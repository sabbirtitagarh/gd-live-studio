/* GD LIVE STUDIO — broadcasting engine.
 *
 *  Browser ──WebRTC/WHIP──▶ Gateway (optional, self-hosted, open source) ──RTMP(S)──▶ YouTube / Facebook / Instagram / custom
 *  Browser ──WebRTC/WHIP──▶ any WHIP endpoint                                            (single destination, no relay needed)
 *
 * GitHub Pages cannot run a streaming server and Apps Script/Drive are never used as video transport.
 * Multi-platform is enabled ONLY when a relay API is configured and answers a real health check.
 */
import { cam } from './camera.js';
import { compositor } from './overlays.js';
import { CONFIG } from './config.js';
import { state, feature } from './state.js';
import { kvGet, addHistory, updateHistory, logActivity } from './storage.js';
import { api, apiConfigured, getSession } from './api.js';
import { prepareDestination, confirmDestination, endDestination } from './platforms.js';
import { uid, sleep, emit } from './ui.js';

/* ---------- gateway configuration ---------- */
export async function resolveGateway() {
  const personal = await kvGet('gateway', null);
  const owner = state.config.gateway || {};
  if (personal && (personal.whipBase || personal.relayApi)) {
    const token = await kvGet('secret:gateway-token', '');
    return { source: 'personal', whipBase: trim(personal.whipBase), relayApi: trim(personal.relayApi), authType: personal.authType || 'bearer', iceServers: personal.iceServers || null, getToken: async () => token };
  }
  if (owner.enabled && (owner.whipBase || owner.relayApi)) {
    return { source: 'owner', whipBase: trim(owner.whipBase), relayApi: trim(owner.relayApi), authType: owner.authType || 'bearer', iceServers: owner.iceServers || null,
      getToken: async () => { if (!getSession()) return ''; const r = await api.gatewayToken(); return r.token || ''; } };
  }
  return null;
}
const trim = s => String(s || '').trim().replace(/\/+$/, '');
const authHeaders = (type, token) => !token ? {} : type === 'basic' ? { Authorization: 'Basic ' + btoa('studio:' + token) } : { Authorization: 'Bearer ' + token };

