(function(){
 'use strict';
 const $=id=>document.getElementById(id),C=window.VGCore;
 // Existing modules keep their command validation and acquisition timestamps.
 $('daylightPower').append(document.querySelector('.pc-powerbar'));
 $('stage').append($('settingsToggle'));
 $('stage').append($('settings'));
 for(const [id,label] of [['powerShutdown','Выключить компьютер'],['powerRestart','Перезагрузить компьютер']]){$(id).title=label;$(id).setAttribute('aria-label',label);}
 const header=document.querySelector('.calendar header'),prev=$('calendarPrev'),next=$('calendarNext'),today=$('calendarToday'),month=$('calendarMonth');
 header.replaceChildren(prev,month,next,today);today.textContent='СЕГОДНЯ';
 new MutationObserver(()=>{if(today.textContent!=='СЕГОДНЯ')today.textContent='СЕГОДНЯ';}).observe(today,{childList:true});
 const usb=document.createElement('span');usb.className='usb-label';usb.textContent='USB —';document.querySelector('.mouse .compact-info').append(usb);
 $('daylightDesktop')?.addEventListener('click',()=>$('launcherDesktop').click());
 const toggle=$('settingsToggle');toggle.innerHTML='<svg class="icon" viewBox="0 0 32 32" aria-hidden="true"><path d="m13 2 6 0 1 5 4 2 5-1 3 5-4 4 0 4 3 4-3 5-5-2-4 2-1 5h-6l-1-5-4-2-5 1-3-5 4-4v-4l-3-4 3-5 5 2 4-2z" transform="translate(1 -1) scale(.9)"/><circle cx="16" cy="16" r="5"/></svg>';toggle.setAttribute('aria-controls','settings');toggle.setAttribute('aria-expanded','false');
 new MutationObserver(()=>toggle.setAttribute('aria-expanded',String(!$('settings').hidden))).observe($('settings'),{attributes:true,attributeFilter:['hidden']});
 $('resetLayout').addEventListener('click',()=>{if(!window.PGLayouts)window.VGLauncher?.resetLayout?.();});
 window.addEventListener('daylight:snapshot',event=>{const source=event.detail?.sources?.mouse;const fresh=C.sourceState(source,Date.now(),120000)==='ok';usb.textContent=!fresh?'USB —':source.data?.charging===true?'USB ⚡':source.data?.charging===false?'USB —':'USB ?';});
 document.addEventListener('keydown',event=>{if(!window.PGWindows&&event.key==='Escape'&&!$('settings').hidden){$('settingsClose').click();}});
})();
