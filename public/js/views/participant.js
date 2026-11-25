import { h, icon, spinner, empty, errorBox, MONTHS_AR } from '../dom.js';
import * as api from '../api.js';

function qrOverlay(src, pid) {
  const el = h('div', { class: 'qr-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'رمز QR' },
    h('img', { src, alt: `رمز QR للحساب ${pid}` }),
    h('div', { class: 'pid ltr' }, pid),
    h('button', { class: 'btn btn-lg', onclick: close }, icon('x'), 'إغلاق'));
  function close() { el.remove(); document.removeEventListener('keydown', onKey); }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(el);
}

function profileCard(p) {
  const src = '/api/me/qr.svg';
  const rank = p.rank ? `#${p.rank}` : '—';
  return h('section', { class: 'card', 'aria-label': 'الملف الشخصي' },
    h('div', { class: 'profile' },
      // QR على اليمين (أول عنصر في RTL)
      h('button', { class: 'qr-box', onclick: () => qrOverlay(src, p.public_id), 'aria-label': 'تكبير رمز QR' },
        h('img', { src, alt: `رمز QR للحساب ${p.public_id}` }), h('span', { class: 'qr-hint' }, 'اضغط للتكبير')),
      h('div', { class: 'stack-sm' },
        h('div', { class: 'pid ltr', style: { textAlign: 'inherit' } }, p.public_id),
        h('div', { class: 'pname' }, p.full_name),
        h('div', { class: 'muted' }, `العمر: ${p.age} سنة`),
        h('div', { class: 'kv' },
          h('div', { class: 'pill' }, h('b', { class: 'num' }, rank), h('span', null, 'ترتيبك')),
          h('div', { class: 'pill gold' }, h('b', { class: 'num' }, p.points), h('span', null, 'نقاطك'))),
        p.leaderboard ? h('div', { class: 'hint' }, `حسب: ${p.leaderboard.name}`) : h('div', { class: 'hint' }, 'لا توجد لوحة صدارة مفعّلة حاليًا.'))));
}

function leaderboardCard(lbData) {
  if (!lbData.leaderboard || !lbData.visible) return null;
  let shown = 10;
  const list = h('div', { class: 'lb-list' });
  const more = h('button', { class: 'btn btn-block', onclick: () => { shown += 20; draw(); } }, 'عرض المزيد');
  function draw() {
    list.replaceChildren(...lbData.entries.slice(0, shown).map((e) =>
      h('div', { class: `lb-row ${e.me ? 'me' : ''} ${e.rank === 1 ? 'top1' : ''}` },
        h('span', { class: `rank ${e.rank <= 3 ? 'r' + e.rank : ''}` }, e.rank),
        h('span', null, e.name, e.me ? h('span', { class: 'badge badge-ok', style: { marginInlineStart: '8px' } }, 'أنت') : null),
        h('span', { class: 'pts' }, `${e.points} نقطة`))));
    more.classList.toggle('hidden', shown >= lbData.entries.length);
  }
  draw();
  const mineInList = lbData.entries.some((e) => e.me);
  return h('section', { class: 'card', 'aria-label': 'لوحة الصدارة' },
    h('h2', null, icon('trophy'), ' ', lbData.leaderboard.name),
    lbData.entries.length ? list : empty('لا توجد نقاط مسجلة بعد.'),
    !mineInList && lbData.me?.rank ? h('p', { class: 'muted small' }, `ترتيبك الحالي: ${lbData.me.rank} (${lbData.me.points} نقطة)`) : null,
    h('div', { class: 'spacer' }), more);
}

function historyCard(hist) {
  // تجميع بحسب الشهر
  const byMonth = new Map();
  for (const d of hist.days) {
    const key = d.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(d);
  }
  const keys = [...byMonth.keys()];
  let current = keys[keys.length - 1];
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  const label = (k) => { const [y, m] = k.split('-'); return `${MONTHS_AR[Number(m) - 1]} ${y}`; };

  function draw() {
    tabs.replaceChildren(...keys.slice().reverse().map((k) =>
      h('button', { class: 'tab', role: 'tab', 'aria-selected': k === current, onclick: () => { current = k; draw(); } }, label(k))));
    const days = byMonth.get(current);
    const rows = days.map((d) => h('tr', { class: d.date === hist.today ? 'today' : '' },
      h('td', { 'data-label': 'اليوم' }, d.weekday),
      h('td', { class: 'num', 'data-label': 'التاريخ' }, d.label),
      h('td', { 'data-label': 'الحالة' }, h('span', { class: `status-chip ${d.status === 'present' ? 'att-present' : 'att-absent'}` }, d.status === 'present' ? 'حاضر' : 'غير مسجل'))));
    body.replaceChildren(h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'اليوم'), h('th', null, 'التاريخ'), h('th', null, 'الحالة'))),
        h('tbody', null, rows))));
  }
  draw();
  return h('section', { class: 'card', 'aria-label': 'سجل الحضور' },
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } },
      h('h2', { style: { margin: 0 } }, 'سجل حضور صلاة الفجر'),
      h('span', { class: 'badge badge-ok num' }, `حضرت ${hist.present_count} يومًا`)),
    tabs, body);
}

export default async function view() {
  const el = h('div', { class: 'stack' }, spinner());
  const [profile, lb, hist] = await Promise.all([api.get('/me/profile'), api.get('/me/leaderboard'), api.get('/me/history')]);
  el.replaceChildren(...[profileCard(profile), leaderboardCard(lb), historyCard(hist)].filter(Boolean));
  return { el };
}
