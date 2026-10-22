'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(width,{theme='paper-green',cached=false}={}){
 const messages=[],handlers={},observed=[],stage={style:{}},panel={hidden:false,offsetHeight:500},feedback={hidden:true,style:{}};let configured=0;
 const rect=(x,y,w,h)=>()=>{const scale=Number(stage.style.transform?.match(/[\d.]+/)?.[0]||1),left=parseFloat(stage.style.left)||0,top=parseFloat(stage.style.top)||0;return {left:x*scale+left,top:y*scale+top,right:(x+w)*scale+left,bottom:(y+h)*scale+top,width:w*scale,height:h*scale};};
 const nav={getBoundingClientRect:rect(24,80,592,456)},system={getBoundingClientRect:rect(24,536,592,68)};panel.getBoundingClientRect=()=>rect(648,80,884,panel.offsetHeight)();
 const nodes={stage,launcherPanel:panel,launcherCategories:nav,launcherRail:{},launcherFeedback:feedback};const document={body:{dataset:{theme}},getElementById:id=>nodes[id],querySelector:selector=>selector==='.launcher-system'?system:null};
 const images=[],timers=new Map();let timerId=0;
 const context={document,innerWidth:width,innerHeight:width*800/1508,Image:class{constructor(){this.complete=cached;images.push(this);}},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),ResizeObserver:class{constructor(fn){observed.push(fn);}observe(){}},MutationObserver:class{constructor(fn){observed.push(fn);}observe(){}},addEventListener:(type,fn)=>handlers[type]=fn,chrome:{webview:{postMessage:m=>messages.push(m),addEventListener:(type,fn)=>handlers['host:'+type]=fn}},VGLauncher:{configure(){configured++;},openInHost(){},dismiss(){}}};context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../runtime/wallpaper/launcher-overlay.js'),'utf8'),context);handlers.DOMContentLoaded();
 return {messages,panel,images,timers,configured:()=>configured,open(group,id='a'.repeat(32)){handlers['host:message']({data:{action:'open',id,profile:'display-1',position:{x:24,y:80},group}});},resize(){observed.forEach(fn=>fn());}};
}
test('native clip excludes the empty area over devices while retaining categories, utilities and menu at all scales',()=>{
 for(const width of [1005.33,1508,2010.67]){
  const a=setup(width);a.open('work');const m=a.messages.at(-1);assert.equal(m.type,'layout');assert.equal(m.rects.length,3);
  const hit=(x,y)=>m.rects.some(r=>x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3]);
  assert(hit(100/1508,100/800));assert(hit(100/1508,490/800));assert(hit(800/1508,200/800));assert(!hit(100/1508,700/800));
 }
});
test('content changes update the clip without resizing the native viewport or reconfiguring its catalog',()=>{
 const a=setup(1508);a.open('work');const first=a.messages.at(-1),length=a.messages.length;a.resize();assert.equal(a.messages.length,length);
 a.panel.offsetHeight=300;a.resize();assert(a.messages.at(-1).rects[2][3]<first.rects[2][3]);
 a.open('games','b'.repeat(32));assert.equal(a.configured(),1);assert(a.messages.every(m=>m.type!=='size'));
});

test('Luna announces ready once after its own texture loads, with bounded missing-image fallback',()=>{
 const ready=a=>a.messages.filter(message=>message.type==='ready').length;
 for(const outcome of ['load','error','timeout']){
  const a=setup(1508,{theme:'luna-blue'});assert.equal(ready(a),0);assert.equal(a.images[0].src,'assets/marble-water.png');assert.equal([...a.timers.values()][0].ms,1200);
  if(outcome==='timeout')[...a.timers.values()][0].fn();else a.images[0][outcome==='load'?'onload':'onerror']();
  assert.equal(ready(a),1);a.images[0].onload();a.images[0].onerror();assert.equal(ready(a),1);assert.equal(a.timers.size,0);
 }
 const cached=setup(1508,{theme:'luna-blue',cached:true});assert.equal(ready(cached),1);assert.equal(cached.timers.size,0);
 const paper=setup(1508);assert.equal(ready(paper),1);assert.equal(paper.images.length,0);assert.equal(paper.timers.size,0);
});
