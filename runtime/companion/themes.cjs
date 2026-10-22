'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'.app-theme.json');
function get(){try{const v=JSON.parse(fs.readFileSync(file,'utf8')).theme;return ['paper-green','classic','luna-blue'].includes(v)?v:'paper-green';}catch{return 'paper-green';}}
function createSwitcher(){return async value=>{if(!['paper-green','classic','luna-blue'].includes(value))throw Error('Unknown app theme');fs.writeFileSync(file,JSON.stringify({theme:value}));setTimeout(()=>console.log(JSON.stringify({type:'app-theme',value})),200);return {status:'ok',identity:'WallpaperShell theme',updatedAt:new Date().toISOString(),data:{requestedTheme:value}};};}
module.exports={get,createSwitcher};
