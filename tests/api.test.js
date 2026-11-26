// اختبارات القبول الآلية. تشغيل: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// يتطلب خادم MongoDB يعمل: MONGODB_URI=mongodb://127.0.0.1:27017 npm test
// تُنشأ قاعدة مؤقتة باسم عشوائي وتُحذف بعد الانتهاء (لا تمسّ بياناتك الحقيقية).
process.env.MONGODB_DB = `fajr_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
process.env.ADMIN_PASSWORD = 'Admin#12345';

const { createApp, seedAdmin } = require('../server/app');
const { C, connect, close, dropDatabase } = require('../server/db');

let server, base;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, extraHeaders = {}) {
    const headers = { 'X-Requested-With': 'fetch', ...extraHeaders };
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.getSetCookie?.() || [];
    for (const c of sc) { const kv = c.split(';')[0]; if (kv.startsWith('sid=')) this.cookie = kv.endsWith('=') ? '' : kv; }
    return res;
  }
  async json(method, url, body) {
    const res = await this.req(method, url, body);
    let data = null; try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data };
  }
  get(url) { return this.json('GET', url); }
  post(url, body = {}) { return this.json('POST', url, body); }
}

const admin = new Client();
let ids = []; // كل معرفات الدفعة
let batchId;

before(async () => {
  await connect();
  await seedAdmin();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await admin.post('/api/auth/staff-login', { username: 'admin', password: 'Admin#12345' });
  assert.equal(r.status, 200);
});
after(async () => { server.close(); await dropDatabase(); await close(); });

const pidOf = async (pub) => (await C.participants.findOne({ public_id: pub }))._id;

const activate = async (id, name = 'محمد أحمد علي الحربي', pw = 'secret123') => {
  const c = new Client();
  const r = await c.post('/api/auth/activate', { account_id: id, full_name: name, age: '٢٥', phone: '0551234567', password: pw, confirm_password: pw });
  return { c, r };
};

test('1) إنشاء 500 حساب دفعة واحدة بمعرفات فريدة وصحيحة', async () => {
  const r = await admin.post('/api/admin/participants/generate', { count: 500 });
  assert.equal(r.status, 200);
  assert.equal(r.data.created, 500);
  batchId = r.data.batch_id;
  const rows = await C.participants.find({ batch_id: batchId }).sort({ _id: 1 }).toArray();
  assert.equal(rows.length, 500);
  ids = rows.map((x) => x.public_id);
  assert.equal(new Set(ids).size, 500, 'المعرفات فريدة');
  for (const x of rows) {
    assert.match(x.public_id, /^FJ-[ACDEFGHJKLMNPQRTUVWXY346789]{5}$/, 'صيغة واضحة بلا أحرف متشابهة');
    assert.equal(x.status, 'pending');
  }
  const bad = await admin.post('/api/admin/participants/generate', { count: 0 });
  assert.equal(bad.status, 400);
});

test('2) QR يحتوي المعرف نفسه فقط، وتصدير بطاقات PDF', async () => {
  const svg = await (await admin.req('GET', `/api/admin/qr/${ids[0]}.svg`)).text();
  assert.ok(svg.includes('<svg'));
  const res = await admin.req('POST', '/api/admin/cards/pdf', { scope: 'batch', batch_id: batchId });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  fs.writeFileSync(path.join(os.tmpdir(), 'fajr-test-cards.pdf'), buf);
  // 500 بطاقة / 6 = 84 صفحة
  const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.equal(pages, 84);
  const none = await admin.post('/api/admin/cards/pdf', { scope: 'ids', ids: [] });
  assert.equal(none.status, 400);
});

test('3) تفعيل الحساب ثم الدخول اليدوي والملف الشخصي والسجل', async () => {
  const id = ids[0];
  const look = await new Client().post('/api/auth/lookup', { code: id.toLowerCase().replace('-', ' ') });
  assert.equal(look.data.state, 'pending');

  const weak = await new Client().post('/api/auth/activate', { account_id: id, full_name: 'اسم قصير', age: 25, phone: '0551234567', password: 'secret123', confirm_password: 'secret123' });
  assert.equal(weak.status, 400, 'يرفض اسمًا أقل من ثلاثة أجزاء');
  const mismatch = await new Client().post('/api/auth/activate', { account_id: id, full_name: 'محمد أحمد علي الحربي', age: 25, phone: '0551234567', password: 'secret123', confirm_password: 'other123' });
  assert.equal(mismatch.status, 400);

  const noPhone = await new Client().post('/api/auth/activate', { account_id: id, full_name: 'سالم سعد علي الغامدي', age: 30, phone: '', password: 'secret123', confirm_password: 'secret123' });
  assert.equal(noPhone.status, 400, 'يرفض التفعيل بدون رقم هاتف');

  const { c, r } = await activate(id);
  assert.equal(r.status, 200);
  const again = await new Client().post('/api/auth/activate', { account_id: id, full_name: 'محمد أحمد علي الحربي', age: 25, phone: '0551234567', password: 'x12345', confirm_password: 'x12345' });
  assert.equal(again.status, 409, 'لا يُفعَّل مرتين');

  const prof = await c.get('/api/me/profile');
  assert.equal(prof.data.public_id, id);
  assert.equal(prof.data.age, 25);
  assert.equal(prof.data.full_name, 'محمد أحمد علي الحربي');

  const login = new Client();
  const bad = await login.post('/api/auth/login', { account_id: id, password: 'wrong' });
  assert.equal(bad.status, 401);
  const ok = await login.post('/api/auth/login', { account_id: id, password: 'secret123' });
  assert.equal(ok.status, 200);

  const qr = await login.req('GET', '/api/me/qr.svg');
  assert.equal(qr.status, 200);
  const hist = await login.get('/api/me/history');
  assert.ok(hist.data.days.length >= 1);
  assert.equal(hist.data.days.at(-1).status, 'absent');

  const pass = (await C.participants.findOne({ public_id: id })).password_hash;
  assert.match(pass, /^scrypt\$/);
  assert.ok(!pass.includes('secret123'));
});

let assistant, assistant2, today;
test('4) المساعد: صلاحية المسح فقط، ولا وصول للإدارة', async () => {
  const mk = async (u, manual) => (await admin.post('/api/admin/staff', { username: u, display_name: `مساعد ${u}`, password: 'assist-pass-1', can_manual: manual })).status;
  assert.equal(await mk('helper1', false), 200);
  assert.equal(await mk('helper2', true), 200);
  assert.equal(await mk('helper1', false), 409);
  assistant = new Client(); assistant2 = new Client();
  assert.equal((await assistant.post('/api/auth/staff-login', { username: 'helper1', password: 'assist-pass-1' })).status, 200);
  assert.equal((await assistant2.post('/api/auth/staff-login', { username: 'helper2', password: 'assist-pass-1' })).status, 200);

  for (const url of ['/api/admin/dashboard', '/api/admin/participants', '/api/admin/leaderboards', '/api/admin/logs', '/api/admin/settings', '/api/admin/staff', '/api/admin/participants-export.csv']) {
    assert.equal((await assistant.get(url)).status, 403, url);
  }
  assert.equal((await assistant.post('/api/admin/participants/generate', { count: 5 })).status, 403);
  assert.equal((await assistant.post('/api/admin/cards/pdf', { scope: 'all' })).status, 403);
  assert.equal((await assistant.post('/api/admin/attendance/set', {})).status, 403);
  assert.equal((await assistant.get('/api/scan/live')).status, 200);

  const manualDenied = await assistant.post('/api/scan', { code: ids[0], method: 'manual' });
  assert.equal(manualDenied.status, 403);
  assert.equal((await new Client().post('/api/scan', { code: ids[0] })).status, 401);
  const asParticipant = (await activate(ids[1])).c;
  assert.equal((await asParticipant.post('/api/scan', { code: ids[0] })).status, 401);
  assert.equal((await asParticipant.get('/api/admin/dashboard')).status, 401);
});

test('5) لوحة صدارة + تسجيل حضور + منع تكرار الحضور والنقاط', async () => {
  const dash = await admin.get('/api/admin/dashboard');
  today = dash.data.today;
  const lb = await admin.post('/api/admin/leaderboards', { name: 'منافسة رمضان', start_date: today, end_date: today, attendance_points: 5, is_visible: true });
  assert.equal(lb.status, 200);

  const first = await assistant.post('/api/scan', { code: ids[0], method: 'qr' });
  assert.equal(first.data.status, 'ok');
  assert.equal(first.data.points, 5);
  const dup = await assistant2.post('/api/scan', { code: ids[0], method: 'manual' });
  assert.equal(dup.data.status, 'duplicate');
  const rows = await C.points_transactions.countDocuments({ participant_id: await pidOf(ids[0]) });
  assert.equal(rows, 1, 'نقاط مرة واحدة فقط');

  assert.equal((await assistant.post('/api/scan', { code: 'ZZ-ABCDE' })).data.status, 'invalid');
  assert.equal((await assistant.post('/api/scan', { code: '<script>' })).data.status, 'invalid');
  assert.equal((await assistant.post('/api/scan', { code: ids[300] })).data.status, 'pending');
});

test('6) تزامن: عدة ماسحات تمسح البطاقة نفسها في اللحظة ذاتها', async () => {
  await activate(ids[2]);
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? assistant : assistant2).post('/api/scan', { code: ids[2], method: 'qr' })));
  const oks = results.filter((r) => r.data.status === 'ok').length;
  const dups = results.filter((r) => r.data.status === 'duplicate').length;
  assert.equal(oks, 1);
  assert.equal(dups, 39);
  const att = await C.attendance.countDocuments({ participant_id: await pidOf(ids[2]) });
  assert.equal(att, 1);
  const ptsDocs = await C.points_transactions.find({ participant_id: await pidOf(ids[2]) }).toArray();
  assert.equal(ptsDocs.length, 1); assert.equal(ptsDocs[0].points, 5);

  // دفعة كبيرة بالتوازي لمشاركين مختلفين
  const batch = ids.slice(10, 70);
  for (const id of batch) await activate(id, 'خالد سعد عبدالله القحطاني');
  const many = await Promise.all(batch.flatMap((id) => [assistant.post('/api/scan', { code: id }), assistant2.post('/api/scan', { code: id })]));
  assert.equal(many.filter((r) => r.data.status === 'ok').length, batch.length);
  assert.equal(many.filter((r) => r.data.status === 'duplicate').length, batch.length);
});

test('7) الإحصاءات الحية وسجل الحضور الإداري', async () => {
  const live = await assistant.get('/api/scan/live');
  assert.equal(live.data.present, 62);
  assert.ok(live.data.mine > 0);
  const att = await admin.get(`/api/admin/attendance?date=${today}&limit=200`);
  assert.equal(att.data.present, 62);
  assert.ok(att.data.expected >= 62);
  assert.ok(att.data.rate > 0);
  const row = att.data.rows.find((r) => r.public_id === ids[0]);
  assert.equal(row.status, 'present');
  assert.ok(row.by_name);
});

test('8) ترتيب النقاط، وإخفاء اللوحة يبقي النقاط الشخصية فقط', async () => {
  const c = new Client();
  await c.post('/api/auth/login', { account_id: ids[0], password: 'secret123' });
  const p1 = await c.get('/api/me/profile');
  assert.equal(p1.data.points, 5);
  assert.equal(p1.data.rank, 1);
  const lb1 = await c.get('/api/me/leaderboard');
  assert.equal(lb1.data.visible, true);
  assert.ok(lb1.data.entries.length > 0);
  assert.ok(!JSON.stringify(lb1.data).includes('0551234567'), 'لا بيانات شخصية');
  assert.ok(!JSON.stringify(lb1.data).includes(ids[0]), 'لا معرفات في اللوحة');

  const list = await admin.get('/api/admin/leaderboards');
  const id = list.data.rows[0].id;
  assert.equal((await admin.json('PATCH', `/api/admin/leaderboards/${id}`, { is_visible: false })).status, 200);
  const lb2 = await c.get('/api/me/leaderboard');
  assert.equal(lb2.data.visible, false);
  assert.deepEqual(lb2.data.entries, []);
  const p2 = await c.get('/api/me/profile');
  assert.equal(p2.data.points, 5);
  assert.equal(p2.data.rank, 1);
  // الحضور ما زال يُسجَّل بعد الإخفاء
  assert.equal((await assistant.post('/api/scan', { code: ids[3] })).data.status, 'pending');
  await admin.json('PATCH', `/api/admin/leaderboards/${id}`, { is_visible: true });
});

test('9) تعديل الحضور يدويًا يتطلب سببًا، ويعكس النقاط، ويُسجَّل', async () => {
  const pid = await pidOf(ids[2]);
  assert.equal((await admin.post('/api/admin/attendance/set', { participant_id: pid, date: today, present: false, reason: '' })).status, 400);
  assert.equal((await admin.post('/api/admin/attendance/set', { participant_id: pid, date: today, present: false, reason: 'مسح خاطئ' })).status, 200);
  const sum = async () => (await C.points_transactions.aggregate([{ $match: { participant_id: pid } }, { $group: { _id: null, s: { $sum: '$points' } } }]).toArray())[0]?.s || 0;
  assert.equal(await sum(), 0);
  assert.equal((await assistant.post('/api/scan', { code: ids[2] })).data.status, 'cancelled');
  assert.equal((await admin.post('/api/admin/attendance/set', { participant_id: pid, date: today, present: false, reason: 'مرة أخرى' })).status, 409);
  assert.equal((await admin.post('/api/admin/attendance/set', { participant_id: pid, date: today, present: true, reason: 'تصحيح' })).status, 200);
  assert.equal(await sum(), 5, 'إعادة الحضور تمنح النقاط مرة واحدة');
  const logs = await admin.get('/api/admin/logs?action=attendance_edit');
  assert.equal(logs.data.total, 2);
  assert.ok(logs.data.rows[0].reason);
});

test('10) إيقاف الحساب واستبدال المعرف واستعادة كلمة المرور', async () => {
  const pid = await pidOf(ids[10]);
  assert.equal((await admin.post(`/api/admin/participants/${pid}/suspend`, { reason: 'اختبار' })).status, 200);
  assert.equal((await new Client().post('/api/auth/login', { account_id: ids[10], password: 'secret123' })).status, 403);
  assert.equal((await assistant.post('/api/scan', { code: ids[10] })).data.status, 'suspended');
  assert.equal((await admin.post(`/api/admin/participants/${pid}/unsuspend`)).status, 200);

  const rep = await admin.post(`/api/admin/participants/${pid}/replace-id`, { reason: 'ضياع البطاقة' });
  assert.equal(rep.status, 200);
  assert.notEqual(rep.data.new, ids[10]);
  assert.equal((await assistant.post('/api/scan', { code: ids[10] })).data.status, 'replaced');
  assert.equal((await assistant.post('/api/scan', { code: rep.data.new })).data.status, 'duplicate', 'الحضور يبقى لنفس الهوية الداخلية');
  assert.equal(await C.attendance.countDocuments({ participant_id: pid }), 1);

  const rs = await admin.post(`/api/admin/participants/${pid}/reset-password`);
  assert.equal(rs.status, 200);
  const c = new Client();
  const l = await c.post('/api/auth/login', { account_id: rep.data.new, password: rs.data.temporary_password });
  assert.equal(l.data.must_change_password, true);
  assert.equal((await c.get('/api/me/profile')).status, 403);
  assert.equal((await c.post('/api/auth/change-password', { current_password: rs.data.temporary_password, new_password: 'brand-new-pass' })).status, 200);
  assert.equal((await c.get('/api/me/profile')).status, 200);
});

test('11) تصدير CSV بدون كلمات مرور، وحماية من حقن الصيغ', async () => {
  const pid = await pidOf(ids[80]);
  await activate(ids[80], '=HYPERLINK("http://x") علي محمد');
  const raw = Buffer.from(await (await admin.req('GET', '/api/admin/participants-export.csv?include_phone=1')).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM لعرض العربية في Excel');
  const txt = raw.toString('utf8');

  assert.ok(txt.includes('رقم الهاتف'));
  assert.ok(!/scrypt|password|كلمة/.test(txt));
  assert.ok(txt.includes("'=HYPERLINK") || txt.includes('"\'=HYPERLINK'), 'تحييد الصيغ');
  const noPhone = await (await admin.req('GET', '/api/admin/participants-export.csv')).text();
  assert.ok(!noPhone.includes('0551234567'));
  assert.ok(pid);
});

test('12) حماية CSRF وتحديد معدل محاولات الدخول', async () => {
  const noHeader = await fetch(base + '/api/auth/logout', { method: 'POST' });
  assert.equal(noHeader.status, 403);
  const c = new Client();
  let last;
  for (let i = 0; i < 20; i++) last = await c.post('/api/auth/login', { account_id: ids[30], password: 'x' + i });
  assert.equal(last.status, 429);
  const s = new Client();
  for (let i = 0; i < 10; i++) last = await s.post('/api/auth/staff-login', { username: 'helper1', password: 'bad' + i });
  assert.equal(last.status, 429);
});

test('13) لوحة منتهية تثبّت نتائجها ولا تمنح نقاطًا بعد انتهائها', async () => {
  const past = await admin.post('/api/admin/leaderboards', { name: 'قديمة', start_date: '2020-01-01', end_date: '2020-01-31', attendance_points: 9, is_visible: true });
  assert.equal(past.status, 200);
  const list = await admin.get('/api/admin/leaderboards');
  const row = list.data.rows.find((r) => r.name === 'قديمة');
  assert.equal(row.status, 'ended');
  assert.equal(row.finalized, true);
  const st = await admin.get(`/api/admin/leaderboards/${row.id}/standings`);
  assert.equal(st.data.leaderboard.finalized, true);
  assert.equal((await admin.json('PATCH', `/api/admin/leaderboards/${row.id}`, { attendance_points: 1 })).status, 409);
  assert.equal(await C.points_transactions.countDocuments({ leaderboard_id: row.id }), 0);
});

test('14) المنع على مستوى قاعدة البيانات (قيود فريدة)', async () => {
  const p = await C.participants.findOne({}, { skip: 11 });
  const ins = () => C.attendance.insertOne({ participant_id: p._id, attendance_date: '2030-01-01', attended_at: new Date().toISOString(), status: 'present', revision: 1, method: 'qr' });
  await ins();
  await assert.rejects(ins, (e) => e.code === 11000);
  const att = await C.attendance.findOne({});
  const lb = await C.leaderboards.findOne({});
  const pt = () => C.points_transactions.insertOne({ participant_id: p._id, leaderboard_id: lb._id, points: 5, kind: 'attendance', reason: 'x', related_attendance_id: att._id, event_key: 'award:77', created_at: new Date().toISOString() });
  await pt();
  await assert.rejects(pt, (e) => e.code === 11000);
});

test('15) الشعار: يقبل PNG/JPG فقط', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(base + '/api/admin/logo', { method: 'PUT', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'image/png', Cookie: admin.cookie }, body: png });
  assert.equal(up.status, 200);
  const got = await fetch(base + '/api/public/logo');
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  const fake = await fetch(base + '/api/admin/logo', { method: 'PUT', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'image/png', Cookie: admin.cookie }, body: Buffer.from('<svg onload=alert(1)>') });
  assert.equal(fake.status, 400);
  const pdf = await admin.req('POST', '/api/admin/cards/pdf', { scope: 'ids', ids: [1, 2, 3] });
  assert.equal(pdf.status, 200, 'PDF مع شعار');
});

test('16) QR يحمل رابط الموقع + المعرف: التوجيه والمسح يلتقطان المعرف', async () => {
  const { normalizeCode } = require('../server/util');
  const id = ids[400];
  assert.equal(normalizeCode(id), id);
  assert.equal(normalizeCode(`https://example.com/c/${id}`), id);
  assert.equal(normalizeCode(`https://example.com/c/${id.toLowerCase()}`), id);
  assert.equal(normalizeCode(`https://example.com/#/c/${id}`), id);
  assert.equal(normalizeCode(`http://localhost:3000/c/${id}?x=1`), id);
  assert.equal(normalizeCode('https://example.com/c/hello-world'), null);

  const red = await new Client().req('GET', `/c/${id.toLowerCase()}`);
  assert.equal(red.status, 302);
  assert.equal(red.headers.get('location'), `/#/c/${id}`);

  const scan = await assistant.post('/api/scan', { code: `https://example.com/c/${id}`, method: 'qr' });
  assert.equal(scan.data.status, 'pending', 'الماسح يلتقط المعرف من الرابط');
  const look = await new Client().post('/api/auth/lookup', { code: `https://example.com/c/${id}` });
  assert.equal(look.data.state, 'pending');
  assert.equal(look.data.public_id, id);

  const svg = await (await admin.req('GET', `/api/admin/qr/${id}.svg`)).text();
  assert.ok(svg.includes('<svg'));
});