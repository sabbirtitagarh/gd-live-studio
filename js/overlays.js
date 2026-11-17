/* GD LIVE STUDIO — overlay compositor & templates.
 * Draws the camera feed ("cover" crop, never stretched) plus branding overlays onto a canvas.
 * The canvas.captureStream() output is the "program" feed used for recording and broadcasting.
 */
import { cam } from './camera.js';
import { CONFIG } from './config.js';
import { kvGet, kvSet, ls } from './storage.js';

export const TEMPLATES = [
  { id: 'gd-official', name: 'GD Tech Academy Official', note: 'Navy bar with the official logo', a: '#07347F', b: '#08C5AA', style: 'bar', lockLogo: true },
  { id: 'education',   name: 'Education Live',           note: 'Title banner for classes',       a: '#0B2E73', b: '#F2B84B', style: 'banner' },
  { id: 'tech-news',   name: 'Technology News',          note: 'Ticker-style bottom bar',        a: '#0F172A', b: '#08C5AA', style: 'ticker' },
  { id: 'tutorial',    name: 'Tutorial Session',         note: 'Compact corner title',           a: '#07347F', b: '#4F86E8', style: 'corner' },
  { id: 'interview',   name: 'Interview',                note: 'Lower-third guest card',         a: '#0B2E73', b: '#08C5AA', style: 'lower' },
  { id: 'creator',     name: 'General Creator',          note: 'Minimal watermark',              a: '#1F2937', b: '#08C5AA', style: 'minimal' }
];

export const DEFAULT_OVERLAY = {
  template: 'gd-official', scene: 'live', showLogo: true,
  channelName: '', title: '', website: CONFIG.WEBSITE.replace('https://', ''), handle: CONFIG.HANDLE,
  showDateTime: false, watermarkText: '',
  lowerThirdOn: false, lowerThirdName: '', lowerThirdRole: '',
  bannerOn: false, banner: '',
  freeText: '', freeTextPos: 'top',
  startingText: 'Starting soon', endingText: 'Thanks for watching',
  customImage: null, customImagePos: 'tr', secondaryLogo: null
};

const imgCache = new Map();
function loadImage(src) {
  if (!src) return null;
  if (imgCache.has(src)) return imgCache.get(src);
  const im = new Image(); im.decoding = 'async'; im.src = src;
  const rec = { im, ready: false }; im.onload = () => { rec.ready = true; }; im.onerror = () => { rec.failed = true; };
  imgCache.set(src, rec); return rec;
}
const ready = r => r && r.ready && !r.failed;

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fitText(ctx, text, x, y, maxW, size, { weight = '700', color = '#fff', align = 'left', minScale = 0.6 } = {}) {
  if (!text) return 0;
  let s = size; ctx.font = `${weight} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  while (ctx.measureText(text).width > maxW && s > size * minScale) { s -= 1; ctx.font = `${weight} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; }
  let t = text; while (ctx.measureText(t).width > maxW && t.length > 1) t = t.slice(0, -1);
  if (t !== text) t = t.slice(0, -1) + '…';
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y);
  return ctx.measureText(t).width;
}
function tile(ctx, rec, x, y, size) {
  ctx.save(); rr(ctx, x, y, size, size, size * 0.2); ctx.clip();
  if (ready(rec)) ctx.drawImage(rec.im, x, y, size, size); else { ctx.fillStyle = '#EBEBEB'; ctx.fillRect(x, y, size, size); }
  ctx.restore();
}
function pill(ctx, text, x, y, U, bg, fg, align = 'left') {
  ctx.font = `700 ${2.8 * U}px system-ui, sans-serif`; const w = ctx.measureText(text).width + 3.2 * U, h = 4.6 * U;
  const px = align === 'right' ? x - w : x; ctx.fillStyle = bg; rr(ctx, px, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, px + 1.6 * U, y + h / 2 + 0.1 * U); return { w, h };
}

