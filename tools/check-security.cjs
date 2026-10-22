'use strict';
// Local-only scan. Report rule + relative path, never matched bytes. No uploads.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),P=require('./publication.cjs');
function audit(root,{index=true}={}){
 let repository='';try{repository=JSON.parse(fs.readFileSync(path.join(root,'app-release.json'),'utf8')).repository||'';}catch{}if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))repository='';
 const files=P.list(root,'source'),findings=P.scan(root,files),personal=[process.env.USERNAME,process.env.COMPUTERNAME].filter(s=>s&&s.length>=5&&!['runneradmin','runner','localhost','system'].includes(s.toLowerCase()));
 const inspect=(name,bytes,scope)=>{const binary=/\.(?:png|ttf|dll|exe)$/i.test(name),body=binary?bytes.toString('latin1')+'\n'+bytes.toString('utf16le'):bytes.toString('utf8');for(const rule of P.scanText(body))findings.push({path:name,rule,scope});const identityText=repository?body.replaceAll(repository,'PUBLIC_REPOSITORY'):body;if(personal.some(s=>new RegExp('(^|[^a-z0-9])'+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9]|$)','i').test(identityText)))findings.push({path:name,rule:'local-machine-identity',scope});};
 for(const name of files)inspect(name,fs.readFileSync(path.join(root,name)),'worktree');
 let indexed=0,history=false,historyBlobs=0;
 if(index){
  const git=args=>cp.execFileSync('git',['-C',root,...args],{encoding:null,maxBuffer:32*1024*1024,stdio:['ignore','pipe','ignore']});
  const names=git(['ls-files','-z']).toString('utf8').split('\0').filter(Boolean);indexed=names.length;
  for(const name of names){if(!P.allowed(name,'source')){findings.push({path:name,rule:'not-allowlisted',scope:'index'});continue;}inspect(name,git(['show',':'+name]),'index');}
  try{git(['rev-parse','--verify','HEAD']);history=true;}catch{}
  if(history){
   const revisions=git(['rev-list','--all']).toString('utf8').trim().split('\n').filter(Boolean),seen=new Set();if(revisions.length>2000)throw Error('History exceeds local scan budget');
   for(const revision of revisions){if(!/^[a-f0-9]{40,64}$/.test(revision))throw Error('Invalid Git revision');for(const item of git(['ls-tree','-r','-z',revision]).toString('utf8').split('\0').filter(Boolean)){
    const match=/^\d+ blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(item);if(!match)continue;const [,object,name]=match;const identity=object+'|'+name;if(seen.has(identity))continue;seen.add(identity);if(seen.size>20000)throw Error('History exceeds local scan budget');historyBlobs++;
    if(!P.allowed(name,'source'))findings.push({path:name,rule:'not-allowlisted',scope:'history'});else inspect(name,git(['cat-file','blob',object]),'history');
   }}
  }
 }
 const unique=[...new Map(findings.map(f=>[JSON.stringify(f),f])).values()];return {schemaVersion:1,sourceFiles:files.length,indexedFiles:indexed,hasCommitHistory:history,historyScanned:index,historyBlobs,networkUsed:false,findings:unique};
}
module.exports={audit};
if(require.main===module){try{const root=path.resolve(__dirname,'..'),result=audit(root,{index:!process.argv.includes('--worktree-only')});console.log(JSON.stringify(result,null,2));if(result.findings.length)process.exitCode=1;}catch{console.error('Security scan failed; no private contents were emitted.');process.exitCode=1;}}
