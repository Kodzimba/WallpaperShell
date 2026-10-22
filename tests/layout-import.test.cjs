'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const M=require('../runtime/wallpaper/widget-model.js'),{createStore}=require('../runtime/companion/layouts.cjs'),{createSession}=require('../runtime/wallpaper/layout-client.js');
const editable=doc=>Object.fromEntries(Object.entries(doc.widgets).map(([id,w])=>[id,{x:w.x,y:w.y,scale:w.scale,visible:w.visible}]));
function memory(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),values};}
function transport(store,calls=[]){return async(method,body)=>{calls.push({method,body:M.clone(body)});try{const document=method==='GET'?store.get(body.theme,body.profile):method==='POST'?store.initialize(body):store.update(body);return {status:document?200:404,document};}catch(error){return {status:error.status||400,document:error.document};}};}
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pg-import-test-'));t.after(()=>{for(const name of ['layouts.json','layouts.json.tmp'])fs.rmSync(path.join(dir,name),{force:true});fs.rmdirSync(dir);});const file=path.join(dir,'layouts.json'),store=createStore(file),calls=[],request=transport(store,calls),storage=memory();return {file,store,calls,request,storage,session:createSession({theme:'paper-green',profile:'display-1',storage,request})};}
function session(store,options={}){return createSession({theme:'paper-green',profile:'display-1',storage:memory(),request:transport(store),...options});}
const layout=(store,theme='paper-green',profile='display-1')=>store.get(theme,profile);
const variant=doc=>editable(M.patch(doc,{clock:{x:900,y:100},weather:{visible:false},scene:{x:630,y:50,scale:.8},launcher:{x:64,y:120}}));

test('a complete import is one durable, undoable action and sends only the normal PATCH schema',async t=>{
 const {session:s,store,calls}=setup(t);await s.sync();const before=s.get(),widgets=variant(before),count=calls.length;
 assert.deepEqual(await s.replaceAll(widgets,{expected:before}),{ok:true,status:'saved'});assert.deepEqual(editable(layout(store)),widgets);assert.equal(s.history().undoCount,1);assert.equal(calls.length,count+1);
 const body=calls.at(-1).body;assert.deepEqual(Object.keys(body).sort(),['changes','operationId','profile','revision','theme']);assert(!Object.hasOwn(body.changes,'calendar'));assert(!JSON.stringify(body).includes('import'));
 assert.equal((await s.undo()).ok,true);assert.deepEqual(layout(store).widgets,before.widgets);assert.equal((await s.redo()).ok,true);assert.deepEqual(editable(layout(store)),widgets);assert.equal(s.history().undoCount,1);
});

test('portable widget values can be applied to another profile without changing its scope or other profiles',async t=>{
 const {session:a,store}=setup(t);await a.sync();await a.replaceAll(variant(a.get()));const source=a.get(),destination=session(store,{profile:'display-2'});await destination.sync();const before=destination.get();
 assert.equal((await destination.replaceAll(editable(source),{expected:before})).ok,true);assert.deepEqual(editable(layout(store,'paper-green','display-2')),editable(source));assert.equal(destination.get().profile,'display-2');assert.equal(destination.get().revision,2);assert.deepEqual(layout(store),source);
});

test('no-op import leaves history, redo and requests intact',async t=>{
 const {session:s,calls}=setup(t);await s.sync();await s.update({weather:{visible:false}});await s.undo();const count=calls.length,history=s.history(),before=s.get();s.preview({clock:{x:800}});
 assert.equal((await s.replaceAll(editable(before),{expected:before})).ok,true);assert.equal(s.state().preview,false);assert.equal(calls.length,count);assert.deepEqual(s.history(),history);assert.equal((await s.redo()).ok,true);
});

test('malformed, partial and normalizing imports leave preview, queue, cache and history unchanged',async t=>{
 const {session:s,calls,storage}=setup(t);await s.sync();s.preview({clock:{x:800}});const before=s.state(),cached=[...storage.values.values()][0],count=calls.length;
 const full=editable(M.create('paper-green','display-1')),partial=M.clone(full);delete partial.weather;
 const inputs=[null,[],{},partial,{...full,unknown:{x:0,y:0,scale:1,visible:true}},{...full,clock:{...full.clock,type:'clock'}},{...full,clock:{x:0}},{...full,clock:{...full.clock,x:-1}},{...full,clock:{...full.clock,x:NaN}},{...full,clock:{...full.clock,visible:'true'}},{...full,launcher:{...full.launcher,scale:1.1}}];
 for(const widgets of inputs){assert.equal((await s.replaceAll(widgets)).reason,'invalid');assert.deepEqual(s.state(),before);assert.equal(calls.length,count);assert.equal([...storage.values.values()][0],cached);}
 assert.equal((await s.replaceAll(full,{expected:{}})).reason,'invalid');assert.equal((await s.replaceAll(full,{unexpected:true})).reason,'invalid');assert.deepEqual(s.state(),before);
});

