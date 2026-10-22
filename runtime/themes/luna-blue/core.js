(function(root,factory){const C=typeof module==='object'&&module.exports?require('../../wallpaper/core.js'):root.VGCore,M=typeof module==='object'&&module.exports?require('../../wallpaper/widget-model.js'):root.PGWidgetModel;const value=factory(C,M);if(typeof module==='object'&&module.exports)module.exports=value;else root.VGCore=value;})(typeof globalThis!=='undefined'?globalThis:this,function(C,M){
 'use strict';
 const layouts=Object.fromEntries(Object.entries(M.catalog('luna-blue')).filter(([id])=>!['launcher','scene'].includes(id)).map(([id,descriptor])=>[id,descriptor.base.slice()]));
 function layout(id,value){const base=layouts[id];if(!base)throw Error('Unknown Luna widget');const raw=value&&typeof value==='object'?value:{},s=C.finite(raw.s)?C.clamp(raw.s,.65,Math.min(1.7,C.WIDTH/base[2],C.HEIGHT/base[3])):1;return {x:C.clamp(C.finite(raw.x)?raw.x:base[0],0,C.WIDTH-base[2]*s),y:C.clamp(C.finite(raw.y)?raw.y:base[1],0,C.HEIGHT-base[3]*s),s};}
 return {...C,layouts,layout};
});
