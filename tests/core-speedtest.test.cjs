'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {measure}=require('../runtime/companion/speedtest.cjs');
test('buttons request one shared companion measurement; loading the page never starts a test',async()=>{
 const callbacks={},result={textContent:''},nodes={speedResult:result,bridgeInput:{value:'http://127.0.0.1:8767/status'}};
 for(const id of ['speedTest','networkTest'])nodes[id]={disabled:false,addEventListener:(event,fn)=>callbacks[id]=fn};
 const calls=[],context={window:{VGCore:require('../runtime/wallpaper/core.js')},document:{getElementById:id=>nodes[id]},URL,Date,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:202};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/speedtest.js'),'utf8'),context);
 assert.equal(calls.length,0);await Promise.all([callbacks.speedTest(),callbacks.networkTest()]);assert.equal(calls.length,1);
 assert.equal(calls[0].url,'http://127.0.0.1:8767/speedtest');assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.headers['X-VioletGhost-Action'],'speedtest');
});
test('shared speed probe limits traffic to 200 MB and measures real transferred bytes',async()=>{
 let tick=0;const calls=[];
 const value=await measure({clock:()=>tick++*400,fill:bytes=>assert.equal(bytes.length,25000000),fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,body:[{length:50000000}],arrayBuffer:async()=>new ArrayBuffer(0)};}});
 assert.equal(calls.length,5);assert.equal(calls.filter(c=>!c.options.method).length,3);assert(calls.filter(c=>c.options.method==='POST').every(c=>c.options.body.length===25000000));
 assert.equal(value.transferredBytes,200000000);assert.equal(value.downMbps,1000);assert.equal(value.upMbps,500);assert(calls.every(c=>c.options.credentials==='omit'&&c.url.startsWith('https://speed.cloudflare.com/')));
});
test('incomplete download rejects the probe before any upload',async()=>{
 let calls=0;await assert.rejects(()=>measure({clock:()=>++calls,fetcher:async()=>({ok:true,body:[{length:2}]})}),/Incomplete/);
});
