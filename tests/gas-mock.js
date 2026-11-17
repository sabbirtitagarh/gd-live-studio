/* In-memory mock of the Google Apps Script services used by the GD LIVE STUDIO backend.
 * Purpose: run the REAL backend code (apps-script/*.gs) in Node to test logic, validation, authorisation and security rules.
 * It is NOT a substitute for testing the deployed Web App (see docs/TESTING_REPORT.md for what was and was not covered).
 */
const crypto = require('crypto');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function signed(buf) { return Array.from(buf, b => (b > 127 ? b - 256 : b)); }
function toBuf(v) { return Array.isArray(v) ? Buffer.from(v.map(b => (b < 0 ? b + 256 : b))) : Buffer.from(String(v), 'utf8'); }

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = this.sh.cells.get(`${this.r + i},${this.c + j}`); row.push(v === undefined ? '' : v); } out.push(row); } return out; }
  setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { this.sh.cells.set(`${this.r + i},${this.c + j}`, v); this.sh.fmtUsed.set(`${this.r + i},${this.c + j}`, this.sh.fmt.get(`${this.r + i},${this.c + j}`) || 'General'); })); return this; }
  setNumberFormat(f) { for (let i = 0; i < Math.min(this.nr, 60); i++) for (let j = 0; j < this.nc; j++) this.sh.fmt.set(`${this.r + i},${this.c + j}`, f); return this; }
  setBackground() { return this; } setFontColor() { return this; } setFontWeight() { return this; } setDataValidation() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.fmt = new Map(); this.fmtUsed = new Map(); this.maxCols = 26; }
  getMaxColumns() { return this.maxCols; } insertColumnsAfter(a, n) { this.maxCols += n; }
  getMaxRows() { return 1000; } setFrozenRows() {}
  getLastRow() { let m = 0; for (const [k, v] of this.cells) { if (v !== '' && v != null) m = Math.max(m, Number(k.split(',')[0])); } return m; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  deleteRow(r) { const nc = new Map(); for (const [k, v] of this.cells) { const [rr, cc] = k.split(',').map(Number); if (rr < r) nc.set(k, v); else if (rr > r) nc.set(`${rr - 1},${cc}`, v); } this.cells = nc; }
  protect() { return { setDescription() { return this; }, setWarningOnly() { return this; } }; }
}
class Spreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = [new Sheet('Sheet1')]; }
  getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; } getName() { return this.name; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; } insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; } deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function createEnv(opts = {}) {
  const props = new Map(Object.entries(opts.props || {})); const cache = new Map(); const spreadsheets = new Map(); const files = [];
  let lockHeld = false; const fetchLog = []; const fetchHandlers = opts.fetch || (() => ({ code: 404, body: '{}' }));
  const env = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, Buffer,
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    CacheService: { getScriptCache: () => ({ get: k => { const e = cache.get(k); if (!e) return null; if (e.exp < Date.now()) { cache.delete(k); return null; } return e.v; }, put: (k, v, s) => cache.set(k, { v: String(v), exp: Date.now() + (s || 600) * 1000 }), remove: k => cache.delete(k), removeAll: ks => ks.forEach(k => cache.delete(k)) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => { if (lockHeld) throw new Error('lock contention'); lockHeld = true; }, releaseLock: () => { lockHeld = false; } }) },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, v) => signed(crypto.createHash('sha256').update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: bytes => ({ getDataAsString: () => toBuf(bytes).toString('utf8') }),
      formatDate: (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ').replace(':', '')
    },
    SpreadsheetApp: {
      create: name => { const id = 'ss_' + crypto.randomBytes(6).toString('hex'); const s = new Spreadsheet(id, name); spreadsheets.set(id, s); return s; },
      openById: id => { if (!spreadsheets.has(id)) throw new Error('not found'); return spreadsheets.get(id); },
      newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } })
    },
    UrlFetchApp: { fetch: (url, o) => { fetchLog.push(url); const r = fetchHandlers(url, o); return { getResponseCode: () => r.code, getContentText: () => r.body }; } },
    DriveApp: {
      createFolder: n => ({ getId: () => 'fld_1', isTrashed: () => false, name: n }),
      getFolderById: () => ({ getId: () => 'fld_1', isTrashed: () => false }),
      getFileById: id => ({ makeCopy: (name) => { const f = { id: 'file_' + files.length, name, trashed: false }; files.push(f); return { getId: () => f.id, getSize: () => 1234 }; }, setTrashed: () => {} })
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; }, create() {} }), deleteTrigger() {} }
  };
  const ctx = vm.createContext(env);
  const dir = path.join(__dirname, '..', 'apps-script');
  const order = ['Configuration', 'Security', 'AuditLogger', 'Authentication', 'UserManager', 'YouTubeService', 'FacebookService', 'InstagramService', 'PlatformManager', 'StreamManager', 'Scheduler', 'RecordingManager', 'StorageManager', 'Analytics', 'AdminController', 'ApiRouter', 'Code'];
  for (const f of order) vm.runInContext(fs.readFileSync(path.join(dir, f + '.gs'), 'utf8'), ctx, { filename: f + '.gs' });
  // Expose helpers to the test script
  const call = (action, payload = {}, session) => { const out = ctx.doPost({ postData: { contents: JSON.stringify({ action, payload, session, v: '1', rid: 'test' }) } }); return JSON.parse(out.getContent()); };
  return { ctx, props, spreadsheets, files, call, fetchLog, run: code => vm.runInContext(code, ctx) };
}
module.exports = { createEnv };
