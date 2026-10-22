'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDOMFixture}=require('./helpers/editor-dom.cjs');
async function setup(theme='paper-green'){
 const f=createDOMFixture({theme});await f.ready;const {document,create,stage}=f;
 const get=(id,tag='div',parent=document.body)=>document.getElementById(id)||create(id,tag,parent);
 const settings=get('settings'),section=get('widgetLayoutSettings','section',settings),input=get('editInput','input',get('editLabel','label',settings)),label=input.parentElement;
 const themePicker=get('themePicker'),settingsToggle=get('settingsToggle','button',stage),themeToggle=get('themeToggle','button',stage);themeToggle.className='theme-toggle';
 const grip=get('oldResizeGrip','div',stage);grip.className='resize-grip';
 let dismissals=0;f.window.VGLauncher={dismiss(){dismissals++;}};
 const targets=[];
 for(const [name,id]of [['screens','screenSingle'],['audio','audioSpeakers'],['media','mediaNext'],['launcher','launcherDesktop']]){const parent=get('block-'+name,'section',stage);parent.dataset.widget=name;targets.push(get(id,'button',parent));}
 f.load('layout-editor.js');f.load('layout-integration.js');return {...f,targets,settings,section,label,input,themePicker,settingsToggle,themeToggle,get,dismissals:()=>dismissals};
}
test('the explicit entry opens one editor, closes panels and restores the original inert state on exit',async()=>{
 const f=await setup(),{document,window,get}=f,entry=get('layoutEditorOpen');f.settings.hidden=false;f.themePicker.hidden=false;f.settingsToggle.inert=true;
 assert(f.label.classList.contains('pg-legacy-editor-toggle'));assert.equal(document.getElementById('oldResizeGrip'),null);assert.equal(entry.getAttribute('aria-controls'),'layoutEditorToolbar');assert.equal(window.PGLayoutEditor.isEditing(),false);
 entry.click();assert.equal(window.PGLayoutEditor.isEditing(),true);assert.equal(f.settings.hidden,true);assert.equal(f.themePicker.hidden,true);assert.equal(f.dismissals(),1);for(const target of f.targets)assert(target.parentElement.inert);assert(f.settingsToggle.inert);
 get('layoutEditorToolbar').querySelector('.pg-editor-done').click();assert.equal(window.PGLayoutEditor.isEditing(),false);for(const target of f.targets)assert.equal(target.parentElement.inert,false);assert(f.settingsToggle.inert,'An originally inert element must remain inert');assert.equal(f.themeToggle.inert,false);
});
test('edit mode blocks underlying hardware, media, launcher and quit handlers even for programmatic events',async()=>{
 const f=await setup();let commands=0;const types=['click','dblclick','contextmenu','pointerdown','mousedown','input','change','keydown'];
 for(const target of f.targets)for(const type of types)target.addEventListener(type,()=>commands++,true);
 for(const target of f.targets)f.fire(target,'click');assert.equal(commands,4);commands=0;
 f.window.PGLayoutEditor.setEditing(true);
 for(const target of f.targets)for(const type of types){const event=f.fire(target,type,{key:'Enter',pointerId:1});assert(event.defaultPrevented,type+' must be intercepted');}
 assert.equal(commands,0);assert.equal(f.window.PGLayoutEditor.isEditing(),true);
 const number=f.get('layoutEditorToolbar').querySelector('input');let editorInputs=0;number.addEventListener('input',()=>editorInputs++);f.fire(number,'input');assert.equal(editorInputs,1,'Editor fields must remain interactive');
 f.window.PGLayoutEditor.setEditing(false);assert.equal(f.document.activeElement,f.settingsToggle);for(const target of f.targets)f.fire(target,'click');assert.equal(commands,4);
});
test('Classic uses the same entry/protection and pagehide releases inert surfaces',async()=>{
 const f=await setup('classic');f.get('layoutEditorOpen').click();assert.equal(f.window.PGLayoutEditor.isEditing(),true);for(const target of f.targets)assert(target.parentElement.inert);
 f.fire(f.window,'pagehide');for(const target of f.targets)assert.equal(target.parentElement.inert,false);
});
