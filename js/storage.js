/* GD LIVE STUDIO — local storage layer.
 *  - IndexedDB: presets, overlay settings, destinations, recordings (blobs + metadata), history, activity.
 *  - localStorage: non-sensitive preferences only (theme, last route, etc.).
 *  - Optional Google Drive (drive.file scope, user-authorised, per-upload consent).
 * Browser storage is NOT a permanent backup: clearing site data or uninstalling the app can delete it.
 */
import { getAccessToken, hasToken, revokeToken } from './gis.js';
import { uid } from './ui.js';

const DB_NAME = 'gd-live-studio';
const DB_VERSION = 1;
let dbp = null;
let ns = 'guest'; // namespace: user id or 'guest'

export function setNamespace(n) { ns = n || 'guest'; }
export function getNamespace() { return ns; }

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not available in this browser.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('recordings')) { const s = db.createObjectStore('recordings', { keyPath: 'id' }); s.createIndex('ns', 'ns'); }
      if (!db.objectStoreNames.contains('history')) { const s = db.createObjectStore('history', { keyPath: 'id' }); s.createIndex('ns', 'ns'); }
      if (!db.objectStoreNames.contains('activity')) { const s = db.createObjectStore('activity', { keyPath: 'id' }); s.createIndex('ns', 'ns'); }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error || new Error('Could not open local database.')); };
    req.onblocked = () => reject(new Error('Local database is blocked by another tab. Close other GD LIVE STUDIO tabs.'));
  });
  return dbp;
}
function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store);
    let out; try { out = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('Local storage transaction aborted (storage full?).'));
  }));
}
const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* ---------- key/value (presets, overlays, destinations, settings) ---------- */
const k = key => `${ns}:${key}`;
export async function kvGet(key, def = null) {
  const db = await openDB();
  const v = await req2p(db.transaction('kv').objectStore('kv').get(k(key)));
  return v === undefined ? def : v;
}
export async function kvSet(key, value) { await tx('kv', 'readwrite', s => s.put(value, k(key))); }
export async function kvDel(key) { await tx('kv', 'readwrite', s => s.delete(k(key))); }
export async function kvKeys(prefix = '') {
  const db = await openDB();
  const keys = await req2p(db.transaction('kv').objectStore('kv').getAllKeys());
  return keys.filter(x => x.startsWith(k(prefix))).map(x => x.slice(ns.length + 1));
}

