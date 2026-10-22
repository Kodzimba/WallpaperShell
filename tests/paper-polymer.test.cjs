'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 let now=0,id=0,buffers=0,resized;const frames=new Map(),uniforms={};
 const methods={getShaderParameter:()=>true,getProgramParameter:()=>true,createBuffer:()=>{buffers++;return {};},getUniformLocation:(_,name)=>name,uniform1f:(name,value)=>{uniforms[name]=value;},uniform3fv:(name,value)=>{uniforms[name]=Array.from(value);},viewport:(...args)=>uniforms.viewport=args};
 const gl=new Proxy(methods,{get:(o,k)=>o[k]||(()=>({}))});
 const canvas={dataset:{},clientWidth:670,clientHeight:510,getContext:()=>gl,addEventListener(){},setAttribute(){}};
 const document={hidden:false,getElementById:()=>canvas,addEventListener(){}};
 const context={document,ResizeObserver:class{constructor(callback){resized=callback;}observe(){}},matchMedia:()=>({matches:false,addEventListener(){}}),performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)};context.window=context;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../runtime/wallpaper/polymer.js'),'utf8'),context);
 return {api:context.VGLiquid,uniforms,frames,buffers:()=>buffers,resize(width,height){canvas.clientWidth=width;canvas.clientHeight=height;resized();},advance(ms){for(let end=now+ms;now<end;){now+=50;const next=[...frames.values()];frames.clear();for(const fn of next)fn(now);}}};
}
test('projection and viewport follow the displayed scene aspect without increasing GPU allocation or restarting the geometry',()=>{
 const a=setup();assert.equal(a.uniforms.aspect,670/510);assert.deepEqual(a.uniforms.viewport,[0,0,800,609]);assert.equal(a.buffers(),2);
 a.advance(300);const clock=a.uniforms.time;a.resize(960,400);assert.equal(a.uniforms.aspect,2.4);assert.deepEqual(a.uniforms.viewport,[0,0,800,333]);assert.equal(a.uniforms.time,clock);assert.equal(a.buffers(),2);
 a.api.setPaused(true);a.resize(400,800);assert.equal(a.uniforms.aspect,.5);assert.deepEqual(a.uniforms.viewport,[0,0,376,752]);assert.equal(a.frames.size,0);assert(a.api.diagnostics().bufferWidth*a.api.diagnostics().bufferHeight<=800*752);
 a.resize(0,0);assert.equal(a.uniforms.aspect,.5,'Hidden scenes keep their last valid aspect');
});
test('repeated unchanged Engine flags do not reset animation time; pause stops scheduling',()=>{
 const a=setup();for(let i=0;i<10;i++){a.api.setPaused(false);a.api.setMotion(true);a.advance(50);}assert(a.uniforms.time>.4);
 a.api.setPaused(true);assert.equal(a.frames.size,0);const held=a.uniforms.time;a.advance(500);assert.equal(a.uniforms.time,held);
 a.api.setPaused(false);a.advance(200);assert(a.uniforms.time>held);assert.equal(a.buffers(),2);
});
test('changing appearance updates the shader without rebuilding geometry or stopping sound reaction',()=>{
 const a=setup(),buffers=a.buffers();a.api.setPalette({background:[.1,.12,.08],dark:true});a.api.setAudio({energy:.6,bass:.7});a.advance(200);
 assert.deepEqual(a.uniforms.backgroundColor,[.1,.12,.08]);assert(a.uniforms.energy>0);assert.equal(a.buffers(),buffers);assert(a.frames.size>0);
 a.api.setPalette({background:[202/255,1,0],dark:false});a.advance(100);assert.deepEqual(a.uniforms.backgroundColor,[202/255,1,0]);assert(a.uniforms.energy>0);
});
test('real bass drives the envelope even with zero broadband energy; silence decays',()=>{
 const a=setup();assert.equal(a.uniforms.energy,0);a.api.setAudio({energy:0,bass:1});a.advance(100);assert(a.uniforms.energy>.3);
 a.api.setAudio({energy:0,bass:0});a.advance(3000);assert(a.uniforms.energy<.001);
 a.api.setMotion(false);assert.equal(a.frames.size,0);assert.equal(a.uniforms.energy,0);
});
test('audio scale preserves changes in ordinary and loud sound instead of clipping to a fixed ceiling',()=>{
 const C=require('../runtime/wallpaper/core.js');
 const input=v=>Array(128).fill(v),values=[0,.0002,.002,.02,.06,.25,1];
 const heights=values.map(C.audioHeight),energy=values.map(v=>C.audioResponse(input(v)).energy);
 assert.equal(heights[0],0);assert.equal(energy[0],0);
 for(let i=1;i<values.length;i++){assert(heights[i]>heights[i-1]);assert(energy[i]>energy[i-1]);}
 assert(energy.at(-1)<1);assert(heights.at(-1)<=100);
 const a=setup();a.api.setAudio(C.audioResponse(input(.02)));a.advance(500);const quiet=a.uniforms.energy;
 a.api.setAudio(C.audioResponse(input(.06)));a.advance(500);assert(a.uniforms.energy>quiet+.1);assert(a.uniforms.energy<1);
});
