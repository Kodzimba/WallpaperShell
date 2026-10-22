'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process'),{createInterface}=require('node:readline');
const {authorized}=require('./desktop-controls.cjs');
const groups=new Set(['work','games','leisure','tools','folders','files','unsorted']);
const exact=(a,keys)=>Object.keys(a).sort().join(',')===keys.sort().join(',');
const sameSurface=(a,b)=>!!a&&!!b&&['surfaceId','monitorId','ownerHandle','shellOwnerHandle','profile'].every(k=>a[k]===b[k])&&['x','y','width','height'].every(k=>a.bounds[k]===b.bounds[k]);
const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&r[2]>r[0]&&r[3]>r[1];
function validSurface(s){return !!s&&typeof s==='object'&&!Array.isArray(s)&&exact(s,['surfaceId','monitorId','ownerHandle','bounds','profile',...(Object.hasOwn(s,'shellOwnerHandle')?['shellOwnerHandle']:[])])&&typeof s.surfaceId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s.surfaceId)&&typeof s.monitorId==='string'&&s.monitorId.length>=1&&s.monitorId.length<=128&&typeof s.ownerHandle==='string'&&/^[1-9][0-9]{0,18}$/.test(s.ownerHandle)&&(!Object.hasOwn(s,'shellOwnerHandle')||typeof s.shellOwnerHandle==='string'&&/^[1-9][0-9]{0,18}$/.test(s.shellOwnerHandle))&&['display-1','display-2'].includes(s.profile)&&!!s.bounds&&exact(s.bounds,['x','y','width','height'])&&['x','y','width','height'].every(k=>Number.isInteger(s.bounds[k]))&&Math.abs(s.bounds.x)<=100000&&Math.abs(s.bounds.y)<=100000&&s.bounds.width>0&&s.bounds.width<=10000&&s.bounds.height>0&&s.bounds.height<=10000;}
function validRequest(a){
 if(!a||typeof a!=='object'||Array.isArray(a)||!/^[a-f0-9]{32}$/.test(a.id||''))return false;
 if(a.action==='close')return exact(a,['action','id']);
 return a.action==='open'&&exact(a,['action','id','group','profile','width','height','rect','position',...(Object.hasOwn(a,'theme')?['theme']:[]),...(Object.hasOwn(a,'appearance')?['appearance']:[]),...(Object.hasOwn(a,'trigger')?['trigger']:[]),...(Object.hasOwn(a,'surface')?['surface']:[])])&&(!Object.hasOwn(a,'theme')||['classic','daylight','luna-blue'].includes(a.theme))&&(!Object.hasOwn(a,'appearance')||['daylight','luna-blue'].includes(a.theme)&&require('./appearance.cjs').valid(a.appearance)&&exact(a.appearance,['mode','accent','revision'])&&Number.isSafeInteger(a.appearance.revision)&&a.appearance.revision>=0)&&(!Object.hasOwn(a,'trigger')||validRect(a.trigger))&&(!Object.hasOwn(a,'surface')||validSurface(a.surface)&&a.surface.bounds.width===a.width&&a.surface.bounds.height===a.height)&&groups.has(a.group)&&['display-1','display-2'].includes(a.profile)&&Number.isInteger(a.width)&&a.width>=800&&a.width<=10000&&Number.isInteger(a.height)&&a.height>=600&&a.height<=10000&&validRect(a.rect)&&a.position&&exact(a.position,['x','y'])&&Number.isFinite(a.position.x)&&a.position.x>=16&&a.position.x<=1656&&Number.isFinite(a.position.y)&&a.position.y>=80&&a.position.y<=1010;
}
function compile(root){
 const destination=path.join(root,'companion/.launcher-host'),vendor=path.join(root,'companion/vendor/webview2'),source=path.join(root,'companion/LauncherOverlay.cs');
 fs.mkdirSync(destination,{recursive:true});
 for(const name of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll'])if(!fs.existsSync(path.join(destination,name)))fs.copyFileSync(path.join(vendor,name),path.join(destination,name));
 const helpers=['LauncherContext.cs','LauncherMenuTheme.cs','LauncherFiles.cs','LauncherSession.cs','LauncherPlacement.cs','PrivateBootstrap.cs'].map(name=>path.join(root,'companion',name));
 const exe=path.join(destination,'VioletGhost.Launcher.exe'),stamp=path.join(destination,'source.sha256'),hash=crypto.createHash('sha256').update([source,...helpers].map(file=>fs.readFileSync(file,'utf8')).join('\n')).digest('hex');
 const published=path.resolve(root,'../bin/WallpaperShell.Launcher.exe'),publishedStamp=path.resolve(root,'../bin/WallpaperShell.Launcher.source.txt');
 if(fs.existsSync(published)&&fs.existsSync(publishedStamp)&&fs.readFileSync(publishedStamp,'utf8')===hash)return Promise.resolve(published);
 if(fs.existsSync(exe)&&fs.existsSync(stamp)&&fs.readFileSync(stamp,'utf8')===hash)return Promise.resolve(exe);
 return new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+exe,'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:'+path.join(destination,'Microsoft.Web.WebView2.Core.dll'),'/reference:'+path.join(destination,'Microsoft.Web.WebView2.WinForms.dll'),source,...helpers],{windowsHide:true,timeout:60000},(error,out)=>{if(error){console.error(String(out).slice(0,2000));reject(Error('Cannot build launcher host'));}else{fs.writeFileSync(stamp,hash);resolve(exe);}}));
}
function createOverlay({root,enabled,key,getMenuMode=()=> 'dark',compileHost=compile,spawnHost=spawn,windowEvent=value=>console.log(JSON.stringify(value))}){
 let child=null,starting=null,active=null,activeSurface=null,generation=0,stopped=false,blocked=false,suspended=false,modalKind=null,modalOwner=null;
 const surfaces=new Map(),suspendedSurfaces=new Set();
 const replies=new Map();
 const contexts=new Map(),shellRequests=new Map(),lateShellRequests=new Map();let contextPending=false,contextSurface=null,contextInvoking=false;
 function write(value){if(child?.stdin.writable)child.stdin.write(JSON.stringify(value)+'\n',()=>{});}
 function host(){
  if(starting)return starting;
  starting=(async()=>{const exe=await compileHost(root);if(stopped)throw Error('Stopped');return new Promise((resolve,reject)=>{
   const proc=child=spawnHost(exe,[root,String(process.pid)],{cwd:path.dirname(exe),windowsHide:true,stdio:['pipe','pipe','pipe']});let registered=null;
   const timeout=setTimeout(()=>{reject(Error('Launcher host startup timed out'));proc.kill();},25000);
   proc.stdin.on('error',()=>{});proc.stderr.on('data',()=>console.error('Launcher overlay host reported an error'));
   createInterface({input:proc.stdout}).on('line',line=>{try{const message=JSON.parse(line);if(message.type==='ready'){if(!registered&&Number.isInteger(proc.pid)&&/^[1-9][0-9]{0,18}$/.test(message.handle||'')){registered={pid:proc.pid,handle:message.handle};windowEvent({type:'app-window',action:'register',...registered});}clearTimeout(timeout);resolve(proc);}if(message.type==='show-error')console.error('Launcher overlay: '+String(message.errorType).replace(/[^a-zA-Z]/g,'').slice(0,60));if(message.type==='shown'&&(!message.visible||!message.positioned))console.error('Launcher overlay state: '+JSON.stringify({visible:message.visible===true,topmost:message.topmost===true,positioned:message.positioned===true,error:Number(message.positionError)||0,style:Number(message.extendedStyle)||0}));if(['shown','show-error','blocked'].includes(message.type)){replies.get(message.id)?.({shown:message.type==='shown'&&message.visible===true&&message.positioned===true,topmost:message.topmost===true,positioned:message.positioned===true,...(message.type==='blocked'?{blocked:true}:{})});replies.delete(message.id);}if(message.type==='context-error')console.error('Shell menu: '+(['surface','validation','shell'].includes(message.stage)?message.stage:'unknown')+' '+(Number(message.code)||0));if(message.type==='context-invoking'&&contexts.has(message.id))contextInvoking=true;if(message.type==='context-result'){contexts.get(message.id)?.(message.ok===true);contexts.delete(message.id);}if(message.type==='hidden'&&(!message.id||message.id===active)){generation++;active=null;activeSurface=null;}if(message.type==='error'){clearTimeout(timeout);reject(Error('WebView2 initialization failed'));}}catch{}});
   proc.on('error',()=>{clearTimeout(timeout);reject(Error('Cannot start launcher host'));});
   proc.on('exit',()=>{clearTimeout(timeout);if(registered)windowEvent({type:'app-window',action:'unregister',...registered});if(child===proc){child=null;starting=null;for(const finish of contexts.values())finish(false);contexts.clear();dismiss();}reject(Error('Launcher host exited'));});
  });})();
  starting.catch(()=>{starting=null;});return starting;
 }
 async function open(a){
  if(contextPending||!allowed(a.surface)||!matchingSurface(a.surface))return {shown:false,topmost:false,positioned:false,blocked:true};
  const at=++generation;active=a.id;activeSurface=a.surface?.surfaceId||null;
  await host();
  if(stopped||at!==generation||active!==a.id||!enabled()||!allowed(a.surface)||!matchingSurface(a.surface))return {shown:false,topmost:false,positioned:false,blocked:true};
  const result=await new Promise(resolve=>{const timer=setTimeout(()=>{replies.delete(a.id);if(active===a.id)dismiss();resolve({shown:false,topmost:false,positioned:false,blocked:true});},6000);replies.set(a.id,value=>{clearTimeout(timer);resolve(value);});write(a);});return {shown:result.shown&&result.positioned&&at===generation,topmost:result.topmost,positioned:result.positioned,...(result.blocked||at!==generation?{blocked:true}:{})};
 }
 async function contextMenu(request){
  const source=request.surfaceId||activeSurface;
  if(contextPending||stopped||!enabled()||!allowed({surfaceId:source})||!source||!surfaces.has(source))throw Error('Shell menu unavailable');contextPending=true;contextSurface=source;contextInvoking=false;const at=generation,metadata=surfaces.get(source);let lease=null;
  const id=crypto.randomBytes(16).toString('hex');
  try{lease=await reserveShell(source);if(!lease||stopped||at!==generation||!sameSurface(metadata,surfaces.get(source)))throw Error('Shell menu unavailable');await host();if(stopped||!enabled()||at!==generation||!allowedShell(source)||!sameSurface(metadata,surfaces.get(source)))throw Error('Shell menu unavailable');await new Promise((resolve,reject)=>{
   // Cancelling TrackPopupMenu does not close a running Rename/Properties.
   // Keep the modal lease until the actual native result or host exit.
   const timer=setTimeout(()=>{if(!contextInvoking)write({action:'context-cancel',id});},600000);
   contexts.set(id,ok=>{clearTimeout(timer);ok?resolve():reject(Error('Shell menu failed'));});const nativeOwner=surfaces.get(source)?.shellOwnerHandle;write({action:'context',id,...request,menuMode:getMenuMode()==='light'?'light':'dark',...(nativeOwner?{invokeOwnerHandle:nativeOwner}:{})});
  });}finally{contexts.delete(id);if(lease)releaseShell(source,lease);contextPending=false;contextSurface=null;contextInvoking=false;}
 }
 function releaseShell(surfaceId,token){windowEvent({type:'app-shell-request',requestId:crypto.randomUUID(),action:'release',surfaceId,token});}
 function reserveShell(surfaceId){return new Promise(resolve=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>finish(null),8000);function finish(value){clearTimeout(timer);shellRequests.delete(requestId);if(!value){lateShellRequests.set(requestId,surfaceId);if(lateShellRequests.size>64)lateShellRequests.delete(lateShellRequests.keys().next().value);}resolve(value?.ok===true&&typeof value.token==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.token)?value.token:null);}shellRequests.set(requestId,finish);windowEvent({type:'app-shell-request',requestId,action:'acquire',surfaceId});});}
 function allowedShell(surfaceId){return !stopped&&!suspended&&!suspendedSurfaces.has(surfaceId)&&(!blocked||modalKind==='shell'&&modalOwner===surfaceId&&contextPending&&contextSurface===surfaceId);}
 function allowed(surface){return !stopped&&!blocked&&!suspended&&!suspendedSurfaces.has(surface?.surfaceId||activeSurface);}
 function matchingSurface(surface){return !surface||sameSurface(surfaces.get(surface.surfaceId),surface);}
 function dismiss(){generation++;active=null;activeSurface=null;for(const finish of replies.values())finish({shown:false,topmost:false,positioned:false,blocked:true});replies.clear();for(const finish of shellRequests.values())finish(null);shellRequests.clear();write({action:'dismiss'});}
 function close(id){if(active===id)dismiss();}
 function stop(){stopped=true;dismiss();write({action:'stop'});}
 function policy(value){
  if(!value||value.type!=='window-policy')return false;
  const event=value.event;
  if(event==='shell-result'){const finish=shellRequests.get(value.requestId);if(finish)finish(value);else{const source=lateShellRequests.get(value.requestId);if(source&&value.ok===true&&typeof value.token==='string')releaseShell(source,value.token);lateShellRequests.delete(value.requestId);}return true;}
  if(event==='surface'){
   const s=value.surface||Object.fromEntries(['surfaceId','monitorId','ownerHandle','bounds','profile',...(Object.hasOwn(value,'shellOwnerHandle')?['shellOwnerHandle']:[])].map(k=>[k,value[k]]));
   if(!validSurface(s))return false;
   if((activeSurface===s.surfaceId||contextPending&&contextSurface===s.surfaceId)&&surfaces.has(s.surfaceId)&&!sameSurface(surfaces.get(s.surfaceId),s))dismiss();surfaces.set(s.surfaceId,s);return true;
  }
  if(event==='modal-state'){blocked=value.blocked===true;modalKind=blocked?value.kind:null;modalOwner=blocked?value.ownerSurfaceId:null;if(blocked&&!(modalKind==='shell'&&contextPending&&contextSurface===modalOwner))dismiss();return true;}
  if(event==='suspend'){if(value.surfaceId)suspendedSurfaces.add(value.surfaceId);else suspended=true;}
  if(event==='resume'){if(value.surfaceId)suspendedSurfaces.delete(value.surfaceId);else suspended=false;return true;}
  if(!['external','suspend','reset','panel-close'].includes(event))return false;
  if(event==='panel-close'&&value.kind==='launcher'&&value.sourceSurfaceId&&(value.sourceSurfaceId===activeSurface||contextPending&&value.sourceSurfaceId===contextSurface))return true;
  if(!value.surfaceId||value.surfaceId===activeSurface||contextPending&&value.surfaceId===contextSurface)dismiss();
  if(event==='reset'){if(value.surfaceId){surfaces.delete(value.surfaceId);suspendedSurfaces.delete(value.surfaceId);}else{surfaces.clear();suspendedSurfaces.clear();}}
  return true;
 }
 function handler(req,res){
  if(req.headers.origin&&!['null','file://','http://127.0.0.1:8767','http://localhost:8767'].includes(req.headers.origin)){res.writeHead(403).end();return;}
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-VioletGhost-Action, X-VioletGhost-Key');res.writeHead(204).end();return;}
  if(!authorized(req,key)){res.writeHead(403).end();return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){res.writeHead(415).end();return;}
  let bytes=0,body='',done=false;const timeout=setTimeout(()=>{done=true;res.writeHead(408).end();},4000);timeout.unref();
  req.on('data',chunk=>{bytes+=chunk.length;if(bytes>2048&&!done){done=true;clearTimeout(timeout);res.writeHead(413).end();}else if(!done)body+=chunk;});
  req.on('error',()=>{done=true;clearTimeout(timeout);});
  req.on('end',async()=>{clearTimeout(timeout);if(done)return;let a;try{a=JSON.parse(body);if(!validRequest(a))throw Error();}catch{res.writeHead(400).end();return;}
   try{if(a.action==='close'){close(a.id);res.writeHead(200,{'Content-Type':'application/json'}).end('{"closed":true}');return;}if(!enabled()){res.writeHead(409).end();return;}const result=await open(a);res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));}
   catch{res.writeHead(503,{'Content-Type':'application/json'}).end('{"error":"Overlay unavailable"}');}
  });
 }
 return {handler,stop,contextMenu,policy,blocked:()=>blocked};
}
module.exports={validRequest,validSurface,compile,createOverlay};
