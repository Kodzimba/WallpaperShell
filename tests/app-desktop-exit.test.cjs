'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDesktopExit}=require('../runtime/companion/session.cjs');

test('desktop exit waits for icons, coalesces requests and only then notifies the own host',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const output=[];t.mock.method(console,'log',line=>output.push(JSON.parse(line)));
 let release,calls=0;const restoring=new Promise(resolve=>{release=resolve;});
 const exit=createDesktopExit({showIcons:()=>{calls++;return restoring;}}),first=exit(),second=exit();
 assert.equal(first,second);assert.equal(calls,1);t.mock.timers.tick(1000);assert.deepEqual(output,[]);
 release();const result=await first;assert.equal(result.data.mode,'desktop');assert.equal(result.data.stopping,true);assert.deepEqual(output,[]);
 t.mock.timers.tick(250);assert.deepEqual(output,[{type:'app-exit'}]);
 await exit();t.mock.timers.tick(500);assert.equal(output.length,1);assert.equal(calls,1);
});
test('failed icon restore does not close the app or report success, and retry works',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const output=[];t.mock.method(console,'log',line=>output.push(JSON.parse(line)));
 let calls=0;const exit=createDesktopExit({showIcons:async()=>{if(++calls===1)throw Error('Synthetic Explorer failure');}});
 await assert.rejects(exit(),/Explorer failure/);t.mock.timers.tick(1000);assert.deepEqual(output,[]);
 await exit();t.mock.timers.tick(250);assert.equal(calls,2);assert.deepEqual(output,[{type:'app-exit'}]);
});
