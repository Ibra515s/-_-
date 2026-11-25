import { h, spinner, empty, errorBox, pager, fmtDateTime } from '../../dom.js';
import * as api from '../../api.js';
import { pageHead } from './shared.js';

const ACTIONS = {
  accounts_generated: 'إنشاء حسابات', account_activated: 'تفعيل حساب', accounts_exported: 'تصدير قائمة الحسابات', cards_exported: 'تصدير بطاقات',
  participant_edited: 'تعديل بيانات مشارك', participant_suspended: 'إيقاف حساب', participant_reactivated: 'إعادة تفعيل حساب',
  id_replaced: 'استبدال معرف', password_reset: 'استعادة كلمة مرور مشارك', password_changed: 'تغيير كلمة مرور',
  attendance_edit: 'تعديل حضور يدوي', points_adjusted: 'تعديل نقاط', leaderboard_created: 'إنشاء لوحة صدارة',
  leaderboard_updated: 'تعديل لوحة صدارة', leaderboard_finalized: 'تثبيت نتائج لوحة', assistant_created: 'إنشاء مساعد',
  assistant_updated: 'تعديل مساعد', assistant_password_reset: 'كلمة مرور مساعد', settings_changed: 'تغيير الإعدادات',
  logo_changed: 'تغيير الشعار', logo_removed: 'حذف الشعار', staff_login: 'دخول موظف', admin_seeded: 'إنشاء المشرف الرئيسي',
};

function describe(r) {
  if (!r.details) return '';
  const d = r.details;
  if (r.action === 'id_replaced') return `${d.old} ← ${d.new}`;
  if (r.action === 'attendance_edit') return `${d.date} — ${{ added: 'إضافة حضور', reinstated: 'استعادة حضور', cancelled: 'إلغاء حضور' }[d.change] || d.change}`;
  if (r.action === 'points_adjusted') return `${d.points > 0 ? '+' : ''}${d.points} (${d.leaderboard})`;
  if (r.action === 'accounts_generated') return `${d.count} حسابًا`;
  if (r.action === 'cards_exported' || r.action === 'accounts_exported') return `${d.count} سجلًا`;
  try { return JSON.stringify(d).slice(0, 140); } catch { return ''; }
}

export default async function view() {
  const st = { page: 1, action: '' };
  const box = h('div');
  const sel = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'نوع العملية', onchange: (e) => { st.action = e.target.value; st.page = 1; load(); } }, h('option', { value: '' }, 'كل العمليات'));

  async function load() {
    box.replaceChildren(spinner());
    const qs = new URLSearchParams({ page: st.page });
    if (st.action) qs.set('action', st.action);
    try {
      const d = await api.get(`/admin/logs?${qs}`);
      if (sel.options.length === 1) d.actions.forEach((a) => sel.append(h('option', { value: a }, ACTIONS[a] || a)));
      if (!d.rows.length) { box.replaceChildren(empty('لا توجد عمليات.')); return; }
      box.replaceChildren(
        h('div', { class: 'table-wrap resp' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['الوقت', 'العملية', 'المنفّذ', 'الهدف', 'التفاصيل', 'السبب'].map((t) => h('th', null, t)))),
          h('tbody', null, d.rows.map((r) => h('tr', null,
            h('td', { 'data-label': 'الوقت', class: 'num' }, fmtDateTime(r.created_at)),
            h('td', { 'data-label': 'العملية' }, ACTIONS[r.action] || r.action),
            h('td', { 'data-label': 'المنفّذ' }, r.actor_name || 'النظام'),
            h('td', { 'data-label': 'الهدف' }, h('span', { class: 'ltr' }, r.target || '—')),
            h('td', { 'data-label': 'التفاصيل' }, describe(r)),
            h('td', { 'data-label': 'السبب' }, r.reason || '—')))))),
        pager(d, (p) => { st.page = p; load(); }));
    } catch (e) { box.replaceChildren(errorBox(e.message)); }
  }

  const el = h('div', null, pageHead('سجل العمليات', sel), box);
  await load();
  return { el };
}
