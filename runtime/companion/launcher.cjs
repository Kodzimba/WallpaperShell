'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
const {authorized}=require('./desktop-controls.cjs');
const freshness=require('./launcher-freshness.cjs');
const groups=[{id:'work',name:'Работа',icon:'work'},{id:'games',name:'Игры',icon:'games'},{id:'leisure',name:'Общение и отдых',icon:'chat'},{id:'tools',name:'Утилиты',icon:'tools'},{id:'folders',name:'Папки',icon:'folder'},{id:'files',name:'Временное',icon:'files'},{id:'unsorted',name:'Разобрать',icon:'inbox'}];
const groupIds=new Set(groups.map(g=>g.id));
const shortcuts=new Set(['.lnk','.url','.exe','.appref-ms']);
const imageExtensions=new Set(['.png','.jpg','.jpeg','.webp','.gif','.bmp','.tif','.tiff']);
const documents=new Set(['.txt','.md','.pdf','.doc','.docx','.odt','.rtf','.xls','.xlsx','.csv','.ppt','.pptx','.png','.jpg','.jpeg','.webp','.gif','.bmp','.tif','.tiff','.mp3','.wav','.flac','.ogg','.mp4','.mkv','.webm','.zip','.7z','.rar','.blend','.psd','.kra']);
function classify(name,extension,directory){
 if(directory)return {group:'folders',section:''};
 const n=name.toLowerCase();
 if(!shortcuts.has(extension))return {group:'files',section:''};
 if(/steamvr|meta horizon|koikatu|deovr|desktop\+|steam 360/.test(n))return {group:'games',section:'VR'};
 if(/dedicated server|mod manager|donbasgard admin/.test(n))return {group:'games',section:'Инструменты'};
 if(/blender|unity|aura.?for|cursor|visual studio|github|git bash|articy|\bword\b|chatgpt|codex|photoshop|t3 code|streamlabs|dicloak/.test(n))return {group:'work',section:''};
 if(/discord|telegram|\bsteam\b|rockstar|opera|chrome|\bvlc\b|krisp/.test(n))return {group:'leisure',section:''};
 if(/ccleaner|crystaldisk|windirstat|gpu-z|afterburner|latencymon|g hub|nvidia|razer|gamesir|wallpaper engine/.test(n))return {group:'tools',section:''};
 if(extension==='.url'&&/anger foot|baldur|deadlock|marvel rivals|mewgenics|outer wilds|sky children|valheim|darktide/.test(n))return {group:'games',section:''};
 return {group:'unsorted',section:''};
}
function validAction(a){
 if(!a||typeof a!=='object'||Array.isArray(a))return false;
 const k=Object.keys(a).sort().join(','),id=typeof a.id==='string'&&/^[a-f0-9]{64}$/.test(a.id);
 const ids=Array.isArray(a.ids)&&a.ids.length>0&&a.ids.length<=100&&a.ids.every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))&&new Set(a.ids).size===a.ids.length;
 if(a.action==='context'){const fields=Object.keys(a).filter(k=>k!=='surfaceId').sort().join(',');return (!Object.hasOwn(a,'surfaceId')||typeof a.surfaceId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(a.surfaceId))&&(fields==='action,id'&&id||fields==='action,ids'&&ids||fields==='action,background'&&a.background===true);}
 if(a.action==='recycle'&&k==='action,ids')return ids;
 if(a.action==='assign'&&k==='action,group,ids')return ids&&groupIds.has(a.group);
 if(a.action==='move'&&k==='action,ids,target')return ids&&typeof a.target==='string'&&/^[a-f0-9]{64}$/.test(a.target);
 return a.action==='open'&&k==='action,id'&&id || a.action==='recycle'&&k==='action,id'&&id || a.action==='move'&&k==='action,id,target'&&id&&typeof a.target==='string'&&/^[a-f0-9]{64}$/.test(a.target) || a.action==='assign'&&k==='action,group,id'&&id&&groupIds.has(a.group) || a.action==='system'&&k==='action,id'&&['thispc','recyclebin','desktop'].includes(a.id) || a.action==='restore'&&k==='action' || a.action==='settings'&&k==='action,enabled,hideIcons'&&typeof a.enabled==='boolean'&&typeof a.hideIcons==='boolean'&&(a.enabled||!a.hideIcons);
}
function windowsNative(root){
 const companion=path.join(root,'companion'),script=fs.readFileSync(path.join(companion,'launcher-windows.ps1'),'utf8');
 return (mode,extra={})=>new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-STA','-Command',script],{windowsHide:true,timeout:mode==='icons'?60000:/^(move|recycle)(-batch)?$/.test(mode)?60000:15000,maxBuffer:16*1024*1024,env:{...process.env,VG_LAUNCH_ROOT:companion,VG_LAUNCH_MODE:mode,...extra}},(error,stdout)=>{if(error){reject(Error('Windows launcher operation failed'));return;}try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(Error('Invalid Windows launcher reply'));}}));
}
function createLauncher({root,key,native=windowsNative(root),contextMenu=null,now=Date.now}){
 const stateFile=path.join(root,'companion/.launcher-state.json'),iconFile=path.join(root,'companion/.launcher-icons.json');
 let state={version:1,enabled:false,hideIcons:false,originalIconsVisible:null,assignments:{},fileSeenVersion:0,fileSeen:{}},icons={},roots=[],entries=new Map(),ready=false,scanBusy=false,stopped=false,timer=null,error=null,revision=0,initialized=false,initializing=false;
 let iconWrites=Promise.resolve(),desktopExit=false;
 try{const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(s.version===1)state={...state,enabled:s.enabled===true,hideIcons:s.enabled===true&&s.hideIcons===true,originalIconsVisible:typeof s.originalIconsVisible==='boolean'?s.originalIconsVisible:null,assignments:s.assignments&&typeof s.assignments==='object'&&!Array.isArray(s.assignments)?s.assignments:{},fileSeenVersion:s.fileSeenVersion===1?1:0,fileSeen:freshness.normalize(s.fileSeen)};}catch{}
 try{icons=JSON.parse(fs.readFileSync(iconFile,'utf8'));}catch{}
 function save(next){fs.writeFileSync(stateFile+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(stateFile+'.tmp',stateFile);state=next;revision++;}
 function setIcons(visible){
  const next=iconWrites.catch(()=>{}).then(async()=>{
   const desired=desktopExit||visible;
   const result=await native('icons-set',{VG_LAUNCH_VISIBLE:String(desired)});
   if(result?.visible!==desired)throw Error('Desktop icon visibility not confirmed');
  });
  iconWrites=next;return next;
 }
 function raster(value){return value&&typeof value.png==='string'&&value.png.length<1500000&&/^[A-Za-z0-9+/=]+$/.test(value.png)&&Number.isInteger(value.width)&&value.width>0&&value.width<=2048&&Number.isInteger(value.height)&&value.height>0&&value.height<=2048?value:null;}
 function publicPayload(){return {version:1,ready,enabled:state.enabled,hideIcons:state.hideIcons,error,revision,groups:groups.filter(g=>g.id!=='unsorted'||[...entries.values()].some(e=>e.group==='unsorted')),items:[...entries.values()].map(e=>{const cached=icons[e.id]?.fingerprint===e.fingerprint?icons[e.id]:null,icon=raster(cached?.icon),thumbnail=e.preview?raster(cached?.thumbnail):null;return {id:e.id,name:e.name,group:e.group,section:e.section,type:e.type,origin:e.origin,newUntil:e.type==='file'&&e.group==='files'?freshness.until(state.fileSeen[e.id]):null,icon:icon?'data:image/png;base64,'+icon.png:null,iconWidth:icon?.width??null,iconHeight:icon?.height??null,thumbnail:thumbnail?'data:image/png;base64,'+thumbnail.png:null,thumbnailWidth:thumbnail?.width??null,thumbnailHeight:thumbnail?.height??null};}).sort((a,b)=>a.name.localeCompare(b.name,'ru'))};}
 async function scan(){
  if(scanBusy||stopped)return;scanBusy=true;
  try{
   const next=new Map(),missing=[];
   for(const [index,desktop] of roots.entries())for(const name of fs.readdirSync(desktop)){
    if(name.startsWith('.')||name.startsWith('~$')||name.toLowerCase()==='desktop.ini')continue;
    const target=path.join(desktop,name);let stat;try{stat=fs.lstatSync(target);}catch{continue;}
    if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile())continue;
    if(/^(этот компьютер|this pc|мой компьютер)(?:\s|\.|$)/i.test(name))continue;
    const id=crypto.createHmac('sha256',key).update(target.toLowerCase()).digest('hex'),extension=path.extname(name).toLowerCase(),folder=stat.isDirectory();
    const detected=classify(name,extension,folder),manual=state.assignments[id];
    const entry={id,path:target,name:shortcuts.has(extension)?name.slice(0,-extension.length):name,group:groupIds.has(manual)?manual:detected.group,section:groupIds.has(manual)?'':detected.section,type:folder?'folder':shortcuts.has(extension)?'app':'file',origin:index===0?'Личный рабочий стол':'Общий рабочий стол',preview:!folder&&imageExtensions.has(extension),fingerprint:'v6:'+stat.mtimeMs+':'+stat.size,mode:folder||shortcuts.has(extension)||documents.has(extension)?'open':'reveal'};
    entry.fileIdentity=stat.dev+':'+stat.ino;entry.createdAt=stat.birthtimeMs;entry.trackingIdentity=entry.fileIdentity+':'+Math.floor(stat.birthtimeMs||0);next.set(id,entry);if(icons[id]?.fingerprint!==entry.fingerprint)missing.push({id,path:target,fingerprint:entry.fingerprint,preview:entry.preview});
   }
   const marks=freshness.observe(state.fileSeen,state.fileSeenVersion===1,[...next.values()].filter(entry=>entry.type==='file').map(entry=>({id:entry.id,identity:entry.trackingIdentity,createdAt:entry.createdAt})),now());
   if(marks.changed||state.fileSeenVersion!==1){const updated={...state,fileSeenVersion:1,fileSeen:marks.records};try{save(updated);}catch{state=updated;revision++;}}
   const changed=entries.size!==next.size||[...next.values()].some(e=>{const old=entries.get(e.id);return !old||old.fingerprint!==e.fingerprint||old.group!==e.group||old.section!==e.section;});
   entries=next;ready=true;error=null;if(changed)revision++;
   if(missing.length){
    const manifest=path.join(root,'companion/.launcher-icon-request.json');fs.writeFileSync(manifest,JSON.stringify(missing),{mode:0o600});
    try{const found=await native('icons',{VG_LAUNCH_MANIFEST:manifest});for(const e of missing)icons[e.id]={fingerprint:e.fingerprint,icon:found[e.id]?.icon||null,thumbnail:e.preview?found[e.id]?.thumbnail||null:null};icons=Object.fromEntries(Object.entries(icons).filter(([id])=>entries.has(id)));fs.writeFileSync(iconFile,JSON.stringify(icons),{mode:0o600});revision++;}catch{/* Real file names and generic glyphs remain usable when image extraction fails. */}finally{try{fs.unlinkSync(manifest);}catch{}}
   }
  }catch{error='Не удалось прочитать рабочий стол';if(!entries.size)ready=false;}
  finally{scanBusy=false;}
 }
 async function initialize(){
  if(initializing||stopped)return;initializing=true;
  try{
   const result=await native('roots');if(!Array.isArray(result.roots)||!result.roots.length)throw Error();roots=[...new Set(result.roots.map(p=>path.resolve(p)))];
   const visibility=await native('icons-get');if(typeof visibility.visible!=='boolean')throw Error();
   if(state.originalIconsVisible===null)save({...state,originalIconsVisible:visibility.visible});
   await scan();if(state.enabled&&state.hideIcons&&ready)await setIcons(false);
   else if(!ready&&state.hideIcons)await restoreIcons();
   initialized=ready;
  }catch{error='Нет связи с рабочим столом';ready=false;try{await restoreIcons();}catch{}}
  finally{initializing=false;}
 }
 async function start(){
  await initialize();
  if(!stopped&&!timer){timer=setInterval(()=>initialized?scan():initialize(),15000);timer.unref?.();}
 }
 async function restoreIcons(){if(typeof state.originalIconsVisible==='boolean')await setIcons(state.originalIconsVisible);}
 async function settings(enabled,hideIcons){
  if(enabled&&!ready)throw Error('Desktop unavailable');
  const before=state;
  try{await setIcons(hideIcons?false:state.originalIconsVisible??true);save({...state,enabled,hideIcons});}
  catch(e){try{await setIcons(before.hideIcons?false:before.originalIconsVisible??true);}catch{}throw e;}
 }
 async function action(a){
  if(!validAction(a))throw Error('Invalid launcher action');
  if(a.action==='restore'){await settings(false,false);return publicPayload();}
  if(a.action==='settings'){await settings(a.enabled,a.hideIcons);return publicPayload();}
  if(!ready||!state.enabled)throw Error('Launcher is disabled');
  if(a.action==='context'){
   if(!contextMenu)throw Error('Shell context menu unavailable');
   const paths=a.background?[]:(a.ids||[a.id]).map(id=>{
    const item=entries.get(id);if(!item)throw Object.assign(Error('Item changed'),{code:'changed'});
    const stat=fs.lstatSync(item.path);
    if(stat.isSymbolicLink()||!roots.includes(path.dirname(item.path))||!stat.isDirectory()&&!stat.isFile()||item.fileIdentity!==stat.dev+':'+stat.ino||path.resolve(fs.realpathSync(item.path)).toLowerCase()!==path.resolve(item.path).toLowerCase())throw Object.assign(Error('Item changed'),{code:'changed'});
    return item.path;
   });
   if(new Set(paths.map(p=>path.dirname(p).toLowerCase())).size>1)throw Object.assign(Error('Mixed folders'),{code:'contextMixed'});
   await contextMenu({paths,folder:a.background?roots[0]:path.dirname(paths[0]),background:a.background===true,...(a.surfaceId?{surfaceId:a.surfaceId}:{})});await scan();return publicPayload();
  }
  if(a.action==='system'){await native('system',{VG_LAUNCH_SYSTEM:a.id});return {ok:true};}
  if(a.action==='move'||a.action==='recycle')return fileAction(a);
  if(a.action==='assign'){
   const targets=(a.ids||[a.id]).map(id=>{const entry=entries.get(id);if(!entry)throw Error('Unknown item');return entry;}),assignments={...state.assignments};
   for(const entry of targets)assignments[entry.id]=a.group;
   save({...state,assignments});for(const entry of targets){entry.group=a.group;entry.section='';}return publicPayload();
  }
  const entry=entries.get(a.id);if(!entry)throw Error('Unknown item');
  const stat=fs.lstatSync(entry.path);
  if(stat.isSymbolicLink()||!roots.includes(path.dirname(entry.path))||!stat.isDirectory()&&!stat.isFile())throw Error('Item changed');
  await native(entry.mode,{VG_LAUNCH_TARGET:entry.path});return {ok:true};
 }
 async function fileAction(a){
   const fail=code=>{throw Object.assign(Error('File operation rejected'),{code});};
   const sources=(a.ids||[a.id]).map(id=>{const entry=entries.get(id);if(!entry)fail('changed');let stat;try{stat=fs.lstatSync(entry.path);}catch{fail('changed');}
    if(entry.type!=='file'||entry.group!=='files'||!roots.includes(path.dirname(entry.path))||stat.isSymbolicLink()||!stat.isFile()||entry.fileIdentity!==stat.dev+':'+stat.ino||entry.fingerprint!=='v6:'+stat.mtimeMs+':'+stat.size||path.resolve(fs.realpathSync(entry.path)).toLowerCase()!==path.resolve(entry.path).toLowerCase())fail('changed');return entry;});
   let folder=null;
   if(a.action==='move'){
    folder=entries.get(a.target);if(!folder||folder.type!=='folder'||folder.group!=='folders'||!roots.includes(path.dirname(folder.path)))fail('changed');
    const target=fs.lstatSync(folder.path);if(!target.isDirectory()||target.isSymbolicLink()||folder.fileIdentity!==target.dev+':'+target.ino||path.resolve(fs.realpathSync(folder.path)).toLowerCase()!==path.resolve(folder.path).toLowerCase())fail('changed');
    const names=new Set();for(const entry of sources){const name=path.basename(entry.path).toLowerCase();if(names.has(name)||fs.existsSync(path.join(folder.path,path.basename(entry.path))))fail('exists');names.add(name);}
   }
   let result;
   if(sources.length===1)result=await native(a.action,{VG_LAUNCH_TARGET:sources[0].path,...(folder?{VG_LAUNCH_FOLDER:folder.path}:{})});
   else {
    const manifest=path.join(root,'companion/.launcher-file-request.json');
    fs.writeFileSync(manifest,JSON.stringify({issuedAt:Date.now(),action:a.action,files:sources.map(e=>e.path),folder:folder?.path||null}),{mode:0o600});
    try{result=await native(a.action+'-batch',{VG_LAUNCH_MANIFEST:manifest});}finally{try{fs.unlinkSync(manifest);}catch{}}
   }
   const statuses=sources.length===1?[result?.ok===true]:result?.completed;
   if(!Array.isArray(statuses)||statuses.length!==sources.length||!statuses.every(value=>typeof value==='boolean'))fail(result?.code==='exists'?'exists':'failed');
   const completed=sources.filter((entry,index)=>statuses[index]&&!fs.existsSync(entry.path)),completedIds=completed.map(e=>e.id),failedIds=sources.filter(e=>!completedIds.includes(e.id)).map(e=>e.id);
   if(!completed.length)fail(result?.code==='exists'?'exists':'failed');
   for(const entry of completed)entries.delete(entry.id);revision++;await scan();
   const notice=failedIds.length?'Выполнено: '+completed.length+' из '+sources.length+'. Остальные файлы остались на месте.':sources.length===1?(a.action==='recycle'?'Файл отправлен в Корзину':'Файл перемещён в «'+folder.name+'»'):(a.action==='recycle'?'В Корзину отправлено файлов: '+completed.length:'В «'+folder.name+'» перемещено файлов: '+completed.length);
   return {...publicPayload(),notice,operation:{completedIds,failedIds}};
 }
 async function showIcons(){
  desktopExit=true;
  try{await setIcons(true);if(state.originalIconsVisible!==true)save({...state,originalIconsVisible:true});}
  catch(error){desktopExit=false;throw error;}
 }
 async function restoreBackground(){const result=await native('standard-background');if(result?.ok!==true)throw Error('Windows background was not restored');}
 async function restoreCurrentIcons(){await setIcons(state.enabled&&state.hideIcons?false:state.originalIconsVisible??true);}
 async function stop({showIcons:visible=false}={}){stopped=true;clearInterval(timer);if(visible)await showIcons();else if(state.hideIcons)await restoreIcons();}
 return {start,scan,action,publicPayload,restoreIcons,showIcons,restoreBackground,restoreCurrentIcons,stop,isEnabled:()=>ready&&state.enabled};
}
function createHandler({key,launcher,canAct=()=>true}){
 let busy=false;
 return (req,res)=>{
  const allowed=!req.headers.origin||['null','file://','http://127.0.0.1:8767','http://localhost:8767'].includes(req.headers.origin);
  if(!allowed){res.writeHead(403).end();return;}
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-VioletGhost-Action, X-VioletGhost-Key');res.writeHead(204).end();return;}
  if(!authorized(req,key)){res.writeHead(403).end();return;}
  if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(launcher.publicPayload()));return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){res.writeHead(415).end();return;}
  if(busy||!canAct()){res.writeHead(409).end();return;}
  let bytes=0,chunks=[],done=false;const timeout=setTimeout(()=>{done=true;res.writeHead(408).end();},4000);timeout.unref();
  req.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>8192){done=true;clearTimeout(timeout);res.writeHead(413).end();}else chunks.push(chunk);});
  req.on('error',()=>{done=true;clearTimeout(timeout);});
  req.on('end',async()=>{
   clearTimeout(timeout);if(done)return;
   let a;try{a=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!validAction(a))throw Error();}catch{res.writeHead(400).end();return;}
   if(busy||!canAct()){res.writeHead(409).end();return;}busy=true;
   try{const payload=await launcher.action(a);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(payload));}
   catch(error){const messages={exists:'В папке уже есть файл с таким именем. Ничего не перезаписано.',changed:'Файл или папка изменились. Обнови список и попробуй снова.',contextMixed:'Для общего меню выбери элементы одного рабочего стола.',failed:'Windows не подтвердила перемещение. Проверь файл и права доступа.'};res.writeHead(error.code==='exists'?409:503,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:messages[error.code]||'Не удалось выполнить действие. Проверь, что файл ещё на рабочем столе.'}));}
   finally{busy=false;}
  });
 };
}
module.exports={groups,classify,validAction,windowsNative,createLauncher,createHandler};
