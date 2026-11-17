/* GD LIVE STUDIO — authentication, session and account management (client side).
 * All authorisation decisions are made by the backend; this module only reflects what the server says.
 */
import { CONFIG } from './config.js';
import { api, apiConfigured, setSession, getSession, ApiError } from './api.js';
import { state, mergePublicConfig } from './state.js';
import { setNamespace, deleteAllLocalData } from './storage.js';
import { emit, $, esc, toast } from './ui.js';
import { loadGIS, googleConfigured, forgetAllTokens } from './gis.js';
import { derivePw } from './crypto.js';

export function currentUser() { return state.user; }

function applyUser(u) {
  state.user = u || null;
  setNamespace(u ? u.id : 'guest');
  emit('auth:changed', u);
}

/** Called once at startup. Restores a valid session if there is one; otherwise stays in guest mode. */
export async function initAuth() {
  if (!apiConfigured()) { state.backend = 'not_configured'; applyUser(null); return; }
  try {
    const cfg = await api.publicConfig();
    mergePublicConfig(cfg); state.backend = 'ok';
  } catch (e) { state.backend = e.code === 'OFFLINE' ? 'unknown' : 'error'; }
  if (getSession()) {
    try { applyUser(await api.me()); }
    catch (e) { if (!(e instanceof ApiError) || ['NETWORK', 'OFFLINE', 'TIMEOUT'].includes(e.code)) applyUser(null); else applyUser(null); }
  } else applyUser(null);
}

function handleAuthResult(res) {
  if (res.session) setSession({ token: res.session.token, exp: new Date(res.session.expiresAt).getTime() });
  if (res.user && res.user.status === 'Active') { applyUser(res.user); return 'active'; }
  return res.user?.status || 'unknown';
}

export async function logout() {
  try { await api.logout(); } catch { /* server session may already be gone */ }
  setSession(null); forgetAllTokens(); applyUser(null);
}

/** Password accounts pass their password (derived here); Google accounts pass the literal confirmation "DELETE". */
export async function removeAccount(secret) {
  const u = state.user; const pw = u?.authProvider === 'google' ? secret : await derivePw(secret || '', u?.email || '');
  await api.deleteAccount({ pw });
  setSession(null); forgetAllTokens();
  await deleteAllLocalData().catch(() => {});
  applyUser(null);
}

/* ---------- Login page wiring ---------- */
export function mountLogin(root, { onDone }) {
  const msg = $('#login-msg', root);
  const setMsg = (text, type = 'err') => { msg.className = 'notice ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : 'warn'); msg.textContent = text; msg.hidden = !text; };
  const tabs = root.querySelectorAll('[data-tab]');
  const panels = { login: $('#form-login', root), register: $('#form-register', root) };
  const showTab = name => { tabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.tab === name))); Object.entries(panels).forEach(([k, p]) => (p.hidden = k !== name)); setMsg(''); };
  tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  showTab('login');

  if (!apiConfigured()) { setMsg('Backend not configured: accounts are unavailable in Local mode. You can still use the camera and recording tools as a guest.', 'warn'); }
  if (state.config.registrationOpen === false) { tabs.forEach(t => { if (t.dataset.tab === 'register') t.hidden = true; }); }

  const finish = status => {
    if (status === 'active') { toast('Signed in', 'ok'); onDone(); }
    else if (status === 'Pending') setMsg('Your account was created and is waiting for approval by the GD TECH ACADEMY owner. You will be able to sign in once it is approved.', 'warn');
    else if (status === 'Suspended') setMsg('This account is suspended. Contact GD TECH ACADEMY for help.');
    else setMsg('Could not complete sign-in.');
  };
  const guard = fn => async e => {
    e?.preventDefault(); setMsg('');
    const btn = e?.submitter; if (btn) btn.disabled = true;
    try { await fn(e); } catch (err) { setMsg(err.message || 'Something went wrong.'); }
    finally { if (btn) btn.disabled = false; }
  };

  panels.login.addEventListener('submit', guard(async () => {
    const f = new FormData(panels.login);
    const email = String(f.get('email')).trim().toLowerCase();
    finish(handleAuthResult(await api.login({ email, pw: await derivePw(f.get('password'), email) })));
  }));

  panels.register.addEventListener('submit', guard(async () => {
    const f = new FormData(panels.register);
    const ageGroup = f.get('ageGroup');
    if (ageGroup === 'under13') throw new Error('You must be at least 13 years old to create an account. Platform rules also apply to live streaming.');
    if (!f.get('consent')) throw new Error('Please accept the privacy notice to register.');
    if (ageGroup === '13-17' && !f.get('guardian')) throw new Error('A parent or guardian must consent for users aged 13–17.');
    if (String(f.get('password')).length < 10) throw new Error('Use a password with at least 10 characters.');
    if (f.get('password') !== f.get('password2')) throw new Error('The two passwords do not match.');
    const email = String(f.get('email')).trim().toLowerCase();
    finish(handleAuthResult(await api.register({
      email, pw: await derivePw(f.get('password'), email), displayName: f.get('name'),
      ageGroup, parentalConsent: !!f.get('guardian'), privacyConsent: true, consentVersion: '1'
    })));
  }));

  /* Google Sign-In */
  const gbox = $('#g-btn', root);
  if (googleConfigured() && apiConfigured()) {
    loadGIS().then(() => {
      google.accounts.id.initialize({
        client_id: CONFIG.GOOGLE_CLIENT_ID, ux_mode: 'popup', auto_select: false,
        callback: async resp => {
          setMsg('');
          try { finish(handleAuthResult(await api.googleLogin({ idToken: resp.credential }))); }
          catch (err) {
            if (err.code === 'NEEDS_REGISTRATION') askConsent(resp.credential);
            else setMsg(err.message);
          }
        }
      });
      google.accounts.id.renderButton(gbox, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(320, gbox.clientWidth || 320) });
    }).catch(e => { gbox.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; });
  } else {
    gbox.innerHTML = `<p class="muted small">Google sign-in needs GOOGLE_CLIENT_ID in js/config.js and a deployed backend.</p>`;
  }

  async function askConsent(idToken) {
    const panel = $('#consent-panel', root); panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const form = $('form', panel);
    form.onsubmit = guard(async () => {
      const f = new FormData(form); const ageGroup = f.get('ageGroup');
      if (ageGroup === 'under13') throw new Error('You must be at least 13 years old to create an account.');
      if (!f.get('consent')) throw new Error('Please accept the privacy notice.');
      if (ageGroup === '13-17' && !f.get('guardian')) throw new Error('A parent or guardian must consent for users aged 13–17.');
      finish(handleAuthResult(await api.googleLogin({ idToken, ageGroup, parentalConsent: !!f.get('guardian'), privacyConsent: true, consentVersion: '1' })));
    });
  }
}
