import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const helpers=read('src/helpers.js');
const app=read('src/app.js');
const assets={loginHtml:read('public/login.html'),loginJs:read('public/login.js'),adminHtml:read('public/admin.html'),adminJs:read('public/admin.js'),css:read('public/assets/admin.css')};
const built=helpers+'\n'+app+'\nconst embeddedAssets = '+JSON.stringify(assets)+';\nexport default createApp({assets:embeddedAssets});\n';
fs.writeFileSync(new URL('worker.js',import.meta.url),built);
console.log('Self-contained worker built: '+Buffer.byteLength(built)+' bytes.');
