'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const C=require('../runtime/wallpaper/core.js');

// Minimal DOM double exercises data wiring, not visual layout. It is not a browser renderer.
class Element {
  constructor(){this.textContent='';this.hidden=false;this.value='';this.checked=false;this.children=[];this.dataset={};this.events={};this.attrs={};this.style={setProperty(k,v){this[k]=v;}};this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),toggle:(v,on)=>on?this.classes.add(v):this.classes.delete(v)};}
  addEventListener(name,fn){this.events[name]=fn;} appendChild(el){this.children.push(el);return el;} replaceChildren(...children){this.children=children;}
  setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k]??null;} removeAttribute(k){delete this[k];delete this.attrs[k];} querySelector(){return this.inside;} closest(){return null;}
  setPointerCapture(){} click(){this.events.click?.({target:this});}
}
function setup({bridge='',payload=null,fetchError=false,layouts,editor,theme='paper-green'}={}){
  const html=fs.readFileSync(path.join(__dirname,'../runtime/wallpaper/index.html'),'utf8');
  const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const panels=Object.keys(C.layouts).map(id=>{const el=new Element();el.dataset.widget=id;el.inside=new Element();return el;});
  nodes.settings.hidden=true;
  const callbacks={},storage=new Map(),intervals=[],timeouts=new Map(),windowEvents={};let timer=0,calls=0;
  storage.set('paper-green-app-settings-v1:2560x1440',JSON.stringify({bridge}));
  const document={getElementById:id=>{assert(nodes[id],`Missing DOM id ${id}`);return nodes[id];},querySelectorAll:()=>panels,
    createElement:()=>new Element(),createDocumentFragment:()=>new Element(),body:new Element(),events:{},addEventListener(name,fn){this.events[name]=fn;},hidden:false};
  document.body.dataset.theme=theme;
  const context={console,URL,Intl,Date,AbortController,document,innerWidth:2560,innerHeight:1440,VGCore:C,PGLayouts:layouts,PGLayoutEditor:editor,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},addEventListener(name,fn){windowEvents[name]=fn;},
    setInterval:fn=>intervals.push(fn),setTimeout:(fn,ms)=>{timeouts.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timeouts.delete(id),
    fetch:async()=>{calls++;if(fetchError)throw new Error('offline');return {ok:true,json:async()=>payload};},
    wallpaperMediaIntegration:{PLAYBACK_PLAYING:1,PLAYBACK_PAUSED:2,PLAYBACK_STOPPED:3}};
  for(const name of ['MediaStatus','MediaProperties','MediaThumbnail','MediaPlayback','MediaTimeline','Audio'])context[`wallpaperRegister${name}Listener`]=fn=>{callbacks[name]=fn;};
  context.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options.detail;}};context.dispatchEvent=()=>{};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../runtime/wallpaper/app.js'),'utf8'),context);
  return {nodes,panels,callbacks,context,intervals,timeouts,storage,payload,windowEvents,calls:()=>calls};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('automatic preference changes preserve other committed values and do not restart data collection',async()=>{
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{}}});await settle();const before=JSON.parse(JSON.stringify(a.context.PGPreferences.get())),calls=a.calls();
 a.nodes.timezoneInput.value='An unfinished draft';assert.equal(a.context.PGPreferences.update({seconds:!before.seconds}),true);await settle();
 assert.equal(a.context.PGPreferences.get().timezone,before.timezone);assert.equal(a.context.PGPreferences.get().profile,before.profile);assert.equal(a.context.PGPreferences.get().seconds,!before.seconds);assert.equal(a.calls(),calls);assert.equal(a.nodes.seconds.hidden,before.seconds);
 assert.equal(a.context.PGPreferences.update({profile:'display-2'}),true);assert.equal(a.nodes.profileInput.value,'display-2');assert.equal(a.context.PGPreferences.get().seconds,!before.seconds);
});

test('invalid automatic timezone or profile leaves committed preferences and storage intact',()=>{
 const a=setup(),before=JSON.stringify(a.context.PGPreferences.get()),stored=[...a.storage.entries()];
 assert.equal(a.context.PGPreferences.update({timezone:'Not/A-Timezone'}),false);assert.equal(JSON.stringify(a.context.PGPreferences.get()),before);assert.deepEqual([...a.storage.entries()],stored);
 assert.equal(a.context.PGPreferences.update({profile:'unknown'}),false);assert.equal(JSON.stringify(a.context.PGPreferences.get()),before);assert.deepEqual([...a.storage.entries()],stored);
});

