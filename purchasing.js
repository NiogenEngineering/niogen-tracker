// Niogen Tracker: purchase orders.
//
// An order has a vendor, items (part, quantity, price, optional radio and note) and extra charges.
// Placing an order puts its items "on order" in inventory. Receiving items adds them to stock.
//
// Shipping, tariffs and fees follow the items they were spent on:
//   - an item tied to a radio adds its share to that radio as an auxiliary cost (like entering shipping by hand)
//   - an item for stock folds its share into the part's unit cost
// Sales tax is recorded on the order but never spread, because each radio already adds its own tax on parts.
//
// "counted" on a line means its remaining quantity is included in the part's on-order amount. It is true
// while the order is Ordered, and keeps the on-order number honest when lines are edited or cancelled.

import { db, AppError, r4, r6, trim, receiveInTx, radioName } from './db.js';
import { round2, num, allocateExtras } from './pricing.js';

export const ORDER_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'ordered', label: 'Ordered' },
  { id: 'received', label: 'Received' },
  { id: 'cancelled', label: 'Cancelled' },
];
export const EXTRA_KINDS = [
  { id: 'shipping', label: 'Shipping', spread: true },
  { id: 'tariff', label: 'Tariff or duty', spread: true },
  { id: 'fee', label: 'Other fee', spread: true },
  { id: 'tax', label: 'Sales tax (recorded only)', spread: false },
];
export const orderStatusLabel = (id) => ORDER_STATUSES.find((s) => s.id === id)?.label ?? id;
export const extraKindLabel = (id) => EXTRA_KINDS.find((k) => k.id === id)?.label ?? id;

const TABLES = () => [db.orders, db.orderLines, db.parts, db.stock, db.aux, db.radios];
const remaining = (l) => Math.max(0, r4(l.qty - (l.receivedQty || 0)));
export const lineRemaining = remaining;

/* ---------- pure helpers ---------- */

export function orderTotals(order, lines) {
  const extras = order.extras ?? [];
  const items = round2(lines.reduce((t, l) => t + num(l.qty) * num(l.price), 0));
  const spread = round2(extras.filter((e) => e.kind !== 'tax').reduce((t, e) => t + num(e.amount), 0));
  const tax = round2(extras.filter((e) => e.kind === 'tax').reduce((t, e) => t + num(e.amount), 0));
  return { items, spread, tax, total: round2(items + spread + tax) };
}

// The extras share of each line, in the same order as `lines`.
export const lineShares = (order, lines) => allocateExtras(lines, orderTotals(order, lines).spread);

// What one unit costs once it is in stock: price plus its extras share, unless it is tied to a radio
// (then the share goes to the radio instead and the part comes in at its plain price).
export const landedUnitCost = (line, share) => (line.radioId ? r6(line.price) : r6(num(line.price) + share / num(line.qty)));

/* ---------- internal: keep derived data in step ---------- */

// The "on order" note on a part lists the open orders it is on.
async function refreshPartNote(partId) {
  const lines = await db.orderLines.where('partId').equals(partId).filter((l) => l.counted && remaining(l) > 0).toArray();
  if (!lines.length) return;
  const orders = await db.orders.bulkGet([...new Set(lines.map((l) => l.orderId))]);
  const numbers = [...new Set(orders.filter(Boolean).map((o) => o.number))].sort();
  await db.parts.update(partId, { onOrderNote: numbers.join(', ') });
}

async function adjustOnOrder(partId, delta) {
  if (!delta) return;
  const part = await db.parts.get(partId);
  if (!part) return;
  const next = Math.max(0, r4((part.onOrderQty || 0) + delta));
  await db.parts.update(partId, {
    onOrderQty: next, onOrderNote: next > 0 ? part.onOrderNote : '', onOrderAt: next > 0 ? part.onOrderAt ?? Date.now() : null, updatedAt: Date.now(),
  });
}

