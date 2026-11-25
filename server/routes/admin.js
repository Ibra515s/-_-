const express = require('express');
const { C, getSetting, getSettings, setSetting, today, logAction, reserveIds, nextId, withId, isDup, escapeRegex } = require('../db');
const U = require('../util');
const { HttpError } = U;
const A = require('../auth');
const LB = require('../services/leaderboard');
const { adminSetAttendance } = require('../services/attendance');
const { renderCardsPdf } = require('../services/cards');
const { qrSvg } = require('./me');

const router = express.Router();
router.use('/admin', A.requireAdmin);

const int = (v, d, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const num = (v) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

// =====================================================================
// لوحة التحكم
// =====================================================================
router.get('/admin/dashboard', async (req, res) => {
  await LB.finalizeDue();
  const day = today();
  const [byStatus, present, lb] = await Promise.all([
    C.participants.aggregate([{ $group: { _id: '$status', c: { $sum: 1 } } }]).toArray(),
    C.attendance.countDocuments({ attendance_date: day, status: 'present' }),
    LB.currentLeaderboard({ includeDisabled: true }),
  ]);
  const n = (s) => byStatus.find((r) => r._id === s)?.c || 0;
  const active = n('active');
  res.json({
    today: day, total: n('active') + n('pending') + n('suspended'), active, pending: n('pending'), suspended: n('suspended'),
    present_today: present, absent_today: Math.max(0, active - present), attendance_rate: pct(present, active),
    leaderboard: lb && { id: lb.id, name: lb.name, status: LB.lbStatus(lb), is_enabled: !!lb.is_enabled, is_visible: !!lb.is_visible, start_date: lb.start_date, end_date: lb.end_date },
  });
});

// =====================================================================
// المشاركون
// =====================================================================
const participantRow = (p, replaced = 0) => ({
  id: p._id, public_id: p.public_id, full_name: p.full_name ?? null, age: p.age ?? null, phone: p.phone ?? null, status: p.status,
  batch_id: p.batch_id, created_at: p.created_at, activated_at: p.activated_at ?? null, replaced_ids: replaced,
});

router.get('/admin/participants', async (req, res) => {
  const q = U.cleanText(req.query.q, 60);
  const status = ['pending', 'active', 'suspended'].includes(req.query.status) ? req.query.status : null;
  const batch = req.query.batch ? int(req.query.batch, null, 1, 1e9) : null;
  const limit = int(req.query.limit, 50, 1, 200);
  const page = int(req.query.page, 1, 1, 1e6);

  const filter = {};
  if (status) filter.status = status;
  if (batch) filter.batch_id = batch;
  if (q) {
    const code = escapeRegex(U.toLatinDigits(q).toUpperCase());
    const retired = await C.retired_ids.find({ _id: { $regex: code } }, { projection: { participant_id: 1 } }).limit(50).toArray();
    filter.$or = [
      { full_name: { $regex: escapeRegex(q), $options: 'i' } },
      { public_id: { $regex: code } },
      { phone: { $regex: escapeRegex(U.toLatinDigits(q)) } },
      ...(retired.length ? [{ _id: { $in: retired.map((r) => r.participant_id) } }] : []),
    ];
  }
  const [total, rows] = await Promise.all([
    C.participants.countDocuments(filter),
    C.participants.find(filter, { projection: { password_hash: 0 } }).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
  ]);
  const rep = await C.retired_ids.aggregate([{ $match: { participant_id: { $in: rows.map((r) => r._id) } } }, { $group: { _id: '$participant_id', c: { $sum: 1 } } }]).toArray();
  const rm = new Map(rep.map((r) => [r._id, r.c]));
  res.json({ total, page, limit, rows: rows.map((p) => participantRow(p, rm.get(p._id) || 0)) });
});

router.post('/admin/participants/generate', async (req, res) => {
  const count = Number.parseInt(req.body?.count, 10);
  if (!Number.isInteger(count) || count < 1 || count > 20000) {
    throw new HttpError(400, 'invalid_count', 'أدخل عددًا صحيحًا بين 1 و20000.');
  }
  const prefix = getSetting('id_prefix');
  const batchId = await nextId('batches');
  const now = U.nowIso();
  await C.batches.insertOne({ _id: batchId, count, created_at: now, created_by: req.auth.user.id });

  let created = 0, attempts = 0;
  const first = await reserveIds('participants', count);
  let nextPid = first;           // نحجز نطاقًا واحدًا؛ ولو فشل بعضها (تعارض معرف) نحجز بدائل
  const spare = [];
  while (created < count) {
    if (++attempts > 50) throw new HttpError(500, 'id_space_exhausted', 'تعذّر توليد معرفات فريدة كافية.');
    const need = count - created;
    const seen = new Set();
    const docs = [];
    while (docs.length < need) {
      const pub = `${prefix}-${U.genIdSuffix()}`;
      if (seen.has(pub)) continue;
      seen.add(pub);
      const _id = spare.length ? spare.pop() : nextPid++ < first + count ? nextPid - 1 : await reserveIds('participants', 1);
      docs.push({ _id, public_id: pub, full_name: null, age: null, phone: null, password_hash: null, status: 'pending', must_change_password: false, batch_id: batchId, created_at: now, activated_at: null });
    }
    // لا نسمح بمعرف سبق استبداله
    const clash = new Set((await C.retired_ids.find({ _id: { $in: docs.map((d) => d.public_id) } }, { projection: { _id: 1 } }).toArray()).map((r) => r._id));
    const ok = docs.filter((d) => !clash.has(d.public_id));
    clash.size && docs.filter((d) => clash.has(d.public_id)).forEach((d) => spare.push(d._id));
    let inserted = 0;
    try {
      const r = await C.participants.insertMany(ok, { ordered: false });
      inserted = r.insertedCount;
    } catch (e) {
      if (!e.writeErrors && !isDup(e)) throw e;
      inserted = e.result?.insertedCount ?? e.insertedCount ?? 0;
      const failed = new Set((e.writeErrors || []).map((w) => w.index));
      ok.forEach((d, i) => { if (failed.has(i)) spare.push(d._id); });
    }
    created += inserted;
  }
  await logAction(A.actorOf(req), 'accounts_generated', `batch:${batchId}`, { count });
  res.json({ ok: true, batch_id: batchId, created });
});

router.get('/admin/batches', async (req, res) => {
  const [batches, stats] = await Promise.all([
    C.batches.find().sort({ _id: -1 }).limit(200).toArray(),
    C.participants.aggregate([{ $group: { _id: { b: '$batch_id', s: '$status' }, c: { $sum: 1 } } }]).toArray(),
  ]);
  const staff = await C.staff.find({ _id: { $in: batches.map((b) => b.created_by) } }, { projection: { display_name: 1 } }).toArray();
  const sm = new Map(staff.map((s) => [s._id, s.display_name]));
  const cnt = (b, s) => stats.find((r) => r._id.b === b && r._id.s === s)?.c || 0;
  res.json({ rows: batches.map((b) => ({ id: b._id, count: b.count, created_at: b.created_at, created_by: sm.get(b.created_by) || null, active: cnt(b._id, 'active'), pending: cnt(b._id, 'pending') })) });
});

async function participantOr404(id) {
  const p = await C.participants.findOne({ _id: num(id) });
  if (!p) throw new HttpError(404, 'not_found', 'المشارك غير موجود.');
  return p;
}

router.get('/admin/participants/:id', async (req, res) => {
  const p = await participantOr404(req.params.id);
  const [retired, att, points, lb] = await Promise.all([
    C.retired_ids.find({ participant_id: p._id }).sort({ replaced_at: -1 }).toArray(),
    C.attendance.find({ participant_id: p._id }).sort({ attendance_date: -1 }).limit(60).toArray(),
    C.points_transactions.find({ participant_id: p._id }).sort({ _id: -1 }).limit(50).toArray(),
    LB.currentLeaderboard({ includeDisabled: true }),
  ]);
  const st = await LB.participantStanding(lb, p._id);
  const staff = await C.staff.find({ _id: { $in: att.map((a) => a.recorded_by) } }, { projection: { display_name: 1 } }).toArray();
  const sm = new Map(staff.map((s) => [s._id, s.display_name]));
  res.json({
    participant: participantRow(p, retired.length),
    retired_ids: retired.map((r) => ({ public_id: r._id, replaced_at: r.replaced_at })),
    attendance: att.map((a) => ({ attendance_date: a.attendance_date, attended_at: a.attended_at, status: a.status, method: a.method, by_name: sm.get(a.recorded_by) || null })),
    points_log: points.map((t) => ({ points: t.points, kind: t.kind, reason: t.reason, created_at: t.created_at, leaderboard_id: t.leaderboard_id })),
    standing: { ...st, leaderboard: lb?.name ?? null },
  });
});

router.patch('/admin/participants/:id', async (req, res) => {
  const p = await participantOr404(req.params.id);
  if (p.status === 'pending') throw new HttpError(400, 'not_activated', 'لا يمكن تعديل بيانات حساب لم يُفعَّل بعد.');
  const b = req.body || {};
  const full_name = b.full_name !== undefined ? U.validateFullName(b.full_name) : p.full_name;
  const age = b.age !== undefined ? U.validateAge(b.age) : p.age;
  const phone = b.phone !== undefined ? U.validatePhone(b.phone) : p.phone;
  await C.participants.updateOne({ _id: p._id }, { $set: { full_name, age, phone } });
  await logAction(A.actorOf(req), 'participant_edited', `participant:${p.public_id}`, { before: { full_name: p.full_name, age: p.age }, after: { full_name, age } });
  res.json({ ok: true });
});

async function setStatus(req, res, kind) {
  const p = await participantOr404(req.params.id);
  let next;
  if (kind === 'suspend') {
    if (p.status === 'suspended') throw new HttpError(400, 'no_change', 'الحساب موقوف مسبقًا.');
    next = 'suspended';
  } else {
    if (p.status !== 'suspended') throw new HttpError(400, 'no_change', 'الحساب غير موقوف.');
    next = p.activated_at ? 'active' : 'pending';
  }
  await C.participants.updateOne({ _id: p._id }, { $set: { status: next } });
  if (next === 'suspended') await A.destroyUserSessions('participant', p._id);
  await logAction(A.actorOf(req), kind === 'suspend' ? 'participant_suspended' : 'participant_reactivated', `participant:${p.public_id}`, null, U.cleanText(req.body?.reason, 200) || null);
  res.json({ ok: true, status: next });
}
router.post('/admin/participants/:id/suspend', (req, res) => setStatus(req, res, 'suspend'));
router.post('/admin/participants/:id/unsuspend', (req, res) => setStatus(req, res, 'unsuspend'));

// استبدال المعرف (بطاقة ضائعة مثلًا): الهوية الداخلية والحضور والنقاط تبقى كما هي
router.post('/admin/participants/:id/replace-id', async (req, res) => {
  const p = await participantOr404(req.params.id);
  const prefix = getSetting('id_prefix');
  let newId = null;
  for (let i = 0; i < 100 && !newId; i++) {
    const cand = `${prefix}-${U.genIdSuffix()}`;
    if (await C.participants.findOne({ public_id: cand }, { projection: { _id: 1 } })) continue;
    if (await C.retired_ids.findOne({ _id: cand })) continue;
    // نسجّل القديم أولًا (إن تعطل الخادم بعدها يبقى القديم صالحًا ولا يضيع شيء)
    try { await C.participants.updateOne({ _id: p._id, public_id: p.public_id }, { $set: { public_id: cand } }); newId = cand; }
    catch (e) { if (!isDup(e)) throw e; }
  }
  if (!newId) throw new HttpError(500, 'id_space_exhausted', 'تعذّر توليد معرف جديد.');
  await C.retired_ids.updateOne({ _id: p.public_id }, { $set: { participant_id: p._id, replaced_at: U.nowIso(), replaced_by: req.auth.user.id } }, { upsert: true });
  await logAction(A.actorOf(req), 'id_replaced', `participant:${newId}`, { old: p.public_id, new: newId }, U.cleanText(req.body?.reason, 200) || null);
  res.json({ ok: true, old: p.public_id, new: newId });
});

// استعادة كلمة المرور بآلية يديرها المشرف: كلمة مؤقتة تُعرض مرة واحدة ثم يُجبر المشارك على تغييرها
router.post('/admin/participants/:id/reset-password', async (req, res) => {
  const p = await participantOr404(req.params.id);
  if (p.status === 'pending') throw new HttpError(400, 'not_activated', 'الحساب لم يُفعَّل بعد.');
  const temp = U.genTempPassword();
  await C.participants.updateOne({ _id: p._id }, { $set: { password_hash: await U.hashPassword(temp), must_change_password: true } });
  await A.destroyUserSessions('participant', p._id);
  await logAction(A.actorOf(req), 'password_reset', `participant:${p.public_id}`);
  res.json({ ok: true, temporary_password: temp });
});

router.get('/admin/qr/:code.svg', async (req, res) => {
  const code = U.normalizeCode(req.params.code);
  if (!code) throw new HttpError(400, 'invalid_code', 'معرف غير صالح.');
  res.type('image/svg+xml').send(await qrSvg(code));
});

// ---------- تصدير البطاقات (PDF) ----------
router.post('/admin/cards/pdf', async (req, res) => {
  const b = req.body || {};
  let filter = {};
  if (b.scope === 'batch') filter = { batch_id: int(b.batch_id, 0, 0, 1e9) };
  else if (b.scope === 'ids') filter = { _id: { $in: (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 20000) } };
  else if (b.scope === 'pending') filter = { status: 'pending' };
  const rows = await C.participants.find(filter, { projection: { public_id: 1 } }).sort({ _id: 1 }).toArray();
  if (!rows.length) throw new HttpError(400, 'nothing_to_export', 'لا توجد بطاقات للتصدير.');
  await logAction(A.actorOf(req), 'cards_exported', b.scope || 'all', { count: rows.length, batch_id: b.batch_id ?? null });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="cards-${today()}.pdf"`, 'Cache-Control': 'no-store' });
  renderCardsPdf(rows.map((r) => r.public_id), res);
});

// ---------- تصدير الحسابات (CSV) ----------
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // منع حقن الصيغ في Excel
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const STATUS_AR = { pending: 'بانتظار التفعيل', active: 'نشط', suspended: 'موقوف' };

router.get('/admin/participants-export.csv', async (req, res) => {
  const includePhone = req.query.include_phone === '1';
  const batch = req.query.batch ? int(req.query.batch, 0, 0, 1e9) : null;
  const tz = getSetting('timezone');
  const rows = await C.participants.find(batch ? { batch_id: batch } : {}, { projection: { password_hash: 0 } }).sort({ _id: 1 }).toArray();
  const head = ['معرف الحساب', 'الاسم الرباعي', 'حالة الحساب', 'تاريخ الإنشاء', ...(includePhone ? ['رقم الهاتف'] : [])];
  const lines = [head.map(csvCell).join(',')];
  for (const p of rows) {
    lines.push([p.public_id, p.full_name || '', STATUS_AR[p.status], U.dateInTz(new Date(p.created_at), tz), ...(includePhone ? [p.phone || ''] : [])].map(csvCell).join(','));
  }
  await logAction(A.actorOf(req), 'accounts_exported', 'csv', { count: rows.length, include_phone: includePhone });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="participants-${today()}.csv"`, 'Cache-Control': 'no-store' });
  res.send('﻿' + lines.join('\r\n') + '\r\n'); // BOM ليفتح Excel العربية بشكل صحيح
});

