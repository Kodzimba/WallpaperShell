'use strict';
// Preparation for the official DELTA 3 MAX API. Only GET is implemented.
// Cloud quota caches have no guaranteed acquisition time; they are not live UI measurements.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function flatten(value,prefix='',out={}){
 for(const [key,item] of Object.entries(value)){
  const field=prefix?`${prefix}.${key}`:key;
  if(Array.isArray(item))item.forEach((v,i)=>typeof v==='object'&&v!==null?flatten(v,`${field}[${i}]`,out):out[`${field}[${i}]`]=v);
  else if(item!==null&&typeof item==='object')flatten(item,field,out);else out[field]=item;
 }return out;
}
function headers(config,parameters={},nonce=crypto.randomInt(100000,1000000),timestamp=Date.now()){
 const values=flatten(parameters),query=Object.keys(values).sort().map(k=>`${k}=${values[k]}`).join('&');
 const auth=`accessKey=${config.accessKey}&nonce=${nonce}&timestamp=${timestamp}`;
 return {accessKey:config.accessKey,nonce:String(nonce),timestamp:String(timestamp),sign:crypto.createHmac('sha256',config.secretKey).update(query?query+'&'+auth:auth).digest('hex')};
}
function configPath(root=path.resolve(__dirname,'../..')){return path.join(root,'data/ecoflow.json');}
function readConfig(root){const file=configPath(root);if(fs.statSync(file).size>8192)throw new Error('EcoFlow configuration invalid');const c=JSON.parse(fs.readFileSync(file,'utf8'));if(c.enabled!==true||typeof c.accessKey!=='string'||!c.accessKey||typeof c.secretKey!=='string'||!c.secretKey||!/^D3N1[A-Z0-9]+$/i.test(c.sn))throw new Error('Expected explicit opt-in, own DELTA 3 MAX serial and Developer API keys');return c;}
async function get(config,endpoint,params={}){
 if(!['/iot-open/sign/device/list','/iot-open/sign/device/quota/all','/iot-open/sign/certification'].includes(endpoint))throw new Error('Read-only path rejected');
 const url=new URL(endpoint,'https://api.ecoflow.com');Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
 const r=await fetch(url,{method:'GET',headers:headers(config,params),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok)throw new Error('EcoFlow HTTP '+r.status);const result=await r.json();if(String(result.code)!=='0')throw new Error('EcoFlow rejected read request');return result;
}
function mapDeltaMax(data,measurementAt){
 if(!Number.isFinite(Date.parse(measurementAt)))throw new Error('Verified device acquisition time required');
 const number=k=>typeof data[k]==='number'&&Number.isFinite(data[k])&&data[k]>=0?data[k]:null;
 const soc=number('cmsBattSoc');
 return {status:'ok',updatedAt:new Date(measurementAt).toISOString(),identity:'EcoFlow official API / DELTA 3 MAX / firmware v7.80.98.26',data:{batteryPercent:soc!==null&&soc<=100?soc:null,inputWatts:number('powInSumW'),outputWatts:number('powOutSumW')}};
}
module.exports={flatten,headers,configPath,readConfig,get,mapDeltaMax};
