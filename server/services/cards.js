const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const { FONT_DIR } = require('../config');
const { getSettings, getLogoBuffer } = require('../db');

const MM = 72 / 25.4;
const mm = (v) => v * MM;

// المقاس الافتراضي للبطاقة (CR80 أفقياً)
const CARD_W = 85.6, CARD_H = 54;

const PAPERS = {
  A4: [210, 297],
  A3: [297, 420],
  SRA3: [320, 450],
  A2: [420, 594],
  B2: [500, 700],
  B1: [700, 1000],
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

const INK = '#1a2b26';
const MUTED = '#5b6b66';
const BRAND = '#0f6b4f';
const ARABIC_RE = /([؀-ۿ]+)/;

function clampNum(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveLayout(opts = {}) {
  const isDefaultClassic = !opts || (!opts.paper && !opts.spacing && !opts.card_size && !opts.orientation);
  if (isDefaultClassic) {
    return {
      pageW: 210, pageH: 297, cardW: CARD_W, cardH: CARD_H,
      cols: 2, rows: 3, gapX: 12, gapY: 16, margin: 10,
      footer: true, corners: 'rounded',
    };
  }

  let [baseW, baseH] = PAPERS[opts.paper] || PAPERS.A4;
  if (opts.paper === 'CUSTOM') {
    baseW = clampNum(opts.page_w, 297, 100, 2000);
    baseH = clampNum(opts.page_h, 420, 100, 2000);
  }
  const minSide = Math.min(baseW, baseH);
  const maxSide = Math.max(baseW, baseH);

  let [cardW, cardH] = CARD_SIZES[opts.card_size] || CARD_SIZES.cr80;
  if (opts.card_size === 'custom') {
    cardW = clampNum(opts.card_w, CARD_W, 35, 250);
    cardH = clampNum(opts.card_h, CARD_H, 25, 200);
  }

  const sp = SPACING_PRESETS[opts.spacing] || SPACING_PRESETS.tight;
  const gapX = opts.spacing === 'custom' ? clampNum(opts.gap_x, 2, 0, 50) : sp.gapX;
  const gapY = opts.spacing === 'custom' ? clampNum(opts.gap_y, 2, 0, 50) : sp.gapY;
  const margin = opts.spacing === 'custom' ? clampNum(opts.margin, 5, 0, 50) : sp.margin;
  const footer = opts.footer !== undefined ? !!opts.footer : sp.footer;
  const corners = opts.corners === 'sharp' ? 'sharp' : 'rounded';
  const footerReserve = footer ? 12 : 0;

  const fitFor = (pw, ph) => {
    const availW = Math.max(cardW, pw - margin * 2);
    const availH = Math.max(cardH, ph - margin * 2 - footerReserve);
    const cols = Math.max(1, Math.floor((availW + gapX + 0.01) / (cardW + gapX)));
    const rows = Math.max(1, Math.floor((availH + gapY + 0.01) / (cardH + gapY)));
    return { pw, ph, cols, rows, total: cols * rows };
  };

  const portrait = fitFor(minSide, maxSide);
  const landscape = fitFor(maxSide, minSide);
  let chosen;
  if (opts.orientation === 'portrait') chosen = portrait;
  else if (opts.orientation === 'landscape') chosen = landscape;
  else chosen = landscape.total > portrait.total ? landscape : portrait;

  return {
    pageW: chosen.pw, pageH: chosen.ph,
    cardW, cardH,
    cols: chosen.cols, rows: chosen.rows,
    gapX, gapY, margin, footer, corners,
  };
}

function registerFonts(doc) {
  doc.registerFont('ar', path.join(FONT_DIR, 'tajawal-arabic-400-normal.woff'));
  doc.registerFont('ar-b', path.join(FONT_DIR, 'tajawal-arabic-700-normal.woff'));
  doc.registerFont('la', path.join(FONT_DIR, 'tajawal-latin-400-normal.woff'));
  doc.registerFont('la-b', path.join(FONT_DIR, 'tajawal-latin-700-normal.woff'));
}

/** يقسّم النص إلى كلمات عربية (خط عربي) وما عداها من مسافات وأرقام وحروف لاتينية (خط لاتيني) بترتيبها المنطقي */
function splitRuns(text) {
  return String(text).split(ARABIC_RE).filter((s) => s !== '').map((s) => ({ text: s, arabic: /[؀-ۿ]/.test(s) }));
}

function runWidth(doc, runs, size, bold) {
  let w = 0;
  for (const r of runs) w += doc.font((r.arabic ? 'ar' : 'la') + (bold ? '-b' : '')).fontSize(size).widthOfString(r.text);
  return w;
}

/**
 * يرسم نصًا مختلط الاتجاه. اتجاه الفقرة الأساسي RTL (المقطع الأول منطقيًا في أقصى اليمين)
 * أو LTR حسب opts.rtl. المحاذاة: right | left | center داخل المربع [x, x+width].
 */
function drawText(doc, text, x, y, width, { size = 10, bold = false, color = INK, rtl = true, align = 'right', minSize = 5 } = {}) {
  const runs = splitRuns(text);
  let s = size;
  while (s > minSize && runWidth(doc, runs, s, bold) > width) s -= 0.25;
  const total = runWidth(doc, runs, s, bold);
  let cursor;
  if (align === 'center') cursor = rtl ? x + width / 2 + total / 2 : x + width / 2 - total / 2;
  else if (align === 'right') cursor = rtl ? x + width : x + width - total;
  else cursor = rtl ? x + total : x;
  doc.fillColor(color);
  for (const r of runs) {
    const f = (r.arabic ? 'ar' : 'la') + (bold ? '-b' : '');
    doc.font(f).fontSize(s);
    const w = doc.widthOfString(r.text);
    if (rtl) { cursor -= w; doc.text(r.text, cursor, y, { lineBreak: false }); }
    else { doc.text(r.text, cursor, y, { lineBreak: false }); cursor += w; }
  }
  return s;
}

/** يرسم رمز QR كمربعات متجهة (حادة عند أي دقة طباعة) */
function drawQr(doc, text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 4;
  const unit = size / (n + quiet * 2);
  doc.fillColor('#000000');
  const data = qr.modules.data;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (data[r * n + c]) {
        let end = c;
        while (end + 1 < n && data[r * n + end + 1]) end++;
        doc.rect(x + (quiet + c) * unit, y + (quiet + r) * unit, (end - c + 1) * unit + 0.02, unit + 0.02).fill();
        c = end + 1;
      } else c++;
    }
  }
}

