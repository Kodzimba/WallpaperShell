(function(){
 'use strict';
 const layouts=window.PGBuilderLayouts||window.PGLayouts;if(!layouts)return;
 const $=id=>document.getElementById(id),viewport=$('settingsLayoutWidgets')||$('settingsViewport')||$('settings');if(!viewport)return;
 const section=document.createElement('section');section.id='widgetLayoutSettings';section.className='widget-layout-settings';
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Виджеты';details.append(summary);
 details.addEventListener('toggle',()=>window.VGSettingsScroll?.update());
 const list=document.createElement('div');list.className='widget-layout-list';details.append(list);
 const status=document.createElement('p');status.className='help';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const retry=document.createElement('button');retry.type='button';retry.textContent='Повторить сохранение';retry.addEventListener('click',()=>{void layouts.retry();});
 section.append(details,status,retry);viewport.append(section);
 const buttons=new Map(),catalog=window.PGWidgetModel.catalog(layouts.theme);
 for(const [id,descriptor]of Object.entries(catalog)){
  const button=document.createElement('button');button.type='button';button.className='widget-visibility';
  const title=document.createElement('span'),indicator=document.createElement('span');title.textContent=descriptor.title;indicator.setAttribute('aria-hidden','true');button.append(title,indicator);
  button.addEventListener('click',()=>{const doc=layouts.current();if(doc)void layouts.update({[id]:{visible:!doc.widgets[id].visible}});});buttons.set(id,{button,indicator});list.append(button);
 }
 if(['paper-green','luna-blue'].includes(layouts.theme)){section.hidden=document.querySelector('[data-settings-tab="layout"]')?.getAttribute('aria-pressed')!=='true';window.addEventListener('paper:settings-tab',event=>{section.hidden=event.detail!=='layout';window.VGSettingsScroll?.update();});}
 layouts.subscribe(({document:doc,status:state,historyError})=>{
  for(const [id,{button,indicator}]of buttons){const visible=doc.widgets[id].visible;button.setAttribute('aria-pressed',String(visible));indicator.textContent=visible?'✓':'—';}
  status.textContent=historyError||({loading:'Загрузка компоновки…',saving:'Сохраняю компоновку…',saved:['paper-green','luna-blue'].includes(layouts.theme)?'':'Компоновка сохранена на этом ПК.',local:'Компоновка в локальном кэше. Запись в файл пока недоступна.',memory:'Компоновка в памяти. Сохранение пока недоступно.'})[state]||'';status.hidden=!status.textContent;retry.hidden=!['local','memory'].includes(state);
  const scene=document.querySelector(layouts.theme==='classic'?'.art':'.scene'),p=doc.widgets.scene;
  if(scene){scene.hidden=!p.visible;if(['paper-green','luna-blue'].includes(layouts.theme)){const base=catalog.scene.base;Object.assign(scene.style,{left:p.x+'px',top:p.y+'px',width:base[2]+'px',height:base[3]+'px',transform:'scale('+p.scale+')',transformOrigin:'0 0'});}}
  window.VGSettingsScroll?.update();
 });
})();
