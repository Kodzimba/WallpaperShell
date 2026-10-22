'use strict';
// Node 22 + Windows PowerShell, no npm packages, service or administrator.
const http=require('node:http'), path=require('node:path'), fs=require('node:fs');
const session=require('./session.cjs');
if(session.isStandardDesktop(path.join(__dirname,'..')))process.exit(0);
if(process.argv.includes('--background')){
 const stream=name=>{const file=path.join(__dirname,name);try{if(fs.statSync(file).size>2*1024*1024){fs.copyFileSync(file,file+'.previous');fs.truncateSync(file,0);}}catch(error){if(error.code!=='ENOENT')throw error;}return fs.createWriteStream(file,{flags:'a'});};
 global.console=new (require('node:console').Console)({stdout:stream('runtime-autostart.log'),stderr:stream('runtime-autostart.err.log')});
 process.on('uncaughtExceptionMonitor',error=>console.error('Companion exited after an uncaught error: '+(error.code||error.name||'Error')));
}
const {spawn,execFile}=require('node:child_process');
const {createInterface}=require('node:readline');
const {performance}=require('node:perf_hooks');
const relay=require('./app-relay.cjs');
const appStatic=require('./app-static.cjs');
const {boundary}=require('./app-http.cjs');
const weatherConfig=require('./weather-config.cjs');
const weatherSettings=weatherConfig.readWeatherConfig(path.join(__dirname,'../..'));
const appRelease=JSON.parse(fs.readFileSync(path.join(__dirname,'../../app-release.json'),'utf8'));
let localActive=false,sharedActive=false;
const L=require('./logic.cjs');
const {measure}=require('./speedtest.cjs');
const {startEcoflow}=require('./ecoflow-live.cjs');
const desktop=require('./desktop-controls.cjs');
const {Energy}=require('./energy.cjs');
const energy=new Energy(path.join(__dirname,'.ecoflow-history.json'));
const {EventFeed}=require('./events.cjs');const eventFeed=new EventFeed();
const unavailable=(identity,detail)=>({status:'unavailable',updatedAt:null,data:null,identity,detail});
const sources={system:unavailable('Windows / NVIDIA'),network:unavailable('Windows route'),mouse:unavailable('Беспроводная мышь'),weather:unavailable('Open-Meteo','Погода не настроена'),ecoflow:unavailable('EcoFlow','Подключение не настроено'),pet:unavailable('Native Codex Pet','Нет проверенной подписки на текущую desktop-сессию; app-server control socket недоступен')};
let ram=null,previous=null,probe=null,worker=null,mediaWorker=null,closing=false,stopEcoflow=null;
sources.media=unavailable('Windows SMTC');
sources.speedtest=unavailable('Cloudflare HTTP / 200 MB');
sources.desktop=unavailable('Windows DisplayConfig / Core Audio');
sources.events=unavailable('VioletGhost / observed state changes');
const commandFile=path.join(__dirname,'.desktop-command.json');
const switchTheme=require('./themes.cjs').createSwitcher();
const appearance=require('./appearance.cjs').createAppearance(path.join(__dirname,'..'));
const lunaAppearance=require('./appearance.cjs').createAppearance(path.join(__dirname,'..'),'luna-blue');
const mediaCommandFile=path.join(__dirname,'.media-command.json');
let pendingDesktop=null;
function desktopSource(data,measuredAt){return {status:'ok',identity:'Windows DisplayConfig / Core Audio',updatedAt:measuredAt,data};}
function dispatchDesktop(action){
 if(launcherOverlay.blocked()&&action.kind!=='workspace')return Promise.reject(Error('Application dialog is active'));
 if(action.kind==='appearance')return Promise.resolve((action.theme==='luna-blue'?lunaAppearance:appearance).set(action));
 if(action.kind==='workspace')return exitToDesktop();
 if(action.kind==='theme')return switchTheme(action.value);
 if(sharedActive)return relay.control(action);
 const targetWorker=action.kind==='media'?mediaWorker:worker,file=action.kind==='media'?mediaCommandFile:commandFile;
 if(!targetWorker||pendingDesktop)return Promise.reject(Error('Control worker unavailable'));
 if(action.kind==='media'&&(sources.media.status!=='ok'||sources.media.data?.session!==action.session))return Promise.reject(Error('Media session changed'));
 return new Promise((resolve,reject)=>{
  const id=require('node:crypto').randomUUID();
  const timer=setTimeout(()=>{pendingDesktop=null;try{fs.unlinkSync(file);}catch{}reject(Error('Control worker timeout'));},20000);
  pendingDesktop={id,resolve,reject,timer,kind:action.kind};
  try{fs.writeFileSync(file+'.tmp',JSON.stringify({...action,id,issuedAt:Date.now()}));fs.renameSync(file+'.tmp',file);}catch(error){clearTimeout(timer);pendingDesktop=null;reject(error);}
 });
}
const controlKey=desktop.localKey(path.join(__dirname,'..'));
const deviceManager=require('./devices.cjs').createDevices({root:__dirname,key:controlKey,getSources:()=>sources,isShared:()=>sharedActive});
const deviceHandler=require('./devices.cjs').createHandler({key:controlKey,devices:deviceManager,canAct:()=>!launcherOverlay.blocked()});
const layoutHandler=require('./layouts.cjs').createHandler({key:controlKey,store:require('./layouts.cjs').createStore(path.join(__dirname,'../../data/layouts.json'))});
const uiDiagnostics=require('./ui-diagnostics.cjs').createDiagnostics({key:controlKey});
const controlHandler=desktop.createHandler({key:controlKey,dispatch:dispatchDesktop});
const powerHandler=require('./power.cjs').createHandler({key:controlKey});
const {createLauncher,createHandler:createLauncherHandler}=require('./launcher.cjs');
const launcher=createLauncher({root:path.join(__dirname,'..'),key:controlKey,contextMenu:request=>launcherOverlay.contextMenu(request)});
const launcherHandler=createLauncherHandler({key:controlKey,launcher,canAct:()=>!launcherOverlay.blocked()});
const launcherOverlay=require('./launcher-overlay.cjs').createOverlay({root:path.join(__dirname,'..'),key:controlKey,enabled:launcher.isEnabled,getMenuMode:()=>{const theme=require('./themes.cjs').get();return theme==='classic'?'dark':(theme==='luna-blue'?lunaAppearance:appearance).get().mode;}});
const builderHandler=require('./builder.cjs').createHandler({key:controlKey,store:require('./builder.cjs').createStore(path.join(__dirname,'../../data/builder.json')),agent:require('./builder-codex.cjs').createCodex({root:path.join(__dirname,'../..')}),canAct:()=>!launcherOverlay.blocked()});
const exitToDesktop=session.createDesktopExit({showIcons:launcher.showIcons});
const {createInputBridge}=require('./launcher-input.cjs');
const launcherInput=createInputBridge({key:controlKey,enabled:()=>!closing,updateNative:regions=>{
 if(!worker?.stdin?.writable)return;
 const line='L|'+regions.map(r=>[r.id,r.width,r.height,...r.rect,r.expires,1].join(',')).join(';')+'\n';
 worker.stdin.write(line,()=>{});
}});
let speedActive=false,speedDue=0;
const speedCache=path.join(__dirname,'.speedtest.json');
try{const cached=JSON.parse(fs.readFileSync(speedCache,'utf8'));if(Number.isFinite(Date.parse(cached.updatedAt))&&Date.parse(cached.updatedAt)<=Date.now()&&Number.isFinite(cached.data?.downMbps)&&Number.isFinite(cached.data?.upMbps)){sources.speedtest=cached;speedDue=Date.parse(cached.updatedAt)+3600000;}}catch{}
async function runSpeedtest(){
 if(speedActive||closing||!deviceManager.canTest())return;
 const networkDeviceId=deviceManager.beginTest();
 speedActive=true;sources.speedtest={...sources.speedtest,running:true,error:null};
 try{const data=await measure();sources.speedtest={status:'ok',updatedAt:new Date().toISOString(),identity:'Cloudflare HTTP / 200 MB',data:{...data,networkDeviceId},running:false};try{fs.writeFileSync(speedCache,JSON.stringify(sources.speedtest));}catch{}}
 catch{sources.speedtest={...sources.speedtest,running:false,error:'Тест не выполнен; предыдущий результат сохранён'};}
 finally{speedActive=false;speedDue=Date.now()+3600000;}
}
function scheduleSpeedtest(){if(Date.now()>=speedDue&&!speedActive)runSpeedtest();later(scheduleSpeedtest,10000);}
const timers=new Set();
function later(fn,ms){if(!localActive)return;const t=setTimeout(()=>{timers.delete(t);if(!closing&&localActive)fn();},ms);timers.add(t);return t;}
function run(exe,args){return new Promise((resolve,reject)=>execFile(exe,args,{windowsHide:true,timeout:4000,maxBuffer:128*1024},(err,stdout)=>err?reject(err):resolve(stdout)));}
function publishSystem(){
 if(!localActive)return;
 const now=Date.now(), r=ram&&now-Date.parse(ram.updatedAt)<10000?ram:null, selectedGpu=deviceManager.selectedGpu(),g=selectedGpu?.provider==='nvidia'&&now-Date.parse(deviceManager.gpuTimestamp())<15000?{gpuName:selectedGpu.name,vramUsedBytes:selectedGpu.used,vramTotalBytes:selectedGpu.total,updatedAt:deviceManager.gpuTimestamp()}:null;
 sources.system=r||g?{status:'ok',updatedAt:[r?.updatedAt,g?.updatedAt].filter(Boolean).sort()[0],identity:'GlobalMemoryStatusEx / nvidia-smi dedicated framebuffer',data:{ramUsedBytes:r?.usedBytes??null,ramTotalBytes:r?.totalBytes??null,vramUsedBytes:g?.vramUsedBytes??null,vramTotalBytes:g?.vramTotalBytes??null,gpuName:g?.gpuName??null},measurements:{ram:r?.updatedAt??null,vram:g?.updatedAt??null}}:unavailable('Windows / NVIDIA');
}
function startWorker(){
 worker=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',fs.readFileSync(path.join(__dirname,'windows-sensors.ps1'),'utf8')],{windowsHide:true,env:{...process.env,VG_DESKTOP_ROOT:__dirname},stdio:['pipe','pipe','pipe']});
 worker.stdin.on('error',()=>{});
 const lines=createInterface({input:worker.stdout});
 lines.on('line',line=>{try{
  const sample=JSON.parse(line.replace(/^\uFEFF/,''));
  if(Object.hasOwn(sample,'launcherInputReady')){launcherInput.setAvailable(sample.launcherInputReady);return;}
  if(sample.launcherWheel){launcherInput.push(sample.launcherWheel);return;}
  if(sample.desktop)sources.desktop=desktopSource(sample.desktop,sample.measuredAt);
  else if(!sample.reply)sources.desktop=unavailable('Windows DisplayConfig / Core Audio');
  if(sample.reply){
   if(pendingDesktop?.id===sample.reply){const pending=pendingDesktop;pendingDesktop=null;clearTimeout(pending.timer);if(sample.ok)pending.resolve(sources.desktop);else{console.error('Desktop control failed: '+String(sample.error).slice(0,250));pending.reject(Error('Desktop switch failed'));}}
   return;
  }
  if(sample.ram)ram={...sample.ram,updatedAt:sample.measuredAt};else ram=null;
  publishSystem();
  const p=probe&&Date.now()-Date.parse(probe.updatedAt)<12000?probe:null;
  sources.network=sample.network?{status:'ok',updatedAt:p?[sample.measuredAt,p.updatedAt].sort()[0]:sample.measuredAt,identity:`Windows best route to ${sample.network.routeTarget} / ${sample.network.description}`,data:{adapter:sample.network.adapter,...L.rates(previous,sample),linkSpeedMbps:sample.network.linkSpeedBitsPerSecond>0?sample.network.linkSpeedBitsPerSecond/1000000:null,internet:p?.internet??null,pingMs:p?.pingMs??null,pingTarget:'https://www.microsoft.com/favicon.ico (HTTPS RTT)',routeTarget:sample.network.routeTarget,includesLan:true},measurements:{traffic:sample.measuredAt,connectivity:p?.updatedAt??null}}:unavailable('Windows route','Нет активного маршрута');
  previous=sample;
  sources.events=eventFeed.observe(sources);
 }catch{console.error('Windows sensor response rejected');}});
 worker.stderr.on('data',()=>console.error('Windows sensor worker reported an error'));
 worker.on('error',()=>console.error('Cannot start Windows sensor worker'));
 worker.on('exit',()=>{launcherInput.setAvailable(false);ram=null;previous=null;if(localActive){sources.network=unavailable('Windows route');sources.desktop=unavailable('Windows DisplayConfig / Core Audio');}try{fs.unlinkSync(commandFile);}catch{}if(pendingDesktop&&pendingDesktop.kind!=='media'){clearTimeout(pendingDesktop.timer);pendingDesktop.reject(Error('Desktop worker exited'));pendingDesktop=null;}if(!closing&&localActive)later(startWorker,10000);});
}
function startMedia(){
 mediaWorker=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',fs.readFileSync(path.join(__dirname,'windows-media.ps1'),'utf8')],{windowsHide:true,env:{...process.env,VG_DESKTOP_ROOT:__dirname},stdio:['ignore','pipe','pipe']});
 createInterface({input:mediaWorker.stdout}).on('line',line=>{try{const {reply,ok,error,...s}=JSON.parse(line.replace(/^\uFEFF/,''));if(['ok','unavailable'].includes(s.status))sources.media=s;if(reply&&pendingDesktop?.id===reply){const p=pendingDesktop;pendingDesktop=null;clearTimeout(p.timer);if(ok)p.resolve(sources.media);else{console.error('Media control failed: '+String(error).slice(0,200));p.reject(Error('Media control failed'));}}}catch{sources.media=unavailable('Windows SMTC');}});
 mediaWorker.stderr.on('data',()=>console.error('Windows media reader reported an error'));
 mediaWorker.on('error',()=>console.error('Cannot start Windows media reader'));
 mediaWorker.on('exit',()=>{if(localActive)sources.media=unavailable('Windows SMTC');try{fs.unlinkSync(mediaCommandFile);}catch{}if(pendingDesktop?.kind==='media'){clearTimeout(pendingDesktop.timer);pendingDesktop.reject(Error('Media worker exited'));pendingDesktop=null;}if(!closing&&localActive)later(startMedia,10000);});
}
async function checkInternet(){const t=performance.now();try{const r=await fetch('https://www.microsoft.com/favicon.ico',{signal:AbortSignal.timeout(3500),redirect:'error'});await r.arrayBuffer();probe={updatedAt:new Date().toISOString(),internet:r.ok?true:null,pingMs:r.ok?performance.now()-t:null};}catch{probe={updatedAt:new Date().toISOString(),internet:null,pingMs:null};}later(checkInternet,8000);}
async function readWeather(){if(!weatherSettings)return;let retry=600000;try{const r=await fetch(weatherConfig.weatherUrl(weatherSettings),{signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw new Error();sources.weather=L.weatherResult(await r.json(),weatherSettings);}catch{retry=30000;if(sources.weather.status!=='ok')sources.weather={...unavailable('Open-Meteo'),status:'error'};}later(readWeather,retry);}
const clients=new Set();
const server=http.createServer((req,res)=>{
 const url=boundary(req,res,controlKey);if(!url)return;
 const origin=req.headers.origin;
 const trusted=!origin||['null','file://','http://127.0.0.1:8767','http://localhost:8767'].includes(origin);
 if(['/devices','/devices/refresh'].includes(url.pathname)){deviceHandler(req,res,url);return;}
 if(['/builder','/builder/chat','/builder/chat/cancel'].includes(url.pathname)){builderHandler(req,res,url);return;}
 if(appStatic.serve(req,res,url))return;
 if(url.pathname==='/layouts'){layoutHandler(req,res,url);return;}
 if(url.pathname==='/app-info'&&trusted&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({application:'WallpaperShell',version:appRelease.version,backend:sharedActive?'shared':localActive?'local':'starting',theme:require('./themes.cjs').get(),automaticSpeedtest:process.env.PG_NO_AUTOSPEED!=='1'}));return;}
 if(url.pathname==='/launcher-input'){
  launcherInput.handler(req,res);return;
 }
 if(url.pathname==='/controls'){controlHandler(req,res);return;}
 if(url.pathname==='/diagnostics'){uiDiagnostics.handler(req,res);return;}
 if(url.pathname==='/power'){powerHandler(req,res);return;}
 if(url.pathname==='/launcher'){launcherHandler(req,res);return;}
 if(url.pathname==='/launcher-overlay'){launcherOverlay.handler(req,res);return;}
 if(url.pathname==='/speedtest'){
  if(!trusted){res.writeHead(403).end();return;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','X-VioletGhost-Action, X-VioletGhost-Key');res.writeHead(204).end();return;}
  if(req.method!=='POST'||req.headers['x-violetghost-action']!=='speedtest'){res.writeHead(405).end();return;}
  if(!desktop.authorized(req,controlKey,'speedtest')){res.writeHead(403).end();return;}
  if(!deviceManager.canTest()){res.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Для теста выбери активный маршрут Windows («Авто»). Остальные адаптеры показывают текущий трафик.'}));return;}
  if(sharedActive){deviceManager.beginTest();relay.speedtest().then(r=>{res.writeHead(r.status,{'Content-Type':'application/json'}).end(r.body);}).catch(()=>res.writeHead(503).end());return;}
  if(!speedActive&&Date.now()<speedDue-3540000){res.writeHead(429).end();return;}
  runSpeedtest();res.writeHead(202,{'Content-Type':'application/json'}).end(JSON.stringify({running:true}));return;
 }
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');res.writeHead(204).end();return;}
 if(req.method!=='GET'||url.pathname!=='/status'){res.writeHead(req.method==='GET'?404:405).end();return;}
 if(!desktop.authorized(req,controlKey)){res.writeHead(403).end();return;}
 // Only non-sensitive render diagnostics: confirms the real Engine viewport and profile.
 uiDiagnostics.record(url);
 const profile=url.searchParams.get('vgProfile'),viewport=url.searchParams.get('vgViewport'),context=url.searchParams.get('vgContext');
 if(['display-1','display-2'].includes(profile)&&/^\d{2,5}x\d{2,5}$/.test(viewport)&&['engine','browser'].includes(context)){
  const flags=['vgMedia','vgAudio','vgMotion','vgReactive','vgLauncher'].map(key=>{const v=url.searchParams.get(key);return /^[a-z]{2,12}$/.test(v||'')?`${key.slice(2)}=${v}`:'';}).filter(Boolean).join(' ');
  const id=`${context} ${profile} ${viewport} ${flags}`;if(!clients.has(id)){if(clients.size>=32)clients.delete(clients.values().next().value);clients.add(id);console.log('WallpaperShell client: '+id);}
 }
 publishSystem();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({schemaVersion:1,appearance:appearance.get(),lunaAppearance:lunaAppearance.get(),sources:deviceManager.decorate({...sources,media:trusted?sources.media:unavailable('Windows SMTC'),desktop:trusted?sources.desktop:unavailable('Windows DisplayConfig / Core Audio')})}));
});
// A duplicate must not clean command files or restore the running launcher's icons.
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'WallpaperShell is already running on port 8767':error.code);process.exit(error.code==='EADDRINUSE'?0:1);});
function stop(options={}){if(closing)return;closing=true;builderHandler.stop();deviceManager.stop();sourceCoordinator.stop();launcherOverlay.stop();launcherInput.stop();stopLocal();server.close();launcher.stop(options).catch(()=>{}).finally(()=>process.exit());setTimeout(()=>process.exit(),16000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
function startLocal(){if(localActive||closing)return;localActive=true;sharedActive=false;startWorker();startMedia();checkInternet();readWeather();stopEcoflow=startEcoflow(s=>{if(localActive)sources.ecoflow=energy.enrich(s);});if(process.env.PG_NO_AUTOSPEED!=='1')later(scheduleSpeedtest,10000);}
function stopLocal(){localActive=false;for(const t of timers)clearTimeout(t);timers.clear();stopEcoflow?.();stopEcoflow=null;worker?.kill();mediaWorker?.kill();worker=null;mediaWorker=null;}
const sourceCoordinator=new (require('./app-sources.cjs').SourceCoordinator)({
 readShared:()=>process.env.PG_FORCE_LOCAL==='1'?Promise.reject(Error('Local mode')):relay.snapshot(),startLocal,stopLocal,isLocalBusy:()=>speedActive,
 applyShared:s=>{sharedActive=true;for(const key of Object.keys(sources))if(s.sources[key])sources[key]=s.sources[key];}
});
server.listen(8767,'127.0.0.1',()=>{for(const file of [commandFile,mediaCommandFile])try{fs.unlinkSync(file);}catch{}fs.writeFileSync(path.join(__dirname,'.runtime.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));console.log(JSON.stringify({type:'app-ready',port:8767,theme:require('./themes.cjs').get()}));deviceManager.start();sourceCoordinator.start();launcher.start();});
// Owned stdin is closed if the C# application exits, even after an exception.
process.stdin.resume();createInterface({input:process.stdin}).on('line',line=>{if(line==='stop'){stop();return;}try{const message=JSON.parse(line);if(message.type==='window-policy')launcherOverlay.policy(message);}catch{}});process.stdin.on('end',()=>stop());


