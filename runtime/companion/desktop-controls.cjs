'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const origins=new Set(['null','file://','http://127.0.0.1:8767','http://localhost:8767']);
function validAction(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=Object.keys(value),choices={audio:['headphones','speakers','tv'],displays:['single','dual'],theme:['paper-green','classic','luna-blue'],workspace:['desktop']};
 if(value.kind==='appearance')return (keys.sort().join(',')==='accent,kind,mode'||keys.sort().join(',')==='accent,kind,mode,theme'&&value.theme==='luna-blue')&&require('./appearance.cjs').valid(value);
 if(Object.hasOwn(choices,value.kind))return keys.length===2&&choices[value.kind].includes(value.value);
 if(value.kind==='media')return keys.length===3&&['play','pause','previous','next'].includes(value.value)&&typeof value.session==='string'&&/^[a-f0-9]{64}$/.test(value.session);
 if(value.kind==='volume')return keys.length===3&&Number.isInteger(value.value)&&value.value>=0&&value.value<=100&&typeof value.target==='string'&&/^[a-f0-9]{64}$/.test(value.target);
 return false;
}
function authorized(req,key,action='desktop'){
 const supplied=req.headers['x-violetghost-key'];
 return (!req.headers.origin||origins.has(req.headers.origin))&&req.headers['x-violetghost-action']===action&&typeof supplied==='string'&&/^[a-f0-9]{64}$/.test(supplied)&&crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(key));
}
function localKey(root){
 const directory=path.resolve(root,'../data/private'),file=path.join(directory,'control.key');let key;
 if(!fs.existsSync(directory)||fs.lstatSync(directory).isSymbolicLink())throw Error('Start WallpaperShell to initialize private storage.');
 if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Private capability path is not a regular file.');
 try{key=fs.readFileSync(file,'utf8');}catch{}
 if(typeof key!=='string'||key.length!==64||!/^[a-f0-9]{64}$/.test(key)){key=crypto.randomBytes(32).toString('hex');fs.writeFileSync(file,key,{mode:0o600});}
 // Injected by the exact trusted native documents; never served over HTTP.
 return key;
}
function createHandler({key,dispatch}){
 let busy=false;
 return function handle(req,res){
  if(req.headers.origin&&!origins.has(req.headers.origin)){res.writeHead(403).end();return;}
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-VioletGhost-Action, X-VioletGhost-Key');res.writeHead(204).end();return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  if(!authorized(req,key)){res.writeHead(403).end();return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){res.writeHead(415).end();return;}
  if(busy){res.writeHead(409).end();return;}
  let body='',bytes=0,done=false;
  const timer=setTimeout(()=>{done=true;res.writeHead(408).end();},4000);timer.unref();
  req.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>1024){done=true;clearTimeout(timer);res.writeHead(413).end();}else body+=chunk;});
  req.on('error',()=>{done=true;clearTimeout(timer);});
  req.on('end',async()=>{
   clearTimeout(timer);if(done)return;
   let action;try{action=JSON.parse(body);if(!validAction(action))throw Error();}catch{res.writeHead(400).end();return;}
   if(busy){res.writeHead(409).end();return;}busy=true;
   try{const source=await dispatch(action);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({source}));}
   catch{res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'Windows не подтвердила переключение. Попробуй ещё раз.'}));}
   finally{busy=false;}
  });
 };
}
module.exports={validAction,authorized,localKey,createHandler};