/* ---------- localStorage (non-sensitive prefs) ---------- */
export const ls = {
  get(key, def = null) { try { const v = localStorage.getItem('gdls.' + key); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(key, val) { try { localStorage.setItem('gdls.' + key, JSON.stringify(val)); return true; } catch { return false; } },
  del(key) { try { localStorage.removeItem('gdls.' + key); } catch { /* ignore */ } }
};

/* ---------- recordings ---------- */
export async function saveRecording(meta, blob) {
  const rec = { id: meta.id || uid('rec'), ns, createdAt: new Date().toISOString(), ...meta, size: blob.size, blob };
  await tx('recordings', 'readwrite', s => s.put(rec));
  return rec;
}
export async function listRecordings() {
  const db = await openDB();
  const all = await req2p(db.transaction('recordings').objectStore('recordings').index('ns').getAll(ns));
  return all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export async function getRecording(id) {
  const db = await openDB();
  const r = await req2p(db.transaction('recordings').objectStore('recordings').get(id));
  return r && r.ns === ns ? r : null;
}
export async function updateRecording(id, patch) {
  const r = await getRecording(id); if (!r) return null;
  Object.assign(r, patch); await tx('recordings', 'readwrite', s => s.put(r)); return r;
}
export async function deleteRecording(id) {
  const r = await getRecording(id); if (!r) return;
  await tx('recordings', 'readwrite', s => s.delete(id));
}

/* ---------- history & activity ---------- */
export async function addHistory(entry) {
  const rec = { id: entry.id || uid('hist'), ns, at: new Date().toISOString(), ...entry };
  await tx('history', 'readwrite', s => s.put(rec)); return rec;
}
export async function updateHistory(id, patch) {
  const db = await openDB();
  const r = await req2p(db.transaction('history').objectStore('history').get(id));
  if (!r || r.ns !== ns) return null; Object.assign(r, patch);
  await tx('history', 'readwrite', s => s.put(r)); return r;
}
export async function listHistory(limit = 100) {
  const db = await openDB();
  const all = await req2p(db.transaction('history').objectStore('history').index('ns').getAll(ns));
  return all.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
}
export async function deleteHistory(id) { await tx('history', 'readwrite', s => s.delete(id)); }

export async function logActivity(text, type = 'info') {
  const rec = { id: uid('act'), ns, at: new Date().toISOString(), text, type };
  try {
    await tx('activity', 'readwrite', s => s.put(rec));
    const all = await listActivity(500);
    if (all.length > 200) for (const a of all.slice(200)) await tx('activity', 'readwrite', s => s.delete(a.id));
  } catch { /* activity log is best-effort */ }
  return rec;
}
export async function listActivity(limit = 20) {
  const db = await openDB();
  const all = await req2p(db.transaction('activity').objectStore('activity').index('ns').getAll(ns));
  return all.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
}

/* ---------- housekeeping ---------- */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0, free: Math.max(0, (e.quota || 0) - (e.usage || 0)) }; } catch { return null; }
}
export async function persistStatus() {
  if (!navigator.storage?.persisted) return null;
  try { return await navigator.storage.persisted(); } catch { return null; }
}
export async function requestPersist() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}
export async function localSummary() {
  const recs = await listRecordings();
  const keys = await kvKeys('');
  const presets = (await kvGet('presets', [])).length;
  return {
    recordings: recs.length,
    recordingBytes: recs.reduce((a, r) => a + (r.size || 0), 0),
    kvItems: keys.length,
    presets,
    history: (await listHistory(1000)).length
  };
}
/** Delete ALL local data for the current namespace (recordings, presets, overlays, history, activity, settings). */
export async function deleteAllLocalData() {
  const db = await openDB();
  const wipe = (store, indexed) => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite'); const s = t.objectStore(store);
    if (indexed) {
      const c = s.index('ns').openKeyCursor(IDBKeyRange.only(ns));
      c.onsuccess = () => { const cur = c.result; if (cur) { s.delete(cur.primaryKey); cur.continue(); } };
    } else {
      const c = s.openKeyCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { if (String(cur.key).startsWith(ns + ':')) s.delete(cur.key); cur.continue(); } };
    }
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
  await wipe('recordings', true); await wipe('history', true); await wipe('activity', true); await wipe('kv', false);
}
export async function exportLocalData() {
  const keys = await kvKeys('');
  const kv = {}; for (const key of keys) { if (key.startsWith('secret:')) continue; kv[key] = await kvGet(key); } // never export stream keys
  const recs = (await listRecordings()).map(({ blob, ...m }) => m);
  return { exportedAt: new Date().toISOString(), namespace: ns, settings: kv, recordings: recs, history: await listHistory(1000), activity: await listActivity(200) };
}

/* ---------- Google Drive (optional, user-authorised, drive.file scope only) ---------- */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const driveConnected = () => hasToken(DRIVE_SCOPE);
export async function connectDrive() { return getAccessToken(DRIVE_SCOPE); }
export function disconnectDrive() { revokeToken(DRIVE_SCOPE); }

async function driveFetch(url, opts = {}) {
  const token = await getAccessToken(DRIVE_SCOPE);
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    let msg = res.statusText; try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
    throw new Error(`Google Drive error ${res.status}: ${msg}`);
  }
  return res;
}
async function ensureDriveFolder() {
  const cached = await kvGet('driveFolderId', null);
  if (cached) {
    try { const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed`); const j = await r.json(); if (!j.trashed) return cached; } catch { /* recreate */ }
  }
  const r = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'GD LIVE STUDIO Recordings', mimeType: 'application/vnd.google-apps.folder' })
  });
  const j = await r.json(); await kvSet('driveFolderId', j.id); return j.id;
}
/** Upload a Blob to the user's own Drive (resumable upload). Caller MUST have obtained explicit consent first. */
export async function uploadToDrive(blob, name, onProgress) {
  const folder = await ensureDriveFolder();
  const init = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'video/webm', 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify({ name, parents: [folder] })
  });
  const loc = init.headers.get('Location');
  if (!loc) throw new Error('Google Drive did not return an upload location.');
  const token = await getAccessToken(DRIVE_SCOPE);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', loc); x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300) ? resolve(JSON.parse(x.responseText)) : reject(new Error('Drive upload failed (' + x.status + ').'));
    x.onerror = () => reject(new Error('Network error during Drive upload.'));
    x.send(blob);
  });
}
