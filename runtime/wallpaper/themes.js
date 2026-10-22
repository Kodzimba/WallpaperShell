(function(){
 'use strict';
 const current=['paper-green','luna-blue'].includes(document.body.dataset.theme)?document.body.dataset.theme:'classic',paper=current!=='classic';
 const host=paper?document.getElementById('stage'):document.body;
 const toggle=document.createElement('button');toggle.type='button';toggle.className='theme-toggle';toggle.title='Темы приложения';toggle.setAttribute('aria-label','Темы приложения');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','themePicker');
 toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M5 5h5v14H5z" fill="currentColor" stroke="none"/></svg>';
 const unified=paper&&!!window.PGSettings;
 const panel=unified?document.getElementById('applicationThemes'):document.createElement('section');
 if(!unified){panel.id='themePicker';panel.className='theme-picker';panel.hidden=true;panel.setAttribute('aria-label','Темы приложения');}
 const title=document.createElement('strong');title.textContent=paper?'ОФОРМЛЕНИЕ':'ТЕМЫ';const close=document.createElement('button');close.type='button';close.className='theme-close';close.textContent='×';close.setAttribute('aria-label','Закрыть темы');
 const header=document.createElement('header');header.append(title,close);if(unified){title.textContent='Дизайн экрана';panel.append(title);}else panel.append(header);
 const choices=document.createElement('div');choices.className='theme-choices';panel.append(choices);
 const message=document.createElement('p');message.className='theme-message';message.textContent=unified?'':'Раскладки дизайнов сохраняются отдельно.';message.setAttribute('role','status');panel.append(message);
 let busy=false;
 for(const [value,label]of [['paper-green','Paper Green'],['luna-blue','Luna Blue'],['classic','Black / Violet']]){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.theme=value;b.setAttribute('aria-pressed',String(value===current));choices.append(b);
  b.addEventListener('click',async()=>{
   if(busy||value===current||window.PGLayoutEditor?.isEditing?.()||window.PGWindows&&!window.PGWindows.canInteract())return;busy=true;for(const el of choices.children)el.disabled=true;message.textContent='Переключаю дизайн…';
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
   try{
    const input=document.getElementById('bridgeInput'),base=window.VGCore?.bridgeUrl(input?.value||'http://127.0.0.1:8767/status');if(!base||!window.VG_LOCAL_CONTROL_KEY)throw Error();
    const url=new URL('/controls',base);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='8767'||url.username||url.password)throw Error();
    const r=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY},body:JSON.stringify({kind:'theme',value}),signal:controller.signal,credentials:'omit',redirect:'error'});
    if(!r.ok)throw Error();const result=await r.json();if(result.source?.data?.requestedTheme!==value)throw Error();
    message.textContent='Тема приложения изменена.';
   }catch{message.textContent='Не удалось переключить дизайн. Попробуй ещё раз.';}
   finally{clearTimeout(timer);busy=false;for(const el of choices.children)el.disabled=false;}
  });
 }
 if(paper){
  toggle.id='startToggle';toggle.className='start-toggle';toggle.title='Пуск';toggle.setAttribute('aria-label','Пуск Windows');toggle.removeAttribute('aria-expanded');toggle.removeAttribute('aria-controls');
  toggle.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>';
  toggle.addEventListener('click',()=>{
   if(document.hidden||window.PGLayoutEditor?.isEditing?.()||window.PGWindows&&!window.PGWindows.canInteract())return;
   window.PGSettings?.close('outside');window.VGLauncher?.dismiss?.();window.PGDesktopHub?.openStartMenu?.();
  });host.append(toggle);return;
 }
 const policy=window.PGWindows;
 function hide(reason){panel.hidden=true;toggle.setAttribute('aria-expanded','false');if(!policy&&['explicit','escape'].includes(reason))toggle.focus();}
 policy?.registerPanel('themes',{isOpen:()=>!panel.hidden,close:hide});
 async function show(value,reason='explicit'){
  if(!value){if(policy)policy.closePanel('themes',reason);else hide(reason);return;}
  if(policy&&!await policy.openPanel('themes',{trigger:toggle}))return;
  panel.hidden=false;toggle.setAttribute('aria-expanded','true');if(paper){if(settings)settings.hidden=true;window.dispatchEvent(new CustomEvent('paper:panel-open'));}if(policy)policy.restoreFocus(close,'done');else close.focus();
 }
 toggle.addEventListener('click',()=>show(panel.hidden));close.addEventListener('click',()=>show(false));
 document.addEventListener('keydown',event=>{if(!policy&&event.key==='Escape'&&!panel.hidden)show(false,'escape');});
 document.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!toggle.contains(event.target))show(false,'outside');});
 host.append(toggle,panel);
 // Also discoverable from Settings without exposing native form controls.
 const settings=document.getElementById('settings'),entry=document.createElement('button');entry.type='button';entry.textContent='Темы приложения ↗';entry.addEventListener('click',()=>{settings.hidden=true;show(true);});(document.getElementById('settingsViewport')||settings)?.append(entry);
})();
