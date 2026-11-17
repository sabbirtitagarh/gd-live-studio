/* GD LIVE STUDIO — application shell: router, navigation, status bars, PWA install/update, permanent branding guard. */
import { CONFIG, ROUTES_NAV } from './config.js';
import { $, $$, h, esc, icon, toast, modal, on, emit } from './ui.js';
import { state, isAdmin, isUser, feature, role } from './state.js';
import { initTheme, setTheme, currentTheme } from './theme.js';
import { initAuth } from './auth.js';
import { apiConfigured, getSession } from './api.js';
import { setNamespace, kvGet, requestPersist } from './storage.js';
import { cam } from './camera.js';
import { compositor } from './overlays.js';
import { recorder } from './recording.js';
import { broadcast } from './streaming.js';
import { loadPlatformState } from './platforms.js';
import { mountCamera, mountRecord, mountGoLive, mountStudio, mountOverlays } from './views-core.js';
import { mountDashboard, mountPlatforms, mountRecordings, mountHistory, mountDevices, mountStorage, mountHelp, mountProfile, mountAbout, mountLoginPage } from './views-misc.js';
import { mountSchedule } from './scheduler.js';
import { mountDiagnostics } from './diagnostics.js';
import { mountAdmin } from './admin.js';

/* access: 'open' (everyone) | 'user' (signed in; open in Local mode) | 'admin' */
const ROUTES = {
  '/login':       { file: 'login',       mount: mountLoginPage, access: 'open', nav: false },
  '/dashboard':   { file: 'dashboard',   mount: mountDashboard, access: 'guest' },
  '/go-live':     { file: 'golive',      mount: mountGoLive,    access: 'user' },
  '/studio':      { file: 'studio',      mount: mountStudio,    access: 'user' },
  '/camera':      { file: 'camera',      mount: mountCamera,    access: 'guest', feature: 'camera_studio' },
  '/record':      { file: 'record',      mount: mountRecord,    access: 'guest', feature: 'recording' },
  '/platforms':   { file: 'platforms',   mount: mountPlatforms, access: 'user' },
  '/schedule':    { file: 'schedule',    mount: mountSchedule,  access: 'user', feature: 'scheduler' },
  '/overlays':    { file: 'overlays',    mount: mountOverlays,  access: 'guest', feature: 'overlays' },
  '/recordings':  { file: 'recordings',  mount: mountRecordings, access: 'guest' },
  '/history':     { file: 'history',     mount: mountHistory,   access: 'user' },
  '/devices':     { file: 'devices',     mount: mountDevices,   access: 'guest' },
  '/storage':     { file: 'storage',     mount: mountStorage,   access: 'guest' },
  '/diagnostics': { file: 'diagnostics', mount: mountDiagnostics, access: 'open' },
  '/help':        { file: 'help',        mount: mountHelp,      access: 'open' },
  '/profile':     { file: 'profile',     mount: mountProfile,   access: 'guest' },
  '/about':       { file: 'about',       mount: mountAbout,     access: 'open' },
  '/admin':       { file: 'admin',       mount: mountAdmin,     access: 'admin' }
};

