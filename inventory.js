// Inventory screen: parts list, add/edit, receive stock, adjust counts, history.

import { S } from './state.js';
import * as D from './db.js';
import { num, round2 } from './pricing.js';
import { esc, money, unitMoney, fmtQty, fmtDate, formData, openModal, confirmChoice, toast, $ } from './ui.js';

const COLUMNS = [
  { key: 'partNumber', label: 'Part number' },
  { key: 'description', label: 'Description' },
  { key: 'qty', label: 'On hand', num: true },
  { key: 'onOrderQty', label: 'On order' },
  { key: 'bin', label: 'Bin' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'unitCost', label: 'Unit cost', num: true },
];
const natural = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });

let parts = [];

export async function render(view) {
  parts = await D.listParts();
  view.innerHTML = `
    <div class="page-head">
      <h1>Inventory</h1>
      <div class="head-tools">
        <label class="check inline"><input type="checkbox" id="invOrdered" ${S.inv.ordered ? 'checked' : ''}><span>On order only</span></label>
        <input type="search" id="invSearch" class="search" placeholder="Search parts" value="${esc(S.inv.q)}" aria-label="Search parts" autocomplete="off">
        <button class="btn primary" data-action="add-part">Add part</button>
      </div>
    </div>
    <div class="panel flush">
      <div class="table-wrap">
        <table class="data" id="invTable">
          <thead><tr>
            ${COLUMNS.map((c) => `<th class="${c.num ? 'num' : ''}" aria-sort="${S.inv.sort === c.key ? (S.inv.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button class="th-sort" data-action="sort-inv" data-col="${c.key}">${c.label}<span aria-hidden="true">${S.inv.sort === c.key ? (S.inv.dir > 0 ? ' \u25B2' : ' \u25BC') : ''}</span></button></th>`).join('')}
            <th><span class="sr-only">Actions</span></th>
          </tr></thead>
          <tbody id="invBody"></tbody>
        </table>
      </div>
      <p class="table-foot" id="invFoot"></p>
    </div>`;
  $('#invSearch').addEventListener('input', (e) => { S.inv.q = e.target.value; paintRows(); });
  $('#invOrdered').addEventListener('change', (e) => { S.inv.ordered = e.target.checked; paintRows(); });
  paintRows();
}

function paintRows() {
  const q = S.inv.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const { sort, dir } = S.inv;
  const list = parts
    .filter((p) => !S.inv.ordered || p.onOrderQty > 0)
    .filter((p) => q.every((t) => [p.partNumber, p.description, p.bin, p.vendor, p.onOrderNote].join(' ').toLowerCase().includes(t)))
    .sort((a, b) => (typeof a[sort] === 'number' ? a[sort] - b[sort] : natural(a[sort], b[sort])) * dir || natural(a.partNumber, b.partNumber));
  const body = $('#invBody');
  if (!parts.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-cell">No parts yet. Add a part to start your inventory.</td></tr>`;
  } else if (!list.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-cell">No parts match your search.</td></tr>`;
  } else {
    body.innerHTML = list.map((p) => `
      <tr>
        <td class="mono">${esc(p.partNumber)}</td>
        <td>${esc(p.description)}</td>
        <td class="num ${p.qty <= 0 ? 'zero' : ''}">${fmtQty(p.qty)}</td>
        <td>${p.onOrderQty > 0 ? `<span class="tag order">${fmtQty(p.onOrderQty)} ordered</span>${p.onOrderNote ? `<div class="sub">${esc(p.onOrderNote)}</div>` : ''}` : ''}</td>
        <td>${esc(p.bin)}</td>
        <td>${esc(p.vendor)}</td>
        <td class="num">${unitMoney(p.unitCost)}</td>
        <td class="row-actions">
          <button class="btn small" data-action="order" data-id="${p.id}">Order</button>
          <button class="btn small" data-action="receive" data-id="${p.id}">Receive</button>
          <button class="btn small ghost" data-action="adjust" data-id="${p.id}">Adjust</button>
          <button class="btn small ghost" data-action="history" data-id="${p.id}">History</button>
          <button class="btn small ghost" data-action="edit-part" data-id="${p.id}">Edit</button>
        </td>
      </tr>`).join('');
  }
  const ordered = parts.filter((p) => p.onOrderQty > 0).length;
  $('#invFoot').textContent = parts.length ? `${list.length} of ${parts.length} part${parts.length === 1 ? '' : 's'} shown. ${ordered} on order.` : '';
}

