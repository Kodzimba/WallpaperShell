(function(root,factory){const math=factory();if(typeof module==='object'&&module.exports)module.exports=math;else root.VGAppearanceMath=math;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const valid=s=>!!s&&['light','dark'].includes(s.mode)&&/^#[a-f0-9]{6}$/i.test(s.accent||'');
 const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 const luminance=hex=>rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 function palette(s){const accent=rgb(s.accent),dark=s.mode==='dark',bright=luminance(s.accent)>.179;return {background:dark?accent.map((v,i)=>(v*.12+[17,20,17][i]*.88)/255):accent.map(v=>v/255),dark:dark||!bright,ink:bright?'#000000':'#ffffff',signal:bright?s.accent:'#'+accent.map(v=>Math.round(v*.4+153).toString(16).padStart(2,'0')).join('')};}
 return {valid,rgb,palette};
});
(function(){
 if(typeof document==='undefined')return;
 const M=window.VGAppearanceMath,luna=document.body.dataset?.theme==='luna-blue',key=luna?'luna-blue-appearance-v1':'paper-green-appearance-v1';let state=luna?{mode:'dark',accent:'#b6d8f8',revision:0}:{mode:'light',accent:'#caff00',revision:0},pending=false,confirmed=false;
 const views=new Set(),presets=[['#caff00','Салатовый'],['#00d9d0','Бирюзовый'],['#66b7ff','Голубой'],['#ffbf47','Янтарный'],['#ff7965','Коралловый'],['#bb9aff','Лиловый']];
 try{const saved=JSON.parse(localStorage.getItem(key));if(M.valid(saved))state={...state,...saved};}catch{}
 function apply(next){
  if(!M.valid(next))return;state={mode:next.mode,accent:next.accent.toLowerCase(),revision:Number.isSafeInteger(next.revision)?next.revision:state.revision};
  const p=M.palette(state),style=document.documentElement.style;document.documentElement.dataset.appearance=state.mode;
  style.setProperty('--accent',state.accent);style.setProperty('--lime',state.accent);style.setProperty('--violet',state.accent);style.setProperty('--accent-rgb',M.rgb(state.accent).join(','));style.setProperty('--accent-ink',p.ink);style.setProperty('--media-accent',p.signal);style.setProperty('--scene-color','rgb('+p.background.map(v=>Math.round(v*255)).join(',')+')');
  try{localStorage.setItem(key,JSON.stringify(state));}catch{}
  for(const sync of views)sync();window.VGLiquid?.setPalette?.(p);window.dispatchEvent(new CustomEvent('paper:appearance',{detail:{...state}}));
 }
 function receive(next,force=false){if(!M.valid(next)||pending)return;if(confirmed&&next.mode===state.mode&&next.accent.toLowerCase()===state.accent&&next.revision===state.revision)return;if(force||!confirmed||next.revision>=state.revision){confirmed=true;apply(next);}}
 async function choose(next,message){
  if(pending)return;const previous={...state};pending=true;apply(next);message.textContent='Сохраняю…';
  try{const base=window.VGCore?.bridgeUrl(document.getElementById('bridgeInput')?.value||'http://127.0.0.1:8767/status');if(!base||!window.VG_LOCAL_CONTROL_KEY)throw Error();const u=new URL('/controls',base);
   const r=await fetch(u.href,{method:'POST',headers:{'Content-Type':'application/json','X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY},body:JSON.stringify({kind:'appearance',mode:state.mode,accent:state.accent,...(luna?{theme:'luna-blue'}:{})}),signal:AbortSignal.timeout(5000),credentials:'omit',redirect:'error'});if(!r.ok)throw Error();const result=await r.json();if(!M.valid(result.source?.data))throw Error();confirmed=true;apply(result.source.data);message.textContent='Применено на обоих экранах.';
  }catch{apply(previous);message.textContent='Не удалось сохранить. Проверь Companion.';}finally{pending=false;for(const sync of views)sync();}
 }
 function mount(container,custom=false){
  const section=document.createElement('div');section.className='appearance-controls';const label=document.createElement('strong');label.textContent='Светлая / тёмная';section.append(label);
  const modes=document.createElement('div');modes.className='appearance-modes';const message=document.createElement('p');message.className='appearance-message';message.setAttribute('role','status');
  const buttons=[];
  for(const [mode,text]of [['light','Светлая'],['dark','Тёмная']]){const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.mode=mode;b.addEventListener('click',()=>choose({...state,mode},message));buttons.push(b);modes.append(b);}section.append(modes);
  const heading=document.createElement('strong');heading.textContent='Акцентный цвет';section.append(heading);const colors=document.createElement('div');colors.className='appearance-colors';
  for(const [accent,text]of presets){const b=document.createElement('button');b.type='button';b.title=text;b.setAttribute('aria-label',text);b.dataset.accent=accent;const dot=document.createElement('i');dot.style.background=accent;b.append(dot);b.addEventListener('click',()=>choose({...state,accent},message));buttons.push(b);colors.append(b);}section.append(colors);
  let field;
  if(custom){const row=document.createElement('div');row.className='appearance-custom';field=document.createElement('span');field.className='daylight-field';field.contentEditable='true';field.spellcheck=false;field.setAttribute('role','textbox');field.setAttribute('aria-label','Свой акцентный цвет HEX');const b=document.createElement('button');b.type='button';b.textContent='Применить';b.addEventListener('click',()=>{const accent=field.textContent.trim();if(!M.valid({mode:state.mode,accent})){message.textContent='Нужен цвет в формате #CAFF00.';return;}choose({...state,accent},message);});row.append(field,b);section.append(row);}
  section.append(message);container.append(section);const sync=()=>{for(const b of buttons){b.disabled=pending;b.setAttribute('aria-pressed',String(b.dataset.mode?state.mode===b.dataset.mode:state.accent===b.dataset.accent));}if(field&&document.activeElement!==field)field.textContent=state.accent.toUpperCase();};views.add(sync);sync();
 }
 window.VGAppearance={get:()=>({...state}),palette:()=>M.palette(state),receive,mount};
 window.addEventListener('daylight:snapshot',event=>receive(luna?event.detail?.lunaAppearance:event.detail?.appearance));apply(state);
})();
