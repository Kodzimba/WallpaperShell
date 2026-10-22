'use strict';
const fs=require('node:fs'),path=require('node:path');
const data=path.resolve(__dirname,'../../data');
// Sharing is opt-in and uses a capability explicitly placed in this app's data
// directory. Never discover another application's profile or capability file.
function headers(action='desktop'){
 const config=JSON.parse(fs.readFileSync(path.join(data,'shared-source.json'),'utf8'));
 if(!config||Object.keys(config).join(',')!=='enabled'||config.enabled!==true)throw Error('Shared source is not enabled');
 const key=fs.readFileSync(path.join(data,'shared-source.key'),'utf8').trim();if(!/^[a-f0-9]{64}$/.test(key))throw Error('Shared source unavailable');
 return {Origin:'null','Content-Type':'application/json','X-VioletGhost-Action':action,'X-VioletGhost-Key':key};
}
async function snapshot(){
 const r=await fetch('http://127.0.0.1:8765/status',{headers:headers(),signal:AbortSignal.timeout(1800),redirect:'error'});
 if(!r.ok)throw Error('Shared source unavailable');const s=await r.json();if(s.schemaVersion!==1||!s.sources||typeof s.sources!=='object')throw Error('Shared schema rejected');return s;
}
async function control(action){
 if(!['audio','displays','volume','media'].includes(action.kind))throw Error('Local app action cannot be relayed');
 const r=await fetch('http://127.0.0.1:8765/controls',{method:'POST',headers:headers(),body:JSON.stringify(action),signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!r.ok)throw Error('Shared hardware control failed');const s=await r.json();if(!s.source)throw Error('Missing confirmed state');return s.source;
}
async function speedtest(){
 const r=await fetch('http://127.0.0.1:8765/speedtest',{method:'POST',headers:headers('speedtest'),signal:AbortSignal.timeout(4000),redirect:'error'});
 return {status:r.status,body:await r.text()};
}
module.exports={snapshot,control,speedtest};
