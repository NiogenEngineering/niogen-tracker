// One purchase order: details, items (each with a radio dropdown and note), extra charges, and receiving.

import { S } from './state.js';
import * as D from './db.js';
import * as O from './purchasing.js';
import { num } from './pricing.js';
import {
  esc, money, unitMoney, fmtQty, fmtDate, dateInputValue, fromDateInput, formData,
  openModal, confirmChoice, toast, $,
} from './ui.js';

let B = null;

const natural = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const isOpen = () => ['draft', 'ordered'].includes(B.order.status);
const anyReceived = () => B.lines.some((l) => (l.receivedQty || 0) > 0);

export async function render(el, route) {
  B = await O.loadOrderBundle(route.id);
  if (!B) {
    el.innerHTML = `<div class="panel empty"><h2>Order not found</h2><p>It may have been deleted.</p><a class="btn primary" href="#/orders">Back to orders</a></div>`;
    return;
  }
  el.innerHTML = `
    <a class="back" href="#/orders">&larr; All orders</a>
    <section class="panel asset-head" id="orderHead"></section>
    <div class="two-col">
      <section class="panel" id="orderDetails"></section>
      <section class="panel" id="orderSummary"></section>
    </div>
    <section class="panel" id="orderItems"></section>
    <section class="panel" id="orderCharges"></section>`;
  paintAll();
  document.title = `${B.order.number} - Niogen Tracker`;
}

async function reload() {
  const fresh = await O.loadOrderBundle(B.order.id);
  if (!$('#orderHead')) return; // the person already moved to another screen while this finished
  B = fresh;
  paintAll();
}

function paintAll() { paintHead(); paintDetails(); paintSummary(); paintItems(); paintCharges(); }

/* ---------- header ---------- */

function stateStamp() {
  const { order } = B;
  const got = B.lines.reduce((t, l) => t + Math.min(l.qty, l.receivedQty || 0), 0);
  if (order.status === 'ordered' && got > 0) return '<span class="chip os-partly">Partly received</span>';
  return `<span class="chip os-${order.status}">${esc(O.orderStatusLabel(order.status))}</span>`;
}

function paintHead() {
  const { order, lines } = B;
  const pending = lines.some((l) => l.remaining > 0);
  const buttons = {
    draft: `<button class="btn primary" data-action="place-order">Place order</button>
            <button class="btn ghost danger-text" data-action="delete-order">Delete draft</button>`,
    ordered: `${pending ? '<button class="btn primary" data-action="receive-all">Receive all remaining</button>' : ''}
              ${anyReceived() ? '' : '<button class="btn" data-action="back-to-draft">Back to draft</button>'}
              <button class="btn ghost danger-text" data-action="cancel-order">Cancel order</button>`,
    received: '',
    cancelled: '<button class="btn ghost danger-text" data-action="delete-order">Delete order</button>',
  }[order.status];
  $('#orderHead').innerHTML = `
    <div class="asset-title">
      <div>
        <h1>${esc(order.number)}</h1>
        <p class="muted">${esc(order.vendor) || 'No vendor yet'}, ${fmtDate(order.date)}</p>
      </div>
      <div class="asset-tools">${stateStamp()} ${buttons}</div>
    </div>
    ${order.status === 'draft' ? '<p class="readout-note">A draft is only a plan. Nothing is on order in Inventory until you place it.</p>' : ''}
    ${order.imported ? '<p class="readout-note">This order was created from parts that were already marked on order. Add its shipping and fees under Charges, and tie items to radios below.</p>' : ''}`;
}

/* ---------- details and summary ---------- */

