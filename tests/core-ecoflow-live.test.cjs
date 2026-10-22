'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Reader,packet}=require('../runtime/companion/mqtt-readonly.cjs'),P=require('../runtime/companion/ecoflow-proto.cjs');
const {Samples,selectMax}=require('../runtime/companion/ecoflow-live.cjs'),E=require('../runtime/companion/ecoflow-app.cjs');
const vint=n=>{const b=[];do{const x=n%128;n=Math.floor(n/128);b.push(x|(n?128:0));}while(n);return Buffer.from(b);};
const num=(id,n)=>Buffer.concat([vint(id*8),vint(n)]);
const bytes=(id,b)=>Buffer.concat([vint(id*8+2),vint(b.length),b]);
const float=(id,n)=>{const b=Buffer.alloc(4);b.writeFloatLE(n);return Buffer.concat([vint(id*8+5),b]);};
function sample({seq=1,values=Buffer.concat([float(3,0),float(4,210),float(262,99)]),time}={}){
 return {payload:bytes(1,Buffer.concat([bytes(1,values),num(8,254),num(9,21),num(14,seq),...(time?[num(18,time)]:[])])),retained:false,duplicate:false};
}
test('MQTT reader handles fragmented and joined frames and rejects unbounded lengths',()=>{
 const reader=new Reader(),out=[];reader.on('packet',(t,b)=>out.push([t,[...b]]));
 reader.push(Buffer.from([0x20]));reader.push(Buffer.from([2,0]));assert.equal(out.length,0);
 reader.push(Buffer.from([0,0xd0,0]));assert.deepEqual(out,[[0x20,[0,0]],[0xd0,[]]]);
 assert.throws(()=>new Reader().push(Buffer.from([0x30,0xff,0xff,0xff,0xff,1])),/invalid/);
 assert.throws(()=>packet(0x30,Buffer.from('set')),/Read-only/);
});
test('Delta 3 decoder preserves genuine zero and field absence, bounds malformed payloads',()=>{
 assert.deepEqual(P.decode(sample().payload)[0].values,{inputWatts:0,outputWatts:210,batteryPercent:99});
 assert.deepEqual(P.decode(sample({values:float(4,0)}).payload)[0].values,{outputWatts:0});
 assert.throws(()=>P.decode(Buffer.from([0x0a,0x7f,0])),/Truncated/);
 assert.throws(()=>P.fields(Buffer.from([8,...Array(10).fill(255)])),/overflow/);
 assert.deepEqual(P.decode(sample({values:float(262,101)}).payload)[0].values,{});
});
test('Live samples reject cache, duplicates, old device time and never refresh a missing field',()=>{
 const s=new Samples(),now=1792357200000;
 assert.equal(s.accept({...sample(),retained:true},now),false);
 assert.equal(s.accept({...sample(),duplicate:true},now),false);
 assert.equal(s.accept(sample({time:Math.floor(now/1000)-121}),now),false);
 assert.equal(s.accept(sample(),now),true);const initial=s.snapshot(now);
 assert.equal(s.accept(sample(),now+10000),false);
 assert.equal(s.snapshot(now+10000).updatedAt,initial.updatedAt);
 s.accept(sample({seq:2,values:float(4,0)}),now+119000);
 const after=s.snapshot(now+120000);
 assert.deepEqual(after.data,{batteryPercent:null,inputWatts:null,outputWatts:0});
 assert.equal(after.updatedAt,new Date(now+119000).toISOString());
 assert.equal(s.snapshot(now+239000).status,'unavailable');
 assert.equal(initial.timeBasis,'live MQTT receive time');
});
test('Exact DELTA 3 Max selection and allowlists reject Max Plus and write requests',async()=>{
 assert.equal(selectMax({serials:['D3N1TEST']}),'D3N1TEST');
 assert.throws(()=>selectMax({serials:['D3M1TEST']}));
 assert.throws(()=>selectMax({serials:['D3N1TEST','D3M1TEST']}));
 await assert.rejects(E.appGet({},'/iot-service/device/property/set'),/read path rejected/);
 assert.throws(()=>E.broker({url:'mqtt-e.ecoflow.com.evil.invalid'}),/Unexpected/);
 assert.throws(()=>E.broker({url:'evil@note.ecoflow.com'}),/Unexpected/);
});

