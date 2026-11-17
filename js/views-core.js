/* GD LIVE STUDIO — page controllers: Camera, Recording, Start Streaming, Broadcast Studio, Overlays.
 * Each mount function receives the page root and returns an optional cleanup function.
 */
import { $, $$, esc, h, icon, toast, modal, confirmDialog, badge, fmtBytes, fmtDuration, on, emit, sleep } from './ui.js';
import { cam, QUALITY, recorderTypes } from './camera.js';
import { compositor, TEMPLATES, DEFAULT_OVERLAY, fileToDataUrl } from './overlays.js';
import { recorder, recorderSupported, downloadRecording, extensionFor } from './recording.js';
import { broadcast, runCountdown, resolveGateway, checkGateway } from './streaming.js';
import { availableDestinations } from './platforms.js';
import { kvGet, kvSet, driveConnected, connectDrive, uploadToDrive, getRecording, updateRecording } from './storage.js';
import { state, feature, isUser } from './state.js';
import { api, apiConfigured } from './api.js';

/* ---------- shared helpers ---------- */
function seg(root, sel, get, set) {
  const el = $(sel, root); if (!el) return () => {};
  const paint = () => $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(get()))));
  el.addEventListener('click', async e => { const b = e.target.closest('button[data-v]'); if (!b) return; try { await set(b.dataset.v); } catch (err) { toast(err.message || String(err), 'err'); } paint(); });
  paint(); return paint;
}
function applyStageAspect(root) {
  const st = $('#stage', root); if (!st) return;
  st.classList.toggle('portrait', cam.s.orientation === 'portrait'); st.classList.toggle('landscape', cam.s.orientation !== 'portrait');
}
function showMediaError(root, boxSel, e) {
  const box = $(boxSel, root); if (!box) return;
  if (!e) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = `<strong>${esc(e.title)}</strong>${esc(e.message)}<br><span class="muted">${esc(e.fix || '')}</span>`;
}
function paintPerms(root) {
  const m = { granted: 'Allowed', denied: 'Blocked', prompt: 'Not asked yet', unknown: 'Not asked yet' };
  for (const [id, key, label] of [['#perm-cam', 'camera', 'Camera'], ['#perm-mic', 'microphone', 'Microphone']]) {
    const el = $(id, root); if (!el) continue; const st = cam.permission[key] || 'unknown';
    el.className = 'perm ' + (st === 'granted' ? 'granted' : st === 'denied' ? 'denied' : 'prompt'); el.innerHTML = `<i></i>${label}: <b>${m[st] || st}</b>`;
  }
}
function meterLoop(root, sel = '#meter') {
  const el = $(sel, root); let raf; const tick = () => { if (el) el.style.width = Math.round(cam.level() * 100) + '%'; raf = requestAnimationFrame(tick); }; tick();
  return () => cancelAnimationFrame(raf);
}
function paintMicButton(btn) { if (!btn) return; const on = cam.s.micOn !== false; btn.innerHTML = icon(on ? 'mic' : 'mic-off'); btn.classList.toggle('on', on); btn.title = on ? 'Microphone on' : 'Microphone muted'; btn.setAttribute('aria-pressed', String(on)); }
async function startCameraSafely(root, errSel) {
  try { await cam.start(); showMediaError(root, errSel, null); return true; }
  catch (e) { showMediaError(root, errSel, e.title ? e : { title: 'Camera error', message: String(e.message || e), fix: '' }); return false; }
}
function drawStageCanvas(canvas) {
  const src = compositor.canvas; if (!canvas) return () => {};
  const ctx = canvas.getContext('2d'); let raf;
  const loop = () => { if (canvas.width !== src.width || canvas.height !== src.height) { canvas.width = src.width; canvas.height = src.height; } ctx.drawImage(src, 0, 0); raf = requestAnimationFrame(loop); };
  loop(); return () => cancelAnimationFrame(raf);
}
async function doCountdown(root, seconds) {
  if (!seconds) return;
  const box = $('#countdown', root); if (!box) return; box.hidden = false;
  await runCountdown(seconds, n => { box.textContent = n > 0 ? n : 'GO'; }); box.hidden = true;
}
const fsOf = root => async () => { const ok = await cam.enterFullscreen($('#stage', root)); if (!ok) toast('Full-screen is not supported on this browser.', 'err'); };