async function timed(url, opts = {}, ms = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
export async function checkGateway() {
  const gw = await resolveGateway();
  if (!gw) return { configured: false, ok: false, relay: false, message: 'No gateway is configured. Single-destination WHIP streaming still works; RTMP platforms and multi-platform need a gateway.' };
  const out = { configured: true, source: gw.source, ok: false, relay: false, whip: false, message: '' };
  const t0 = performance.now();
  if (gw.relayApi) {
    try {
      const r = await timed(gw.relayApi + '/health'); const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { out.relay = true; out.ffmpeg = j.ffmpeg !== false; out.ms = Math.round(performance.now() - t0); }
      else out.message = 'Relay API answered but is not healthy (HTTP ' + r.status + ').';
    } catch { out.message = 'Cannot reach the relay API. Check the URL, HTTPS certificate and CORS settings on the gateway.'; }
  }
  if (gw.whipBase) { try { await timed(gw.whipBase, { mode: 'no-cors' }, 6000); out.whip = true; } catch { out.message = (out.message ? out.message + ' ' : '') + 'Cannot reach the WHIP base URL.'; } }
  out.ok = out.whip && (gw.relayApi ? out.relay : true);
  if (out.ok && !out.message) out.message = 'Gateway reachable.';
  return out;
}

/* ---------- WHIP publisher ---------- */
async function iceDone(pc, ms = 3000) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise(res => { const t = setTimeout(res, ms); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
}
export async function whipPublish({ endpoint, token, authType, stream, iceServers, maxBitrate }) {
  if (!window.RTCPeerConnection) throw new Error('WebRTC is not supported by this browser.');
  const pc = new RTCPeerConnection({ iceServers: iceServers || state.config.gateway?.iceServers || CONFIG.DEFAULT_ICE_SERVERS, bundlePolicy: 'max-bundle' });
  let vTr = null;
  for (const t of stream.getTracks()) { const tr = pc.addTransceiver(t, { direction: 'sendonly', streams: [stream] }); if (t.kind === 'video') vTr = tr; }
  try { // prefer H.264: RTMP platforms need it and the relay can then copy video without transcoding
    const caps = RTCRtpSender.getCapabilities?.('video');
    if (vTr?.setCodecPreferences && caps) { const h = caps.codecs.filter(c => /h264/i.test(c.mimeType)); if (h.length) vTr.setCodecPreferences([...h, ...caps.codecs.filter(c => !/h264/i.test(c.mimeType))]); }
  } catch { /* preference is optional */ }
  await pc.setLocalDescription(await pc.createOffer()); await iceDone(pc);
  let res;
  try { res = await timed(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/sdp', ...authHeaders(authType, token) }, body: pc.localDescription.sdp }, 12000); }
  catch { pc.close(); throw new Error('Could not reach the WHIP endpoint. Check the URL, that it uses HTTPS, and that the server allows requests from this website (CORS).'); }
  if (res.status === 401 || res.status === 403) { pc.close(); throw new Error('The gateway rejected the credentials (HTTP ' + res.status + '). Sign in again or check the gateway token.'); }
  if (res.status !== 201 && res.status !== 200) { const body = await res.text().catch(() => ''); pc.close(); throw new Error('WHIP endpoint refused the stream (HTTP ' + res.status + ')' + (body ? ': ' + body.slice(0, 160) : '.')); }
  const loc = res.headers.get('Location'); const answer = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  const resource = loc ? new URL(loc, endpoint).toString() : null;
  try {
    for (const s of pc.getSenders().filter(s => s.track?.kind === 'video')) { const p = s.getParameters(); if (!p.encodings?.length) p.encodings = [{}]; if (maxBitrate) p.encodings[0].maxBitrate = maxBitrate; await s.setParameters(p); }
  } catch { /* some browsers reject bitrate caps; stream still works */ }
  await new Promise((resolve, reject) => {
    if (pc.connectionState === 'connected') return resolve();
    const t = setTimeout(() => reject(new Error('The media connection did not establish within 15 seconds (firewall/NAT may block WebRTC UDP; a TURN server may be needed).')), 15000);
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') { clearTimeout(t); resolve(); } else if (pc.connectionState === 'failed') { clearTimeout(t); reject(new Error('The media connection failed.')); } });
  }).catch(e => { pc.close(); throw e; });
  return { pc, resource, endpoint, token, authType };
}
async function whipStop(h) {
  try { if (h?.resource) await timed(h.resource, { method: 'DELETE', headers: authHeaders(h.authType, h.token) }, 4000); } catch { /* best effort */ }
  try { h?.pc?.close(); } catch { /* ignore */ }
}

/* ---------- relay client (talks to the self-hosted relay controller) ---------- */
const relayCall = async (gw, token, path, body, method = 'POST') => {
  const r = await timed(gw.relayApi + path, { method, headers: { 'Content-Type': 'application/json', ...authHeaders('bearer', token) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }, 10000);
  const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || 'Relay error (HTTP ' + r.status + ').'); return j;
};

/* ---------- stats / health ---------- */
async function readStats(pc, prev) {
  const rep = await pc.getStats(); const o = { t: performance.now() };
  rep.forEach(r => {
    if (r.type === 'outbound-rtp' && r.kind === 'video') { o.bytes = r.bytesSent; o.fps = r.framesPerSecond; o.w = r.frameWidth; o.h = r.frameHeight; o.limit = r.qualityLimitationReason; }
    if (r.type === 'remote-inbound-rtp' && r.kind === 'video') { o.rtt = r.roundTripTime; o.fracLost = r.fractionLost; }
    if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) o.pairRtt = r.currentRoundTripTime;
  });
  if (prev && prev.bytes != null && o.bytes != null) o.kbps = Math.round(((o.bytes - prev.bytes) * 8) / ((o.t - prev.t) / 1000) / 1000);
  const rtt = o.rtt ?? o.pairRtt; o.rttMs = rtt != null ? Math.round(rtt * 1000) : null;
  o.health = (o.kbps != null && o.kbps < 20) ? 'poor' : (o.fracLost > .1 || (o.rttMs ?? 0) > 700) ? 'poor' : (o.fracLost > .03 || (o.rttMs ?? 0) > 350 || o.limit === 'bandwidth') ? 'fair' : 'good';
  return o;
}

export function runCountdown(seconds, onTick) {
  return new Promise(resolve => { let n = seconds; onTick(n); const t = setInterval(() => { n--; if (n <= 0) { clearInterval(t); onTick(0); resolve(); } else onTick(n); }, 1000); });
}

/* ---------- Broadcast orchestration ---------- */
class Broadcast extends EventTarget {
  constructor() { super(); this.reset(); }
  reset() {
    this.status = 'idle'; this.dests = []; this.whip = null; this.stats = null; this.startedAt = 0; this.error = null; this.timers = []; this.opts = null; this.pathName = ''; this.gw = null; this.gwToken = ''; this.stream = null; this.retries = 0; this.historyId = ''; this.serverSession = ''; this.wasLive = false;
  }
  on(n, fn) { const h = e => fn(e.detail); this.addEventListener(n, h); return () => this.removeEventListener(n, h); }
  snapshot() { return { status: this.status, dests: this.dests.map(d => ({ key: d.key, label: d.label, platform: d.platform, status: d.status, detail: d.detail, verified: d.verified, link: d.link })), stats: this.stats, startedAt: this.startedAt, error: this.error, mode: this.opts?.mode }; }
  push() { this.dispatchEvent(new CustomEvent('update', { detail: this.snapshot() })); emit('broadcast:update', this.snapshot()); }
  elapsed() { return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0; }
  setStatus(s) { this.status = s; this.push(); }
  fail(message) { this.error = message; this.setStatus('error'); }

  /** Pre-flight blockers: returns [{ok, label, detail}] — all must be ok before start is allowed. */
  async preflight({ mode, specs }) {
    const checks = [];
    const add = (ok, label, detail = '', warn = false) => checks.push({ ok, label, detail, warn });
    add(cam.running, 'Camera ready', cam.running ? '' : 'Start the camera in Camera Studio.');
    add(cam.audioTrack() ? cam.s.micOn : true, 'Microphone', cam.audioTrack() ? (cam.s.micOn ? '' : 'Microphone is muted — viewers will hear nothing.') : 'No microphone track (video only).', true);
    add(!!window.RTCPeerConnection, 'WebRTC support', 'This browser cannot publish WebRTC.');
    add(navigator.onLine, 'Network', 'You are offline.');
    add(specs.length > 0, 'Destination selected', 'Choose at least one destination.');
    if (mode === 'single') add(specs.length <= 1, 'Single platform mode', 'Single mode sends to exactly one destination.');
    const gw = await resolveGateway(); const needsGw = specs.some(s => s.ingest === 'rtmp') || mode === 'multi';
    if (mode === 'multi') {
      add(feature('multi_platform'), 'Multi-platform enabled by owner', 'The owner has disabled multi-platform streaming.');
      add(specs.length >= 2, 'At least two destinations', 'Multi-platform needs two or more destinations.');
      add(specs.every(s => s.ingest === 'rtmp'), 'Relay-compatible destinations', 'WHIP destinations can only be used in single mode.');
    }
    if (needsGw) {
      if (!gw || !gw.relayApi) add(false, 'Streaming gateway', 'RTMP platforms and multi-platform streaming need a relay gateway. Multi-platform is UNAVAILABLE until one is configured (Device Settings > Gateway, or ask the owner).');
      else { const h = await checkGateway(); add(h.ok && h.relay, 'Streaming gateway reachable', h.message || 'Gateway is not healthy.'); }
    }
    for (const s of specs) add(s.ready !== false, 'Destination: ' + s.label, s.reason || '');
    return checks;
  }

  async start(opts) {
    // opts: { title, description, privacy, mode, specs, madeForKids, scheduleId }
    if (this.status !== 'idle' && this.status !== 'error') throw new Error('A broadcast is already running.');
    this.reset(); this.opts = opts; this.setStatus('preparing');
    const checks = await this.preflight(opts); const bad = checks.find(c => !c.ok && !c.warn);
    if (bad) { this.fail(bad.label + ': ' + bad.detail); throw new Error(this.error); }
    const gw = await resolveGateway(); this.gw = gw;
    try {
      // 1) create the real platform objects (YouTube broadcast+stream, Facebook live video, …)
      for (const spec of opts.specs) {
        try { const d = await prepareDestination(spec, opts); this.dests.push(d); d.status = 'Ready'; this.push(); }
        catch (e) { throw new Error(`${spec.label}: ${e.message}`); }
      }
      // 2) program feed
      this.owner = 'broadcast-' + uid(); compositor.lock(true); compositor.acquire(this.owner); this.stream = compositor.program();
      this.setStatus('connecting');
      const q = cam.quality(); const rtmpDests = this.dests.filter(d => d.ingest === 'rtmp'); const whipDests = this.dests.filter(d => d.ingest === 'whip');
      if (rtmpDests.length) {
        this.gwToken = await gw.getToken();
        this.pathName = 'gd-' + uid('').slice(1, 11);
        const ep = `${gw.whipBase}/${this.pathName}/whip`;
        await this.publish(ep, gw.authType, this.gwToken, gw.iceServers, q.vbr);
        await relayCall(gw, this.gwToken, '/relay/start', { path: this.pathName, destinations: rtmpDests.map(d => ({ id: d.key, label: d.label, url: d.url })) });
        rtmpDests.forEach(d => { d.status = 'Connecting'; d.detail = 'Relay starting…'; });
      } else if (whipDests[0]) {
        const d = whipDests[0]; await this.publish(d.url, 'bearer', d.token, null, q.vbr); d.status = 'Broadcasting'; d.detail = 'Connected'; d.unverifiable = true;
      }
      this.startedAt = Date.now(); this.setStatus('broadcasting'); cam.requestWake();
      // 3) bookkeeping
      const h = await addHistory({ title: opts.title || 'Untitled stream', mode: opts.mode, destinations: this.dests.map(d => d.label), startedAt: new Date().toISOString(), status: 'Started', orientation: cam.s.orientation, quality: cam.s.quality }); this.historyId = h.id;
      if (apiConfigured() && getSession()) api.streamStart({ title: opts.title, mode: opts.mode, orientation: cam.s.orientation, quality: cam.s.quality, destinations: this.dests.map(d => ({ platform: d.platform, label: d.label })), scheduleId: opts.scheduleId || '' }).then(r => { this.serverSession = r.sessionId; }).catch(() => {});
      logActivity('Broadcast started: ' + (opts.title || 'Untitled'));
      this.loops();
    } catch (e) { await this.teardown(true, e.message); throw e; }
  }

  async publish(endpoint, authType, token, iceServers, maxBitrate) {
    this.whip = await whipPublish({ endpoint, token, authType, stream: this.stream, iceServers, maxBitrate });
    this.whipArgs = { endpoint, authType, token, iceServers, maxBitrate };
    this.whip.pc.addEventListener('connectionstatechange', () => this.onConn());
  }
  onConn() {
    const st = this.whip?.pc?.connectionState; if (this.status !== 'broadcasting') return;
    if (st === 'failed' || st === 'closed') this.reconnect();
    else if (st === 'disconnected') { clearTimeout(this.discTimer); this.discTimer = setTimeout(() => { if (this.whip?.pc?.connectionState === 'disconnected') this.reconnect(); }, 6000); this.notice('Connection interrupted — waiting to recover…'); }
  }
  notice(t) { this.lastNotice = t; this.push(); }
  async reconnect() {
    if (this.reconnecting || this.status !== 'broadcasting') return; this.reconnecting = true;
    // Safe to retry: only the WHIP media connection is re-established; no new platform broadcast is created.
    for (let i = 1; i <= 3 && this.status === 'broadcasting'; i++) {
      this.notice(`Reconnecting to the gateway (attempt ${i}/3)…`); this.stats = { ...(this.stats || {}), health: 'poor' };
      try { await whipStop(this.whip); await sleep(1000 * i); await this.publish(this.whipArgs.endpoint, this.whipArgs.authType, this.whipArgs.token, this.whipArgs.iceServers, this.whipArgs.maxBitrate); this.notice('Reconnected.'); this.reconnecting = false; return; }
      catch (e) { this.notice('Reconnect failed: ' + e.message); }
    }
    this.reconnecting = false; if (this.status === 'broadcasting') { await this.stop('connection_lost', 'The connection to the gateway was lost and could not be restored.'); }
  }

  loops() {
    let prev = null;
    this.timers.push(setInterval(async () => {
      if (!this.whip?.pc) return;
      try { const s = await readStats(this.whip.pc, prev); prev = s; this.stats = s; this.push(); } catch { /* stats are best effort */ }
    }, 2000));
    // relay per-destination health
    if (this.gw?.relayApi && this.pathName) this.timers.push(setInterval(async () => {
      try {
        const r = await relayCall(this.gw, this.gwToken, '/relay/status?path=' + encodeURIComponent(this.pathName), null, 'GET');
        for (const rd of r.destinations || []) { const d = this.dests.find(x => x.key === rd.id); if (!d) continue; d.relayState = rd.state; d.restarts = rd.restarts;
          if (rd.state === 'running') { if (d.status !== 'Live' && !d.verified) { d.status = d.unverifiable ? 'Sending (not verified)' : 'Broadcasting'; d.detail = d.unverifiable ? 'Relay is sending. This platform does not confirm a live state.' : 'Relay is sending; waiting for platform confirmation…'; } }
          else if (rd.state === 'retrying') { d.status = 'Error'; d.detail = 'Relay lost this destination, retrying… ' + (rd.error || ''); }
          else if (rd.state === 'failed') { d.status = 'Error'; d.detail = 'Relay could not keep this destination running. ' + (rd.error || ''); }
        }
        this.push();
      } catch { /* transient */ }
    }, 3000));
    // platform confirmation — only the platform can say "Live"
    this.timers.push(setInterval(async () => {
      for (const d of this.dests) {
        if (!(d.ytBroadcastId || d.fbLiveId)) continue;
        const c = await confirmDestination(d);
        if (c.state === 'live') { if (!d.verified) { d.verified = true; this.wasLive = true; this.onLive(d); } d.status = 'Live'; d.detail = c.detail; d.link = c.link || d.link; }
        else if (c.state === 'ended') { d.status = 'Completed'; d.detail = c.detail; }
        else if (c.state === 'error') { d.detail = 'Could not read platform state: ' + c.detail; }
        else { d.detail = c.detail; }
      }
      this.push();
    }, 4000));
  }
  async onLive(d) {
    if (this.opts?.scheduleId && apiConfigured() && getSession()) {
      try { await api.schedStatus({ id: this.opts.scheduleId, status: 'Live', confirmation: { platform: d.platform, broadcastId: d.ytBroadcastId || d.fbLiveId, lifecycle: 'live' } }); } catch { /* best effort */ }
    }
  }

  async stop(reason = 'user', errorText = '') { if (this.status === 'idle') return; await this.teardown(false, errorText, reason); }

  async teardown(failedEarly, errorText, reason = 'user') {
    this.timers.forEach(clearInterval); this.timers = []; clearTimeout(this.discTimer);
    const wasRunning = this.startedAt > 0; const dur = this.elapsed();
    this.status = 'stopping'; this.push();
    try { if (this.gw?.relayApi && this.pathName) await relayCall(this.gw, this.gwToken, '/relay/stop', { path: this.pathName }); } catch { /* relay may already be gone */ }
    for (const d of this.dests) await endDestination(d);
    await whipStop(this.whip);
    if (this.stream) compositor.releaseProgram(this.stream); if (this.owner) { compositor.release(this.owner); compositor.lock(false); }
    cam.releaseWake();
    const finalStatus = failedEarly ? 'Failed' : (errorText ? 'Failed' : (this.wasLive || this.dests.some(d => d.unverifiable) ? 'Completed' : 'Completed'));
    if (this.historyId) updateHistory(this.historyId, { endedAt: new Date().toISOString(), duration: Math.round(dur), status: finalStatus, error: errorText || '' }).catch(() => {});
    if (this.serverSession) api.streamEnd({ sessionId: this.serverSession, status: finalStatus, durationSec: Math.round(dur), endReason: reason, error: (errorText || '').slice(0, 200) }).catch(() => {});
    if (this.opts?.scheduleId && wasRunning && apiConfigured() && getSession()) api.schedStatus({ id: this.opts.scheduleId, status: finalStatus === 'Completed' && this.wasLive ? 'Completed' : 'Failed' }).catch(() => {});
    logActivity(wasRunning ? `Broadcast ended (${Math.round(dur)} s)` : 'Broadcast could not start: ' + errorText);
    const err = errorText || null; this.reset(); this.error = err;
    this.status = err ? 'error' : 'idle'; this.push();
  }
}
export const broadcast = new Broadcast();

window.addEventListener('beforeunload', e => { if (broadcast.status === 'broadcasting' || broadcast.status === 'connecting') { e.preventDefault(); e.returnValue = ''; } });
