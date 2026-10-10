// Asset page: one radio's details, photos, parts list, costs, and selling prices.

import { S, urlFor } from './state.js';
import * as D from './db.js';
import { computeCosts, suggestedPrice, profitAt, sellerFee, actualProfit, num } from './pricing.js';
import {
  esc, money, unitMoney, fmtQty, fmtPct, fmtDate, dateInputValue, fromDateInput, formData,
  openModal, confirmChoice, toast, $, $$,
} from './ui.js';
import { RADIO_ART } from './radios.js';

let B = null;      // loaded data for this radio
let C = null;      // computed costs and per-site prices
let root = null;

const natural = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const AUX_PRESETS = ['Radio purchase', 'Shipping in', 'Shipping out', 'Market matching', 'Other'];

/* ---------- loading and math ---------- */

function compute() {
  const { radio, components, aux, listings } = B;
  const costs = computeCosts({ components, aux, laborRate: radio.laborRate, taxPct: radio.taxPct });
  const rows = S.sellers.filter((s) => s.active).map((seller) => {
    const suggested = suggestedPrice(costs.total, seller, radio.cushionPct);
    const listed = listings.find((l) => l.sellerId === seller.id)?.price ?? null;
    return { seller, suggested, listed, profitListed: listed ? profitAt(listed, costs.total, seller) : null };
  });
  C = { costs, rows };
}

async function reload() {
  B = await D.loadRadioBundle(B.radio.id);
  compute();
  paintHead(); paintComponents(); paintCosts(); paintListings();
}

export async function render(el, route) {
  root = el;
  B = await D.loadRadioBundle(route.id);
  if (!B) {
    el.innerHTML = `<div class="panel empty"><h2>Radio not found</h2><p>It may have been deleted.</p><a class="btn primary" href="#/radios">Back to radios</a></div>`;
    return;
  }
  compute();
  el.innerHTML = `
    <a class="back" href="#/radios">&larr; All radios</a>
    <section class="panel asset-head" id="assetHead"></section>
    <div class="two-col">
      <section class="panel" id="detailsPanel"></section>
      <section class="panel" id="photosPanel"></section>
    </div>
    <section class="panel" id="componentsPanel"></section>
    <div class="two-col">
      <section class="panel" id="costPanel"></section>
      <section class="panel" id="listingsPanel"></section>
    </div>`;
  paintHead(); paintDetails(); paintPhotos(); paintComponents(); paintCosts(); paintListings();
  document.title = `${D.radioName(B.radio)} - Niogen Tracker`;
}

/* ---------- header and readout ---------- */

function readout() {
  const { radio } = B;
  if (radio.status === 'sold') {
    const profit = actualProfit(radio.salePrice, radio.saleFee, C.costs.total);
    return `
      <div class="readout" role="group" aria-label="Sale summary">
        <div class="rd-cell"><span class="rd-label">Total cost</span><span class="rd-value">${money(C.costs.total)}</span></div>
        <div class="rd-cell"><span class="rd-label">Sold${radio.soldSellerName ? ` on ${esc(radio.soldSellerName)}` : ''}</span><span class="rd-value amber">${money(radio.salePrice)}</span></div>
        <div class="rd-cell"><span class="rd-label">Site fees</span><span class="rd-value">${money(radio.saleFee)}</span></div>
        <div class="rd-cell"><span class="rd-label">Profit</span><span class="rd-value ${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</span></div>
      </div>
      <p class="readout-note">Sold ${fmtDate(radio.soldAt)}. Fees and profit are locked in from the day of sale.</p>`;
  }
  const cells = C.rows.length
    ? C.rows.map((r) => `<div class="rd-cell"><span class="rd-label">${esc(r.seller.name)} price</span><span class="rd-value amber">${r.suggested == null ? 'n/a' : money(r.suggested)}</span></div>`).join('')
    : `<div class="rd-cell wide"><span class="rd-label">Prices</span><span class="rd-value small">Turn on a selling site in Settings</span></div>`;
  return `
    <div class="readout" role="group" aria-label="Cost and suggested prices">
      <div class="rd-cell"><span class="rd-label">Total cost</span><span class="rd-value">${money(C.costs.total)}</span></div>
      ${cells}
    </div>
    <p class="readout-note">Each price covers the total cost, that site's fees, and your ${fmtPct(B.radio.cushionPct)} cushion.</p>`;
}

