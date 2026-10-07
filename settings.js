// Settings screen: defaults, selling sites, appearance, backups, storage.

import { S } from './state.js';
import * as D from './db.js';
import * as K from './backup.js';
import { num } from './pricing.js';
import { esc, money, fmtDate, formData, openModal, confirmChoice, toast, $ } from './ui.js';
import { applyTheme } from './theme.js';

let persisted = null;

export async function render(view) {
  const s = S.settings;
  const sellers = S.sellers;
  const folder = K.folderSupported() ? await K.folderStatus() : null;
  persisted = (await navigator.storage?.persisted?.()) ?? null;
  const last = s.lastBackupAt ? `${fmtDate(s.lastBackupAt)} at ${new Date(s.lastBackupAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Never';

  view.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>

    <section class="panel">
      <h2>Defaults for new radios</h2>
      <div class="grid3">
        <label class="field"><span>Labor ($ flat)</span><input type="number" min="0" step="any" data-change="default" data-key="laborRate" value="${s.laborRate}"></label>
        <label class="field"><span>Sales tax on parts (%)</span><input type="number" min="0" max="100" step="any" data-change="default" data-key="taxPct" value="${s.taxPct}"></label>
        <label class="field"><span>Cushion (%)</span><input type="number" min="0" max="99" step="any" data-change="default" data-key="cushionPct" value="${s.cushionPct}"></label>
      </div>
      <p class="hint">These are copied onto each new radio when you create it. Radios you already have keep their own rates. The cushion is the share of every selling price you want left over after costs and site fees.</p>
    </section>

    <section class="panel">
      <h2>Selling sites</h2>
      <div class="table-wrap"><table class="data compact sites">
        <thead><tr><th>Use</th><th>Site</th><th class="num">Fee %</th><th class="num">Fixed fee ($)</th><th><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>${sellers.map((x) => `<tr>
          <td class="chk"><input type="checkbox" data-change="seller-active" data-id="${x.id}" ${x.active ? 'checked' : ''} aria-label="Use ${esc(x.name)}"></td>
          <td><input data-change="seller" data-id="${x.id}" data-field="name" value="${esc(x.name)}" aria-label="Site name"></td>
          <td class="num"><input type="number" min="0" max="99.9" step="any" data-change="seller" data-id="${x.id}" data-field="feePct" value="${x.feePct}" aria-label="Fee percent for ${esc(x.name)}"></td>
          <td class="num"><input type="number" min="0" step="any" data-change="seller" data-id="${x.id}" data-field="fixedFee" value="${x.fixedFee}" aria-label="Fixed fee for ${esc(x.name)}"></td>
          <td class="row-actions"><button class="btn small ghost danger-text" data-action="delete-seller" data-id="${x.id}">Remove</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="add-row">
        <button class="btn" data-action="add-seller">Add a selling site</button>
      </div>
      <p class="hint">Fee % is the share of the sale price the site keeps. Fixed fee is the per-sale amount on top of that, such as Etsy's $0.25 processing plus $0.20 listing fee. These starting numbers came from published 2026 fee pages, which disagree in places, so compare them with a recent payout on each site. Sales you already marked as sold keep the fees recorded at the time.</p>
    </section>

    <section class="panel">
      <h2>Appearance</h2>
      <fieldset class="seg-field">
        <legend class="sr-only">Theme</legend>
        ${['auto', 'light', 'dark'].map((t) => `<label class="seg"><input type="radio" name="theme" value="${t}" data-change="theme" ${s.theme === t ? 'checked' : ''}><span>${t === 'auto' ? 'Match my computer' : t[0].toUpperCase() + t.slice(1)}</span></label>`).join('')}
      </fieldset>
    </section>

    <section class="panel">
      <h2>Backup and restore</h2>
      <p>Last backup: <strong>${esc(last)}</strong></p>
      <div class="btn-row">
        <button class="btn primary" data-action="backup-now">Back up now</button>
        <label class="btn">Restore from a backup file<input type="file" accept=".json,application/json" data-change="restore" hidden></label>
      </div>
      <p class="hint">A backup is one file with everything in it, photos included. Back up now saves it to your Downloads folder.</p>
      <h3>Automatic backup to a folder</h3>
      ${folder === null
        ? '<p class="hint">Automatic folder backup needs Chrome or Edge on a computer.</p>'
        : folder.connected
          ? `<p>Saving to the folder <strong>${esc(folder.name)}</strong> after every change. ${folder.permission === 'granted' ? '<span class="good">Connected.</span>' : '<span class="bad">Needs permission again.</span>'}</p>
             <div class="btn-row">
               ${folder.permission === 'granted' ? '' : '<button class="btn primary" data-action="reconnect-folder">Reconnect folder</button>'}
               <button class="btn" data-action="choose-folder">Choose a different folder</button>
               <button class="btn ghost" data-action="disconnect-folder">Turn off</button>
             </div>`
          : '<div class="btn-row"><button class="btn primary" data-action="choose-folder">Choose a backup folder</button></div>'}
      <p class="hint">${folder !== null ? 'The app keeps one file per day for the last 14 days, so you can go back if something goes wrong. A folder in OneDrive, Dropbox, or on a USB drive protects you if this computer fails. ' : ''}Your data lives in this browser. It is never uploaded anywhere.</p>
    </section>

    <section class="panel">
      <h2>Storage protection</h2>
      <p>${persisted === true ? '<span class="good">Protected.</span> The browser will not clear this app\'s data to free space.' : persisted === false ? '<span class="bad">Not protected yet.</span> The browser may clear data if the computer runs low on space. Installing the app and keeping a backup folder covers you.' : 'This browser does not report storage protection.'}</p>
      ${persisted === false ? '<div class="btn-row"><button class="btn" data-action="ask-persist">Ask the browser to protect my data</button></div>' : ''}
    </section>`;
}

async function addSellerDialog() {
  const ok = await openModal({
    title: 'Add a selling site', submitButtons: [{ label: 'Add site', value: 'ok' }],
    body: `
      <label class="field"><span>Site name</span><input name="name" placeholder="Reverb" autocomplete="off"></label>
      <div class="grid2">
        <label class="field"><span>Fee (%)</span><input name="feePct" type="number" min="0" max="99.9" step="any" value="0"></label>
        <label class="field"><span>Fixed fee per sale ($)</span><input name="fixedFee" type="number" min="0" step="any" value="0"></label>
      </div>`,
    onSubmit: async (form) => { await D.addSeller(formData(form)); return 'ok'; },
  });
  if (ok === 'ok') { toast('Selling site added'); await S.render(); }
}

async function restoreFile(file) {
  let obj, info;
  try {
    obj = JSON.parse(await file.text());
    info = K.inspectBackup(obj);
  } catch (e) {
    toast(e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message, 'error', 6000);
    return;
  }
  const when = info.exportedAt ? new Date(info.exportedAt).toLocaleString('en-US') : 'unknown date';
  const go = await openModal({
    title: 'Restore this backup?',
    submitButtons: [{ label: 'Replace my data', value: 'ok', kind: 'danger' }],
    body: `
      <p class="confirm-text">This backup was made ${esc(when)} and holds ${info.radios} radio${info.radios === 1 ? '' : 's'}, ${info.parts} part${info.parts === 1 ? '' : 's'}, and ${info.photos} photo${info.photos === 1 ? '' : 's'}.</p>
      <p class="confirm-text"><strong>Everything currently in the app will be replaced.</strong></p>
      <label class="check"><input type="checkbox" name="safety" checked><span>Download a backup of my current data first</span></label>`,
    onSubmit: async (form) => {
      if (formData(form).safety) await K.downloadBackup();
      return 'ok';
    },
  });
  if (go !== 'ok') return;
  try {
    await K.importAll(obj);
    toast('Backup restored');
    location.hash = '#/radios';
    await S.render();
  } catch (e) {
    console.error(e);
    toast(`Restore failed: ${e.message}. Your data was not changed.`, 'error', 8000);
  }
}

export const actions = {
  'add-seller': () => addSellerDialog(),
  'delete-seller': async (el) => {
    const x = S.sellers.find((v) => v.id === Number(el.dataset.id));
    const v = await confirmChoice({
      title: `Remove ${x.name}?`, message: 'Its listed prices on your radios are removed too. Sales already recorded keep their fees.',
      choices: [{ label: 'Remove site', value: 'yes', kind: 'danger' }],
    });
    if (v === 'yes') { await D.deleteSeller(x.id); await S.render(); }
  },
  'choose-folder': async () => {
    try { await K.connectFolder(); toast('Backup folder connected'); } catch (e) { if (e.name !== 'AbortError') toast(`Could not use that folder: ${e.message}`, 'error', 6000); }
    await S.render();
  },
  'disconnect-folder': async () => { await K.disconnectFolder(); toast('Automatic backup turned off'); await S.render(); },
  'ask-persist': async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Storage is now protected' : 'The browser said no. Install the app and keep a backup folder.', ok ? 'ok' : 'error', 6000);
    await S.render();
  },
};

export const changes = {
  default: async (el) => {
    const v = num(el.value), key = el.dataset.key, max = key === 'cushionPct' ? 99 : key === 'taxPct' ? 100 : Infinity;
    if (el.value === '' || v < 0 || v > max) { toast('Enter a valid number.', 'error'); await S.render(); return; }
    await D.setSetting(key, v);
    toast('Default saved');
  },
  seller: async (el) => {
    const x = S.sellers.find((v) => v.id === Number(el.dataset.id));
    try {
      await D.updateSeller(x.id, { name: x.name, feePct: x.feePct, fixedFee: x.fixedFee, [el.dataset.field]: el.value });
      toast('Saved');
    } catch (e) { toast(e.message, 'error'); }
    await S.render();
  },
  'seller-active': async (el) => { await D.setSellerActive(Number(el.dataset.id), el.checked); },
  theme: async (el) => { await D.setSetting('theme', el.value); applyTheme(el.value); },
  restore: async (el) => { const f = el.files[0]; el.value = ''; if (f) await restoreFile(f); },
};
