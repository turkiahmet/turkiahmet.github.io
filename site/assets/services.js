/* Optional live services. Public content stays usable when services are unavailable. */
(() => {
  'use strict';
  const lang = document.documentElement.lang || 'ar';
  const labels = {
    ar: {title:'مراسلة عبر الموقع',message:'الرسالة',name:'الاسم (اختياري)',email:'البريد الإلكتروني للرد (اختياري)',hint:'يمكنك الإرسال دون اسم أو بريد أو حساب. لا يدعم النموذج المرفقات.',send:'إرسال الرسالة',sending:'جارٍ الإرسال…',success:'وصلت رسالتك. شكرًا لك.',failure:'تعذّر الإرسال الآن. يمكنك المحاولة لاحقًا أو استخدام البريد.',empty:'اكتب الرسالة أولًا.'},
    tr: {title:'Siteden mesaj gönder',message:'Mesaj',name:'Ad (isteğe bağlı)',email:'Yanıt için e-posta (isteğe bağlı)',hint:'Ad, e-posta veya hesap olmadan mesaj gönderebilirsiniz. Ek dosya kabul edilmez.',send:'Mesajı gönder',sending:'Gönderiliyor…',success:'Mesajınız alındı. Teşekkür ederiz.',failure:'Mesaj şu anda gönderilemedi. Daha sonra deneyebilir veya e-postayı kullanabilirsiniz.',empty:'Önce mesajınızı yazın.'},
    en: {title:'Send a message',message:'Message',name:'Name (optional)',email:'Email for a reply (optional)',hint:'You can send a message without a name, email, or account. Attachments are not supported.',send:'Send message',sending:'Sending…',success:'Your message was received. Thank you.',failure:'The message could not be sent now. Please try later or use email.',empty:'Please write a message first.'}
  };
  const text = labels[lang] || labels.en;
  const element = (tag, content, props={}) => {
    const node=document.createElement(tag); if(content)node.textContent=content;
    Object.entries(props).forEach(([key,value]) => node.setAttribute(key,value));return node;
  };
  function form(origin, config) {
    const host=document.querySelector('[data-contact-form]');if(!host||!config.contactEnabled)return;
    const section=element('section','',{class:'section contact-form-section','aria-labelledby':'contact-form-title'});
    section.append(element('h2',text.title,{id:'contact-form-title'}),element('p',text.hint,{class:'small-note'}));
    const f=element('form','',{class:'contact-form'});
    for (const [key,type,label] of [['name','text',text.name],['email','email',text.email],['message','textarea',text.message]]) {
      const field=element('div','',{class:'form-field'});field.append(element('label',label,{for:'contact-'+key}));
      const input=element(type==='textarea'?'textarea':'input','',{id:'contact-'+key,name:key,...(type==='textarea'?{rows:'6',maxlength:String(config.maxMessageLength||3000),required:''}:{type,maxlength:'254',autocomplete:key==='email'?'email':'name'})});
      field.append(input);f.append(field);
    }
    const trap=element('input','',{name:'website',type:'text',tabindex:'-1',autocomplete:'off','aria-hidden':'true',class:'contact-trap'});f.append(trap);
    const button=element('button',text.send,{type:'submit',class:'form-button'});const status=element('p','',{class:'copy-status',role:'status','aria-live':'polite'});f.append(button,status);
    f.addEventListener('submit',async event=>{
      event.preventDefault();const data=new FormData(f);const message=String(data.get('message')||'').trim();
      if(!message){status.textContent=text.empty;return;}
      button.disabled=true;status.textContent=text.sending;
      try {const result=await fetch(origin+'/api/contact',{method:'POST',mode:'cors',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,name:String(data.get('name')||'').trim(),email:String(data.get('email')||'').trim(),website:String(data.get('website')||'')})});
        if(!result.ok)throw new Error('message rejected');f.reset();status.textContent=text.success;
      }catch{status.textContent=text.failure;}finally{button.disabled=false;}
    });
    section.append(f);host.append(section);
  }
  async function analytics(origin,config) {
    if(!config.analyticsEnabled||navigator.globalPrivacyControl||navigator.doNotTrack==='1')return;
    let visit=true;const now=Date.now();try{const old=Number(sessionStorage.getItem('academic-visit-time')||'0');visit=now-old>30*60*1000;sessionStorage.setItem('academic-visit-time',String(now));}catch{}
    let referrer='';try{referrer=document.referrer?new URL(document.referrer).origin:'';}catch{}
    try{await fetch(origin+'/api/analytics',{method:'POST',mode:'cors',credentials:'omit',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({path:location.pathname,referrer,visit})});}catch{}
  }
  async function start(){try{
    const services=await fetch('/services.json',{credentials:'omit',cache:'no-store'}).then(r=>r.ok?r.json():null);if(!services?.backendOrigin)return;
    const u=new URL(services.backendOrigin);if(u.protocol!=='https:')return;const origin=u.origin;
    const config=await fetch(origin+'/api/config',{credentials:'omit',mode:'cors',cache:'no-store'}).then(r=>r.ok?r.json():null);if(!config)return;
    form(origin,config);analytics(origin,config);
  }catch{}}
  start();
})();
