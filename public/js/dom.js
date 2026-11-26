// أدوات بناء الواجهة. كل النصوص تُدرج كنصوص (textContent) لمنع XSS.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { el.replaceChildren(); return el; };

// ---------- أيقونات (مسارات ثابتة موثوقة) ----------
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  home: '<path d="M3 11 12 3l9 8M5 9.5V20h14V9.5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0V4ZM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4M8 21h8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  flash: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4ZM16.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4ZM17 9l4 6M21 9l-4 6"/>',
};

export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ---------- إشعارات ونوافذ ----------
export function toast(msg, type = '') {
  const t = h('div', { class: `toast ${type}`, role: type === 'err' ? 'alert' : 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3200);
}

export function openModal({ title, body, actions = [], wide = false, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const modal = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' },
      h('h2', null, title),
      h('button', { class: 'btn btn-ghost btn-sm', 'aria-label': 'إغلاق', onclick: close }, icon('x'))),
    body,
    actions.length ? h('div', { class: 'modal-foot' }, actions) : null);
  back.append(modal);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  const first = modal.querySelector('input:not([readonly]),select,textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, modal };
}

export function confirmDialog({ title, message, confirmText = 'تأكيد', danger = false, withReason = false }) {
  return new Promise((resolve) => {
    const reason = withReason ? h('input', { class: 'input', placeholder: 'السبب (مطلوب)', maxlength: 200 }) : null;
    const err = h('div', { class: 'form-error hidden' });
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = openModal({
      title,
      body: h('div', { class: 'stack-sm' }, h('p', { style: { margin: 0 } }, message), reason, err),
      onClose: () => finish(null),
      actions: [
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => {
          if (withReason && reason.value.trim().length < 3) { err.textContent = 'اكتب سببًا واضحًا.'; err.classList.remove('hidden'); return; }
          finish(withReason ? reason.value.trim() : true); m.close();
        } }, confirmText),
        h('button', { class: 'btn', onclick: () => m.close() }, 'إلغاء'),
      ],
    });
  });
}

// ---------- مساعدات عرض ----------
export const spinner = () => h('div', { class: 'loading' }, h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'جارٍ التحميل' }));
export const empty = (msg) => h('div', { class: 'empty' }, msg);
export const errorBox = (msg) => h('div', { class: 'form-error', role: 'alert' }, msg);

export function field(label, input, hint) {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function switchEl(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, onchange: (e) => onchange(e.target.checked, e.target) });
  return h('label', { class: 'switch' }, input, h('span', null, label));
}

export function pager({ page, limit, total }, go) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return h('div');
  return h('div', { class: 'pager' },
    h('button', { class: 'btn btn-sm', disabled: page <= 1, onclick: () => go(page - 1) }, 'السابق'),
    h('span', { class: 'muted num' }, `${page} / ${pages}`),
    h('button', { class: 'btn btn-sm', disabled: page >= pages, onclick: () => go(page + 1) }, 'التالي'));
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- تنسيق التواريخ (أرقام لاتينية بتوقيت إعدادات المسجد) ----------
let TZ = 'Asia/Amman';
export const setTimezone = (tz) => { TZ = tz; };
export function fmtTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  return `${date} ${fmtTime(iso)}`;
}
export const fmtDate = (s) => (s ? s.split('-').reverse().join('/') : '—');
const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const weekday = (s) => WD[new Date(`${s}T12:00:00Z`).getUTCDay()];
export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const STATUS = {
  pending: ['بانتظار التفعيل', 'badge-warn'],
  active: ['نشط', 'badge-ok'],
  suspended: ['موقوف', 'badge-danger'],
};
export const statusBadge = (s) => h('span', { class: `badge ${STATUS[s]?.[1] || ''}` }, h('i', { class: 'dot' }), STATUS[s]?.[0] || s);

export const LB_STATUS = { upcoming: ['قادمة', 'badge-warn'], active: ['نشطة', 'badge-ok'], ended: ['منتهية', ''] };

// ---------- صوت ----------
let audioCtx;
export function beep(kind) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const seq = kind === 'ok' ? [[880, 0.09], [1175, 0.12]] : kind === 'dup' ? [[520, 0.1], [520, 0.1]] : [[220, 0.28]];
    let t = audioCtx.currentTime;
    for (const [f, d] of seq) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = kind === 'err' ? 'sawtooth' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + d + 0.02);
      t += d + 0.04;
    }
  } catch { /* الصوت اختياري */ }
}
