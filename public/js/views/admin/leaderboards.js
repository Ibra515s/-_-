import { h, icon, field, openModal, toast, errorBox, spinner, empty, switchEl, fmtDate, LB_STATUS } from '../../dom.js';
import * as api from '../../api.js';
import { pageHead } from './shared.js';

export default async function view({ navigate }) {
  const box = h('div', { class: 'stack' });

  async function load() {
    box.replaceChildren(spinner());
    try {
      const d = await api.get('/admin/leaderboards');
      box.replaceChildren(...(d.rows.length ? d.rows.map(card) : [empty('لم تُنشأ أي لوحة صدارة بعد. اضغط «إنشاء لوحة صدارة».')]));
    } catch (e) { box.replaceChildren(errorBox(e.message)); }
  }

  async function toggle(lb, key, value, input) {
    try { await api.patch(`/admin/leaderboards/${lb.id}`, { [key]: value }); toast('تم الحفظ.', 'ok'); load(); }
    catch (e) { input.checked = !value; toast(e.message, 'err'); }
  }

  function card(lb) {
    const [stLabel, stCls] = LB_STATUS[lb.status];
    return h('section', { class: 'card' },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
        h('div', null, h('h2', { style: { marginBottom: '4px' } }, lb.name),
          h('div', { class: 'muted num' }, `${fmtDate(lb.start_date)} ← ${fmtDate(lb.end_date)}`),
          h('div', { class: 'muted small' }, `نقاط الحضور: ${lb.attendance_points}`)),
        h('div', { class: 'row' },
          h('span', { class: `badge ${stCls}` }, stLabel),
          !lb.is_enabled ? h('span', { class: 'badge badge-danger' }, 'موقوفة') : null,
          lb.finalized ? h('span', { class: 'badge' }, 'نتائج مثبتة') : null)),
      h('div', { class: 'spacer' }),
      h('div', { class: 'row', style: { gap: '24px' } },
        switchEl('ظاهرة للمشاركين', lb.is_visible, (v, i) => toggle(lb, 'is_visible', v, i)),
        switchEl('مفعّلة', lb.is_enabled, (v, i) => toggle(lb, 'is_enabled', v, i))),
      h('p', { class: 'hint', style: { margin: '8px 0 0' } }, 'إخفاء اللوحة لا يحذفها ولا يوقف تسجيل الحضور؛ يبقى المشارك يرى نقاطه وترتيبه فقط.'),
      h('div', { class: 'spacer' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => standingsModal(lb) }, icon('trophy'), 'الترتيب والنتائج'),
        h('button', { class: 'btn', onclick: () => formModal(lb) }, icon('edit'), 'تعديل')));
  }

  function formModal(lb) {
    const name = h('input', { class: 'input', value: lb?.name || '', maxlength: 80, required: true });
    const start = h('input', { class: 'input', type: 'date', value: lb?.start_date || '' });
    const end = h('input', { class: 'input', type: 'date', value: lb?.end_date || '' });
    const pts = h('input', { class: 'input ltr', inputmode: 'numeric', value: lb?.attendance_points ?? 5 });
    const vis = h('input', { type: 'checkbox', checked: lb ? lb.is_visible : false });
    const err = h('div');
    const locked = lb?.finalized;
    if (locked) [start, end, pts].forEach((i) => { i.disabled = true; });
    const m = openModal({
      title: lb ? 'تعديل لوحة الصدارة' : 'إنشاء لوحة صدارة',
      body: h('div', { class: 'stack' },
        locked ? h('p', { class: 'hint', style: { margin: 0 } }, 'اللوحة منتهية ونتائجها مثبتة؛ لا يمكن تعديل مدتها أو نقاطها.') : null,
        field('اسم لوحة الصدارة', name),
        h('div', { class: 'grid2' }, field('تاريخ بداية المنافسة', start), field('تاريخ نهاية المنافسة', end)),
        field('نقاط الحضور', pts, 'تُمنح عن كل يوم حضور مسجّل ضمن المدة.'),
        !lb ? h('label', { class: 'switch' }, vis, h('span', null, 'إظهارها للمشاركين')) : null, err),
      actions: [
        h('button', { class: 'btn btn-primary', onclick: async () => {
          err.replaceChildren();
          const body = { name: name.value, start_date: start.value, end_date: end.value, attendance_points: pts.value };
          try {
            if (lb) await api.patch(`/admin/leaderboards/${lb.id}`, body);
            else await api.post('/admin/leaderboards', { ...body, is_visible: vis.checked });
            m.close(); toast('تم الحفظ.', 'ok'); load();
          } catch (e) { err.append(errorBox(e.message)); }
        } }, 'حفظ'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'إلغاء'),
      ],
    });
  }

  async function standingsModal(lb) {
    const body = h('div', null, spinner());
    openModal({ title: `ترتيب: ${lb.name}`, body, wide: true });
    async function fill() {
      try {
        const d = await api.get(`/admin/leaderboards/${lb.id}/standings?limit=200`);
        body.replaceChildren(
          d.leaderboard.finalized ? h('p', { class: 'badge badge-gold' }, 'النتائج النهائية (مثبتة)') : null,
          d.rows.length ? h('div', { class: 'table-wrap resp' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, ['الترتيب', 'الاسم', 'المعرف', 'النقاط', ''].map((t) => h('th', null, t)))),
            h('tbody', null, d.rows.map((r) => h('tr', null,
              h('td', { 'data-label': 'الترتيب', class: 'num' }, r.rank), h('td', { 'data-label': 'الاسم' }, r.full_name || '—'),
              h('td', { 'data-label': 'المعرف' }, h('span', { class: 'ltr' }, r.public_id)), h('td', { 'data-label': 'النقاط', class: 'num pts' }, r.points),
              h('td', { 'data-label': '', class: 'actions' }, d.leaderboard.finalized ? null : h('button', { class: 'btn btn-sm', onclick: () => adjustModal(r) }, 'تعديل النقاط'))))))) : empty('لا يوجد مشاركون نشطون.'),
          d.total > d.rows.length ? h('p', { class: 'muted small' }, `يظهر أول ${d.rows.length} من ${d.total}`) : null);
      } catch (e) { body.replaceChildren(errorBox(e.message)); }
    }
    function adjustModal(r) {
      const pts = h('input', { class: 'input ltr', inputmode: 'numeric', placeholder: 'مثال: 5 أو -5' });
      const reason = h('input', { class: 'input', placeholder: 'السبب (مطلوب)', maxlength: 200 });
      const err = h('div');
      const m = openModal({
        title: `تعديل نقاط ${r.full_name}`,
        body: h('div', { class: 'stack' }, field('عدد النقاط (موجب للإضافة وسالب للخصم)', pts), field('السبب', reason), err),
        actions: [h('button', { class: 'btn btn-primary', onclick: async () => {
          err.replaceChildren();
          try { await api.post(`/admin/leaderboards/${lb.id}/adjust`, { participant_id: r.participant_id, points: pts.value, reason: reason.value }); m.close(); toast('تم تسجيل التعديل.', 'ok'); fill(); }
          catch (e) { err.append(errorBox(e.message)); }
        } }, 'حفظ')],
      });
    }
    fill();
  }

  const el = h('div', null, pageHead('لوحة الصدارة', h('button', { class: 'btn btn-primary', onclick: () => formModal(null) }, icon('plus'), 'إنشاء لوحة صدارة')), box);
  await load();
  return { el };
}