/** علامات قص ذكية: لا تتداخل مع البطاقات المجاورة عندما يكون الهامش صغيراً */
function drawCropMarks(doc, x, y, w, h, layout) {
  if (layout.gapX >= 8 && layout.gapY >= 8) {
    const off = mm(1.8), len = mm(3.5);
    doc.lineWidth(0.25).strokeColor('#000000');
    const corners = [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]];
    for (const [cx, cy, sx, sy] of corners) {
      doc.moveTo(cx + sx * off, cy).lineTo(cx + sx * (off + len), cy).stroke();
      doc.moveTo(cx, cy + sy * off).lineTo(cx, cy + sy * (off + len)).stroke();
    }
    return;
  }
  // في الهوامش الصغيرة: علامات زاوية دقيقة داخل حدود البطاقة/الفجوة دون المساس بالبطاقة المجاورة
  const len = mm(2.2);
  doc.save().lineWidth(0.3).strokeColor('#555555');
  const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
  for (const [cx, cy, sx, sy] of corners) {
    doc.moveTo(cx, cy).lineTo(cx + sx * len, cy).stroke();
    doc.moveTo(cx, cy).lineTo(cx, cy + sy * len).stroke();
  }
  doc.restore();
}

/** علامات قص خارجية حول أطراف الشبكة في هامش الورقة لتسهيل القص بالمسطرة أو مقصلة المطبعة */
function drawSheetGridMarks(doc, x0Mm, y0Mm, layout) {
  const { cols, rows, cardW, cardH, gapX, gapY, margin } = layout;
  if (margin < 2) return;
  const gridW = cols * cardW + (cols - 1) * gapX;
  const gridH = rows * cardH + (rows - 1) * gapY;
  const tickLen = mm(Math.min(3.5, Math.max(1.5, margin - 1)));
  const off = mm(0.8);
  doc.save().lineWidth(0.35).strokeColor('#000000');

  // خطوط القص العمودية (أعلى وأسفل الشبكة)
  const xCuts = new Set();
  for (let c = 0; c < cols; c++) {
    const left = x0Mm + c * (cardW + gapX);
    const right = left + cardW;
    xCuts.add(left.toFixed(2));
    xCuts.add(right.toFixed(2));
  }
  const topY = mm(y0Mm);
  const botY = mm(y0Mm + gridH);
  for (const xs of xCuts) {
    const x = mm(Number(xs));
    doc.moveTo(x, topY - off).lineTo(x, topY - off - tickLen).stroke();
    doc.moveTo(x, botY + off).lineTo(x, botY + off + tickLen).stroke();
  }

  // خطوط القص الأفقية (يمين ويسار الشبكة)
  const yCuts = new Set();
  for (let r = 0; r < rows; r++) {
    const top = y0Mm + r * (cardH + gapY);
    const bot = top + cardH;
    yCuts.add(top.toFixed(2));
    yCuts.add(bot.toFixed(2));
  }
  const leftX = mm(x0Mm);
  const rightX = mm(x0Mm + gridW);
  for (const ys of yCuts) {
    const y = mm(Number(ys));
    doc.moveTo(leftX - off, y).lineTo(leftX - off - tickLen, y).stroke();
    doc.moveTo(rightX + off, y).lineTo(rightX + off + tickLen, y).stroke();
  }
  doc.restore();
}

