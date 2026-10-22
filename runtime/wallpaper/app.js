(function () {
  'use strict';
  const C = window.VGCore;
  const $ = id => document.getElementById(id);
  const text = (id, value) => { const el=$(id),next=String(value);if(el.textContent!==next)el.textContent=next; };
  const requestHeaders = endpoint => endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)&&endpoint.port==='8767'?{'X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY||''}:{};
  const stage = $('stage');
  const panels = Object.fromEntries([...document.querySelectorAll('[data-widget]')].map(el => [el.dataset.widget, el]));
  const physicalWidth = Math.round((window.screen?.width || window.innerWidth) * (window.devicePixelRatio || 1));
  const luna=document.body.dataset?.theme==='luna-blue';
  const prefsKey = `${luna?'luna-blue':'paper-green-app'}-settings-v1:${window.innerWidth}x${window.innerHeight}`;
  const defaults = {profile: Math.max(physicalWidth,window.innerWidth) >= 3000 ? 'display-2' : 'display-1', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', bridge: 'http://127.0.0.1:8767/status', motion: true, seconds: true};
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Restricted storage must not stop a wallpaper. */ } };
  let prefs = {...defaults, ...read(prefsKey, {})};
  try { C.dateParts(new Date(), prefs.timezone); } catch (_) { prefs.timezone = defaults.timezone; }
  prefs.bridge = C.bridgeUrl(prefs.bridge) || '';
  if (!['display-1', 'display-2'].includes(prefs.profile)) prefs.profile = defaults.profile;
  let positions = {}, editing = false, drag = null;
  let shownMonth = null, todayKey = '', paused = false, enginePaused = false;
  let snapshot = null, snapshotBridge = '', bridgeTimer = null, bridgeAbort = null, bridgeGeneration = 0, failures = 0, bridgeFault = '';
  let audioReceived = false, audioPeak = 0, audioFormat = 'none', audioAt = 0;
  const pixelEqualizer=$('scenePixels');
  const pixelBars=pixelEqualizer?Array.from({length:56},()=>{const bar=document.createElement('i');pixelEqualizer.appendChild(bar);return bar;}):[];
  function renderPixelEqualizer(levels){
    if(pixelEqualizer){const signal=levels.some(value=>value>.001)?'active':'silent';if(pixelEqualizer.dataset.signal!==signal)pixelEqualizer.dataset.signal=signal;}
    pixelBars.forEach((bar,index)=>{const level=Math.max(0,(levels[Math.floor(index*levels.length/pixelBars.length)]||0)-.00002),steps=Math.max(0,Math.min(8,Math.round(Math.sqrt(level/(level+.04))*8)));const height=(steps?steps*7-3:2)+'px';if(bar.style.height!==height)bar.style.height=height;});
  }
  renderPixelEqualizer([]);
  const diagnosticId=Math.random().toString(16).slice(2,14).padEnd(12,'0');
  let formatters;
  function formats() {
    if (!formatters || formatters.zone !== prefs.timezone) {
      formatters={zone:prefs.timezone,
        time:new Intl.DateTimeFormat('ru-RU',{timeZone:prefs.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit'}),
        shortTime:new Intl.DateTimeFormat('ru-RU',{timeZone:prefs.timezone,hour:'2-digit',minute:'2-digit'}),
        weekday:new Intl.DateTimeFormat('ru-RU',{timeZone:prefs.timezone,weekday:'long'})};
    }
    return formatters;
  }
  const layoutKey = () => `${luna?'luna-blue':'paper-green-app'}-layout-v1:${prefs.profile}`;
  const sourceLabels = {ok: 'Подключено', stale: 'Данные устарели', error: 'Ошибка источника', unavailable: 'Источник не подключён'};
  const cleanString = (value, fallback = '', limit = 200) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback;

  function resizeStage() {
    const scale = Math.min(window.innerWidth / C.WIDTH, window.innerHeight / C.HEIGHT);
    stage.style.setProperty('--scale', scale);
  }
  function place(id) {
    const p = positions[id] = C.layout(id, positions[id]);
    const base = C.layouts[id], el = panels[id], inside = el.querySelector('.widget-content');
    Object.assign(el.style, {left: `${p.x}px`, top: `${p.y}px`, width: `${base[2] * p.s}px`, height: `${base[3] * p.s}px`});
    Object.assign(inside.style, {width: `${base[2]}px`, height: `${base[3]}px`, transform: `scale(${p.s})`});
  }
  function loadLayout() {
    drag=null;
    if(window.PGLayouts){applyLayoutModel(window.PGLayouts.activate(prefs.profile).get());return;}
    positions = read(layoutKey(), {});
    if (!positions || typeof positions !== 'object' || Array.isArray(positions)) positions = {};
    Object.keys(panels).forEach(place);
  }
  function applyLayoutModel(doc){
    if(doc.profile!==prefs.profile||drag)return;
    for(const id of Object.keys(panels)){const p=doc.widgets[id];if(!p)continue;positions[id]={x:p.x,y:p.y,s:p.scale};panels[id].hidden=!p.visible;place(id);}
  }
  window.PGLayouts?.subscribe(({document:doc})=>applyLayoutModel(doc));
  for (const [id, panel] of Object.entries(panels)) {
    const grip = document.createElement('div'); grip.className = 'resize-grip'; grip.title = 'Изменить размер'; panel.appendChild(grip);
    panel.addEventListener('pointerdown', event => {
      if (window.PGLayoutEditor || !editing || event.button !== 0 || event.target.closest('button')) return;
      const isGrip = event.target.closest('.resize-grip');
      if (!isGrip && !event.target.closest('.drag-handle')) return;
      drag = {id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initial: {...positions[id]}, resize: !!isGrip};
      panel.setPointerCapture(event.pointerId); event.preventDefault();
    });
    panel.addEventListener('pointermove', event => {
      if (!drag || drag.id !== id || drag.pointerId !== event.pointerId) return;
      const scale = Math.min(window.innerWidth / C.WIDTH, window.innerHeight / C.HEIGHT);
      const dx = (event.clientX - drag.startX) / scale, dy = (event.clientY - drag.startY) / scale;
      const base = C.layouts[id], initial = drag.initial;
      if (drag.resize) {
        const delta = Math.abs(dx / base[2]) >= Math.abs(dy / base[3]) ? dx / base[2] : dy / base[3];
        positions[id] = {...initial, s: initial.s + delta};
      } else positions[id] = {...initial, x: initial.x + dx, y: initial.y + dy};
      place(id);
    });
    const finish = event => { if (drag?.id === id && drag.pointerId === event.pointerId) { drag = null;const p=positions[id];if(window.PGLayouts)void window.PGLayouts.update({[id]:{x:p.x,y:p.y,scale:p.s}});else write(layoutKey(), positions); } };
    panel.addEventListener('pointerup', finish); panel.addEventListener('pointercancel', finish); panel.addEventListener('lostpointercapture', finish);
  }

  const months = ['ЯНВАРЬ','ФЕВРАЛЬ','МАРТ','АПРЕЛЬ','МАЙ','ИЮНЬ','ИЮЛЬ','АВГУСТ','СЕНТЯБРЬ','ОКТЯБРЬ','НОЯБРЬ','ДЕКАБРЬ'];
  function renderCalendar(now = C.dateParts(new Date(), prefs.timezone)) {
    const m = shownMonth || now, {offset, days} = C.calendar(m.year, m.month);
    text('calendarMonth', `${months[m.month - 1]} ${m.year}`);
    text('calendarToday', String(now.day).padStart(2, '0'));
    text('calendarCaption', shownMonth ? '↺ НАЖМИ НА ДАТУ ДЛЯ ВОЗВРАТА' : 'СЕГОДНЯ / LOCAL DATE');
    const fragment = document.createDocumentFragment();
    // Always reserve six rows so a month change never pushes another widget.
    for (let i = 0; i < 42; i++) {
      const cell = document.createElement('span'), day = i - offset + 1;
      if (day > 0 && day <= days) {
        cell.textContent = day;
        if (i % 7 >= 5) cell.classList.add('weekend');
        if (day === now.day && m.month === now.month && m.year === now.year) { cell.classList.add('today'); cell.setAttribute('aria-current', 'date'); }
      }
      fragment.appendChild(cell);
    }
    $('calendarDays').replaceChildren(fragment);
  }
  function clockTick() {
    if (paused) return;
    const d = new Date(), p = C.dateParts(d, prefs.timezone);
    text('hours', p.hour); text('minutes', p.minute); text('seconds', p.second);
    text('clockDate', `${String(p.day).padStart(2, '0')} ${months[p.month - 1].slice(0, 3)} ${p.year}`);
    text('clockWeekday', formats().weekday.format(d).toUpperCase());
    const key = `${p.year}-${p.month}-${p.day}`;
    if (key !== todayKey) { todayKey = key; renderCalendar(p); }
    renderSources();
  }
  function changeMonth(delta) {
    const p = shownMonth || C.dateParts(new Date(), prefs.timezone);
    shownMonth = C.shiftMonth(p.year, p.month, delta); renderCalendar();
  }
  $('calendarPrev').addEventListener('click', () => changeMonth(-1));
  $('calendarNext').addEventListener('click', () => changeMonth(1));
  $('calendarToday').addEventListener('click', () => { shownMonth = null; renderCalendar(); });

  const sourceFor=name=>name==='system'?C.freshSystem(snapshot?.sources?.[name]):snapshot?.sources?.[name];
  function stateFor(name, age) { return C.sourceState(sourceFor(name), Date.now(), age); }
  function dataFor(name, age) { const source=sourceFor(name);return C.sourceState(source,Date.now(),age)==='ok'?source.data||{}:{}; }
  function sourceNote(name, age) {
    const state = stateFor(name, age);
    if (state === 'ok') {
      const timestamp = new Date(sourceFor(name).updatedAt);
      return `${name==='ecoflow'&&snapshot.sources[name].timeBasis==='live MQTT receive time'?'Принято':'Обновлено'} ${formats().time.format(timestamp)}`;
    }
    return sourceLabels[state];
  }
  function bar(id, value) { const el=$(id),next=`${C.finite(value) ? C.clamp(value, 0, 100) : 0}%`;if(el.style.width!==next)el.style.width=next; }
  function batteryText(value) { const b = C.battery(value); return b === null ? '—%' : `${C.number(b)}%`; }
  function renderSources() {
    window.VGDesktopControls?.render(snapshot?.sources?.desktop||null,prefs.bridge);
    window.VGPower?.render(snapshot?.sources?.desktop||null,prefs.bridge);
    window.VGPlayer?.render(snapshot?.sources?.media||null,snapshot?.sources?.desktop||null,prefs.bridge);
    const session=dataFor('media',15000);
    if(session.title && media.enabled){
      const title=cleanString(session.title,'',500),artist=cleanString(session.artist,'',300);
      if(title!==media.title||artist!==media.artist){clearCover();resetTimeline();}
      Object.assign(media,{origin:'smtc',title,artist,playback:['playing','paused','stopped'].includes(session.playback)?session.playback:'waiting',position:C.nonnegative(session.position),duration:C.nonnegative(session.duration),positionAt:session.timelineUpdatedAt,rate:session.playbackRate});
      const thumbnail=session.thumbnail;
      if(typeof thumbnail==='string'&&/^data:image\/(png|jpeg|webp);base64,/i.test(thumbnail)){if($('mediaCover').getAttribute?.('src')!==thumbnail)$('mediaCover').src=thumbnail;$('mediaCover').hidden=false;$('coverPlaceholder').hidden=true;}
      panels.media.title=snapshot.sources.media.identity+' · '+sourceNote('media',15000);
      renderMedia();
    }else if(media.origin==='smtc'){
      Object.assign(media,{origin:'native',title:'',artist:'',playback:'waiting'});clearCover();resetTimeline();renderMedia();
    }
    for (const [name, age] of Object.entries({system:15000,network:15000,mouse:120000,ecoflow:120000,weather:1800000,pet:15000})) {
      if(!panels[name])continue;
      const state=stateFor(name,age),title=[snapshot?.sources?.[name]?.identity,sourceNote(name,age),snapshot?.sources?.[name]?.detail].filter(Boolean).join(' · ');
      if(panels[name].dataset.state!==state)panels[name].dataset.state=state;
      if(panels[name].title!==title)panels[name].title=title;
    }
    const sys = dataFor('system',15000);
    if($('systemModel'))text('systemModel',cleanString(snapshot?.sources?.system?.data?.gpuName,'SYSTEM',90));
    text('vramValue', `${C.gib(sys.vramUsedBytes)} / ${C.gib(sys.vramTotalBytes)} GiB`);
    text('ramValue', `${C.gib(sys.ramUsedBytes)} / ${C.gib(sys.ramTotalBytes)} GiB`);
    bar('vramBar', C.percent(sys.vramUsedBytes, sys.vramTotalBytes)); bar('ramBar', C.percent(sys.ramUsedBytes, sys.ramTotalBytes));
    text('systemStatus', sourceNote('system',15000));
    const net = dataFor('network',15000);
    const speed=dataFor('speedtest',4500000),speedSource=snapshot?.sources?.speedtest;
    const traffic=snapshot?.sources?.deviceSettings?.data?.effectiveSpeedMode==='traffic'||snapshot?.sources?.deviceSettings?.data?.speedMode==='traffic';
    const speedNumber=value=>C.finite(value)&&value>=0?(value>=100?String(Math.round(value)):value.toFixed(1)):'—';
    text('downValue',speedNumber(traffic?C.finite(net.rxBytesPerSecond)?net.rxBytesPerSecond*8/1000000:null:speed.downMbps));text('upValue',speedNumber(traffic?C.finite(net.txBytesPerSecond)?net.txBytesPerSecond*8/1000000:null:speed.upMbps));
    text('networkSpeedTime',traffic?'ТЕКУЩИЙ ТРАФИК':speedSource?.running?'ИЗМЕРЯЕТСЯ…':stateFor('speedtest',4500000)==='ok'?`Последний — ${formats().shortTime.format(new Date(speedSource.updatedAt))}`:speedSource?.error?'Ошибка теста':stateFor('speedtest',4500000)==='stale'?'Тест устарел':'Ещё не измерена');
    window.VGSpeedtest?.render(speedSource);
    text('pingValue', C.number(C.nonnegative(net.pingMs)));
    text('internetState', net.internet === true ? 'ONLINE' : net.internet === false ? 'OFFLINE' : 'НЕИЗВЕСТНО');
    text('networkStatus', stateFor('network',15000) === 'ok' ? cleanString(net.adapter,'Сетевой адаптер',45)+(C.finite(net.linkSpeedMbps)?` · линк ${Math.round(net.linkSpeedMbps)} Mbps`:'') : sourceLabels[stateFor('network',15000)]);
    const pingTarget=cleanString(net.pingTarget,'',120);
    text('networkTarget', pingTarget==='https://www.microsoft.com/favicon.ico (HTTPS RTT)' ? 'HTTPS RTT · microsoft.com' : pingTarget || 'Задержка: нет измерения');
    const mouse = dataFor('mouse',120000);
    text('mouseModel', cleanString(snapshot?.sources?.mouse?.data?.model,'Беспроводная мышь',80).replace(/ Wireless Gaming Mouse$/i,''));
    text('mouseBattery', batteryText(mouse.batteryPercent)); bar('mouseBar', C.battery(mouse.batteryPercent));
    const charge=C.battery(mouse.batteryPercent);
    const batteryState=charge===null?'unknown':charge<=5?'critical':charge<=15?'low':charge<=25?'warning':'normal',charging=mouse.charging===true?'true':'false';
    if(panels.mouse.dataset.battery!==batteryState)panels.mouse.dataset.battery=batteryState;
    if(panels.mouse.dataset.charging!==charging)panels.mouse.dataset.charging=charging;
    text('mouseCharging', mouse.charging === true ? '⚡ ЗАРЯД' : '');
    text('mouseStatus', stateFor('mouse',120000)==='ok' ? '' : sourceNote('mouse',120000));
    if(panels.ecoflow){const eco = dataFor('ecoflow',120000);
    text('ecoBattery', batteryText(eco.batteryPercent)); bar('ecoBar', C.battery(eco.batteryPercent));
    text('ecoIn', C.number(C.nonnegative(eco.inputWatts))); text('ecoOut', C.number(C.nonnegative(eco.outputWatts))); text('ecoStatus', sourceNote('ecoflow',120000));
    text('ecoRuntime',C.runtimeText(eco.estimatedRuntimeMinutes));
    $('ecoRuntime').title='Оценка без подзарядки: 2048 Вт·ч × заряд × 0,85 / средняя выходная мощность за 60 с. Не учитывает установленный резерв, износ и температуру; коэффициент потерь приблизительный.';
    const plot=C.loadPlot(eco.loadHistory),graphNode=$('ecoLoadPath');if(graphNode.getAttribute?.('d')!==plot.path)graphNode.setAttribute('d',plot.path);
    $('ecoLoadDot').setAttribute('visibility',plot.x===null?'hidden':'visible');if(plot.x!==null){$('ecoLoadDot').setAttribute('cx',plot.x.toFixed(1));$('ecoLoadDot').setAttribute('cy',plot.y.toFixed(1));}
    text('ecoLoadTitle','Выходная мощность · последние '+plot.minutes+' мин. Разрывы означают отсутствие измерений.');
    }
    if(panels.pet){const pet=dataFor('pet',15000),states={working:'РАБОТАЕТ',ready:'ГОТОВО',input:'ЖДЁТ ОТВЕТА',idle:'ОЖИДАЕТ',blocked:'ОШИБКА',offline:'НЕТ СВЯЗИ'};text('petState',Object.hasOwn(states,pet.state)?states[pet.state]:'НЕТ СВЯЗИ');text('petDetail',stateFor('pet',15000)==='ok'?cleanString(pet.detail,'CODEX',100):'Место для твоего Пэта');}
    const eventSource=snapshot?.sources?.events,events=stateFor('events',15000)==='ok'?eventSource.data?.items:[];
    const event=Array.isArray(events)?events.find(e=>typeof e.text==='string'&&(!luna||!/ecoflow|станци|автономност/i.test(e.text))&&Date.now()>=e.start&&Date.now()<e.until):null;
    $('eventNotice').hidden=!event;text('eventMessage',event?event.text.slice(0,120):'');$('eventNotice').dataset.tone=event?.tone==='critical'?'critical':event?.tone==='warning'?'warning':'info';
    const weather = dataFor('weather',1800000);
    text('weatherLocation',cleanString(weather.city,'ПОГОДА',64));
    const appearance=C.weatherInfo(weather.weatherCode,weather.isDay),symbol='#i-weather-'+appearance.icon;
    if($('weatherSymbol').getAttribute?.('href')!==symbol)$('weatherSymbol').setAttribute('href',symbol);
    text('weatherIconTitle',Number.isInteger(weather.weatherCode)?appearance.description:'Нет данных о погоде');
    text('temperature', C.finite(weather.temperatureC) ? `${weather.temperatureC > 0 ? '+' : ''}${Math.round(weather.temperatureC)}` : '—');
    text('weatherText',Number.isInteger(weather.weatherCode)?appearance.description:cleanString(weather.description,'Нет данных',60)); text('weatherStatus', sourceNote('weather',1800000));
  }

  function stopBridge() {
    bridgeGeneration++; clearTimeout(bridgeTimer); bridgeTimer = null; bridgeAbort?.abort(); bridgeAbort = null;
  }
  function startBridge() {
    stopBridge();
    // Resuming the same source must not flash empty cards while the reply is in flight.
    // Existing acquisition timestamps still govern freshness; another URL clears the cache.
    if(snapshotBridge!==prefs.bridge){snapshot=null;snapshotBridge=prefs.bridge;}
    failures = 0; bridgeFault = ''; renderSources();
    if (!prefs.bridge || paused) return;
    const generation = bridgeGeneration;
    async function poll() {
      if (paused || generation !== bridgeGeneration) return;
      const controller = new AbortController(); bridgeAbort = controller;
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const endpoint=new URL(prefs.bridge);
        diagnosticParams(endpoint);
        endpoint.searchParams.set('vgProfile',prefs.profile);
        endpoint.searchParams.set('vgViewport',`${window.innerWidth}x${window.innerHeight}`);
        endpoint.searchParams.set('vgContext',typeof window.wallpaperRegisterMediaPropertiesListener==='function'?'engine':'browser');
        endpoint.searchParams.set('vgMedia',!media.enabled?'disabled':media.title?'title':'empty');
        endpoint.searchParams.set('vgAudio',!audioReceived?'none':audioFormat!=='stereo'?audioFormat:audioPeak>0.001?'signal':audioPeak>0?'quiet':'zero');
        endpoint.searchParams.set('vgMotion',window.VGLiquid?.state?.()||'absent');
        endpoint.searchParams.set('vgReactive',window.VGLiquid?.audioState?.()||'absent');
        endpoint.searchParams.set('vgLauncher',window.VGLauncher?.state?.()||'absent');
        const response = await fetch(endpoint.href, {headers:requestHeaders(endpoint),signal: controller.signal, cache:'no-store', credentials:'omit', redirect:'error'});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || payload.schemaVersion !== 1 || !payload.sources || typeof payload.sources !== 'object' || Array.isArray(payload.sources)) throw new Error('Несовместимый формат данных');
        if (generation !== bridgeGeneration) return;
        snapshot = payload; failures = 0; bridgeFault = ''; window.dispatchEvent(new CustomEvent('daylight:snapshot',{detail:payload}));
      } catch (error) {
        if (generation !== bridgeGeneration) return;
        failures++; bridgeFault = error.name === 'AbortError' ? 'Источник не ответил за 3 секунды' : cleanString(error.message, 'Нет связи с источником');
        // Existing source timestamps expire normally; failed polls never turn old readings into fresh ones.
      } finally { clearTimeout(timeout); if (bridgeAbort === controller) bridgeAbort = null; }
      if (generation !== bridgeGeneration || paused) return;
    renderSources();
      if (!$('settings').hidden && bridgeFault) text('settingsMessage', bridgeFault);
      bridgeTimer = setTimeout(poll, failures ? Math.min(30000, 2000 * 2 ** Math.min(failures,4)) : 2000);
    }
    poll();
  }

  // Wallpaper Engine registration happens synchronously at script evaluation, at the end of body.
  const media = {enabled:true, title:'', artist:'', playback:'waiting', position:null, duration:null,origin:'native',positionAt:null,rate:1};
  const bars = pixelBars;
  function clearCover() { $('mediaCover').hidden=true; $('mediaCover').removeAttribute('src'); $('coverPlaceholder').hidden=false;panels.media.dataset.artwork='square'; }
  function resetTimeline() { media.position=null; media.duration=null; $('timeline').hidden=true; bar('timelineBar',null); }
  function renderMedia() {
    text('mediaTitle', media.enabled && media.title ? media.title : 'Тишина в эфире');
    text('mediaArtist', !media.enabled ? 'Медиаинтеграция отключена в Wallpaper Engine' : media.artist || (media.title?'Автор не указан':'Ожидание медиасессии Windows'));
    const title=media.enabled?media.title:'',artist=media.enabled?media.artist:'';
    if($('mediaTitle').title!==title)$('mediaTitle').title=title;
    if($('mediaArtist').title!==artist)$('mediaArtist').title=artist;
    text('mediaState', !media.enabled ? 'ОТКЛЮЧЕНО' : ({playing:'ИГРАЕТ',paused:'ПАУЗА',stopped:'ОСТАНОВЛЕНО',waiting:'ОЖИДАНИЕ'}[media.playback]));
    const timeline = media.enabled && C.finite(media.duration) && media.duration>0 && C.finite(media.position) && media.position>=0;
    $('timeline').hidden=!timeline;
    if (timeline) {
      const position=C.mediaPosition(media,Date.now());
      bar('timelineBar', C.percent(position,media.duration)); text('timelineText',`${C.duration(position)} / ${C.duration(media.duration)}`);
    }
  }
  function register(name, callback) { if (typeof window[name] === 'function') window[name](callback); }
  register('wallpaperRegisterMediaStatusListener', event => {
    media.enabled=event.enabled===true;
    if (!media.enabled) {media.title='';media.artist='';media.playback='waiting';clearCover();resetTimeline();}
    renderMedia();
  });
  register('wallpaperRegisterMediaPropertiesListener', event => {
    if(stateFor('media',15000)==='ok')return;
    const title=cleanString(event.title,'',500), artist=cleanString(event.artist || event.albumArtist || event.subTitle,'',300);
    if (title!==media.title || artist!==media.artist) {clearCover();resetTimeline();}
    media.title=title;media.artist=artist;media.origin='native';
    if (!title) {clearCover();resetTimeline();}
    renderMedia();
  });
  register('wallpaperRegisterMediaThumbnailListener', event => {
    if(stateFor('media',15000)==='ok')return;
    const thumbnail = typeof event.thumbnail==='string' ? event.thumbnail : '';
    if (!thumbnail) {clearCover();return;}
    // Accept only embedded image data from the engine, never fetch arbitrary album-cover URLs.
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(thumbnail)) {clearCover();return;}
    $('mediaCover').src=thumbnail;$('mediaCover').hidden=false;$('coverPlaceholder').hidden=true;
  });
  $('mediaCover').addEventListener('error',clearCover);
  $('mediaCover').addEventListener('load',()=>{const image=$('mediaCover');panels.media.dataset.artwork=C.artworkKind(image.naturalWidth,image.naturalHeight);});
  register('wallpaperRegisterMediaPlaybackListener', event => {
    if(stateFor('media',15000)==='ok')return;
    const api=window.wallpaperMediaIntegration || {}, p=api.playback || {};
    const isState=(flat,nested)=> typeof flat==='number' && event.state===flat || typeof nested==='number' && event.state===nested;
    media.playback=isState(api.PLAYBACK_PLAYING,p.PLAYING)?'playing':isState(api.PLAYBACK_PAUSED,p.PAUSED)?'paused':isState(api.PLAYBACK_STOPPED,p.STOPPED)?'stopped':'waiting';
    if (media.playback==='stopped') {media.title='';media.artist='';clearCover();resetTimeline();}
    renderMedia();
  });
  register('wallpaperRegisterMediaTimelineListener', event => {if(stateFor('media',15000)==='ok')return;media.position=C.nonnegative(event.position);media.duration=C.nonnegative(event.duration);media.positionAt=null;renderMedia();});
  register('wallpaperRegisterAudioListener', samples => {
    if (paused) return;
    const levels=C.audioBars(samples,luna?64:40);renderPixelEqualizer(levels);audioReceived=true;audioAt=Date.now();audioFormat=samples?.length===128?'stereo':samples?.length===64?'mono':samples?.length===256?'double':'invalid';audioPeak=Math.max(...levels);window.dispatchEvent(new CustomEvent('daylight:audio',{detail:levels}));
    window.VGLiquid?.setAudio(C.audioResponse(samples));
  });
  if (typeof window.wallpaperRegisterMediaPropertiesListener!=='function') media.artist='Ожидание медиасессии Windows';
  renderMedia();

  function applyPrefs(restart = true) {
    window.VGLauncher?.configure(prefs);
    document.body.classList.toggle('motion-off', !prefs.motion);
    window.VGLiquid?.setMotion(prefs.motion);
    $('seconds').hidden=!prefs.seconds;
    text('zoneLabel',prefs.timezone);
    $('profileInput').value=prefs.profile;$('timezoneInput').value=prefs.timezone;$('bridgeInput').value=prefs.bridge;
    $('motionInput').checked=!!prefs.motion;$('secondsInput').checked=!!prefs.seconds;
    todayKey='';shownMonth=null;clockTick();loadLayout();write(prefsKey,prefs);
    if (restart) startBridge();
    window.dispatchEvent(new CustomEvent('paper:preferences',{detail:{timezone:prefs.timezone,profile:prefs.profile,motion:prefs.motion,seconds:prefs.seconds}}));
  }
  function syncEditing(value) { drag=null;editing=!!value;$('editInput').checked=editing;document.body.classList.toggle('editing',editing);window.VGLauncher?.setEditing(editing);window.VGPower?.setEditing(editing); }
  function setEditing(value) { if(window.PGLayoutEditor){window.PGLayoutEditor.setEditing(!!value);return;}syncEditing(value); }
  window.addEventListener('paper:layout-editing',event=>syncEditing(event.detail?.editing===true));
  const policy=window.PGWindows;
  policy?.registerPanel('settings',{isOpen:()=>!$('settings').hidden,close:()=>{$('settings').hidden=true;$('settingsToggle').setAttribute('aria-expanded','false');}});
  async function showSettings(){if(!$('settings').hidden){policy?policy.closePanel('settings','explicit'):$('settings').hidden=true;return;}if(policy&&!await policy.openPanel('settings',{trigger:$('settingsToggle')}))return;$('settings').hidden=false;$('settingsToggle').setAttribute('aria-expanded','true');text('settingsMessage',bridgeFault);if(policy)policy.restoreFocus($('settingsClose'),'done');else $('settingsClose').focus({preventScroll:true});}
  $('settingsToggle').addEventListener('click',showSettings);
  $('settingsClose').addEventListener('click',()=>{if(policy)policy.closePanel('settings','explicit');else $('settings').hidden=true;setEditing(false);});
  document.addEventListener('pointerdown',event=>{if(policy&&!$('settings').hidden&&!$('settings').contains(event.target)&&!$('settingsToggle').contains(event.target)&&!window.PGSettings?.isTrigger?.(event.target))policy.closePanel('settings','outside');});
  $('editInput').addEventListener('change',event=>setEditing(event.target.checked));
  function savePreferences(changes){
    const next={...prefs,...changes},timezone=next.timezone.trim(),bridge=C.bridgeUrl(next.bridge);
    try {C.dateParts(new Date(),timezone);} catch (_) {text('settingsMessage','Проверь часовой пояс, например UTC.');return false;}
    if (bridge===null) {text('settingsMessage','Нужен HTTP-адрес localhost или 127.0.0.1 без логина и пароля.');return false;}
    if(!['display-1','display-2'].includes(next.profile))return false;
    const reconnect=bridge!==prefs.bridge;prefs={...next,timezone,bridge};applyPrefs(reconnect);text('settingsMessage','Сохранено.');return true;
  }
  window.PGPreferences={get:()=>({timezone:prefs.timezone,profile:prefs.profile,motion:prefs.motion,seconds:prefs.seconds}),update:savePreferences};
  $('saveSettings').addEventListener('click',()=>savePreferences({timezone:$('timezoneInput').value,bridge:$('bridgeInput').value,profile:$('profileInput').value,motion:$('motionInput').checked,seconds:$('secondsInput').checked}));
  $('resetLayout').addEventListener('click',()=>{if(window.PGLayouts){const profile=prefs.profile;void Promise.resolve(window.PGLayouts.reset()).then(result=>{if(prefs.profile===profile)text('settingsMessage',result?.ok===false?result.message:window.PGLayouts.status?.()==='saved'?'Исходная компоновка восстановлена.':'Компоновка восстановлена. Запись в файл пока недоступна.');});text('settingsMessage','Восстанавливаю исходную компоновку…');return;}positions={};Object.keys(panels).forEach(place);write(layoutKey(),positions);text('settingsMessage','Исходное расположение восстановлено.');});
  window.wallpaperPropertyListener = {
    applyGeneralProperties(properties) { if (properties.fps) window.VGLiquid?.setFps(properties.fps); },
    applyUserProperties(properties) {
      // Optional keys can be added through the WE editor after import; no project.json is fabricated.
      if (properties.motion) prefs.motion=properties.motion.value===true;
      if (properties.showseconds) prefs.seconds=properties.showseconds.value===true;
      if (properties.bridgeurl) prefs.bridge=C.bridgeUrl(properties.bridgeurl.value)||'';
      if (properties.monitorprofile?.value==='auto') prefs.profile=defaults.profile;
      else if (properties.monitorprofile && ['display-1','display-2'].includes(properties.monitorprofile.value)) prefs.profile=properties.monitorprofile.value;
      applyPrefs();
    },
    setPaused(value) { enginePaused=!!value;refreshPause(); }
  };
  function refreshPause() {
    const next=enginePaused || document.hidden;
    if(next===paused)return;
    paused=next;
    window.VGLauncher?.setPaused(paused);
    window.VGPower?.setPaused(paused);
    window.VGLiquid?.setPaused(paused);
    document.body.classList.toggle('engine-paused',paused);
    if (paused) stopBridge();else {clockTick();startBridge();}
    if(paused&&prefs.bridge){try{const endpoint=new URL(prefs.bridge);diagnosticParams(endpoint);fetch(endpoint.href,{headers:requestHeaders(endpoint),cache:'no-store',credentials:'omit',redirect:'error'}).catch(()=>{});}catch{}}
  }
  function diagnosticParams(endpoint){
    const stats=window.VGLiquid?.diagnostics?.()||{},hit=el=>{if(!el)return 'missing';const r=el.getBoundingClientRect?.();if(!r)return 'missing';return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))?'yes':'no';};
    const values={vgBuild:'input2k1',vgInstance:diagnosticId,vgProfile:prefs.profile,vgViewport:`${window.innerWidth}x${window.innerHeight}`,vgContext:typeof window.wallpaperRegisterMediaPropertiesListener==='function'?'engine':'browser',vgPause:enginePaused?'engine':document.hidden?'hidden':'running',vgPrefs:prefs.motion?'on':'off',vgFrames:stats.frames??0,vgFrameAge:stats.frameAge??0,vgClock:stats.clock??0,vgEnergy:stats.audio??0,vgGlError:stats.glError??0,vgContextLost:stats.contextLost?'yes':'no',vgBarHeight:Math.max(0,...bars.map(b=>parseFloat(b.style.height)||0)),vgAudioAge:audioAt?Date.now()-audioAt:1e12,vgPeak:audioPeak,vgGearHit:hit($('settingsToggle')),vgThemeHit:hit(document.querySelector?.('.theme-toggle')),vgStartHit:hit(document.querySelector?.('.start-toggle')),vgSettings:$('settings').hidden?'closed':'open',vgTheme:document.querySelector?.('#themePicker')?.hidden===false?'open':'closed'};
    for(const [k,v]of Object.entries(values))endpoint.searchParams.set(k,String(v));
  }
  window.addEventListener('resize',resizeStage);
  document.addEventListener('visibilitychange',refreshPause);
  resizeStage();applyPrefs();setInterval(clockTick,1000);
})();
