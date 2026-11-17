/* GD LIVE STUDIO — Google Identity Services helper.
 * Access tokens obtained here live ONLY in memory (never localStorage, never sent to the backend, never logged).
 */
import { CONFIG } from './config.js';

const loaders = new Map();
export function loadScript(src) {
  if (loaders.has(src)) return loaders.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { loaders.delete(src); reject(new Error('Could not load ' + new URL(src).hostname + '. Check your internet connection or ad-blocker.')); };
    document.head.append(s);
  });
  loaders.set(src, p);
  return p;
}

export const googleConfigured = () => !!CONFIG.GOOGLE_CLIENT_ID;
export async function loadGIS() {
  if (!googleConfigured()) throw new Error('Google sign-in is not configured. The owner must set GOOGLE_CLIENT_ID in js/config.js.');
  await loadScript('https://accounts.google.com/gsi/client');
  if (!window.google?.accounts) throw new Error('Google Identity Services failed to initialise.');
}

const tokens = new Map(); // scope -> { token, exp }
export function hasToken(scope) {
  const t = tokens.get(scope); return !!(t && t.exp - 60000 > Date.now());
}
export function peekToken(scope) { return hasToken(scope) ? tokens.get(scope).token : null; }

/** Request an OAuth access token. MUST be called from a user gesture (click) the first time. */
export async function getAccessToken(scope, { forcePrompt = false } = {}) {
  if (!forcePrompt && hasToken(scope)) return tokens.get(scope).token;
  await loadGIS();
  return new Promise((resolve, reject) => {
    // OAuth `state`: a random nonce that Google echoes back. A response with a different state is rejected (CSRF / replay protection).
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope,
      state: nonce,
      callback: resp => {
        if (resp.error) return reject(new Error(describeOAuthError(resp.error, resp.error_description)));
        if (resp.state !== nonce) return reject(new Error('The Google authorisation response could not be verified (state mismatch). Please try again.'));
        tokens.set(scope, { token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
        resolve(resp.access_token);
      },
      error_callback: err => reject(new Error(describeOAuthError(err?.type || 'popup_failed')))
    });
    client.requestAccessToken({ prompt: forcePrompt || !tokens.has(scope) ? 'consent' : '' });
  });
}

export function revokeToken(scope) {
  const t = tokens.get(scope);
  tokens.delete(scope);
  if (t && window.google?.accounts?.oauth2) { try { google.accounts.oauth2.revoke(t.token, () => {}); } catch { /* ignore */ } }
}
export function forgetAllTokens() { tokens.clear(); }

function describeOAuthError(code, desc) {
  const map = {
    popup_closed: 'The Google permission window was closed before access was granted.',
    popup_failed_to_open: 'Your browser blocked the Google permission window. Allow pop-ups for this site and try again.',
    access_denied: 'Access was denied. Grant the requested permission to continue.',
    invalid_client: 'The Google OAuth client ID is not valid for this website origin. Check "Authorized JavaScript origins" in Google Cloud.',
    redirect_uri_mismatch: 'This website origin is not authorised for the OAuth client. Add it in Google Cloud Console.',
    admin_policy_enforced: 'Your Google Workspace administrator blocks this permission.',
    popup_failed: 'The Google permission window could not be opened.'
  };
  return map[code] || `Google authorisation failed (${code}${desc ? ': ' + desc : ''}).`;
}
