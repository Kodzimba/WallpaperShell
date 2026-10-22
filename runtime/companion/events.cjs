'use strict';
const fresh=(s,now,ttl)=>s?.status==='ok'&&Number.isFinite(Date.parse(s.updatedAt))&&now-Date.parse(s.updatedAt)>=0&&now-Date.parse(s.updatedAt)<ttl;
class EventFeed {
 constructor(){this.items=[];this.previous=new Map();this.id=0;this.probeAt=null;this.failures=0;this.internetWarning=false;this.inputCandidate=null;this.inputCount=0;}
 push(kind,text,tone,now){
  this.items=this.items.filter(e=>e.until>now);
  const queued=this.items.find(e=>e.kind===kind&&e.start>now);
  if(queued){Object.assign(queued,{id:++this.id,text,tone:tone||'info',at:now});return;}
  if(this.items.length>=3)this.items=this.items.slice(0,2);
  const start=Math.max(now,this.items.at(-1)?.until||now);
  this.items.push({id:++this.id,kind,text,tone: tone||'info',at:now,start,until:start+6500});
 }
 changed(key,value,now,callback){const before=this.previous.get(key);this.previous.set(key,{value,at:now});if(before&&now-before.at<300000&&before.value!==value)callback(before.value,value);}
 observe(sources,now=Date.now()){
  this.items=this.items.filter(e=>e.until>now);
  const m=sources.mouse;
  if(fresh(m,now,120000)){
   if(typeof m.data?.charging==='boolean')this.changed('charging',m.data.charging,now,(_,v)=>this.push('mouse',v?'Мышь заряжается':m.data.batteryPercent>=99?'Мышь заряжена':'Мышь работает от аккумулятора','info',now));
   const battery=m.data?.batteryPercent;if(Number.isFinite(battery))this.changed('mouseLevel',battery<=5?'critical':battery<=15?'low':battery<=25?'warning':'normal',now,(_,v)=>{if(v!=='normal')this.push('mouse','Мышь: заряд '+Math.round(battery)+'%',v==='critical'?'critical':'warning',now);});
  }
  const d=sources.desktop;
  if(fresh(d,now,15000)){
   const audio=Array.isArray(d.data?.audio)?d.data.audio:[],selected=audio.find(a=>a.selected)?.key||'other';
   this.changed('output',selected,now,(old,value)=>{
    const names={headphones:'наушники Razer',speakers:'колонки Realtek',tv:'телевизор Samsung',other:'другой выход'};
    const removed=audio.find(a=>a.key===old)?.available===false;
    this.push('audio',removed?'Аудиоустройство отключено':`Звук: ${names[value]||names.other}`,removed?'warning':'info',now);
   });
   if(['single','dual'].includes(d.data?.displays?.mode))this.changed('displays',d.data.displays.mode,now,(_,v)=>this.push('displays',v==='single'?'Работает основной монитор 2К':'Оба монитора включены','info',now));
  }
  const n=sources.network,probe=n?.measurements?.connectivity;
  if(fresh(n,now,15000)&&probe&&probe!==this.probeAt&&now-Date.parse(probe)<12000){
   this.probeAt=probe;
   if(n.data?.internet===true){if(this.internetWarning)this.push('internet','Интернет снова доступен','info',now);this.internetWarning=false;this.failures=0;}
   else if(++this.failures>=3&&!this.internetWarning){this.internetWarning=true;this.push('internet','Проверка интернета не отвечает','warning',now);}
  }
  const eco=sources.ecoflow;
  if(fresh(eco,now,120000)&&Number.isFinite(eco.data?.inputWatts)&&Number.isFinite(eco.data?.outputWatts)){
   const input=eco.data.inputWatts>=20?'present':eco.data.inputWatts<=1&&eco.data.outputWatts>=10?'absent':null;
   const stamp=eco.measurements?.inputWatts;
   if(input&&stamp&&this.inputStamp!==stamp){this.inputStamp=stamp;if(this.inputCandidate===input)this.inputCount++;else{this.inputCandidate=input;this.inputCount=1;}if(this.inputCount>=2)this.changed('ecoInput',input,now,(_,v)=>this.push('ecoflow',v==='present'?'EcoFlow: входное питание восстановлено':'EcoFlow: нет входного питания',v==='present'?'info':'warning',now));}
  }
  return {status:'ok',identity:'VioletGhost / observed state changes',updatedAt:new Date(now).toISOString(),data:{items:this.items.map(e=>({...e}))}};
 }
}
module.exports={EventFeed};
