'use strict';
const {authorized}=require('./desktop-controls.cjs');
function createDiagnostics({key,now=Date.now}){
 const latest=new Map();
 const origins=new Set(['null','file://','http://127.0.0.1:8767','http://localhost:8767']);
 function record(url){
  const q=url.searchParams,profile=q.get('vgProfile'),viewport=q.get('vgViewport'),context=q.get('vgContext');
  if(q.get('vgBuild')!=='input2k1'||!['display-1','display-2'].includes(profile)||!/^\d{2,5}x\d{2,5}$/.test(viewport||'')||!['engine','browser'].includes(context))return;
  const number=name=>{const s=q.get(name),n=Number(s);return s!==null&&Number.isFinite(n)&&n>=0&&n<=1e12?n:null;};
  const choice=(name,values)=>values.includes(q.get(name))?q.get(name):null;
  const instance=/^[a-f0-9]{12}$/.test(q.get('vgInstance')||'')?q.get('vgInstance'):'';
  const id=context+':'+profile+':'+viewport+':'+instance;latest.delete(id);latest.set(id,{receivedAt:now(),instance,profile,viewport,context,pause:choice('vgPause',['engine','hidden','running']),motion:choice('vgPrefs',['on','off']),frames:number('vgFrames'),frameAge:number('vgFrameAge'),clock:number('vgClock'),energy:number('vgEnergy'),glError:number('vgGlError'),contextLost:choice('vgContextLost',['yes','no']),barHeight:number('vgBarHeight'),audioAge:number('vgAudioAge'),audioPeak:number('vgPeak'),gearHit:choice('vgGearHit',['yes','no','missing']),themeHit:choice('vgThemeHit',['yes','no','missing']),settings:choice('vgSettings',['open','closed']),theme:choice('vgTheme',['open','closed'])});
  while(latest.size>12)latest.delete(latest.keys().next().value);
 }
 function handler(req,res){
  if(req.headers.origin&&!origins.has(req.headers.origin)){res.writeHead(403).end();return;}
  if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');res.setHeader('Access-Control-Allow-Headers','X-VioletGhost-Action, X-VioletGhost-Key');res.writeHead(204).end();return;}
  if(!authorized(req,key)){res.writeHead(403).end();return;}
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({clients:[...latest.values()].map(c=>({...c,age:now()-c.receivedAt}))}));
 }
 return {record,handler};
}
module.exports={createDiagnostics};
