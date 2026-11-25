import { h, icon, field, openModal, toast, errorBox, fmtDateTime } from '../../dom.js';
import * as api from '../../api.js';

/** نافذة إنشاء حسابات جديدة بعدد يحدده المشرف */
export function createAccountsModal(onDone) {
  const count = h('input', { class: 'input ltr', type: 'text', inputmode: 'numeric', value: '500', required: true, maxlength: 5 });
  const err = h('div');
  const btn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'إنشاء الحسابات');
  const form = h('form', { class: 'stack', novalidate: true },
    field('عدد الحسابات المطلوبة', count, 'مثال: 500. تُنشأ بحالة «بانتظار التفعيل» ويُولَّد لكل حساب معرف ورمز QR فريد.'),
    err, h('div', { class: 'modal-foot', style: { marginTop: 0 } }, btn));
  const m = openModal({ title: 'إنشاء حسابات جديدة', body: form });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.replaceChildren();
    const n = Number(String(count.value).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660));
    if (!Number.isInteger(n) || n < 1) { err.append(errorBox('أدخل عددًا صحيحًا أكبر من صفر.')); return; }
    btn.disabled = true; btn.textContent = 'جارٍ الإنشاء…';
    try {
      const r = await api.post('/admin/participants/generate', { count: n });
      m.close();
      summaryModal(r, onDone);
    } catch (ex) { err.append(errorBox(ex.message)); btn.disabled = false; btn.textContent = 'إنشاء الحسابات'; }
  });
}

function summaryModal(r, onDone) {
  const done = () => { m.close(); onDone?.(); };
  const m = openModal({
    title: 'تم إنشاء الحسابات',
    onClose: () => onDone?.(),
    body: h('div', { class: 'stack' },
      h('div', { class: 'stat accent' }, h('div', { class: 'v num' }, r.created), h('div', { class: 'l' }, `حسابًا جديدًا بنجاح (الدفعة رقم ${r.batch_id})`)),
      h('p', { class: 'muted', style: { margin: 0 } }, 'يمكنك الآن تصدير بطاقات هذه الدفعة للطباعة، ويمكن إعادة طباعتها لاحقًا دون توليد معرفات جديدة.')),
    actions: [
      h('button', { class: 'btn btn-primary', onclick: () => exportCards({ scope: 'batch', batch_id: r.batch_id }) }, icon('download'), 'تصدير بطاقات الدفعة (PDF)'),
      h('button', { class: 'btn', onclick: done }, 'تم'),
    ],
  });
}

let exporting = false;
export async function exportCards(body) {
  if (exporting) return;
  exporting = true;
  toast('جارٍ تجهيز ملف PDF…');
  try {
    await api.download('/admin/cards/pdf', { method: 'POST', body }, 'cards.pdf');
    toast('تم تنزيل ملف البطاقات. اطبعه بالحجم الفعلي 100%.', 'ok');
  } catch (e) { toast(e.message, 'err'); } finally { exporting = false; }
}

/** نافذة اختيار نطاق تصدير البطاقات */
export async function exportCardsModal() {
  let batches = [];
  try { batches = (await api.get('/admin/batches')).rows; } catch { /* */ }
  const scopeSel = h('select', { class: 'input' },
    h('option', { value: 'all' }, 'جميع البطاقات'),
    h('option', { value: 'pending' }, 'الحسابات بانتظار التفعيل فقط'),
    h('option', { value: 'batch' }, 'دفعة محددة'));
  const batchSel = h('select', { class: 'input' }, batches.map((b) => h('option', { value: b.id }, `الدفعة ${b.id} — ${b.count} بطاقة (${fmtDateTime(b.created_at)})`)));
  const batchField = field('الدفعة', batchSel);
  batchField.classList.add('hidden');
  scopeSel.addEventListener('change', () => batchField.classList.toggle('hidden', scopeSel.value !== 'batch'));
  const m = openModal({
    title: 'تصدير البطاقات للطباعة',
    body: h('div', { class: 'stack' },
      field('ما الذي تريد تصديره؟', scopeSel), batchField,
      h('p', { class: 'hint', style: { margin: 0 } }, 'ملف PDF بمقاس A4: ست بطاقات في الصفحة (CR80: 85.6×54 ملم) مع علامات قص. اطبع بنسبة 100% دون «ملاءمة الصفحة».')),
    actions: [
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const body = { scope: scopeSel.value };
        if (scopeSel.value === 'batch') {
          if (!batchSel.value) { toast('لا توجد دفعات.', 'err'); return; }
          body.batch_id = Number(batchSel.value);
        }
        m.close();
        await exportCards(body);
      } }, icon('download'), 'تصدير PDF'),
      h('button', { class: 'btn', onclick: () => m.close() }, 'إلغاء'),
    ],
  });
}

export const pageHead = (title, ...actions) => h('div', { class: 'page-head' }, h('h1', null, title), h('div', { class: 'row' }, ...actions));
