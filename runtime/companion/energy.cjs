'use strict';
// DELTA 3 Max: nominal 2048 Wh (EcoFlow EU). 0.85 is an explicit runtime
// modelling assumption, following EcoFlow's runtime example, not battery telemetry.
// https://eu.ecoflow.com/products/delta-3-max-series-portable-power-station
// https://www.ecoflow.com/us/blog/how-long-will-a-3000-watt-solar-generator-run
const fs=require('node:fs');
const WINDOW=20*60000,INTERVAL=15000;
class Energy {
 constructor(file){this.file=file;this.points=[];this.saved=0;try{const points=JSON.parse(fs.readFileSync(file,'utf8'));this.points=points.filter(p=>Number.isFinite(p.at)&&p.at<=Date.now()&&Date.now()-p.at<WINDOW&&Number.isFinite(p.watts)&&p.watts>=0).sort((a,b)=>a.at-b.at).slice(-81);}catch{}}
 enrich(source,now=Date.now()){
  this.points=this.points.filter(p=>now-p.at<WINDOW&&p.at<=now);
  const data=source.data;if(source.status!=='ok'||!data)return source;
  const at=Date.parse(source.measurements?.outputWatts),socAt=Date.parse(source.measurements?.batteryPercent);
  const watts=data.outputWatts,soc=data.batteryPercent;
  const fresh=Number.isFinite(at)&&at<=now&&now-at<120000&&Number.isFinite(watts)&&watts>=0;
  if(fresh&&(!this.points.length||at-this.points.at(-1).at>=INTERVAL)){
   this.points.push({at,watts});this.points=this.points.slice(-81);
   if(this.file&&now-this.saved>=30000){try{fs.writeFileSync(this.file,JSON.stringify(this.points));this.saved=now;}catch{}}
  }
  const recent=this.points.filter(p=>at-p.at<=60000&&at>=p.at);
  const average=fresh?(recent.length?recent.reduce((sum,p)=>sum+p.watts,0)/recent.length:watts):null;
  const socFresh=Number.isFinite(socAt)&&socAt<=now&&now-socAt<120000&&Number.isFinite(soc)&&soc>=0&&soc<=100;
  // A near-zero load is dominated by unknown standby losses; don't show huge hours.
  const runtime=fresh&&socFresh&&watts>=10&&average>=10?2048*(soc/100)*.85/average*60:null;
  return {...source,data:{...data,loadHistory:this.points.map(p=>({...p})),loadAverageWatts:average,estimatedRuntimeMinutes:runtime===null?null:Math.round(runtime/(runtime>=60?5:1))*(runtime>=60?5:1),runtimeCapacityWh:2048,runtimeEfficiency:.85,runtimeBasis:'nominal capacity × SOC × 0.85 / mean output (60s); no incoming charge',runtimeUpdatedAt:runtime===null?null:new Date(Math.min(at,socAt)).toISOString()}};
 }
}
module.exports={Energy};
