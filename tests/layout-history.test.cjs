'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const M=require('../runtime/wallpaper/widget-model.js'),{createStore}=require('../runtime/companion/layouts.cjs'),{createSession}=require('../runtime/wallpaper/layout-client.js');
function disk(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pg-history-test-'));t.after(()=>{for(const name of ['layouts.json','layouts.json.tmp'])fs.rmSync(path.join(dir,name),{force:true});fs.rmdirSync(dir);});return path.join(dir,'layouts.json');}
function memory(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),values};}
function transport(store,calls=[]){return async(method,body)=>{calls.push({method,body:M.clone(body)});try{const document=method==='GET'?store.get(body.theme,body.profile):method==='POST'?store.initialize(body):store.update(body);return {status:document?200:404,document};}catch(error){return {status:error.status||400,document:error.document};}};}
function setup(t,options={}){const store=createStore(disk(t)),calls=[],storage=memory(),request=transport(store,calls);return {store,calls,storage,request,session:createSession({theme:'paper-green',profile:'display-1',storage,request,...options})};}
const other=(store,options={})=>createSession({theme:'paper-green',profile:'display-1',storage:memory(),request:transport(store),...options});
const layout=store=>store.get('paper-green','display-1');

test('one action groups multiple widgets and normalized fields into one durable undo/redo step',async t=>{
 const {session:s,store,calls}=setup(t);await s.sync();const before=s.get();let event;s.subscribe(value=>event=value);
 await s.update({clock:{x:800,y:100,scale:1.1},weather:{visible:false}});assert.deepEqual(s.history(),{canUndo:true,canRedo:false,undoCount:1,redoCount:0});assert.equal(event.history.undoCount,1);
 const after=s.get();assert.equal((await s.undo()).ok,true);assert.deepEqual(layout(store).widgets,before.widgets);assert.deepEqual(s.history(),{canUndo:false,canRedo:true,undoCount:0,redoCount:1});
 assert.equal((await s.redo()).ok,true);assert.deepEqual(layout(store).widgets,after.widgets);assert.equal(s.status(),'saved');
 const patches=calls.filter(call=>call.method==='PATCH');assert.equal(patches.length,3);assert.equal(new Set(patches.map(call=>call.body.operationId)).size,3);for(const {body}of patches)assert.deepEqual(Object.keys(body).sort(),['changes','operationId','profile','revision','theme']);
 event.history.undoCount=999;assert.equal(s.history().undoCount,1);
});

test('no-op updates and reset do not write, create steps or discard redo',async t=>{
 const {session:s,calls}=setup(t);await s.sync();let count=calls.length;await s.reset();await s.update({clock:{x:s.get().widgets.clock.x,visible:true}});assert.equal(calls.length,count);assert.equal(s.history().undoCount,0);
 await s.update({clock:{visible:false}});await s.undo();count=calls.length;await s.update({clock:{visible:true}});await s.reset();assert.equal(calls.length,count);assert.equal(s.history().redoCount,1);assert.equal((await s.redo()).ok,true);
 const next=s.get();await s.update({clock:{x:next.widgets.clock.x},weather:{visible:false}});const last=calls.filter(call=>call.method==='PATCH').at(-1);assert.deepEqual(last.body.changes,{weather:{visible:false}});
});

test('history is limited to 50 actions and a new edit discards redo',async t=>{
 const {session:s}=setup(t);await s.sync();for(let index=0;index<55;index++)await s.update({clock:{x:900-index}});assert.equal(s.history().undoCount,50);
 for(let index=0;index<50;index++)assert.equal((await s.undo()).ok,true);assert.equal(s.get().widgets.clock.x,896);assert.equal(s.history().redoCount,50);assert.equal((await s.undo()).reason,'empty');
 await s.update({weather:{visible:false}});assert.equal(s.history().redoCount,0);assert.equal((await s.redo()).reason,'empty');
});

test('history is session-only and independent for all theme/profile combinations',async t=>{
 const {store}=setup(t),sessions=[];for(const theme of M.themes)for(const profile of M.profiles){const s=other(store,{theme,profile});await s.sync();await s.update({clock:{visible:false}});sessions.push(s);}
 await sessions[0].undo();assert.equal(sessions[0].history().redoCount,1);for(const s of sessions.slice(1)){assert.equal(s.history().undoCount,1);assert.equal(s.get().widgets.clock.visible,false);}
 const restarted=other(store);await restarted.sync();assert.equal(restarted.history().undoCount,0);assert.equal(restarted.history().redoCount,0);assert.equal(restarted.get().widgets.clock.visible,true);
});