test('the editor owns input and synchronizes the old modules without a second drag controller',()=>{
 const modes=[],launcher=[],power=[];let notify=()=>{};const editor={setEditing(value){modes.push(value);notify(value);}};
 const a=setup({editor});a.context.VGLauncher={setEditing:value=>launcher.push(value)};a.context.VGPower={setEditing:value=>power.push(value)};notify=value=>a.windowEvents['paper:layout-editing']({detail:{editing:value}});
 a.nodes.editInput.events.change({target:{checked:true}});assert.deepEqual(modes,[true]);assert.equal(a.nodes.editInput.checked,true);assert(a.context.document.body.classes.has('editing'));assert.deepEqual(launcher,[true]);assert.deepEqual(power,[true]);
 const weather=a.panels.find(el=>el.dataset.widget==='weather'),before=weather.style.left;weather.events.pointerdown({button:0,pointerId:1,clientX:100,clientY:100,target:{closest:s=>s==='.drag-handle'?{}:null},preventDefault(){}});weather.events.pointermove({pointerId:1,clientX:0,clientY:0});weather.events.pointerup({pointerId:1});assert.equal(weather.style.left,before);assert.equal(a.storage.has('paper-green-app-layout-v1:display-1'),false);
 a.nodes.settingsClose.click();assert.deepEqual(modes,[true,false]);assert.equal(a.nodes.editInput.checked,false);assert.equal(a.context.document.body.classes.has('editing'),false);assert.deepEqual(launcher,[true,false]);assert.deepEqual(power,[true,false]);
});

test('Paper renderer uses model visibility/profile state and persists only the dragged widget',()=>{
 const M=require('../runtime/wallpaper/widget-model.js'),docs=Object.fromEntries(M.profiles.map(p=>[p,M.create('paper-green',p)])),listeners=[],updates=[];let profile='display-1';
 const emit=()=>listeners.forEach(fn=>fn({document:docs[profile]}));
 const layouts={subscribe:fn=>listeners.push(fn),activate(p){profile=p;emit();return {get:()=>docs[p]};},update(changes){updates.push(changes);docs[profile]=M.patch(docs[profile],changes);emit();},reset(){docs[profile]=M.create('paper-green',profile);emit();}};
 const a=setup({layouts}),weather=a.panels.find(p=>p.dataset.widget==='weather');layouts.update({weather:{x:500,y:100,scale:.8}});assert.equal(weather.style.left,'500px');
 a.nodes.editInput.events.change({target:{checked:true}});
 weather.events.pointerdown({button:0,pointerId:1,clientX:100,clientY:100,target:{closest:s=>s==='.drag-handle'?{}:null},preventDefault(){}});
 weather.events.pointermove({pointerId:1,clientX:220,clientY:140});weather.events.pointerup({pointerId:1});
 assert.deepEqual(Object.keys(updates.at(-1)),['weather']);assert(Math.abs(docs[profile].widgets.weather.x-590)<.001);assert.equal(updates.at(-1).weather.scale,.8);
 layouts.update({weather:{visible:false}});assert.equal(weather.hidden,true);a.context.wallpaperPropertyListener.applyUserProperties({monitorprofile:{value:'display-2'}});assert.equal(weather.hidden,false);assert.equal(weather.style.left,'1310px');
 a.context.wallpaperPropertyListener.applyUserProperties({monitorprofile:{value:'display-1'}});assert.equal(weather.hidden,true);a.nodes.resetLayout.click();assert.equal(weather.hidden,false);assert.equal(weather.style.left,'1310px');assert.equal(a.storage.has('paper-green-app-layout-v1:display-1'),false);
 weather.events.pointerdown({button:0,pointerId:2,clientX:100,clientY:100,target:{closest:s=>s==='.drag-handle'?{}:null},preventDefault(){}});weather.events.pointermove({pointerId:2,clientX:0,clientY:0});const before=updates.length;a.context.wallpaperPropertyListener.applyUserProperties({monitorprofile:{value:'display-2'}});weather.events.pointerup({pointerId:2});assert.equal(updates.length,before);assert.equal(docs['display-2'].widgets.weather.x,1310);
});

