import { h, icon, field, openModal, confirmDialog, toast, errorBox, spinner, empty, pager, debounce, statusBadge, fmtDateTime, fmtDate, STATUS } from '../../dom.js';
import * as api from '../../api.js';
import { navigate } from '../../app.js';
import { createAccountsModal, exportCardsModal, exportCards, pageHead } from './shared.js';

export default async function view() {
  const st = { q: '', status: '', batch: '', page: 1, limit: 50 };
  const selected = new Set();
  let batches = [];
  try { batches = (await api.get('/admin/batches')).rows; } catch { /* */ }

  const listBox = h('div');
  const bar = h('div');

  // ---------- شريط الأدوات ----------
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'ابحث بالاسم أو المعرف أو الهاتف', 'aria-label': 'بحث' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.page = 1; load(); }));
  const statusSel = h('select', { class: 'input', 'aria-label': 'الحالة', onchange: (e) => { st.status = e.target.value; st.page = 1; load(); } },
    h('option', { value: '' }, 'كل الحالات'), ...Object.entries(STATUS).map(([k, [label]]) => h('option', { value: k }, label)));
  const batchSel = h('select', { class: 'input', 'aria-label': 'الدفعة', onchange: (e) => { st.batch = e.target.value; st.page = 1; load(); } },
    h('option', { value: '' }, 'كل الدفعات'), ...batches.map((b) => h('option', { value: b.id }, `الدفعة ${b.id} (${b.count})`)));

  const toolbar = h('div', { class: 'toolbar' }, search, statusSel, batchSel);

  async function load() {
    listBox.replaceChildren(spinner());
    const qs = new URLSearchParams({ page: st.page, limit: st.limit });
    if (st.q) qs.set('q', st.q);
    if (st.status) qs.set('status', st.status);
    if (st.batch) qs.set('batch', st.batch);
    try {
      const d = await api.get(`/admin/participants?${qs}`);
      draw(d);
    } catch (e) { listBox.replaceChildren(errorBox(e.message)); }
  }

  function drawBar() {
    bar.replaceChildren(selected.size ? h('div', { class: 'sticky-bar' },
      h('span', null, `${selected.size} محدد`),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: () => exportCardsModal({ scope: 'ids', ids: [...selected] }) }, icon('card'), 'طباعة بطاقات المحدد'),
        h('button', { class: 'btn btn-sm', onclick: () => { selected.clear(); drawBar(); document.querySelectorAll('.sel').forEach((c) => { c.checked = false; }); } }, 'إلغاء التحديد'))) : '');
  }

  function draw(d) {
    if (!d.rows.length) { listBox.replaceChildren(empty('لا يوجد مشاركون مطابقون.')); return; }
    const all = h('input', { type: 'checkbox', 'aria-label': 'تحديد الكل', onchange: (e) => {
      d.rows.forEach((r) => (e.target.checked ? selected.add(r.id) : selected.delete(r.id)));
      document.querySelectorAll('.sel').forEach((c) => { c.checked = e.target.checked; }); drawBar();
    } });
    const rows = d.rows.map((r) => h('tr', null,
      h('td', { 'data-label': '' }, h('input', { type: 'checkbox', class: 'sel', 'aria-label': `تحديد ${r.public_id}`, checked: selected.has(r.id), onchange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); drawBar(); } })),
      h('td', { 'data-label': 'المعرف' }, h('b', { class: 'ltr' }, r.public_id), r.replaced_ids ? h('span', { class: 'badge badge-warn', style: { marginInlineStart: '6px' }, title: 'تم استبدال معرف سابق' }, 'مستبدل') : null),
      h('td', { 'data-label': 'الاسم' }, r.full_name || h('span', { class: 'muted' }, '—')),
      h('td', { 'data-label': 'العمر', class: 'num' }, r.age ?? '—'),
      h('td', { 'data-label': 'الحالة' }, statusBadge(r.status)),
      h('td', { 'data-label': 'تاريخ الإنشاء', class: 'num' }, fmtDateTime(r.created_at).slice(0, 10)),
      h('td', { 'data-label': '', class: 'actions' }, h('button', { class: 'btn btn-sm', onclick: () => detailModal(r.id) }, 'تفاصيل'))));
    listBox.replaceChildren(
      h('p', { class: 'muted small num', style: { margin: '0 0 8px' } }, `${d.total} مشارك`),
      h('div', { class: 'table-wrap resp' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, all), ...['المعرف', 'الاسم', 'العمر', 'الحالة', 'تاريخ الإنشاء', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows))),
      pager(d, (p) => { st.page = p; load(); }));
  }

  // ---------- التفاصيل ----------
  async function detailModal(id) {
    const body = h('div', null, spinner());
    const m = openModal({ title: 'تفاصيل المشارك', body, wide: true });
    async function fill() {
      let d;
      try { d = await api.get(`/admin/participants/${id}`); } catch (e) { body.replaceChildren(errorBox(e.message)); return; }
      const p = d.participant;
      const err = h('div');
      const act = async (fn, okMsg) => {
        err.replaceChildren();
        try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); await fill(); load(); return r; }
        catch (e) { err.replaceChildren(errorBox(e.message)); }
      };
      const name = h('input', { class: 'input', value: p.full_name || '' });
      const age = h('input', { class: 'input ltr', value: p.age ?? '', inputmode: 'numeric' });
      const phone = h('input', { class: 'input ltr', value: p.phone || '', inputmode: 'tel' });

      body.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'row' },
          h('span', { class: 'kbd' }, p.public_id), statusBadge(p.status),
          d.retired_ids.length ? h('span', { class: 'badge badge-warn' }, `معرفات سابقة: ${d.retired_ids.map((r) => r.public_id).join('، ')}`) : null),
        p.status === 'pending'
          ? h('p', { class: 'muted' }, 'هذا الحساب لم يُفعَّل بعد؛ ستظهر بياناته بعد أن يمسح صاحبه البطاقة ويكمل النموذج.')
          : h('div', { class: 'stack-sm' },
            h('div', { class: 'grid2' }, field('الاسم الرباعي', name), h('div', { class: 'grid2' }, field('العمر', age), field('الهاتف', phone))),
            h('div', null, h('button', { class: 'btn btn-sm', onclick: () => act(() => api.patch(`/admin/participants/${id}`, { full_name: name.value, age: age.value, phone: phone.value }), 'تم حفظ البيانات') }, 'حفظ التعديلات')),
            h('div', { class: 'row small muted' },
              h('span', null, `النقاط: ${d.standing.points}`), h('span', null, d.standing.rank ? `الترتيب: ${d.standing.rank}` : 'الترتيب: —'),
              d.standing.leaderboard ? h('span', null, `(${d.standing.leaderboard})`) : null,
              h('span', { class: 'num' }, `تاريخ التفعيل: ${fmtDateTime(p.activated_at)}`))),
        err,
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => exportCardsModal({ scope: 'ids', ids: [p.id] }) }, icon('card'), 'طباعة البطاقة'),
          p.status === 'suspended'
            ? h('button', { class: 'btn', onclick: async () => { if (await confirmDialog({ title: 'إعادة تفعيل الحساب', message: 'سيتمكن المشارك من الدخول وتسجيل الحضور مجددًا.', confirmText: 'إعادة التفعيل' })) act(() => api.post(`/admin/participants/${id}/unsuspend`), 'تمت إعادة التفعيل'); } }, 'إلغاء الإيقاف')
            : h('button', { class: 'btn', onclick: async () => { const r = await confirmDialog({ title: 'إيقاف الحساب', message: 'لن يستطيع الدخول أو تسجيل الحضور. تبقى سجلاته ونقاطه محفوظة.', confirmText: 'إيقاف', danger: true, withReason: true }); if (r) act(() => api.post(`/admin/participants/${id}/suspend`, { reason: r }), 'تم إيقاف الحساب'); } }, 'إيقاف الحساب'),
          h('button', { class: 'btn', onclick: async () => {
            const r = await confirmDialog({ title: 'استبدال المعرف', message: 'سيُولَّد معرف جديد ويتوقف القديم (مثلًا عند ضياع البطاقة). يبقى الحضور والنقاط كما هي، وعليك طباعة بطاقة جديدة.', confirmText: 'استبدال', danger: true, withReason: true });
            if (r) { const res = await act(() => api.post(`/admin/participants/${id}/replace-id`, { reason: r })); if (res) { toast(`المعرف الجديد: ${res.new}`, 'ok'); } }
          } }, icon('refresh'), 'استبدال المعرف'),
          p.status !== 'pending' ? h('button', { class: 'btn', onclick: async () => {
            if (!(await confirmDialog({ title: 'استعادة كلمة المرور', message: 'ستُنشأ كلمة مرور مؤقتة تُعرض لك مرة واحدة، ويُطلب من المشارك تغييرها عند الدخول.', confirmText: 'إنشاء كلمة مؤقتة' }))) return;
            const res = await act(() => api.post(`/admin/participants/${id}/reset-password`));
            if (res) openModal({ title: 'كلمة المرور المؤقتة', body: h('div', { class: 'stack center' }, h('span', { class: 'kbd' }, res.temporary_password), h('p', { class: 'muted small', style: { margin: 0 } }, 'سلّمها للمشارك الآن؛ لن تُعرض مرة أخرى.')) });
          } }, icon('key'), 'استعادة كلمة المرور') : null),
        h('h3', null, 'آخر سجلات الحضور'),
        d.attendance.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, ['التاريخ', 'الوقت', 'الطريقة', 'سجّله', 'الحالة'].map((t) => h('th', null, t)))),
            h('tbody', null, d.attendance.slice(0, 14).map((a) => h('tr', null,
              h('td', { class: 'num' }, fmtDate(a.attendance_date)), h('td', { class: 'num' }, fmtDateTime(a.attended_at).slice(11)),
              h('td', null, { qr: 'QR', manual: 'يدوي', admin_edit: 'تعديل المشرف' }[a.method]), h('td', null, a.by_name || '—'),
              h('td', null, a.status === 'present' ? 'حاضر' : 'ملغى'))))))
          : h('p', { class: 'muted' }, 'لا توجد سجلات حضور.')));
    }
    fill();
    return m;
  }

  // ---------- الدفعات ----------
  async function batchesModal() {
    const d = await api.get('/admin/batches');
    openModal({
      title: 'الدفعات السابقة', wide: true,
      body: d.rows.length ? h('div', { class: 'table-wrap resp' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['الدفعة', 'العدد', 'مفعّلة', 'بانتظار التفعيل', 'التاريخ', ''].map((t) => h('th', null, t)))),
        h('tbody', null, d.rows.map((b) => h('tr', null,
          h('td', { 'data-label': 'الدفعة', class: 'num' }, b.id), h('td', { 'data-label': 'العدد', class: 'num' }, b.count),
          h('td', { 'data-label': 'مفعّلة', class: 'num' }, b.active), h('td', { 'data-label': 'بانتظار التفعيل', class: 'num' }, b.pending),
          h('td', { 'data-label': 'التاريخ', class: 'num' }, fmtDateTime(b.created_at)),
          h('td', { 'data-label': '', class: 'actions' }, h('button', { class: 'btn btn-sm', onclick: () => exportCardsModal({ scope: 'batch', batch_id: b.id }) }, icon('card'), 'إعادة طباعة')))))))
        : empty('لا توجد دفعات بعد.'),
    });
  }

  function csvModal() {
    const phone = h('input', { type: 'checkbox' });
    const m = openModal({
      title: 'تصدير قائمة الحسابات (Excel / CSV)',
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted', style: { margin: 0 } }, 'يتضمن: معرف الحساب، الاسم الرباعي، الحالة، تاريخ الإنشاء. لا تُصدَّر كلمات المرور إطلاقًا.'),
        h('label', { class: 'switch' }, phone, h('span', null, 'تضمين رقم الهاتف (للمشرف فقط)'))),
      actions: [
        h('button', { class: 'btn btn-primary', onclick: async () => {
          m.close();
          try { await api.download(`/admin/participants-export.csv?include_phone=${phone.checked ? 1 : 0}${st.batch ? `&batch=${st.batch}` : ''}`, {}, 'participants.csv'); toast('تم تنزيل الملف.', 'ok'); }
          catch (e) { toast(e.message, 'err'); }
        } }, icon('download'), 'تنزيل CSV'),
      ],
    });
  }

  const el = h('div', null,
    pageHead('المشاركون',
      h('button', { class: 'btn btn-primary', onclick: () => createAccountsModal(() => navigate('#/admin/participants')) }, icon('plus'), 'إنشاء حسابات جديدة'),
      h('button', { class: 'btn btn-primary', onclick: exportCardsModal }, icon('card'), 'تصدير البطاقات'),
      h('button', { class: 'btn', onclick: batchesModal }, 'الدفعات'),
      h('button', { class: 'btn', onclick: csvModal }, icon('download'), 'Excel / CSV')),
    toolbar, listBox, bar);
  load();
  return { el };
}
