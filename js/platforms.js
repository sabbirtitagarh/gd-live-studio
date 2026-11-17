/* GD LIVE STUDIO — platform integrations.
 *  YouTube  : official YouTube Data API v3 (Live Streaming) with Google OAuth (token kept in memory only).
 *  Facebook : official Meta Graph API for eligible Pages (page token kept in memory only).
 *  Instagram: conditional — manual RTMP from Live Producer only; no public Live API is assumed.
 *  Custom   : RTMP/RTMPS and WHIP destinations entered by the user (keys never leave the device except to the user's own gateway).
 * A platform shows "Connected" ONLY after a real authorised API call succeeded in this session.
 */
import { CONFIG } from './config.js';
import { state, platformDef, feature } from './state.js';
import { getAccessToken, hasToken, revokeToken, peekToken } from './gis.js';
import { loadScript } from './gis.js';
import { kvGet, kvSet, kvDel, logActivity } from './storage.js';
import { api, apiConfigured, getSession } from './api.js';
import { uid, emit } from './ui.js';

export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube';
const YT = 'https://www.googleapis.com/youtube/v3';
const FB_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,publish_video';

/* ---------- in-memory connection state (derived from real API results) ---------- */
const conn = {
  youtube:   { status: 'Disconnected', account: '', accountId: '', liveEnabled: null, error: '', verifiedAt: null },
  facebook:  { status: 'Disconnected', account: '', accountId: '', pages: [], pageId: '', error: '', verifiedAt: null },
  instagram: { status: 'Disconnected', account: '', error: '', verifiedAt: null },
  rtmp:      { status: 'Disconnected', error: '' },
  whip:      { status: 'Disconnected', error: '' }
};
const memKeys = new Map();     // destination id -> secret (stream key / token) kept only in memory when not remembered
const fbTokens = new Map();    // pageId -> page access token (memory only)
let previous = {};             // persisted metadata about previous connections (no secrets)

export function connection(id) { return conn[id]; }
export async function loadPlatformState() {
  previous = await kvGet('platformMeta', {}) || {};
  await refreshManualStatus();
  emit('platforms:changed');
}
async function persistMeta() { await kvSet('platformMeta', previous); }
const setStatus = (id, patch) => { Object.assign(conn[id], patch); emit('platforms:changed', id); };

/** Metadata (never tokens/keys) mirrored to the backend for logged-in users so the owner can see integration health. */
async function mirror(platform, status, account, accountId, method) {
  previous[platform] = { account, accountId, verifiedAt: new Date().toISOString(), status }; persistMeta().catch(() => {});
  if (apiConfigured() && getSession()) { try { await api.platformUpsert({ platform, status, accountLabel: account, accountId, method }); } catch { /* best effort */ } }
}
export function previousInfo(id) { return previous[id] || null; }

/* ---------- YouTube ---------- */
async function ytFetch(path, { method = 'GET', body, params } = {}) {
  const token = peekToken(YT_SCOPE) || await getAccessToken(YT_SCOPE);
  const url = new URL(YT + path); Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw ytError(res.status, json);
  return json;
}
function ytError(status, json) {
  const e = json?.error; const reason = e?.errors?.[0]?.reason || e?.status || '';
  const map = {
    liveStreamingNotEnabled: 'Live streaming is not enabled on this YouTube channel. Enable it in YouTube Studio (activation can take up to 24 hours) and try again.',
    quotaExceeded: 'The YouTube API daily quota for this Google Cloud project is used up. It resets at midnight Pacific time.',
    insufficientPermissions: 'The YouTube permission was not granted. Disconnect and connect again, accepting all requested permissions.',
    forbidden: 'YouTube refused this action for the signed-in account (channel restrictions or missing permission).',
    accessNotConfigured: 'The YouTube Data API v3 is not enabled for the Google Cloud project that owns this OAuth client.',
    invalidCredentials: 'The Google sign-in expired. Press Connect again.',
    authError: 'The Google sign-in expired. Press Connect again.',
    liveBroadcastNotFound: 'That YouTube broadcast no longer exists.',
    redundantTransition: 'YouTube already moved the broadcast to that state.',
    invalidTransition: 'YouTube cannot move the broadcast to that state yet (the stream may not be active).'
  };
  const err = new Error(map[reason] || e?.message || `YouTube API error (${status}).`); err.code = reason || String(status); err.status = status; return err;
}