function drawCard(doc, publicId, ox, oy, ctx, layout) {
  const cardW = layout?.cardW || CARD_W;
  const cardH = layout?.cardH || CARD_H;
  const k = Math.min(cardW / CARD_W, cardH / CARD_H);
  const W = mm(cardW), H = mm(cardH);
  const pad = mm(4 * k);
  const radius = layout?.corners === 'sharp' ? 0 : mm(3 * k);

  doc.save();
  if (radius > 0) {
    doc.roundedRect(ox, oy, W, H, radius).lineWidth(0.5).fillAndStroke('#ffffff', '#c9d3cf');
    doc.save().roundedRect(ox, oy, W, H, radius).clip();
  } else {
    doc.rect(ox, oy, W, H).lineWidth(0.4).fillAndStroke('#ffffff', '#c0ccc7');
    doc.save().rect(ox, oy, W, H).clip();
  }
  // شريط علوي رفيع بلون الحملة
  doc.rect(ox, oy, W, mm(1.6 * k)).fill(BRAND);
  doc.restore();

  // QR على اليسار (مربع دائماً)
  const qrSize = mm(33 * k);
  const qrX = ox + pad - mm(1 * k);
  const qrY = oy + (H - qrSize) / 2 + mm(0.8 * k);
  drawQr(doc, ctx.qrTextFor ? ctx.qrTextFor(publicId) : publicId, qrX, qrY, qrSize);

  // المنطقة اليمنى
  const rx0 = qrX + qrSize + mm(1.5 * k);
  const rx1 = ox + W - pad;
  const rw = Math.max(mm(10), rx1 - rx0);

  let textRight = rx1;
  if (ctx.logo) {
    const ls = mm(9 * k);
    try { doc.image(ctx.logo, rx1 - ls, oy + mm(4.2 * k), { fit: [ls, ls], align: 'center', valign: 'center' }); } catch { /* شعار تالف */ }
    textRight = rx1 - ls - mm(1.5 * k);
  }
  const tw = Math.max(mm(8), textRight - rx0);
  drawText(doc, ctx.mosque, rx0, oy + mm(5.0 * k), tw, { size: 10.5 * k, bold: true, color: BRAND, rtl: true, align: 'right', minSize: 5 * k });
  drawText(doc, ctx.campaign, rx0, oy + mm(9.6 * k), tw, { size: 7.5 * k, color: MUTED, rtl: true, align: 'right', minSize: 4.5 * k });

  // المعرّف بخط كبير
  drawText(doc, 'معرف الحساب', rx0, oy + mm(17.2 * k), rw, { size: 6.5 * k, color: MUTED, rtl: true, align: 'center', minSize: 4.5 * k });
  drawText(doc, publicId, rx0, oy + mm(20.2 * k), rw, { size: 19 * k, bold: true, color: INK, rtl: false, align: 'center', minSize: 9 * k });

  // مساحة الاسم (فارغة للكتابة اليدوية)
  const lineY = oy + H - mm(8.5 * k);
  const label = 'الاسم:';
  const lw = runWidth(doc, splitRuns(label), 8 * k, true);
  drawText(doc, label, rx0, lineY - mm(3.6 * k), rw, { size: 8 * k, bold: true, color: INK, rtl: true, align: 'right', minSize: 5 * k });
  doc.lineWidth(0.6 * k).strokeColor('#8a9893').moveTo(rx0, lineY).lineTo(Math.max(rx0 + mm(5), rx1 - lw - mm(1.5 * k)), lineY).stroke();
  doc.restore();
}

