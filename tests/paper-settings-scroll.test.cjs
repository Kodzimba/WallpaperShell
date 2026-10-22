'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../runtime/wallpaper/launcher.js');
function setup(scale=1,native=false){
 const nodes=new Map(),events={},observers=[],calls=[];let serial=0;const timers=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:false,value:id==='bridgeInput'?'http://127.0.0.1:8767/status':'',style:{},events:{},attrs:{},scrollTop:0,clientHeight:600,scrollHeight:id==='settingsViewport'?1800:600,captured:false,classList:{toggle(){},contains:()=>false},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.events[k]=fn;},contains(el){return el===this||el?.id==='settingsViewport';},setPointerCapture(){this.captured=true;},hasPointerCapture(){return this.captured;},releasePointerCapture(){this.captured=false;},getBoundingClientRect:()=>({left:32,top:100,right:800,bottom:100+600*scale,height:600*scale})});return nodes.get(id);};
 const document={hidden:false,body:get('body'),getElementById:get,addEventListener(k,fn){(events[k]??=[]).push(fn);}};
 const context={document,VGLauncherMath:M,VG_LOCAL_CONTROL_KEY:'a'.repeat(64),innerWidth:2560,innerHeight:1440,devicePixelRatio:1,URL,AbortController,AbortSignal,Date,Uint8Array,crypto:require('node:crypto').webcrypto,performance:{now:()=>1000},addEventListener(){},ResizeObserver:class{constructor(fn){observers.push(fn);}observe(){}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{calls.push({url,options});if(options.method==='POST')return {ok:true};return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}};
 if(native)context.wallpaperRegisterMediaPropertiesListener=()=>{};context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/settings-scroll.js'),'utf8'),context);
 return {get,calls,context,refresh:()=>observers.forEach(fn=>fn()),emit(type,event={}){for(const fn of events[type]||[])fn({type,...event});},event:(y=0)=>({type:'pointerdown',pointerId:1,button:0,clientY:y,preventDefault(){},stopPropagation(){}})};
}
test('settings wheel and thumb reach both ends at 2K and 4K scales; releasing anywhere ends dragging',()=>{
 for(const scale of [1,4/3,2]){const a=setup(scale),view=a.get('settingsViewport'),thumb=a.get('settingsScrollThumb');a.get('settings').events.wheel({type:'wheel',deltaY:120,deltaMode:0,preventDefault(){},stopPropagation(){}});assert.equal(view.scrollTop,120);
  thumb.events.pointerdown(a.event(100));a.emit('pointermove',{...a.event(100+1000*scale),type:'pointermove'});assert.equal(view.scrollTop,1200);a.emit('mouseup');a.emit('pointermove',a.event(0));assert.equal(view.scrollTop,1200);assert.equal(thumb.captured,false);
  thumb.events.keydown({key:'Home',preventDefault(){}});assert.equal(view.scrollTop,0);
 }
});
test('click outside closes settings while clicks on settings or their toggle preserve them',()=>{
 const a=setup(),panel=a.get('settings');a.emit('pointerdown',{target:a.get('settingsViewport')});assert.equal(panel.hidden,false);a.emit('pointerdown',{target:a.get('settingsToggle')});assert.equal(panel.hidden,false);a.emit('pointerdown',{target:{id:'outside'}});assert.equal(panel.hidden,true);
});
test('release uses the final pointer position when Engine drops intermediate moves',()=>{
 const a=setup(4/3),view=a.get('settingsViewport'),thumb=a.get('settingsScrollThumb');view.scrollTop=1200;thumb.events.pointerdown(a.event(600));a.emit('pointerup',{pointerId:1,clientY:0});assert.equal(view.scrollTop,0);assert.equal(thumb.captured,false);
});
test('native wheel delivery leases only the visible settings rectangle and releases on close',async()=>{
 const a=setup(4/3,true);await new Promise(r=>setImmediate(r));const registration=a.calls.find(c=>c.options.method==='POST');const body=JSON.parse(registration.options.body);assert.equal(body.width,2560);assert.equal(body.height,1440);assert(body.rect.every(v=>v>=0&&v<=1));
 a.get('settings').hidden=true;a.refresh();assert(a.calls.some(c=>c.options.body&&JSON.parse(c.options.body).release===true));
});
