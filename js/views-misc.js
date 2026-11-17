/* GD LIVE STUDIO — page controllers: Dashboard, Platforms, Recordings, History, Devices, Storage, Help, Profile, About, Login. */
import { $, $$, esc, h, icon, toast, modal, confirmDialog, badge, fmtBytes, fmtDuration, fmtDate, relTime, on, downloadBlob, safeFilename } from './ui.js';
import { cam } from './camera.js';
import { recorder, downloadRecording, convertToMp4, conversionAvailable, extensionFor } from './recording.js';
import { broadcast } from './streaming.js';
import * as P from './platforms.js';
import * as S from './storage.js';
import { state, isUser, isAdmin, platformDef } from './state.js';
import { api, apiConfigured, setSession } from './api.js';
import { derivePw } from './crypto.js';
import { CONFIG } from './config.js';
import { checkGateway, resolveGateway } from './streaming.js';
import { saveToDriveFlow } from './views-core.js';
import { mountLogin, logout, removeAccount } from './auth.js';
import { PLATFORM_GLYPHS, platformGlyph } from './ui.js';
import { setTheme, currentTheme } from './theme.js';
import { googleConfigured } from './gis.js';

/* =========================== DASHBOARD =========================== */
export async function mountDashboard(root) {
  const offs = [];
  $('#dash-hello', root).textContent = state.user ? `Welcome, ${state.user.name || 'creator'}` : 'Welcome to GD LIVE STUDIO';
  const ann = $('#dash-announce', root); ann.innerHTML = (state.config.announcements || []).slice(0, 3).map(a => `<div class="notice mb"><strong>${esc(a.title)}</strong>${esc(a.body)}</div>`).join('');
  const paint = async () => {
    const n = P.connectedCount(); $('#d-plat', root).textContent = n; $('#d-plat-sub', root).textContent = n ? ['youtube', 'facebook', 'instagram', 'rtmp', 'whip'].filter(k => ['Connected', 'Ready'].includes(P.connection(k).status)).map(k => platformDef(k)?.name || k).join(', ') : 'None connected';
    const rs = recorder.state; $('#d-rec', root).textContent = rs === 'recording' ? fmtDuration(recorder.elapsed()) : rs === 'paused' ? 'Paused' : 'Idle'; $('#d-rec-sub', root).textContent = rs === 'idle' ? 'No recording in progress' : 'Recording to this device';
    const bs = broadcast.status; $('#d-live', root).textContent = bs === 'broadcasting' ? 'On air' : bs === 'idle' ? 'Idle' : bs[0].toUpperCase() + bs.slice(1); $('#d-live-sub', root).textContent = bs === 'broadcasting' ? broadcast.dests.map(d => d.label + ': ' + d.status).join(' · ') : 'Not broadcasting';
    $('#d-cam', root).textContent = cam.running ? 'On' : 'Off'; $('#d-cam-sub', root).textContent = cam.running && cam.actual?.video ? `${cam.actual.video.width}×${cam.actual.video.height} · ${cam.s.orientation}` : 'Start it in Camera Studio';
    const est = await S.storageEstimate(); $('#d-store', root).textContent = est ? fmtBytes(est.free) : 'Not reported'; $('#d-store-sub', root).textContent = est ? `of ${fmtBytes(est.quota)} browser quota` : 'This browser does not report storage';
    $('#d-presets', root).textContent = (await S.kvGet('presets', [])).length;
  };
  const hist = await S.listHistory(5); const hu = $('#d-hist', root);
  hu.innerHTML = hist.length ? hist.map(x => `<li><span><b>${esc(x.title)}</b><br><span class="small muted">${esc((x.destinations || []).join(', '))} · ${esc(relTime(x.at))}</span></span><span>${badge((x.status || '').toLowerCase(), x.status || '—')}</span></li>`).join('') : '<li class="empty" style="display:block;width:100%">No broadcasts yet.</li>';
  const act = await S.listActivity(8); $('#d-activity', root).innerHTML = act.length ? act.map(a => `<li><span>${esc(a.text)}</span><span class="small muted">${esc(relTime(a.at))}</span></li>`).join('') : '<li class="empty" style="display:block;width:100%">No activity yet.</li>';
  offs.push(on('platforms:changed', paint), on('broadcast:update', paint), on('rec:state', paint)); const t = setInterval(paint, 1000); offs.push(() => clearInterval(t)); paint();
  return () => offs.forEach(f => f());
}

