(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PGLayoutFileBridge=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function create({post,uuid}){
  let active=null;
  function cancel(){if(active){const pending=active;active=null;pending.resolve({status:'cancelled',action:pending.action});}}
  function receive(message){
   if(message?.type!=='layout-file-result'||!active||message.requestId!==active.requestId)return;
   const pending=active;active=null;
   if(message.action!==pending.action||!['ok','cancelled','error'].includes(message.status)||message.status==='ok'&&pending.action==='open'&&(typeof message.content!=='string'||message.content.length>32768)){
    pending.resolve({status:'error',action:pending.action,message:'Приложение вернуло некорректный ответ.'});return;
   }
   pending.resolve({status:message.status,action:pending.action,...(pending.action==='open'&&message.status==='ok'?{content:message.content}:{}),...(typeof message.filename==='string'?{filename:message.filename.slice(0,255)}:{}),...(typeof message.message==='string'?{message:message.message.slice(0,400)}:{})});
  }
  return {receive,cancel,isBusy:()=>!!active,request(action,content){
   if(active)return Promise.reject(Error('Заверши выбор файла в открытом окне Windows.'));
   if(!['open','save'].includes(action)||action==='save'&&(typeof content!=='string'||new TextEncoder().encode(content).length>32768)||action==='open'&&content!==undefined)return Promise.reject(Error('Некорректный запрос файла раскладки.'));
   return new Promise((resolve,reject)=>{const requestId=uuid();active={requestId,action,resolve};try{post({type:'layout-file-request',requestId,action,...(action==='save'?{content}:{})});}catch{active=null;reject(Error('Не удалось открыть окно выбора файла.'));}});
  }};
 }
 return {create};
});
if(typeof window!=='undefined'&&window.PG_APP&&window.chrome?.webview){
 const bridge=window.PGLayoutFileBridge.create({post:message=>window.chrome.webview.postMessage(message),uuid:()=>window.crypto.randomUUID()});
 window.chrome.webview.addEventListener('message',event=>bridge.receive(event.data));
 window.addEventListener('pagehide',()=>bridge.cancel());
 // Display/DPI recovery can reset the workflow without navigating this WebView.
 // Native invalidates its generation and intentionally drops the old result.
 window.addEventListener('pg:window-policy',event=>{if(event.detail?.event==='reset')bridge.cancel();});
 window.PGLayoutFiles={open:()=>bridge.request('open'),save:content=>bridge.request('save',content),isBusy:bridge.isBusy};
}
