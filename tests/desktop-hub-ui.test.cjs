'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const {createDOMFixture} = require('./helpers/editor-dom.cjs');

// Executes the shipped controller with a native bridge double. No OS windows,
// consent dialogs, private Windows notifications, or desktop input are used.
function setup({theme = 'paper-green', native = true} = {}) {
  const f = createDOMFixture({theme}); f.document.body.dataset.theme = theme; f.document.hidden = false;
  f.document.getElementById('themeToggle').remove();f.create('startToggle','button',f.stage).className='start-toggle';
  const windowsPanel = f.create('hubWindows', 'section', f.stage), notificationsPanel = f.create('hubNotifications', 'section', f.stage);
  windowsPanel.dataset.widget = 'openwindows'; notificationsPanel.dataset.widget = 'notifications';
  for (const [id, tag] of [['openWindowsGrid', 'div'], ['openWindowsCount', 'small'], ['openWindowsStatus', 'p'], ['openWindowsFeedback','p']]) f.create(id, tag, windowsPanel);
  for (const [id, tag] of [['notificationsList', 'div'], ['notificationsFeedback','p']]) f.create(id, tag, notificationsPanel);
  const empty = f.create('notificationsEmpty', 'div', notificationsPanel);
  for (const [id, tag] of [['notificationsStatus', 'p'], ['notificationsAccess', 'button'], ['notificationsSetup', 'p']]) f.create(id, tag, empty);
  f.document.getElementById('notificationsSetup').hidden = true;
  const bridge = new f.window.constructor(), reducedMotion = new f.window.constructor(); reducedMotion.matches = false;
  const requests = []; bridge.postMessage = message => requests.push(message);
  if (native) f.window.chrome = {webview: bridge};
  let seq = 0, now = 0, timer = 0; const timers = new Map(), policy = {};
  Object.assign(f.window, {
    crypto: {randomUUID: () => '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0')},
    matchMedia: () => reducedMotion,
    setTimeout: (fn, delay) => { const id = ++timer; timers.set(id, {fn, at: now + delay}); return id; },
    clearTimeout: id => timers.delete(id),
    PGWindows: {canInteract: () => !policy.blocked && !policy.modal, diagnostics: () => policy},
    localStorage: {getItem() { throw Error('Private hub data must not read storage'); }, setItem() { throw Error('Private hub data must not write storage'); }}
  });
  f.load('desktop-hub.js');
  function advance(ms) { now += ms; for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.fn(); } }
  const frame = value => f.fire(bridge, 'message', {data: {type: 'desktop-hub', ...value}});
  const node = id => f.document.getElementById(id);
  return {...f, frame, node, requests, advance, policy, reducedMotion, bridge, windowsPanel, notificationsPanel};
}
const windowItem = (id = 'window-1', title = 'Browser document') => ({id, title, app: 'Browser', minimized: false});
const notification = (id = 'n1', text = 'A real source message') => ({id, app: 'Telegram', sender: 'Sender', text, at: '2026-10-20T12:00:00Z'});
const actions = f => f.requests.map(request => request.action);

test('sender portraits are circular, keep their row on refresh and fall back to the application icon',()=>{
 const f=setup({theme:'luna-blue'}),pixels='data:image/png;base64,c3ludGhldGlj';
 const item={...notification(),icon:pixels,portrait:true};f.frame({notifications:{status:'enabled',items:[item]}});
 const row=f.node('notificationsList').children[0];let icon=row.querySelector('.desktop-notification-icon');
 assert(icon.classList.contains('is-portrait'));assert.equal(icon.querySelector('img').src,pixels);
 f.frame({notifications:{status:'enabled',items:[item]}});assert.equal(f.node('notificationsList').children[0],row);assert.equal(row.querySelector('.desktop-notification-icon'),icon);
 f.frame({notifications:{status:'enabled',items:[{...item,portrait:false}]}});icon=row.querySelector('.desktop-notification-icon');
 assert(!icon.classList.contains('is-portrait'),'A shape change updates even when encoded pixels happen to be the same');assert.equal(f.node('notificationsList').children[0],row);
 f.frame({notifications:{status:'enabled',items:[notification()]}});assert.equal(row.querySelector('img'),null);assert.equal(row.querySelector('.desktop-notification-icon').textContent,'T');
});