function paintHead() {
  const { radio } = B;
  const sub = [radio.year, radio.chassis && `Chassis ${radio.chassis}`].filter(Boolean).join(', ');
  $('#assetHead').innerHTML = `
    <div class="asset-title">
      <div><h1>${esc(D.radioName(radio))}</h1>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>
      <div class="asset-tools">
        <label class="sr-only" for="statusSel">Status</label>
        <select id="statusSel" class="status-select s-${radio.status}" data-change="status">
          ${D.STATUSES.map((s) => `<option value="${s.id}" ${s.id === radio.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
        <button class="btn ghost danger-text" data-action="delete-radio">Delete</button>
      </div>
    </div>
    ${readout()}`;
}

/* ---------- details ---------- */

function paintDetails() {
  const r = B.radio;
  const f = (name, label, ph = '') => `<label class="field"><span>${label}</span><input data-change="detail" data-field="${name}" value="${esc(r[name])}" placeholder="${ph}" autocomplete="off"></label>`;
  $('#detailsPanel').innerHTML = `
    <h2>Details</h2>
    <div class="grid2">${f('manufacturer', 'Manufacturer', 'Zenith')}${f('model', 'Model', 'Trans-Oceanic')}</div>
    <div class="grid2">${f('year', 'Year', '1952')}${f('chassis', 'Chassis number')}</div>
    <label class="field"><span>Notes</span><textarea data-change="detail" data-field="notes" rows="4" placeholder="Condition, history, what still needs doing">${esc(r.notes)}</textarea></label>
    <p class="hint">Details save as you go.</p>`;
}

/* ---------- photos ---------- */

function paintPhotos() {
  const photos = B.photos;
  $('#photosPanel').innerHTML = `
    <div class="panel-head"><h2>Photos</h2>
      <label class="btn small">Add photos<input type="file" id="photoInput" data-change="photos" accept="image/*" multiple hidden></label>
    </div>
    ${photos.length
      ? `<div class="photo-grid">${photos.map((p, i) => `
          <button class="photo" data-action="open-photo" data-index="${i}" aria-label="Open photo ${i + 1}">
            <img src="${urlFor(p.thumb)}" alt="">${i === 0 ? '<span class="badge">Cover</span>' : ''}
          </button>`).join('')}</div>`
      : `<div class="dropzone">${RADIO_ART}<p>Drop photos here or use Add photos.</p></div>`}`;
}

async function reloadPhotos() {
  B.photos = (await D.loadRadioBundle(B.radio.id)).photos;
  paintPhotos();
}

// Registered once for the whole page (not per visit), so one drop never adds a photo twice.
document.addEventListener('dragover', (e) => {
  if (e.target.closest?.('#photosPanel')) { e.preventDefault(); $('#photosPanel').classList.add('drag'); }
});
document.addEventListener('dragleave', (e) => {
  const panel = $('#photosPanel');
  if (panel && !panel.contains(e.relatedTarget)) panel.classList.remove('drag');
});
document.addEventListener('drop', (e) => {
  const panel = e.target.closest?.('#photosPanel');
  if (!panel) return;
  e.preventDefault();
  panel.classList.remove('drag');
  addPhotos([...e.dataTransfer.files]);
});

async function loadBitmap(file) {
  try { return await createImageBitmap(file); } catch {
    return new Promise((resolve, reject) => {
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('unsupported')); };
      img.src = u;
    });
  }
}
function scaled(src, max, quality) {
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', quality));
}

async function addPhotos(files) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) { toast('Choose image files (JPG, PNG, WebP).', 'error'); return; }
  let added = 0, failed = 0;
  for (const file of images) {
    try {
      const bmp = await loadBitmap(file);
      await D.addPhoto(B.radio.id, { full: await scaled(bmp, 1600, 0.85), thumb: await scaled(bmp, 480, 0.8) });
      bmp.close?.();
      added++;
    } catch { failed++; }
  }
  await reloadPhotos();
  if (added) toast(`Added ${added} photo${added === 1 ? '' : 's'}`);
  if (failed) toast(`${failed} file${failed === 1 ? '' : 's'} could not be read. HEIC photos need converting to JPG first.`, 'error', 6000);
}

async function openPhoto(index) {
  const photos = B.photos;
  if (!photos.length) return;
  index = (index + photos.length) % photos.length;
  const photo = photos[index];
  const blob = await D.getFullPhoto(photo.id);
  const url = blob ? URL.createObjectURL(blob) : '';
  const many = photos.length > 1;
  const result = await openModal({
    title: `Photo ${index + 1} of ${photos.length}`, wide: true, cancelLabel: 'Close',
    submitButtons: [
      ...(index > 0 ? [{ label: 'Make cover', value: 'cover', kind: 'ghost' }] : []),
      { label: 'Delete photo', value: 'delete', kind: 'danger' },
    ],
    body: `<div class="lightbox">
      ${many ? '<button type="button" class="lb-nav prev" data-nav="-1" aria-label="Previous photo">&lsaquo;</button>' : ''}
      <img src="${url}" alt="Photo ${index + 1} of ${esc(D.radioName(B.radio))}">
      ${many ? '<button type="button" class="lb-nav next" data-nav="1" aria-label="Next photo">&rsaquo;</button>' : ''}
    </div>`,
    onMount: (api) => {
      api.form.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => api.close(`nav:${b.dataset.nav}`)));
      api.form.addEventListener('keydown', (e) => {
        if (!many) return;
        if (e.key === 'ArrowLeft') api.close('nav:-1');
        if (e.key === 'ArrowRight') api.close('nav:1');
      });
    },
  });
  if (url) URL.revokeObjectURL(url);
  if (typeof result === 'string' && result.startsWith('nav:')) return openPhoto(index + Number(result.slice(4)));
  if (result === 'cover') { await D.setCover(photo.id); await reloadPhotos(); toast('Cover photo updated'); }
  if (result === 'delete') {
    const sure = await confirmChoice({ title: 'Delete this photo?', message: 'This cannot be undone.', choices: [{ label: 'Delete photo', value: 'yes', kind: 'danger' }] });
    if (sure === 'yes') { await D.deletePhoto(photo.id); await reloadPhotos(); toast('Photo deleted'); }
    else return openPhoto(index);
  }
}

/* ---------- components ---------- */

const matchesFilter = (c) => {
  if (S.comp.status !== 'all' && c.status !== S.comp.status) return false;
  const f = S.comp.filter.trim().toLowerCase();
  if (!f) return true;
  return [c.category, c.ref, c.description, c.note, c.part?.partNumber, D.compStatusLabel(c.status)].join(' ').toLowerCase().includes(f);
};

function groupedComponents() {
  const list = B.components.filter(matchesFilter);
  list.sort((a, b) => natural(a.category, b.category) || natural(a.ref, b.ref) || a.id - b.id);
  const groups = new Map();
  for (const c of list) { if (!groups.has(c.category)) groups.set(c.category, []); groups.get(c.category).push(c); }
  return groups;
}

function componentRows() {
  if (!B.components.length) {
    return `<tr><td colspan="8" class="empty-cell">No components listed yet. Use Add components to type in this radio's tubes, capacitors, resistors, and the rest, one per line.</td></tr>`;
  }
  const groups = groupedComponents();
  if (!groups.size) return `<tr><td colspan="8" class="empty-cell">Nothing matches that filter.</td></tr>`;
  let html = '';
  for (const [cat, items] of groups) {
    const need = items.filter((c) => c.status === 'replace').length;
    const subtotal = items.reduce((t, c) => t + num(c.qty) * num(c.unitCost), 0);
    html += `<tr class="cat-row"><th colspan="6" scope="colgroup">${esc(cat)} <span class="count">${items.length}</span>${need ? ` <span class="need-tag">${need} ${need === 1 ? 'needs' : 'need'} replacing</span>` : ''}</th><td class="num">${subtotal > 0 ? money(subtotal) : ''}</td><td></td></tr>`;
    for (const c of items) {
      const replaced = c.status === 'replaced';
      html += `<tr class="${c.status === 'replace' ? 'need' : ''}">
        <td class="ref">${esc(c.ref)}</td>
        <td>${esc(c.description)}${c.note ? `<div class="sub">${esc(c.note)}</div>` : ''}</td>
        <td><select class="row-status cs-${c.status}" data-change="compstatus" data-id="${c.id}" aria-label="Status of ${esc(c.ref || c.description)}">
          ${D.COMP_STATUSES.map((st) => `<option value="${st.id}" ${st.id === c.status ? 'selected' : ''}>${esc(st.label)}</option>`).join('')}
        </select></td>
        <td class="mono">${c.part ? esc(c.part.partNumber) : replaced ? '<span class="muted">Manual cost</span>' : ''}</td>
        <td class="num">${fmtQty(c.qty)}</td>
        <td class="num">${replaced ? unitMoney(c.unitCost) : ''}</td>
        <td class="num">${replaced ? money(num(c.qty) * num(c.unitCost)) : ''}</td>
        <td class="row-actions">
          ${c.partId ? `<button class="btn small" data-action="undo-replace" data-id="${c.id}">Undo</button>` : replaced ? '' : `<button class="btn small" data-action="replace-line" data-id="${c.id}">Replace</button>`}
          <button class="btn small ghost" data-action="edit-line" data-id="${c.id}">Edit</button>
          <button class="btn small ghost danger-text" data-action="remove-line" data-id="${c.id}">Remove</button>
        </td></tr>`;
    }
  }
  return html;
}

