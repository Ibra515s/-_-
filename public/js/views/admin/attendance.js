import { h, icon, field, openModal, toast, errorBox, spinner, empty, pager, debounce, fmtDate, fmtTime } from '../../dom.js';
import * as api from '../../api.js';
import { pageHead } from './shared.js';

const METHOD = { qr: 'QR', manual: 'يدوي', admin_edit: 'تعديل المشرف' };
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default async function view() {
  const st = { date: '', q: '', status: '', page: 1 };
  let todayStr = '';
  let timer;
  const statsBox = h('div', { class: 'stats' });
  const listBox = h('div');
  const recentBox = h('div');
  const dateInput = h('input', { class: 'input', type: 'date', 'aria-label': 'التاريخ', style: { width: 'auto' }, onchange: (e) => { if (e.target.value) { st.date = e.target.value; st.page = 1; load(); } } });
  const title = h('span', { class: 'badge badge-gold' });

  async function load(silent) {
    if (!silent) listBox.replaceChildren(spinner());
    const qs = new URLSearchParams({ page: st.page });
    if (st.date) qs.set('date', st.date);
    if (st.q) qs.set('q', st.q);
    if (st.status) qs.set('status', st.status);
    try {
      const d = await api.get(`/admin/attendance?${qs}`);
      if (!todayStr && d.is_today) todayStr = d.date;
      st.date = d.date;
      dateInput.value = d.date;
      dateInput.max = todayStr || d.date;
      title.textContent = `${d.weekday} ${fmtDate(d.date)}${d.is_today ? ' (اليوم)' : ''}`;
      drawStats(d); drawList(d); drawRecent(d);
    } catch (e) { if (!silent) listBox.replaceChildren(errorBox(e.message)); }
  }

  function drawStats(d) {
    const stat = (v, l, cls = '') => h('div', { class: `stat ${cls}` }, h('div', { class: 'v num' }, v), h('div', { class: 'l' }, l));
    statsBox.replaceChildren(stat(d.expected, 'المشاركون المتوقعون'), stat(d.present, 'سجّلوا الحضور', 'accent'), stat(d.absent, 'لم يسجلوا'), stat(`${d.rate}%`, 'نسبة الحضور'));
  }

  function drawList(d) {
    if (!d.rows.length) { listBox.replaceChildren(empty('لا توجد نتائج.')); return; }
    const rows = d.rows.map((r) => h('tr', { class: r.status === 'present' ? 'row-present' : '' },
      h('td', { 'data-label': 'الاسم' }, r.full_name || '—'),
      h('td', { 'data-label': 'المعرف' }, h('span', { class: 'ltr' }, r.public_id)),
      h('td', { 'data-label': 'الحالة' }, h('span', { class: `status-chip ${r.status === 'present' ? 'att-present' : 'att-absent'}` }, r.status === 'present' ? 'حاضر' : r.status === 'cancelled' ? 'ملغى' : 'غير مسجل')),
      h('td', { 'data-label': 'الوقت', class: 'num' }, r.attended_at ? fmtTime(r.attended_at) : '—'),
      h('td', { 'data-label': 'سجّله' }, r.by_name ? `${r.by_name} (${METHOD[r.method]})` : '—'),
      h('td', { 'data-label': '', class: 'actions' }, h('button', { class: 'btn btn-sm', onclick: () => editModal(r, d.date) }, icon('edit'), 'تعديل'))));
    listBox.replaceChildren(
      h('div', { class: 'table-wrap resp' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['الاسم', 'المعرف', 'الحالة', 'الوقت', 'سجّله', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows))),
      pager(d, (p) => { st.page = p; load(); }));
  }

  function drawRecent(d) {
    recentBox.replaceChildren(h('section', { class: 'card card-flat' }, h('h3', { style: { marginBottom: '6px' } }, 'آخر عمليات المسح'),
      d.recent.length ? h('ul', { class: 'recent' }, d.recent.map((r) => h('li', null,
        h('span', null, r.full_name, ' ', h('span', { class: 'muted small ltr' }, r.public_id), r.status === 'cancelled' ? h('span', { class: 'badge badge-danger', style: { marginInlineStart: '6px' } }, 'ملغى') : null),
        h('span', { class: 'muted small num' }, `${fmtTime(r.attended_at)} · ${r.by_name || '—'}`)))) : h('p', { class: 'muted' }, 'لا توجد عمليات في هذا اليوم.')));
  }

  function editModal(r, date) {
    const makePresent = r.status !== 'present';
    const reason = h('input', { class: 'input', placeholder: 'سبب التعديل (مطلوب)', maxlength: 200 });
    const err = h('div');
    const m = openModal({
      title: makePresent ? 'تسجيل حضور يدويًا' : 'إلغاء حضور مسجّل',
      body: h('div', { class: 'stack' },
        h('div', null, h('b', null, r.full_name), ' ', h('span', { class: 'ltr muted' }, r.public_id), h('div', { class: 'muted small num' }, fmtDate(date))),
        h('p', { class: 'muted', style: { margin: 0 } }, makePresent ? 'سيُسجَّل الحضور وتُمنح النقاط المستحقة، ويُدوَّن التعديل في سجل العمليات.' : 'سيُلغى الحضور وتُخصم النقاط التي مُنحت عنه، ويُدوَّن التعديل في سجل العمليات.'),
        field('السبب', reason), err),
      actions: [
        h('button', { class: `btn ${makePresent ? 'btn-primary' : 'btn-danger'}`, onclick: async () => {
          err.replaceChildren();
          try { await api.post('/admin/attendance/set', { participant_id: r.participant_id, date, present: makePresent, reason: reason.value }); m.close(); toast('تم التعديل.', 'ok'); load(true); }
          catch (e) { err.append(errorBox(e.message)); }
        } }, makePresent ? 'تسجيل الحضور' : 'إلغاء الحضور'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'تراجع'),
      ],
    });
  }

  const search = h('input', { class: 'input search', type: 'search', placeholder: 'ابحث بالاسم أو المعرف', 'aria-label': 'بحث' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.page = 1; load(); }));
  const statusSel = h('select', { class: 'input', 'aria-label': 'الحالة', onchange: (e) => { st.status = e.target.value; st.page = 1; load(); } },
    h('option', { value: '' }, 'الكل'), h('option', { value: 'present' }, 'حاضر'), h('option', { value: 'absent' }, 'غير مسجل'));

  const shift = (n) => { if (!st.date) return; const next = addDays(st.date, n); if (todayStr && next > todayStr) return; st.date = next; st.page = 1; load(); };
  const el = h('div', { class: 'stack' },
    pageHead('سجل الحضور', title),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn btn-sm', 'aria-label': 'اليوم السابق', onclick: () => shift(-1) }, 'اليوم السابق'),
      dateInput,
      h('button', { class: 'btn btn-sm', onclick: () => shift(1) }, 'اليوم التالي'),
      h('button', { class: 'btn btn-sm', onclick: () => { st.date = ''; st.page = 1; load(); } }, 'اليوم')),
    statsBox,
    h('div', { class: 'toolbar', style: { marginBottom: 0 } }, search, statusSel),
    listBox, recentBox);

  await load();
  timer = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.modal-back')) load(true); }, 10000);
  return { el, onLeave: () => clearInterval(timer) };
}
