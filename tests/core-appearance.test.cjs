'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createAppearance}=require('../runtime/companion/appearance.cjs'),{validAction}=require('../runtime/companion/desktop-controls.cjs'),{validRequest}=require('../runtime/companion/launcher-overlay.cjs');
test('appearance commands reject extra fields, invalid modes and CSS injection',()=>{
 assert(validAction({kind:'appearance',mode:'dark',accent:'#CAFF00'}));
 for(const a of [{kind:'appearance',mode:'dark',accent:'url(x)'},{kind:'appearance',mode:'custom',accent:'#caff00'},{kind:'appearance',mode:'light',accent:'#caff00',path:'C:/Windows'}])assert(!validAction(a));
});
test('appearance is persisted with a monotonic revision and read results cannot mutate it',t=>{
 const base=path.resolve(__dirname,'../verification/appearance-tests');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'case-'));fs.mkdirSync(path.join(root,'companion'));t.after(()=>{assert.equal(path.dirname(root),base);fs.rmSync(root,{recursive:true,force:true});});
 const a=createAppearance(root);assert.equal(a.get().mode,'light');const first=a.set({mode:'dark',accent:'#BB9AFF'});assert.equal(first.data.accent,'#bb9aff');assert(first.data.revision>0);const b=createAppearance(root);assert.deepEqual(b.get(),a.get());const copy=b.get();copy.mode='light';assert.equal(b.get().mode,'dark');const next=b.set({mode:'light',accent:'#caff00'});assert(next.data.revision>first.data.revision);
});
test('native Paper menu accepts only the bounded appearance structure; classic protocol stays unchanged',()=>{
 const request={action:'open',theme:'daylight',id:'a'.repeat(32),group:'work',profile:'display-1',width:2560,height:1440,rect:[.01,.07,.8,.85],position:{x:24,y:80}},appearance={mode:'dark',accent:'#caff00',revision:1};assert(validRequest(request));assert(validRequest({...request,appearance}));
 assert(!validRequest({...request,theme:'classic',appearance}));assert(!validRequest({...request,appearance:{...appearance,revision:NaN}}));assert(!validRequest({...request,appearance:{...appearance,url:'file:///C:/'}}));
});