function paintComponents() {
  const total = B.components.length;
  const n = (st) => B.components.filter((c) => c.status === st).length;
  const chips = [{ id: 'all', label: 'All', n: total }, ...D.COMP_STATUSES.map((st) => ({ id: st.id, label: st.label, n: n(st.id) }))];
  $('#componentsPanel').innerHTML = `
    <div class="panel-head">
      <h2>Components</h2>
      <div class="head-tools">
        <input type="search" id="compFilter" class="search" placeholder="Filter components" value="${esc(S.comp.filter)}" aria-label="Filter components on this radio" autocomplete="off">
        <button class="btn primary" data-action="add-components">Add components</button>
        <button class="btn" data-action="add-part-used">Add part used</button>
      </div>
    </div>
    <div class="fchips" role="group" aria-label="Filter by status">
      ${chips.map((ch) => `<button class="fchip ${S.comp.status === ch.id ? 'on' : ''}" aria-pressed="${S.comp.status === ch.id}" data-action="comp-filter" data-value="${ch.id}">${esc(ch.label)} <span class="count">${ch.n}</span></button>`).join('')}
    </div>
    <div class="table-wrap">
      <table class="data parts-table">
        <thead><tr><th>Ref</th><th>Description</th><th>Status</th><th>Replacement</th><th class="num">Qty</th><th class="num">Each</th><th class="num">Line cost</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="compBody">${componentRows()}</tbody>
      </table>
    </div>
    <p class="table-foot">${total ? `${total} component${total === 1 ? '' : 's'}: ${n('replace')} need replacing, ${n('replaced')} replaced, ${n('ok')} OK, ${n('unchecked')} not checked. Parts cost ${money(C.costs.parts)}.` : ''}</p>`;
  $('#compFilter').addEventListener('input', (e) => { S.comp.filter = e.target.value; $('#compBody').innerHTML = componentRows(); });
}