test('a layout change after file selection rejects apply before enqueue and preserves the new edit',async t=>{
 const {session:s,calls,storage,store}=setup(t);await s.sync();const captured=s.get(),widgets=variant(captured);await s.update({mouse:{visible:false}});const count=calls.length,cached=[...storage.values.values()][0],before=layout(store),history=s.history();
 const result=await s.replaceAll(widgets,{expected:captured});assert.equal(result.reason,'conflict');assert.match(result.message,/после выбора файла/);assert.match(s.state().historyError,/Импорт отменён/);assert.equal(calls.length,count);assert.equal([...storage.values.values()][0],cached);assert.deepEqual(layout(store),before);assert.deepEqual(s.history(),history);
});

test('revision changes with identical values still invalidate a captured file selection',async t=>{
 const {session:s,calls}=setup(t);await s.sync();const captured=s.get();await s.update({mouse:{visible:false}});await s.undo();assert.deepEqual(s.get().widgets,captured.widgets);const count=calls.length;
 assert.equal((await s.replaceAll(variant(captured),{expected:captured})).reason,'conflict');assert.equal(calls.length,count);
});

test('wrong captured theme or profile cannot target the current session',async t=>{
 const {session:s,calls}=setup(t);await s.sync();const count=calls.length,before=s.state();
 for(const expected of [M.create('paper-green','display-2'),M.create('classic','display-1')]){const result=await s.replaceAll(variant(s.get()),{expected});assert.equal(result.reason,'scope');assert.match(result.message,/другая тема|другой экран/);}
 assert.deepEqual(s.state(),before);assert.equal(calls.length,count);
});

test('a competing change to a field outside the import diff rejects the entire CAS import',async t=>{
 const {store,request}=setup(t),b=session(store);let race=false;const a=session(store,{request:async(method,body)=>{if(method==='PATCH'&&race){race=false;await b.update({mouse:{visible:false}});}return request(method,body);}});await a.sync();await b.sync();const before=a.get();race=true;
 const result=await a.replaceAll(variant(before),{expected:before});assert.equal(result.reason,'conflict');assert.match(result.message,/Импорт отменён/);assert.equal(a.state().pending,0);assert.equal(a.status(),'saved');assert.equal(a.history().undoCount,0);assert.equal(layout(store).revision,2);assert.equal(layout(store).widgets.clock.x,before.widgets.clock.x);assert.equal(layout(store).widgets.weather.visible,true);assert.equal(layout(store).widgets.mouse.visible,false);
});