// =====================================================================
// الحضور
// =====================================================================
router.get('/admin/attendance', async (req, res) => {
  const day = U.isValidDate(req.query.date) ? req.query.date : today();
  const q = U.cleanText(req.query.q, 60);
  const filter = ['present', 'absent'].includes(req.query.status) ? req.query.status : null;
  const limit = int(req.query.limit, 50, 1, 200);
  const page = int(req.query.page, 1, 1, 1e6);

  const pfilter = { status: 'active' };
  if (q) pfilter.$or = [{ full_name: { $regex: escapeRegex(q), $options: 'i' } }, { public_id: { $regex: escapeRegex(U.toLatinDigits(q).toUpperCase()) } }];
  const [expected, atts, people] = await Promise.all([
    C.participants.countDocuments({ status: 'active' }),
    C.attendance.find({ attendance_date: day }).toArray(),
    C.participants.find(pfilter, { projection: { public_id: 1, full_name: 1 } }).toArray(),
  ]);
  const present = atts.filter((a) => a.status === 'present').length;
  const am = new Map(atts.map((a) => [a.participant_id, a]));

  let rows = people.map((p) => ({ p, a: am.get(p._id) }));
  if (filter === 'present') rows = rows.filter((r) => r.a?.status === 'present');
  if (filter === 'absent') rows = rows.filter((r) => !r.a || r.a.status !== 'present');
  rows.sort((x, y) => (x.a && y.a ? y.a.attended_at.localeCompare(x.a.attended_at) : x.a ? -1 : y.a ? 1 : (x.p.full_name || '').localeCompare(y.p.full_name || '', 'ar')));
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  const staffIds = [...new Set([...pageRows.map((r) => r.a?.recorded_by), ...atts.slice(0, 0)].filter((x) => x != null))];
  const recentAtts = [...atts].sort((x, y) => y.attended_at.localeCompare(x.attended_at)).slice(0, 12);
  const allStaffIds = [...new Set([...staffIds, ...recentAtts.map((a) => a.recorded_by).filter((x) => x != null)])];
  const [staff, recentPeople] = await Promise.all([
    C.staff.find({ _id: { $in: allStaffIds } }, { projection: { display_name: 1 } }).toArray(),
    C.participants.find({ _id: { $in: recentAtts.map((a) => a.participant_id) } }, { projection: { public_id: 1, full_name: 1 } }).toArray(),
  ]);
  const sm = new Map(staff.map((s) => [s._id, s.display_name]));
  const rp = new Map(recentPeople.map((p) => [p._id, p]));

  res.json({
    date: day, weekday: U.weekdayAr(day), is_today: day === today(),
    expected, present, absent: Math.max(0, expected - present), rate: pct(present, expected), total, page, limit,
    rows: pageRows.map(({ p, a }) => ({
      participant_id: p._id, public_id: p.public_id, full_name: p.full_name,
      status: a?.status === 'present' ? 'present' : a?.status === 'cancelled' ? 'cancelled' : 'absent',
      attended_at: a?.attended_at ?? null, method: a?.method ?? null, by_name: a ? sm.get(a.recorded_by) || null : null,
    })),
    recent: recentAtts.map((a) => ({ public_id: rp.get(a.participant_id)?.public_id, full_name: rp.get(a.participant_id)?.full_name, attended_at: a.attended_at, method: a.method, by_name: sm.get(a.recorded_by) || null, status: a.status })),
  });
});

