const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const { FONT_DIR } = require('../config');
const { getSettings, getLogoBuffer } = require('../db');

const MM = 72 / 25.4;
const mm = (v) => v * MM;

// مقاس CR80 أفقيًا
const CARD_W = 85.6, CARD_H = 54;
const COLS = 2, ROWS = 3;
const GAP_X = 12, GAP_Y = 16;
const PAGE_W = 210, PAGE_H = 297;

const INK = '#1a2b26';
const MUTED = '#5b6b66';
const BRAND = '#0f6b4f';
const ARABIC_RE = /([؀-ۿ]+)/;

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
function drawText(doc, text, x, y, width, { size = 10, bold = false, color = INK, rtl = true, align = 'right', minSize = 6 } = {}) {
  let runs = splitRuns(text);
  let s = size;
  while (s > minSize && runWidth(doc, runs, s, bold) > width) s -= 0.25;
  const total = runWidth(doc, runs, s, bold);
  let cursor;
  if (align === 'center') cursor = rtl ? x + width / 2 + total / 2 : x + width / 2 - total / 2;
  else if (align === 'right') cursor = rtl ? x + width : x + width - total;
  else cursor = rtl ? x + total : x;
  doc.fillColor(color);
  const ordered = rtl ? runs : runs;
  for (const r of ordered) {
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
        // نمدّ المستطيل قليلًا لتفادي فواصل شعرية بين المربعات في بعض العارضات
        doc.rect(x + (quiet + c) * unit, y + (quiet + r) * unit, (end - c + 1) * unit + 0.02, unit + 0.02).fill();
        c = end + 1;
      } else c++;
    }
  }
}

function drawCropMarks(doc, x, y, w, h) {
  const off = mm(1.8), len = mm(3.5);
  doc.lineWidth(0.25).strokeColor('#000000');
  const corners = [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]];
  for (const [cx, cy, sx, sy] of corners) {
    doc.moveTo(cx + sx * off, cy).lineTo(cx + sx * (off + len), cy).stroke();
    doc.moveTo(cx, cy + sy * off).lineTo(cx, cy + sy * (off + len)).stroke();
  }
}

function drawCard(doc, publicId, ox, oy, ctx) {
  const W = mm(CARD_W), H = mm(CARD_H);
  const pad = mm(4);

  doc.save();
  doc.roundedRect(ox, oy, W, H, mm(3)).lineWidth(0.5).fillAndStroke('#ffffff', '#c9d3cf');
  // شريط علوي رفيع بلون الحملة
  doc.save().roundedRect(ox, oy, W, H, mm(3)).clip();
  doc.rect(ox, oy, W, mm(1.6)).fill(BRAND);
  doc.restore();

  // QR على اليسار
  const qrSize = mm(33);
  const qrX = ox + pad - mm(1);
  const qrY = oy + (H - qrSize) / 2 + mm(0.8);
  drawQr(doc, ctx.qrTextFor ? ctx.qrTextFor(publicId) : publicId, qrX, qrY, qrSize);

  // المنطقة اليمنى
  const rx0 = qrX + qrSize + mm(1.5);
  const rx1 = ox + W - pad;
  const rw = rx1 - rx0;

  let textRight = rx1;
  if (ctx.logo) {
    const ls = mm(9);
    try { doc.image(ctx.logo, rx1 - ls, oy + mm(4.2), { fit: [ls, ls], align: 'center', valign: 'center' }); } catch { /* شعار تالف */ }
    textRight = rx1 - ls - mm(1.5);
  }
  const tw = textRight - rx0;
  drawText(doc, ctx.mosque, rx0, oy + mm(5.0), tw, { size: 10.5, bold: true, color: BRAND, rtl: true, align: 'right', minSize: 6.5 });
  drawText(doc, ctx.campaign, rx0, oy + mm(9.6), tw, { size: 7.5, color: MUTED, rtl: true, align: 'right', minSize: 5.5 });

  // المعرّف بخط كبير
  drawText(doc, 'معرف الحساب', rx0, oy + mm(17.2), rw, { size: 6.5, color: MUTED, rtl: true, align: 'center' });
  drawText(doc, publicId, rx0, oy + mm(20.2), rw, { size: 19, bold: true, color: INK, rtl: false, align: 'center', minSize: 12 });

  // مساحة الاسم (فارغة للكتابة اليدوية)
  const lineY = oy + H - mm(8.5);
  const label = 'الاسم:';
  const lw = runWidth(doc, splitRuns(label), 8, true);
  drawText(doc, label, rx0, lineY - mm(3.6), rw, { size: 8, bold: true, color: INK, rtl: true, align: 'right' });
  doc.lineWidth(0.6).strokeColor('#8a9893').moveTo(rx0, lineY).lineTo(rx1 - lw - mm(1.5), lineY).stroke();
  doc.restore();
}