test('Start is an explicit argument-free request and recovers after a response or timeout',()=>{
 const f=setup(),button=f.node('startToggle');assert.equal(f.requests.length,0);assert.equal(f.window.PGDesktopHub.diagnostics().appearanceShortcut,false);
 assert.equal(f.window.PGDesktopHub.openStartMenu(),true);const request=f.requests[0];assert.equal(request.action,'start-menu');assert.deepEqual(Object.keys(request).sort(),['action','requestId','type']);assert.equal(button.disabled,true);assert.equal(f.window.PGDesktopHub.openStartMenu(),false);
 f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId:request.requestId,ok:true}});assert.equal(button.disabled,false);assert.equal(button.title,'Пуск');
 assert.equal(f.window.PGDesktopHub.openStartMenu(),true);f.advance(8001);assert.equal(button.disabled,false);assert.match(button.title,/Не удалось/);
});
test('Start respects modal, panel, editor, privacy and missing native bridge guards',()=>{
 const f=setup();for(const state of [{modal:'power'},{activePanel:'settings'},{pendingPanel:'settings'},{suspended:true}]){Object.assign(f.policy,state);assert.equal(f.window.PGDesktopHub.openStartMenu(),false);for(const key of Object.keys(state))delete f.policy[key];}
 f.fire(f.window,'paper:layout-editing',{detail:{editing:true}});assert.equal(f.window.PGDesktopHub.openStartMenu(),false);f.fire(f.window,'paper:layout-editing',{detail:{editing:false}});f.document.hidden=true;assert.equal(f.window.PGDesktopHub.openStartMenu(),false);assert.equal(f.requests.length,0);
 const offline=setup({native:false});assert.equal(offline.window.PGDesktopHub.openStartMenu(),false);
});

test('window close has a separate ID-only button and waits for actual native removal rather than the close acknowledgment',()=>{
 const f=setup();f.frame({windows:{status:'ok',items:[windowItem('one'),windowItem('two')]}});
 const grid=f.node('openWindowsGrid'),tile=grid.children[0],button=tile.querySelector('.desktop-window'),close=tile.querySelector('.desktop-window-close');
 f.fire(button,'pointerenter');f.fire(close,'pointerenter');f.advance(200);assert.equal(actions(f).includes('window-preview'),false,'Moving to close cancels a pending hover preview');
 f.fire(close,'click');const request=f.requests.at(-1);assert.equal(request.action,'window-close');assert.equal(request.id,'one');assert.deepEqual(Object.keys(request).sort(),['action','id','requestId','type']);assert.equal(close.disabled,true);
 f.fire(close,'click');assert.equal(actions(f).filter(action=>action==='window-close').length,1);f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId:request.requestId,ok:true}});assert.equal(grid.children.length,2,'An application may keep its window open for saving or cancellation');
 f.advance(2001);assert.equal(close.disabled,false);assert.equal(grid.children[0],tile,'Canceling a native save prompt leaves the tile usable');
 f.fire(close,'click');f.frame({windows:{status:'ok',items:[windowItem('two')]}});assert.equal(grid.children.length,1);assert.equal(grid.children[0].querySelector('.desktop-window-close').getAttribute('aria-label'),'Закрыть окно: Browser document');
 const count=f.requests.length;f.fire(close,'click');assert.equal(f.requests.length,count,'A removed tile cannot close a new window');assert.equal(actions(f).includes('window-activate'),false);
});

