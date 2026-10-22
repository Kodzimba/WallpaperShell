'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const D=require('../runtime/companion/devices.cjs'),P=require('../runtime/companion/device-provider.cjs');const at=()=>new Date().toISOString(),source=data=>({status:'ok',updatedAt:at(),data}),key='b'.repeat(64);
const sample=(seconds=1)=>({at:at(),peripheralsAt:at(),seconds,networks:[{id:'PRIVATE-NIC-A',name:'Wi-Fi',up:true,isDefault:true,rx:seconds*1000,tx:seconds*100,speed:1000000000},{id:'PRIVATE-NIC-B',name:'Ethernet',up:true,isDefault:false,rx:seconds*3000,tx:seconds*200,speed:100000000}],peripherals:[{id:'PRIVATE-BT',name:'Bluetooth Mouse',kind:'mouse',connected:true,batteryPercent:74}],gpus:[{id:'PRIVATE-AMD',name:'AMD Radeon'}],outputs:[{id:'PRIVATE-AUDIO',name:'My headphones',selected:true}],windowsBatteryApi:true});
function fixture(t,{hub={available:true,devices:[{id:'PRIVATE-HUB',name:'PRO X SUPERLIGHT 2',kind:'mouse',connected:true,batteryPercent:88,charging:false}]},gpu=[{id:'PRIVATE-GPU',name:'NVIDIA RTX 5080',used:2**30,total:16*2**30}],io=fs,root}={}){const dir=root||fs.mkdtempSync(path.join(os.tmpdir(),'pg-devices-'));if(!root)t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let starts=0,refreshes=0,stops=0;const base={system:source({ramUsedBytes:4*2**30,ramTotalBytes:32*2**30,gpuName:'old GPU',vramUsedBytes:9,vramTotalBytes:10}),network:source({adapter:'Wi-Fi',internet:true,pingMs:12}),mouse:source({model:'Old mouse',batteryPercent:17}),speedtest:source({downMbps:900,upMbps:600})},provider={startProbe(){starts++;return {refresh(){refreshes++;},stop(){stops++;}};},readGhub:async()=>hub,readGpus:async()=>gpu};const manager=D.createDevices({root:path.join(dir,'runtime/companion'),key,getSources:()=>base,isShared:()=>false,provider,io});t.after(()=>manager.stop());manager.start();return {manager,base,dir,ready:manager.refresh(),counts:()=>({starts,refreshes,stops})};}
const choose=(manager,changes)=>manager.save({revision:manager.view().config.revision,changes});
test('auto discovers this PC, accepts other GPU/mouse models and exposes opaque IDs only',async t=>{const f=fixture(t);await f.ready;f.manager.ingest(sample());f.manager.ingest(sample(3));const view=f.manager.view(),rendered=f.manager.decorate(f.base);assert.equal(view.mice.length,2);assert.equal(rendered.mouse.data.model,'PRO X SUPERLIGHT 2');assert.equal(rendered.mouse.data.batteryPercent,88);assert.equal(rendered.system.data.gpuName,'NVIDIA RTX 5080');assert.equal(rendered.system.data.vramUsedBytes,2**30);assert.equal(rendered.system.data.ramUsedBytes,4*2**30);assert.equal(rendered.network.data.rxBytesPerSecond,1000);assert(!JSON.stringify(view).includes('PRIVATE-'));assert(!JSON.stringify(rendered).includes('PRIVATE-'));assert.equal(f.counts().starts,1);});
test('manual device selection persists across restart and never substitutes a different mouse when disconnected',async t=>{const f=fixture(t);await f.ready;f.manager.ingest(sample());const mouse=f.manager.view().mice.find(m=>m.provider==='windows');choose(f.manager,{mouse:mouse.id,speedMode:'traffic'});assert.equal(f.manager.decorate(f.base).mouse.data.batteryPercent,74);const next=sample(3);next.peripherals=[];f.manager.ingest(next);assert.equal(f.manager.decorate(f.base).mouse.status,'unavailable');assert.equal(f.manager.view().config.mouse,mouse.id);f.manager.stop();const restored=fixture(t,{root:f.dir});await restored.ready;restored.manager.ingest(sample());assert.equal(restored.manager.view().config.mouse,mouse.id);assert.equal(restored.manager.decorate(f.base).mouse.data.model,'Bluetooth Mouse');});
test('multiple reporting mice require a choice; zero is valid and stale Windows cache does not become fresh',async t=>{const f=fixture(t,{hub:{available:true,devices:[]}});await f.ready;const first=sample();first.peripherals[0].batteryPercent=0;f.manager.ingest(first);assert.equal(f.manager.decorate(f.base).mouse.data.batteryPercent,0);const next=sample(3);next.peripherals.push({...next.peripherals[0],id:'SECOND',name:'Second Mouse'});f.manager.ingest(next);assert.equal(f.manager.view().selected.mouse,null);assert.equal(f.manager.decorate(f.base).mouse.status,'unavailable');choose(f.manager,{mouse:f.manager.view().mice[0].id});next.at=at();next.peripheralsAt=new Date(Date.now()-121000).toISOString();f.manager.ingest(next);assert.equal(f.manager.decorate(f.base).mouse.status,'unavailable');});
test('a manual non-default network has its own traffic, no unrelated RTT or test result',async t=>{const f=fixture(t);await f.ready;f.manager.ingest(sample());f.manager.ingest(sample(3));choose(f.manager,{network:f.manager.view().networks.find(n=>n.name==='Ethernet').id});const result=f.manager.decorate(f.base);assert.equal(result.network.data.adapter,'Ethernet');assert.equal(result.network.data.rxBytesPerSecond,3000);assert.equal(result.network.data.pingMs,null);assert.equal(result.deviceSettings.data.effectiveSpeedMode,'traffic');assert.equal(result.speedtest.status,'unavailable');assert.equal(result.speedtest.testAvailable,false);assert.throws(()=>f.manager.beginTest(),e=>e.status===409);});

