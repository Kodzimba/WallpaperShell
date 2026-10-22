'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {validAction,authorized,createHandler}=require('../runtime/companion/desktop-controls.cjs');
const key='a'.repeat(64),headers={'content-type':'application/json','x-violetghost-action':'desktop','x-violetghost-key':key,origin:'null'};
test('desktop controls accept only the five fixed choices',()=>{
 for(const [kind,value] of [['audio','headphones'],['audio','speakers'],['audio','tv'],['displays','single'],['displays','dual']])assert(validAction({kind,value}));
 for(const value of [null,{},[],{kind:'audio',value:'powershell.exe'},{kind:'toString',value:'tv'},{kind:'__proto__',value:'dual'},{kind:'displays',value:'single',command:'calc.exe'},{kind:'ecoflow',value:'off'}])assert.equal(validAction(value),false);
});
test('media commands bind to a session and volume is an integer bound to an output',()=>{
 for(const value of ['play','pause','previous','next'])assert(validAction({kind:'media',value,session:key}));
 assert(validAction({kind:'volume',value:0,target:key}));assert(validAction({kind:'volume',value:100,target:key}));
 for(const action of [{kind:'media',value:'pause'},{kind:'media',value:'seek',session:key},{kind:'media',value:'play',session:key,command:'calc'},{kind:'volume',value:-1,target:key},{kind:'volume',value:101,target:key},{kind:'volume',value:4.5,target:key},{kind:'volume',value:'4',target:key},{kind:'volume',value:4,target:'any'}])assert.equal(validAction(action),false);
});
test('opaque local origin still needs the local capability; foreign origins and malformed keys fail',()=>{
 assert(authorized({headers},key));
 for(const change of [{origin:'https://example.com'},{'x-violetghost-key':undefined},{'x-violetghost-key':'b'.repeat(64)},{'x-violetghost-key':'я'.repeat(64)},{'x-violetghost-action':'audio'}])assert.equal(authorized({headers:{...headers,...change}},key),false);
});
async function withServer(dispatch,fn){const handler=createHandler({key,dispatch});const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn('http://127.0.0.1:'+server.address().port);}finally{await new Promise(r=>server.close(r));}}
test('HTTP rejects forbidden, oversized and arbitrary commands before dispatch',async()=>{
 let calls=0;await withServer(async()=>{calls++;},async url=>{
  const send=(body,change={},method='POST')=>fetch(url,{method,headers:{...headers,...change},...(method==='POST'?{body}:{} )});
  assert.equal((await send('{}',{},'GET')).status,405);
  assert.equal((await send('{}',{'x-violetghost-key':''})).status,403);
  assert.equal((await send('{}',{origin:'https://example.com'})).status,403);
  assert.equal((await send('{}',{'content-type':'text/plain'})).status,415);
  assert.equal((await send('x'.repeat(1025))).status,413);
  assert.equal((await send('{broken')).status,400);
  assert.equal((await send(JSON.stringify({kind:'audio',value:'tv; calc.exe'}))).status,400);
  assert.equal(calls,0);
 });
});
test('HTTP serializes switches and returns only confirmed state; failures remain failures',async()=>{
 let release,calls=0;await withServer(()=>{calls++;return new Promise(r=>release=r);},async url=>{
  const send=()=>fetch(url,{method:'POST',headers,body:JSON.stringify({kind:'audio',value:'tv'})});
  let firstError;const first=send().catch(error=>{firstError=error;return null;});const deadline=Date.now()+3000;while(!release&&!firstError&&Date.now()<deadline)await new Promise(r=>setImmediate(r));if(firstError)throw firstError;assert(release,'dispatch timeout');
  assert.equal((await send()).status,409);assert.equal(calls,1);
  release({status:'ok',data:{audio:[{key:'tv',selected:true}]}});const response=await first;assert.equal(response.status,200);assert.equal((await response.json()).source.data.audio[0].selected,true);
 });
 await withServer(async()=>{throw Error('native failure');},async url=>{const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({kind:'displays',value:'dual'})});assert.equal(response.status,503);assert.equal((await response.json()).source,undefined);});
});
