/* GD LIVE STUDIO — Stream Scheduler (list + calendar). Logged-in users sync to the backend; guests are told scheduling needs an account.
 * Statuses: Draft, Scheduled, Ready, Live, Completed, Failed, Cancelled.
 * "Live" can only be set by the broadcast engine after a platform confirms it; users cannot pick it manually.
 */
import { $, $$, esc, h, icon, toast, modal, confirmDialog, badge, fmtDate } from './ui.js';
import { api, apiConfigured } from './api.js';
import { state, isUser } from './state.js';
import { kvGet, kvSet } from './storage.js';

export const SCHEDULE_STATUSES = ['Draft', 'Scheduled', 'Ready', 'Live', 'Completed', 'Failed', 'Cancelled'];
const USER_SETTABLE = ['Draft', 'Scheduled', 'Ready', 'Cancelled'];

async function loadAll() {
  if (apiConfigured() && isUser()) { try { const r = await api.schedList(); await kvSet('schedCache', r.items); return { items: r.items, source: 'server' }; } catch (e) { return { items: await kvGet('schedCache', []), source: 'cache', error: e.message }; } }
  return { items: await kvGet('schedLocal', []), source: 'local' };
}
async function persist(item, items, source) {
  if (source === 'server' || (apiConfigured() && isUser())) { const r = await api.schedSave(item); return r.item; }
  const i = items.findIndex(x => x.id === item.id); const rec = { ...item, id: item.id || 'sch_' + Math.random().toString(36).slice(2, 10), updatedAt: new Date().toISOString() };
  if (i >= 0) items[i] = rec; else items.push(rec); await kvSet('schedLocal', items); return rec;
}

function editor(item, platforms) {
  const it = { title: '', date: '', time: '', platforms: [], description: '', privacy: 'unlisted', reminderMin: 15, notes: '', status: 'Scheduled', ...(item || {}) };
  const form = h('form', { class: 'col' });
  const f = (label, el) => h('label', { class: 'field' }, label, el);
  const title = h('input', { type: 'text', maxlength: 100, required: true, value: it.title });
  const date = h('input', { type: 'date', required: true, value: it.date }); const time = h('input', { type: 'time', required: true, value: it.time });
  const desc = h('textarea', { maxlength: 2000 }, it.description);
  const priv = h('select', {}, ...['unlisted', 'public', 'private'].map(p => h('option', { value: p, selected: it.privacy === p }, p[0].toUpperCase() + p.slice(1))));
  const rem = h('select', {}, ...[[0, 'None'], [5, '5 minutes before'], [15, '15 minutes before'], [60, '1 hour before']].map(([v, l]) => h('option', { value: v, selected: Number(it.reminderMin) === v }, l)));
  const stat = h('select', {}, ...USER_SETTABLE.map(s => h('option', { value: s, selected: it.status === s }, s)));
  if (it.status === 'Live' || it.status === 'Completed' || it.status === 'Failed') stat.append(h('option', { value: it.status, selected: true }, it.status + ' (set by the platform)')), stat.disabled = true;
  const notes = h('textarea', { maxlength: 1000 }, it.notes);
  const pBox = h('div', { class: 'col' }, ...platforms.map(p => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: p.id, checked: (it.platforms || []).includes(p.id) }), p.name)));
  form.append(f('Title', title), h('div', { class: 'form-grid' }, f('Date', date), f('Time', time)), f('Platforms', pBox), f('Description', desc), h('div', { class: 'form-grid' }, f('Privacy', priv), f('Reminder', rem), f('Status', stat)), f('Notes', notes));
  return { form, read: () => ({ ...(item?.id ? { id: item.id } : {}), title: title.value.trim(), date: date.value, time: time.value, platforms: $$('input[type=checkbox]', pBox).filter(c => c.checked).map(c => c.value), description: desc.value.trim(), privacy: priv.value, reminderMin: Number(rem.value), notes: notes.value.trim(), status: stat.disabled ? it.status : stat.value }) };
}
const when = it => { const d = new Date(`${it.date}T${it.time || '00:00'}`); return isNaN(d) ? null : d; };