test('last speed test label uses the actual measurement time in the selected zone',async()=>{
 const updatedAt=new Date(Date.now()-60000).toISOString();const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{speedtest:{status:'ok',updatedAt,data:{downMbps:900,upMbps:800}}}}});
 await settle();const expected=new Intl.DateTimeFormat('ru-RU',{timeZone:a.context.PGPreferences.get().timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(updatedAt));assert.equal(a.nodes.networkSpeedTime.textContent,'Последний — '+expected);
});
test('source defaults use the local timezone and only an explicitly configured weather city',async()=>{
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{weather:{status:'ok',updatedAt:new Date().toISOString(),data:{temperatureC:0,city:'Example city'}}}}});await settle();assert.equal(a.context.PGPreferences.get().timezone,Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');assert.equal(a.nodes.weatherLocation.textContent,'Example city');
 const empty=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{}}});await settle();assert.equal(empty.nodes.weatherLocation.textContent,'ПОГОДА');
});
test('EcoFlow estimate, real load plot and expiring notices are wired without update timestamps',async()=>{
 const now=Date.now(),updatedAt=new Date(now).toISOString();const payload={schemaVersion:1,sources:{ecoflow:{status:'ok',updatedAt,data:{batteryPercent:98,inputWatts:200,outputWatts:200,estimatedRuntimeMinutes:490,loadHistory:[{at:now-30000,watts:190},{at:now,watts:200}]}},events:{status:'ok',updatedAt,data:{items:[{text:'Мышь заряжается',start:now-1000,until:now+10000,tone:'info'}]}}}};
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload});await settle();assert.equal(a.nodes.ecoRuntime.textContent,'≈8 ч 10 мин');assert.match(a.nodes.ecoLoadPath.attrs.d,/M.*L/);assert.equal(a.nodes.ecoLoadDot.attrs.visibility,'visible');assert.equal(a.nodes.eventNotice.hidden,false);assert.equal(a.nodes.eventMessage.textContent,'Мышь заряжается');
 payload.sources.events.data.items[0].until=now-1;a.intervals[0]();assert.equal(a.nodes.eventNotice.hidden,true);
 payload.sources.ecoflow.updatedAt='2020-01-01T00:00:00Z';a.intervals[0]();assert.equal(a.nodes.ecoRuntime.textContent,'—');assert.equal(a.nodes.ecoLoadPath.attrs.d,'');assert.equal(a.nodes.ecoLoadDot.attrs.visibility,'hidden');
});
test('app registers native listeners immediately and renders real date',()=>{
  const a=setup();assert.equal(Object.keys(a.callbacks).length,6);assert.match(a.nodes.hours.textContent,/^\d{2}$/);
  assert.equal(a.nodes.calendarDays.children[0].children.length,42);assert.equal(a.calls(),0);
  assert.equal(a.nodes.mouseBattery.textContent,'—%');
});
test('native media updates title/cover/progress and clears old track state',()=>{
  const a=setup(),cb=a.callbacks;
  cb.MediaProperties({title:'A track',artist:'An artist'});cb.MediaPlayback({state:1});cb.MediaThumbnail({thumbnail:'data:image/png;base64,AAAA'});cb.MediaTimeline({position:60,duration:180});
  assert.equal(a.nodes.mediaTitle.textContent,'A track');assert.equal(a.nodes.mediaCover.hidden,false);assert.equal(a.nodes.timeline.hidden,false);assert.equal(a.nodes.mediaState.textContent,'ИГРАЕТ');
  cb.MediaProperties({title:'Next video',artist:''});assert.equal(a.nodes.mediaCover.hidden,true);assert.equal(a.nodes.timeline.hidden,true);
  cb.MediaStatus({enabled:false});assert.equal(a.nodes.mediaState.textContent,'ОТКЛЮЧЕНО');assert.equal(a.nodes.mediaTitle.textContent,'Тишина в эфире');
});
test('unknown playback constants are not accidentally classified as playing',()=>{
  const a=setup();a.context.wallpaperMediaIntegration={};a.callbacks.MediaPlayback({});assert.equal(a.nodes.mediaState.textContent,'ОЖИДАНИЕ');
  a.context.wallpaperMediaIntegration={playback:{PLAYING:7}};a.callbacks.MediaPlayback({state:7});assert.equal(a.nodes.mediaState.textContent,'ИГРАЕТ');
});
test('source bridge renders genuine zero and isolates unavailable devices',async()=>{
  const updatedAt=new Date().toISOString();
  const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{
    mouse:{status:'ok',updatedAt,data:{batteryPercent:0,charging:true}},
    system:{status:'ok',updatedAt,data:{ramUsedBytes:4*1073741824,ramTotalBytes:16*1073741824,vramUsedBytes:0,vramTotalBytes:8*1073741824}},
    network:{status:'ok',updatedAt,data:{internet:false,rxBytesPerSecond:1e6,txBytesPerSecond:0,pingMs:null}},
    speedtest:{status:'ok',updatedAt,data:{downMbps:8,upMbps:0}},
    ecoflow:{status:'unavailable'},pet:{status:'ok',updatedAt,data:{state:'working',detail:'Задача 1'}}}}});
  await settle();assert.equal(a.nodes.mouseBattery.textContent,'0%');assert.equal(a.nodes.vramValue.textContent,'0.0 / 8.0 GiB');
  assert.equal(a.nodes.downValue.textContent,'8.0');assert.equal(a.nodes.upValue.textContent,'0.0');assert.equal(a.nodes.internetState.textContent,'OFFLINE');
  assert.equal(a.nodes.pingValue.textContent,'—');assert.equal(a.nodes.ecoBattery.textContent,'—%');
});
test('old sensor values are hidden even inside a successfully fetched snapshot',async()=>{
  const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{mouse:{status:'ok',updatedAt:'2020-01-01T00:00:00Z',data:{batteryPercent:90}}}}});
  await settle();assert.equal(a.nodes.mouseBattery.textContent,'—%');assert.equal(a.nodes.mouseStatus.textContent,'Данные устарели');
});
test('engine pause suspends polling and resume obtains new data',async()=>{
  const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{}}});await settle();
  assert(a.timeouts.size>0);a.context.wallpaperPropertyListener.setPaused(true);assert.equal(a.timeouts.size,0);
  a.context.wallpaperPropertyListener.setPaused(false);await settle();assert.equal(a.calls(),3);
});
test('failed bridge fetch backs off instead of spinning',async()=>{
  const a=setup({bridge:'http://127.0.0.1:8767/status',fetchError:true});await settle();
  assert.equal(a.calls(),1);assert.equal([...a.timeouts.values()][0].ms,4000);assert.equal(a.nodes.ramValue.textContent,'— / — GiB');
});
test('moving a widget saves separate monitor layout without losing the other profile',()=>{
  const a=setup(),mouse=a.panels.find(el=>el.dataset.widget==='mouse');
  a.nodes.editInput.checked=true;a.nodes.editInput.events.change({target:a.nodes.editInput});
  const target={closest:s=>s==='.drag-handle'?{}:null};
  mouse.events.pointerdown({button:0,pointerId:1,clientX:100,clientY:100,target,preventDefault(){}});
  mouse.events.pointermove({pointerId:1,clientX:120,clientY:110});mouse.events.pointerup({pointerId:1});
  const saved=JSON.parse(a.storage.get('paper-green-app-layout-v1:display-1'));assert.equal(saved.mouse.x,39);assert.equal(saved.mouse.y,761.5);
  a.nodes.profileInput.value='display-2';a.nodes.saveSettings.click();
  assert.equal(mouse.style.left,'24px');assert.equal(JSON.parse(a.storage.get('paper-green-app-layout-v1:display-1')).mouse.x,39);
});
test('mouse uses requested battery thresholds, shows USB charging and hides normal update text',async()=>{
 for(const [batteryPercent,level] of [[0,'critical'],[5,'critical'],[6,'low'],[15,'low'],[16,'warning'],[25,'warning'],[26,'normal'],[100,'normal']]){
  const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{mouse:{status:'ok',updatedAt:new Date().toISOString(),data:{batteryPercent,charging:true}}}}});await settle();
  const mouse=a.panels.find(p=>p.dataset.widget==='mouse');assert.equal(mouse.dataset.battery,level);assert.equal(mouse.dataset.charging,'true');assert.equal(a.nodes.mouseStatus.textContent,'');assert.match(a.nodes.mouseCharging.textContent,/ЗАРЯД/);
 }
});
test('SMTC fills an empty native media session and expires without retaining an old cover',async()=>{
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{media:{status:'ok',updatedAt:new Date().toISOString(),identity:'Windows SMTC / Opera',data:{title:'Current video',artist:'Actual author',playback:'playing',position:10,duration:100,thumbnail:'data:image/jpeg;base64,AAAA'}}}}});await settle();
 assert.equal(a.nodes.mediaTitle.textContent,'Current video');assert.equal(a.nodes.mediaState.textContent,'ИГРАЕТ');assert.equal(a.nodes.mediaCover.hidden,false);assert.equal(a.nodes.timeline.hidden,false);
 a.callbacks.MediaProperties({title:'Native stale title'});assert.equal(a.nodes.mediaTitle.textContent,'Current video');
 a.payload.sources.media.updatedAt='2020-01-01T00:00:00Z';a.intervals[0]();assert.equal(a.nodes.mediaTitle.textContent,'Тишина в эфире');assert.equal(a.nodes.mediaCover.hidden,true);
});
test('sound still drives the figure when the player has no equalizer DOM',()=>{
 const a=setup(),received=[];a.context.VGLiquid={setAudio:value=>received.push(value)};
 assert.equal(a.nodes.audioBars,undefined);
 a.callbacks.Audio(Array(128).fill(0));assert.equal(received.at(-1).energy,0);
 a.callbacks.Audio(Array(128).fill(.25));assert(received.at(-1).energy>0);assert(received.at(-1).bass>0);
 a.callbacks.Audio(Array(128).fill(0));assert.equal(received.at(-1).energy,0);
});
test('pixel equalizer below the figure uses the sound signal, falls to silence and ignores paused frames',()=>{
 const a=setup(),bars=a.nodes.scenePixels.children;assert.equal(bars.length,56);assert(bars.every(bar=>bar.style.height==='2px'));
 a.callbacks.Audio(Array(128).fill(.025));assert(bars.every(bar=>parseFloat(bar.style.height)>=25));const before=bars.map(bar=>bar.style.height);
 a.context.wallpaperPropertyListener.setPaused(true);a.callbacks.Audio(Array(128).fill(0));assert.deepEqual(bars.map(bar=>bar.style.height),before);
 a.context.wallpaperPropertyListener.setPaused(false);a.callbacks.Audio(Array(128).fill(0));assert(bars.every(bar=>bar.style.height==='2px'));assert.equal(a.nodes.scenePixels.dataset.signal,'silent');
 a.callbacks.Audio(Array(128).fill(.25));assert(bars.every(bar=>parseFloat(bar.style.height)>35));a.callbacks.Audio([]);assert(bars.every(bar=>bar.style.height==='2px'));
});