test('window close is blocked by editor/modal/suspension; error and timeout permit retry without hiding the window',()=>{
 const f=setup();f.frame({windows:{status:'ok',items:[windowItem()]}});const close=f.node('openWindowsGrid').querySelector('.desktop-window-close');
 f.policy.modal='power';f.fire(close,'click');delete f.policy.modal;f.fire(f.window,'paper:layout-editing',{detail:{editing:true}});f.fire(close,'click');f.fire(f.window,'paper:layout-editing',{detail:{editing:false}});
 f.fire(f.window,'pg:window-policy',{detail:{event:'suspend'}});f.fire(close,'click');f.fire(f.window,'pg:window-policy',{detail:{event:'resume'}});assert.equal(f.requests.length,0);
 f.fire(close,'click');f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId:f.requests.at(-1).requestId,ok:false}});assert.equal(close.disabled,false);assert.equal(f.node('openWindowsFeedback').hidden,false);assert.equal(f.node('openWindowsGrid').children.length,1);
 f.fire(close,'click');f.advance(8001);assert.equal(close.disabled,false);assert.equal(f.node('openWindowsGrid').children.length,1);
});

test('close is an independent ID-only action; success removes the row and moves its successor up',()=>{
 const f=setup(),items=[{...notification('one'),canActivate:true},notification('two'),notification('three')];f.frame({notifications:{status:'enabled',items}});
 const list=f.node('notificationsList'),[one,two]=list.children,close=one.querySelector('.desktop-notification-dismiss');
 assert.equal(close.hidden,false);assert.equal(f.requests.length,0);f.fire(close,'click');assert.equal(actions(f).at(-1),'notification-dismiss');assert.deepEqual(Object.keys(f.requests.at(-1)).sort(),['action','id','requestId','type']);assert.equal(f.requests.at(-1).id,'one');
 assert.equal(list.children.length,3,'Do not claim removal before native confirms it');assert.equal(close.disabled,true);f.fire(close,'click');f.fire(one.querySelector('.desktop-notification-open'),'click');assert.equal(f.requests.length,1);
 f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId:f.requests[0].requestId,ok:true}});assert.equal(list.children.length,2);assert.equal(list.children[0],two);assert.equal(f.window.PGDesktopHub.diagnostics().notificationCount,2);assert.equal(actions(f).includes('notification-activate'),false);
 f.fire(close,'click');assert.equal(f.requests.length,1,'A stale removed button cannot close anything');
});

test('close obeys lifecycle guards and failures/timeouts preserve the notification for retry',()=>{
 const f=setup();f.frame({notifications:{status:'enabled',items:[notification()]}});const list=f.node('notificationsList'),close=list.children[0].querySelector('.desktop-notification-dismiss');
 f.policy.modal='settings';f.fire(close,'click');delete f.policy.modal;
 f.fire(f.window,'paper:layout-editing',{detail:{editing:true}});f.fire(close,'click');f.fire(f.window,'paper:layout-editing',{detail:{editing:false}});
 f.fire(f.window,'pg:window-policy',{detail:{event:'suspend'}});f.fire(close,'click');f.fire(f.window,'pg:window-policy',{detail:{event:'resume'}});assert.equal(f.requests.length,0);
 f.fire(close,'click');f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId:f.requests[0].requestId,ok:false}});assert.equal(close.disabled,false);assert.equal(list.children.length,1);assert.match(f.node('notificationsFeedback').textContent,/Не удалось закрыть/);
 f.fire(close,'click');f.advance(8001);assert.equal(close.disabled,false);assert.equal(list.children.length,1);assert.equal(f.requests.length,2);
});