/* ---------- add / edit part ---------- */

async function partDialog(part = null) {
  const vendors = await D.listVendors();
  const editing = !!part;
  const result = await openModal({
    title: editing ? `Edit ${part.partNumber}` : 'Add part',
    submitButtons: editing
      ? [{ label: 'Save changes', value: 'ok', kind: 'primary' }, { label: 'Delete part', value: 'delete', kind: 'danger' }]
      : [{ label: 'Add part', value: 'ok', kind: 'primary' }],
    body: `
      <div class="field">
        <label for="pPn"><span>Part number</span></label>
        <div class="input-row">
          <input id="pPn" name="partNumber" autocomplete="off" value="${esc(part?.partNumber ?? '')}" placeholder="C-001">
          <button type="button" class="btn small ghost" id="nextPn">Next in series</button>
        </div>
        <small id="pnMsg" class="hint" aria-live="polite"></small>
      </div>
      <label class="field"><span>Description</span><input name="description" value="${esc(part?.description ?? '')}" placeholder="GE 1AGNT vacuum tube" autocomplete="off"></label>
      <div class="grid2">
        ${editing ? '' : `<label class="field"><span>On hand</span><input name="qty" type="number" min="0" step="any" value="0"></label>`}
        <label class="field"><span>Unit cost (each, $)</span><input name="unitCost" type="number" min="0" step="any" value="${part ? part.unitCost : ''}" placeholder="0.00"></label>
      </div>
      <details class="calc">
        <summary>Work out unit cost from a case or kit price</summary>
        <div class="grid3">
          <label class="field"><span>Total paid ($)</span><input id="kitPaid" type="number" min="0" step="any"></label>
          <label class="field"><span>Pieces</span><input id="kitQty" type="number" min="0" step="any"></label>
          <div class="calc-out"><span id="kitOut">Enter both</span><button type="button" class="btn small" id="kitUse" disabled>Use this cost</button></div>
        </div>
      </details>
      <div class="grid2">
        <label class="field"><span>Bin location</span><input name="bin" value="${esc(part?.bin ?? '')}" placeholder="A3"></label>
        <label class="field"><span>Vendor</span><input name="vendor" list="vendorList" value="${esc(part?.vendor ?? '')}" autocomplete="off"></label>
      </div>
      <datalist id="vendorList">${vendors.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      ${editing ? '' : `<div class="grid2">
        <label class="field"><span>Already on order (qty)</span><input name="onOrderQty" type="number" min="0" step="any" placeholder="0"></label>
        <label class="field"><span>Order note</span><input name="onOrderNote" placeholder="Order number, expected date" autocomplete="off"></label>
      </div>`}
      ${editing ? `<p class="hint">To change the quantity, use Receive or Adjust so the history stays accurate. Use Order for parts that are on the way. A new unit cost applies to future use only. Radios keep the cost they were issued at.</p>` : ''}`,
    onMount: ({ form }) => {
      const pn = form.elements.partNumber, msg = $('#pnMsg', form);
      const check = async () => {
        if (!D.keyOf(pn.value)) { msg.textContent = ''; msg.className = 'hint'; return; }
        const dup = await D.findPartByNumber(pn.value, part?.id);
        msg.className = `hint ${dup ? 'bad' : 'good'}`;
        msg.textContent = dup ? `Already used by ${dup.partNumber}, ${dup.description} (${fmtQty(dup.qty)} on hand).` : 'Available.';
      };
      pn.addEventListener('input', check);
      $('#nextPn', form).addEventListener('click', async () => { pn.value = await D.suggestNextPartNumber(pn.value); await check(); pn.focus(); });
      const paid = $('#kitPaid', form), pieces = $('#kitQty', form), out = $('#kitOut', form), use = $('#kitUse', form);
      const calc = () => {
        const ok = num(paid.value) >= 0 && num(pieces.value) > 0 && paid.value !== '';
        use.disabled = !ok;
        out.textContent = ok ? `${unitMoney(num(paid.value) / num(pieces.value))} each` : 'Enter both';
      };
      paid.addEventListener('input', calc); pieces.addEventListener('input', calc);
      use.addEventListener('click', () => {
        form.elements.unitCost.value = D.r6(num(paid.value) / num(pieces.value));
        if (form.elements.qty && num(form.elements.qty.value) === 0) form.elements.qty.value = pieces.value;
      });
      check();
    },
    onSubmit: async (form, api, sv) => {
      if (sv === 'delete') return 'delete';
      const data = formData(form);
      const same = await D.findPartByDescription(data.description, part?.id);
      const marker = data.description.trim().toLowerCase();
      if (same && form.dataset.ack !== marker) {
        form.dataset.ack = marker;
        api.error(`${same.partNumber} already has this exact description. If it is a different part, press the button again to save anyway.`);
        return false;
      }
      if (editing) await D.updatePart(part.id, data); else await D.addPart(data);
      return 'ok';
    },
  });
  if (result === 'ok') { toast(editing ? 'Part updated' : 'Part added'); await S.render(); }
  if (result === 'delete') {
    const sure = await confirmChoice({
      title: `Delete ${part.partNumber}?`, message: 'This removes the part and its stock history. It cannot be undone.',
      choices: [{ label: 'Delete part', value: 'yes', kind: 'danger' }],
    });
    if (sure === 'yes') {
      try { await D.deletePart(part.id); toast('Part deleted'); } catch (e) { toast(e.message, 'error', 6000); }
      await S.render();
    }
  }
}