test('artwork switches between widescreen video, square music and portrait without stale layout',()=>{
 const a=setup(),panel=a.panels.find(p=>p.dataset.widget==='media'),image=a.nodes.mediaCover;
 a.callbacks.MediaProperties({title:'A song',artist:'An artist'});a.callbacks.MediaThumbnail({thumbnail:'data:image/png;base64,AAAA'});
 image.naturalWidth=1000;image.naturalHeight=1000;image.events.load();assert.equal(panel.dataset.artwork,'square');assert.equal(a.nodes.mediaArtist.textContent,'An artist');
 image.naturalWidth=150;image.naturalHeight=83;image.events.load();assert.equal(panel.dataset.artwork,'wide');
 image.naturalWidth=600;image.naturalHeight=900;image.events.load();assert.equal(panel.dataset.artwork,'portrait');
 a.callbacks.MediaProperties({title:'Next song',artist:'Other artist'});assert.equal(panel.dataset.artwork,'square');assert.equal(image.hidden,true);
});

test('weather glyph follows real WMO code and clears when the source expires',async()=>{
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{weather:{status:'ok',updatedAt:new Date().toISOString(),data:{temperatureC:14,weatherCode:61,isDay:false}}}}});await settle();
 assert.equal(a.nodes.weatherSymbol.attrs.href,'#i-weather-rain');assert.equal(a.nodes.weatherText.textContent,'Дождь');
 a.payload.sources.weather.data.weatherCode=0;a.intervals[0]();assert.equal(a.nodes.weatherSymbol.attrs.href,'#i-weather-moon');
 a.payload.sources.weather.updatedAt='2020-01-01T00:00:00Z';a.intervals[0]();assert.equal(a.nodes.weatherSymbol.attrs.href,'#i-weather-unknown');
});