function liveFixture(){
 const fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
 let now=1792357200000,interval;const scheduled=new Set(),connections=[],published=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 class Mqtt extends EventEmitter{constructor(options){super();this.connected=true;this.options=options;this.stops=0;connections.push(this);}stop(){this.connected=false;this.stops++;/* Deliberately no close event: a broken transport may never deliver it. */}}
 const app={enabled:()=>true,authPath:()=> 'fixture-protected-auth',loadAuth:async()=>({serials:['D3N1TEST'],userId:'1'}),appGet:async(_a,p)=>p==='/iot-service/user/device'?['D3N1TEST']:{},decryptCredentials:()=>({certificateAccount:'test',certificatePassword:'test'}),broker:()=> 'wss://mqtt-e.ecoflow.com:8084/mqtt',clientId:()=> 'fixture'};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/companion/ecoflow-live.cjs'),'utf8'),{module,__dirname:__dirname,Buffer,Date:Clock,process:{env:{LOCALAPPDATA:'fixture'}},require(name){if(name==='node:fs')return {existsSync:()=>true};if(name==='./ecoflow-app.cjs')return app;if(name==='./mqtt-readonly.cjs')return {ReadOnlyMqtt:Mqtt};if(name==='./ecoflow-proto.cjs')return P;return require(name);},setInterval(fn){interval=fn;return 1;},clearInterval(){interval=null;},setTimeout(fn,delay){const timer={fn,delay};scheduled.add(timer);return timer;},clearTimeout(timer){scheduled.delete(timer);}});
 const stop=module.exports.startEcoflow(value=>published.push(value));
 return {connections,published,scheduled,stop,advance(ms){now+=ms;interval?.();},tick:()=>new Promise(resolve=>setImmediate(resolve)),retry(){const timer=[...scheduled][0];assert(timer);scheduled.delete(timer);timer.fn();}};
}
test('a connected but silent live stream reconnects after expiry, rejects late events and resumes from real data',async()=>{
 const f=liveFixture();try{
  await f.tick();const first=f.connections[0];first.emit('ready');first.emit('message',sample());
  f.advance(119999);assert.equal(f.scheduled.size,0);assert.equal(f.published.at(-1).status,'ok');
  // Broker keepalives are not station samples. Invalid/retained data cannot prolong freshness.
  first.emit('message',{...sample({seq:2}),retained:true});first.emit('message',{payload:Buffer.from([0x0a,0x7f]),retained:false,duplicate:false});
  f.advance(1);assert.equal(first.stops,1);assert.equal(f.published.at(-1).data,null);assert.equal([...f.scheduled][0].delay,0);
  f.retry();await f.tick();const second=f.connections[1];assert(second);
  first.emit('closed');first.emit('message',sample({seq:3}));assert.equal(f.scheduled.size,0);assert.equal(f.published.at(-1).data,null);
  second.emit('ready');second.emit('message',sample({seq:1}));assert.equal(f.published.at(-1).data.batteryPercent,99);assert.equal(f.published.at(-1).data.inputWatts,0);
 }finally{f.stop();}
});
test('partial live samples keep the connection while absent fields expire; failure retries without waiting for close',async()=>{
 const f=liveFixture();try{
  await f.tick();const first=f.connections[0];first.emit('ready');first.emit('message',sample());
  f.advance(60000);first.emit('message',sample({seq:2,values:float(4,125)}));f.advance(60000);
  assert.equal(first.stops,0);assert.equal(f.scheduled.size,0);assert.equal(f.published.at(-1).data.batteryPercent,null);assert.equal(f.published.at(-1).data.inputWatts,null);assert.equal(f.published.at(-1).data.outputWatts,125);
  first.emit('failure');assert.equal(first.stops,1);assert.equal(f.published.at(-1).status,'unavailable');assert.equal([...f.scheduled][0].delay,60000);
  first.emit('closed');assert.equal(f.scheduled.size,1);f.stop();assert.equal(f.scheduled.size,0);f.advance(300000);assert.equal(f.connections.length,1);
 }finally{f.stop();}
});
