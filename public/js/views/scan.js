import { h, icon, beep, fmtTime } from '../dom.js';
import * as api from '../api.js';
import { QrScanner, cameraErrorMessage } from '../scanner.js';

const num = (n) => new Intl.NumberFormat('en-US').format(n);

export default async function view({ state }) {
  const me = state.me.user;
  let sound = localStorage.getItem('scanSound') !== '0';
  let queue = Promise.resolve();
  let scanner = null;
  let wakeLock = null;
  let resumeTimer = null;
  let pollTimer = null;
  let torchSupported = false;

  // ---------- الإحصاءات ----------
  const vPresent = h('div', { class: 'v num' }, '—');
  const vExpected = h('div', { class: 'v num' }, '—');
  const vMine = h('div', { class: 'v num' }, '—');
  const recentList = h('ul', { class: 'recent' });
  const recentBox = h('section', { class: 'card card-flat', style: { marginTop: '14px' } }, h('h3', { style: { marginBottom: '6px' } }, 'آخر عمليات التسجيل التي نفّذتها'), recentList);

  async function refreshLive() {
    try {
      const d = await api.get('/scan/live');
      vPresent.textContent = num(d.present);
      vExpected.textContent = num(d.expected);
      vMine.textContent = num(d.mine);
      recentList.replaceChildren(...(d.recent.length
        ? d.recent.map((r) => h('li', null, h('span', null, r.name || r.public_id, ' ', h('span', { class: 'muted small ltr' }, r.public_id)), h('span', { class: 'muted num' }, fmtTime(r.attended_at))))
        : [h('li', { class: 'muted' }, 'لا توجد عمليات بعد.')]));
    } catch { /* سيُعاد في الدورة التالية */ }
  }

  // ---------- الكاميرا ----------
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const torchBtn = h('button', { class: 'btn btn-sm hidden', onclick: async () => { const on = await scanner?.toggleTorch(); torchBtn.setAttribute('aria-pressed', String(!!on)); torchBtn.style.background = on ? 'rgba(255,200,60,.75)' : ''; }, 'aria-label': 'المصباح' }, icon('flash'), ' المصباح');
  const toggleBtn = h('button', { class: 'btn btn-sm', onclick: () => (scanner?.active ? stopCamera() : startCamera()) }, icon('stop'), ' إيقاف');
  const soundBtn = h('button', { class: 'btn btn-sm', 'aria-label': 'الصوت', onclick: () => {
    sound = !sound; localStorage.setItem('scanSound', sound ? '1' : '0'); drawSound(); if (sound) beep('ok');
  } });
  function drawSound() { soundBtn.replaceChildren(icon(sound ? 'volume' : 'mute'), sound ? ' الصوت' : ' صامت'); }
  drawSound();

  const offPanel = h('div', { class: 'off hidden' }, h('div', { class: 'msg' }, 'الكاميرا متوقفة'), h('button', { class: 'btn btn-primary', onclick: () => startCamera() }, icon('camera'), 'تشغيل الكاميرا'));
  const cam = h('div', { class: 'cam' }, video, h('div', { class: 'frame' }), offPanel, h('div', { class: 'tools' }, h('div', { class: 'row', style: { gap: '6px' } }, toggleBtn, torchBtn), soundBtn));

  function setCamState(cls) { cam.classList.remove('ok', 'dup', 'err'); if (cls) cam.classList.add(cls); }

  async function startCamera() {
    offPanel.classList.add('hidden');
    try {
      if (!scanner) {
        scanner = new QrScanner(video, (code) => handle(code, 'qr'), { onTorchSupport: (s) => { torchSupported = s; torchBtn.classList.toggle('hidden', !s); } });
      }
      await scanner.start();
      toggleBtn.replaceChildren(icon('stop'), ' إيقاف');
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* غير مدعوم */ }
    } catch (e) {
      scanner = null;
      offPanel.querySelector('.msg').textContent = cameraErrorMessage(e);
      offPanel.classList.remove('hidden');
    }
  }
  function stopCamera() {
    scanner?.stop();
    toggleBtn.replaceChildren(icon('camera'), ' تشغيل');
    offPanel.querySelector('.msg').textContent = 'الكاميرا متوقفة';
    offPanel.classList.remove('hidden');
    try { wakeLock?.release(); } catch { /* */ }
  }

  // ---------- نتيجة المسح ----------
  const result = h('div', { class: 'result idle', role: 'status', 'aria-live': 'assertive' }, 'جاهز للمسح — وجّه الكاميرا نحو البطاقة');
  function showResult(r) {
    const map = {
      ok: ['ok', 'check', 'تم تسجيل الحضور'],
      duplicate: ['dup', 'alert', 'الحضور مسجّل مسبقًا'],
      cancelled: ['dup', 'alert', 'حضور ملغى من المشرف'],
      pending: ['err', 'x', 'الحساب غير مفعّل'],
      suspended: ['err', 'x', 'الحساب موقوف'],
      replaced: ['err', 'x', 'بطاقة مستبدلة'],
      invalid: ['err', 'x', 'رمز غير صحيح'],
      network: ['err', 'x', 'تعذّر الاتصال — لم يُسجَّل الحضور'],
    };
    const [cls, ic, title] = map[r.status] || map.invalid;
    result.className = `result ${cls}`;
    const lines = [];
    if (r.name || r.public_id) lines.push(h('div', null, r.name || '', ' ', r.public_id ? h('span', { class: 'ltr', style: { display: 'inline-block' } }, r.public_id) : null));
    if (r.status === 'ok' && r.points) lines.push(h('div', { class: 'small' }, `+${r.points} نقاط`));
    if (r.status === 'duplicate') lines.push(h('div', { class: 'small' }, `سُجّل الساعة ${fmtTime(r.attended_at)}${r.by ? ` بواسطة ${r.by}` : ''}`));
    if (!['ok', 'duplicate'].includes(r.status) && r.message) lines.push(h('div', { class: 'small' }, r.message));
    result.replaceChildren(h('div', { class: 'ic' }, icon(ic)), h('div', null, h('div', { class: 'big' }, title), ...lines));
    setCamState(cls);
    if (sound) beep(cls);
    try { navigator.vibrate?.(cls === 'ok' ? 60 : [80, 60, 80]); } catch { /* */ }
  }

  // معالجة متسلسلة: لا يتداخل طلبان من الجهاز نفسه
  function handle(code, method) {
    if (scanner) scanner.paused = true;
    queue = queue.then(async () => {
      let r;
      try { r = await api.post('/scan', { code, method }); }
      catch (e) {
        r = e.status === 0 ? { status: 'network', message: e.message }
          : e.status === 401 ? { status: 'invalid', message: 'انتهت الجلسة. أعد تسجيل الدخول.' }
          : { status: 'invalid', message: e.message };
      }
      showResult(r);
      if (r.status === 'ok') refreshLive();
      // العودة التلقائية إلى وضع الاستعداد
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { setCamState(''); if (scanner) scanner.paused = false; }, r.status === 'ok' ? 1300 : 2000);
    });
    return queue;
  }

  // ---------- الإدخال اليدوي (بارز دائمًا ضمن الصفحة) ----------
  const canManual = me.role === 'admin' || me.can_manual;
  const manualInput = h('input', { class: 'input ltr', placeholder: 'FJ-XXXXX', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, maxlength: 12, 'aria-label': 'معرف الحساب', enterkeyhint: 'done' });
  const manualBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'تسجيل');
  const manual = canManual
    ? h('section', { class: 'card manual' },
      h('h3', { style: { marginBottom: '8px' } }, 'إدخال المعرف يدويًا'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const v = manualInput.value.trim();
        if (!v) return;
        manualBtn.disabled = true;
        await handle(v, 'manual');
        manualBtn.disabled = false; manualInput.value = ''; manualInput.focus();
      } }, h('div', { class: 'grow' }, manualInput), manualBtn),
      h('p', { class: 'hint', style: { margin: '8px 0 0' } }, 'استخدمه إذا تعذّرت قراءة الرمز (بطاقة تالفة أو إضاءة ضعيفة).'))
    : h('p', { class: 'hint center' }, 'الإدخال اليدوي غير مفعّل لحسابك.');

  const el = h('div', null,
    h('div', { class: 'scan-stats' },
      h('div', { class: 'stat accent' }, vPresent, h('div', { class: 'l' }, 'الحاضرون اليوم')),
      h('div', { class: 'stat' }, vExpected, h('div', { class: 'l' }, 'المتوقع')),
      h('div', { class: 'stat' }, vMine, h('div', { class: 'l' }, 'سجّلتَهم أنت'))),
    cam, result, manual, recentBox);

  refreshLive();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshLive(); }, 5000);
  startCamera();

  return {
    el,
    onLeave() {
      clearInterval(pollTimer); clearTimeout(resumeTimer);
      scanner?.stop();
      try { wakeLock?.release(); } catch { /* */ }
    },
  };
}