test('a native frame before close confirmation preserves the successor and keyboard focus; the last row reveals the empty state',()=>{
 const f=setup(),items=[notification('one'),notification('two')];f.window.PGWindows.restoreFocus=target=>target.focus();f.frame({notifications:{status:'enabled',items}});
 const list=f.node('notificationsList'),[one,two]=list.children,close=one.querySelector('.desktop-notification-dismiss');close.focus();f.fire(close,'click');const requestId=f.requests.at(-1).requestId;
 f.frame({notifications:{status:'enabled',items:items.slice(1)}});f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId,ok:true}});assert.equal(list.children[0],two);assert.equal(f.document.activeElement,two.querySelector('.desktop-notification-dismiss'));
 f.fire(two.querySelector('.desktop-notification-dismiss'),'click');f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId:f.requests.at(-1).requestId,ok:true}});assert.equal(list.hidden,true);assert.equal(f.node('notificationsEmpty').hidden,false);assert.match(f.node('notificationsStatus').textContent,/Новых уведомлений нет/);
});

test('notification navigation requires an explicit click on a native actionable row and sends only its ID',()=>{
 const f=setup();f.frame({notifications:{status:'enabled',items:[{...notification('linked'),canActivate:true},notification('inert')]}});
 const [linked,inert]=f.node('notificationsList').children,button=linked.querySelector('.desktop-notification-open');assert.equal(button.hidden,false);assert.equal(inert.querySelector('.desktop-notification-open').hidden,true);
 f.fire(linked,'pointerenter');assert.equal(f.requests.length,0);f.fire(button,'click');assert.equal(actions(f).at(-1),'notification-activate');assert.deepEqual(Object.keys(f.requests.at(-1)).sort(),['action','id','requestId','type']);assert.equal(f.requests.at(-1).id,'linked');assert.equal(button.disabled,true);
 f.fire(button,'click');assert.equal(f.requests.length,1);f.fire(f.bridge,'message',{data:{type:'desktop-hub-result',requestId:f.requests.at(-1).requestId,ok:true}});assert.equal(button.disabled,false);
 f.frame({notifications:{status:'enabled',items:[]}});f.fire(button,'click');assert.equal(f.requests.length,1);
});

test('notification links are revoked with source capability, guarded in modal/editor, and timeouts recover without leaking targets',()=>{
 const f=setup(),item={...notification(),canActivate:true};f.frame({notifications:{status:'enabled',items:[item]}});const button=f.node('notificationsList').children[0].querySelector('.desktop-notification-open');
 f.policy.blocked=true;f.fire(button,'click');assert.equal(f.requests.length,0);f.policy.blocked=false;
 f.frame({notifications:{status:'enabled',items:[{...item,canActivate:'true'}]}});f.fire(button,'click');assert.equal(f.requests.length,0);assert.equal(button.hidden,true);
 f.frame({notifications:{status:'enabled',items:[item]}});f.fire(button,'click');f.advance(8001);assert.equal(button.disabled,false);assert.equal(f.node('notificationsFeedback').hidden,false);assert(!f.node('notificationsFeedback').textContent.includes('Sender'));
 f.frame({notifications:{status:'denied',items:[item]}});f.fire(button,'click');assert.equal(f.requests.length,1);
});

test('native hover is delayed, normalized, cancellable, and click activates only an existing window', () => {
  const f = setup(); f.frame({windows: {status: 'ok', items: [windowItem(), windowItem('window-2')]}});
  const [one, two] = [...f.node('openWindowsGrid').children].map(node=>node.querySelector('.desktop-window'));
  one.rect = {left: 800, top: 900, width: 100, height: 60}; two.rect = one.rect;
  f.fire(one, 'pointerenter'); f.advance(100); assert.deepEqual(actions(f), []);
  f.fire(two, 'pointerenter'); f.advance(180);
  const request = f.requests.find(value => value.action === 'window-preview');
  assert.equal(request.id, 'window-2'); assert.match(request.requestId, /^[\da-f-]{36}$/);
  assert.deepEqual(Array.from(request.rect), [800 / f.window.innerWidth, 900 / f.window.innerHeight, 900 / f.window.innerWidth, 960 / f.window.innerHeight]);
  assert.equal(actions(f).filter(action => action === 'window-activate').length, 0);
  f.fire(two, 'pointerleave'); f.advance(120); assert.equal(actions(f).at(-1), 'window-preview-close');
  f.fire(two, 'click'); assert.equal(f.requests.at(-1).action, 'window-activate'); assert.equal(f.requests.at(-1).id, 'window-2');
  f.frame({windows: {status: 'ok', items: []}}); f.fire(two, 'click'); assert.equal(actions(f).filter(action => action === 'window-activate').length, 1);
  assert.equal(f.node('openWindowsGrid').hidden, true);
});