/* =========================== PLATFORMS =========================== */
export async function mountPlatforms(root) {
  const offs = []; const cards = $('#pl-cards', root);
  const paintGateway = async () => {
    const g = await checkGateway(); const box = $('#pl-gateway', root);
    box.innerHTML = `<div class="row between"><h3 style="margin:0">Streaming gateway</h3>${badge(g.ok ? 'connected' : g.configured ? 'error' : 'unavailable', g.ok ? 'Reachable' : g.configured ? 'Error' : 'Not configured')}</div><p class="small muted" style="margin:8px 0 0">${esc(g.message || '')} ${g.relay ? 'Multi-platform streaming is <b>available</b>.' : 'Multi-platform streaming is <b>unavailable</b> until a relay gateway is configured.'} <a href="#/devices">Gateway settings</a></p>`;
  };
  const render = () => {
    cards.innerHTML = '';
    for (const id of ['youtube', 'facebook', 'instagram']) {
      const def = platformDef(id) || {}; const c = P.connection(id); const disabled = def.enabled === false; const prev = P.previousInfo(id);
      const status = disabled ? 'Unavailable' : c.status; const cls = status.toLowerCase();
      const isOAuth = id !== 'instagram';
      const body = h('div', { class: 'card platform-card' },
        h('header', {}, h('span', { class: 'plat-logo', html: platformGlyph(id) }), h('div', { class: 'grow' }, h('h3', { style: 'margin:0' }, def.name || id), h('span', { html: badge(cls, status) })),
        ),
        h('dl', {}, h('dt', {}, 'Method'), h('dd', {}, def.method || ''), h('dt', {}, 'Account'), h('dd', {}, c.account || (prev ? prev.account + ' (reconnect to verify)' : '—')), h('dt', {}, 'Eligibility'), h('dd', {}, def.eligibility || '')),
        disabled && def.apiMessage ? h('div', { class: 'notice warn small' }, def.apiMessage) : null,
        c.error ? h('div', { class: 'notice err small' }, c.error) : null,
        id === 'youtube' && c.status === 'Connected' && c.liveEnabled === false ? h('div', { class: 'notice warn small' }, 'Live streaming is not enabled on this channel yet.') : null,
        id === 'facebook' && c.pages?.length > 1 ? h('label', { class: 'field' }, 'Page', h('select', { onchange: e => P.selectFacebookPage(e.target.value) }, ...c.pages.map(p => h('option', { value: p.id, selected: p.id === c.pageId }, p.name)))) : null,
        id === 'instagram' ? h('div', { class: 'notice small' }, 'Instagram has no general public Live API. Add the RTMP URL and key from Instagram Live Producer below, if your account has it. Otherwise this destination is not available to you.') : null,
        h('details', { class: 'instr' }, h('summary', {}, 'Configuration instructions'), h('div', { class: 'body' }, h('ol', {}, ...(def.instructions || []).map(s => h('li', {}, s))))),
        h('div', { class: 'row' },
          isOAuth ? h('button', { class: 'btn accent sm', type: 'button', disabled: disabled || c.status === 'Testing', onclick: async e => { e.target.disabled = true; try { id === 'youtube' ? await P.connectYouTube() : await P.connectFacebook(); toast(def.name + ' connected', 'ok'); } catch (er) { toast(er.message, 'err'); } render(); } }, c.status === 'Connected' ? 'Reconnect' : 'Connect') : h('a', { class: 'btn accent sm', href: '#pl-form', onclick: e => { e.preventDefault(); $('#pl-form [name=platform]', root).value = 'instagram'; $('#pl-form', root).scrollIntoView({ behavior: 'smooth' }); } }, 'Add RTMP details'),
          isOAuth ? h('button', { class: 'btn soft sm', type: 'button', disabled: c.status !== 'Connected', onclick: async e => { e.target.disabled = true; try { id === 'youtube' ? await P.testYouTube() : await P.testFacebook(); toast('Connection test passed', 'ok'); } catch (er) { toast(er.message, 'err'); } render(); } }, 'Test connection') : null,
          h('button', { class: 'btn ghost sm', type: 'button', disabled: !(c.status === 'Connected' || c.status === 'Error' || c.status === 'Ready'), onclick: async () => { if (await confirmDialog('Disconnect ' + (def.name || id) + '?', 'Access is revoked for this session and removed from your account record.', 'Disconnect', true)) { P.disconnect(id); render(); } } }, 'Disconnect')));
      cards.append(body);
    }
  };
  const renderManual = async () => {
    const list = await P.listManual(); const box = $('#pl-manual', root);
    box.innerHTML = list.length ? '' : '<div class="empty">No custom destinations yet.</div>';
    for (const d of list) box.append(h('div', { class: 'dest-card' }, h('span', { class: 'plat-logo', html: platformGlyph(d.platform) }), h('div', { class: 'body' }, h('b', {}, d.label), h('span', { class: 'small muted mono' }, d.url.replace(/(\/\/[^/]+).*/, '$1/…'), d.hasSecret ? (d.remember ? ' · key remembered on this device' : ' · key in memory this session') : ' · no key')),
      d.hasSecret && !d.remember ? h('button', { class: 'btn soft sm', type: 'button', onclick: async () => { const f = h('input', { type: 'password', autocomplete: 'off' }); const r = await modal({ title: 'Enter key for this session', body: h('label', { class: 'field' }, 'Stream key / token', f), actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Use', class: 'accent', value: true }] }); if (r && f.value) { await P.setManualSecret(d.id, f.value, false); toast('Key set for this session'); } } }, 'Set key') : null,
      h('button', { class: 'btn ghost sm icon', type: 'button', 'aria-label': 'Remove', html: icon('trash'), onclick: async () => { if (await confirmDialog('Remove destination?', d.label, 'Remove', true)) { await P.removeManual(d.id); renderManual(); render(); } } })));
  };
  $('#pl-form', root).onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await P.addManual({ platform: f.get('platform'), label: f.get('label'), url: f.get('url'), key: f.get('key'), remember: !!f.get('remember') }); e.target.reset(); toast('Destination added', 'ok'); renderManual(); render(); } catch (er) { toast(er.message, 'err'); }
  };
  offs.push(on('platforms:changed', render)); render(); renderManual(); paintGateway();
  return () => offs.forEach(f => f());
}

/* =========================== RECORDINGS =========================== */
export async function mountRecordings(root) {
  const urls = [];
  const render = async () => {
    const list = await S.listRecordings(); const box = $('#rc-list', root); box.innerHTML = '';
    const total = list.reduce((a, r) => a + (r.size || 0), 0); const est = await S.storageEstimate();
    $('#rc-summary', root).textContent = `${list.length} recording${list.length === 1 ? '' : 's'} · ${fmtBytes(total)} on this device` + (est ? ` · ${fmtBytes(est.free)} free` : '');
    if (!list.length) { box.append(h('div', { class: 'empty' }, 'No recordings yet. ', h('a', { href: '#/record' }, 'Record something'))); return; }
    for (const r of list) {
      const url = URL.createObjectURL(r.blob); urls.push(url);
      const v = h('video', { src: url, controls: true, preload: 'metadata', playsinline: true, class: r.orientation === 'portrait' ? 'portrait' : '' });
      box.append(h('div', { class: 'card rec-card' }, v, h('div', {},
        h('b', {}, r.title), h('div', { class: 'small muted' }, fmtDate(r.createdAt), ' · ', fmtDuration(r.duration), ' · ', fmtBytes(r.size), ' · ', r.orientation === 'portrait' ? '9:16' : '16:9', ' · ', esc(r.mime.split(';')[0]).replace(/&amp;/g, '&')),
        r.driveLink ? h('div', { class: 'small' }, h('a', { href: r.driveLink, target: '_blank', rel: 'noopener noreferrer' }, 'Saved in your Google Drive')) : null,
        h('div', { class: 'row mt' },
          h('button', { class: 'btn accent sm', type: 'button', onclick: () => downloadRecording(r) }, h('span', { html: icon('download') }), 'Download'),
          h('button', { class: 'btn soft sm', type: 'button', onclick: () => saveToDriveFlow(r).then(render) }, h('span', { html: icon('upload') }), 'Drive'),
          h('button', { class: 'btn soft sm', type: 'button', onclick: async () => { const f = h('input', { type: 'text', value: r.title, maxlength: 80 }); const ok = await modal({ title: 'Rename', body: h('label', { class: 'field' }, 'Title', f), actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Save', class: 'accent', value: true }] }); if (ok && f.value.trim()) { await S.updateRecording(r.id, { title: f.value.trim() }); render(); } } }, 'Rename'),
          !/mp4/.test(r.mime) && conversionAvailable() ? h('button', { class: 'btn ghost sm', type: 'button', title: 'Experimental, on-device', onclick: async e => { if (!await confirmDialog('Convert to MP4 on this device?', 'This downloads the open-source ffmpeg.wasm converter (about 30 MB) and runs it locally. It can be slow and may fail on phones with little memory. Your video is not uploaded anywhere.', 'Convert')) return; const btn = e.currentTarget; btn.disabled = true; try { const blob = await convertToMp4(r, p => { btn.textContent = Math.round(p * 100) + '%'; }); downloadBlob(blob, safeFilename(r.title) + '.mp4'); toast('Converted. MP4 downloaded.', 'ok'); } catch (er) { toast(er.message, 'err'); } btn.disabled = false; btn.textContent = 'MP4'; } }, 'MP4') : null,
          h('button', { class: 'btn danger sm', type: 'button', onclick: async () => { if (await confirmDialog('Delete recording?', `"${r.title}" will be removed from this device. This cannot be undone.`, 'Delete', true)) { await S.deleteRecording(r.id); render(); } } }, h('span', { html: icon('trash') }))))));
    }
  };
  await render(); return () => urls.forEach(u => URL.revokeObjectURL(u));
}

/* =========================== HISTORY =========================== */
export async function mountHistory(root) {
  const render = async () => {
    const list = await S.listHistory(200); const box = $('#hs-list', root);
    if (!list.length) { box.innerHTML = '<div class="empty">No broadcasts yet.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Started</th><th>Duration</th><th>Destinations</th><th>Result</th></tr></thead><tbody>${list.map(x => `<tr><td><b>${esc(x.title)}</b><br><span class="small muted">${esc(x.mode || '')} · ${esc(x.orientation === 'portrait' ? '9:16' : '16:9')} · ${esc(x.quality || '')}</span></td><td>${esc(fmtDate(x.startedAt || x.at))}</td><td>${x.duration != null ? esc(fmtDuration(x.duration)) : '—'}</td><td>${esc((x.destinations || []).join(', '))}</td><td>${badge((x.status || '').toLowerCase(), x.status || '—')}${x.error ? '<br><span class="small muted">' + esc(x.error) + '</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  };
  $('#hs-clear', root).onclick = async () => { if (!await confirmDialog('Clear history?', 'Removes the broadcast list from this device.', 'Clear', true)) return; for (const x of await S.listHistory(1000)) await S.deleteHistory(x.id); render(); };
  await render();
}

/* =========================== DEVICE SETTINGS =========================== */
export async function mountDevices(root) {
  await cam.init(); const offs = [];
  const seg = (sel, cur, fn) => { const el = $(sel, root); const paint = () => $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === cur()))); el.onclick = e => { const b = e.target.closest('button[data-v]'); if (b) { fn(b.dataset.v); paint(); } }; paint(); };
  seg('#ds-theme', currentTheme, v => setTheme(v));
  const fill = () => { const f = (sel, list, cur, def) => { const s = $(sel, root); s.innerHTML = `<option value="">${def}</option>` + list.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || def + ' ' + (i + 1))}</option>`).join(''); s.value = cur || ''; }; f('#ds-cam', cam.devices.video, cam.s.videoDeviceId, 'Default'); f('#ds-mic', cam.devices.audio, cam.s.audioDeviceId, 'Default'); };
  offs.push(cam.on('devices', fill)); fill();
  $('#ds-cam', root).onchange = e => { cam.s.videoDeviceId = e.target.value; cam.save(); toast('Saved'); }; $('#ds-mic', root).onchange = e => { cam.s.audioDeviceId = e.target.value; cam.save(); toast('Saved'); };
  $('#ds-perm', root).onclick = async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); s.getTracks().forEach(t => t.stop()); await cam.refreshDevices(); await cam.queryPermissions(); toast('Devices refreshed', 'ok'); } catch (e) { toast('Permission was not granted: ' + (e.name || e.message), 'err'); } };
  const prefs = (await S.kvGet('prefs', {})) || {}; const savePrefs = async p => { Object.assign(prefs, p); await S.kvSet('prefs', prefs); if (isUser() && apiConfigured()) api.savePrefs({ prefs: { ...prefs } }).catch(() => {}); };
  $('#ds-mirror', root).checked = !!cam.s.mirror; $('#ds-mirror', root).onchange = e => cam.setMirror(e.target.checked);
  $('#ds-count', root).value = String(cam.s.countdown ?? 0); $('#ds-count', root).onchange = e => { cam.s.countdown = Number(e.target.value); cam.save(); savePrefs({ countdown: cam.s.countdown }); };
  $('#ds-remind', root).value = String(prefs.reminderMin ?? 15); $('#ds-remind', root).onchange = e => savePrefs({ reminderMin: Number(e.target.value) });
  // gateway
  const gwForm = $('#gw-form', root); const cur = (await S.kvGet('gateway', {})) || {};
  gwForm.whipBase.value = cur.whipBase || ''; gwForm.relayApi.value = cur.relayApi || ''; gwForm.authType.value = cur.authType || 'bearer';
  const paintGw = async () => { const gw = await resolveGateway(); $('#gw-badge', root).className = 'badge ' + (gw ? 'ready' : 'disconnected'); $('#gw-badge', root).textContent = gw ? (gw.source === 'owner' ? 'Using owner gateway' : 'Personal gateway set') : 'Not set'; }; paintGw();
  gwForm.onsubmit = async e => { e.preventDefault(); const f = new FormData(gwForm); const wb = String(f.get('whipBase') || '').trim(), ra = String(f.get('relayApi') || '').trim();
    for (const u of [wb, ra]) if (u && !/^https:\/\//i.test(u)) return toast('Gateway URLs must start with https://', 'err');
    await S.kvSet('gateway', { whipBase: wb, relayApi: ra, authType: f.get('authType') }); if (f.get('token')) await S.kvSet('secret:gateway-token', String(f.get('token'))); gwForm.token.value = ''; toast('Gateway saved on this device', 'ok'); paintGw(); };
  $('#gw-test', root).onclick = async e => { const b = e.target; b.disabled = true; const r = await checkGateway(); const box = $('#gw-result', root); box.hidden = false; box.className = 'notice small mt ' + (r.ok ? 'ok' : 'err'); box.textContent = r.message + (r.ms ? ` (${r.ms} ms)` : '') + (r.relay ? ' · relay OK' : ''); b.disabled = false; };
  $('#gw-clear', root).onclick = async () => { await S.kvDel('gateway'); await S.kvDel('secret:gateway-token'); gwForm.reset(); paintGw(); toast('Gateway removed'); };
  return () => offs.forEach(f => f());
}

/* =========================== STORAGE MANAGER =========================== */
export async function mountStorage(root) {
  const paint = async () => {
    const s = await S.localSummary(); const est = await S.storageEstimate(); const persisted = await S.persistStatus();
    $('#st-kv', root).innerHTML = `<span>Recordings</span><b>${s.recordings} (${fmtBytes(s.recordingBytes)})</b><span>Stream presets</span><b>${s.presets}</b><span>Saved settings</span><b>${s.kvItems}</b><span>History entries</span><b>${s.history}</b><span>Persistent storage</span><b>${persisted == null ? 'Unknown' : persisted ? 'Granted' : 'Not granted'}</b>`;
    $('#st-bar', root).style.width = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) + '%' : '0';
    $('#st-est', root).textContent = est ? `${fmtBytes(est.usage)} used of ${fmtBytes(est.quota)} browser quota (${fmtBytes(est.free)} free).` : 'This browser does not report storage usage.';
    const c = S.driveConnected(); $('#st-drive-badge', root).className = 'badge ' + (c ? 'connected' : 'disconnected'); $('#st-drive-badge', root).textContent = c ? 'Connected' : 'Disconnected';
  };
  $('#st-persist', root).onclick = async () => { const ok = await S.requestPersist(); toast(ok ? 'The browser agreed to keep your data.' : 'The browser did not grant persistent storage. Installing the app to your home screen often helps.', ok ? 'ok' : ''); paint(); };
  $('#st-export', root).onclick = async () => { downloadBlob(new Blob([JSON.stringify(await S.exportLocalData(), null, 2)], { type: 'application/json' }), 'gd-live-studio-local-data.json'); toast('Exported (stream keys are never included)', 'ok'); };
  $('#st-delete', root).onclick = async () => { if (!await confirmDialog('Delete ALL local data?', 'Recordings, presets, overlays, history and settings stored in this browser will be permanently removed. Download anything you need first.', 'Delete everything', true)) return; await S.deleteAllLocalData(); toast('Local data deleted', 'ok'); paint(); };
  $('#st-drive-connect', root).onclick = async () => { try { await S.connectDrive(); toast('Google Drive connected (drive.file only)', 'ok'); } catch (e) { const m = $('#st-drive-msg', root); m.hidden = false; m.className = 'notice err small mt'; m.textContent = e.message; } paint(); };
  $('#st-drive-disc', root).onclick = () => { S.disconnectDrive(); paint(); toast('Drive access revoked'); };
  if (!googleConfigured()) { const m = $('#st-drive-msg', root); m.hidden = false; m.className = 'notice warn small mt'; m.textContent = 'Google Drive needs GOOGLE_CLIENT_ID in js/config.js (owner setup).'; }
  paint();
}

/* =========================== HELP =========================== */
export async function mountHelp(root) {
  $('#hp-announce', root).innerHTML = (state.config.announcements || []).map(a => `<div class="notice mb"><strong>${esc(a.title)}</strong>${esc(a.body)}</div>`).join('');
  const box = $('#hp-faq', root);
  if (!apiConfigured()) return;
  try { const c = await api.helpContent(); const faqs = (c.items || []).filter(x => x.type === 'FAQ'), tut = (c.items || []).filter(x => x.type === 'Tutorial');
    const sec = (t, a) => a.length ? `<div class="card mb"><h2>${t}</h2>${a.map(x => `<details class="instr"><summary>${esc(x.title)}</summary><div class="body">${esc(x.body).replace(/\n/g, '<br>')}${x.url ? `<p><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Open link</a></p>` : ''}</div></details>`).join('')}</div>` : '';
    box.innerHTML = sec('Tutorials', tut) + sec('FAQ', faqs); } catch { /* static help is still shown */ }
}

/* =========================== PROFILE =========================== */
export async function mountProfile(root) {
  const u = state.user; $('#pf-guest', root).hidden = !!u; $('#pf-main', root).hidden = !u; if (!u) return;
  $('#pf-name', root).textContent = u.name; $('#pf-email', root).textContent = u.email; $('#pf-status', root).className = 'badge ' + (u.status || '').toLowerCase(); $('#pf-status', root).textContent = u.status; $('#pf-role', root).textContent = u.role === 'SuperAdmin' ? 'Super Admin' : 'Registered User';
  const av = $('#pf-avatar', root); av.innerHTML = ''; if (u.avatar && /^https:\/\//.test(u.avatar)) av.append(h('img', { src: u.avatar, alt: '', referrerpolicy: 'no-referrer' })); else av.textContent = (u.name || '?')[0].toUpperCase();
  const f = $('#pf-form', root); f.displayName.value = u.name || ''; f.avatarUrl.value = u.avatar || ''; f.channelName.value = u.channelName || ''; f.defaultTitle.value = u.defaultTitle || '';
  $('#pf-consent', root).textContent = u.consentAt ? fmtDate(u.consentAt) + ' (v' + (u.consentVersion || '1') + ')' : 'on record';
  f.onsubmit = async e => { e.preventDefault(); try { const r = await api.updateProfile({ displayName: f.displayName.value, avatarUrl: f.avatarUrl.value, channelName: f.channelName.value, defaultTitle: f.defaultTitle.value }); Object.assign(state.user, r.user); toast('Profile saved', 'ok'); mountProfile(root); } catch (er) { toast(er.message, 'err'); } };
  $('#pf-pass-card', root).hidden = u.authProvider === 'google';
  $('#pf-pass', root).onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); try { if (String(fd.get('next')).length < 10) throw new Error('Use a password with at least 10 characters.'); const r = await api.changePassword({ currentPw: await derivePw(fd.get('current'), u.email), nextPw: await derivePw(fd.get('next'), u.email) }); if (r.session) setSession({ token: r.session.token, exp: new Date(r.session.expiresAt).getTime() }); e.target.reset(); toast('Password changed. Other devices were signed out.', 'ok'); } catch (er) { toast(er.message, 'err'); } };
  $('#pf-export', root).onclick = async () => { try { const d = await api.exportData(); downloadBlob(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }), 'gd-live-studio-account-data.json'); toast('Account data exported', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  $('#pf-logout', root).onclick = async () => { await logout(); location.hash = '#/login'; };
  $('#pf-delete', root).onclick = async () => {
    const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: u.authProvider === 'google' ? 'Type DELETE to confirm' : 'Your password' });
    const r = await modal({ title: 'Delete your account?', body: h('div', {}, h('p', {}, 'This permanently deletes your account and data. It cannot be undone.'), h('label', { class: 'field' }, u.authProvider === 'google' ? 'Confirmation' : 'Password', pw)), actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Delete forever', class: 'danger', value: true }] });
    if (!r) return; try { await removeAccount(u.authProvider === 'google' ? (pw.value === 'DELETE' ? 'DELETE' : '') : pw.value); toast('Account deleted', 'ok'); location.hash = '#/login'; } catch (e) { toast(e.message, 'err'); }
  };
}

/* =========================== ABOUT / LOGIN =========================== */
export async function mountAbout(root) { $('#ab-version', root).textContent = CONFIG.VERSION; }
export async function mountLoginPage(root) { mountLogin(root, { onDone: () => { location.hash = '#/dashboard'; } }); }
