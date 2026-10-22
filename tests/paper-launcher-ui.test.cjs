'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../runtime/wallpaper/launcher.js');
const fs=require('node:fs'),vm=require('node:vm');
test('selection supports individual toggles, forward/backward ranges and excludes invisible files',()=>{
 const order=['a','b','c','d'];assert.deepEqual([...M.pickSelection(order,[] ,null,'b')],['b']);
 assert.deepEqual([...M.pickSelection(order,['a'],'a','c',{toggle:true})],['a','c']);assert.deepEqual([...M.pickSelection(order,['a','c'],'a','c',{toggle:true})],['a']);
 assert.deepEqual([...M.pickSelection(order,['d'],'a','c',{range:true})],['a','b','c']);assert.deepEqual([...M.pickSelection(order,[],'d','b',{range:true})],['b','c','d']);
 assert.deepEqual([...M.pickSelection(order,['d','hidden'],'a','b',{range:true,toggle:true})],['d','a','b']);
 assert.deepEqual([...M.pickSelection(order,['hidden'],'missing','c',{range:true})],['c']);
});
test('rubber selection intersects tiles at transformed scales and after vertical scrolling',()=>{
 for(const scale of [5/6,4/3,2,4])for(const scroll of [0,200]){const tile={left:10*scale,right:110*scale,top:(200-scroll)*scale,bottom:(380-scroll)*scale};assert(M.intersects({left:0,right:50*scale,top:(250-scroll)*scale,bottom:(400-scroll)*scale},tile));assert(!M.intersects({left:120*scale,right:200*scale,top:0,bottom:900*scale},tile));}
});
test('native icons never exceed their source pixels at either monitor scale',()=>{
 for(const scale of [0.833333,1,4/3,2,4])for(const pixels of [16,32,48,64,128,256]){
  const size=M.rasterSize(pixels,pixels,scale,48,48);assert(size.width<=48);assert(size.width*scale<=pixels+1e-8);assert.equal(size.width,size.height);
 }
 assert.deepEqual(M.rasterSize(256,256,2,48,48),{width:48,height:48});
 assert.deepEqual(M.rasterSize(32,32,2,48,48),{width:16,height:16});
 const preview=M.rasterSize(384,216,2,160,106);assert.equal(preview.width,160);assert.equal(preview.height,90);
});
test('scroll thumb reaches the exact first and last item and respects transformed screen coordinates',()=>{
 const metrics=M.scrollMetrics(600,1800,524);assert.equal(metrics.max,1200);
 for(const scale of [0.833333,4/3,2]){assert.equal(M.dragScroll(0,metrics.travel*scale,metrics.max,metrics.travel*scale),1200);assert.equal(M.dragScroll(1200,-metrics.travel*scale,metrics.max,metrics.travel*scale),0);assert.equal(M.dragScroll(0,1e6,metrics.max,metrics.travel*scale),1200);}
 assert.equal(M.scrollMetrics(600,400,524).max,0);assert.equal(M.dragScroll(500,100,0,0),0);
});
test('wheel scrolling handles pixel, line, page and legacy events with bounded movement',()=>{
 assert.equal(M.wheelDelta({deltaY:120,deltaMode:0},600),120);
 assert.equal(M.wheelDelta({deltaY:3,deltaMode:1},600),72);
 assert.equal(M.wheelDelta({deltaY:1,deltaMode:2},600),600);
 assert.equal(M.wheelDelta({wheelDelta:120},600),-120);
 assert.equal(M.wheelDelta({deltaY:1e9},600),1200);
});
test('desktop-host release on another element stops dragging even when move events report buttons=0',()=>{
 const elements=new Map(),documentEvents=new Map();
 function element(id){if(!elements.has(id))elements.set(id,{style:{},classList:{toggle(){}},events:new Map(),scrollTop:0,clientHeight:id==='launcherScrollTrack'?524:600,scrollHeight:1800,offsetHeight:470,disabled:false,captured:false,querySelectorAll:()=>[],setAttribute(){},contains:()=>false,getBoundingClientRect:()=>({top:200,height:524*2}),addEventListener(type,fn){this.events.set(type,fn);},setPointerCapture(){this.captured=true;},hasPointerCapture(){return this.captured;},releasePointerCapture(){this.captured=false;}});return elements.get(id);}
 const document={getElementById:element,addEventListener(type,fn){const all=documentEvents.get(type)||[];all.push(fn);documentEvents.set(type,all);}},window={VGLauncherMath:M,addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/launcher.js'),'utf8'),{module:{exports:{}},window,document,clearTimeout,setTimeout,performance:{now:()=>0}});
 const event=(type,y)=>({type,pointerId:1,button:0,buttons:type==='pointerdown'?1:0,clientY:y,preventDefault(){},stopPropagation(){}}),emit=(type,y)=>{for(const fn of documentEvents.get(type)||[])fn(event(type,y));};
 const items=element('launcherItems'),thumb=element('launcherScrollThumb');
 for(const release of ['pointerup','mouseup','pointercancel']){
  items.scrollTop=0;thumb.events.get('pointerdown')(event('pointerdown',300));emit('pointermove',500);assert(items.scrollTop>0);const last=items.scrollTop;
  emit(release,500);assert.equal(thumb.captured,false);emit('pointermove',800);assert.equal(items.scrollTop,last);
 }
});
