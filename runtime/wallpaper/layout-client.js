(function(root,factory){const M=typeof module==='object'&&module.exports?require('./widget-model.js'):root.PGWidgetModel;const api=factory(M);if(typeof module==='object'&&module.exports)module.exports=api;else root.PGLayoutClient=api;})(typeof globalThis!=='undefined'?globalThis:this,function(M){
 'use strict';
 function createSession({theme,profile,storage,request,legacy={}}){
  M.scope(theme,profile);const cacheKey='paper-green-app-layout-model-v1:'+theme+':'+profile;
  let seed=M.migrate(theme,profile,legacy.positions,legacy.launcher),confirmed=null,pending=[],current=seed,status='loading',running=null,cacheSaved=false,draft=null,historyError='';
  const listeners=new Set(),undoStack=[],redoStack=[],outcomes=new Map(),fields=['x','y','scale','visible'],historyLimit=50;
  const operation=(doc,op)=>op.reset?M.create(theme,profile):M.patch(doc,op.changes);
  const checked=doc=>{const clean=M.validate(doc);if(clean.theme!==theme||clean.profile!==profile)throw Error('Unexpected layout scope');return clean;};
  const history=()=>({canUndo:undoStack.length>0,canRedo:redoStack.length>0,undoCount:undoStack.length,redoCount:redoStack.length});
  const view=()=>M.clone(draft?M.patch(current,draft):current);
  const snapshot=()=>({document:view(),status,pending:pending.length,history:history(),historyError,preview:draft!==null});
  const matches=(doc,values)=>Object.entries(values).every(([id,values])=>Object.entries(values).every(([field,value])=>doc.widgets[id][field]===value));
  const editable=doc=>Object.fromEntries(Object.entries(doc.widgets).map(([id,widget])=>[id,Object.fromEntries(fields.map(field=>[field,widget[field]]))]));
  function difference(before,after){const entry={before:{},after:{}};for(const id of Object.keys(before.widgets))for(const field of fields)if(before.widgets[id][field]!==after.widgets[id][field]){(entry.before[id]||={})[field]=before.widgets[id][field];(entry.after[id]||={})[field]=after.widgets[id][field];}return entry;}
  const changed=entry=>Object.keys(entry.after).length>0;
  // A normalized resize may move another coordinate. An undo must guard those fields too.
  function guarded(doc,op){if(!op.guard)return true;if(!matches(doc,op.guard))return false;if(op.reset)return true;const next=operation(doc,op),actual=difference(doc,next).after;return matches(next,op.changes)&&Object.entries(actual).every(([id,values])=>Object.keys(values).every(field=>Object.hasOwn(op.changes[id]||{},field)));}
  function checkCached(op,probe){
   if(!op||typeof op!=='object'||Array.isArray(op)||Object.keys(op).some(k=>!['reset','import','changes','operationId','guard','sentRevision'].includes(k))||typeof op.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(op.operationId)||op.reset!==undefined&&op.reset!==true||op.reset===true&&op.changes!==undefined||op.reset!==true&&!op.changes||op.import!==undefined&&op.import!==true||op.import===true&&(op.reset===true||!op.guard))throw Error('Invalid pending layout');
   const next=operation(probe,op);
   if(op.guard!==undefined){
    const expected=op.reset||op.import?editable(probe):op.changes;
    if(!op.guard||typeof op.guard!=='object'||Array.isArray(op.guard)||JSON.stringify(Object.keys(op.guard).sort())!==JSON.stringify(Object.keys(expected).sort()))throw Error('Invalid pending guard');
    for(const [id,values]of Object.entries(op.guard)){
     if(!values||typeof values!=='object'||Array.isArray(values)||JSON.stringify(Object.keys(values).sort())!==JSON.stringify(Object.keys(expected[id]).sort()))throw Error('Invalid pending guard');
     for(const [field,value]of Object.entries(values))if(!fields.includes(field)||(field==='visible'?typeof value!=='boolean':typeof value!=='number'||!Number.isFinite(value)))throw Error('Invalid pending guard');
    }
   }
   if(op.sentRevision!==undefined&&(!op.guard||!Number.isSafeInteger(op.sentRevision)||op.sentRevision<0))throw Error('Invalid pending revision');
   return next;
  }
  function upgradeCache(cached){
   if(![1,2].includes(cached.document?.schemaVersion))return cached;
   let probe=M.validateLegacy(cached.document);if(probe.theme!==theme||probe.profile!==profile||!Array.isArray(cached.pending)||cached.pending.length>128)throw Error('Invalid legacy cache');
   const migrated=[];
   for(const raw of cached.pending){
    // Validate old guards against the old catalog before projecting the operation.
    // Preserve its receipt ID and revision: a lost response may already be saved.
    const oldOperation=raw.reset?M.create(theme,profile,probe.schemaVersion):M.patchLegacy(probe,raw.changes);
    const newBefore=M.upgrade(probe),newAfter=M.upgrade(oldOperation),changes=difference(newBefore,newAfter).after;
    const op=M.clone(raw);checkCachedLegacy(raw,probe,oldOperation);
    if(raw.guard){
     const guardedDoc=M.clone(probe);for(const [id,values]of Object.entries(raw.guard))Object.assign(guardedDoc.widgets[id],values);
     const upgradedGuard=M.upgrade(guardedDoc);
     op.guard=raw.reset||raw.import?editable(upgradedGuard):Object.fromEntries(Object.entries(changes).map(([id,values])=>[id,Object.fromEntries(Object.keys(values).map(field=>[field,upgradedGuard.widgets[id][field]]))]));
    }
    if(!raw.reset)op.changes=changes;
    if(raw.reset||Object.keys(changes).length)migrated.push(op);
    probe=oldOperation;
   }
   return {document:M.upgrade(cached.document),pending:migrated};
  }
  function checkCachedLegacy(op,probe,next){
   // Reuse the strict queue validator with old documents, including complete
   // reset/import guards, without admitting old payloads on the network.
   if(!op||typeof op!=='object'||Array.isArray(op)||Object.keys(op).some(k=>!['reset','import','changes','operationId','guard','sentRevision'].includes(k))||typeof op.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(op.operationId)||op.reset!==undefined&&op.reset!==true||op.reset===true&&op.changes!==undefined||op.reset!==true&&!op.changes||op.import!==undefined&&op.import!==true||op.import===true&&(op.reset===true||!op.guard))throw Error('Invalid legacy operation');
   if(op.guard!==undefined){const expected=op.reset||op.import?editable(probe):op.changes;if(!op.guard||Object.keys(op.guard).sort().join(',')!==Object.keys(expected).sort().join(','))throw Error('Invalid legacy guard');for(const [id,values]of Object.entries(op.guard)){if(!values||Object.keys(values).sort().join(',')!==Object.keys(expected[id]).sort().join(','))throw Error('Invalid legacy guard');for(const [field,value]of Object.entries(values))if(!fields.includes(field)||(field==='visible'?typeof value!=='boolean':typeof value!=='number'||!Number.isFinite(value)))throw Error('Invalid legacy guard');}}
   if(op.sentRevision!==undefined&&(!op.guard||!Number.isSafeInteger(op.sentRevision)||op.sentRevision<0))throw Error('Invalid legacy revision');
  }
  try{let cached=JSON.parse(storage.getItem(cacheKey));if(cached){cached=upgradeCache(cached);seed=checked(cached.document);if(!Array.isArray(cached.pending)||cached.pending.length>128)throw Error();let probe=seed;for(const op of cached.pending)probe=checkCached(op,probe);pending=cached.pending;current=probe;}}catch{pending=[];current=seed;}
  function emit(){const value=snapshot();for(const listener of listeners)try{listener(value);}catch(error){/* A renderer failure must not discard a durable change. */}}
  function incompatible(op){undoStack.length=0;redoStack.length=0;historyError=op?.import?'Импорт отменён: раскладка изменена в другом окне. Проверь её и заново выбери файл. История текущей раскладки очищена.':op?.reset?'Сброс отменён: раскладка изменена в другом окне. Проверь её и повтори сброс. История текущей раскладки очищена.':'Отмена недоступна: эти поля изменены в другом окне. История текущей раскладки очищена.';const outcome=outcomes.get(op?.operationId);if(outcome)outcome.conflict=true;outcomes.delete(op?.operationId);}
  function rebase(){
   const previousRevision=current.revision;let next=confirmed||seed;const kept=[];
   for(const op of pending){
    if(!guarded(next,op)){
     // An ambiguous request may already have a receipt. Keep it for a stale-revision
     // retry, never optimistically apply it over the conflicting value.
     if(op.sentRevision!==undefined&&op.sentRevision!==next.revision){kept.push(op);continue;}
     incompatible(op);continue;
    }
    kept.push(op);next=operation(next,op);next.revision=(confirmed||seed).revision;
   }
   pending=kept;current=next;if(previousRevision!==current.revision)draft=null;emit();
  }
  function cache(){try{storage.setItem(cacheKey,JSON.stringify({document:confirmed||seed,pending}));cacheSaved=true;}catch{cacheSaved=false;}}
  function sync(){
   if(running)return running;status='saving';emit();
   running=Promise.resolve().then(async()=>{
    try{
     if(!confirmed){let response=await request('GET',{theme,profile});if(response.status===404)response=await request('POST',seed);if(response.status!==200)throw Error('Layout unavailable');confirmed=checked(response.document);cache();rebase();}
     let conflicts=0;
     while(pending.length){
      const op=pending[0];
      if(op.guard&&op.sentRevision===undefined){if(!guarded(confirmed,op)){pending.shift();incompatible(op);cache();rebase();continue;}op.sentRevision=confirmed.revision;cache();}
      const response=await request('PATCH',{theme,profile,revision:op.sentRevision??confirmed.revision,operationId:op.operationId,...(op.reset?{reset:true}:{changes:op.changes})});
      if(response.status===409){confirmed=checked(response.document);if(op.guard){delete op.sentRevision;if(!guarded(confirmed,op)){pending.shift();incompatible(op);}}cache();rebase();if(++conflicts>5)throw Error('Layout conflict');continue;}
      if(response.status!==200)throw Error('Layout write failed');
      confirmed=checked(response.document);pending.shift();outcomes.delete(op.operationId);cache();rebase();conflicts=0;
     }
     status='saved';cache();emit();
    }catch{cache();status=cacheSaved?'local':'memory';emit();}
   }).finally(()=>{running=null;if(status==='saved'&&pending.length)sync();});return running;
  }
  function capacity(){if(pending.length>=128)throw Error('Слишком много несохранённых изменений. Повтори сохранение.');}
  function enqueue(op,outcome){const queued={...M.clone(op),operationId:globalThis.crypto.randomUUID()};pending.push(queued);if(outcome)outcomes.set(queued.operationId,outcome);cache();status='saving';rebase();return sync();}
  function clearPreview(){const had=draft!==null;draft=null;return had;}
  function edit(op){
   // Rejected edits leave the ephemeral gesture intact, including its last emitted view.
   const entry=difference(current,operation(current,op));if(!changed(entry)){if(clearPreview())emit();return Promise.resolve(op.reset?{ok:true,status}:undefined);}capacity();clearPreview();
   undoStack.push(entry);if(undoStack.length>historyLimit)undoStack.shift();redoStack.length=0;historyError='';
   // Reset changes the whole document. Guard every field so a stale reset cannot
   // reset a foreign edit that its local history entry never observed.
   const outcome=op.reset?{conflict:false}:null,result=enqueue(op.reset?{reset:true,guard:editable(current)}:{changes:entry.after},outcome);
   return op.reset?result.then(()=>outcome.conflict?{ok:false,reason:'conflict',message:historyError}:{ok:true,status}):result;
  }
  function replaceAll(widgets,options={}){
   // A portable file has editable values only. Reject normalization and missing/extra
   // fields rather than silently changing a transferred layout or accepting commands.
   let after,entry,expected;
   const rejected=(reason,message)=>Promise.resolve({ok:false,reason,message});
   try{
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='expected'))throw Error();
    expected=options.expected===undefined?M.clone(current):M.validate(options.expected);
    if(expected.theme!==theme||expected.profile!==profile)return rejected('scope','Импорт отменён: выбраны другая тема или другой экран. Заново выбери файл для текущей раскладки.');
    if(!widgets||typeof widgets!=='object'||Array.isArray(widgets)||JSON.stringify(Object.keys(widgets).sort())!==JSON.stringify(Object.keys(current.widgets).sort()))throw Error();
    for(const values of Object.values(widgets))if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).sort().join(',')!=='scale,visible,x,y')throw Error();
    after=M.patch(current,widgets);if(!matches(after,widgets))throw Error();entry=difference(current,after);
   }catch{return rejected('invalid','Импорт отменён: файл содержит недопустимые параметры виджетов.');}
   if(expected.revision!==current.revision||!matches(current,editable(expected))){historyError='Импорт отменён: раскладка изменилась после выбора файла. Проверь её и заново выбери файл.';emit();return rejected('conflict',historyError);}
   if(!changed(entry)){if(clearPreview())emit();return Promise.resolve({ok:true,status});}
   capacity();clearPreview();undoStack.push(entry);if(undoStack.length>historyLimit)undoStack.shift();redoStack.length=0;historyError='';
   // Guard the complete observed layout, including fields absent from the diff.
   // The marker stays in the durable client queue; the wire remains the ordinary PATCH.
   const outcome={conflict:false};return enqueue({changes:entry.after,guard:editable(current),import:true},outcome).then(()=>outcome.conflict?{ok:false,reason:'conflict',message:historyError}:{ok:true,status});
  }
  function traverse(undo){
   const from=undo?undoStack:redoStack,to=undo?redoStack:undoStack,entry=from[from.length-1];
   if(!entry){if(clearPreview())emit();return Promise.resolve({ok:false,reason:'empty',message:undo?'Нет действий для отмены.':'Нет действий для повтора.'});}
   const op={changes:undo?entry.before:entry.after,guard:undo?entry.after:entry.before};
   if(!guarded(current,op)){clearPreview();incompatible();emit();return Promise.resolve({ok:false,reason:'conflict',message:historyError});}
   capacity();clearPreview();from.pop();to.push(entry);historyError='';const outcome={conflict:false};
   return enqueue(op,outcome).then(()=>outcome.conflict?{ok:false,reason:'conflict',message:historyError}:{ok:true,status});
  }
  return {
   get:view,status:()=>status,history,state:snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return ()=>listeners.delete(listener);},
   update:changes=>edit({changes}),reset:()=>edit({reset:true}),replaceAll,undo:()=>traverse(true),redo:()=>traverse(false),sync,
   preview(changes){const merged=M.clone(draft||{});for(const [id,values]of Object.entries(changes))merged[id]={...(merged[id]||{}),...values};M.patch(current,changes);M.patch(current,merged);draft=merged;emit();return view();},
   cancelPreview(){if(clearPreview())emit();return view();},
   // Re-read on focus, retaining unconfirmed edits and rebasing them on the newest revision.
   refresh(){if(running)return running;confirmed=null;return sync();}
  };
 }
 return {createSession};
});
if(typeof window!=='undefined'&&window.PGLayoutClient&&window.PG_APP){
 (function(){
  'use strict';
  const theme=location.pathname.startsWith('/classic/')?'classic':location.pathname.startsWith('/luna-blue/')?'luna-blue':'paper-green',sessions=new Map(),listeners=new Set();let active=null;
  const read=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
  async function request(method,value){
   const query=new URLSearchParams({theme:value.theme,profile:value.profile}),response=await fetch('/layouts'+(method==='GET'?'?'+query:''),{method,headers:{'X-VioletGhost-Action':'desktop','X-VioletGhost-Key':window.VG_LOCAL_CONTROL_KEY||'',...(method!=='GET'?{'Content-Type':'application/json'}:{})},...(method!=='GET'?{body:JSON.stringify(value)}:{}),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});
   const result=await response.json();return {status:response.status,document:result.document};
  }
  function activate(profile){
   if(active?.get().profile===profile)return active;
   active?.cancelPreview();
   let session=sessions.get(profile);
   if(!session){const classic=theme==='classic',luna=theme==='luna-blue';session=window.PGLayoutClient.createSession({theme,profile,storage:localStorage,request,legacy:luna?{}:{positions:read((classic?'paper-green-app-classic-layout-v1:':'paper-green-app-layout-v1:')+profile),launcher:read((classic?'paper-green-app-classic-launcher-layout-v1:':'paper-green-app-launcher-layout-v1:')+profile)}});sessions.set(profile,session);session.subscribe(value=>{if(active===session)for(const listener of listeners)listener(value);});}
   active=session;for(const listener of listeners)listener(session.state());void session.sync();return session;
  }
  window.PGLayouts={theme,activate,current:()=>active?.get(),status:()=>active?.status(),history:()=>active?.history()||{canUndo:false,canRedo:false,undoCount:0,redoCount:0},update:changes=>active?.update(changes),reset:()=>active?.reset(),replaceAll:(widgets,options)=>active?active.replaceAll(widgets,options):Promise.resolve({ok:false,reason:'scope',message:'Импорт отменён: раскладка не выбрана.'}),undo:()=>active?active.undo():Promise.resolve({ok:false,reason:'empty',message:'Раскладка не выбрана.'}),redo:()=>active?active.redo():Promise.resolve({ok:false,reason:'empty',message:'Раскладка не выбрана.'}),preview:changes=>active?.preview(changes),cancelPreview:()=>active?.cancelPreview(),retry:()=>active?.sync(),subscribe(listener){listeners.add(listener);if(active)listener(active.state());return ()=>listeners.delete(listener);}};
  window.addEventListener('focus',()=>{void active?.refresh();});window.addEventListener('online',()=>{void active?.sync();});
  // Only retry failed writes/discovery; no background polling when everything is saved.
  setInterval(()=>{for(const session of sessions.values())if(['local','memory'].includes(session.status()))void session.sync();},10000);
 })();
}
