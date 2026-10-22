(function(){
 'use strict';
 const $=id=>document.getElementById(id),C=window.VGCore;
 let media=null,desktop=null,bridge='',busy=false,dragging=false,errorUntil=0,pendingVolume=null;
 const newer=(old,next)=>next===null||!old||Date.parse(next?.updatedAt)>=Date.parse(old.updatedAt)?next:old;
 function render(m,d,url){
  if(m!==undefined)media=newer(media,m);if(d!==undefined)desktop=newer(desktop,d);if(typeof url==='string')bridge=url;
  let endpoint;try{endpoint=new URL(bridge);}catch{}
  const local=!!window.VG_LOCAL_CONTROL_KEY&&endpoint?.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)&&endpoint.port==='8767';
  const session=C.sourceState(media,Date.now(),15000)==='ok'?media.data:null,volume=C.sourceState(desktop,Date.now(),15000)==='ok'?desktop.data?.volume:null;
  const ready=local&&!busy&&!!session?.title&&/^[a-f0-9]{64}$/.test(session?.session||''),playing=session?.playback==='playing',action=playing?'pause':'play';
  $('mediaPrevious').disabled=!ready||session?.controls?.previous!==true;$('mediaNext').disabled=!ready||session?.controls?.next!==true;$('mediaPlay').disabled=!ready||session?.controls?.[action]!==true;
  $('mediaPlay').setAttribute('aria-label',playing?'Пауза':'Воспроизвести');$('mediaPlay').title=playing?'Пауза':'Воспроизвести';$('mediaPlaySymbol').setAttribute('href',playing?'#i-pause':'#i-play');
  for(const id of ['mediaPrevious','mediaNext'])$(id).title=busy?'Выполняется…':$(id).disabled?'Команда недоступна в текущей медиасессии':id==='mediaNext'?'Следующий трек':'Предыдущий трек';
  const available=local&&!busy&&C.finite(volume?.percent)&&/^[a-f0-9]{64}$/.test(volume?.target||'');
  $('mediaVolume').disabled=!available;
  if(!dragging)$('mediaVolume').value=pendingVolume===null?(volume?String(Math.round(volume.percent)):'0'):String(pendingVolume);
  $('volumeSymbol').setAttribute('href',volume?.muted||volume?.percent===0?'#i-volume-off':'#i-volume');
  $('playerFeedback').hidden=Date.now()>=errorUntil;
 }
 async function send(action){
  if(busy)return;busy=true;if(action.kind==='volume')pendingVolume=action.value;render();
  try{
   const url=new URL(bridge);url.pathname='/controls';url.search='';url.hash='';
   const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY},body:JSON.stringify(action),signal:AbortSignal.timeout(25000),credentials:'omit',redirect:'error'});
   if(!response.ok)throw Error();const result=await response.json();if(!result.source)throw Error();
   if(action.kind==='media')media=newer(media,result.source);else desktop=newer(desktop,result.source);errorUntil=0;
  }catch{errorUntil=Date.now()+6500;$('playerFeedback').textContent='Не удалось выполнить. Проверь текущий плеер или выход звука.';}
  finally{busy=false;pendingVolume=null;render();}
 }
 for(const [id,value] of [['mediaPrevious','previous'],['mediaNext','next'],['mediaPlay',null]])$(id).addEventListener('click',()=>{if(!$(id).disabled)send({kind:'media',value:value||(media.data.playback==='playing'?'pause':'play'),session:media.data.session});});
 $('mediaVolume').addEventListener('input',()=>{dragging=true;});
 $('mediaVolume').addEventListener('change',()=>{const value=Number($('mediaVolume').value);dragging=false;if(!$('mediaVolume').disabled&&Number.isInteger(value)&&value>=0&&value<=100)send({kind:'volume',value,target:desktop.data.volume.target});else render();});
 $('mediaVolume').addEventListener('blur',()=>{dragging=false;render();});
 window.VGPlayer={render};render(null,null);
})();
