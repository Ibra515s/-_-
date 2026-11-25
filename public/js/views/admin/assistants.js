import { h, icon, field, openModal, toast, errorBox, spinner, empty, switchEl, fmtDateTime, fmtDate } from '../../dom.js';
import * as api from '../../api.js';
import { pageHead } from './shared.js';

export default async function view() {
  const box = h('div', { class: 'stack' });

  async function load() {
    box.replaceChildren(spinner());
    try {
      const d = await api.get('/admin/staff');
      box.replaceChildren(...(d.rows.length ? d.rows.map(card) : [empty('لا يوجد مساعدون بعد. أنشئ حسابًا ليسجّل الحضور من هاتفه.')]));
    } catch (e) { box.replaceChildren(errorBox(e.message)); }
  }

  async function update(s, patch, input, revert) {
    try { await api.patch(`/admin/staff/${s.id}`, patch); toast('تم الحفظ.', 'ok'); load(); }
    catch (e) { if (input) input.checked = revert; toast(e.message, 'err'); }
  }

  function card(s) {
    return h('section', { class: 'card' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('div', null, h('h3', null, s.display_name), h('div', { class: 'muted small' }, 'اسم المستخدم: ', h('span', { class: 'ltr' }, s.username))),
        h('div', { class: 'row' },
          h('span', { class: `badge ${s.is_active ? 'badge-ok' : 'badge-danger'}` }, s.is_active ? 'نشط' : 'موقوف'),
          h('span', { class: 'badge badge-gold num' }, `سجّل اليوم: ${s.today_count}`))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'row', style: { gap: '22px' } },
        switchEl('الحساب نشط', s.is_active, (v, i) => update(s, { is_active: v }, i, !v)),
        switchEl('صلاحية مسح QR', s.can_scan, (v, i) => update(s, { can_scan: v }, i, !v)),
        switchEl('الإدخال اليدوي', s.can_manual, (v, i) => update(s, { can_manual: v }, i, !v))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm', onclick: () => activityModal(s) }, icon('list'), 'سجل العمليات'),
        h('button', { class: 'btn btn-sm', onclick: () => passwordModal(s) }, icon('key'), 'كلمة مرور جديدة')));
  }

  function createModal() {
    const display = h('input', { class: 'input', maxlength: 60, required: true });
    const user = h('input', { class: 'input ltr', autocapitalize: 'none', autocorrect: 'off', maxlength: 30, placeholder: 'مثال: ahmad.k' });
    const pw = h('input', { class: 'input ltr', type: 'text', autocomplete: 'off', placeholder: '8 أحرف على الأقل' });
    const manual = h('input', { type: 'checkbox' });
    const err = h('div');
    const m = openModal({
      title: 'إنشاء حساب مساعد',
      body: h('div', { class: 'stack' },
        field('اسم المساعد', display), field('اسم المستخدم (إنجليزي)', user), field('كلمة المرور', pw, 'سلّمها للمساعد مباشرة؛ يستطيع تغييرها لاحقًا من أيقونة المفتاح.'),
        h('label', { class: 'switch' }, manual, h('span', null, 'السماح بإدخال المعرف يدويًا')),
        h('p', { class: 'hint', style: { margin: 0 } }, 'يحصل المساعد على صلاحية مسح الحضور فقط، دون أي وصول لبيانات المشاركين أو الإعدادات.'), err),
      actions: [h('button', { class: 'btn btn-primary', onclick: async () => {
        err.replaceChildren();
        try { await api.post('/admin/staff', { display_name: display.value, username: user.value, password: pw.value, can_manual: manual.checked }); m.close(); toast('تم إنشاء حساب المساعد.', 'ok'); load(); }
        catch (e) { err.append(errorBox(e.message)); }
      } }, 'إنشاء الحساب')],
    });
  }

  function passwordModal(s) {
    const pw = h('input', { class: 'input ltr', type: 'text', autocomplete: 'off', placeholder: '8 أحرف على الأقل' });
    const err = h('div');
    const m = openModal({
      title: `كلمة مرور جديدة لـ ${s.display_name}`,
      body: h('div', { class: 'stack' }, field('كلمة المرور الجديدة', pw, 'ستُغلق جلسات المساعد الحالية.'), err),
      actions: [h('button', { class: 'btn btn-primary', onclick: async () => {
        try { await api.post(`/admin/staff/${s.id}/password`, { password: pw.value }); m.close(); toast('تم تغيير كلمة المرور.', 'ok'); }
        catch (e) { err.replaceChildren(errorBox(e.message)); }
      } }, 'حفظ')],
    });
  }

  async function activityModal(s) {
    const body = h('div', null, spinner());
    openModal({ title: `عمليات ${s.display_name}`, body, wide: true });
    try {
      const d = await api.get(`/admin/staff/${s.id}/activity`);
      body.replaceChildren(h('p', { class: 'muted' }, `إجمالي ما سجّله: ${d.total} (يظهر آخر ${d.rows.length})`),
        d.rows.length ? h('div', { class: 'table-wrap resp' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ['المشارك', 'المعرف', 'اليوم', 'الوقت', 'الطريقة', 'الحالة'].map((t) => h('th', null, t)))),
          h('tbody', null, d.rows.map((r) => h('tr', null,
            h('td', { 'data-label': 'المشارك' }, r.full_name), h('td', { 'data-label': 'المعرف' }, h('span', { class: 'ltr' }, r.public_id)),
            h('td', { 'data-label': 'اليوم', class: 'num' }, fmtDate(r.attendance_date)), h('td', { 'data-label': 'الوقت', class: 'num' }, fmtDateTime(r.attended_at).slice(11)),
            h('td', { 'data-label': 'الطريقة' }, { qr: 'QR', manual: 'يدوي', admin_edit: 'تعديل' }[r.method]), h('td', { 'data-label': 'الحالة' }, r.status === 'present' ? 'حاضر' : 'ملغى')))))) : empty('لا توجد عمليات.'));
    } catch (e) { body.replaceChildren(errorBox(e.message)); }
  }

  const el = h('div', null, pageHead('المساعدون', h('button', { class: 'btn btn-primary', onclick: createModal }, icon('plus'), 'إنشاء حساب مساعد')), box);
  await load();
  return { el };
}
