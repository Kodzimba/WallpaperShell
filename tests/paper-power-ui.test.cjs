'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../runtime/wallpaper/core.js'),token='b'.repeat(64);
function setup(fetch){
 const nodes={},events={},windows={},timers=new Map();let timer=0;
 const document={activeElement:null,getElementById(id){return nodes[id]||(nodes[id]={hidden:id==='powerOverlay',disabled:false,textContent:'',attrs:{},events:{},setAttribute(key,value){this.attrs[key]=value;},addEventListener(type,fn){this.events[type]=fn;},focus(){document.activeElement=this;},click(){if(!this.disabled)return this.events.click?.();}});},addEventListener(type,fn){events[type]=fn;}};
 const context={document,URL,Date,AbortSignal,fetch,VGCore:C,VG_LOCAL_CONTROL_KEY:'a'.repeat(64),addEventListener(type,fn){windows[type]=fn;},setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);}};context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/power.js'),'utf8'),context);
 return {nodes,document,events,windows,timers,power:context.VGPower};
}
const source=()=>({status:'ok',updatedAt:new Date().toISOString(),data:{}}),settle=()=>new Promise(r=>setImmediate(r));
const prepared=value=>({ok:true,json:async()=>({value,confirmation:token,expiresAt:Date.now()+30000})});
test('first click only prepares; cancel has default focus and never sends confirm',async()=>{
 const calls=[],a=setup(async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return body.action==='prepare'?prepared(body.value):{ok:true,json:async()=>({cancelled:true})};});a.power.render(source(),'http://127.0.0.1:8767/status?profile=x');
 a.nodes.powerShutdown.click();await settle();assert.equal(a.nodes.powerOverlay.hidden,false);assert.equal(a.document.activeElement,a.nodes.powerCancel);assert.equal(a.nodes.powerConfirm.disabled,false);assert.equal(a.nodes.powerTitle.textContent,'Выключить компьютер?');assert.deepEqual(calls.map(c=>c.body.action),['prepare']);assert.equal(calls[0].url,'http://127.0.0.1:8767/power');
 a.nodes.powerCancel.click();await settle();assert.equal(a.nodes.powerOverlay.hidden,true);assert.deepEqual(calls.map(c=>c.body.action),['prepare','cancel']);
});
test('explicit confirm sends the bound one-use token exactly once even after repeated clicks',async()=>{
 const calls=[];let release;const a=setup(async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);if(body.action==='prepare')return prepared(body.value);return new Promise(r=>release=()=>r({ok:true,json:async()=>({accepted:true,value:body.value})}));});a.power.render(source(),'http://127.0.0.1:8767/status');a.nodes.powerRestart.click();await settle();assert.equal(a.nodes.powerTitle.textContent,'Перезагрузить компьютер?');a.nodes.powerConfirm.click();a.nodes.powerConfirm.click();assert.deepEqual(calls,[{action:'prepare',value:'restart'},{action:'confirm',value:'restart',confirmation:token}]);assert.equal(a.nodes.powerCancel.disabled,true);release();await settle();assert.equal(a.nodes.powerConfirm.disabled,true);a.nodes.powerConfirm.click();assert.equal(calls.length,2);
});
test('late preparation after cancellation is revoked without re-opening the modal',async()=>{
 let release;const calls=[],a=setup(async(url,options)=>{const body=JSON.parse(options.body);calls.push(body.action);if(body.action==='prepare')return new Promise(r=>release=()=>r(prepared(body.value)));return {ok:true,json:async()=>({cancelled:true})};});a.power.render(source(),'http://127.0.0.1:8767/status');a.nodes.powerShutdown.click();a.nodes.powerCancel.click();release();await settle();assert.equal(a.nodes.powerOverlay.hidden,true);assert.deepEqual(calls,['prepare','cancel']);assert.equal(a.nodes.powerConfirm.disabled,true);
});
test('expiration disables confirmation; pause, editing and blur cancel an open prompt',async()=>{
 for(const cancelAction of ['expiry','pause','editing','blur']){const calls=[],a=setup(async(url,options)=>{const body=JSON.parse(options.body);calls.push(body.action);return body.action==='prepare'?prepared(body.value):{ok:true,json:async()=>({cancelled:true})};});a.power.render(source(),'http://127.0.0.1:8767/status');a.nodes.powerShutdown.click();await settle();if(cancelAction==='expiry')for(const fn of a.timers.values())fn();else if(cancelAction==='pause')a.power.setPaused(true);else if(cancelAction==='editing')a.power.setEditing(true);else a.windows.blur();a.nodes.powerConfirm.click();await settle();assert(!calls.includes('confirm'));assert.equal(a.nodes.powerConfirm.disabled,true);}
});
test('disconnected or foreign endpoints never receive the local capability',()=>{
 let calls=0;const a=setup(()=>{calls++;});for(const url of ['https://127.0.0.1:8767/status','http://example.com:8767/status','http://127.0.0.1:9999/status','http://user@127.0.0.1:8767/status']){a.power.render(source(),url);a.nodes.powerShutdown.click();assert.equal(a.nodes.powerShutdown.disabled,true);}a.power.render(null,'http://127.0.0.1:8767/status');a.nodes.powerRestart.click();assert.equal(calls,0);
});