function drawFooter(doc, pageNo, pages, layout) {
  const pageW = layout.pageW, pageH = layout.pageH;
  const y = mm(pageH - 10);
  doc.save();
  drawText(doc, 'اطبع بالحجم الفعلي 100% (بدون ملاءمة الصفحة) — صفحة ' + pageNo + ' من ' + pages, mm(12), y, mm(pageW - 24), { size: 7.5, color: MUTED, rtl: true, align: 'right' });
  const x0 = mm(12), len = mm(Math.min(100, pageW - 90));
  if (len >= mm(40)) {
    doc.lineWidth(0.5).strokeColor('#000000').moveTo(x0, y + 4).lineTo(x0 + len, y + 4).stroke();
    doc.moveTo(x0, y).lineTo(x0, y + 8).stroke().moveTo(x0 + len, y).lineTo(x0 + len, y + 8).stroke();
  }
  doc.restore();
}

/**
 * يولّد PDF للبطاقات ويكتبه إلى stream مع دعم خيارات مقاس الورقة وحجم البطاقة والهوامش.
 * @param {string[]} publicIds
 */
function renderCardsPdf(publicIds, stream, qrTextFor = (id) => id, opts = {}) {
  const s = getSettings();
  const layout = resolveLayout(opts);
  const { pageW, pageH, cardW, cardH, cols, rows, gapX, gapY, footer } = layout;
  const pageSizePt = [mm(pageW), mm(pageH)];

  const doc = new PDFDocument({ autoFirstPage: false, size: pageSizePt, margin: 0, info: { Title: 'بطاقات المشاركين', Producer: 'Fajr Campaign' } });
  doc.pipe(stream);
  registerFonts(doc);
  let logo = null;
  try { const buf = getLogoBuffer(); if (buf) logo = doc.openImage(buf); } catch { logo = null; }

  const perPage = cols * rows;
  const pages = Math.max(1, Math.ceil(publicIds.length / perPage));
  const gridW = cols * cardW + (cols - 1) * gapX;
  const gridH = rows * cardH + (rows - 1) * gapY;
  const x0 = (pageW - gridW) / 2;
  const y0 = footer ? Math.max(layout.margin, (pageH - 10 - gridH) / 2) : (pageH - gridH) / 2;
  const ctx = { logo, mosque: s.mosque_name, campaign: s.campaign_name, qrTextFor };

  for (let i = 0; i < publicIds.length; i++) {
    const slot = i % perPage;
    if (slot === 0) {
      doc.addPage({ size: pageSizePt, margin: 0 });
      drawSheetGridMarks(doc, x0, y0, layout);
    }
    const col = slot % cols, row = Math.floor(slot / cols);
    // اتجاه RTL: العمود الأول في اليمين
    const cx = mm(x0 + (cols - 1 - col) * (cardW + gapX));
    const cy = mm(y0 + row * (cardH + gapY));
    drawCard(doc, publicIds[i], cx, cy, ctx, layout);
    if (gapX >= 8 && gapY >= 8) drawCropMarks(doc, cx, cy, mm(cardW), mm(cardH), layout);
    if (footer && (slot === perPage - 1 || i === publicIds.length - 1)) {
      drawFooter(doc, Math.floor(i / perPage) + 1, pages, layout);
    }
  }
  if (publicIds.length === 0) { doc.addPage({ size: pageSizePt, margin: 0 }); }
  doc.end();
  return pages;
}

module.exports = { renderCardsPdf, resolveLayout, CARD_W, CARD_H };
