'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {validRequest,createOverlay}=require('../runtime/companion/launcher-overlay.cjs');
const key='b'.repeat(64),id='a'.repeat(32);
const open={action:'open',id,group:'work',profile:'display-1',width:2560,height:1440,rect:[.0125,.1259,.6115,.9259],position:{x:24,y:200}};
test('overlay accepts bounded geometry for the two profiles and only existing category IDs',()=>{
 assert(validRequest(open));assert(validRequest({...open,profile:'display-2',width:3840,height:2160}));assert(validRequest({action:'close',id}));
 for(const bad of [null,[],{...open,path:'C:/Windows/cmd.exe'},{...open,action:'execute'},{...open,group:'__proto__'},{...open,group:'cmd.exe'},{...open,id:'secret'},{...open,profile:'display-3'},{...open,width:1e9},{...open,height:0},{...open,rect:[0,0,2,1]},{...open,rect:[.5,0,.2,1]},{...open,position:{x:-100,y:200}},{...open,position:{x:24,y:200,command:'x'}},{action:'close',id,group:'work'}])assert.equal(!!validRequest(bad),false);
});
test('both theme category triggers accept only a bounded normalized rectangle and preserve legacy requests',()=>{
 const request={...open,theme:'daylight',trigger:[.01,.08,.32,.15]};assert(validRequest(request));assert(validRequest(open));
 for(const trigger of [[],null,[0,0,1],[0,0,2,1],[.3,0,.2,1],[0,0,NaN,1],[0,0,1,Infinity],[0,0,0,1],'work'])assert.equal(!!validRequest({...request,trigger}),false);
 assert(validRequest({...request,theme:'classic'}));
});
test('overlay endpoint rejects foreign origins, missing capability, malformed geometry and oversized bodies without starting a host',async()=>{
 const overlay=createOverlay({root:process.cwd(),key,enabled:()=>false});
 const server=http.createServer(overlay.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const headers={'X-VioletGhost-Action':'desktop','X-VioletGhost-Key':key,Origin:'null','Content-Type':'application/json'};
 try{
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://example.com'},body:JSON.stringify(open)})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(open)})).status,409);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...open,group:'arbitrary'})})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:'x'.repeat(2049)})).status,413);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'close',id})})).status,200);
 }finally{overlay.stop();await new Promise(r=>server.close(r));}
});