router.post('/admin/attendance/set', async (req, res) => {
  const { participant_id, date, present } = req.body || {};
  const reason = U.cleanText(req.body?.reason, 200);
  if (!U.isValidDate(date) || date > today()) throw new HttpError(400, 'invalid_date', 'التاريخ غير صحيح.');
  if (reason.length < 3) throw new HttpError(400, 'reason_required', 'اذكر سبب التعديل.');
  const r = await adminSetAttendance({ participantId: num(participant_id), date, present: !!present, reason, actor: A.actorOf(req) });
  if (r.error === 'not_found') throw new HttpError(404, 'not_found', 'المشارك غير موجود.');
  if (r.error === 'no_change') throw new HttpError(409, 'no_change', 'لا تغيير: الحالة المطلوبة هي نفسها الحالية.');
  res.json(r);
});

// =====================================================================
// لوحات الصدارة
// =====================================================================
const lbRow = (l) => ({
  id: l._id, name: l.name, start_date: l.start_date, end_date: l.end_date, attendance_points: l.attendance_points,
  is_visible: !!l.is_visible, is_enabled: !!l.is_enabled, status: LB.lbStatus(l), finalized: !!l.finalized_at,
});

function readLbBody(b, existing) {
  const name = U.cleanText(b.name ?? existing?.name, 80);
  const start = b.start_date ?? existing?.start_date;
  const end = b.end_date ?? existing?.end_date;
  const points = b.attendance_points !== undefined ? Number.parseInt(b.attendance_points, 10) : existing?.attendance_points;
  if (!name) throw new HttpError(400, 'invalid_name', 'اسم لوحة الصدارة مطلوب.');
  if (!U.isValidDate(start) || !U.isValidDate(end)) throw new HttpError(400, 'invalid_date', 'التواريخ غير صحيحة.');
  if (end < start) throw new HttpError(400, 'invalid_range', 'تاريخ النهاية يجب ألا يسبق البداية.');
  if (!Number.isInteger(points) || points < 0 || points > 1000) throw new HttpError(400, 'invalid_points', 'نقاط الحضور يجب أن تكون عددًا صحيحًا بين 0 و1000.');
  return { name, start, end, points };
}

