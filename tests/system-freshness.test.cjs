'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../runtime/wallpaper/core.js');
const now=Date.parse('2026-10-21T20:00:00Z'),fresh=new Date(now-3000).toISOString(),old=new Date(now-60000).toISOString();
const source=(measurements,updatedAt=fresh)=>({status:'ok',updatedAt,measurements,data:{ramUsedBytes:4,ramTotalBytes:16,vramUsedBytes:3,vramTotalBytes:8,gpuName:'Fixture GPU'}});
test('RAM/VRAM freshness uses separate measurement times without mutating source',()=>{
 const input=source({ram:fresh,vram:old},old),s=C.freshSystem(input,now);assert.equal(s.data.ramUsedBytes,4);assert.equal(s.data.vramUsedBytes,null);assert.equal(s.updatedAt,fresh);assert.equal(input.data.vramUsedBytes,3);assert.equal(C.sourceState(s,now),'ok');
 const reverse=C.freshSystem(source({ram:old,vram:fresh},old),now);assert.equal(reverse.data.ramUsedBytes,null);assert.equal(reverse.data.vramUsedBytes,3);
});
test('missing legacy field timestamps fall back; explicit null never borrows another field freshness',()=>{
 const legacy=C.freshSystem(source(undefined),now);assert.equal(legacy.data.vramUsedBytes,3);
 const nullGpu=C.freshSystem(source({ram:fresh,vram:null}),now);assert.equal(nullGpu.data.vramUsedBytes,null);assert.equal(nullGpu.data.gpuName,'Fixture GPU');
});
test('both expired fields remain stale; future measurements cannot make values fresh',()=>{
 const stale=C.freshSystem(source({ram:old,vram:old}),now);assert.equal(C.sourceState(stale,now),'stale');assert.equal(stale.data.ramUsedBytes,null);
 const future=C.freshSystem(source({ram:new Date(now+60000).toISOString(),vram:null}),now);assert.notEqual(C.sourceState(future,now),'ok');assert.equal(future.data.ramUsedBytes,null);
 assert.equal(C.freshSystem(null,now),null);const unavailable={...source(),status:'unavailable'};assert.equal(C.freshSystem(unavailable,now),unavailable);
});
