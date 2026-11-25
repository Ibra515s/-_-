const { C, today, logAction, isDup } = require('../db');
const { nowIso, normalizeCode } = require('../util');

/** يضيف قيد نقاط مرة واحدة فقط (الفهرس الفريد هو الحَكَم). يرجع true إن أُضيف فعلًا. */
async function insertPointsOnce(doc) {
  try { await C.points_transactions.insertOne({ ...doc, created_at: nowIso() }); return true; }
  catch (e) { if (isDup(e)) return false; throw e; }
}

/** يمنح نقاط الحضور لكل لوحة مفعّلة تغطي التاريخ (ولم تُثبّت نتائجها). آمن عند التكرار. */
async function awardForAttendance(att, staffId) {
  const boards = await C.leaderboards.find({
    is_enabled: true, finalized_at: null, start_date: { $lte: att.attendance_date }, end_date: { $gte: att.attendance_date }, attendance_points: { $ne: 0 },
  }).toArray();
  let total = 0;
  for (const lb of boards) {
    const ok = await insertPointsOnce({
      participant_id: att.participant_id, leaderboard_id: lb._id, points: lb.attendance_points, kind: 'attendance',
      reason: 'تسجيل حضور صلاة الفجر', related_attendance_id: att._id, event_key: `award:${att.revision}`, created_by: staffId ?? null,
    });
    if (ok) total += lb.attendance_points;
  }
  return total;
}

async function reverseForAttendance(att, staffId, reason) {
  const awards = await C.points_transactions.find({ related_attendance_id: att._id, event_key: `award:${att.revision}` }).toArray();
  for (const a of awards) {
    const lb = await C.leaderboards.findOne({ _id: a.leaderboard_id });
    if (!lb || lb.finalized_at) continue;
    await insertPointsOnce({
      participant_id: att.participant_id, leaderboard_id: a.leaderboard_id, points: -a.points, kind: 'reversal',
      reason: `إلغاء حضور: ${reason}`, related_attendance_id: att._id, event_key: `reversal:${att.revision}`, created_by: staffId ?? null,
    });
  }
}

/**
 * تسجيل حضور من الماسح. آمن مع التزامن: الفهرس الفريد (مشارك + يوم) هو الحَكَم،
 * وإن تعطّل الخادم بين تسجيل الحضور ومنح النقاط فإن أول مسح لاحق للبطاقة يكمل النقاط (idempotent).
 */
async function recordScan({ code, method, staff }) {
  const norm = normalizeCode(code);
  if (!norm) return { status: 'invalid', message: 'الرمز غير صحيح.' };

  const p = await C.participants.findOne({ public_id: norm });
  if (!p) {
    const old = await C.retired_ids.findOne({ _id: norm });
    if (old) return { status: 'replaced', public_id: norm, message: 'هذه البطاقة تم استبدالها. استخدم البطاقة الجديدة.' };
    return { status: 'invalid', public_id: norm, message: 'المعرف غير موجود.' };
  }
  const base = { public_id: p.public_id, name: p.full_name };
  if (p.status === 'pending') return { ...base, status: 'pending', message: 'الحساب لم يُفعَّل بعد.' };
  if (p.status === 'suspended') return { ...base, status: 'suspended', message: 'الحساب موقوف.' };

  const day = today();
  const at = nowIso();
  const doc = { participant_id: p._id, attendance_date: day, attended_at: at, status: 'present', revision: 1, recorded_by: staff.id, method };
  try {
    const r = await C.attendance.insertOne(doc);
    const points = await awardForAttendance({ ...doc, _id: r.insertedId }, staff.id);
    return { ...base, status: 'ok', attended_at: at, points, message: 'تم تسجيل الحضور.' };
  } catch (e) {
    if (!isDup(e)) throw e;
  }
  const ex = await C.attendance.findOne({ participant_id: p._id, attendance_date: day });
  if (ex.status === 'cancelled') return { ...base, status: 'cancelled', message: 'أُلغي حضور هذا المشارك اليوم من المشرف.' };
  await awardForAttendance(ex, ex.recorded_by); // إكمال نقاط قد تكون ضاعت بانقطاع (آمن عند التكرار)
  const by = ex.recorded_by != null ? (await C.staff.findOne({ _id: ex.recorded_by }))?.display_name : null;
  return { ...base, status: 'duplicate', attended_at: ex.attended_at, by, message: 'الحضور مسجّل مسبقًا اليوم.' };
}

/** تعديل يدوي من المشرف الرئيسي (حاضر / غير مسجل) مع سجل مراجعة */
async function adminSetAttendance({ participantId, date, present, reason, actor }) {
  const p = await C.participants.findOne({ _id: participantId });
  if (!p) return { error: 'not_found' };
  let att = await C.attendance.findOne({ participant_id: participantId, attendance_date: date });
  let change;
  if (present) {
    if (!att) {
      const doc = { participant_id: participantId, attendance_date: date, attended_at: nowIso(), status: 'present', revision: 1, recorded_by: actor.id, method: 'admin_edit' };
      try { const r = await C.attendance.insertOne(doc); att = { ...doc, _id: r.insertedId }; }
      catch (e) { if (isDup(e)) return { error: 'no_change' }; throw e; }
      await awardForAttendance(att, actor.id);
      change = 'added';
    } else if (att.status === 'cancelled') {
      const upd = await C.attendance.findOneAndUpdate({ _id: att._id, status: 'cancelled' },
        { $set: { status: 'present', recorded_by: actor.id, method: 'admin_edit', attended_at: nowIso() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
      if (!upd) return { error: 'no_change' };
      await awardForAttendance(upd, actor.id);
      change = 'reinstated';
    } else return { error: 'no_change' };
  } else {
    if (!att || att.status === 'cancelled') return { error: 'no_change' };
    const upd = await C.attendance.findOneAndUpdate({ _id: att._id, status: 'present' }, { $set: { status: 'cancelled' } }, { returnDocument: 'after' });
    if (!upd) return { error: 'no_change' };
    await reverseForAttendance(upd, actor.id, reason);
    change = 'cancelled';
  }
  await logAction(actor, 'attendance_edit', `participant:${p.public_id}`, { date, change }, reason);
  return { ok: true, change };
}

module.exports = { recordScan, adminSetAttendance };
