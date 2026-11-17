/* GD LIVE STUDIO — Admin Control Panel (client).
 * This UI is only a convenience. The backend re-verifies the Super Admin role on EVERY admin.* call,
 * so editing JavaScript or local state cannot grant admin powers.
 */
import { $, $$, esc, h, toast, modal, confirmDialog, badge, fmtDate, relTime, debounce, icon } from './ui.js';
import { api } from './api.js';
import { state, isAdmin, DEFAULT_PLATFORMS, DEFAULT_FEATURES } from './state.js';

const TABS = [['dashboard', 'Dashboard'], ['users', 'Users'], ['platforms', 'Platforms'], ['settings', 'Settings'], ['content', 'Content'], ['system', 'System'], ['audit', 'Audit logs']];
const A = (sub, p) => api.admin(sub, p);
const kvRows = obj => Object.entries(obj).map(([k, v]) => `<span>${esc(k)}</span><b>${esc(v)}</b>`).join('');

export async function mountAdmin(root) {
  if (!isAdmin()) { root.innerHTML = '<div class="notice err"><strong>Not authorised</strong>This area is for the GD TECH ACADEMY owner only.</div>'; return; }
  const tabs = $('#ad-tabs', root), body = $('#ad-body', root); let cur = 'dashboard';
  tabs.innerHTML = ''; for (const [id, label] of TABS) tabs.append(h('button', { type: 'button', 'aria-pressed': String(id === cur), 'data-id': id, role: 'tab' }, label));
  const show = async id => { cur = id; $$('button', tabs).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id))); body.innerHTML = '<div class="empty">Loading…</div>'; try { await VIEWS[id](body); } catch (e) { body.innerHTML = `<div class="notice err"><strong>Request failed</strong>${esc(e.message)}</div>`; } };
  tabs.onclick = e => { const b = e.target.closest('button[data-id]'); if (b) show(b.dataset.id); };
  await show('dashboard');
}