// Recomputes the shipping and fees that radio-tied items have earned so far. One auxiliary cost per radio per order.
// It only counts items that have arrived, so a radio is charged when its parts show up.
async function syncOrderAux(orderId) {
  const order = await db.orders.get(orderId);
  if (!order) return;
  const lines = await db.orderLines.where('orderId').equals(orderId).sortBy('id');
  const shares = lineShares(order, lines);
  const perRadio = new Map();
  lines.forEach((l, i) => {
    const got = l.receivedQty || 0;
    if (!l.radioId || got <= 0) return;
    const portion = Math.min(1, got / l.qty);
    perRadio.set(l.radioId, (perRadio.get(l.radioId) ?? 0) + shares[i] * portion);
  });
  const label = `${order.number} shipping and fees${trim(order.vendor) ? ` (${trim(order.vendor)})` : ''}`;
  const existing = await db.aux.filter((a) => a.orderId === orderId).toArray();
  const now = Date.now();
  const touched = new Set();
  for (const [radioId, raw] of perRadio) {
    const amount = round2(raw);
    const row = existing.find((a) => a.radioId === radioId);
    if (amount <= 0) continue;
    if (!(await db.radios.get(radioId))) continue;
    touched.add(radioId);
    if (row) await db.aux.update(row.id, { label, amount });
    else await db.aux.add({ radioId, label, amount, orderId, createdAt: now });
    await db.radios.update(radioId, { updatedAt: now });
  }
  for (const row of existing) {
    if (!touched.has(row.radioId)) { await db.aux.delete(row.id); await db.radios.update(row.radioId, { updatedAt: now }).catch(() => {}); }
  }
}

const getOpenOrder = async (orderId, allowed = ['draft', 'ordered']) => {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('That order no longer exists.', 'missing');
  if (!allowed.includes(order.status)) throw new AppError(`This order is ${orderStatusLabel(order.status).toLowerCase()} and cannot be changed that way.`, 'invalid');
  return order;
};

/* ---------- orders ---------- */

export async function createOrder({ vendor = '', date, notes = '' } = {}) {
  return db.transaction('rw', db.orders, async () => {
    const all = await db.orders.toArray();
    const max = all.reduce((m, o) => Math.max(m, parseInt(String(o.number).replace(/\D/g, ''), 10) || 0), 0);
    const now = Date.now();
    return db.orders.add({
      number: `PO-${String(max + 1).padStart(4, '0')}`, vendor: trim(vendor), date: Number(date) || now, notes: trim(notes),
      status: 'draft', extras: [], createdAt: now, updatedAt: now,
    });
  });
}

export async function updateOrder(id, fields) {
  return db.transaction('rw', ...TABLES(), async () => {
    const order = await db.orders.get(id);
    if (!order) throw new AppError('That order no longer exists.', 'missing');
    const changes = { updatedAt: Date.now() };
    if (fields.vendor !== undefined) changes.vendor = trim(fields.vendor);
    if (fields.date !== undefined) changes.date = Number(fields.date) || order.date;
    if (fields.notes !== undefined) changes.notes = trim(fields.notes);
    await db.orders.update(id, changes);
    if (changes.vendor !== undefined) await syncOrderAux(id); // the auxiliary cost label shows the vendor
  });
}

export async function deleteOrder(id) {
  return db.transaction('rw', ...TABLES(), async () => {
    const order = await db.orders.get(id);
    if (!order) return;
    if (!['draft', 'cancelled'].includes(order.status)) throw new AppError('Only a draft or cancelled order can be deleted. Cancel this one first.', 'invalid');
    const lines = await db.orderLines.where('orderId').equals(id).toArray();
    for (const l of lines) if (l.counted) await adjustOnOrder(l.partId, -remaining(l));
    await db.aux.filter((a) => a.orderId === id).delete();
    await db.orderLines.where('orderId').equals(id).delete();
    await db.orders.delete(id);
  });
}

export async function placeOrder(id) {
  return db.transaction('rw', ...TABLES(), async () => {
    const order = await getOpenOrder(id, ['draft']);
    const lines = await db.orderLines.where('orderId').equals(id).toArray();
    if (!lines.length) throw new AppError('Add at least one item before placing the order.', 'invalid');
    if (!trim(order.vendor)) throw new AppError('Enter the vendor before placing the order.', 'invalid');
    const now = Date.now();
    for (const l of lines) {
      if (!l.counted) { await adjustOnOrder(l.partId, remaining(l)); await db.orderLines.update(l.id, { counted: true }); }
      await db.stock.add({ partId: l.partId, delta: 0, reason: 'ordered', note: `${order.number}: ${r4(l.qty)} ordered from ${trim(order.vendor)}`, date: now });
      await refreshPartNote(l.partId);
    }
    await db.orders.update(id, { status: 'ordered', orderedAt: now, updatedAt: now });
  });
}