/* A part can come from inventory (stock goes down) or be a typed-in cost. Used by two dialogs. */
const sourceBlock = () => `
  <fieldset class="seg-field">
    <legend class="sr-only">Where the part comes from</legend>
    <label class="seg"><input type="radio" name="source" value="part" checked><span>From inventory</span></label>
    <label class="seg"><input type="radio" name="source" value="manual"><span>Typed-in cost</span></label>
  </fieldset>
  <div id="srcPart">
    <label class="field"><span>Find a part</span><input type="search" id="partSearch" placeholder="Search part number or description" autocomplete="off"></label>
    <div id="partList" class="pick-list" role="listbox" aria-label="Inventory parts"></div>
    <input type="hidden" name="partId" value="">
  </div>`;

function wireSource(form, parts, { onChoose } = {}) {
  const list = $('#partList', form), search = $('#partSearch', form), srcPart = $('#srcPart', form), cost = form.elements.unitCost;
  let selected = null;
  const draw = () => {
    const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = parts.filter((p) => q.every((t) => `${p.partNumber} ${p.description}`.toLowerCase().includes(t)))
      .sort((a, b) => natural(a.partNumber, b.partNumber)).slice(0, 40);
    list.innerHTML = hits.length
      ? hits.map((p) => `<button type="button" class="pick ${selected === p.id ? 'on' : ''}" role="option" aria-selected="${selected === p.id}" data-pid="${p.id}">
          <span class="mono">${esc(p.partNumber)}</span><span>${esc(p.description)}</span>
          <span class="stock ${p.qty <= 0 ? 'out' : ''}">${fmtQty(p.qty)} on hand${p.onOrderQty > 0 ? `, ${fmtQty(p.onOrderQty)} on order` : ''}</span></button>`).join('')
      : `<p class="empty-note">${parts.length ? 'No parts match.' : 'Inventory is empty. Use a typed-in cost, or add parts in Inventory first.'}</p>`;
  };
  const choose = (id) => {
    selected = id;
    form.elements.partId.value = id ?? '';
    const p = parts.find((x) => x.id === id) ?? null;
    cost.value = p ? p.unitCost : '';
    draw();
    onChoose?.(p);
  };
  const setSource = () => {
    const manual = form.elements.source.value === 'manual';
    srcPart.hidden = manual;
    cost.disabled = !manual;
    cost.placeholder = manual ? '0.00' : 'From inventory';
    if (manual) choose(null);
  };
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-pid]'); if (b) choose(Number(b.dataset.pid)); });
  search.addEventListener('input', draw);
  form.querySelectorAll('[name=source]').forEach((r) => r.addEventListener('change', setSource));
  draw();
  return {
    search, isManual: () => form.elements.source.value === 'manual',
    refresh(newParts) { parts = newParts; draw(); },
    reset() { selected = null; form.elements.partId.value = ''; search.value = ''; cost.value = ''; draw(); },
  };
}

