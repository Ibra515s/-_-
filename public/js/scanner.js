// ماسح QR يعمل داخل المتصفح بكاميرا الهاتف الخلفية.
// يستخدم BarcodeDetector الأصلي إن وُجد (أسرع)، وإلا مكتبة jsQR.
import { h, icon } from './dom.js';

let jsQRPromise;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsQRPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/jsQR.js';
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => reject(new Error('تعذّر تحميل مكتبة قراءة QR.'));
    document.head.append(s);
  });
  return jsQRPromise;
}

export function inAppBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Snapchat|MicroMessenger|Line\/|TikTok|musical_ly|Twitter|WhatsApp|; wv\)/i.test(ua);
}

export function cameraErrorMessage(e) {
  const code = e?.name ? ` [${e.name}]` : '';
  if (inAppBrowser()) return 'الموقع مفتوح من داخل تطبيق آخر (متصفح مدمج) وهو يمنع الكاميرا. انسخ الرابط وافتحه في Chrome أو Safari، أو استخدم زر «التقاط صورة للرمز».' + code;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'تشغيل الكاميرا يتطلب اتصالًا آمنًا (HTTPS) ومتصفحًا حديثًا. يمكنك استخدام «التقاط صورة للرمز».' + code;
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError':
      return 'تم رفض إذن الكاميرا لهذا الموقع. اضغط على أيقونة القفل/الإعدادات بجوار عنوان الموقع ← الكاميرا ← سماح، ثم أعد تحميل الصفحة. (آيفون: الإعدادات ← Safari ← الكاميرا ← سماح). أو استخدم «التقاط صورة للرمز».' + code;
    case 'NotFoundError': case 'OverconstrainedError': return 'لم يتم العثور على كاميرا في هذا الجهاز. يمكنك استخدام «التقاط صورة للرمز».' + code;
    case 'NotReadableError': return 'الكاميرا مستخدمة من تطبيق آخر. أغلقه وأعد المحاولة.' + code;
    default: return 'تعذّر تشغيل الكاميرا. يمكنك استخدام «التقاط صورة للرمز».' + code;
  }
}

/** يقرأ QR من صورة (التقاط بكاميرا الجهاز الأصلية) — لا يحتاج إذن كاميرا للموقع */
export async function decodeImageFile(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch {
    bmp = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file); });
  }
  const W = bmp.width || bmp.naturalWidth, H = bmp.height || bmp.naturalHeight;
  if ('BarcodeDetector' in window) {
    try {
      const fmts = await window.BarcodeDetector.getSupportedFormats();
      if (fmts.includes('qr_code')) {
        const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bmp);
        if (found.length) return found[0].rawValue;
      }
    } catch { /* نكمل بـ jsQR */ }
  }
  await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const max of [1280, 800, 1920, 500]) {
    const scale = Math.min(1, max / Math.max(W, H));
    const w = Math.max(1, Math.round(W * scale)), hh = Math.max(1, Math.round(H * scale));
    canvas.width = w; canvas.height = hh;
    ctx.drawImage(bmp, 0, 0, w, hh);
    const res = window.jsQR(ctx.getImageData(0, 0, w, hh).data, w, hh, { inversionAttempts: 'attemptBoth' });
    if (res?.data) return res.data;
  }
  return '';
}

/** زر «التقاط صورة للرمز»: يفتح كاميرا الجهاز الأصلية ثم يقرأ الرمز من الصورة */
export function photoButton(onCode, onError, label = 'التقاط صورة للرمز') {
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const code = await decodeImageFile(f);
      if (code) onCode(code); else onError('تعذّرت قراءة الرمز من الصورة. قرّب الكاميرا من الرمز وتأكد من وضوحه ثم أعد المحاولة.');
    } catch { onError('تعذّرت معالجة الصورة. أعد المحاولة.'); }
  });
  return h('label', { class: 'btn btn-block', style: { cursor: 'pointer' } }, icon('camera'), label, input);
}

export class QrScanner {
  /**
   * @param {HTMLVideoElement} video
   * @param {(code:string)=>void} onCode  يُستدعى عند قراءة رمز (مع تجاهل تكرار الرمز نفسه خلال cooldownMs)
   */
  constructor(video, onCode, { cooldownMs = 3000, onTorchSupport } = {}) {
    this.video = video;
    this.onCode = onCode;
    this.cooldownMs = cooldownMs;
    this.onTorchSupport = onTorchSupport;
    this.stream = null;
    this.running = false;
    this.paused = false;
    this.last = { code: '', at: 0 };
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = null;
    this.torchOn = false;
  }

  get active() { return this.running; }

  async start() {
    if (this.running) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'SecurityError' });
    const tries = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr;
    for (const c of tries) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (e) {
        lastErr = e;
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw e;
      }
    }
    if (!this.stream) throw lastErr || new Error('camera_failed');
    this.video.setAttribute('autoplay', '');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;

    if ('BarcodeDetector' in window) {
      try {
        const fmts = await window.BarcodeDetector.getSupportedFormats();
        if (fmts.includes('qr_code')) this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch { /* نستخدم jsQR */ }
    }
    if (!this.detector) await loadJsQR();

    const track = this.stream.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() || {};
    this.onTorchSupport?.(!!caps.torch);
    this._loop();
  }

  stop() {
    this.running = false;
    this.torchOn = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async toggleTorch() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;
    this.torchOn = !this.torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: this.torchOn }] }); }
    catch { this.torchOn = false; }
    return this.torchOn;
  }

  _emit(raw) {
    const code = String(raw || '').trim();
    if (!code) return;
    const now = Date.now();
    if (code === this.last.code && now - this.last.at < this.cooldownMs) { this.last.at = now; return; }
    this.last = { code, at: now };
    this.onCode(code);
  }

  async _scanOnce() {
    const v = this.video;
    if (!v.videoWidth) return;
    if (this.detector) {
      const found = await this.detector.detect(v);
      if (found.length) this._emit(found[0].rawValue);
      return;
    }
    const max = 640;
    const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale), hgt = Math.round(v.videoHeight * scale);
    this.canvas.width = w; this.canvas.height = hgt;
    this.ctx.drawImage(v, 0, 0, w, hgt);
    const img = this.ctx.getImageData(0, 0, w, hgt);
    const res = window.jsQR(img.data, w, hgt, { inversionAttempts: 'dontInvert' });
    if (res?.data) this._emit(res.data);
  }

  async _loop() {
    while (this.running) {
      if (!this.paused && document.visibilityState === 'visible') {
        try { await this._scanOnce(); } catch { /* إطار تالف */ }
      }
      await new Promise((r) => setTimeout(r, 110));
    }
  }
}