// Takes an order back to Draft. Only possible while nothing has arrived.
export async function backToDraft(id) {
  return db.transaction('rw', ...TABLES(), async () => {
    await getOpenOrder(id, ['ordered']);
    const lines = await db.orderLines.where('orderId').equals(id).toArray();
    if (lines.some((l) => (l.receivedQty || 0) > 0)) throw new AppError('Some items have already arrived, so this order cannot go back to draft.', 'invalid');
    for (const l of lines) if (l.counted) { await adjustOnOrder(l.partId, -remaining(l)); await db.orderLines.update(l.id, { counted: false }); }
    await db.orders.update(id, { status: 'draft', updatedAt: Date.now() });
  });
}

// Cancels what has not arrived yet. Items that already arrived stay in stock.
export async function cancelOrder(id) {
  return db.transaction('rw', ...TABLES(), async () => {
    const order = await getOpenOrder(id);
    const lines = await db.orderLines.where('orderId').equals(id).toArray();
    const now = Date.now();
    for (const l of lines) {
      if (!l.counted) continue;
      await adjustOnOrder(l.partId, -remaining(l));
      await db.orderLines.update(l.id, { counted: false });
      await db.stock.add({ partId: l.partId, delta: 0, reason: 'ordered', note: `${order.number} cancelled`, date: now });
    }
    await db.orders.update(id, { status: 'cancelled', updatedAt: now });
  });
}

/* ---------- lines ---------- */

async function checkLineInput({ qty, price, radioId }) {
  const q = num(qty);
  if (!(q > 0)) throw new AppError('Enter a quantity greater than zero.', 'invalid');
  const raw = String(price ?? '').trim();
  if (raw === '' || num(raw) < 0) throw new AppError('Enter a price of zero or more.', 'invalid');
  if (radioId) {
    if (!(await db.radios.get(Number(radioId)))) throw new AppError('That radio no longer exists.', 'missing');
  }
  return { qty: r4(q), price: r6(num(raw)), radioId: radioId ? Number(radioId) : null };
}

export async function addOrderLine(orderId, input) {
  const clean = await checkLineInput(input);
  return db.transaction('rw', ...TABLES(), async () => {
    const order = await getOpenOrder(orderId);
    const part = await db.parts.get(Number(input.partId));
    if (!part) throw new AppError('Choose a part for this item.', 'invalid');
    const counted = order.status === 'ordered';
    const id = await db.orderLines.add({ orderId, partId: part.id, ...clean, note: trim(input.note), receivedQty: 0, counted, createdAt: Date.now() });
    if (counted) { await adjustOnOrder(part.id, clean.qty); await refreshPartNote(part.id); }
    await db.orders.update(orderId, { updatedAt: Date.now() });
    return id;
  });
}

export async function updateOrderLine(lineId, input) {
  return db.transaction('rw', ...TABLES(), async () => {
    const line = await db.orderLines.get(lineId);
    if (!line) throw new AppError('That item no longer exists.', 'missing');
    const order = await db.orders.get(line.orderId);
    const got = line.receivedQty || 0;
    const changes = {};
    if (input.note !== undefined) changes.note = trim(input.note);
    const editable = ['draft', 'ordered'].includes(order.status);
    if (input.qty !== undefined || input.price !== undefined || input.radioId !== undefined) {
      if (!editable) throw new AppError('This order is closed. Only notes can be changed.', 'invalid');
      const clean = await checkLineInput({ qty: input.qty ?? line.qty, price: input.price ?? line.price, radioId: input.radioId !== undefined ? input.radioId : line.radioId });
      if (clean.qty < got) throw new AppError(`${got} have already arrived, so the quantity cannot go below that.`, 'invalid');
      if (got > 0 && clean.price !== line.price) throw new AppError('This item has arrived, so its price is locked.', 'invalid');
      if (got > 0 && clean.radioId !== line.radioId) throw new AppError('This item has arrived, so its radio cannot be changed.', 'invalid');
      if (line.counted) await adjustOnOrder(line.partId, remaining({ qty: clean.qty, receivedQty: got }) - remaining(line));
      Object.assign(changes, clean);
    }
    await db.orderLines.update(lineId, changes);
    await refreshPartNote(line.partId);
    await db.orders.update(line.orderId, { updatedAt: Date.now() });
    await syncOrderAux(line.orderId);
  });
}

export async function removeOrderLine(lineId) {
  return db.transaction('rw', ...TABLES(), async () => {
    const line = await db.orderLines.get(lineId);
    if (!line) return;
    await getOpenOrder(line.orderId);
    if ((line.receivedQty || 0) > 0) throw new AppError('This item has already arrived and cannot be removed.', 'invalid');
    if (line.counted) await adjustOnOrder(line.partId, -remaining(line));
    await db.orderLines.delete(lineId);
    await refreshPartNote(line.partId);
    await db.orders.update(line.orderId, { updatedAt: Date.now() });
  });
}

