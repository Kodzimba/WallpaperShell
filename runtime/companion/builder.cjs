'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../wallpaper/custom-widget-model.js'),{authorized}=require('./desktop-controls.cjs');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function scope(theme,profile){return C.create(theme,profile).theme+':'+profile;}
function createStore(file,io=fs){
 let state={version:1,documents:{},receipts:{}},broken=false;
 try{const raw=JSON.parse(io.readFileSync(file,'utf8'));if(!raw||Object.keys(raw).sort().join(',')!=='documents,receipts,version'||raw.version!==1||!raw.documents||typeof raw.documents!=='object'||Array.isArray(raw.documents)||!raw.receipts||typeof raw.receipts!=='object'||Array.isArray(raw.receipts))throw Error();for(const [key,value]of Object.entries(raw.documents))if(scope(value.theme,value.profile)!==key||!C.document(value))throw Error();for(const [key,ids]of Object.entries(raw.receipts))if(!Object.hasOwn(raw.documents,key)||!Array.isArray(ids)||ids.length>128||ids.some(id=>!/^[a-f0-9-]{36}$/.test(id)))throw Error();state=raw;}catch(error){if(error.code!=='ENOENT')broken=true;}
 const healthy=()=>{if(broken)throw fail('Файл своих виджетов не читается. Исходный файл сохранён.',503);};
 return {get(theme,profile){healthy();const key=scope(theme,profile);return C.clone(state.documents[key]||C.create(theme,profile));},replace(input){
  healthy();if(!input||Object.keys(input).sort().join(',')!=='items,operationId,profile,revision,theme'||typeof input.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(input.operationId))throw fail('Неверный запрос конструктора.');
  const key=scope(input.theme,input.profile),current=this.get(input.theme,input.profile);if(state.receipts[key]?.includes(input.operationId))return current;
  if(input.revision!==current.revision)throw Object.assign(fail('Свои виджеты изменились в другом окне. Повтори действие.',409),{document:current});
  const doc=C.document({version:1,theme:input.theme,profile:input.profile,revision:current.revision+1,items:input.items}),next={version:1,documents:{...state.documents,[key]:doc},receipts:{...state.receipts,[key]:[...(state.receipts[key]||[]),input.operationId].slice(-128)}};
  try{io.mkdirSync(path.dirname(file),{recursive:true});io.writeFileSync(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});io.renameSync(file+'.tmp',file);}catch{throw fail('Не удалось сохранить свои виджеты на диск.',503);}state=next;return C.clone(doc);
 }};
}
function createHandler({key,store,agent,canAct=()=>true,now=Date.now}){
 const jobs=new Map();
 function cleanJobs(){for(const [id,job]of jobs)if(job.state!=='running'&&now()-job.at>600000)jobs.delete(id);}
 function handler(req,res,url){
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));};
  if(!authorized(req,key)){send(403,{error:'Forbidden'});return;}if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');cleanJobs();
  if(req.method==='GET'){
   try{if(url.pathname==='/builder/chat'){const job=jobs.get(url.searchParams.get('id'));if(!job)throw fail('Запрос помощника не найден.',404);send(200,{...job});return;}send(200,{document:store.get(url.searchParams.get('theme'),url.searchParams.get('profile')),agent:agent.status()});}catch(error){send(error.status||400,{error:error.message});}return;
  }
  if(!['PUT','POST'].includes(req.method)){send(405,{error:'Method not allowed'});return;}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){send(415,{error:'Expected JSON'});return;}
  let body='',bytes=0,ended=false;const timer=setTimeout(()=>{if(!ended){ended=true;send(408,{error:'Request timeout'});}},5000);timer.unref();
  req.on('data',part=>{if(ended)return;bytes+=Buffer.byteLength(part);if(bytes>384000){ended=true;clearTimeout(timer);send(413,{error:'Запрос слишком большой.'});}else body+=part;});req.on('aborted',()=>{ended=true;clearTimeout(timer);});req.on('error',()=>{ended=true;clearTimeout(timer);});
  req.on('end',()=>{clearTimeout(timer);if(ended)return;ended=true;try{
   const input=JSON.parse(body);if(!canAct())throw fail('Сначала заверши открытый диалог приложения.',409);
   if(url.pathname==='/builder'&&req.method==='PUT'){send(200,{document:store.replace(input)});return;}
   if(url.pathname==='/builder/chat'&&req.method==='POST'){
    if(!input||Object.keys(input).sort().join(',')!=='messages,profile,theme,widget')throw fail('Неверный запрос чата.');scope(input.theme,input.profile);
    const id=crypto.randomUUID(),job={id,theme:input.theme,profile:input.profile,state:'running',progress:'Подключаю Codex…',at:now(),answer:null,widget:null,error:null};
    const work=agent.chat(input.messages,input.widget,message=>{job.progress=message;});jobs.set(id,job);
    Promise.resolve(work).then(result=>{if(job.state!=='running')return;job.state='done';job.answer=result.answer;job.widget=result.widget;job.at=now();},()=>{if(job.state!=='running')return;job.state='error';job.error='Codex не смог ответить. Проверь вход и доступные лимиты в Codex, затем повтори запрос.';job.at=now();});send(202,{id,state:job.state});return;
   }
   if(url.pathname==='/builder/chat/cancel'&&req.method==='POST'){
    if(!input||Object.keys(input).join(',')!=='id'||typeof input.id!=='string')throw fail('Неверный запрос остановки.');const job=jobs.get(input.id);if(!job)throw fail('Запрос помощника не найден.',404);if(job.state==='running'){job.state='cancelled';job.at=now();agent.stop();}send(200,{state:job.state});return;
   }
   send(405,{error:'Method not allowed'});
  }catch(error){send(error.status||400,{error:error.message,...(error.document?{document:error.document}:{})});}});
 }
 handler.stop=()=>agent.stop();return handler;
}
module.exports={createStore,createHandler};

