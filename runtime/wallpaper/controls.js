(function(){
 'use strict';
 const $=id=>document.getElementById(id),groups={displays:['screenSingle','screenDual'],audio:['audioHeadphones','audioSpeakers','audioTv']};
 const actions={screenSingle:['displays','single'],screenDual:['displays','dual'],audioHeadphones:['audio','headphones'],audioSpeakers:['audio','speakers'],audioTv:['audio','tv']};
 let source=null,bridge='',busy=false,feedback=null;
 function render(next,url){
  if(next===null||!source||Date.parse(next?.updatedAt)>=Date.parse(source.updatedAt))source=next;
  if(typeof url==='string')bridge=url;
  const fresh=window.VGCore.sourceState(source,Date.now(),15000)==='ok',data=fresh?source.data:{};
  let endpoint;try{endpoint=new URL(bridge);}catch{}
  const ready=fresh&&!!window.VG_LOCAL_CONTROL_KEY&&endpoint?.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)&&endpoint.port==='8767';
  for(const [id,[kind,value]] of Object.entries(actions)){
   const choice=kind==='audio'?data.audio?.find(c=>c.key===value):null;
   const available=kind==='audio'?choice?.available===true:!!data.displays?.primary2k;
   const selected=kind==='audio'?choice?.selected===true:data.displays?.mode===value;
   const button=$(id);button.disabled=!ready||!available||busy;button.setAttribute('aria-pressed',String(selected));
   button.title=busy?'Переключение…':!fresh?'Нет связи с Windows':kind==='audio'?choice?.name||'Устройство не подключено':value==='single'?'Оставить основной 2560×1440. Второй экран потеряет сигнал.':'Включить оба экрана и расширить рабочий стол';
  }
  for(const [kind,prefix] of [['displays','screens'],['audio','audio']]){
   const el=$(prefix+'Feedback');const message=feedback?.kind===kind&&feedback.until>Date.now()?feedback.message:'';
   el.hidden=!message;if(el.textContent!==message)el.textContent=message;
   $(prefix+'Label').title=fresh?source.identity+' · '+new Date(source.updatedAt).toLocaleTimeString('ru-RU'):'Нет связи с Windows';
  }
 }
 async function change(kind,value){
  if(busy)return;busy=true;feedback={kind,message:'Переключение…',until:Date.now()+30000};render(source);
  try{
   const url=new URL(bridge);url.pathname='/controls';url.search='';url.hash='';
   const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY},body:JSON.stringify({kind,value}),signal:AbortSignal.timeout(25000)});
   if(!response.ok)throw Error();const result=await response.json();if(!result.source)throw Error();source=result.source;window.VGPlayer?.render(undefined,source);feedback=null;
  }catch{feedback={kind,message:'Не удалось переключить',until:Date.now()+8000};}
  finally{busy=false;render(source);}
 }
 for(const [id,[kind,value]] of Object.entries(actions))$(id).addEventListener('click',()=>{if(!$(id).disabled)change(kind,value);});
 window.VGDesktopControls={render};render(null);
})();
