const { C, getSetting, today, logAction, withId } = require('../db');
const { displayName, nowIso } = require('../util');

const lbStatus = (lb, day = today()) =>
  day < lb.start_date ? 'upcoming' : day > lb.end_date ? 'ended' : 'active';

/** اللوحة "الحالية": النشطة، وإلا آخر منتهية، وإلا أقرب قادمة */
async function currentLeaderboard({ includeDisabled = false } = {}) {
  const day = today();
  const all = (await C.leaderboards.find(includeDisabled ? {} : { is_enabled: true }).toArray()).map(withId);
  const by = (st) => all.filter((l) => lbStatus(l, day) === st);
  const active = by('active').sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id);
  if (active.length) return active[0];
  const ended = by('ended').sort((a, b) => b.end_date.localeCompare(a.end_date) || b.id - a.id);
  if (ended.length) return ended[0];
  return by('upcoming').sort((a, b) => a.start_date.localeCompare(b.start_date))[0] || null;
}

function rankRows(rows) {
  rows.sort((a, b) => b.points - a.points || (a.full_name || '').localeCompare(b.full_name || '', 'ar'));
  let prevPts = null, prevRank = 0;
  rows.forEach((r, i) => {
    if (r.points !== prevPts) { prevRank = i + 1; prevPts = r.points; }
    r.rank = prevRank;
  });
  return rows;
}

async function liveStandings(lbId) {
  const [sums, people] = await Promise.all([
    C.points_transactions.aggregate([{ $match: { leaderboard_id: lbId } }, { $group: { _id: '$participant_id', s: { $sum: '$points' } } }]).toArray(),
    C.participants.find({ status: 'active' }, { projection: { full_name: 1 } }).toArray(),
  ]);
  const m = new Map(sums.map((r) => [r._id, r.s]));
  return rankRows(people.map((p) => ({ participant_id: p._id, full_name: p.full_name, points: m.get(p._id) || 0 })));
}

/** الترتيب الكامل (حي، أو من اللقطة المثبتة إن كانت اللوحة منتهية ومثبتة) */
async function standings(lb) {
  if (lb.finalized_at) {
    return C.leaderboard_results.find({ leaderboard_id: lb.id }, { projection: { _id: 0 } }).sort({ rank: 1, full_name: 1 }).toArray();
  }
  return liveStandings(lb.id);
}

async function participantStanding(lb, participantId) {
  if (!lb) return { points: 0, rank: null, total: 0 };
  const rows = await standings(lb);
  const me = rows.find((r) => r.participant_id === participantId);
  if (me) return { points: me.points, rank: me.rank, total: rows.length };
  const agg = await C.points_transactions.aggregate([{ $match: { participant_id: participantId, leaderboard_id: lb.id } }, { $group: { _id: null, s: { $sum: '$points' } } }]).toArray();
  return { points: agg[0]?.s || 0, rank: null, total: rows.length };
}

async function publicEntries(lb, meId, limit = 100) {
  const mode = getSetting('leaderboard_names');
  const rows = await standings(lb);
  return rows.slice(0, limit).map((r) => ({ rank: r.rank, name: displayName(r.full_name, mode), points: r.points, me: r.participant_id === meId }));
}

/** تثبيت النتائج النهائية للوحات المنتهية (آمن عند التكرار) */
async function finalizeDue() {
  const day = today();
  const due = (await C.leaderboards.find({ finalized_at: null, end_date: { $lt: day } }).toArray()).map(withId);
  for (const lb of due) {
    const rows = await liveStandings(lb.id);
    if (rows.length) {
      await C.leaderboard_results.bulkWrite(rows.map((r) => ({
        updateOne: { filter: { leaderboard_id: lb.id, participant_id: r.participant_id },
          update: { $set: { full_name: r.full_name, points: r.points, rank: r.rank } }, upsert: true },
      })));
    }
    const claim = await C.leaderboards.updateOne({ _id: lb.id, finalized_at: null }, { $set: { finalized_at: nowIso() } });
    if (claim.modifiedCount) await logAction(null, 'leaderboard_finalized', `leaderboard:${lb.id}`, { name: lb.name, participants: rows.length });
  }
}

module.exports = { lbStatus, currentLeaderboard, standings, participantStanding, publicEntries, finalizeDue };
