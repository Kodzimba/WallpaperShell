'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const appRoot=()=>path.resolve(__dirname,'../..');
function authPath(root=appRoot()){return path.join(root,'data/ecoflow-app-auth.txt');}
function enabled(root=appRoot(),io=fs){try{const file=path.join(root,'data/ecoflow-app.json');if(io.statSync(file).size>1024)return false;const value=JSON.parse(io.readFileSync(file,'utf8'));return value?.enabled===true&&Object.keys(value).join(',')==='enabled';}catch{return false;}}
async function loadAuth({root=appRoot(),execFileProcess=execFile}={}){
 if(!enabled(root))throw new Error('EcoFlow is not configured');
 const script="$ErrorActionPreference='Stop';$s=Get-Content -LiteralPath $env:WS_ECOFLOW_AUTH_PATH -Raw;$v=ConvertTo-SecureString ($s.Trim());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($v);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p);$v.Dispose()}";
 const psRoot=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0');
 // A Node launched from PowerShell 7 inherits incompatible module search paths.
 const stdout=await new Promise((resolve,reject)=>execFileProcess(path.join(psRoot,'powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,PSModulePath:path.join(psRoot,'Modules'),WS_ECOFLOW_AUTH_PATH:authPath(root)},windowsHide:true,timeout:10000,maxBuffer:32768},(error,out)=>error?reject(new Error('EcoFlow protected login unavailable')):resolve(out)));
 let auth;try{auth=JSON.parse(stdout);}catch{throw new Error('EcoFlow protected login invalid');}
 if(!['https://api-e.ecoflow.com','https://api.ecoflow.com'].includes(auth.baseUrl)||typeof auth.token!=='string'||!/^\d+$/.test(auth.userId||''))throw new Error('EcoFlow login fields invalid');
 return auth;
}
async function appGet(auth,endpoint){
 if(!['/iot-service/user/device','/iot-auth/enterprise-development/user/certification'].includes(endpoint))throw new Error('EcoFlow read path rejected');
 const r=await fetch(new URL(endpoint,auth.baseUrl),{headers:{Authorization:'Bearer '+auth.token},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!r.ok)throw new Error('EcoFlow HTTP '+r.status);
 const body=await r.json();if(String(body.code)!=='0')throw new Error('EcoFlow API code '+String(body.code).replace(/[^\d-]/g,'').slice(0,10));return body.data;
}
function decryptCredentials(auth,data){
 if(typeof data==='string'){
  const d=crypto.createDecipheriv('aes-256-cfb',crypto.createHash('sha256').update(auth.token).digest(),Buffer.from('ojsajkqjwk1w2dfg'));
  let bytes=Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]);
  const n=bytes.at(-1);if(n>0&&n<=16&&bytes.subarray(-n).every(b=>b===n))bytes=bytes.subarray(0,-n);
  try{data=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('EcoFlow certificate invalid');}
 }
 const account=data?.certificateAccount??data?.userName,password=data?.certificatePassword??data?.password;
 if(typeof account!=='string'||typeof password!=='string')throw new Error('EcoFlow MQTT credentials unavailable');
 return {...data,certificateAccount:account,certificatePassword:password};
}
function broker(credentials){
 const raw=String(credentials.url||'mqtt-e.ecoflow.com').replace(/^[a-z]+:\/\//i,'');
 const u=new URL('wss://'+raw);
 if(!/^mqtt[a-z0-9.-]*\.ecoflow\.com$/i.test(u.hostname)||u.username||u.password)throw new Error('Unexpected EcoFlow broker');
 return `wss://${u.hostname}:8084/mqtt`;
}
function clientId(userId){
 // Public Portal client pair from the vendor web client; these are not account credentials.
 const base=`WEB_${crypto.randomUUID()}_${userId}`,at=Date.now();
 const hash=crypto.createHash('md5').update('aed8900fd005458cb41a762ffe375e1b'+base+at).digest('hex').toUpperCase();
 return `${base}_e80b6010a485434a806e5e531479a37c_${at}_${hash}`;
}
module.exports={authPath,enabled,loadAuth,appGet,decryptCredentials,broker,clientId};