const costField = (disabled, value = '') => `<label class="field"><span>Cost each ($)</span><input name="unitCost" type="number" min="0" step="any" value="${value}" ${disabled ? 'disabled' : ''} placeholder="${disabled ? 'From inventory' : '0.00'}"></label>`;
const catList = (cats) => `<datalist id="catList">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;

// Type the radio's own components in a list; they start as Not checked and cost nothing.
async function bulkDialog() {
  const cats = await D.listCategories();
  const parse = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^,\t]*)[,\t]\s*(.+)$/);
    return m ? { ref: m[1].trim(), description: m[2].trim() } : { ref: '', description: l };
  });
  const ok = await openModal({
    title: 'Add components', wide: true, submitButtons: [{ label: 'Add to this radio', value: 'ok' }],
    body: `
      <label class="field"><span>Category</span><input name="category" list="catList" placeholder="Leave blank to sort by reference letter" autocomplete="off"></label>
      ${catList(cats)}
      <label class="field"><span>Components, one per line</span>
        <textarea name="lines" rows="9" placeholder="V1, 6BE6 converter tube&#10;V2, 6BA6 IF amplifier&#10;V3, 6AV6 detector and first audio&#10;C1, 0.047uF 600V coupling cap"></textarea></label>
      <p class="hint">Write the reference first, then a comma, then the description. A line with no comma is used as the description. With the category blank, the reference letter picks it: V is Tube, C is Capacitor, R is Resistor, T is Transformer, L is Coil, S is Switch. Everything starts as Not checked and costs nothing.</p>
      <p class="preview" id="bulkPreview" aria-live="polite"></p>`,
    onMount: ({ form }) => {
      const out = $('#bulkPreview', form);
      form.elements.lines.addEventListener('input', () => {
        const n = parse(form.elements.lines.value).length;
        out.textContent = n ? `${n} component${n === 1 ? '' : 's'} will be added.` : '';
      });
    },
    onSubmit: async (form) => {
      const d = formData(form);
      toast(`Added ${await D.addComponentsBulk(B.radio.id, d.category, parse(d.lines))} components`);
      return 'ok';
    },
  });
  if (ok === 'ok') await reload();
}

// A part used on the radio right away, without listing the original component first.
async function partUsedDialog() {
  let parts = await D.listParts();
  const cats = await D.listCategories();
  let autoDesc = '', picker = null;
  await openModal({
    title: 'Add part used',
    submitButtons: [{ label: 'Add part', value: 'ok' }, { label: 'Add and add another', value: 'again', kind: 'ghost' }],
    body: `
      ${sourceBlock()}
      <div class="grid2">
        <label class="field"><span>Category</span><input name="category" list="catList" placeholder="Capacitor" autocomplete="off"></label>
        <label class="field"><span>Reference</span><input name="ref" placeholder="C12" autocomplete="off"></label>
      </div>
      ${catList(cats)}
      <label class="field"><span>Description</span><input name="description" placeholder="0.1uF 400V cap" autocomplete="off"></label>
      <div class="grid2">
        <label class="field"><span>Quantity</span><input name="qty" type="number" min="0" step="any" value="1"></label>
        ${costField(true)}
      </div>`,
    onMount: ({ form }) => {
      const desc = form.elements.description;
      picker = wireSource(form, parts, { onChoose: (p) => {
        if (p && (!desc.value.trim() || desc.value === autoDesc)) { desc.value = p.description; autoDesc = p.description; }
      } });
      form._reset = async () => {
        parts = await D.listParts(); picker.refresh(parts); picker.reset();
        form.elements.ref.value = ''; desc.value = ''; form.elements.qty.value = 1; autoDesc = '';
        (picker.isManual() ? form.elements.ref : picker.search).focus();
      };
    },
    onSubmit: async (form, api, sv) => {
      const d = formData(form);
      const fromPart = (d.source ?? 'part') === 'part';
      if (fromPart && !d.partId) { api.error('Pick a part from the list, or switch to Typed-in cost.'); return false; }
      await D.addComponent(B.radio.id, {
        partId: fromPart ? Number(d.partId) : null, category: d.category, ref: d.ref, description: d.description,
        qty: d.qty, unitCost: fromPart ? 0 : d.unitCost, status: 'replaced',
      });
      toast(`Added ${d.description || 'part'}`);
      await reload();
      if (sv === 'again') { await form._reset(); return false; }
      return 'ok';
    },
  });
}

// Record what replaced a component: a part from inventory, or a typed-in cost.
async function replaceDialog(c) {
  const parts = await D.listParts();
  const ok = await openModal({
    title: 'Replace component', submitButtons: [{ label: 'Mark as replaced', value: 'ok' }],
    body: `
      <p class="part-line"><strong>${esc(c.ref ? `${c.ref}: ` : '')}${esc(c.description)}</strong> <span class="muted">${esc(c.category)}</span></p>
      ${sourceBlock()}
      <div class="grid2">
        <label class="field"><span>Quantity used</span><input name="qty" type="number" min="0" step="any" value="${c.qty}"></label>
        ${costField(true)}
      </div>`,
    onMount: ({ form }) => { wireSource(form, parts); },
    onSubmit: async (form, api) => {
      const d = formData(form);
      const fromPart = (d.source ?? 'part') === 'part';
      if (fromPart && !d.partId) { api.error('Pick the part you used, or switch to Typed-in cost.'); return false; }
      await D.replaceComponent(c.id, { partId: fromPart ? Number(d.partId) : null, qty: d.qty, unitCost: fromPart ? 0 : d.unitCost });
      return 'ok';
    },
  });
  if (ok === 'ok') toast('Marked as replaced');
  await reload(); // also puts the status menu back if the dialog was cancelled
}

async function editLineDialog(c) {
  const cats = await D.listCategories();
  const manualCost = !c.partId && c.status === 'replaced';
  const ok = await openModal({
    title: 'Edit component', submitButtons: [{ label: 'Save changes', value: 'ok' }],
    body: `
      ${c.partId ? `<p class="part-line"><strong>${esc(c.part?.partNumber ?? 'Part')}</strong> from inventory. Changing the quantity updates stock.</p>` : ''}
      <div class="grid2">
        <label class="field"><span>Category</span><input name="category" list="catList" value="${esc(c.category)}" autocomplete="off"></label>
        <label class="field"><span>Reference</span><input name="ref" value="${esc(c.ref)}" autocomplete="off"></label>
      </div>
      ${catList(cats)}
      <label class="field"><span>Description</span><input name="description" value="${esc(c.description)}" autocomplete="off"></label>
      <div class="grid2">
        <label class="field"><span>Quantity</span><input name="qty" type="number" min="0" step="any" value="${c.qty}"></label>
        ${manualCost ? costField(false, c.unitCost) : ''}
      </div>
      <label class="field"><span>Notes</span><textarea name="note" rows="3" placeholder="Test results, what to order, where it is on the chassis">${esc(c.note)}</textarea></label>`,
    onSubmit: async (form) => { await D.updateComponent(c.id, formData(form)); return 'ok'; },
  });
  if (ok === 'ok') { toast('Component updated'); await reload(); }
}

async function undoFlow(c, thenStatus = 'replace') {
  const v = await confirmChoice({
    title: 'Undo this replacement?',
    message: `${fmtQty(c.qty)} x ${c.part?.partNumber ?? 'part'} was taken from inventory for this. Put it back on the shelf, or was it used up or damaged?`,
    choices: [
      { label: 'Return to stock', value: 'return', kind: 'primary' },
      { label: 'Used up, do not return', value: 'keep', kind: 'ghost' },
    ],
  });
  if (!v) return false;
  await D.undoReplacement(c.id, { returnToStock: v === 'return' });
  if (thenStatus !== 'replace') await D.setStatus(c.id, thenStatus);
  toast(v === 'return' ? 'Undone and returned to stock' : 'Undone');
  return true;
}

async function changeCompStatus(el) {
  const c = B.components.find((x) => x.id === Number(el.dataset.id));
  const next = el.value;
  if (!c || next === c.status) return;
  if (next === 'replaced') { await replaceDialog(c); return; }
  if (c.partId) await undoFlow(c, next);
  else await D.setStatus(c.id, next);
  await reload();
}

async function removeLine(comp) {
  if (comp.partId && comp.part) {
    const v = await confirmChoice({
      title: 'Remove this component?',
      message: `${fmtQty(comp.qty)} x ${comp.part.partNumber} (${comp.description}) came from inventory. Put it back on the shelf, or was it used up or damaged?`,
      choices: [
        { label: 'Return to stock', value: 'return', kind: 'primary' },
        { label: 'Used up, do not return', value: 'keep', kind: 'ghost' },
      ],
    });
    if (!v) return;
    await D.removeComponent(comp.id, { returnToStock: v === 'return' });
    toast(v === 'return' ? 'Removed and returned to stock' : 'Removed');
  } else {
    const v = await confirmChoice({
      title: 'Remove this component?', message: `${comp.description} will be removed from this radio's list.`,
      choices: [{ label: 'Remove component', value: 'yes', kind: 'danger' }],
    });
    if (v !== 'yes') return;
    await D.removeComponent(comp.id, { returnToStock: false });
    toast('Component removed');
  }
  await reload();
}