test('editor, modal, panel, visibility and suspension cancel preview and guard commands', () => {
  const f = setup(); f.frame({windows: {status: 'ok', items: [windowItem()]}}); const button = f.node('openWindowsGrid').children[0].querySelector('.desktop-window');
  f.fire(button, 'pointerenter'); f.fire(f.window, 'paper:layout-editing', {detail: {editing: true}}); f.advance(500); f.fire(button, 'click');
  assert.equal(actions(f).includes('window-preview'), false); assert.equal(actions(f).includes('window-activate'), false);
  f.fire(f.window, 'paper:layout-editing', {detail: {editing: false}});
  for (const state of [{modal: 'power'}, {blocked: true}, {activePanel: 'settings'}, {pendingPanel: 'theme'}]) {
    Object.assign(f.policy, state); f.fire(button, 'pointerenter'); f.advance(200); f.fire(button, 'click');
    assert.equal(actions(f).includes('window-preview'), false); assert.equal(actions(f).includes('window-activate'), false);
    for (const key of Object.keys(state)) delete f.policy[key];
  }
  f.fire(f.window, 'pg:window-policy', {detail: {event: 'suspend'}}); f.fire(button, 'click'); assert.equal(actions(f).includes('window-activate'), false);
  f.fire(f.window, 'pg:window-policy', {detail: {event: 'resume'}}); f.fire(button, 'pointerenter'); f.advance(180); assert.equal(actions(f).at(-1), 'window-preview');
  f.document.hidden = true; f.fire(f.document, 'visibilitychange'); assert.equal(actions(f).at(-1), 'window-preview-close');
  f.fire(button, 'click'); assert.equal(actions(f).includes('window-activate'), false);
});

test('external transition cancels stale hover, later visible hover is checked by native again', () => {
  const f = setup(); f.frame({windows: {status: 'ok', items: [windowItem()]}}); const button = f.node('openWindowsGrid').children[0].querySelector('.desktop-window');
  f.fire(button, 'pointerenter'); f.fire(f.window, 'pg:window-policy', {detail: {event: 'external'}}); f.advance(300);
  assert.equal(actions(f).includes('window-preview'), false);
  f.fire(button, 'pointerenter'); f.advance(180); assert.equal(actions(f).at(-1), 'window-preview');
  f.frame({windows: {status: 'unavailable', items: []}}); assert.equal(actions(f).at(-1), 'window-preview-close');
});

test('notification access requires an explicit action and identity help never opens an unrelated OS setting', () => {
  const f = setup(); f.frame({notifications: {status: 'identity-required', detail: 'identity-required', items: []}});
  assert.equal(f.requests.length, 0); assert.equal(f.node('notificationsSettings'), null);
  f.fire(f.node('notificationsAccess'), 'click'); assert.equal(f.requests.length, 0); assert.equal(f.node('notificationsSetup').hidden, false);
  f.frame({notifications: {status: 'identity-required', items: []}}); assert.equal(f.node('notificationsSetup').hidden, false);
  f.frame({notifications: {status: 'unknown', detail: 'not-requested', items: []}});
  assert.equal(f.node('notificationsAccess').hidden, false); f.fire(f.node('notificationsAccess'), 'click'); assert.equal(actions(f).at(-1), 'notifications-access');
  assert.equal(f.node('notificationsAccess').disabled, true);
  f.frame({notifications: {status: 'unknown', detail: 'permission-required', items: []}}); assert.equal(f.node('notificationsAccess').disabled, true);
  f.fire(f.bridge, 'message', {data: {type: 'desktop-hub-result', requestId: f.requests.at(-1).requestId, ok: true}}); assert.equal(f.node('notificationsAccess').disabled, false);
  f.frame({notifications: {status: 'denied', items: []}}); f.fire(f.node('notificationsAccess'), 'click'); assert.equal(actions(f).at(-1), 'notifications-settings');
});