export async function connectYouTube() {
  if (!feature('platform_youtube')) throw new Error('YouTube is turned off by the owner.');
  setStatus('youtube', { status: 'Testing', error: '' });
  try {
    await getAccessToken(YT_SCOPE, { forcePrompt: true });
    return await testYouTube();
  } catch (e) { setStatus('youtube', { status: 'Error', error: e.message }); throw e; }
}
export async function testYouTube() {
  if (!hasToken(YT_SCOPE)) { setStatus('youtube', { status: 'Disconnected', error: '' }); throw new Error('Not authorised in this session. Press Connect.'); }
  setStatus('youtube', { status: 'Testing', error: '' });
  try {
    const ch = await ytFetch('/channels', { params: { part: 'snippet', mine: 'true' } });
    const item = ch.items?.[0]; if (!item) throw new Error('No YouTube channel was found for this Google account. Create a channel first.');
    let liveEnabled = true;
    try { await ytFetch('/liveBroadcasts', { params: { part: 'id', mine: 'true', maxResults: '1' } }); }
    catch (e) { if (e.code === 'liveStreamingNotEnabled') liveEnabled = false; else if (e.status !== 403) throw e; else liveEnabled = false; }
    setStatus('youtube', { status: 'Connected', account: item.snippet.title, accountId: item.id, liveEnabled, error: liveEnabled ? '' : 'Connected, but live streaming is not enabled on this channel yet.', verifiedAt: Date.now() });
    await mirror('youtube', 'Connected', item.snippet.title, item.id, 'oauth2-youtube-live'); logActivity('YouTube connected: ' + item.snippet.title);
    return conn.youtube;
  } catch (e) { setStatus('youtube', { status: 'Error', error: e.message }); throw e; }
}

