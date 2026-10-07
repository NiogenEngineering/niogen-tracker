// Niogen Tracker: app shell. Routing, event wiring, backup banner, install button.

import { initDb, getSettings, setSetting, listSellers, onDataChanged, db } from './db.js';
import { S, revokeUrls } from './state.js';
import { mirrorNow, folderSupported, folderStatus, reconnectFolder, downloadBackup } from './backup.js';
import { applyTheme, resolveTheme } from './theme.js';
import { $, $$, esc, toast } from './ui.js';
import * as Radios from './views/radios.js';
import * as Radio from './views/radio.js';
import * as Inventory from './views/inventory.js';
import * as Reports from './views/reports.js';
import * as Settings from './views/settings.js';

const views = { radios: Radios, radio: Radio, inventory: Inventory, reports: Reports, settings: Settings };
const BACKUP_NAG_DAYS = 14;

/* ---------- routing and rendering ---------- */

function parseRoute() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'radio' && Number(b)) return { name: 'radio', id: Number(b) };
  if (['inventory', 'reports', 'settings'].includes(a)) return { name: a };
  return { name: 'radios' };
}

let queue = Promise.resolve();
const TITLES = { radios: 'Radios', inventory: 'Inventory', reports: 'Reports', settings: 'Settings' };

function render({ top = false } = {}) {
  queue = queue.then(() => draw(top)).catch((e) => console.error(e));
  return queue;
}

async function draw(top) {
  const y = window.scrollY;
  revokeUrls();
  S.settings = await getSettings();
  S.sellers = await listSellers();
  const route = parseRoute();
  $$('.nav a').forEach((a) => {
    const on = a.dataset.route === route.name || (route.name === 'radio' && a.dataset.route === 'radios');
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const el = $('#view');
  try {
    document.title = `${TITLES[route.name] ?? 'Radio'} - Niogen Tracker`;
    await views[route.name].render(el, route);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="panel"><h1>Something went wrong</h1><p>${esc(err.message)}</p><p class="hint">Reload the app. If this keeps happening, restore your latest backup from Settings.</p></div>`;
  }
  window.scrollTo(0, top ? 0 : y);
  renderBanner();
}

S.render = () => render();

/* ---------- events ---------- */

const shellActions = {
  'backup-now': async () => {
    try { await downloadBackup(); toast('Backup saved to your Downloads folder'); } catch (e) { toast(`Backup failed: ${e.message}`, 'error', 6000); }
    await S.render();
  },
  'reconnect-folder': async () => {
    try {
      const ok = await reconnectFolder();
      toast(ok ? 'Backup folder reconnected' : 'Permission was not granted', ok ? 'ok' : 'error');
    } catch (e) { toast(e.message, 'error'); }
    await S.render();
  },
  'dismiss-banner': () => { S.bannerDismissed = true; $('#banner').innerHTML = ''; },
  'toggle-theme': async () => {
    const next = resolveTheme() === 'dark' ? 'light' : 'dark';
    await setSetting('theme', next);
    applyTheme(next);
    if (parseRoute().name === 'settings') S.render();
  },
  'install-app': async () => {
    const ev = S.installPrompt;
    if (!ev) return;
    ev.prompt();
    await ev.userChoice.catch(() => {});
    S.installPrompt = null;
    $('#installBtn').hidden = true;
  },
};

const actions = Object.assign({}, ...Object.values(views).map((v) => v.actions ?? {}), shellActions);
const changes = Object.assign({}, ...Object.values(views).map((v) => v.changes ?? {}));

async function run(fn, el, ev) {
  try { await fn(el, ev); } catch (err) {
    toast(err?.message || 'Something went wrong.', 'error', 6000);
    if (err?.name !== 'AppError') console.error(err);
  }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) run(fn, el, ev);
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-change]');
  if (!el) return;
  const fn = changes[el.dataset.change];
  if (fn) run(fn, el, ev);
});
window.addEventListener('hashchange', () => render({ top: true }));
// A file dropped anywhere else must not make the browser navigate away from the app.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

/* ---------- banner ---------- */

async function renderBanner() {
  const host = $('#banner');
  if (S.bannerDismissed) { host.innerHTML = ''; return; }
  const s = await getSettings();
  const folder = folderSupported() ? await folderStatus() : { connected: false };
  let msg = null;
  if (folder.connected && folder.permission !== 'granted') {
    msg = { text: 'Your backup folder needs permission again before it can save.', action: 'reconnect-folder', label: 'Reconnect folder' };
  } else if (!folder.connected) {
    const hasData = (await db.radios.count()) + (await db.parts.count()) > 0;
    const days = s.lastBackupAt ? (Date.now() - s.lastBackupAt) / 864e5 : Infinity;
    if (hasData && days > BACKUP_NAG_DAYS) {
      msg = {
        text: s.lastBackupAt ? `Your last backup was ${Math.floor(days)} days ago.` : 'You have not backed up your data yet.',
        action: 'backup-now', label: 'Back up now',
      };
    }
  }
  host.innerHTML = msg
    ? `<div class="banner" role="status"><span>${esc(msg.text)}</span><span class="banner-actions"><button class="btn small" data-action="${msg.action}">${esc(msg.label)}</button><button class="btn small ghost" data-action="dismiss-banner">Dismiss</button></span></div>`
    : '';
}

/* ---------- install button and service worker ---------- */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.installPrompt = e;
  $('#installBtn').hidden = false;
});
window.addEventListener('appinstalled', () => { S.installPrompt = null; $('#installBtn').hidden = true; toast('Niogen Tracker installed'); });

async function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) toast('An update is ready. Reload the app to use it.', 'ok', 10000);
      });
    });
  } catch (e) {
    console.warn('Offline support is off:', e.message); // normal when opened from a file or without https
  }
}

/* ---------- start ---------- */

async function boot() {
  try {
    await initDb();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="panel"><h1>This browser cannot store data</h1><p>Niogen Tracker needs a normal (not private or incognito) browser window with storage allowed.</p><p class="hint">${esc(e.message)}</p></div>`;
    return;
  }
  const s = await getSettings();
  applyTheme(s.theme);
  navigator.storage?.persist?.().catch(() => {});
  onDataChanged(async () => {
    try { if (await mirrorNow()) renderBanner(); } catch (e) { console.warn('Folder backup failed:', e.message); }
  });
  await render({ top: true });
  registerWorker();
}

boot();
