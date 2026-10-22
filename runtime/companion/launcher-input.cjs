'use strict';
// Ephemeral, authenticated wheel delivery for a visible desktop menu. No input log.
const {authorized}=require('./desktop-controls.cjs');
const crypto=require('node:crypto');
const idPattern=/^[a-f0-9]{32}$/;
function validRegion(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!idPattern.test(value.id||''))return false;
 if(Object.keys(value).sort().join(',')==='id,release')return value.release===true;
 if(Object.keys(value).sort().join(',')!=='height,id,rect,width')return false;
 const {width,height,rect}=value;
 return Number.isInteger(width)&&width>=320&&width<=16384&&Number.isInteger(height)&&height>=240&&height<=16384&&Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect.every(n=>n>=0&&n<=1)&&rect[0]<rect[2]&&rect[1]<rect[3];
}
function createInputBridge({key,enabled,updateNative,now=Date.now}){
 const regions=new Map(),waiting=new Map(),counts=new Map(),stream=crypto.randomBytes(8).toString('hex');let available=false,sequence=0,stopped=false;
 function reply(id,events=[]){const pending=waiting.get(id);if(!pending)return;waiting.delete(id);clearTimeout(pending.timer);pending.res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({stream,events}));}
 function sync(){
  const time=now();for(const [id,r] of regions)if(r.expires<=time||!enabled()){regions.delete(id);reply(id);}
  updateNative(available?[...regions.values()].map(({id,width,height,rect,expires})=>({id,width,height,rect,expires})):[]);
 }
 function remove(id){regions.delete(id);reply(id);sync();}
 function register(value){
  if(value.release){remove(value.id);return true;}
  if(!available||!enabled())return false;
  sync();if(!regions.has(value.id)&&regions.size>=4)return false;
  const old=regions.get(value.id);regions.set(value.id,{...value,expires:now()+4000,events:old?.events||[],forwarded:old?.forwarded||0});sync();return true;
 }
 function push(event){
  const r=regions.get(event?.id);if(!available||!enabled()||!r||r.expires<=now()||!Number.isInteger(event.delta)||!event.delta||Math.abs(event.delta)>32768)return;
  const item={seq:++sequence,delta:event.delta,at:now()};r.forwarded++;const size=r.width+'x'+r.height;if(counts.has(size)||counts.size<16)counts.set(size,(counts.get(size)||0)+1);r.events.push(item);r.events=r.events.filter(e=>now()-e.at<1000).slice(-32);reply(r.id,[item]);
 }
 function setAvailable(value){available=value===true;sync();if(!available)for(const id of waiting.keys())reply(id);}
 const timer=setInterval(sync,1000);timer.unref();
 function handler(req,res){
  const origin=req.headers.origin;if(origin&&!['null','file://','http://127.0.0.1:8767','http://localhost:8767'].includes(origin)){res.writeHead(403).end();return;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-VioletGhost-Action, X-VioletGhost-Key');res.writeHead(204).end();return;}
  if(!authorized(req,key)){res.writeHead(403).end();return;}
  if(stopped){res.writeHead(503).end();return;}
  if(req.method==='GET'){
   const url=new URL(req.url,'http://127.0.0.1'),id=url.searchParams.get('id');
   if(!id){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({available,counts:Object.fromEntries(counts),clients:[...regions.values()].map(r=>({width:r.width,height:r.height,forwarded:r.forwarded}))}));return;}
   const after=Number(url.searchParams.get('after')||0),r=regions.get(id);
   if(!idPattern.test(id)||!Number.isSafeInteger(after)||after<0){res.writeHead(400).end();return;}
   if(!available||!enabled()||!r||r.expires<=now()){res.writeHead(409).end();return;}
   const events=r.events.filter(e=>e.seq>after&&now()-e.at<1000);
   if(events.length){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({stream,events}));return;}
   reply(id);const pending={res,timer:setTimeout(()=>reply(id),20000)};pending.timer.unref();waiting.set(id,pending);
   res.on('close',()=>{if(waiting.get(id)===pending){waiting.delete(id);clearTimeout(pending.timer);}});return;
  }
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){res.writeHead(415).end();return;}
  let size=0,body='',done=false;const timeout=setTimeout(()=>{done=true;res.writeHead(408).end();},4000);timeout.unref();
  req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>1024){done=true;clearTimeout(timeout);res.writeHead(413).end();}else body+=chunk;});
  req.on('error',()=>{done=true;clearTimeout(timeout);});
  req.on('end',()=>{clearTimeout(timeout);if(done)return;let value;try{value=JSON.parse(body);if(!validRegion(value))throw Error();}catch{res.writeHead(400).end();return;}res.writeHead(register(value)?204:503).end();});
 }
 function stop(){stopped=true;clearInterval(timer);regions.clear();for(const id of waiting.keys())reply(id);updateNative([]);}
 return {handler,push,setAvailable,stop,register};
}
module.exports={validRegion,createInputBridge};
