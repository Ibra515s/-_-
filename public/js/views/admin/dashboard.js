import { h, icon, fmtDate, LB_STATUS } from '../../dom.js';
import * as api from '../../api.js';
import { createAccountsModal, exportCardsModal, pageHead } from './shared.js';

const n = (v) => new Intl.NumberFormat('en-US').format(v);

export default async function view({ navigate }) {
  const d = await api.get('/admin/dashboard');
  const lb = d.leaderboard;
  const lbStatus = lb ? LB_STATUS[lb.status] : null;

  const stat = (v, l, cls = '') => h('div', { class: `stat ${cls}` }, h('div', { class: 'v num' }, v), h('div', { class: 'l' }, l));

  const el = h('div', { class: 'stack', style: { gap: '22px' } },
    pageHead('لوحة التحكم', h('span', { class: 'badge badge-gold num' }, fmtDate(d.today))),
    h('section', { 'aria-label': 'الوصول السريع' },
      h('div', { class: 'quick' },
        h('button', { class: 'primary', onclick: () => createAccountsModal(() => navigate('#/admin')) }, icon('plus'), 'إنشاء حسابات جديدة'),
        h('button', { class: 'primary', onclick: exportCardsModal }, icon('card'), 'تصدير البطاقات'),
        h('a', { href: '#/scan' }, icon('scan'), 'تسجيل الحضور'),
        h('a', { href: '#/admin/attendance' }, icon('cal'), 'سجل الحضور'),
        h('a', { href: '#/admin/participants' }, icon('users'), 'إدارة المشاركين'),
        h('a', { href: '#/admin/assistants' }, icon('key'), 'إدارة المساعدين'))),
    h('div', { class: 'cols-2' },
      h('section', { class: 'card', 'aria-label': 'مؤشرات اليوم' },
        h('h2', { class: 'section-title' }, 'حضور اليوم'),
        h('div', { class: 'stats' },
          stat(n(d.present_today), 'حاضرون اليوم', 'accent'),
          stat(n(d.absent_today), 'غير مسجلين'),
          stat(`${d.attendance_rate}%`, 'نسبة الحضور'),
          h('div', { class: 'stat' },
            h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, d.attendance_rate)}%` } })),
            h('div', { class: 'l', style: { marginTop: '10px' } }, `${n(d.present_today)} من ${n(d.active)} مشارك نشط`)))),
      h('section', { class: 'card', 'aria-label': 'المشاركون' },
        h('h2', { class: 'section-title' }, 'المشاركون'),
        h('div', { class: 'stats' },
          stat(n(d.total), 'إجمالي المشاركين'),
          stat(n(d.active), 'الحسابات المفعّلة'),
          stat(n(d.pending), 'بانتظار التفعيل'),
          stat(n(d.suspended), 'موقوفة')))),
    h('section', { class: 'card', 'aria-label': 'لوحة الصدارة' },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', null,
          h('h2', { style: { marginBottom: '6px' } }, 'لوحة الصدارة الحالية'),
          lb
            ? h('div', { class: 'row', style: { gap: '8px' } }, h('b', null, lb.name), h('span', { class: 'muted num small' }, `${fmtDate(lb.start_date)} ← ${fmtDate(lb.end_date)}`))
            : h('div', { class: 'muted' }, 'لم يتم إنشاء لوحة صدارة بعد.')),
        h('div', { class: 'row', style: { gap: '8px' } },
          lb ? h('span', { class: `badge ${lbStatus[1]}` }, lbStatus[0]) : null,
          lb && !lb.is_enabled ? h('span', { class: 'badge badge-danger' }, 'موقوفة') : null,
          lb ? h('span', { class: `badge ${lb.is_visible ? 'badge-ok' : ''}` }, lb.is_visible ? 'ظاهرة للمشاركين' : 'مخفية عن المشاركين') : null,
          h('a', { class: 'btn btn-sm', href: '#/admin/leaderboards' }, lb ? 'إدارة' : 'إنشاء لوحة')))));
  return { el };
}
