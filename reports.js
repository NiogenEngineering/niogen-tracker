// Reports screen: total cost and profit, per radio and overall.

import { loadRadioSummaries, listReplacements, radioName, STATUSES } from './db.js';
import { actualProfit, round2 } from './pricing.js';
import { esc, money, fmtDate } from './ui.js';

export async function render(view) {
  const rows = await loadRadioSummaries();
  const waiting = (await listReplacements()).filter((l) => l.radio.status !== 'sold')
    .sort((a, b) => radioName(a.radio).localeCompare(radioName(b.radio)) || a.category.localeCompare(b.category) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const order = Object.fromEntries(STATUSES.map((s, i) => [s.id, i]));
  rows.sort((a, b) => order[b.radio.status] - order[a.radio.status] || (b.radio.soldAt ?? 0) - (a.radio.soldAt ?? 0) || radioName(a.radio).localeCompare(radioName(b.radio)));

  const sold = rows.filter((r) => r.radio.status === 'sold');
  const totalCost = round2(rows.reduce((t, r) => t + r.costs.total, 0));
  const revenue = round2(sold.reduce((t, r) => t + r.radio.salePrice, 0));
  const fees = round2(sold.reduce((t, r) => t + r.radio.saleFee, 0));
  const costSold = round2(sold.reduce((t, r) => t + r.costs.total, 0));
  const profit = round2(revenue - fees - costSold);

  const line = ({ radio, costs }) => {
    const isSold = radio.status === 'sold';
    const p = isSold ? actualProfit(radio.salePrice, radio.saleFee, costs.total) : null;
    return `<tr>
      <td><a href="#/radio/${radio.id}">${esc(radioName(radio))}</a>${radio.year ? ` <span class="muted">${esc(radio.year)}</span>` : ''}</td>
      <td><span class="chip s-${radio.status}">${esc(STATUSES.find((s) => s.id === radio.status)?.label)}</span></td>
      <td class="num">${money(costs.total)}</td>
      <td class="num">${isSold ? money(radio.salePrice) : '<span class="muted">Not sold</span>'}</td>
      <td class="num">${isSold ? money(radio.saleFee) : ''}</td>
      <td class="num strong ${p == null ? '' : p >= 0 ? 'pos' : 'neg'}">${p == null ? '' : money(p)}</td>
      <td class="muted">${isSold ? fmtDate(radio.soldAt) : ''}</td>
    </tr>`;
  };

  view.innerHTML = `
    <div class="page-head"><h1>Reports</h1></div>
    <div class="stat-row">
      <div class="stat"><span class="stat-label">Total cost across all radios</span><span class="stat-value">${money(totalCost)}</span></div>
      <div class="stat"><span class="stat-label">Profit on sold radios</span><span class="stat-value ${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</span></div>
      <div class="stat"><span class="stat-label">Radios sold</span><span class="stat-value">${sold.length} <small>of ${rows.length}</small></span></div>
    </div>
    <div class="panel flush">
      ${rows.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Radio</th><th>Status</th><th class="num">Total cost</th><th class="num">Sold for</th><th class="num">Site fees</th><th class="num">Profit</th><th>Date sold</th></tr></thead>
        <tbody>${rows.map(line).join('')}</tbody>
        <tfoot><tr><th colspan="2">Sold radios</th><td class="num">${money(costSold)}</td><td class="num">${money(revenue)}</td><td class="num">${money(fees)}</td><td class="num strong ${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</td><td></td></tr></tfoot>
      </table></div>`
      : '<p class="empty-cell">Reports fill in once you add radios.</p>'}
    </div>
    <h2 class="section-title">Waiting to be replaced</h2>
    <div class="panel flush">
      ${waiting.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Radio</th><th>Category</th><th>Ref</th><th>Description</th><th>Notes</th></tr></thead>
        <tbody>${waiting.map((l) => `<tr>
          <td><a href="#/radio/${l.radio.id}">${esc(radioName(l.radio))}</a></td><td>${esc(l.category)}</td>
          <td class="ref">${esc(l.ref)}</td><td>${esc(l.description)}</td><td>${esc(l.note)}</td></tr>`).join('')}</tbody>
      </table></div>`
      : '<p class="empty-cell">Nothing is marked Needs replacing. Set a component\'s status on its radio to see it here.</p>'}
    </div>
    <p class="hint pad">Profit is the sale price minus site fees minus the radio's total cost. Total cost includes parts, sales tax, your flat labor charge, and auxiliary costs, so profit is what remains after paying yourself for labor.</p>`;
}

export const actions = {};
export const changes = {};
