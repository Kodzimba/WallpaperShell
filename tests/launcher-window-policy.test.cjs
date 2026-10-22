'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createOverlay,validRequest,validSurface}=require('../runtime/companion/launcher-overlay.cjs');
const {createHandler}=require('../runtime/companion/launcher.cjs');
const key='b'.repeat(64),id='a'.repeat(32),tick=()=>new Promise(r=>setImmediate(r));
const surface={surfaceId:'surface-1',monitorId:'\\\\.\\DISPLAY2',ownerHandle:'345678',bounds:{x:-2560,y:0,width:2560,height:1440},profile:'display-1'};
const open={action:'open',id,group:'work',profile:'display-1',width:2560,height:1440,rect:[.01,.08,.65,.9],trigger:[.01,.08,.3,.14],position:{x:24,y:80},surface};
function request(handler,body,method='POST'){
 return new Promise(resolve=>{const req=new EventEmitter();req.method=method;req.headers={'x-violetghost-action':'desktop','x-violetghost-key':key,'content-type':'application/json',origin:'null'};
  const res={status:0,setHeader(){},writeHead(status){this.status=status;return this;},end(value){resolve({status:this.status,value:value?JSON.parse(value):null});}};
  handler(req,res);if(method==='POST'){req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');}
 });
}
function setup({cold=false,shellAuto=true,getMenuMode=()=> 'dark'}={}){
 let proc,finishCompile;const commands=[],windows=[];
 const overlay=createOverlay({root:process.cwd(),enabled:()=>true,key,getMenuMode,windowEvent:v=>{windows.push(v);if(v.type==='app-shell-request'&&shellAuto){if(v.action==='acquire')queueMicrotask(()=>{overlay.policy({type:'window-policy',event:'panel-close',sourceSurfaceId:v.surfaceId,kind:'launcher',reason:'replacement'});overlay.policy({type:'window-policy',event:'modal-state',blocked:true,kind:'shell',ownerSurfaceId:v.surfaceId});overlay.policy({type:'window-policy',event:'shell-result',requestId:v.requestId,ok:true,token:'11111111-2222-4333-8444-555555555555'});});else if(v.action==='release')overlay.policy({type:'window-policy',event:'modal-state',blocked:false});}},compileHost:cold?()=>new Promise(r=>finishCompile=r):async()=>'/test/host.exe',spawnHost:()=>{
  proc=new EventEmitter();proc.pid=12345;proc.stdin=new PassThrough();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.kill=()=>proc.emit('exit',0);
  proc.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n'))commands.push(JSON.parse(line));});return proc;
 }});
 overlay.policy({type:'window-policy',event:'surface',...surface});
 return {overlay,commands,windows,request:b=>request(overlay.handler,b),ready:async()=>{await tick();proc.stdout.write(JSON.stringify({type:'ready',handle:'98765'})+'\n');await tick();},emit:v=>proc.stdout.write(JSON.stringify(v)+'\n'),compile:()=>finishCompile('/test/host.exe'),exit:()=>proc.emit('exit',0)};
}
test('surface snapshot is strict, accepts negative monitor coordinates and binds profile and physical viewport',()=>{
 assert(validSurface(surface));assert(validRequest(open));assert(validRequest({...open,theme:'classic'}));
 for(const value of [{...surface,command:'x'},{...surface,ownerHandle:345678},{...surface,ownerHandle:'-1'},{...surface,bounds:{...surface.bounds,width:0}},{...surface,bounds:{...surface.bounds,path:'x'}},{...surface,profile:'display-3'}])assert.equal(validSurface(value),false);
 assert(validRequest({...open,surface:{...surface,profile:'display-2'}}));assert.equal(validRequest({...open,width:3840}),false);
});
test('external transition during cold startup cannot resurrect the menu; HWND registration lasts only for host lifetime',async()=>{
 const a=setup({cold:true}),pending=a.request(open);await tick();a.overlay.policy({type:'window-policy',event:'external'});a.compile();await a.ready();
 assert.deepEqual((await pending).value,{shown:false,topmost:false,positioned:false,blocked:true});assert(!a.commands.some(c=>c.action==='open'));
 assert.deepEqual(a.windows,[{type:'app-window',action:'register',pid:12345,handle:'98765'}]);a.exit();assert.equal(a.windows[1].action,'unregister');a.overlay.stop();
});
test('modal reservation invalidates an already prepared native open and a late shown response cannot paint fallback',async()=>{
 const a=setup(),pending=a.request(open);await a.ready();assert(a.commands.some(c=>c.action==='open'));
 a.overlay.policy({type:'window-policy',event:'modal-state',blocked:true});a.emit({type:'shown',id,visible:true,positioned:true,topmost:false});
 assert.equal((await pending).value.blocked,true);assert(a.commands.some(c=>c.action==='dismiss'));assert.equal((await a.request(open)).value.blocked,true);
 a.overlay.policy({type:'window-policy',event:'resume'});assert(a.overlay.blocked());a.overlay.policy({type:'window-policy',event:'modal-state',blocked:false});a.overlay.stop();a.exit();
});

test('a visible positioned popup is admitted in the normal window band without TopMost',async()=>{
 const a=setup(),pending=a.request(open);await a.ready();
 a.emit({type:'shown',id,visible:true,positioned:true,topmost:false});
 assert.deepEqual((await pending).value,{shown:true,topmost:false,positioned:true});
 a.overlay.stop();a.exit();
});

test('TopMost is not proof of a usable popup when positioning failed or visibility is false',async()=>{
 for(const status of [{visible:true,positioned:false,topmost:true},{visible:false,positioned:true,topmost:false}]){
  const a=setup(),pending=a.request(open);await a.ready();
  a.emit({type:'shown',id,...status});assert.equal((await pending).value.shown,false);
  a.overlay.stop();a.exit();
 }
});

test('a newly opened external browser invalidates a pending show even when native readiness arrives later',async()=>{
 const a=setup(),pending=a.request(open);await a.ready();
 a.overlay.policy({type:'window-policy',event:'external',reason:'window-shown'});
 a.emit({type:'shown',id,visible:true,positioned:true,topmost:false});
 assert.equal((await pending).value.blocked,true);assert(a.commands.some(c=>c.action==='dismiss'));
 a.overlay.stop();a.exit();
});
test('surface identity and geometry must match private metadata; reset invalidates stale snapshots',async()=>{
 const a=setup();assert.equal((await a.request({...open,surface:{...surface,ownerHandle:'777'}})).value.blocked,true);
 const pending=a.request(open);await a.ready();a.overlay.policy({type:'window-policy',event:'surface',...surface,bounds:{...surface.bounds,x:0}});assert.equal((await pending).value.blocked,true);
 assert.equal((await a.request(open)).value.blocked,true);a.overlay.policy({type:'window-policy',event:'reset',surfaceId:surface.surfaceId});assert.equal((await a.request(open)).value.blocked,true);a.overlay.stop();a.exit();
});
test('old hidden/close messages cannot close a new session, and another monitor suspension leaves it open',async()=>{
 const a=setup(),first=a.request(open);await a.ready();a.emit({type:'shown',id,visible:true,positioned:true,topmost:false});assert.equal((await first).value.shown,true);
 const nextId='c'.repeat(32),next=a.request({...open,id:nextId});await tick();a.emit({type:'hidden',id});await a.request({action:'close',id});a.overlay.policy({type:'window-policy',event:'suspend',surfaceId:'surface-2'});a.emit({type:'shown',id:nextId,visible:true,positioned:true,topmost:false});assert.equal((await next).value.shown,true);
 a.overlay.policy({type:'window-policy',event:'panel-close',sourceSurfaceId:surface.surfaceId,kind:'launcher'});assert.equal(a.commands.filter(c=>c.action==='dismiss').length,0);a.overlay.stop();a.exit();
});
test('inline Shell handshake survives own panel-close, then external cancel waits for the native acknowledgement',async()=>{
 const a=setup(),context=a.overlay.contextMenu({surfaceId:surface.surfaceId,paths:[],folder:'fixture',background:true}),rejected=assert.rejects(context);await a.ready();
 const native=a.commands.find(c=>c.action==='context');assert(native);assert(a.overlay.blocked());a.overlay.policy({type:'window-policy',event:'external'});await tick();assert(!a.windows.some(v=>v.action==='release'));
 a.emit({type:'context-result',id:native.id,ok:false});await rejected;assert(a.windows.some(v=>v.action==='release'));const next=a.request(open);await tick();a.emit({type:'shown',id,visible:true,positioned:true,topmost:false});assert.equal((await next).value.shown,true);a.overlay.stop();a.exit();
});
test('durable Shell invocation keeps global lease after Alt+Tab until real result or process exit',async()=>{
 const a=setup(),context=a.overlay.contextMenu({surfaceId:surface.surfaceId,paths:[],folder:'fixture',background:true});await a.ready();const native=a.commands.find(c=>c.action==='context');a.emit({type:'context-invoking',id:native.id});a.overlay.policy({type:'window-policy',event:'external'});await tick();assert(a.overlay.blocked());assert(!a.windows.some(v=>v.action==='release'));assert.equal((await a.request(open)).value.blocked,true);
 a.emit({type:'context-result',id:native.id,ok:true});await context;assert(!a.overlay.blocked());assert(a.windows.some(v=>v.action==='release'));a.overlay.stop();a.exit();
});

test('native Shell menu follows current trusted appearance on every invocation, including inline without an open popup',async()=>{
 let mode='dark';const a=setup({getMenuMode:()=>mode});
 for(const next of ['dark','light','dark']){
  mode=next;const pending=a.overlay.contextMenu({surfaceId:surface.surfaceId,paths:[],folder:'fixture',background:true,menuMode:'forged'});if(a.commands.some(c=>c.action==='context'))await tick();else await a.ready();
  const native=a.commands.filter(c=>c.action==='context').at(-1);assert.equal(native.menuMode,next);assert(a.overlay.blocked());a.emit({type:'context-result',id:native.id,ok:true});await pending;assert(!a.overlay.blocked());
 }
 a.overlay.stop();a.exit();
});
test('late Shell reservation after external cancellation is released without opening a host',async()=>{
 const a=setup({shellAuto:false}),context=a.overlay.contextMenu({surfaceId:surface.surfaceId,paths:[],folder:'fixture',background:true}),rejected=assert.rejects(context);const acquire=a.windows.find(v=>v.action==='acquire');a.overlay.policy({type:'window-policy',event:'external'});await rejected;
 a.overlay.policy({type:'window-policy',event:'shell-result',requestId:acquire.requestId,ok:true,token:'11111111-2222-4333-8444-555555555555'});assert(a.windows.some(v=>v.action==='release'));assert.equal(a.commands.length,0);a.overlay.stop();
});
test('inline Shell reservation is invalidated by its own reset, suspension or physical metadata change',async()=>{
 for(const change of [{event:'reset',surfaceId:surface.surfaceId},{event:'suspend',surfaceId:surface.surfaceId},{event:'surface',...surface,bounds:{...surface.bounds,x:0}}]){
  const a=setup({shellAuto:false}),context=a.overlay.contextMenu({surfaceId:surface.surfaceId,paths:[],folder:'fixture',background:true}),rejected=assert.rejects(context);const acquire=a.windows.find(v=>v.action==='acquire');a.overlay.policy({type:'window-policy',...change});await rejected;
  a.overlay.policy({type:'window-policy',event:'shell-result',requestId:acquire.requestId,ok:true,token:'11111111-2222-4333-8444-555555555555'});assert(a.windows.some(v=>v.action==='release'));assert.equal(a.commands.length,0);a.overlay.stop();
 }
});
test('launcher POST guard blocks conflicting commands while GET remains available and rechecks at dispatch',async()=>{
 let blocked=true,actions=0;const handler=createHandler({key,canAct:()=>!blocked,launcher:{publicPayload:()=>({ready:true}),action:async()=>{actions++;return {ok:true};}}});
 assert.equal((await request(handler,{action:'system',id:'thispc'})).status,409);assert.equal((await request(handler,null,'GET')).status,200);assert.equal(actions,0);blocked=false;assert.equal((await request(handler,{action:'system',id:'thispc'})).status,200);assert.equal(actions,1);
});
