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

function intSetting(env,key,fallback,min,max){const n=Number(env[key]??fallback);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
function parseDocument(row){try{return JSON.parse(row.document);}catch{fail(503,'تحتاج البيانات المحفوظة إلى مراجعة.');}}
async function rows(env,sql,...args){return (await env.DB.prepare(sql).bind(...args).all()).results||[];}
async function notificationSummary(request, env, url) {
 await requireNotificationAccess(request,env);
 if(request.method!=='GET')fail(405,'هذه الطريقة غير متاحة.');
 if(url.searchParams.getAll('after').length!==1||[...url.searchParams.keys()].some(k=>k!=='after'))fail(400,'مؤشر التنبيهات غير صالح.');
 const raw=url.searchParams.get('after');
 if(!/^(0|[1-9][0-9]*)$/.test(raw))fail(400,'مؤشر التنبيهات غير صالح.');
 const after=Number(raw);if(!Number.isSafeInteger(after))fail(400,'مؤشر التنبيهات غير صالح.');
 const entries=await rows(env,"SELECT key,value FROM settings WHERE key IN ('contact_notification_sequence','contact_notification_latest_at')");
 const values=Object.fromEntries(entries.map(row=>[row.key,row.value]));
 if(!Object.hasOwn(values,'contact_notification_sequence')||!Object.hasOwn(values,'contact_notification_latest_at')||!/^(0|[1-9][0-9]*)$/.test(values.contact_notification_sequence))fail(503,'يلزم إكمال تهيئة عداد التنبيهات.');
 const sequence=Number(values.contact_notification_sequence);if(!Number.isSafeInteger(sequence))fail(503,'يحتاج عداد التنبيهات إلى مراجعة.');
 if(after>sequence)fail(409,'مؤشر التنبيهات يسبق العداد الحالي؛ راجع التهيئة قبل استئناف الإرسال.');
 let latestAt=null;
 if(sequence>0){
  const latest=Number(values.contact_notification_latest_at);
  if(!Number.isSafeInteger(latest)||latest<0||!Number.isFinite(new Date(latest*1000).getTime()))fail(503,'يحتاج وقت التنبيهات إلى مراجعة.');
  latestAt=new Date(latest*1000).toISOString();
 }
 return json({sequence,pending:sequence-after,latestAt},200,{'X-Robots-Tag':'noindex, nofollow'});
}
async function snapshot(env){
 const p=await env.DB.prepare('SELECT document FROM profile WHERE id=1').first();
 if(!p)fail(409,'استورد المحتوى الحالي قبل النشر.');
 const profile=validateProfile(parseDocument(p));
 const workRows=await rows(env,"SELECT document FROM research WHERE visibility='public' ORDER BY year DESC,created_at ASC LIMIT 200");
 const works=workRows.map(parseDocument).filter(work=>work.status==='published').map(work=>{const {visibility,...record}=validateResearch({...work,visibility:'public'});return record;});
 if(!works.some(w=>w.id==='sharh-al-tawilat-2021'))fail(409,'لم يوجد سجل الماجستير المعتمد؛ أعد استيراد المصدر أو حفظه قبل النشر.');
 return {schemaVersion:1,profile,works};
}
async function githubRead(env,fetchImpl){
 const url='https://api.github.com/repos/'+REPOSITORY+'/contents/'+DATA_PATH+'?ref=main';
 const res=await fetchImpl(url,{headers:{...(env.GITHUB_TOKEN?{Authorization:'Bearer '+env.GITHUB_TOKEN}:{}),Accept:'application/vnd.github+json','User-Agent':'TurkiAhmet-Private-Admin','X-GitHub-Api-Version':'2022-11-28'}});
 if(!res.ok)fail(503,'تعذر قراءة مصدر GitHub. تحقق من صلاحية الربط بالمستودع.');
 const data=await res.json();if(!data.sha||data.type!=='file')fail(503,'مصدر النشر غير موجود في المستودع.');return data;
}
function utf8Base64(value){let s='';for(const b of encoder.encode(value))s+=String.fromCharCode(b);return btoa(s);}
async function importCurrent(env,fetchImpl,session,clock){
 const existing=await env.DB.prepare('SELECT document FROM profile WHERE id=1').first();
 if(existing)fail(409,'سبق استيراد المحتوى؛ لن يستبدل المحتوى المحفوظ تلقائيًا.');
 const source=await githubRead(env,fetchImpl);let seed;try{seed=JSON.parse(decoder.decode(Uint8Array.from(atob((source.content||'').replace(/\s/g,'')),c=>c.charCodeAt(0))));}catch{fail(503,'لم يتوفر مصدر الموقع الجديد للاستيراد بعد.');}if(seed.schemaVersion!==1||!Array.isArray(seed.works)||seed.works.length>200)fail(400,'صيغة مصدر الموقع غير صالحة.');
 const profile=validateProfile(seed.profile), works=seed.works.map(w=>validateResearch({...w,visibility:w.status==='published'?'public':'draft'}));
 if(!works.some(w=>w.id==='sharh-al-tawilat-2021'))fail(400,'يجب أن يتضمن المصدر سجل الماجستير المعتمد.');
 const now=nowSeconds(clock),statements=[env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('publication_base_sha',source.sha),env.DB.prepare('INSERT INTO profile(id,document,updated_at) VALUES(1,?,?)').bind(JSON.stringify(profile),now)];
 for(const work of works)statements.push(env.DB.prepare('INSERT INTO research(id,document,year,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(work.id,JSON.stringify(work),work.year,work.visibility,now,now));
 statements.push(env.DB.prepare('INSERT INTO revisions(kind,record_id,document,actor_sub,created_at) VALUES(?,?,?,?,?)').bind('import','site',JSON.stringify({count:works.length,source:SEED_URL}),session.sub,now));
 await env.DB.batch(statements);return {imported:true,works:works.length};
}
function csvEscape(value){let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function csv(headers,data){return '\uFEFF'+[headers,...data].map(r=>r.map(csvEscape).join(',')).join('\r\n');}
async function readUpload(request,env){
 const limit=intSetting(env,'OWNER_UPLOAD_MAX_BYTES',5*1024*1024,100*1024,10*1024*1024);
 const contentType=request.headers.get('Content-Type')||'';
 if(!/^multipart\/form-data;\s*boundary=/i.test(contentType))fail(415,'اختر ملفًا باستخدام نموذج الرفع.');
 const length=Number(request.headers.get('Content-Length'));if(Number.isFinite(length)&&length>limit+32768)fail(413,'الملف أكبر من حد الرفع المسموح.');
 if(!request.body)fail(400,'لم يُرسل ملف.');const reader=request.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit+32768){await reader.cancel();fail(413,'الملف أكبر من حد الرفع المسموح.');}chunks.push(value);}
 const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
 let form;try{form=await new Request(request.url,{method:'POST',headers:{'Content-Type':contentType},body:buffer}).formData();}catch{fail(400,'تعذرت قراءة الملف المرسل.');}
 if([...form.keys()].some(k=>!['file','kind'].includes(k))||form.getAll('file').length!==1||form.getAll('kind').length!==1)fail(400,'ارفع ملفًا واحدًا وحدد نوعه.');
 const file=form.get('file'),kind=form.get('kind');if(!file||typeof file.arrayBuffer!=='function'||!['image','cv'].includes(kind))fail(400,'اختر صورة أو ملف سيرة PDF.');
 if(file.size<1||file.size>limit)fail(413,'حجم الملف خارج الحد المسموح.');
 const bytes=new Uint8Array(await file.arrayBuffer());const mime=String(file.type).toLowerCase();let ext='';
 if(kind==='cv'&&mime==='application/pdf'){
  const head=new TextDecoder('latin1').decode(bytes.subarray(0,12)),tail=new TextDecoder('latin1').decode(bytes.subarray(Math.max(0,bytes.length-1024)));
  if(!/^%PDF-[12]\.[0-9](?:\r|\n|\s)/.test(head)||!tail.includes('%%EOF'))fail(415,'الملف ليس PDF مدعومًا.');ext='pdf';
 }else if(kind==='image'&&mime==='image/png'){
  const magic=[137,80,78,71,13,10,26,10];if(bytes.length<33||!magic.every((b,i)=>bytes[i]===b)||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')fail(415,'الصورة ليست PNG مدعومة.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(8)!==13||!view.getUint32(16)||!view.getUint32(20)||view.getUint32(16)>20000||view.getUint32(20)>20000)fail(415,'أبعاد صورة PNG غير مدعومة.');ext='png';
 }else if(kind==='image'&&mime==='image/jpeg'){
  if(bytes.length<5||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)fail(415,'الصورة ليست JPEG مدعومة.');ext='jpg';
 }else if(kind==='image'&&mime==='image/webp'){
  if(bytes.length<20||String.fromCharCode(...bytes.subarray(0,4))!=='RIFF'||String.fromCharCode(...bytes.subarray(8,12))!=='WEBP'||!['VP8 ','VP8L','VP8X'].includes(String.fromCharCode(...bytes.subarray(12,16)))||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)!==bytes.length-8)fail(415,'الصورة ليست WebP مدعومة.');ext='webp';
 }else fail(415,'الأنواع المسموحة صور PNG وJPEG وWebP، وسيرة PDF فقط. لا تُقبل ملفات HTML أو SVG.');
 return {bytes,mime,ext,kind,size:file.size};
}
function bytesBase64(bytes){const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(chunks.join(''));}
async function uploadPublicFile(request,env,session,fetchImpl,clock){
 if(!env.GITHUB_TOKEN)fail(503,'يلزم إعداد ربط المستودع قبل رفع الملفات العامة.');
 const file=await readUpload(request,env);const path='site/uploads/'+(file.kind==='cv'?'cv/':'images/')+crypto.randomUUID()+'.'+file.ext;
 const response=await fetchImpl('https://api.github.com/repos/'+REPOSITORY+'/contents/'+path,{method:'PUT',headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'TurkiAhmet-Private-Admin','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({message:'Upload owner-approved public '+(file.kind==='cv'?'CV PDF':'image'),content:bytesBase64(file.bytes),branch:'main'})});
 if(response.status===409||response.status===422)fail(409,'تعذر إنشاء مسار الملف؛ راجع المصدر قبل إعادة الرفع.');if(!response.ok)fail(503,'تعذر رفع الملف إلى GitHub؛ لم يثبت حفظه.');
 const result=await response.json();if(!/^[0-9a-f]{40}$/.test(result.commit?.sha||''))fail(503,'لم يصل معرّف حفظ الملف. راجع GitHub قبل إعادة الرفع.');
 const receipt={path,url:SITE_ORIGIN+'/'+path.slice(5),mime:file.mime,kind:file.kind,size:file.size,commit:result.commit.sha,fileSha:result.content?.sha||null,createdAt:new Date(clock()).toISOString()};
 await env.DB.prepare('INSERT INTO revisions(kind,record_id,document,actor_sub,created_at) VALUES(?,?,?,?,?)').bind('upload',path,JSON.stringify(receipt),session.sub,nowSeconds(clock)).run();
 return {...receipt,committed:true,actionsUrl:'https://github.com/'+REPOSITORY+'/actions',note:'حُفظ الملف في المستودع العام. يبدأ النشر التلقائي؛ تحقق من نجاح التشغيل قبل مشاركة الرابط.'};
}

export function createApp({fetchImpl=fetch,clock=Date.now,assets={}}={}){
 return {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,'')||'/';
  const isPublic=['/api/contact','/api/analytics','/api/config'].includes(path);
  try{
   if(path==='/api/notifications/summary')return await notificationSummary(request,env,url);
   if(isPublic&&request.method==='OPTIONS'){
    requireOrigin(request,SITE_ORIGIN);return new Response(null,{status:204,headers:publicHeaders()});
   }
   if(path==='/health'&&request.method==='GET')return json({service:'turkiahmet-private-admin',configured:!!(env.DB&&env.GOOGLE_CLIENT_ID&&env.SESSION_SECRET),publicSite:SITE_ORIGIN});
   if(path==='/api/config'&&request.method==='GET'){
    let ready=false;try{config(env,request);ready=true;}catch{}
    return publicJson({contactEnabled:ready&&env.CONTACT_ENABLED==='true',maxMessageLength:intSetting(env,'CONTACT_MAX_LENGTH',3000,100,10000),analyticsEnabled:ready&&env.ANALYTICS_ENABLED==='true',adminUrl:url.origin+'/admin'});
   }
   if(path==='/api/contact'){
    if(request.method!=='POST')fail(405,'هذه الطريقة غير متاحة.');const cfg=config(env,request);requireOrigin(request,SITE_ORIGIN);
    if(env.CONTACT_ENABLED!=='true')fail(503,'نموذج التواصل غير مفعّل الآن.');
    const body=await readJson(request,32768),allowed=new Set(['name','email','subject','message','website']);
    if(Object.keys(body).some(k=>!allowed.has(k)))fail(400,'المرفقات والحقول الإضافية غير مدعومة.');
    if(body.website)return publicJson({received:true},201);
    const max=intSetting(env,'CONTACT_MAX_LENGTH',3000,100,10000),name=textField(body.name,120,'الاسم'),email=textField(body.email,254,'البريد'),subject=textField(body.subject,240,'الموضوع'),message=textField(body.message,max*2,'الرسالة',true);
    if(Array.from(message).length>max)fail(400,'الرسالة أطول من الحد المسموح.');
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'البريد الإلكتروني غير صالح.');
    await rateLimit(request,env,cfg,clock,'contact',intSetting(env,'CONTACT_HOURLY_LIMIT',5,1,100));
    const id=crypto.randomUUID(),now=nowSeconds(clock),cap=intSetting(env,'CONTACT_CAPACITY',1000,100,10000);
    const saved=await env.DB.prepare('INSERT INTO contacts(id,name,email,subject,message,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM contacts)<? RETURNING id').bind(id,name,email,subject,message,now,cap).first();
    if(!saved)fail(503,'صندوق الرسائل ممتلئ مؤقتًا. يمكنك استخدام البريد المباشر.');
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now).run();
    return publicJson({received:true},201);
   }
   if(path==='/api/analytics'){
    if(request.method!=='POST')fail(405,'هذه الطريقة غير متاحة.');const cfg=config(env,request);requireOrigin(request,SITE_ORIGIN);
    if(env.ANALYTICS_ENABLED!=='true')return new Response(null,{status:204,headers:publicHeaders()});
    const body=await readJson(request,2048);
    if(Object.keys(body).some(k=>!['path','referrer','visit'].includes(k)))fail(400,'صيغة إحصاء الزيارة غير صالحة.');
    const p=textField(body.path,250,'المسار',true);
    if(p!=='/'&&!/^\/(ar|tr|en)(\/[a-z0-9-]+)*\/?$/.test(p))fail(400,'المسار غير صالح.');
    const ua=request.headers.get('User-Agent')||'';
    if(/bot|spider|crawler|headless|preview|monitor|uptime/i.test(ua)||request.cf?.botManagement?.verifiedBot)return new Response(null,{status:204,headers:publicHeaders()});
    await rateLimit(request,env,cfg,clock,'analytics',120);
    let ref='direct';if(body.referrer){try{ref=new URL(body.referrer).hostname.toLowerCase().slice(0,120);if(ref===new URL(SITE_ORIGIN).hostname)ref='internal';}catch{fail(400,'مصدر الزيارة غير صالح.');}}
    const country=/^[A-Z]{2}$/.test(request.cf?.country||'')?request.cf.country:'XX',device=/mobile|android|iphone/i.test(ua)?'mobile':/ipad|tablet/i.test(ua)?'tablet':'desktop';
    const day=new Date(clock()).toISOString().slice(0,10);
    await env.DB.prepare('INSERT INTO analytics_daily(day,path,country,referrer,device,views,visits) VALUES(?,?,?,?,?,1,?) ON CONFLICT(day,path,country,referrer,device) DO UPDATE SET views=views+1,visits=visits+excluded.visits').bind(day,p,country,ref,device,body.visit===true?1:0).run();
    return new Response(null,{status:204,headers:publicHeaders()});
   }
   if(path==='/login.css'&&request.method==='GET')return page(assets.css||'', 'text/css; charset=utf-8');
   if(path==='/login.js'&&request.method==='GET')return page(assets.loginJs||'', 'text/javascript; charset=utf-8');
   if(path.startsWith('/api/admin')){
    const cfg=config(env,request);
    if(path==='/api/admin/config'&&request.method==='GET')return json({clientId:cfg.clientId,ownerHint:OWNER_EMAIL});
    if(path==='/api/admin/nonce'&&request.method==='GET'){
     await rateLimit(request,env,cfg,clock,'login',20);const nonce=randomToken(),now=nowSeconds(clock);
     await env.DB.batch([env.DB.prepare('DELETE FROM admin_nonces WHERE expires_at<=?').bind(now),env.DB.prepare('INSERT INTO admin_nonces(nonce_hash,expires_at) VALUES(?,?)').bind(await digest(nonce),now+LOGIN_SECONDS)]);
     return json({nonce},200,{'Set-Cookie':cookie(LOGIN_COOKIE,await signPayload({type:'login',nonce,iat:now,exp:now+LOGIN_SECONDS},cfg.secret),LOGIN_SECONDS)});
    }
    if(path==='/api/admin/login'&&request.method==='POST'){
     requireOrigin(request,cfg.origin);const body=await readJson(request,20000),now=nowSeconds(clock),login=await verifyPayload(readCookie(request,LOGIN_COOKIE),cfg.secret,now,'login');
     if(body.nonce!==login.nonce)fail(401,'انتهت محاولة الدخول؛ حدّث الصفحة.');
     const claims=await verifyGoogleToken(body.credential,cfg.clientId,login.nonce,fetchImpl,clock);
     if(env.OWNER_GOOGLE_SUB&&claims.sub!==env.OWNER_GOOGLE_SUB)fail(403,'هذا الحساب غير مخول.');
     const used=await env.DB.prepare('DELETE FROM admin_nonces WHERE nonce_hash=? AND expires_at>? RETURNING nonce_hash').bind(await digest(login.nonce),now).first();if(!used)fail(401,'انتهت محاولة الدخول.');
     await env.DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').bind('owner_google_sub',claims.sub).run();if(await storedOwner(env)!==claims.sub)fail(403,'هذا الحساب غير مخول.');
     const session={type:'session',sid:randomToken(),sub:claims.sub,email:OWNER_EMAIL,csrf:randomToken(),iat:now,exp:now+SESSION_SECONDS};
     await env.DB.batch([env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),env.DB.prepare('INSERT INTO admin_sessions(sid_hash,owner_sub,expires_at) VALUES(?,?,?)').bind(await digest(session.sid),session.sub,session.exp)]);
     const res=json({authenticated:true});res.headers.append('Set-Cookie',cookie(SESSION_COOKIE,await signPayload(session,cfg.secret),SESSION_SECONDS));res.headers.append('Set-Cookie',cookie(LOGIN_COOKIE,'',0));return res;
    }
    const session=await requireSession(request,env,cfg,clock);
    if(path==='/api/admin/session'&&request.method==='GET')return json({authenticated:true,email:OWNER_EMAIL,csrfToken:session.csrf});
    if(!['GET','HEAD'].includes(request.method)){requireOrigin(request,cfg.origin);requireCsrf(request,session);}
    if(path==='/api/admin/logout'&&request.method==='POST'){await env.DB.prepare('DELETE FROM admin_sessions WHERE sid_hash=?').bind(await digest(session.sid)).run();return json({authenticated:false},200,{'Set-Cookie':cookie(SESSION_COOKIE,'',0)});}
    if(path==='/api/admin/uploads'&&request.method==='GET')return json({uploads:(await rows(env,"SELECT document FROM revisions WHERE kind='upload' ORDER BY id DESC LIMIT 100")).map(parseDocument),maxBytes:intSetting(env,'OWNER_UPLOAD_MAX_BYTES',5*1024*1024,100*1024,10*1024*1024)});
    if(path==='/api/admin/uploads'&&request.method==='POST')return json(await uploadPublicFile(request,env,session,fetchImpl,clock),201);
    if(path==='/api/admin/import'&&request.method==='POST')return json(await importCurrent(env,fetchImpl,session,clock));
    if(path==='/api/admin/profile'&&request.method==='GET'){const row=await env.DB.prepare('SELECT document FROM profile WHERE id=1').first();return json({profile:row?parseDocument(row):null});}
    if(path==='/api/admin/profile'&&request.method==='PUT'){
     const profile=validateProfile(await readJson(request)),now=nowSeconds(clock),document=JSON.stringify(profile);
     await env.DB.batch([env.DB.prepare('INSERT INTO profile(id,document,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at').bind(document,now),env.DB.prepare('INSERT INTO revisions(kind,record_id,document,actor_sub,created_at) VALUES(?,?,?,?,?)').bind('profile','1',document,session.sub,now)]);return json({saved:true});
    }
    if(path==='/api/admin/research'&&request.method==='GET')return json({records:(await rows(env,'SELECT document FROM research ORDER BY updated_at DESC LIMIT 200')).map(parseDocument)});
    if((path==='/api/admin/research'&&request.method==='POST')||(/^\/api\/admin\/research\/[a-z0-9-]{1,100}$/.test(path)&&request.method==='PUT')){
     const record=validateResearch(await readJson(request)),id=request.method==='POST'?(record.id||'work-'+crypto.randomUUID()):path.split('/').at(-1),now=nowSeconds(clock);record.id=id;
     if(request.method==='POST'&&await env.DB.prepare('SELECT id FROM research WHERE id=?').bind(id).first())fail(409,'معرّف العمل مستخدم.');
     if(request.method==='PUT'&&!await env.DB.prepare('SELECT id FROM research WHERE id=?').bind(id).first())fail(404,'العمل غير موجود.');
     const document=JSON.stringify(record);await env.DB.batch([env.DB.prepare('INSERT INTO research(id,document,year,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,year=excluded.year,visibility=excluded.visibility,updated_at=excluded.updated_at').bind(id,document,record.year,record.visibility,now,now),env.DB.prepare('INSERT INTO revisions(kind,record_id,document,actor_sub,created_at) VALUES(?,?,?,?,?)').bind('research',id,document,session.sub,now)]);return json({record},request.method==='POST'?201:200);
    }
    if(path==='/api/admin/preview'&&request.method==='GET')return json({source:await snapshot(env),note:'معاينة البيانات العامة التي ستُنشر؛ المسودات الخاصة مستبعدة.'});
    if(path==='/api/admin/publish'&&request.method==='POST'){
     const data=await snapshot(env),document=JSON.stringify(data,null,2)+'\n';if(encoder.encode(document).length>750000)fail(413,'حجم مصدر المحتوى كبير؛ يلزم تقسيمه قبل النشر.');
     if(!env.GITHUB_TOKEN)fail(503,'يلزم إعداد ربط النشر الخاص بالمستودع قبل النشر.');const current=await githubRead(env,fetchImpl);const baseline=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('publication_base_sha').first();if(!baseline||baseline.value!==current.sha)fail(409,'تغير مصدر الموقع خارج اللوحة؛ يلزم مراجعة التغييرات ودمجها قبل النشر.');const response=await fetchImpl('https://api.github.com/repos/'+REPOSITORY+'/contents/'+DATA_PATH,{method:'PUT',headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'TurkiAhmet-Private-Admin','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({message:'Update public academic content from owner dashboard',content:utf8Base64(document),sha:current.sha,branch:'main'})});
     if(response.status===409||response.status===422)fail(409,'تغير المصدر أثناء النشر؛ راجع النسخة الحالية قبل إعادة المحاولة.');if(!response.ok)fail(503,'تعذر حفظ المحتوى في GitHub؛ لم يثبت النشر.');
     const result=await response.json();if(!/^[0-9a-f]{40}$/.test(result.commit?.sha||''))fail(503,'لم تُستلم هوية نشر صالحة.');
     if(!/^[0-9a-f]{40}$/.test(result.content?.sha||''))fail(503,'حُفظ المصدر لكن يلزم مراجعة معرّف الملف قبل أي نشر جديد.');await env.DB.prepare('UPDATE settings SET value=? WHERE key=?').bind(result.content.sha,'publication_base_sha').run();
     await env.DB.prepare('INSERT INTO revisions(kind,record_id,document,actor_sub,created_at) VALUES(?,?,?,?,?)').bind('publish','site',JSON.stringify({commit:result.commit.sha}),session.sub,nowSeconds(clock)).run();
     return json({committed:true,commit:result.commit.sha,actionsUrl:'https://github.com/'+REPOSITORY+'/actions',note:'حُفظ المصدر؛ يبدأ النشر التلقائي. تحقق من نجاح التشغيل قبل اعتبار التعديل ظاهرًا.'});
    }
    if(path==='/api/admin/publication'&&request.method==='GET'){
     const row=await env.DB.prepare("SELECT document,created_at FROM revisions WHERE kind='publish' ORDER BY id DESC LIMIT 1").first();
     if(!row)return json({publishedFromDashboard:false});const commit=parseDocument(row).commit;
     if(!env.GITHUB_TOKEN)return json({commit,status:'unknown'});
     const response=await fetchImpl('https://api.github.com/repos/'+REPOSITORY+'/actions/runs?head_sha='+commit+'&per_page=10',{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'TurkiAhmet-Private-Admin','X-GitHub-Api-Version':'2022-11-28'}});
     if(!response.ok)return json({commit,status:'unknown',actionsUrl:'https://github.com/'+REPOSITORY+'/actions'});
     const payload=await response.json(),run=(payload.workflow_runs||[]).find(x=>x.name==='Publish academic website')||(payload.workflow_runs||[])[0];
     return json({commit,status:run?.status||'queued',conclusion:run?.conclusion||null,actionsUrl:run?.html_url||'https://github.com/'+REPOSITORY+'/actions'});
    }
    if(path==='/api/admin/revisions'&&request.method==='GET')return json({revisions:await rows(env,'SELECT id,kind,record_id,document,created_at FROM revisions ORDER BY id DESC LIMIT 100')});
    if(/^\/api\/admin\/revisions\/[0-9]+\/restore$/.test(path)&&request.method==='POST'){
     const row=await env.DB.prepare('SELECT kind,record_id,document FROM revisions WHERE id=?').bind(Number(path.split('/').at(-2))).first();if(!row||!['profile','research'].includes(row.kind))fail(404,'هذه النسخة غير قابلة للاستعادة.');
     const now=nowSeconds(clock);let data;if(row.kind==='profile'){data=validateProfile(parseDocument(row));await env.DB.prepare('UPDATE profile SET document=?,updated_at=? WHERE id=1').bind(JSON.stringify(data),now).run();}else{data=validateResearch({...parseDocument(row),visibility:'draft'});await env.DB.prepare('UPDATE research SET document=?,year=?,visibility=?,updated_at=? WHERE id=?').bind(JSON.stringify(data),data.year,'draft',now,row.record_id).run();}
     await env.DB.prepare('INSERT INTO revisions(kind,record_id,document,actor_sub,created_at) VALUES(?,?,?,?,?)').bind(row.kind,row.record_id,JSON.stringify(data),session.sub,now).run();return json({restored:true,published:false});
    }
    if(path==='/api/admin/inbox'&&request.method==='GET'){
     const m=await rows(env,'SELECT id,name,email,subject,message,created_at,read_at,archived_at FROM contacts ORDER BY created_at DESC LIMIT 1000'),count=await env.DB.prepare('SELECT COUNT(*) AS count FROM contacts').first();
     return json({messages:m.map(({created_at,read_at,archived_at,...v})=>({...v,createdAt:new Date(created_at*1000).toISOString(),readAt:read_at?new Date(read_at*1000).toISOString():null,archivedAt:archived_at?new Date(archived_at*1000).toISOString():null})),storedCount:count.count,capacity:intSetting(env,'CONTACT_CAPACITY',1000,100,10000),retentionDays:0});
    }
    if(path==='/api/admin/inbox/export'&&request.method==='GET'){
     const records=await rows(env,'SELECT id,name,email,subject,message,created_at,read_at,archived_at FROM contacts ORDER BY created_at DESC LIMIT 10000');
     return new Response(csv(['id','name','email','subject','message','created_at','read_at','archived_at'],records.map(v=>Object.values(v))),{headers:{...securityHeaders('text/csv; charset=utf-8'),'Content-Disposition':'attachment; filename="private-inbox.csv"'}});
    }
    if(/^\/api\/admin\/inbox\/[0-9a-f-]{36}\/(read|archive)$/.test(path)&&request.method==='POST'){
     const action=path.split('/').at(-1);await env.DB.prepare('UPDATE contacts SET '+(action==='read'?'read_at':'archived_at')+'=? WHERE id=?').bind(nowSeconds(clock),path.split('/').at(-2)).run();return json({updated:true});
    }
    if(/^\/api\/admin\/inbox\/[0-9a-f-]{36}$/.test(path)&&request.method==='DELETE'){await env.DB.prepare('DELETE FROM contacts WHERE id=?').bind(path.split('/').at(-1)).run();return json({deleted:true});}
    if(path==='/api/admin/analytics'&&request.method==='GET'){
     const n=Number(url.searchParams.get('days')||30),days=[1,7,30,90,365].includes(n)?n:30,since=new Date(clock()-(days-1)*86400000).toISOString().slice(0,10);
     const totals=await env.DB.prepare('SELECT COALESCE(SUM(views),0) AS views,COALESCE(SUM(visits),0) AS visits FROM analytics_daily WHERE day>=?').bind(since).first();
     const timeline=await rows(env,'SELECT day,SUM(views) AS views,SUM(visits) AS visits FROM analytics_daily WHERE day>=? GROUP BY day ORDER BY day',since);
     const grouped={};for(const col of ['path','country','referrer','device'])grouped[col]=await rows(env,'SELECT '+col+' AS label,SUM(views) AS views,SUM(visits) AS visits FROM analytics_daily WHERE day>=? GROUP BY '+col+' ORDER BY views DESC LIMIT 20',since);
     return json({days,since,totals,timeline,grouped,updatedAt:new Date(clock()).toISOString(),definition:'المشاهدات أحداث تحميل مرسلة من المتصفح؛ الزيارات جلسات تصفح تقديرية. لا أسماء أو عناوين IP كاملة ولا أشخاص فريدون. تبدأ البيانات بعد التفعيل.'});
    }
    fail(404,'هذا المسار غير متاح.');
   }
   if(path==='/'||path==='/login')return new Response(null,{status:302,headers:{Location:'/admin','Cache-Control':'no-store'}});
   if(path==='/admin'||path==='/admin.js'||path==='/admin.css'){
    const cfg=config(env,request);try{await requireSession(request,env,cfg,clock);}catch(error){if(path==='/admin'&&error.status===401)return page(assets.loginHtml||'');throw error;}
    return page(path==='/admin'?(assets.adminHtml||''):path==='/admin.js'?(assets.adminJs||''):(assets.css||''),path==='/admin'?'text/html; charset=utf-8':path==='/admin.js'?'text/javascript; charset=utf-8':'text/css; charset=utf-8');
   }
   fail(404,'هذه الصفحة غير متاحة.');
  }catch(error){const res=json({error:error instanceof AppError?error.message:'تعذر إكمال العملية الآن؛ حاول لاحقًا.'},error instanceof AppError?error.status:503);if(isPublic)for(const[k,v]of Object.entries(publicHeaders()))res.headers.set(k,v);return res;}
 }};
}
export {signPayload,verifyGoogleToken,validateProfile,validateResearch,readJson,csvEscape};

