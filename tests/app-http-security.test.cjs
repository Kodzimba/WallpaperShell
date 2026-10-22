'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{boundary}=require('../runtime/companion/app-http.cjs'),{serve}=require('../runtime/companion/app-static.cjs');
const key='c'.repeat(64);
function fixture(headers={},url='/.controls-key.js',method='GET'){
 const req={headers:{host:'127.0.0.1:8767',...headers},url,method},res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code){this.code=code;return this;},end(){}};
 return {req,res,result:boundary(req,res,key)};
}
test('remote opaque-origin iframe cannot read the bootstrap key, status or preflight an action',()=>{
 for(const url of ['/.controls-key.js','/luna-blue/.controls-key.js','/status','/power','/speedtest'])for(const method of ['GET','OPTIONS','POST']){const f=fixture({origin:'null'},url,method);assert.equal(f.result,null);assert.equal(f.res.code,403);assert.equal(f.res.headers['Access-Control-Allow-Origin'],undefined);}
 const direct=fixture();serve({...direct.req,headers:{origin:'null'}},direct.res,direct.result);assert.equal(direct.res.code,403);
});
test('foreign origins, cross-site no-cors loads and DNS-rebinding hosts are denied without CORS',()=>{
 for(const headers of [{origin:'https://example.invalid'},{host:'rebound.example.invalid:8767'},{host:'127.0.0.1:8767.attacker.invalid'},{'sec-fetch-site':'cross-site'}]){const f=fixture(headers);assert.equal(f.res.code,403);assert.equal(f.res.headers['Access-Control-Allow-Origin'],undefined);}
 assert.equal(fixture({},'http://example.invalid/status').res.code,403);assert.equal(fixture({},'http://[').res.code,400);
});
test('same-origin app works, legacy action clients need their existing private capability',()=>{
 for(const origin of [undefined,'http://127.0.0.1:8767','http://localhost:8767']){const f=fixture(origin?{origin}:{});assert(f.result);assert.notEqual(f.res.headers['Access-Control-Allow-Origin'],'*');assert.equal(f.res.headers['Cross-Origin-Resource-Policy'],'same-origin');}
 for(const action of ['desktop','speedtest']){assert(fixture({origin:'null','x-violetghost-key':key,'x-violetghost-action':action},'/controls','POST').result);assert.equal(fixture({origin:'null','x-violetghost-key':'d'.repeat(64),'x-violetghost-action':action}).res.code,403);}
});

test('even a raw local client cannot obtain the capability through an HTTP bootstrap endpoint',()=>{
 for(const url of ['/.controls-key.js','/classic/.controls-key.js','/luna-blue/.controls-key.js']){const f=fixture({},url);assert(f.result);serve(f.req,f.res,f.result);assert.equal(f.res.code,404);}
});

test('native file popup preflights do not grant any unauthenticated access',()=>{
 const headers={origin:'null','sec-fetch-site':'cross-site','access-control-request-method':'POST','access-control-request-headers':'Content-Type, X-VioletGhost-Action, X-VioletGhost-Key'};
 assert(fixture(headers,'/launcher','OPTIONS').result);assert.equal(fixture(headers,'/.controls-key.js','OPTIONS').res.code,403);assert.equal(fixture(headers,'/status','OPTIONS').res.code,403);assert.equal(fixture({origin:'null','sec-fetch-site':'cross-site'},'/launcher','POST').res.code,403);assert(fixture({origin:'null','sec-fetch-site':'cross-site','x-violetghost-key':key,'x-violetghost-action':'desktop'},'/launcher','POST').result);
});

test('local capability generation uses private storage and creates no theme JavaScript copies',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{localKey}=require('../runtime/companion/desktop-controls.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'wallpapershell-key-fixture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const runtime=path.join(root,'runtime');fs.mkdirSync(runtime);assert.throws(()=>localKey(runtime));fs.mkdirSync(path.join(root,'data/private'),{recursive:true});const value=localKey(runtime);assert.match(value,/^[a-f0-9]{64}$/);assert.equal(localKey(runtime),value);assert.equal(fs.readFileSync(path.join(root,'data/private/control.key'),'utf8'),value);for(const name of ['wallpaper','themes/classic','themes/luna-blue'])assert(!fs.existsSync(path.join(runtime,name,'.controls-key.js')));
});
