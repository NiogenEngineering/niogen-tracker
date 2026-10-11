// Orders screen: every purchase order, newest first.

import { S } from './state.js';
import * as D from './db.js';
import * as O from './purchasing.js';
import { esc, money, fmtQty, fmtDate, dateInputValue, fromDateInput, formData, openModal, confirmChoice, toast } from './ui.js';

export const orderStamp = (summary) => {
  const o = summary.order;
  if (summary.partly) return `<span class="chip os-partly">Partly received</span>`;
  return `<span class="chip os-${o.status}">${esc(O.orderStatusLabel(o.status))}</span>`;
};

export async function render(view) {
  const [rows, uncovered] = await Promise.all([O.listOrders(), O.uncoveredOnOrder()]);
  const f = S.orderFilter;
  const tabs = [{ id: 'all', label: 'All', n: rows.length }, ...O.ORDER_STATUSES.map((s) => ({ id: s.id, label: s.label, n: rows.filter((r) => r.order.status === s.id).length }))];
  const list = rows.filter((r) => f === 'all' || r.order.status === f);

  const pieces = uncovered.reduce((t, u) => t + u.qty, 0);
  const vendors = new Set(uncovered.map((u) => (u.part.vendor || '').trim() || 'Unknown vendor'));
  const importPanel = uncovered.length ? `
    <div class="panel notice">
      <p><strong>${uncovered.length} part${uncovered.length === 1 ? ' is' : 's are'} marked on order but not on any order.</strong>
      That is ${fmtQty(pieces)} piece${pieces === 1 ? '' : 's'} from ${vendors.size} vendor${vendors.size === 1 ? '' : 's'}. Create an order for each vendor so you can add shipping and fees, tie items to radios, and receive them here.
      Your stock and on-order amounts do not change.</p>
      <button class="btn primary" data-action="import-on-order">Create orders from them</button>
    </div>` : '';

  view.innerHTML = `
    <div class="page-head"><h1>Orders</h1><button class="btn primary" data-action="new-order">New order</button></div>
    ${importPanel}
    <div class="tabs" role="tablist" aria-label="Filter by status">
      ${tabs.map((t) => `<button role="tab" aria-selected="${f === t.id}" class="tab ${f === t.id ? 'on' : ''}" data-action="filter-orders" data-value="${t.id}">${esc(t.label)} <span class="count">${t.n}</span></button>`).join('')}
    </div>
    <div class="panel flush">
      ${list.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Order</th><th>Vendor</th><th>Date</th><th>Status</th><th class="num">Items</th><th class="num">Received</th><th class="num">Order total</th></tr></thead>
        <tbody>${list.map((r) => `<tr>
          <td><a href="#/order/${r.order.id}" class="mono">${esc(r.order.number)}</a></td>
          <td>${esc(r.order.vendor) || '<span class="muted">No vendor</span>'}</td>
          <td>${fmtDate(r.order.date)}</td>
          <td>${orderStamp(r)}</td>
          <td class="num">${r.lineCount}</td>
          <td class="num">${r.order.status === 'draft' ? '' : `${fmtQty(r.got)} of ${fmtQty(r.ordered)}`}</td>
          <td class="num strong">${money(r.totals.total)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
      : `<p class="empty-cell">${rows.length ? 'No orders with this status.' : 'No orders yet. Start one when you buy parts, then receive the items here when they arrive.'}</p>`}
    </div>`;
}

async function newOrderDialog() {
  const vendors = [...new Set([...(await D.listVendors()), ...(await D.db.orders.toArray()).map((o) => o.vendor).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const id = await openModal({
    title: 'New order', submitButtons: [{ label: 'Create order', value: 'ok' }],
    body: `
      <label class="field"><span>Vendor</span><input name="vendor" list="orderVendors" placeholder="Amplified Parts" autocomplete="off" data-autofocus></label>
      <datalist id="orderVendors">${vendors.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
      <label class="field"><span>Order date</span><input name="date" type="date" value="${dateInputValue()}"></label>
      <label class="field"><span>Notes (optional)</span><input name="notes" placeholder="Your order number from the vendor, what it is for" autocomplete="off"></label>
      <p class="hint">You add items and charges on the next screen. Nothing is on order until you place it.</p>`,
    onSubmit: async (form) => {
      const d = formData(form);
      return String(await O.createOrder({ vendor: d.vendor, date: fromDateInput(d.date), notes: d.notes }));
    },
  });
  if (id && id !== 'ok') location.hash = `#/order/${id}`;
}

async function importDialog() {
  const uncovered = await O.uncoveredOnOrder();
  const groups = new Map();
  for (const u of uncovered) { const v = (u.part.vendor || '').trim() || 'Unknown vendor'; groups.set(v, (groups.get(v) ?? 0) + 1); }
  const v = await confirmChoice({
    title: 'Create orders from on-order parts?',
    message: `This makes ${groups.size} order${groups.size === 1 ? '' : 's'}, one per vendor: ${[...groups].map(([n, c]) => `${n} (${c} item${c === 1 ? '' : 's'})`).join(', ')}. Prices come from each part's unit cost. They are marked Ordered, and nothing about your stock or on-order amounts changes.`,
    choices: [{ label: 'Create orders', value: 'yes', kind: 'primary' }],
  });
  if (v !== 'yes') return;
  const made = await O.createOrdersFromOnOrder();
  toast(`Created ${made.length} order${made.length === 1 ? '' : 's'}`);
  await S.render();
}

export const actions = {
  'new-order': () => newOrderDialog(),
  'import-on-order': () => importDialog(),
  'filter-orders': (el) => { S.orderFilter = el.dataset.value; return S.render(); },
};
export const changes = {};
