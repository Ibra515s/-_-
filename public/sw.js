// عامل خدمة بسيط: يخزّن ملفات الواجهة الثابتة فقط (لا يخزّن أي طلبات API أو بيانات).
const CACHE = 'fajr-shell-v3';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/api.js', '/js/dom.js', '/js/scanner.js', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/manifest.webmanifest') return;
  // الشبكة أولًا ثم الكاش عند انقطاع الاتصال
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && /\.(js|css|woff2|png|html)$|^\/$/.test(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