/* ---------- costs ---------- */

function paintCosts() {
  const { costs } = C, r = B.radio;
  $('#costPanel').innerHTML = `
    <h2>Costs</h2>
    <dl class="sum">
      <div><dt>Parts</dt><dd>${money(costs.parts)}</dd></div>
      <div><dt>Sales tax on parts (${fmtPct(r.taxPct)})</dt><dd>${money(costs.tax)}</dd></div>
      <div><dt>Labor</dt><dd>${money(costs.labor)}</dd></div>
      <div><dt>Auxiliary costs</dt><dd>${money(costs.aux)}</dd></div>
      <div class="total"><dt>Total cost</dt><dd>${money(costs.total)}</dd></div>
    </dl>
    <h3>Auxiliary costs</h3>
    ${B.aux.length
      ? `<ul class="aux-list">${[...B.aux].sort((a, b) => a.id - b.id).map((a) => `
          <li><span>${esc(a.label)}</span><span class="amt">${money(a.amount)}</span>
            <span class="row-actions"><button class="btn small ghost" data-action="edit-aux" data-id="${a.id}">Edit</button>
            <button class="btn small ghost danger-text" data-action="remove-aux" data-id="${a.id}">Remove</button></span></li>`).join('')}</ul>`
      : '<p class="hint">Radio purchase price and anything else that is not a part goes here.</p>'}
    <div class="chip-row" aria-label="Add a cost">
      ${AUX_PRESETS.map((p) => `<button class="chip-btn" data-action="add-aux" data-label="${esc(p)}">Add ${esc(p.toLowerCase())}</button>`).join('')}
    </div>
    <h3>Rates for this radio</h3>
    <div class="grid3">
      <label class="field"><span>Labor ($ flat)</span><input type="number" min="0" step="any" data-change="rate" data-field="laborRate" value="${r.laborRate}"></label>
      <label class="field"><span>Sales tax on parts (%)</span><input type="number" min="0" max="100" step="any" data-change="rate" data-field="taxPct" value="${r.taxPct}"></label>
      <label class="field"><span>Cushion (%)</span><input type="number" min="0" max="99" step="any" data-change="rate" data-field="cushionPct" value="${r.cushionPct}"></label>
    </div>
    <p class="hint">New radios start from the defaults in Settings. Changing a rate here affects only this radio.</p>`;
}