test('offline update, undo and redo stay durable without serializing the session history',async t=>{
 const {store,storage,request}=setup(t);let offline=false;const send=(...args)=>{if(offline)throw Error('Offline');return request(...args);};const s=createSession({theme:'paper-green',profile:'display-1',storage,request:send});await s.sync();offline=true;
 await s.update({clock:{visible:false}});assert.equal((await s.undo()).status,'local');assert.equal(s.get().widgets.clock.visible,true);assert.equal((await s.redo()).status,'local');assert.equal(s.get().widgets.clock.visible,false);assert.equal(s.history().undoCount,1);
 const serialized=[...storage.values.values()][0];assert(!serialized.includes('undoStack'));assert(!serialized.includes('redoStack'));offline=false;
 const restarted=createSession({theme:'paper-green',profile:'display-1',storage,request:send});assert.equal(restarted.history().undoCount,0);await restarted.sync();assert.equal(layout(store).widgets.clock.visible,false);assert.equal(restarted.status(),'saved');
});

test('refresh allows undo of own fields while preserving another window’s other fields',async t=>{
 const {session:a,store}=setup(t),b=other(store);await a.sync();await a.update({clock:{x:900}});await b.sync();await b.update({clock:{visible:false},weather:{x:200}});await a.refresh();assert.equal((await a.undo()).ok,true);
 assert.equal(layout(store).widgets.clock.x,1310);assert.equal(layout(store).widgets.clock.visible,false);assert.equal(layout(store).widgets.weather.x,200);
});

test('refresh rejects an entire multi-field undo when one expected field was changed elsewhere',async t=>{
 const {session:a,store,calls}=setup(t);await a.sync();await a.update({clock:{x:900},weather:{visible:false}});const b=other(store);await b.sync();await b.update({clock:{x:700}});await a.refresh();const count=calls.length,result=await a.undo();
 assert.equal(result.ok,false);assert.equal(result.reason,'conflict');assert.match(result.message,/другом окне/);assert.equal(calls.length,count);assert.equal(layout(store).widgets.clock.x,700);assert.equal(layout(store).widgets.weather.visible,false);assert.equal(a.history().canUndo,false);assert.equal(a.history().canRedo,false);assert.match(a.state().historyError,/очищена/);
});

test('a CAS race discovered during undo never writes stale values over another window',async t=>{
 const {store,request}=setup(t);let racing=false;const b=other(store);const a=other(store,{request:async(method,body)=>{if(method==='PATCH'&&racing){racing=false;await b.update({clock:{x:700}});}return request(method,body);}});await a.sync();await a.update({clock:{x:900},weather:{visible:false}});await b.sync();racing=true;
 assert.equal((await a.undo()).reason,'conflict');assert.equal(layout(store).widgets.clock.x,700);assert.equal(layout(store).widgets.weather.visible,false);assert.equal(a.status(),'saved');assert.equal(a.state().pending,0);
});

test('redo is also guarded against changes discovered after its request starts',async t=>{
 const {store,request}=setup(t);let racing=false;const b=other(store),a=other(store,{request:async(method,body)=>{if(method==='PATCH'&&racing){racing=false;await b.update({clock:{x:700}});}return request(method,body);}});await a.sync();await a.update({clock:{x:900}});await a.undo();await b.sync();racing=true;
 assert.equal((await a.redo()).reason,'conflict');assert.equal(layout(store).widgets.clock.x,700);assert.equal(a.history().undoCount,0);assert.equal(a.history().redoCount,0);
});

test('an undo retries a CAS race on unrelated fields and preserves both changes',async t=>{
 const {store,request}=setup(t);let racing=false;const b=other(store),a=other(store,{request:async(method,body)=>{if(method==='PATCH'&&racing){racing=false;await b.update({weather:{visible:false}});}return request(method,body);}});await a.sync();await a.update({clock:{x:900}});await b.sync();racing=true;
 assert.equal((await a.undo()).ok,true);assert.equal(layout(store).widgets.clock.x,1310);assert.equal(layout(store).widgets.weather.visible,false);assert.equal(a.history().redoCount,1);
});

test('a later edit queued during a conflicting undo still reaches durable storage',async t=>{
 const {store,request}=setup(t);let block=false,release,started;const waiting=new Promise(resolve=>started=resolve),b=other(store),a=other(store,{request:async(method,body)=>{if(method==='PATCH'&&block){block=false;started();await new Promise(resolve=>release=resolve);}return request(method,body);}});await a.sync();await a.update({clock:{x:900}});await b.sync();block=true;const undo=a.undo();await waiting;const update=a.update({mouse:{visible:false}});await b.update({clock:{x:700}});release();await Promise.all([undo,update]);
 assert.equal((await undo).reason,'conflict');assert.equal(layout(store).widgets.clock.x,700);assert.equal(layout(store).widgets.mouse.visible,false);assert.equal(a.state().pending,0);assert.equal(a.status(),'saved');
});