test('content stays literal, only local raster icons load, refreshed nodes preserve ticker progress, diagnostics omit private text', () => {
  const f = setup(), payload = '<img src=x onerror=steal()> private message';
  const item = {...notification('n1', payload), icon: 'https://remote.invalid/tracker.png'};
  f.frame({windows: {status: 'ok', items: [windowItem('one', '<svg onload=attack()>')]}, notifications: {status: 'enabled', items: [item]}});
  const row = f.node('notificationsList').children[0], text = row.querySelector('.desktop-notification-text');
  assert.equal(text.textContent, payload); assert.equal(row.querySelector('img'), null);
  assert.equal(f.node('openWindowsGrid').querySelector('.desktop-window-label').textContent, '<svg onload=attack()>');
  f.frame({notifications: {status: 'enabled', items: [item]}}); assert.equal(f.node('notificationsList').children[0], row);
  const diagnostic = JSON.stringify(f.window.PGDesktopHub.diagnostics()); assert(!diagnostic.includes('private')); assert(!diagnostic.includes('Sender')); assert(!diagnostic.includes('Browser'));
  assert.equal(f.window.PGDesktopHub.diagnostics().notificationCount, 1);
  f.frame({notifications: {status: 'enabled', detail: 'session-locked', items: [item]}}); assert.equal(f.node('notificationsList').children.length, 0); assert.match(f.node('notificationsStatus').textContent, /заблокирована/);
});

test('ticker runs only for overflow and pauses on reduced motion, hidden page or engine pause', () => {
  const f = setup(); f.frame({notifications: {status: 'enabled', items: [notification()]}});
  const row = f.node('notificationsList').children[0], text = row.querySelector('.desktop-notification-text'), viewport = row.querySelector('.desktop-notification-viewport');
  text.scrollWidth = 400; viewport.clientWidth = 180; f.flushFrames();
  assert.equal(row.classList.contains('has-overflow'), true); assert.equal(row.style['--ticker-shift'], '-444px');
  f.reducedMotion.matches = true; f.fire(f.reducedMotion, 'change'); assert.equal(f.node('notificationsList').classList.contains('is-paused'), true);
  f.reducedMotion.matches = false; f.fire(f.reducedMotion, 'change'); assert.equal(f.node('notificationsList').classList.contains('is-paused'), false);
  f.document.body.classList.add('engine-paused'); f.fire(f.document, 'visibilitychange'); assert.equal(f.node('notificationsList').classList.contains('is-paused'), true);
  f.document.body.classList.remove('engine-paused'); f.document.hidden = true; f.fire(f.document, 'visibilitychange'); assert.equal(f.node('notificationsList').classList.contains('is-paused'), true);
  f.document.hidden = false; text.scrollWidth = 100; f.fire(f.window, 'resize'); f.flushFrames(); assert.equal(row.classList.contains('has-overflow'), false);
});

