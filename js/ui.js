/* GD LIVE STUDIO — small UI helpers: DOM, escaping, icons, toasts, modals, formatting. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escape any untrusted string before inserting into HTML (output escaping). */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}

/** Create an element safely. Children that are strings become text nodes (never HTML). */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // only for trusted, already-escaped markup
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---------- Icons (24x24, stroke based) ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 010 8.4M7.8 16.2a6 6 0 010-8.4M19.1 4.9a10 10 0 010 14.2M4.9 19.1a10 10 0 010-14.2"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  'camera-off': '<path d="M1 1l22 22"/><path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m4-3h5l2 3h4a2 2 0 012 2v9.3"/><path d="M9.5 9.5a4 4 0 005 5"/>',
  circle: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 01-12 0z"/><path d="M12 18v4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  palette: '<path d="M12 22a10 10 0 110-20c5.5 0 10 3.6 10 8 0 3-2.5 4-4.5 4H15a2 2 0 00-1.4 3.4c.8.9.4 4.6-1.6 4.6z"/><circle cx="7.5" cy="11" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="16.5" cy="10" r="1"/>',
  film: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 12h20M2 7.5h5M17 7.5h5M2 16.5h5M17 16.5h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  drive: '<path d="M22 12H2"/><path d="M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z"/><path d="M6 16h.01M10 16h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 01-14 0v-1M12 18v4M8 22h8"/>',
  'mic-off': '<path d="M1 1l22 22"/><path d="M9 9v2a3 3 0 005.1 2.1M15 9.3V5a3 3 0 00-5.9-.7"/><path d="M19 10v1a7 7 0 01-.9 3.4M5 10v1a7 7 0 0011.4 5.4M12 18v4M8 22h8"/>',
  flip: '<path d="M20 7H8a4 4 0 00-4 4v1"/><path d="M17 4l3 3-3 3"/><path d="M4 17h12a4 4 0 004-4v-1"/><path d="M7 20l-3-3 3-3"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15"/>',
  maximize: '<path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M16 21h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/>',
  play: '<path d="M6 4l14 8-14 8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>',
  wifi: '<path d="M5 12.6a10 10 0 0114 0M1.4 9a15 15 0 0121.2 0M8.5 16.1a6 6 0 017 0M12 20h.01"/>',
  'wifi-off': '<path d="M1 1l22 22M16.7 11.1A10 10 0 0119 12.6M5 12.6a10 10 0 015.2-2.8M10.7 5.1A15 15 0 0122.6 9M1.4 9a15 15 0 014.7-2.9M8.5 16.1a6 6 0 017 0M12 20h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
};
export function icon(name, cls = 'ico') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}
export function iconEl(name, cls = 'ico') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls).trim();
  return t.content.firstChild;
}

/* ---------- Platform glyphs (simplified marks used only to identify the integration) ---------- */
export const PLATFORM_GLYPHS = {
  youtube: '<svg viewBox="0 0 24 24"><rect x="1.5" y="5" width="21" height="14" rx="4" fill="#FF0033"/><path d="M10 9l5 3-5 3z" fill="#fff"/></svg>',
  facebook: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="#1877F2"/><path d="M13.4 20v-6.6h2.2l.4-2.6h-2.6V9.2c0-.8.3-1.3 1.4-1.3H16V5.6c-.3 0-1.1-.1-2-.1-2 0-3.4 1.2-3.4 3.4v1.9H8.4v2.6h2.2V20z" fill="#fff"/></svg>',
  instagram: '<svg viewBox="0 0 24 24"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".5" stop-color="#D62976"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#igg)"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="17.2" cy="6.8" r="1.2" fill="#fff"/></svg>',
  rtmp: '<svg viewBox="0 0 24 24" fill="none" stroke="#08C5AA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 010 8.4M7.8 16.2a6 6 0 010-8.4"/></svg>',
  whip: '<svg viewBox="0 0 24 24" fill="none" stroke="#07347F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M14 6l6 6-6 6"/></svg>'
};
export function platformGlyph(id) { return PLATFORM_GLYPHS[id] || PLATFORM_GLYPHS.rtmp; }

/* ---------- Status badge ---------- */
export const STATUS_LABELS = ['Connected', 'Disconnected', 'Testing', 'Ready', 'Recording', 'Broadcasting', 'Error'];
export function badge(status, label) {
  const cls = String(status || '').toLowerCase().replace(/[^a-z]/g, '');
  return `<span class="badge ${esc(cls)}">${esc(label || status)}</span>`;
}

/* ---------- Toasts ---------- */
export function toast(message, type = '', opts = {}) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div', { class: `toast ${type}`, role: type === 'err' ? 'alert' : 'status' }, h('span', {}, message));
  if (opts.action) t.append(h('button', { type: 'button', onclick: () => { opts.action.run(); t.remove(); } }, opts.action.label));
  host.append(t);
  if (!opts.sticky) setTimeout(() => t.remove(), opts.ms || (type === 'err' ? 7000 : 3800));
  return t;
}

/* ---------- Modal ---------- */
export function modal({ title, body, actions = [], dismissable = true }) {
  return new Promise(resolve => {
    const bd = h('div', { class: 'modal-backdrop', role: 'presentation' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    box.append(h('h2', {}, title));
    if (typeof body === 'string') box.append(h('div', { html: body })); // callers pass escaped markup only
    else if (body) box.append(body);
    const bar = h('div', { class: 'actions' });
    const close = v => { bd.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape' && dismissable) close(null); };
    for (const a of actions) bar.append(h('button', { type: 'button', class: `btn ${a.class || ''}`, onclick: () => close(a.value) }, a.label));
    box.append(bar); bd.append(box);
    bd.addEventListener('click', e => { if (e.target === bd && dismissable) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(bd);
    const first = box.querySelector('input,select,textarea,button.btn');
    if (first) first.focus();
    modal.last = { close };
  });
}
export async function confirmDialog(title, message, okLabel = 'Confirm', danger = false) {
  const r = await modal({
    title, body: h('p', {}, message),
    actions: [{ label: 'Cancel', class: 'ghost', value: false }, { label: okLabel, class: danger ? 'danger' : 'accent', value: true }]
  });
  return r === true;
}

/* ---------- Formatting ---------- */
export function fmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; n = Number(n);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (hh ? String(hh).padStart(2, '0') + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}
export function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return '—';
  return d.toLocaleString([], withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}
export function relTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago';
}
export function uid(prefix = 'id') {
  const a = new Uint8Array(8); crypto.getRandomValues(a);
  return prefix + '_' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename }); document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
export function safeFilename(s) { return String(s || 'gd-live-studio').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80); }
export function setText(root, sel, v) { const el = typeof sel === 'string' ? $(sel, root) : sel; if (el) el.textContent = v; }

/** Tiny event bus used between modules. */
export const bus = new EventTarget();
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) { const h2 = e => fn(e.detail, e); bus.addEventListener(name, h2); return () => bus.removeEventListener(name, h2); }
