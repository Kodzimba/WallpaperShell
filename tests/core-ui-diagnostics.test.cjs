'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDiagnostics}=require('../runtime/companion/ui-diagnostics.cjs');
const key='a'.repeat(64);
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);return this;},end(body){this.body=body;}};}
const headers={origin:'null','x-violetghost-action':'desktop','x-violetghost-key':key};
const url=(instance='a'.repeat(12))=>new URL('http://127.0.0.1:8767/status?vgBuild=input2k1&vgProfile=display-1&vgViewport=2560x1440&vgContext=engine&vgFrames=10&vgInstance='+instance);
test('diagnostics require the local capability; foreign origins fail even with a key',()=>{
 const a=createDiagnostics({key});
 for(const h of [{}, {...headers,'x-violetghost-key':'b'.repeat(64)},{...headers,origin:'https://example.com'}]){const r=response();a.handler({method:'GET',headers:h},r);assert.equal(r.status,403);assert.equal(r.body,undefined);}
 const preflight=response();a.handler({method:'OPTIONS',headers:{origin:'null'}},preflight);assert.equal(preflight.status,204);
 const ok=response();a.handler({method:'GET',headers},ok);assert.equal(ok.status,200);assert.deepEqual(JSON.parse(ok.body),{clients:[]});
});
test('diagnostics retain only bounded latest technical states and separate simultaneous renderers',()=>{
 let now=100;const a=createDiagnostics({key,now:()=>now});
 const first=url(),q=first.searchParams;q.set('vgFrames','NaN');q.set('vgGearHit','yes');q.set('history','private');a.record(first);
 a.record(url('b'.repeat(12)));now=200;
 const read=()=>{const r=response();a.handler({method:'GET',headers},r);return JSON.parse(r.body).clients;};
 let c=read();assert.equal(c.length,2);assert.equal(c[0].frames,null);assert.equal(c[0].gearHit,'yes');assert.equal(c[0].age,100);assert(!JSON.stringify(c).includes('private'));
 q.set('vgFrames','20');a.record(first);c=read();assert.equal(c.length,2);assert.equal(c.at(-1).frames,20);assert.equal(c.at(-1).age,0);
 for(let i=0;i<30;i++)a.record(url(i.toString(16).padStart(12,'0')));assert.equal(read().length,12);
 const bad=url();bad.searchParams.set('vgProfile','any');a.record(bad);assert.equal(read().length,12);
});