test('non-App source remains truthful and cleanup stops late messages without touching Classic', () => {
  const offline = setup({native: false}); assert.match(offline.node('openWindowsStatus').textContent, /WallpaperShell/); assert.equal(offline.node('openWindowsGrid').children.length, 0);
  const classic = setup({theme: 'classic'}); assert.equal(classic.window.PGDesktopHub, undefined); assert.equal(classic.requests.length, 0);
  const f = setup(); f.frame({windows: {status: 'ok', items: [windowItem()]}, notifications: {status: 'enabled', items: [notification()]}});
  f.fire(f.node('openWindowsGrid').children[0].querySelector('.desktop-window'), 'pointerenter'); f.fire(f.window, 'pagehide'); f.advance(200); f.flushFrames();
  f.frame({windows: {status: 'ok', items: [windowItem()]}}); assert.equal(f.node('openWindowsGrid').children.length, 0); assert.equal(f.window.PGDesktopHub.diagnostics().mounted, false); assert.equal(f.node('notificationsList').children.length, 0);
  assert.equal(actions(f).includes('window-preview'), false);
});
test('all windows stay mounted in source order and scrolling cancels pending or shown native previews',()=>{
 const f=setup(),items=Array.from({length:13},(_,i)=>windowItem('w'+i,'Window '+i));f.frame({windows:{status:'ok',items}});
 const grid=f.node('openWindowsGrid');assert.equal(grid.children.length,13);assert.equal(f.node('openWindowsCount').textContent,'13');assert.equal(f.window.PGDesktopHub.diagnostics().windowRows,3);
 const first=grid.children[0],firstButton=first.querySelector('.desktop-window');firstButton.rect={left:800,top:900,width:100,height:60};Object.assign(grid,{scrollHeight:256,clientHeight:180,scrollTop:0});
 f.fire(firstButton,'pointerenter');f.fire(grid,'wheel',{deltaY:88,deltaMode:0});f.advance(180);assert.equal(actions(f).includes('window-preview'),false);
 assert.equal(grid.scrollTop,76);f.fire(firstButton,'pointerenter');f.advance(180);assert.equal(actions(f).at(-1),'window-preview');f.fire(grid,'scroll');assert.equal(actions(f).at(-1),'window-preview-close');
 f.frame({windows:{status:'ok',items}});assert.equal(grid.children[0],first);assert.equal(grid.scrollTop,76);assert.equal(grid.children[5].querySelector('.desktop-window-label').textContent,'Window 5');
 f.frame({windows:{status:'ok',items:items.slice(0,2)}});assert.equal(grid.children.length,2);assert.equal(f.window.PGDesktopHub.diagnostics().windowRows,1);
});
test('notification wheel scrolling reaches every row, respects policy and units, and refresh preserves nodes and position',()=>{
 const f=setup(),items=Array.from({length:8},(_,i)=>notification('n'+i,'Message '+i));f.frame({notifications:{status:'enabled',items}});
 const list=f.node('notificationsList');Object.assign(list,{scrollHeight:480,clientHeight:180,scrollTop:0});const row=list.children[0];assert.equal(list.children.length,8);assert.equal(f.window.PGDesktopHub.diagnostics().notificationRendered,8);
 const wheel=(deltaY,deltaMode=0,extra={})=>f.fire(list,'wheel',{deltaY,deltaMode,...extra});
 assert.equal(wheel(120).defaultPrevented,true);assert.equal(list.scrollTop,120);wheel(2,1);assert.equal(list.scrollTop,168);wheel(1,2);assert.equal(list.scrollTop,300);
 wheel(-1,2);assert.equal(list.scrollTop,120);wheel(90,0,{ctrlKey:true});assert.equal(list.scrollTop,120);
 f.policy.blocked=true;wheel(90);assert.equal(list.scrollTop,120);f.policy.blocked=false;
 f.frame({notifications:{status:'enabled',items}});assert.equal(list.children[0],row);assert.equal(list.scrollTop,120);assert.equal(f.requests.length,0);
 wheel(-1000);assert.equal(list.scrollTop,0);f.frame({notifications:{status:'enabled',items:items.slice(0,1)}});assert.equal(list.children.length,1);
});
test('ticker is independent of scene motion, pauses outside the viewport, and the duplicate is inaccessible',()=>{
 const f=setup();f.frame({notifications:{status:'enabled',items:[notification()]}});const row=f.node('notificationsList').children[0];row.querySelector('.desktop-notification-text').scrollWidth=400;row.querySelector('.desktop-notification-viewport').clientWidth=180;f.flushFrames();
 const duplicate=row.querySelector('.desktop-notification-copy-text');assert.equal(duplicate.hidden,false);assert.equal(duplicate.getAttribute('aria-hidden'),'true');assert.equal(duplicate.textContent,'A real source message');
 assert.equal(f.window.PGDesktopHub.diagnostics().notificationTickers,1);assert.equal(f.window.PGDesktopHub.diagnostics().activeNotificationTickers,1);
 f.document.body.classList.add('motion-off');f.fire(f.document,'visibilitychange');assert.equal(f.node('notificationsList').classList.contains('is-paused'),false);
 f.node('notificationsList').rect={top:40,height:180};row.rect={top:220,height:60};f.fire(f.node('notificationsList'),'scroll');f.flushFrames();assert.equal(row.classList.contains('is-outside'),true);
 assert.equal(f.window.PGDesktopHub.diagnostics().activeNotificationTickers,0);
 row.rect={top:40,height:60};f.fire(f.node('notificationsList'),'scroll');f.flushFrames();assert.equal(row.classList.contains('is-outside'),false);
 f.reducedMotion.matches=true;f.fire(f.reducedMotion,'change');assert.equal(f.node('notificationsList').classList.contains('is-paused'),true);
 assert.equal(f.window.PGDesktopHub.diagnostics().activeNotificationTickers,0);
 f.policy.blocked=true;f.fire(f.window,'pg:window-policy',{detail:{event:'modal-state'}});assert.equal(f.node('notificationsList').classList.contains('is-paused'),true);
});

