// Radios screen: cards grouped by status.

import { S, urlFor } from './state.js';
import { loadRadioSummaries, createRadio, STATUSES, radioName, db } from './db.js';
import { esc, money, openModal, formData } from './ui.js';

export const RADIO_ART = `<svg class="radio-art" viewBox="0 0 120 90" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="22" width="100" height="60" rx="11"/><circle cx="38" cy="52" r="17"/><circle cx="38" cy="52" r="5"/><path d="M68 38h30M68 48h30M68 58h30M68 68h30"/><path d="M32 22 25 8M88 22l8-14"/></svg>`;

function card({ radio, costs, cover }) {
  const sub = [radio.year, radio.chassis && `Chassis ${radio.chassis}`].filter(Boolean).join(', ');
  const status = STATUSES.find((s) => s.id === radio.status);
  return `
    <a class="radio-card" href="#/radio/${radio.id}">
      <div class="thumb">${cover ? `<img src="${urlFor(cover.thumb)}" alt="">` : RADIO_ART}</div>
      <div class="card-body">
        <h3>${esc(radioName(radio))}</h3>
        <p class="muted">${esc(sub) || '&nbsp;'}</p>
        <div class="card-foot">
          <span class="chip s-${radio.status}">${esc(status?.label)}</span>
          <span class="cost" title="Total cost so far">${money(costs.total)}</span>
        </div>
      </div>
    </a>`;
}

export async function render(view) {
  const rows = await loadRadioSummaries();
  const f = S.radioFilter;
  const tabs = [{ id: 'all', label: 'All', n: rows.length }, ...STATUSES.map((s) => ({ id: s.id, label: s.label, n: rows.filter((r) => r.radio.status === s.id).length }))];
  const groups = STATUSES
    .filter((s) => f === 'all' || f === s.id)
    .map((s) => ({ s, items: rows.filter((r) => r.radio.status === s.id) }))
    .filter((g) => g.items.length);

  let content;
  if (!rows.length) {
    content = `<div class="empty panel">${RADIO_ART}<h2>No radios yet</h2><p>Add the first radio on your bench. Each one gets its own page for photos, parts, and costs.</p><button class="btn primary" data-action="new-radio">New radio</button></div>`;
  } else if (!groups.length) {
    content = `<p class="empty-note">No radios with this status.</p>`;
  } else {
    content = groups.map(({ s, items }) => `
      <section class="group">
        <h2 class="group-head">${esc(s.label)} <span class="count">${items.length}</span></h2>
        <div class="cards">${items.map(card).join('')}</div>
      </section>`).join('');
  }

  view.innerHTML = `
    <div class="page-head"><h1>Radios</h1><button class="btn primary" data-action="new-radio">New radio</button></div>
    <div class="tabs" role="tablist" aria-label="Filter by status">
      ${tabs.map((t) => `<button role="tab" aria-selected="${f === t.id}" class="tab ${f === t.id ? 'on' : ''}" data-action="filter-radios" data-value="${t.id}">${esc(t.label)} <span class="count">${t.n}</span></button>`).join('')}
    </div>
    ${content}`;
}

async function newRadioDialog() {
  const makers = [...new Set((await db.radios.toArray()).map((r) => r.manufacturer).filter(Boolean))];
  const id = await openModal({
    title: 'New radio',
    submitButtons: [{ label: 'Create radio', value: 'ok', kind: 'primary' }],
    body: `
      <div class="grid2">
        <label class="field"><span>Manufacturer</span><input name="manufacturer" list="makers" placeholder="Zenith" autocomplete="off"></label>
        <label class="field"><span>Model</span><input name="model" placeholder="Trans-Oceanic"></label>
      </div>
      <datalist id="makers">${makers.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="field"><span>Year</span><input name="year" inputmode="numeric" placeholder="1952"></label>
        <label class="field"><span>Chassis number</span><input name="chassis"></label>
      </div>
      <label class="field"><span>Status</span>
        <select name="status">${STATUSES.filter((s) => s.id !== 'sold').map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select>
      </label>`,
    onSubmit: async (form, api) => {
      const data = formData(form);
      if (!data.manufacturer.trim() && !data.model.trim()) { api.error('Enter a manufacturer or a model.'); return false; }
      return String(await createRadio(data));
    },
  });
  if (id) location.hash = `#/radio/${id}`;
}

export const actions = {
  'new-radio': () => newRadioDialog(),
  'filter-radios': (el) => { S.radioFilter = el.dataset.value; return S.render(); },
};
export const changes = {};
