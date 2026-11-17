/* GD LIVE STUDIO — camera & microphone manager (MediaDevices / getUserMedia / MediaStream).
 * One shared instance (`cam`) keeps the same MediaStream alive while the user moves between pages.
 * Nothing here promises a resolution or frame rate: actual values are always read back from the track.
 */
import { ls } from './storage.js';

export const QUALITY = {
  low:      { label: 'Low bandwidth', w: 640,  h: 360,  fps: 24, vbr: 800000,  abr: 64000 },
  standard: { label: 'Standard',      w: 1280, h: 720,  fps: 30, vbr: 2500000, abr: 128000 },
  hd:       { label: 'HD',            w: 1920, h: 1080, fps: 30, vbr: 4500000, abr: 128000 },
  custom:   { label: 'Custom',        w: 1280, h: 720,  fps: 30, vbr: 2500000, abr: 128000 }
};

const DEFAULTS = { videoDeviceId: '', audioDeviceId: '', facing: 'user', orientation: 'landscape', quality: 'standard', custom: { w: 1280, h: 720, fps: 30, vbr: 2500000 }, mirror: true, micOn: true, camOn: true };

export function explainMediaError(e) {
  const n = e?.name || 'Error';
  if (!window.isSecureContext) return { title: 'Secure connection required', message: 'Camera and microphone only work on HTTPS (or localhost).', fix: 'Open the app through its https:// GitHub Pages address.' };
  if (n === 'NotAllowedError' || n === 'SecurityError') return { title: 'Permission blocked', message: 'The browser or your device blocked access to the camera/microphone.', fix: 'Tap the lock/camera icon in the address bar, set Camera and Microphone to "Allow", then press Start Camera again. On Android also check Settings > Apps > your browser > Permissions.' };
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return { title: 'No camera or microphone found', message: 'The browser could not find the requested device.', fix: 'Connect a camera/microphone, or choose another device in Device Settings. You can start with the microphone off or camera off.' };
  if (n === 'NotReadableError' || n === 'TrackStartError') return { title: 'Camera is busy', message: 'Another app or browser tab is using the camera or microphone.', fix: 'Close other apps/tabs that use the camera (video calls, other camera apps) and try again.' };
  if (n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError') return { title: 'Settings not supported', message: 'This device cannot deliver the requested camera settings.', fix: 'Choose a lower quality preset or the default camera.' };
  if (n === 'AbortError') return { title: 'Camera start aborted', message: 'The device could not be started.', fix: 'Try again, or restart the browser.' };
  if (n === 'TypeError') return { title: 'Not supported', message: 'This browser does not support camera access (getUserMedia).', fix: 'Use a current version of Chrome, Edge, Firefox or Safari.' };
  return { title: 'Camera error', message: e?.message || String(e), fix: 'Try again. If it keeps failing, open Diagnostics.' };
}

class CameraManager extends EventTarget {
  constructor() {
    super();
    this.s = { ...DEFAULTS, ...(ls.get('cam.settings', {}) || {}), custom: { ...DEFAULTS.custom, ...((ls.get('cam.settings', {}) || {}).custom || {}) } };
    this.stream = null;
    this.running = false;
    this.devices = { video: [], audio: [] };
    this.permission = { camera: 'unknown', microphone: 'unknown' };
    this.lastError = null;
    this.actual = null;           // actual track settings
    this.interrupted = false;
    this.src = document.createElement('video'); // hidden frame source for the compositor
    this.src.muted = true; this.src.playsInline = true; this.src.autoplay = true; this.src.setAttribute('playsinline', '');
    Object.assign(this.src.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '-10px', top: '-10px' });
    this.ctx = null; this.analyser = null; this.monitorGain = null; this.meterBuf = null; this.wake = null;
    this._inited = false;
  }
  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  on(name, fn) { const h = e => fn(e.detail); this.addEventListener(name, h); return () => this.removeEventListener(name, h); }
  save() { ls.set('cam.settings', this.s); }

  async init() {
    if (this._inited) return; this._inited = true;
    document.body.append(this.src);
    if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDevices());
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.wake === 'wanted') this.requestWake(); });
    await this.queryPermissions(); await this.refreshDevices();
  }

  get supported() { return !!navigator.mediaDevices?.getUserMedia; }
  get mirrorEffective() { return !!(this.s.mirror && this.s.facing === 'user'); }
  get aspect() { return this.s.orientation === 'portrait' ? 9 / 16 : 16 / 9; }
  quality() {
    const q = this.s.quality === 'custom' ? { ...QUALITY.custom, ...this.s.custom, abr: 128000 } : QUALITY[this.s.quality] || QUALITY.standard;
    return q;
  }
  /** Output (program) dimensions for the selected orientation, matching the preset's long/short edge. */
  outputSize() {
    const q = this.quality(); const long = Math.max(q.w, q.h), short = Math.min(q.w, q.h);
    return this.s.orientation === 'portrait' ? { w: short, h: long, fps: q.fps } : { w: long, h: short, fps: q.fps };
  }

  async queryPermissions() {
    for (const [key, name] of [['camera', 'camera'], ['microphone', 'microphone']]) {
      try {
        const st = await navigator.permissions.query({ name });
        this.permission[key] = st.state; st.onchange = () => { this.permission[key] = st.state; this.emit('permission', this.permission); };
      } catch { /* Safari/Firefox may not support querying; stays 'unknown' until first request */ }
    }
    this.emit('permission', this.permission);
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return this.devices;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices.video = all.filter(d => d.kind === 'videoinput');
      this.devices.audio = all.filter(d => d.kind === 'audioinput');
      this.devices.output = all.filter(d => d.kind === 'audiooutput');
    } catch { /* ignore */ }
    this.emit('devices', this.devices); return this.devices;
  }

  constraints(relax = false) {
    const q = this.outputSize();
    const video = this.s.camOn === false && !this.running ? true : { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } };
    if (video !== true) {
      if (this.s.videoDeviceId && !relax) video.deviceId = { exact: this.s.videoDeviceId };
      else video.facingMode = { ideal: this.s.facing };
    }
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (this.s.audioDeviceId && !relax) audio.deviceId = { exact: this.s.audioDeviceId };
    return { video, audio };
  }

  async start({ audioOnlyFallback = true } = {}) {
    if (!this.supported) { this.lastError = explainMediaError(new TypeError('no getUserMedia')); this.emit('error', this.lastError); throw this.lastError; }
    this.stop(true);
    let stream = null, err = null;
    const attempts = [this.constraints(false), this.constraints(true)];
    for (const c of attempts) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); err = null; break; } catch (e) { err = e; if (!['OverconstrainedError', 'NotFoundError'].includes(e.name)) break; }
    }
    if (!stream && err && audioOnlyFallback && ['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(err.name)) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); err = null; } catch (e) { err = e; }
    }
    if (!stream) {
      if (err?.name === 'NotAllowedError') this.permission.camera = this.permission.microphone = 'denied';
      this.lastError = explainMediaError(err); this.emit('permission', this.permission); this.emit('error', this.lastError);
      throw this.lastError;
    }
    this.lastError = null; this.stream = stream; this.running = true; this.interrupted = false;
    if (stream.getVideoTracks().length) this.permission.camera = 'granted';
    if (stream.getAudioTracks().length) this.permission.microphone = 'granted';
    const v = this.videoTrack(), a = this.audioTrack();
    if (v) { v.enabled = this.s.camOn !== false; v.onended = () => this._ended('camera'); v.onmute = () => this._interrupt(true); v.onunmute = () => this._interrupt(false); }
    if (a) { a.enabled = this.s.micOn !== false; a.onended = () => this._ended('microphone'); }
    this.src.srcObject = new MediaStream(v ? [v] : []);
    try { await this.src.play(); } catch { /* autoplay may need a gesture; preview elements call play() themselves */ }
    this._readActual(); this._setupAudio();
    if (v && this.s.facing && v.getSettings().deviceId) this.s.videoDeviceId = this.s.videoDeviceId || '';
    await this.refreshDevices(); this.emit('permission', this.permission); this.emit('started', this.actual);
    return stream;
  }

  stop(silent = false) {
    if (this.stream) this.stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
    this.stream = null; this.running = false; this.actual = null; this.src.srcObject = null;
    this._teardownAudio(); this.releaseWake();
    if (!silent) this.emit('stopped');
  }

  videoTrack() { return this.stream?.getVideoTracks()[0] || null; }
  audioTrack() { return this.stream?.getAudioTracks()[0] || null; }
  capabilities() { try { return this.videoTrack()?.getCapabilities?.() || {}; } catch { return {}; } }
  _readActual() {
    const v = this.videoTrack(), a = this.audioTrack();
    this.actual = { video: v ? v.getSettings() : null, audio: a ? a.getSettings() : null, videoLabel: v?.label || '', audioLabel: a?.label || '' };
  }
  _ended(which) {
    const e = { title: which === 'camera' ? 'Camera disconnected' : 'Microphone disconnected', message: `The ${which} stopped unexpectedly (unplugged, taken by another app, or the browser/OS paused it).`, fix: 'Reconnect the device and press Start Camera again.' };
    this.lastError = e; this.stop(); this.emit('error', e);
  }
  _interrupt(on) {
    this.interrupted = on; this.emit('interrupted', on);
  }

  /* ---------- controls ---------- */
  async switchFacing() {
    const next = this.s.facing === 'user' ? 'environment' : 'user';
    const before = this.actual?.video?.deviceId; this.s.facing = next; this.s.videoDeviceId = ''; this.save();
    if (!this.running) { this.emit('settings', this.s); return { changed: false }; }
    await this.start();
    const changed = before !== this.actual?.video?.deviceId;
    this.emit('settings', this.s); return { changed, count: this.devices.video.length };
  }
  async selectVideoDevice(id) { this.s.videoDeviceId = id; this.save(); if (this.running) await this.start(); this.emit('settings', this.s); }
  async selectAudioDevice(id) { this.s.audioDeviceId = id; this.save(); if (this.running) await this.start(); this.emit('settings', this.s); }
  toggleMic(force) {
    this.s.micOn = typeof force === 'boolean' ? force : !this.s.micOn; this.save();
    const a = this.audioTrack(); if (a) a.enabled = this.s.micOn; this.emit('settings', this.s); return this.s.micOn;
  }
  toggleCam(force) {
    this.s.camOn = typeof force === 'boolean' ? force : !this.s.camOn; this.save();
    const v = this.videoTrack(); if (v) v.enabled = this.s.camOn; this.emit('settings', this.s); return this.s.camOn;
  }
  setMirror(on) { this.s.mirror = !!on; this.save(); this.emit('settings', this.s); }
  async setOrientation(o) {
    this.s.orientation = o === 'portrait' ? 'portrait' : 'landscape'; this.save(); this.emit('settings', this.s);
    if (this.running) await this._reapply();
  }
  async setQuality(name, custom) {
    this.s.quality = QUALITY[name] ? name : 'standard'; if (custom) this.s.custom = { ...this.s.custom, ...custom }; this.save(); this.emit('settings', this.s);
    if (this.running) await this._reapply();
  }
  async _reapply() {
    const v = this.videoTrack(); if (!v) return;
    const q = this.outputSize();
    try { await v.applyConstraints({ width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } }); this._readActual(); this.emit('started', this.actual); }
    catch { await this.start(); }
  }
  async setZoom(z) {
    const v = this.videoTrack(); const cap = this.capabilities(); if (!v || !cap.zoom) return false;
    try { await v.applyConstraints({ advanced: [{ zoom: Number(z) }] }); this._readActual(); return true; } catch { return false; }
  }

  /* ---------- audio meter & monitoring ---------- */
  _setupAudio() {
    const a = this.audioTrack(); if (!a) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); const srcNode = this.ctx.createMediaStreamSource(new MediaStream([a]));
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512; this.meterBuf = new Uint8Array(this.analyser.fftSize);
      srcNode.connect(this.analyser); this._srcNode = srcNode;
      this.monitorGain = this.ctx.createGain(); this.monitorGain.gain.value = 0; srcNode.connect(this.monitorGain); this.monitorGain.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { this.analyser = null; }
  }
  _teardownAudio() {
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.analyser = null; this.monitorGain = null; this._srcNode = null;
  }
  /** 0..1 microphone level; 0 when the mic is muted or unavailable. */
  level() {
    if (!this.analyser || this.s.micOn === false) return 0;
    this.analyser.getByteTimeDomainData(this.meterBuf);
    let sum = 0; for (const b of this.meterBuf) { const x = (b - 128) / 128; sum += x * x; }
    return Math.min(1, Math.sqrt(sum / this.meterBuf.length) * 3.2);
  }
  get monitorSupported() { return !!this.monitorGain; }
  setMonitor(on) { if (this.monitorGain) this.monitorGain.gain.value = on ? 0.9 : 0; this.monitoring = !!on; }

  /* ---------- screen wake lock (keeps the screen on while recording/broadcasting where supported) ---------- */
  async requestWake() {
    this.wake = 'wanted';
    try { if ('wakeLock' in navigator) { this._wl = await navigator.wakeLock.request('screen'); return true; } } catch { /* denied or unsupported */ }
    return false;
  }
  releaseWake() { this.wake = null; try { this._wl?.release(); } catch { /* ignore */ } this._wl = null; }

  /** Attach the live camera to a <video> for preview. */
  attachPreview(video) {
    if (!video) return;
    video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
    video.srcObject = this.stream ? new MediaStream(this.stream.getVideoTracks()) : null;
    video.classList.toggle('mirror', this.mirrorEffective); video.style.transform = this.mirrorEffective ? 'scaleX(-1)' : '';
    if (this.stream) video.play().catch(() => {});
  }
  async enterFullscreen(el) {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen; if (!fn) return false;
    try { await fn.call(el); } catch { return false; } return true;
  }
}

export const cam = new CameraManager();

/** Test whether the browser can deliver a specific recording MIME type (used by recording & diagnostics). */
export function recorderTypes() {
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm'];
  if (!window.MediaRecorder) return [];
  return list.filter(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } });
}