test('identical native feeds do not rewrite DOM or schedule notification layout work',()=>{
 const f=setup({theme:'luna-blue'}),feed={windows:{status:'ok',items:[windowItem()]},notifications:{status:'enabled',items:[notification()]}};
 f.frame(feed);f.flushFrames();let writes=0,reads=0;
 for(const node of [f.document.body,...f.document.body.querySelectorAll('*')]){
  for(const key of ['textContent','hidden','disabled','title','tabIndex']){let value=node[key];Object.defineProperty(node,key,{configurable:true,get:()=>value,set:next=>{writes++;value=next;}});}
  const attr=node.setAttribute.bind(node);node.setAttribute=(...args)=>{writes++;return attr(...args);};
  const toggle=node.classList.toggle.bind(node.classList);node.classList.toggle=(...args)=>{writes++;return toggle(...args);};
  const rect=node.getBoundingClientRect.bind(node);node.getBoundingClientRect=()=>{reads++;return rect();};
 }
 for(let i=0;i<100;i++)f.frame(feed);
 assert.equal(writes,0);assert.equal(reads,0);assert.equal(f.pendingFrames(),0);
 f.frame({...feed,notifications:{status:'enabled',items:[notification('n1','A changed message')]}});
 assert(writes>0);assert.equal(f.pendingFrames(),1);f.flushFrames();assert(reads>0);
 f.frame({notifications:{status:'enabled',items:[]}});assert.equal(f.pendingFrames(),1,'Removal must update scroll visibility even if remaining DOM order already matches');f.flushFrames();
});

test('notification measurements batch every layout read before writing ticker geometry',()=>{
 const f=setup(),items=[notification('one'),notification('two')];f.frame({notifications:{status:'enabled',items}});
 const order=[],list=f.node('notificationsList');
 for(const row of list.children){
  const text=row.querySelector('.desktop-notification-text'),viewport=row.querySelector('.desktop-notification-viewport');
  Object.defineProperty(text,'scrollWidth',{get(){order.push('read');return 400;}});Object.defineProperty(viewport,'clientWidth',{get(){order.push('read');return 180;}});
  const write=row.style.setProperty.bind(row.style);row.style.setProperty=(...args)=>{order.push('write');return write(...args);};
 }
 f.flushFrames();assert(order.includes('write'));assert(order.lastIndexOf('read')<order.indexOf('write'));
});
