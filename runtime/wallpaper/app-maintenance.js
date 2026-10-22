(function(){
 'use strict';
 const bridge=window.chrome?.webview;if(!bridge)return;
 let view=null,info=null,request=null,available=null,lease=null,busy=false,phase='idle',attempt=0;
 const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 const allowed=()=>!window.PGLayoutEditor?.isEditing?.()&&(!window.PGWindows||window.PGWindows.canInteract());
 const uuid=()=>window.crypto.randomUUID();
 function post(action,id=request){bridge.postMessage({type:'app-maintenance',action,requestId:id});}
 function status(value){if(view)text(view.status,String(value||'').slice(0,500));}
 function controls(){if(!view)return;view.check.disabled=busy||!info?.enabled;view.report.disabled=busy||!info?.reportAvailable;view.install.hidden=!available||busy;view.cancel.hidden=view.overlay.hidden||phase==='installing';}
 function closeModal(){if(!view)return;view.overlay.hidden=true;if(lease){lease.release('done');lease=null;}}
 function cancel(){if(phase==='installing')return;attempt++;if(!busy){closeModal();window.PGSettings?.open('general');return;}if(request)post('cancel');request=null;busy=false;phase='canceled';available=null;closeModal();status('Обновление отменено.');controls();}
 function applyInfo(value){info=value;if(!view)return;text(view.version,'WallpaperShell '+String(value.version||'').slice(0,40));if(!value.enabled)status('Репозиторий обновлений ещё не настроен.');controls();}
 bridge.addEventListener('message',event=>{
  const message=event.data;
  if(message?.type==='app-maintenance-info'){applyInfo(message);return;}
  if(!view||message?.requestId!==request)return;
  if(message.type==='app-maintenance-progress'&&busy){const bytes=Number(message.bytes),total=Number(message.total);const percent=Number.isFinite(bytes)&&Number.isFinite(total)&&total>0?Math.max(0,Math.min(100,bytes/total*100)):null;text(view.progress,percent===null?'Проверяем пакет…':'Скачивание: '+Math.floor(percent)+'%');return;}
  if(message.type!=='app-maintenance-status')return;
  const state=message.state;if(!['checking','available','latest','downloading','installing','canceled','error','reported'].includes(state))return;
  phase=state;busy=['checking','downloading','installing'].includes(state);status(message.message);
  if(state==='available'){
   const version=String(message.version||'').slice(0,40),size=Number(message.size);available={version};
   text(view.install,'Скачать и установить '+version);status('Доступна версия '+version+(Number.isFinite(size)&&size>0?' · '+(size/1048576).toFixed(1)+' МиБ':'')+'. Приложение перезапустится.');
  }else if(!busy){available=null;if(state==='error'&&!view.overlay.hidden){text(view.progress,message.message||'Обновление не выполнено.');text(view.cancel,'Закрыть');}else closeModal();}
  if(state==='installing')text(view.progress,'Загрузка проверена. Перезапускаем WallpaperShell…');controls();
 });
 function mount(){
  if(view)return;const parent=document.getElementById('settingsGeneralHost')||document.getElementById('settingsViewport')||document.getElementById('settings');if(!parent)return;
  const make=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node;};
  const section=make('section','app-maintenance');section.id='appMaintenance';const heading=make('h3','','Приложение'),version=make('p','app-maintenance-version','WallpaperShell'),actions=make('div','app-maintenance-actions');
  const check=make('button','','Обновить'),report=make('button','','Репорт'),install=make('button','app-maintenance-install');check.id='appUpdate';report.id='appReport';install.id='appUpdateInstall';for(const button of [check,report,install])button.type='button';install.hidden=true;
  const message=make('p','app-maintenance-status');message.id='appUpdateStatus';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  actions.append(check,report);section.append(heading,version,actions,install,message,make('p','app-maintenance-note','Репорт откроет форму GitHub. Опиши проблему и проверь сообщение перед отправкой.'));parent.append(section);
  const overlay=make('div','app-maintenance-overlay');overlay.id='appUpdateOverlay';overlay.hidden=true;
  const dialog=make('section','app-maintenance-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','appUpdateHeading');const title=make('h2','','Обновление WallpaperShell');title.id='appUpdateHeading';const progress=make('p','','Скачиваем и проверяем пакет…');progress.id='appUpdateProgress';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');const cancelButton=make('button','','Отменить');cancelButton.id='appUpdateCancel';cancelButton.type='button';dialog.append(title,progress,make('p','app-maintenance-note','После проверки приложение перезапустится. Настройки и раскладка сохранятся.'),cancelButton);overlay.append(dialog);document.body.append(overlay);
  view={section,version,check,report,install,status:message,overlay,progress,cancel:cancelButton};
  check.addEventListener('click',()=>{if(!allowed()||busy||!info?.enabled)return;request=uuid();available=null;busy=true;phase='checking';status('Проверяем стабильный релиз…');controls();post('check');});
  report.addEventListener('click',()=>{if(!allowed()||busy||!info?.reportAvailable)return;request=uuid();post('report');});
  install.addEventListener('click',async()=>{
   if(!allowed()||busy||!available)return;
   const serial=++attempt;busy=true;phase='acquiring';request=null;overlay.hidden=false;text(cancelButton,'Отменить');text(progress,'Подготавливаем обновление…');controls();
   try{const acquired=await window.PGWindows?.acquire('update',{element:overlay,onEscape:cancel,onReset:cancel});if(serial!==attempt||overlay.hidden){acquired?.release('cancel');return;}lease=acquired;if(!lease)throw Error();request=uuid();phase='downloading';text(progress,'Скачиваем и проверяем пакет…');controls();window.PGWindows?.restoreFocus?.(cancelButton,'done');post('install');}
   catch{if(serial!==attempt)return;busy=false;phase='error';closeModal();status('Не удалось начать обновление. Повтори попытку.');controls();}
  });
  cancelButton.addEventListener('click',cancel);
  window.addEventListener('pagehide',()=>{attempt++;if(busy&&request)post('cancel');request=null;busy=false;closeModal();});
  if(info)applyInfo(info);else controls();post('info',uuid());window.PGMaintenance={diagnostics:()=>({mounted:true,updateMounted:true,reportMounted:true,phase,version:info?.version||null})};
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