let cleanup = null; let navToken = 0; let deferredInstall = null;
const view = () => $('#view');
const parseHash = () => { const raw = location.hash.replace(/^#/, '') || '/dashboard'; const [path, q] = raw.split('?'); return { path: path || '/dashboard', query: new URLSearchParams(q || '') }; };

/* ---------- icons in fragments ---------- */
function hydrateIcons(root) { $$('[data-icon]', root).forEach(el => { el.outerHTML = icon(el.dataset.icon); }); }

/* ---------- navigation chrome ---------- */
function visibleNav() { return ROUTES_NAV.filter(r => !r.admin || isAdmin()); }
function buildNav() {
  const cur = parseHash().path; const items = visibleNav();
  const groups = { main: 'Studio', library: 'Library', system: 'System', admin: 'Owner' };
  const side = $('#sidebar-nav'); side.innerHTML = ''; let last = '';
  for (const r of items) { if (r.group !== last) { side.append(h('div', { class: 'sep' }, groups[r.group] || '')); last = r.group; }
    side.append(h('a', { href: '#' + r.path, 'aria-current': r.path === cur ? 'page' : null, html: icon(r.icon) + '<span>' + esc(r.label) + '</span>' })); }
  const bn = $('#bottom-nav'); bn.innerHTML = '';
  const tab = (path, label, ic, cls = '') => h('a', { href: '#' + path, class: cls, 'aria-current': path === cur ? 'page' : null, html: cls === 'go' ? `<span class="dot">${icon(ic)}</span><span>${label}</span>` : icon(ic) + `<span>${label}</span>` });
  bn.append(tab('/dashboard', 'Home', 'home'), tab('/camera', 'Camera', 'camera'), tab('/go-live', 'Go Live', 'radio', 'go'), tab('/record', 'Record', 'circle'),
    h('button', { type: 'button', 'aria-label': 'More', html: icon('grid') + '<span>More</span>', onclick: openMore }));
}
function openMore() {
  const grid = h('div', { class: 'more-grid' }, ...visibleNav().map(r => h('a', { href: '#' + r.path, html: icon(r.icon) + '<span>' + esc(r.label) + '</span>', onclick: () => modal.last?.close(null) })));
  modal({ title: 'All sections', body: grid, actions: [{ label: 'Close', class: 'soft', value: true }] });
}
function paintHeader() {
  const u = state.user; const box = $('#header-user'); box.innerHTML = '';
  if (u) { const a = h('a', { href: '#/profile', class: 'avatar', 'aria-label': 'Profile: ' + u.name, style: 'width:36px;height:36px' }); if (u.avatar && /^https:\/\//.test(u.avatar)) a.append(h('img', { src: u.avatar, alt: '', referrerpolicy: 'no-referrer' })); else a.textContent = (u.name || '?')[0].toUpperCase(); box.append(a); }
  else box.append(h('a', { href: '#/login', class: 'btn sm accent' }, 'Sign in'));
  $('#btn-theme').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  buildNav();
}
function paintStatusBars() {
  const bars = $('#status-bars'); bars.innerHTML = '';
  if (!state.online) bars.append(h('div', { class: 'status-bar offline', role: 'status' }, 'You are offline. Camera and recording still work; sign-in, sync and broadcasting need internet.'));
  if (state.config.maintenance && !isAdmin()) bars.append(h('div', { class: 'status-bar maint', role: 'status' }, state.config.maintenanceMessage || 'GD LIVE STUDIO is in maintenance mode.'));
  if (!apiConfigured()) bars.append(h('div', { class: 'status-bar local', role: 'status' }, 'Local mode — backend not configured. Camera, recording and overlays work; accounts, scheduling sync and the admin panel need the Apps Script backend.'));
  else if (state.backend === 'error') bars.append(h('div', { class: 'status-bar offline', role: 'status' }, 'Cannot reach the backend right now. Local features still work.'));
}
function paintChips() {
  const on = state.online; const c1 = $('#chip-net'); c1.className = 'chip ' + (on ? 'ok' : 'bad'); $('span', c1).textContent = on ? 'Online' : 'Offline';
  const rs = recorder.state; const cr = $('#chip-rec'); cr.hidden = !(rs === 'recording' || rs === 'paused'); $('span', cr).textContent = rs === 'paused' ? 'PAUSED' : 'REC';
  const live = broadcast.status === 'broadcasting'; const cl = $('#chip-live'); cl.hidden = !live;
}

/* ---------- permanent branding (users cannot remove it from the UI) ---------- */
function ensureBranding() {
  let f = $('#app-footer');
  const html = `<span class="logo-tile"><img src="${CONFIG.LOGO_MARK}" alt="GD TECH ACADEMY"></span><b>Powered by GD TECH ACADEMY</b><span aria-hidden="true">·</span><a href="${CONFIG.WEBSITE}" target="_blank" rel="noopener noreferrer">gyaankadabba.blogspot.com</a>`;
  if (!f) { f = h('footer', { id: 'app-footer', class: 'app-footer' }); document.body.append(f); }
  if (!/Powered by GD TECH ACADEMY/.test(f.textContent) || !$('a', f)) f.innerHTML = html;
  Object.assign(f.style, { display: 'flex', visibility: 'visible', opacity: '1' }); f.hidden = false;
}
new MutationObserver(ensureBranding).observe(document.body, { childList: true });
setInterval(ensureBranding, 4000);

/* ---------- router ---------- */
function gate(route) {
  if (route.access === 'admin') return isAdmin() ? null : (state.user ? 'forbidden' : 'login');
  if (state.config.maintenance && !isAdmin() && !['open'].includes(route.access)) return 'maintenance';
  if (route.access === 'user') { if (!apiConfigured()) return null; return isUser() ? null : 'login'; }
  if (route.access === 'guest' && !state.user && state.config.guestAccess === false && apiConfigured()) return 'login';
  if (route.feature && !feature(route.feature) && !isAdmin()) return 'feature';
  return null;
}
function blocked(kind, route) {
  const msgs = {
    login: ['Sign in required', 'This area needs an account. Guests can use the camera preview, device tests and local recording.', '<a class="btn accent" href="#/login">Sign in or create account</a> <a class="btn ghost" href="#/camera">Continue as guest</a>'],
    forbidden: ['Not authorised', 'This area is for the GD TECH ACADEMY owner only.', '<a class="btn soft" href="#/dashboard">Back to dashboard</a>'],
    maintenance: ['Maintenance in progress', state.config.maintenanceMessage || 'GD LIVE STUDIO is temporarily unavailable.', '<a class="btn soft" href="#/about">About</a>'],
    feature: ['Feature unavailable', 'The owner has turned this feature off.', '<a class="btn soft" href="#/dashboard">Back to dashboard</a>']
  }[kind];
  view().innerHTML = `<section class="page"><div class="card center" style="padding:28px"><h1>${esc(msgs[0])}</h1><p class="muted">${esc(msgs[1])}</p><div class="row" style="justify-content:center">${msgs[2]}</div></div></section>`;
}
async function render() {
  const token = ++navToken; const { path } = parseHash();
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } } cleanup = null;
  const route = ROUTES[path] || ROUTES['/dashboard'];
  if (!ROUTES[path]) { location.replace('#/dashboard'); return; }
  buildNav(); paintStatusBars(); window.scrollTo(0, 0);
  if (path === '/login' && state.user) { location.replace('#/dashboard'); return; }
  const g = gate(route); if (g) { blocked(g, route); return; }
  const v = view(); v.innerHTML = '<div class="empty" style="margin:30px 0">Loading…</div>';
  try {
    const res = await fetch(`pages/${route.file}.html`, { cache: 'no-cache' }); if (!res.ok) throw new Error('Page file missing (' + res.status + ')');
    const html = await res.text(); if (token !== navToken) return;
    v.innerHTML = html; hydrateIcons(v); document.title = (ROUTES_NAV.find(r => r.path === path)?.label || (path === '/login' ? 'Sign in' : 'GD LIVE STUDIO')) + ' · GD LIVE STUDIO';
    const page = v.firstElementChild; const c = await route.mount(page); if (token !== navToken) { if (typeof c === 'function') c(); return; } cleanup = c; $('#app-main').focus({ preventScroll: true });
  } catch (e) {
    if (token !== navToken) return;
    v.innerHTML = `<section class="page"><div class="notice err"><strong>This page could not be displayed</strong>${esc(e.message)}${navigator.onLine ? '' : ' You are offline and this page has not been cached yet.'}<br><button class="btn soft sm mt" id="reload-btn" type="button">Reload</button></div></section>`;
    $('#reload-btn', v).addEventListener('click', () => location.reload());
    console.error(e);
  }
}

/* ---------- PWA: install + update ---------- */
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function setupInstall() {
  const btn = $('#btn-install');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (!isStandalone()) btn.hidden = false; });
  window.addEventListener('appinstalled', () => { btn.hidden = true; deferredInstall = null; toast('GD LIVE STUDIO installed', 'ok'); });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone(); if (ios) btn.hidden = false;
  btn.onclick = async () => {
    if (deferredInstall) { deferredInstall.prompt(); const r = await deferredInstall.userChoice; deferredInstall = null; if (r.outcome === 'accepted') btn.hidden = true; }
    else modal({ title: 'Install on iPhone / iPad', body: h('div', { html: '<ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>.</li></ol><p class="muted small">Safari limits some camera and recording features compared with Chrome.</p>' }), actions: [{ label: 'OK', class: 'accent', value: true }] });
  };
}
async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('service-worker.js'); let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) return; refreshing = true; location.reload(); });
    const offer = worker => { const bars = $('#update-bar'); bars.hidden = false; $('#update-btn').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' }); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  } catch (e) { console.warn('Service worker registration failed', e); }
}

