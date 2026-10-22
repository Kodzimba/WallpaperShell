'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {validRegion,createInputBridge}=require('../runtime/companion/launcher-input.cjs');
const key='a'.repeat(64),id='b'.repeat(32),other='c'.repeat(32),headers={'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':key,Origin:'null'};
const region={id,width:3840,height:2160,rect:[.15,.12,.62,.85]};
test('wheel leases accept only bounded geometry and opaque identifiers',()=>{
 assert(validRegion(region));assert(validRegion({id,release:true}));
 for(const value of [null,{...region,id:'x'},{...region,rect:[0,0,2,1]},{...region,rect:[.8,0,.2,1]},{...region,width:Infinity},{...region,path:'C:/secret'},{id,release:false}])assert.equal(!!validRegion(value),false);
});
async function fixture(){
 let time=100000,enabled=true,snapshot=[];
 const bridge=createInputBridge({key,enabled:()=>enabled,updateNative:value=>{snapshot=value;},now:()=>time});
 const server=http.createServer(bridge.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 return {bridge,url,post:value=>fetch(url,{method:'POST',headers,body:JSON.stringify(value)}),snapshot:()=>snapshot,advance:ms=>{time+=ms;},enable:value=>{enabled=value;},close:async()=>{bridge.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test('native wheel delivery is authenticated, isolated per open panel, and sequenced once',async()=>{
 const f=await fixture();try{
  assert.equal((await fetch(f.url)).status,403);assert.equal((await fetch(f.url,{headers:{...headers,Origin:'https://example.com'}})).status,403);
  assert.equal((await f.post(region)).status,503);f.bridge.setAvailable(true);assert.equal((await f.post(region)).status,204);
  assert.equal(f.snapshot()[0].expires,104000);assert.deepEqual(f.snapshot()[0].rect,region.rect);
  f.bridge.push({id:other,delta:120});f.bridge.push({id,delta:120});
  const first=await (await fetch(f.url+'?id='+id+'&after=0',{headers})).json();assert.equal(first.events.length,1);assert.equal(first.events[0].delta,120);
  const pending=fetch(f.url+'?id='+id+'&after='+first.events[0].seq,{headers}).then(r=>r.json());
  await new Promise(resolve=>setTimeout(resolve,20));f.bridge.push({id,delta:-120});const next=await pending;assert.equal(next.events.length,1);assert.equal(next.events[0].delta,-120);assert(next.events[0].seq>first.events[0].seq);
  const summary=await (await fetch(f.url,{headers})).json();assert.deepEqual(summary.counts,{'3840x2160':2});assert(!JSON.stringify(summary).includes(id));
 }finally{await f.close();}
});
test('closed, expired and disabled panels never receive wheel input; stale events are discarded',async()=>{
 const f=await fixture();try{
  f.bridge.setAvailable(true);await f.post(region);f.bridge.push({id,delta:120});f.advance(1200);
  const pending=fetch(f.url+'?id='+id+'&after=0',{headers}).then(r=>r.json());await new Promise(resolve=>setTimeout(resolve,20));await f.post({id,release:true});assert.deepEqual((await pending).events,[]);assert.deepEqual(f.snapshot(),[]);
  f.bridge.push({id,delta:120});assert.equal((await fetch(f.url+'?id='+id,{headers})).status,409);
  await f.post(region);f.advance(4001);f.bridge.push({id,delta:120});assert.equal((await fetch(f.url+'?id='+id,{headers})).status,409);
  await f.post(region);f.enable(false);f.bridge.push({id,delta:120});assert.equal((await fetch(f.url+'?id='+id,{headers})).status,409);
  f.bridge.setAvailable(false);assert.deepEqual(f.snapshot(),[]);const summary=await (await fetch(f.url,{headers})).json();assert.equal(summary.counts['3840x2160'],1);
 }finally{await f.close();}
});
test('a restarted companion identifies a new wheel stream so the page can reset its cursor',async()=>{
 let previous;
 for(let i=0;i<2;i++){
  const f=await fixture();try{f.bridge.setAvailable(true);await f.post(region);f.bridge.push({id,delta:120});const payload=await (await fetch(f.url+'?id='+id,{headers})).json();assert.match(payload.stream,/^[a-f0-9]{16}$/);assert.notEqual(payload.stream,previous);previous=payload.stream;}finally{await f.close();}
 }
});
