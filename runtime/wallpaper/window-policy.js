(function(){
 'use strict';
 const native=!!window.chrome?.webview,panels=new Map(),contexts=new Map(),requests=new Map(),late=new Set(),inert=new Map();
 let panel=null,pendingPanel=null,modal=null,blocked=false,owned=false,active=true,suspended=false,epoch=0,escapeHeld=false,panelSerial=0;
 const uuid=()=>window.crypto?.randomUUID?.()||'00000000-0000-4000-8000-'+Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12);
 const emit=detail=>window.dispatchEvent(new CustomEvent('pg:window-policy',{detail}));
 function restoreFocus(target,reason){if(!['explicit','escape','done'].includes(reason)||!active||suspended||document.hidden||!target?.isConnected||target.disabled)return;for(let at=target;at;at=at.parentElement)if(at.inert||at.hidden)return;target.focus({preventScroll:true});}
 function post(message){window.chrome.webview.postMessage(message);}
 function releaseNative(token){if(native&&token)try{post({type:'window-policy-request',requestId:uuid(),action:'release',token});}catch{}}
 function releaseNativePanel(kind){if(native&&kind)try{post({type:'window-policy-request',requestId:uuid(),action:'panel-close',kind});}catch{}}
 function request(action,kind,token){
  if(!native)return Promise.resolve({ok:true,token:action==='acquire'?uuid():undefined});
  return new Promise((resolve,reject)=>{const requestId=uuid(),timer=setTimeout(()=>{requests.delete(requestId);late.add(requestId);if(late.size>64)late.delete(late.values().next().value);reject(Error('Приложение не подтвердило доступ к окну. Попробуй ещё раз.'));},8000);requests.set(requestId,{resolve,reject,timer,action});try{post({type:'window-policy-request',requestId,action,...(kind?{kind}:{}),...(token?{token}:{})});}catch{clearTimeout(timer);requests.delete(requestId);reject(Error('Нет связи с управлением окнами.'));}});
 }
 function shield(){
  const allowed=modal?.element,protectedNodes=new Set();
  function visit(parent){for(const child of parent.children){if(child===allowed)continue;if(allowed&&child.contains?.(allowed)){visit(child);continue;}protectedNodes.add(child);}}
  if(blocked||modal)visit(document.body);
  for(const [child,value]of inert)if(!protectedNodes.has(child)){child.inert=value;inert.delete(child);}
  for(const child of protectedNodes){if(!inert.has(child))inert.set(child,!!child.inert);child.inert=true;}
  if(!blocked&&!modal){for(const [child,value]of inert)child.inert=value;inert.clear();}
  document.body.classList.toggle('pg-window-blocked',blocked&&!owned);document.body.classList.toggle('pg-window-modal',!!modal);
 }
 function closePanel(kind,reason='explicit'){
  const pending=pendingPanel?.kind===kind;if(pending){pendingPanel=null;panelSerial++;}
  if(panel?.kind!==kind){if(pending){releaseNativePanel(kind);panels.get(kind)?.close?.(reason);}return;}const closing=panel;panel=null;panelSerial++;releaseNativePanel(kind);panels.get(kind)?.close?.(reason);restoreFocus(closing.trigger,reason);
 }
 function closePanels(reason,except){if(pendingPanel&&pendingPanel.kind!==except)closePanel(pendingPanel.kind,reason);if(panel&&panel.kind!==except)closePanel(panel.kind,reason);for(const [kind,p]of panels)if(kind!==except&&p.isOpen?.())p.close?.(reason);}
 async function openPanel(kind,options={}){
  if(!canInteract()||!panels.has(kind))return false;closePanels('replacement',kind);const at=epoch,serial=++panelSerial,entry={kind,trigger:options.trigger||document.activeElement,serial};pendingPanel=entry;
  try{const response=await request('panel',kind);if(!response.ok||at!==epoch||serial!==panelSerial||pendingPanel!==entry||!canInteract())return false;closePanels('replacement',kind);panel={kind,trigger:entry.trigger};if(options.focus)restoreFocus(options.focus,'done');return true;}catch{return false;}finally{if(pendingPanel===entry)pendingPanel=null;}
 }
 function canInteract(){return !blocked&&!modal&&!suspended;}
 async function acquire(kind,options={}){
  if(!canInteract())throw Error('Заверши текущее окно перед следующим действием.');
  const at=epoch,entry={kind,token:null,element:options.element||null,...options,trigger:document.activeElement,pending:true};modal=entry;closePanels('modal');shield();
  try{const response=await request('acquire',kind);if(!response.ok||typeof response.token!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.token))throw Error(response.message||'Другое окно приложения уже ожидает действия.');
   if(modal!==entry||at!==epoch){releaseNative(response.token);throw Error('Открытие окна отменено.');}
   entry.token=response.token;entry.pending=false;
   const lease={token:entry.token,attach(element,handlers={}){if(modal!==entry)return;entry.element=element;Object.assign(entry,handlers);shield();},release(reason='explicit'){if(modal!==entry)return;modal=null;if(owned){blocked=false;owned=false;}releaseNative(entry.token);shield();restoreFocus(entry.trigger,reason);}};entry.lease=lease;shield();return lease;
  }catch(error){if(modal===entry){modal=null;shield();}throw error;}
 }
 function lifecycle(message){
  if(message.event==='surface'){window.PGSurface={...message};delete window.PGSurface.type;delete window.PGSurface.event;}
  if(message.event==='modal-state'){blocked=message.blocked===true;owned=message.owned===true;shield();}
  if(message.event==='panel-close'){const own=window.PGSurface?.surfaceId===message.sourceSurfaceId;if(!own)panelSerial++;closePanels(message.reason||'replacement',own?message.kind:undefined);}
  if(['external','suspend','reset'].includes(message.event)){
   active=false;epoch++;escapeHeld=false;if(message.event==='suspend')suspended=true;closePanels(message.event);
   if(modal?.kind==='power')modal.onExternal?.(message.event);
   if(message.event==='reset'&&modal){const old=modal;modal=null;old.onReset?.();releaseNative(old.token);shield();}
  }
  if(message.event==='resume'){active=true;suspended=false;}
  emit(message);
 }
 if(native)window.chrome.webview.addEventListener('message',event=>{const m=event.data;if(m?.type==='window-policy-result'){
  const waiting=requests.get(m.requestId);if(!waiting){if(late.delete(m.requestId)&&m.ok&&m.token)releaseNative(m.token);return;}requests.delete(m.requestId);clearTimeout(waiting.timer);waiting.resolve(m);
 }else if(m?.type==='window-policy')lifecycle(m);});
 window.addEventListener('focus',()=>{active=true;});window.addEventListener('blur',()=>{active=false;escapeHeld=false;});
 if(!native)window.addEventListener('blur',()=>lifecycle({event:'external'}));
 window.addEventListener('pagehide',()=>{epoch++;closePanels('reset');if(modal){releaseNative(modal.token);modal=null;}for(const [id,p]of requests){clearTimeout(p.timer);late.add(id);p.reject(Error('Окно закрыто.'));}requests.clear();blocked=false;owned=false;suspended=false;escapeHeld=false;shield();});
 window.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
   const present=!!modal||blocked||!!pendingPanel||!!panel||[...contexts.values()].some(p=>p.isOpen());if(!present)return;
   event.preventDefault();event.stopImmediatePropagation();if(escapeHeld||event.repeat)return;escapeHeld=true;
   if(modal){if(!modal.pending)modal.onEscape?.();return;}if(blocked)return;
   if(pendingPanel){closePanel(pendingPanel.kind,'escape');return;}
   if(panel){const p=panels.get(panel.kind);if(p?.escape)p.escape();else closePanel(panel.kind,'escape');return;}
   const top=[...contexts.values()].reverse().find(p=>p.isOpen());top?.escape?.(event);return;
  }
  if(event.key==='Tab'&&modal){event.preventDefault();event.stopImmediatePropagation();const list=(modal.focusables?.()||[...modal.element?.querySelectorAll?.('button,input,select,textarea,[tabindex]')||[]]).filter(el=>!el.disabled&&!el.hidden&&!el.inert);const at=list.indexOf(document.activeElement),index=event.shiftKey?(at<=0?list.length-1:at-1):(at+1)%list.length;list[index]?.focus({preventScroll:true});}
 },true);
 window.addEventListener('keyup',event=>{if(event.key==='Escape')escapeHeld=false;},true);
 window.addEventListener('pointerdown',event=>{if(pendingPanel&&!pendingPanel.trigger?.contains(event.target))closePanel(pendingPanel.kind,'outside');},true);
 function guard(event){if(!(blocked||modal)||modal?.element?.contains(event.target))return;event.preventDefault();event.stopImmediatePropagation();}
 for(const name of ['click','dblclick','contextmenu','pointerdown','mousedown','wheel','input','change','keydown'])window.addEventListener(name,guard,true);
 window.PGWindows={registerPanel(kind,options){panels.set(kind,options);return()=>panels.delete(kind);},registerContext(kind,options){contexts.set(kind,options);return()=>contexts.delete(kind);},openPanel,closePanel,releasePanel(kind){let released=false;if(pendingPanel?.kind===kind){pendingPanel=null;panelSerial++;released=true;}if(panel?.kind===kind){panel=null;panelSerial++;released=true;}if(released)releaseNativePanel(kind);},acquire,canInteract,restoreFocus,lifecycle,isNative:()=>native,diagnostics:()=>({mounted:true,activePanel:panel?.kind||null,pendingPanel:pendingPanel?.kind||null,modal:modal?.kind||null,pending:!!modal?.pending||!!pendingPanel,blocked,owned,active,suspended,surface:window.PGSurface||null})};
})();