/* =========================== CAMERA STUDIO =========================== */
export async function mountCamera(root) {
  await cam.init(); const offs = []; const video = $('#preview', root);
  const paintAll = () => {
    applyStageAspect(root); paintPerms(root); cam.attachPreview(video);
    $('#stage-ph', root).hidden = cam.running && cam.s.camOn !== false;
    $('.lbl', $('#b-start', root)).textContent = cam.running ? 'Stop Camera' : 'Start Camera';
    $('#b-start', root).classList.toggle('danger', cam.running); $('#b-start', root).classList.toggle('accent', !cam.running);
    paintMicButton($('#b-mic', root)); $('#b-cam', root).innerHTML = icon(cam.s.camOn !== false ? 'camera' : 'camera-off');
    $('#mic-state', root).textContent = !cam.audioTrack() ? (cam.running ? 'No microphone' : '') : cam.s.micOn ? 'Mic on' : 'Muted';
    const chip = $('#chip-res', root); const a = cam.actual?.video;
    chip.hidden = !a; if (a) $('span', chip).textContent = `${a.width || '?'}×${a.height || '?'} @ ${Math.round(a.frameRate || 0)} fps`;
    const info = $('#cam-actual', root);
    info.innerHTML = cam.running && a ? `<b>Actual output:</b> ${a.width}×${a.height}, ${Math.round(a.frameRate || 0)} fps · ${esc(cam.actual.videoLabel || 'camera')} · ${esc(cam.actual.audioLabel || 'no microphone')}` : 'Actual camera output appears here after the camera starts.';
    const cap = cam.capabilities(); const zw = $('#zoom-wrap', root);
    if (cam.running && cap.zoom) { zw.hidden = false; const r = $('#rng-zoom', root); r.min = cap.zoom.min; r.max = cap.zoom.max; r.step = cap.zoom.step || 0.1; r.value = cam.actual.video.zoom || cap.zoom.min; $('#zoom-na', root).hidden = true; } else { zw.hidden = true; $('#zoom-na', root).hidden = false; }
    $('#mon-wrap', root).hidden = !cam.monitorSupported && cam.running; $('#chk-mirror', root).checked = !!cam.s.mirror;
    $('#b-flip', root).disabled = cam.devices.video.length < 2 && cam.running && cam.s.facing && false;
  };
  const fillDevices = () => {
    const fill = (sel, list, cur, def) => { const s = $(sel, root); s.innerHTML = `<option value="">${def}</option>` + list.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || def + ' ' + (i + 1))}</option>`).join(''); s.value = cur || ''; };
    fill('#sel-cam', cam.devices.video, cam.s.videoDeviceId, 'Default camera'); fill('#sel-mic', cam.devices.audio, cam.s.audioDeviceId, 'Default microphone');
  };
  offs.push(cam.on('started', paintAll), cam.on('stopped', paintAll), cam.on('settings', paintAll), cam.on('permission', () => paintPerms(root)), cam.on('devices', fillDevices));
  offs.push(cam.on('error', e => { showMediaError(root, '#cam-error', e); paintAll(); }), cam.on('interrupted', v => { $('#cam-interrupt', root).hidden = !v; }));
  $('#b-start', root).onclick = async () => { if (cam.running) { cam.stop(); } else await startCameraSafely(root, '#cam-error'); paintAll(); };
  $('#b-flip', root).onclick = async () => { try { if (!cam.running) await startCameraSafely(root, '#cam-error'); const r = await cam.switchFacing(); if (cam.devices.video.length < 2) toast('Only one camera was found on this device.', ''); else if (r.changed === false) toast('The browser kept the same camera. Pick one in Devices.', ''); } catch (e) { showMediaError(root, '#cam-error', e); } paintAll(); };
  $('#b-mic', root).onclick = () => { cam.toggleMic(); paintAll(); };
  $('#b-cam', root).onclick = () => { cam.toggleCam(); paintAll(); };
  $('#b-fs', root).onclick = fsOf(root);
  $('#sel-cam', root).onchange = async e => { try { await cam.selectVideoDevice(e.target.value); } catch (er) { showMediaError(root, '#cam-error', er); } };
  $('#sel-mic', root).onchange = async e => { try { await cam.selectAudioDevice(e.target.value); } catch (er) { showMediaError(root, '#cam-error', er); } };
  $('#chk-mirror', root).onchange = e => { cam.setMirror(e.target.checked); paintAll(); };
  $('#sel-fit', root).value = compositor.fit; $('#sel-fit', root).onchange = e => compositor.setFit(e.target.value);
  $('#rng-zoom', root).oninput = e => cam.setZoom(e.target.value);
  $('#chk-monitor', root).onchange = e => { cam.setMonitor(e.target.checked); if (e.target.checked) toast('Monitoring on — use headphones to avoid feedback.'); };
  const ct = $('#sel-count', root); ct.value = String(cam.s.countdown ?? 0); ct.onchange = e => { cam.s.countdown = Number(e.target.value); cam.save(); };
  seg(root, '#seg-orient', () => cam.s.orientation, v => cam.setOrientation(v));
  seg(root, '#seg-quality', () => cam.s.quality, async v => { await cam.setQuality(v); $('#custom-q', root).hidden = v !== 'custom'; });
  const cq = cam.s.custom; $('#cq-w', root).value = cq.w; $('#cq-h', root).value = cq.h; $('#cq-fps', root).value = cq.fps; $('#cq-br', root).value = Math.round(cq.vbr / 1000); $('#custom-q', root).hidden = cam.s.quality !== 'custom';
  for (const id of ['cq-w', 'cq-h', 'cq-fps', 'cq-br']) $('#' + id, root).onchange = () => cam.setQuality('custom', { w: +$('#cq-w', root).value || 1280, h: +$('#cq-h', root).value || 720, fps: +$('#cq-fps', root).value || 30, vbr: (+$('#cq-br', root).value || 2500) * 1000 });
  offs.push(meterLoop(root)); fillDevices(); paintAll();
  return () => offs.forEach(f => f());
}

/* =========================== RECORDING STUDIO =========================== */
export async function mountRecord(root) {
  await cam.init(); await compositor.load(); const offs = [];
  if (!recorderSupported()) $('#rec-unsupported', root).hidden = false;
  const canvas = $('#rec-canvas', root); const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000';
  const stage = $('#stage', root);
  // Preview: show the raw camera (or the composited program when overlays are enabled)
  canvas.replaceWith(video); video.id = 'rec-video';
  let stopDraw = () => {}, usingComp = false;
  const setPreview = () => {
    const wantOverlays = $('#r-overlays', root).checked;
    if (wantOverlays && !usingComp) { video.replaceWith(canvas); compositor.acquire('rec-preview'); stopDraw = drawStageCanvas(canvas); usingComp = true; }
    else if (!wantOverlays) { if (usingComp) { stopDraw(); compositor.release('rec-preview'); canvas.replaceWith(video); usingComp = false; } cam.attachPreview(video); }
  };
  const mimeSel = $('#r-mime', root); const types = recorderTypes();
  mimeSel.innerHTML = types.length ? types.map(t => `<option value="${esc(t)}">${esc(t.split(';')[0])}${/codecs=([^;]+)/.test(t) ? ' (' + esc(t.match(/codecs=([^;]+)/)[1]) + ')' : ''}</option>`).join('') : '<option value="">Browser default</option>';
  $('#r-mime-hint', root).textContent = types.length ? `${types.length} supported by this browser` : 'Could not detect';
  $('#r-title', root).value = '';
  const paint = () => {
    applyStageAspect(root); paintMicButton($('#r-mic', root)); cam.attachPreview(video); $('#stage-ph', root).hidden = cam.running && cam.s.camOn !== false;
    $('.lbl', $('#r-cam', root)).textContent = cam.running ? 'Stop Camera' : 'Start Camera';
    const st = recorder.state; const busy = st === 'recording' || st === 'paused' || st === 'stopping';
    $('#r-start', root).disabled = !cam.running || busy || !recorderSupported(); $('#r-pause', root).disabled = st !== 'recording'; $('#r-pause', root).hidden = st === 'paused';
    $('#r-resume', root).hidden = st !== 'paused'; $('#r-stop', root).disabled = !(st === 'recording' || st === 'paused');
    $('#r-cam', root).disabled = busy; $('#r-flip', root).disabled = busy; $('#r-overlays', root).disabled = busy; mimeSel.disabled = busy;
    $('#rec-chip', root).hidden = st !== 'recording'; $('#rec-badge', root).innerHTML = st === 'recording' ? badge('recording', 'Recording') : st === 'paused' ? badge('testing', 'Paused') : cam.running ? badge('ready', 'Ready') : badge('disconnected', 'Camera off');
    emit('rec:ui', { state: st });
  };
  offs.push(cam.on('started', paint), cam.on('stopped', paint), cam.on('settings', paint), cam.on('error', e => showMediaError(root, '#rec-error', e)));
  offs.push(recorder.on('state', paint), recorder.on('tick', ({ sec, size }) => { $('#rec-timer', root).textContent = fmtDuration(sec); $('#rec-size', root).textContent = fmtBytes(size); }));
  offs.push(recorder.on('error', e => { showMediaError(root, '#rec-error', { title: 'Recording problem', message: e.message, fix: e.blob ? 'Use the download button below.' : '' }); if (e.blob) { const rec = { blob: e.blob, mime: e.blob.type, title: e.meta?.title || 'recording' }; $('#last-card', root).hidden = false; $('#last-video', root).src = URL.createObjectURL(e.blob); $('#last-dl', root).onclick = () => downloadRecording(rec); } }));
  let last = null;
  offs.push(recorder.on('saved', rec => { last = rec; $('#last-card', root).hidden = false; const v = $('#last-video', root); if (v.src) URL.revokeObjectURL(v.src); v.src = URL.createObjectURL(rec.blob); toast('Recording saved on this device', 'ok'); $('#rec-timer', root).textContent = '00:00'; }));
  $('#last-dl', root).onclick = () => last && downloadRecording(last);
  $('#last-drive', root).onclick = () => last && saveToDriveFlow(last);
  $('#r-cam', root).onclick = async () => { if (cam.running) cam.stop(); else await startCameraSafely(root, '#rec-error'); paint(); };
  $('#r-flip', root).onclick = async () => { try { if (!cam.running) await startCameraSafely(root, '#rec-error'); await cam.switchFacing(); } catch (e) { showMediaError(root, '#rec-error', e); } paint(); };
  $('#r-mic', root).onclick = () => { cam.toggleMic(); paint(); }; $('#r-fs', root).onclick = fsOf(root);
  $('#r-overlays', root).onchange = setPreview;
  $('#r-quality', root).value = cam.s.quality; $('#r-quality', root).onchange = e => cam.setQuality(e.target.value);
  const rc = $('#r-count', root); rc.value = String(cam.s.countdown ?? 0); rc.onchange = e => { cam.s.countdown = Number(e.target.value); cam.save(); };
  seg(root, '#seg-orient', () => cam.s.orientation, v => cam.setOrientation(v));
  $('#r-start', root).onclick = async () => {
    showMediaError(root, '#rec-error', null);
    try { await doCountdown(root, Number(rc.value)); await recorder.start({ title: $('#r-title', root).value, withOverlays: $('#r-overlays', root).checked, mime: mimeSel.value }); }
    catch (e) { showMediaError(root, '#rec-error', { title: 'Cannot record', message: e.message, fix: '' }); }
    paint();
  };
  $('#r-pause', root).onclick = () => recorder.pause(); $('#r-resume', root).onclick = () => recorder.resume(); $('#r-stop', root).onclick = () => recorder.stop();
  offs.push(meterLoop(root)); setPreview(); paint(); if (recorder.state !== 'idle') paint();
  return () => { offs.forEach(f => f()); stopDraw(); if (usingComp) compositor.release('rec-preview'); const v = $('#last-video', root); if (v?.src?.startsWith('blob:')) URL.revokeObjectURL(v.src); };
}

/** Explicit-consent Drive upload used by recordings and the recording studio. */
export async function saveToDriveFlow(rec) {
  if (!state.config.features.drive_storage) return toast('Drive storage is turned off by the owner.', 'err');
  const ok = await confirmDialog('Upload to your Google Drive?', `"${rec.title}" (${fmtBytes(rec.size || rec.blob?.size)}) will be uploaded to a "GD LIVE STUDIO Recordings" folder in YOUR Google Drive. GD TECH ACADEMY does not receive the file. This app can only access files it creates itself.` + (isUser() && apiConfigured() ? ' A small metadata record (title, size, Drive file ID) is saved to your account so you can find it later.' : ''), 'Upload');
  if (!ok) return;
  const msg = toast('Connecting to Google Drive…', '', { sticky: true });
  try {
    await connectDrive();
    const res = await uploadToDrive(rec.blob, (rec.title || 'recording').replace(/[^\w .-]+/g, '_') + '.' + extensionFor(rec.mime), p => { msg.firstChild.textContent = `Uploading… ${Math.round(p * 100)}%`; });
    if (rec.id) await updateRecording(rec.id, { storage: 'device+drive', driveId: res.id, driveLink: res.webViewLink || '' }).catch(() => {});
    // Signed-in users: mirror a small metadata record (title, size, Drive file ID — never the video) so the file can be found later.
    if (isUser() && apiConfigured()) { try { await api.recSave({ title: rec.title, durationSec: rec.duration || 0, sizeBytes: rec.size || rec.blob?.size || 0, mime: rec.mime, orientation: rec.orientation, storage: 'drive', driveFileId: res.id }); } catch (e) { toast('Uploaded, but could not save the record to your account: ' + e.message, 'err'); } }
    msg.remove(); toast('Uploaded to your Google Drive', 'ok');
  } catch (e) { msg.remove(); toast(e.message || 'Upload failed', 'err'); }
}

/* =========================== START STREAMING =========================== */
export async function mountGoLive(root) {
  await cam.init(); const offs = []; let mode = 'single'; let specs = []; let selected = new Set(); let checks = []; let scheduleId = '';
  const privacy = $('#gl-privacy', root);
  const draft = await kvGet('draft', {}); $('#gl-title', root).value = draft.title || state.user?.defaultTitle || ''; $('#gl-desc', root).value = draft.desc || ''; privacy.value = draft.privacy || 'unlisted';
  const saveDraft = () => kvSet('draft', { title: $('#gl-title', root).value, desc: $('#gl-desc', root).value, privacy: privacy.value }).catch(() => {});
  for (const id of ['#gl-title', '#gl-desc', '#gl-privacy']) $(id, root).addEventListener('change', saveDraft);
  const paintBadge = () => { const s = broadcast.status; $('#gl-badge', root).innerHTML = s === 'broadcasting' ? badge('broadcasting', 'Broadcasting') : s === 'idle' ? badge(cam.running ? 'ready' : 'disconnected', cam.running ? 'Ready' : 'Camera off') : badge(s === 'error' ? 'error' : 'testing', s[0].toUpperCase() + s.slice(1)); };
  const modeNote = async () => {
    const n = $('#gl-mode-note', root); const gw = await resolveGateway();
    if (mode === 'single') n.innerHTML = 'Sends one stream to one destination. WHIP endpoints connect directly. YouTube, Facebook and RTMP destinations need a relay gateway because browsers cannot speak RTMP.';
    else if (!gw?.relayApi) { n.className = 'notice err small mt'; n.innerHTML = '<strong>Multi-platform is unavailable</strong>No relay gateway is configured. Multi-platform streaming needs a self-hosted open-source gateway (see Device Settings and docs/GATEWAY_GUIDE.md). It will not be shown as working until a real relay answers its health check.'; return; }
    else n.innerHTML = `Sends one WebRTC stream to your gateway (${esc(gw.source)}), which relays it to every selected RTMP destination. Each destination has its own status.`;
    n.className = 'notice small mt';
  };
  const renderDests = async () => {
    specs = await availableDestinations(); const box = $('#gl-dests', root); box.innerHTML = '';
    for (const s of specs) {
      const ok = s.ready !== false; const input = h('input', { type: mode === 'multi' ? 'checkbox' : 'radio', name: 'dest', value: s.key, disabled: !ok || (mode === 'multi' && s.ingest === 'whip') });
      input.checked = selected.has(s.key) && !input.disabled; input.onchange = () => { if (mode === 'single') selected = new Set([s.key]); else input.checked ? selected.add(s.key) : selected.delete(s.key); recheck(); };
      box.append(h('label', { class: 'dest-card', style: ok ? '' : 'opacity:.6' }, input, h('div', { class: 'body' }, h('b', {}, s.label), h('span', { class: 'small muted' }, ok ? (s.ingest === 'whip' ? 'Direct WebRTC/WHIP' : 'Via relay gateway') : s.reason || 'Unavailable'))));
    }
    if (!specs.length) box.append(h('div', { class: 'empty' }, 'No destinations yet. Connect a platform or add one.'));
  };
  const chosen = () => specs.filter(s => selected.has(s.key));
  const recheck = async () => {
    const ul = $('#gl-checks', root); ul.innerHTML = '<li class="warn"><span class="mark">…</span><span>Checking…</span></li>';
    try { checks = await broadcast.preflight({ mode, specs: chosen() }); } catch (e) { checks = [{ ok: false, label: 'Check failed', detail: e.message }]; }
    ul.innerHTML = checks.map(c => `<li class="${c.ok ? 'pass' : c.warn ? 'warn' : 'fail'}"><span class="mark">${c.ok ? '✓' : c.warn ? '!' : '✕'}</span><span><b>${esc(c.label)}</b>${!c.ok && c.detail ? '<br><span class="muted small">' + esc(c.detail) + '</span>' : ''}</span></li>`).join('');
    $('#gl-go', root).disabled = checks.some(c => !c.ok && !c.warn) || ['preparing', 'connecting', 'broadcasting'].includes(broadcast.status);
  };
  seg(root, '#gl-mode', () => mode, async v => { mode = v; if (mode === 'single' && selected.size > 1) selected = new Set([[...selected][0]]); if (mode === 'multi') selected = new Set([...selected].filter(k => specs.find(s => s.key === k)?.ingest === 'rtmp')); await modeNote(); await renderDests(); await recheck(); });
  seg(root, '#seg-orient', () => cam.s.orientation, v => cam.setOrientation(v));
  seg(root, '#seg-quality', () => cam.s.quality, v => cam.setQuality(v));
  const gc = $('#gl-count', root); gc.value = String(cam.s.countdown ?? 0); gc.onchange = e => { cam.s.countdown = Number(e.target.value); cam.save(); };
  // presets (never contain stream keys)
  const loadPresets = async () => { const list = await kvGet('presets', []); const sel = $('#gl-preset', root); sel.innerHTML = '<option value="">Select a preset…</option>' + list.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join(''); return list; };
  $('#gl-preset-save', root).onclick = async () => {
    const f = h('input', { type: 'text', maxlength: 40, placeholder: 'Preset name' });
    const r = await modal({ title: 'Save preset', body: h('div', {}, h('label', { class: 'field' }, 'Name', f)), actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Save', class: 'accent', value: true }] });
    if (!r || !f.value.trim()) return; const list = await kvGet('presets', []);
    list.push({ name: f.value.trim(), mode, title: $('#gl-title', root).value, desc: $('#gl-desc', root).value, privacy: privacy.value, orientation: cam.s.orientation, quality: cam.s.quality, destinations: [...selected] });
    await kvSet('presets', list); await loadPresets(); toast('Preset saved', 'ok');
  };
  $('#gl-preset-load', root).onclick = async () => {
    const list = await kvGet('presets', []); const p = list[+$('#gl-preset', root).value]; if (!p) return toast('Choose a preset first.');
    $('#gl-title', root).value = p.title || ''; $('#gl-desc', root).value = p.desc || ''; privacy.value = p.privacy || 'unlisted'; await cam.setOrientation(p.orientation); await cam.setQuality(p.quality);
    mode = p.mode || 'single'; selected = new Set(p.destinations || []); await modeNote(); await renderDests(); await recheck(); $$('#gl-mode button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === mode))); toast('Preset loaded');
  };
  $('#gl-preset-del', root).onclick = async () => { const list = await kvGet('presets', []); const i = +$('#gl-preset', root).value; if (isNaN(i) || !list[i]) return toast('Choose a preset first.'); if (!await confirmDialog('Delete preset?', `Delete "${list[i].name}"?`, 'Delete', true)) return; list.splice(i, 1); await kvSet('presets', list); await loadPresets(); };
  $('#gl-recheck', root).onclick = recheck;
  $('#gl-go', root).onclick = async () => {
    saveDraft(); $('#gl-error', root).hidden = true; const btn = $('#gl-go', root); btn.disabled = true;
    try {
      const warn = checks.filter(c => c.warn && !c.ok);
      if (warn.length && !await confirmDialog('Go live with warnings?', warn.map(w => w.label + ': ' + w.detail).join(' '), 'Go live anyway')) { btn.disabled = false; return; }
      const sel = chosen(); const names = sel.map(s => s.label).join(', ');
      if (!await confirmDialog('Go live now?', `You are about to broadcast "${$('#gl-title', root).value || 'Untitled stream'}" to: ${names}.`, 'Go live')) { btn.disabled = false; return; }
      await doCountdown(root.closest('.page') || root, 0);
      const s = Number(gc.value); if (s) { const ov = h('div', { class: 'modal-backdrop' }, h('div', { class: 'countdown', style: 'position:static;background:none;font-size:9rem;color:#fff' }, String(s))); document.body.append(ov); await runCountdown(s, n => { ov.firstChild.textContent = n > 0 ? n : 'GO'; }); ov.remove(); }
      await broadcast.start({ title: $('#gl-title', root).value.trim(), description: $('#gl-desc', root).value.trim(), privacy: privacy.value, madeForKids: $('#gl-kids', root).checked, mode, specs: sel, scheduleId });
      location.hash = '#/studio';
    } catch (e) { const box = $('#gl-error', root); box.hidden = false; box.innerHTML = `<strong>Could not start the broadcast</strong>${esc(e.message)}`; }
    paintBadge(); recheck();
  };
  offs.push(on('broadcast:update', () => { paintBadge(); }), cam.on('started', () => { paintBadge(); recheck(); }), cam.on('stopped', () => { paintBadge(); recheck(); }));
  await loadPresets(); await modeNote(); await renderDests(); paintBadge(); await recheck(); offs.push(on('platforms:changed', async () => { await renderDests(); recheck(); }));
  // Opened from the scheduler: prefill from the scheduled event (the scheduler never marks it Live itself)
  const schedId = new URLSearchParams((location.hash.split('?')[1]) || '').get('schedule');
  if (schedId) {
    try {
      const items = (await kvGet('schedCache', [])).concat(await kvGet('schedLocal', [])); const it = items.find(x => x.id === schedId);
      if (it) { $('#gl-title', root).value = it.title || ''; $('#gl-desc', root).value = it.description || ''; if (it.privacy) privacy.value = it.privacy; selected = new Set(specs.filter(s => (it.platforms || []).includes(s.platform) && s.ready !== false).map(s => s.key)); if (selected.size > 1) { mode = 'multi'; $$('#gl-mode button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === mode))); } scheduleId = it.id; toast('Loaded “' + it.title + '” from your schedule'); await modeNote(); await renderDests(); await recheck(); }
    } catch { /* optional convenience */ }
  }
  return () => offs.forEach(f => f());
}

/* =========================== BROADCAST STUDIO =========================== */
export async function mountStudio(root) {
  await cam.init(); await compositor.load(); const offs = []; compositor.acquire('studio-view');
  const stop = drawStageCanvas($('#bs-canvas', root)); offs.push(stop, () => compositor.release('studio-view'), meterLoop(root));
  let timer;
  const paint = snap => {
    snap = snap || broadcast.snapshot(); applyStageAspect(root); paintMicButton($('#bs-mic', root));
    const live = snap.status === 'broadcasting'; $('#bs-chip', root).hidden = !live; $('#bs-stop', root).disabled = !(live || snap.status === 'connecting');
    $('#bs-badge', root).innerHTML = live ? badge('broadcasting', 'Broadcasting') : snap.status === 'idle' ? badge(cam.running ? 'ready' : 'disconnected', cam.running ? 'Ready' : 'Camera off') : badge(snap.status === 'error' ? 'error' : 'testing', snap.status[0].toUpperCase() + snap.status.slice(1));
    const eb = $('#bs-error', root); eb.hidden = !snap.error; eb.innerHTML = snap.error ? `<strong>Broadcast problem</strong>${esc(snap.error)}` : '';
    const nb = $('#bs-notice', root); nb.hidden = !broadcast.lastNotice || !live; nb.textContent = broadcast.lastNotice || '';
    const box = $('#bs-dests', root);
    box.innerHTML = snap.dests.length ? '' : '<div class="empty">Not broadcasting. <a href="#/go-live">Start streaming</a></div>';
    for (const d of snap.dests) {
      const cls = d.status === 'Live' ? 'live' : /Error/.test(d.status) ? 'error' : /Sending/.test(d.status) ? 'testing' : d.status === 'Completed' ? 'completed' : 'testing';
      box.append(h('div', { class: 'dest-card' }, h('div', { class: 'body' }, h('b', {}, d.label), h('span', { class: 'small muted' }, d.detail || ''), d.link ? h('a', { href: d.link, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Open on platform') : null), h('span', { html: badge(cls, d.status) })));
    }
    const s = snap.stats; const hl = $('#bs-health', root);
    hl.innerHTML = s ? `<span>Connection health</span><b class="health ${s.health}">${s.health === 'good' ? 'Good' : s.health === 'fair' ? 'Fair' : 'Poor'}</b><span>Bitrate</span><b>${s.kbps != null ? s.kbps + ' kbps' : '—'}</b><span>Frame rate</span><b>${s.fps ? Math.round(s.fps) + ' fps' : '—'}</b><span>Resolution</span><b>${s.w ? s.w + '×' + s.h : '—'}</b><span>Round trip</span><b>${s.rttMs != null ? s.rttMs + ' ms' : '—'}</b><span>Limited by</span><b>${esc(s.limit && s.limit !== 'none' ? s.limit : '—')}</b>` : '<span>Status</span><b>—</b>';
    $('#bs-stats', root).textContent = s?.kbps != null ? `${s.kbps} kbps · ${s.rttMs ?? '—'} ms` : '';
  };
  offs.push(on('broadcast:update', paint)); timer = setInterval(() => { $('#bs-timer', root).textContent = fmtDuration(broadcast.elapsed()); }, 500); offs.push(() => clearInterval(timer));
  $('#bs-stop', root).onclick = async () => { if (await confirmDialog('Stop broadcast?', 'This ends the stream on every destination.', 'Stop broadcast', true)) { await broadcast.stop('user'); toast('Broadcast stopped', 'ok'); } };
  $('#bs-flip', root).onclick = async () => { try { await cam.switchFacing(); } catch (e) { toast(e.message || 'Could not switch camera', 'err'); } };
  $('#bs-mic', root).onclick = () => { cam.toggleMic(); paint(); }; $('#bs-fs', root).onclick = fsOf(root);
  seg(root, '#bs-scene', () => compositor.s.scene, v => { compositor.s.scene = v; });
  $('#bs-lt', root).checked = !!compositor.s.lowerThirdOn; $('#bs-lt', root).onchange = e => compositor.update({ lowerThirdOn: e.target.checked });
  offs.push(cam.on('settings', paint)); paint();
  return () => offs.forEach(f => f());
}

/* =========================== OVERLAYS =========================== */
export async function mountOverlays(root) {
  await cam.init(); await compositor.load(); const offs = []; compositor.acquire('overlay-editor'); offs.push(() => compositor.release('overlay-editor'), drawStageCanvas($('#ov-canvas', root)));
  const S = () => compositor.s; const upd = p => compositor.update(p);
  const bindText = (id, key) => { const el = $(id, root); el.value = S()[key] ?? ''; el.oninput = () => upd({ [key]: el.value }); };
  const bindChk = (id, key) => { const el = $(id, root); el.checked = !!S()[key]; el.onchange = () => upd({ [key]: el.checked }); };
  bindText('#ov-channel', 'channelName'); bindText('#ov-title', 'title'); bindText('#ov-website', 'website'); bindText('#ov-handle', 'handle'); bindText('#ov-watermark', 'watermarkText'); bindText('#ov-free', 'freeText');
  bindText('#ov-lt-name', 'lowerThirdName'); bindText('#ov-lt-role', 'lowerThirdRole'); bindText('#ov-ban', 'banner'); bindText('#ov-start', 'startingText'); bindText('#ov-end', 'endingText');
  bindChk('#ov-dt', 'showDateTime'); bindChk('#ov-logo', 'showLogo'); bindChk('#ov-lt-on', 'lowerThirdOn'); bindChk('#ov-ban-on', 'bannerOn');
  $('#ov-free-pos', root).value = S().freeTextPos; $('#ov-free-pos', root).onchange = e => upd({ freeTextPos: e.target.value });
  $('#ov-img-pos', root).value = S().customImagePos; $('#ov-img-pos', root).onchange = e => upd({ customImagePos: e.target.value });
  const paintLogoLock = () => { const lock = compositor.template().lockLogo; const c = $('#ov-logo', root); c.checked = lock || S().showLogo; c.disabled = lock; };
  const tg = $('#ov-templates', root);
  const renderTpl = () => { tg.innerHTML = ''; for (const t of TEMPLATES) tg.append(h('button', { type: 'button', 'aria-pressed': String(S().template === t.id), onclick: () => { upd({ template: t.id }); renderTpl(); paintLogoLock(); } }, h('span', { class: 'sw', style: `background:linear-gradient(90deg,${t.a},${t.b})` }), h('b', {}, t.name), h('span', { class: 'small muted' }, t.note))); };
  renderTpl(); paintLogoLock();
  seg(root, '#seg-orient', () => cam.s.orientation, v => { cam.setOrientation(v); applyStageAspect(root); });
  seg(root, '#seg-scene', () => S().scene, v => { compositor.s.scene = v; });
  applyStageAspect(root);
  $('#ov-cam', root).onclick = async () => { if (cam.running) { cam.stop(); } else { try { await cam.start(); } catch (e) { toast(e.title ? e.title + ': ' + e.message : e.message, 'err'); } } $('.lbl', $('#ov-cam', root)).textContent = cam.running ? 'Stop camera preview' : 'Use camera in preview'; };
  $('.lbl', $('#ov-cam', root)).textContent = cam.running ? 'Stop camera preview' : 'Use camera in preview';
  const img = async (id, key) => { const f = $(id, root).files[0]; if (!f) return; try { upd({ [key]: await fileToDataUrl(f) }); toast('Image added', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  $('#ov-img', root).onchange = () => img('#ov-img', 'customImage'); $('#ov-logo2', root).onchange = () => img('#ov-logo2', 'secondaryLogo');
  $('#ov-img-clear', root).onclick = () => { upd({ customImage: null, secondaryLogo: null }); $('#ov-img', root).value = ''; $('#ov-logo2', root).value = ''; };
  $('#ov-reset', root).onclick = async () => { if (!await confirmDialog('Reset overlays?', 'All overlay text, images and options return to defaults.', 'Reset', true)) return; compositor.s = { ...DEFAULT_OVERLAY }; await compositor.save(); await mountOverlaysRefresh(root); };
  offs.push(cam.on('settings', () => applyStageAspect(root)));
  return () => offs.forEach(f => f());
}
async function mountOverlaysRefresh(root) { location.hash = '#/overlays?r=' + Date.now(); }
