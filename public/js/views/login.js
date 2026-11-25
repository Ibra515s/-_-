import { h, icon, field, toast, errorBox } from '../dom.js';
import * as api from '../api.js';
import { QrScanner, cameraErrorMessage } from '../scanner.js';
import { state, navigate, refreshMe, homeFor, logoMark } from '../app.js';

function authShell(...children) {
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand' },
      logoMark('logo-img'),
      h('div', { class: 'mosque' }, state.info.mosqueName),
      h('div', { class: 'sub' }, state.info.campaignName)),
    h('div', { class: 'card' }, ...children)));
}

function passwordField(label, name, autocomplete) {
  const input = h('input', { class: 'input', type: 'password', name, autocomplete, required: true });
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'إظهار كلمة المرور', onclick: () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  } }, icon('eye'));
  const f = field(label, input);
  const grow = h('div', { class: 'grow' });
  const wrap = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, grow, btn);
  f.replaceChild(wrap, input);
  grow.append(input);
  return { el: f, input };
}

function submitButton(label) {
  return h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, label);
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------
export async function loginView() {
  const idInput = h('input', { class: 'input ltr', name: 'account_id', autocomplete: 'username', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, placeholder: 'FJ-XXXXX', required: true, maxlength: 12 });
  const pw = passwordField('كلمة المرور', 'password', 'current-password');
  const errBox = h('div');
  const camBox = h('div', { class: 'hidden stack-sm' });
  const form = h('form', { class: 'stack', novalidate: true });
  let scanner = null;

  const showError = (msg) => { errBox.replaceChildren(msg ? errorBox(msg) : ''); };
  const stopScan = () => { scanner?.stop(); scanner = null; camBox.classList.add('hidden'); camBox.replaceChildren(); };

  async function startScan() {
    showError('');
    const video = h('video', { autoplay: true, playsinline: true, muted: true });
    camBox.replaceChildren(
      h('div', { class: 'cam' }, video, h('div', { class: 'frame' })),
      h('p', { class: 'muted small center', style: { margin: 0 } }, 'وجّه الكاميرا نحو رمز QR على البطاقة'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: stopScan }, 'إلغاء'));
    camBox.classList.remove('hidden');
    scanner = new QrScanner(video, async (code) => {
      scanner.paused = true;
      try {
        const r = await api.post('/auth/lookup', { code });
        if (r.state === 'active') {
          idInput.value = r.public_id; stopScan(); toast('تمت قراءة البطاقة. أدخل كلمة المرور.', 'ok'); pw.input.focus();
        } else if (r.state === 'pending') {
          state.pendingCode = r.public_id; stopScan(); navigate('#/activate');
        } else {
          stopScan(); showError(r.state === 'suspended' ? 'هذا الحساب موقوف. راجع المشرف.' : r.message);
        }
      } catch (e) { stopScan(); showError(e.message); }
    });
    try { await scanner.start(); } catch (e) { stopScan(); showError(cameraErrorMessage(e)); }
  }

  const submit = submitButton('دخول');
  form.append(
    field('معرف الحساب', idInput, 'مكتوب على بطاقتك، مثل FJ-7K4P9'),
    pw.el, errBox, submit,
    h('div', { class: 'divider' }, 'أو'),
    h('button', { type: 'button', class: 'btn btn-lg btn-block', onclick: startScan }, icon('scan'), 'الدخول باستخدام البطاقة'),
    camBox);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    await withBusy(submit, async () => {
      try {
        const r = await api.post('/auth/login', { account_id: idInput.value, password: pw.input.value });
        if (r.state === 'pending') { state.pendingCode = idInput.value; toast(r.message); navigate('#/activate'); return; }
        await refreshMe();
        navigate(homeFor(state.me));
      } catch (err) { showError(err.message); }
    });
  });

  return {
    el: authShell(
      h('h1', { style: { marginBottom: '16px' } }, 'تسجيل الدخول'), form,
      h('div', { class: 'spacer' }),
      h('div', { class: 'center small' }, h('a', { href: '#/activate' }, 'أول مرة؟ فعّل حسابك'), ' · ', h('a', { href: '#/staff-login' }, 'دخول المشرفين والمساعدين'))),
    onLeave: stopScan,
  };
}

