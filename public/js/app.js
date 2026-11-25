import { h, $, clear, icon, spinner, toast, setTimezone } from './dom.js';
import * as api from './api.js';

export const state = { info: null, me: null, pendingCode: null };
const root = $('#app');
let leave = null;
let renderToken = 0;

export function navigate(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}
const replace = (hash) => { location.replace(hash); };

export async function refreshMe() { state.me = await api.get('/auth/me'); return state.me; }
export async function refreshInfo() {
  state.info = await api.get('/public/info');
  setTimezone(state.info.timezone);
  document.title = state.info.appName;
}

export const homeFor = (me) => (me.type === 'participant' ? '#/me' : me.user.role === 'admin' ? '#/admin' : '#/scan');

export function logoMark(cls = 'logo') {
  return state.info.hasLogo
    ? h('img', { class: cls, src: `/api/public/logo?v=${state.info.logoVersion}`, alt: '' })
    : h('div', { class: 'logo-ph' }, icon('moon'));
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* حتى لو فشل الطلب نخرج محليًا */ }
  state.me = { type: null };
  navigate('#/login');
}

// ---------- الهياكل ----------
const openAccount = async () => (await import('./views/account.js')).accountModal();

function topbar({ right = [], subtitle, menu = null } = {}) {
  return h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
    menu,
    logoMark(),
    h('div', { class: 'title' }, h('span', { class: 'ttl' }, state.info.mosqueName), h('small', null, subtitle || state.info.campaignName)),
    h('div', { class: 'grow' }),
    h('div', { class: 'topbar-actions' }, ...right)));
}

function accountButtons({ settings = true, hideOnMobile = false } = {}) {
  return [
    settings ? h('button', { class: 'btn btn-ghost btn-sm', title: 'إعدادات الحساب', 'aria-label': 'إعدادات الحساب', onclick: openAccount }, icon('gear')) : null,
    h('button', { class: `btn btn-sm ${hideOnMobile ? 'hide-sm-logout' : ''}`, onclick: logout }, icon('logout'), h('span', { class: 'hide-sm' }, 'خروج')),
  ];
}

const ADMIN_NAV = [
  ['#/admin', 'لوحة التحكم', 'home'],
  ['#/admin/participants', 'المشاركون', 'users'],
  ['#/admin/attendance', 'سجل الحضور', 'cal'],
  ['#/admin/leaderboards', 'لوحة الصدارة', 'trophy'],
  ['#/admin/assistants', 'المساعدون', 'key'],
  ['#/admin/settings', 'الإعدادات', 'gear'],
  ['#/admin/logs', 'سجل العمليات', 'list'],
];

function shellAdmin(content, path) {
  const shell = h('div', { class: 'admin-shell' });
  const setOpen = (on) => {
    shell.classList.toggle('nav-open', on);
    document.body.classList.toggle('no-scroll', on);
    toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  const toggle = h('button', { class: 'btn btn-ghost btn-sm nav-toggle', 'aria-label': 'القائمة الجانبية', 'aria-expanded': 'false', onclick: () => setOpen(!shell.classList.contains('nav-open')) }, icon('menu'));
  const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); }, { once: true });

  const closeThen = (fn) => (e) => { setOpen(false); fn?.(e); };
  const nav = h('nav', { class: 'nav', 'aria-label': 'القائمة الرئيسية' },
    h('div', { class: 'nav-head' },
      logoMark(),
      h('div', { class: 'title' }, h('span', { class: 'ttl' }, state.info.mosqueName), h('small', null, 'لوحة المشرف')),
      h('button', { class: 'btn btn-ghost btn-sm', 'aria-label': 'إغلاق القائمة', onclick: () => setOpen(false) }, icon('x'))),
    ADMIN_NAV.map(([href, label, ic]) => h('a', { href, class: href === `#${path}` ? 'active' : '', 'aria-current': href === `#${path}` ? 'page' : null, onclick: closeThen() }, icon(ic), label)),
    h('div', { class: 'nav-sep' }),
    h('a', { href: '#/scan', class: path === '/scan' ? 'active' : '', onclick: closeThen() }, icon('scan'), 'ماسح الحضور'),
    h('a', { href: '#', onclick: closeThen((e) => { e.preventDefault(); openAccount(); }) }, icon('gear'), 'إعدادات الحساب'),
    h('a', { href: '#', class: 'nav-logout', onclick: closeThen((e) => { e.preventDefault(); logout(); }) }, icon('logout'), 'تسجيل الخروج'));
  const backdrop = h('div', { class: 'nav-backdrop', onclick: () => setOpen(false) });
  shell.append(nav, backdrop, h('main', { id: 'main', style: { minWidth: 0 } }, content));
  return h('div', null, topbar({ subtitle: 'لوحة المشرف', menu: toggle, right: accountButtons({ settings: false, hideOnMobile: true }) }), shell);
}

