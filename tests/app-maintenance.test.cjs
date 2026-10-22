'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDOMFixture}=require('./helpers/editor-dom.cjs');
function setup(options={}){
 const f=createDOMFixture({theme:'luna-blue'}),messages=[];let receive,serial=0,interact=true,leaseCount=0,releases=0;
 Object.assign(f.window,{crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`},chrome:{webview:{addEventListener(name,fn){receive=fn;},postMessage:m=>messages.push(m)}},PGWindows:{canInteract:()=>interact,async acquire(kind,acquireOptions){assert.equal(kind,'update');assert.equal(acquireOptions.element.id,'appUpdateOverlay');leaseCount++;if(options.wait)await options.wait;return {release(){releases++;}};}}});
 f.load('app-maintenance.js');const button=id=>f.document.getElementById(id),send=m=>receive({data:m}),info={type:'app-maintenance-info',version:'0.2.0',enabled:true,reportAvailable:true,repository:'Kodzimba/WallpaperShell'};
 return {...f,messages,button,send,info,block:()=>interact=false,leases:()=>leaseCount,releases:()=>releases,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('maintenance mounts once and offers report/check without sending telemetry or account data',()=>{
 const f=setup();assert.equal(f.messages.length,1);assert.equal(f.messages[0].action,'info');f.send(f.info);
 f.button('appReport').click();assert.equal(f.messages.at(-1).action,'report');assert.deepEqual(Object.keys(f.messages.at(-1)).sort(),['action','requestId','type']);
 assert(f.document.querySelector('.app-maintenance-version').textContent.includes('WallpaperShell 0.2.0'));f.block();const n=f.messages.length;f.button('appUpdate').click();f.button('appReport').click();assert.equal(f.messages.length,n);
});
test('update requires release check, explicit install and the shared modal lease',async()=>{
 const f=setup();f.send(f.info);f.button('appUpdate').click();const check=f.messages.at(-1);assert.equal(check.action,'check');assert(f.button('appUpdate').disabled);
 f.send({type:'app-maintenance-status',requestId:'foreign',state:'available',version:'9.9.9'});assert(f.button('appUpdateInstall').hidden);
 f.send({type:'app-maintenance-status',requestId:check.requestId,state:'available',version:'0.3.0',size:10485760});assert(!f.button('appUpdateInstall').hidden);assert(f.button('appUpdateStatus').textContent.includes('10.0 МиБ'));
 f.button('appUpdateInstall').click();await f.flush();assert.equal(f.leases(),1);assert.equal(f.messages.at(-1).action,'install');assert(!f.button('appUpdateOverlay').hidden);
 const id=f.messages.at(-1).requestId;f.send({type:'app-maintenance-progress',requestId:id,bytes:5,total:10});assert(f.button('appUpdateProgress').textContent.includes('50%'));
 f.button('appUpdateCancel').click();assert.equal(f.messages.at(-1).action,'cancel');assert.equal(f.messages.at(-1).requestId,id);assert(f.button('appUpdateOverlay').hidden);assert.equal(f.releases(),1);
});
test('failed install stays readable in the modal and late messages cannot replace another request',async()=>{
 const f=setup();f.send(f.info);f.button('appUpdate').click();f.send({type:'app-maintenance-status',requestId:f.messages.at(-1).requestId,state:'available',version:'0.3.0'});f.button('appUpdateInstall').click();await f.flush();const id=f.messages.at(-1).requestId;
 f.send({type:'app-maintenance-status',requestId:id,state:'error',message:'<img src=x onerror=alert(1)>'});assert(!f.button('appUpdateOverlay').hidden);assert.equal(f.button('appUpdateProgress').textContent,'<img src=x onerror=alert(1)>');assert.equal(f.document.querySelectorAll('img').length,0);
 f.button('appUpdateCancel').click();assert(f.button('appUpdateOverlay').hidden);assert.equal(f.releases(),1);
 f.button('appUpdate').click();f.send({type:'app-maintenance-status',requestId:id,state:'latest',message:'stale'});assert.notEqual(f.button('appUpdateStatus').textContent,'stale');
});
test('unconfigured update/report remain disabled and installation phase cannot be canceled after commit handoff',async()=>{
 const f=setup();f.send({...f.info,enabled:false,reportAvailable:false});assert(f.button('appUpdate').disabled&&f.button('appReport').disabled);f.send(f.info);f.button('appUpdate').click();f.send({type:'app-maintenance-status',requestId:f.messages.at(-1).requestId,state:'available',version:'0.3.0'});f.button('appUpdateInstall').click();await f.flush();const id=f.messages.at(-1).requestId;
 f.send({type:'app-maintenance-status',requestId:id,state:'installing',message:'Перезапускаем…'});const n=f.messages.length;f.button('appUpdateCancel').click();assert.equal(f.messages.length,n);assert.equal(f.releases(),0);
});

test('cancel while the native lease is pending releases late ownership without starting an install',async()=>{
 let resolve;const f=setup({wait:new Promise(done=>resolve=done)});f.send(f.info);f.button('appUpdate').click();const check=f.messages.at(-1);f.send({type:'app-maintenance-status',requestId:check.requestId,state:'available',version:'0.3.0'});
 f.button('appUpdateInstall').click();f.button('appUpdateCancel').click();resolve();await f.flush();
 assert(f.button('appUpdateOverlay').hidden);assert.equal(f.releases(),1);assert(!f.messages.some(m=>m.action==='install'));
 f.send({type:'app-maintenance-status',requestId:check.requestId,state:'available',version:'9.9.9'});assert(f.button('appUpdateInstall').hidden);
});
