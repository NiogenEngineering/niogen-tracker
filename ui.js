// Niogen Tracker: small UI helpers (escaping, number formats, dialogs, toasts).

import { num, round2 } from './pricing.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdUnit = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const money = (n) => usd.format(round2(num(n)));
export const unitMoney = (n) => usdUnit.format(num(n)); // shows 4 decimals only when needed
export const fmtQty = (n) => String(Math.round(num(n) * 1e4) / 1e4);
export const fmtPct = (n) => `${Math.round(num(n) * 1000) / 1000}%`;
export const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
export const dateInputValue = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fromDateInput = (v) => (v ? new Date(`${v}T12:00:00`).getTime() : Date.now());

export const formData = (form) => {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = v;
  return out;
};

/* ---------- toasts ---------- */

export function toast(message, kind = 'ok', ms = 3200) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove(); // keep the stack short
  setTimeout(() => el.remove(), ms);
}

/* ---------- dialogs ---------- */

let finishCurrent = null;

// onSubmit(form, api, buttonValue): return false to keep the dialog open.
// Resolves with the value of the button that closed it, or null if cancelled.
export function openModal({
  title, body = '', submitButtons = [{ label: 'Save', value: 'ok', kind: 'primary' }],
  cancelLabel = 'Cancel', wide = false, onMount, onSubmit,
}) {
  finishCurrent?.(null);
  return new Promise((resolve) => {
    const d = document.getElementById('modal');
    d.className = wide ? 'wide' : '';
    d.innerHTML = `
      <form class="modal-card" novalidate>
        <header class="modal-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
        </header>
        <div class="modal-body">${body}</div>
        <p class="form-error" role="alert" hidden></p>
        <footer class="modal-foot">
          <button type="button" class="btn ghost" data-close>${esc(cancelLabel)}</button>
          ${submitButtons.map((b) => `<button type="submit" class="btn ${b.kind || 'primary'}" value="${esc(b.value)}">${esc(b.label)}</button>`).join('')}
        </footer>
      </form>`;
    const form = d.querySelector('form');
    const errEl = d.querySelector('.form-error');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      finishCurrent = null;
      if (d.open) d.close();
      d.innerHTML = '';
      resolve(value);
    };
    finishCurrent = finish;
    const api = {
      form, close: finish,
      error(msg) { errEl.textContent = msg || ''; errEl.hidden = !msg; },
      busy(on) { form.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = on; }); },
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = e.submitter?.value ?? submitButtons[0]?.value ?? 'ok';
      api.error('');
      if (!onSubmit) return finish(value);
      api.busy(true);
      try {
        const result = await onSubmit(form, api, value);
        if (result !== false) finish(result === undefined ? value : result);
      } catch (err) {
        api.error(err?.message || 'Something went wrong.');
        if (err?.name !== 'AppError') console.error(err);
      } finally {
        if (!done) api.busy(false);
      }
    });
    d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => finish(null)));
    d.oncancel = (e) => { e.preventDefault(); finish(null); };
    d.onclick = (e) => { if (e.target === d) finish(null); }; // click on the backdrop
    d.showModal();
    onMount?.(api);
    const first = d.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), select, textarea');
    first?.focus();
  });
}

// choices: [{label, value, kind}] -> resolves with the chosen value, or null if cancelled
export function confirmChoice({ title, message, choices, cancelLabel = 'Cancel' }) {
  return openModal({
    title, cancelLabel,
    body: `<p class="confirm-text">${esc(message)}</p>`,
    submitButtons: choices.map((c) => ({ kind: 'ghost', ...c })),
  });
}
