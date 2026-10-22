(function(){
 'use strict';
 const params=new URLSearchParams(location.search),audio=new Set();let audioFrames=0,lastAudio=0,peakSinceReport=0;
 window.PG_APP=true;window.PG_APP_DESKTOP=params.get('desktop')==='1';
 window.wallpaperRegisterAudioListener=callback=>{if(typeof callback==='function')audio.add(callback);};
 window.chrome.webview.addEventListener('message',event=>{
  const m=event.data;if(m?.type==='audio'&&Array.isArray(m.samples)&&m.samples.length===128){audioFrames++;lastAudio=Date.now();peakSinceReport=Math.max(peakSinceReport,...m.samples);for(const callback of audio)callback(m.samples);}
  if(m?.type==='pause')window.wallpaperPropertyListener?.setPaused?.(m.value===true);
 });
 function command(value){if(window.PGWindows&&!window.PGWindows.canInteract())return;window.chrome.webview.postMessage({type:'host-command',value});}
 let sources=null;window.addEventListener('daylight:snapshot',event=>{sources=event.detail?.sources;});
 window.addEventListener('DOMContentLoaded',()=>{
  const profile=params.get('profile');if(['display-1','display-2'].includes(profile))window.wallpaperPropertyListener?.applyUserProperties?.({monitorprofile:{value:profile}});
  const settings=document.getElementById('settingsGeneralHost')||document.getElementById('settingsViewport')||document.getElementById('settings');
  if(settings){
   const row=document.createElement('section');row.className='app-mode-controls';
   const title=document.createElement('strong');title.textContent='Режим приложения';row.append(title);
   for(const [value,text]of [['window','В окне'],['desktop','Основной монитор'],['all','Все мониторы'],['quit','Закрыть приложение']]){const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.hostMode=value;b.style.cssText='display:block;width:100%;margin:8px 0';b.addEventListener('click',()=>command(value));row.append(b);}settings.append(row);
  }
  for(const id of ['daylightDesktop','launcherDesktop','launcherRestore']){const b=document.getElementById(id);if(b){b.title='Закрыть WallpaperShell и вернуться к прежнему рабочему столу';b.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();command('quit');},true);}}
  const bridge=document.getElementById('bridgeInput');if(bridge){bridge.value='http://127.0.0.1:8767/status';bridge.readOnly=true;}
  setInterval(()=>{
   const stats=window.VGLiquid?.diagnostics?.()||{},bars=[...document.querySelectorAll('#audioBars i,#audioBars span,#scenePixels i')];
   const layout=window.PGLayouts?.current(),layoutStatus=window.PGLayouts?.status();
   const panels=[...document.querySelectorAll('[data-widget]')],layoutDiagnostics=layout?{theme:layout.theme,profile:layout.profile,revision:layout.revision,status:layoutStatus,widgetCount:Object.keys(layout.widgets).length,settingsMounted:!!document.getElementById('widgetLayoutSettings'),renderedPanels:panels.length,matchedPanels:panels.filter(el=>{const p=layout.widgets[el.dataset.widget];return p&&el.hidden===!p.visible&&Math.abs(parseFloat(el.style.left)-p.x)<.01&&Math.abs(parseFloat(el.style.top)-p.y)<.01;}).length}:null;
   if(layoutDiagnostics){layoutDiagnostics.maintenance=window.PGMaintenance?.diagnostics?.()||null;layoutDiagnostics.editor=window.PGLayoutEditor?.diagnostics?.()||null;layoutDiagnostics.editorEntryMounted=!!document.getElementById('layoutEditorOpen');layoutDiagnostics.editorToolbarMounted=!!document.getElementById('layoutEditorToolbar');layoutDiagnostics.editorOverlayMounted=!!document.getElementById('layoutEditorOverlay');}
   if(layoutDiagnostics){layoutDiagnostics.devices={mounted:!!window.PGDeviceSettings,network:!!sources?.network?.data?.deviceId,mouse:sources?.mouse?.status||null,gpu:!!sources?.system?.data?.gpuName};layoutDiagnostics.builder={mounted:!!window.PGBuilderUI,customWidgets:window.PGCustomWidgets?.current()?.items.length||0,status:window.PGCustomWidgets?.status()||null,aiAvailable:!!window.PGCustomWidgets?.agent()?.available};layoutDiagnostics.transfer=window.PGLayoutTransfer?.diagnostics?.()||null;layoutDiagnostics.fileBridgeReady=!!window.PGLayoutFiles;layoutDiagnostics.desktopHub=window.PGDesktopHub?.diagnostics?.()||null;}
   if(layoutDiagnostics&&layout.theme==='paper-green'){layoutDiagnostics.pixelEqualizer={mounted:!!document.getElementById('scenePixels'),bars:document.querySelectorAll('#scenePixels i').length,signal:document.getElementById('scenePixels')?.dataset.signal||'unknown'};}
   if(layoutDiagnostics&&['paper-green','luna-blue'].includes(layout.theme)){layoutDiagnostics.settings={unified:!!window.PGSettings,sections:document.querySelectorAll('[data-settings-panel]').length,paletteEditors:document.querySelectorAll('.appearance-controls').length,legacyThemePanel:!!document.getElementById('themePicker')};layoutDiagnostics.launcher=window.VGLauncher?.diagnostics?.()||null;}
   window.chrome.webview.postMessage({type:'app-diagnostics',data:{profile:profile||'auto',layout:layoutDiagnostics,windowPolicy:window.PGWindows?.diagnostics?.()||null,surface:window.PGSurface||null,viewport:[innerWidth,innerHeight],scene:window.VGLiquid?.state?.()||null,sceneGeometry:stats.cssWidth>0?{aspect:stats.aspect,cssWidth:stats.cssWidth,cssHeight:stats.cssHeight,bufferWidth:stats.bufferWidth,bufferHeight:stats.bufferHeight}:null,frames:stats.frames||0,frameAge:stats.frameAge??null,glError:stats.glError??null,glErrorProbeAge:stats.glErrorProbeAge??null,contextLost:stats.contextLost===true,waterFps:stats.waterFps??null,renderFps:stats.renderFps??null,renderSleeping:stats.renderFps===0,waterSleeping:stats.waterFps===0,moonMaterial:stats.moonMaterial??null,waterDraws:stats.waterDraws??null,spectrumDraws:stats.spectrumDraws??null,audioEnergy:stats.audio||0,audioFrames,audioAge:lastAudio?Date.now()-lastAudio:null,audioPeak:peakSinceReport,barHeight:Math.max(0,...bars.map(b=>parseFloat(b.style.height)||0)),sources:sources?Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,v?.status])):null,settingsOpen:document.getElementById('settings')?.hidden===false,launcherPresent:document.getElementById('launcher')?.hidden===false}});peakSinceReport=0;
  },5000);
 });
})();