async function vendorList() {
  return [...new Set([...(await D.listVendors()), ...(await D.db.orders.toArray()).map((o) => o.vendor).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
}

function paintDetails() {
  const { order } = B;
  const open = isOpen();
  $('#orderDetails').innerHTML = `
    <h2>Details</h2>
    <label class="field"><span>Vendor</span><input data-change="order-field" data-field="vendor" list="orderVendorList" value="${esc(order.vendor)}" ${open ? '' : 'disabled'} autocomplete="off" placeholder="Amplified Parts"></label>
    <datalist id="orderVendorList"></datalist>
    <label class="field"><span>Order date</span><input type="date" data-change="order-field" data-field="date" value="${dateInputValue(order.date)}" ${open ? '' : 'disabled'}></label>
    <label class="field"><span>Notes</span><textarea data-change="order-field" data-field="notes" rows="3" placeholder="The vendor's order number, what it is for">${esc(order.notes)}</textarea></label>
    <p class="hint">Details save as you go.</p>`;
  vendorList().then((vs) => { const dl = $('#orderVendorList'); if (dl) dl.innerHTML = vs.map((v) => `<option value="${esc(v)}">`).join(''); });
}

function paintSummary() {
  const { order, lines, totals } = B;
  const pieces = lines.reduce((t, l) => t + l.qty, 0);
  const got = lines.reduce((t, l) => t + Math.min(l.qty, l.receivedQty || 0), 0);
  $('#orderSummary').innerHTML = `
    <h2>Order total</h2>
    <dl class="sum">
      <div><dt>Items</dt><dd>${money(totals.items)}</dd></div>
      <div><dt>Shipping, tariffs, and fees</dt><dd>${money(totals.spread)}</dd></div>
      <div><dt>Sales tax (recorded only)</dt><dd>${money(totals.tax)}</dd></div>
      <div class="total"><dt>Total paid</dt><dd>${money(totals.total)}</dd></div>
    </dl>
    ${order.status === 'draft' || !lines.length ? '' : `<p class="hint">Received ${fmtQty(got)} of ${fmtQty(pieces)} piece${pieces === 1 ? '' : 's'}.</p>`}
    <p class="hint">Sales tax is not added to part costs, because each radio already adds its own tax on parts.</p>`;
}

/* ---------- items ---------- */

const radioOptions = (selected) => `<option value="">Stock (no radio)</option>${[...B.radios]
  .sort((a, b) => natural(D.radioName(a), D.radioName(b)))
  .map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${esc(D.radioName(r))}${r.status === 'sold' ? ' (sold)' : ''}</option>`).join('')}`;

function paintItems() {
  const { order, lines, totals } = B;
  const open = isOpen();
  const rows = lines.length ? lines.map((l) => {
    const got = l.receivedQty || 0;
    const lock = !open || got > 0;
    return `<tr>
      <td><span class="mono">${esc(l.part?.partNumber ?? '?')}</span><div>${esc(l.part?.description ?? 'Removed part')}</div></td>
      <td class="num">${fmtQty(l.qty)}</td>
      <td class="num">${unitMoney(l.price)}</td>
      <td class="num">${l.share ? money(l.share) : ''}${l.share ? `<div class="sub">${l.radio ? `to ${esc(D.radioName(l.radio))}` : `${unitMoney(l.landed)} each in stock`}</div>` : ''}</td>
      <td><select class="cell-input" data-change="line-radio" data-id="${l.id}" ${lock ? 'disabled' : ''} aria-label="Radio for ${esc(l.part?.partNumber ?? 'item')}">${radioOptions(l.radioId)}</select></td>
      <td><input class="cell-input" data-change="line-note" data-id="${l.id}" value="${esc(l.note)}" placeholder="Note" aria-label="Note for ${esc(l.part?.partNumber ?? 'item')}" autocomplete="off"></td>
      <td class="num">${fmtQty(Math.min(got, l.qty))} of ${fmtQty(l.qty)}${l.remaining <= 0 && order.status !== 'draft' ? ' <span class="chip os-received">Done</span>' : ''}</td>
      <td class="row-actions">
        ${order.status === 'ordered' && l.remaining > 0 ? `<button class="btn small" data-action="receive-line" data-id="${l.id}">Receive</button>` : ''}
        ${open ? `<button class="btn small ghost" data-action="edit-line" data-id="${l.id}">Edit</button>` : ''}
        ${open && got === 0 ? `<button class="btn small ghost danger-text" data-action="remove-line" data-id="${l.id}">Remove</button>` : ''}
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" class="empty-cell">No items yet. Use Add item to list what you are buying.</td></tr>`;
  $('#orderItems').innerHTML = `
    <div class="panel-head"><h2>Items</h2>${open ? '<button class="btn primary" data-action="add-line">Add item</button>' : ''}</div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price each</th><th class="num">Extras share</th><th>For radio</th><th>Note</th><th class="num">Received</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows}</tbody>
        ${lines.length ? `<tfoot><tr><th colspan="2">Items subtotal</th><td></td><td class="num">${totals.spread ? money(totals.spread) : ''}</td><td colspan="4" class="num">${money(totals.items)}</td></tr></tfoot>` : ''}
      </table>
    </div>
    <p class="table-foot">Pick a radio for an item to charge it that radio's share of shipping and fees when it arrives. Items marked Stock fold their share into the part's unit cost.</p>`;
}

