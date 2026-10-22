(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PGCustomWidgetModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const kinds=['note','metric','progress','countdown','clock','checklist'],bindings=['none','ramUsed','ramPercent','vramUsed','vramPercent','mouseBattery','ping','download','upload','temperature'],arts=['none','moon','sun','water','orbit','leaf'];
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),clone=v=>JSON.parse(JSON.stringify(v)),finite=v=>typeof v==='number'&&Number.isFinite(v),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function exact(v,keys){if(!object(v)||Object.keys(v).sort().join(',')!==keys.slice().sort().join(','))throw Error('Неверный формат виджета.');}
 function text(v,max){if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw Error('Недопустимый текст виджета.');return v;}
 function spec(value){
  exact(value,['version','title','kind','width','height','accent','text','binding','unit','target','items','art']);
  if(value.version!==1||!kinds.includes(value.kind)||!bindings.includes(value.binding)||!arts.includes(value.art))throw Error('Этот тип виджета пока не поддерживается.');
  if(!finite(value.width)||value.width<160||value.width>960||!finite(value.height)||value.height<100||value.height>700||!/^#[0-9a-f]{6}$/i.test(value.accent))throw Error('Недопустимые размеры или цвет.');
  text(value.title,64);if(!value.title.trim())throw Error('У виджета должно быть название.');text(value.text,2400);text(value.unit,24);text(value.target,40);
  if(value.kind==='countdown'&&!Number.isFinite(Date.parse(value.target)))throw Error('Укажи дату для обратного отсчёта.');
  if(!Array.isArray(value.items)||value.items.length>12)throw Error('В списке может быть до 12 пунктов.');for(const item of value.items)text(item,160);
  return clone(value);
 }
 function geometry(s,value={}){const scale=finite(value.scale)?clamp(value.scale,.35,Math.min(2.5,1920/s.width,1080/s.height)):1;return {type:'custom',x:clamp(finite(value.x)?value.x:800,0,1920-s.width*scale),y:clamp(finite(value.y)?value.y:400,0,1080-s.height*scale),scale,visible:typeof value.visible==='boolean'?value.visible:true};}
 function item(value){exact(value,['id','spec','geometry']);if(typeof value.id!=='string'||!/^custom-[a-f0-9-]{36}$/.test(value.id))throw Error('Неверный ID виджета.');const s=spec(value.spec),g=geometry(s,value.geometry);exact(value.geometry,['type','x','y','scale','visible']);if(Object.keys(g).some(k=>g[k]!==value.geometry[k]))throw Error('Виджет выходит за пределы экрана.');return {id:value.id,spec:s,geometry:g};}
 function document(value){exact(value,['version','theme','profile','revision','items']);if(value.version!==1||!['paper-green','classic','luna-blue'].includes(value.theme)||!['display-1','display-2'].includes(value.profile)||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.items)||value.items.length>32)throw Error('Неверный документ своих виджетов.');const ids=new Set();for(const raw of value.items){const clean=item(raw);if(ids.has(clean.id))throw Error('Повторяющийся виджет.');ids.add(clean.id);}return clone(value);}
 function create(theme,profile){return document({version:1,theme,profile,revision:0,items:[]});}
 function catalog(doc){return Object.fromEntries(doc.items.map(i=>[i.id,{id:i.id,title:i.spec.title,type:'custom',base:[i.geometry.x,i.geometry.y,i.spec.width,i.spec.height],movable:true,resizable:true}]));}
 const schema={type:'object',additionalProperties:false,properties:{version:{type:'integer',enum:[1]},title:{type:'string'},kind:{type:'string',enum:kinds},width:{type:'number'},height:{type:'number'},accent:{type:'string'},text:{type:'string'},binding:{type:'string',enum:bindings},unit:{type:'string'},target:{type:'string'},items:{type:'array',items:{type:'string'}},art:{type:'string',enum:arts}},required:['version','title','kind','width','height','accent','text','binding','unit','target','items','art']};
 return {kinds,bindings,arts,spec,geometry,item,document,create,catalog,clone,schema};
});
