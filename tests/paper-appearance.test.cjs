'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../runtime/wallpaper/appearance.js');
test('appearance validates fixed modes and plain HEX only; palettes retain readable foregrounds',()=>{
 for(const mode of ['light','dark'])for(const accent of ['#caff00','#000000','#ffffff','#ff0000','#123456']){const s={mode,accent};assert(M.valid(s));const p=M.palette(s);assert(p.background.every(v=>v>=0&&v<=1));assert(['#000000','#ffffff'].includes(p.ink));}
 for(const s of [{mode:'other',accent:'#caff00'},{mode:'dark',accent:'url(x)'},{mode:'light',accent:'#12345g'},{mode:'light',accent:'red'}])assert(!M.valid(s));
 assert.deepEqual(M.palette({mode:'light',accent:'#caff00'}).background,[202/255,1,0]);
 assert(M.palette({mode:'dark',accent:'#caff00'}).background.every(v=>v<.22));assert(M.palette({mode:'light',accent:'#000000'}).dark);
 assert.equal(M.palette({mode:'light',accent:'#caff00'}).signal,'#caff00');
 for(const accent of ['#000000','#123456']){const signal=M.rgb(M.palette({mode:'dark',accent}).signal);assert(signal.every(v=>v>=153));}
});