const VIEWS = {
  async dashboard(box) {
    const d = await A('dashboard');
    box.innerHTML = `<div class="grid cols-3">
      ${[['Registered users', d.users.total], ['Active users', d.users.active], ['Pending approval', d.users.pending], ['Suspended', d.users.suspended], ['Stream sessions', d.streams.total], ['Errors (24 h)', d.errors24h]].map(([l, v]) => `<div class="card stat"><span class="label">${l}</span><span class="value">${esc(v)}</span></div>`).join('')}</div>
      <div class="grid cols-2 mt">
        <div class="card"><h3>Application usage</h3><div class="kv">${kvRows({ 'Users signed in (7 days)': d.usage.logins7d, 'Streams started (7 days)': d.usage.streams7d, 'Scheduled events': d.usage.schedules, 'Recordings metadata': d.usage.recordings })}</div></div>
        <div class="card"><h3>System health</h3><div class="kv">${kvRows({ Backend: d.health.status, 'Sheets reachable': d.health.sheets ? 'Yes' : 'No', 'Last backup': d.health.lastBackup || 'Never', Maintenance: d.health.maintenance ? 'ON' : 'Off' })}</div></div>
        <div class="card"><h3>Integration health</h3>${d.integrations.length ? `<ul class="list">${d.integrations.map(i => `<li><span><b>${esc(i.platform)}</b><br><span class="small muted">${esc(i.connected)} user connection(s), self-reported${i.errors ? ' · ' + esc(i.errors) + ' in error' : ''}</span></span>${badge(i.enabled ? 'active' : 'disconnected', i.enabled ? 'Enabled' : 'Disabled')}</li>`).join('')}</ul>` : '<div class="empty">No integration data yet.</div>'}</div>
        <div class="card"><h3>Recent activity</h3>${d.recent.length ? `<ul class="list">${d.recent.map(a => `<li><span>${esc(a.action)}<br><span class="small muted">${esc(a.actor || '')}</span></span><span class="small muted">${esc(relTime(a.time))}</span></li>`).join('')}</ul>` : '<div class="empty">Nothing yet.</div>'}</div>
      </div>`;
  },

  async users(box) {
    box.innerHTML = `<div class="card"><div class="row"><input type="search" id="u-q" placeholder="Search name or email" class="grow"><select id="u-st"><option value="">All statuses</option><option>Pending</option><option>Active</option><option>Suspended</option></select></div><div id="u-list" class="mt"></div></div>`;
    const load = async () => {
      const r = await A('users.list', { query: $('#u-q', box).value.trim(), status: $('#u-st', box).value });
      const list = $('#u-list', box);
      if (!r.items.length) { list.innerHTML = '<div class="empty">No users found.</div>'; return; }
      list.innerHTML = `<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th><th>Last login</th><th></th></tr></thead><tbody>${r.items.map(u => `<tr data-id="${esc(u.id)}"><td><b>${esc(u.name)}</b><br><span class="small muted">${esc(u.email)}</span></td><td>${esc(u.role)}</td><td>${badge(u.status.toLowerCase(), u.status)}</td><td class="small">${esc(fmtDate(u.createdAt, false))}</td><td class="small">${esc(u.lastLoginAt ? relTime(u.lastLoginAt) : '—')}</td><td><div class="row">${u.status === 'Pending' ? '<button class="btn accent sm" data-a="approve">Approve</button>' : ''}${u.status === 'Active' ? '<button class="btn soft sm" data-a="suspend">Suspend</button>' : ''}${u.status === 'Suspended' ? '<button class="btn accent sm" data-a="restore">Restore</button>' : ''}<button class="btn ghost sm" data-a="role">Role</button><button class="btn ghost sm" data-a="activity">Activity</button><button class="btn danger sm" data-a="delete">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`;
    };
    {
      box.addEventListener('click', async e => {
        const b = e.target.closest('button[data-a]'); if (!b) return; const tr = b.closest('tr'); const id = tr.dataset.id; const name = tr.querySelector('b').textContent; const act = b.dataset.a;
        try {
          if (act === 'approve') await A('users.approve', { id });
          else if (act === 'restore') await A('users.restore', { id });
          else if (act === 'suspend') { const f = h('input', { type: 'text', maxlength: 200, placeholder: 'Reason (recorded in audit log)' }); const r = await modal({ title: 'Suspend ' + name + '?', body: h('label', { class: 'field' }, 'Reason', f), actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Suspend', class: 'danger', value: true }] }); if (!r) return; await A('users.suspend', { id, reason: f.value }); }
          else if (act === 'role') { const s = h('select', {}, h('option', { value: 'User' }, 'Registered User'), h('option', { value: 'SuperAdmin' }, 'Super Admin')); const r = await modal({ title: 'Assign role to ' + name, body: h('div', {}, h('label', { class: 'field' }, 'Role', s), h('p', { class: 'small muted' }, 'Super Admins have complete control. Grant this very carefully.')), actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Assign', class: 'accent', value: true }] }); if (!r) return; await A('users.setRole', { id, role: s.value }); }
          else if (act === 'activity') { const r = await A('users.activity', { id }); await modal({ title: 'Activity: ' + name, body: h('div', { html: r.items.length ? `<ul class="list">${r.items.map(a => `<li><span>${esc(a.action)}</span><span class="small muted">${esc(fmtDate(a.time))}</span></li>`).join('')}</ul>` : '<div class="empty">No activity recorded.</div>' }), actions: [{ label: 'Close', class: 'soft', value: true }] }); return; }
          else if (act === 'delete') { if (!await confirmDialog('Delete ' + name + '?', 'Permanently deletes the account and their stored records. Their audit history is kept.', 'Delete account', true)) return; await A('users.delete', { id }); }
          toast('Done', 'ok'); load();
        } catch (er) { toast(er.message, 'err'); }
      });
    }
    $('#u-q', box).oninput = debounce(load, 350); $('#u-st', box).onchange = load; await load();
  },

  async platforms(box) {
    const r = await A('platforms.list'); const items = r.items;
    box.innerHTML = `<div class="notice small mb">Owner controls for availability and guidance text. OAuth client IDs live in <span class="mono">js/config.js</span> (public values); client <b>secrets</b> are never stored here.</div><div class="grid cols-2" id="pf-grid"></div>
      <div class="card mt"><h3>Add a custom destination type</h3><form id="pf-add" class="form-grid"><label class="field">ID (a-z, 0-9, -)<input name="id" pattern="[a-z0-9-]{2,24}" required></label><label class="field">Name<input name="name" maxlength="40" required></label><label class="field" style="grid-column:1/-1">Method (official API or protocol)<input name="method" maxlength="160" required></label><label class="field" style="grid-column:1/-1">Eligibility notes<input name="eligibility" maxlength="300"></label><label class="field">Ingest<select name="ingest"><option value="rtmp">RTMP/RTMPS (via gateway)</option><option value="whip">WHIP (direct)</option></select></label><div class="row" style="grid-column:1/-1"><button class="btn accent" type="submit">Add</button></div></form><p class="small muted">Use only official APIs or documented streaming protocols. Private-API workarounds are not supported.</p></div>`;
    const grid = $('#pf-grid', box);
    for (const p of items) {
      const f = h('form', { class: 'card col' },
        h('div', { class: 'row between' }, h('h3', { style: 'margin:0' }, p.name), h('span', { html: badge(p.enabled ? 'active' : 'disconnected', p.enabled ? 'Enabled' : 'Disabled') })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'enabled', checked: p.enabled }), 'Enabled for users'),
        h('label', { class: 'field' }, 'Availability message (shown to users)', h('input', { name: 'apiMessage', maxlength: 300, value: p.apiMessage || '' })),
        h('label', { class: 'field' }, 'Eligibility text', h('textarea', { name: 'eligibility', maxlength: 600 }, p.eligibility || '')),
        h('label', { class: 'field' }, 'Instructions (one step per line)', h('textarea', { name: 'instructions', maxlength: 2000 }, (p.instructions || []).join('\n'))),
        h('label', { class: 'field' }, 'OAuth configuration reference (non-secret note, e.g. “Google Cloud project gd-live-prod”)', h('input', { name: 'oauthRef', maxlength: 200, value: p.oauthRef || '' })),
        h('button', { class: 'btn accent sm', type: 'submit' }, 'Save'));
      f.onsubmit = async e => { e.preventDefault(); const fd = new FormData(f); try { await A('platforms.save', { id: p.id, enabled: !!fd.get('enabled'), apiMessage: fd.get('apiMessage'), eligibility: fd.get('eligibility'), instructions: String(fd.get('instructions')).split('\n').map(s => s.trim()).filter(Boolean), oauthRef: fd.get('oauthRef') }); toast('Saved', 'ok'); } catch (er) { toast(er.message, 'err'); } };
      grid.append(f);
    }
    $('#pf-add', box).onsubmit = async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); try { await A('platforms.add', fd); toast('Added', 'ok'); VIEWS.platforms(box); } catch (er) { toast(er.message, 'err'); } };
  },

  async settings(box) {
    const r = await A('settings.get'); const s = r.settings, ft = r.features, gw = s.gateway || {};
    const feat = Object.keys(DEFAULT_FEATURES);
    box.innerHTML = `<form id="st-form" class="col">
      <div class="card"><h3>General</h3><div class="form-grid">
        <label class="field">Application name<input name="appName" maxlength="60" value="${esc(s.appName)}"></label>
        <label class="field">Theme default<select name="theme"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label class="field">Logo asset reference<input name="logoRef" maxlength="200" value="${esc(s.logoRef)}"><span class="hint">The official GD TECH ACADEMY logo is permanent; this only references the asset path.</span></label>
        <label class="field">Per-user limit for Drive-linked recordings (MB, 0 = no limit)<input type="number" name="storageLimitMb" min="0" value="${esc(s.storageLimitMb)}"></label>
      </div></div>
      <div class="card"><h3>Access</h3><div class="col">
        <label class="check"><input type="checkbox" name="registrationOpen" ${s.registrationOpen ? 'checked' : ''}>Registration open</label>
        <label class="check"><input type="checkbox" name="requireApproval" ${s.requireApproval ? 'checked' : ''}>New accounts require owner approval</label>
        <label class="check"><input type="checkbox" name="guestAccess" ${s.guestAccess ? 'checked' : ''}>Allow guest access</label>
        <label class="check"><input type="checkbox" name="maintenance" ${s.maintenance ? 'checked' : ''}>Maintenance mode (non-admin users see the message below)</label>
        <label class="field">Maintenance message<input name="maintenanceMessage" maxlength="300" value="${esc(s.maintenanceMessage)}"></label>
      </div></div>
      <div class="card"><h3>Feature availability</h3><div class="form-grid">${feat.map(k => `<label class="check"><input type="checkbox" name="f_${k}" ${ft[k] !== false ? 'checked' : ''}>${esc(k.replace(/_/g, ' '))}</label>`).join('')}</div></div>
      <div class="card"><h3>Shared streaming gateway (optional)</h3><p class="small muted">If you host the open-source gateway, users can stream through it. The gateway token is stored server-side in Script Properties and handed to signed-in users only when they go live. Never paste secrets here.</p>
        <div class="form-grid"><label class="check" style="grid-column:1/-1"><input type="checkbox" name="g_enabled" ${gw.enabled ? 'checked' : ''}>Offer the shared gateway to registered users</label>
        <label class="field">WHIP base URL<input type="url" name="g_whipBase" value="${esc(gw.whipBase || '')}" placeholder="https://gateway.example.com:8889"></label>
        <label class="field">Relay API URL<input type="url" name="g_relayApi" value="${esc(gw.relayApi || '')}" placeholder="https://gateway.example.com:8787"></label>
        <label class="field">Auth type<select name="g_authType"><option value="bearer">Bearer</option><option value="basic">Basic</option></select></label></div></div>
      <div class="row"><button class="btn accent lg" type="submit">Save settings</button></div>
      <p class="small muted">The footer “Powered by GD TECH ACADEMY” and the official logo are permanent and are not configurable.</p>
    </form>`;
    $('select[name=theme]', box).value = s.theme || 'auto'; $('select[name=g_authType]', box).value = gw.authType || 'bearer';
    $('#st-form', box).onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target); const chk = n => !!fd.get(n);
      const features = {}; feat.forEach(k => { features[k] = chk('f_' + k); });
      try { await A('settings.save', { settings: { appName: fd.get('appName'), theme: fd.get('theme'), logoRef: fd.get('logoRef'), storageLimitMb: Number(fd.get('storageLimitMb') || 0), registrationOpen: chk('registrationOpen'), requireApproval: chk('requireApproval'), guestAccess: chk('guestAccess'), maintenance: chk('maintenance'), maintenanceMessage: fd.get('maintenanceMessage'), gateway: { enabled: chk('g_enabled'), whipBase: fd.get('g_whipBase'), relayApi: fd.get('g_relayApi'), authType: fd.get('g_authType') } }, features }); toast('Settings saved', 'ok'); } catch (er) { toast(er.message, 'err'); }
    };
  },

  async content(box) {
    const ann = await A('announcements.list'); const cnt = await A('content.list');
    box.innerHTML = `<div class="grid cols-2"><div class="card"><div class="row between"><h3 style="margin:0">Announcements</h3><button class="btn accent sm" id="an-new">New</button></div><ul class="list mt" id="an-list"></ul></div>
      <div class="card"><div class="row between"><h3 style="margin:0">Tutorials &amp; FAQs</h3><button class="btn accent sm" id="ct-new">New</button></div><ul class="list mt" id="ct-list"></ul></div></div>`;
    const edit = async (kind, item) => {
      const isAnn = kind === 'ann'; const title = h('input', { type: 'text', maxlength: 120, value: item?.title || '', required: true }); const bodyT = h('textarea', { maxlength: 3000 }, item?.body || '');
      const type = h('select', {}, ...['Tutorial', 'FAQ'].map(t => h('option', { value: t, selected: item?.type === t }, t))); const url = h('input', { type: 'url', value: item?.url || '', placeholder: 'https://…' });
      const pub = h('input', { type: 'checkbox', checked: item ? item.published : true });
      const form = h('div', { class: 'col' }, h('label', { class: 'field' }, 'Title', title), isAnn ? null : h('label', { class: 'field' }, 'Type', type), h('label', { class: 'field' }, 'Text', bodyT), isAnn ? null : h('label', { class: 'field' }, 'Link (optional)', url), h('label', { class: 'check' }, pub, 'Published'));
      const r = await modal({ title: (item ? 'Edit ' : 'New ') + (isAnn ? 'announcement' : 'content'), body: form, actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Save', class: 'accent', value: true }] }); if (!r) return;
      try { await A(isAnn ? 'announcements.save' : 'content.save', { id: item?.id, title: title.value, body: bodyT.value, type: type.value, url: url.value, published: pub.checked }); toast('Saved', 'ok'); VIEWS.content(box); } catch (er) { toast(er.message, 'err'); }
    };
    const fill = (sel, items, kind) => { const ul = $(sel, box); ul.innerHTML = items.length ? '' : '<li class="empty" style="display:block;width:100%">Nothing yet.</li>'; for (const it of items) ul.append(h('li', {}, h('span', {}, h('b', {}, it.title), h('br'), h('span', { class: 'small muted' }, (it.type ? it.type + ' · ' : '') + (it.published ? 'Published' : 'Draft'))), h('span', { class: 'row' }, h('button', { class: 'btn soft sm', type: 'button', onclick: () => edit(kind, it) }, 'Edit'), h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { if (await confirmDialog('Delete?', it.title, 'Delete', true)) { try { await A(kind === 'ann' ? 'announcements.delete' : 'content.delete', { id: it.id }); VIEWS.content(box); } catch (er) { toast(er.message, 'err'); } } } }, 'Delete')))); };
    fill('#an-list', ann.items, 'ann'); fill('#ct-list', cnt.items, 'ct'); $('#an-new', box).onclick = () => edit('ann'); $('#ct-new', box).onclick = () => edit('ct');
  },

  async system(box) {
    const r = await A('system.health');
    box.innerHTML = `<div class="grid cols-2"><div class="card"><h3>Diagnostics</h3><div class="kv">${kvRows({ 'Backend version': r.version, 'Spreadsheet': r.spreadsheetName, 'Sheets present': r.sheetsPresent + ' / ' + r.sheetsExpected, 'Users': r.counts.users, 'Time zone': r.timezone, 'Last backup': r.lastBackup || 'Never' })}</div>
      <div class="row mt"><button class="btn accent sm" id="sy-backup">Run backup now</button><button class="btn soft sm" id="sy-init">Re-check database</button></div><div id="sy-msg" class="notice small mt" hidden></div></div>
      <div class="card"><h3>Usage statistics</h3><div class="kv">${kvRows(r.usage)}</div></div></div>
      <div class="card mt"><div class="row between"><h3 style="margin:0">Logs</h3><div class="seg" id="sy-seg"><button type="button" data-v="ErrorLogs" aria-pressed="true">Backend errors</button><button type="button" data-v="Requests">Request log</button><button type="button" data-v="Failed">Failed operations</button><button type="button" data-v="BackupLogs">Backups</button></div></div><div id="sy-logs" class="mt"></div></div>`;
    const msg = (t, ok) => { const m = $('#sy-msg', box); m.hidden = false; m.className = 'notice small mt ' + (ok ? 'ok' : 'err'); m.textContent = t; };
    $('#sy-backup', box).onclick = async e => { e.target.disabled = true; try { const x = await A('backup.run'); msg('Backup created: ' + x.name, true); } catch (er) { msg(er.message, false); } e.target.disabled = false; };
    $('#sy-init', box).onclick = async () => { try { const x = await A('system.init'); msg(x.message, true); } catch (er) { msg(er.message, false); } };
    const load = async kind => { $$('#sy-seg button', box).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === kind))); const l = await A('system.logs', { kind }); const el = $('#sy-logs', box);
      el.innerHTML = l.items.length ? `<div class="table-wrap"><table><thead><tr>${l.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${l.items.map(row => `<tr>${row.map(c => `<td class="small">${esc(String(c).slice(0, 220))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">No entries.</div>'; };
    $('#sy-seg', box).onclick = e => { const b = e.target.closest('button[data-v]'); if (b) load(b.dataset.v).catch(er => toast(er.message, 'err')); };
    await load('ErrorLogs');
  },

  async audit(box) {
    box.innerHTML = `<div class="card"><div class="row"><select id="au-f"><option value="">All events</option><option>AUTH</option><option>USER</option><option>CONFIG</option><option>INTEGRATION</option><option>SECURITY</option><option>ACCOUNT_DELETE</option></select><span class="muted small">Passwords, access tokens and complete stream keys are never written to the audit log.</span></div><div id="au-list" class="mt"></div></div>`;
    const load = async () => { const r = await A('audit.list', { category: $('#au-f', box).value }); $('#au-list', box).innerHTML = r.items.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Category</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead><tbody>${r.items.map(a => `<tr><td class="small">${esc(fmtDate(a.time))}</td><td>${esc(a.category)}</td><td>${esc(a.action)}</td><td class="small">${esc(a.actor)}</td><td class="small">${esc(a.target)}</td><td class="small">${esc(a.details)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No entries.</div>'; };
    $('#au-f', box).onchange = load; await load();
  }
};