async function lbOr404(id) {
  const lb = await C.leaderboards.findOne({ _id: num(id) });
  if (!lb) throw new HttpError(404, 'not_found', 'اللوحة غير موجودة.');
  return withId(lb);
}

router.get('/admin/leaderboards', async (req, res) => {
  await LB.finalizeDue();
  const rows = await C.leaderboards.find().sort({ start_date: -1, _id: -1 }).toArray();
  res.json({ rows: rows.map(lbRow) });
});

router.post('/admin/leaderboards', async (req, res) => {
  const v = readLbBody(req.body || {});
  const id = await nextId('leaderboards');
  await C.leaderboards.insertOne({ _id: id, name: v.name, start_date: v.start, end_date: v.end, attendance_points: v.points,
    is_visible: !!req.body?.is_visible, is_enabled: req.body?.is_enabled !== false, finalized_at: null, created_at: U.nowIso() });
  await logAction(A.actorOf(req), 'leaderboard_created', `leaderboard:${id}`, v);
  res.json({ ok: true, id });
});

router.patch('/admin/leaderboards/:id', async (req, res) => {
  const lb = await lbOr404(req.params.id);
  const b = req.body || {};
  const v = readLbBody(b, lb);
  if (lb.finalized_at && (v.start !== lb.start_date || v.end !== lb.end_date || v.points !== lb.attendance_points)) {
    throw new HttpError(409, 'finalized', 'اللوحة منتهية وتم تثبيت نتائجها؛ لا يمكن تعديل مدتها أو نقاطها.');
  }
  const is_visible = b.is_visible !== undefined ? !!b.is_visible : lb.is_visible;
  const is_enabled = b.is_enabled !== undefined ? !!b.is_enabled : lb.is_enabled;
  await C.leaderboards.updateOne({ _id: lb.id }, { $set: { name: v.name, start_date: v.start, end_date: v.end, attendance_points: v.points, is_visible, is_enabled } });
  await logAction(A.actorOf(req), 'leaderboard_updated', `leaderboard:${lb.id}`, {
    before: { name: lb.name, start: lb.start_date, end: lb.end_date, points: lb.attendance_points, visible: lb.is_visible, enabled: lb.is_enabled },
    after: { name: v.name, start: v.start, end: v.end, points: v.points, visible: is_visible, enabled: is_enabled },
  });
  res.json({ ok: true });
});