/* ---------- receive stock ---------- */

async function receiveDialog(part) {
  const ok = await openModal({
    title: 'Receive stock',
    submitButtons: [{ label: 'Add to stock', value: 'ok' }],
    body: `
      <p class="part-line"><strong>${esc(part.partNumber)}</strong> ${esc(part.description)}</p>
      <p class="hint">On hand: ${fmtQty(part.qty)}. Current average cost: ${unitMoney(part.unitCost)} each.${part.onOrderQty > 0 ? ` ${fmtQty(part.onOrderQty)} on order. What you receive comes off the on-order amount.` : ''}</p>
      <div class="grid2">
        <label class="field"><span>Quantity received</span><input name="qty" type="number" min="0" step="any" value="${part.onOrderQty > 0 ? part.onOrderQty : ''}" data-autofocus></label>
        <label class="field"><span id="costLabel">Price per piece ($)</span><input name="cost" type="number" min="0" step="any"></label>
      </div>
      <fieldset class="seg-field">
        <legend>The price I entered is</legend>
        <label class="seg"><input type="radio" name="mode" value="each" checked><span>Per piece</span></label>
        <label class="seg"><input type="radio" name="mode" value="total"><span>Total for the batch</span></label>
      </fieldset>
      <label class="field"><span>Note (optional)</span><input name="note" value="${esc(part.onOrderNote ?? '')}" placeholder="Order number, vendor, case or kit"></label>
      <p class="preview" id="preview" aria-live="polite"></p>`,
    onMount: ({ form }) => {
      const preview = $('#preview', form), label = $('#costLabel', form);
      const read = () => {
        const q = num(form.elements.qty.value), c = num(form.elements.cost.value);
        const mode = form.elements.mode.value;
        label.textContent = mode === 'total' ? 'Total paid ($)' : 'Price per piece ($)';
        const unit = mode === 'total' ? (q > 0 ? c / q : 0) : c;
        return { q, unit };
      };
      const update = () => {
        const { q, unit } = read();
        if (!(q > 0)) { preview.textContent = ''; return; }
        const newQty = part.qty + q;
        const avg = part.qty > 0 ? (part.qty * part.unitCost + q * unit) / newQty : unit;
        preview.textContent = `After this: ${fmtQty(newQty)} on hand at ${unitMoney(avg)} each (average). This batch is ${unitMoney(unit)} each.`;
      };
      form.addEventListener('input', update);
      update();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      const q = num(d.qty);
      const unit = d.mode === 'total' ? (q > 0 ? num(d.cost) / q : 0) : num(d.cost);
      await D.receiveStock(part.id, q, unit, d.note);
      return 'ok';
    },
  });
  if (ok === 'ok') { toast(`Received into ${part.partNumber}`); await S.render(); }
}

/* ---------- on order ---------- */

