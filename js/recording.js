/* GD LIVE STUDIO — local Recording Studio (MediaRecorder). Works without any social account.
 * Recordings are stored in this device's IndexedDB; nothing is uploaded unless the user explicitly chooses Drive.
 */
import { cam, recorderTypes } from './camera.js';
import { compositor } from './overlays.js';
import { saveRecording, logActivity } from './storage.js';
import { downloadBlob, safeFilename, uid, emit } from './ui.js';

export function pickMime(preferred) {
  const types = recorderTypes();
  if (preferred && types.includes(preferred)) return preferred;
  return types[0] || '';
}
export const recorderSupported = () => !!window.MediaRecorder && !!HTMLCanvasElement.prototype.captureStream;

class Recorder extends EventTarget {
  constructor() { super(); this.reset(); }
  reset() { this.mr = null; this.chunks = []; this.state = 'idle'; this.startedAt = 0; this.pausedMs = 0; this.pauseStart = 0; this.stream = null; this.meta = null; this.timer = null; }
  emit(n, d) { this.dispatchEvent(new CustomEvent(n, { detail: d })); emit('rec:' + n, d); }
  on(n, fn) { const h = e => fn(e.detail); this.addEventListener(n, h); return () => this.removeEventListener(n, h); }
  elapsed() {
    if (!this.startedAt) return 0;
    const now = this.state === 'paused' ? this.pauseStart : Date.now();
    return Math.max(0, (now - this.startedAt - this.pausedMs) / 1000);
  }

  /** opts: { title, withOverlays: boolean, mime?: string } */
  async start(opts = {}) {
    if (this.state !== 'idle') throw new Error('A recording is already in progress.');
    if (!recorderSupported()) throw new Error('This browser does not support MediaRecorder. Try a current Chrome, Edge, Firefox or Safari.');
    if (!cam.running) throw new Error('Start the camera first.');
    const mime = pickMime(opts.mime);
    this.programOwner = 'recording-' + uid();
    let stream;
    if (opts.withOverlays) { compositor.lock(true); compositor.acquire(this.programOwner); stream = compositor.program(); this.usesProgram = true; }
    else { stream = new MediaStream(cam.stream.getTracks()); this.usesProgram = false; }
    this.stream = stream;
    const q = cam.quality();
    let mr;
    try { mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: q.vbr, audioBitsPerSecond: q.abr }); }
    catch (e) { try { mr = new MediaRecorder(stream); } catch (e2) { this._cleanup(); throw new Error('Could not start the recorder: ' + (e2.message || e2.name)); } }
    this.mr = mr; this.chunks = []; this.pausedMs = 0;
    const out = cam.outputSize();
    this.meta = {
      title: (opts.title || '').trim() || 'Recording ' + new Date().toLocaleString(), mime: mr.mimeType || mime || 'video/webm',
      orientation: cam.s.orientation, withOverlays: !!opts.withOverlays, resolution: opts.withOverlays ? `${out.w}x${out.h}` : `${cam.actual?.video?.width || '?'}x${cam.actual?.video?.height || '?'}`
    };
    mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    mr.onerror = e => { this.emit('error', { message: 'Recorder error: ' + (e.error?.message || e.error?.name || 'unknown') }); this._finalize(true); };
    mr.onstop = () => this._finalize(false);
    mr.start(1000); // 1 s chunks so a crash loses at most ~1 s
    this.state = 'recording'; this.startedAt = Date.now(); cam.requestWake();
    this.timer = setInterval(() => this.emit('tick', { sec: this.elapsed(), size: this.chunks.reduce((a, c) => a + c.size, 0) }), 500);
    this.emit('state', { state: this.state, mime: this.meta.mime });
    logActivity('Recording started');
    return this.meta;
  }
  pause() { if (this.state !== 'recording') return; this.mr.pause(); this.state = 'paused'; this.pauseStart = Date.now(); this.emit('state', { state: this.state }); }
  resume() { if (this.state !== 'paused') return; this.mr.resume(); this.pausedMs += Date.now() - this.pauseStart; this.state = 'recording'; this.emit('state', { state: this.state }); }
  stop() { if (this.state === 'idle' || !this.mr) return; if (this.state === 'paused') this.pausedMs += Date.now() - this.pauseStart; this.state = 'stopping'; try { this.mr.stop(); } catch { this._finalize(false); } }

  async _finalize(failed) {
    clearInterval(this.timer); const dur = this.elapsed();
    const blob = new Blob(this.chunks, { type: this.meta?.mime || 'video/webm' });
    const meta = this.meta; this._cleanup();
    if (!blob.size) { this.emit('state', { state: 'idle' }); this.emit('error', { message: 'The recording is empty (no data was produced).' }); return; }
    try {
      const rec = await saveRecording({ title: meta.title, mime: blob.type, orientation: meta.orientation, resolution: meta.resolution, duration: Math.round(dur), withOverlays: meta.withOverlays, storage: 'device' }, blob);
      logActivity(`Recording saved (${Math.round(dur)} s)`);
      this.emit('saved', rec);
    } catch (e) {
      // Storage may be full: still let the user download what was captured.
      this.emit('error', { message: 'Could not store the recording on this device (' + (e.message || 'storage full') + '). Download it now so it is not lost.', blob, meta });
    }
    this.emit('state', { state: 'idle' });
  }
  _cleanup() {
    if (this.usesProgram) { compositor.releaseProgram(this.stream); compositor.release(this.programOwner); compositor.lock(false); }
    cam.releaseWake(); this.stream = null; this.mr = null; this.chunks = []; this.state = 'idle'; this.startedAt = 0; this.meta = null; clearInterval(this.timer);
  }
}
export const recorder = new Recorder();

