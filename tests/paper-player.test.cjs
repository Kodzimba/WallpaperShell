'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),C=require('../runtime/wallpaper/core.js');
const token='a'.repeat(64);
function setup(fetch=async()=>{throw Error('offline')}){
 const ids=['mediaPrevious','mediaNext','mediaPlay','mediaPlaySymbol','mediaVolume','volumeSymbol','playerFeedback'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{attrs:{},events:{},value:'0',textContent:'',setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.events[k]=v;}}]));
 const context={document:{getElementById:id=>nodes[id]},VGCore:C,VG_LOCAL_CONTROL_KEY:token,URL,Date,AbortSignal,fetch};context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/player.js'),'utf8'),context);
 return {nodes,render:context.VGPlayer.render};
}
const media=()=>({status:'ok',updatedAt:new Date().toISOString(),data:{title:'Music',session:token,playback:'playing',controls:{play:false,pause:true,next:true,previous:false}}});
const desktop=()=>({status:'ok',updatedAt:new Date().toISOString(),data:{volume:{target:token,percent:4,muted:false}}});
const settle=()=>new Promise(r=>setImmediate(r));
test('player follows session capabilities and stale state disables controls',()=>{
 const a=setup();a.render(media(),desktop(),'http://127.0.0.1:8767/status');assert.equal(a.nodes.mediaPrevious.disabled,true);assert.equal(a.nodes.mediaNext.disabled,false);assert.equal(a.nodes.mediaPlay.attrs['aria-label'],'Пауза');assert.equal(a.nodes.mediaVolume.value,'4');
 const old=media();old.updatedAt='2020-01-01T00:00:00Z';a.render(null,null);a.render(old,desktop());assert.equal(a.nodes.mediaPlay.disabled,true);
 a.render(media(),desktop(),'http://example.com:8767/status');assert.equal(a.nodes.mediaVolume.disabled,true);
});
test('pause is session-bound and UI changes only when Windows confirms',async()=>{
 let complete,request;const a=setup((url,options)=>{request={url,options};return new Promise(r=>complete=r);});a.render(media(),desktop(),'http://127.0.0.1:8767/status?profile=x');a.nodes.mediaPlay.events.click();assert.equal(a.nodes.mediaPlay.attrs['aria-label'],'Пауза');assert.equal(a.nodes.mediaPlay.disabled,true);assert.deepEqual(JSON.parse(request.options.body),{kind:'media',value:'pause',session:token});assert.equal(request.url,'http://127.0.0.1:8767/controls');
 const paused=media();paused.data.playback='paused';paused.data.controls.play=true;complete({ok:true,json:async()=>({source:paused})});await settle();assert.equal(a.nodes.mediaPlay.attrs['aria-label'],'Воспроизвести');
});
test('volume applies only on change and binds to the exact current output',async()=>{
 let request;const a=setup(async(url,options)=>{request=JSON.parse(options.body);const result=desktop();result.data.volume.percent=3;return {ok:true,json:async()=>({source:result})};});a.render(media(),desktop(),'http://127.0.0.1:8767/status');a.nodes.mediaVolume.value='3';a.nodes.mediaVolume.events.input();assert.equal(request,undefined);a.nodes.mediaVolume.events.change();await settle();assert.deepEqual(request,{kind:'volume',value:3,target:token});assert.equal(a.nodes.mediaVolume.value,'3');
});
test('rejected media commands show an error without inventing a paused state',async()=>{
 const a=setup();a.render(media(),desktop(),'http://127.0.0.1:8767/status');a.nodes.mediaPlay.events.click();await settle();assert.equal(a.nodes.mediaPlay.attrs['aria-label'],'Пауза');assert.equal(a.nodes.playerFeedback.hidden,false);
});
