const express = require('express');
const crypto = require('crypto');
const { PUBLIC_DIR, TRUST_PROXY } = require('./config');
const { C, getSettings, getLogoBuffer, logAction, nextId, isDup } = require('./db');
const { HttpError, hashPassword, nowIso, normalizeCode } = require('./util');
const A = require('./auth');
const LB = require('./services/leaderboard');

async function seedAdmin() {
  const exists = await C.staff.findOne({ role: 'admin' }, { projection: { _id: 1 } });
  if (exists) return null;
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url'); generated = true; }
  const id = await nextId('staff');
  try {
    await C.staff.insertOne({ _id: id, username, display_name: 'المشرف الرئيسي', password_hash: await hashPassword(password), role: 'admin',
      is_active: true, can_scan: true, can_manual: true, must_change_password: generated, created_at: nowIso() });
  } catch (e) {
    if (isDup(e)) return null; // نسخة أخرى من الخادم أنشأته للتو
    throw e;
  }
  await logAction(null, 'admin_seeded', `staff:${username}`);
  return { username, password, generated };
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);

  // ---------- ترويسات الأمان ----------
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' data: blob: mediastream:; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', (req, res, next) => { A.loadSession(req, res).then(() => next(), next); });
  // حماية CSRF: كل طلب يغيّر البيانات يجب أن يحمل ترويسة مخصصة (لا تُرسَل من نطاق آخر دون CORS)
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'fetch') {
      throw new HttpError(403, 'csrf', 'طلب غير مسموح.');
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', require('./routes/auth').router);
  app.use('/api', require('./routes/me').router);
  app.use('/api', require('./routes/scan').router);
  app.use('/api', require('./routes/admin').router);

  // شعار الموقع (عام: يظهر في صفحة الدخول)
  app.get('/api/public/logo', (req, res) => {
    const s = getSettings();
    const buf = getLogoBuffer();
    if (!s.logo_type || !buf) return res.status(404).end();
    res.set({ 'Content-Type': s.logo_type, 'Cache-Control': 'public, max-age=86400' }).send(buf);
  });

  // manifest ديناميكي يتبع اسم التطبيق
  app.get('/manifest.webmanifest', (req, res) => {
    const s = getSettings();
    res.type('application/manifest+json').json({
      name: s.app_name, short_name: s.app_name.slice(0, 12), lang: 'ar', dir: 'rtl',
      start_url: '/', scope: '/', display: 'standalone', background_color: '#f6f8f7', theme_color: '#0f6b4f',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  });

  app.use('/api', (req, res) => { throw new HttpError(404, 'not_found', 'غير موجود.'); });

  // رابط البطاقة داخل QR: /c/FJ-XXXXX ← تتولى الواجهة التوجيه (تفعيل إن كان جديدًا، أو تسجيل الدخول)
  app.get('/c/:code', (req, res) => {
    const code = normalizeCode(req.params.code);
    res.set('Cache-Control', 'no-store');
    res.redirect(302, `/#/c/${code || encodeURIComponent(String(req.params.code).slice(0, 40))}`);
  });

  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, file) {
      if (/\.(woff2?|png)$/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else res.set('Cache-Control', 'no-cache');
    },
  }));

  // ---------- معالج الأخطاء ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...(err.extra || {}) });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'الحجم أكبر من المسموح.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'صيغة الطلب غير صحيحة.' });
    console.error(err);
    if (res.headersSent) return res.end();
    res.status(500).json({ error: 'server_error', message: 'حدث خطأ غير متوقع.' });
  });

  return app;
}

function startBackgroundJobs() {
  const run = () => LB.finalizeDue().catch((e) => console.error(e));
  run();
  setInterval(run, 60 * 1000).unref(); // الجلسات المنتهية تحذفها MongoDB تلقائيًا (TTL)
}

module.exports = { createApp, seedAdmin, startBackgroundJobs };
