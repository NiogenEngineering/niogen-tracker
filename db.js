// Niogen Tracker: data layer (IndexedDB through Dexie).
// Every stock-changing action runs inside one transaction, so stock counts and
// radio costs can never drift apart if something fails halfway.

import Dexie from './vendor/dexie.min.mjs';
import { round2, num, computeCosts } from './pricing.js';

export const STATUSES = [
  { id: 'disrepair', label: 'Disrepair' },
  { id: 'repair', label: 'In repair' },
  { id: 'finished', label: 'Finished' },
  { id: 'sold', label: 'Sold' },
];
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label ?? id;

export const DEFAULT_CATEGORIES = [
  'Capacitor', 'Resistor', 'Tube', 'Transformer', 'Speaker',
  'Dial / knob', 'Switch / pot', 'Cabinet / hardware', 'Wiring', 'Other',
];

export const DEFAULT_SETTINGS = {
  laborRate: 20,
  taxPct: 8.25,
  cushionPct: 10,
  theme: 'auto',
  lastBackupAt: null,
  sellersSeeded: false,
};

// Starting values only. Checked against published 2026 fee pages, but the sources
// disagree in places, so confirm against your own seller dashboards in Settings.
export const SEED_SELLERS = [
  { name: 'Etsy', feePct: 9.5, fixedFee: 0.45, active: true, order: 1 },
  { name: 'eBay', feePct: 13.6, fixedFee: 0.4, active: true, order: 2 },
  { name: 'Facebook Marketplace', feePct: 10, fixedFee: 0, active: true, order: 3 },
];

export class AppError extends Error {
  constructor(message, code = 'error', data = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.data = data;
  }
}

export const db = new Dexie('niogen-tracker');
db.version(1).stores({
  parts: '++id, &key, partNumber',
  radios: '++id, status, updatedAt',
  components: '++id, radioId, partId',
  aux: '++id, radioId',
  stock: '++id, partId, radioId, date',
  photos: '++id, radioId',
  photoBlobs: 'id',
  sellers: '++id, order',
  listings: '++id, &[radioId+sellerId], radioId, sellerId',
  settings: 'key',
});

/* ---------- change notification (drives the auto-backup) ---------- */

const listeners = new Set();
let timer = null;
let muted = 0;
export function onDataChanged(fn) { listeners.add(fn); }
function notify() {
  if (muted) return;
  clearTimeout(timer);
  timer = setTimeout(() => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }), 4000);
  timer?.unref?.();
}
export async function withoutNotify(fn) {
  muted++;
  try { return await fn(); } finally { muted--; }
}
db.tables.forEach((t) => {
  if (t.name === 'settings') return;
  t.hook('creating', () => { notify(); });
  t.hook('updating', () => { notify(); });
  t.hook('deleting', () => { notify(); });
});

/* ---------- small helpers ---------- */

