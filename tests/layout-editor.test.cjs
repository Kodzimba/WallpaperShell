'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../runtime/wallpaper/widget-model.js'),E=require('../runtime/wallpaper/layout-editor-core.js');
const {createDOMFixture}=require('./helpers/editor-dom.cjs');
test('focused dimension follows incoming scale until the user starts editing it',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');const editor=f.window.PGLayoutEditor;editor.setEditing(true);editor.select('weather');const field=f.document.querySelector('input[aria-label="Высота в пикселях"]');field.focus();await f.layouts.update({weather:{scale:1.5}});assert.equal(field.value,'114');field.value='333';f.fire(field,'input');await f.layouts.update({weather:{scale:1.2}});assert.equal(field.value,'333');f.fire(field,'blur');assert.equal(field.value,'91');
});
function controller(theme='paper-green'){
 let doc=M.create(theme,'display-1'),base=doc,draft=false,writes=[];
 const c=E.createController({get:()=>doc,preview:changes=>{doc=M.patch(base,changes);draft=true;},cancelPreview:()=>{doc=base;draft=false;},commit:changes=>{doc=M.patch(base,changes);base=doc;draft=false;writes.push(changes);return Promise.resolve();}});
 return {c,get:()=>doc,base:()=>base,writes,draft:()=>draft,receive:value=>{base=value.document;doc=base;return c.receive(value);}};
}
test('editor converts pointer coordinates from any scaled and centered stage to logical pixels',()=>{
 for(const scale of [.5,1,1.25,2])assert.deepEqual(E.logicalPoint({x:80+640*scale,y:30+200*scale},{left:80,top:30,width:1920*scale}),{x:640,y:200});
 assert.throws(()=>E.logicalPoint({x:0,y:0},{left:0,top:0,width:0}));
});
test('a drag previews many frames but writes only one normalized widget patch on release',()=>{
 const {c,get,base,writes}=controller(),original=M.clone(base());assert(c.begin('weather','move',{x:20,y:20}));for(let i=1;i<=30;i++)c.move({x:20-i*3,y:20+i});assert.equal(writes.length,0);assert.deepEqual(base(),original);assert.equal(get().widgets.weather.x,1220);c.finish();assert.equal(writes.length,1);assert.deepEqual(writes[0],{weather:{x:1220,y:336}});assert.equal(c.state().gesture,null);
});
test('Esc, canceled capture and a no-op release restore preview without durable writes',()=>{
 const {c,get,base,writes,draft}=controller();c.begin('calendar','move',{x:0,y:0});c.move({x:-400,y:30});assert(draft());assert(c.cancel());assert.deepEqual(get(),base());assert.equal(writes.length,0);c.begin('calendar','move',{x:0,y:0});c.move({x:0,y:0});assert.equal(c.finish(),null);assert.equal(writes.length,0);
});
test('model owns bounds and proportional scaling, including the launcher and locked Classic scene',()=>{
 const {c,get,writes}=controller();c.begin('media','resize',{x:0,y:0});c.move({x:99999,y:99999});c.finish();const p=get().widgets.media,b=M.catalog('paper-green').media.base;assert(p.x+b[2]*p.scale<=1920);assert(p.y+b[3]*p.scale<=1080);assert.equal(writes.length,1);
 assert.equal(c.begin('launcher','resize',{x:0,y:0}),false);assert(c.begin('launcher','move',{x:0,y:0}));c.move({x:-9999,y:-9999});c.finish();assert.equal(get().widgets.launcher.x,16);assert.equal(get().widgets.launcher.y,80);
 const classic=controller('classic');assert.equal(classic.c.begin('scene','move',{x:0,y:0}),false);classic.c.select('scene');assert.equal(classic.c.nudge(10,0),null);assert.equal(classic.writes.length,0);
});
test('a hidden widget remains selectable and can be shown without a fake drag target',()=>{
 const {c,get,writes}=controller();c.select('ecoflow');c.apply({visible:false});assert.equal(get().widgets.ecoflow.visible,false);assert.equal(c.begin('ecoflow','move',{x:0,y:0}),false);assert.equal(c.state().selected,'ecoflow');c.apply({visible:true});assert.equal(get().widgets.ecoflow.visible,true);assert.equal(writes.length,2);
});
test('keyboard movement and numeric edits use the same normalization and avoid no-op history entries',()=>{
 const {c,get,writes}=controller();c.select('weather');c.nudge(-10,1);assert.equal(get().widgets.weather.x,1300);assert.equal(get().widgets.weather.y,307);c.apply({x:-999});assert.equal(get().widgets.weather.x,0);const count=writes.length;c.nudge(-1,0);assert.equal(writes.length,count);c.apply({scale:.1});assert.equal(get().widgets.weather.scale,.65);assert.equal(c.select('not-a-widget'),false);
});
test('a different revision or profile cancels stale gestures while preview events do not',()=>{
 const {c,get,receive,writes}=controller();c.begin('clock','move',{x:0,y:0});c.move({x:-200,y:20});assert.equal(c.receive({document:get(),preview:true}),false);const foreign=M.patch(M.create('paper-green','display-1'),{clock:{x:700}});foreign.revision=2;assert(receive({document:foreign,preview:false}));assert.equal(c.state().gesture,null);assert.equal(get().widgets.clock.x,700);assert.equal(c.finish(),null);assert.equal(writes.length,0);c.begin('clock','move',{x:0,y:0});assert(receive({document:M.create('paper-green','display-2'),preview:false}));assert.equal(get().profile,'display-2');
});
test('finishing a resize persists only effective geometry and never actions or widget content',()=>{
 const {c,writes}=controller();c.begin('weather','resize',{x:0,y:0});c.move({x:61,y:0});c.finish();assert.deepEqual(writes,[{weather:{x:1249,scale:1.1}}]);assert.equal(JSON.stringify(writes).includes('sources'),false);assert.equal(JSON.stringify(writes).includes('actions'),false);
});
test('shipped editor has no inactive hit targets, mounts an unscaled toolbar, and selects hidden blocks',async()=>{
 for(const theme of M.themes){const f=createDOMFixture({theme,scale:.833333});await f.ready;f.load('layout-editor.js');const editor=f.window.PGLayoutEditor,toolbar=f.document.getElementById('layoutEditorToolbar'),overlay=f.document.getElementById('layoutEditorOverlay');assert.equal(editor.isEditing(),false);assert.equal(editor.diagnostics().targets,0);assert.equal(toolbar.hidden,true);assert.equal(overlay.hidden,true);assert.equal(toolbar.parentElement,f.document.body);assert.equal(overlay.parentElement,f.stage);
  await f.layouts.update({weather:{visible:false}});editor.setEditing(true);assert.equal(toolbar.hidden,false);assert.equal(overlay.hidden,false);assert.equal(f.document.querySelector('[data-widget-id=weather]').hidden,true);const picker=toolbar.querySelector('select');assert(picker.querySelector('[value=weather]').textContent.includes('скрыт'));picker.value='weather';f.fire(picker,'change');assert.equal(editor.state().selected,'weather');const visibility=toolbar.querySelectorAll('button').find(el=>el.textContent==='Показать');visibility.click();await f.layouts.retry();assert.equal(f.layouts.current().widgets.weather.visible,true);editor.setEditing(false);assert.equal(toolbar.hidden,true);assert.equal(editor.diagnostics().targets,0);
 }
});
test('actual pointer handlers preview at stage scale and save once, with capture loss restoring state',async()=>{
 const f=createDOMFixture({scale:.5});await f.ready;f.load('layout-editor.js');const editor=f.window.PGLayoutEditor;editor.setEditing(true);editor.setSnapping(false);const weather=f.document.querySelector('[data-widget-id=weather]');const old=f.layouts.current().widgets.weather;f.fire(weather,'pointerdown',{pointerId:2,clientX:800,clientY:300});for(let i=1;i<=5;i++)f.fire(weather,'pointermove',{pointerId:2,clientX:800-i*5,clientY:300+i*5});assert.equal(f.pendingFrames(),1);assert.equal(editor.diagnostics().commits,0);assert.equal(f.layouts.current().widgets.weather.x,old.x);f.flushFrames();assert.equal(f.layouts.current().widgets.weather.x,old.x-50);assert.equal(f.layouts.current().widgets.weather.y,old.y+50);f.fire(weather,'pointerup',{pointerId:2,clientX:775,clientY:325});await f.layouts.retry();assert.equal(editor.diagnostics().commits,1);assert.equal(editor.state().dragging,false);const saved=M.clone(f.layouts.current());f.fire(weather,'pointerdown',{pointerId:3,clientX:800,clientY:300});f.fire(weather,'pointermove',{pointerId:3,clientX:700,clientY:400});weather.releasePointerCapture(3);assert.equal(editor.state().dragging,false);assert.equal(f.pendingFrames(),0);assert.deepEqual(f.layouts.current(),saved);assert.equal(editor.diagnostics().commits,1);
});
test('keyboard handlers move selected blocks, leave editable keys alone and undo/redo through real session',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');const editor=f.window.PGLayoutEditor;editor.setEditing(true);editor.select('weather');const old=f.layouts.current().widgets.weather.x;const toolbar=f.document.getElementById('layoutEditorToolbar'),done=toolbar.querySelector('.pg-editor-done');done.focus();f.fire(done,'keydown',{key:'ArrowLeft',shiftKey:true});await f.layouts.retry();assert.equal(f.layouts.current().widgets.weather.x,old-10);f.fire(done,'keydown',{key:'z',ctrlKey:true});await f.layouts.retry();assert.equal(f.layouts.current().widgets.weather.x,old);f.fire(done,'keydown',{key:'z',ctrlKey:true,shiftKey:true});await f.layouts.retry();assert.equal(f.layouts.current().widgets.weather.x,old-10);const input=toolbar.querySelector('input');input.focus();const event=f.fire(input,'keydown',{key:'ArrowLeft'});assert.equal(event.defaultPrevented,false);assert.equal(f.layouts.current().widgets.weather.x,old-10);f.fire(done,'keydown',{key:'Escape'});assert.equal(editor.isEditing(),false);
});
test('Escape cancels a gesture before exit, and resize/blur cancel without writing',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');const editor=f.window.PGLayoutEditor;editor.setEditing(true);const weather=f.document.querySelector('[data-widget-id=weather]'),saved=M.clone(f.layouts.current());f.fire(weather,'pointerdown',{pointerId:7,clientX:800,clientY:300});f.fire(weather,'pointermove',{pointerId:7,clientX:700,clientY:350});f.fire(weather,'keydown',{key:'Escape'});assert.equal(editor.isEditing(),true);assert.equal(editor.state().dragging,false);assert.deepEqual(f.layouts.current(),saved);for(const type of ['resize','blur','pagehide']){f.fire(weather,'pointerdown',{pointerId:8,clientX:800,clientY:300});f.fire(weather,'pointermove',{pointerId:8,clientX:700,clientY:350});f.fire(f.window,type);assert.equal(editor.state().dragging,false);assert.deepEqual(f.layouts.current(),saved);}assert.equal(editor.diagnostics().commits,0);
});
test('launcher editing uses its measured height and Classic background never covers foreground targets',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');const editor=f.window.PGLayoutEditor;editor.setEditing(true);editor.select('launcher');const toolbar=f.document.getElementById('layoutEditorToolbar'),inputs=toolbar.querySelectorAll('input');inputs[1].value='900';f.fire(inputs[1],'change');await f.layouts.retry();assert.equal(f.layouts.current().widgets.launcher.y,486);const overlay=f.document.getElementById('layoutEditorOverlay');assert.equal(overlay.children[1].children[0].dataset.widgetId,'scene');
 const c=createDOMFixture({theme:'classic'});await c.ready;c.load('layout-editor.js');c.window.PGLayoutEditor.setEditing(true);assert.equal(c.document.querySelector('[data-widget-id=scene]').dataset.locked,'true');assert.equal(c.document.querySelector('[data-widget-id=scene]').tabIndex,-1);assert.equal(c.window.PGLayoutEditor.diagnostics().targets,12);
});
test('returning one drag axis to its origin clears its previous preview without losing the other axis',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');f.window.PGLayoutEditor.setEditing(true);const el=f.document.querySelector('[data-widget-id=weather]'),old=f.layouts.current().widgets.weather;f.fire(el,'pointerdown',{pointerId:4,clientX:500,clientY:400});f.fire(el,'pointermove',{pointerId:4,clientX:450,clientY:420});f.flushFrames();assert.equal(f.layouts.current().widgets.weather.x,old.x-50);f.fire(el,'pointermove',{pointerId:4,clientX:500,clientY:420});f.flushFrames();assert.equal(f.layouts.current().widgets.weather.x,old.x);assert.equal(f.layouts.current().widgets.weather.y,old.y+20);f.fire(el,'pointerup',{pointerId:4,clientX:500,clientY:420});await f.layouts.retry();assert.equal(f.layouts.current().widgets.weather.x,old.x);assert.equal(f.layouts.current().widgets.weather.y,old.y+20);
});
test('pointer release flushes the last queued frame, and editable Escape keeps native field behavior',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');const editor=f.window.PGLayoutEditor;editor.setEditing(true);editor.setSnapping(false);const el=f.document.querySelector('[data-widget-id=weather]'),old=f.layouts.current().widgets.weather;f.fire(el,'pointerdown',{pointerId:5,clientX:500,clientY:400});f.fire(el,'pointermove',{pointerId:5,clientX:450,clientY:420});assert.equal(f.pendingFrames(),1);f.fire(el,'pointerup',{pointerId:5,clientX:425,clientY:430});await f.layouts.retry();assert.equal(f.pendingFrames(),0);assert.equal(f.layouts.current().widgets.weather.x,old.x-75);assert.equal(f.layouts.current().widgets.weather.y,old.y+30);const input=f.document.getElementById('layoutEditorToolbar').querySelector('input');input.focus();const escaped=f.fire(input,'keydown',{key:'Escape'});assert.equal(escaped.defaultPrevented,false);assert.equal(editor.isEditing(),true);editor.setEditing(false);assert.equal(f.pendingFrames(),0);
});