async function auxDialog(row = null, presetLabel = '') {
  const ok = await openModal({
    title: row ? 'Edit cost' : 'Add cost',
    submitButtons: [{ label: row ? 'Save changes' : 'Add cost', value: 'ok' }],
    body: `
      <label class="field"><span>What is it for</span><input name="label" list="auxList" value="${esc(row?.label ?? presetLabel)}" placeholder="Radio purchase" autocomplete="off"></label>
      <datalist id="auxList">${AUX_PRESETS.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <label class="field"><span>Amount ($)</span><input name="amount" type="number" min="0" step="any" value="${row ? row.amount : ''}" data-autofocus></label>`,
    onMount: ({ form }) => { (presetLabel || row ? form.elements.amount : form.elements.label).focus(); },
    onSubmit: async (form) => {
      const d = formData(form);
      if (row) await D.updateAux(row.id, d); else await D.addAux(B.radio.id, d);
      return 'ok';
    },
  });
  if (ok === 'ok') { toast(row ? 'Cost updated' : 'Cost added'); await reload(); }
}

/* ---------- selling prices and sale ---------- */

function paintListings() {
  const sold = B.radio.status === 'sold';
  $('#listingsPanel').innerHTML = `
    <div class="panel-head"><h2>Selling prices</h2>
      <button class="btn ${sold ? 'ghost' : 'primary'} small" data-action="${sold ? 'edit-sale' : 'mark-sold'}">${sold ? 'Edit sale details' : 'Mark as sold'}</button>
    </div>
    ${C.rows.length ? `
      <div class="table-wrap"><table class="data compact">
        <thead><tr><th>Site</th><th class="num">Fees</th><th class="num">Suggested</th><th class="num">Your listed price</th><th class="num">Profit at listed</th></tr></thead>
        <tbody>${C.rows.map((r) => `<tr>
          <td>${esc(r.seller.name)}</td>
          <td class="num">${fmtPct(r.seller.feePct)}${r.seller.fixedFee ? ` + ${money(r.seller.fixedFee)}` : ''}</td>
          <td class="num strong">${r.suggested == null ? 'n/a' : money(r.suggested)}</td>
          <td class="num"><input class="price-input" type="number" min="0" step="0.01" inputmode="decimal" data-change="listing" data-seller="${r.seller.id}" value="${r.listed ?? ''}" placeholder="Not listed" aria-label="Listed price on ${esc(r.seller.name)}"></td>
          <td class="num ${r.profitListed == null ? '' : r.profitListed >= 0 ? 'pos' : 'neg'}">${r.profitListed == null ? '' : money(r.profitListed)}</td>
        </tr>`).join('')}</tbody></table></div>
      <details class="calc"><summary>How the suggested price works</summary>
        <p class="hint">Suggested price = (total cost + the site's fixed fee) &divide; (1 &minus; site fee % &minus; cushion %). The cushion is a share of the selling price. It is the profit you keep if the sale goes as planned. Prices round up to the next cent.</p>
      </details>`
      : '<p class="empty-note">No selling sites are turned on. Add or enable them in Settings.</p>'}`;
}

async function soldDialog(editing) {
  const r = B.radio;
  const sites = S.sellers.filter((s) => s.active || s.id === r.soldSellerId);
  const startSite = editing ? (r.soldSellerId ?? 0) : (sites[0]?.id ?? 0);
  const siteById = (id) => sites.find((s) => s.id === Number(id)) ?? null;
  const defaultPrice = (id) => {
    const row = C.rows.find((x) => x.seller.id === Number(id));
    return row?.listed ?? row?.suggested ?? '';
  };
  let feeDirty = editing, priceDirty = editing;
  const ok = await openModal({
    title: editing ? 'Edit sale details' : 'Mark as sold',
    submitButtons: [{ label: editing ? 'Save sale' : 'Mark as sold', value: 'ok' }],
    body: `
      <label class="field"><span>Sold on</span>
        <select name="site">${sites.map((s) => `<option value="${s.id}" ${s.id === startSite ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="0" ${startSite === 0 ? 'selected' : ''}>Other (no fees)</option></select>
      </label>
      <div class="grid3">
        <label class="field"><span>Price it sold for ($)</span><input name="price" type="number" min="0" step="0.01" value="${editing ? r.salePrice : defaultPrice(startSite)}" data-autofocus></label>
        <label class="field"><span>Site fees ($)</span><input name="fee" type="number" min="0" step="0.01" value="${editing ? r.saleFee : ''}"></label>
        <label class="field"><span>Date sold</span><input name="date" type="date" value="${dateInputValue(editing ? r.soldAt : Date.now())}"></label>
      </div>
      <p class="hint" id="saleHint">Fees fill in from the site's rates. Change them if the real number differs.</p>
      <p class="preview" id="salePreview" aria-live="polite"></p>`,
    onMount: ({ form }) => {
      const e = form.elements, preview = $('#salePreview', form);
      const update = () => {
        if (!feeDirty) e.fee.value = e.price.value === '' ? '' : sellerFee(e.price.value, siteById(e.site.value));
        const p = num(e.price.value);
        preview.textContent = p > 0 ? `Profit after fees and all costs: ${money(actualProfit(p, e.fee.value, C.costs.total))}` : '';
      };
      e.price.addEventListener('input', () => { priceDirty = true; update(); });
      e.fee.addEventListener('input', () => { feeDirty = true; update(); });
      e.site.addEventListener('change', () => { if (!priceDirty) e.price.value = defaultPrice(e.site.value); update(); });
      update();
    },
    onSubmit: async (form) => {
      const d = formData(form);
      const site = siteById(d.site);
      await D.markSold(r.id, { sellerId: site?.id ?? null, sellerName: site?.name ?? 'Other', salePrice: d.price, saleFee: d.fee, soldAt: fromDateInput(d.date) });
      return 'ok';
    },
  });
  if (ok === 'ok') { toast(editing ? 'Sale updated' : 'Marked as sold'); }
  await reload();
  return ok === 'ok';
}

async function changeStatus(sel) {
  const next = sel.value, prev = B.radio.status;
  if (next === prev) return;
  if (next === 'sold') { await soldDialog(false); return; }
  if (prev === 'sold') {
    const v = await confirmChoice({
      title: 'Reopen this radio?', message: 'The sale price, fees, and date will be cleared. Costs and parts stay as they are.',
      choices: [{ label: 'Reopen radio', value: 'yes', kind: 'primary' }],
    });
    if (v !== 'yes') { paintHead(); return; }
    await D.reopenRadio(B.radio.id, next);
  } else {
    await D.updateRadio(B.radio.id, { status: next });
  }
  await reload();
}

async function deleteRadio() {
  const linked = B.components.filter((c) => c.partId && c.part);
  const name = D.radioName(B.radio);
  const v = await confirmChoice({
    title: `Delete ${name}?`,
    message: linked.length
      ? `This removes the radio, its photos, and its cost history. ${linked.length} line${linked.length === 1 ? ' was' : 's were'} taken from inventory. Should those parts go back on the shelf?`
      : 'This removes the radio, its photos, and its cost history. It cannot be undone.',
    choices: linked.length
      ? [{ label: 'Delete and return parts to stock', value: 'return', kind: 'danger' }, { label: 'Delete, leave stock as it is', value: 'keep', kind: 'ghost' }]
      : [{ label: 'Delete radio', value: 'keep', kind: 'danger' }],
  });
  if (!v) return;
  await D.deleteRadio(B.radio.id, { returnParts: v === 'return' });
  toast(`${name} deleted`);
  location.hash = '#/radios';
}

/* ---------- event maps (wired up in app.js) ---------- */

const comp = (el) => B.components.find((c) => c.id === Number(el.dataset.id));
const auxRow = (el) => B.aux.find((a) => a.id === Number(el.dataset.id));

export const actions = {
  'add-components': () => bulkDialog(),
  'add-part-used': () => partUsedDialog(),
  'edit-line': (el) => editLineDialog(comp(el)),
  'replace-line': (el) => replaceDialog(comp(el)),
  'undo-replace': async (el) => { if (await undoFlow(comp(el))) await reload(); },
  'comp-filter': (el) => { S.comp.status = el.dataset.value; paintComponents(); },
  'remove-line': (el) => removeLine(comp(el)),
  'add-aux': (el) => auxDialog(null, el.dataset.label),
  'edit-aux': (el) => auxDialog(auxRow(el)),
  'remove-aux': async (el) => { await D.removeAux(Number(el.dataset.id)); toast('Cost removed'); await reload(); },
  'mark-sold': () => soldDialog(false),
  'edit-sale': () => soldDialog(true),
  'delete-radio': () => deleteRadio(),
  'open-photo': (el) => openPhoto(Number(el.dataset.index)),
};

export const changes = {
  status: (el) => changeStatus(el),
  detail: async (el) => {
    const field = el.dataset.field;
    await D.updateRadio(B.radio.id, { [field]: el.value.trim() });
    B.radio[field] = el.value.trim();
    paintHead();
    document.title = `${D.radioName(B.radio)} - Niogen Tracker`;
  },
  compstatus: (el) => changeCompStatus(el),
  photos: async (el) => { const files = [...el.files]; el.value = ''; await addPhotos(files); },
  listing: async (el) => { await D.setListing(B.radio.id, Number(el.dataset.seller), el.value); await reload(); },
  rate: async (el) => {
    const field = el.dataset.field;
    const v = num(el.value);
    const max = field === 'cushionPct' ? 99 : field === 'taxPct' ? 100 : Infinity;
    if (el.value === '' || v < 0 || v > max) { toast(`Enter a number between 0 and ${max === Infinity ? 'any amount' : max}.`, 'error'); paintCosts(); return; }
    await D.updateRadio(B.radio.id, { [field]: v });
    await reload();
  },
};