test('reset is one undoable action and undo only restores fields changed by that reset',async t=>{
 const {session:a,store}=setup(t);await a.sync();await a.update({clock:{x:900},scene:{visible:false},launcher:{x:60}});const before=a.get();await a.reset();assert.equal(a.history().undoCount,2);const b=other(store);await b.sync();await b.update({weather:{visible:false}});await a.refresh();await a.undo();
 assert.equal(layout(store).widgets.clock.x,before.widgets.clock.x);assert.equal(layout(store).widgets.scene.visible,false);assert.equal(layout(store).widgets.launcher.x,60);assert.equal(layout(store).widgets.weather.visible,false);
});

test('a stale reset is rejected atomically instead of resetting a foreign field outside its undo entry',async t=>{
 const {store,request}=setup(t);let racing=false;const b=other(store),a=other(store,{request:async(method,body)=>{if(method==='PATCH'&&body.reset&&racing){racing=false;await b.update({weather:{visible:false}});}return request(method,body);}});await a.sync();await a.update({clock:{x:900}});await b.sync();racing=true;
 const result=await a.reset();assert.equal(result.ok,false);assert.equal(result.reason,'conflict');assert.match(result.message,/Сброс отменён/);assert.equal(layout(store).widgets.clock.x,900);assert.equal(layout(store).widgets.weather.visible,false);assert.equal(a.state().pending,0);assert.equal(a.history().undoCount,0);assert.equal((await a.undo()).reason,'empty');
 // Retrying from the now-current layout captures both real before-values in one step.
 assert.equal((await a.reset()).ok,true);assert.equal(layout(store).widgets.clock.x,1310);assert.equal(layout(store).widgets.weather.visible,true);assert.equal(a.history().undoCount,1);await a.undo();assert.equal(layout(store).widgets.clock.x,900);assert.equal(layout(store).widgets.weather.visible,false);
});

