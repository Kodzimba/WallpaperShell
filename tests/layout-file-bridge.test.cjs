'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {create}=require('../runtime/wallpaper/layout-file-bridge.js');
function setup(){const sent=[],bridge=create({post:message=>sent.push(message),uuid:()=>crypto.randomUUID()});return {bridge,sent,respond(result={}){bridge.receive({type:'layout-file-result',requestId:sent.at(-1).requestId,action:sent.at(-1).action,status:'ok',...result});}};}
test('native layout messages carry only UUID, action and content, never file paths',async()=>{const f=setup(),pending=f.bridge.request('save','{}');assert.deepEqual(Object.keys(f.sent[0]).sort(),['action','content','requestId','type']);assert.equal(f.sent[0].type,'layout-file-request');f.respond({filename:'My layout.json'});assert.equal((await pending).status,'ok');assert.equal(f.bridge.isBusy(),false);});
test('open request does not accept content, unknown actions or oversized UTF-8 payloads',async()=>{const f=setup();for(const [action,content]of [['open','x'],['remove',undefined],['save','я'.repeat(17000)],['save',null]])await assert.rejects(f.bridge.request(action,content));assert.equal(f.sent.length,0);});
test('a foreign request id or unrelated audio event cannot settle a file request',async()=>{const f=setup(),pending=f.bridge.request('open');f.bridge.receive({type:'audio',samples:[]});f.bridge.receive({type:'layout-file-result',requestId:crypto.randomUUID(),action:'open',status:'ok',content:'bad'});assert(f.bridge.isBusy());f.respond({content:'{}',filename:'layout.json'});assert.equal((await pending).content,'{}');});
test('busy, cancellation and navigation release the request without exposing previous data',async()=>{const f=setup(),first=f.bridge.request('open');await assert.rejects(f.bridge.request('save','{}'));f.respond({status:'cancelled'});assert.equal((await first).status,'cancelled');const second=f.bridge.request('open');f.bridge.cancel();assert.equal((await second).status,'cancelled');assert.equal(f.bridge.isBusy(),false);});
test('malformed matching native results fail explicitly and late results are ignored',async()=>{const f=setup(),pending=f.bridge.request('open');f.respond({content:'x'.repeat(32769)});assert.equal((await pending).status,'error');f.respond({content:'valid'});assert.equal(f.bridge.isBusy(),false);const next=f.bridge.request('save','{}');f.respond({action:'open',content:'{}'});assert.equal((await next).status,'error');});
test('a failed post reports an error and does not leave a permanently busy bridge',async()=>{const bridge=create({post(){throw Error();},uuid:()=>crypto.randomUUID()});await assert.rejects(bridge.request('open'));assert.equal(bridge.isBusy(),false);});

test('display reset without page navigation cancels native open/save and a late result cannot poison the next chooser',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),handlers=new Map(),sent=[];let receive;
 const context={PG_APP:true,crypto,TextEncoder,chrome:{webview:{postMessage:message=>sent.push(message),addEventListener:(type,callback)=>{receive=callback;}}},addEventListener:(type,callback)=>handlers.set(type,callback)};
 context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/layout-file-bridge.js'),'utf8'),context);
 for(const action of ['open','save']){
  const pending=action==='open'?context.PGLayoutFiles.open():context.PGLayoutFiles.save('{}'),old=sent.at(-1);
  assert(context.PGLayoutFiles.isBusy());handlers.get('pg:window-policy')({detail:{event:'reset',reason:'display'}});
  assert.equal((await pending).status,'cancelled');assert.equal(context.PGLayoutFiles.isBusy(),false);
  const next=context.PGLayoutFiles.open(),current=sent.at(-1);
  receive({data:{type:'layout-file-result',requestId:old.requestId,action,status:'ok',content:'old'}});
  assert(context.PGLayoutFiles.isBusy(),'Late result must not settle the new request');
  receive({data:{type:'layout-file-result',requestId:current.requestId,action:'open',status:'ok',content:'{}'}});
  assert.equal((await next).content,'{}');assert.equal(context.PGLayoutFiles.isBusy(),false);
 }
});
