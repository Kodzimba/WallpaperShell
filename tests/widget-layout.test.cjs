'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http');
const M=require('../runtime/wallpaper/widget-model.js'),{createStore,createHandler}=require('../runtime/companion/layouts.cjs'),{createSession}=require('../runtime/wallpaper/layout-client.js');
function disk(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pg-layout-test-'));t.after(()=>{for(const name of ['layouts.json','layouts.json.tmp'])fs.rmSync(path.join(dir,name),{force:true});fs.rmdirSync(dir);});return path.join(dir,'layouts.json');}
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),values};};
const change=(store,doc,changes,extra={})=>store.update({theme:doc.theme,profile:doc.profile,revision:doc.revision,operationId:crypto.randomUUID(),changes,...extra});
function transport(store){return async(method,body)=>{try{return {status:method==='GET'&&!store.get(body.theme,body.profile)?404:200,document:method==='GET'?store.get(body.theme,body.profile):method==='POST'?store.initialize(body):store.update(body)};}catch(e){return {status:e.status||400,document:e.document};}};}
function client(store,options={}){return createSession({theme:'paper-green',profile:'display-1',storage:memory(),request:transport(store),...options});}

test('both widget catalogs match the shipped DOM and original sizes, preserving all functions',()=>{
 for(const theme of M.themes){const base=theme==='classic'?'themes/classic':theme==='luna-blue'?'themes/luna-blue':'wallpaper',core=require('../runtime/'+base+'/core.js'),html=fs.readFileSync(path.join(__dirname,'../runtime',base,'index.html'),'utf8'),catalog=M.catalog(theme),doc=M.create(theme,'display-1');
  assert.deepEqual(Object.keys(catalog).sort(),[...html.matchAll(/data-widget="([^"]+)"/g)].map(m=>m[1]).concat('launcher','scene').sort());
  for(const [id,bounds]of Object.entries(core.layouts)){assert.deepEqual(catalog[id].base,bounds);assert.deepEqual({x:doc.widgets[id].x,y:doc.widgets[id].y,s:doc.widgets[id].scale},core.layout(id));}
  assert.deepEqual(catalog.media.actions,['media','volume']);if(theme!=='luna-blue')assert.deepEqual(catalog.ecoflow.sources,['ecoflow']);else for(const id of ['ecoflow','screens','audio'])assert.equal(doc.widgets[id].visible,false);assert.equal(catalog.launcher.resizable,false);M.validate(doc);
 }
});
test('legacy positions, scale and launcher migrate separately by theme/profile without changing the legacy values',()=>{
 const positions={weather:{x:100,y:200,s:1.25},clock:{x:'bad',y:NaN,s:null}},launcher={x:40,y:120};const before=JSON.stringify(positions);
 const doc=M.migrate('paper-green','display-2',positions,launcher);assert.equal(doc.widgets.weather.scale,1.25);assert.equal(doc.widgets.weather.x,100);assert.equal(doc.widgets.launcher.y,120);assert.equal(JSON.stringify(positions),before);assert.equal(doc.profile,'display-2');
 assert.equal(M.create('paper-green','display-1').widgets.weather.x,1310);assert.equal(M.create('classic','display-2').widgets.weather.x,1582);
 const classic=M.migrate('classic','display-1',{media:{x:124,y:820,s:1},ecoflow:{x:1308,y:934,s:1}},{x:18,y:408});assert.equal(classic.widgets.media.y,740);assert.equal(classic.widgets.ecoflow.y,904);assert.equal(classic.widgets.launcher.y,200);
});
test('schema rejects executable fields, unknown widgets, forged types, invalid scopes and future versions',()=>{
 const doc=M.create('paper-green','display-1');
 for(const changes of [{unknown:{visible:false}},{clock:{command:'whoami'}},{clock:{scale:Infinity}},{clock:{visible:'false'}},JSON.parse('{"__proto__":{"visible":false}}')])assert.throws(()=>M.patch(doc,changes));
 for(const bad of [{...doc,schemaVersion:M.VERSION+1},{...doc,profile:'../../x'},{...doc,theme:'evil'},{...doc,script:'code'}])assert.throws(()=>M.validate(bad));
 const changed=M.clone(doc);changed.widgets.media.type='shell';assert.throws(()=>M.validate(changed));assert.equal({}.visible,undefined);
});
test('widget bounds stay on the logical canvas while scaling remains proportional',()=>{
 const doc=M.patch(M.create('paper-green','display-1'),{media:{x:1e8,y:-20,scale:999},clock:{visible:false}}),p=doc.widgets.media,b=M.catalog('paper-green').media.base;
 assert(p.x>=0&&p.x+b[2]*p.scale<=1920);assert(p.y>=0&&p.y+b[3]*p.scale<=1080);assert.equal(doc.widgets.clock.visible,false);assert.equal(doc.widgets.weather.visible,true);M.validate(doc);
});
test('all theme/profile layouts survive a process restart and repeated migration never overwrites a saved profile',t=>{
 const file=disk(t),store=createStore(file);for(const theme of M.themes)for(const profile of M.profiles){let doc=store.initialize(M.create(theme,profile));doc=change(store,doc,{clock:{visible:profile!=='display-2'}});assert.equal(store.initialize(M.migrate(theme,profile,{clock:{x:0}},null)).revision,doc.revision);}
 const reopened=createStore(file);for(const theme of M.themes)for(const profile of M.profiles)assert.equal(reopened.get(theme,profile).widgets.clock.visible,profile!=='display-2');
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(file,'utf8')).layouts).length,M.themes.length*M.profiles.length);
});
test('failed atomic replacement leaves the confirmed file and memory unchanged, then recovers',t=>{
 const file=disk(t);let fail=false;const store=createStore(file,{...fs,renameSync(...args){if(fail)throw Error('Disk full');return fs.renameSync(...args);}}),doc=store.initialize(M.create('paper-green','display-1')),before=fs.readFileSync(file,'utf8');
 fail=true;assert.throws(()=>change(store,doc,{clock:{visible:false}}),e=>e.status===503);assert.equal(store.get(doc.theme,doc.profile).revision,doc.revision);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(createStore(file).get(doc.theme,doc.profile).widgets.clock.visible,true);
 fail=false;assert.equal(change(store,doc,{clock:{visible:false}}).widgets.clock.visible,false);
});
test('corrupt or future files remain intact and block writes instead of silently resetting the layout',t=>{
 const file=disk(t);for(const raw of ['{broken',JSON.stringify({schemaVersion:99,layouts:{}})]){fs.writeFileSync(file,raw);const store=createStore(file);assert.throws(()=>store.initialize(M.create('paper-green','display-1')),e=>e.status===503);assert.throws(()=>store.get('paper-green','display-1'),e=>e.status===503);assert.equal(fs.readFileSync(file,'utf8'),raw);}
});
test('two stale windows merge changes to different fields of the same widget without losing either change',async t=>{
 const store=createStore(disk(t)),a=client(store),b=client(store);await Promise.all([a.sync(),b.sync()]);await Promise.all([a.update({clock:{x:900}}),b.update({clock:{visible:false}})]);
 const doc=store.get('paper-green','display-1');assert.equal(doc.widgets.clock.x,900);assert.equal(doc.widgets.clock.visible,false);await a.refresh();assert.equal(a.get().widgets.clock.visible,false);assert.equal(a.status(),'saved');
});
test('offline edits survive WebView restart and rebase on a newer file without clobbering another widget',async t=>{
 const store=createStore(disk(t)),storage=memory();let offline=false;const request=async(...args)=>{if(offline)throw Error('Offline');return transport(store)(...args);};
 const a=client(store,{storage,request});await a.sync();offline=true;await a.update({weather:{x:200,visible:false}});assert.equal(a.status(),'local');
 const other=client(store);await other.sync();await other.update({clock:{visible:false}});offline=false;
 const restarted=client(store,{storage,request});assert.equal(restarted.get().widgets.weather.visible,false);await restarted.sync();assert.equal(restarted.status(),'saved');assert.equal(restarted.get().widgets.clock.visible,false);assert.equal(restarted.get().widgets.weather.x,200);
});
test('an edit made during a pending write is queued and also persisted',async t=>{
 const store=createStore(disk(t));let release,started;const startedPromise=new Promise(r=>started=r);let block=true;
 const a=client(store,{request:async(method,body)=>{if(method==='PATCH'&&block){block=false;started();await new Promise(r=>release=r);}return transport(store)(method,body);}});await a.sync();const first=a.update({clock:{visible:false}});await startedPromise;const second=a.update({weather:{visible:false}});release();await Promise.all([first,second]);const doc=store.get('paper-green','display-1');assert.equal(doc.widgets.clock.visible,false);assert.equal(doc.widgets.weather.visible,false);assert.equal(a.status(),'saved');
});
test('a lost reset acknowledgement is idempotent across restart and cannot erase a later edit',async t=>{
 const file=disk(t),store=createStore(file),storage=memory();let lose=false;
 const a=client(store,{storage,request:async(method,body)=>{const response=await transport(store)(method,body);if(lose&&method==='PATCH'){lose=false;throw Error('Lost acknowledgement');}return response;}});await a.sync();await a.update({clock:{visible:false}});lose=true;await a.reset();assert.equal(a.status(),'local');
 const b=client(store);await b.sync();await b.update({weather:{visible:false}});const revision=b.get().revision;
 const restarted=client(createStore(file),{storage});await restarted.sync();assert.equal(restarted.get().widgets.clock.visible,true);assert.equal(restarted.get().widgets.weather.visible,false);assert.equal(restarted.get().revision,revision);
});
test('reset restores only the selected theme/profile including hidden widgets and the launcher',async t=>{
 const store=createStore(disk(t)),a=client(store),b=client(store,{profile:'display-2'}),c=client(store,{theme:'classic'});await Promise.all([a.sync(),b.sync(),c.sync()]);for(const s of [a,b,c])await s.update({clock:{visible:false},launcher:{x:60,visible:false}});await a.reset();assert.equal(a.get().widgets.clock.visible,true);assert.equal(a.get().widgets.launcher.x,24);assert.equal(b.get().widgets.clock.visible,false);assert.equal(c.get().widgets.launcher.visible,false);
});
test('unavailable localStorage never reports offline edits as saved',async t=>{
 const store=createStore(disk(t)),a=client(store,{storage:{getItem(){throw Error();},setItem(){throw Error();}},request:async()=>{throw Error();}});await a.update({mouse:{visible:false}});assert.equal(a.status(),'memory');assert.equal(a.get().widgets.mouse.visible,false);
});
test('layout HTTP API enforces the local capability, strict payloads, revision conflicts and a size limit',async t=>{
 const store=createStore(disk(t)),key='a'.repeat(64),handler=createHandler({key,store}),server=http.createServer((req,res)=>handler(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const endpoint='http://127.0.0.1:'+server.address().port+'/layouts',headers={'X-VioletGhost-Action':'desktop','X-VioletGhost-Key':key,'Content-Type':'application/json',Origin:'null'};
 const request=(method,body,extra={})=>fetch(endpoint+(method==='GET'?'?theme=paper-green&profile=display-1':''),{method,headers:{...headers,...extra},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
 assert.equal((await request('GET',undefined,{'X-VioletGhost-Key':''})).status,403);assert.equal((await request('GET',undefined,{Origin:'https://evil.invalid'})).status,403);assert.equal((await request('GET')).status,404);
 const doc=(await (await request('POST',M.create('paper-green','display-1'))).json()).document;assert.equal(doc.revision,1);
 const payload={theme:doc.theme,profile:doc.profile,revision:1,operationId:crypto.randomUUID(),changes:{clock:{visible:false}}};assert.equal((await request('PATCH',payload)).status,200);assert.equal((await request('PATCH',{...payload,operationId:crypto.randomUUID()})).status,409);assert.equal((await request('PATCH',{...payload,revision:2,operationId:crypto.randomUUID(),changes:{clock:{script:'bad'}}})).status,400);
 assert.equal((await request('POST','x'.repeat(25000))).status,413);assert.equal((await request('POST',{}, {'Content-Type':'text/plain'})).status,415);
});
