'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../runtime/wallpaper/launcher.js');
async function setup(native=false,entries=[],options={}){
 const nodes=new Map(),timers=new Map(),calls=[],observers=[],documentEvents=new Map(),windowEvents=new Map();let serial=0,ack,contextAck;
 const listen=(map,k,fn)=>map.set(k,[...(map.get(k)||[]),fn]);
 function element(tag='div'){
  const classes=new Set();return {tag,children:[],dataset:{},attrs:{},style:{},events:{},scrollTop:0,clientHeight:600,scrollHeight:600,offsetHeight:524,
   classList:{toggle(k,on){on?classes.add(k):classes.delete(k);},contains:k=>classes.has(k),remove:k=>classes.delete(k)},
   addEventListener(k,fn){this.events[k]=fn;},setAttribute(k,v){this.attrs[k]=v;},contains:()=>false,getBoundingClientRect:()=>({left:24,top:80,right:616,bottom:156}),
   append(...els){this.children.push(...els);},appendChild(el){this.children.push(el);},
   replaceChildren(fragment){this.children=fragment.children;},
   querySelectorAll(selector){return selector==='button'?this.children.filter(x=>x.tag==='button'):[];}};
 }
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const document={getElementById:get,body:element(),createElement:element,createElementNS:(_,tag)=>element(tag),createDocumentFragment:()=>element(),addEventListener:(k,fn)=>listen(documentEvents,k,fn)};
 get('settings').hidden=true;get('themePicker').hidden=true;get('stage').getBoundingClientRect=()=>({left:0,top:0,width:1920});
 const window={VGLauncherMath:M,VG_LOCAL_CONTROL_KEY:'a'.repeat(64),innerWidth:1920,innerHeight:1080,addEventListener:(k,fn)=>listen(windowEvents,k,fn)};
 window.PG_APP_DESKTOP=native;if(native)window.wallpaperRegisterMediaPropertiesListener=()=>{};
 Object.assign(window,options.window);
 const payload={version:1,revision:'1',enabled:true,ready:true,groups:[{id:'work',name:'Работа'},{id:'games',name:'Игры'}],items:entries};
 const context={module:{exports:{}},window,document,URL,AbortController,AbortSignal,crypto:require('node:crypto').webcrypto,Uint8Array,MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}},fetch:async(url,options)=>{calls.push({url,options});if(options?.body&&JSON.parse(options.body).action==='context')return new Promise(resolve=>contextAck=()=>resolve({ok:true,json:async()=>payload}));if(url.endsWith('/launcher-overlay')&&JSON.parse(options.body).action==='open')return new Promise(resolve=>ack=(result={shown:true})=>resolve({ok:true,json:async()=>result}));return {ok:true,json:async()=>payload};},performance:{now:()=>0},localStorage:{getItem:()=>null},requestAnimationFrame(){},clearTimeout:id=>timers.delete(id),setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;}};
 vm.runInNewContext(fs.readFileSync(require.resolve(options.theme==='classic'?'../runtime/themes/classic/launcher.js':'../runtime/wallpaper/launcher.js'),'utf8'),context);
 window.VGLauncher.configure({bridge:'http://127.0.0.1:8767/status',profile:'display-1'});await new Promise(r=>setImmediate(r));
 return {get,timers,calls,window,observers,dispatchDocument:(k,event)=>documentEvents.get(k)?.forEach(fn=>fn(event)),dispatchWindow:(k,event)=>windowEvents.get(k)?.forEach(fn=>fn(event)),ack:result=>ack?.(result),finishContext:()=>contextAck?.()};
}
test('right click requests the Shell menu by ID, never opens the app, and holds its category until dismissal',async()=>{
 const id='a'.repeat(64),a=await setup(false,[{id,name:'Fixture',type:'app',group:'work',origin:'Test'}]);a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();
 const item=a.get('launcherItems').children[0].children[0];let prevented=false,stopped=false;const pending=item.events.contextmenu({preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
 assert(prevented&&stopped);const request=JSON.parse(a.calls.find(c=>c.options?.body&&JSON.parse(c.options.body).action==='context').options.body);assert.deepEqual(request,{action:'context',id});
 assert(!a.calls.some(c=>c.options?.body&&JSON.parse(c.options.body).action==='open'));a.get('launcherRail').events.pointerleave();assert(![...a.timers.values()].some(t=>t.ms===450));a.window.VGLauncher.dismiss();assert.equal(a.window.VGLauncher.state(),'open');
 a.finishContext();await pending;assert.equal(a.window.VGLauncher.state(),'open');
});
test('moving between categories immediately selects one highlight and cancels the pending previous open',async()=>{
 const {get,timers}=await setup();
 const nav=get('launcherCategories'),[work,games]=nav.children;
 work.events.pointerenter();assert.equal(work.dataset.hovered,'true');assert.equal(games.dataset.hovered,'false');
 work.events.pointerleave();games.events.pointerenter();
 assert.equal(work.dataset.hovered,'false');assert.equal(games.dataset.hovered,'true');assert.equal([...timers.values()].filter(t=>t.ms===80).length,1);
 [...timers.values()].find(t=>t.ms===80).fn();assert.equal(get('launcherTitle').textContent,'Игры');
 assert.equal(work.attrs['aria-expanded'],'false');assert.equal(games.attrs['aria-expanded'],'true');
 nav.events.pointerleave();assert.equal(nav.classList.contains('launcher-hovering'),false);
});
test('an occluded category never paints the fallback menu while awaiting Windows or after a blocked reply',async()=>{
 const a=await setup(true),work=a.get('launcherCategories').children[0];work.events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();
 const request=JSON.parse(a.calls.find(c=>c.url.endsWith('/launcher-overlay')).options.body);assert.deepEqual(request.trigger,[24/1920,80/1080,616/1920,156/1080]);assert.equal(a.get('launcherPanel').hidden,true);
 a.ack({shown:false,topmost:false,blocked:true});await new Promise(r=>setImmediate(r));assert.equal(a.get('launcherPanel').hidden,true);assert.equal(a.window.VGLauncher.state(),'ready');assert.equal(work.attrs['aria-expanded'],'false');assert.equal(work.dataset.hovered,'false');
});
test('a genuine native host failure still provides the local menu instead of being treated as occlusion',async()=>{
 const a=await setup(true);a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();a.ack({shown:false,topmost:false});await new Promise(r=>setImmediate(r));assert.equal(a.get('launcherPanel').hidden,false);assert.equal(a.window.VGLauncher.state(),'open');
});

test('standalone desktop categories request their native popup without Wallpaper Engine APIs in both designs',async()=>{
 const surface={surfaceId:'s-1',monitorId:'\\\\.\\DISPLAY1',ownerHandle:'123',bounds:{x:0,y:0,width:2560,height:1440},profile:'display-1'};
 for(const theme of ['paper-green','classic']){
  const policy={canInteract:()=>true,registerPanel(){},releasePanel(){},openPanel:async()=>true};
  const a=await setup(false,[],{theme,window:{PG_APP:true,PG_APP_DESKTOP:true,PGSurface:surface,PGWindows:policy}});
  assert.equal(typeof a.window.wallpaperRegisterMediaPropertiesListener,'undefined');
  a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===(theme==='classic'?300:80)).fn();await new Promise(r=>setImmediate(r));
  const call=a.calls.find(c=>c.url.endsWith('/launcher-overlay'));
  assert(call,theme+' must use its own desktop popup, independent of Engine media callbacks');
  const request=JSON.parse(call.options.body);assert.equal(request.surface.surfaceId,surface.surfaceId);assert.equal(request.group,'work');assert(require('../runtime/companion/launcher-overlay.cjs').validRequest(request));
  a.ack({shown:true,positioned:true});await new Promise(r=>setImmediate(r));assert.equal(a.get('launcherPanel').hidden,true);assert.equal(a.window.VGLauncher.state(),'open');
 }
});

test('standalone window mode keeps categories inline even if Engine media APIs happen to exist',async()=>{
 for(const theme of ['paper-green','classic']){
  const a=await setup(true,[],{theme,window:{PG_APP:true,PG_APP_DESKTOP:false}});
  a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===(theme==='classic'?300:80)).fn();
  assert.equal(a.get('launcherPanel').hidden,false);assert.equal(a.window.VGLauncher.state(),'open');assert(!a.calls.some(c=>c.url.endsWith('/launcher-overlay')));
 }
});

