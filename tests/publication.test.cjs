'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),P=require('../tools/publication.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wallpapershell-public-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function write(root,name,value){const file=path.join(root,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
test('source export never copies local state, private capabilities, unverified artwork or proprietary font',t=>{
 const root=fixture(t),target=path.join(root,'dist/export');for(const name of ['data/layouts.json','verification/screenshot.png','runtime/companion/.desktop-key','runtime/wallpaper/.controls-key.js','runtime/themes/luna-blue/.controls-key.js','runtime/wallpaper/assets/DaylightCondensed.ttf','runtime/themes/classic/assets/neon-city.webp','AGENTS.md','HANDOFF.md'])write(root,name,'private');write(root,'runtime/wallpaper/styles.css','url(assets/DaylightCondensed.ttf) url(assets/neon-city.webp)');
 const result=P.exportSource(root,target),manifest=JSON.parse(fs.readFileSync(path.join(target,'source-export-manifest.json')));assert.equal(result.files,1);assert.deepEqual(manifest.files.map(x=>x.path),['runtime/wallpaper/styles.css']);assert.match(fs.readFileSync(path.join(target,'runtime/wallpaper/styles.css'),'utf8'),/Oswald\.ttf.*public-water\.png/);assert.equal(manifest.files[0].sha256.length,64);
});
test('scanner returns rule and relative file only, never secret contents',t=>{
 const root=fixture(t),token='ghp_'+'x'.repeat(40);write(root,'src/Example.cs',token);const findings=P.scan(root,['src/Example.cs']);assert.deepEqual(findings,[{path:'src/Example.cs',rule:'github-token'}]);assert(!JSON.stringify(findings).includes(token));assert.throws(()=>P.exportSource(root,path.join(root,'dist/export')),error=>error.findings.length===1);
});

test('secret detection covers cloud tokens, bearer values and embedded credentials without echoing them',()=>{
 const samples=[['aws-access-key','AK'+'IA'+'Z'.repeat(16)],['bearer-token','Bea'+'rer '+'x'.repeat(36)],['embedded-login','pass'+'word="'+'x'.repeat(32)+'"'],['device-serial','device'+'Sn="'+'D'.repeat(16)+'"']];
 for(const [rule,secret]of samples){const result=P.scanText(secret);assert(result.includes(rule));assert(!JSON.stringify(result).includes(secret));}
});
test('personal local paths are detected but ordinary Windows framework paths are permitted',t=>{
 const root=fixture(t);write(root,'src/Example.cs',['C:','Users','PRIVATE_ACCOUNT','Documents'].join('/'));assert.equal(P.scan(root,['src/Example.cs'])[0].rule,'user-path');write(root,'src/Example.cs','C:/Windows/System32');assert.deepEqual(P.scan(root,['src/Example.cs']),[]);
 write(root,'src/Example.cs',['C:','Users','PRIVATE_ACCOUNT','Documents'].join('\\'));assert.equal(P.scan(root,['src/Example.cs'])[0].rule,'user-path');
});
test('notification documentation is replaced with portable instructions and exact icons are allowed',t=>{
 const root=fixture(t),target=path.join(root,'dist/export');write(root,'docs/NOTIFICATIONS.md','Portable setup instructions');write(root,'identity/notifications/README.md',['C:','Users','PRIVATE_ACCOUNT'].join('\\'));
 P.exportSource(root,target);assert.equal(fs.readFileSync(path.join(target,'identity/notifications/README.md'),'utf8'),'Portable setup instructions');
 assert(P.allowed('identity/notifications/Assets/Square44x44Logo.png','package'));assert(!P.allowed('identity/notifications/Assets/unknown.png','package'));
});
test('a re-export manifest never hashes its previous version or rewrites publication tooling',t=>{
 const root=fixture(t),first=path.join(root,'dist/first'),second=path.join(root,'dist/second');write(root,'tools/publication.cjs','const excluded="DaylightCondensed.ttf";');write(root,'README.md','Source');P.exportSource(root,first);P.exportSource(first,second);
 const manifest=JSON.parse(fs.readFileSync(path.join(second,'source-export-manifest.json')));assert(!manifest.files.some(f=>f.path==='source-export-manifest.json'));assert.match(fs.readFileSync(path.join(second,'tools/publication.cjs'),'utf8'),/DaylightCondensed\.ttf/);for(const file of manifest.files)assert.equal(P.manifest(second,[file.path])[0].sha256,file.sha256);
});
test('Windows path aliases, traversal, unknown executables and extras cannot enter a portable package',()=>{
 for(const name of ['../src/a.cs','/src/a.cs','C:/src/a.cs','bin/../data/key','bin\\x.exe','bin/CON.txt','bin/x.exe '])assert.equal(P.safeName(name),false,name);
 for(const name of ['bin/Unknown.exe','bin/.desktop-key','runtime/companion/private.json','runtime/companion/runtime-autostart.log','tools/arbitrary.ps1','data/foo.json'])assert.equal(P.allowed(name,'package'),false,name);
 for(const name of ['bin/WallpaperShell.exe','bin/WallpaperShell.Updater.exe','bin/node.exe','tools/launch-luna.ps1','runtime/companion/server.cjs'])assert.equal(P.allowed(name,'package'),true,name);
});
test('an image with changed pixels cannot bypass the reviewed asset hash',t=>{
 const root=fixture(t);write(root,'runtime/themes/luna-blue/assets/moon.png','different pixels');write(root,'licenses/assets-provenance.json',JSON.stringify({assets:[{path:'runtime/themes/luna-blue/assets/moon.png',sha256:'a'.repeat(64),redistribution:'included'}]}));assert.deepEqual(P.scan(root,['runtime/themes/luna-blue/assets/moon.png']),[{path:'runtime/themes/luna-blue/assets/moon.png',rule:'asset-provenance-mismatch'}]);
});
