'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const W=require('../runtime/companion/weather-config.cjs'),E=require('../runtime/companion/ecoflow-app.cjs'),Official=require('../runtime/companion/ecoflow.cjs'),{weatherResult}=require('../runtime/companion/logic.cjs');
const weather=()=>({enabled:true,latitude:0,longitude:0,city:'Example city'});
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ws-privacy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('weather requires explicit app-local valid config and never autodiscovers location',t=>{
 const root=temp(t);assert.equal(W.readWeatherConfig(root),null);fs.mkdirSync(path.join(root,'data'));const file=path.join(root,'data/weather.json');
 for(const value of [{}, {...weather(),enabled:false},{...weather(),latitude:91},{...weather(),longitude:-181},{...weather(),latitude:'0'},{...weather(),city:'<img>'},{...weather(),url:'https://example.invalid'},{...weather(),city:'x\nsecret'}]){fs.writeFileSync(file,JSON.stringify(value));assert.equal(W.readWeatherConfig(root),null);assert.throws(()=>W.weatherUrl(value));}
 fs.writeFileSync(file,JSON.stringify(weather()));assert.deepEqual(W.readWeatherConfig(root),weather());const url=new URL(W.weatherUrl(weather()));assert.equal(url.origin,'https://api.open-meteo.com');assert.equal(url.searchParams.get('latitude'),'0');assert.equal(url.searchParams.get('longitude'),'0');assert.equal(url.searchParams.get('timezone'),'UTC');
 const reads=[];assert.equal(W.readWeatherConfig(root,{io:{statSync(file){reads.push(file);return {size:10000};},readFileSync(){throw Error('must not read oversized data');}}}),null);assert.deepEqual(reads,[file]);
});
test('weather source identity omits private coordinates and returns only explicit city',()=>{
 const payload={current:{temperature_2m:0,time:1792357200,weather_code:0,is_day:1},current_units:{temperature_2m:'°C'}};
 assert.equal(weatherResult(payload).identity,'Open-Meteo');assert.equal(weatherResult(payload).data.city,undefined);const source=weatherResult(payload,weather());assert.equal(source.data.city,'Example city');assert.equal(source.data.latitude,undefined);assert.equal(source.data.longitude,undefined);assert.equal(weatherResult(payload,{...weather(),city:'<script>'}).data.city,undefined);
});
test('EcoFlow credentials stay inside app-local data and require explicit enablement before decrypting',async t=>{
 const root=temp(t);assert.equal(E.enabled(root),false);assert.equal(E.authPath(root),path.join(root,'data/ecoflow-app-auth.txt'));assert.equal(Official.configPath(root),path.join(root,'data/ecoflow.json'));let spawns=0;const execFileProcess=(_exe,_args,options,done)=>{spawns++;assert.equal(options.env.WS_ECOFLOW_AUTH_PATH,E.authPath(root));assert.equal(options.windowsHide,true);done(null,JSON.stringify({baseUrl:'https://api.ecoflow.com',token:'synthetic',userId:'1'}));};
 await assert.rejects(E.loadAuth({root,execFileProcess}),/not configured/);assert.equal(spawns,0);fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/ecoflow-app.json'),JSON.stringify({enabled:true}));assert.equal(E.enabled(root),true);await E.loadAuth({root,execFileProcess});assert.equal(spawns,1);
 fs.writeFileSync(path.join(root,'data/ecoflow-app.json'),JSON.stringify({enabled:true,legacyProfile:true}));assert.equal(E.enabled(root),false);
 const file=Official.configPath(root),config={accessKey:'synthetic',secretKey:'synthetic',sn:'D3N1TEST'};fs.writeFileSync(file,JSON.stringify(config));assert.throws(()=>Official.readConfig(root),/explicit opt-in/);fs.writeFileSync(file,JSON.stringify({...config,enabled:true}));assert.equal(Official.readConfig(root).enabled,true);
});
test('disabled EcoFlow creates no decrypt, connection, retry or expiry timer',()=>{
 const published=[],module={exports:{}};let checks=0;const fail=()=>{throw Error('disabled provider must remain idle');};
 vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/companion/ecoflow-live.cjs'),'utf8'),{module,__dirname:path.resolve(__dirname,'../runtime/companion'),require(name){if(name==='./ecoflow-app.cjs')return {enabled(){checks++;return false;},loadAuth:fail};if(name==='./mqtt-readonly.cjs')return {ReadOnlyMqtt:fail};if(name==='./ecoflow-proto.cjs')return {};return require(name);},setInterval:fail,setTimeout:fail});
 const stop=module.exports.startEcoflow(value=>published.push(value));stop();assert.equal(checks,1);assert.equal(published.length,1);assert.equal(published[0].status,'unavailable');assert.equal(published[0].data,null);
});
test('builder limits raw output before an unterminated line can accumulate unbounded memory',async t=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),{createCodex}=require('../runtime/companion/builder-codex.cjs');let child,killed=0;
 const spawnProcess=()=>{child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){killed++;queueMicrotask(()=>child.emit('close',1));}});return child;};
 const agent=createCodex({root:temp(t),cli:'synthetic-codex',spawnProcess}),promise=agent.chat([{role:'user',text:'Synthetic request'}],null);
 child.stdout.write(Buffer.alloc(1024*1024+1,0x61));await assert.rejects(promise,/слишком большой/);assert.equal(killed,1);assert.equal(agent.status().busy,false);
});