test('unchanged weather does not rewrite its SVG, text or source attributes on clock ticks',async()=>{
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{weather:{status:'ok',updatedAt:new Date().toISOString(),identity:'Weather fixture',data:{temperatureC:14,weatherCode:61,isDay:false}}}}});await settle();
 const weather=a.panels.find(p=>p.dataset.widget==='weather'),writes=[];
 weather.dataset=new Proxy(weather.dataset,{set(target,key,value){writes.push(key);target[key]=value;return true;}});
 let title=weather.title;Object.defineProperty(weather,'title',{get:()=>title,set(value){writes.push('title');title=value;}});
 for(const id of ['weatherSymbol','weatherIconTitle','temperature','weatherText','weatherStatus']){
  const el=a.nodes[id],set=el.setAttribute.bind(el);el.setAttribute=(...args)=>{writes.push(id);set(...args);};
  let text=el.textContent;Object.defineProperty(el,'textContent',{get:()=>text,set(value){writes.push(id);text=value;}});
 }
 for(let i=0;i<5;i++)a.intervals[0]();assert.deepEqual(writes,[]);
});

test('resume retains fresh weather while awaiting a reply, ignores duplicate pause and still expires old data',async()=>{
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{weather:{status:'ok',updatedAt:new Date().toISOString(),data:{temperatureC:14,weatherCode:61,isDay:false}}}}});await settle();
 const property=a.context.wallpaperPropertyListener,calls=a.calls();property.setPaused(false);assert.equal(a.calls(),calls);
 property.setPaused(true);const pausedCalls=a.calls();property.setPaused(true);assert.equal(a.calls(),pausedCalls);
 a.context.fetch=()=>new Promise(()=>{});property.setPaused(false);
 assert.equal(a.nodes.temperature.textContent,'+14');assert.equal(a.nodes.weatherSymbol.attrs.href,'#i-weather-rain');
 a.payload.sources.weather.updatedAt='2020-01-01T00:00:00Z';a.intervals[0]();assert.equal(a.nodes.temperature.textContent,'—');assert.equal(a.nodes.weatherSymbol.attrs.href,'#i-weather-unknown');
});