router.get('/admin/leaderboards/:id/standings', async (req, res) => {
  await LB.finalizeDue();
  const lb = await lbOr404(req.params.id);
  const limit = int(req.query.limit, 100, 1, 1000);
  const rows = await LB.standings(lb.finalized_at ? lb : { ...lb });
  const ids = await C.participants.find({ _id: { $in: rows.slice(0, limit).map((r) => r.participant_id) } }, { projection: { public_id: 1 } }).toArray();
  const im = new Map(ids.map((r) => [r._id, r.public_id]));
  res.json({ leaderboard: lbRow({ ...lb, _id: lb.id }), total: rows.length,
    rows: rows.slice(0, limit).map((r) => ({ participant_id: r.participant_id, public_id: im.get(r.participant_id), full_name: r.full_name, points: r.points, rank: r.rank })) });
});

// تعديل يدوي للنقاط (مع سبب إلزامي وسجل مراجعة)
router.post('/admin/leaderboards/:id/adjust', async (req, res) => {
  const lb = await lbOr404(req.params.id);
  if (lb.finalized_at) throw new HttpError(409, 'finalized', 'اللوحة منتهية وتم تثبيت نتائجها.');
  const points = Number.parseInt(req.body?.points, 10);
  const reason = U.cleanText(req.body?.reason, 200);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 10000) throw new HttpError(400, 'invalid_points', 'أدخل عدد نقاط صحيحًا (موجبًا أو سالبًا).');
  if (reason.length < 3) throw new HttpError(400, 'reason_required', 'اذكر سبب التعديل.');
  const p = await C.participants.findOne({ _id: num(req.body?.participant_id), status: 'active' });
  if (!p) throw new HttpError(404, 'not_found', 'المشارك غير موجود أو غير نشط.');
  await C.points_transactions.insertOne({ participant_id: p._id, leaderboard_id: lb.id, points, kind: 'adjustment', reason: `تعديل يدوي: ${reason}`, created_by: req.auth.user.id, created_at: U.nowIso() });
  await logAction(A.actorOf(req), 'points_adjusted', `participant:${p.public_id}`, { leaderboard: lb.name, points }, reason);
  res.json({ ok: true });
});

