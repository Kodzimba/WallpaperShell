(function(){
 'use strict';
 const $=id=>document.getElementById(id),overlay=$('powerOverlay'),cancel=$('powerCancel'),confirm=$('powerConfirm');
 const buttons={shutdown:$('powerShutdown'),restart:$('powerRestart')};
 if(window.PGWindows)document.body.append(overlay);
 let bridge='',connected=false,paused=false,editing=false,pending=null,busy=false,reserving=false,generation=0,expiry=null,previousFocus=null,lease=null;
 function endpoint(){try{const u=new URL(bridge);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='8767'||u.username||u.password||!window.VG_LOCAL_CONTROL_KEY)return null;u.pathname='/power';u.search='';u.hash='';return u.href;}catch{return null;}}
 function render(){for(const button of Object.values(buttons))button.disabled=!connected||!endpoint()||paused||editing||busy||reserving||!overlay.hidden;}
 async function request(body){
  const url=endpoint();if(!url)throw Error('Нет связи с помощником');
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),credentials:'omit',redirect:'error'});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Windows не подтвердила действие');return result;
 }
 function revoke(token){if(token)request({action:'cancel',confirmation:token}).catch(()=>{});}
 function dismiss(reason='explicit'){
  if(busy)return;generation++;clearTimeout(expiry);revoke(pending?.confirmation);pending=null;overlay.hidden=true;confirm.disabled=true;reserving=false;render();
  if(lease){const held=lease;lease=null;held.release(reason);}else if(!window.PGWindows&&['explicit','escape'].includes(reason)&&previousFocus&&!previousFocus.disabled)previousFocus.focus({preventScroll:true});previousFocus=null;
 }
 function close(reason='explicit'){if(busy)return;dismiss(typeof reason==='string'?reason:'explicit');}
 async function prepare(value){
  if(buttons[value].disabled||!overlay.hidden||busy)return;
  const at=++generation;previousFocus=document.activeElement;pending=null;reserving=true;render();
  if(window.PGWindows)try{const held=await window.PGWindows.acquire('power',{element:overlay,onEscape:()=>close('escape'),onExternal:()=>close('external'),onReset:()=>close('reset'),focusables:()=>[cancel,confirm].filter(el=>!el.disabled)});if(at!==generation){held.release('stale');return;}lease=held;}catch{reserving=false;render();return;}
  if(at!==generation)return;reserving=false;overlay.hidden=false;confirm.disabled=true;
  $('powerTitle').textContent=value==='shutdown'?'Выключить компьютер?':'Перезагрузить компьютер?';
  $('powerDialogSymbol').setAttribute('href',value==='shutdown'?'#i-pc-shutdown':'#i-pc-restart');
  $('powerDescription').textContent='Открытые программы будут закрыты. Сохрани работу перед подтверждением.';
  confirm.textContent=value==='shutdown'?'Да, выключить':'Да, перезагрузить';$('powerStatus').textContent='Подготовка подтверждения…';render();cancel.focus({preventScroll:true});
  try{
   const result=await request({action:'prepare',value});
   if(at!==generation){revoke(result.confirmation);return;}
   if(result.value!==value||!/^[a-f0-9]{64}$/.test(result.confirmation)||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now())throw Error('Не удалось подготовить подтверждение');
   pending={value,confirmation:result.confirmation};confirm.disabled=false;$('powerStatus').textContent='Действие начнётся только после подтверждения.';
   expiry=setTimeout(()=>{if(at!==generation)return;revoke(pending?.confirmation);pending=null;confirm.disabled=true;$('powerStatus').textContent='Подтверждение устарело. Нажми «Отмена» и попробуй снова.';},Math.min(30000,result.expiresAt-Date.now()));
  }catch(error){if(at===generation){confirm.disabled=true;$('powerStatus').textContent=error.message||'Нет связи с помощником';}}
 }
 async function execute(){
  if(busy||confirm.disabled||!pending||overlay.hidden)return;
  const action=pending;pending=null;clearTimeout(expiry);busy=true;confirm.disabled=true;cancel.disabled=true;render();$('powerStatus').textContent='Запрос отправляется в Windows…';
  try{const result=await request({action:'confirm',...action});if(!result.accepted||result.value!==action.value)throw Error('Windows не подтвердила действие');$('powerStatus').textContent='Запрос принят Windows.';}
  catch(error){$('powerStatus').textContent=error.message||'Не удалось получить ответ Windows';}
  finally{busy=false;cancel.disabled=false;cancel.textContent='Закрыть';render();if(window.PGWindows)window.PGWindows.restoreFocus(cancel,'done');else cancel.focus({preventScroll:true});}
 }
 for(const [value,button] of Object.entries(buttons))button.addEventListener('click',()=>{cancel.textContent='Отмена';prepare(value);});
 cancel.addEventListener('click',()=>close('explicit'));confirm.addEventListener('click',execute);overlay.addEventListener('click',event=>{if(event.target===overlay){event.preventDefault();event.stopPropagation();close('outside');}});
 document.addEventListener('keydown',event=>{
  if(overlay.hidden||window.PGWindows)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}
  if(event.key==='Tab'){event.preventDefault();const next=document.activeElement===cancel&&!confirm.disabled?confirm:cancel;if(!next.disabled)next.focus({preventScroll:true});}
 },true);
 window.addEventListener('blur',()=>{if(!window.PGWindows)close('external');});window.addEventListener('pagehide',()=>close('reset'));
 window.VGPower={render(source,url){if(typeof url==='string'&&bridge!==url){close('replacement');bridge=url;}connected=window.VGCore.sourceState(source,Date.now(),15000)==='ok';if(!connected)close('unavailable');render();},setPaused(value){paused=!!value;if(paused)close('suspend');render();},setEditing(value){editing=!!value;if(editing)close('editor');render();}};
 render();
})();
