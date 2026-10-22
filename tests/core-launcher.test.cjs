'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {classify,validAction,createLauncher,createHandler}=require('../runtime/companion/launcher.cjs');
const key='a'.repeat(64),headers={'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':key,Origin:'null'};
function fixture(state,extra={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'vg-launch-')),desk=path.join(root,'Desktop');fs.mkdirSync(desk);fs.mkdirSync(path.join(root,'companion'));if(state)fs.writeFileSync(path.join(root,'companion/.launcher-state.json'),JSON.stringify({version:1,...state}));const calls=[];let visible=true,fail=false;
 const native=async(mode,env={})=>{calls.push({mode,env});if(fail)throw Error('native failure');if(mode==='roots')return {roots:[desk]};if(mode==='icons-get')return {visible};if(mode==='icons-set'){visible=env.VG_LAUNCH_VISIBLE==='true';return {visible};}if(mode==='move'){fs.renameSync(env.VG_LAUNCH_TARGET,path.join(env.VG_LAUNCH_FOLDER,path.basename(env.VG_LAUNCH_TARGET)));return {ok:true};}if(mode==='recycle'){fs.renameSync(env.VG_LAUNCH_TARGET,path.join(root,'test-recycled-file'));return {ok:true};}return {};};
 let batchLimit=Infinity;const wrappedNative=async(mode,env={})=>{if(!mode.endsWith('-batch'))return native(mode,env);calls.push({mode,env});if(fail)throw Error('native failure');const request=JSON.parse(fs.readFileSync(env.VG_LAUNCH_MANIFEST,'utf8'));const completed=request.files.map((source,index)=>{if(index>=batchLimit)return false;fs.renameSync(source,mode==='move-batch'?path.join(request.folder,path.basename(source)):path.join(root,'recycled-'+path.basename(source)));return true;});return {ok:completed.every(Boolean),completed};};
 const api=createLauncher({root,key,native:wrappedNative,...extra});return {root,desk,api,calls,visible:()=>visible,fail:value=>{fail=value;},batchLimit:value=>{batchLimit=value;},cleanup:async()=>{await api.stop().catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}};
}
test('temporary-file timestamps persist across launcher restart and editing does not renew them',async()=>{
 let clock=Date.parse('2026-10-21T12:00:00Z');const f=fixture(undefined,{now:()=>clock});let restarted;
 try{
  await f.api.start();const target=path.join(f.desk,'Fresh.txt');fs.writeFileSync(target,'first');await f.api.scan();const item=f.api.publicPayload().items.find(item=>item.name==='Fresh.txt');assert.equal(item.newUntil,clock+86400000);
  clock+=3600000;fs.appendFileSync(target,' edited');await f.api.scan();assert.equal(f.api.publicPayload().items.find(entry=>entry.id===item.id).newUntil,item.newUntil);
  const native=async mode=>mode==='roots'?{roots:[f.desk]}:mode==='icons-get'?{visible:true}:{};
  await f.api.stop();restarted=createLauncher({root:f.root,key,native,now:()=>clock});await restarted.start();assert.equal(restarted.publicPayload().items[0].newUntil,item.newUntil);
  fs.writeFileSync(path.join(f.desk,'App.lnk'),'fixture');await restarted.scan();assert.equal(restarted.publicPayload().items.find(entry=>entry.type==='app').newUntil,null);
 }finally{await restarted?.stop();await f.cleanup();}
});

