import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../notification-script/Code.gs',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('../notification-script/appsscript.json',import.meta.url),'utf8'));
const FIXED_URL='https://turkiahmet-admin.turkiahmet26.workers.dev/api/notifications/summary';
const FIXED_RECIPIENT='turkiahmet26@gmail.com';
const TEST_TOKEN='notification-unit-test-only-key-'+ 'a'.repeat(32);
const NOW=Date.UTC(2026,10,5,9);
const DAY=24*60*60*1000;
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({cursor='5',sequence=5,quota=100,properties={}}={}){
  const values=new Map(Object.entries({TOKEN:TEST_TOKEN,...(cursor===null?{}:{LAST_SEQUENCE:cursor}),...properties}));
  const state={sequence,quota,now:NOW,lockAvailable:true,lockHeld:false,releases:0,requests:[],emails:[],responseStatus:200};
  const props={
    getProperty(key){return values.has(key)?values.get(key):null;},
    setProperty(key,value){if(state.propertyFailure)throw new Error('simulated property save failed');values.set(key,value);},
    setProperties(data,deleteAllOthers){
      if(state.propertyFailure)throw new Error('simulated property save failed');
      if(deleteAllOthers)values.clear();
      for(const[key,value]of Object.entries(data))values.set(key,value);
    }
  };
  const context=vm.createContext({
    Date:class extends Date {static now(){return state.now;}},
    PropertiesService:{getScriptProperties(){return props;}},
    LockService:{getScriptLock(){return {
      tryLock(){if(!state.lockAvailable||state.lockHeld)return false;state.lockHeld=true;return true;},
      releaseLock(){assert.equal(state.lockHeld,true,'only its own lock may be released');state.lockHeld=false;state.releases++;}
    };}},
    UrlFetchApp:{fetch(url,options){
      state.requests.push({url,options:plain(options)});
      if(state.fetchFailure)throw new Error('simulated transport failure '+TEST_TOKEN);
      const after=Number(new URL(url).searchParams.get('after'));
      return {
        getResponseCode(){return state.responseStatus;},
        getContentText(){return state.rawResponse===undefined?JSON.stringify({sequence:state.sequence,pending:state.sequence-after,latestAt:state.sequence?new Date(NOW).toISOString():null}):state.rawResponse;}
      };
    }},
    MailApp:{
      getRemainingDailyQuota(){if(state.quotaFailure)throw new Error('simulated quota unavailable');return state.quota;},
      sendEmail(email){if(state.sendFailure)throw new Error('simulated send failure');state.emails.push(plain(email));state.quota--;}
    }
  });
  vm.runInContext(source,context,{filename:'Code.gs'});
  return {state,values,context,initialize:()=>context.initializeBaseline(),notify:()=>context.notifyNewVisitorMessages()};
}

test('private notification baseline skips existing arrivals and never sends email',()=>{
  const f=fixture({cursor:null,sequence:12});
  assert.deepEqual(plain(f.initialize()),{initialized:true,sequence:12});
  assert.equal(f.values.get('LAST_SEQUENCE'),'12');
  assert.equal(f.state.emails.length,0);
  assert.deepEqual(plain(f.notify()),{sent:false,reason:'no_new_messages'});
  assert.equal(f.state.emails.length,0);
  assert.equal(f.state.lockHeld,false);
  assert.equal(f.state.releases,2);
});

