'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../runtime/wallpaper/core.js');
function setup(fetch){
 const ids=['screenSingle','screenDual','audioHeadphones','audioSpeakers','audioTv','screensLabel','audioLabel','screensFeedback','audioFeedback'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{attrs:{},disabled:false,hidden:false,textContent:'',setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this[k]=v;}}]));
 const context={document:{getElementById:id=>nodes[id]},URL,Date,AbortSignal,fetch,VGCore:C,VG_LOCAL_CONTROL_KEY:'a'.repeat(64)};context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/controls.js'),'utf8'),context);
 return {nodes,render:context.VGDesktopControls.render};
}
function source(){return {status:'ok',updatedAt:new Date().toISOString(),identity:'Windows',data:{displays:{count:2,primary2k:true,mode:'dual'},audio:[{key:'headphones',name:'Razer',selected:true,available:true},{key:'speakers',name:'Realtek',selected:false,available:true},{key:'tv',name:null,selected:false,available:false}]}};}
const settle=()=>new Promise(r=>setImmediate(r));
test('controls reflect confirmed state and disable disconnected or stale devices',()=>{
 const a=setup();a.render(source(),'http://127.0.0.1:8767/status');assert.equal(a.nodes.screenDual.attrs['aria-pressed'],'true');assert.equal(a.nodes.screenSingle.attrs['aria-pressed'],'false');assert.equal(a.nodes.audioHeadphones.attrs['aria-pressed'],'true');assert.equal(a.nodes.audioTv.disabled,true);
 const old=source();old.updatedAt='2020-01-01T00:00:00Z';a.render(null);a.render(old);assert.equal(a.nodes.screenSingle.disabled,true);assert.equal(a.nodes.audioHeadphones.attrs['aria-pressed'],'false');
});
test('buttons cannot send the local capability to another host or port',()=>{
 let calls=0;const a=setup(()=>calls++);
 for(const url of ['https://127.0.0.1:8767/status','http://example.com:8767/status','http://127.0.0.1:9999/status']){a.render(source(),url);a.nodes.audioSpeakers.click();assert.equal(a.nodes.audioSpeakers.disabled,true);}
 assert.equal(calls,0);
});
test('audio switch remains unselected until Windows confirms; all buttons lock during a switch',async()=>{
 let finish,request;const a=setup((url,options)=>{request={url,options};return new Promise(r=>finish=r);});a.render(source(),'http://127.0.0.1:8767/status?vgProfile=display-1');
 a.nodes.audioSpeakers.click();assert.equal(a.nodes.audioSpeakers.attrs['aria-pressed'],'false');assert.equal(a.nodes.screenSingle.disabled,true);assert.equal(request.url,'http://127.0.0.1:8767/controls');assert.deepEqual(JSON.parse(request.options.body),{kind:'audio',value:'speakers'});assert.equal(request.options.headers['X-VioletGhost-Key'],'a'.repeat(64));
 const changed=source();changed.data.audio[0].selected=false;changed.data.audio[1].selected=true;finish({ok:true,json:async()=>({source:changed})});await settle();assert.equal(a.nodes.audioSpeakers.attrs['aria-pressed'],'true');assert.equal(a.nodes.screenSingle.disabled,false);
});
test('failed switch shows failure and preserves the actual selected output',async()=>{
 const a=setup(async()=>({ok:false}));a.render(source(),'http://127.0.0.1:8767/status');a.nodes.audioSpeakers.click();await settle();assert.equal(a.nodes.audioHeadphones.attrs['aria-pressed'],'true');assert.equal(a.nodes.audioSpeakers.attrs['aria-pressed'],'false');assert.equal(a.nodes.audioFeedback.hidden,false);assert.match(a.nodes.audioFeedback.textContent,/Не удалось/);
});