/* ---------- charges ---------- */

function paintCharges() {
  const { order } = B;
  const extras = order.extras ?? [];
  const open = isOpen();
  $('#orderCharges').innerHTML = `
    <div class="panel-head"><h2>Charges</h2>${open ? '<button class="btn primary" data-action="add-extra">Add charge</button>' : ''}</div>
    ${extras.length ? `<div class="table-wrap"><table class="data compact">
      <thead><tr><th>Charge</th><th>Kind</th><th class="num">Amount</th><th>What happens to it</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${extras.map((e) => `<tr>
        <td>${esc(e.label)}</td><td>${esc(O.extraKindLabel(e.kind))}</td><td class="num">${money(e.amount)}</td>
        <td class="hint-cell">${e.kind === 'tax' ? 'Recorded only. Not added to any cost.' : 'Shared across the items by value.'}</td>
        <td class="row-actions">${open ? `<button class="btn small ghost" data-action="edit-extra" data-id="${esc(e.id)}">Edit</button><button class="btn small ghost danger-text" data-action="remove-extra" data-id="${esc(e.id)}">Remove</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">No charges yet. Add shipping, a tariff, or fees, and they are shared across the items by value.</p>'}
    <p class="hint">Shipping, tariffs, and fees follow the items. An item tied to a radio adds its share to that radio as an auxiliary cost when it arrives. An item for stock adds its share to the part's unit cost.${anyReceived() ? ' Parts that have already arrived keep the cost they came in at.' : ''}</p>`;
}

/* ---------- dialogs ---------- */

async function addLineDialog() {
  let parts = await D.listParts();
  const cats = await D.listPartCategories();
  let selected = null, autoPrice = '';
  await openModal({
    title: 'Add item', wide: true,
    submitButtons: [{ label: 'Add item', value: 'ok' }, { label: 'Add and add another', value: 'again', kind: 'ghost' }],
    body: `
      <fieldset class="seg-field">
        <legend class="sr-only">Which part</legend>
        <label class="seg"><input type="radio" name="source" value="part" checked><span>Part in inventory</span></label>
        <label class="seg"><input type="radio" name="source" value="new"><span>New part</span></label>
      </fieldset>
      <div id="srcPart">
        <label class="field"><span>Find a part</span><input type="search" id="partSearch" placeholder="Search part number or description" autocomplete="off"></label>
        <div id="partList" class="pick-list" role="listbox" aria-label="Inventory parts"></div>
        <input type="hidden" name="partId" value="">
      </div>
      <div id="srcNew" hidden>
        <div class="field">
          <label for="npPn"><span>New part number</span></label>
          <div class="input-row"><input id="npPn" name="partNumber" autocomplete="off" placeholder="C-050"><button type="button" class="btn small ghost" id="npNext">Next in series</button></div>
        </div>
        <div class="grid2">
          <label class="field"><span>Description</span><input name="description" placeholder="Polypropylene cap 0.05mfd 630V" autocomplete="off"></label>
          <label class="field"><span>Category</span><input name="category" list="lineCats" placeholder="Pick or type" autocomplete="off"></label>
        </div>
        <datalist id="lineCats">${cats.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
        <p class="hint">A new part is added to Inventory with none on hand. It shows as on order once you place this order.</p>
      </div>
      <div class="grid2">
        <label class="field"><span>Quantity</span><input name="qty" type="number" min="0" step="any" value="1"></label>
        <label class="field"><span>Price each ($)</span><input name="price" type="number" min="0" step="any" placeholder="0.00"></label>
      </div>
      <label class="field"><span>For radio</span><select name="radioId">${radioOptions(null)}</select></label>
      <label class="field"><span>Note</span><input name="note" placeholder="Which component this is for, or anything else to remember" autocomplete="off"></label>`,
    onMount: ({ form }) => {
      const list = $('#partList', form), search = $('#partSearch', form), price = form.elements.price;
      const draw = () => {
        const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const hits = parts.filter((p) => q.every((t) => `${p.partNumber} ${p.description}`.toLowerCase().includes(t))).sort((a, b) => natural(a.partNumber, b.partNumber)).slice(0, 40);
        list.innerHTML = hits.length
          ? hits.map((p) => `<button type="button" class="pick ${selected === p.id ? 'on' : ''}" role="option" aria-selected="${selected === p.id}" data-pid="${p.id}">
              <span class="mono">${esc(p.partNumber)}</span><span>${esc(p.description)}</span>
              <span class="stock ${p.qty <= 0 ? 'out' : ''}">${fmtQty(p.qty)} on hand${p.onOrderQty > 0 ? `, ${fmtQty(p.onOrderQty)} on order` : ''}</span></button>`).join('')
          : `<p class="empty-note">${parts.length ? 'No parts match. Try New part.' : 'Inventory is empty. Use New part.'}</p>`;
      };
      const choose = (id) => {
        selected = id; form.elements.partId.value = id;
        const p = parts.find((x) => x.id === id);
        if (p && (price.value === '' || price.value === autoPrice)) { price.value = p.unitCost; autoPrice = String(p.unitCost); }
        draw();
      };
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-pid]'); if (b) choose(Number(b.dataset.pid)); });
      search.addEventListener('input', draw);
      form.querySelectorAll('[name=source]').forEach((r) => r.addEventListener('change', () => {
        const isNew = form.elements.source.value === 'new';
        $('#srcPart', form).hidden = isNew; $('#srcNew', form).hidden = !isNew;
        (isNew ? form.elements.partNumber : search).focus();
      }));
      $('#npNext', form).addEventListener('click', async () => { form.elements.partNumber.value = await D.suggestNextPartNumber(form.elements.partNumber.value); });
      draw();
      form._reset = async () => {
        parts = await D.listParts(); selected = null; autoPrice = '';
        form.elements.partId.value = ''; search.value = ''; price.value = ''; form.elements.qty.value = 1; form.elements.note.value = '';
        form.elements.partNumber.value = ''; form.elements.description.value = '';
        form.elements.radioId.value = ''; // back to Stock, so a part is never tied to a radio by accident
        draw(); (form.elements.source.value === 'new' ? form.elements.partNumber : search).focus();
      };
    },
    onSubmit: async (form, api, sv) => {
      const d = formData(form);
      const isNew = d.source === 'new';
      if (!(num(d.qty) > 0)) { api.error('Enter a quantity greater than zero.'); return false; }
      if (d.price === '') { api.error('Enter the price each, even if it is an estimate.'); return false; }
      if (!isNew && !d.partId) { api.error('Pick a part from the list, or switch to New part.'); return false; }
      let partId = Number(d.partId);
      if (isNew) partId = await D.addPart({ partNumber: d.partNumber, description: d.description, qty: 0, unitCost: d.price, vendor: B.order.vendor, category: d.category });
      await O.addOrderLine(B.order.id, { partId, qty: d.qty, price: d.price, radioId: d.radioId, note: d.note });
      toast('Item added');
      await reload();
      if (sv === 'again') { await form._reset(); return false; }
      return 'ok';
    },
  });
}

async function editLineDialog(l) {
  const got = l.receivedQty || 0;
  const ok = await openModal({
    title: 'Edit item', submitButtons: [{ label: 'Save changes', value: 'ok' }],
    body: `
      <p class="part-line"><strong>${esc(l.part?.partNumber ?? '')}</strong> ${esc(l.part?.description ?? '')}</p>
      ${got > 0 ? `<p class="hint">${fmtQty(got)} of this item has arrived, so its price and radio are locked. The quantity cannot go below ${fmtQty(got)}.</p>` : ''}
      <div class="grid2">
        <label class="field"><span>Quantity</span><input name="qty" type="number" min="0" step="any" value="${l.qty}"></label>
        <label class="field"><span>Price each ($)</span><input name="price" type="number" min="0" step="any" value="${l.price}" ${got > 0 ? 'disabled' : ''}></label>
      </div>
      <label class="field"><span>For radio</span><select name="radioId" ${got > 0 ? 'disabled' : ''}>${radioOptions(l.radioId)}</select></label>
      <label class="field"><span>Note</span><input name="note" value="${esc(l.note)}" autocomplete="off"></label>`,
    onSubmit: async (form) => {
      const d = formData(form);
      const input = { qty: d.qty, note: d.note };
      if (got === 0) { input.price = d.price; input.radioId = d.radioId; }
      await O.updateOrderLine(l.id, input);
      return 'ok';
    },
  });
  if (ok === 'ok') { toast('Item updated'); await reload(); }
}

async function receiveDialog(l) {
  const tied = !!l.radio;
  const ok = await openModal({
    title: 'Receive items', submitButtons: [{ label: 'Add to inventory', value: 'ok' }],
    body: `
      <p class="part-line"><strong>${esc(l.part?.partNumber ?? '')}</strong> ${esc(l.part?.description ?? '')}</p>
      <p class="hint">${fmtQty(l.remaining)} still to come on ${esc(B.order.number)}. On hand now: ${fmtQty(l.part?.qty ?? 0)}.</p>
      <label class="field"><span>Quantity that arrived</span><input name="qty" type="number" min="0" step="any" value="${l.remaining}" data-autofocus></label>
      <p class="preview" id="rcvPreview" aria-live="polite"></p>`,
    onMount: ({ form }) => {
      const out = $('#rcvPreview', form);
      const update = () => {
        const q = num(form.elements.qty.value);
        if (!(q > 0)) { out.textContent = ''; return; }
        const newQty = (l.part?.qty ?? 0) + q;
        let text = `Adds ${fmtQty(q)} to inventory at ${unitMoney(l.landed)} each. On hand becomes ${fmtQty(newQty)}.`;
        if (tied && l.share) text += ` ${money((l.share * Math.min(q, l.qty)) / l.qty)} of shipping and fees goes to ${D.radioName(l.radio)} as an auxiliary cost.`;
        out.textContent = text;
      };
      form.addEventListener('input', update); update();
    },
    onSubmit: async (form) => { await O.receiveOrderLine(l.id, formData(form).qty); return 'ok'; },
  });
  if (ok === 'ok') { toast(`Received into ${l.part?.partNumber ?? 'inventory'}`); await reload(); }
}

async function extraDialog(extra = null) {
  const ok = await openModal({
    title: extra ? 'Edit charge' : 'Add charge', submitButtons: [{ label: extra ? 'Save changes' : 'Add charge', value: 'ok' }],
    body: `
      <label class="field"><span>Kind</span><select name="kind">${O.EXTRA_KINDS.map((k) => `<option value="${k.id}" ${k.id === (extra?.kind ?? 'shipping') ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Label (optional)</span><input name="label" value="${esc(extra && extra.label !== O.extraKindLabel(extra.kind) ? extra.label : '')}" placeholder="Parts tariff, expedited shipping" autocomplete="off"></label>
      <label class="field"><span>Amount ($)</span><input name="amount" type="number" min="0" step="0.01" value="${extra ? extra.amount : ''}" data-autofocus></label>
      <p class="hint">Shipping, tariffs, and fees are shared across the items by value. Sales tax is only recorded, because each radio already adds its own tax on parts.${anyReceived() ? ' Parts that already arrived keep the cost they came in at.' : ''}</p>`,
    onSubmit: async (form) => {
      const d = formData(form);
      if (extra) await O.updateOrderExtra(B.order.id, extra.id, d); else await O.addOrderExtra(B.order.id, d);
      return 'ok';
    },
  });
  if (ok === 'ok') { toast(extra ? 'Charge updated' : 'Charge added'); await reload(); }
}

/* ---------- order-level actions ---------- */

async function placeOrder() {
  const v = await confirmChoice({
    title: `Place ${B.order.number}?`,
    message: `${B.lines.length} item${B.lines.length === 1 ? '' : 's'}, ${money(B.totals.total)} in total, from ${B.order.vendor || 'no vendor'}. The items show as on order in Inventory until you receive them.`,
    choices: [{ label: 'Place order', value: 'yes', kind: 'primary' }],
  });
  if (v !== 'yes') return;
  await O.placeOrder(B.order.id);
  toast(`${B.order.number} placed`);
  await reload();
}

async function receiveAll() {
  const lines = B.lines.filter((l) => l.remaining > 0);
  const pieces = lines.reduce((t, l) => t + l.remaining, 0);
  const v = await confirmChoice({
    title: 'Receive everything that is left?',
    message: `This adds ${fmtQty(pieces)} piece${pieces === 1 ? '' : 's'} across ${lines.length} item${lines.length === 1 ? '' : 's'} to Inventory and charges shipping and fees as described under Charges. If only some of it arrived, receive those items one at a time instead.`,
    choices: [{ label: 'Receive all', value: 'yes', kind: 'primary' }],
  });
  if (v !== 'yes') return;
  await O.receiveOrderAll(B.order.id);
  toast('Everything received into inventory');
  await reload();
}

async function cancelOrder() {
  const left = B.lines.filter((l) => l.remaining > 0).length;
  const v = await confirmChoice({
    title: `Cancel ${B.order.number}?`,
    message: anyReceived()
      ? `What has not arrived (${left} item${left === 1 ? '' : 's'}) comes off on-order. Items that already arrived stay in your inventory.`
      : 'Everything on this order comes off on-order in Inventory. You can delete the cancelled order afterwards.',
    choices: [{ label: 'Cancel order', value: 'yes', kind: 'danger' }], cancelLabel: 'Keep order',
  });
  if (v !== 'yes') return;
  await O.cancelOrder(B.order.id);
  toast(`${B.order.number} cancelled`);
  await reload();
}

async function deleteOrder() {
  const v = await confirmChoice({
    title: `Delete ${B.order.number}?`, message: 'This removes the order and its items. It cannot be undone.',
    choices: [{ label: 'Delete order', value: 'yes', kind: 'danger' }],
  });
  if (v !== 'yes') return;
  await O.deleteOrder(B.order.id);
  toast('Order deleted');
  location.hash = '#/orders';
}

const lineOf = (el) => B.lines.find((l) => l.id === Number(el.dataset.id));

export const actions = {
  'place-order': () => placeOrder(),
  'receive-all': () => receiveAll(),
  'back-to-draft': async () => { await O.backToDraft(B.order.id); toast('Back to draft'); await reload(); },
  'cancel-order': () => cancelOrder(),
  'delete-order': () => deleteOrder(),
  'add-line': () => addLineDialog(),
  'edit-line': (el) => editLineDialog(lineOf(el)),
  'receive-line': (el) => receiveDialog(lineOf(el)),
  'remove-line': async (el) => { await O.removeOrderLine(Number(el.dataset.id)); toast('Item removed'); await reload(); },
  'add-extra': () => extraDialog(),
  'edit-extra': (el) => extraDialog(B.order.extras.find((e) => e.id === el.dataset.id)),
  'remove-extra': async (el) => { await O.removeOrderExtra(B.order.id, el.dataset.id); toast('Charge removed'); await reload(); },
};

export const changes = {
  'order-field': async (el) => {
    const field = el.dataset.field;
    const value = field === 'date' ? fromDateInput(el.value) : el.value;
    await O.updateOrder(B.order.id, { [field]: value });
    await reload();
  },
  'line-radio': async (el) => { await O.updateOrderLine(Number(el.dataset.id), { radioId: el.value }); await reload(); },
  'line-note': async (el) => { await O.updateOrderLine(Number(el.dataset.id), { note: el.value }); toast('Note saved', 'ok', 1400); },
};