test('Shell context payload allows only catalog IDs or the fixed desktop background; no paths or verbs',()=>{
 for(const good of [{action:'context',id:key},{action:'context',ids:[key,'b'.repeat(64)]},{action:'context',background:true}])assert(validAction(good));
 for(const bad of [{action:'context',path:'C:/Windows'},{action:'context',id:key,verb:'delete'},{action:'context',id:key,background:true},{action:'context',ids:[]},{action:'context',ids:[key,key]},{action:'context',background:false},{action:'context',id:'../file'}])assert.equal(!!validAction(bad),false);
});
test('Shell menu resolves apps, game shortcuts, files and folders privately without opening them',async()=>{
 const menus=[],f=fixture(undefined,{contextMenu:async request=>menus.push(request)});try{
  for(const name of ['App.lnk','Game.url','note.txt'])fs.writeFileSync(path.join(f.desk,name),'fixture');fs.mkdirSync(path.join(f.desk,'Folder'));await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});
  const entries=f.api.publicPayload().items;for(const item of entries){const result=await f.api.action({action:'context',id:item.id});assert.equal(result.version,1);}assert.equal(menus.length,4);
  for(const request of menus){assert.equal(request.folder,f.desk);assert.equal(request.paths.length,1);assert.equal(path.dirname(request.paths[0]),f.desk);assert.equal(request.background,false);}
  assert(!f.calls.some(c=>['open','reveal','move','recycle'].includes(c.mode)));
  await f.api.action({action:'context',ids:entries.slice(0,2).map(e=>e.id)});assert.equal(menus.at(-1).paths.length,2);
  await f.api.action({action:'context',background:true});assert.deepEqual(menus.at(-1),{paths:[],folder:f.desk,background:true});
 }finally{await f.cleanup();}
});
test('a replaced or unknown catalog item never reaches the Shell menu',async()=>{
 const menus=[],f=fixture(undefined,{contextMenu:async request=>menus.push(request)});try{
  const file=path.join(f.desk,'note.txt');fs.writeFileSync(file,'old');await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const id=f.api.publicPayload().items[0].id;
  fs.renameSync(file,file+'.old');fs.writeFileSync(file,'new');await assert.rejects(f.api.action({action:'context',id}));await assert.rejects(f.api.action({action:'context',id:'f'.repeat(64)}));assert.equal(menus.length,0);
 }finally{await f.cleanup();}
});