test('an offline reset guard survives restart and cannot reset a later foreign edit',async t=>{
 const {store,storage,request}=setup(t);let offline=false;const a=other(store,{storage,request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await a.sync();await a.update({clock:{x:900}});offline=true;assert.equal((await a.reset()).status,'local');const b=other(store);await b.sync();await b.update({weather:{visible:false}});const before=layout(store);
 const restarted=other(store,{storage});await restarted.sync();assert.equal(restarted.status(),'saved');assert.equal(restarted.state().pending,0);assert.match(restarted.state().historyError,/Сброс отменён/);assert.deepEqual(layout(store),before);
});

test('lost undo acknowledgement is resolved by receipt after restart without erasing a later foreign edit',async t=>{
 const {store,storage,request}=setup(t);let lose=false;const a=other(store,{storage,request:async(...args)=>{const response=await request(...args);if(lose&&args[0]==='PATCH'){lose=false;throw Error('Lost response');}return response;}});await a.sync();await a.update({clock:{x:900}});lose=true;assert.equal((await a.undo()).status,'local');
 const b=other(store);await b.sync();await b.update({clock:{x:700},weather:{visible:false}});const revision=layout(store).revision;
 const restarted=other(store,{storage});await restarted.sync();assert.equal(restarted.status(),'saved');assert.equal(restarted.state().pending,0);assert.equal(layout(store).revision,revision);assert.equal(layout(store).widgets.clock.x,700);assert.equal(layout(store).widgets.weather.visible,false);
});

test('an offline undo is cancelled on recovery if a foreign edit changed its expected field',async t=>{
 const {store,request}=setup(t);let offline=false;const a=other(store,{request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await a.sync();await a.update({clock:{x:900}});offline=true;assert.equal((await a.undo()).status,'local');const b=other(store);await b.sync();await b.update({clock:{x:700}});offline=false;await a.sync();
 assert.equal(layout(store).widgets.clock.x,700);assert.equal(a.get().widgets.clock.x,700);assert.equal(a.history().canRedo,false);assert.match(a.state().historyError,/другом окне/);assert.equal(a.state().pending,0);
});

test('undo refuses a normalized restoration that would alter an unrelated foreign coordinate',async t=>{
 const {session:a,store}=setup(t);await a.sync();await a.update({clock:{x:800,scale:.65}});const b=other(store);await b.sync();await b.update({clock:{y:900}});await a.refresh();const before=layout(store);assert.equal((await a.undo()).reason,'conflict');assert.deepEqual(layout(store),before);
});

test('preview emits a draft without cache, history or HTTP writes; cancel leaves the original intact',async t=>{
 const {session:s,calls,storage}=setup(t);await s.sync();const before=s.get(),serialized=[...storage.values.values()][0],count=calls.length;let event;s.subscribe(value=>event=value);
 s.preview({clock:{x:900}});s.preview({clock:{y:100}});assert.equal(s.get().widgets.clock.x,900);assert.equal(s.get().widgets.clock.y,100);assert.equal(event.preview,true);assert.equal(event.history.undoCount,0);assert.equal(calls.length,count);assert.equal([...storage.values.values()][0],serialized);
 s.cancelPreview();assert.equal(event.preview,false);assert.deepEqual(s.get(),before);assert.equal(s.history().undoCount,0);assert.equal(calls.length,count);
});

test('preview commit counts as one action and undo restores the original, not the preview',async t=>{
 const {session:s,store,calls}=setup(t);await s.sync();const before=s.get(),count=calls.length;s.preview({scene:{x:500,y:40,scale:.8}});const expected=s.get().widgets.scene;await s.update({scene:{x:500,y:40,scale:.8}});assert.equal(s.state().preview,false);assert.equal(s.history().undoCount,1);assert.deepEqual(layout(store).widgets.scene,expected);assert.equal(calls.length,count+1);
 await s.undo();assert.deepEqual(layout(store).widgets.scene,before.widgets.scene);
});

test('a rejected edit leaves the emitted preview, history and cache consistently unchanged',async t=>{
 const {session:s,calls,storage}=setup(t);await s.sync();s.preview({clock:{x:800}});let last;s.subscribe(value=>last=value);const before=s.state(),cached=[...storage.values.values()][0],count=calls.length;
 assert.throws(()=>s.update({clock:{x:NaN}}));assert.deepEqual(s.state(),before);assert.deepEqual(last,before);assert.equal([...storage.values.values()][0],cached);assert.equal(calls.length,count);s.cancelPreview();assert.equal(last.preview,false);assert.equal(s.get().widgets.clock.x,1310);
});

test('a full offline queue rejects edits and undo without silently clearing the emitted preview',async t=>{
 const {store,request,storage}=setup(t);let offline=false;const s=other(store,{storage,request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await s.sync();offline=true;for(let index=0;index<128;index++)await s.update({clock:{x:800+index%2}});assert.equal(s.state().pending,128);s.preview({clock:{x:700}});let last;s.subscribe(value=>last=value);const before=s.state(),cached=[...storage.values.values()][0];
 assert.throws(()=>s.update({weather:{visible:false}}),/несохранённых/);assert.deepEqual(s.state(),before);assert.deepEqual(last,before);assert.throws(()=>s.undo(),/несохранённых/);assert.deepEqual(s.state(),before);assert.deepEqual(last,before);assert.equal([...storage.values.values()][0],cached);
});

test('a new revision cancels an ephemeral preview and restarting never restores it',async t=>{
 const {session:a,store,storage,request}=setup(t);await a.sync();a.preview({clock:{x:900}});const restarted=other(store,{storage,request});assert.equal(restarted.get().widgets.clock.x,1310);const b=other(store);await b.sync();await b.update({weather:{visible:false}});await a.refresh();assert.equal(a.state().preview,false);assert.equal(a.get().widgets.clock.x,1310);assert.equal(a.get().widgets.weather.visible,false);assert.equal(a.history().undoCount,0);
});

test('browser PGLayouts exposes the contract and profile switches cancel drafts but retain separate histories',async t=>{
 const {store}=setup(t),storage=memory(),events=new Map(),send=transport(store);const context={PGWidgetModel:M,PG_APP:true,console,crypto:globalThis.crypto,URLSearchParams,AbortSignal,localStorage:storage,location:{pathname:'/index.html'},setInterval(){},addEventListener:(type,handler)=>events.set(type,handler),fetch:async(url,options)=>{const query=new URL(url,'http://localhost').searchParams,body=options.method==='GET'?{theme:query.get('theme'),profile:query.get('profile')}:JSON.parse(options.body),response=await send(options.method,body);return {status:response.status,json:async()=>({document:response.document})};}};context.window=context;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../runtime/wallpaper/layout-client.js'),'utf8'),context);
 const api=context.PGLayouts;assert.equal((await api.undo()).reason,'empty');const first=api.activate('display-1');await first.sync();await api.update({clock:{visible:false}});api.preview({clock:{x:900}});const second=api.activate('display-2');await second.sync();assert.equal(first.state().preview,false);assert.equal(api.history().undoCount,0);await api.update({weather:{visible:false}});api.activate('display-1');assert.equal(api.history().undoCount,1);assert.equal(api.current().widgets.clock.x,1310);assert.equal(api.current().widgets.weather.visible,true);let event;api.subscribe(value=>event=value);api.preview({clock:{x:800}});assert.equal(event.preview,true);assert.equal((await api.undo()).ok,true);assert.equal(api.current().widgets.clock.visible,true);assert.equal(second.get().widgets.weather.visible,false);
});