test('changing the bridge clears previous weather immediately instead of keeping another source cached',async()=>{
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{weather:{status:'ok',updatedAt:new Date().toISOString(),data:{temperatureC:14,weatherCode:61,isDay:false}}}}});await settle();
 a.context.fetch=()=>new Promise(()=>{});a.nodes.bridgeInput.value='http://localhost:8767/status';a.nodes.saveSettings.click();
 assert.equal(a.nodes.temperature.textContent,'—');assert.equal(a.nodes.weatherSymbol.attrs.href,'#i-weather-unknown');
});

test('Luna forwards 64 real stereo bands to its spectrum while Paper retains its existing band count',()=>{
 for(const [theme,count]of [['luna-blue',64],['paper-green',40]]){
  const a=setup({theme}),events=[];a.context.dispatchEvent=event=>events.push(event);
  const samples=Array(128).fill(0);samples[17]=.6;samples[81]=.2;a.callbacks.Audio(samples);
  const packet=events.find(event=>event.type==='daylight:audio');assert.equal(packet.detail.length,count);
  if(theme==='luna-blue'){assert.equal(packet.detail[17],.4);assert.equal(packet.detail[16],0);}
 }
});

test('the system card retains fresh RAM while stale VRAM expires independently',async()=>{
 const now=new Date().toISOString(),old='2020-01-01T00:00:00Z';
 const a=setup({bridge:'http://127.0.0.1:8767/status',payload:{schemaVersion:1,sources:{system:{status:'ok',updatedAt:old,measurements:{ram:now,vram:old},data:{ramUsedBytes:4*2**30,ramTotalBytes:16*2**30,vramUsedBytes:3*2**30,vramTotalBytes:8*2**30}}}}});await settle();
 assert.equal(a.nodes.ramValue.textContent,'4.0 / 16.0 GiB');assert.equal(a.nodes.vramValue.textContent,'— / — GiB');
});
