(function(){
 'use strict';
 if(!['paper-green','luna-blue'].includes(document.body.dataset.theme))return;
 const $=id=>document.getElementById(id),panel=$('settings'),view=$('settingsViewport'),C=window.VGCore;
 if(!panel||!view)return;
 const tabs=[...document.querySelectorAll('[data-settings-tab]')],sections=[...view.querySelectorAll('[data-settings-panel]')],triggers=new Map();
 let current='general',snapshot=null;const sourceRows=new Map();
 const allowed=()=>!window.PGLayoutEditor?.isEditing?.()&&(!window.PGWindows||window.PGWindows.canInteract());
 const labels={system:'RAM / VRAM',weather:'Погода',network:'Интернет / RTT',speedtest:'Тест скорости',mouse:'Мышь',ecoflow:'EcoFlow',desktop:'Экраны и звук',media:'Медиасессия',events:'События'};
 if(document.body.dataset.theme==='luna-blue')labels.pet='Пэт Codex';
 const ages={system:15000,weather:1800000,network:15000,speedtest:4500000,mouse:120000,ecoflow:120000,desktop:15000,media:15000,events:15000,pet:15000};
 function sources(){
  for(const [id,name]of Object.entries(labels)){
   let entry=sourceRows.get(id);if(!entry){const row=document.createElement('details'),summary=document.createElement('summary'),small=document.createElement('small');row.className='source-detail';row.dataset.source=id;row.append(summary,small);$('sourceDetails').append(row);entry={row,summary,small};sourceRows.set(id,entry);}
   const source=snapshot?.sources?.[id],state=C.sourceState(source,Date.now(),ages[id]);entry.row.dataset.state=state;
   const title=name+' · '+({ok:'Подключено',stale:'Устарело',error:'Ошибка',unavailable:'Нет данных'}[state]),detail=[source?.identity,source?.updatedAt?'Измерено: '+new Date(source.updatedAt).toLocaleString('ru-RU'):'Измерений нет',source?.detail].filter(Boolean).join(' · ');
   if(entry.summary.textContent!==title)entry.summary.textContent=title;if(entry.small.textContent!==detail)entry.small.textContent=detail;
  }
 }
 function syncTriggers(){for(const [button,tab]of triggers)button.setAttribute('aria-expanded',String(!panel.hidden&&current===tab));}
 function select(tab){
  if(!tabs.some(button=>button.dataset.settingsTab===tab))return false;
  current=tab;for(const button of tabs)button.setAttribute('aria-pressed',String(button.dataset.settingsTab===tab));
  for(const section of sections)section.hidden=section.dataset.settingsPanel!==tab;
  if(tab==='sources')sources();view.scrollTop=0;syncTriggers();
  window.dispatchEvent(new CustomEvent('paper:settings-tab',{detail:tab}));window.VGSettingsScroll?.update();return true;
 }
 async function open(tab='general',{trigger=$('settingsToggle')}={}){
  if(!allowed()||!tabs.some(button=>button.dataset.settingsTab===tab))return false;
  const policy=window.PGWindows;
  if(policy&&(panel.hidden||policy.diagnostics().activePanel!=='settings')&&!await policy.openPanel('settings',{trigger}))return false;
  if(!allowed())return false;
  select(tab);panel.hidden=false;$('settingsToggle').setAttribute('aria-expanded','true');syncTriggers();
  window.dispatchEvent(new CustomEvent('paper:panel-open'));
  if(policy)policy.restoreFocus($('settingsClose'),'done');else $('settingsClose').focus({preventScroll:true});return true;
 }
 function close(reason='explicit'){if(window.PGWindows)window.PGWindows.closePanel('settings',reason);else panel.hidden=true;syncTriggers();}
 function toggle(tab,options){if(!allowed())return;if(!panel.hidden&&current===tab||window.PGWindows?.diagnostics().pendingPanel==='settings'){close();return;}return open(tab,options);}
 window.PGSettings={open,close,toggle,select,current:()=>current,registerTrigger(button,tab){triggers.set(button,tab);button.setAttribute('aria-controls','settings');syncTriggers();},isTrigger:target=>[...triggers.keys()].some(button=>button.contains(target))};
 for(const button of tabs)button.addEventListener('click',()=>{if(allowed())select(button.dataset.settingsTab);});
 new MutationObserver(syncTriggers).observe(panel,{attributes:true,attributeFilter:['hidden']});
 function save(values){if(!allowed())return false;return window.PGPreferences?.update(values)===true;}
 for(const [id,field]of [['motionInput','motion'],['secondsInput','seconds']])$(id).addEventListener('change',()=>{if(!save({[field]:$(id).checked}))$(id).checked=window.PGPreferences.get()[field];});
 $('profileInput').addEventListener('change',()=>{if(!save({profile:$('profileInput').value}))$('profileInput').value=window.PGPreferences.get().profile;});
 $('timezoneInput').addEventListener('change',()=>{$('timezoneInput').setAttribute('aria-invalid',String(!save({timezone:$('timezoneInput').value})));});
 $('timezoneInput').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('timezoneInput').blur();}else if(event.key==='Escape'){$('timezoneInput').value=window.PGPreferences.get().timezone;$('timezoneInput').removeAttribute('aria-invalid');}});
 window.addEventListener('paper:preferences',()=>{$('timezoneInput').removeAttribute('aria-invalid');});
 window.VGAppearance?.mount($('appearanceSettings'),true);
 $('ecoModel')?.addEventListener('click',async()=>{if(await open('sources',{trigger:$('ecoModel')})){$('ecoInfo').open=true;$('ecoInfo').scrollIntoView({block:'nearest'});}});
 window.addEventListener('daylight:snapshot',event=>{snapshot=event.detail;if(!panel.hidden&&current==='sources')sources();});
 view.addEventListener('toggle',()=>window.VGSettingsScroll?.update(),true);
 select('general');
})();
