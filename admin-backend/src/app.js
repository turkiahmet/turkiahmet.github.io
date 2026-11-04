function intSetting(env,key,fallback,min,max){const n=Number(env[key]??fallback);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
function parseDocument(row){try{return JSON.parse(row.document);}catch{fail(503,'تحتاج البيانات المحفوظة إلى مراجعة.');}}
async function rows(env,sql,...args){return (await env.DB.prepare(sql).bind(...args).all()).results||[];}
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