export function extensionFor(mime) { return /mp4/.test(mime) ? 'mp4' : /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogv' : 'webm'; }
export function downloadRecording(rec) { downloadBlob(rec.blob, safeFilename(rec.title) + '.' + extensionFor(rec.mime)); }

/** Optional local conversion to MP4 using ffmpeg.wasm (free, open source, runs on-device).
 *  EXPERIMENTAL: heavy download (~30 MB), slow on phones, may fail on low-memory devices. Never required. */
export function conversionAvailable() { return typeof WebAssembly === 'object' && typeof Worker !== 'undefined'; }
export async function convertToMp4(rec, onProgress) {
  if (!conversionAvailable()) throw new Error('WebAssembly/Workers are not available on this device.');
  if (/mp4/.test(rec.mime)) throw new Error('This recording is already MP4.');
  if ((rec.size || 0) > 500 * 1024 * 1024) throw new Error('This file is too large to convert on-device.');
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg';
  const toBlobURL = async (url, type) => URL.createObjectURL(new Blob([await (await fetch(url)).arrayBuffer()], { type }));
  let FFmpeg;
  try { ({ FFmpeg } = await import(`${base}/ffmpeg@0.12.10/dist/esm/index.js`)); } catch { throw new Error('Could not download the converter (offline or blocked).'); }
  const ff = new FFmpeg();
  ff.on('progress', ({ progress }) => onProgress && onProgress(Math.min(1, Math.max(0, progress))));
  await ff.load({
    classWorkerURL: await toBlobURL(`${base}/ffmpeg@0.12.10/dist/esm/worker.js`, 'text/javascript'),
    coreURL: await toBlobURL(`${base}/core@0.12.6/dist/esm/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/core@0.12.6/dist/esm/ffmpeg-core.wasm`, 'application/wasm')
  });
  await ff.writeFile('in.webm', new Uint8Array(await rec.blob.arrayBuffer()));
  const code = await ff.exec(['-i', 'in.webm', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-movflags', '+faststart', 'out.mp4']);
  if (code !== 0) throw new Error('Conversion failed (ffmpeg exit code ' + code + ').');
  const data = await ff.readFile('out.mp4'); ff.terminate();
  return new Blob([data.buffer], { type: 'video/mp4' });
}
