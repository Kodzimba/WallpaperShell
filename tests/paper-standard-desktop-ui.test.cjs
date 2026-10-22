'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const M=require('../runtime/wallpaper/launcher.js');
function setup({bridge='http://127.0.0.1:8767/status',key='a'.repeat(64),fail=false}={}){
 const nodes=new Map(),calls=[],timers=new Map();let serial=0;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{children:[],style:{},dataset:{},events:{},classList:{toggle(){}},offsetHeight:524,querySelectorAll:()=>[],setAttribute(){},addEventListener(k,fn){this.events[k]=fn;},contains:()=>false});return nodes.get(id);};
 const document={body:get('body'),getElementById:get,addEventListener(){},createDocumentFragment:()=>({children:[]})};
 const window={VGLauncherMath:M,VG_LOCAL_CONTROL_KEY:key,addEventListener(){}};
 const context={module:{exports:{}},window,document,URL,AbortController,AbortSignal,performance:{now:()=>0},localStorage:{getItem:()=>null},setTimeout(fn,ms){timers.set(++serial,{fn,ms});return serial;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/controls'))return {ok:!fail,json:async()=>({source:{data:{mode:'desktop'}}})};return {ok:true,json:async()=>({version:1,revision:1,enabled:true,ready:true,groups:[],items:[]})};}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../runtime/wallpaper/launcher.js'),'utf8'),context);window.VGLauncher.configure({bridge,profile:'display-1'});
 return {get,calls,window};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('Desktop sends the protected full-exit action instead of opening an Explorer folder',async()=>{
 const a=setup();await settle();await a.get('launcherDesktop').events.click();
 const command=a.calls.find(c=>c.url.endsWith('/controls'));assert(command);assert.deepEqual(JSON.parse(command.options.body),{kind:'workspace',value:'desktop'});
 assert.equal(command.options.headers['X-VioletGhost-Key'],'a'.repeat(64));assert.equal(command.options.redirect,'error');
 assert(a.calls.every(c=>!c.options?.body?.includes('"action":"system"')));
});
test('exit cannot transmit the local capability to a foreign address or operate without a key',async()=>{
 for(const options of [{bridge:'http://example.com:8767/status'},{bridge:'http://127.0.0.1:9999/status'},{key:''}]){const a=setup(options);await a.get('launcherDesktop').events.click();assert.equal(a.calls.length,0);}
});
test('failure leaves an understandable message and permits retry',async()=>{
 const a=setup({fail:true});await settle();await a.get('launcherDesktop').events.click();assert.match(a.get('launcherFeedback').textContent,/Не удалось выйти/);await a.get('launcherDesktop').events.click();assert.equal(a.calls.filter(c=>c.url.endsWith('/controls')).length,2);
});