test('fresh RAM survives an expired GPU cache and stale aggregate system timestamp',async t=>{
 const f=fixture(t);await f.ready;f.manager.ingest(sample());const initial=Date.now(),now=initial+20000;t.mock.method(Date,'now',()=>now);
 const ramAt=new Date(now-500).toISOString(),old=new Date(initial-1000).toISOString();
 f.base.system={...f.base.system,updatedAt:old,measurements:{ram:ramAt,vram:old}};
 const result=f.manager.decorate(f.base).system;
 assert.equal(result.status,'ok');assert.equal(result.updatedAt,ramAt);assert.equal(result.measurements.ram,ramAt);
 assert.equal(result.data.ramUsedBytes,4*2**30);assert.equal(result.data.vramUsedBytes,null);assert.equal(result.data.vramTotalBytes,null);
 assert.equal(result.data.gpuName,'NVIDIA RTX 5080');assert(Date.parse(result.measurements.vram)<now-15000);
 assert.equal(f.base.system.data.vramUsedBytes,9,'Decoration must not mutate its input');
});

test('selected GPU cache has its own timestamp and works before Windows inventory arrives',async t=>{
 const f=fixture(t);await f.ready;const old=new Date(Date.now()-20000).toISOString(),gpuAt=f.manager.gpuTimestamp();
 f.base.system={...f.base.system,status:'unavailable',updatedAt:old,measurements:{ram:old,vram:old}};
 const result=f.manager.decorate(f.base).system;
 assert.equal(f.manager.view().ready,false);assert.equal(result.status,'ok');assert.equal(result.updatedAt,gpuAt);assert.equal(result.measurements.vram,gpuAt);
 assert.equal(result.data.ramUsedBytes,null);assert.equal(result.data.ramTotalBytes,null);assert.equal(result.data.vramUsedBytes,2**30);
 f.base.system.data=null;const withoutRam=f.manager.decorate(f.base).system;assert.equal(withoutRam.status,'ok');assert.equal(withoutRam.data.vramUsedBytes,2**30);assert.equal(withoutRam.data.ramUsedBytes,null);
});

test('fresh per-GPU base measurement remains usable even when RAM and GPU cache expired',async t=>{
 const f=fixture(t);await f.ready;f.manager.ingest(sample());const initial=Date.now(),now=initial+20000;t.mock.method(Date,'now',()=>now);
 const vramAt=new Date(now-1000).toISOString(),old=new Date(initial-1000).toISOString();
 f.base.system={...f.base.system,updatedAt:old,data:{...f.base.system.data,gpuName:'NVIDIA RTX 5080'},measurements:{ram:old,vram:vramAt}};
 const result=f.manager.decorate(f.base).system;
 assert.equal(result.status,'ok');assert.equal(result.updatedAt,vramAt);assert.equal(result.measurements.vram,vramAt);
 assert.equal(result.data.ramUsedBytes,null);assert.equal(result.data.vramUsedBytes,9);assert.equal(result.data.vramTotalBytes,10);
});

test('explicitly missing RAM does not borrow a fresh aggregate time and disabled GPU clears its measurement',async t=>{
 const f=fixture(t);await f.ready;f.manager.ingest(sample());choose(f.manager,{gpu:'none'});
 f.base.system.measurements={ram:null,vram:at()};
 const result=f.manager.decorate(f.base).system;
 assert.equal(result.status,'unavailable');assert.equal(result.updatedAt,null);assert.deepEqual(result.measurements,{ram:null,vram:null});
 for(const field of ['ramUsedBytes','ramTotalBytes','vramUsedBytes','vramTotalBytes','gpuName'])assert.equal(result.data[field],null);
});

test('legacy system times still work, while RAM TTL and numeric validation remain independent',async t=>{
 const f=fixture(t);await f.ready;f.manager.ingest(sample());choose(f.manager,{gpu:'none'});
 assert.equal(f.manager.decorate(f.base).system.data.ramUsedBytes,4*2**30);
 f.base.system.updatedAt=new Date(Date.now()-10001).toISOString();assert.equal(f.manager.decorate(f.base).system.status,'unavailable');
 f.base.system.updatedAt=at();f.base.system.data.ramTotalBytes=0;assert.equal(f.manager.decorate(f.base).system.status,'unavailable');
});

