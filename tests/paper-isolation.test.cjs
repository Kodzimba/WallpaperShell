'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {validRequest}=require('../runtime/companion/launcher-overlay.cjs');
const open={action:'open',id:'a'.repeat(32),group:'work',profile:'display-1',width:2560,height:1440,rect:[.01,.07,.8,.85],position:{x:24,y:80}};
test('overlay is backward compatible and accepts only fixed theme names',()=>{assert(validRequest(open));assert(validRequest({...open,theme:'daylight'}));assert(validRequest({...open,theme:'classic'}));for(const theme of ['../../secret','file:///C:/','http://example.com',{},null])assert(!validRequest({...open,theme}));assert(!validRequest({...open,theme:'daylight',path:'C:/Windows'}));});
