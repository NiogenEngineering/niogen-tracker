// Niogen Tracker: backup and restore.
// A backup is ONE self-contained JSON file (photos included), so restoring never
// depends on a second folder. Chrome and Edge can also mirror it to a folder you
// pick, automatically, after every change.

import { db, withoutNotify, setSetting } from './db.js';

export const BACKUP_VERSION = 1;
const TABLES = ['parts', 'radios', 'components', 'aux', 'stock', 'photos', 'photoBlobs', 'sellers', 'listings'];
const DEVICE_ONLY = new Set(['backupDirHandle', 'lastBackupAt']); // never part of a backup
const KEEP_DAYS = 14;

export const todayStamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}
function dataUrlToBlob(url) {
  const [head, b64] = String(url).split(',');
  const type = head.match(/^data:(.*?);base64$/)?.[1] ?? '';
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportAll() {
  const data = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  for (const p of data.photos) p.thumb = await blobToDataUrl(p.thumb);
  data.photoBlobs = await Promise.all(data.photoBlobs.map(async (r) => ({ id: r.id, blob: await blobToDataUrl(r.blob) })));
  data.settings = (await db.settings.toArray()).filter((r) => !DEVICE_ONLY.has(r.key));
  return { app: 'niogen-tracker', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

// Throws a readable Error if the file is not a Niogen backup. Returns counts for the confirm dialog.
export function inspectBackup(obj) {
  if (!obj || obj.app !== 'niogen-tracker' || !obj.data) throw new Error('This file is not a Niogen Tracker backup.');
  if (obj.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  for (const t of [...TABLES, 'settings']) {
    if (!Array.isArray(obj.data[t])) throw new Error(`The backup is missing its "${t}" data.`);
  }
  return {
    radios: obj.data.radios.length, parts: obj.data.parts.length, photos: obj.data.photos.length,
    exportedAt: obj.exportedAt,
  };
}

export async function importAll(obj) {
  inspectBackup(obj);
  const d = obj.data;
  // Decode photos before the transaction: awaiting non-database work inside one can end it early.
  const photos = d.photos.map((p) => ({ ...p, thumb: dataUrlToBlob(p.thumb) }));
  const photoBlobs = d.photoBlobs.map((r) => ({ id: r.id, blob: dataUrlToBlob(r.blob) }));
  await withoutNotify(() =>
    db.transaction('rw', db.tables, async () => {
      for (const t of TABLES) await db.table(t).clear();
      await db.parts.bulkAdd(d.parts);
      await db.radios.bulkAdd(d.radios);
      await db.components.bulkAdd(d.components);
      await db.aux.bulkAdd(d.aux);
      await db.stock.bulkAdd(d.stock);
      await db.photos.bulkAdd(photos);
      await db.photoBlobs.bulkAdd(photoBlobs);
      await db.sellers.bulkAdd(d.sellers);
      await db.listings.bulkAdd(d.listings);
      const keep = (await db.settings.toArray()).filter((r) => DEVICE_ONLY.has(r.key)).map((r) => r.key);
      await db.settings.filter((r) => !keep.includes(r.key)).delete();
      await db.settings.bulkPut(d.settings.filter((r) => !DEVICE_ONLY.has(r.key)));
    }),
  );
}

/* ---------- manual download ---------- */

export async function downloadBackup() {
  const json = JSON.stringify(await exportAll());
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `niogen-backup-${todayStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  await setSetting('lastBackupAt', Date.now());
}

/* ---------- Chrome / Edge folder mirror ---------- */

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;
const getHandle = async () => (await db.settings.get('backupDirHandle'))?.value ?? null;

export async function folderStatus() {
  const handle = await getHandle();
  if (!handle) return { connected: false };
  let permission = 'prompt';
  try { permission = await handle.queryPermission({ mode: 'readwrite' }); } catch { /* keep prompt */ }
  return { connected: true, name: handle.name, permission };
}

export async function connectFolder() {
  const handle = await window.showDirectoryPicker({ id: 'niogen-backups', mode: 'readwrite' });
  await setSetting('backupDirHandle', handle);
  return mirrorNow();
}

// Must be called from a click: the browser only shows the permission prompt after a user gesture.
export async function reconnectFolder() {
  const handle = await getHandle();
  if (!handle) return false;
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  return mirrorNow();
}

export const disconnectFolder = () => db.settings.delete('backupDirHandle');

export async function mirrorNow() {
  const handle = await getHandle();
  if (!handle) return false;
  if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') return false;
  const json = JSON.stringify(await exportAll());
  const file = await handle.getFileHandle(`niogen-backup-${todayStamp()}.json`, { create: true });
  const writable = await file.createWritable();
  await writable.write(json);
  await writable.close();
  // Keep the newest two weeks of daily files so a bad day can be rolled back.
  const names = [];
  for await (const [name] of handle.entries()) if (/^niogen-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name);
  names.sort().reverse();
  for (const old of names.slice(KEEP_DAYS)) await handle.removeEntry(old).catch(() => {});
  await setSetting('lastBackupAt', Date.now());
  return true;
}