// =====================================================================
// المساعدون
// =====================================================================
const staffRow = (s) => ({ id: s._id, username: s.username, display_name: s.display_name, is_active: !!s.is_active,
  can_scan: !!s.can_scan, can_manual: !!s.can_manual, must_change_password: !!s.must_change_password, created_at: s.created_at });

router.get('/admin/staff', async (req, res) => {
  const day = today();
  const [rows, counts] = await Promise.all([
    C.staff.find({ role: 'assistant' }).sort({ _id: -1 }).toArray(),
    C.attendance.aggregate([{ $match: { attendance_date: day, status: 'present' } }, { $group: { _id: '$recorded_by', c: { $sum: 1 } } }]).toArray(),
  ]);
  const cm = new Map(counts.map((r) => [r._id, r.c]));
  res.json({ rows: rows.map((s) => ({ ...staffRow(s), today_count: cm.get(s._id) || 0 })) });
});

router.post('/admin/staff', async (req, res) => {
  const b = req.body || {};
  const username = U.cleanText(b.username, 30).toLowerCase();
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) throw new HttpError(400, 'invalid_username', 'اسم المستخدم: 3-30 حرفًا إنجليزيًا أو أرقامًا أو (_ . -).');
  const display_name = U.cleanText(b.display_name, 60);
  if (!display_name) throw new HttpError(400, 'invalid_name', 'اسم المساعد مطلوب.');
  const password = U.validatePassword(b.password, 8);
  const hash = await U.hashPassword(password);
  const id = await nextId('staff');
  try {
    await C.staff.insertOne({ _id: id, username, display_name, password_hash: hash, role: 'assistant', is_active: true,
      can_scan: b.can_scan !== false, can_manual: !!b.can_manual, must_change_password: false, created_at: U.nowIso() });
  } catch (e) {
    if (isDup(e)) throw new HttpError(409, 'duplicate', 'اسم المستخدم مستخدم مسبقًا.');
    throw e;
  }
  await logAction(A.actorOf(req), 'assistant_created', `staff:${username}`, { can_manual: !!b.can_manual });
  res.json({ ok: true, id });
});

