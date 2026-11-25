const express = require('express');
const { C, getSettings, logAction } = require('../db');
const {
  HttpError, normalizeCode, hashPassword, verifyPassword, validateFullName, validateAge, validatePhone,
  validatePassword, cleanText, nowIso,
} = require('../util');
const A = require('../auth');

const router = express.Router();

function publicInfo() {
  const s = getSettings();
  return {
    appName: s.app_name, mosqueName: s.mosque_name, campaignName: s.campaign_name,
    hasLogo: !!s.logo_type, logoVersion: s.logo_version, timezone: s.timezone,
  };
}

router.get('/public/info', (req, res) => res.json(publicInfo()));

router.get('/auth/me', (req, res) => {
  const a = req.auth;
  if (!a) return res.json({ type: null });
  const u = a.user;
  if (a.type === 'staff') {
    return res.json({
      type: 'staff',
      user: { id: u.id, username: u.username, display_name: u.display_name, role: u.role, can_scan: !!u.can_scan, can_manual: !!u.can_manual || u.role === 'admin' },
      must_change_password: !!u.must_change_password,
    });
  }
  res.json({ type: 'participant', user: { public_id: u.public_id, full_name: u.full_name }, must_change_password: !!u.must_change_password });
});

// فحص حالة البطاقة بعد مسحها في صفحة الدخول
router.post('/auth/lookup', async (req, res) => {
  A.throttleLookup(req.ip);
  const code = normalizeCode(req.body?.code);
  if (!code) return res.json({ state: 'invalid', message: 'هذا الرمز ليس بطاقة مشارك صحيحة.' });
  const p = await C.participants.findOne({ public_id: code }, { projection: { public_id: 1, status: 1 } });
  if (!p) {
    const old = await C.retired_ids.findOne({ _id: code });
    return res.json(old
      ? { state: 'replaced', message: 'هذه البطاقة تم استبدالها ببطاقة جديدة.' }
      : { state: 'invalid', message: 'المعرف غير موجود.' });
  }
  res.json({ state: p.status, public_id: p.public_id });
});

router.post('/auth/activate', async (req, res) => {
  A.throttleLookup(req.ip);
  const b = req.body || {};
  const code = normalizeCode(b.account_id);
  if (!code) throw new HttpError(400, 'invalid_code', 'معرف الحساب غير صحيح.');
  const full_name = validateFullName(b.full_name);
  const age = validateAge(b.age);
  const phone = validatePhone(b.phone);
  const password = validatePassword(b.password);
  if (password !== b.confirm_password) throw new HttpError(400, 'password_mismatch', 'تأكيد كلمة المرور غير مطابق.');

  const p = await C.participants.findOne({ public_id: code });
  if (!p) throw new HttpError(404, 'not_found', 'المعرف غير موجود.');
  if (p.status === 'suspended') throw new HttpError(403, 'suspended', 'هذا الحساب موقوف. راجع المشرف.');
  if (p.status === 'active') throw new HttpError(409, 'already_active', 'هذا الحساب مفعّل مسبقًا. سجّل الدخول بكلمة المرور.');

  const password_hash = await hashPassword(password);
  // الشرط status:'pending' يجعل التفعيل ذريًا حتى لو أُرسل الطلب مرتين معًا
  const r = await C.participants.updateOne({ _id: p._id, status: 'pending' },
    { $set: { full_name, age, phone, password_hash, status: 'active', activated_at: nowIso(), must_change_password: false } });
  if (r.modifiedCount === 0) throw new HttpError(409, 'already_active', 'هذا الحساب مفعّل مسبقًا.');
  await logAction({ type: 'participant', id: p._id, name: p.public_id }, 'account_activated', `participant:${p.public_id}`);
  await A.createSession(req, res, 'participant', p._id);
  res.json({ ok: true });
});

router.post('/auth/login', async (req, res) => {
  const code = normalizeCode(req.body?.account_id);
  const password = String(req.body?.password ?? '');
  if (!code || !password) throw new HttpError(400, 'invalid_credentials', 'أدخل معرف الحساب وكلمة المرور.');
  A.checkLoginAllowed(req.ip, code);

  const p = await C.participants.findOne({ public_id: code });
  if (p && p.status === 'pending') {
    return res.status(200).json({ ok: false, state: 'pending', message: 'الحساب غير مفعّل. فعّله أولًا بإدخال بياناتك.' });
  }
  const ok = await verifyPassword(password, p?.password_hash);
  if (!p || !ok) {
    A.registerLoginFailure(req.ip, code);
    throw new HttpError(401, 'invalid_credentials', 'معرف الحساب أو كلمة المرور غير صحيحة.');
  }
  if (p.status === 'suspended') throw new HttpError(403, 'suspended', 'هذا الحساب موقوف. راجع المشرف.');
  A.registerLoginSuccess(req.ip, code);
  await A.createSession(req, res, 'participant', p._id);
  res.json({ ok: true, must_change_password: !!p.must_change_password });
});

router.post('/auth/staff-login', async (req, res) => {
  const username = cleanText(req.body?.username, 40).toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!username || !password) throw new HttpError(400, 'invalid_credentials', 'أدخل اسم المستخدم وكلمة المرور.');
  const key = `staff:${username}`;
  A.checkLoginAllowed(req.ip, key);

  const u = await C.staff.findOne({ username });
  const ok = await verifyPassword(password, u?.password_hash);
  if (!u || !ok) {
    A.registerLoginFailure(req.ip, key);
    throw new HttpError(401, 'invalid_credentials', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }
  if (!u.is_active) throw new HttpError(403, 'suspended', 'هذا الحساب موقوف.');
  A.registerLoginSuccess(req.ip, key);
  await A.createSession(req, res, 'staff', u._id);
  await logAction({ type: 'staff', id: u._id, name: u.display_name }, 'staff_login', `staff:${u.username}`);
  res.json({ ok: true, role: u.role, must_change_password: !!u.must_change_password });
});

router.post('/auth/logout', async (req, res) => {
  await A.destroySession(req, res);
  res.json({ ok: true });
});

router.post('/auth/change-password', async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'unauthenticated', 'سجّل الدخول أولًا.');
  const { current_password, new_password } = req.body || {};
  const isStaff = req.auth.type === 'staff';
  const pw = validatePassword(new_password, isStaff ? 8 : 6);
  const u = req.auth.user;
  if (!(await verifyPassword(String(current_password ?? ''), u.password_hash))) {
    throw new HttpError(400, 'wrong_password', 'كلمة المرور الحالية غير صحيحة.');
  }
  if (pw === current_password) throw new HttpError(400, 'same_password', 'اختر كلمة مرور مختلفة عن الحالية.');
  const hash = await hashPassword(pw);
  await (isStaff ? C.staff : C.participants).updateOne({ _id: u.id }, { $set: { password_hash: hash, must_change_password: false } });
  await A.destroyUserSessions(req.auth.type, u.id, req.auth.hash);
  await logAction(A.actorOf(req), 'password_changed', isStaff ? `staff:${u.username}` : `participant:${u.public_id}`);
  res.json({ ok: true });
});

module.exports = { router, publicInfo };