test('notification sends one fixed-recipient count-only email for a batch and does not repeat it',()=>{
  const f=fixture({cursor:'5',sequence:9});
  const result=plain(f.notify());
  assert.deepEqual(result,{sent:true,count:4,sequence:9});
  assert.equal(f.state.emails.length,1);
  const email=f.state.emails[0];
  assert.equal(email.to,FIXED_RECIPIENT);
  assert.match(email.body,/4/);
  assert.match(email.body,/https:\/\/turkiahmet-admin\.turkiahmet26\.workers\.dev\/admin#inbox/);
  assert.deepEqual(Object.keys(email).sort(),['body','name','subject','to']);
  assert(!JSON.stringify(email).includes(TEST_TOKEN));
  assert.equal(f.values.get('LAST_SEQUENCE'),'9');
  assert.equal(f.values.get('WINDOW_SEND_COUNT'),'1');
  assert.deepEqual(plain(f.notify()),{sent:false,reason:'no_new_messages'});
  assert.equal(f.state.emails.length,1);
  assert(!JSON.stringify(result).includes(TEST_TOKEN));
  const request=f.state.requests[0];
  assert.equal(request.url,FIXED_URL+'?after=5');
  assert(!request.url.includes(TEST_TOKEN));
  assert.equal(request.options.headers.Authorization,'Bearer '+TEST_TOKEN);
  assert.equal(request.options.method,'get');
  assert.equal(request.options.followRedirects,false,'bearer token must not follow a redirect');
  assert.equal(request.options.validateHttpsCertificates,true);
  assert.equal(request.options.body,undefined);
});

test('notification requires an explicit baseline and a valid separately stored token',()=>{
  const missingBaseline=fixture({cursor:null,sequence:12});
  assert.throws(()=>missingBaseline.notify(),/initializeBaseline/);
  assert.equal(missingBaseline.state.requests.length,0);
  assert.equal(missingBaseline.state.emails.length,0);
  for(const token of ['', 'short', 'bad token with spaces '+ 'a'.repeat(50)]){
    const f=fixture({sequence:6,properties:{TOKEN:token}});
    assert.throws(()=>f.notify());
    assert.equal(f.state.requests.length,0);
    assert.equal(f.values.get('LAST_SEQUENCE'),'5');
    assert.equal(f.state.emails.length,0);
    assert.equal(f.state.lockHeld,false);
  }
});

test('transport and service failures leave the notification cursor unchanged and do not expose token errors',()=>{
  const f=fixture({sequence:6});
  f.state.fetchFailure=true;
  assert.throws(()=>f.notify(),error=>!error.message.includes(TEST_TOKEN));
  assert.equal(f.values.get('LAST_SEQUENCE'),'5');
  assert.equal(f.state.emails.length,0);
  assert.equal(f.state.lockHeld,false);
  f.state.fetchFailure=false;
  for(const status of [301,401,403,409,503]){
    f.state.responseStatus=status;
    assert.throws(()=>f.notify());
    assert.equal(f.values.get('LAST_SEQUENCE'),'5');
    assert.equal(f.state.emails.length,0);
  }
});

test('malformed, private-field, or inconsistent summaries cannot cause notification or cursor progress',()=>{
  const cases=[
    'not JSON',
    JSON.stringify({sequence:6,pending:1,latestAt:null,message:'PRIVATE MESSAGE',email:'visitor@example.invalid'}),
    JSON.stringify({sequence:4,pending:-1,latestAt:null}),
    JSON.stringify({sequence:6,pending:2,latestAt:null}),
    JSON.stringify({sequence:6,pending:1,latestAt:'not a time'}),
    JSON.stringify({sequence:Number.MAX_SAFE_INTEGER+1,pending:1,latestAt:null})
  ];
  for(const rawResponse of cases){
    const f=fixture({sequence:6});f.state.rawResponse=rawResponse;
    assert.throws(()=>f.notify());
    assert.equal(f.values.get('LAST_SEQUENCE'),'5');
    assert.equal(f.state.emails.length,0);
    assert.equal(f.state.lockHeld,false);
  }
});

test('Google quota exhaustion and quota lookup failure defer notification without advancing cursor',()=>{
  const f=fixture({sequence:8,quota:0});
  assert.deepEqual(plain(f.notify()),{sent:false,reason:'quota'});
  assert.equal(f.values.get('LAST_SEQUENCE'),'5');
  assert.equal(f.state.emails.length,0);
  assert.equal(f.values.has('WINDOW_SEND_COUNT'),false);
  f.state.quotaFailure=true;
  assert.throws(()=>f.notify(),/quota unavailable/);
  assert.equal(f.values.get('LAST_SEQUENCE'),'5');
  assert.equal(f.state.lockHeld,false);
});

test('local cap blocks the ninety-first email and resumes after 24 hours only when Google quota is available',()=>{
  const f=fixture({sequence:7,properties:{WINDOW_STARTED_AT:String(NOW),WINDOW_SEND_COUNT:'89'}});
  assert.equal(f.notify().sent,true);
  assert.equal(f.values.get('WINDOW_SEND_COUNT'),'90');
  f.state.sequence=8;
  assert.deepEqual(plain(f.notify()),{sent:false,reason:'quota'});
  assert.equal(f.values.get('LAST_SEQUENCE'),'7');
  assert.equal(f.state.emails.length,1);
  f.state.now=NOW+DAY;f.state.quota=0;
  assert.deepEqual(plain(f.notify()),{sent:false,reason:'quota'});
  assert.equal(f.values.get('LAST_SEQUENCE'),'7');
  assert.equal(f.values.get('WINDOW_SEND_COUNT'),'90');
  f.state.quota=1;
  assert.deepEqual(plain(f.notify()),{sent:true,count:1,sequence:8});
  assert.equal(f.values.get('WINDOW_SEND_COUNT'),'1');
  assert.equal(f.values.get('WINDOW_STARTED_AT'),String(NOW+DAY));
  assert.equal(f.state.emails.length,2);
});

test('send failure preserves all pending messages for a later attempt',()=>{
  const f=fixture({sequence:10});f.state.sendFailure=true;
  assert.throws(()=>f.notify(),/send failure/);
  assert.equal(f.values.get('LAST_SEQUENCE'),'5');
  assert.equal(f.values.has('WINDOW_SEND_COUNT'),false);
  assert.equal(f.state.emails.length,0);
  assert.equal(f.state.lockHeld,false);
  f.state.sendFailure=false;
  assert.deepEqual(plain(f.notify()),{sent:true,count:5,sequence:10});
  assert.equal(f.state.emails.length,1);
});

test('unavailable script lock performs no fetch or send and does not release another execution lock',()=>{
  const f=fixture({sequence:6});f.state.lockAvailable=false;
  assert.deepEqual(plain(f.notify()),{sent:false,reason:'busy'});
  assert.throws(()=>f.initialize());
  assert.equal(f.state.requests.length,0);
  assert.equal(f.state.emails.length,0);
  assert.equal(f.state.releases,0);
  assert.equal(f.values.get('LAST_SEQUENCE'),'5');
});

test('a property-save failure after a successful send can duplicate an alert but does not discard the cursor',()=>{
  const f=fixture({sequence:6});f.state.propertyFailure=true;
  assert.throws(()=>f.notify(),/property save failed/);
  assert.equal(f.state.emails.length,1);
  assert.equal(f.values.get('LAST_SEQUENCE'),'5');
  assert.equal(f.state.lockHeld,false);
  f.state.propertyFailure=false;
  assert.equal(f.notify().sent,true);
  assert.equal(f.state.emails.length,2,'documented at-least-once edge after a save failure');
  assert.equal(f.values.get('LAST_SEQUENCE'),'6');
  assert.equal(f.notify().reason,'no_new_messages');
  assert.equal(f.state.emails.length,2);
});

test('private notification script has two permissions and no published webhook or programmatic trigger creation',()=>{
  assert.deepEqual(manifest.oauthScopes.sort(),[
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.send_mail'
  ]);
  assert.equal(manifest.webapp,undefined);
  const f=fixture();
  assert.equal(f.context.doGet,undefined);
  assert.equal(f.context.doPost,undefined);
  assert(!/\bScriptApp\s*\./.test(source));
  assert(!/\bGmailApp\s*\./.test(source));
});
