export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || 'حدث خطأ غير متوقع.');
    this.status = status;
    this.code = data?.error;
    this.data = data;
  }
}

async function request(path, { method = 'GET', body, rawBody, contentType } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  let payload;
  if (rawBody !== undefined) { payload = rawBody; headers['Content-Type'] = contentType; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, { error: 'network', message: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.' });
  }
  return res;
}

export async function api(path, opts) {
  const res = await request(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* قد يكون الرد فارغًا */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('session-expired'));
    if (res.status === 403 && data?.error === 'must_change_password') window.dispatchEvent(new CustomEvent('must-change-password'));
    throw err;
  }
  return data;
}

/** تنزيل ملف (PDF/CSV) كما يرسله الخادم */
export async function download(path, opts, fallbackName) {
  const res = await request(path, opts);
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* */ }
    throw new ApiError(res.status, data);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { blob, name };
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
