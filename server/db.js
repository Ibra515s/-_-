const { MongoClient } = require('mongodb');
const { MONGODB_URI, MONGODB_DB, DEFAULT_TZ } = require('./config');
const { dateInTz, nowIso } = require('./util');

/**
 * تصميم الحفظ (MongoDB):
 *  - لا نعتمد على المعاملات (تعمل أيضًا على خادم مفرد): كل ما يجب ألا يتكرر محمي بفهرس فريد،
 *    وكل عملية متعددة الخطوات قابلة للإعادة بأمان (idempotent).
 *  - المعرفات الرقمية (مشارك/مساعد/دفعة/لوحة) من عدّاد؛ والبقية ObjectId.
 *  - الشعار يُخزَّن داخل القاعدة (لا ملفات على القرص) لتعمل الاستضافات ذات القرص المؤقت.
 */
const C = {}; // مجموعات البيانات بعد الاتصال
let client = null;
let cache = {};

const DEFAULT_SETTINGS = {
  app_name: 'حملة صلاة الفجر',
  mosque_name: 'اسم المسجد',
  campaign_name: 'حملة صلاة الفجر',
  campaign_start: dateInTz(new Date(), DEFAULT_TZ),
  timezone: DEFAULT_TZ,
  id_prefix: 'FJ',
  leaderboard_names: 'short', // short = الأول + الأخير | full = كاملًا
  logo_type: '',
  logo_b64: '',
  logo_version: '0',
};

async function connect(uri = MONGODB_URI, dbName = MONGODB_DB) {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, maxPoolSize: 20 });
  await client.connect();
  const db = client.db(dbName);
  C.db = db;
  for (const n of ['settings', 'counters', 'staff', 'batches', 'participants', 'retired_ids', 'attendance', 'leaderboards',
    'points_transactions', 'leaderboard_results', 'sessions', 'activity_logs']) C[n] = db.collection(n);

  await Promise.all([
    C.staff.createIndex({ username: 1 }, { unique: true }),
    C.participants.createIndex({ public_id: 1 }, { unique: true }),
    C.participants.createIndex({ status: 1 }),
    C.participants.createIndex({ batch_id: 1 }),
    C.retired_ids.createIndex({ participant_id: 1 }),
    // يمنع أكثر من حضور للمشارك في اليوم نفسه
    C.attendance.createIndex({ participant_id: 1, attendance_date: 1 }, { unique: true }),
    C.attendance.createIndex({ attendance_date: 1, status: 1 }),
    C.attendance.createIndex({ recorded_by: 1, attendance_date: 1 }),
    // يمنع تكرار منح النقاط للحضور نفسه
    C.points_transactions.createIndex({ related_attendance_id: 1, leaderboard_id: 1, event_key: 1 },
      { unique: true, partialFilterExpression: { related_attendance_id: { $type: 'objectId' } } }),
    C.points_transactions.createIndex({ leaderboard_id: 1, participant_id: 1 }),
    C.points_transactions.createIndex({ participant_id: 1 }),
    C.leaderboard_results.createIndex({ leaderboard_id: 1, participant_id: 1 }, { unique: true }),
    C.sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    C.sessions.createIndex({ user_type: 1, user_id: 1 }),
    C.activity_logs.createIndex({ created_at: -1 }),
    C.activity_logs.createIndex({ action: 1 }),
  ]);

  await C.settings.bulkWrite(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => ({
    updateOne: { filter: { _id: k }, update: { $setOnInsert: { value: v } }, upsert: true },
  })));
  await loadSettings();
}

async function loadSettings() {
  cache = { ...DEFAULT_SETTINGS };
  for (const r of await C.settings.find().toArray()) cache[r._id] = r.value;
  logoBuf = undefined;
}

async function close() { await client?.close(); client = null; }
async function dropDatabase() { await client.db(MONGODB_DB).dropDatabase(); } // للاختبارات فقط

// ---------- الإعدادات (نسخة في الذاكرة، تُكتب إلى القاعدة فورًا) ----------
let logoBuf;
const getSetting = (k) => cache[k] ?? DEFAULT_SETTINGS[k];
const getSettings = () => ({ ...cache });
async function setSetting(k, v) {
  v = String(v);
  await C.settings.updateOne({ _id: k }, { $set: { value: v } }, { upsert: true });
  cache[k] = v;
  if (k === 'logo_b64') logoBuf = undefined;
}
function getLogoBuffer() {
  if (!cache.logo_type || !cache.logo_b64) return null;
  logoBuf ||= Buffer.from(cache.logo_b64, 'base64');
  return logoBuf;
}

const today = () => dateInTz(new Date(), getSetting('timezone'));

// ---------- معرفات رقمية ----------
/** يحجز n معرفًا متتاليًا ويرجع أول واحد منها */
async function reserveIds(name, n = 1) {
  const r = await C.counters.findOneAndUpdate({ _id: name }, { $inc: { seq: n } }, { upsert: true, returnDocument: 'after' });
  return r.seq - n + 1;
}
const nextId = (name) => reserveIds(name, 1);

// ---------- سجل العمليات ----------
async function logAction(actor, action, target, details, reason) {
  await C.activity_logs.insertOne({
    actor_type: actor?.type ?? 'system', actor_id: actor?.id ?? null, actor_name: actor?.name ?? null,
    action, target: target ?? null, details: details ?? null, reason: reason ?? null, created_at: nowIso(),
  });
}

/** يضيف حقل id (من _id) لتبقى واجهة الـ API كما هي */
const withId = (d) => (d ? { ...d, id: d._id } : d);
const isDup = (e) => e?.code === 11000;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { C, connect, close, dropDatabase, getSetting, getSettings, setSetting, getLogoBuffer, today, reserveIds, nextId, logAction, withId, isDup, escapeRegex, loadSettings };
