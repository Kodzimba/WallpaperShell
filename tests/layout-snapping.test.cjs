'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../runtime/wallpaper/widget-model.js'),E=require('../runtime/wallpaper/layout-editor-core.js'),{createDOMFixture}=require('./helpers/editor-dom.cjs');
const rect=(x,y,width=100,height=80)=>({x,y,width,height});
test('smart guides align nearest edges, centers and opposing edges independently',()=>{
 const targets=[{id:'a',rect:rect(300,400,200,160)}];
 for(const [x,y,expectedX,expectedY]of [[304,404,300,400],[354,444,350,440],[404,484,400,480],[204,324,200,320]]){
  const result=E.magnet(rect(x,y),targets);assert.equal(result.rect.x,expectedX);assert.equal(result.rect.y,expectedY);assert.deepEqual(result.guides.map(g=>g.axis),['x','y']);
 }
 const distant=E.magnet(rect(210,330),targets);assert.deepEqual(distant.rect,rect(210,330));assert.equal(distant.guides.length,0);
});
test('magnetic locks resist jitter then release, and deterministic ties prefer like anchors',()=>{
 const targets=[{id:'a',rect:rect(300,400)}],first=E.magnet(rect(304,404),targets),held=E.magnet(rect(309,409),targets,{locks:first.locks});
 assert.equal(held.rect.x,300);assert.equal(held.rect.y,400);assert.equal(E.magnet(rect(311,411),targets,{locks:held.locks}).guides.length,0);
 const tie=E.magnet(rect(100,200),[{id:'opposing',rect:rect(0,800)},{id:'same',rect:rect(100,900)}]);assert.equal(tie.guides[0].targetId,'same');
});
test('resize chooses a single proportional scale and only draws actually aligned axes',()=>{
 const result=E.magnet(rect(100,200,196,98),[{id:'a',rect:rect(300,300,130,100)}],{kind:'resize'});
 assert.equal(result.rect.width,200);assert.equal(result.rect.height,100);assert.equal(result.rect.x,100);assert.equal(result.rect.y,200);assert(result.guides.some(g=>g.axis==='x'&&g.position===300));assert(result.guides.some(g=>g.axis==='y'&&g.position===300));
});
async function fixture(scale=1){const f=createDOMFixture({theme:'luna-blue',scale});await f.ready;f.load('layout-editor.js');f.editor=f.window.PGLayoutEditor;f.editor.setEditing(true);f.network=f.document.querySelector('[data-widget-id=network]');return f;}
function drag(f,dx=4,dy=-171,altKey=false){const scale=f.stage.getBoundingClientRect().width/1920;f.fire(f.network,'pointerdown',{pointerId:7,clientX:200*scale,clientY:770*scale,altKey});f.fire(f.network,'pointermove',{pointerId:7,clientX:(200+dx)*scale,clientY:(770+dy)*scale,altKey});f.flushFrames();}
const finish=f=>f.fire(f.network,'pointerup',{pointerId:7,clientX:204,clientY:599});
test('shipped editor snaps to visible neighbors, previews only, saves once and undoes in one action',async()=>{
 const f=await fixture(),before=M.clone(f.layouts.current());drag(f);const p=f.layouts.current().widgets.network;assert.equal(p.x,65);assert.equal(p.y,540);assert.equal(f.editor.state().guides.length,2);assert.equal(f.document.querySelectorAll('.pg-editor-guide').length,2);assert.equal(f.editor.diagnostics().commits,0);assert.deepEqual(f.records.get(M.scope(before.theme,before.profile)),before);
 finish(f);await f.layouts.retry();assert.equal(f.editor.diagnostics().commits,1);assert.equal(f.document.querySelectorAll('.pg-editor-guide').length,0);await f.layouts.undo();assert.deepEqual(f.layouts.current().widgets.network,before.widgets.network);
});
test('Alt releases and restores snapping without moving the pointer; toggle also clears guides',async()=>{
 const f=await fixture();drag(f);f.fire(f.network,'keydown',{key:'Alt',altKey:true});assert.equal(f.layouts.current().widgets.network.x,69);assert.equal(f.layouts.current().widgets.network.y,543);assert.equal(f.editor.state().guides.length,0);
 f.fire(f.network,'keyup',{key:'Alt'});assert.equal(f.layouts.current().widgets.network.y,540);assert.equal(f.editor.state().guides.length,2);const toggle=f.document.querySelector('.pg-editor-snap');toggle.click();assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(f.layouts.current().widgets.network.y,543);assert.equal(f.editor.state().guides.length,0);f.editor.cancel();assert.equal(f.editor.diagnostics().commits,0);
});
test('guide tolerance stays six screen pixels across stage scales',async()=>{
 for(const scale of [.5,1,1.25]){const f=await fixture(scale);drag(f,Math.floor(5/scale),-171);assert.equal(f.layouts.current().widgets.network.x,65);assert.equal(f.document.querySelector('.pg-editor-guide').style.width,1/scale+'px');f.editor.cancel();drag(f,Math.ceil(12/scale),-171);assert.equal(f.layouts.current().widgets.network.x,65+Math.ceil(12/scale));f.editor.cancel();}
});
test('hidden widgets are not targets and measured launcher edges are targets',async()=>{
 const f=await fixture();await f.layouts.update({system:{visible:false,y:570},launcher:{x:800,y:300}});drag(f,4,-141);assert.equal(f.layouts.current().widgets.network.y,573);assert(!f.editor.state().guides.some(g=>g.targetId==='system'));f.editor.cancel();
 // Fixture rail is 592px wide, irrespective of the descriptor width310.
 drag(f,1013,23);assert.equal(f.layouts.current().widgets.network.x,1082);assert(f.editor.state().guides.some(g=>g.axis==='x'&&g.position===1392&&g.targetId==='launcher'));f.editor.cancel();
});
test('guides and drafts clear on Escape, capture loss, blur, resize, policy and exit',async()=>{
 for(const event of ['escape','capture','blur','resize','pagehide','policy','exit']){const f=await fixture(),saved=M.clone(f.layouts.current());drag(f);assert(f.editor.state().guides.length);if(event==='escape')f.fire(f.network,'keydown',{key:'Escape'});else if(event==='capture')f.network.releasePointerCapture(7);else if(event==='policy')f.fire(f.window,'pg:window-policy',{detail:{event:'suspend'}});else if(event==='exit')f.editor.setEditing(false);else f.fire(f.window,event);assert.equal(f.editor.state().guides.length,0,event);assert.equal(f.document.querySelectorAll('.pg-editor-guide').length,0,event);assert.deepEqual(f.layouts.current(),saved,event);assert.equal(f.editor.diagnostics().commits,0,event);}
});
test('clicking without displacement keeps geometry even when another edge is nearby; exact edits ignore magnets',async()=>{
 const f=await fixture();await f.layouts.update({network:{x:69,y:543}});f.fire(f.network,'pointerdown',{pointerId:7,clientX:200,clientY:770});f.fire(f.network,'pointerup',{pointerId:7,clientX:200,clientY:770});assert.equal(f.editor.diagnostics().commits,0);assert.equal(f.layouts.current().widgets.network.x,69);f.fire(f.network,'keydown',{key:'ArrowLeft'});await f.layouts.retry();assert.equal(f.layouts.current().widgets.network.x,68);
 const x=f.document.querySelector('input[aria-label="Положение X"]');x.value='67';f.fire(x,'change');await f.layouts.retry();assert.equal(f.layouts.current().widgets.network.x,67);assert.equal(f.editor.state().guides.length,0);
});
test('normalization wins over an impossible alignment and never displays a false guide',()=>{
 let doc=M.create('luna-blue','display-1');const c=E.createController({get:()=>doc,geometry:(id,p,d)=>id==='launcher'?rect(1924,100,310,400):rect(p.x,p.y,d.base[2]*p.scale,d.base[3]*p.scale),preview:changes=>{doc=M.patch(doc,changes);},cancelPreview(){},commit(){}});c.begin('network','move',{x:0,y:0});c.move({x:2000,y:-111},{snapping:true});assert.equal(doc.widgets.network.x,1610);assert(!c.state().guides.some(g=>g.axis==='x'&&g.position===1924));
});