async function assistantOr404(id) {
  const s = await C.staff.findOne({ _id: num(id), role: 'assistant' });
  if (!s) throw new HttpError(404, 'not_found', 'المساعد غير موجود.');
  return s;
}

router.patch('/admin/staff/:id', async (req, res) => {
  const s = await assistantOr404(req.params.id);
  const b = req.body || {};
  const next = {
    display_name: b.display_name !== undefined ? U.cleanText(b.display_name, 60) || s.display_name : s.display_name,
    is_active: b.is_active !== undefined ? !!b.is_active : s.is_active,
    can_scan: b.can_scan !== undefined ? !!b.can_scan : s.can_scan,
    can_manual: b.can_manual !== undefined ? !!b.can_manual : s.can_manual,
  };
  await C.staff.updateOne({ _id: s._id }, { $set: next });
  if (!next.is_active) await A.destroyUserSessions('staff', s._id);
  await logAction(A.actorOf(req), 'assistant_updated', `staff:${s.username}`, next);
  res.json({ ok: true });
});

router.post('/admin/staff/:id/password', async (req, res) => {
  const s = await assistantOr404(req.params.id);
  const pw = U.validatePassword(req.body?.password, 8);
  await C.staff.updateOne({ _id: s._id }, { $set: { password_hash: await U.hashPassword(pw), must_change_password: false } });
  await A.destroyUserSessions('staff', s._id);
  await logAction(A.actorOf(req), 'assistant_password_reset', `staff:${s.username}`);
  res.json({ ok: true });
});

router.get('/admin/staff/:id/activity', async (req, res) => {
  const s = await assistantOr404(req.params.id);
  const [atts, total] = await Promise.all([
    C.attendance.find({ recorded_by: s._id }).sort({ attended_at: -1 }).limit(200).toArray(),
    C.attendance.countDocuments({ recorded_by: s._id, status: 'present' }),
  ]);
  const people = await C.participants.find({ _id: { $in: atts.map((a) => a.participant_id) } }, { projection: { public_id: 1, full_name: 1 } }).toArray();
  const pm = new Map(people.map((p) => [p._id, p]));
  res.json({ staff: staffRow(s), total, rows: atts.map((a) => ({ public_id: pm.get(a.participant_id)?.public_id, full_name: pm.get(a.participant_id)?.full_name, attendance_date: a.attendance_date, attended_at: a.attended_at, method: a.method, status: a.status })) });
});

