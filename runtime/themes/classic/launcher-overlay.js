(function(){
 'use strict';
 let current=null,lastSize='';
 function crop(){if(!current)return;const p=current.position,left=p.x+266+884<=1904?p.x+266:p.x-902,top=Math.min(244,Math.max(80,p.y-64)),panel=document.getElementById('launcherPanel'),rail=document.getElementById('launcherRail');const x=Math.min(p.x,Math.max(16,left)),y=Math.min(p.y,top),width=Math.max(p.x+248,Math.max(16,left)+884)-x,height=Math.max(p.y+(rail.offsetHeight||600),top+(panel.offsetHeight||800))-y+2;const scale=innerWidth/width;const stage=document.getElementById('stage');stage.style.transform=`scale(${scale})`;stage.style.left=-x*scale+'px';stage.style.top=-y*scale+'px';const feedback=document.getElementById('launcherFeedback');feedback.style.left=Math.max(16,left)+'px';feedback.style.top=(top+(panel.offsetHeight||800)-52)+'px';const size=width+':'+height;if(size!==lastSize){lastSize=size;window.chrome.webview.postMessage({type:'size',width,height});}}
 window.VGOverlayHost={hide:()=>window.chrome.webview.postMessage({type:'hide'})};
 window.chrome.webview.addEventListener('message',event=>{const a=event.data;if(a.type==='hidden'){window.VGLauncher?.dismiss();return;}if(a.action!=='open')return;current=a;lastSize='';crop();window.VGLauncher.configure({bridge:'http://127.0.0.1:8767/status',profile:a.profile});window.VGLauncher.openInHost(a.group,a.position);});
 window.addEventListener('resize',crop);
 window.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(crop).observe(document.getElementById('launcherPanel'));new MutationObserver(()=>requestAnimationFrame(crop)).observe(document.getElementById('launcherPanel'),{childList:true,subtree:true});window.chrome.webview.postMessage({type:'ready'});});
})();