export async function mountSchedule(root) {
  let data = await loadAll(); let view = 'list'; let month = new Date(); month.setDate(1);
  const note = $('#sc-note', root);
  if (data.source === 'local') { note.hidden = false; note.textContent = apiConfigured() ? 'You are not signed in: schedules are saved on this device only.' : 'Local mode: schedules are saved on this device only (backend not configured).'; }
  else if (data.source === 'cache') { note.hidden = false; note.textContent = 'Could not reach the backend (' + data.error + '). Showing the last synced copy.'; }
  const platforms = state.config.platforms.filter(p => p.enabled !== false);

  const openEditor = async item => {
    const ed = editor(item, platforms);
    const r = await modal({ title: item ? 'Edit scheduled stream' : 'New scheduled stream', body: ed.form, actions: [{ label: 'Cancel', class: 'ghost', value: null }, { label: 'Save', class: 'accent', value: true }] });
    if (!r) return; const v = ed.read(); if (!v.title || !v.date || !v.time) return toast('Title, date and time are required.', 'err');
    try { await persist(v, data.items, data.source); data = await loadAll(); toast('Saved', 'ok'); render(); } catch (e) { toast(e.message, 'err'); }
  };
  const card = it => {
    const d = when(it); const past = d && d < new Date() && ['Scheduled', 'Ready', 'Draft'].includes(it.status);
    return h('div', { class: 'card flat' }, h('div', { class: 'row between' }, h('div', {}, h('b', {}, it.title), h('div', { class: 'small muted' }, d ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—', ' · ', (it.platforms || []).map(id => platforms.find(p => p.id === id)?.name || id).join(', ') || 'No platform')), h('span', { html: badge(it.status.toLowerCase(), it.status) })),
      past ? h('div', { class: 'small', style: 'color:var(--warn);margin-top:6px' }, 'This time has passed. Update it or mark it cancelled.') : null,
      it.description ? h('p', { class: 'small muted', style: 'margin:8px 0 0' }, it.description) : null,
      h('div', { class: 'row mt' }, h('button', { class: 'btn soft sm', type: 'button', onclick: () => openEditor(it) }, 'Edit'),
        ['Scheduled', 'Ready'].includes(it.status) ? h('a', { class: 'btn accent sm', href: '#/go-live?schedule=' + encodeURIComponent(it.id) }, 'Go live with this') : null,
        h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { if (!await confirmDialog('Delete scheduled stream?', `Delete "${it.title}"?`, 'Delete', true)) return; try { if (data.source === 'server') await api.schedDelete({ id: it.id }); else { data.items = data.items.filter(x => x.id !== it.id); await kvSet('schedLocal', data.items); } data = await loadAll(); render(); } catch (e) { toast(e.message, 'err'); } } }, 'Delete')));
  };
  const renderList = () => {
    const box = $('#sc-list', root); box.innerHTML = ''; const items = [...data.items].sort((a, b) => (when(a) || 0) - (when(b) || 0));
    if (!items.length) { box.append(h('div', { class: 'empty' }, 'No scheduled streams yet. Press New to plan one.')); return; }
    const col = h('div', { class: 'col' }); items.forEach(i => col.append(card(i))); box.append(col);
  };
  const renderCal = () => {
    const grid = $('#cal-grid', root); grid.innerHTML = ''; $('#cal-title', root).textContent = month.toLocaleString([], { month: 'long', year: 'numeric' });
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => grid.append(h('div', { class: 'dow' }, d)));
    const first = new Date(month.getFullYear(), month.getMonth(), 1); const start = new Date(first); start.setDate(1 - first.getDay());
    const todayKey = new Date().toDateString();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const evs = data.items.filter(x => x.date === key);
      const b = h('button', { type: 'button', class: 'day' + (d.getMonth() !== month.getMonth() ? ' out' : '') + (d.toDateString() === todayKey ? ' today' : ''), onclick: () => showDay(key, evs) }, h('span', { class: 'n' }, d.getDate()), ...evs.slice(0, 2).map(e => h('span', { class: 'ev' }, e.title)), evs.length > 2 ? h('span', { class: 'small muted' }, '+' + (evs.length - 2)) : null);
      grid.append(b);
    }
  };
  const showDay = (key, evs) => { const box = $('#cal-day', root); box.innerHTML = ''; box.append(h('h3', {}, new Date(key + 'T00:00').toLocaleDateString([], { dateStyle: 'full' })));
    if (!evs.length) { box.append(h('div', { class: 'empty' }, 'Nothing scheduled.'), h('button', { class: 'btn soft sm mt', type: 'button', onclick: () => openEditor({ date: key }) }, 'Schedule a stream on this day')); return; }
    const col = h('div', { class: 'col' }); evs.forEach(e => col.append(card(e))); box.append(col); };
  const render = () => { $('#sc-list', root).hidden = view !== 'list'; $('#sc-cal', root).hidden = view !== 'calendar'; $$('#sc-view button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === view))); view === 'list' ? renderList() : renderCal(); };
  $('#sc-view', root).onclick = e => { const b = e.target.closest('button[data-v]'); if (b) { view = b.dataset.v; render(); } };
  $('#sc-new', root).onclick = () => openEditor(null);
  $('#cal-prev', root).onclick = () => { month.setMonth(month.getMonth() - 1); renderCal(); }; $('#cal-next', root).onclick = () => { month.setMonth(month.getMonth() + 1); renderCal(); };
  render();
  // in-app reminders while the app is open (no background push is claimed)
  const t = setInterval(async () => {
    const now = Date.now(); const sent = (await kvGet('remindersSent', {})) || {};
    for (const it of data.items) { if (!['Scheduled', 'Ready'].includes(it.status) || !it.reminderMin) continue; const d = when(it); if (!d) continue; const diff = (d - now) / 60000;
      if (diff <= it.reminderMin && diff > -5 && !sent[it.id + it.date + it.time]) { sent[it.id + it.date + it.time] = 1; await kvSet('remindersSent', sent); toast(`Reminder: "${it.title}" starts ${diff > 1 ? 'in ' + Math.round(diff) + ' min' : 'now'}.`, '', { sticky: true }); } }
  }, 30000);
  return () => clearInterval(t);
}
