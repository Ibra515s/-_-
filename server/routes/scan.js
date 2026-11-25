const express = require('express');
const { C, today } = require('../db');
const { HttpError } = require('../util');
const A = require('../auth');
const { recordScan } = require('../services/attendance');

const router = express.Router();
router.use('/scan', A.requireScanner);

router.post('/scan', async (req, res) => {
  const staff = req.auth.user;
  const method = req.body?.method === 'manual' ? 'manual' : 'qr';
  if (method === 'manual' && staff.role !== 'admin' && !staff.can_manual) {
    throw new HttpError(403, 'manual_forbidden', 'الإدخال اليدوي غير مسموح لحسابك.');
  }
  if (typeof req.body?.code !== 'string') throw new HttpError(400, 'invalid_code', 'الرمز مطلوب.');
  res.json(await recordScan({ code: req.body.code, method, staff }));
});

// إحصاءات حيّة تتحدث كل بضع ثوانٍ في كل أجهزة المسح
router.get('/scan/live', async (req, res) => {
  const staff = req.auth.user;
  const day = today();
  const [present, expected, mine, recentDocs] = await Promise.all([
    C.attendance.countDocuments({ attendance_date: day, status: 'present' }),
    C.participants.countDocuments({ status: 'active' }),
    C.attendance.countDocuments({ attendance_date: day, recorded_by: staff.id, status: 'present' }),
    C.attendance.find({ attendance_date: day, recorded_by: staff.id, status: 'present' }).sort({ attended_at: -1, _id: -1 }).limit(8).toArray(),
  ]);
  const people = await C.participants.find({ _id: { $in: recentDocs.map((r) => r.participant_id) } }, { projection: { public_id: 1, full_name: 1 } }).toArray();
  const pm = new Map(people.map((p) => [p._id, p]));
  const recent = recentDocs.map((a) => ({ public_id: pm.get(a.participant_id)?.public_id, name: pm.get(a.participant_id)?.full_name, attended_at: a.attended_at, method: a.method }));
  res.json({ date: day, present, expected, mine, recent });
});

module.exports = { router };
