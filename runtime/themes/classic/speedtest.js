(function(){
 'use strict';
 const buttons=[document.getElementById('speedTest'),document.getElementById('networkTest')],result=document.getElementById('speedResult');
 let requesting=false;
 const resultTime=new Intl.DateTimeFormat('ru-RU',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 function show(message){if(result.textContent!==message)result.textContent=message;}
 function render(source){
  const running=source?.running===true||requesting;buttons.forEach(b=>b.disabled=running||source?.testAvailable===false);
  if(running){show('Измерение: до 150 МБ вниз + 50 МБ вверх…');return;}
  const d=source?.data;
  if(d&&Number.isFinite(d.downMbps)&&Number.isFinite(d.upMbps))show(`↓ ${d.downMbps.toFixed(1)} / ↑ ${d.upMbps.toFixed(1)} Mbps · ${resultTime.format(new Date(source.updatedAt))} · Cloudflare HTTP${source.error?' · последний тест завершился ошибкой':''}`);
  else show(source?.error||'Ещё не измерялась.');
 }
 async function run(){
  if(requesting)return;requesting=true;render();
  try{
   const base=window.VGCore.bridgeUrl(document.getElementById('bridgeInput').value);
   if(!base)throw new Error('Companion не подключён');
   const endpoint=new URL('/speedtest',base);
   const response=await fetch(endpoint.href,{method:'POST',headers:{'X-VioletGhost-Action':'speedtest','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY||''},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});
   if(response.status===429)throw new Error('Повторный тест доступен через минуту');
   if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.error||'Не удалось запустить тест');}
   result.textContent='Тест запущен. Результат появится в окне Интернета.';
  }catch(error){result.textContent=error.message;}
  finally{requesting=false;buttons.forEach(b=>b.disabled=false);}
 }
 window.VGSpeedtest={render,run};buttons.forEach(button=>button.addEventListener('click',run));
})();
