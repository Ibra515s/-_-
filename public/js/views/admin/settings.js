import { h, icon, field, toast, errorBox, confirmDialog } from '../../dom.js';
import * as api from '../../api.js';
import { state, refreshInfo, navigate } from '../../app.js';
import { pageHead } from './shared.js';
import { changePasswordModal } from '../account.js';

const TIMEZONES = [
  ['Asia/Riyadh', 'الرياض (السعودية)'], ['Asia/Kuwait', 'الكويت'], ['Asia/Qatar', 'قطر'], ['Asia/Dubai', 'الإمارات'], ['Asia/Muscat', 'عُمان'],
  ['Asia/Bahrain', 'البحرين'], ['Asia/Baghdad', 'بغداد'], ['Asia/Amman', 'عمّان'], ['Asia/Beirut', 'بيروت'], ['Africa/Cairo', 'القاهرة'],
  ['Africa/Khartoum', 'الخرطوم'], ['Africa/Casablanca', 'الدار البيضاء'], ['Africa/Algiers', 'الجزائر'], ['Africa/Tunis', 'تونس'], ['Europe/Istanbul', 'إسطنبول'], ['UTC', 'UTC'],
];

export default async function view() {
  const s = await api.get('/admin/settings');
  const mosque = h('input', { class: 'input', value: s.mosque_name, maxlength: 60 });
  const app = h('input', { class: 'input', value: s.app_name, maxlength: 60 });
  const camp = h('input', { class: 'input', value: s.campaign_name, maxlength: 60 });
  const start = h('input', { class: 'input', type: 'date', value: s.campaign_start });
  const tzList = TIMEZONES.some(([v]) => v === s.timezone) ? TIMEZONES : [[s.timezone, s.timezone], ...TIMEZONES];
  const tz = h('select', { class: 'input' }, tzList.map(([v, l]) => h('option', { value: v, selected: v === s.timezone }, l)));
  const prefix = h('input', { class: 'input ltr', value: s.id_prefix, maxlength: 4, autocapitalize: 'characters' });
  const names = h('select', { class: 'input' },
    h('option', { value: 'short', selected: s.leaderboard_names === 'short' }, 'الاسم الأول والأخير فقط'),
    h('option', { value: 'full', selected: s.leaderboard_names === 'full' }, 'الاسم الرباعي كاملًا'));
  const err = h('div');

  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'grid2' }, field('اسم المسجد', mosque, 'يظهر في الدخول وواجهة المشارك وعلى البطاقات المطبوعة.'), field('اسم التطبيق', app)),
    h('div', { class: 'grid2' }, field('اسم الحملة', camp, 'يُطبع تحت اسم المسجد على البطاقة.'), field('تاريخ بداية الحملة', start, 'يبدأ منه سجل حضور كل مشارك.')),
    h('div', { class: 'grid2' }, field('المنطقة الزمنية', tz, 'يُحسب «اليوم» وفقها.'), field('بادئة المعرف', prefix, 'تؤثر على الحسابات الجديدة فقط (2-4 أحرف إنجليزية).')),
    field('عرض الأسماء في لوحة الصدارة', names, 'لا يُعرض أي رقم هاتف أو عمر أو معرف حساب في اللوحة.'),
    err,
    h('div', null, h('button', { class: 'btn btn-primary', type: 'submit' }, 'حفظ الإعدادات')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.replaceChildren();
    try {
      await api.put('/admin/settings', { mosque_name: mosque.value, app_name: app.value, campaign_name: camp.value, campaign_start: start.value, timezone: tz.value, id_prefix: prefix.value, leaderboard_names: names.value });
      await refreshInfo(); toast('تم حفظ الإعدادات.', 'ok'); navigate('#/admin/settings');
    } catch (ex) { err.append(errorBox(ex.message)); }
  });

  // الشعار
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'hidden' });
  const preview = state.info.hasLogo ? h('img', { class: 'logo-preview', src: `/api/public/logo?v=${state.info.logoVersion}`, alt: 'الشعار الحالي' }) : h('div', { class: 'logo-preview muted center', style: { display: 'flex', alignItems: 'center', justifyContent: 'center' } }, 'لا يوجد');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { toast('الصورة أكبر من 1 ميغابايت.', 'err'); return; }
    try {
      await api.api('/admin/logo', { method: 'PUT', rawBody: f, contentType: f.type });
      await refreshInfo(); toast('تم رفع الشعار.', 'ok'); navigate('#/admin/settings');
    } catch (ex) { toast(ex.message, 'err'); }
  });

  const el = h('div', { class: 'stack' },
    pageHead('الإعدادات'),
    h('section', { class: 'card' }, h('h2', null, 'بيانات المسجد والحملة'), form),
    h('section', { class: 'card' }, h('h2', null, 'شعار الموقع'),
      h('div', { class: 'row' }, preview,
        h('div', { class: 'stack-sm' },
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('download'), 'رفع شعار (PNG / JPG)'),
            state.info.hasLogo ? h('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmDialog({ title: 'حذف الشعار', message: 'سيُستبدل بالشعار الافتراضي.', danger: true, confirmText: 'حذف' })) { await api.del('/admin/logo'); await refreshInfo(); navigate('#/admin/settings'); } } }, 'حذف') : null),
          h('span', { class: 'hint' }, 'يظهر في صفحة الدخول وواجهة المشارك وعلى البطاقات. الحد الأقصى 1 ميغابايت.')), fileInput)),
    h('section', { class: 'card' }, h('h2', null, 'حسابي'), h('button', { class: 'btn', onclick: changePasswordModal }, icon('key'), 'تغيير كلمة المرور')));
  return { el };
}