export async function ytListUpcoming() {
  const j = await ytFetch('/liveBroadcasts', { params: { part: 'snippet,status,contentDetails', mine: 'true', broadcastStatus: 'upcoming', maxResults: '25' } });
  return (j.items || []).map(b => ({ id: b.id, title: b.snippet.title, start: b.snippet.scheduledStartTime, privacy: b.status.privacyStatus, life: b.status.lifeCycleStatus, boundStreamId: b.contentDetails?.boundStreamId || '' }));
}
export async function ytCreateBroadcast({ title, description = '', privacy = 'unlisted', start, madeForKids = false }) {
  const when = start ? new Date(start) : new Date(Date.now() + 15000);
  const b = await ytFetch('/liveBroadcasts', {
    method: 'POST', params: { part: 'snippet,status,contentDetails' },
    body: {
      snippet: { title: title || 'GD LIVE STUDIO stream', description, scheduledStartTime: when.toISOString() },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: !!madeForKids },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: 'low', monitorStream: { enableMonitorStream: false } }
    }
  });
  return b.id;
}
async function ytAttachStream(broadcastId, title) {
  const s = await ytFetch('/liveStreams', { method: 'POST', params: { part: 'snippet,cdn,contentDetails' }, body: { snippet: { title: (title || 'GD LIVE STUDIO') + ' ingest' }, cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' }, contentDetails: { isReusable: false } } });
  await ytFetch('/liveBroadcasts/bind', { method: 'POST', params: { id: broadcastId, streamId: s.id, part: 'id,contentDetails' } });
  const ing = s.cdn.ingestionInfo; return { streamId: s.id, url: ing.ingestionAddress.replace(/\/$/, '') + '/' + ing.streamName };
}
export async function ytPoll(broadcastId, streamId) {
  const b = await ytFetch('/liveBroadcasts', { params: { part: 'status', id: broadcastId } });
  const s = await ytFetch('/liveStreams', { params: { part: 'status', id: streamId } });
  return { life: b.items?.[0]?.status?.lifeCycleStatus || 'unknown', stream: s.items?.[0]?.status?.streamStatus || 'unknown', health: s.items?.[0]?.status?.healthStatus?.status || 'noData' };
}
export async function ytTransition(broadcastId, to) {
  return ytFetch('/liveBroadcasts/transition', { method: 'POST', params: { broadcastStatus: to, id: broadcastId, part: 'status' } });
}

/* ---------- Facebook ---------- */
async function loadFB() {
  if (!CONFIG.FACEBOOK_APP_ID) throw new Error('Facebook is not configured. The owner must set FACEBOOK_APP_ID in js/config.js.');
  await loadScript('https://connect.facebook.net/en_US/sdk.js');
  if (!window.FB) throw new Error('The Facebook SDK could not load (blocked by the browser or an extension).');
  if (!loadFB.init) { FB.init({ appId: CONFIG.FACEBOOK_APP_ID, cookie: false, xfbml: false, version: CONFIG.FACEBOOK_GRAPH_VERSION }); loadFB.init = true; }
}
const graph = async (path, { method = 'GET', params = {}, token } = {}) => {
  const url = new URL(`https://graph.facebook.com/${CONFIG.FACEBOOK_GRAPH_VERSION}/${path}`);
  const form = new URLSearchParams({ ...params, access_token: token });
  let res; if (method === 'GET') { form.forEach((v, k) => url.searchParams.set(k, v)); res = await fetch(url); } else res = await fetch(url, { method, body: form });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) { const err = new Error(fbMsg(j.error)); err.code = j.error?.code; throw err; }
  return j;
};
function fbMsg(e) {
  if (!e) return 'Facebook request failed.';
  if (e.code === 190) return 'The Facebook sign-in expired. Press Connect again.';
  if (e.code === 200 || e.code === 10) return 'Meta has not granted this app the permission needed for live video yet. In Development mode only people with a role on the app can use it; others need Meta App Review. (' + e.message + ')';
  return e.message || 'Facebook request failed.';
}
export async function connectFacebook() {
  if (!feature('platform_facebook')) throw new Error('Facebook is turned off by the owner.');
  setStatus('facebook', { status: 'Testing', error: '' });
  try {
    await loadFB();
    const auth = await new Promise((resolve, reject) => FB.login(r => r.authResponse ? resolve(r.authResponse) : reject(new Error('Facebook sign-in was cancelled or not granted.')), { scope: FB_SCOPES, return_scopes: true }));
    const pages = await graph('me/accounts', { params: { fields: 'id,name,access_token,tasks', limit: '50' }, token: auth.accessToken });
    const eligible = (pages.data || []).filter(p => (p.tasks || []).some(t => ['CREATE_CONTENT', 'MANAGE', 'ADVERTISE'].includes(t)) || !p.tasks);
    if (!eligible.length) throw new Error('No eligible Facebook Page found. You need a Page where you can create content.');
    fbTokens.clear(); eligible.forEach(p => fbTokens.set(p.id, p.access_token));
    const pageId = conn.facebook.pageId && fbTokens.has(conn.facebook.pageId) ? conn.facebook.pageId : eligible[0].id;
    const page = eligible.find(p => p.id === pageId);
    setStatus('facebook', { status: 'Connected', pages: eligible.map(p => ({ id: p.id, name: p.name })), pageId, account: page.name, accountId: page.id, error: '', verifiedAt: Date.now() });
    await mirror('facebook', 'Connected', page.name, page.id, 'meta-graph-page-live'); logActivity('Facebook Page connected: ' + page.name);
    return conn.facebook;
  } catch (e) { setStatus('facebook', { status: 'Error', error: e.message }); throw e; }
}
export function selectFacebookPage(pageId) {
  const p = conn.facebook.pages.find(x => x.id === pageId); if (p) setStatus('facebook', { pageId, account: p.name, accountId: p.id });
}
export async function testFacebook() {
  const id = conn.facebook.pageId, tok = fbTokens.get(id); if (!tok) { setStatus('facebook', { status: 'Disconnected' }); throw new Error('Not authorised in this session. Press Connect.'); }
  setStatus('facebook', { status: 'Testing' });
  try { const r = await graph(id, { params: { fields: 'id,name' }, token: tok }); setStatus('facebook', { status: 'Connected', account: r.name, error: '', verifiedAt: Date.now() }); return conn.facebook; }
  catch (e) { setStatus('facebook', { status: 'Error', error: e.message }); throw e; }
}
async function fbCreateLive({ title, description, privacy }) {
  const tok = fbTokens.get(conn.facebook.pageId); if (!tok) throw new Error('Facebook is not authorised in this session. Connect it again.');
  const live = await graph(conn.facebook.pageId + '/live_videos', { method: 'POST', token: tok, params: { status: 'LIVE_NOW', title: title || 'GD LIVE STUDIO stream', description: description || '', 'privacy': JSON.stringify({ value: privacy === 'private' ? 'SELF' : 'EVERYONE' }) } });
  const url = live.secure_stream_url || live.stream_url; if (!url) throw new Error('Facebook did not return a stream URL for this Page.');
  return { id: live.id, url, token: tok };
}

/* ---------- Manual destinations (custom RTMP/RTMPS, Instagram Live Producer, WHIP) ---------- */
export async function listManual() { return (await kvGet('destinations', [])) || []; }
async function refreshManualStatus() {
  const list = await listManual();
  for (const p of ['rtmp', 'whip', 'instagram']) {
    const has = list.some(d => d.platform === p);
    if (p === 'instagram') setStatus('instagram', { status: has ? 'Ready' : 'Disconnected', account: has ? list.find(d => d.platform === 'instagram').label : '', error: '' });
    else setStatus(p, { status: has ? 'Ready' : 'Disconnected' });
  }
}
export async function addManual({ platform, label, url, key, remember }) {
  url = String(url || '').trim();
  if (platform === 'whip') { if (!/^https:\/\//i.test(url)) throw new Error('A WHIP endpoint must start with https:// (browsers block insecure WebRTC signalling from an HTTPS page).'); }
  else if (!/^rtmps?:\/\//i.test(url)) throw new Error('Enter a valid RTMP URL starting with rtmp:// or rtmps://');
  const id = uid('dest'); const list = await listManual();
  list.push({ id, platform, label: (label || '').trim() || (platform === 'whip' ? 'WHIP endpoint' : 'RTMP destination'), url, hasSecret: !!key, remember: !!remember });
  await kvSet('destinations', list);
  if (key) { if (remember) await kvSet('secret:dest:' + id, key); else memKeys.set(id, key); }
  await refreshManualStatus(); logActivity('Destination added: ' + list.at(-1).label); return id;
}
export async function removeManual(id) {
  const list = (await listManual()).filter(d => d.id !== id); await kvSet('destinations', list); await kvDel('secret:dest:' + id); memKeys.delete(id); await refreshManualStatus();
}
export async function setManualSecret(id, key, remember) { if (remember) await kvSet('secret:dest:' + id, key); else memKeys.set(id, key); }
async function manualSecret(id) { return memKeys.get(id) || (await kvGet('secret:dest:' + id, '')) || ''; }

/* ---------- Destination catalogue for the Go Live wizard ---------- */
export async function availableDestinations() {
  const out = []; const yt = conn.youtube;
  const def = id => platformDef(id) || {};
  out.push({ key: 'youtube', platform: 'youtube', kind: 'youtube', label: 'YouTube' + (yt.account ? ' — ' + yt.account : ''), ingest: 'rtmp', ready: yt.status === 'Connected' && yt.liveEnabled !== false && def('youtube').enabled !== false && feature('platform_youtube'), reason: def('youtube').enabled === false ? (def('youtube').apiMessage || 'Disabled by the owner.') : yt.status !== 'Connected' ? 'Connect YouTube first.' : yt.liveEnabled === false ? 'Live streaming is not enabled on this channel.' : '' });
  const fb = conn.facebook;
  out.push({ key: 'facebook', platform: 'facebook', kind: 'facebook', label: 'Facebook' + (fb.account ? ' — ' + fb.account : ''), ingest: 'rtmp', ready: fb.status === 'Connected' && def('facebook').enabled !== false && feature('platform_facebook'), reason: def('facebook').enabled === false ? (def('facebook').apiMessage || 'Disabled by the owner.') : fb.status !== 'Connected' ? 'Connect a Facebook Page first.' : '' });
  for (const d of await listManual()) {
    const dp = def(d.platform);
    out.push({ key: d.id, platform: d.platform, kind: 'manual', label: d.label + (d.platform === 'instagram' ? ' (Instagram, manual)' : d.platform === 'whip' ? ' (WHIP)' : ' (RTMP)'), ingest: d.platform === 'whip' ? 'whip' : 'rtmp', ready: dp.enabled !== false && (d.platform === 'whip' || true), reason: dp.enabled === false ? (dp.apiMessage || 'Disabled by the owner.') : '', manual: d });
  }
  return out;
}

/** Create the real platform-side objects for one chosen destination and return a session handle.
 *  The returned object holds secrets in memory only. */
export async function prepareDestination(spec, { title, description, privacy, madeForKids }) {
  const base = { key: spec.key, platform: spec.platform, label: spec.label, ingest: spec.ingest, status: 'Preparing', detail: '', verified: false };
  if (spec.kind === 'youtube') {
    const bid = spec.existingBroadcastId || await ytCreateBroadcast({ title, description, privacy, madeForKids });
    const att = await ytAttachStream(bid, title);
    return { ...base, url: att.url, ytBroadcastId: bid, ytStreamId: att.streamId, created: !spec.existingBroadcastId };
  }
  if (spec.kind === 'facebook') {
    const l = await fbCreateLive({ title, description, privacy }); return { ...base, url: l.url, fbLiveId: l.id, fbToken: l.token };
  }
  const d = spec.manual; const secret = await manualSecret(d.id);
  if (d.platform === 'whip') return { ...base, url: d.url, token: secret };
  const url = secret ? d.url.replace(/\/$/, '') + '/' + secret : d.url;
  return { ...base, url, unverifiable: true };
}

/** Ask the platform what the broadcast state really is. Never invents "live". */
export async function confirmDestination(dest) {
  try {
    if (dest.ytBroadcastId) {
      const p = await ytPoll(dest.ytBroadcastId, dest.ytStreamId);
      if (p.life === 'live') return { state: 'live', detail: 'YouTube confirms the broadcast is live.', health: p.health };
      if (p.life === 'testing') { try { await ytTransition(dest.ytBroadcastId, 'live'); } catch { /* auto-start may handle it */ } return { state: 'waiting', detail: 'YouTube is in test state, moving to live…', health: p.health }; }
      if (p.life === 'complete' || p.life === 'revoked') return { state: 'ended', detail: 'YouTube reports the broadcast has ended.' };
      return { state: 'waiting', detail: p.stream === 'active' ? 'YouTube is receiving video and starting the broadcast…' : 'Waiting for YouTube to receive video…', health: p.health };
    }
    if (dest.fbLiveId) {
      const r = await graph(dest.fbLiveId, { params: { fields: 'status,permalink_url' }, token: dest.fbToken });
      if (r.status === 'LIVE_NOW') return { state: 'live', detail: 'Facebook confirms the video is live.', link: r.permalink_url ? 'https://facebook.com' + r.permalink_url : '' };
      if (['VOD', 'PROCESSING'].includes(r.status)) return { state: 'ended', detail: 'Facebook reports the live video has ended.' };
      return { state: 'waiting', detail: 'Facebook status: ' + r.status };
    }
  } catch (e) { return { state: 'error', detail: e.message }; }
  return { state: 'unverified', detail: dest.ingest === 'whip' ? 'Connected to the WHIP endpoint. The receiving service does not report a live state to this app.' : 'Sending to this destination. This platform does not confirm a live state to this app.' };
}
export async function endDestination(dest) {
  try { if (dest.ytBroadcastId) await ytTransition(dest.ytBroadcastId, 'complete'); } catch { /* may already be complete */ }
  try { if (dest.fbLiveId) await graph(dest.fbLiveId, { method: 'POST', params: { end_live_video: 'true' }, token: dest.fbToken }); } catch { /* ignore */ }
}

export function disconnect(id) {
  if (id === 'youtube') revokeToken(YT_SCOPE);
  if (id === 'facebook') { fbTokens.clear(); try { window.FB?.logout(() => {}); } catch { /* ignore */ } }
  Object.assign(conn[id], { status: 'Disconnected', error: '' }); if (id === 'youtube') Object.assign(conn.youtube, { account: '', accountId: '', liveEnabled: null }); if (id === 'facebook') Object.assign(conn.facebook, { pages: [], pageId: '', account: '', accountId: '' });
  delete previous[id]; persistMeta().catch(() => {});
  if (apiConfigured() && getSession()) api.platformRemove({ platform: id }).catch(() => {});
  emit('platforms:changed', id); logActivity('Disconnected ' + id);
}
export function connectedCount() { return ['youtube', 'facebook'].filter(k => conn[k].status === 'Connected').length + (conn.instagram.status === 'Ready' ? 1 : 0) + (conn.rtmp.status === 'Ready' ? 1 : 0) + (conn.whip.status === 'Ready' ? 1 : 0); }
