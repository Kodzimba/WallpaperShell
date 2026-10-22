'use strict';
// Idempotent changes confined to the imported app copies.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../runtime');
for(const theme of ['wallpaper','themes/classic']){
 const dir=path.join(root,theme);
 for(const file of fs.readdirSync(dir).filter(n=>/\.(js|html)$/.test(n))){
  if(file==='app-host.js')continue;let s=fs.readFileSync(path.join(dir,file),'utf8');
  s=s.replaceAll('violetghost-settings','paper-green-app-classic-settings').replaceAll('violetghost-launcher','paper-green-app-classic-launcher');
  s=s.replaceAll('Темы обоев','Темы приложения').replaceAll('Другие обои ↗','Темы приложения ↗').replaceAll('Переключаю обои…','Переключаю тему…').replaceAll('Команда отправлена обоим мониторам.','Тема приложения изменена.').replaceAll('Медиаданные доступны внутри Wallpaper Engine','Ожидание медиасессии Windows').replaceAll('Медиаданные появляются внутри Wallpaper Engine.','Медиаданные получает Windows SMTC.');
  if(file==='launcher.js')s=s.replaceAll("typeof window.wallpaperRegisterMediaPropertiesListener==='function'","window.PG_APP_DESKTOP===true");
  fs.writeFileSync(path.join(dir,file),s);
 }
}
console.log('App UI adapted without changing original themes.');
