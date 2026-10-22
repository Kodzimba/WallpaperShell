(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VGLauncherMath=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function scrollMetrics(view,content,track){view=Math.max(0,view||0);content=Math.max(view,content||0);track=Math.max(0,track||0);const max=Math.max(0,content-view),thumb=max?Math.min(track,Math.max(38,track*view/content)):track;return {max,thumb,travel:Math.max(0,track-thumb)};}
 function dragScroll(start,delta,max,travel){return travel>0?clamp(start+delta*max/travel,0,max):0;}
 function rasterSize(width,height,physicalScale,maxWidth,maxHeight){if(!(width>0&&height>0&&physicalScale>0))return {width:0,height:0};const factor=Math.min(1/physicalScale,maxWidth/width,maxHeight/height);return {width:width*factor,height:height*factor};}
 function wheelDelta(event,page){let value=Number.isFinite(event.deltaY)?event.deltaY:-(Number(event.wheelDelta)||0);if(event.deltaMode===1)value*=24;if(event.deltaMode===2)value*=page;return clamp(value,-page*2,page*2);}
 function fileKind(name){const extension=String(name||'').split('.').pop().toLowerCase();if(!String(name||'').includes('.'))return 'other';if(['png','jpg','jpeg','webp','gif','bmp','tif','tiff','svg','avif','heic','heif','ico'].includes(extension))return 'images';if(['txt','md','markdown','rtf','doc','docx','odt','pdf','log','csv','tsv','xls','xlsx','ods','ppt','pptx','odp','json','xml','yaml','yml','ini','cfg','conf','toml'].includes(extension))return 'text';return 'other';}
 function isNewFile(entry,now=Date.now()){return entry?.type==='file'&&entry.group==='files'&&Number.isFinite(entry.newUntil)&&entry.newUntil>now&&entry.newUntil<=now+86400000;}
 function pickSelection(order,current,anchor,picked,{toggle=false,range=false}={}){const valid=new Set(order),selected=new Set([...current].filter(id=>valid.has(id)));if(!valid.has(picked))return selected;const a=order.indexOf(anchor),b=order.indexOf(picked);if(range&&a>=0){if(!toggle)selected.clear();for(const id of order.slice(Math.min(a,b),Math.max(a,b)+1))selected.add(id);}else if(toggle){if(selected.has(picked))selected.delete(picked);else selected.add(picked);}else{selected.clear();selected.add(picked);}return selected;}
 function intersects(a,b){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}
 return {scrollMetrics,dragScroll,rasterSize,wheelDelta,fileKind,isNewFile,pickSelection,intersects};
});
(function(){
 'use strict';
 if(typeof document==='undefined')return;
 const M=window.VGLauncherMath;
 let newBadges=[],newBadgeTimer=null;
 const $=id=>document.getElementById(id),root=$('launcher'),rail=$('launcherRail'),nav=$('launcherCategories'),panel=$('launcherPanel'),items=$('launcherItems');
 const luna=document.body?.dataset?.theme==='luna-blue',railWidth=luna?310:592,railGap=luna?342:624;
 let bridge='',profile='display-1',data=null,opened=null,arranging=false,busy=false,paused=false,editing=false,drag=null,scrollDrag=null,viewGroup=null,timer=null,hover=null,closing=null,feedbackTimer=null,controller=null,generation=0,position={x:24,y:80},lastWheel=-Infinity,lastModernWheel=-Infinity;
 let inputId='',inputGeneration=0,inputTimer=null,inputController=null,inputRegistered=false,inputSequence=0;
 let fileFilter='all';
 let fileDrag=null,fileDropHover=null,fileHoverTimer=null,suppressClickUntil=0,pendingMove=null;
 let selectedFiles=new Set(),selectionAnchor=null,selectionMode=false,boxDrag=null,boxFrame=null;
 const overlayHost=!!window.VGOverlayHost;
 const settingsOpen=()=>['settings','themePicker'].some(id=>$(id)?.hidden===false);
 let remoteId='',remoteShown=false,remoteSerial=0,hostOpen=null,remotePending='';
 let contextActive=false,openSerial=0,fallbackEscapeHeld=false;
 const icons={work:'work',games:'games',leisure:'chat',tools:'tools',folders:'folder',files:'files',unsorted:'inbox'};
 const headers=()=>({'X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY||''});
 const layoutKey=()=>`${luna?'luna-blue':'paper-green-app'}-launcher-layout-v1:${profile}`;
 function endpoint(){try{const u=new URL(bridge);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='8767'||!window.VG_LOCAL_CONTROL_KEY)return null;u.pathname='/launcher';u.search='';u.hash='';return u.href;}catch{return null;}}
 function symbol(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-launch-'+name);svg.appendChild(use);return svg;}
 function count(id){return data?.items?.filter(item=>item.group===id).length||0;}
 function place(){
  const height=rail.offsetHeight||470;
  position.x=Math.max(16,Math.min(luna?1594:1304,Number(position.x)||24));position.y=Math.max(80,Math.min(1010-height,Number(position.y)||200));
  rail.style.left=position.x+'px';rail.style.top=position.y+'px';
  const left=position.x+railGap+884<=1904?position.x+railGap:position.x-902;
  panel.style.left=Math.max(16,left)+'px';panel.style.top=Math.min(244,Math.max(80,position.y-64))+'px';
  $('launcherFeedback').style.left=Math.max(16,left)+'px';$('launcherFeedback').style.top=Math.min(1038,Math.max(80,position.y-64)+808)+'px';
 }
 function loadPosition(){if(window.PGLayouts&&!overlayHost){const p=window.PGLayouts.activate(profile).get().widgets.launcher;position={x:p.x,y:p.y};place();return;}try{const p=JSON.parse(localStorage.getItem(layoutKey()));position=p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&!(p.x===18&&p.y===408)?p:{x:24,y:80};}catch{position={x:24,y:80};}place();}
 function cancelClose(){clearTimeout(closing);}
 function highlight(group){nav.classList.toggle('launcher-hovering',!!group);nav.querySelectorAll('button').forEach(b=>{b.dataset.hovered=String(b.dataset.group===group);});}
 function close(reason='explicit'){if(contextActive&&!['external','suspend','reset','replacement'].includes(reason))return;clearTimeout(newBadgeTimer);newBadgeTimer=null;openSerial++;clearTimeout(hover);cancelClose();finishScroll();clearFileDrag();finishBox(null,true);selectedFiles.clear();selectionAnchor=null;selectionMode=false;pendingMove=null;stopNativeInput();opened=null;panel.hidden=true;arranging=false;highlight(null);nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-expanded','false'));remoteSerial++;if(remoteId){const u=overlayEndpoint();if(u)fetch(u,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({action:'close',id:remoteId}),keepalive:true,credentials:'omit',redirect:'error'}).catch(()=>{});}remoteId='';remoteShown=false;remotePending='';window.PGWindows?.releasePanel?.('launcher');if(overlayHost)window.VGOverlayHost.hide();}
 function delayedClose(){clearTimeout(hover);cancelClose();if(contextActive||remoteShown||remotePending||scrollDrag||fileDrag||boxDrag)return;closing=setTimeout(()=>{if(!panel.contains(document.activeElement))close();},450);}
 nav.addEventListener('pointerleave',()=>highlight(null));
 function overlayEndpoint(){const u=endpoint();if(!u)return null;const url=new URL(u);url.pathname='/launcher-overlay';return url.href;}
 function nativeOverlayAvailable(){return !overlayHost&&(window.PG_APP?window.PG_APP_DESKTOP===true:window.PG_APP_DESKTOP===true)&&!!overlayEndpoint();}
 function surfaceRequest(){const s=window.PGSurface;return s?{surfaceId:s.surfaceId,monitorId:s.monitorId,ownerHandle:s.ownerHandle,...(s.shellOwnerHandle?{shellOwnerHandle:s.shellOwnerHandle}:{}),bounds:{x:s.bounds.x,y:s.bounds.y,width:s.bounds.width,height:s.bounds.height},profile:s.profile}:null;}
 async function openAboveWindows(group){
  if(!nativeOverlayAvailable()||fileDrag||pendingMove||remotePending===group)return;
  const u=overlayEndpoint();if(!u)return;
  remotePending=group;cancelClose();const at=++remoteSerial,id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');remoteId=id;remoteShown=false;
  const stage=document.getElementById('stage').getBoundingClientRect(),scale=stage.width/1920,left=Number.parseFloat(panel.style.left),top=Number.parseFloat(panel.style.top);
  const x=Math.min(position.x,left),y=Math.min(position.y,top),right=Math.max(position.x+railWidth,left+884),bottom=Math.max(position.y+(luna?450:600),top+800),dpr=window.devicePixelRatio||1;
  const rect=[(stage.left+x*scale)/window.innerWidth,(stage.top+y*scale)/window.innerHeight,(stage.left+right*scale)/window.innerWidth,(stage.top+bottom*scale)/window.innerHeight].map(n=>Math.max(0,Math.min(1,n)));
  const button=Array.from(nav.querySelectorAll('button')).find(b=>b.dataset.group===group),r=button.getBoundingClientRect(),trigger=[r.left/window.innerWidth,r.top/window.innerHeight,r.right/window.innerWidth,r.bottom/window.innerHeight].map(n=>Math.max(0,Math.min(1,n)));
  const surface=surfaceRequest();
  try{const response=await fetch(u,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({action:'open',theme:luna?'luna-blue':'daylight',...(window.VGAppearance?{appearance:window.VGAppearance.get()}:{}),...(surface?{surface}:{}),id,group,profile,width:surface?.bounds.width||Math.round(window.innerWidth*dpr),height:surface?.bounds.height||Math.round(window.innerHeight*dpr),rect,trigger,position}),signal:AbortSignal.timeout(35000),credentials:'omit',redirect:'error'});const result=await response.json();if(at!==remoteSerial)return;if(response.ok&&result.blocked){close('replacement');return;}if(response.ok&&result.shown){remoteShown=true;panel.hidden=true;stopNativeInput();cancelClose();}}
  catch{/* Keep the in-page fallback on failure. */}
  finally{if(at===remoteSerial){remotePending='';if(!remoteShown&&opened===group){panel.hidden=false;startNativeInput();}}}
 }
 function updateScrollbar(){
  const track=$('launcherScrollTrack'),thumb=$('launcherScrollThumb'),metrics=M.scrollMetrics(items.clientHeight,items.scrollHeight,track.clientHeight);
  $('launcherScrollbar').classList.toggle('no-scroll',!metrics.max);thumb.disabled=!metrics.max;
  thumb.style.height=metrics.thumb+'px';thumb.style.transform=`translateY(${metrics.max?metrics.travel*items.scrollTop/metrics.max:0}px)`;
  thumb.setAttribute('aria-valuenow',String(metrics.max?Math.round(items.scrollTop/metrics.max*100):0));
  $('launcherScrollUp').disabled=items.scrollTop<=0;$('launcherScrollDown').disabled=items.scrollTop>=metrics.max;
 }
 function scrollBy(delta){items.scrollTop=Math.max(0,Math.min(Math.max(0,items.scrollHeight-items.clientHeight),items.scrollTop+delta));updateScrollbar();}
 function wheel(event){if(!opened||!panel.contains(event.target))return;const now=performance.now();if(event.type==='mousewheel'&&now-lastModernWheel<60){event.preventDefault();return;}if(event.type==='wheel')lastModernWheel=now;lastWheel=now;const delta=M.wheelDelta(event,items.clientHeight||600);if(delta){event.preventDefault();event.stopPropagation();cancelClose();scrollBy(delta);}}
 function inputEndpoint(){const url=endpoint();if(!url)return null;const u=new URL(url);u.pathname='/launcher-input';return u;}
 function stopNativeInput(){
  inputGeneration++;clearTimeout(inputTimer);inputController?.abort();inputController=null;
  if(inputRegistered){const u=inputEndpoint();if(u)fetch(u.href,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({id:inputId,release:true}),keepalive:true,credentials:'omit',redirect:'error'}).catch(()=>{});}
  inputRegistered=false;
 }
 function startNativeInput(){
  stopNativeInput();if(typeof window.wallpaperRegisterMediaPropertiesListener!=='function'||!opened||paused||editing)return;
  const at=inputGeneration,id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');let inputStream=null;inputId=id;inputSequence=0;
  async function lease(){
   if(at!==inputGeneration||!opened)return;const u=inputEndpoint();if(!u)return;
   const rect=panel.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
   const region={id,width:Math.round(window.innerWidth*dpr),height:Math.round(window.innerHeight*dpr),rect:[rect.left/window.innerWidth,rect.top/window.innerHeight,rect.right/window.innerWidth,rect.bottom/window.innerHeight].map(n=>Math.max(0,Math.min(1,n)))};
   try{const response=await fetch(u.href,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(region),signal:AbortSignal.timeout(2500),credentials:'omit',redirect:'error'});
    if(at!==inputGeneration){fetch(u.href,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({id,release:true}),credentials:'omit',redirect:'error'}).catch(()=>{});return;}
    if(response.ok&&!inputRegistered){inputRegistered=true;receive();}
   }catch{}
   if(at===inputGeneration)inputTimer=setTimeout(lease,1000);
  }
  async function receive(){
   while(at===inputGeneration&&opened){
    const u=inputEndpoint();if(!u)return;u.searchParams.set('id',id);u.searchParams.set('after',String(inputSequence));const active=new AbortController();inputController=active;
    try{const response=await fetch(u.href,{headers:headers(),signal:active.signal,cache:'no-store',credentials:'omit',redirect:'error'});if(!response.ok)throw Error();const payload=await response.json();
     if(at!==inputGeneration)return;
     if(payload.stream!==inputStream){inputStream=payload.stream;inputSequence=0;}
     for(const event of payload.events||[]){if(!Number.isSafeInteger(event.seq)||event.seq<=inputSequence||!Number.isInteger(event.delta)||Math.abs(event.delta)>32768)continue;inputSequence=event.seq;if(Date.now()-event.at>1000)continue;
      setTimeout(()=>{if(at===inputGeneration&&opened&&performance.now()-lastWheel>130){cancelClose();scrollBy(event.delta);}},70);
     }
    }catch{if(at!==inputGeneration)return;await new Promise(resolve=>setTimeout(resolve,500));}
    finally{if(inputController===active)inputController=null;}
   }
  }
  requestAnimationFrame(lease);
 }
 function feedback(message){clearTimeout(feedbackTimer);$('launcherFeedback').textContent=message;$('launcherFeedback').hidden=!message;feedbackTimer=setTimeout(()=>{$('launcherFeedback').hidden=true;},6000);}
 function visibleFiles(){return (data?.items||[]).filter(entry=>entry.group==='files'&&entry.type==='file'&&(fileFilter==='all'||M.fileKind(entry.name)===fileFilter)).sort((a,b)=>(a.section||'').localeCompare(b.section||'','ru')||a.name.localeCompare(b.name,'ru'));}
 function updateSelection(){
  for(const tile of items.querySelectorAll('[data-file-tile]')){const selected=selectedFiles.has(tile.dataset.fileTile);tile.classList.toggle('launcher-selected',selected);const check=tile.querySelector('.launcher-file-check');check?.setAttribute('aria-checked',String(selected));if(check)check.textContent=selected?'✓':'';}
  $('launcherSelectMode').setAttribute('aria-pressed',String(selectionMode));$('launcherSelectMode').disabled=busy||arranging;
  $('launcherSelectAll').disabled=busy||arranging||!visibleFiles().length;$('launcherSelectClear').disabled=busy||!selectedFiles.size;
  $('launcherSelectedCount').textContent=selectedFiles.size?'Выбрано: '+selectedFiles.size+' · перетащи за файл':'Галочки · Ctrl / Shift · рамка';
 }
 function selectFile(entry,event={},checkbox=false){const toggle=checkbox||event.ctrlKey||event.metaKey||selectionMode;selectedFiles=M.pickSelection(visibleFiles().map(item=>item.id),selectedFiles,selectionAnchor,entry.id,{toggle,range:!!event.shiftKey});if(!event.shiftKey||!selectionAnchor)selectionAnchor=entry.id;updateSelection();cancelClose();}
 function groupName(entries){const n=entries.length,last=n%10,teen=n%100;return n===1?entries[0].name:n+' '+(teen>=11&&teen<=14?'файлов':last===1?'файл':last>=2&&last<=4?'файла':'файлов');}
 function sendFiles(entries,target){return send({action:target.kind,...(entries.length===1?{id:entries[0].id}:{ids:entries.map(entry=>entry.id)}),...(target.kind==='move'?{target:target.id}:{})});}
 function startBox(event){
  if(event.button!==0||opened!=='files'||busy||arranging||editing||fileDrag||event.target.closest('.launcher-tile'))return;
  const rect=items.getBoundingClientRect(),scale=rect.width/items.clientWidth;cancelClose();event.preventDefault();
  boxDrag={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,contentY:(event.clientY-rect.top)/scale+items.scrollTop,base:new Set(selectedFiles),extend:!!(event.ctrlKey||event.shiftKey||event.metaKey),active:false};
 }
 function drawBox(){
  if(!boxDrag?.active)return;const current=boxDrag,rect=items.getBoundingClientRect(),scale=rect.width/items.clientWidth;
  const anchorY=rect.top+(current.contentY-items.scrollTop)*scale,area={left:Math.min(current.startX,current.x),right:Math.max(current.startX,current.x),top:Math.min(anchorY,current.y),bottom:Math.max(anchorY,current.y)};
  selectedFiles=current.extend?new Set(current.base):new Set();
  for(const tile of items.querySelectorAll('[data-file-tile]'))if(M.intersects(area,tile.getBoundingClientRect()))selectedFiles.add(tile.dataset.fileTile);
  const stage=root.getBoundingClientRect(),stageScale=stage.width/1920,left=Math.max(rect.left,area.left),top=Math.max(rect.top,area.top);
  Object.assign(current.box.style,{left:(left-stage.left)/stageScale+'px',top:(top-stage.top)/stageScale+'px',width:Math.max(0,Math.min(rect.right,area.right)-left)/stageScale+'px',height:Math.max(0,Math.min(rect.bottom,area.bottom)-top)/stageScale+'px'});updateSelection();
 }
 function autoBox(){
  if(!boxDrag?.active)return;const rect=items.getBoundingClientRect(),scale=rect.width/items.clientWidth,edge=30*scale;let delta=0;
  if(boxDrag.y<rect.top+edge)delta=-Math.min(12,(rect.top+edge-boxDrag.y)/scale/3);else if(boxDrag.y>rect.bottom-edge)delta=Math.min(12,(boxDrag.y-rect.bottom+edge)/scale/3);
  if(delta){scrollBy(delta);drawBox();}boxFrame=requestAnimationFrame(autoBox);
 }
 function moveBox(event){
  if(!boxDrag||event.pointerId!==boxDrag.id)return;const current=boxDrag,scale=Math.min(window.innerWidth/1920,window.innerHeight/1080);current.x=event.clientX;current.y=event.clientY;
  if(!current.active&&Math.hypot(current.x-current.startX,current.y-current.startY)<5*scale)return;
  event.preventDefault();cancelClose();if(!current.active){current.active=true;current.box=document.createElement('div');current.box.className='launcher-selection-box';root.appendChild(current.box);root.classList.add('launcher-box-selecting');boxFrame=requestAnimationFrame(autoBox);}drawBox();
 }
 function finishBox(event,cancel=false){
  if(!boxDrag||event&&event.type!=='mouseup'&&event.pointerId!==boxDrag.id)return;const current=boxDrag;boxDrag=null;if(boxFrame!==null)cancelAnimationFrame(boxFrame);boxFrame=null;current.box?.remove();root.classList.remove('launcher-box-selecting');
  if(cancel)selectedFiles=current.base;else if(!current.active&&!current.extend)selectedFiles.clear();if(current.active)suppressClickUntil=performance.now()+500;updateSelection();if(current.active&&opened)renderItems();
 }
 function dropAt(x,y){
  const element=document.elementFromPoint(x,y)?.closest('#launcherTrash,[data-drop-folder],[data-drop-group]');if(!element||!fileDrag?.active)return null;
  if(element.id==='launcherTrash')return fileDrag.canMoveFiles?{element,kind:'recycle'}:null;
  if(element.dataset.dropFolder)return fileDrag.canMoveFiles?{element,kind:'move',id:element.dataset.dropFolder}:null;
  const group=element.dataset.dropGroup;if(!data.groups.some(g=>g.id===group)||fileDrag.entries.every(entry=>entry.group===group))return null;
  if(group==='folders'&&fileDrag.canMoveFiles)return {element,kind:'folders'};
  return {element,kind:'assign',group};
 }
 function clearFileDrag(){
  clearTimeout(fileHoverTimer);fileDropHover?.element.classList.remove('launcher-drop-hover','launcher-category-drop-hover');fileDropHover=null;
  root.classList.remove('launcher-dragging-file','launcher-dragging-item');
  if(!fileDrag)return;const current=fileDrag;fileDrag=null;for(const button of items.querySelectorAll('.launcher-drag-source'))button.classList.remove('launcher-drag-source');current.button.classList.remove('launcher-drag-source');current.ghost?.remove();
  try{if(current.button.hasPointerCapture(current.id))current.button.releasePointerCapture(current.id);}catch{}
  window.dispatchEvent(new CustomEvent('launcher:drag-preview'));
 }
 function updateFileDrop(x,y){
  if(!fileDrag?.active)return;fileDrag.x=x;fileDrag.y=y;
  const rect=root.getBoundingClientRect(),scale=rect.width/1920;
  const minX=Math.max(8,-rect.left/scale+8),minY=Math.max(8,-rect.top/scale+8),maxX=Math.min(1580,(window.innerWidth-rect.left)/scale-340),maxY=Math.min(1000,(window.innerHeight-rect.top)/scale-90);
  fileDrag.ghost.style.left=Math.max(minX,Math.min(maxX,(x-rect.left)/scale+17))+'px';fileDrag.ghost.style.top=Math.max(minY,Math.min(maxY,(y-rect.top)/scale+17))+'px';
  const target=dropAt(x,y);
  if(fileDropHover?.element!==target?.element){clearTimeout(fileHoverTimer);fileDropHover?.element.classList.remove('launcher-drop-hover','launcher-category-drop-hover');fileDropHover=target;target?.element.classList.add(target.kind==='assign'?'launcher-category-drop-hover':'launcher-drop-hover');
   if(target?.kind==='folders')fileHoverTimer=setTimeout(()=>{if(fileDrag?.active){open('folders');updateFileDrop(fileDrag.x,fileDrag.y);}},350);
  }
  const folder=target?.kind==='move'?data.items.find(entry=>entry.id===target.id):null;
  const category=target?.kind==='assign'?data.groups.find(g=>g.id===target.group):null;
  fileDrag.hint.textContent=category?'Отпустить → категория «'+category.name+'»':target?.kind==='recycle'?'Отпустить → в Корзину':folder?'Отпустить → «'+folder.name+'»':target?.kind==='folders'?'Удерживай здесь, затем выбери папку':fileDrag.canMoveFiles?'Перетащи в категорию, на Корзину или «Папки»':'Перетащи на нужную категорию слева';
  fileDrag.ghost.classList.toggle('recycling',target?.kind==='recycle');
  window.dispatchEvent(new CustomEvent('launcher:drag-preview'));
 }
 function startFileDrag(event,entry,button){
  if(event.button!==0||busy||arranging||editing||contextActive||pendingMove||fileDrag)return;
  cancelClose();fileDrag={id:event.pointerId,entry,button,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,canMoveFiles:opened==='files'&&entry.type==='file'};
  try{button.setPointerCapture(event.pointerId);}catch{}
 }
 function moveFileDrag(event){
  if(!fileDrag||event.pointerId!==fileDrag.id)return;
  const scale=Math.min(window.innerWidth/1920,window.innerHeight/1080);
  if(!fileDrag.active&&Math.hypot(event.clientX-fileDrag.startX,event.clientY-fileDrag.startY)<8*scale)return;
  event.preventDefault();cancelClose();
  if(!fileDrag.active){fileDrag.active=true;clearTimeout(hover);root.classList.add('launcher-dragging-item');if(fileDrag.canMoveFiles)root.classList.add('launcher-dragging-file');
   if(fileDrag.canMoveFiles){if(!selectedFiles.has(fileDrag.entry.id))selectedFiles=new Set([fileDrag.entry.id]);fileDrag.entries=visibleFiles().filter(entry=>selectedFiles.has(entry.id));}else fileDrag.entries=[fileDrag.entry];
   if(fileDrag.entries.length>100){feedback('За один раз можно переместить до 100 файлов');clearFileDrag();suppressClickUntil=performance.now()+500;return;}
   updateSelection();for(const button of items.querySelectorAll('[data-item]'))if(fileDrag.entries.some(entry=>entry.id===button.dataset.item))button.classList.add('launcher-drag-source');
   const ghost=document.createElement('div');ghost.className='launcher-drag-ghost';const name=document.createElement('strong'),hint=document.createElement('span');name.textContent=groupName(fileDrag.entries);ghost.append(name,hint);root.appendChild(ghost);fileDrag.ghost=ghost;fileDrag.hint=hint;
  }
  updateFileDrop(event.clientX,event.clientY);
 }
 function endFileDrag(event,cancel=false){
  if(!fileDrag||event&&event.type!=='mouseup'&&event.pointerId!==fileDrag.id)return;
  const current=fileDrag,target=!cancel&&current.active&&event?dropAt(event.clientX,event.clientY):null;clearFileDrag();
  if(!current.active)return;suppressClickUntil=performance.now()+500;
  renderNav();if(opened)renderItems();
  if(target?.kind==='assign'){const group=data.groups.find(g=>g.id===target.group),source=opened;send({action:'assign',...(current.entries.length===1?{id:current.entries[0].id}:{ids:current.entries.map(entry=>entry.id)}),group:target.group}).then(result=>{if(result){feedback(groupName(current.entries)+' → «'+group.name+'»');if(opened===source&&!paused&&!editing)open(target.group);}});return;}
  if(target?.kind==='folders'){pendingMove=current.entries;open('folders');return;}
  if(target?.kind==='recycle'||target?.kind==='move')sendFiles(current.entries,target);
 }
 function renderSettings(connected=true){
  $('launcherEnabled').checked=data?.enabled===true;$('launcherHideIcons').checked=data?.hideIcons===true;
  $('launcherEnabled').disabled=busy||!connected||!data?.ready;
  $('launcherHideIcons').disabled=busy||!connected||!data?.ready||!data?.enabled;
  $('launcherRestore').disabled=busy||!connected;
  $('launcherSettingsStatus').textContent=!connected?'Нет связи с помощником. Для полного возврата есть RESTORE_DESKTOP.cmd.':busy?'Применяется…':data?.error||(!data?.enabled?'Категории выключены. Обычные значки восстановлены.':data?.hideIcons?'Категории включены, обычные значки скрыты.':'Категории включены, обычные значки пока видны.');
 }
 function renderNav(){
  const fragment=document.createDocumentFragment();
  for(const group of data.groups){
   if(!icons[group.id])continue;
   const button=document.createElement('button');button.type='button';button.dataset.group=group.id;button.dataset.dropGroup=group.id;button.setAttribute('aria-controls','launcherPanel');button.setAttribute('aria-expanded',String(opened===group.id));
   const name=document.createElement('span');name.textContent=group.id==='leisure'?'Общение':group.name;
   const amount=document.createElement('small');amount.textContent=count(group.id);const index=document.createElement('em');index.textContent=String(data.groups.indexOf(group)+1).padStart(2,'0');const arrow=document.createElement('i');arrow.textContent='›';button.append(index,name,amount,arrow);
   if(group.id==='folders')button.dataset.dropFolders='true';
   button.addEventListener('pointerenter',()=>{if(contextActive||settingsOpen()||window.PGWindows&&!window.PGWindows.canInteract())return;cancelClose();clearTimeout(hover);highlight(group.id);if(!editing&&!fileDrag?.active&&(opened!==group.id||remoteShown))hover=setTimeout(()=>open(group.id),80);});
   button.addEventListener('pointerleave',()=>clearTimeout(hover));
   button.addEventListener('click',()=>{if(editing)return;opened===group.id&&!remoteShown?close():open(group.id);});
   fragment.appendChild(button);
  }
  rail.classList.toggle('has-unsorted',data.groups.some(g=>g.id==='unsorted'));nav.replaceChildren(fragment);place();
 }
 function syncNewBadges(){
  clearTimeout(newBadgeTimer);newBadgeTimer=null;const now=Date.now();let next=Infinity;
  for(const {badge,entry}of newBadges){const recent=M.isNewFile(entry,now);badge.hidden=!recent;if(recent)next=Math.min(next,entry.newUntil);}
  if(opened&&!paused&&!editing&&Number.isFinite(next))newBadgeTimer=setTimeout(syncNewBadges,Math.max(1,next-now));
 }
 function renderItems(){
  clearTimeout(newBadgeTimer);newBadgeTimer=null;newBadges=[];
  const group=data?.groups.find(g=>g.id===opened)||(opened==='unsorted'?{id:'unsorted',name:'Разобрать'}:null);if(!group){close();return;}
  const choosing=opened==='folders'&&pendingMove;
  $('launcherTitle').textContent=choosing?'Переместить в папку':group.id==='leisure'?'Общение':group.name;
  $('launcherArrange').hidden=false;$('launcherArrange').disabled=busy;$('launcherArrange').setAttribute('aria-pressed',String(arranging));$('launcherArrange').setAttribute('aria-label',choosing?'Отменить перенос в папку':arranging?'Завершить выбор категорий':'Изменить категории элементов');$('launcherArrange').textContent=choosing?'Отмена':arranging?'Готово':'Категории';
  const view=opened==='files'?opened+':'+fileFilter:opened,previous=viewGroup===view?items.scrollTop:0;viewGroup=view;
  const allEntries=data.items.filter(item=>item.group===opened),filters=$('launcherFileFilters');filters.hidden=opened!=='files';panel.classList.toggle('launcher-filtered',opened==='files');
  $('launcherSelection').hidden=opened!=='files';
  if(opened==='files')for(const button of filters.querySelectorAll('button[data-file-filter]')){const filter=button.dataset.fileFilter;button.setAttribute('aria-pressed',String(fileFilter===filter));button.querySelector('small').textContent=filter==='all'?allEntries.length:allEntries.filter(entry=>M.fileKind(entry.name)===filter).length;}
  const entries=allEntries.filter(entry=>opened!=='files'||fileFilter==='all'||M.fileKind(entry.name)===fileFilter),fragment=document.createDocumentFragment();let section='';
  items.classList.toggle('launcher-file-list',opened==='folders');items.classList.toggle('launcher-previews',opened==='files');items.classList.toggle('arranging',arranging);
  entries.sort((a,b)=>(a.section||'').localeCompare(b.section||'','ru')||a.name.localeCompare(b.name,'ru'));
  for(const entry of entries){
   if(entry.section&&entry.section!==section){const heading=document.createElement('div');heading.className='launcher-section';heading.textContent=entry.section;fragment.appendChild(heading);}section=entry.section||'';
   const preview=typeof entry.thumbnail==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(entry.thumbnail);
   const tile=document.createElement('div');tile.className='launcher-tile';tile.classList.toggle('has-preview',preview);
   const button=document.createElement('button');button.className='launcher-item';button.type='button';button.disabled=arranging||busy;button.title=entry.name+' · '+entry.origin;button.dataset.item=entry.id;
   button.draggable=false;
   button.addEventListener('contextmenu',event=>openContext(event,entry));
   button.title+=' · Перетащи на категорию слева';button.addEventListener('pointerdown',event=>startFileDrag(event,entry,button));button.addEventListener('lostpointercapture',()=>{if(fileDrag?.button===button&&button.isConnected)endFileDrag(null,true);});
   if(entry.type==='folder'&&entry.group==='folders')button.dataset.dropFolder=entry.id;
   if(opened==='files'&&entry.type==='file'){tile.dataset.fileTile=entry.id;button.title+=' · Галочка — выбрать, Корзина или Папки — перенести файл';}
   const image=document.createElement('span');image.className='launcher-item-icon';
   const fallback=symbol(entry.type==='folder'?'folder':entry.type==='file'?'files':icons[entry.group]||'inbox');image.appendChild(fallback);
   const source=preview?entry.thumbnail:entry.icon;
   if(typeof source==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(source)){const img=document.createElement('img');img.alt=preview?'Превью: '+entry.name:'';img.src=source;img.draggable=false;img.decoding='async';
    const physicalScale=Math.min(window.innerWidth/1920,window.innerHeight/1080)*(window.devicePixelRatio||1),size=M.rasterSize(preview?entry.thumbnailWidth:entry.iconWidth,preview?entry.thumbnailHeight:entry.iconHeight,physicalScale,preview?160:48,preview?106:48);
    img.style.width=size.width+'px';img.style.height=size.height+'px';fallback.setAttribute('hidden','');img.addEventListener('error',()=>{img.hidden=true;fallback.removeAttribute('hidden');});image.appendChild(img);
   }
   const name=document.createElement('span');name.className='launcher-item-name';name.textContent=entry.name;
   if(entry.type==='file'&&entry.group==='files'){
    const caption=document.createElement('span'),badge=document.createElement('span');caption.className='launcher-item-caption';badge.className='launcher-item-new';badge.textContent='new';badge.title='Новый файл · менее 24 часов';badge.setAttribute('aria-label','Новый файл');badge.hidden=!M.isNewFile(entry);
    caption.append(name,badge);button.append(image,caption);newBadges.push({badge,entry});
   }else button.append(image,name);
   if(choosing&&entry.type==='folder')button.title='Переместить '+groupName(pendingMove)+' в «'+entry.name+'»';
   button.addEventListener('click',async event=>{if(busy||arranging)return;if(pendingMove&&opened==='folders'&&entry.type==='folder'){const result=await sendFiles(pendingMove,{kind:'move',id:entry.id});if(result){pendingMove=null;if(opened)renderItems();}return;}
    if(opened==='files'&&entry.type==='file'&&(selectionMode||selectedFiles.size||event.ctrlKey||event.metaKey||event.shiftKey)){selectFile(entry,event);return;}
    const result=await send({action:'open',id:entry.id});if(result)close();});tile.appendChild(button);
   if(opened==='files'&&entry.type==='file'&&!arranging){
    const check=document.createElement('button');check.type='button';check.className='launcher-file-check';check.setAttribute('role','checkbox');check.setAttribute('aria-label','Выбрать: '+entry.name);check.disabled=busy;
    check.addEventListener('click',event=>{event.stopPropagation();if(!busy)selectFile(entry,event,true);});tile.appendChild(check);
    check.addEventListener('contextmenu',event=>openContext(event,entry));
    button.addEventListener('dblclick',async event=>{if(busy||arranging||event.ctrlKey||event.shiftKey)return;event.preventDefault();const result=await send({action:'open',id:entry.id});if(result)close();});
   }
   if(arranging){const select=document.createElement('select');select.setAttribute('aria-label','Категория: '+entry.name);select.disabled=busy;
    for(const g of data.groups){const option=document.createElement('option');option.value=g.id;option.textContent=g.id==='leisure'?'Общение':g.name;select.appendChild(option);}select.value=entry.group;
    select.addEventListener('change',()=>send({action:'assign',id:entry.id,group:select.value}));tile.appendChild(select);
   }
   fragment.appendChild(tile);
  }
  if(!entries.length){const empty=document.createElement('p');empty.className='launcher-empty';empty.textContent=opened==='files'&&fileFilter!=='all'?'Файлов этого типа пока нет':'Здесь пока пусто';fragment.appendChild(empty);}
  items.replaceChildren(fragment);items.scrollTop=previous;$('launcherCount').textContent=choosing?'Переместить: '+groupName(pendingMove):entries.length+(opened==='files'&&fileFilter!=='all'?' из '+allEntries.length:'')+' элементов';$('launcherCount').title=choosing?groupName(pendingMove):'';updateSelection();requestAnimationFrame(updateScrollbar);
  syncNewBadges();
 }
 function apply(payload){
  if(!payload||payload.version!==1||!Array.isArray(payload.groups)||!Array.isArray(payload.items))return;
  const changed=!data||data.revision!==payload.revision||data.enabled!==payload.enabled||data.ready!==payload.ready;data=payload;
  const validFiles=new Set(data.items.filter(entry=>entry.type==='file'&&entry.group==='files').map(entry=>entry.id));selectedFiles=new Set([...selectedFiles].filter(id=>validFiles.has(id)));
  if(pendingMove){pendingMove=pendingMove.filter(entry=>validFiles.has(entry.id));if(!pendingMove.length)pendingMove=null;}
  root.hidden=!data.enabled;
  document.body.classList.toggle('launcher-enabled',data.enabled===true);
  if(!data.enabled)close();
  if(changed&&!contextActive&&!fileDrag&&!boxDrag){renderNav();if(opened)renderItems();}
  renderSettings();
  syncNewBadges();
  if(overlayHost&&hostOpen&&data.ready&&data.enabled){const next=hostOpen;hostOpen=null;position=next.position;place();open(next.group);}
 }
 async function open(group){if(!data?.enabled||!data.ready||editing||settingsOpen()||window.PGWindows&&!window.PGWindows.canInteract())return;clearTimeout(hover);cancelClose();if(window.PGWindows&&!overlayHost){const at=++openSerial,trigger=Array.from(nav.querySelectorAll('button')).find(b=>b.dataset.group===group);if(!await window.PGWindows.openPanel('launcher',{trigger})||at!==openSerial||editing||settingsOpen())return;}if(group!=='folders')pendingMove=null;arranging=false;opened=group;panel.hidden=!!(remoteShown||remotePending||!fileDrag&&!pendingMove&&nativeOverlayAvailable());renderItems();nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.group===group)));if(!panel.hidden)startNativeInput();openAboveWindows(group);}
 async function send(action){
  const url=endpoint();if(busy||!url)return null;busy=true;renderSettings();if(opened)renderItems();
  try{const response=await fetch(url,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(action),signal:AbortSignal.timeout(action.action==='context'?900000:['move','recycle'].includes(action.action)?75000:20000),credentials:'omit',redirect:'error'});const result=await response.json();if(!response.ok){feedback(typeof result.error==='string'?result.error:'Не удалось выполнить действие');return null;}if(result.version===1)apply(result);if(typeof result.notice==='string')feedback(result.notice);return result;}
  catch{feedback('Не удалось выполнить действие');return null;}
  finally{busy=false;renderSettings();if(opened)renderItems();}
 }
 async function openContext(event,entry){
  event.preventDefault();event.stopPropagation();if(busy||arranging||contextActive||fileDrag?.active||boxDrag?.active)return;
  clearTimeout(hover);cancelClose();finishScroll();let action={action:'context',background:true};
  if(entry){
   if(opened==='files'&&entry.type==='file'){
    if(!selectedFiles.has(entry.id)){selectedFiles=new Set([entry.id]);selectionAnchor=entry.id;updateSelection();}
    const ids=visibleFiles().filter(item=>selectedFiles.has(item.id)).map(item=>item.id);action=ids.length>1?{action:'context',ids}:{action:'context',id:entry.id};
   }else action={action:'context',id:entry.id};
  }
  if(window.PGSurface?.surfaceId)action.surfaceId=window.PGSurface.surfaceId;
  contextActive=true;try{await send(action);}finally{contextActive=false;cancelClose();renderNav();if(opened)renderItems();}
 }
 async function standardDesktop(){
  const base=endpoint();if(busy||!base)return;busy=true;feedback('Возвращаю обычный рабочий стол…');
  try{
   const url=new URL('/controls',base),response=await fetch(url.href,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({kind:'workspace',value:'desktop'}),signal:AbortSignal.timeout(60000),credentials:'omit',redirect:'error'});
   if(!response.ok)throw Error();const result=await response.json();if(result.source?.data?.mode!=='desktop')throw Error();
  }catch{feedback('Не удалось выйти. Проверь Companion и попробуй снова.');}
  finally{busy=false;}
 }
 async function poll(){
  clearTimeout(timer);const url=endpoint(),at=generation;
  if(paused||!url){renderSettings(false);return;}
  controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),6000);
  try{const response=await fetch(url,{headers:headers(),signal:active.signal,cache:'no-store',credentials:'omit',redirect:'error'});if(!response.ok)throw Error();const result=await response.json();if(at===generation)apply(result);}
  catch{if(at===generation){renderSettings(false);if(opened)feedback('Нет связи с помощником');}}
  finally{clearTimeout(timeout);if(controller===active)controller=null;if(at===generation&&!paused)timer=setTimeout(poll,10000);}
 }
 function configure(prefs){
  const changed=bridge!==prefs.bridge;if(changed)stopNativeInput();bridge=prefs.bridge||'';
  if(profile!==prefs.profile){drag=null;profile=prefs.profile;loadPosition();}
  if(changed||!data){generation++;clearTimeout(timer);controller?.abort();poll();}
 }
 function setPaused(value){paused=!!value;generation++;clearTimeout(timer);controller?.abort();if(paused)close();else poll();}
 function setEditing(value){editing=!!value;if(editing)close();}
 $('launcherEnabled').addEventListener('change',()=>send({action:'settings',enabled:$('launcherEnabled').checked,hideIcons:$('launcherEnabled').checked&&data?.hideIcons===true}));
 $('launcherHideIcons').addEventListener('change',()=>send({action:'settings',enabled:true,hideIcons:$('launcherHideIcons').checked}));
 $('launcherRestore').addEventListener('click',()=>send({action:'restore'}));
 $('launcherPC').addEventListener('click',()=>send({action:'system',id:'thispc'}));$('launcherTrash').addEventListener('click',()=>send({action:'system',id:'recyclebin'}));$('launcherDesktop').addEventListener('click',standardDesktop);
 $('launcherClose').addEventListener('click',()=>window.PGWindows?window.PGWindows.closePanel('launcher','explicit'):close());
 $('launcherArrange').addEventListener('click',()=>{if(pendingMove){pendingMove=null;arranging=false;}else arranging=!arranging;renderItems();});
 for(const button of $('launcherFileFilters').querySelectorAll('button[data-file-filter]'))button.addEventListener('click',()=>{if(opened!=='files'||fileFilter===button.dataset.fileFilter||fileDrag?.active||boxDrag?.active)return;finishScroll();cancelClose();selectedFiles.clear();selectionAnchor=null;fileFilter=button.dataset.fileFilter;renderItems();startNativeInput();});
 $('launcherSelectMode').addEventListener('click',()=>{if(busy||arranging)return;selectionMode=!selectionMode;updateSelection();});
 $('launcherSelectAll').addEventListener('click',()=>{if(busy||arranging)return;const entries=visibleFiles();selectedFiles=new Set(entries.map(entry=>entry.id));selectionAnchor=entries[0]?.id||null;updateSelection();});
 $('launcherSelectClear').addEventListener('click',()=>{selectedFiles.clear();selectionAnchor=null;updateSelection();});
 items.addEventListener('pointerdown',startBox);document.addEventListener('pointermove',moveBox);
 items.addEventListener('contextmenu',event=>{if(!event.target.closest?.('.launcher-item,.launcher-file-check'))openContext(event,null);});
 panel.addEventListener('wheel',wheel,{passive:false});panel.addEventListener('mousewheel',wheel,{passive:false});items.addEventListener('scroll',updateScrollbar);
 $('launcherScrollUp').addEventListener('click',()=>scrollBy(-170));$('launcherScrollDown').addEventListener('click',()=>scrollBy(170));
 $('launcherScrollThumb').addEventListener('pointerdown',event=>{if(event.button!==0)return;cancelClose();event.preventDefault();event.stopPropagation();const metrics=M.scrollMetrics(items.clientHeight,items.scrollHeight,$('launcherScrollTrack').clientHeight),scale=$('launcherScrollTrack').getBoundingClientRect().height/$('launcherScrollTrack').clientHeight;scrollDrag={id:event.pointerId,y:event.clientY,start:items.scrollTop,max:metrics.max,travel:metrics.travel*scale};$('launcherScrollThumb').setPointerCapture(event.pointerId);});
 $('launcherScrollTrack').addEventListener('pointerdown',event=>{if(event.target!==$('launcherScrollTrack'))return;event.preventDefault();const metrics=M.scrollMetrics(items.clientHeight,items.scrollHeight,$('launcherScrollTrack').clientHeight),rect=$('launcherScrollTrack').getBoundingClientRect(),scale=rect.height/$('launcherScrollTrack').clientHeight;items.scrollTop=M.dragScroll(0,event.clientY-rect.top-metrics.thumb*scale/2,metrics.max,metrics.travel*scale);updateScrollbar();});
 document.addEventListener('pointermove',event=>{if(scrollDrag?.id!==event.pointerId)return;event.preventDefault();cancelClose();items.scrollTop=M.dragScroll(scrollDrag.start,event.clientY-scrollDrag.y,scrollDrag.max,scrollDrag.travel);updateScrollbar();});
 document.addEventListener('pointermove',moveFileDrag);
 for(const name of ['pointerup','mouseup'])document.addEventListener(name,event=>endFileDrag(event),true);
 document.addEventListener('pointercancel',event=>endFileDrag(event,true),true);
 for(const name of ['pointerup','mouseup'])document.addEventListener(name,event=>finishBox(event),true);
 document.addEventListener('pointercancel',event=>finishBox(event,true),true);
 document.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
 function finishScroll(event){if(!scrollDrag||event&&event.type!=='mouseup'&&scrollDrag.id!==event.pointerId)return;const id=scrollDrag.id;scrollDrag=null;try{if($('launcherScrollThumb').hasPointerCapture(id))$('launcherScrollThumb').releasePointerCapture(id);}catch{}}
 for(const name of ['pointerup','pointercancel','mouseup'])document.addEventListener(name,finishScroll,true);
 $('launcherScrollThumb').addEventListener('lostpointercapture',finishScroll);
 window.addEventListener('blur',()=>{fallbackEscapeHeld=false;finishScroll();endFileDrag(null,true);finishBox(null,true);});window.addEventListener('pagehide',()=>close('reset'));
 $('launcherScrollThumb').addEventListener('keydown',event=>{const deltas={ArrowUp:-60,ArrowDown:60,PageUp:-items.clientHeight,PageDown:items.clientHeight,Home:-items.scrollHeight,End:items.scrollHeight};if(Object.hasOwn(deltas,event.key)){event.preventDefault();scrollBy(deltas[event.key]);}});
 if(typeof ResizeObserver==='function')new ResizeObserver(updateScrollbar).observe(items);
 for(const region of [rail,panel]){region.addEventListener('pointerenter',cancelClose);region.addEventListener('pointerleave',delayedClose);}
 if($('settings')&&typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(settingsOpen()){close();highlight(null);}}).observe($('settings'),{attributes:true,attributeFilter:['hidden']});
 window.addEventListener('paper:panel-open',()=>{close();highlight(null);});
 function escape(){if(fileDrag?.active||boxDrag?.active){endFileDrag(null,true);finishBox(null,true);}else if(opened==='files'&&selectedFiles.size){selectedFiles.clear();updateSelection();}else close('escape');}
 window.PGWindows?.registerPanel('launcher',{isOpen:()=>opened!==null,close,escape});
 window.addEventListener('pg:window-policy',event=>{const p=event.detail;if(['external','suspend','reset'].includes(p?.event)&&(!p.surfaceId||p.surfaceId===window.PGSurface?.surfaceId))close(p.event);});
 document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close('outside');});
 document.addEventListener('keyup',event=>{if(event.key==='Escape')fallbackEscapeHeld=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!window.PGWindows&&!event.repeat&&!fallbackEscapeHeld){fallbackEscapeHeld=true;escape();}}else if(opened==='files'&&!busy&&!arranging&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();$('launcherSelectAll').click();}});
 $('launcherHandle').addEventListener('pointerdown',event=>{if(window.PGLayoutEditor||!editing||event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,start:{...position}};rail.setPointerCapture(event.pointerId);event.preventDefault();});
 rail.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const scale=Math.min(window.innerWidth/1920,window.innerHeight/1080);position={x:drag.start.x+(event.clientX-drag.x)/scale,y:drag.start.y+(event.clientY-drag.y)/scale};place();});
 function finish(event){if(drag?.id!==event.pointerId)return;drag=null;if(window.PGLayouts&&!overlayHost){void window.PGLayouts.update({launcher:{x:position.x,y:position.y}});return;}try{localStorage.setItem(layoutKey(),JSON.stringify(position));}catch{}}
 rail.addEventListener('pointerup',finish);rail.addEventListener('pointercancel',finish);rail.addEventListener('lostpointercapture',finish);
 loadPosition();renderSettings(false);
 if(!overlayHost)window.PGLayouts?.subscribe(({document:doc})=>{if(doc.profile!==profile||drag)return;const p=doc.widgets.launcher;position={x:p.x,y:p.y};root.style.display=p.visible?'':'none';if(!p.visible)close();place();});
 window.VGLauncher={resetLayout:()=>{position={x:24,y:80};try{localStorage.removeItem(layoutKey());}catch{}place();},configure,setPaused,setEditing,dismiss:close,openInHost:(group,p)=>{if(!overlayHost||opened===group&&!panel.hidden&&position.x===p.x&&position.y===p.y)return;hostOpen={group,position:p};if(data?.ready&&data.enabled){hostOpen=null;position=p;place();open(group);}},state:()=>!data?.ready?'unavailable':!data.enabled?'disabled':opened?(items.scrollTop>1?'scrolled':'open'):'ready',diagnostics:()=>({mounted:true,categoryDragAvailable:true,desktop:window.PG_APP_DESKTOP===true,overlayHost,nativeOverlayAvailable:nativeOverlayAvailable(),remotePending:!!remotePending,remoteShown})};
})();
