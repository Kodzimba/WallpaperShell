(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const grid = $('openWindowsGrid'), list = $('notificationsList');
  if (!['paper-green','luna-blue'].includes(document.body.dataset.theme) || !grid || !list) return;
  const bridge = window.chrome?.webview, windows = new Map(), notifications = new Map(), pending = new Map();
  const windowColumns=5;
  let windowOrder=[],notificationOrder=[],activationRequest=null,dismissRequest=null,startRequest=null,feedbackTimer=null,windowFeedbackTimer=null,notificationSequence=0;
  const ready = status => ['ready', 'ok', 'available', 'enabled'].includes(status);
  const setText=(node,value)=>{if(node.textContent!==value){node.textContent=value;return true;}return false;};
  const property=(node,key,value)=>{if(node[key]!==value)node[key]=value;};
  const attribute=(node,key,value)=>{if(node.getAttribute(key)!==value)node.setAttribute(key,value);};
  const toggle=(node,key,value)=>{if(node.classList.contains(key)!==value)node.classList.toggle(key,value);};
  const clean = (value, limit = 256) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit) : '';
  const uuid = () => window.crypto?.randomUUID?.() || '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12);
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let windowStatus = bridge ? 'connecting' : 'unavailable', notificationStatus = windowStatus;
  let editing = false, suspended = false, disposed = false, preview = null, previewTimer = null, leaveTimer = null, measureFrame = null;
  const timer = (fn, delay) => window.setTimeout(fn, delay);
  const cancel = id => { if (id !== null) window.clearTimeout(id); };
  const panelVisible = node => { for (let at = node; at; at = at.parentElement) if (at.hidden || at.inert) return false; return true; };
  function permitted(node) {
    if (!bridge || disposed || suspended || editing || document.hidden || window.PGLayoutEditor?.isEditing?.() || !panelVisible(node)) return false;
    if (window.PGWindows && !window.PGWindows.canInteract()) return false;
    const state = window.PGWindows?.diagnostics?.();
    return !(state?.modal || state?.blocked || state?.suspended || state?.activePanel || state?.pendingPanel);
  }
  function post(action, extra = {}) {
    if (!bridge || disposed) return null;
    const requestId = uuid();
    try {
      bridge.postMessage({type: 'desktop-hub-request', requestId, action, ...extra});
      if (action !== 'window-preview-close') {
        const timeout = timer(() => { pending.delete(requestId); if (action === 'notifications-access' || action === 'notifications-settings') $('notificationsAccess').disabled = false;if(action==='notification-activate')finishNotification(requestId,false);if(action==='notification-dismiss')finishDismiss(requestId,false);if(action==='window-close')finishWindowClose(requestId,false);if(action==='start-menu')finishStartMenu(requestId,false); }, action === 'notifications-access' ? 125000 : 8000);
        pending.set(requestId, {action, timeout});
      }
      return requestId;
    } catch (_) { return null; }
  }
  function stopPreview() {
    cancel(previewTimer); cancel(leaveTimer); previewTimer = null; leaveTimer = null;
    if (!preview) return;
    const id = preview.id; preview = null;
    post('window-preview-close', {id});
  }
  function triggerRect(button) {
    const r = button.getBoundingClientRect(), width = window.innerWidth, height = window.innerHeight;
    if (!(width > 0 && height > 0 && r.width > 0 && r.height > 0)) return null;
    const clamp = n => Math.max(0, Math.min(1, n));
    const rect = [clamp(r.left / width), clamp(r.top / height), clamp((r.left + r.width) / width), clamp((r.top + r.height) / height)];
    return rect[2] > rect[0] && rect[3] > rect[1] ? rect : null;
  }
  function startPreview(id, button) {
    cancel(leaveTimer); leaveTimer = null;
    if (preview?.id === id && preview.shown) return;
    stopPreview();
    if (!permitted(button)||windows.get(id)?.closeRequest) return;
    const current = {id, button, shown: false}; preview = current;
    previewTimer = timer(() => {
      previewTimer = null;
      if (preview !== current || !windows.has(id) || !permitted(button)) { stopPreview(); return; }
      const rect = triggerRect(button);
      if (!rect) { stopPreview(); return; }
      // Native code checks that this trigger is actually visible on its Surface,
      // then uses a DWM thumbnail. No screen capture or activation on hover.
      const state = window.VGAppearance?.get?.();
      const appearance = {mode:'dark',accent:state&&/^#[a-f0-9]{6}$/i.test(state.accent)?state.accent:'#caff00'};
      current.shown = !!post('window-preview', {id, rect, ...(appearance ? {appearance} : {})});
    }, 180);
  }
  function scheduleClose() { cancel(leaveTimer); leaveTimer = timer(stopPreview, 120); }
  function openStartMenu(){
    const button=$('startToggle');if(!button||startRequest||!permitted(button))return false;
    stopPreview();const requestId=post('start-menu');if(!requestId)return false;
    startRequest={requestId,button};button.disabled=true;button.title='Пуск';return true;
  }
  function finishStartMenu(requestId,ok){
    if(startRequest?.requestId!==requestId)return;
    startRequest.button.disabled=false;startRequest.button.title=ok?'Пуск':'Не удалось открыть «Пуск». Попробуй ещё раз.';startRequest=null;
  }
  function icon(value, app, className) {
    const node = document.createElement('span'); node.className = className; node.setAttribute('aria-hidden', 'true');
    const fallback = clean(app, 1).toUpperCase() || '□';
    // Native embedded raster icons only: never navigate or fetch a remote URL.
    if (typeof value === 'string' && value.length <= 262144 && /^data:image\/(?:png|jpeg|webp|gif|x-icon);base64,[A-Za-z0-9+/=\r\n]+$/i.test(value)) {
      const img = document.createElement('img'); img.alt = ''; img.src = value;
      img.addEventListener('error', () => { node.replaceChildren(); node.textContent = fallback; }, {once: true});
      node.append(img);
    } else node.textContent = fallback;
    return node;
  }
  function updateIcon(container, value, app, className) {
    const key = (typeof value === 'string' ? value : '') + '\n' + app+'\n'+className;
    if (container.iconKey === key) return;
    container.iconKey = key; container.icon.replaceChildren(icon(value, app, className));
  }
  function paintWindows(){
    const ordered=windowOrder.map(id=>windows.get(id).element);
    if(ordered.some((node,i)=>grid.children[i]!==node)||grid.children.length!==ordered.length){stopPreview();grid.replaceChildren(...ordered);}
    setText($('openWindowsCount'),ordered.length?String(ordered.length):'');
  }
  function windowFeedback(message){
    const feedback=$('openWindowsFeedback');cancel(windowFeedbackTimer);if(!feedback)return;
    feedback.hidden=!message;feedback.textContent=message||'';
    if(message)windowFeedbackTimer=timer(()=>{feedback.hidden=true;},4000);
  }
  function finishWindowClose(requestId,ok){
    const row=[...windows.values()].find(value=>value.closeRequest===requestId);if(!row)return;
    const release=()=>{row.closeRequest=null;row.closeTimer=null;row.close.disabled=false;};
    if(ok){
      // Windows may display a save dialog or the user may cancel. Keep the tile
      // until the native catalog actually reports that the window disappeared.
      row.closeTimer=timer(release,2000);
    }else{release();windowFeedback('Не удалось закрыть окно. Попробуй закрыть его в самом приложении.');}
  }
  function windowRow(item) {
    const element=document.createElement('div');element.className='desktop-window-tile';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'desktop-window';
    const close=document.createElement('button');close.type='button';close.className='desktop-window-close';close.textContent='×';close.title='Закрыть окно';
    const glyph = document.createElement('span'), label = document.createElement('span'); glyph.className = 'desktop-window-glyph'; label.className = 'desktop-window-label';
    button.append(glyph, label);
    button.addEventListener('pointerenter', () => startPreview(item.id, button));
    button.addEventListener('pointerleave', scheduleClose);
    button.addEventListener('click', () => { if (!permitted(button) || !windows.has(item.id)) return; stopPreview(); post('window-activate', {id: item.id}); });
    const row={element,button,close,label,icon:glyph,closeRequest:null,closeTimer:null};
    close.addEventListener('pointerenter',stopPreview);
    close.addEventListener('click',event=>{
      event.stopPropagation();if(row.closeRequest||windows.get(item.id)!==row||!permitted(close))return;
      stopPreview();const request=post('window-close',{id:item.id});
      if(request){row.closeRequest=request;close.disabled=true;windowFeedback('');}
    });
    element.append(button,close);return row;
  }
  const windowsMessages = {connecting: 'Подключение к Windows…', unavailable: 'Открытые окна доступны в WallpaperShell.', unsupported: 'Список окон недоступен в этой версии Windows.', error: 'Не удалось получить открытые окна. Приложение повторит попытку.'};
  function renderWindows(source) {
    windowStatus = clean(source?.status, 40) || 'unavailable';
    const ids = new Set(),order=[];
    if (ready(windowStatus) && Array.isArray(source.items)) for (const raw of source.items.slice(0, 128)) {
      const id = clean(raw?.id, 128); if (!id || ids.has(id)) continue; ids.add(id);order.push(id);
      const app = clean(raw.app, 100), title = clean(raw.title, 300) || app || 'Окно';
      let row = windows.get(id);
      if (!row) { row = windowRow({id}); windows.set(id, row); }
      setText(row.label,title);property(row.button,'title',(app && app !== title ? app + ' · ' + title : title)+(raw.minimized?' · Свёрнуто':''));
      attribute(row.button,'aria-label','Открыть окно: '+title);
      attribute(row.close,'aria-label','Закрыть окно: '+title);
      toggle(row.button,'is-minimized',raw.minimized===true);
      updateIcon(row, raw.icon, app, 'desktop-window-icon');
    }
    let focusNext=null;
    for (const [id, row] of windows) if (!ids.has(id)) {
      if(row.closeRequest&&document.activeElement===row.close&&permitted(grid)){const at=windowOrder.indexOf(id);focusNext=windows.get(windowOrder[at+1])?.close||windows.get(windowOrder[at-1])?.close||grid;}
      if (preview?.id === id) stopPreview();cancel(row.closeTimer);row.element.remove();windows.delete(id);
    }
    windowOrder=order;paintWindows();
    property(grid,'hidden',windows.size===0);property($('openWindowsStatus'),'hidden',windows.size>0);
    setText($('openWindowsStatus'),ready(windowStatus)?'Нет открытых окон.':windowsMessages[windowStatus]||'Список окон временно недоступен.');
    if(focusNext?.isConnected&&permitted(focusNext)){if(window.PGWindows)window.PGWindows.restoreFocus?.(focusNext,'done');else focusNext.focus({preventScroll:true});}
  }
  function syncNotificationActions(){const disabled=!!activationRequest||!!dismissRequest;for(const row of notifications.values()){property(row.open,'hidden',!row.canActivate);property(row.open,'disabled',disabled);property(row.dismiss,'disabled',disabled);toggle(row.element,'is-actionable',row.canActivate);property(row.viewport,'tabIndex',row.canActivate?-1:0);}}
  function notificationFeedback(message){
    const feedback=$('notificationsFeedback');cancel(feedbackTimer);if(!feedback)return;
    feedback.hidden=!message;feedback.textContent=message||'';
    if(message)feedbackTimer=timer(()=>{feedback.hidden=true;},4000);
  }
  function finishNotification(requestId,ok){
    if(activationRequest!==requestId)return;activationRequest=null;syncNotificationActions();
    notificationFeedback(ok?'':'Переход недоступен. Возможно, уведомление уже закрыто.');
  }
  function finishDismiss(requestId,ok){
    if(dismissRequest?.requestId!==requestId)return;
    const request=dismissRequest;dismissRequest=null;
    if(ok){
      notifications.get(request.id)?.element.remove();notifications.delete(request.id);
      notificationOrder=notificationOrder.filter(id=>id!==request.id);paintNotifications();queueMeasure();
      list.hidden=notifications.size===0;$('notificationsEmpty').hidden=!list.hidden;
      if(list.hidden&&ready(notificationStatus))$('notificationsStatus').textContent='Новых уведомлений нет.';
    }
    syncNotificationActions();notificationFeedback(ok?'':'Не удалось закрыть уведомление. Попробуй ещё раз.');
    if(ok&&request.restoreFocus&&permitted(list)&&(document.activeElement===document.body||document.activeElement===request.button)){
      const target=notifications.get(request.focusId)?.dismiss||notifications.values().next().value?.dismiss||list;
      if(window.PGWindows)window.PGWindows.restoreFocus?.(target,'done');else target.focus({preventScroll:true});
    }
  }
  function notificationRow(id) {
    const element = document.createElement('div'); element.className = 'desktop-notification'; element.setAttribute('role', 'listitem');
    const glyph = document.createElement('span'), copy = document.createElement('div'), heading = document.createElement('div'), sender = document.createElement('span'), app = document.createElement('span'), viewport = document.createElement('div'), track=document.createElement('div'),text = document.createElement('span'),duplicate=document.createElement('span');
    copy.className = 'desktop-notification-copy'; heading.className = 'desktop-notification-heading'; sender.className = 'desktop-notification-sender'; app.className = 'desktop-notification-app'; viewport.className = 'desktop-notification-viewport'; text.className = 'desktop-notification-text';
    viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Текст уведомления');
    track.className='desktop-notification-track';duplicate.className='desktop-notification-copy-text';duplicate.setAttribute('aria-hidden','true');duplicate.hidden=true;
    text.id='desktopNotificationText-'+(++notificationSequence);
    const open=document.createElement('button');open.type='button';open.className='desktop-notification-open';open.textContent='↗';open.hidden=true;open.setAttribute('aria-describedby',text.id);
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='desktop-notification-dismiss';dismiss.textContent='×';dismiss.title='Закрыть уведомление';dismiss.setAttribute('aria-label','Закрыть уведомление');
    const row={element,icon:glyph,sender,app,viewport,text,duplicate,open,dismiss,canActivate:false,metricKey:''};
    open.addEventListener('click',()=>{if(activationRequest||dismissRequest||!row.canActivate||notifications.get(id)!==row||!permitted(open))return;stopPreview();const request=post('notification-activate',{id});if(request){activationRequest=request;syncNotificationActions();notificationFeedback('');}});
    dismiss.addEventListener('click',event=>{
      event.stopPropagation();
      if(dismissRequest||activationRequest||notifications.get(id)!==row||!permitted(dismiss))return;
      stopPreview();const requestId=post('notification-dismiss',{id});
      if(requestId){const at=notificationOrder.indexOf(id);dismissRequest={requestId,id,button:dismiss,restoreFocus:document.activeElement===dismiss,focusId:notificationOrder[at+1]||notificationOrder[at-1]};syncNotificationActions();notificationFeedback('');}
    });
    heading.append(sender, app); track.append(text,duplicate);viewport.append(track);copy.append(heading, viewport); element.append(glyph, copy,open,dismiss);
    return row;
  }
  function paintNotifications(){
    const ordered=notificationOrder.map(id=>notifications.get(id).element);
    if(ordered.some((node,i)=>list.children[i]!==node)||list.children.length!==ordered.length){list.replaceChildren(...ordered);queueMeasure();}
  }
  const notificationMessages = {
    connecting: 'Подключение к Windows…',
    unavailable: 'Уведомления доступны в WallpaperShell.',
    'identity-required': 'Для уведомлений требуется однократная установка компонента приложения.',
    'not-requested': 'Разреши WallpaperShell читать уведомления Windows.',
    denied: 'Доступ к уведомлениям выключен в Windows.',
    unsupported: 'Эта версия Windows не поддерживает чтение уведомлений.',
    'not-supported': 'Эта версия Windows не поддерживает чтение уведомлений.',
    unknown: 'Разреши WallpaperShell читать уведомления Windows.',
    error: 'Не удалось получить уведомления Windows. Приложение повторит попытку.'
  };
  function renderNotifications(source) {
    const previousStatus = notificationStatus, locked = source?.detail === 'session-locked';
    notificationStatus = clean(source?.status, 40) || 'unavailable';
    const ids = new Set(), ordered = [];let measureDirty=false;
    if (!locked && ready(notificationStatus) && Array.isArray(source.items)) for (const raw of source.items.slice(0, 20)) {
      const id = clean(raw?.id, 128); if (!id || ids.has(id)) continue;
      const app = clean(raw.app, 100), sender = clean(raw.sender, 200), text = clean(raw.text, 4096);
      if (!text && !sender) continue;
      ids.add(id);
      let row = notifications.get(id);
      if (!row) { row = notificationRow(id); notifications.set(id, row);measureDirty=true; }
      const canActivate=raw.canActivate===true;if(row.canActivate!==canActivate){row.canActivate=canActivate;measureDirty=true;}
      attribute(row.open,'aria-label','Открыть уведомление: '+[app,sender].filter(Boolean).join(' · '));property(row.open,'title','Перейти к исходному сообщению');
      attribute(row.dismiss,'aria-label','Закрыть уведомление: '+[app,sender].filter(Boolean).join(' · '));
      if(setText(row.sender,sender||app||'Уведомление'))measureDirty=true;
      if(setText(row.app,sender?app:''))measureDirty=true;property(row.app,'hidden',!sender||!app);
      // Titles and messages are text only; they never enter storage/exports/logs.
      if (row.text.textContent !== text) { row.text.textContent = text;row.duplicate.textContent=text;row.viewport.title=text;row.metricKey='';measureDirty=true; }
      updateIcon(row, raw.icon, app, 'desktop-notification-icon'+(raw.portrait===true?' is-portrait':'')); ordered.push(id);
    }
    for (const [id, row] of notifications) if (!ids.has(id)) { row.element.remove(); notifications.delete(id);measureDirty=true; }
    // Preserve identical nodes and ticker progress when native refreshes its list.
    notificationOrder=ordered;syncNotificationActions();paintNotifications();
    property(list,'hidden',ordered.length===0);property($('notificationsEmpty'),'hidden',ordered.length>0);
    setText($('notificationsStatus'),locked?'Уведомления скрыты, пока Windows заблокирована.':ready(notificationStatus)?'Новых уведомлений нет.':notificationMessages[notificationStatus]||'Уведомления временно недоступны.');
    const access = $('notificationsAccess'), needsIdentity = notificationStatus === 'identity-required';
    const canRequest = notificationStatus === 'not-requested' || notificationStatus === 'unknown' && ['not-requested', 'permission-required'].includes(source?.detail);
    property(access,'hidden',locked||!(needsIdentity||canRequest||notificationStatus==='denied'));
    setText(access,needsIdentity?'Как подключить':notificationStatus==='denied'?'Открыть доступ в Windows':'Разрешить уведомления');
    if (previousStatus !== notificationStatus || !needsIdentity) { attribute(access,'aria-expanded','false');property($('notificationsSetup'),'hidden',true); }
    property(access,'disabled',[...pending.values()].some(request=>request.action==='notifications-access'||request.action==='notifications-settings'));
    if(measureDirty)queueMeasure();else syncMotion();
  }
  function syncMotion() {
    const state=window.PGWindows?.diagnostics?.();
    const stopped = motion?.matches || document.hidden || document.body.classList.contains('engine-paused') || editing || suspended || state?.blocked || state?.modal;
    if (list.classList.contains('is-paused') !== !!stopped) list.classList.toggle('is-paused', !!stopped);
    if (!permitted(grid)) stopPreview();
  }
  function measure() {
    measureFrame = null;
    const bounds=list.getBoundingClientRect();
    // Batch layout reads before writes; repeated identical feeds do not reach
    // this path, while scroll/resize/font/content changes still remeasure.
    const rows=[];for(const row of notifications.values())if(row.element.parentElement===list){const rect=row.element.getBoundingClientRect();rows.push({row,outside:rect.top+rect.height<=bounds.top||rect.top>=bounds.top+bounds.height,width:row.text.scrollWidth||0,available:row.viewport.clientWidth||0});}
    for (const {row,outside,width,available} of rows) {
      toggle(row.element,'is-outside',outside);
      const overflow = Math.max(0,width-available);
      const key=width+':'+available;
      if(key===row.metricKey)continue;row.metricKey=key;
      toggle(row.element,'has-overflow',overflow>2);
      property(row.duplicate,'hidden',overflow<=2);
      const travel=width+44;
      row.element.style.setProperty('--ticker-shift', -travel + 'px');
      row.element.style.setProperty('--ticker-duration', Math.max(4,travel/32) + 's');
    }
    syncMotion();
  }
  function queueMeasure() { if (!disposed && measureFrame === null) measureFrame = window.requestAnimationFrame(measure); }
  for(const node of [grid,list]){
    node.addEventListener('wheel',event=>{
      if(event.ctrlKey||!permitted(node)||!Number.isFinite(event.deltaY)||!event.deltaY)return;
      const max=Math.max(0,node.scrollHeight-node.clientHeight);
      if(!max)return;
      const unit=event.deltaMode===1?24:event.deltaMode===2?node.clientHeight:1;
      event.preventDefault();event.stopPropagation();stopPreview();
      node.scrollTop=Math.max(0,Math.min(max,node.scrollTop+event.deltaY*unit));
      if(node===list)queueMeasure();
    },{passive:false});
    node.addEventListener('scroll',()=>{stopPreview();if(node===list)queueMeasure();},{passive:true});
  }
  $('notificationsAccess').addEventListener('click', () => {
    const button = $('notificationsAccess'); if (!permitted(button)) return; stopPreview();
    if (notificationStatus === 'identity-required') { const help = $('notificationsSetup'); help.hidden = !help.hidden; button.setAttribute('aria-expanded', String(!help.hidden)); return; }
    if (post(notificationStatus === 'denied' ? 'notifications-settings' : 'notifications-access')) button.disabled = true;
  });
  bridge?.addEventListener('message', event => {
    if (disposed) return;
    const frame = event.data;
    if (frame?.type === 'desktop-hub') { if (frame.windows) renderWindows(frame.windows); if (frame.notifications) renderNotifications(frame.notifications); }
    else if (frame?.type === 'desktop-hub-result') {
      const request = pending.get(frame.requestId); if (!request) return;
      cancel(request.timeout); pending.delete(frame.requestId);
      if (request.action === 'notifications-access' || request.action === 'notifications-settings') $('notificationsAccess').disabled = false;
      if(request.action==='notification-activate')finishNotification(frame.requestId,frame.ok===true);
      if(request.action==='notification-dismiss')finishDismiss(frame.requestId,frame.ok===true);
      if(request.action==='window-close')finishWindowClose(frame.requestId,frame.ok===true);
      if(request.action==='start-menu')finishStartMenu(frame.requestId,frame.ok===true);
    }
  });
  window.addEventListener('pg:window-policy', event => {
    const action = event.detail?.event;
    if (action === 'suspend') suspended = true;
    if (action === 'resume') suspended = false;
    if (['external', 'suspend', 'reset', 'modal-state', 'panel-close'].includes(action)) stopPreview();
    syncMotion();
  });
  window.addEventListener('paper:layout-editing', event => { editing = event.detail?.editing === true; stopPreview(); syncMotion(); });
  window.addEventListener('resize', () => { stopPreview(); queueMeasure(); });
  window.addEventListener('blur', stopPreview);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPreview(); syncMotion(); });
  motion?.addEventListener?.('change',syncMotion);
  document.fonts?.ready?.then(queueMeasure);document.fonts?.addEventListener?.('loadingdone',queueMeasure);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(queueMeasure).observe(list);
  if (typeof MutationObserver !== 'undefined') new MutationObserver(records => {
    if (records.some(record => record.target === document.body || record.target.id === 'settings' || record.target.id === 'themePicker' || record.target.dataset?.widget === 'openwindows')) syncMotion();
  }).observe(document.body, {attributes: true, subtree: true, attributeFilter: ['class', 'hidden', 'inert']});
  window.addEventListener('pagehide', () => {
    stopPreview(); disposed = true; if (measureFrame !== null) window.cancelAnimationFrame(measureFrame);
    for (const request of pending.values()) cancel(request.timeout); pending.clear();
    for(const row of windows.values())cancel(row.closeTimer);
    grid.replaceChildren(); list.replaceChildren(); windows.clear(); notifications.clear();
    windowOrder=[];notificationOrder=[];
    activationRequest=null;dismissRequest=null;startRequest=null;cancel(feedbackTimer);if($('notificationsFeedback'))$('notificationsFeedback').hidden=true;
    cancel(windowFeedbackTimer);if($('openWindowsFeedback'))$('openWindowsFeedback').hidden=true;
  });
  renderWindows({status: windowStatus}); renderNotifications({status: notificationStatus});
  function tickerCounts(){let notificationTickers=0,activeNotificationTickers=0;const active=!disposed&&!list.hidden&&panelVisible(list)&&!list.classList.contains('is-paused')&&!document.body.classList.contains('motion-off');for(const row of notifications.values())if(row.element.classList.contains('has-overflow')){notificationTickers++;if(active&&!row.element.classList.contains('is-outside'))activeNotificationTickers++;}return {notificationTickers,activeNotificationTickers};}
  // Deliberately counts/status only: private titles, senders and text stay in DOM.
  window.PGDesktopHub = {openStartMenu,diagnostics: () => ({mounted: !disposed,startMenuMounted:!!$('startToggle'),appearanceShortcut:!!document.querySelector('.theme-toggle'),windowStatus, windowCount: windows.size,windowRendered:grid.children.length,windowColumns,windowRows:Math.ceil(windowOrder.length/windowColumns),windowCloseMounted:true,notificationStatus, notificationCount: notifications.size,notificationRendered:list.children.length,scrolling:true,notificationActivationMounted:true,notificationDismissalMounted:true,actionableNotifications:[...notifications.values()].filter(row=>row.canActivate).length,...tickerCounts()})};
})();