async function orderDialog(part) {
  const result = await openModal({
    title: 'Parts on order',
    submitButtons: [
      { label: 'Save order', value: 'ok' },
      ...(part.onOrderQty > 0 ? [{ label: 'Clear order', value: 'clear', kind: 'ghost' }] : []),
    ],
    body: `
      <p class="part-line"><strong>${esc(part.partNumber)}</strong> ${esc(part.description)}</p>
      <p class="hint">On hand: ${fmtQty(part.qty)}. Use this for parts you have already bought that are still shipping. When they arrive, use Receive and the on-order amount drops by itself.</p>
      <div class="grid2">
        <label class="field"><span>Quantity on order</span><input name="qty" type="number" min="0" step="any" value="${part.onOrderQty > 0 ? part.onOrderQty : ''}" data-autofocus></label>
        <label class="field"><span>Note</span><input name="note" value="${esc(part.onOrderNote ?? '')}" placeholder="Order number, vendor, arrives Friday" autocomplete="off"></label>
      </div>`,
    onSubmit: async (form, api, sv) => {
      const d = formData(form);
      if (sv === 'clear' || d.qty === '') { await D.setOnOrder(part.id, 0); return 'cleared'; }
      await D.setOnOrder(part.id, d.qty, d.note);
      return 'ok';
    },
  });
  if (result === 'ok') { toast(`${part.partNumber} marked on order`); await S.render(); }
  if (result === 'cleared') { toast('Order cleared'); await S.render(); }
}

/* ---------- adjust count ---------- */

async function adjustDialog(part) {
  const ok = await openModal({
    title: 'Adjust count',
    submitButtons: [{ label: 'Save count', value: 'ok' }],
    body: `
      <p class="part-line"><strong>${esc(part.partNumber)}</strong> ${esc(part.description)}</p>
      <p class="hint">The system shows ${fmtQty(part.qty)} on hand. Enter what is actually on the shelf.</p>
      <label class="field"><span>Counted quantity</span><input name="qty" type="number" min="0" step="any" value="${part.qty}" data-autofocus></label>
      <label class="field"><span>Reason</span>
        <select name="reason"><option>Count correction</option><option>Damaged or lost</option><option>Used outside a radio</option><option>Other</option></select>
      </label>
      <label class="field"><span>Note (optional)</span><input name="note"></label>
      <p class="preview" id="preview" aria-live="polite"></p>`,
    onMount: ({ form }) => {
      const preview = $('#preview', form);
      const update = () => {
        const delta = D.r4(num(form.elements.qty.value) - part.qty);
        preview.textContent = delta === 0 ? 'No change.' : `Change: ${delta > 0 ? '+' : ''}${fmtQty(delta)}`;
      };
      form.addEventListener('input', update); update();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      if (d.qty === '') throw new D.AppError('Enter the counted quantity.', 'invalid');
      await D.adjustStock(part.id, d.qty, d.reason, d.note);
      return 'ok';
    },
  });
  if (ok === 'ok') { toast('Count updated'); await S.render(); }
}

/* ---------- history ---------- */

const REASONS = {
  initial: 'Added to inventory', received: 'Received', issued: 'Used on a radio',
  returned: 'Returned to stock', adjusted: 'Adjusted', consumed: 'Used up', ordered: 'On order',
};

async function historyDialog(part) {
  const rows = await D.stockHistory(part.id);
  await openModal({
    title: `History for ${part.partNumber}`, wide: true, submitButtons: [], cancelLabel: 'Close',
    body: rows.length
      ? `<div class="table-wrap short"><table class="data compact">
          <thead><tr><th>Date</th><th class="num">Change</th><th>What happened</th><th>Radio</th><th>Note</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${fmtDate(r.date)}</td>
            <td class="num ${r.delta < 0 ? 'neg' : r.delta > 0 ? 'pos' : ''}">${r.delta === 0 ? '' : `${r.delta > 0 ? '+' : ''}${fmtQty(r.delta)}`}</td>
            <td>${esc(REASONS[r.reason] ?? r.reason)}</td>
            <td>${esc(r.radioName)}</td>
            <td>${esc(r.note ?? '')}${r.reason === 'received' && r.unitCost != null ? ` (${unitMoney(r.unitCost)} each)` : ''}</td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="empty-note">No stock changes recorded yet.</p>',
  });
}

const byId = (el) => parts.find((p) => p.id === Number(el.dataset.id));

export const actions = {
  'add-part': () => partDialog(),
  'edit-part': (el) => partDialog(byId(el)),
  order: (el) => orderDialog(byId(el)),
  receive: (el) => receiveDialog(byId(el)),
  adjust: (el) => adjustDialog(byId(el)),
  history: (el) => historyDialog(byId(el)),
  'sort-inv': (el) => {
    const col = el.dataset.col;
    S.inv.dir = S.inv.sort === col ? -S.inv.dir : 1;
    S.inv.sort = col;
    return S.render();
  },
};
export const changes = {};