/* ---------- extra charges ---------- */

function cleanExtra(input) {
  if (!EXTRA_KINDS.some((k) => k.id === input.kind)) throw new AppError('Choose what kind of charge this is.', 'invalid');
  const raw = String(input.amount ?? '').trim();
  if (raw === '' || !(num(raw) > 0)) throw new AppError('Enter an amount greater than zero.', 'invalid');
  return { kind: input.kind, label: trim(input.label) || extraKindLabel(input.kind), amount: round2(num(raw)) };
}

async function saveExtras(orderId, change) {
  return db.transaction('rw', ...TABLES(), async () => {
    const order = await getOpenOrder(orderId);
    const extras = [...(order.extras ?? [])];
    change(extras);
    await db.orders.update(orderId, { extras, updatedAt: Date.now() });
    await syncOrderAux(orderId);
  });
}
export const addOrderExtra = async (orderId, input) => { const e = cleanExtra(input); return saveExtras(orderId, (list) => list.push({ id: `${Date.now()}${list.length}`, ...e })); };
export const updateOrderExtra = async (orderId, extraId, input) => { const e = cleanExtra(input); return saveExtras(orderId, (list) => { const i = list.findIndex((x) => x.id === extraId); if (i >= 0) list[i] = { id: extraId, ...e }; }); };
export const removeOrderExtra = (orderId, extraId) => saveExtras(orderId, (list) => { const i = list.findIndex((x) => x.id === extraId); if (i >= 0) list.splice(i, 1); });

/* ---------- receiving ---------- */

// Runs inside a transaction. Adds the quantity to stock at the landed unit cost, and closes the order when everything has arrived.
async function receiveLineInTx(lineId, qty) {
  const q = num(qty);
  if (!(q > 0)) throw new AppError('Enter a quantity greater than zero.', 'invalid');
  const line = await db.orderLines.get(lineId);
  if (!line) throw new AppError('That item no longer exists.', 'missing');
  const order = await db.orders.get(line.orderId);
  if (order.status !== 'ordered') throw new AppError(order.status === 'draft' ? 'Place the order first, then receive items.' : `This order is ${orderStatusLabel(order.status).toLowerCase()}.`, 'invalid');
  const lines = await db.orderLines.where('orderId').equals(order.id).sortBy('id');
  const shares = lineShares(order, lines);
  const share = shares[lines.findIndex((l) => l.id === lineId)] ?? 0;
  const unitCost = landedUnitCost(line, share);
  const before = remaining(line);
  const result = await receiveInTx(line.partId, r4(q), unitCost, `${order.number} from ${trim(order.vendor)}`, Math.min(q, before));
  await db.orderLines.update(lineId, { receivedQty: r4((line.receivedQty || 0) + q) });
  await refreshPartNote(line.partId);
  const after = await db.orderLines.where('orderId').equals(order.id).toArray();
  const done = after.every((l) => remaining(l) <= 0);
  const now = Date.now();
  await db.orders.update(order.id, done ? { status: 'received', receivedAt: now, updatedAt: now } : { updatedAt: now });
  await syncOrderAux(order.id);
  return { ...result, unitCost, complete: done };
}

export const receiveOrderLine = (lineId, qty) => db.transaction('rw', ...TABLES(), () => receiveLineInTx(lineId, qty));

export async function receiveOrderAll(orderId) {
  return db.transaction('rw', ...TABLES(), async () => {
    await getOpenOrder(orderId, ['ordered']);
    const lines = await db.orderLines.where('orderId').equals(orderId).sortBy('id');
    let pieces = 0;
    for (const l of lines) { const rem = remaining(l); if (rem > 0) { await receiveLineInTx(l.id, rem); pieces += rem; } }
    return pieces;
  });
}

/* ---------- reading ---------- */

export async function loadOrderBundle(id) {
  const order = await db.orders.get(id);
  if (!order) return null;
  const lines = await db.orderLines.where('orderId').equals(id).sortBy('id');
  const parts = await db.parts.bulkGet([...new Set(lines.map((l) => l.partId))]);
  const partMap = new Map(parts.filter(Boolean).map((p) => [p.id, p]));
  const radios = await db.radios.toArray();
  const radioMap = new Map(radios.map((r) => [r.id, r]));
  const shares = lineShares(order, lines);
  lines.forEach((l, i) => {
    l.part = partMap.get(l.partId) ?? null;
    l.radio = l.radioId ? radioMap.get(l.radioId) ?? null : null;
    l.share = shares[i];
    l.landed = landedUnitCost(l, shares[i]);
    l.remaining = remaining(l);
  });
  return { order, lines, radios, totals: orderTotals(order, lines) };
}