test('early logon retries Explorer initialization and reapplies saved launcher/icon settings',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const f=fixture({enabled:true,hideIcons:true,originalIconsVisible:true});
 try{
  fs.writeFileSync(path.join(f.desk,'new.txt'),'test');f.fail(true);
  await f.api.start();assert.equal(f.api.publicPayload().ready,false);
  f.fail(false);t.mock.timers.tick(15000);await new Promise(setImmediate);
  assert.equal(f.api.publicPayload().ready,true);assert.equal(f.api.publicPayload().enabled,true);
  assert.equal(f.api.publicPayload().items.length,1);assert.equal(f.visible(),false);
  assert.equal(f.calls.filter(c=>c.mode==='roots').length,2);
  await f.api.stop();assert.equal(f.visible(),true);
  const calls=f.calls.length;t.mock.timers.tick(30000);await new Promise(setImmediate);assert.equal(f.calls.length,calls);
 }finally{await f.cleanup();t.mock.timers.reset();}
});
test('batch payloads accept at most 100 distinct opaque IDs and reject mixed forms or extra flags',()=>{
 const ids=Array.from({length:100},(_,i)=>i.toString(16).padStart(64,'0'));for(const action of ['move','recycle']){const extra=action==='move'?{target:key}:{};assert(validAction({action,ids,...extra}));for(const bad of [[],[key,key],[...ids,'b'.repeat(64)],['C:/outside'],null])assert.equal(!!validAction({action,ids:bad,...extra}),false);assert.equal(!!validAction({action,ids:[key],id:key,...extra}),false);assert.equal(!!validAction({action,ids:[key],permanent:true,...extra}),false);}
});
test('batch move validates every file, moves all bytes and removes its private request manifest',async()=>{
 const f=fixture();try{for(const name of ['a.txt','b.txt'])fs.writeFileSync(path.join(f.desk,name),name);fs.mkdirSync(path.join(f.desk,'Folder'));await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const items=f.api.publicPayload().items,ids=items.filter(i=>i.type==='file').map(i=>i.id);const result=await f.api.action({action:'move',ids,target:items.find(i=>i.type==='folder').id});assert.deepEqual(result.operation,{completedIds:ids,failedIds:[]});for(const name of ['a.txt','b.txt'])assert.equal(fs.readFileSync(path.join(f.desk,'Folder',name),'utf8'),name);assert(!fs.existsSync(path.join(f.root,'companion/.launcher-file-request.json')));assert.equal(f.calls.filter(c=>c.mode==='move-batch').length,1);}finally{await f.cleanup();}
});
test('one collision or changed source refuses the entire batch before moving any file',async()=>{
 for(const changed of [false,true]){const f=fixture();try{for(const name of ['a.txt','b.txt'])fs.writeFileSync(path.join(f.desk,name),name);fs.mkdirSync(path.join(f.desk,'Folder'));await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const items=f.api.publicPayload().items,ids=items.filter(i=>i.type==='file').map(i=>i.id);if(changed)fs.writeFileSync(path.join(f.desk,'b.txt'),'changed');else fs.writeFileSync(path.join(f.desk,'Folder/b.txt'),'destination');await assert.rejects(f.api.action({action:'move',ids,target:items.find(i=>i.type==='folder').id}),{code:changed?'changed':'exists'});assert.equal(fs.readFileSync(path.join(f.desk,'a.txt'),'utf8'),'a.txt');assert(fs.existsSync(path.join(f.desk,'b.txt')));assert.equal(f.calls.filter(c=>c.mode==='move-batch').length,0);}finally{await f.cleanup();}}
});
test('batch recycle reports partial success precisely and keeps failed files available',async()=>{
 const f=fixture();try{for(const name of ['a.txt','b.txt'])fs.writeFileSync(path.join(f.desk,name),name);await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const ids=f.api.publicPayload().items.map(i=>i.id);f.batchLimit(1);const result=await f.api.action({action:'recycle',ids});assert.deepEqual(result.operation,{completedIds:[ids[0]],failedIds:[ids[1]]});assert.equal(result.items.length,1);assert.equal(result.items[0].id,ids[1]);assert.match(result.notice,/1 из 2/);assert.equal(fs.readFileSync(path.join(f.root,'recycled-a.txt'),'utf8'),'a.txt');assert.equal(fs.readFileSync(path.join(f.desk,'b.txt'),'utf8'),'b.txt');assert(!fs.existsSync(path.join(f.root,'companion/.launcher-file-request.json')));}finally{await f.cleanup();}
});
test('batch native failure and zero completion preserve every source and clean the manifest',async()=>{
 for(const throwing of [false,true]){const f=fixture();try{for(const name of ['a.txt','b.txt'])fs.writeFileSync(path.join(f.desk,name),name);await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const ids=f.api.publicPayload().items.map(i=>i.id);if(throwing)f.fail(true);else f.batchLimit(0);await assert.rejects(f.api.action({action:'recycle',ids}));assert.equal(f.api.publicPayload().items.length,2);for(const name of ['a.txt','b.txt'])assert.equal(fs.readFileSync(path.join(f.desk,name),'utf8'),name);assert(!fs.existsSync(path.join(f.root,'companion/.launcher-file-request.json')));}finally{await f.cleanup();}}
});
test('authenticated batch larger than 1KiB is accepted while bodies exceeding 8KiB are refused',async()=>{
 let calls=0;const handler=createHandler({key,launcher:{action:async()=>{calls++;return {ok:true};}}}),server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{const ids=Array.from({length:100},(_,i)=>i.toString(16).padStart(64,'0')),body=JSON.stringify({action:'recycle',ids});assert(body.length>1024);assert.equal((await fetch(url,{method:'POST',headers,body})).status,200);assert.equal((await fetch(url,{method:'POST',headers,body:' '.repeat(8193)})).status,413);assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://example.com'},body})).status,403);assert.equal(calls,1);}finally{await new Promise(r=>server.close(r));}
});
test('classification separates tools, VR and launchers from games and keeps unknown apps for review',()=>{
 for(const [name,ext,directory,group,section] of [['Blender 5.2.lnk','.lnk',false,'work',''],['Word.lnk','.lnk',false,'work',''],['Wallpaper Engine.url','.url',false,'tools',''],['Steam.lnk','.lnk',false,'leisure',''],['SteamVR.url','.url',false,'games','VR'],['Valheim Dedicated Server.url','.url',false,'games','Инструменты'],['Valheim.url','.url',false,'games',''],['Mystery.url','.url',false,'unsorted',''],['essay.docx','.docx',false,'files',''],['Project 2030','',true,'folders','']])assert.deepEqual(classify(name,ext,directory),{group,section});
});
test('launcher accepts identifiers and fixed settings, never client paths, commands or permanent deletion',()=>{
 for(const a of [{action:'open',id:key},{action:'assign',id:key,group:'work'},{action:'system',id:'recyclebin'},{action:'restore'},{action:'settings',enabled:true,hideIcons:true},{action:'recycle',id:key},{action:'move',id:key,target:key}])assert(validAction(a));
 for(const a of [null,[],{action:'open',path:'C:/Windows/calc.exe'},{action:'open',id:key,command:'calc'},{action:'delete',id:key},{action:'assign',id:key,group:'__proto__'},{action:'system',id:'cmd.exe'},{action:'settings',enabled:false,hideIcons:true}])assert.equal(!!validAction(a),false);
});
test('file drop moves one regular temporary file into a catalog folder and immediately refreshes the catalog',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'memo.txt'),'contents');fs.mkdirSync(path.join(f.desk,'Folder'));await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const items=f.api.publicPayload().items,file=items.find(i=>i.type==='file'),folder=items.find(i=>i.type==='folder');const result=await f.api.action({action:'move',id:file.id,target:folder.id});assert.equal(fs.readFileSync(path.join(f.desk,'Folder/memo.txt'),'utf8'),'contents');assert.equal(fs.existsSync(path.join(f.desk,'memo.txt')),false);assert(!result.items.some(i=>i.id===file.id));assert.match(result.notice,/перемещён/);}finally{await f.cleanup();}
});
test('recycle dispatches only the recycle operation and retains test bytes in its simulated bin',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'memo.txt'),'recyclable');await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const file=f.api.publicPayload().items[0];const result=await f.api.action({action:'recycle',id:file.id});assert.equal(fs.readFileSync(path.join(f.root,'test-recycled-file'),'utf8'),'recyclable');assert.equal(result.items.length,0);assert.equal(f.calls.filter(c=>c.mode==='recycle').length,1);assert.match(result.notice,/Корзину/);}finally{await f.cleanup();}
});
test('same-name collision never overwrites either file and never reaches the native mover',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'memo.txt'),'source');fs.mkdirSync(path.join(f.desk,'Folder'));fs.writeFileSync(path.join(f.desk,'Folder/memo.txt'),'destination');await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const items=f.api.publicPayload().items;await assert.rejects(f.api.action({action:'move',id:items.find(i=>i.type==='file').id,target:items.find(i=>i.type==='folder').id}),{code:'exists'});assert.equal(fs.readFileSync(path.join(f.desk,'memo.txt'),'utf8'),'source');assert.equal(fs.readFileSync(path.join(f.desk,'Folder/memo.txt'),'utf8'),'destination');assert.equal(f.calls.filter(c=>c.mode==='move').length,0);}finally{await f.cleanup();}
});
test('apps, folders, reassigned files and modified files cannot be recycled through temporary-file drop',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'Steam.lnk'),'app');fs.writeFileSync(path.join(f.desk,'memo.txt'),'source');fs.mkdirSync(path.join(f.desk,'Folder'));await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const items=f.api.publicPayload().items;for(const item of items.filter(i=>i.type!=='file'))await assert.rejects(f.api.action({action:'recycle',id:item.id}));const file=items.find(i=>i.type==='file');await f.api.action({action:'assign',id:file.id,group:'work'});await assert.rejects(f.api.action({action:'recycle',id:file.id}));await f.api.action({action:'assign',id:file.id,group:'files'});fs.writeFileSync(path.join(f.desk,'memo.txt'),'changed bytes');await assert.rejects(f.api.action({action:'recycle',id:file.id}));assert.equal(f.calls.filter(c=>c.mode==='recycle'||c.mode==='move').length,0);}finally{await f.cleanup();}
});
test('forged move paths, extra flags and permanent-delete requests are rejected',()=>{
 for(const value of [{action:'move',id:key,target:'C:/outside'},{action:'move',id:key,target:key,overwrite:true},{action:'recycle',id:key,permanent:true},{action:'delete',id:key}])assert.equal(!!validAction(value),false);
});
test('a catalog folder replaced by a junction cannot redirect a drop outside the desktop',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'memo.txt'),'source');const folderPath=path.join(f.desk,'Folder'),outside=path.join(f.root,'Outside');fs.mkdirSync(folderPath);fs.mkdirSync(outside);await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const items=f.api.publicPayload().items;fs.rmdirSync(folderPath);fs.symlinkSync(outside,folderPath,'junction');await assert.rejects(f.api.action({action:'move',id:items.find(i=>i.type==='file').id,target:items.find(i=>i.type==='folder').id}));assert.equal(fs.existsSync(path.join(f.desk,'memo.txt')),true);assert.equal(fs.readdirSync(outside).length,0);assert.equal(f.calls.filter(c=>c.mode==='move').length,0);}finally{await f.cleanup();}
});
test('native file-operation failure leaves the source and catalog untouched',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'memo.txt'),'source');await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const file=f.api.publicPayload().items[0];f.fail(true);await assert.rejects(f.api.action({action:'recycle',id:file.id}));assert.equal(fs.readFileSync(path.join(f.desk,'memo.txt'),'utf8'),'source');assert(f.api.publicPayload().items.some(i=>i.id===file.id));}finally{await f.cleanup();}
});
test('catalog scanning does not open or move files, hides Office locks, preserves real names and opaque paths',async()=>{
 const f=fixture();try{for(const name of ['Word.lnk','memo.txt','~$memo.docx','desktop.ini','unknown.cmd'])fs.writeFileSync(path.join(f.desk,name),'test');fs.mkdirSync(path.join(f.desk,'Project'));
 await f.api.start();const payload=f.api.publicPayload();assert.equal(payload.items.length,4);assert(payload.items.every(item=>/^[a-f0-9]{64}$/.test(item.id)&&!Object.hasOwn(item,'path')));assert(!JSON.stringify(payload).includes(f.desk));assert.equal(f.calls.filter(c=>c.mode==='open'||c.mode==='reveal'||c.mode==='icons-set').length,0);assert.equal(fs.readFileSync(path.join(f.desk,'memo.txt'),'utf8'),'test');
 }finally{await f.cleanup();}
});
test('manual assignment persists without moving files and newly created files appear after a scan',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'Mystery.lnk'),'x');await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const id=f.api.publicPayload().items[0].id;await f.api.action({action:'assign',id,group:'work'});await f.api.scan();assert.equal(f.api.publicPayload().items[0].group,'work');assert.equal(fs.existsSync(path.join(f.desk,'Mystery.lnk')),true);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'companion/.launcher-state.json'))).assignments[id],'work');fs.writeFileSync(path.join(f.desk,'new.png'),'x');await f.api.scan();assert.equal(f.api.publicPayload().items.length,2);
 }finally{await f.cleanup();}
});

