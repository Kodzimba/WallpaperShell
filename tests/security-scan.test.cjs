'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),{audit}=require('../tools/check-security.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wallpapershell-secret-scan-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const empty=path.join(root,'verification/empty');fs.mkdirSync(empty,{recursive:true});const git=(...args)=>cp.execFileSync('git',['-C',root,'-c','core.autocrlf=false','-c','commit.gpgsign=false','-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath='+empty,...args],{stdio:'ignore'});git('init','--template='+empty);return {root,git,write:(name,value)=>{const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);}};}
test('a clean worktree cannot hide a secret that is still staged for publication',t=>{
 const f=fixture(t),secret='gh'+'p_'+'x'.repeat(36);f.write('src/Example.cs',secret);f.git('add','.');f.write('src/Example.cs','Safe source');const result=audit(f.root);assert(result.findings.some(v=>v.scope==='index'&&v.rule==='github-token'));assert(!JSON.stringify(result).includes(secret));assert.equal(result.networkUsed,false);assert.equal(result.hasCommitHistory,false);
});

test('a staged secret cannot evade inspection by using an approved binary filename',t=>{
 const f=fixture(t),secret='gh'+'p_'+'x'.repeat(36),name='runtime/themes/luna-blue/assets/moon.png';f.write(name,secret);f.git('add','.');fs.unlinkSync(path.join(f.root,name));assert(audit(f.root).findings.some(v=>v.scope==='index'&&v.rule==='github-token'));
});
test('a secret removed from the latest commit is still detected in reachable history',t=>{
 const f=fixture(t),secret='AK'+'IA'+'Z'.repeat(16);f.write('src/Example.cs',secret);f.git('add','.');f.git('commit','-m','Synthetic secret fixture');f.write('src/Example.cs','Safe replacement');f.git('add','.');f.git('commit','-m','Synthetic cleanup');const result=audit(f.root);assert(result.historyScanned&&result.hasCommitHistory);assert(result.findings.some(v=>v.scope==='history'&&v.rule==='aws-access-key'));assert(!result.findings.some(v=>v.scope==='index'));assert(!JSON.stringify(result).includes(secret));
});
test('intentional public repository identity is allowed while stray machine identity is rejected',t=>{
 const f=fixture(t),previous=process.env.USERNAME;process.env.USERNAME='SyntheticLocalIdentity';try{f.write('app-release.json',JSON.stringify({repository:'SyntheticLocalIdentity/Example'}));f.write('README.md','Project SyntheticLocalIdentity/Example');assert.equal(audit(f.root,{index:false}).findings.length,0);f.write('README.md','Machine SyntheticLocalIdentity');assert(audit(f.root,{index:false}).findings.some(v=>v.rule==='local-machine-identity'));}finally{if(previous===undefined)delete process.env.USERNAME;else process.env.USERNAME=previous;}
});
