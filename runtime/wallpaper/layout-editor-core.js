(function(root,factory){const M=typeof module==='object'&&module.exports?require('./widget-model.js'):root.PGWidgetModel;const api=factory(M);if(typeof module==='object'&&module.exports)module.exports=api;else root.PGLayoutEditorCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(M){
 'use strict';
 const fields=['x','y','scale','visible'];
 function difference(before,after){return Object.fromEntries(fields.filter(key=>before[key]!==after[key]).map(key=>[key,after[key]]));}
 function logicalPoint(client,rect){if(!rect||!Number.isFinite(rect.width)||rect.width<=0)throw Error('Холст пока недоступен.');const scale=rect.width/M.WIDTH;return {x:(client.x-rect.left)/scale,y:(client.y-rect.top)/scale};}
 const factors=[0,.5,1],axisSize={x:'width',y:'height'},validRect=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.width>0&&r.height>0;
 function anchors(rect,axis){return factors.map(factor=>({factor,position:rect[axis]+rect[axisSize[axis]]*factor}));}
 // Pure smart guides: distances are supplied in logical pixels, independent of
 // display scale. Locks use a wider release radius so slow drags do not flicker.
 function magnet(rect,targets,{kind='move',threshold=6,release=10,locks={}}={}){
  if(!validRect(rect))return {rect,guides:[],locks:{}};
  const valid=targets.filter(t=>validRect(t.rect)),candidates=[];
  for(const target of valid)for(const axis of ['x','y'])for(const own of anchors(rect,axis))for(const other of anchors(target.rect,axis)){
   if(kind==='resize'&&own.factor===0)continue;
   const delta=other.position-own.position,distance=Math.abs(delta),token=target.id+':'+axis+':'+own.factor+':'+other.factor;
   candidates.push({axis,position:other.position,ownFactor:own.factor,targetId:target.id,targetFactor:other.factor,delta,distance,token,priority:own.factor===other.factor?0:1});
  }
  const choose=(axis,held)=>{
   const all=candidates.filter(c=>!axis||c.axis===axis),locked=all.find(c=>c.token===held&&c.distance<=release);
   if(locked)return locked;
   return all.filter(c=>c.distance<=threshold).sort((a,b)=>a.distance-b.distance||a.priority-b.priority||String(a.targetId).localeCompare(String(b.targetId))||a.ownFactor-b.ownFactor)[0]||null;
  };
  const result={...rect},nextLocks={},guides=[];
  if(kind==='resize'){
   // One scale preserves proportions. A second guide is shown only if that
   // same scale happens to align both axes exactly.
   const candidate=choose(null,locks.scale);if(candidate){const axis=candidate.axis,ratio=(candidate.position-rect[axis])/(rect[axisSize[axis]]*candidate.ownFactor);if(Number.isFinite(ratio)&&ratio>0){result.width*=ratio;result.height*=ratio;nextLocks.scale=candidate.token;for(const c of candidates)if(Math.abs(result[c.axis]+result[axisSize[c.axis]]*c.ownFactor-c.position)<.001&&(c.token===candidate.token||c.ownFactor===1))guides.push(c);}}
  }else for(const axis of ['x','y']){const candidate=choose(axis,locks[axis]);if(candidate){result[axis]+=candidate.delta;nextLocks[axis]=candidate.token;guides.push(candidate);}}
  const unique=[];for(const g of guides)if(!unique.some(v=>v.axis===g.axis&&Math.abs(v.position-g.position)<.001))unique.push(g);
  return {rect:result,guides:unique,locks:nextLocks};
 }
 function createController({get,preview,commit,cancelPreview,constrain=(id,p)=>p,model=M,geometry:rectFor=(id,p,d)=>({x:p.x,y:p.y,width:d.base[2]*p.scale,height:d.base[3]*p.scale})}){
  const M=model;
  let selected=null,gesture=null;
  const available=(doc,id)=>Object.hasOwn(doc.widgets,id);
  const stop=()=>{const had=!!gesture;gesture=null;cancelPreview();return had;};
  function select(id){if(gesture)stop();const doc=get();if(id!==null&&(!doc||!available(doc,id)))return false;selected=id;return true;}
  function begin(id,kind,point){
   const doc=get();if(!doc||!available(doc,id)||!['move','resize'].includes(kind))return false;
   const d=M.catalog(doc.theme)[id];if(!doc.widgets[id].visible||!(kind==='move'?d.movable:d.resizable))return false;
   if(gesture)stop();selected=id;const catalog=M.catalog(doc.theme),rect=rectFor(id,doc.widgets[id],d),targets=Object.entries(catalog).filter(([other,descriptor])=>other!==id&&doc.widgets[other]?.visible&&(descriptor.movable||descriptor.resizable)).map(([other,descriptor])=>({id:other,rect:rectFor(other,doc.widgets[other],descriptor)}));targets.push({id:'__canvas__',rect:{x:0,y:0,width:M.WIDTH,height:M.HEIGHT}});gesture={id,kind,point:{...point},document:M.clone(doc),changes:{},rect,targets,locks:{},guides:[]};return true;
  }
  function move(point,{snapping=false,threshold=6,release=10}={}){
   if(!gesture)return false;const g=gesture,initial=g.document.widgets[g.id],d=M.catalog(g.document.theme)[g.id],dx=point.x-g.point.x,dy=point.y-g.point.y;
   if(!Number.isFinite(dx)||!Number.isFinite(dy))return false;
   const candidate=g.kind==='move'?{x:Math.round(initial.x+dx),y:Math.round(initial.y+dy)}:{scale:Math.round((initial.scale+(Math.abs(dx/d.base[2])>=Math.abs(dy/d.base[3])?dx/d.base[2]:dy/d.base[3]))*1000)/1000};
   let normalized=M.patch(g.document,{[g.id]:constrain(g.id,candidate)}).widgets[g.id];
   const poseRect=p=>({x:g.rect.x+p.x-initial.x,y:g.rect.y+p.y-initial.y,width:g.rect.width*p.scale/initial.scale,height:g.rect.height*p.scale/initial.scale});
   g.guides=[];
   if(snapping&&(dx!==0||dy!==0)){const rawRect=poseRect(normalized),snapped=magnet(rawRect,g.targets,{kind:g.kind,threshold,release,locks:g.locks}),value=g.kind==='move'?{x:normalized.x+snapped.rect.x-rawRect.x,y:normalized.y+snapped.rect.y-rawRect.y}:{scale:normalized.scale*snapped.rect.width/rawRect.width};normalized=M.patch(g.document,{[g.id]:constrain(g.id,value)}).widgets[g.id];const actual=poseRect(normalized);g.guides=snapped.guides.filter(line=>Math.abs(actual[line.axis]+actual[axisSize[line.axis]]*line.ownFactor-line.position)<.01).map(({axis,position,targetId})=>({axis,position,targetId}));g.locks=g.guides.length?snapped.locks:{};}else g.locks={};
   g.changes=difference(initial,normalized);
   // Preview is a merge API. Send complete geometry so returning one axis to its
   // starting value cannot leave an earlier frame's coordinate in the draft.
   if(Object.keys(g.changes).length)preview({[g.id]:{x:normalized.x,y:normalized.y,scale:normalized.scale}});else cancelPreview();return true;
  }
  function finish(){if(!gesture)return null;const g=gesture;gesture=null;if(!Object.keys(g.changes).length){cancelPreview();return null;}return commit({[g.id]:g.changes});}
  function apply(changes){if(gesture)stop();const doc=get();if(!doc||!selected||!available(doc,selected))return null;const next=M.patch(doc,{[selected]:constrain(selected,changes)}),changed=difference(doc.widgets[selected],next.widgets[selected]);return Object.keys(changed).length?commit({[selected]:changed}):null;}
  function nudge(dx,dy){const doc=get();if(!doc||!selected||!M.catalog(doc.theme)[selected]?.movable)return null;const p=doc.widgets[selected];return apply({x:p.x+dx,y:p.y+dy});}
  function receive({document:doc,preview:isPreview}){if(!doc)return false;let canceled=false;if(gesture&&!isPreview&&(doc.theme!==gesture.document.theme||doc.profile!==gesture.document.profile||doc.revision!==gesture.document.revision||doc.builderRevision!==gesture.document.builderRevision))canceled=stop();if(selected&&!available(doc,selected))selected=null;return canceled;}
  return {select,begin,move,finish,cancel:stop,apply,nudge,receive,state:()=>({selected,guides:gesture?gesture.guides.map(g=>({...g})):[],gesture:gesture?{id:gesture.id,kind:gesture.kind,theme:gesture.document.theme,profile:gesture.document.profile,revision:gesture.document.revision}:null})};
 }
 return {logicalPoint,difference,magnet,createController};
});
