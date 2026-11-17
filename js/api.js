/* GD LIVE STUDIO — backend client for the Google Apps Script Web App.
 * Requests are JSON, sent as text/plain to avoid a CORS pre-flight (Apps Script cannot answer OPTIONS).
 * Authentication uses an opaque server-issued session token in the request body (no cookies => no CSRF surface).
 * The server NEVER trusts role information from the client; every protected action is re-verified server-side.
 */
import { CONFIG } from './config.js';
import { ls } from './storage.js';
import { emit } from './ui.js';

export class ApiError extends Error {
  constructor(code, message, extra) { super(message); this.name = 'ApiError'; this.code = code; this.extra = extra; }
}
export const apiConfigured = () => /^https:\/\/script\.google\.com\/(macros\/s\/|a\/)/.test(CONFIG.API_URL || '');

let session = ls.get('session', null); // { token, exp }
export function getSession() { return session && session.exp > Date.now() ? session : null; }
export function setSession(s) { session = s; if (s) ls.set('session', s); else ls.del('session'); }

const metrics = { calls: 0, failures: 0, lastLatency: null, lastError: null, lastOkAt: null };
export const apiMetrics = () => ({ ...metrics });

export async function call(action, payload = {}, { auth = true, timeoutMs = 30000 } = {}) {
  if (!apiConfigured()) throw new ApiError('NOT_CONFIGURED', 'The backend is not configured yet. Set API_URL in js/config.js after deploying the Apps Script Web App.');
  if (!navigator.onLine) throw new ApiError('OFFLINE', 'You are offline. This action needs an internet connection.');
  const body = { action, payload, v: CONFIG.VERSION, rid: Math.random().toString(36).slice(2, 10) };
  if (auth && getSession()) body.session = getSession().token;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now(); metrics.calls++;
  let res;
  try {
    res = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal, redirect: 'follow' });
  } catch (e) {
    metrics.failures++; metrics.lastError = e.name === 'AbortError' ? 'timeout' : 'network';
    throw new ApiError(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', e.name === 'AbortError' ? 'The server took too long to respond. Try again.' : 'Could not reach the backend. Check your connection and that the Web App is deployed with access set to "Anyone".');
  } finally { clearTimeout(timer); }
  metrics.lastLatency = Math.round(performance.now() - t0);
  let json;
  try { json = await res.json(); } catch { metrics.failures++; metrics.lastError = 'bad_response'; throw new ApiError('BAD_RESPONSE', 'The backend returned an unexpected response. Re-deploy the Apps Script Web App and make sure the URL ends in /exec.'); }
  if (!json.ok) {
    metrics.failures++; metrics.lastError = json.error?.code || 'error';
    const err = new ApiError(json.error?.code || 'ERROR', json.error?.message || 'Request failed.', json.error);
    if (['SESSION_INVALID', 'SESSION_EXPIRED'].includes(err.code)) { setSession(null); emit('auth:expired'); }
    if (err.code === 'ACCOUNT_SUSPENDED') emit('auth:suspended');
    throw err;
  }
  metrics.lastOkAt = Date.now();
  return json.data;
}

export const api = {
  ping: () => call('ping', {}, { auth: false, timeoutMs: 15000 }),
  publicConfig: () => call('config.public', {}, { auth: false }),
  register: p => call('auth.register', p, { auth: false }),
  login: p => call('auth.login', p, { auth: false }),
  googleLogin: p => call('auth.google', p, { auth: false }),
  logout: () => call('auth.logout'),
  me: () => call('auth.me'),
  updateProfile: p => call('user.updateProfile', p),
  getPrefs: () => call('user.getPrefs'),
  savePrefs: p => call('user.savePrefs', p),
  exportData: () => call('user.export'),
  deleteAccount: p => call('user.delete', p),
  changePassword: p => call('user.changePassword', p),
  gatewayToken: () => call('stream.gatewayToken'),

  platformsList: () => call('platform.list'),
  platformUpsert: p => call('platform.upsertConnection', p),
  platformRemove: p => call('platform.removeConnection', p),

  streamStart: p => call('stream.start', p),
  streamEnd: p => call('stream.end', p),
  streamList: p => call('stream.list', p),

  schedList: () => call('schedule.list'),
  schedSave: p => call('schedule.save', p),
  schedDelete: p => call('schedule.delete', p),
  schedStatus: p => call('schedule.setStatus', p),

  recList: () => call('recording.list'),
  recSave: p => call('recording.save', p),
  recDelete: p => call('recording.delete', p),

  helpContent: () => call('content.list', {}, { auth: false }),

  admin: (sub, p = {}) => call('admin.' + sub, p)
};