function drawFooter(doc, pageNo, pages) {
  const y = mm(PAGE_H - 12);
  doc.save();
  drawText(doc, 'اطبع بالحجم الفعلي 100% (بدون ملاءمة الصفحة) — صفحة ' + pageNo + ' من ' + pages, mm(15), y, mm(PAGE_W - 30), { size: 7.5, color: MUTED, rtl: true, align: 'right' });
  // مسطرة للتحقق من مقياس الطباعة: يجب أن يقيس هذا الخط 100 ملم
  const x0 = mm(15), len = mm(100);
  doc.lineWidth(0.5).strokeColor('#000000').moveTo(x0, y + 4).lineTo(x0 + len, y + 4).stroke();
  doc.moveTo(x0, y).lineTo(x0, y + 8).stroke().moveTo(x0 + len, y).lineTo(x0 + len, y + 8).stroke();
  doc.restore();
}

/**
 * يولّد PDF للبطاقات ويكتبه إلى stream. ست بطاقات في كل صفحة A4 (عمودان × ثلاثة صفوف).
 * @param {string[]} publicIds
 */
function renderCardsPdf(publicIds, stream, qrTextFor = (id) => id) {
  const s = getSettings();
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0, info: { Title: 'بطاقات المشاركين', Producer: 'Fajr Campaign' } });
  doc.pipe(stream);
  registerFonts(doc);
  let logo = null;
  try { const buf = getLogoBuffer(); if (buf) logo = doc.openImage(buf); } catch { logo = null; } // يُضمَّن الشعار مرة واحدة فقط

  const perPage = COLS * ROWS;
  const pages = Math.max(1, Math.ceil(publicIds.length / perPage));
  const gridW = COLS * CARD_W + (COLS - 1) * GAP_X;
  const gridH = ROWS * CARD_H + (ROWS - 1) * GAP_Y;
  const x0 = (PAGE_W - gridW) / 2;
  const y0 = (PAGE_H - gridH) / 2 - 4;
  const ctx = { logo, mosque: s.mosque_name, campaign: s.campaign_name, qrTextFor };

  for (let i = 0; i < publicIds.length; i++) {
    const slot = i % perPage;
    if (slot === 0) doc.addPage({ size: 'A4', margin: 0 });
    const col = slot % COLS, row = Math.floor(slot / COLS);
    // اتجاه RTL: العمود الأول في اليمين
    const cx = mm(x0 + (COLS - 1 - col) * (CARD_W + GAP_X));
    const cy = mm(y0 + row * (CARD_H + GAP_Y));
    drawCard(doc, publicIds[i], cx, cy, ctx);
    drawCropMarks(doc, cx, cy, mm(CARD_W), mm(CARD_H));
    if (slot === perPage - 1 || i === publicIds.length - 1) drawFooter(doc, Math.floor(i / perPage) + 1, pages);
  }
  if (publicIds.length === 0) { doc.addPage({ size: 'A4', margin: 0 }); }
  doc.end();
  return pages;
}

module.exports = { renderCardsPdf, CARD_W, CARD_H };