const shellParticipant = (content) => h('div', null, topbar({ right: accountButtons() }), h('main', { class: 'container' }, content));
const shellScan = (content, me) => h('div', null,
  topbar({
    subtitle: 'تسجيل الحضور',
    right: [
      me.user.role === 'admin' ? h('a', { class: 'btn btn-sm', href: '#/admin' }, icon('home'), 'لوحة المشرف') : null,
      ...accountButtons(),
    ],
  }),
  h('main', { class: 'scan-shell' }, content));

// ---------- التوجيه ----------
const PUBLIC_PATHS = ['/login', '/staff-login', '/activate'];

async function render() {
  const token = ++renderToken;
  leave?.(); leave = null;
  const [path] = (location.hash.replace(/^#/, '') || '/').split('?');
  const me = state.me;

  // حراس المسارات
  if (!me.type) {
    if (!PUBLIC_PATHS.includes(path)) return replace('#/login');
  } else if (me.must_change_password) {
    const mod = await import('./views/account.js');
    clear(root).append(mod.forcedChangePassword());
    return;
  } else if (PUBLIC_PATHS.includes(path) || path === '/') {
    return replace(homeFor(me));
  } else if (me.type === 'participant' && path !== '/me') {
    return replace('#/me');
  } else if (me.type === 'staff') {
    const isAdmin = me.user.role === 'admin';
    if (path.startsWith('/admin') && !isAdmin) return replace('#/scan');
    if (path === '/scan' && !(isAdmin || me.user.can_scan)) return replace('#/login');
    if (path === '/me') return replace(homeFor(me));
  }

  clear(root).append(spinner());
  const holder = h('div');
  let wrapped;
  try {
    let mod, ctx = { state, navigate, refreshMe, refreshInfo };
    if (path === '/login') { mod = await import('./views/login.js'); wrapped = (c) => c; const r = await mod.loginView(ctx); holder.append(r.el); leave = r.onLeave; }
    else if (path === '/staff-login') { mod = await import('./views/login.js'); wrapped = (c) => c; const r = await mod.staffLoginView(ctx); holder.append(r.el); leave = r.onLeave; }
    else if (path === '/activate') { mod = await import('./views/login.js'); wrapped = (c) => c; const r = await mod.activateView(ctx); holder.append(r.el); leave = r.onLeave; }
    else if (path === '/me') { mod = await import('./views/participant.js'); wrapped = shellParticipant; const r = await mod.default(ctx); holder.append(r.el); leave = r.onLeave; }
    else if (path === '/scan') { mod = await import('./views/scan.js'); wrapped = (c) => shellScan(c, me); const r = await mod.default(ctx); holder.append(r.el); leave = r.onLeave; }
    else if (path.startsWith('/admin')) {
      const name = { '/admin': 'dashboard', '/admin/participants': 'participants', '/admin/attendance': 'attendance', '/admin/leaderboards': 'leaderboards', '/admin/assistants': 'assistants', '/admin/settings': 'settings', '/admin/logs': 'logs' }[path];
      if (!name) return replace('#/admin');
      mod = await import(`./views/admin/${name}.js`);
      wrapped = (c) => shellAdmin(c, path);
      const r = await mod.default(ctx);
      holder.append(r.el); leave = r.onLeave;
    } else return replace(me.type ? homeFor(me) : '#/login');
  } catch (e) {
    if (token !== renderToken) return;
    if (e.status === 401) { state.me = { type: null }; return replace('#/login'); }
    clear(root).append(h('div', { class: 'container' }, h('div', { class: 'card' }, h('div', { class: 'form-error' }, e.message || 'تعذّر تحميل الصفحة.'), h('div', { class: 'spacer' }), h('button', { class: 'btn', onclick: render }, 'إعادة المحاولة'))));
    return;
  }
  if (token !== renderToken) { return; }
  const content = holder.childNodes.length === 1 ? holder.firstChild : holder;
  clear(root).append(wrapped(content));
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
window.addEventListener('session-expired', async () => {
  if (!state.me?.type) return;
  state.me = { type: null };
  toast('انتهت الجلسة. سجّل الدخول من جديد.', 'err');
  navigate('#/login');
});
window.addEventListener('must-change-password', async () => { await refreshMe(); render(); });

(async function boot() {
  try {
    await Promise.all([refreshInfo(), refreshMe()]);
  } catch (e) {
    clear(root).append(h('div', { class: 'container' }, h('div', { class: 'card' }, h('div', { class: 'form-error' }, e.message), h('div', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => location.reload() }, 'إعادة المحاولة'))));
    return;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
})();
