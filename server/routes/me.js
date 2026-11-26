const express = require('express');
const QRCode = require('qrcode');
const { C, getSetting, today } = require('../db');
const { addDays, weekdayAr, fmtDMY, publicBase, cardUrl } = require('../util');
const A = require('../auth');
const LB = require('../services/leaderboard');

const router = express.Router();
router.use('/me', A.requireParticipant);

const qrSvg = (text) => QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } });

function leaderboardInfo(lb) {
  if (!lb) return null;
  return { id: lb.id, name: lb.name, status: LB.lbStatus(lb), visible: !!lb.is_visible, start_date: lb.start_date, end_date: lb.end_date, points_per_attendance: lb.attendance_points };
}

router.get('/me/profile', async (req, res) => {
  const p = req.auth.user;
  const lb = await LB.currentLeaderboard();
  const st = await LB.participantStanding(lb, p.id);
  res.json({
    public_id: p.public_id, full_name: p.full_name, age: p.age,
    points: st.points, rank: st.rank, total_participants: st.total, leaderboard: leaderboardInfo(lb),
  });
});

// نفس رمز البطاقة المطبوعة تمامًا (رابط الموقع + المعرف)
router.get('/me/qr.svg', async (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'private, max-age=3600').send(await qrSvg(cardUrl(publicBase(req), req.auth.user.public_id)));
});

router.get('/me/history', async (req, res) => {
  const p = req.auth.user;
  const day = today();
  let start = getSetting('campaign_start');
  const floor = addDays(day, -399);
  if (start < floor) start = floor;
  const rows = await C.attendance.find({ participant_id: p.id, status: 'present' }, { projection: { attendance_date: 1 } }).toArray();
  const present = new Set(rows.map((r) => r.attendance_date));
  const days = [];
  for (let d = start; d <= day; d = addDays(d, 1)) {
    days.push({ date: d, label: fmtDMY(d), weekday: weekdayAr(d), status: present.has(d) ? 'present' : 'absent' });
  }
  res.json({ today: day, campaign_start: start, present_count: days.filter((d) => d.status === 'present').length, days });
});

router.get('/me/leaderboard', async (req, res) => {
  const p = req.auth.user;
  const lb = await LB.currentLeaderboard();
  if (!lb) return res.json({ leaderboard: null, visible: false, entries: [] });
  const st = await LB.participantStanding(lb, p.id);
  // إن كانت اللوحة مخفية لا تُرسل قائمة الآخرين إطلاقًا
  const entries = lb.is_visible ? await LB.publicEntries(lb, p.id, 100) : [];
  res.json({ leaderboard: leaderboardInfo(lb), visible: !!lb.is_visible, me: { points: st.points, rank: st.rank }, entries });
});

module.exports = { router, qrSvg };
