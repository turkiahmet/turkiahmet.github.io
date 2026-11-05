// Private owner dashboard service for the GitHub Pages academic site.
// All private HTML and APIs are authenticated at the server.
const OWNER_EMAIL = 'turkiahmet26@gmail.com';
const SITE_ORIGIN = 'https://turkiahmet.github.io';
const REPOSITORY = 'turkiahmet/turkiahmet.github.io';
const DATA_PATH = 'content/site-data.json';
const SEED_URL = 'https://raw.githubusercontent.com/' + REPOSITORY + '/main/' + DATA_PATH;
const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const LANGS = ['ar', 'tr', 'en'];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const SESSION_SECONDS = 3600;
const LOGIN_SECONDS = 300;
const SESSION_COOKIE = '__Host-ta-session';
const LOGIN_COOKIE = '__Host-ta-login';
const CONTACT_CAPACITY = 1000;
const RETENTION_DAYS = 0; // Messages are not automatically purged.
const jwksCache = new Map();

class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new AppError(status, message); };
const nowSeconds = (clock) => Math.floor(clock() / 1000);
function b64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function unb64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail(401, 'بيانات تسجيل الدخول غير صالحة.');
  try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)); }
  catch { fail(401, 'بيانات تسجيل الدخول غير صالحة.'); }
}
function parseSegment(value) { try { return JSON.parse(decoder.decode(unb64(value))); } catch { fail(401, 'بيانات تسجيل الدخول غير صالحة.'); } }
function randomToken() { return b64(crypto.getRandomValues(new Uint8Array(32))); }
async function digest(value) { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
async function hmacKey(secret) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
// This separate credential can read notification counts only; an owner session is not accepted.
async function requireNotificationAccess(request, env) {
  if (env.EMAIL_NOTIFICATIONS_ENABLED !== 'true') fail(404, 'هذه الصفحة غير متاحة.');
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.NOTIFICATION_SECRET !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(env.NOTIFICATION_SECRET)) fail(503, 'لم يكتمل إعداد التنبيهات.');
  if (!request.url.startsWith('https://')) fail(503, 'يلزم اتصال آمن للتنبيهات.');
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.get('Authorization') || '');
  if (!match) fail(401, 'يلزم تصريح التنبيهات.');
  // Compare through Web Crypto verification rather than a length-dependent string loop.
  const data = encoder.encode('turkiahmet-contact-notification-v1');
  const proof = await crypto.subtle.sign('HMAC', await hmacKey(match[1]), data);
  if (!await crypto.subtle.verify('HMAC', await hmacKey(env.NOTIFICATION_SECRET), proof, data)) fail(403, 'تصريح التنبيهات غير صالح.');
}
async function signPayload(payload, secret) {
  const data = b64(encoder.encode(JSON.stringify(payload)));
  const signature = b64(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data))));
  return `${data}.${signature}`;
}
async function verifyPayload(value, secret, now, expectedType) {
  if (typeof value !== 'string' || value.length > 4096) fail(401, 'انتهت جلسة الدخول أو لم تبدأ.');
  const parts = value.split('.');
  if (parts.length !== 2) fail(401, 'انتهت جلسة الدخول أو لم تبدأ.');
  let valid = false;
  try { valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64(parts[1]), encoder.encode(parts[0])); } catch {}
  if (!valid) fail(401, 'انتهت جلسة الدخول أو لم تبدأ.');
  const payload = parseSegment(parts[0]);
  if (payload.type !== expectedType || !Number.isInteger(payload.exp) || payload.exp <= now || !Number.isInteger(payload.iat) || payload.iat > now + 30) fail(401, 'انتهت جلسة الدخول أو لم تبدأ.');
  return payload;
}
function readCookie(request, name) {
  const values = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  if (values.length !== 1) return null;
  return values[0].slice(name.length + 1);
}
function cookie(name, value, seconds) { return `${name}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Lax`; }
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
function config(env, request) {
  if (!env.DB || typeof env.DB.prepare !== 'function' || typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32 || typeof env.GOOGLE_CLIENT_ID !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID)) fail(503, 'لم يكتمل إعداد الإدارة وتسجيل الدخول بعد.');
  const origin = new URL(request.url).origin;
  if (!origin.startsWith('https://')) fail(503, 'يلزم اتصال آمن للوحة الإدارة.');
  return { origin, siteOrigin: SITE_ORIGIN, ownerEmail: OWNER_EMAIL, clientId: env.GOOGLE_CLIENT_ID, secret: env.SESSION_SECRET };
}
function requireOrigin(request, origin) {
  if (request.headers.get('Origin') !== origin) fail(403, 'لم يُسمح بهذا الطلب من خارج الموقع.');
}
function publicHeaders() { return { 'Access-Control-Allow-Origin': SITE_ORIGIN, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }; }
function publicJson(data, status = 200) { return json(data,status,publicHeaders()); }
function securityHeaders(type = 'text/html; charset=utf-8') {
 return { 'Content-Type':type, 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Cross-Origin-Opener-Policy':'same-origin-allow-popups', 'Content-Security-Policy':"default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; img-src 'self' data: https://lh3.googleusercontent.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
}
function page(content, type) { return new Response(content,{headers:securityHeaders(type)}); }
async function readJson(request, maxBytes = 65536) {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) fail(415, 'صيغة الطلب غير مدعومة.');
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > maxBytes) fail(413, 'حجم البيانات أكبر من المسموح.');
  if (!request.body) fail(400, 'لا توجد بيانات للحفظ.');
  const reader = request.body.getReader();
  let chunks = [], total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); fail(413, 'حجم البيانات أكبر من المسموح.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  try { const data = JSON.parse(decoder.decode(bytes)); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { fail(400, 'تعذّرت قراءة البيانات المرسلة.'); }
}
async function googleKeys(fetchImpl, clock) {
  const cached = jwksCache.get(fetchImpl);
  if (cached && cached.expires > clock()) return cached.keys;
  const response = await fetchImpl(GOOGLE_KEYS, { headers: { Accept: 'application/json' } });
  if (!response.ok) fail(503, 'تعذّر التحقق من Google الآن.');
  let data; try { data = await response.json(); } catch { fail(503, 'تعذّر التحقق من Google الآن.'); }
  if (!Array.isArray(data.keys) || data.keys.length > 20) fail(503, 'تعذّر التحقق من Google الآن.');
  const maxAge = Math.min(3600, Math.max(60, Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1]) || 300));
  jwksCache.set(fetchImpl, { keys: data.keys, expires: clock() + maxAge * 1000 });
  return data.keys;
}
async function verifyGoogleToken(token, clientId, nonce, fetchImpl, clock) {
  if (typeof token !== 'string' || token.length > 16000) fail(401, 'تعذّر إثبات هوية حساب Google.');
  const parts = token.split('.');
  if (parts.length !== 3) fail(401, 'تعذّر إثبات هوية حساب Google.');
  const header = parseSegment(parts[0]), claims = parseSegment(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) fail(401, 'تعذّر إثبات هوية حساب Google.');
  const keys = await googleKeys(fetchImpl, clock);
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
  if (!jwk) fail(401, 'تعذّر إثبات هوية حساب Google.');
  let valid = false;
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
  } catch {}
  const now = nowSeconds(clock);
  if (!valid || claims.aud !== clientId || (claims.azp && claims.azp !== clientId) || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || !Number.isInteger(claims.exp) || claims.exp <= now || !Number.isInteger(claims.iat) || claims.iat > now + 30 || (claims.nbf && claims.nbf > now + 30) || claims.nonce !== nonce || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub || '')) fail(401, 'تعذّر إثبات هوية حساب Google.');
  if (claims.email_verified !== true || typeof claims.email !== 'string' || claims.email.toLowerCase() !== OWNER_EMAIL) fail(403, 'هذا الحساب غير مخوّل بإدارة الموقع.');
  return claims;
}
async function storedOwner(env) { const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('owner_google_sub').first(); return row?.value || null; }
async function requireSession(request, env, cfg, clock) {
  const session = await verifyPayload(readCookie(request, SESSION_COOKIE), cfg.secret, nowSeconds(clock), 'session');
  if (session.email !== OWNER_EMAIL || !session.sub || session.sub !== await storedOwner(env) || (env.OWNER_GOOGLE_SUB && session.sub !== env.OWNER_GOOGLE_SUB)) fail(403, 'هذه الجلسة غير مخوّلة بإدارة الموقع.');
  if (!session.sid) fail(401, 'انتهت جلسة الدخول أو لم تبدأ.');
  const active = await env.DB.prepare('SELECT owner_sub FROM admin_sessions WHERE sid_hash=? AND expires_at>?').bind(await digest(session.sid), nowSeconds(clock)).first();
  if (!active || active.owner_sub !== session.sub) fail(401, 'انتهت جلسة الدخول أو لم تبدأ.');
  return session;
}
async function rateLimit(request, env, cfg, clock, purpose, limit) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) fail(503, 'تعذّر التحقق من مصدر الطلب.');
  const now = nowSeconds(clock), hour = Math.floor(now / 3600);
  const bucket = await digest(cfg.secret + ':' + purpose + ':' + ip + ':' + hour);
  const allowed = await env.DB.prepare('INSERT INTO rate_limits(bucket,hits,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 WHERE hits<? RETURNING hits').bind(bucket, now + 7200, limit).first();
  if (!allowed) fail(429, 'طلبات كثيرة؛ حاول لاحقًا.');
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now).run();
}
function requireCsrf(request, session) {
  const token = request.headers.get('X-CSRF-Token');
  if (!token || token.length !== 43 || token !== session.csrf) fail(403, 'تحتاج الصفحة إلى تحديث قبل الحفظ.');
}
function textField(value, max, label, required = false) {
  if (typeof value !== 'string') { if (!required && value == null) return ''; fail(400, `حقل ${label} غير صالح.`); }
  value = value.trim();
  if (value.length > max || (required && !value) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) fail(400, `تحقق من حقل ${label} وطوله.`);
  return value;
}
function cleanUrl(value, label) {
  value = textField(value, 2000, label);
  if (!value) return '';
  let url; try { url = new URL(value); } catch { fail(400, `رابط ${label} غير صالح.`); }
  if (url.protocol !== 'https:' || url.username || url.password) fail(400, `يجب أن يكون رابط ${label} من نوع HTTPS.`);
  return url.href;
}
function validateProfile(body) {
 const input=body.profile || body, output={};
 for(const lang of LANGS){ const v=input[lang]; if(!v || typeof v!=='object' || Array.isArray(v)) fail(400,'تحتاج النبذة إلى اللغات الثلاث.');
 const interests=v.interests || []; if(!Array.isArray(interests)||interests.length>20) fail(400,'قائمة الاهتمامات غير صالحة.');
 output[lang]={displayName:textField(v.displayName,100,'الاسم',true),role:textField(v.role,200,'الصفة',true),tagline:textField(v.tagline,600,'الوصف'),bio:textField(v.bio,6000,'النبذة'),interests:interests.map(x=>textField(x,150,'الاهتمام',true))}; }
 return output;
}
function validateResearch(body) {
 const v=body.record || body;
 if(!['masters_thesis','doctoral_thesis','article','other'].includes(v.type)||!['published','in_progress'].includes(v.status)||!['draft','public'].includes(v.visibility||'draft')) fail(400,'نوع العمل أو حالته غير صالحة.');
 if((v.visibility||'draft')==='public'&&v.status!=='published')fail(400,'لا يُسمح بعرض عمل لم يُنشر رسميًا. احفظه مسودة خاصة.');
 const out={id:textField(v.id,100,'معرّف العمل'),title:{},summary:{},keywords:{},type:v.type,status:v.status,visibility:v.visibility||'draft'};
 if(out.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.id)) fail(400,'معرّف العمل يقبل أحرفًا لاتينية صغيرة وأرقامًا وواصلات فقط.');
 for(const lang of LANGS){out.title[lang]=textField(v.title?.[lang],500,'العنوان',out.visibility==='public');out.summary[lang]=textField(v.summary?.[lang],12000,'الملخص');const k=v.keywords?.[lang]||[];if(!Array.isArray(k)||k.length>20) fail(400,'الكلمات المفتاحية كثيرة.');out.keywords[lang]=k.map(x=>textField(x,100,'الكلمة المفتاحية',true));}
 if(!LANGS.some(l=>out.title[l]))fail(400,'اكتب عنوان العمل بلغة واحدة على الأقل.');
 if(v.year!=null && (!Number.isInteger(v.year)||v.year<1000||v.year>2100)) fail(400,'سنة العمل غير صالحة.');
 return {...out,year:v.year??null,officialUrl:cleanUrl(v.officialUrl,'المصدر'),imageUrl:cleanUrl(v.imageUrl,'الصورة'),videoUrl:cleanUrl(v.videoUrl,'الفيديو')};
}
