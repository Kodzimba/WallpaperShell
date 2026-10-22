'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const M=require('../runtime/wallpaper/widget-model.js'),T=require('../runtime/wallpaper/layout-transfer-core.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const document=(theme='paper-green',profile='display-1')=>M.create(theme,profile);
const portable=(theme='paper-green')=>T.exportDocument(document(theme));
const rejects=(payload,code)=>assert.throws(()=>T.parse(typeof payload==='string'?payload:JSON.stringify(payload)),error=>error.code===code);

test('portable layouts round-trip both themes and all widget functions remain on the target computer',()=>{
 for(const theme of M.themes){const original=M.patch(document(theme,'display-2'),{weather:{x:100,y:200,scale:1.2,visible:false},launcher:{x:80,y:240}});original.revision=71;
  const text=T.stringify(original),decoded=T.parse(text),target=document(theme,'display-1'),result=T.prepareImport(text,target),applied=M.patch(target,result.changes);
  assert.deepEqual(applied.widgets,original.widgets);assert.equal(applied.profile,'display-1');assert.equal(applied.revision,0);assert.equal(result.theme,theme);assert.deepEqual(result.changedWidgets.sort(),['launcher','weather']);assert.deepEqual(T.exportDocument(applied),decoded);
  assert.equal(decoded.canvas.width,1920);assert.equal(decoded.canvas.height,1080);assert.equal(decoded.format,'paper-green-layout');assert.equal(decoded.version,T.VERSION);
 }
});
test('export contains geometry and visibility only, with no profile, revision, types or machine-specific bindings',()=>{
 const payload=T.exportDocument(document());assert.deepEqual(Object.keys(payload).sort(),['canvas','format','theme','version','widgets']);
 for(const widget of Object.values(payload.widgets))assert.deepEqual(Object.keys(widget).sort(),['scale','visible','x','y']);
 const text=T.stringify(document());for(const privateField of ['profile','revision','schemaVersion','sources','actions','type','password','token','account','path','url'])assert.equal(text.includes('"'+privateField+'"'),false,privateField);
});
test('export rejects polluted documents rather than copying or silently stripping extra data',()=>{
 for(const mutation of [doc=>{doc.password='PRIVATE';},doc=>{doc.widgets.weather.url='https://private.invalid';},doc=>{doc.widgets.launcher.path='C:\\private';},doc=>{doc.widgets.ecoflow.account='PRIVATE';}]){
  const doc=document();mutation(doc);assert.throws(()=>T.stringify(doc),error=>error.code==='FIELDS');
 }
 const invalid=document();invalid.widgets.weather.type='shell';assert.throws(()=>T.stringify(invalid),error=>error.code==='DOCUMENT');
});
test('import returns an exact effective diff and never mutates either input',()=>{
 const current=M.patch(document(),{weather:{visible:false},clock:{x:100}}),file=portable(),currentBefore=clone(current),fileBefore=clone(file);
 const result=T.prepareImport(file,current);assert.deepEqual(result.changes,{clock:{x:1310},weather:{visible:true}});assert.deepEqual(result.changedWidgets,['clock','weather']);assert.deepEqual(current,currentBefore);assert.deepEqual(file,fileBefore);
 result.changes.clock.x=999;assert.deepEqual(current,currentBefore);assert.deepEqual(file,fileBefore);
 assert.deepEqual(T.prepareImport(T.exportDocument(current),current),{theme:'paper-green',changes:{},changedWidgets:[]});
});
test('wrong theme rejects without switching, editing or importing a profile',()=>{
 const current=document('paper-green','display-2'),before=clone(current);assert.throws(()=>T.prepareImport(portable('classic'),current),error=>error.code==='THEME'&&/Переключите/.test(error.message));assert.deepEqual(current,before);
 const file=portable();file.profile='display-2';rejects(file,'FIELDS');
});
test('unknown, missing and executable fields are rejected at every level',()=>{
 const mutations=[file=>{file.url='https://x.invalid';},file=>{file.name='my layout';},file=>{delete file.theme;},file=>{file.canvas.height=undefined;},file=>{file.canvas.scale=1;},file=>{file.widgets.unknown={x:1,y:2,scale:1,visible:true};},file=>{delete file.widgets.clock;},file=>{file.widgets.media.type='shell';},file=>{file.widgets.launcher.command='whoami';},file=>{file.widgets.ecoflow.token='secret';},file=>{file.widgets.clock=null;},file=>{file.widgets.clock=[];}];
 for(const mutation of mutations){const file=portable();mutation(file);rejects(file,'FIELDS');}
 for(const level of ['root','widgets','widget']){const file=portable(),target=level==='root'?file:level==='widgets'?file.widgets:file.widgets.clock;Object.defineProperty(target,'__proto__',{value:{polluted:true},enumerable:true});rejects(file,'FIELDS');}
 assert.equal({}.polluted,undefined);
});
test('malformed JSON, future versions, wrong format and incorrect canvas are rejected clearly',()=>{
 for(const text of ['','{broken','null','[]','true','{"format":"paper-green-layout",}'])rejects(text,text==='null'||text==='[]'||text==='true'?'FIELDS':'JSON');
 for(const [key,value,code]of [['version',T.VERSION+1,'VERSION'],['version','1','VERSION'],['format','other','FORMAT'],['theme','future','THEME']]){const file=portable();file[key]=value;rejects(file,code);}
 for(const [key,value]of [['width',2560],['height',1440],['width','1920']]){const file=portable();file.canvas[key]=value;rejects(file,'BOUNDS');}
});
test('import strictly rejects invalid geometry instead of silently clamping it',()=>{
 for(const fields of [{x:-1},{x:1921},{y:-1},{y:1081},{scale:.6499},{scale:999},{x:'20'},{scale:null},{visible:1}]){const file=portable();Object.assign(file.widgets.weather,fields);rejects(file,Object.values(fields).some(v=>v===null||typeof v==='string'||Object.hasOwn(fields,'visible'))?'FIELDS':'BOUNDS');}
 for(const fields of [{x:15},{x:1305},{y:79},{y:901},{scale:1.01}]){const file=portable();Object.assign(file.widgets.launcher,fields);rejects(file,'BOUNDS');}
 for(const fields of [{x:1},{y:1},{scale:.8}]){const file=portable('classic');Object.assign(file.widgets.scene,fields);rejects(file,'BOUNDS');}
 const file=portable();file.widgets.media.x=1299;rejects(file,'BOUNDS');
 for(const value of [NaN,Infinity,-Infinity]){const file=portable();file.widgets.weather.x=value;assert.throws(()=>T.prepareImport(file,document()),error=>error.code==='FIELDS');}
});
test('payload limit counts UTF-8 bytes and accepts exactly the documented limit',()=>{
 const text=JSON.stringify(portable());assert(text.length<T.MAX_BYTES);assert.deepEqual(T.parse(text+' '.repeat(T.MAX_BYTES-Buffer.byteLength(text))),portable());rejects(text+' '.repeat(T.MAX_BYTES-Buffer.byteLength(text)+1),'TOO_LARGE');
 const unicode='"'+('\u044f'.repeat(T.MAX_BYTES/2))+'"';rejects(unicode,'TOO_LARGE');
 assert.throws(()=>T.parse({}),error=>error.code==='JSON');
});
test('duplicate JSON keys, including escaped equivalent keys, cannot hide fields at any depth',()=>{
 const text=JSON.stringify(portable());
 for(const duplicate of [text.replace('"version":3','"version":4,"version":3'),text.replace('"version":3','"ver\\u0073ion":2,"version":3'),text.replace('"width":1920','"width":2560,"width":1920'),text.replace('"x":1310','"x":12,"x":1310'),text.replace('"clock":{','"clock":{},"clock":{')])rejects(duplicate,'DUPLICATE');
});
test('direct object API rejects getters, prototype payloads and hidden properties without executing them',()=>{
 let executed=0;for(const mode of ['getter','hidden','prototype','symbol']){const file=portable();if(mode==='getter')Object.defineProperty(file.widgets.clock,'x',{enumerable:true,get(){executed++;return 1310;}});if(mode==='hidden')Object.defineProperty(file,'secret',{value:'private'});if(mode==='prototype')Object.setPrototypeOf(file.widgets.clock,{secret:'private'});if(mode==='symbol')file[Symbol('secret')]='private';assert.throws(()=>T.prepareImport(file,document()),error=>error.code==='FIELDS');}
 assert.equal(executed,0);
 const doc=document();Object.defineProperty(doc.widgets.clock,'x',{enumerable:true,get(){executed++;return 1310;}});assert.throws(()=>T.exportDocument(doc),error=>error.code==='FIELDS');assert.equal(executed,0);
});
test('all rejected imports leave the current document intact',()=>{
 const current=M.patch(document(),{weather:{x:100,visible:false}}),before=clone(current),bad=portable();bad.widgets.weather.x=-1;
 for(const input of ['{bad',JSON.stringify(bad),portable('classic'),' '.repeat(T.MAX_BYTES+1)]){assert.throws(()=>T.prepareImport(input,current));assert.deepEqual(current,before);}
});
test('browser UMD exposes the same API and validates data without Node or eval',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../runtime/wallpaper/widget-model.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../runtime/wallpaper/layout-transfer-core.js'),'utf8'),context);
 assert.equal(context.PGLayoutTransferCore.FORMAT,T.FORMAT);assert.equal(context.PGLayoutTransferCore.parse(T.stringify(document())).theme,'paper-green');assert.equal(vm.runInContext('PGLayoutTransferCore.stringify(PGWidgetModel.create("classic","display-2"))',context),T.stringify(document('classic','display-2')));
});