test('an offline import survives restart, reaches disk once and keeps the guard off the wire',async t=>{
 const {store,request,storage,file}=setup(t);let offline=false;const a=session(store,{storage,request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await a.sync();const before=a.get(),widgets=variant(before);offline=true;
 assert.equal((await a.replaceAll(widgets,{expected:before})).status,'local');assert.equal(a.state().pending,1);assert.equal(a.history().undoCount,1);assert.equal(layout(store).revision,1);
 const cached=JSON.parse([...storage.values.values()][0]);assert.equal(cached.pending[0].import,true);assert.equal(Object.keys(cached.pending[0].guard).length,Object.keys(before.widgets).length);
 const restartedStore=createStore(file),calls=[],restarted=session(restartedStore,{storage,request:transport(restartedStore,calls)});assert.equal(restarted.history().undoCount,0);await restarted.sync();assert.equal(restarted.status(),'saved');assert.deepEqual(editable(layout(restartedStore)),widgets);assert.equal(layout(restartedStore).revision,2);assert.equal(calls.filter(c=>c.method==='PATCH').length,1);assert(!Object.hasOwn(calls.at(-1).body,'guard'));
});

test('an offline imported snapshot never overwrites a later foreign edit after restart',async t=>{
 const {store,request,storage}=setup(t);let offline=false;const a=session(store,{storage,request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await a.sync();offline=true;await a.replaceAll(variant(a.get()));const b=session(store);await b.sync();await b.update({mouse:{visible:false}});const before=layout(store);
 const restarted=session(store,{storage});await restarted.sync();assert.equal(restarted.state().pending,0);assert.match(restarted.state().historyError,/Импорт отменён/);assert.deepEqual(layout(store),before);assert.deepEqual(restarted.get(),before);
});

test('lost import acknowledgement uses the receipt after restart and preserves subsequent foreign changes',async t=>{
 const {store,request,storage}=setup(t);let lose=false;const a=session(store,{storage,request:async(...args)=>{const response=await request(...args);if(lose&&args[0]==='PATCH'){lose=false;throw Error('Lost response');}return response;}});await a.sync();const widgets=variant(a.get());lose=true;assert.equal((await a.replaceAll(widgets)).status,'local');assert.deepEqual(editable(layout(store)),widgets);
 const b=session(store);await b.sync();await b.update({clock:{x:700},mouse:{visible:false}});const before=layout(store),restarted=session(store,{storage});await restarted.sync();assert.equal(restarted.status(),'saved');assert.equal(restarted.state().pending,0);assert.deepEqual(layout(store),before);assert.deepEqual(restarted.get(),before);assert.equal(restarted.state().historyError,'');
});

test('an imported action can be undone offline and redone after the queue reaches disk',async t=>{
 const {store,request}=setup(t);let offline=false;const a=session(store,{request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await a.sync();const before=a.get(),widgets=variant(before);offline=true;await a.replaceAll(widgets);assert.equal((await a.undo()).status,'local');assert.deepEqual(a.get().widgets,before.widgets);offline=false;await a.sync();assert.deepEqual(layout(store).widgets,before.widgets);assert.equal((await a.redo()).ok,true);assert.deepEqual(editable(layout(store)),widgets);
});

test('import follows existing offline edits in order and undo restores their observed values',async t=>{
 const {store,request}=setup(t);let offline=false;const a=session(store,{request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await a.sync();offline=true;await a.update({clock:{x:1000},mouse:{visible:false}});const before=a.get(),widgets=variant(before);await a.replaceAll(widgets,{expected:before});assert.equal(a.state().pending,2);assert.equal(a.history().undoCount,2);offline=false;await a.sync();assert.equal(layout(store).revision,3);assert.deepEqual(editable(layout(store)),widgets);await a.undo();assert.deepEqual(layout(store).widgets,before.widgets);
});

test('Classic imports keep its fixed scene intact and include its independent pet block',async t=>{
 const {store}=setup(t),a=session(store,{theme:'classic'});await a.sync();const before=a.get(),widgets=editable(M.patch(before,{clock:{x:1000},scene:{visible:false},pet:{visible:false},launcher:{x:72,y:160}}));assert.equal((await a.replaceAll(widgets,{expected:before})).ok,true);assert.deepEqual(editable(layout(store,'classic')),widgets);assert.equal((await a.undo()).ok,true);assert.deepEqual(layout(store,'classic').widgets,before.widgets);
});

test('an offline full queue rejects import without losing its active preview or history',async t=>{
 const {store,request,storage}=setup(t);let offline=false;const a=session(store,{storage,request:(...args)=>{if(offline)throw Error('Offline');return request(...args);}});await a.sync();offline=true;for(let i=0;i<128;i++)await a.update({clock:{x:800+i%2}});const expected=a.get();a.preview({clock:{x:700}});const before=a.state(),cached=[...storage.values.values()][0];assert.throws(()=>a.replaceAll(variant(expected),{expected}),/несохранённых/);assert.deepEqual(a.state(),before);assert.equal([...storage.values.values()][0],cached);
});

test('browser facade rejects a file selection captured before profile switching',async t=>{
 const {store}=setup(t),storage=memory(),send=transport(store),context={PGWidgetModel:M,PG_APP:true,console,crypto:globalThis.crypto,URLSearchParams,AbortSignal,localStorage:storage,location:{pathname:'/index.html'},setInterval(){},addEventListener(){},fetch:async(url,options)=>{const query=new URL(url,'http://localhost').searchParams,body=options.method==='GET'?{theme:query.get('theme'),profile:query.get('profile')}:JSON.parse(options.body),response=await send(options.method,body);return {status:response.status,json:async()=>({document:response.document})};}};context.window=context;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../runtime/wallpaper/layout-client.js'),'utf8'),context);const api=context.PGLayouts;
 assert.equal((await api.replaceAll({})).reason,'scope');await api.activate('display-1').sync();const expected=JSON.parse(JSON.stringify(api.current())),widgets=variant(expected);await api.activate('display-2').sync();const before=layout(store,'paper-green','display-2');assert.equal((await api.replaceAll(widgets,{expected})).reason,'scope');assert.deepEqual(layout(store,'paper-green','display-2'),before);assert.equal(api.history().undoCount,0);
 // A fresh choice for the new screen applies there and leaves the earlier screen alone.
 assert.equal((await api.replaceAll(widgets,{expected:api.current()})).ok,true);assert.deepEqual(editable(layout(store,'paper-green','display-2')),widgets);assert.equal(layout(store).revision,1);
});
