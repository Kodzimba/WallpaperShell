'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.argv[2],main=fs.readFileSync(path.join(root,'main-script.js'),'utf8'),popup=fs.readFileSync(path.join(root,'popup-script.js'),'utf8'),popupUri=fs.readFileSync(path.join(root,'popup-uri.txt'),'utf8').replace(/^\uFEFF/,'');
function run(script,location,frame=false){const window={};window.top=frame?{}:window;vm.runInNewContext(script,{window,location});return window;}
const allowed={origin:'http://127.0.0.1:8767',pathname:'/luna-blue/index.html'};
assert.equal(run(main,allowed).VG_LOCAL_CONTROL_KEY,'a'.repeat(64));
for(const location of [{...allowed,origin:'https://remote.invalid'},{...allowed,origin:'http://127.0.0.1:8768'},{...allowed,pathname:'/untrusted.html'},{...allowed,origin:'null'}])assert.equal(run(main,location).VG_LOCAL_CONTROL_KEY,undefined);
assert.equal(run(main,allowed,true).VG_LOCAL_CONTROL_KEY,undefined);
assert.equal(run(popup,{href:popupUri}).VG_LOCAL_CONTROL_KEY,'a'.repeat(64));
assert.equal(run(popup,{href:popupUri},true).VG_LOCAL_CONTROL_KEY,undefined);
assert.equal(run(popup,{href:popupUri+'?other'}).VG_LOCAL_CONTROL_KEY,undefined);
assert.equal(run(popup,{href:'file:///untrusted/launcher-overlay.html'}).VG_LOCAL_CONTROL_KEY,undefined);
const descriptor=Object.getOwnPropertyDescriptor(run(main,allowed),'VG_LOCAL_CONTROL_KEY');assert.equal(descriptor.writable,false);assert.equal(descriptor.configurable,false);
console.log('Private bootstrap: 12 actual-script VM isolation checks passed; no browser or native actions executed.');
