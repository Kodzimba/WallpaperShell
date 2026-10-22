(function(){
 'use strict';
 const api=window.PGCustomWidgets,C=window.PGCustomWidgetModel,stage=document.getElementById('stage');if(!api||!stage)return;
 const root=document.createElement('div');root.id='customWidgetLayer';stage.append(root);const nodes=new Map();let snapshot=null,tick=null,disposed=false;
 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const artwork={moon:'☾',sun:'☀',water:'≋',orbit:'◎',leaf:'❧'};
 const clockFormat=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}),numberFormat=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
 const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 const fields={ramUsed:['system','ramUsedBytes',15000,1073741824],ramPercent:['system','ramUsedBytes',15000,'ramTotalBytes'],vramUsed:['system','vramUsedBytes',15000,1073741824],vramPercent:['system','vramUsedBytes',15000,'vramTotalBytes'],mouseBattery:['mouse','batteryPercent',120000,1],ping:['network','pingMs',15000,1],download:['speedtest','downMbps',4500000,1],upload:['speedtest','upMbps',4500000,1],temperature:['weather','temperatureC',1800000,1]};
 const stopped=()=>document.hidden||document.body.classList.contains('engine-paused');
 function create(spec,{preview=false,id='preview'}={}){
  const s=C.spec(spec),node=el('section','pg-custom-card');node.style.setProperty('--custom-accent',s.accent);node.style.width=s.width+'px';node.style.height=s.height+'px';node.dataset.kind=s.kind;
  node.style.padding=Math.min(22,s.height*.09)+'px '+Math.min(24,s.width*.06)+'px';
  const title=el('header','pg-custom-title',s.title);node.append(title);if(s.art!=='none'){const art=el('span','pg-custom-art',artwork[s.art]);art.setAttribute('aria-hidden','true');node.append(art);}
  const content=el('div','pg-custom-content');node.append(content);const value=el('strong','pg-custom-value'),detail=el('p','pg-custom-detail',s.text);detail.style.fontSize=Math.max(11,Math.min(23,Math.sqrt(s.width*(s.height-65)/Math.max(1,s.text.length))*1.15))+'px';
  if(s.kind==='note')content.append(detail);
  else if(s.kind==='checklist'){
   let checked=[];try{checked=JSON.parse(localStorage.getItem('pg-custom-checks:'+id))||[];}catch{}
   for(const [index,text]of s.items.entries()){const label=el('label','pg-custom-check'),input=el('input');input.type='checkbox';input.checked=Array.isArray(checked)&&checked.includes(index);input.disabled=preview;input.addEventListener('change',()=>{checked=[...content.querySelectorAll('input')].flatMap((v,i)=>v.checked?[i]:[]);try{localStorage.setItem('pg-custom-checks:'+id,JSON.stringify(checked));}catch{}});label.append(input,el('span','',text));content.append(label);}if(!s.items.length)content.append(detail);
  }else{content.append(value,detail);if(s.kind==='progress'){const track=el('div','pg-custom-track'),fill=el('div','pg-custom-fill');track.append(fill);content.append(track);}}
  value.style.fontSize=Math.max(18,Math.min(58,(s.height-60)*.42,s.width*.12))+'px';
  node._update=()=>{
   if(s.kind==='clock'){text(value,clockFormat.format(new Date()));return;}
   if(s.kind==='countdown'){const seconds=Math.max(0,Math.floor((Date.parse(s.target)-Date.now())/1000)),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);text(value,(days?days+' д ':'')+String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0'));return;}
   if(!['metric','progress'].includes(s.kind))return;
   const binding=metric(s.binding);text(value,binding===null?'—':numberFormat.format(binding)+(s.unit?' '+s.unit:''));
   if(s.kind==='progress'){const fill=node.querySelector('.pg-custom-fill'),percent=binding===null?0:Math.max(0,Math.min(100,binding)),width=percent+'%',label=binding===null?'Нет данных':width;if(fill.style.width!==width)fill.style.width=width;if(fill.parentElement.getAttribute('aria-label')!==label)fill.parentElement.setAttribute('aria-label',label);}
  };node._nextDelay=now=>{
   if(s.kind==='clock')return 60001-now%60000;
   if(s.kind==='countdown'){const remaining=Date.parse(s.target)-now;return remaining>=60000?remaining%60000+1:Infinity;}
   if(!['metric','progress'].includes(s.kind))return Infinity;
   const field=fields[s.binding];if(!field)return Infinity;const [kind,key,ttl]=field,source=snapshot?.sources?.[kind];if(source?.status!=='ok')return Infinity;
   const measurement=kind==='system'?(key.startsWith('vram')?'vram':'ram'):null,at=Date.parse(measurement&&source.measurements&&Object.hasOwn(source.measurements,measurement)?source.measurements[measurement]:source.updatedAt);
   if(!Number.isFinite(at))return Infinity;
   if(at>now+30000)return at-now-30000+1;
   return at+ttl>=now?at+ttl-now+1:Infinity;
  };node._update();return node;
 }
 function metric(binding){
  const field=fields[binding];if(!field)return null;const [source,key,ttl,divisor]=field,raw=snapshot?.sources?.[source],entry=source==='system'?window.VGCore?.freshSystem(raw):raw;if(window.VGCore?.sourceState(entry,Date.now(),ttl)!=='ok')return null;const data=entry.data||{},value=data[key];if(typeof value!=='number'||!Number.isFinite(value))return null;const total=typeof divisor==='string'?data[divisor]:divisor;if(typeof total!=='number'||!Number.isFinite(total)||total<=0)return null;return value/total*(typeof divisor==='string'?100:1);
 }
 function schedule(){
  if(tick!==null){window.clearTimeout(tick);tick=null;}if(disposed||stopped())return;
  const now=Date.now();let delay=Infinity;for(const {node}of nodes.values())if(!node.hidden)delay=Math.min(delay,node._nextDelay(now));
  if(Number.isFinite(delay))tick=window.setTimeout(()=>{tick=null;update();},Math.max(1,Math.min(2147483647,delay)));
 }
 function update(){if(disposed)return;if(!stopped())for(const {node}of nodes.values())if(!node.hidden)node._update();schedule();}
 function render(){if(disposed)return;const doc=api.current();if(!doc)return;const keep=new Set();for(const item of doc.items){keep.add(item.id);const signature=JSON.stringify(item.spec);let entry=nodes.get(item.id);if(!entry||entry.signature!==signature){const node=create(item.spec,{id:item.id});node.dataset.customWidget=item.id;if(entry)entry.node.replaceWith(node);else root.append(node);entry={node,signature};nodes.set(item.id,entry);}const g=item.geometry,node=entry.node,hidden=!g.visible,inert=!!window.PGLayoutEditor?.isEditing();if(node.hidden!==hidden)node.hidden=hidden;if(node.inert!==inert)node.inert=inert;for(const [key,value]of Object.entries({left:g.x+'px',top:g.y+'px',transform:'scale('+g.scale+')'}))if(node.style[key]!==value)node.style[key]=value;}for(const [id,entry]of nodes)if(!keep.has(id)){entry.node.remove();nodes.delete(id);}update();}
 window.PGCustomRenderer={create};const unsubscribe=api.subscribe(render);window.addEventListener('daylight:snapshot',event=>{snapshot=event.detail;update();});
 window.addEventListener('paper:layout-editing',render);document.addEventListener('visibilitychange',update);
 const observer=typeof MutationObserver!=='undefined'?new MutationObserver(update):null;observer?.observe(document.body,{attributes:true,attributeFilter:['class']});
 window.addEventListener('pagehide',()=>{disposed=true;if(tick!==null)window.clearTimeout(tick);tick=null;observer?.disconnect();unsubscribe?.();});
})();
