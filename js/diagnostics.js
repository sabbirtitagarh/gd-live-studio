/* GD LIVE STUDIO — Diagnostics Centre: real checks with recovery instructions. */
import { $, esc, icon, toast } from './ui.js';
import { cam, recorderTypes } from './camera.js';
import { api, apiConfigured, apiMetrics } from './api.js';
import { checkGateway, resolveGateway } from './streaming.js';
import { storageEstimate, persistStatus } from './storage.js';
import { connection } from './platforms.js';
import { fmtBytes } from './ui.js';
import { CONFIG } from './config.js';
import { googleConfigured } from './gis.js';

export async function runDiagnostics() {
  const out = [];
  const add = (status, label, detail = '', fix = '') => out.push({ status, label, detail, fix });
  const secure = window.isSecureContext;
  add(secure ? 'pass' : 'fail', 'Secure context (HTTPS)', secure ? location.protocol + '//' + location.host : 'Camera, microphone, WebRTC and installation require HTTPS.', 'Open the app from its https:// GitHub Pages address.');
  add(navigator.mediaDevices?.getUserMedia ? 'pass' : 'fail', 'Camera API (getUserMedia)', '', 'Use a current version of Chrome, Edge, Firefox or Safari.');
  for (const name of ['camera', 'microphone']) {
    try { const p = await navigator.permissions.query({ name }); add(p.state === 'granted' ? 'pass' : p.state === 'denied' ? 'fail' : 'warn', (name === 'camera' ? 'Camera' : 'Microphone') + ' permission', 'State: ' + p.state, p.state === 'denied' ? 'Open the browser site settings (lock icon) and set it to Allow.' : p.state === 'prompt' ? 'Press Start Camera and approve the prompt.' : ''); }
    catch { add('warn', (name === 'camera' ? 'Camera' : 'Microphone') + ' permission', 'This browser cannot report the permission state before first use.', 'Start the camera once to be asked.'); }
  }
  try { const d = await navigator.mediaDevices.enumerateDevices(); const v = d.filter(x => x.kind === 'videoinput').length, a = d.filter(x => x.kind === 'audioinput').length; add(v ? 'pass' : 'warn', 'Cameras detected', String(v), v ? '' : 'Connect a camera or grant permission so devices can be listed.'); add(a ? 'pass' : 'warn', 'Microphones detected', String(a), a ? '' : 'Connect a microphone or grant permission.'); } catch (e) { add('fail', 'Device enumeration', e.message); }
  add(cam.running ? 'pass' : 'warn', 'Camera running now', cam.running ? `${cam.actual?.video?.width}×${cam.actual?.video?.height} @ ${Math.round(cam.actual?.video?.frameRate || 0)} fps` : 'Camera is not started.', 'Start it in Camera Studio to test it.');
  add(window.MediaRecorder ? 'pass' : 'fail', 'MediaRecorder', '', 'Recording needs MediaRecorder support.');
  const types = recorderTypes(); add(types.length ? 'pass' : 'fail', 'Supported recording formats', types.length ? types.join(', ') : 'None detected', 'Use a different browser.');
  add(typeof HTMLCanvasElement.prototype.captureStream === 'function' ? 'pass' : 'warn', 'Canvas capture (overlays)', '', 'Overlays on recordings/broadcast need canvas.captureStream().');
  add(window.RTCPeerConnection ? 'pass' : 'fail', 'WebRTC', '', 'Broadcasting needs WebRTC.');
  try { const caps = RTCRtpSender.getCapabilities('video'); const h264 = caps.codecs.some(c => /h264/i.test(c.mimeType)); add(h264 ? 'pass' : 'warn', 'WebRTC H.264 encoder', h264 ? 'Available (best for RTMP relay).' : 'Not offered: the relay must transcode, which costs more CPU.'); } catch { /* unsupported */ }
  add('wakeLock' in navigator ? 'pass' : 'warn', 'Screen wake lock', '', 'Without it, keep the screen on manually while live.');
  add('serviceWorker' in navigator ? 'pass' : 'warn', 'Service worker (offline/PWA)', navigator.serviceWorker?.controller ? 'Active' : 'Not controlling this page yet', 'Reload once after the first visit.');
  add(navigator.onLine ? 'pass' : 'fail', 'Network', navigator.onLine ? 'Online' + (navigator.connection ? ` (${navigator.connection.effectiveType || 'unknown'}, ~${navigator.connection.downlink || '?'} Mbps)` : '') : 'Offline', 'Reconnect to the internet.');
  const est = await storageEstimate(); add(est ? (est.free > 200 * 1024 * 1024 ? 'pass' : 'warn') : 'warn', 'Storage available', est ? `${fmtBytes(est.free)} free of ${fmtBytes(est.quota)}` : 'This browser does not report storage.', 'Free some space or download and delete old recordings.');
  const persisted = await persistStatus(); if (persisted != null) add(persisted ? 'pass' : 'warn', 'Persistent storage', persisted ? 'Granted' : 'Not granted: the browser may clear local data under storage pressure.', 'Use Storage Manager > “Ask browser to keep my data”.');
  add(googleConfigured() ? 'pass' : 'warn', 'Google OAuth client configured', googleConfigured() ? 'Client ID present' : 'GOOGLE_CLIENT_ID is empty', 'Owner: set it in js/config.js (see docs/OAUTH_SETUP.md).');
  add(CONFIG.FACEBOOK_APP_ID ? 'pass' : 'warn', 'Facebook app configured', CONFIG.FACEBOOK_APP_ID ? 'App ID present' : 'FACEBOOK_APP_ID is empty', 'Owner: set it in js/config.js.');
  for (const [id, label] of [['youtube', 'YouTube authorisation'], ['facebook', 'Facebook authorisation']]) { const c = connection(id); add(c.status === 'Connected' ? 'pass' : c.status === 'Error' ? 'fail' : 'warn', label, c.status + (c.account ? ' — ' + c.account : '') + (c.error ? ' (' + c.error + ')' : ''), 'Connect it in Platform Connections.'); }
  if (!apiConfigured()) add('warn', 'Backend API', 'API_URL is not set (Local mode).', 'Deploy the Apps Script Web App and set API_URL in js/config.js.');
  else { const t0 = performance.now(); try { const r = await api.ping(); add('pass', 'Backend API', `Responded in ${Math.round(performance.now() - t0)} ms · server ${r.version || ''} · ${r.time || ''}`); } catch (e) { add('fail', 'Backend API', e.message, 'Check the Web App deployment: Execute as “Me”, access “Anyone”, URL ends in /exec.'); } }
  const gw = await resolveGateway();
  if (!gw) add('warn', 'Streaming gateway', 'Not configured. Single WHIP destinations work; RTMP platforms and multi-platform are unavailable.', 'Deploy the optional gateway (docs/GATEWAY_GUIDE.md) and add it in Device Settings.');
  else { const g = await checkGateway(); add(g.ok ? 'pass' : 'fail', 'Streaming gateway', (g.source ? g.source + ' · ' : '') + g.message + (g.ms ? ` (${g.ms} ms)` : ''), 'Check URL, HTTPS certificate, CORS and that the relay service is running.'); }
  return out;
}