class Compositor {
  constructor() {
    this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.canvas.width = 1280; this.canvas.height = 720; this.canvas.setAttribute('aria-label', 'Program preview');
    this.s = { ...DEFAULT_OVERLAY }; this.owners = new Set(); this.timer = null; this.locked = false;
    this.fit = ls.get('comp.fit', 'cover'); this.logo = loadImage(CONFIG.LOGO_MARK);
    this.frames = 0;
    cam.on('settings', () => this.applyFormat()); cam.on('started', () => this.applyFormat());
    this.applyFormat();
  }
  template() { return TEMPLATES.find(t => t.id === this.s.template) || TEMPLATES[0]; }
  async load() { const saved = await kvGet('overlay', null); this.s = { ...DEFAULT_OVERLAY, ...(saved || {}) }; this.s.scene = 'live'; }
  async save() { await kvSet('overlay', this.s); }
  update(patch) {
    Object.assign(this.s, patch);
    if (this.template().lockLogo) this.s.showLogo = true; // official identity stays on the official template
    this.save().catch(() => {});
  }
  setFit(f) { this.fit = f === 'contain' ? 'contain' : 'cover'; ls.set('comp.fit', this.fit); }
  applyFormat() {
    if (this.locked) return;
    const { w, h } = cam.outputSize(); if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
  lock(v) { this.locked = !!v; if (!v) this.applyFormat(); }
  acquire(owner) { this.owners.add(owner); if (!this.timer) { const fps = Math.min(30, cam.outputSize().fps || 30); this.timer = setInterval(() => this.draw(), 1000 / fps); } this.draw(); }
  release(owner) { this.owners.delete(owner); if (!this.owners.size && this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** Program feed = composited video + the microphone track. Audio is never recorded when the mic is muted (track disabled). */
  program() {
    const fps = Math.min(30, cam.outputSize().fps || 30);
    const out = this.canvas.captureStream(fps); const a = cam.audioTrack(); if (a) out.addTrack(a); return out;
  }
  releaseProgram(stream) { stream?.getVideoTracks().forEach(t => t.stop()); }

  draw() {
    const { ctx, canvas } = this; const W = canvas.width, H = canvas.height, U = Math.min(W, H) / 100, L = W >= H;
    const S = this.s; this.frames++;
    ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, W, H);
    if (S.scene === 'starting' || S.scene === 'ending') return this.drawCard(ctx, W, H, U, S.scene === 'starting' ? S.startingText : S.endingText);

    const v = cam.src; let drewVideo = false;
    if (cam.running && cam.s.camOn !== false && v.videoWidth > 0 && v.readyState >= 2) {
      const vw = v.videoWidth, vh = v.videoHeight; const sc = this.fit === 'contain' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh);
      const dw = vw * sc, dh = vh * sc, dx = (W - dw) / 2, dy = (H - dh) / 2;
      ctx.save(); if (cam.mirrorEffective) { ctx.translate(W, 0); ctx.scale(-1, 1); } ctx.drawImage(v, dx, dy, dw, dh); ctx.restore(); drewVideo = true;
    }
    if (!drewVideo) {
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0B2E73'); g.addColorStop(1, '#06172f'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${3.6 * U}px system-ui, sans-serif`;
      ctx.fillText(cam.running ? 'Camera is off' : 'Camera not started', W / 2, H / 2 - 2 * U);
      ctx.font = `500 ${2.6 * U}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.fillText(cam.running ? 'Turn the camera on to show video' : 'Overlay preview background', W / 2, H / 2 + 3 * U);
    }
    this.drawOverlays(ctx, W, H, U, L);
  }

  drawCard(ctx, W, H, U, text) {
    const T = this.template(); const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, T.a); g.addColorStop(1, '#05122b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = T.b; ctx.fillRect(0, H - 1.2 * U, W, 1.2 * U);
    const size = Math.min(W, H) * 0.3; tile(ctx, this.logo, (W - size) / 2, H * 0.14, size);
    fitText(ctx, text || '', W / 2, H * 0.14 + size + 8 * U, W * 0.86, 7 * U, { align: 'center', weight: '800' });
    fitText(ctx, this.s.title || '', W / 2, H * 0.14 + size + 16 * U, W * 0.86, 4 * U, { align: 'center', color: T.b });
    fitText(ctx, [this.s.channelName, this.s.handle].filter(Boolean).join('  ·  '), W / 2, H - 6 * U, W * 0.86, 2.8 * U, { align: 'center', weight: '600', color: 'rgba(255,255,255,.8)' });
  }

  drawOverlays(ctx, W, H, U, L) {
    const S = this.s, T = this.template(); const logoOn = S.showLogo || T.lockLogo;
    const used = { top: 0, bottom: 0 };
    ctx.save(); ctx.globalAlpha = 1;

    if (T.style === 'bar') {
      const bh = (L ? 15 : 13) * U, y = H - bh; ctx.globalAlpha = .94; ctx.fillStyle = T.a; ctx.fillRect(0, y, W, bh); ctx.fillStyle = T.b; ctx.fillRect(0, y, W, .7 * U); ctx.globalAlpha = 1;
      let x = 2 * U; if (logoOn) { const s = bh - 3 * U; tile(ctx, this.logo, x, y + 1.7 * U, s); x += s + 2 * U; }
      const rightW = L ? W * 0.28 : 0, maxW = W - x - 2 * U - rightW;
      fitText(ctx, S.title || 'GD TECH ACADEMY', x, y + bh * .38, maxW, 4.6 * U, { weight: '800' });
      fitText(ctx, S.channelName || 'Create. Connect. Go Live.', x, y + bh * .72, maxW, 3 * U, { color: T.b, weight: '700' });
      if (L) { fitText(ctx, S.handle, W - 2 * U, y + bh * .38, rightW, 3 * U, { align: 'right', weight: '700' }); fitText(ctx, S.website, W - 2 * U, y + bh * .72, rightW, 2.4 * U, { align: 'right', weight: '500', color: 'rgba(255,255,255,.8)' }); }
      used.bottom = bh;
    } else if (T.style === 'banner') {
      const bh = 10 * U; ctx.globalAlpha = .93; ctx.fillStyle = T.a; ctx.fillRect(0, 0, W, bh); ctx.fillStyle = T.b; ctx.fillRect(0, bh, W, .6 * U); ctx.globalAlpha = 1;
      let x = 2 * U; if (logoOn) { tile(ctx, this.logo, x, 1.2 * U, bh - 2.4 * U); x += bh; }
      fitText(ctx, S.title || S.channelName || 'Live class', x, bh / 2, W - x - 2 * U, 4.4 * U, { weight: '800' });
      const sh = 5 * U; ctx.globalAlpha = .85; ctx.fillStyle = '#000'; ctx.fillRect(0, H - sh, W, sh); ctx.globalAlpha = 1;
      fitText(ctx, [S.channelName, S.handle, S.website].filter(Boolean).join('   ·   '), W / 2, H - sh / 2, W - 4 * U, 2.5 * U, { align: 'center', weight: '600' });
      used.top = bh + .6 * U; used.bottom = sh;
    } else if (T.style === 'ticker') {
      const bh = 8.5 * U, y = H - bh; ctx.globalAlpha = .95; ctx.fillStyle = T.a; ctx.fillRect(0, y, W, bh); ctx.globalAlpha = 1;
      const label = (S.channelName || 'LIVE').toUpperCase(); ctx.font = `800 ${3 * U}px system-ui, sans-serif`; const lw = Math.min(W * .4, ctx.measureText(label).width + 5 * U);
      ctx.fillStyle = T.b; ctx.fillRect(0, y, lw, bh); fitText(ctx, label, lw / 2, y + bh / 2, lw - 2 * U, 3 * U, { align: 'center', weight: '800', color: '#04221D' });
      const text = S.title || S.banner || 'Technology news'; ctx.font = `600 ${3.2 * U}px system-ui, sans-serif`; const tw = ctx.measureText(text).width, room = W - lw - 4 * U;
      ctx.save(); ctx.beginPath(); ctx.rect(lw, y, W - lw, bh); ctx.clip();
      const off = tw > room ? ((this.frames * 1.6) % (tw + room)) : 0; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, lw + 2 * U + (tw > room ? room - off : 0), y + bh / 2); ctx.restore();
      if (logoOn) tile(ctx, this.logo, W - 7.5 * U, y - 9 * U, 7 * U);
      used.bottom = bh;
    } else if (T.style === 'corner') {
      const w = Math.min(W * (L ? .42 : .8), 60 * U), h = 9 * U; ctx.globalAlpha = .92; ctx.fillStyle = T.a; rr(ctx, 2 * U, 2 * U, w, h, 2 * U); ctx.fill(); ctx.fillStyle = T.b; ctx.fillRect(2 * U, 2 * U, .8 * U, h); ctx.globalAlpha = 1;
      let x = 4 * U; if (logoOn) { tile(ctx, this.logo, x, 3.2 * U, h - 2.4 * U); x += h; }
      fitText(ctx, S.title || 'Tutorial', x, 2 * U + h * .36, w - (x - 2 * U) - 2 * U, 3.6 * U, { weight: '800' });
      fitText(ctx, S.channelName || S.handle, x, 2 * U + h * .72, w - (x - 2 * U) - 2 * U, 2.4 * U, { color: T.b, weight: '600' });
      used.top = 2 * U + h;
    } else if (T.style === 'lower') {
      if (!S.lowerThirdOn) {
        const bh = 9 * U, y = H - bh - 3 * U; ctx.globalAlpha = .92; ctx.fillStyle = T.a; rr(ctx, 2 * U, y, W - 4 * U, bh, 2 * U); ctx.fill(); ctx.globalAlpha = 1;
        let x = 4 * U; if (logoOn) { tile(ctx, this.logo, x, y + 1 * U, bh - 2 * U); x += bh; }
        fitText(ctx, S.title || 'Interview', x, y + bh * .4, W - x - 6 * U, 3.8 * U, { weight: '800' }); fitText(ctx, S.channelName || S.handle, x, y + bh * .76, W - x - 6 * U, 2.4 * U, { color: T.b });
      }
      used.bottom = S.lowerThirdOn ? 0 : 12 * U;
    } else { // minimal
      if (logoOn) { ctx.globalAlpha = .9; tile(ctx, this.logo, W - 11 * U, 2 * U, 9 * U); ctx.globalAlpha = 1; }
      if (S.title) { ctx.globalAlpha = .85; ctx.fillStyle = '#000'; const t = S.title; ctx.font = `700 ${3.4 * U}px system-ui, sans-serif`; const w = Math.min(W - 16 * U, ctx.measureText(t).width + 4 * U); rr(ctx, 2 * U, 2 * U, w, 6 * U, 3 * U); ctx.fill(); ctx.globalAlpha = 1; fitText(ctx, t, 4 * U, 5 * U, w - 4 * U, 3.4 * U); }
      used.top = 8.5 * U;
    }

    /* Common, user-editable layers */
    let y = used.top + 2 * U;
    if (S.bannerOn && S.banner) { const h = 6.2 * U; ctx.globalAlpha = .9; ctx.fillStyle = '#F2B84B'; rr(ctx, 2 * U, y, W - 4 * U, h, 1.6 * U); ctx.fill(); ctx.globalAlpha = 1; fitText(ctx, S.banner, W / 2, y + h / 2, W - 8 * U, 3.2 * U, { align: 'center', weight: '800', color: '#2a1d00' }); y += h + 1.6 * U; }
    if (S.watermarkText) { ctx.globalAlpha = .6; fitText(ctx, S.watermarkText, 3 * U, y + 2 * U, W * .5, 2.6 * U, { weight: '700' }); ctx.globalAlpha = 1; y += 4.6 * U; }
    if (S.freeText) {
      const fy = S.freeTextPos === 'center' ? H / 2 : S.freeTextPos === 'bottom' ? H - used.bottom - 12 * U : Math.max(y + 3 * U, 10 * U);
      ctx.font = `800 ${5 * U}px system-ui, sans-serif`; const tw = Math.min(W - 8 * U, ctx.measureText(S.freeText).width + 6 * U);
      ctx.globalAlpha = .55; ctx.fillStyle = '#000'; rr(ctx, (W - tw) / 2, fy - 4 * U, tw, 8 * U, 2 * U); ctx.fill(); ctx.globalAlpha = 1;
      fitText(ctx, S.freeText, W / 2, fy, tw - 3 * U, 5 * U, { align: 'center', weight: '800' });
    }
    if (S.showDateTime) { const t = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); pill(ctx, t, W - 2 * U, used.top + 2 * U, U, 'rgba(0,0,0,.6)', '#fff', 'right'); }
    if (S.lowerThirdOn && (S.lowerThirdName || S.lowerThirdRole)) {
      const h = 10 * U, ly = H - used.bottom - h - 3 * U, w = Math.min(W - 4 * U, 62 * U);
      ctx.globalAlpha = .93; ctx.fillStyle = T.a; rr(ctx, 2 * U, ly, w, h, 2 * U); ctx.fill(); ctx.fillStyle = T.b; ctx.fillRect(2 * U, ly, 1 * U, h); ctx.globalAlpha = 1;
      fitText(ctx, S.lowerThirdName, 5 * U, ly + h * .36, w - 5 * U, 4.2 * U, { weight: '800' }); fitText(ctx, S.lowerThirdRole, 5 * U, ly + h * .74, w - 5 * U, 2.8 * U, { color: T.b, weight: '600' });
    }
    const placeImg = (rec, pos, size) => {
      if (!ready(rec)) return; const r = rec.im, sc = size / Math.max(r.naturalWidth, r.naturalHeight), w = r.naturalWidth * sc, h = r.naturalHeight * sc, m = 2.5 * U;
      const x = pos.includes('l') ? m : W - w - m, yy = pos.startsWith('t') ? used.top + m + (S.showDateTime && pos === 'tr' ? 6 * U : 0) : H - used.bottom - h - m - (S.lowerThirdOn && pos === 'bl' ? 14 * U : 0);
      ctx.save(); rr(ctx, x, yy, w, h, 1.2 * U); ctx.clip(); ctx.drawImage(r, x, yy, w, h); ctx.restore();
    };
    placeImg(loadImage(S.customImage), S.customImagePos || 'tr', 16 * U);
    placeImg(loadImage(S.secondaryLogo), S.customImagePos === 'br' ? 'bl' : 'br', 11 * U);
    ctx.restore();
  }
}

export const compositor = new Compositor();

/** Read an image file chosen by the user, downscale it, and return a data URL (stored locally only). */
export function fileToDataUrl(file, max = 512) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return reject(new Error('Choose a PNG, JPG, WEBP or GIF image.'));
    if (file.size > 6 * 1024 * 1024) return reject(new Error('Image is larger than 6 MB.'));
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      const sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', .9));
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); }; im.src = url;
  });
}
