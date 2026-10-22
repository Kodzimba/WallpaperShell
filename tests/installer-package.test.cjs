'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),P=require('../tools/publication.cjs');
const root=path.resolve(__dirname,'..');
test('installer sources and pinned manifest export without shipping build tools or bootstrappers as app files',()=>{
 for(const name of ['installer/WallpaperShell.iss','installer/policy.iss','tools/bootstrap-installer.ps1','tools/package-installer.ps1','tools/installer-dependencies.json','tests/InstallerPolicy.iss']){assert(P.allowed(name,'source'),name);assert(!P.allowed(name,'package'),name);}
 for(const name of ['installer/MicrosoftEdgeWebview2Setup.exe','installer/ndp48-web.exe','bin/ISCC.exe','.build-cache/inno-7.1.0/ISCC.exe']){assert(!P.allowed(name,'source'));assert(!P.allowed(name,'package'));}
 assert(P.allowed('identity/application.ico','source'));assert(!P.allowed('identity/application.ico','package'));assert(!P.allowed('identity/other.ico','package'));
});
test('application icon is the original crescent in a valid single-image ICO container',()=>{
 const bytes=fs.readFileSync(path.join(root,'identity/application.ico')),png=fs.readFileSync(path.join(root,'identity/notifications/Assets/Square150x150Logo.png'));
 assert.equal(bytes.readUInt16LE(2),1);assert.equal(bytes.readUInt16LE(4),1);assert.equal(bytes.readUInt32LE(18),22);assert.deepEqual(bytes.subarray(22),png);
});
test('release, application manifest and Windows file metadata expose the same version',()=>{
 const v=JSON.parse(fs.readFileSync(path.join(root,'app-release.json'),'utf8')).version;
 assert(fs.readFileSync(path.join(root,'src/app.manifest'),'utf8').includes('version="'+v+'.0"'));
 assert(fs.readFileSync(path.join(root,'src/AppAssembly.cs'),'utf8').includes('AssemblyFileVersion("'+v+'.0")'));
});
test('application icon is covered by the reviewed asset hash',()=>{
 assert.deepEqual(P.scan(root,['identity/application.ico']),[]);
});
