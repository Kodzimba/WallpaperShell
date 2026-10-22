(function(){
 'use strict';
 let current=null,lastLayout='',profile=null;
 function crop(){
  const panel=document.getElementById('launcherPanel');if(!current||panel.hidden||!innerWidth||!innerHeight)return;
  const luna=document.body?.dataset?.theme==='luna-blue',gap=luna?342:624,railWidth=luna?310:592;
  const p=current.position,left=Math.max(16,p.x+gap+884<=1904?p.x+gap:p.x-902),top=Math.min(244,Math.max(80,p.y-64));
  const x=Math.min(p.x,left),y=Math.min(p.y,top),width=Math.max(p.x+railWidth,left+884)-x,scale=innerWidth/width;
  const stage=document.getElementById('stage');stage.style.transform='scale('+scale+')';stage.style.left=-x*scale+'px';stage.style.top=-y*scale+'px';
  const feedback=document.getElementById('launcherFeedback');feedback.style.left=left+'px';feedback.style.top=(top+panel.offsetHeight-52)+'px';
  // Keep the viewport stable; only visible controls paint or receive input.
  const elements=[document.getElementById('launcherCategories'),document.querySelector('.launcher-system'),panel];if(!feedback.hidden)elements.push(feedback);const ghost=document.querySelector('.launcher-drag-ghost');if(ghost)elements.push(ghost);
  const rects=elements.filter(Boolean).map(el=>el.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0).map(r=>[r.left/innerWidth,r.top/innerHeight,r.right/innerWidth,r.bottom/innerHeight].map(n=>Math.round(Math.max(0,Math.min(1,n))*1e6)/1e6)).filter(r=>r[2]>r[0]&&r[3]>r[1]);
  const message={type:'layout',id:current.id,rects},encoded=JSON.stringify(message);if(encoded!==lastLayout){lastLayout=encoded;window.chrome.webview.postMessage(message);}
 }
 window.VGOverlayHost={hide:()=>window.chrome.webview.postMessage({type:'hide'})};
 window.chrome.webview.addEventListener('message',event=>{
  const a=event.data;if(a.type==='hidden'){window.VGLauncher?.dismiss();return;}if(a.action!=='open')return;
  current=a;lastLayout='';if(profile!==a.profile){profile=a.profile;window.VGLauncher.configure({bridge:'http://127.0.0.1:8767/status',profile});}
  if(a.appearance)window.VGAppearance?.receive(a.appearance,true);
  window.VGLauncher.openInHost(a.group,a.position);crop();
 });
 window.addEventListener('resize',crop);
 window.addEventListener('launcher:drag-preview',crop);
 window.addEventListener('DOMContentLoaded',()=>{
  const resize=new ResizeObserver(crop);for(const id of ['launcherPanel','launcherRail'])resize.observe(document.getElementById(id));
  const mutations=new MutationObserver(crop);for(const id of ['launcherPanel','launcherRail','launcherFeedback'])mutations.observe(document.getElementById(id),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});
  if(document.body?.dataset?.theme==='luna-blue'){
   // Own static texture only. Let the first native-visible frame contain the
   // material; a missing image must never block opening the launcher.
   const image=new Image();let announced=false,fallback=null;const ready=()=>{if(announced)return;announced=true;if(fallback!==null)clearTimeout(fallback);window.chrome.webview.postMessage({type:'ready'});};
   image.onload=image.onerror=ready;image.src='assets/marble-water.png';if(image.complete)ready();else fallback=setTimeout(ready,1200);
  }else window.chrome.webview.postMessage({type:'ready'});
 });
})();
