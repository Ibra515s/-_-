const { C, withId } = require('./db');
const { HttpError, sha256, newToken } = require('./util');
const { PARTICIPANT_SESSION_DAYS, STAFF_SESSION_DAYS } = require('./config');

// ---------- تحديد معدل المحاولات (في الذاكرة) ----------
class FailureLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  _prune(key) {
    const e = this.map.get(key);
    if (e && Date.now() - e.first > this.windowMs) this.map.delete(key);
    return this.map.get(key);
  }
  blockedFor(key) {
    const e = this._prune(key);
    if (!e || e.count < this.max) return 0;
    return Math.ceil((e.first + this.windowMs - Date.now()) / 1000);
  }
  fail(key) {
    const e = this._prune(key);
    if (e) e.count++; else this.map.set(key, { count: 1, first: Date.now() });
  }
  reset(key) { this.map.delete(key); }
  cleanup() { for (const k of [...this.map.keys()]) this._prune(k); }
}

const loginByAccount = new FailureLimiter(15, 15 * 60 * 1000);
const loginByIpAccount = new FailureLimiter(8, 15 * 60 * 1000);
const loginByIp = new FailureLimiter(120, 15 * 60 * 1000);
const lookupByIp = new FailureLimiter(400, 15 * 60 * 1000); // يُحتسب كل طلب
setInterval(() => [loginByAccount, loginByIpAccount, loginByIp, lookupByIp].forEach((l) => l.cleanup()), 5 * 60 * 1000).unref();

function checkLoginAllowed(ip, account) {
  const wait = Math.max(loginByAccount.blockedFor(account), loginByIpAccount.blockedFor(`${ip}|${account}`), loginByIp.blockedFor(ip));
  if (wait > 0) {
    throw new HttpError(429, 'too_many_attempts', `محاولات كثيرة. حاول بعد ${Math.ceil(wait / 60)} دقيقة.`);
  }
}
const registerLoginFailure = (ip, account) => { loginByAccount.fail(account); loginByIpAccount.fail(`${ip}|${account}`); loginByIp.fail(ip); };
const registerLoginSuccess = (ip, account) => { loginByAccount.reset(account); loginByIpAccount.reset(`${ip}|${account}`); };

function throttleLookup(ip) {
  if (lookupByIp.blockedFor(ip) > 0) throw new HttpError(429, 'too_many_requests', 'طلبات كثيرة. حاول بعد قليل.');
  lookupByIp.fail(ip);
}

// ---------- الجلسات ----------
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const ttlMs = (type) => (type === 'staff' ? STAFF_SESSION_DAYS : PARTICIPANT_SESSION_DAYS) * 86400000;

async function createSession(req, res, type, userId) {
  const token = newToken();
  const now = new Date();
  await C.sessions.insertOne({ _id: sha256(token), user_type: type, user_id: userId, created_at: now.toISOString(), last_seen: now, expires_at: new Date(now.getTime() + ttlMs(type)) });
  setCookie(req, res, token, ttlMs(type));
}

function setCookie(req, res, token, maxAgeMs) {
  const parts = [`sid=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

async function destroySession(req, res) {
  const raw = parseCookies(req.headers.cookie).sid;
  if (raw) await C.sessions.deleteOne({ _id: sha256(raw) });
  res.append('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${req.secure ? '; Secure' : ''}`);
}

const destroyUserSessions = (type, userId, exceptHash) =>
  C.sessions.deleteMany({ user_type: type, user_id: userId, ...(exceptHash ? { _id: { $ne: exceptHash } } : {}) });

async function loadSession(req, res) {
  req.auth = null;
  const raw = parseCookies(req.headers.cookie).sid;
  if (!raw) return;
  const hash = sha256(raw);
  const s = await C.sessions.findOne({ _id: hash, expires_at: { $gt: new Date() } });
  if (!s) return;
  const user = s.user_type === 'staff'
    ? await C.staff.findOne({ _id: s.user_id, is_active: true })
    : await C.participants.findOne({ _id: s.user_id, status: 'active' });
  if (!user) return;
  req.auth = { type: s.user_type, user: withId(user), hash };
  if (Date.now() - new Date(s.last_seen).getTime() > 6 * 3600 * 1000) {
    const now = new Date();
    await C.sessions.updateOne({ _id: hash }, { $set: { last_seen: now, expires_at: new Date(now.getTime() + ttlMs(s.user_type)) } });
    setCookie(req, res, raw, ttlMs(s.user_type));
  }
}

// ---------- حراس الصلاحيات (تُنفَّذ كلها على الخادم) ----------
const actorOf = (req) => ({
  type: req.auth.type,
  id: req.auth.user.id,
  name: req.auth.type === 'staff' ? req.auth.user.display_name : req.auth.user.public_id,
});

function requireParticipant(req, res, next) {
  if (req.auth?.type !== 'participant') throw new HttpError(401, 'unauthenticated', 'سجّل الدخول أولًا.');
  if (req.auth.user.must_change_password) throw new HttpError(403, 'must_change_password', 'يجب تغيير كلمة المرور أولًا.');
  next();
}

function requireStaff(req, res, next) {
  if (req.auth?.type !== 'staff') throw new HttpError(401, 'unauthenticated', 'سجّل الدخول أولًا.');
  if (req.auth.user.must_change_password) throw new HttpError(403, 'must_change_password', 'يجب تغيير كلمة المرور أولًا.');
  next();
}

function requireAdmin(req, res, next) {
  requireStaff(req, res, () => {
    if (req.auth.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'ليست لديك صلاحية لهذه العملية.');
    next();
  });
}

function requireScanner(req, res, next) {
  requireStaff(req, res, () => {
    const u = req.auth.user;
    if (u.role !== 'admin' && !u.can_scan) throw new HttpError(403, 'forbidden', 'ليست لديك صلاحية مسح الحضور.');
    next();
  });
}

module.exports = {
  checkLoginAllowed, registerLoginFailure, registerLoginSuccess, throttleLookup,
  createSession, destroySession, destroyUserSessions, loadSession,
  requireParticipant, requireStaff, requireAdmin, requireScanner, actorOf, parseCookies,
};