export async function listOrders() {
  const [orders, lines] = await Promise.all([db.orders.toArray(), db.orderLines.toArray()]);
  const byOrder = new Map();
  for (const l of lines) { if (!byOrder.has(l.orderId)) byOrder.set(l.orderId, []); byOrder.get(l.orderId).push(l); }
  return orders.map((order) => {
    const ls = byOrder.get(order.id) ?? [];
    const ordered = r4(ls.reduce((t, l) => t + l.qty, 0));
    const got = r4(ls.reduce((t, l) => t + Math.min(l.qty, l.receivedQty || 0), 0));
    return { order, lineCount: ls.length, ordered, got, totals: orderTotals(order, ls), partly: order.status === 'ordered' && got > 0 };
  }).sort((a, b) => b.order.date - a.order.date || b.order.id - a.order.id);
}

// Items tied to one radio, for its "Incoming parts" panel.
export async function listIncomingForRadio(radioId) {
  const lines = await db.orderLines.where('radioId').equals(radioId).toArray();
  const orders = await db.orders.bulkGet([...new Set(lines.map((l) => l.orderId))]);
  const orderMap = new Map(orders.filter(Boolean).map((o) => [o.id, o]));
  const parts = await db.parts.bulkGet([...new Set(lines.map((l) => l.partId))]);
  const partMap = new Map(parts.filter(Boolean).map((p) => [p.id, p]));
  return lines
    .map((l) => ({ ...l, order: orderMap.get(l.orderId), part: partMap.get(l.partId) }))
    .filter((l) => l.order && l.part && l.order.status !== 'cancelled')
    .sort((a, b) => b.order.date - a.order.date || a.id - b.id);
}

/* ---------- bringing in orders that were entered as plain "on order" amounts ---------- */

// Parts whose on-order amount is not covered by any open order line.
export async function uncoveredOnOrder() {
  const parts = await db.parts.filter((p) => p.onOrderQty > 0).toArray();
  const lines = await db.orderLines.filter((l) => l.counted).toArray();
  const covered = new Map();
  for (const l of lines) covered.set(l.partId, (covered.get(l.partId) ?? 0) + remaining(l));
  return parts
    .map((part) => ({ part, qty: r4(part.onOrderQty - (covered.get(part.id) ?? 0)) }))
    .filter((x) => x.qty > 0);
}

// One order per vendor, already Ordered (they are on their way). The on-order amounts do not change.
export async function createOrdersFromOnOrder() {
  return db.transaction('rw', ...TABLES(), async () => {
    const uncovered = await uncoveredOnOrder();
    if (!uncovered.length) return [];
    const groups = new Map();
    for (const u of uncovered) {
      const vendor = trim(u.part.vendor) || 'Unknown vendor';
      if (!groups.has(vendor)) groups.set(vendor, []);
      groups.get(vendor).push(u);
    }
    const all = await db.orders.toArray();
    let seq = all.reduce((m, o) => Math.max(m, parseInt(String(o.number).replace(/\D/g, ''), 10) || 0), 0);
    const made = [];
    for (const [vendor, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      const when = Math.min(...items.map((u) => u.part.onOrderAt ?? Date.now()));
      const now = Date.now();
      const id = await db.orders.add({
        number: `PO-${String(++seq).padStart(4, '0')}`, vendor: vendor === 'Unknown vendor' ? '' : vendor, date: when,
        notes: 'Created from parts that were already marked on order. Add shipping and fees, and tie items to radios.',
        status: 'ordered', extras: [], imported: true, orderedAt: when, createdAt: now, updatedAt: now,
      });
      await db.orderLines.bulkAdd(items.map((u, i) => ({
        orderId: id, partId: u.part.id, qty: u.qty, price: u.part.unitCost, radioId: null,
        note: u.part.onOrderNote || '', receivedQty: 0, counted: true, createdAt: now + i,
      })));
      for (const u of items) await refreshPartNote(u.part.id);
      made.push({ id, vendor, lines: items.length });
    }
    return made;
  });
}

export { radioName };
