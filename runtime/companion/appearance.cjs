'use strict';
const fs=require('node:fs'),path=require('node:path');
const valid=value=>value&&typeof value==='object'&&!Array.isArray(value)&&['light','dark'].includes(value.mode)&&/^#[a-f0-9]{6}$/i.test(value.accent||'');
function createAppearance(root,theme='paper-green'){
 if(!['paper-green','luna-blue'].includes(theme))throw Error('Unknown appearance theme');
 const file=path.join(root,theme==='luna-blue'?'companion/.luna-appearance.json':'companion/.appearance.json');let value=theme==='luna-blue'?{mode:'dark',accent:'#b6d8f8',revision:0}:{mode:'light',accent:'#caff00',revision:0};
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(valid(saved)&&Number.isSafeInteger(saved.revision)&&saved.revision>=0)value={mode:saved.mode,accent:saved.accent.toLowerCase(),revision:saved.revision};}catch{}
 return {get:()=>({...value}),set(next){if(!valid(next))throw Error('Invalid appearance');const updated={mode:next.mode,accent:next.accent.toLowerCase(),revision:Math.max(Date.now(),value.revision+1)};fs.writeFileSync(file+'.tmp',JSON.stringify(updated),{mode:0o600});fs.renameSync(file+'.tmp',file);value=updated;return {status:'ok',identity:'Paper Green appearance',updatedAt:new Date().toISOString(),data:{...updated}};}};
}
module.exports={valid,createAppearance};