export const r4 = (n) => Math.round(num(n) * 1e4) / 1e4;
export const r6 = (n) => Math.round(num(n) * 1e6) / 1e6;
const trim = (v) => String(v ?? '').trim();
export const keyOf = (partNumber) => String(partNumber ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* ---------- settings ---------- */

export async function getSettings() {
  const rows = await db.settings.toArray();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}
export const setSetting = (key, value) => db.settings.put({ key, value });

export async function initDb() {
  await db.open();
  const s = await getSettings();
  if (!s.sellersSeeded) {
    if ((await db.sellers.count()) === 0) await db.sellers.bulkAdd(SEED_SELLERS);
    await setSetting('sellersSeeded', true);
  }
}

/* ---------- parts / inventory ---------- */

export const listParts = () => db.parts.toArray();
export const getPart = (id) => db.parts.get(id);

export async function findPartByNumber(partNumber, exceptId = null) {
  const key = keyOf(partNumber);
  if (!key) return null;
  const p = await db.parts.where('key').equals(key).first();
  return p && p.id !== exceptId ? p : null;
}

export async function findPartByDescription(description, exceptId = null) {
  const d = trim(description).toLowerCase();
  if (!d) return null;
  const all = await db.parts.toArray();
  return all.find((p) => p.id !== exceptId && p.description.trim().toLowerCase() === d) ?? null;
}

function cleanPartInput(input) {
  const partNumber = trim(input.partNumber);
  const description = trim(input.description);
  if (!partNumber || !keyOf(partNumber)) throw new AppError('Enter a part number.', 'invalid');
  if (!description) throw new AppError('Enter a description.', 'invalid');
  const unitCost = num(input.unitCost);
  if (unitCost < 0) throw new AppError('Unit cost cannot be negative.', 'invalid');
  return { partNumber, description, unitCost: r6(unitCost), bin: trim(input.bin), vendor: trim(input.vendor) };
}

const dupMessage = (dup) =>
  `Part number ${dup.partNumber} already exists (${dup.description}). Part numbers ignore case, spaces, and dashes.`;

export async function addPart(input) {
  const clean = cleanPartInput(input);
  const qty = num(input.qty);
  if (qty < 0) throw new AppError('Quantity cannot be negative.', 'invalid');
  return db.transaction('rw', db.parts, db.stock, async () => {
    const dup = await findPartByNumber(clean.partNumber);
    if (dup) throw new AppError(dupMessage(dup), 'duplicate', dup);
    const now = Date.now();
    const id = await db.parts.add({ ...clean, key: keyOf(clean.partNumber), qty: r4(qty), createdAt: now, updatedAt: now });
    if (qty > 0) await db.stock.add({ partId: id, delta: r4(qty), reason: 'initial', note: 'Added to inventory', unitCost: clean.unitCost, date: now });
    return id;
  });
}

export async function updatePart(id, input) {
  const clean = cleanPartInput(input);
  return db.transaction('rw', db.parts, async () => {
    const dup = await findPartByNumber(clean.partNumber, id);
    if (dup) throw new AppError(dupMessage(dup), 'duplicate', dup);
    await db.parts.update(id, { ...clean, key: keyOf(clean.partNumber), updatedAt: Date.now() });
  });
}

// Weighted-average cost: a new case of resistors at a different price blends in
// with what is already on the shelf. Radios keep the cost they were issued at.
export async function receiveStock(partId, qty, unitCost, note = '') {
  qty = num(qty); unitCost = num(unitCost);
  if (!(qty > 0)) throw new AppError('Enter a quantity greater than zero.', 'invalid');
  if (unitCost < 0) throw new AppError('Unit cost cannot be negative.', 'invalid');
  return db.transaction('rw', db.parts, db.stock, async () => {
    const part = await db.parts.get(partId);
    if (!part) throw new AppError('That part no longer exists.', 'missing');
    const newQty = r4(part.qty + qty);
    const newCost = part.qty > 0 ? r6((part.qty * part.unitCost + qty * unitCost) / newQty) : r6(unitCost);
    await db.parts.update(partId, { qty: newQty, unitCost: newCost, updatedAt: Date.now() });
    await db.stock.add({ partId, delta: r4(qty), reason: 'received', note: trim(note), unitCost: r6(unitCost), date: Date.now() });
    return { qty: newQty, unitCost: newCost };
  });
}

export async function adjustStock(partId, newQty, reasonLabel = 'Count correction', note = '') {
  newQty = num(newQty);
  if (newQty < 0) throw new AppError('Quantity cannot be negative.', 'invalid');
  return db.transaction('rw', db.parts, db.stock, async () => {
    const part = await db.parts.get(partId);
    if (!part) throw new AppError('That part no longer exists.', 'missing');
    const delta = r4(newQty - part.qty);
    if (delta === 0) return part.qty;
    await db.parts.update(partId, { qty: r4(newQty), updatedAt: Date.now() });
    await db.stock.add({ partId, delta, reason: 'adjusted', note: [reasonLabel, trim(note)].filter(Boolean).join(': '), date: Date.now() });
    return r4(newQty);
  });
}

export async function deletePart(id) {
  return db.transaction('rw', db.parts, db.stock, db.components, async () => {
    const used = await db.components.where('partId').equals(id).count();
    if (used > 0) throw new AppError(`This part is used on ${used} radio line${used === 1 ? '' : 's'}. Remove those first, or leave the quantity at 0.`, 'in-use');
    await db.stock.where('partId').equals(id).delete();
    await db.parts.delete(id);
  });
}

// "C-" or "C-203" -> next unused number in that series, e.g. "C-204".
export async function suggestNextPartNumber(seed) {
  const s = trim(seed);
  const m = s.match(/^(.*?)(\d*)$/);
  const prefix = m[1];
  let width = m[2].length || 3;
  let max = 0;
  for (const p of await db.parts.toArray()) {
    if (!p.partNumber.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const tail = p.partNumber.slice(prefix.length);
    if (/^\d+$/.test(tail)) {
      max = Math.max(max, parseInt(tail, 10));
      width = Math.max(width, tail.length);
    }
  }
  return prefix + String(max + 1).padStart(width, '0');
}

export async function stockHistory(partId) {
  const rows = await db.stock.where('partId').equals(partId).toArray();
  const radioIds = [...new Set(rows.map((r) => r.radioId).filter(Boolean))];
  const radios = await db.radios.bulkGet(radioIds);
  const names = new Map(radios.filter(Boolean).map((r) => [r.id, radioName(r)]));
  return rows
    .map((r) => ({ ...r, radioName: r.radioId ? names.get(r.radioId) ?? 'Deleted radio' : '' }))
    .sort((a, b) => b.date - a.date || b.id - a.id);
}

export async function listVendors() {
  const parts = await db.parts.toArray();
  return [...new Set(parts.map((p) => p.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/* ---------- radios ---------- */

export const radioName = (r) => [r.manufacturer, r.model].filter(Boolean).join(' ') || 'Untitled radio';

export async function createRadio(input) {
  const s = await getSettings();
  const now = Date.now();
  return db.radios.add({
    manufacturer: trim(input.manufacturer),
    model: trim(input.model),
    year: trim(input.year),
    chassis: trim(input.chassis),
    notes: '',
    status: input.status && input.status !== 'sold' ? input.status : 'disrepair',
    laborRate: num(s.laborRate),
    taxPct: num(s.taxPct),
    cushionPct: num(s.cushionPct),
    createdAt: now,
    updatedAt: now,
  });
}

export const updateRadio = (id, fields) => db.radios.update(id, { ...fields, updatedAt: Date.now() });

export async function markSold(id, { sellerId = null, sellerName = '', salePrice, saleFee, soldAt }) {
  salePrice = num(salePrice);
  if (!(salePrice > 0)) throw new AppError('Enter the price it sold for.', 'invalid');
  await db.radios.update(id, {
    status: 'sold', soldSellerId: sellerId, soldSellerName: trim(sellerName),
    salePrice: round2(salePrice), saleFee: round2(num(saleFee)), soldAt: soldAt || Date.now(), updatedAt: Date.now(),
  });
}

export async function reopenRadio(id, status) {
  await db.radios.update(id, {
    status, soldSellerId: null, soldSellerName: '', salePrice: null, saleFee: null, soldAt: null, updatedAt: Date.now(),
  });
}

export async function deleteRadio(id, { returnParts }) {
  return db.transaction('rw', db.radios, db.components, db.parts, db.stock, db.aux, db.photos, db.photoBlobs, db.listings, async () => {
    const comps = await db.components.where('radioId').equals(id).toArray();
    if (returnParts) {
      for (const c of comps) {
        if (!c.partId) continue;
        const part = await db.parts.get(c.partId);
        if (!part) continue;
        await db.parts.update(part.id, { qty: r4(part.qty + c.qty), updatedAt: Date.now() });
        await db.stock.add({ partId: part.id, radioId: id, delta: r4(c.qty), reason: 'returned', note: 'Radio deleted', date: Date.now() });
      }
    }
    const photoIds = (await db.photos.where('radioId').equals(id).primaryKeys());
    await db.photoBlobs.bulkDelete(photoIds);
    await db.photos.where('radioId').equals(id).delete();
    await db.components.where('radioId').equals(id).delete();
    await db.aux.where('radioId').equals(id).delete();
    await db.listings.where('radioId').equals(id).delete();
    await db.radios.delete(id);
  });
}

export async function loadRadioBundle(id) {
  const radio = await db.radios.get(id);
  if (!radio) return null;
  const [components, aux, listings, photos] = await Promise.all([
    db.components.where('radioId').equals(id).toArray(),
    db.aux.where('radioId').equals(id).toArray(),
    db.listings.where('radioId').equals(id).toArray(),
    db.photos.where('radioId').equals(id).toArray(),
  ]);
  const partIds = [...new Set(components.map((c) => c.partId).filter(Boolean))];
  const parts = (await db.parts.bulkGet(partIds)).filter(Boolean);
  const byId = new Map(parts.map((p) => [p.id, p]));
  components.forEach((c) => { c.part = c.partId ? byId.get(c.partId) ?? null : null; });
  photos.sort((a, b) => a.order - b.order);
  return { radio, components, aux, listings, photos };
}

export async function loadRadioSummaries() {
  const [radios, components, aux, photos] = await Promise.all([
    db.radios.toArray(), db.components.toArray(), db.aux.toArray(), db.photos.toArray(),
  ]);
  const group = (rows) => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.radioId)) m.set(r.radioId, []); m.get(r.radioId).push(r); }
    return m;
  };
  const gc = group(components), ga = group(aux), gp = group(photos);
  return radios
    .map((radio) => {
      const costs = computeCosts({
        components: gc.get(radio.id) ?? [], aux: ga.get(radio.id) ?? [],
        laborRate: radio.laborRate, taxPct: radio.taxPct,
      });
      const pics = (gp.get(radio.id) ?? []).sort((a, b) => a.order - b.order);
      return { radio, costs, cover: pics[0] ?? null, photoCount: pics.length, lineCount: (gc.get(radio.id) ?? []).length };
    })
    .sort((a, b) => b.radio.updatedAt - a.radio.updatedAt);
}

/* ---------- components (the parts list on a radio) ---------- */

const stockError = (part, needed) =>
  new AppError(`Only ${part.qty} of ${part.partNumber} on hand, and this line needs ${needed}. Receive more stock or correct the count first.`, 'stock', { part, needed });

export async function addComponent(radioId, input) {
  const qty = num(input.qty || 1);
  if (!(qty > 0)) throw new AppError('Enter a quantity greater than zero.', 'invalid');
  return db.transaction('rw', db.components, db.parts, db.stock, db.radios, async () => {
    const now = Date.now();
    let unitCost = num(input.unitCost);
    let description = trim(input.description);
    if (input.partId) {
      const part = await db.parts.get(input.partId);
      if (!part) throw new AppError('That part no longer exists.', 'missing');
      if (part.qty < qty - 1e-9) throw stockError(part, qty);
      await db.parts.update(part.id, { qty: r4(part.qty - qty), updatedAt: now });
      await db.stock.add({ partId: part.id, radioId, delta: -r4(qty), reason: 'issued', unitCost: part.unitCost, date: now });
      unitCost = part.unitCost;
      description = description || part.description;
    }
    if (!description) throw new AppError('Enter a description.', 'invalid');
    if (unitCost < 0) throw new AppError('Cost cannot be negative.', 'invalid');
    const id = await db.components.add({
      radioId, partId: input.partId || null, category: trim(input.category) || 'Other', ref: trim(input.ref),
      description, qty: r4(qty), unitCost: r6(unitCost), verified: !!input.verified, createdAt: now,
    });
    await db.radios.update(radioId, { updatedAt: now });
    return id;
  });
}

export async function updateComponent(id, input) {
  return db.transaction('rw', db.components, db.parts, db.stock, db.radios, async () => {
    const comp = await db.components.get(id);
    if (!comp) throw new AppError('That line no longer exists.', 'missing');
    const now = Date.now();
    const qty = input.qty === undefined ? comp.qty : num(input.qty);
    if (!(qty > 0)) throw new AppError('Enter a quantity greater than zero.', 'invalid');
    const description = trim(input.description ?? comp.description);
    if (!description) throw new AppError('Enter a description.', 'invalid');
    const delta = r4(qty - comp.qty);
    if (comp.partId && delta !== 0) {
      const part = await db.parts.get(comp.partId);
      if (!part) throw new AppError('The linked part no longer exists.', 'missing');
      if (delta > 0 && part.qty < delta - 1e-9) throw stockError(part, delta);
      await db.parts.update(part.id, { qty: r4(part.qty - delta), updatedAt: now });
      await db.stock.add({
        partId: part.id, radioId: comp.radioId, delta: -delta, reason: delta > 0 ? 'issued' : 'returned',
        note: 'Line quantity changed', unitCost: comp.unitCost, date: now,
      });
    }
    const changes = {
      category: trim(input.category ?? comp.category) || 'Other',
      ref: trim(input.ref ?? comp.ref), description, qty: r4(qty),
      verified: input.verified === undefined ? comp.verified : !!input.verified,
    };
    if (!comp.partId && input.unitCost !== undefined) changes.unitCost = r6(Math.max(0, num(input.unitCost)));
    await db.components.update(id, changes);
    await db.radios.update(comp.radioId, { updatedAt: now });
  });
}

export const setVerified = (id, verified) => db.components.update(id, { verified: !!verified });

export async function removeComponent(id, { returnToStock }) {
  return db.transaction('rw', db.components, db.parts, db.stock, db.radios, async () => {
    const comp = await db.components.get(id);
    if (!comp) return;
    const now = Date.now();
    if (comp.partId && returnToStock) {
      const part = await db.parts.get(comp.partId);
      if (part) {
        await db.parts.update(part.id, { qty: r4(part.qty + comp.qty), updatedAt: now });
        await db.stock.add({ partId: part.id, radioId: comp.radioId, delta: r4(comp.qty), reason: 'returned', note: 'Removed from radio', date: now });
      }
    } else if (comp.partId) {
      await db.stock.add({ partId: comp.partId, radioId: comp.radioId, delta: 0, reason: 'consumed', note: 'Removed from radio, not returned', date: now });
    }
    await db.components.delete(id);
    await db.radios.update(comp.radioId, { updatedAt: now });
  });
}

/* ---------- auxiliary costs ---------- */

function cleanAux(input) {
  const label = trim(input.label);
  if (!label) throw new AppError('Enter a label for this cost.', 'invalid');
  const raw = String(input.amount ?? '').trim();
  const amount = num(raw);
  if (raw === '' || amount < 0) throw new AppError('Enter an amount of zero or more.', 'invalid');
  return { label, amount: round2(amount) };
}
export async function addAux(radioId, input) {
  const id = await db.aux.add({ radioId, ...cleanAux(input), createdAt: Date.now() });
  await db.radios.update(radioId, { updatedAt: Date.now() });
  return id;
}
export const updateAux = (id, input) => db.aux.update(id, cleanAux(input));
export const removeAux = (id) => db.aux.delete(id);

/* ---------- selling sites + listings ---------- */

export const listSellers = async () => (await db.sellers.toArray()).sort((a, b) => a.order - b.order || a.id - b.id);

function cleanSeller(input) {
  const name = trim(input.name);
  if (!name) throw new AppError('Enter a name for the selling site.', 'invalid');
  const feePct = num(input.feePct), fixedFee = num(input.fixedFee);
  if (feePct < 0 || feePct >= 100) throw new AppError('Fee percent must be between 0 and 100.', 'invalid');
  if (fixedFee < 0) throw new AppError('Fixed fee cannot be negative.', 'invalid');
  return { name, feePct, fixedFee: round2(fixedFee) };
}
export async function addSeller(input) {
  const order = ((await db.sellers.orderBy('order').last())?.order ?? 0) + 1;
  return db.sellers.add({ ...cleanSeller(input), active: true, order });
}
export const updateSeller = (id, input) => db.sellers.update(id, cleanSeller(input));
export const setSellerActive = (id, active) => db.sellers.update(id, { active: !!active });
export async function deleteSeller(id) {
  await db.transaction('rw', db.sellers, db.listings, async () => {
    await db.listings.where('sellerId').equals(id).delete();
    await db.sellers.delete(id);
  });
}

export async function setListing(radioId, sellerId, price) {
  const ex = await db.listings.where('[radioId+sellerId]').equals([radioId, sellerId]).first();
  const p = String(price ?? '').trim();
  if (p === '' || !(num(p) > 0)) { if (ex) await db.listings.delete(ex.id); return; }
  if (ex) await db.listings.update(ex.id, { price: round2(num(p)) });
  else await db.listings.add({ radioId, sellerId, price: round2(num(p)) });
}

/* ---------- photos ---------- */

export async function addPhoto(radioId, { thumb, full }) {
  return db.transaction('rw', db.photos, db.photoBlobs, db.radios, async () => {
    const last = await db.photos.where('radioId').equals(radioId).toArray();
    const order = last.length ? Math.max(...last.map((p) => p.order)) + 1 : 0;
    const id = await db.photos.add({ radioId, order, thumb, createdAt: Date.now() });
    await db.photoBlobs.put({ id, blob: full });
    await db.radios.update(radioId, { updatedAt: Date.now() });
    return id;
  });
}
export async function setCover(photoId) {
  const p = await db.photos.get(photoId);
  if (!p) return;
  const all = await db.photos.where('radioId').equals(p.radioId).toArray();
  await db.photos.update(photoId, { order: Math.min(...all.map((x) => x.order)) - 1 });
}
export async function deletePhoto(photoId) {
  await db.transaction('rw', db.photos, db.photoBlobs, async () => {
    await db.photos.delete(photoId);
    await db.photoBlobs.delete(photoId);
  });
}
export const getFullPhoto = async (id) => (await db.photoBlobs.get(id))?.blob ?? null;

/* ---------- misc lookups ---------- */

export async function listCategories() {
  const used = (await db.components.toArray()).map((c) => c.category);
  return [...new Set([...DEFAULT_CATEGORIES, ...used])];
}
