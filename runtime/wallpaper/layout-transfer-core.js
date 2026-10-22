(function(root,factory){const M=typeof module==='object'&&module.exports?require('./widget-model.js'):root.PGWidgetModel;const api=factory(M);if(typeof module==='object'&&module.exports)module.exports=api;else root.PGLayoutTransferCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(M){
 'use strict';
 const FORMAT='paper-green-layout',VERSION=3,MAX_BYTES=32768;
 const fields=['x','y','scale','visible'],modelFields=['type',...fields];
 function fail(code,message){const error=Error(message);error.code=code;throw error;}
 function exact(value,keys,label){
  if(value===null||typeof value!=='object'||Array.isArray(value))fail('FIELDS',label+': требуется объект.');
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)fail('FIELDS',label+': недопустимый объект.');
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))fail('FIELDS',label+': неизвестные или отсутствующие поля.');
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail('FIELDS',label+': допустимы только поля данных.');}
 }
 function bytes(text){
  // Same UTF-8 accounting as TextEncoder, including replacement of lone surrogates.
  let length=0;for(const character of text){const point=character.codePointAt(0);length+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;}return length;
 }
 function checkSize(text){if(bytes(text)>MAX_BYTES)fail('TOO_LARGE','Файл раскладки превышает 32 КиБ.');}
 function rejectDuplicateKeys(text){
  // JSON.parse has already checked the grammar. Scan its tokens without evaluating
  // code, keeping original member names before duplicate keys can be overwritten.
  let offset=0;
  const whitespace=()=>{while(/[\x20\t\r\n]/.test(text[offset]||'\u0000'))offset++;};
  function string(){const start=offset++;while(offset<text.length){const character=text[offset++];if(character==='\\')offset++;else if(character==='"')return JSON.parse(text.slice(start,offset));}}
  function value(depth){
   if(depth>12)fail('FIELDS','В файле раскладки слишком много вложенных объектов.');
   whitespace();const character=text[offset];
   if(character==='"'){string();return;}
   if(character==='{'){
    offset++;whitespace();if(text[offset]==='}'){offset++;return;}
    const keys=new Set();
    while(offset<text.length){whitespace();const key=string();if(keys.has(key))fail('DUPLICATE','В файле раскладки повторяется поле.');keys.add(key);whitespace();offset++;value(depth+1);whitespace();if(text[offset++]==='}')return;}
   }else if(character==='['){
    offset++;whitespace();if(text[offset]===']'){offset++;return;}while(offset<text.length){value(depth+1);whitespace();if(text[offset++]===']')return;}
   }else while(offset<text.length&&!/[\x20\t\r\n,}\]]/.test(text[offset]))offset++;
  }
  value(0);
 }
 function validatePortable(input){
  exact(input,['format','version','theme','canvas','widgets'],'Раскладка');
  if(input.format!==FORMAT)fail('FORMAT','Это не файл раскладки WallpaperShell.');
  if(![1,2,VERSION].includes(input.version))fail('VERSION','Эта версия файла раскладки не поддерживается.');
  if(!M.themes.includes(input.theme))fail('THEME','Тема в файле раскладки не поддерживается.');
  exact(input.canvas,['width','height'],'Холст');
  if(input.canvas.width!==M.WIDTH||input.canvas.height!==M.HEIGHT)fail('BOUNDS','Раскладка должна использовать холст 1920 × 1080.');
  const base=M.create(input.theme,'display-1',input.version),ids=Object.keys(base.widgets),changes={};
  exact(input.widgets,ids,'Виджеты');
  for(const id of ids){
   const widget=input.widgets[id];exact(widget,fields,'Виджет '+id);
   if(fields.slice(0,3).some(key=>typeof widget[key]!=='number'||!Number.isFinite(widget[key]))||typeof widget.visible!=='boolean')fail('FIELDS','Виджет '+id+': неверные значения полей.');
   changes[id]=Object.fromEntries(fields.map(key=>[key,widget[key]]));
  }
  const normalized=input.version<VERSION?M.patchLegacy(base,changes):M.patch(base,changes);
  for(const id of ids)if(fields.some(key=>changes[id][key]!==normalized.widgets[id][key]))fail('BOUNDS','Виджет '+id+' выходит за допустимые границы или размер.');
  const upgraded=M.upgrade(normalized);
  return {format:FORMAT,version:VERSION,theme:input.theme,canvas:{width:M.WIDTH,height:M.HEIGHT},widgets:Object.fromEntries(Object.entries(upgraded.widgets).map(([id,widget])=>[id,Object.fromEntries(fields.map(key=>[key,widget[key]]))]))};
 }
 function exportDocument(document){
  exact(document,['schemaVersion','theme','profile','revision','widgets'],'Документ раскладки');
  if(!M.themes.includes(document.theme))fail('DOCUMENT','Текущая тема раскладки не поддерживается.');
  const ids=Object.keys(M.catalog(document.theme));exact(document.widgets,ids,'Виджеты документа');
  for(const id of ids)exact(document.widgets[id],modelFields,'Виджет '+id);
  let valid;try{valid=M.validate(document);}catch(_){fail('DOCUMENT','Текущий документ раскладки повреждён.');}
  return validatePortable({format:FORMAT,version:VERSION,theme:valid.theme,canvas:{width:M.WIDTH,height:M.HEIGHT},widgets:Object.fromEntries(ids.map(id=>[id,Object.fromEntries(fields.map(key=>[key,valid.widgets[id][key]]))]))});
 }
 function stringify(document){const result=JSON.stringify(exportDocument(document),null,2)+'\n';checkSize(result);return result;}
 function parse(text){
  if(typeof text!=='string')fail('JSON','Для импорта требуется текст JSON.');
  checkSize(text);let value;try{value=JSON.parse(text);}catch(_){fail('JSON','Не удалось прочитать JSON раскладки.');}
  rejectDuplicateKeys(text);return validatePortable(value);
 }
 function prepareImport(textOrObject,currentDocument){
  const imported=typeof textOrObject==='string'?parse(textOrObject):validatePortable(textOrObject),current=exportDocument(currentDocument);
  if(imported.theme!==current.theme)fail('THEME','Файл предназначен для другой темы. Переключите тему и повторите импорт.');
  const changes={},changedWidgets=[];
  for(const id of Object.keys(current.widgets)){
   const difference=Object.fromEntries(fields.filter(key=>imported.widgets[id][key]!==current.widgets[id][key]).map(key=>[key,imported.widgets[id][key]]));
   if(Object.keys(difference).length){changes[id]=difference;changedWidgets.push(id);}
  }
  return {theme:imported.theme,changes,changedWidgets};
 }
 return {FORMAT,VERSION,MAX_BYTES,exportDocument,stringify,parse,prepareImport};
});