export function renderDiagnostics(list, results) {
  list.innerHTML = results.map(r => `<li class="${r.status}"><span class="mark">${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✕' : '!'}</span><span><b>${esc(r.label)}</b>${r.detail ? '<br><span class="small muted">' + esc(r.detail) + '</span>' : ''}${r.status !== 'pass' && r.fix ? '<br><span class="small">Fix: ' + esc(r.fix) + '</span>' : ''}</span></li>`).join('');
}

export async function mountDiagnostics(root) {
  const list = $('#dg-list', root); let report = [];
  const run = async () => { list.innerHTML = '<li class="warn"><span class="mark">…</span><span>Running checks…</span></li>'; try { report = await runDiagnostics(); renderDiagnostics(list, report); } catch (e) { list.innerHTML = `<li class="fail"><span class="mark">✕</span><span>${esc(e.message)}</span></li>`; } paintEnv(); };
  const paintEnv = () => {
    const m = apiMetrics(); const env = { app: CONFIG.APP_NAME + ' ' + CONFIG.VERSION, time: new Date().toISOString(), userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, secure: window.isSecureContext, online: navigator.onLine, screen: `${screen.width}x${screen.height} @${devicePixelRatio}x`, api: { calls: m.calls, failures: m.failures, lastLatencyMs: m.lastLatency, lastError: m.lastError }, results: report.map(r => `${r.status.toUpperCase()}: ${r.label}`) };
    $('#dg-env', root).textContent = JSON.stringify(env, null, 2);
  };
  const types = recorderTypes(); $('#dg-codecs', root).innerHTML = `<h3>Recording formats your browser can produce</h3>` + (types.length ? `<ul>${types.map(t => `<li class="mono">${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">None detected.</p>') + '<p class="small muted">MP4 appears only if your browser really supports it.</p>';
  $('#dg-run', root).onclick = run; $('#dg-copy', root).onclick = async () => { try { await navigator.clipboard.writeText($('#dg-env', root).textContent); toast('Report copied', 'ok'); } catch { toast('Copy failed — select the text manually.', 'err'); } };
  paintEnv(); run();
}