// ---------------------------------------------------------------
export async function activateView() {
  const prefill = state.pendingCode || '';
  const idInput = h('input', { class: 'input ltr', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, placeholder: 'FJ-XXXXX', required: true, maxlength: 12, value: prefill });
  const name = h('input', { class: 'input', autocomplete: 'name', required: true, maxlength: 120 });
  const age = h('input', { class: 'input ltr', type: 'text', inputmode: 'numeric', required: true, maxlength: 3 });
  const phone = h('input', { class: 'input ltr', type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: 20, placeholder: '05XXXXXXXX (اختياري)' });
  const pw = passwordField('كلمة المرور', 'new-password', 'new-password');
  const pw2 = passwordField('تأكيد كلمة المرور', 'confirm', 'new-password');
  const errBox = h('div');
  const submit = submitButton('تفعيل الحساب');
  let scanner = null;
  const camBox = h('div', { class: 'hidden stack-sm' });
  const stopScan = () => { scanner?.stop(); scanner = null; camBox.classList.add('hidden'); camBox.replaceChildren(); };

  async function scanCard() {
    const video = h('video', { autoplay: true, playsinline: true, muted: true });
    camBox.replaceChildren(h('div', { class: 'cam' }, video, h('div', { class: 'frame' })), h('button', { type: 'button', class: 'btn btn-block', onclick: stopScan }, 'إلغاء'));
    camBox.classList.remove('hidden');
    scanner = new QrScanner(video, async (code) => {
      scanner.paused = true;
      try {
        const r = await api.post('/auth/lookup', { code });
        stopScan();
        if (r.state === 'pending') { idInput.value = r.public_id; toast('تمت قراءة البطاقة.', 'ok'); }
        else if (r.state === 'active') { toast('هذا الحساب مفعّل مسبقًا. سجّل الدخول.'); navigate('#/login'); }
        else errBox.replaceChildren(errorBox(r.message || 'هذا الحساب موقوف.'));
      } catch (e) { stopScan(); errBox.replaceChildren(errorBox(e.message)); }
    });
    try { await scanner.start(); } catch (e) { stopScan(); errBox.replaceChildren(errorBox(cameraErrorMessage(e))); }
  }

  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('معرف الحساب', idInput)),
      h('button', { type: 'button', class: 'btn', style: { alignSelf: 'flex-end' }, onclick: scanCard }, icon('scan'), 'مسح')),
    camBox,
    field('الاسم الرباعي', name, 'مثال: محمد أحمد علي الحربي'),
    h('div', { class: 'grid2' }, field('العمر (بالسنوات)', age), field('رقم الهاتف (اختياري)', phone)),
    pw.el, pw2.el, errBox, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.replaceChildren();
    await withBusy(submit, async () => {
      try {
        await api.post('/auth/activate', { account_id: idInput.value, full_name: name.value, age: age.value, phone: phone.value, password: pw.input.value, confirm_password: pw2.input.value });
        state.pendingCode = null;
        await refreshMe();
        toast('تم تفعيل حسابك. أهلًا بك!', 'ok');
        navigate(homeFor(state.me));
      } catch (err) { errBox.replaceChildren(errorBox(err.message)); }
    });
  });

  return {
    el: authShell(h('h1', { style: { marginBottom: '4px' } }, 'تفعيل الحساب'),
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'أكمل بياناتك مرة واحدة فقط، ثم تدخل لاحقًا بالمعرف وكلمة المرور.'),
      form, h('div', { class: 'spacer' }), h('div', { class: 'center small' }, h('a', { href: '#/login' }, 'لديّ حساب مفعّل'))),
    onLeave: stopScan,
  };
}

// ---------------------------------------------------------------
export async function staffLoginView() {
  const user = h('input', { class: 'input ltr', name: 'username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', required: true });
  const pw = passwordField('كلمة المرور', 'password', 'current-password');
  const errBox = h('div');
  const submit = submitButton('دخول');
  const form = h('form', { class: 'stack', novalidate: true }, field('اسم المستخدم', user), pw.el, errBox, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.replaceChildren();
    await withBusy(submit, async () => {
      try {
        await api.post('/auth/staff-login', { username: user.value, password: pw.input.value });
        await refreshMe();
        navigate(homeFor(state.me));
      } catch (err) { errBox.replaceChildren(errorBox(err.message)); }
    });
  });
  return {
    el: authShell(h('h1', { style: { marginBottom: '16px' } }, 'دخول المشرفين والمساعدين'), form,
      h('div', { class: 'spacer' }), h('div', { class: 'center small' }, h('a', { href: '#/login' }, 'دخول المشاركين'))),
  };
}
