(function(){
 'use strict';
 const appearance=()=>{const state=window.VGAppearance?.get();if(state)document.documentElement.style.setProperty('--luna-accent',state.accent);};appearance();window.addEventListener('paper:appearance',appearance);
 // The existing launcher/catalog, WindowPolicy and native Desktop Hub own actions.
 // The theme supplies presentation only and introduces no new native command.
 document.getElementById('coverPlaceholder').textContent='☾';
 document.getElementById('settings')?.setAttribute('aria-label','Настройки Luna Blue');
})();
