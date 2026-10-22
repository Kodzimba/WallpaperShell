(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PGWidgetModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION=3,WIDTH=1920,HEIGHT=1080;
 const themes=['paper-green','classic','luna-blue'],profiles=['display-1','display-2'];
 const oldPaper={clock:[1310,64,610,242],weather:[1310,306,610,76],calendar:[1310,382,610,266],system:[1310,648,610,74],network:[1310,722,610,116],media:[640,838,1280,242],screens:[24,604,592,66],audio:[24,670,592,84],mouse:[24,754,592,100],ecoflow:[24,854,592,142]};
 const paper={...oldPaper,media:[664,650,622,176],openwindows:[640,838,640,242],notifications:[1280,838,640,242]};
 const classic={clock:[1296,0,264,888],calendar:[1582,70,312,304],weather:[1582,394,312,124],system:[1582,534,312,128],network:[1582,678,312,132],media:[124,740,860,284],mouse:[1078,940,210,84],ecoflow:[1296,904,264,120],pet:[1666,940,228,84],screens:[1582,826,312,50],audio:[1582,884,312,50]};
 const luna={clock:[65,110,310,170],weather:[1500,434,350,90],calendar:[1500,136,350,282],system:[1500,540,350,130],network:[65,714,310,130],mouse:[65,860,310,130],media:[660,686,600,174],openwindows:[660,880,600,120],notifications:[1500,686,350,260]};
 const lunaExtra={ecoflow:[400,550,240,164],screens:[400,310,240,104],audio:[400,430,240,104],pet:[400,730,240,132]};
 // Bindings describe existing capabilities, never user-supplied URLs, scripts or commands.
 const meta={clock:['Время','clock',[],[]],calendar:['Календарь','calendar',[],[]],weather:['Погода','weather',['weather'],[]],system:['Система','system',['system'],[]],network:['Интернет','network',['network','speedtest'],['speedtest']],media:['Плеер','media',['media','audio-loopback'],['media','volume']],screens:['Экраны','screens',['desktop'],['displays']],audio:['Звук','audio',['desktop'],['audio']],mouse:['Мышь','battery',['mouse'],[]],ecoflow:['EcoFlow','energy',['ecoflow'],[]],pet:['Пет','pet',['pet'],[]],launcher:['Программы и файлы','launcher',['launcher'],['launcher','workspace']],scene:['Движущаяся фигура','scene',['audio-loopback'],[]]};
 meta.openwindows=['Открытые окна','openwindows',['native-windows'],['window-preview','window-activate']];meta.notifications=['Уведомления','notifications',['windows-notifications'],['notifications-access']];
 const clone=v=>JSON.parse(JSON.stringify(v));
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function scope(theme,profile){if(!themes.includes(theme)||!profiles.includes(profile))throw Error('Invalid layout scope');return theme+':'+profile;}
 function catalog(theme,version=VERSION){scope(theme,profiles[0]);if(![1,2,VERSION].includes(version))throw Error('Unsupported layout version');const bases=theme==='luna-blue'?{...luna,...(version>=3?lunaExtra:{}),launcher:[65,300,310,400],scene:[675,90,570,570]}:{...(theme==='classic'?classic:version===1?oldPaper:paper),launcher:[24,theme==='classic'?200:80,theme==='classic'?248:592,524],scene:theme==='classic'?[0,0,1920,1080]:[640,64,670,774]};return Object.fromEntries(Object.entries(bases).map(([id,bounds])=>{const [title,type,sources,actions]=meta[id];return [id,{id,title:id==='scene'&&theme==='luna-blue'?'Луна и спектр':title,type,base:bounds.slice(),sources:sources.slice(),actions:actions.slice(),movable:id!=='scene'||theme!=='classic',resizable:id!=='launcher'&&(id!=='scene'||theme!=='classic'),defaultVisible:!(theme==='luna-blue'&&Object.hasOwn(lunaExtra,id))}];}));}
 function normalize(descriptor,input={}){
  const [x,y,w,h]=descriptor.base,scale=descriptor.resizable&&finite(input.scale)?clamp(input.scale,.65,Math.min(1.7,WIDTH/w,HEIGHT/h)):1;
  // Launcher height follows its real category count; its renderer fits it to the free area.
  if(descriptor.id==='launcher')return {type:descriptor.type,x:clamp(finite(input.x)?input.x:x,16,w===248?1656:w===310?1594:1304),y:clamp(finite(input.y)?input.y:y,80,w===310?1010-h:900),scale:1,visible:typeof input.visible==='boolean'?input.visible:true};
  return {type:descriptor.type,x:descriptor.movable?clamp(finite(input.x)?input.x:x,0,WIDTH-w*scale):x,y:descriptor.movable?clamp(finite(input.y)?input.y:y,0,HEIGHT-h*scale):y,scale,visible:typeof input.visible==='boolean'?input.visible:true};
 }
 function create(theme,profile,version=VERSION){scope(theme,profile);return {schemaVersion:version,theme,profile,revision:0,widgets:Object.fromEntries(Object.entries(catalog(theme,version)).map(([id,d])=>[id,normalize(d,{visible:d.defaultVisible})]))};}
 function validateVersion(doc,version){
  if(!object(doc)||doc.schemaVersion!==version||!Number.isSafeInteger(doc.revision)||doc.revision<0)throw Error('Unsupported layout document');
  scope(doc.theme,doc.profile);const expected=create(doc.theme,doc.profile,version),ids=Object.keys(expected.widgets);
  if(!object(doc.widgets)||Object.keys(doc.widgets).length!==ids.length)throw Error('Invalid widgets');
  for(const id of ids){const raw=doc.widgets[id],normal=normalize(catalog(doc.theme,version)[id],raw);
   if(!object(raw)||Object.keys(raw).sort().join(',')!=='scale,type,visible,x,y'||Object.keys(normal).some(k=>raw[k]!==normal[k]))throw Error('Invalid widget');
  }
  if(Object.keys(doc).sort().join(',')!=='profile,revision,schemaVersion,theme,widgets')throw Error('Invalid layout fields');
  return clone(doc);
 }
 function validate(doc){return validateVersion(doc,VERSION);}
 function patchVersion(doc,changes,version){
  const next=validateVersion(doc,version),entries=catalog(doc.theme,version);
  if(!object(changes)||!Object.keys(changes).length||Object.keys(changes).length>Object.keys(entries).length)throw Error('Invalid changes');
  for(const [id,fields]of Object.entries(changes)){
   if(!Object.hasOwn(entries,id)||!object(fields)||!Object.keys(fields).length)throw Error('Unknown widget');
   for(const [key,value]of Object.entries(fields))if(!['x','y','scale','visible'].includes(key)||(key==='visible'?typeof value!=='boolean':!finite(value)))throw Error('Invalid widget property');
   next.widgets[id]=normalize(entries[id],{...next.widgets[id],...fields});
  }
  return next;
 }
 function patch(doc,changes){return patchVersion(doc,changes,VERSION);}
 function upgrade(doc){
  if(doc?.schemaVersion===VERSION)return validate(doc);
  const old=validateVersion(doc,doc?.schemaVersion===2?2:1),next=create(old.theme,old.profile);next.revision=old.revision;
  for(const [id,raw]of Object.entries(old.widgets)){
   // Only the old standard player is moved automatically. Custom geometry keeps
   // its anchor, with bounds checked against the new compact player dimensions.
   const value=id==='media'&&old.schemaVersion===1&&old.theme==='paper-green'&&raw.x===640&&raw.y===838&&raw.scale===1?{...raw,x:664,y:650}:raw;
   next.widgets[id]=normalize(catalog(old.theme)[id],value);
  }
  return validate(next);
 }
 function migrate(theme,profile,positions,launcher){
  if(theme==='classic'&&object(positions)){
   positions=clone(positions);
   if(positions.media?.x===124&&[820,776].includes(positions.media.y)&&positions.media.s===1)positions.media.y=740;
   for(const [id,x,y,next]of [['system',1582,568,534],['network',1582,744,678],['mouse',1078,934,940],['ecoflow',1308,934,940],['pet',1666,934,940]])if(positions[id]?.x===x&&positions[id].y===y&&positions[id].s===1)positions[id].y=next;
   if(positions.ecoflow?.x===1308&&positions.ecoflow.y===940&&positions.ecoflow.s===1)positions.ecoflow={x:1296,y:904,s:1};
  }
  let doc=create(theme,profile);const changes={};
  for(const id of Object.keys(theme==='classic'?classic:theme==='luna-blue'?luna:paper))if(object(positions?.[id])){let raw=positions[id];if(theme==='paper-green'&&id==='media'&&raw.x===640&&raw.y===838&&raw.s===1)raw={...raw,x:664,y:650};const fields={};if(finite(raw.x))fields.x=raw.x;if(finite(raw.y))fields.y=raw.y;if(finite(raw.s))fields.scale=raw.s;if(Object.keys(fields).length)changes[id]=fields;}
  if(object(launcher)&&finite(launcher.x)&&finite(launcher.y)&&!(launcher.x===18&&launcher.y===408))changes.launcher={x:launcher.x,y:launcher.y};
  if(Object.keys(changes).length)doc=patch(doc,changes);return doc;
 }
 return {VERSION,WIDTH,HEIGHT,themes,profiles,scope,catalog,create,validate,patch,migrate,clone,upgrade,validateLegacy:doc=>validateVersion(doc,doc?.schemaVersion===2?2:1),patchLegacy:(doc,changes)=>patchVersion(doc,changes,doc?.schemaVersion===2?2:1)};
});