// =====================================================================
// الإعدادات والشعار
// =====================================================================
router.get('/admin/settings', (req, res) => {
  const s = getSettings();
  res.json({ app_name: s.app_name, mosque_name: s.mosque_name, campaign_name: s.campaign_name, campaign_start: s.campaign_start,
    timezone: s.timezone, id_prefix: s.id_prefix, leaderboard_names: s.leaderboard_names, hasLogo: !!s.logo_type, logoVersion: s.logo_version });
});

router.put('/admin/settings', async (req, res) => {
  const b = req.body || {};
  const upd = {};
  if (b.app_name !== undefined) upd.app_name = U.cleanText(b.app_name, 60) || 'حملة صلاة الفجر';
  if (b.mosque_name !== undefined) upd.mosque_name = U.cleanText(b.mosque_name, 60) || 'اسم المسجد';
  if (b.campaign_name !== undefined) upd.campaign_name = U.cleanText(b.campaign_name, 60) || 'حملة صلاة الفجر';
  if (b.campaign_start !== undefined) {
    if (!U.isValidDate(b.campaign_start)) throw new HttpError(400, 'invalid_date', 'تاريخ بداية الحملة غير صحيح.');
    upd.campaign_start = b.campaign_start;
  }
  if (b.timezone !== undefined) {
    if (!U.isValidTimezone(b.timezone)) throw new HttpError(400, 'invalid_timezone', 'المنطقة الزمنية غير صحيحة.');
    upd.timezone = b.timezone;
  }
  if (b.id_prefix !== undefined) {
    const p = String(b.id_prefix).toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(p)) throw new HttpError(400, 'invalid_prefix', 'بادئة المعرف: 2-4 أحرف إنجليزية.');
    upd.id_prefix = p;
  }
  if (b.leaderboard_names !== undefined) {
    if (!['short', 'full'].includes(b.leaderboard_names)) throw new HttpError(400, 'invalid_value', 'قيمة غير صحيحة.');
    upd.leaderboard_names = b.leaderboard_names;
  }
  for (const [k, v] of Object.entries(upd)) await setSetting(k, v);
  await logAction(A.actorOf(req), 'settings_changed', 'settings', upd);
  res.json({ ok: true });
});

const sniffImage = (buf) => {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
};

// الشعار يُحفظ داخل قاعدة البيانات (لا ملفات على القرص)
router.put('/admin/logo', express.raw({ type: ['image/png', 'image/jpeg'], limit: '1mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'invalid_image', 'ارفع صورة PNG أو JPG بحجم أقل من 1 ميغابايت.');
  const type = sniffImage(req.body);
  if (!type) throw new HttpError(400, 'invalid_image', 'الملف ليس صورة PNG أو JPG صحيحة.');
  await setSetting('logo_b64', req.body.toString('base64'));
  await setSetting('logo_type', type);
  await setSetting('logo_version', Date.now());
  await logAction(A.actorOf(req), 'logo_changed', 'settings');
  res.json({ ok: true });
});

router.delete('/admin/logo', async (req, res) => {
  await setSetting('logo_type', '');
  await setSetting('logo_b64', '');
  await setSetting('logo_version', Date.now());
  await logAction(A.actorOf(req), 'logo_removed', 'settings');
  res.json({ ok: true });
});

// =====================================================================
// سجل العمليات
// =====================================================================
router.get('/admin/logs', async (req, res) => {
  const limit = int(req.query.limit, 50, 1, 200);
  const page = int(req.query.page, 1, 1, 1e6);
  const filter = req.query.action ? { action: String(req.query.action).slice(0, 50) } : {};
  const [total, rows, actions] = await Promise.all([
    C.activity_logs.countDocuments(filter),
    C.activity_logs.find(filter).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    C.activity_logs.distinct('action'),
  ]);
  res.json({ total, page, limit, actions: actions.sort(), rows: rows.map((r) => ({ ...r, id: String(r._id), _id: undefined })) });
});

module.exports = { router };