test('clicking a widget transfers focus from the picker so arrow keys move that widget',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');f.window.PGLayoutEditor.setEditing(true);const picker=f.document.getElementById('layoutEditorToolbar').querySelector('select');assert.equal(f.document.activeElement,picker);
 const weather=f.document.querySelector('[data-widget-id=weather]'),before=f.layouts.current().widgets.weather.x;f.fire(weather,'pointerdown',{pointerId:9,clientX:500,clientY:400});f.fire(weather,'pointerup',{pointerId:9,clientX:500,clientY:400});assert.equal(f.document.activeElement,weather);
 const key=f.fire(f.document.activeElement,'keydown',{key:'ArrowLeft'});assert(key.defaultPrevented);await f.layouts.retry();assert.equal(f.layouts.current().widgets.weather.x,before-1);
});

test('background history conflicts are visible even when their API result is not handled by the toolbar',async()=>{
 const f=createDOMFixture();await f.ready;f.load('layout-editor.js');await f.layouts.update({clock:{x:800}});f.window.PGLayoutEditor.setEditing(true);
 const other=M.patch(f.layouts.current(),{clock:{x:700}});other.revision++;f.records.set(M.scope(other.theme,other.profile),other);const result=await f.layouts.undo();assert.equal(result.reason,'conflict');
 assert.match(f.document.getElementById('layoutEditorToolbar').querySelector('.pg-editor-status').textContent,/изменены в другом окне/);assert.equal(f.layouts.current().widgets.clock.x,700);
});
