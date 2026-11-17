/* Backend logic/security tests: run the real Apps Script code against the in-memory Google service mock.
 * Usage: node tests/backend-test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const { createEnv } = require('./gas-mock');

const OWNER = 'owner@example.com'; const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const googleTokens = new Map();
const env = createEnv({
  props: { OWNER_EMAIL: OWNER, GOOGLE_CLIENT_ID: CLIENT_ID, PW_SERVER_ROUNDS: '5', GATEWAY_JWT_SECRET: 'gw-secret-for-test' },
  fetch: url => { const m = /id_token=([^&]+)/.exec(url); const t = m && googleTokens.get(decodeURIComponent(m[1])); return t ? { code: 200, body: JSON.stringify(t) } : { code: 400, body: '{"error":"invalid_token"}' }; }
});
const { call } = env;
const hex64 = s => crypto.createHash('sha256').update(s).digest('hex');
const fakeGoogle = (email, sub = 'sub_' + email) => { const tok = 'x'.repeat(120) + crypto.randomBytes(4).toString('hex'); googleTokens.set(tok, { aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 3000), email, email_verified: 'true', sub, name: 'Name ' + email, picture: 'https://example.com/p.png' }); return tok; };

let passed = 0, failed = 0; const results = [];
async function t(name, fn) { try { await fn(); passed++; results.push('  PASS  ' + name); } catch (e) { failed++; results.push('  FAIL  ' + name + '\n        ' + (e.message || e)); } }
const ok = r => { assert.strictEqual(r.ok, true, 'expected ok but got ' + JSON.stringify(r.error)); return r.data; };
const err = (r, code) => { assert.strictEqual(r.ok, false, 'expected error ' + code + ' but call succeeded'); if (code) assert.strictEqual(r.error.code, code, 'expected ' + code + ' got ' + r.error.code + ': ' + r.error.message); return r.error; };
const reg = (email, extra = {}) => call('auth.register', { email, pw: hex64(email + 'pw'), displayName: 'Test ' + email, ageGroup: '18+', privacyConsent: true, consentVersion: '1', ...extra });

(async () => {
  let adminSession, userSession, userId, user2Session;

  await t('ping works and auto-initialises nothing sensitive', () => { const d = ok(call('ping')); assert.strictEqual(d.name, 'GD LIVE STUDIO'); });
  await t('database auto-initialises all 14 required sheets', () => {
    ok(call('config.public')); const ss = [...env.spreadsheets.values()][0];
    const want = ['Users', 'UserProfiles', 'AppSettings', 'PlatformConnections', 'StreamSessions', 'StreamSchedules', 'RecordingMetadata', 'UserPreferences', 'Announcements', 'AuditLogs', 'ErrorLogs', 'AdminAccounts', 'FeatureControls', 'BackupLogs'];
    want.forEach(n => assert.ok(ss.getSheetByName(n), 'missing sheet ' + n)); assert.strictEqual(ss.getSheetByName('Sheet1'), null);
    assert.ok(env.props.get('SESSION_SECRET') && env.props.get('PW_PEPPER'), 'secrets not generated');
  });
  await t('public config exposes platforms/features but no secrets', () => {
    const c = ok(call('config.public')); assert.ok(c.platforms.length >= 5); assert.ok(!JSON.stringify(c).includes('oauthRef')); assert.ok(!JSON.stringify(c).includes(env.props.get('SESSION_SECRET')));
    assert.strictEqual(c.gateway.enabled, false);
  });

  await t('owner bootstrap only via Google-verified email (becomes Super Admin)', () => {
    const r = ok(call('auth.google', { idToken: fakeGoogle(OWNER) })); assert.strictEqual(r.user.role, 'SuperAdmin'); assert.strictEqual(r.user.status, 'Active'); adminSession = r.session.token;
    assert.ok(ok(call('admin.dashboard', {}, adminSession)).users.total >= 1);
  });
  await t('password registration with the owner email is blocked', () => { err(reg(OWNER), 'RESERVED'); });
  await t('Google token with wrong audience is rejected', () => { const tok = 'y'.repeat(130); googleTokens.set(tok, { aud: 'other', iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 300), email: 'a@b.co', email_verified: 'true', sub: '1' }); err(call('auth.google', { idToken: tok }), 'GOOGLE_INVALID'); });
  await t('unverified Google email is rejected', () => { const tok = 'z'.repeat(130); googleTokens.set(tok, { aud: CLIENT_ID, iss: 'accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 300), email: 'a@b.co', email_verified: 'false', sub: '2' }); err(call('auth.google', { idToken: tok }), 'GOOGLE_INVALID'); });

  await t('registration validation: under-13, no consent, minor w/o guardian, bad pw format', () => {
    err(reg('kid@example.com', { ageGroup: 'under13' }), 'AGE_RESTRICTED'); err(reg('nc@example.com', { privacyConsent: false }), 'CONSENT_REQUIRED');
    err(reg('teen@example.com', { ageGroup: '13-17' }), 'PARENTAL_CONSENT'); err(call('auth.register', { email: 'bad@example.com', pw: 'plain-text-password', displayName: 'x', ageGroup: '18+', privacyConsent: true }), 'INVALID');
    assert.ok(ok(reg('teen@example.com', { ageGroup: '13-17', parentalConsent: true })).user.status === 'Pending');
  });
  await t('new user is Pending, cannot get a session, duplicate email prevented', () => {
    const r = ok(reg('user1@example.com')); assert.strictEqual(r.user.status, 'Pending'); assert.ok(!r.session); userId = r.user.id; err(reg('USER1@example.com'), 'DUPLICATE');
    const l = ok(call('auth.login', { email: 'user1@example.com', pw: hex64('user1@example.compw') })); assert.strictEqual(l.user.status, 'Pending'); assert.ok(!l.session);
  });
  await t('admin approves; user can sign in; passwords/hashes never returned', () => {
    ok(call('admin.users.approve', { id: userId }, adminSession)); const l = ok(call('auth.login', { email: 'user1@example.com', pw: hex64('user1@example.compw') })); userSession = l.session.token;
    assert.strictEqual(l.user.role, 'User'); assert.ok(!JSON.stringify(l).match(/PasswordHash|PasswordSalt|pw/i));
  });
  await t('wrong password -> generic error; 5 failures lock the account for the window', () => {
    err(call('auth.login', { email: 'nobody@example.com', pw: hex64('x') }), 'INVALID_CREDENTIALS');
    for (let i = 0; i < 5; i++) err(call('auth.login', { email: 'user1@example.com', pw: hex64('wrong' + i) }), 'INVALID_CREDENTIALS'); // five failures are counted...
    err(call('auth.login', { email: 'user1@example.com', pw: hex64('wrong5') }), 'LOCKED');                                  // ...the sixth attempt is locked out
    err(call('auth.login', { email: 'user1@example.com', pw: hex64('user1@example.compw') }), 'LOCKED');                      // even with the correct password
    env.run("Sec.rateClear('login:user1@example.com')");                                                                      // (simulates the 15-minute window expiring)
    assert.ok(ok(call('auth.login', { email: 'user1@example.com', pw: hex64('user1@example.compw') })).session);
  });

  await t('server ignores client-claimed role: ordinary user gets FORBIDDEN on every admin action', () => {
    ['admin.dashboard', 'admin.users.list', 'admin.settings.get', 'admin.system.health', 'admin.audit.list'].forEach(a => err(call(a, { role: 'SuperAdmin', isAdmin: true }, userSession), 'FORBIDDEN'));
    err(call('admin.users.setRole', { id: userId, role: 'SuperAdmin' }, userSession), 'FORBIDDEN');
  });
  await t('unauthenticated, tampered, and garbage sessions are rejected', () => {
    err(call('auth.me', {}), 'SESSION_INVALID'); err(call('auth.me', {}, 'garbage'), 'SESSION_INVALID');
    const parts = userSession.split('.'); const forged = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + 1e9, v: 1, n: 'x' })).toString('base64url') + '.' + parts[1]; err(call('auth.me', {}, forged), 'SESSION_INVALID');
    err(call('admin.dashboard', {}, userSession.slice(0, -2) + 'aa'), 'SESSION_INVALID');
  });
  await t('unknown / malformed actions and oversize bodies are rejected', () => {
    err(call('nope.nothing'), 'UNKNOWN_ACTION'); err(call('../../etc'), 'UNKNOWN_ACTION');
    const big = env.ctx.doPost({ postData: { contents: 'x'.repeat(130000) } }); assert.strictEqual(JSON.parse(big.getContent()).error.code, 'BAD_REQUEST');
    assert.strictEqual(JSON.parse(env.ctx.doPost({ postData: { contents: '{bad' } }).getContent()).error.code, 'BAD_REQUEST');
  });

  await t('formula-injection: user text is stored in text-formatted cells', () => {
    ok(call('user.updateProfile', { displayName: '=IMPORTXML("http://evil","//a")', avatarUrl: '', channelName: '+cmd', defaultTitle: '@x' }, userSession));
    const ss = [...env.spreadsheets.values()][0]; const sh = ss.getSheetByName('UserProfiles'); const fmt = sh.fmt.get('3,2'); assert.strictEqual(fmt, '@');
  });
  await t('profile: avatar must be https, display name required', () => { err(call('user.updateProfile', { displayName: 'A', avatarUrl: 'http://x.com/a.png' }, userSession), 'INVALID'); err(call('user.updateProfile', { displayName: '   ' }, userSession), 'INVALID'); });
  await t('preferences are allow-listed and never store objects', () => {
    const r = ok(call('user.savePrefs', { prefs: { countdown: 3, mirror: true, '../x': 1, nested: { a: 1 }, streamKey: 'abc' } }, userSession)); assert.deepStrictEqual(Object.keys(r.prefs).sort(), ['countdown', 'mirror', 'streamKey'].sort());
  });

  await t('platform metadata: valid upsert, unknown platform rejected, tokens never stored', () => {
    ok(call('platform.upsertConnection', { platform: 'youtube', status: 'Connected', accountLabel: 'My Channel', accountId: 'UC1234abcd' }, userSession));
    err(call('platform.upsertConnection', { platform: 'tiktok', status: 'Connected' }, userSession), 'INVALID'); err(call('platform.upsertConnection', { platform: 'youtube', status: 'Connected', accountId: 'bad id!' }, userSession), 'INVALID');
    assert.strictEqual(ok(call('platform.list', {}, userSession)).items.length, 1);
    assert.ok(env.ctx.Db.columns('PlatformConnections').every(c => !/token|key|secret/i.test(c)));
  });
  await t('owner can disable a platform; users then cannot connect it', () => {
    ok(call('admin.platforms.save', { id: 'youtube', enabled: false, apiMessage: 'Paused for maintenance', eligibility: 'e', instructions: ['a'], oauthRef: 'proj' }, adminSession));
    err(call('platform.upsertConnection', { platform: 'youtube', status: 'Connected', accountLabel: 'x', accountId: 'UC1' }, userSession), 'PLATFORM_DISABLED');
    const pub = ok(call('config.public')).platforms.find(p => p.id === 'youtube'); assert.strictEqual(pub.enabled, false); assert.ok(!('oauthRef' in pub));
    ok(call('admin.platforms.save', { id: 'youtube', enabled: true, apiMessage: '', eligibility: 'e', instructions: ['a'], oauthRef: '' }, adminSession));
  });

  await t('scheduler: users cannot self-set Live/Completed; Live needs platform confirmation', () => {
    err(call('schedule.save', { title: 'T', date: '2027-01-01', time: '10:00', status: 'Live' }, userSession), 'INVALID');
    err(call('schedule.save', { title: 'T', date: '2027-13-01', time: '10:00' }, userSession), 'INVALID'); err(call('schedule.save', { title: 'T', date: '2027-01-01', time: '25:00' }, userSession), 'INVALID');
    const it = ok(call('schedule.save', { title: 'Class', date: '2027-01-01', time: '10:00', platforms: ['youtube', 'bogus'], status: 'Scheduled' }, userSession)).item; assert.deepStrictEqual(it.platforms, ['youtube']);
    err(call('schedule.setStatus', { id: it.id, status: 'Live' }, userSession), 'CONFIRMATION_REQUIRED'); err(call('schedule.setStatus', { id: it.id, status: 'Completed' }, userSession), 'INVALID');
    const live = ok(call('schedule.setStatus', { id: it.id, status: 'Live', confirmation: { platform: 'youtube', broadcastId: 'bc1', lifecycle: 'live' } }, userSession)).item; assert.strictEqual(live.status, 'Live');
    err(call('schedule.save', { id: it.id, title: 'Class', date: '2027-01-01', time: '10:00', status: 'Scheduled' }, userSession), 'INVALID');
    assert.strictEqual(ok(call('schedule.setStatus', { id: it.id, status: 'Completed' }, userSession)).item.status, 'Completed');
  });
  await t('data isolation: another user cannot read/modify my schedules or sessions', () => {
    const r2 = ok(reg('user2@example.com')); ok(call('admin.users.approve', { id: r2.user.id }, adminSession)); user2Session = ok(call('auth.login', { email: 'user2@example.com', pw: hex64('user2@example.compw') })).session.token;
    assert.strictEqual(ok(call('schedule.list', {}, user2Session)).items.length, 0);
    const mine = ok(call('schedule.list', {}, userSession)).items[0]; err(call('schedule.delete', { id: mine.id }, user2Session), 'NOT_FOUND'); err(call('schedule.setStatus', { id: mine.id, status: 'Cancelled' }, user2Session), 'NOT_FOUND');
  });

  await t('stream sessions: metadata only; secrets redacted from stored errors and logs', () => {
    const s = ok(call('stream.start', { title: 'Live', mode: 'single', orientation: 'portrait', quality: 'hd', destinations: [{ platform: 'rtmp', label: 'Twitch', url: 'rtmps://live.example/app/SECRETKEY1234567890' }] }, userSession));
    ok(call('stream.end', { sessionId: s.sessionId, status: 'Failed', durationSec: 12, endReason: 'error', error: 'failed pushing to rtmps://live.example/app/SECRETKEY1234567890 with token abcdefghijklmnop12345' }, userSession));
    const row = ok(call('stream.list', {}, userSession)).items[0]; assert.strictEqual(row.status, 'Failed');
    const dump = JSON.stringify([...env.spreadsheets.values()][0].sheets.map(sh => [...sh.cells.values()])); assert.ok(!dump.includes('SECRETKEY1234567890'), 'stream key leaked into the sheet'); assert.ok(!dump.includes('abcdefghijklmnop12345'), 'token leaked');
    err(call('stream.end', { sessionId: s.sessionId, status: 'Failed' }, user2Session), 'NOT_FOUND');
  });

  await t('recordings metadata: respects per-user storage limit', () => {
    ok(call('admin.settings.save', { settings: { storageLimitMb: 1 } }, adminSession));
    ok(call('recording.save', { title: 'r1', sizeBytes: 600000, mime: 'video/webm', orientation: 'landscape', storage: 'drive', driveFileId: 'abc123' }, userSession));
    err(call('recording.save', { title: 'r2', sizeBytes: 600000, storage: 'drive' }, userSession), 'STORAGE_LIMIT'); ok(call('admin.settings.save', { settings: { storageLimitMb: 0 } }, adminSession));
  });

  await t('admin settings: validation, official logo path, maintenance blocks users but not owner', () => {
    err(call('admin.settings.save', { settings: { logoRef: 'https://evil.com/logo.png' } }, adminSession), 'INVALID'); err(call('admin.settings.save', { settings: { gateway: { relayApi: 'http://insecure' } } }, adminSession), 'INVALID');
    ok(call('admin.settings.save', { settings: { maintenance: true, maintenanceMessage: 'Back soon' } }, adminSession));
    err(call('schedule.list', {}, userSession), 'MAINTENANCE'); assert.ok(ok(call('auth.me', {}, userSession))); ok(call('admin.dashboard', {}, adminSession));
    assert.strictEqual(ok(call('config.public')).maintenance, true); ok(call('admin.settings.save', { settings: { maintenance: false } }, adminSession)); ok(call('schedule.list', {}, userSession));
  });
  await t('feature flags and registration controls', () => {
    ok(call('admin.settings.save', { settings: { registrationOpen: false } }, adminSession)); err(reg('late@example.com'), 'REGISTRATION_CLOSED'); ok(call('admin.settings.save', { settings: { registrationOpen: true } }, adminSession));
    ok(call('admin.settings.save', { settings: {}, features: { scheduler: false } }, adminSession)); assert.strictEqual(ok(call('config.public')).features.scheduler, false); ok(call('admin.settings.save', { settings: {}, features: { scheduler: true } }, adminSession));
  });

  await t('suspension revokes sessions immediately; restore re-enables sign-in', () => {
    ok(call('admin.users.suspend', { id: userId, reason: 'test' }, adminSession)); err(call('auth.me', {}, userSession), 'SESSION_INVALID');
    assert.strictEqual(ok(call('auth.login', { email: 'user1@example.com', pw: hex64('user1@example.compw') })).user.status, 'Suspended');
    ok(call('admin.users.restore', { id: userId }, adminSession)); userSession = ok(call('auth.login', { email: 'user1@example.com', pw: hex64('user1@example.compw') })).session.token;
  });
  await t('admin cannot suspend self / last admin cannot be demoted or deleted', () => {
    const me = ok(call('auth.me', {}, adminSession)); err(call('admin.users.suspend', { id: me.id }, adminSession), 'INVALID'); err(call('admin.users.setRole', { id: me.id, role: 'User' }, adminSession), 'LAST_ADMIN'); err(call('admin.users.delete', { id: me.id }, adminSession), 'INVALID');
    err(call('user.delete', { pw: 'DELETE' }, adminSession), 'LAST_ADMIN');
  });
  await t('role assignment: promote then demote; promoted admin gets admin rights from the sheet', () => {
    const r3 = ok(reg('helper@example.com')); ok(call('admin.users.approve', { id: r3.user.id }, adminSession)); const hs = ok(call('auth.login', { email: 'helper@example.com', pw: hex64('helper@example.compw') })).session.token;
    err(call('admin.dashboard', {}, hs), 'FORBIDDEN'); ok(call('admin.users.setRole', { id: r3.user.id, role: 'SuperAdmin' }, adminSession)); ok(call('admin.dashboard', {}, hs));
    ok(call('admin.users.setRole', { id: r3.user.id, role: 'User' }, adminSession)); err(call('admin.dashboard', {}, hs), 'SESSION_INVALID');
  });

  await t('password change: wrong current rejected; others signed out; new session works', () => {
    err(call('user.changePassword', { currentPw: hex64('bad'), nextPw: hex64('new') }, userSession), 'INVALID_CREDENTIALS');
    const r = ok(call('user.changePassword', { currentPw: hex64('user1@example.compw'), nextPw: hex64('newpw') }, userSession)); err(call('auth.me', {}, userSession), 'SESSION_INVALID'); userSession = r.session.token; ok(call('auth.me', {}, userSession));
    assert.ok(ok(call('auth.login', { email: 'user1@example.com', pw: hex64('newpw') })).session);
  });
  await t('logout invalidates the session server-side', () => { const s = ok(call('auth.login', { email: 'user1@example.com', pw: hex64('newpw') })).session.token; ok(call('auth.logout', {}, s)); err(call('auth.me', {}, s), 'SESSION_INVALID'); userSession = ok(call('auth.login', { email: 'user1@example.com', pw: hex64('newpw') })).session.token; });

  await t('gateway token: off by default, then a verifiable short-lived HS256 JWT', () => {
    err(call('stream.gatewayToken', {}, userSession), 'GATEWAY_OFF'); ok(call('admin.settings.save', { settings: { gateway: { enabled: true, whipBase: 'https://gw.example.com/whip', relayApi: 'https://gw.example.com/relay-api', authType: 'bearer' } } }, adminSession));
    const g = ok(call('stream.gatewayToken', {}, userSession)); const [h, b, s] = g.token.split('.'); const exp = crypto.createHmac('sha256', 'gw-secret-for-test').update(h + '.' + b).digest('base64url'); assert.strictEqual(s, exp);
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString()); assert.ok(claims.exp - claims.iat === 600); assert.ok(ok(call('config.public')).gateway.enabled);
  });
  await t('content: announcements/tutorials publish rules; https-only links', () => {
    ok(call('admin.announcements.save', { title: 'Welcome', body: 'Hello', published: true }, adminSession)); ok(call('admin.content.save', { type: 'FAQ', title: 'Q', body: 'A', published: true }, adminSession)); ok(call('admin.content.save', { type: 'Tutorial', title: 'Hidden', body: 'draft', published: false }, adminSession));
    err(call('admin.content.save', { type: 'FAQ', title: 'bad', body: 'x', url: 'javascript:alert(1)' }, adminSession), 'INVALID');
    const pub = ok(call('content.list')).items; assert.ok(pub.some(i => i.title === 'Q') && !pub.some(i => i.title === 'Hidden')); assert.ok(ok(call('config.public')).announcements.some(a => a.title === 'Welcome'));
  });
  await t('backup runs, is logged, and system health reports 14/14 sheets', () => {
    ok(call('admin.backup.run', {}, adminSession)); const h = ok(call('admin.system.health', {}, adminSession)); assert.strictEqual(h.sheetsPresent, 14); assert.ok(h.lastBackup);
    const logs = ok(call('admin.system.logs', { kind: 'BackupLogs' }, adminSession)); assert.ok(logs.items.length >= 1);
  });
  await t('audit log records required events and never contains secrets', () => {
    const a = ok(call('admin.audit.list', {}, adminSession)).items; const acts = a.map(x => x.action);
    ['ADMIN_LOGIN', 'APPROVE', 'SUSPEND', 'RESTORE', 'SETTINGS_CHANGED', 'PLATFORM_UPDATED', 'ADMIN_ACCESS_DENIED', 'OWNER_BOOTSTRAP', 'ROLE_SUPERADMIN'].forEach(x => assert.ok(acts.includes(x), 'audit missing ' + x));
    const dump = JSON.stringify(a); assert.ok(!dump.includes(env.props.get('SESSION_SECRET'))); assert.ok(!dump.includes(env.props.get('PW_PEPPER'))); assert.ok(!/eyJ[A-Za-z0-9_-]{8,}\./.test(dump), 'JWT in audit log');
  });
  await t('export contains the user data but no credential material; delete removes all records', () => {
    const e = ok(call('user.export', {}, userSession)); assert.ok(e.account.email === 'user1@example.com'); assert.ok(!JSON.stringify(e).match(/PasswordHash|PasswordSalt|SessionVersion/));
    err(call('user.delete', { pw: hex64('wrong') }, userSession), 'INVALID_CREDENTIALS'); ok(call('user.delete', { pw: hex64('newpw') }, userSession)); err(call('auth.me', {}, userSession), 'SESSION_INVALID');
    const ss = [...env.spreadsheets.values()][0]; const all = JSON.stringify([...ss.getSheetByName('Users').cells.values()]); assert.ok(!all.includes('user1@example.com'));
    assert.strictEqual(ok(call('admin.audit.list', { category: 'ACCOUNT_DELETE' }, adminSession)).items.length >= 1, true);
  });
  await t('error logs capture failures without leaking secrets', () => { const l = ok(call('admin.system.logs', { kind: 'Failed' }, adminSession)); assert.ok(l.items.length > 0); assert.ok(!JSON.stringify(l).includes('SECRETKEY')); });

  console.log(results.join('\n')); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
})();
