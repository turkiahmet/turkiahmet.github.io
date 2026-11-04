'use strict';
(async()=>{
 const status=document.getElementById('status');
 async function api(path,data){const response=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{Accept:'application/json'},body:data?JSON.stringify(data):undefined});const value=await response.json();if(!response.ok)throw new Error(value.error||'تعذر تسجيل الدخول.');return value;}
 try{
  const config=await api('/api/admin/config');document.getElementById('login-note').textContent='الحساب المصرح له: '+config.ownerHint;
  const challenge=await api('/api/admin/nonce');
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.onload=resolve;script.onerror=()=>reject(new Error('تعذر تحميل تسجيل الدخول من Google.'));document.head.append(script);});
  google.accounts.id.initialize({client_id:config.clientId,nonce:challenge.nonce,auto_select:false,callback:async result=>{try{status.textContent='جارٍ التحقق من الحساب…';await api('/api/admin/login',{credential:result.credential,nonce:challenge.nonce});location.assign('/admin');}catch(error){status.textContent=error.message;}}});
  google.accounts.id.renderButton(document.getElementById('google-signin'),{type:'standard',theme:'outline',size:'large',locale:'ar',width:280});
 }catch(error){status.textContent=error.message;}
})();