test('category batches persist across scans and restart without filesystem moves or auto-classification overriding them',async()=>{
 const f=fixture();let restarted;try{
  for(const name of ['Word.lnk','Steam.lnk'])fs.writeFileSync(path.join(f.desk,name),'fixture');await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const ids=f.api.publicPayload().items.map(e=>e.id);
  await f.api.action({action:'assign',ids,group:'games'});await f.api.scan();assert(f.api.publicPayload().items.every(e=>e.group==='games'&&e.section===''));assert(!f.calls.some(c=>['move','move-batch','recycle','recycle-batch','open','reveal'].includes(c.mode)));
  const native=async mode=>mode==='roots'?{roots:[f.desk]}:mode==='icons-get'?{visible:true}:{};await f.api.stop();restarted=createLauncher({root:f.root,key,native});await restarted.start();assert(restarted.publicPayload().items.every(e=>e.group==='games'));for(const name of ['Word.lnk','Steam.lnk'])assert.equal(fs.readFileSync(path.join(f.desk,name),'utf8'),'fixture');
 }finally{await restarted?.stop();await f.cleanup();}
});

test('category batches validate every catalog ID before saving any assignment',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.desk,'Word.lnk'),'fixture');await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:false});const id=f.api.publicPayload().items[0].id,file=path.join(f.root,'companion/.launcher-state.json'),before=fs.readFileSync(file,'utf8');
  for(const body of [{action:'assign',ids:[id,id],group:'games'},{action:'assign',ids:[],group:'games'},{action:'assign',ids:[id],group:'__proto__'},{action:'assign',ids:[id],group:'games',path:'C:/fake'}]){assert.equal(!!validAction(body),false);await assert.rejects(f.api.action(body));}
  await assert.rejects(f.api.action({action:'assign',ids:[id,'f'.repeat(64)],group:'games'}));assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(f.api.publicPayload().items[0].group,'work');
 }finally{await f.cleanup();}
});
test('hide, restore and stopped companion return the original native icon visibility',async()=>{
 const f=fixture();try{await f.api.start();await f.api.action({action:'settings',enabled:true,hideIcons:true});assert.equal(f.visible(),false);await f.api.action({action:'restore'});assert.equal(f.visible(),true);assert.equal(f.api.publicPayload().enabled,false);await f.api.action({action:'settings',enabled:true,hideIcons:true});await f.api.stop();assert.equal(f.visible(),true);
 }finally{await f.cleanup();}
});
test('explicit desktop return overrides an old hidden baseline and shutdown keeps icons visible',async()=>{
 for(const hideIcons of [false,true]){
  const f=fixture({enabled:true,hideIcons,originalIconsVisible:false,assignments:{[key]:'work'}});
  try{
   await f.api.start();const before=JSON.parse(fs.readFileSync(path.join(f.root,'companion/.launcher-state.json')));
   await f.api.showIcons();assert.equal(f.visible(),true);await f.api.stop();assert.equal(f.visible(),true);
   const after=JSON.parse(fs.readFileSync(path.join(f.root,'companion/.launcher-state.json')));
   assert.deepEqual(after,{...before,originalIconsVisible:true},'Only the explicitly requested visible desktop baseline changes');
  }finally{await f.cleanup();}
 }
});
test('failed desktop restoration keeps the saved baseline and can be retried',async()=>{
 const f=fixture({enabled:true,hideIcons:true,originalIconsVisible:false});
 try{await f.api.start();f.fail(true);await assert.rejects(f.api.showIcons());assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'companion/.launcher-state.json'))).originalIconsVisible,false);f.fail(false);await f.api.showIcons();await f.api.stop();assert.equal(f.visible(),true);}finally{await f.cleanup();}
});
test('late launcher startup cannot hide icons after an explicit desktop return',async()=>{
 const f=fixture({enabled:true,hideIcons:true,originalIconsVisible:false});let api,release,visible=false;const writes=[];
 try{
  fs.writeFileSync(path.join(f.desk,'synthetic.lnk'),'fixture');
  const extracting=new Promise(resolve=>{release=resolve;});
  api=createLauncher({root:f.root,key,native:async(mode,env={})=>{
   if(mode==='roots')return {roots:[f.desk]};if(mode==='icons-get')return {visible};
   if(mode==='icons')return extracting;
   if(mode==='icons-set'){visible=env.VG_LAUNCH_VISIBLE==='true';writes.push(visible);return {visible};}return {};
  }});
  const starting=api.start();await new Promise(setImmediate);await api.showIcons();assert.equal(visible,true);
  release({});await starting;await api.stop();assert.equal(visible,true);assert(writes.every(Boolean),'All late writes respect the desktop-return intent');
 }finally{release?.({});await api?.stop();await f.cleanup();}
});
test('native acknowledgment without restored visibility cannot commit a visible baseline',async()=>{
 const f=fixture({enabled:true,hideIcons:false,originalIconsVisible:false});
 try{
  const api=createLauncher({root:f.root,key,native:async()=>({visible:false})});await assert.rejects(api.showIcons(),/visibility not confirmed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'companion/.launcher-state.json'))).originalIconsVisible,false);await api.stop();
 }finally{await f.cleanup();}
});
test('unknown identifiers, disabled catalog and removed files cannot launch; scripts reveal instead of execute',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.desk,'file.cmd'),'x');await f.api.start();const id=f.api.publicPayload().items[0].id;await assert.rejects(f.api.action({action:'open',id}));await f.api.action({action:'settings',enabled:true,hideIcons:false});await assert.rejects(f.api.action({action:'open',id:key}));await f.api.action({action:'open',id});assert.equal(f.calls.at(-1).mode,'reveal');fs.unlinkSync(path.join(f.desk,'file.cmd'));await assert.rejects(f.api.action({action:'open',id}));
 }finally{await f.cleanup();}
});
test('failed native setting never commits a successful hide/enable state',async()=>{const f=fixture();try{await f.api.start();f.fail(true);await assert.rejects(f.api.action({action:'settings',enabled:true,hideIcons:true}));assert.equal(f.api.publicPayload().enabled,false);assert.equal(f.api.publicPayload().hideIcons,false);}finally{await f.cleanup();}});
test('real image previews stay private, include dimensions and are never accepted for executable files',async()=>{
 const f=fixture();let api;try{
  fs.writeFileSync(path.join(f.desk,'photo.png'),'test');fs.writeFileSync(path.join(f.desk,'tool.cmd'),'test');
  const native=async(mode,env)=>{if(mode==='roots')return {roots:[f.desk]};if(mode==='icons-get')return {visible:true};if(mode==='icons'){return Object.fromEntries(JSON.parse(fs.readFileSync(env.VG_LAUNCH_MANIFEST,'utf8')).map(e=>[e.id,{icon:{png:'AAAA',width:256,height:256},thumbnail:{png:'AAAA',width:384,height:216}}]));}return {};};
  api=createLauncher({root:f.root,key,native});await api.start();const payload=api.publicPayload(),photo=payload.items.find(i=>i.name==='photo.png'),command=payload.items.find(i=>i.name==='tool.cmd');
  assert.equal(photo.thumbnail,'data:image/png;base64,AAAA');assert.equal(photo.thumbnailWidth,384);assert.equal(photo.iconWidth,256);assert.equal(command.thumbnail,null);assert(!JSON.stringify(payload).includes(f.desk));
 }finally{await api?.stop();await f.cleanup();}
});
test('catalog GET needs the same local capability as launch; foreign origins and arbitrary payloads never dispatch',async()=>{
 let calls=0;const launcher={publicPayload:()=>({version:1,privateName:'not-public'}),action:async()=>{calls++;return {ok:true};}},handler=createHandler({key,launcher}),server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(url)).status,403);assert.equal((await fetch(url,{headers:{...headers,Origin:'https://example.com'}})).status,403);assert.equal((await fetch(url,{headers})).status,200);for(const body of ['{}','x'.repeat(1025),JSON.stringify({action:'open',path:'C:/Windows/calc.exe'})])assert([400,413].includes((await fetch(url,{method:'POST',headers,body})).status));assert.equal(calls,0);assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'system',id:'thispc'})})).status,200);assert.equal(calls,1);}finally{await new Promise(r=>server.close(r));}
});
