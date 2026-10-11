// Reports screen: cost and profit per radio, shop costs, net profit, and what is waiting to be replaced.

import { S } from './state.js';
import * as D from './db.js';
import { actualProfit, profitSummary, round2 } from './pricing.js';
import { esc, money, fmtDate, dateInputValue, fromDateInput, formData, openModal, confirmChoice, toast } from './ui.js';

const SHOP_PRESETS = ['Polisher or buffer', 'Tool', 'Stain or finish', 'Polish and wax', 'Sandpaper and abrasives', 'Cleaning supplies'];
let shopRows = [];

export async function render(view) {
  const rows = await D.loadRadioSummaries();
  shopRows = await D.listShopCosts();
  const waiting = (await D.listReplacements()).filter((l) => l.radio.status !== 'sold')
    .sort((a, b) => D.radioName(a.radio).localeCompare(D.radioName(b.radio)) || a.category.localeCompare(b.category) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));

  const order = Object.fromEntries(D.STATUSES.map((s, i) => [s.id, i]));
  rows.sort((a, b) => order[b.radio.status] - order[a.radio.status] || (b.radio.soldAt ?? 0) - (a.radio.soldAt ?? 0) || D.radioName(a.radio).localeCompare(D.radioName(b.radio)));

  const sold = rows.filter((r) => r.radio.status === 'sold');
  const shopTotal = round2(shopRows.reduce((t, r) => t + r.amount, 0));
  const sum = profitSummary(sold.map((r) => ({ salePrice: r.radio.salePrice, saleFee: r.radio.saleFee, costs: r.costs })), shopTotal);
  const totalCostAll = round2(rows.reduce((t, r) => t + r.costs.total, 0));
  const signed = (n) => `${n < 0 ? '\u2212' : '+'}${money(Math.abs(n))}`;

  const line = ({ radio, costs }) => {
    const isSold = radio.status === 'sold';
    const p = isSold ? actualProfit(radio.salePrice, radio.saleFee, costs.total) : null;
    return `<tr>
      <td><a href="#/radio/${radio.id}">${esc(D.radioName(radio))}</a>${radio.year ? ` <span class="muted">${esc(radio.year)}</span>` : ''}</td>
      <td><span class="chip s-${radio.status}">${esc(D.statusLabel(radio.status))}</span></td>
      <td class="num">${money(costs.total)}</td>
      <td class="num">${isSold ? money(radio.salePrice) : '<span class="muted">Not sold</span>'}</td>
      <td class="num">${isSold ? money(radio.saleFee) : ''}</td>
      <td class="num strong ${p == null ? '' : p >= 0 ? 'pos' : 'neg'}">${p == null ? '' : money(p)}</td>
      <td class="muted">${isSold ? fmtDate(radio.soldAt) : ''}</td>
    </tr>`;
  };

  let coverage;
  if (!sum.consumablesCharged && !sum.shop) {
    coverage = 'Add your tools and supplies under Shop costs below, and set a consumables amount on your radios, to see whether the charges are covering your spending.';
  } else {
    coverage = `Consumables charged to sold radios: ${money(sum.consumablesCharged)}. Shop costs spent: ${money(sum.shop)}. ${
      sum.ahead >= 0 ? `The charges are ${money(sum.ahead)} ahead of your spending.` : `The charges are ${money(-sum.ahead)} behind your spending. Raising the consumables amount recovers it faster.`} Radios that are not sold yet are not counted until they sell.`;
  }

  view.innerHTML = `
    <div class="page-head"><h1>Reports</h1></div>
    <div class="stat-row">
      <div class="stat"><span class="stat-label">Total cost, all radios</span><span class="stat-value">${money(totalCostAll)}</span></div>
      <div class="stat"><span class="stat-label">Radios sold</span><span class="stat-value">${sold.length} <small>of ${rows.length}</small></span></div>
      <div class="stat"><span class="stat-label">Profit on sold radios</span><span class="stat-value ${sum.profit >= 0 ? 'pos' : 'neg'}">${money(sum.profit)}</span></div>
      <div class="stat"><span class="stat-label">Shop costs</span><span class="stat-value">${money(sum.shop)}</span></div>
      <div class="stat"><span class="stat-label">Net profit</span><span class="stat-value ${sum.net >= 0 ? 'pos' : 'neg'}">${money(sum.net)}</span></div>
    </div>

    <div class="panel flush">
      ${rows.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Radio</th><th>Status</th><th class="num">Total cost</th><th class="num">Sold for</th><th class="num">Site fees</th><th class="num">Profit</th><th>Date sold</th></tr></thead>
        <tbody>${rows.map(line).join('')}</tbody>
        <tfoot><tr><th colspan="2">Sold radios</th><td class="num">${money(sum.costOfSold)}</td><td class="num">${money(sum.revenue)}</td><td class="num">${money(sum.fees)}</td><td class="num strong ${sum.profit >= 0 ? 'pos' : 'neg'}">${money(sum.profit)}</td><td></td></tr></tfoot>
      </table></div>`
      : '<p class="empty-cell">Reports fill in once you add radios.</p>'}
    </div>
    <p class="hint pad">Profit on a radio is the sale price minus site fees minus its total cost. Total cost includes parts, sales tax, your flat labor charge, consumables, and auxiliary costs, so profit is what remains after paying yourself for labor.</p>

    <h2 class="section-title">Net profit</h2>
    <div class="panel flush">
      <div class="table-wrap"><table class="data ledger">
        <tbody>
          <tr><td>Profit on sold radios</td><td class="num">${money(sum.profit)}</td><td class="hint-cell">Sale price, less site fees, less each radio's total cost</td></tr>
          <tr><td>Add back: consumables charged to those radios</td><td class="num">${signed(sum.consumablesCharged)}</td><td class="hint-cell">Already inside each radio's cost, so it comes back out here</td></tr>
          <tr><td>Less: shop costs spent</td><td class="num">${signed(-sum.shop)}</td><td class="hint-cell">The real spending, from the list below</td></tr>
        </tbody>
        <tfoot><tr><th>Net profit after shop costs</th><td class="num ${sum.net >= 0 ? 'pos' : 'neg'}">${money(sum.net)}</td><td></td></tr></tfoot>
      </table></div>
    </div>
    <p class="hint pad">${esc(coverage)} The charge is added back so the same spending is not subtracted twice: once as a consumables charge on a radio, and again as a shop cost.</p>

    <div class="panel-head section-bar">
      <h2>Shop costs</h2>
      <button class="btn primary" data-action="add-shop-cost">Add shop cost</button>
    </div>
    <div class="panel flush">
      ${shopRows.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Date</th><th>What</th><th>Notes</th><th class="num">Amount</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${shopRows.map((r) => `<tr>
          <td>${fmtDate(r.date)}</td><td>${esc(r.label)}</td><td class="muted">${esc(r.note)}</td><td class="num">${money(r.amount)}</td>
          <td class="row-actions"><button class="btn small ghost" data-action="edit-shop-cost" data-id="${r.id}">Edit</button>
            <button class="btn small ghost danger-text" data-action="remove-shop-cost" data-id="${r.id}">Remove</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3">Total shop costs</th><td class="num">${money(shopTotal)}</td><td></td></tr></tfoot>
      </table></div>`
      : '<p class="empty-cell">No shop costs yet. Add tools and supplies that are not billed to one radio, such as a buffer or a case of stain.</p>'}
    </div>
    <p class="hint pad">Shop costs come out of your overall profit. They are never added to a radio's price. To earn them back over time, set a consumables amount per radio.</p>

    <h2 class="section-title">Waiting to be replaced</h2>
    <div class="panel flush">
      ${waiting.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Radio</th><th>Category</th><th>Ref</th><th>Description</th><th>Notes</th></tr></thead>
        <tbody>${waiting.map((l) => `<tr>
          <td><a href="#/radio/${l.radio.id}">${esc(D.radioName(l.radio))}</a></td><td>${esc(l.category)}</td>
          <td class="ref">${esc(l.ref)}</td><td>${esc(l.description)}</td><td>${esc(l.note)}</td></tr>`).join('')}</tbody>
      </table></div>`
      : '<p class="empty-cell">Nothing is marked Needs replacing. Set a component\'s status on its radio to see it here.</p>'}
    </div>`;
}

async function shopCostDialog(row = null) {
  const ok = await openModal({
    title: row ? 'Edit shop cost' : 'Add shop cost',
    submitButtons: [{ label: row ? 'Save changes' : 'Add shop cost', value: 'ok' }],
    body: `
      <label class="field"><span>What is it</span><input name="label" list="shopList" value="${esc(row?.label ?? '')}" placeholder="Polisher" autocomplete="off"></label>
      <datalist id="shopList">${SHOP_PRESETS.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="field"><span>Amount ($)</span><input name="amount" type="number" min="0" step="0.01" value="${row ? row.amount : ''}"></label>
        <label class="field"><span>Date bought</span><input name="date" type="date" value="${dateInputValue(row?.date ?? Date.now())}"></label>
      </div>
      <label class="field"><span>Notes (optional)</span><input name="note" value="${esc(row?.note ?? '')}" placeholder="Store, what it is used for" autocomplete="off"></label>
      <p class="hint">This comes out of your overall profit. It is not added to any radio's price.</p>`,
    onSubmit: async (form) => {
      const d = formData(form);
      const input = { label: d.label, amount: d.amount, date: fromDateInput(d.date), note: d.note };
      if (row) await D.updateShopCost(row.id, input); else await D.addShopCost(input);
      return 'ok';
    },
  });
  if (ok === 'ok') { toast(row ? 'Shop cost updated' : 'Shop cost added'); await S.render(); }
}

const rowOf = (el) => shopRows.find((r) => r.id === Number(el.dataset.id));

export const actions = {
  'add-shop-cost': () => shopCostDialog(),
  'edit-shop-cost': (el) => shopCostDialog(rowOf(el)),
  'remove-shop-cost': async (el) => {
    const r = rowOf(el);
    const v = await confirmChoice({
      title: 'Remove this shop cost?', message: `${r.label}, ${money(r.amount)}, will be removed from your profit figures.`,
      choices: [{ label: 'Remove', value: 'yes', kind: 'danger' }],
    });
    if (v !== 'yes') return;
    await D.removeShopCost(r.id);
    toast('Shop cost removed');
    await S.render();
  },
};
export const changes = {};
