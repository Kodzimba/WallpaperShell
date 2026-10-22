'use strict';
const crypto=require('node:crypto'),path=require('node:path'),{execFile}=require('node:child_process');
const {authorized}=require('./desktop-controls.cjs');
const origins=new Set(['null','file://','http://127.0.0.1:8767','http://localhost:8767']);
const choices=new Set(['shutdown','restart']);
function validAction(a){
 if(!a||typeof a!=='object'||Array.isArray(a))return false;
 const keys=Object.keys(a).sort().join(','),token=typeof a.confirmation==='string'&&/^[a-f0-9]{64}$/.test(a.confirmation);
 return a.action==='prepare'&&keys==='action,value'&&choices.has(a.value)||a.action==='confirm'&&keys==='action,confirmation,value'&&choices.has(a.value)&&token||a.action==='cancel'&&keys==='action,confirmation'&&token;
}
function command(value){if(!choices.has(value))throw Error('Unknown power action');return {file:path.join(process.env.SystemRoot||'C:\\Windows','System32','shutdown.exe'),args:[value==='shutdown'?'/s':'/r','/t','0']};}
function executePower(value){
 const {file,args}=command(value);
 // /t > 0 implies /f in shutdown.exe. Zero + no /f preserves normal app handling.
 return new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:5000,maxBuffer:16384},error=>error?reject(Error('Windows rejected power action')):resolve()));
}
function createHandler({key,execute=executePower,now=Date.now}){
 const pending=new Map();let busy=false,blockedUntil=0;
 return (req,res)=>{
  if(req.headers.origin&&!origins.has(req.headers.origin)){res.writeHead(403).end();return;}
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-VioletGhost-Action, X-VioletGhost-Key');res.writeHead(204).end();return;}
  if(!authorized(req,key)){res.writeHead(403).end();return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){res.writeHead(415).end();return;}
  const reply=(status,payload)=>res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(payload));
  if(busy||now()<blockedUntil){reply(409,{error:'Запрос уже выполняется. Подожди несколько секунд.'});return;}
  let body='',bytes=0,done=false;const timer=setTimeout(()=>{done=true;res.writeHead(408).end();},4000);timer.unref();
  req.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>1024){done=true;clearTimeout(timer);res.writeHead(413).end();}else body+=chunk;});
  req.on('error',()=>{done=true;clearTimeout(timer);});
  req.on('end',async()=>{
   clearTimeout(timer);if(done)return;let a;try{a=JSON.parse(body);if(!validAction(a))throw Error();}catch{reply(400,{error:'Недопустимое действие'});return;}
   if(busy||now()<blockedUntil){reply(409,{error:'Запрос уже выполняется. Подожди несколько секунд.'});return;}
   for(const [id,entry] of pending)if(entry.expiresAt<=now())pending.delete(id);
   if(a.action==='cancel'){pending.delete(a.confirmation);reply(200,{cancelled:true});return;}
   if(a.action==='prepare'){
    if(pending.size>=4){reply(429,{error:'Закрой предыдущее подтверждение и попробуй снова.'});return;}
    const confirmation=crypto.randomBytes(32).toString('hex'),expiresAt=now()+30000;pending.set(confirmation,{value:a.value,expiresAt});reply(200,{confirmation,value:a.value,expiresAt});return;
   }
   const entry=pending.get(a.confirmation);pending.delete(a.confirmation);
   if(!entry||entry.value!==a.value){reply(409,{error:'Подтверждение устарело. Нажми кнопку ещё раз.'});return;}
   busy=true;pending.clear();
   try{await execute(a.value);blockedUntil=now()+10000;reply(202,{accepted:true,value:a.value});}
   catch{reply(503,{error:'Windows не подтвердила действие. Компьютер может требовать внимания.'});}
   finally{busy=false;}
  });
 };
}
module.exports={validAction,command,executePower,createHandler};
