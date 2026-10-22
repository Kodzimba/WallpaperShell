'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {validAction,command,createHandler}=require('../runtime/companion/power.cjs');
const key='a'.repeat(64),headers={'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':key,Origin:'null'};
async function server(options,fn){const s=http.createServer(createHandler({key,...options}));await new Promise(r=>s.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+s.address().port;const send=(action,extra={})=>fetch(url,{method:'POST',headers:{...headers,...extra},body:typeof action==='string'?action:JSON.stringify(action)});try{await fn(send,url);}finally{await new Promise(r=>s.close(r));}}
test('power allowlist excludes force, arbitrary commands, client paths and direct execution',()=>{
 for(const value of ['shutdown','restart']){assert(validAction({action:'prepare',value}));assert(validAction({action:'confirm',value,confirmation:key}));assert.deepEqual(command(value).args,[value==='shutdown'?'/s':'/r','/t','0']);assert.match(command(value).file,/System32[\\/]shutdown\.exe$/);}
 assert(validAction({action:'cancel',confirmation:key}));
 for(const a of [null,[],{action:'shutdown'},{action:'prepare',value:'sleep'},{action:'prepare',value:'restart',force:true},{action:'confirm',value:'shutdown'},{action:'confirm',value:'restart',confirmation:key,command:'calc.exe'},{action:'confirm',value:'C:/shutdown.exe',confirmation:key},{action:'cancel',confirmation:'x'}])assert.equal(!!validAction(a),false);
 assert.throws(()=>command('shutdown /f'));
});
test('prepare and cancel never execute; confirmation executes once and only the chosen action',async()=>{
 for(const value of ['shutdown','restart']){let calls=[];await server({execute:async value=>calls.push(value)},async send=>{
  const prepared=await(await send({action:'prepare',value})).json();assert.match(prepared.confirmation,/^[a-f0-9]{64}$/);assert.equal(calls.length,0);
  assert.equal((await send({action:'cancel',confirmation:prepared.confirmation})).status,200);assert.equal((await send({action:'confirm',value,confirmation:prepared.confirmation})).status,409);assert.equal(calls.length,0);
  const next=await(await send({action:'prepare',value})).json();assert.equal((await send({action:'confirm',value,confirmation:next.confirmation})).status,202);assert.deepEqual(calls,[value]);assert.equal((await send({action:'confirm',value,confirmation:next.confirmation})).status,409);assert.deepEqual(calls,[value]);
 });}
});
test('missing, expired or mismatched confirmation never reaches Windows',async()=>{
 let time=1000,calls=0;await server({execute:async()=>calls++,now:()=>time},async send=>{
  assert.equal((await send({action:'confirm',value:'shutdown',confirmation:key})).status,409);
  const a=await(await send({action:'prepare',value:'shutdown'})).json();time=a.expiresAt;assert.equal((await send({action:'confirm',value:'shutdown',confirmation:a.confirmation})).status,409);
  const b=await(await send({action:'prepare',value:'shutdown'})).json();assert.equal((await send({action:'confirm',value:'restart',confirmation:b.confirmation})).status,409);assert.equal((await send({action:'confirm',value:'shutdown',confirmation:b.confirmation})).status,409);assert.equal(calls,0);
 });
});
test('HTTP rejects foreign origins, missing capability, wrong methods and oversized requests',async()=>{
 let calls=0;await server({execute:async()=>calls++},async(send,url)=>{
  assert.equal((await fetch(url,{headers})).status,405);assert.equal((await send({action:'prepare',value:'shutdown'},{Origin:'https://example.com'})).status,403);
  assert.equal((await send({action:'prepare',value:'shutdown'},{'X-VioletGhost-Key':''})).status,403);assert.equal((await send('{}',{'Content-Type':'text/plain'})).status,415);assert.equal((await send('x'.repeat(1025))).status,413);assert.equal((await send('{')).status,400);assert.equal(calls,0);
 });
});
test('simultaneous confirmations on two monitors dispatch only once and invalidate other challenges',async()=>{
 let release,calls=0,time=1000;await server({now:()=>time,execute:()=>{calls++;return new Promise(r=>release=r);}},async send=>{
  const a=await(await send({action:'prepare',value:'shutdown'})).json(),b=await(await send({action:'prepare',value:'restart'})).json();
  const first=send({action:'confirm',value:'shutdown',confirmation:a.confirmation});const end=Date.now()+3000;while(!release&&Date.now()<end)await new Promise(r=>setImmediate(r));assert(release);
  assert.equal((await send({action:'confirm',value:'restart',confirmation:b.confirmation})).status,409);release();assert.equal((await first).status,202);time+=10001;assert.equal((await send({action:'confirm',value:'restart',confirmation:b.confirmation})).status,409);assert.equal(calls,1);
 });
});
test('native failure stays a failure; its consumed confirmation cannot be retried',async()=>{
 let calls=0;await server({execute:async()=>{calls++;throw Error('fixture failure');}},async send=>{
  const a=await(await send({action:'prepare',value:'shutdown'})).json(),action={action:'confirm',value:'shutdown',confirmation:a.confirmation};assert.equal((await send(action)).status,503);assert.equal((await send(action)).status,409);assert.equal(calls,1);
 });
});
