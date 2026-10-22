'use strict';
const fs=require('node:fs'),path=require('node:path');
const M=require('../wallpaper/widget-model.js');
const {authorized}=require('./desktop-controls.cjs');
function failure(message,code){return Object.assign(Error(message),{status:code});}
function createStore(file,io=fs){
 let state={schemaVersion:1,layouts:{},receipts:{}},loadError=false,readOriginal=false;
 try{const original=io.readFileSync(file,'utf8');readOriginal=true;const raw=JSON.parse(original);if(raw.schemaVersion!==1||!raw.layouts||typeof raw.layouts!=='object'||Array.isArray(raw.layouts)||Object.keys(raw).sort().join(',')!=='layouts,receipts,schemaVersion'||!raw.receipts||typeof raw.receipts!=='object'||Array.isArray(raw.receipts))throw Error();let upgraded=false;for(const [key,doc]of Object.entries(raw.layouts)){const clean=M.upgrade(doc);if(key!==M.scope(doc.theme,doc.profile))throw Error();if(clean.schemaVersion!==doc.schemaVersion)upgraded=true;raw.layouts[key]=clean;}for(const [key,ids]of Object.entries(raw.receipts))if(!raw.layouts[key]||!Array.isArray(ids)||ids.length>128||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw Error();if(upgraded){
  // A complete old store is validated before touching the disk. The backup uses
  // exclusive creation so a later restart never replaces the original snapshot.
  const backup=file+(Object.values(JSON.parse(original).layouts).some(doc=>doc.schemaVersion===1)?'.v1-backup':'.v2-backup');
  try{io.writeFileSync(backup,original,{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  io.writeFileSync(file+'.tmp',JSON.stringify(raw,null,2),{mode:0o600});io.renameSync(file+'.tmp',file);
 }state=raw;}catch(error){if(readOriginal||error.code!=='ENOENT')loadError=true;}
 function healthy(){if(loadError)throw failure('Файл раскладок не читается. Сохранение приостановлено; исходный файл сохранён.',503);}
 function save(key,doc,operationId){
  const next={schemaVersion:1,layouts:{...state.layouts,[key]:doc},receipts:{...state.receipts,...(operationId?{[key]:[...(state.receipts[key]||[]),operationId].slice(-128)}:{})}};
  try{io.mkdirSync(path.dirname(file),{recursive:true});io.writeFileSync(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});io.renameSync(file+'.tmp',file);}catch{throw failure('Не удалось записать раскладку на диск.',503);}
  state=next;return M.clone(doc);
 }
 return {
  get(theme,profile){healthy();return M.clone(state.layouts[M.scope(theme,profile)]||null);},
  initialize(candidate){healthy();const doc=M.validate(candidate),key=M.scope(doc.theme,doc.profile);if(state.layouts[key])return M.clone(state.layouts[key]);doc.revision=1;return save(key,doc);},
  update({theme,profile,revision,changes,reset,operationId}){
   healthy();const key=M.scope(theme,profile),current=state.layouts[key];if(!current)throw failure('Layout missing',404);
   if(!Number.isSafeInteger(revision)||revision<0)throw failure('Invalid revision',400);
   if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw failure('Invalid operation id',400);
   if(state.receipts[key]?.includes(operationId))return M.clone(current);
   if(revision!==current.revision)throw Object.assign(failure('Layout changed',409),{document:M.clone(current)});
   if(reset!==undefined&&reset!==true||reset===true&&changes!==undefined)throw failure('Invalid reset',400);
   const doc=reset?M.create(theme,profile):M.patch(current,changes);doc.revision=current.revision+1;return save(key,doc,operationId);
  }
 };
}
function createHandler({key,store}){
 return function handle(req,res,url){
  const send=(code,value)=>res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
  if(!authorized(req,key)){send(403,{error:'Forbidden'});return;}
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
  if(req.method==='GET'){try{const document=store.get(url.searchParams.get('theme'),url.searchParams.get('profile'));send(document?200:404,{document});}catch(e){send(e.status||400,{error:e.message});}return;}
  if(!['POST','PATCH'].includes(req.method)){send(405,{error:'Method not allowed'});return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){send(415,{error:'Expected JSON'});return;}
  let body='',bytes=0,done=false;
  const timer=setTimeout(()=>{if(!done){done=true;send(408,{error:'Request timeout'});}},4000);timer.unref();
  req.on('data',chunk=>{if(done)return;bytes+=Buffer.byteLength(chunk);if(bytes>24000){done=true;clearTimeout(timer);send(413,{error:'Layout too large'});}else body+=chunk;});
  req.on('error',()=>{done=true;clearTimeout(timer);});req.on('aborted',()=>{done=true;clearTimeout(timer);});
  req.on('end',()=>{clearTimeout(timer);if(done)return;done=true;try{const input=JSON.parse(body);if(req.method==='PATCH'&&(!input||Object.keys(input).some(k=>!['theme','profile','revision','changes','reset','operationId'].includes(k))))throw Error('Invalid request');const document=req.method==='POST'?store.initialize(input):store.update(input);send(200,{document});}catch(e){send(e.status||400,{error:e.message,...(e.document?{document:e.document}:{})});}});
 };
}
module.exports={createStore,createHandler};
