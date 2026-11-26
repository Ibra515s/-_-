// ماسح QR يعمل داخل المتصفح بكاميرا الهاتف الخلفية.
// يستخدم BarcodeDetector الأصلي إن وُجد (أسرع)، وإلا مكتبة jsQR.

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

export function cameraErrorMessage(e) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'تشغيل الكاميرا يتطلب اتصالًا آمنًا (HTTPS).';
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError': return 'لم يُسمح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح ثم أعد المحاولة.';
    case 'NotFoundError': case 'OverconstrainedError': return 'لم يتم العثور على كاميرا في هذا الجهاز.';
    case 'NotReadableError': return 'الكاميرا مستخدمة من تطبيق آخر. أغلقه وأعد المحاولة.';
    default: return 'تعذّر تشغيل الكاميرا.';
  }
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
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.setAttribute('playsinline', '');
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
