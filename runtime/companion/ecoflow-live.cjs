'use strict';
const fs=require('node:fs'),path=require('node:path');
const E=require('./ecoflow-app.cjs'),P=require('./ecoflow-proto.cjs'),{ReadOnlyMqtt}=require('./mqtt-readonly.cjs');
const IDENTITY='EcoFlow app MQTT / DELTA 3 Max / D3N1';
const TTL=120000,KEYS=['batteryPercent','inputWatts','outputWatts'];
class Samples{
 constructor(){this.values={};this.sequences=new Set();}
 accept(message,now=Date.now()){
  // Only the device's live push topic is subscribed. Never import quota caches,
  // retained messages, duplicate deliveries, get_reply or arbitrary JSON.
  if(message.retained||message.duplicate||!Number.isFinite(now))return false;
  let changed=false;
  for(const frame of P.decode(message.payload)){
   if(frame.encrypted||!Object.keys(frame.values).length)continue;
   if(frame.deviceTime){const at=frame.deviceTime<1e12?frame.deviceTime*1000:frame.deviceTime;if(now-at>TTL||at-now>30000)continue;}
   if(frame.sequence!==undefined){const id=`${frame.func}/${frame.cmd}/${frame.sequence}`;if(this.sequences.has(id))continue;this.sequences.add(id);if(this.sequences.size>256)this.sequences.delete(this.sequences.values().next().value);}
   for(const [key,value] of Object.entries(frame.values)){
    this.values[key]={value,at:now};changed=true;
   }
  }return changed;
 }
 snapshot(now=Date.now()){
  const data={},measurements={};
  for(const key of KEYS){const v=this.values[key];const fresh=v&&now>=v.at&&now-v.at<TTL;data[key]=fresh?v.value:null;measurements[key]=fresh?new Date(v.at).toISOString():null;}
  const times=Object.values(measurements).filter(Boolean).sort();
  return {status:times.length?'ok':'unavailable',identity:IDENTITY,updatedAt:times[0]||null,data:times.length?data:null,measurements,timeBasis:'live MQTT receive time',detail:'Время приёма live MQTT, не часы станции. Отдельная свежесть каждого поля: 2 минуты; кэш и retained исключены.'};
 }
}
function selectMax(auth){
 const serials=auth.serials?.filter(s=>typeof s==='string'&&/^D3N1[A-Z0-9]+$/.test(s));
 if(serials?.length!==1||auth.serials.length!==1)throw new Error('Expected exactly one own DELTA 3 Max');return serials[0];
}
function startEcoflow(publish,{root=path.resolve(__dirname,'../..')}={}){
 if(!E.enabled(root)){publish({status:'unavailable',identity:IDENTITY,updatedAt:null,data:null,detail:'EcoFlow не настроен. Подключение выполняется только после явной настройки в этом приложении.'});return ()=>{};}
 let stopped=false,mqtt=null,retry=null,connecting=false,samples=new Samples(),lastLive=0;
 const state=detail=>publish({status:'unavailable',identity:IDENTITY,updatedAt:null,data:null,detail});
 function reconnect(connection,detail,delay=60000){
  if(stopped||mqtt!==connection)return;
  // Detach first: late close/message events from this socket cannot replace
  // a new session or keep stale measurements alive. Close can itself hang.
  mqtt=null;state(detail);connection.stop();schedule(delay);
 }
 async function connect(){
  if(stopped||connecting)return;connecting=true;
  try{
   const file=E.authPath(root);if(!fs.existsSync(file))throw new Error();
   const auth=await E.loadAuth({root}),sn=selectMax(auth);
   // Validate that the saved device remains in this account before subscribing.
   const devices=JSON.stringify(await E.appGet(auth,'/iot-service/user/device'));
   if(!devices.includes('"'+sn+'"'))throw new Error();
   const c=E.decryptCredentials(auth,await E.appGet(auth,'/iot-auth/enterprise-development/user/certification'));
   if(stopped)return;samples=new Samples();lastLive=Date.now();
   const connection=mqtt=new ReadOnlyMqtt({url:E.broker(c),clientId:E.clientId(auth.userId),username:c.certificateAccount,password:c.certificatePassword,topics:[`/app/device/property/${sn}`]});
   state('Ожидание живой телеметрии станции');
   connection.on('ready',()=>{if(!stopped&&mqtt===connection)state('MQTT подключён, ожидание измерений');});
   connection.on('message',message=>{if(stopped||mqtt!==connection)return;try{if(samples.accept(message)){lastLive=Date.now();publish(samples.snapshot());}}catch{/* Malformed frames never become measurements. */}});
   connection.on('failure',()=>reconnect(connection,'Потеря связи с EcoFlow; повтор подключения через минуту'));
   connection.on('closed',()=>reconnect(connection,'Нет связи с EcoFlow; повтор подключения через минуту'));
  }catch{if(!stopped){state('Нет доступа EcoFlow. Проверьте явную настройку и защищённый вход этого приложения.');schedule();}}
  finally{connecting=false;}
 }
 function schedule(delay=60000){clearTimeout(retry);if(!stopped)retry=setTimeout(connect,delay);}
 const expiry=setInterval(()=>{
  if(stopped||!mqtt?.connected)return;
  // A broker can answer PING while this device's live stream has stopped.
  // Re-subscribe once the same 2-minute freshness window expires. Missing
  // individual fields do not cause reconnects while other live values arrive.
  if(Date.now()-lastLive>=TTL){reconnect(mqtt,'Нет свежей телеметрии EcoFlow; переподключение',0);return;}
  publish(samples.snapshot());
 },3000);
 connect();
 return ()=>{stopped=true;clearInterval(expiry);clearTimeout(retry);mqtt?.stop();};
}
module.exports={Samples,selectMax,startEcoflow};