test('standalone desktop rejects an occluded trigger and retains inline fallback only for a host failure',async()=>{
 for(const result of [{shown:false,blocked:true},{shown:false}]){
  const a=await setup(false,[],{window:{PG_APP:true,PG_APP_DESKTOP:true}});
  a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();assert.equal(a.get('launcherPanel').hidden,true);
  assert(a.calls.some(c=>c.url.endsWith('/launcher-overlay')));a.ack(result);await new Promise(r=>setImmediate(r));
  assert.equal(a.get('launcherPanel').hidden,!!result.blocked);assert.equal(a.window.VGLauncher.state(),result.blocked?'ready':'open');
 }
});

test('desktop flags without a usable popup endpoint do not leave the inline category invisible',async()=>{
 const a=await setup(false,[],{window:{PG_APP:true,PG_APP_DESKTOP:true}});a.window.VG_LOCAL_CONTROL_KEY='';
 a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();
 assert.equal(a.get('launcherPanel').hidden,false);assert.equal(a.window.VGLauncher.state(),'open');assert(!a.calls.some(c=>c.url.endsWith('/launcher-overlay')));
});
test('cold native popup survives pointerleave until its shown acknowledgement',async()=>{
 const a=await setup(true);a.get('launcherCategories').children[0].events.pointerenter();
 [...a.timers.values()].find(t=>t.ms===80).fn();
 assert(a.calls.some(c=>c.url.endsWith('/launcher-overlay')&&JSON.parse(c.options.body).action==='open'));
 a.get('launcherRail').events.pointerleave();assert(![...a.timers.values()].some(t=>t.ms===450));
 a.ack();await new Promise(r=>setImmediate(r));assert.equal(a.get('launcherPanel').hidden,true);
 assert(!a.calls.some(c=>c.url.endsWith('/launcher-overlay')&&JSON.parse(c.options.body).action==='close'));
});
test('settings block category hover and close an already open menu',async()=>{
 const a=await setup(),work=a.get('launcherCategories').children[0];
 work.events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();assert.equal(a.window.VGLauncher.state(),'open');
 a.get('settings').hidden=false;a.observers.forEach(fn=>fn());assert.equal(a.window.VGLauncher.state(),'ready');
 a.timers.clear();work.events.pointerenter();assert.equal(a.timers.size,0);assert.equal(work.dataset.hovered,'false');
});
test('physical native surface geometry wins over fractional DPR rounding and layout profile selection',async()=>{
 const surface={surfaceId:'s-1',monitorId:'\\\\.\\DISPLAY2',ownerHandle:'123',shellOwnerHandle:'456',bounds:{x:-2560,y:0,width:2560,height:1440},profile:'display-2'};
 for(const theme of ['paper-green','classic']){
  const a=await setup(true,[],{theme,window:{PGSurface:surface,innerWidth:1707,innerHeight:960,devicePixelRatio:1.5}});a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===(theme==='classic'?300:80)).fn();
  const request=JSON.parse(a.calls.find(c=>c.url.endsWith('/launcher-overlay')).options.body);assert.equal(request.width,2560);assert.equal(request.height,1440);assert.equal(request.profile,'display-1');assert.equal(request.surface.profile,'display-2');assert.equal(request.surface.shellOwnerHandle,'456');assert.equal(require('../runtime/companion/launcher-overlay.cjs').validRequest(request),true);a.ack();
 }
});
test('a closed policy session ignores a late native panel claim',async()=>{
 let grant;const policy={canInteract:()=>true,registerPanel(){},releasePanel(){},openPanel:()=>new Promise(r=>grant=r)};
 const a=await setup(false,[],{window:{PGWindows:policy}});a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();
 a.dispatchWindow('pg:window-policy',{detail:{event:'external'}});grant(true);await new Promise(r=>setImmediate(r));assert.equal(a.window.VGLauncher.state(),'ready');assert.equal(a.get('launcherPanel').hidden,true);
});
test('native popup fallback Escape ignores repeat and closes only once before key release in both themes',async()=>{
 for(const theme of ['paper-green','classic']){
  const a=await setup(false,[],{theme}),open=()=>{a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===(theme==='classic'?300:80)).fn();};open();
  a.dispatchDocument('keydown',{key:'Escape',repeat:true});assert.equal(a.window.VGLauncher.state(),'open');a.dispatchDocument('keydown',{key:'Escape',repeat:false});assert.equal(a.window.VGLauncher.state(),'ready');
  open();a.dispatchDocument('keydown',{key:'Escape',repeat:false});assert.equal(a.window.VGLauncher.state(),'open');a.dispatchDocument('keyup',{key:'Escape'});a.dispatchDocument('keydown',{key:'Escape',repeat:false});assert.equal(a.window.VGLauncher.state(),'ready');
 }
});
test('inline Shell context carries only the originating opaque surface ID in addition to its catalog ID',async()=>{
 const id='a'.repeat(64),a=await setup(false,[{id,name:'Fixture',type:'app',group:'work',origin:'Test'}],{window:{PGSurface:{surfaceId:'s-1'}}});a.get('launcherCategories').children[0].events.pointerenter();[...a.timers.values()].find(t=>t.ms===80).fn();
 const pending=a.get('launcherItems').children[0].children[0].events.contextmenu({preventDefault(){},stopPropagation(){}});const request=JSON.parse(a.calls.find(c=>c.options?.body&&JSON.parse(c.options.body).action==='context').options.body);assert.deepEqual(request,{action:'context',id,surfaceId:'s-1'});a.finishContext();await pending;
});