test('mouse battery and charging use their provider time independently of network or Windows inventory',async t=>{
 const f=fixture(t);await f.ready;
 let result=f.manager.decorate(f.base);assert.equal(result.mouse.status,'ok');assert.equal(result.mouse.data.batteryPercent,88);assert.equal(result.network.status,'unavailable');
 f.manager.ingest(sample());const initial=Date.now();let elapsed=20000;t.mock.method(Date,'now',()=>initial+elapsed);
 result=f.manager.decorate(f.base);assert.equal(result.network.status,'unavailable');assert.equal(result.mouse.status,'ok');assert.equal(result.mouse.data.charging,false);
 const windowsMouse=f.manager.view().mice.find(d=>d.provider==='windows');choose(f.manager,{mouse:windowsMouse.id});
 result=f.manager.decorate(f.base);assert.equal(result.mouse.status,'ok');assert.equal(result.mouse.data.batteryPercent,74);
 elapsed=121000;result=f.manager.decorate(f.base);assert.equal(result.mouse.status,'unavailable');assert.equal(result.mouse.data.batteryPercent,null);assert.equal(result.mouse.data.charging,null);
 choose(f.manager,{mouse:'auto'});result=f.manager.decorate(f.base);assert.equal(result.mouse.status,'unavailable');
});
test('internet tests have route provenance; a previous result cannot follow a different adapter',async t=>{const f=fixture(t);await f.ready;f.manager.ingest(sample());assert.equal(f.manager.decorate(f.base).speedtest.status,'unavailable');f.manager.beginTest();f.base.speedtest.updatedAt=new Date(Date.now()+5).toISOString();assert.equal(f.manager.decorate(f.base).speedtest.status,'ok');const next=sample(3);next.networks[0].isDefault=false;next.networks[1].isDefault=true;f.manager.ingest(next);assert.equal(f.manager.decorate(f.base).speedtest.status,'unavailable');assert.equal(f.manager.view().selected.network,f.manager.view().networks.find(n=>n.name==='Ethernet').id);});
test('device preferences reject stale revisions, unknown devices, scripts and disk failure without losing current settings',async t=>{const f=fixture(t);await f.ready;f.manager.ingest(sample());for(const changes of [{network:'../../x'},{command:'script'},{mouse:'https://x.invalid'},{speedMode:'linkSpeed'}])assert.throws(()=>choose(f.manager,changes));choose(f.manager,{speedMode:'traffic'});assert.throws(()=>f.manager.save({revision:0,changes:{mouse:'none'}}),e=>e.status===409);const failing=fixture(t,{root:f.dir,io:{...fs,renameSync(){throw Error('disk');}}});await failing.ready;failing.manager.ingest(sample());assert.throws(()=>choose(failing.manager,{mouse:'none'}),e=>e.status===503);assert.equal(failing.manager.view().config.mouse,'auto');const file=path.join(f.dir,'data/devices.json');fs.writeFileSync(file,'broken');const broken=fixture(t,{root:f.dir});await broken.ready;assert.throws(()=>choose(broken.manager,{mouse:'none'}),e=>e.status===503);assert.equal(fs.readFileSync(file,'utf8'),'broken');});
test('G HUB classification supports several mice and excludes keyboards and wired G502 HERO',()=>{const caps={hasBatteryStatus:true};for(const name of ['G305 LIGHTSPEED','PRO X SUPERLIGHT 2','G903 LIGHTSPEED Wireless Gaming Mouse'])assert(P.isMouse({displayName:name,capabilities:caps}));assert(!P.isMouse({displayName:'G915 LIGHTSPEED',capabilities:caps}));assert(!P.isMouse({displayName:'G502 HERO',capabilities:caps}));assert(P.isMouse({displayName:'Future Wireless',deviceType:'MOUSE',capabilities:caps}));});
test('device endpoint is authenticated and cannot change bindings during native dialogs',async t=>{const f=fixture(t);await f.ready;f.manager.ingest(sample());let blocked=false;const handler=D.createHandler({key,devices:f.manager,canAct:()=>!blocked}),server=http.createServer((req,res)=>handler(req,res,new URL(req.url,'http://fixture')));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const url='http://127.0.0.1:'+server.address().port,headers={'X-VioletGhost-Action':'desktop','X-VioletGhost-Key':key,'Content-Type':'application/json'};assert.equal((await fetch(url+'/devices')).status,403);assert.equal((await fetch(url+'/devices',{headers})).status,200);blocked=true;assert.equal((await fetch(url+'/devices',{method:'POST',headers,body:JSON.stringify({revision:0,changes:{mouse:'none'}})})).status,409);blocked=false;assert.equal((await fetch(url+'/devices',{method:'POST',headers,body:JSON.stringify({revision:0,changes:{mouse:'none'}})})).status,200);});
