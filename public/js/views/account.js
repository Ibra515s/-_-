import { h, field, openModal, toast, errorBox } from '../dom.js';
import * as api from '../api.js';
import { state, refreshMe, navigate, logout, logoMark, homeFor } from '../app.js';

function buildForm(onDone, { forced = false } = {}) {
  const minLen = state.me.type === 'staff' ? 8 : 6;
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const n1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
  const n2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
  const err = h('div');
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'حفظ كلمة المرور');
  const form = h('form', { class: 'stack', novalidate: true },
    forced ? h('p', { class: 'muted', style: { margin: 0 } }, 'لأمان حسابك، اختر كلمة مرور جديدة قبل المتابعة.') : null,
    field(forced ? 'كلمة المرور الحالية (المؤقتة)' : 'كلمة المرور الحالية', cur),
    field('كلمة المرور الجديدة', n1, `لا تقل عن ${minLen} أحرف`),
    field('تأكيد كلمة المرور الجديدة', n2), err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.replaceChildren();
    if (n1.value !== n2.value) { err.append(errorBox('تأكيد كلمة المرور غير مطابق.')); return; }
    submit.disabled = true;
    try {
      await api.post('/auth/change-password', { current_password: cur.value, new_password: n1.value });
      toast('تم تغيير كلمة المرور.', 'ok');
      await onDone();
    } catch (ex) { err.append(errorBox(ex.message)); } finally { submit.disabled = false; }
  });
  return form;
}

export function changePasswordModal() {
  let m;
  const form = buildForm(() => m.close());
  m = openModal({
    title: 'إعدادات الحساب',
    body: h('div', { class: 'stack' },
      h('h3', { style: { margin: 0 } }, 'تغيير كلمة المرور'),
      form),
  });
}
export const accountModal = changePasswordModal;

export function forcedChangePassword() {
  const form = buildForm(async () => { await refreshMe(); navigate(homeFor(state.me)); }, { forced: true });
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand' }, logoMark('logo-img'), h('div', { class: 'mosque' }, state.info.mosqueName)),
    h('div', { class: 'card' }, h('h1', { style: { marginBottom: '12px' } }, 'تغيير كلمة المرور'), form,
      h('div', { class: 'spacer' }), h('button', { class: 'btn btn-ghost btn-block', onclick: logout }, 'خروج'))));
}