const embeddedAssets = {"loginHtml":"<!doctype html><html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>دخول المالك</title><link rel=\"stylesheet\" href=\"/login.css\"><script src=\"/login.js\" defer></script></head><body><main class=\"container\"><section class=\"card login-panel\"><p class=\"eyebrow\">تركي الاحمد · إدارة الموقع</p><h1>دخول المالك</h1><p>تُفتح أدوات التحرير والرسائل والإحصاءات بعد التحقق من الحساب المصرح له.</p><p id=\"login-note\" class=\"muted\"></p><div id=\"google-signin\"></div><p id=\"status\" role=\"status\" aria-live=\"polite\" class=\"status\"></p><p><a href=\"https://turkiahmet.github.io/ar/\">الموقع العام</a></p></section></main></body></html>\n","loginJs":"'use strict';\n(async()=>{\n const status=document.getElementById('status');\n async function api(path,data){const response=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{Accept:'application/json'},body:data?JSON.stringify(data):undefined});const value=await response.json();if(!response.ok)throw new Error(value.error||'تعذر تسجيل الدخول.');return value;}\n try{\n  const config=await api('/api/admin/config');document.getElementById('login-note').textContent='الحساب المصرح له: '+config.ownerHint;\n  const challenge=await api('/api/admin/nonce');\n  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.onload=resolve;script.onerror=()=>reject(new Error('تعذر تحميل تسجيل الدخول من Google.'));document.head.append(script);});\n  google.accounts.id.initialize({client_id:config.clientId,nonce:challenge.nonce,auto_select:false,callback:async result=>{try{status.textContent='جارٍ التحقق من الحساب…';await api('/api/admin/login',{credential:result.credential,nonce:challenge.nonce});location.assign('/admin');}catch(error){status.textContent=error.message;}}});\n  google.accounts.id.renderButton(document.getElementById('google-signin'),{type:'standard',theme:'outline',size:'large',locale:'ar',width:280});\n }catch(error){status.textContent=error.message;}\n})();\n","adminHtml":"<!doctype html><html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>لوحة تحكم تركي الاحمد</title><link rel=\"stylesheet\" href=\"/admin.css\"><script src=\"/admin.js\" defer></script></head><body><a class=\"skip-link\" href=\"#main\">انتقل إلى المحتوى</a><header class=\"admin-header\"><div><p class=\"eyebrow\">تركي الاحمد</p><h1>لوحة التحكم الخاصة</h1><p id=\"session-email\" class=\"muted\"></p></div><div class=\"header-actions\"><a href=\"https://turkiahmet.github.io/ar/\" target=\"_blank\" rel=\"noopener\">الموقع العام</a><button id=\"logout\" type=\"button\" class=\"secondary\">خروج</button></div></header><main id=\"main\" class=\"container\"><p id=\"status\" role=\"status\" aria-live=\"polite\" class=\"status\"></p><nav class=\"section-nav\" aria-label=\"أقسام الإدارة\"><a href=\"#publication\">النشر</a><a href=\"#profile\">النبذة</a><a href=\"#works\">الأعمال</a><a href=\"#uploads\">الملفات العامة</a><a href=\"#inbox\">الرسائل</a><a href=\"#analytics\">الإحصاءات</a><a href=\"#history\">السجل</a></nav>\n<section id=\"publication\" class=\"card\"><h2>المصدر والنشر</h2><p class=\"muted\">المسودات والرسائل تبقى في الإدارة. لا يظهر المحتوى للزوار إلا بعد اعتماد نشره ونجاح GitHub Actions.</p><div class=\"form-actions\"><button id=\"import\" class=\"secondary\">استيراد الموقع الحالي أول مرة</button><button id=\"preview\" class=\"secondary\">معاينة البيانات العامة</button><button id=\"publish\">اعتماد النشر إلى الموقع</button><button id=\"publication-status\" class=\"secondary\">تحقق من النشر</button></div><p id=\"publication-result\" class=\"muted\" aria-live=\"polite\"></p><pre id=\"preview-data\" dir=\"ltr\" hidden></pre></section>\n<section id=\"publish-confirm\" class=\"card\" role=\"group\" aria-label=\"تأكيد النشر\" hidden><h2>تأكيد النشر إلى الموقع</h2><p>ستُنشر البيانات العامة المعتمدة فقط. تبقى المسودات والرسائل خاصة.</p><div class=\"form-actions\"><button id=\"publish-confirm-yes\" type=\"button\">نعم، انشر البيانات المعتمدة</button><button id=\"publish-confirm-cancel\" type=\"button\" class=\"secondary\">إلغاء النشر</button></div></section>\n<section id=\"profile\" class=\"card\"><h2>النبذة والهوية</h2><form id=\"profile-form\"><div id=\"profile-fields\" class=\"language-grid\"></div><button type=\"submit\">حفظ النبذة في الإدارة</button></form></section>\n<section id=\"works\" class=\"card\"><div class=\"section-heading\"><h2>الأعمال العلمية</h2><button id=\"new-work\" class=\"secondary\">إضافة عمل</button></div><div id=\"work-list\" class=\"research-list\"></div><form id=\"work-form\" class=\"editor\" hidden><h3>تحرير العمل</h3><label>معرّف ثابت للعمل<input id=\"work-id\" dir=\"ltr\" maxlength=\"100\" pattern=\"[a-z0-9-]+\"><small>للعمل الجديد: حروف لاتينية صغيرة وأرقام وواصلات. لا تغير معرّف سجل الماجستير.</small></label><div id=\"work-fields\" class=\"language-grid\"></div><div class=\"field-grid\"><label>نوع العمل<select id=\"work-type\"><option value=\"article\">مقال علمي</option><option value=\"masters_thesis\">ماجستير</option><option value=\"doctoral_thesis\">دكتوراه</option><option value=\"other\">عمل آخر</option></select></label><label>الحالة العلمية<select id=\"work-status\"><option value=\"published\">منشور رسميًا</option><option value=\"in_progress\">قيد الإعداد</option></select></label><label>الظهور في الموقع<select id=\"work-visibility\"><option value=\"draft\">مسودة خاصة</option><option value=\"public\">ضمن النشر العام القادم</option></select></label><label>سنة ثابتة، إن وجدت<input id=\"work-year\" type=\"number\" min=\"1000\" max=\"2100\"></label><label class=\"wide-field\">المصدر الرسمي<input id=\"work-officialUrl\" type=\"url\" dir=\"ltr\" maxlength=\"2000\"></label><label>رابط صورة<input id=\"work-imageUrl\" type=\"url\" dir=\"ltr\" maxlength=\"2000\"></label><label>رابط فيديو<input id=\"work-videoUrl\" type=\"url\" dir=\"ltr\" maxlength=\"2000\"></label></div><div class=\"form-actions\"><button type=\"submit\">حفظ العمل</button><button id=\"cancel-work\" type=\"button\" class=\"secondary\">إلغاء</button></div></form></section>\n<section id=\"uploads\" class=\"card\"><h2>رفع الصور والسيرة العامة</h2><p class=\"muted\">الملفات هنا تصبح عامة في مستودع الموقع ورابطه بعد النشر. راجع السيرة واحذف بياناتها الخاصة قبل رفعها. هذه الوظيفة للمالك؛ نموذج الزوار يظل بلا مرفقات.</p><form id=\"upload-form\"><div class=\"field-grid\"><label>نوع الملف<select id=\"upload-kind\" name=\"kind\"><option value=\"image\">صورة عامة</option><option value=\"cv\">سيرة عامة PDF</option></select></label><label>الملف<input id=\"upload-file\" name=\"file\" type=\"file\" accept=\"image/png,image/jpeg,image/webp\" required></label></div><p id=\"upload-limit\" class=\"muted\"></p><button type=\"submit\">رفع الملف العام</button></form><p id=\"upload-result\" aria-live=\"polite\" class=\"muted\"></p><div id=\"upload-list\"></div></section>\n<section id=\"inbox\" class=\"card\"><div class=\"section-heading\"><h2>صندوق الرسائل الخاص</h2><div class=\"form-actions\"><button id=\"refresh-inbox\" class=\"secondary\">تحديث</button><a href=\"/api/admin/inbox/export\">تصدير CSV خاص</a></div></div><p id=\"inbox-summary\" class=\"muted\"></p><div id=\"inbox-list\" class=\"inbox-list\"></div></section>\n<section id=\"analytics\" class=\"card\"><div class=\"section-heading\"><h2>الزيارات والقراءة</h2><label>الفترة<select id=\"analytics-days\"><option value=\"1\">اليوم UTC</option><option value=\"7\">٧ أيام</option><option value=\"30\" selected>٣٠ يومًا</option><option value=\"90\">٩٠ يومًا</option><option value=\"365\">٣٦٥ يومًا</option></select></label></div><p id=\"analytics-note\" class=\"muted\"></p><div id=\"analytics-totals\" class=\"metric-grid\"></div><div id=\"analytics-groups\" class=\"field-grid\"></div><div id=\"analytics-timeline\"></div></section>\n<section id=\"history\" class=\"card\"><div class=\"section-heading\"><h2>سجل التعديلات</h2><button id=\"refresh-history\" class=\"secondary\">تحديث السجل</button></div><p class=\"muted\">الاستعادة تحفظ نسخة في الإدارة؛ يلزم اعتماد النشر لتغيير الموقع العام.</p><div id=\"history-list\"></div></section></main><footer class=\"admin-footer\">تُراجع البيانات العلمية قبل النشر. لا تعرض الإحصاءات أسماء الزوار تلقائيًا.</footer></body></html>\n","adminJs":"'use strict';\n(()=>{\n const langs=[['ar','العربية','rtl'],['tr','Türkçe','ltr'],['en','English','ltr']],$=id=>document.getElementById(id);\n let csrf='',records=[],editing=false;\n const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};\n const notice=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};\n async function api(path,{method='GET',data}={}){const headers={Accept:'application/json'};if(data!==undefined)headers['Content-Type']='application/json';if(method!=='GET')headers['X-CSRF-Token']=csrf;const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,body:data===undefined?undefined:JSON.stringify(data)});let d={};try{d=await r.json();}catch{}if(!r.ok){if(r.status===401)location.assign('/admin');throw new Error(d.error||'تعذر إكمال الطلب.');}return d;}\n const busy=async(button,fn)=>{if(button)button.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{if(button)button.disabled=false;}};\n function field(parent,id,label,dir,max=500,multi=false){const l=node('label',label),i=node(multi?'textarea':'input');i.id=id;i.dir=dir;i.maxLength=max;l.append(i);parent.append(l);}\n for(const[lang,label,dir]of langs){const p=node('fieldset');p.append(node('legend',label));for(const[key,title,max,multi]of[['displayName','الاسم',100,false],['role','الصفة المختصرة',200,false],['tagline','الوصف الأكاديمي',600,true],['bio','النبذة',6000,true],['interests','الاهتمامات، بفاصلة',2500,true]])field(p,'profile-'+lang+'-'+key,title,dir,max,multi);$('profile-fields').append(p);const w=node('fieldset');w.append(node('legend',label));field(w,'work-'+lang+'-title','العنوان',dir,500);field(w,'work-'+lang+'-summary','الملخص',dir,12000,true);field(w,'work-'+lang+'-keywords','الكلمات المفتاحية، بفاصلة',dir,2000);$('work-fields').append(w);}\n const split=value=>value.split(/[,،]/).map(s=>s.trim()).filter(Boolean);\n function fillProfile(data){for(const[l]of langs)for(const key of['displayName','role','tagline','bio','interests'])$('profile-'+l+'-'+key).value=key==='interests'?(data?.[l]?.[key]||[]).join('، '):data?.[l]?.[key]||'';}\n async function loadContent(){const[p,w]=await Promise.all([api('/api/admin/profile'),api('/api/admin/research')]);fillProfile(p.profile);records=w.records||[];const list=$('work-list');list.replaceChildren();if(!records.length)list.append(node('p','استورد الموقع الحالي أول مرة لبدء التحرير.','muted'));for(const r of records){const c=node('article',undefined,'record-card');c.append(node('h3',r.title?.ar||r.title?.tr||r.title?.en),node('p',(r.visibility==='public'?'ضمن النشر العام':'مسودة خاصة')+' · '+(r.status==='published'?'منشور رسميًا':'قيد الإعداد'),'muted'));const b=node('button','تحرير','secondary');b.type='button';b.addEventListener('click',()=>edit(r));c.append(b);list.append(c);}}\n function constrainVisibility(){const blocked=$('work-status').value!=='published';const option=[...$('work-visibility').options].find(o=>o.value==='public');if(option)option.disabled=blocked;if(blocked)$('work-visibility').value='draft';}\n function edit(r){editing=!!r;$('work-form').reset();$('work-id').value=r?.id||'';$('work-id').readOnly=editing;for(const[l]of langs){$('work-'+l+'-title').value=r?.title?.[l]||'';$('work-'+l+'-summary').value=r?.summary?.[l]||'';$('work-'+l+'-keywords').value=(r?.keywords?.[l]||[]).join('، ');}for(const k of['type','status','visibility','year','officialUrl','imageUrl','videoUrl'])$('work-'+k).value=r?.[k]??({type:'article',status:'in_progress',visibility:'draft'}[k]||'');constrainVisibility();$('work-form').hidden=false;$('work-form').scrollIntoView({block:'start'});}\n async function inbox(){const d=await api('/api/admin/inbox');$('inbox-summary').textContent='المحفوظ: '+d.storedCount+' من '+d.capacity+'. لا حذف تلقائي للرسائل. الاسم والبريد اختياريان.';const list=$('inbox-list');list.replaceChildren();if(!d.messages.length)list.append(node('p','لا توجد رسائل محفوظة.','muted'));for(const m of d.messages){const c=node('article',undefined,'message-card'+(m.archivedAt?' archived':''));c.append(node('h3',m.subject||'دون عنوان'),node('p',(m.name||'بلا اسم')+' · '+(m.email||'بلا بريد للرد')+' · '+new Date(m.createdAt).toLocaleString('ar'),'muted'),node('p',m.message,'message-body'));const actions=node('div',undefined,'form-actions');for(const[action,label]of[['read','مقروءة'],['archive','أرشفة'],['delete','حذف نهائي']]){const b=node('button',label,'secondary'+(action==='delete'?' danger':''));b.type='button';b.addEventListener('click',()=>{if(action==='delete'&&!confirm('حذف هذه الرسالة نهائيًا؟'))return;busy(b,async()=>{await api('/api/admin/inbox/'+encodeURIComponent(m.id)+(action==='delete'?'':'/'+action),{method:action==='delete'?'DELETE':'POST',data:{}});await inbox();});});actions.append(b);}c.append(actions);list.append(c);}}\n async function uploads(){const d=await api('/api/admin/uploads');$('upload-limit').textContent='الحد الأقصى '+(d.maxBytes/1048576).toLocaleString('ar')+' ميغابايت. صور PNG/JPEG/WebP وسيرة PDF فقط.';const list=$('upload-list');list.replaceChildren();for(const u of d.uploads){const c=node('article',undefined,'record-card');c.append(node('p',(u.kind==='cv'?'سيرة PDF':'صورة')+' · '+Math.ceil(u.size/1024).toLocaleString('ar')+' كيلوبايت · '+new Date(u.createdAt).toLocaleString('ar'),'muted'));const input=node('input');input.readOnly=true;input.dir='ltr';input.value=u.url;input.setAttribute('aria-label','الرابط العام للملف');input.addEventListener('focus',()=>input.select());const a=node('a','فتح الرابط العام بعد نجاح النشر');a.href=u.url;a.target='_blank';a.rel='noopener';c.append(input,a);list.append(c);}}\n function table(headers,data){const t=node('table'),head=node('thead'),row=node('tr');headers.forEach(v=>row.append(node('th',v)));head.append(row);const b=node('tbody');for(const values of data){const r=node('tr');values.forEach(v=>r.append(node('td',String(v))));b.append(r);}t.append(head,b);return t;}\n async function analytics(){const d=await api('/api/admin/analytics?days='+$('analytics-days').value);$('analytics-note').textContent=d.definition+' آخر تحديث: '+new Date(d.updatedAt).toLocaleString('ar');const total=$('analytics-totals');total.replaceChildren();for(const[k,label]of[['visits','زيارات تقديرية'],['views','مشاهدات صفحات']]){const c=node('div',label,'metric');c.append(node('strong',d.totals[k]));total.append(c);}const groups=$('analytics-groups');groups.replaceChildren();for(const[k,title]of[['path','الصفحات'],['country','البلدان التقريبية'],['referrer','مصادر الوصول'],['device','الأجهزة']]){const section=node('section');section.append(node('h3',title),table(['الفئة','المشاهدات','الزيارات'],d.grouped[k].map(v=>[v.label,v.views,v.visits])));groups.append(section);}$('analytics-timeline').replaceChildren(node('h3','حسب اليوم UTC'),table(['اليوم','المشاهدات','الزيارات'],d.timeline.map(v=>[v.day,v.views,v.visits])));}\n async function history(){const d=await api('/api/admin/revisions'),list=$('history-list');list.replaceChildren();for(const r of d.revisions){const c=node('div',undefined,'history-item');c.append(node('p',r.kind+' · '+r.record_id+' · '+new Date(r.created_at*1000).toLocaleString('ar')));if(['profile','research'].includes(r.kind)){const b=node('button','استعادة هذه النسخة في الإدارة','secondary');b.type='button';b.addEventListener('click',()=>{if(!confirm('استعادة هذه النسخة في الإدارة؟ لن يتغير الموقع العام قبل اعتماد النشر.'))return;busy(b,async()=>{await api('/api/admin/revisions/'+r.id+'/restore',{method:'POST',data:{}});await loadContent();notice('استعيدت النسخة في الإدارة. راجعها قبل النشر.');});});c.append(b);}list.append(c);}}\n $('profile-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{const p={};for(const[l]of langs){p[l]={};for(const k of['displayName','role','tagline','bio'])p[l][k]=$('profile-'+l+'-'+k).value.trim();p[l].interests=split($('profile-'+l+'-interests').value);}await api('/api/admin/profile',{method:'PUT',data:p});notice('حُفظت النبذة في الإدارة؛ يلزم اعتماد النشر لتظهر.');});});\n $('work-form').addEventListener('submit',e=>{e.preventDefault();busy(e.submitter,async()=>{const r={id:$('work-id').value.trim(),title:{},summary:{},keywords:{}};for(const[l]of langs){r.title[l]=$('work-'+l+'-title').value.trim();r.summary[l]=$('work-'+l+'-summary').value.trim();r.keywords[l]=split($('work-'+l+'-keywords').value);}for(const k of['type','status','visibility','officialUrl','imageUrl','videoUrl'])r[k]=$('work-'+k).value.trim();r.year=$('work-year').value?Number($('work-year').value):null;await api('/api/admin/research'+(editing?'/'+encodeURIComponent(r.id):''),{method:editing?'PUT':'POST',data:r});await loadContent();$('work-form').hidden=true;notice('حُفظ العمل في الإدارة.');});});\n $('upload-kind').addEventListener('change',()=>{$('upload-file').accept=$('upload-kind').value==='cv'?'application/pdf':'image/png,image/jpeg,image/webp';$('upload-file').value='';});\n $('upload-form').addEventListener('submit',e=>{e.preventDefault();const file=$('upload-file').files[0];if(!file)return;if(!confirm('سيُرفع هذا الملف إلى مستودع عام ويصبح متاحًا للجميع، وقد يبقى في سجل Git حتى بعد حذفه. هل راجعت خلوه من البيانات الخاصة وتريد نشره؟'))return;busy(e.submitter,async()=>{const form=new FormData();form.set('kind',$('upload-kind').value);form.set('file',file);const response=await fetch('/api/admin/uploads',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'X-CSRF-Token':csrf,Accept:'application/json'},body:form});const d=await response.json();if(!response.ok)throw new Error(d.error||'تعذر رفع الملف.');$('upload-result').textContent=d.note+' '+d.url;const a=node('a','متابعة النشر');a.href=d.actionsUrl;a.target='_blank';a.rel='noopener';$('upload-result').append(' ',a);$('upload-form').reset();await uploads();notice('حُفظ الملف العام؛ انتظر نجاح النشر قبل استخدام الرابط.');});});\n $('work-status').addEventListener('change',constrainVisibility);\n $('new-work').addEventListener('click',()=>edit());$('cancel-work').addEventListener('click',()=>{$('work-form').hidden=true;});\n $('import').addEventListener('click',e=>busy(e.currentTarget,async()=>{await api('/api/admin/import',{method:'POST',data:{}});await loadContent();notice('استورد المحتوى العام الحالي.');}));\n $('preview').addEventListener('click',e=>busy(e.currentTarget,async()=>{const d=await api('/api/admin/preview');$('preview-data').textContent=JSON.stringify(d.source,null,2);$('preview-data').hidden=false;notice(d.note);}));\n $('publish').addEventListener('click',()=>{$('publish-confirm').hidden=false;$('publish-confirm').scrollIntoView({block:'center'});$('publish-confirm-yes').focus();});\n $('publish-confirm-cancel').addEventListener('click',()=>{$('publish-confirm').hidden=true;$('publish').focus();});\n $('publish-confirm-yes').addEventListener('click',e=>{busy(e.currentTarget,async()=>{const d=await api('/api/admin/publish',{method:'POST',data:{}});$('publish-confirm').hidden=true;$('publication-result').textContent=d.note+' '+d.commit;const a=node('a','متابعة GitHub Actions');a.href=d.actionsUrl;a.target='_blank';a.rel='noopener';$('publication-result').append(' ',a);notice('حُفظ المصدر؛ تحقق من نتيجة النشر.');});});\n $('publication-status').addEventListener('click',e=>busy(e.currentTarget,async()=>{const d=await api('/api/admin/publication');$('publication-result').textContent=d.publishedFromDashboard===false?'لم يحدث نشر من هذه اللوحة بعد.':d.status+' · '+(d.conclusion||'بانتظار نتيجة')+' · '+d.commit;}));\n $('refresh-inbox').addEventListener('click',e=>busy(e.currentTarget,inbox));$('analytics-days').addEventListener('change',()=>busy(null,analytics));$('refresh-history').addEventListener('click',e=>busy(e.currentTarget,history));$('logout').addEventListener('click',e=>busy(e.currentTarget,async()=>{await api('/api/admin/logout',{method:'POST',data:{}});location.assign('/admin');}));\n busy(null,async()=>{const s=await api('/api/admin/session');csrf=s.csrfToken;$('session-email').textContent=s.email;await Promise.all([loadContent(),inbox(),analytics(),history(),uploads()]);notice('تم التحقق من حساب المالك.');});\n})();\n","css":":root{color-scheme:light;--paper:#f7f5ed;--surface:#fffef9;--ink:#193d33;--muted:#637169;--line:#d9dfd5;--accent:#315f49;--soft:#eaf0e6;--error:#862f2f}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:1.5rem}body{margin:0;background:var(--paper);color:var(--ink);font-family:Amiri,\"Noto Naskh Arabic\",\"Segoe UI\",Tahoma,sans-serif;font-size:18px;line-height:1.8}[hidden]{display:none!important}a{color:inherit;text-underline-offset:4px}button,input,select,textarea{font:inherit}button{border:1px solid var(--ink);border-radius:5px;padding:.55rem 1.1rem;background:var(--ink);color:white;cursor:pointer;min-height:44px}button.secondary{color:var(--ink);background:var(--surface);border-color:var(--line)}button:disabled{opacity:.55;cursor:wait}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #95723c;outline-offset:3px}.skip-link{position:absolute;top:-100px;padding:.5rem 1rem;background:var(--ink);color:white}.skip-link:focus{top:0}.admin-header{max-width:1180px;margin:auto;padding:2rem;display:flex;align-items:center;justify-content:space-between;gap:1.5rem;flex-wrap:wrap}.header-copy{display:flex;align-items:center;gap:1rem}.brand-mark{border:1px solid var(--ink);width:52px;height:56px;display:grid;place-items:center;font:22px Georgia,serif}.eyebrow{font-size:13px;color:var(--accent);margin:0;letter-spacing:.02em}h1,h2,h3,p{margin-top:0}h1{font-size:29px;line-height:1.4;margin-bottom:0}h2{font-size:25px;line-height:1.5;margin-bottom:.5rem}h3{font-size:21px;line-height:1.6}.owner-name{margin-bottom:0;color:var(--muted);font-size:16px}.header-actions,.form-actions,.section-nav{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem}.header-actions{font-size:16px}.container{max-width:1180px;margin:auto;padding:0 2rem 2rem}.card{padding:2rem;background:var(--surface);border:1px solid var(--line);border-radius:7px;margin-bottom:1.5rem}.login-panel{max-width:650px;margin:2rem auto 4rem}.muted,small{color:var(--muted);font-size:15px}.status{padding:.7rem 1rem;border-inline-start:3px solid var(--accent);background:var(--soft);overflow-wrap:anywhere}.status.error{border-color:var(--error);color:var(--error);background:#fcf0ef}.status:empty{display:none}.session-line{font-size:15px;color:var(--muted);overflow-wrap:anywhere}.section-nav{margin:1.5rem 0 2rem;gap:.8rem 1.5rem}.section-nav a{font-size:16px}.section-heading{display:flex;align-items:start;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.5rem}.language-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.3rem}fieldset{padding:1rem;border:1px solid var(--line);border-radius:4px;min-width:0}legend{padding:0 .5rem;font-weight:700}label{display:grid;gap:.4rem;margin-bottom:1rem;min-width:0}input,select,textarea{width:100%;min-width:0;background:#fff;border:1px solid #b9c7bc;border-radius:4px;padding:.55rem .65rem;color:#253c30}textarea{resize:vertical;min-height:110px;line-height:1.75}input[type=number]{max-width:160px}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 1.5rem;margin-top:1.5rem}.wide-field{grid-column:1/-1}.form-actions{margin-top:1rem}.research-list,.inbox-list{display:grid;gap:1rem}.record-card,.message-card{border:1px solid var(--line);border-radius:4px;padding:1.2rem;overflow-wrap:anywhere}.record-topline{display:flex;gap:.6rem;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:.5rem}.badge{padding:.1rem .55rem;border-radius:3px;background:var(--soft);color:var(--accent)}.badge.draft{background:#f3e9d7;color:#77520f}.record-card h3{margin-bottom:.7rem}.record-card button{font-size:15px}.editor{border-top:1px solid var(--line);margin-top:2rem;padding-top:2rem}.message-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:17px}.message-meta{display:flex;gap:.8rem;flex-wrap:wrap;color:var(--muted);font-size:14px}.message-subject{font-weight:700}.admin-footer{padding:1.5rem 2rem;border-top:1px solid var(--line);text-align:center;color:var(--muted);font-size:14px}.admin-footer p{margin:0}.empty-state{color:var(--muted);padding:1rem 0}.form-hint{font-size:13px;margin:0 0 .5rem;color:var(--muted)}@media(max-width:950px){.language-grid{grid-template-columns:1fr}.language-grid textarea{min-height:100px}}@media(max-width:550px){.admin-header{padding:1.25rem}.container{padding:0 1rem 1.5rem}.card{padding:1.15rem}.field-grid{grid-template-columns:1fr;gap:0}.wide-field{grid-column:auto}.header-actions{width:100%;justify-content:space-between}h1{font-size:25px}h2{font-size:23px}.section-heading{margin-bottom:1rem}.form-actions button{flex:1}.section-nav{gap:.75rem 1rem}.brand-mark{width:43px;height:48px}.login-panel{margin-top:1rem}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}\nbutton.danger{color:var(--error);border-color:#d9b7b2}button.danger:hover{background:#fcf0ef}.message-card .form-actions{margin-top:.8rem}\npre{max-height:26rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#edf1e9;padding:1rem;border-radius:5px;font:13px/1.6 ui-monospace,monospace}table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:.4rem;text-align:start;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.metric-grid{display:flex;flex-wrap:wrap;gap:1rem}.metric{border:1px solid var(--line);padding:1rem;min-width:9rem}.metric strong{font-size:2rem;display:block}.message-card.archived{opacity:.7}.history-item{padding:1rem 0;border-bottom:1px solid var(--line)}\n"};
export default createApp({assets:embeddedAssets});
