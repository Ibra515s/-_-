import { h, icon, field, openModal, toast, errorBox, fmtDateTime } from '../../dom.js';
import * as api from '../../api.js';

const PAPERS = {
  A3: [297, 420],
  SRA3: [320, 450],
  A2: [420, 594],
  B2: [500, 700],
  B1: [700, 1000],
  A4: [210, 297],
  LETTER: [215.9, 279.4],
};

const CARD_SIZES = {
  cr80: [85.6, 54],
  biz: [90, 55],
  medium: [75, 48],
  compact: [65, 42],
};

const SPACING_PRESETS = {
  tight: { gapX: 2, gapY: 2, margin: 5, footer: false },
  ultra_tight: { gapX: 1, gapY: 1, margin: 4, footer: false },
  touching: { gapX: 0, gapY: 0, margin: 4, footer: false },
  classic: { gapX: 12, gapY: 16, margin: 10, footer: true },
};

function clampNum(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function previewLayout(opts) {
  let [baseW, baseH] = PAPERS[opts.paper] || PAPERS.A3;
  if (opts.paper === 'CUSTOM') {
    baseW = clampNum(opts.page_w, 297, 100, 2000);
    baseH = clampNum(opts.page_h, 420, 100, 2000);
  }
  const minSide = Math.min(baseW, baseH);
  const maxSide = Math.max(baseW, baseH);

  let [cardW, cardH] = CARD_SIZES[opts.card_size] || CARD_SIZES.cr80;
  if (opts.card_size === 'custom') {
    cardW = clampNum(opts.card_w, 85.6, 35, 250);
    cardH = clampNum(opts.card_h, 54, 25, 200);
  }

  const sp = SPACING_PRESETS[opts.spacing] || SPACING_PRESETS.tight;
  const gapX = opts.spacing === 'custom' ? clampNum(opts.gap_x, 2, 0, 50) : sp.gapX;
  const gapY = opts.spacing === 'custom' ? clampNum(opts.gap_y, 2, 0, 50) : sp.gapY;
  const margin = opts.spacing === 'custom' ? clampNum(opts.margin, 5, 0, 50) : sp.margin;
  const footerReserve = opts.footer ? 12 : 0;

  const fitFor = (pw, ph, dirLabel) => {
    const availW = Math.max(cardW, pw - margin * 2);
    const availH = Math.max(cardH, ph - margin * 2 - footerReserve);
    const cols = Math.max(1, Math.floor((availW + gapX + 0.01) / (cardW + gapX)));
    const rows = Math.max(1, Math.floor((availH + gapY + 0.01) / (cardH + gapY)));
    return { pw, ph, cols, rows, total: cols * rows, dirLabel };
  };

  const portrait = fitFor(minSide, maxSide, 'طولي');
  const landscape = fitFor(maxSide, minSide, 'عرضي');
  if (opts.orientation === 'portrait') return { ...portrait, cardW, cardH, gapX, gapY, margin };
  if (opts.orientation === 'landscape') return { ...landscape, cardW, cardH, gapX, gapY, margin };
  const chosen = landscape.total > portrait.total ? landscape : portrait;
  return { ...chosen, cardW, cardH, gapX, gapY, margin };
}

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
      h('p', { class: 'muted', style: { margin: 0 } }, 'يمكنك الآن تصدير بطاقات هذه الدفعة للطباعة مع اختيار مقاس الورقة وترتيب البطاقات.')),
    actions: [
      h('button', { class: 'btn btn-primary', onclick: () => { m.close(); onDone?.(); exportCardsModal({ scope: 'batch', batch_id: r.batch_id }); } }, icon('download'), 'تصدير بطاقات الدفعة (PDF)'),
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

/** نافذة اختيار نطاق تصدير البطاقات وإعدادات الحجم والترتيب والطباعة */
export async function exportCardsModal(arg = null) {
  const presetScope = arg && typeof arg === 'object' && !('target' in arg) ? arg : null;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('fajr_print_prefs') || '{}') || {}; } catch { saved = {}; }

  let batches = [];
  try { batches = (await api.get('/admin/batches')).rows; } catch { /* */ }

  const hasFixedIds = presetScope?.scope === 'ids' && Array.isArray(presetScope.ids);

  const scopeSel = h('select', { class: 'input' },
    hasFixedIds ? h('option', { value: 'ids' }, `البطاقات المحددة (${presetScope.ids.length} بطاقة)`) : null,
    h('option', { value: 'all' }, 'جميع البطاقات'),
    h('option', { value: 'pending' }, 'الحسابات بانتظار التفعيل فقط'),
    h('option', { value: 'batch' }, 'دفعة محددة'));

  if (presetScope?.scope) scopeSel.value = presetScope.scope;

  const batchSel = h('select', { class: 'input' }, batches.map((b) => h('option', { value: b.id }, `الدفعة ${b.id} — ${b.count} بطاقة (${fmtDateTime(b.created_at)})`)));
  if (presetScope?.batch_id) batchSel.value = String(presetScope.batch_id);
  const batchField = field('الدفعة', batchSel);
  batchField.classList.toggle('hidden', scopeSel.value !== 'batch');

  const orderSel = h('select', { class: 'input' },
    h('option', { value: 'id_asc' }, 'حسب تسلسل الإنشاء (الأقدم أولاً)'),
    h('option', { value: 'id_desc' }, 'حسب تسلسل الإنشاء (الأحدث أولاً)'),
    h('option', { value: 'code_asc' }, 'أبجدياً حسب رمز المعرف (A → Z)'),
    h('option', { value: 'name_asc' }, 'أبجدياً حسب اسم المشارك'));
  if (saved.order) orderSel.value = saved.order;

  const paperSel = h('select', { class: 'input' },
    h('option', { value: 'A3' }, 'A3 — ورقة كبيرة (297 × 420 ملم)'),
    h('option', { value: 'SRA3' }, 'SRA3 — قياس المطابع الديجيتال (320 × 450 ملم)'),
    h('option', { value: 'A2' }, 'A2 — ورقة كبيرة جداً (420 × 594 ملم)'),
    h('option', { value: 'B2' }, 'فرخ مطبعة 50×70 سم (500 × 700 ملم)'),
    h('option', { value: 'B1' }, 'فرخ مطبعة كامل 70×100 سم (700 × 1000 ملم)'),
    h('option', { value: 'A4' }, 'A4 — ورقة عادية (210 × 297 ملم)'),
    h('option', { value: 'LETTER' }, 'Letter (216 × 279 ملم)'),
    h('option', { value: 'CUSTOM' }, 'مقاس ورقة مخصص (بالملم)'));
  paperSel.value = saved.paper || 'A3';

  const customPageW = h('input', { class: 'input ltr', type: 'number', min: 100, max: 2000, step: '1', value: saved.page_w || '320' });
  const customPageH = h('input', { class: 'input ltr', type: 'number', min: 100, max: 2000, step: '1', value: saved.page_h || '450' });
  const customPageBox = h('div', { class: 'grid2 hidden' },
    field('عرض الورقة (ملم)', customPageW),
    field('ارتفاع الورقة (ملم)', customPageH));

  const orientSel = h('select', { class: 'input' },
    h('option', { value: 'auto' }, 'تلقائي (الاتجاه الذي يتسع لأكبر عدد بطاقات)'),
    h('option', { value: 'portrait' }, 'طولي (عمودي)'),
    h('option', { value: 'landscape' }, 'عرضي (أفقي)'));
  orientSel.value = saved.orientation || 'auto';

  const cardSizeSel = h('select', { class: 'input' },
    h('option', { value: 'cr80' }, 'قياسي CR80 (85.6 × 54 ملم — حجم بطاقة الهوية)'),
    h('option', { value: 'biz' }, 'كرت شخصي (90 × 55 ملم)'),
    h('option', { value: 'medium' }, 'متوسط (75 × 48 ملم — يتسع لعدد أكبر بالورقة)'),
    h('option', { value: 'compact' }, 'مدمج (65 × 42 ملم — يتسع لضعف العدد)'),
    h('option', { value: 'custom' }, 'مقاس بطاقة مخصص (بالملم)'));
  cardSizeSel.value = saved.card_size || 'cr80';

  const customCardW = h('input', { class: 'input ltr', type: 'number', min: 35, max: 250, step: '0.5', value: saved.card_w || '85.6' });
  const customCardH = h('input', { class: 'input ltr', type: 'number', min: 25, max: 200, step: '0.5', value: saved.card_h || '54' });
  const customCardBox = h('div', { class: 'grid2 hidden' },
    field('عرض البطاقة (ملم)', customCardW),
    field('ارتفاع البطاقة (ملم)', customCardH));

  const spacingSel = h('select', { class: 'input' },
    h('option', { value: 'tight' }, 'ملء الورقة — هامش قص صغير جداً (2 ملم بين البطاقات)'),
    h('option', { value: 'ultra_tight' }, 'ملء الورقة — هامش قص دقيق (1 ملم بين البطاقات)'),
    h('option', { value: 'touching' }, 'ملء الورقة — متلاصق تماماً (0 ملم — خط قص مشترك)'),
    h('option', { value: 'classic' }, 'متباعد قياسي (12×16 ملم — 6 بطاقات في A4)'),
    h('option', { value: 'custom' }, 'تخصيص المسافة والهامش يدوياً (بالملم)'));
  spacingSel.value = saved.spacing || 'tight';

  const customGapX = h('input', { class: 'input ltr', type: 'number', min: 0, max: 50, step: '0.5', value: saved.gap_x ?? '2' });
  const customGapY = h('input', { class: 'input ltr', type: 'number', min: 0, max: 50, step: '0.5', value: saved.gap_y ?? '2' });
  const customMargin = h('input', { class: 'input ltr', type: 'number', min: 0, max: 50, step: '0.5', value: saved.margin ?? '5' });
  const customSpacingBox = h('div', { class: 'grid2 hidden' },
    field('المسافة بين البطاقات أفقياً (ملم)', customGapX),
    field('المسافة بين البطاقات عمودياً (ملم)', customGapY),
    field('هامش حواف الورقة (ملم)', customMargin));

  const cornersSel = h('select', { class: 'input' },
    h('option', { value: 'rounded' }, 'زوايا دائرية أنيقة'),
    h('option', { value: 'sharp' }, 'زوايا قائمة مستقيمة (أسهل للقص بالمقصلة/المشرط)'));
  cornersSel.value = saved.corners || 'rounded';

  const footerChk = h('input', { type: 'checkbox', checked: saved.footer ?? false });

  const summaryBox = h('div', {
    class: 'card card-flat',
    style: { background: 'var(--brand-50)', borderColor: 'var(--brand-100)', padding: '12px 14px' },
  });

  function currentLayoutOpts() {
    return {
      paper: paperSel.value,
      page_w: Number(customPageW.value) || 320,
      page_h: Number(customPageH.value) || 450,
      orientation: orientSel.value,
      card_size: cardSizeSel.value,
      card_w: Number(customCardW.value) || 85.6,
      card_h: Number(customCardH.value) || 54,
      spacing: spacingSel.value,
      gap_x: Number(customGapX.value) || 0,
      gap_y: Number(customGapY.value) || 0,
      margin: Number(customMargin.value) || 0,
      corners: cornersSel.value,
      footer: footerChk.checked,
    };
  }

  function updatePreview() {
    batchField.classList.toggle('hidden', scopeSel.value !== 'batch');
    customPageBox.classList.toggle('hidden', paperSel.value !== 'CUSTOM');
    customCardBox.classList.toggle('hidden', cardSizeSel.value !== 'custom');
    customSpacingBox.classList.toggle('hidden', spacingSel.value !== 'custom');

    const opts = currentLayoutOpts();
    const p = previewLayout(opts);
    summaryBox.replaceChildren(
      h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '8px' } },
        h('b', { style: { color: 'var(--brand-700)' } }, `التوزيع في الورقة: ${p.cols} أعمدة × ${p.rows} صفوف = ${p.total} بطاقة في كل ورقة`),
        h('span', { class: 'badge badge-ok num' }, `${Math.round(p.pw)}×${Math.round(p.ph)} ملم (${p.dirLabel})`)),
      h('div', { class: 'small muted', style: { marginTop: '4px' } },
        `حجم البطاقة: ${p.cardW}×${p.cardH} ملم · المسافة للقص بين البطاقات: ${p.gapX} ملم · هامش الورقة: ${p.margin} ملم مع علامات قص على الحواف.`));
  }

  for (const el of [scopeSel, paperSel, customPageW, customPageH, orientSel, cardSizeSel, customCardW, customCardH, spacingSel, customGapX, customGapY, customMargin, cornersSel, footerChk]) {
    el.addEventListener('change', updatePreview);
    el.addEventListener('input', updatePreview);
  }
  updatePreview();

  const m = openModal({
    title: 'إعدادات تصدير وطباعة البطاقات (PDF)',
    wide: true,
    body: h('div', { class: 'stack' },
      h('div', { class: 'grid2' },
        field('نطاق البطاقات', scopeSel),
        field('ترتيب تسلسل البطاقات', orderSel)),
      batchField,
      h('div', { class: 'grid2' },
        field('مقاس الورقة', paperSel),
        field('اتجاه الورقة', orientSel)),
      customPageBox,
      h('div', { class: 'grid2' },
        field('توزيع البطاقات وهامش القص', spacingSel),
        field('حجم البطاقة الواحدة', cardSizeSel)),
      customSpacingBox,
      customCardBox,
      h('div', { class: 'grid2' },
        field('شكل زوايا البطاقة', cornersSel),
        h('div', { class: 'field', style: { justifyContent: 'flex-end', paddingBottom: '8px' } },
          h('label', { class: 'switch' }, footerChk, h('span', null, 'إظهار شريط التذييل ومسطرة القياس أسفل الورقة')))),
      summaryBox,
      h('p', { class: 'hint', style: { margin: 0 } }, 'عند الطباعة: اختر الحجم الفعلي 100% (Actual Size) دون «ملاءمة الصفحة». توضع علامات قص تلقائية على أطراف الورقة بمحاذاة كل صف وعمود لتسهيل القص بالمسطرة أو مقصلة المطبعة.')),
    actions: [
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const layout = currentLayoutOpts();
        try {
          localStorage.setItem('fajr_print_prefs', JSON.stringify({ ...layout, order: orderSel.value }));
        } catch { /* */ }
        const body = { scope: scopeSel.value, order: orderSel.value, layout };
        if (scopeSel.value === 'batch') {
          if (!batchSel.value) { toast('لا توجد دفعات.', 'err'); return; }
          body.batch_id = Number(batchSel.value);
        } else if (scopeSel.value === 'ids' && hasFixedIds) {
          body.ids = presetScope.ids;
        }
        m.close();
        await exportCards(body);
      } }, icon('download'), 'تصدير ملف PDF للطباعة'),
      h('button', { class: 'btn', onclick: () => m.close() }, 'إلغاء'),
    ],
  });
}

export const pageHead = (title, ...actions) => h('div', { class: 'page-head' }, h('h1', null, title), h('div', { class: 'row' }, ...actions));
