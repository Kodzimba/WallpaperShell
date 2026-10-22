'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDOMFixture}=require('./helpers/editor-dom.cjs'),C=require('../runtime/wallpaper/custom-widget-model.js'),Core=require('../runtime/wallpaper/core.js');
const note=()=>({version:1,title:'Fixture',kind:'note',width:320,height:180,accent:'#b6d8f8',text:'Synthetic text',binding:'none',unit:'',target:'',items:[],art:'none'});
function setup(specs=[]){
 const f=createDOMFixture({theme:'luna-blue'});f.document.hidden=false;let now=Date.parse('2026-10-21T12:34:22Z'),seq=0,notify,observer,doc={items:specs.map((spec,i)=>({id:'custom-fixture-'+i,spec,geometry:C.geometry(spec)}))};const timers=new Map();
 Object.assign(f.window,{PGCustomWidgetModel:C,VGCore:{...Core,freshSystem:source=>Core.freshSystem(source,now)},PGCustomWidgets:{current:()=>doc,subscribe(fn){notify=fn;fn();return ()=>{notify=null;};}},setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)});
 f.context.Date=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 f.context.localStorage={getItem:()=>null,setItem(){}};
 f.context.MutationObserver=class{constructor(fn){observer=fn;}observe(){}disconnect(){observer=null;}};
 f.load('custom-widget-renderer.js');
 return {...f,timers,now:()=>now,node:i=>f.document.querySelector('[data-custom-widget="custom-fixture-'+i+'"]'),snapshot:sources=>f.fire(f.window,'daylight:snapshot',{detail:{sources}}),advance(ms){now+=ms;for(const [id,task]of [...timers])if(task.at<=now){timers.delete(id);task.fn();}},change(items){doc={items};notify?.();},refresh:()=>notify?.(),pause(value){f.document.body.classList.toggle('engine-paused',value);observer?.();}};
}
test('empty, static and hidden custom widgets have no periodic wakeups or repeated geometry writes',()=>{
 const empty=setup();assert.equal(empty.timers.size,0);
 const f=setup([note()]);assert.equal(f.timers.size,0);const node=f.node(0);let writes=0;
 node.style=new Proxy(node.style,{set(target,key,value){writes++;target[key]=value;return true;}});
 for(let i=0;i<100;i++){f.refresh();f.snapshot({});}assert.equal(writes,0);assert.equal(f.timers.size,0);
 const clock={...note(),kind:'clock'},g=C.geometry(clock,{visible:false});f.change([{id:'custom-fixture-1',spec:clock,geometry:g}]);assert.equal(f.timers.size,0);
});
test('clocks and countdowns wake only when their displayed minute can change',()=>{
 const f=setup([{...note(),kind:'clock'}]),value=f.node(0).querySelector('.pg-custom-value'),before=value.textContent;
 assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.at-f.now(),38001);
 f.advance(37000);assert.equal(value.textContent,before);f.advance(1001);assert.notEqual(value.textContent,before);assert.equal(f.timers.size,1);
 const countdown={...note(),kind:'countdown',target:new Date(f.now()+120001).toISOString()};f.change([{id:'custom-fixture-2',spec:countdown,geometry:C.geometry(countdown)}]);
 assert.equal([...f.timers.values()][0].at-f.now(),2);f.advance(2);assert.equal(f.node(2).querySelector('.pg-custom-value').textContent,'00:01');f.advance(60000);assert.equal(f.node(2).querySelector('.pg-custom-value').textContent,'00:00');assert.equal(f.timers.size,0);
});
test('metric expiry remains exact without polling and new snapshots update immediately',()=>{
 const f=setup([{...note(),kind:'metric',binding:'mouseBattery',unit:'%'}]),value=f.node(0).querySelector('.pg-custom-value');assert.equal(f.timers.size,0);
 const source={status:'ok',updatedAt:new Date(f.now()-100000).toISOString(),data:{batteryPercent:74}};
 f.snapshot({mouse:source});assert.equal(value.textContent,'74 %');assert.equal([...f.timers.values()][0].at-f.now(),20001);
 f.advance(20001);assert.equal(value.textContent,'—');assert.equal(f.timers.size,0);
 f.snapshot({mouse:{...source,updatedAt:new Date(f.now()).toISOString(),data:{batteryPercent:75}}});assert.equal(value.textContent,'75 %');assert.equal(f.timers.size,1);
});
test('RAM/VRAM timers retain independent measurement freshness and explicit null never borrows aggregate time',()=>{
 const f=setup([{...note(),kind:'metric',binding:'ramUsed'},{...note(),kind:'metric',binding:'vramUsed'}]),at=new Date(f.now()).toISOString();
 f.snapshot({system:{status:'ok',updatedAt:at,measurements:{ram:at,vram:null},data:{ramUsedBytes:4*2**30,ramTotalBytes:16*2**30,vramUsedBytes:2**30,vramTotalBytes:8*2**30}}});
 assert.equal(f.node(0).querySelector('.pg-custom-value').textContent,'4');assert.equal(f.node(1).querySelector('.pg-custom-value').textContent,'—');assert.equal(f.timers.size,1);
 f.advance(15001);assert.equal(f.node(0).querySelector('.pg-custom-value').textContent,'—');assert.equal(f.timers.size,0);
});
test('paused or hidden custom widgets neither update nor keep timers; resume refreshes and pagehide disposes',()=>{
 const f=setup([{...note(),kind:'metric',binding:'mouseBattery'}]),value=f.node(0).querySelector('.pg-custom-value');
 const send=batteryPercent=>f.snapshot({mouse:{status:'ok',updatedAt:new Date(f.now()).toISOString(),data:{batteryPercent}}});
 send(70);assert.equal(value.textContent,'70');f.pause(true);assert.equal(f.timers.size,0);send(60);assert.equal(value.textContent,'70');f.pause(false);assert.equal(value.textContent,'60');assert.equal(f.timers.size,1);
 f.document.hidden=true;f.fire(f.document,'visibilitychange');assert.equal(f.timers.size,0);send(50);assert.equal(value.textContent,'60');f.document.hidden=false;f.fire(f.document,'visibilitychange');assert.equal(value.textContent,'50');
 f.fire(f.window,'pagehide');assert.equal(f.timers.size,0);send(40);assert.equal(value.textContent,'50');
});