/* ---------- boot ---------- */
async function boot() {
  initTheme(); ensureBranding(); setupInstall();
  $('#btn-theme').onclick = () => { const dark = document.documentElement.dataset.theme === 'dark'; setTheme(dark ? 'light' : 'dark'); paintHeader(); };
  window.addEventListener('online', () => { state.online = true; paintChips(); paintStatusBars(); toast('Back online', 'ok'); });
  window.addEventListener('offline', () => { state.online = false; paintChips(); paintStatusBars(); toast('You are offline', 'err'); });
  on('auth:changed', () => { paintHeader(); paintStatusBars(); });
  on('auth:expired', () => { toast('Your session expired. Please sign in again.', 'err'); location.hash = '#/login'; });
  on('auth:suspended', () => { toast('This account is suspended.', 'err'); location.hash = '#/login'; });
  on('broadcast:update', paintChips); on('rec:state', paintChips); on('rec:tick', () => {});
  window.addEventListener('hashchange', render);
  try { await initAuth(); } catch (e) { console.warn(e); }
  try { await compositor.load(); await loadPlatformState(); } catch (e) { console.warn('Local init', e); }
  paintHeader(); paintStatusBars(); paintChips();
  const sp = $('#splash'); await render();
  setTimeout(() => { sp.classList.add('done'); setTimeout(() => sp.remove(), 500); }, 350);
  setupServiceWorker(); requestPersist().catch(() => {});
}
boot().catch(e => { console.error(e); const sp = $('#splash'); if (sp) { $('p', sp).textContent = 'Startup failed: ' + e.message; $('.spinner', sp)?.remove(); } });
