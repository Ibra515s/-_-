const crypto = require('crypto');

// أحرف واضحة: بدون O/0 وI/1 وما يشبهها (S/5 وB/8 وZ/2)
const ID_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY346789';
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY346789';

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const toLatinDigits = (s) =>
  String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

function randomFrom(alphabet, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

const genIdSuffix = () => randomFrom(ID_ALPHABET, 5);
const genTempPassword = () => randomFrom(TEMP_ALPHABET, 8);

function strictCode(input) {
  const s = toLatinDigits(input)
    .toUpperCase()
    .replace(/[\s‎‏‪-‮]/g, '')
    .replace(/[‐-―_]/g, '-');
  const m = /^([A-Z]{2,4})-?([A-Z0-9]{5})$/.exec(s);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * يحوّل أي إدخال (يدوي، أو محتوى QR) إلى صيغة FJ-7K4P9 أو null إن كان غير صالح.
 * يقبل المعرف وحده، أو رابط البطاقة الكامل (https://site/c/FJ-7K4P9) فيستخرج المعرف منه.
 */
function normalizeCode(input) {
  if (typeof input !== 'string' || input.length > 300) return null;
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    let u;
    try { u = new URL(trimmed); } catch { return null; }
    const last = (p) => decodeURIComponent(p).split(/[\/?]/).filter(Boolean).pop() || '';
    const cands = [last(u.pathname), last(u.hash.replace(/^#/, '')), u.searchParams.get('id'), u.searchParams.get('code')];
    for (const c of cands) { const r = c && strictCode(c); if (r) return r; }
    return null;
  }
  if (trimmed.length > 40) return null;
  return strictCode(trimmed);
}

/** عنوان الموقع العام (لرابط البطاقة داخل QR). يمكن تثبيته بـ PUBLIC_URL */
function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}
const cardUrl = (base, code) => `${base}/c/${code}`;

// ---------- كلمات المرور (scrypt) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scryptAsync(password, salt, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

const DUMMY_HASH_PROMISE = hashPassword('dummy-password-for-timing');

async function verifyPassword(password, stored) {
  try {
    if (!stored) {
      await verifyPassword(password, await DUMMY_HASH_PROMISE);
      return false;
    }
    const [scheme, N, r, p, saltB64, keyB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scryptAsync(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), {
      N: Number(N), r: Number(r), p: Number(p), keylen: expected.length,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// ---------- التواريخ ----------
const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function dateInTz(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayAr = (dateStr) => WEEKDAYS_AR[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
const fmtDMY = (dateStr) => dateStr.split('-').reverse().join('/');

function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

// ---------- التحقق من المدخلات ----------
const cleanText = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function validateFullName(raw) {
  const name = cleanText(raw, 120);
  const parts = name.split(' ').filter(Boolean);
  if (parts.length < 3 || parts.some((p) => p.length < 2)) {
    throw new HttpError(400, 'invalid_name', 'أدخل الاسم الرباعي كاملًا (ثلاثة أسماء على الأقل).');
  }
  return name;
}

function validateAge(raw) {
  const n = Number(toLatinDigits(raw));
  if (!Number.isInteger(n) || n < 4 || n > 110) throw new HttpError(400, 'invalid_age', 'العمر يجب أن يكون عددًا صحيحًا بالسنوات.');
  return n;
}

function validatePhone(raw) {
  const p = toLatinDigits(raw).replace(/[\s\-().]/g, '');
  if (!/^\+?\d{8,15}$/.test(p)) throw new HttpError(400, 'invalid_phone', 'رقم الهاتف غير صحيح.');
  return p;
}

function validatePassword(raw, min = 6) {
  const pw = String(raw ?? '');
  if (pw.length < min) throw new HttpError(400, 'weak_password', `كلمة المرور يجب ألا تقل عن ${min} أحرف.`);
  if (pw.length > 128) throw new HttpError(400, 'weak_password', 'كلمة المرور طويلة جدًا.');
  return pw;
}

const nowIso = () => new Date().toISOString();

/** اسم للعرض في لوحة الصدارة: الأول + الأخير (أو كاملًا حسب الإعداد) */
function displayName(fullName, mode) {
  if (!fullName) return '—';
  if (mode === 'full') return fullName;
  const parts = fullName.split(' ').filter(Boolean);
  return parts.length <= 2 ? fullName : `${parts[0]} ${parts[parts.length - 1]}`;
}

module.exports = {
  HttpError, genIdSuffix, genTempPassword, normalizeCode, publicBase, cardUrl, toLatinDigits,
  hashPassword, verifyPassword, sha256, newToken,
  WEEKDAYS_AR, dateInTz, isValidDate, addDays, weekdayAr, fmtDMY, isValidTimezone,
  cleanText, validateFullName, validateAge, validatePhone, validatePassword, nowIso, displayName,
};
