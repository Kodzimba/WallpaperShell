(function(){
 'use strict';
 const layouts=window.PGLayouts,T=window.PGLayoutTransferCore,files=window.PGLayoutFiles;if(!layouts||!T)return;
 const $=id=>document.getElementById(id),buttons=[],inertState=new Map();let busy=false,opened=false,applying=false,plan=null,previousFocus=null,noticeTimer=null,lease=null,operation=0;
 const node=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
 const button=(text,action)=>{const el=node('button',text);el.type='button';el.addEventListener('click',action);return el;};
 const notice=node('p','','layout-transfer-notice');notice.id='layoutTransferNotice';notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');document.body.append(notice);
 const dialog=node('div','','layout-transfer-overlay');dialog.id='layoutTransferDialog';dialog.dataset.pgLayoutEditor='true';dialog.hidden=true;
 const panel=node('section','','layout-transfer-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','layoutTransferTitle');
 const header=node('header'),title=node('strong','Импорт раскладки');title.id='layoutTransferTitle';const close=button('×',()=>dismiss());close.setAttribute('aria-label','Отменить импорт');header.append(title,close);
 const summary=node('p'),preview=document.createElementNS('http://www.w3.org/2000/svg','svg');preview.classList.add('layout-transfer-preview');preview.setAttribute('viewBox','0 0 1920 1080');preview.setAttribute('role','img');preview.setAttribute('aria-label','Схема размещения блоков из файла');
 const warning=node('p','','layout-transfer-warning');warning.setAttribute('role','status');const foot=node('footer'),cancel=button('Отмена',()=>dismiss()),apply=button('Применить',()=>applyImport());apply.className='layout-transfer-primary';foot.append(cancel,apply);panel.append(header,summary,preview,warning,foot);dialog.append(panel);document.body.append(dialog);
 function inform(message,error=false){clearTimeout(noticeTimer);notice.textContent=message;notice.dataset.error=String(error);notice.hidden=!message;if(message&&!error)noticeTimer=setTimeout(()=>{notice.hidden=true;},6000);}
 function setBusy(value){busy=!!value;for(const b of buttons)b.disabled=busy||opened||!files;}
 function capture(){window.PGLayoutEditor?.cancel?.();layouts.cancelPreview?.();const doc=layouts.current();if(!doc)throw Error('Раскладка ещё загружается.');return doc;}
 function sameScope(a,b){return a&&b&&a.theme===b.theme&&a.profile===b.profile;}
 function currentMatches(expected){const now=layouts.current();return sameScope(now,expected)&&now.revision===expected.revision&&JSON.stringify(now.widgets)===JSON.stringify(expected.widgets);}
 function lock(value){
  if(value){for(const selector of ['stage','settings','themePicker','settingsToggle','layoutEditorToolbar']){const el=$(selector);if(el&&!inertState.has(el)){inertState.set(el,!!el.inert);el.inert=true;}}}
  else{for(const [el,inert]of inertState)el.inert=inert;inertState.clear();}
 }
 function release(reason){if(lease){const held=lease;lease=null;held.release(reason);}else if(!window.PGWindows&&['explicit','escape'].includes(reason)&&previousFocus?.isConnected&&!previousFocus.inert)previousFocus.focus({preventScroll:true});previousFocus=null;}
 function dismiss(restore=true,reason='explicit'){if(!opened)return;opened=false;plan=null;dialog.hidden=true;lock(false);setBusy(false);release(restore?reason:'reset');}
 async function reserve(kind){if(!window.PGWindows)return;lease=await window.PGWindows.acquire(kind,{onReset:()=>{operation++;dismiss(false);setBusy(false);},onEscape:()=>{if(opened&&!applying)dismiss(true,'escape');}});}
 function draw(portable){
  preview.replaceChildren();const catalog=window.PGWidgetModel.catalog(portable.theme),order=['scene',...Object.keys(catalog).filter(id=>id!=='scene')];
  for(const id of order){const p=portable.widgets[id],d=catalog[id],rect=document.createElementNS('http://www.w3.org/2000/svg','rect'),label=document.createElementNS('http://www.w3.org/2000/svg','text');
   rect.setAttribute('x',String(p.x));rect.setAttribute('y',String(p.y));rect.setAttribute('width',String(d.base[2]*p.scale));rect.setAttribute('height',String(d.base[3]*p.scale));rect.dataset.visible=String(p.visible);rect.dataset.scene=String(id==='scene');
   label.setAttribute('x',String(p.x+8));label.setAttribute('y',String(p.y+Math.min(34,d.base[3]*p.scale-5)));label.textContent=d.title;label.dataset.visible=String(p.visible);preview.append(rect,label);
  }
 }
 function showPlan(portable,expected,filename){
  const prepared=T.prepareImport(portable,expected);plan={portable,expected,changed:prepared.changedWidgets};opened=true;dialog.hidden=false;lease?.attach(dialog);lock(true);setBusy(false);
  summary.textContent=(filename?filename+' · ':'')+({'paper-green':'Paper Green','luna-blue':'Luna Blue',classic:'Classic'}[portable.theme])+' · '+(expected.profile==='display-2'?'Профиль экрана 2':'Профиль экрана 1')+'. Изменится блоков: '+prepared.changedWidgets.length+'.';
  warning.textContent=prepared.changedWidgets.length?'Текущая раскладка будет заменена. После применения можно отменить импорт одним действием.':'Этот файл совпадает с текущей раскладкой.';
  apply.disabled=!prepared.changedWidgets.length||!currentMatches(expected);if(!currentMatches(expected))warning.textContent='Раскладка изменилась, пока выбирался файл. Закрой это окно и открой импорт ещё раз.';
  draw(portable);const target=apply.disabled?cancel:apply;if(window.PGWindows)window.PGWindows.restoreFocus(target,'done');else target.focus({preventScroll:true});
 }
 async function exportLayout(){
  if(busy||opened||window.PGWindows&&!window.PGWindows.canInteract())return;const at=++operation;previousFocus=document.activeElement;setBusy(true);try{if(!files)throw Error('Экспорт доступен в WallpaperShell.');const content=T.stringify(capture());await reserve('export');if(at!==operation)return;const result=await files.save(content);if(at!==operation)return;if(result.status==='error')throw Error(result.message||'Не удалось сохранить файл.');if(result.status==='ok')inform('Раскладка сохранена в файл.');}
  catch(error){if(at===operation)inform(error.message||'Не удалось экспортировать раскладку.',true);}finally{if(at===operation){setBusy(false);release('explicit');}}
 }
 async function importLayout(){
  if(busy||opened||window.PGWindows&&!window.PGWindows.canInteract())return;const at=++operation;previousFocus=document.activeElement;setBusy(true);try{if(!files)throw Error('Импорт доступен в WallpaperShell.');const expected=capture();await reserve('import');if(at!==operation)return;const result=await files.open();if(at!==operation)return;if(result.status==='error')throw Error(result.message||'Не удалось прочитать файл.');if(result.status==='ok')showPlan(T.parse(result.content),expected,result.filename);}
  catch(error){if(at===operation)inform(error.message||'Не удалось импортировать раскладку.',true);}finally{if(at===operation){setBusy(false);if(!opened)release('explicit');}}
 }
 async function applyImport(){
  if(!opened||!plan||apply.disabled)return;const chosen=plan;applying=true;apply.disabled=true;cancel.disabled=true;close.disabled=true;
  try{const result=await layouts.replaceAll(chosen.portable.widgets,{expected:chosen.expected});if(result?.ok===false)throw Error(result.message||'Не удалось применить раскладку.');dismiss();inform(layouts.status()==='saved'?'Раскладка импортирована. Можно отменить действие.':layouts.status()==='memory'?'Изменения только в памяти. Экспортируй раскладку перед закрытием приложения.':'Раскладка применена. Запись в файл приложения ожидает восстановления связи.',layouts.status()==='memory');}
  catch(error){warning.textContent=error.message||'Не удалось применить раскладку.';}
  finally{applying=false;cancel.disabled=false;close.disabled=false;apply.disabled=true;}
 }
 function mount(parent,compact=false){
  if(!parent)return;const actions=node('div','','layout-transfer-actions');actions.dataset.pgLayoutEditor='true';const save=button('Экспорт',()=>exportLayout()),open=button('Импорт',()=>importLayout());save.title='Сохранить текущую раскладку в JSON-файл';open.title='Прочитать раскладку из JSON-файла';actions.append(save,open);buttons.push(save,open);compact?parent.append(actions):parent.prepend(actions);
 }
 mount($('widgetLayoutSettings'));mount($('layoutEditorToolbar')?.querySelector('.pg-editor-top'),true);setBusy(false);
 layouts.subscribe(()=>{if(opened&&plan&&!applying&&!currentMatches(plan.expected)){apply.disabled=true;warning.textContent='Раскладка изменилась. Закрой это окно и открой импорт ещё раз.';}});
 window.addEventListener('keydown',event=>{
  if(!opened||window.PGWindows)return;
  if(event.key==='Escape'&&!cancel.disabled){event.preventDefault();event.stopImmediatePropagation();dismiss();}
  else if(event.key==='Tab'){const order=[close,cancel,apply].filter(el=>!el.disabled),at=order.indexOf(document.activeElement),next=event.shiftKey?(at<=0?order.length-1:at-1):(at+1)%order.length;event.preventDefault();event.stopImmediatePropagation();order[next]?.focus({preventScroll:true});}
 },true);
 function guard(event){if(!opened||dialog.contains(event.target))return;event.preventDefault();event.stopImmediatePropagation();}
 for(const name of ['click','dblclick','contextmenu','pointerdown','mousedown','input','change','keydown'])document.addEventListener(name,guard,true);
 dialog.addEventListener('click',event=>{if(event.target===dialog&&!cancel.disabled){event.preventDefault();event.stopPropagation();dismiss(true,'outside');}});
 window.addEventListener('pagehide',()=>{operation++;dismiss(false);release('reset');clearTimeout(noticeTimer);});
 window.PGLayoutTransfer={exportLayout,importLayout,isOpen:()=>opened,isBusy:()=>busy||opened,diagnostics:()=>({mounted:true,busy,open:opened,buttons:buttons.length})};
})();
