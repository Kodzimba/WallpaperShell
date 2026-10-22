(function(){
 'use strict';
 const editor=window.PGLayoutEditor;if(!editor)return;
 const $=id=>document.getElementById(id),stage=$('stage'),inertState=new Map();
 const section=$('widgetLayoutSettings'),legacy=$('editInput')?.parentElement;
 document.body.classList.add('pg-editor-ready');
 if(legacy)legacy.classList.add('pg-legacy-editor-toggle');
 for(const grip of document.querySelectorAll('.resize-grip'))grip.remove();
 if(section){
  const entry=document.createElement('button');entry.id='layoutEditorOpen';entry.type='button';entry.className='layout-editor-open';entry.textContent='Открыть конструктор';
  entry.setAttribute('aria-controls','layoutEditorToolbar');entry.addEventListener('click',()=>editor.setEditing(true));section.prepend(entry);
 }
 function protect(editing){
  if(editing){
   for(const id of ['settings','themePicker']){const panel=$(id);if(panel)panel.hidden=true;}
   window.VGLauncher?.dismiss?.();
   for(const element of document.querySelectorAll('[data-widget],[data-custom-widget],.scene,.art,#launcher,.masthead,.pc-powerbar,#settingsToggle,.theme-toggle,.start-toggle,#eventNotice')){
    if(!inertState.has(element))inertState.set(element,!!element.inert);element.inert=true;
   }
  }else{for(const [element,inert]of inertState)element.inert=inert;inertState.clear();}
 }
 window.addEventListener('paper:layout-editing',event=>{const editing=event.detail?.editing===true;protect(editing);if(!editing){const target=$('settingsToggle');if(window.PGWindows)window.PGWindows.restoreFocus(target,'done');else if(target&&!target.inert)target.focus({preventScroll:true});}});
 // Also blocks programmatic activation of an inert button while arranging, before
 // app-host's capture listeners can dispatch a hardware command or close the app.
 function guard(event){
  if(!editor.isEditing())return;
  const target=event.target;if(!target||target.closest?.('[data-pg-layout-editor]'))return;
  if(stage.contains(target)||target.closest?.('#settings,#themePicker,#settingsToggle,.theme-toggle,.start-toggle,.app-mode-controls')){event.preventDefault();event.stopImmediatePropagation();}
 }
 for(const name of ['click','dblclick','contextmenu','pointerdown','mousedown','input','change','keydown'])document.addEventListener(name,guard,true);
 window.addEventListener('pagehide',()=>protect(false));
})();
