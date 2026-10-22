'use strict';
// Exiting THIS app must never unload Wallpaper Engine or stop its Companion.
function createDesktopExit({showIcons}={}){
 let pending=null;
 return ()=>{
  if(pending)return pending;
  pending=(async()=>{
   // Explicit «Рабочий стол» means a usable Windows desktop, even when the
   // historical baseline was captured while another wallpaper hid its icons.
   await showIcons();
   setTimeout(()=>console.log(JSON.stringify({type:'app-exit'})),250);
   return {status:'ok',updatedAt:new Date().toISOString(),identity:'WallpaperShell',data:{mode:'desktop',stopping:true}};
  })();
  pending.catch(()=>{pending=null;});
  return pending;
 };
}
module.exports={isStandardDesktop:()=>false,createDesktopExit};
