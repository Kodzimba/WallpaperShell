'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../runtime/companion/logic.cjs');
test('traffic uses actual monotonic interval and resets on adapter changes, sleep and counter reset',()=>{
 const a={monotonicSeconds:10,network:{id:'A',rx:100,tx:200}};
 const b={monotonicSeconds:12.5,network:{id:'A',rx:350,tx:200}};
 assert.deepEqual(L.rates(a,b),{rxBytesPerSecond:100,txBytesPerSecond:0});
 for(const c of [{...b,network:{...b.network,id:'VPN'}},{...b,monotonicSeconds:50},{...b,monotonicSeconds:9}])assert.equal(L.rates(a,c).rxBytesPerSecond,null);
 assert.equal(L.rates(a,{...b,network:{...b.network,rx:0}}).rxBytesPerSecond,null);
 assert.equal(L.rates(null,b).txBytesPerSecond,null);
});
test('NVIDIA MiB are binary bytes; unavailable VRAM is never zero',()=>{
 assert.equal(L.gpuCsv('NVIDIA GeForce RTX 2070, 1234, 8192').vramUsedBytes,1234*1048576);
 assert.equal(L.gpuCsv('NVIDIA GeForce RTX 2070, 0, 8192').vramUsedBytes,0);
 assert.equal(L.gpuCsv('NVIDIA GeForce RTX 2070, [N/A], 8192').vramUsedBytes,null);
});
test('weather retains provider measurement time instead of retrieval time',()=>{
 const p={current:{time:1700000000,temperature_2m:0,weather_code:61},current_units:{temperature_2m:'°C'}};
 assert.equal(L.weatherResult(p).updatedAt,'2023-11-14T22:13:20.000Z');
 assert.equal(L.weatherResult(p).data.temperatureC,0);
 assert.throws(()=>L.weatherResult({...p,current_units:{temperature_2m:'°F'}}));
});
test('Logitech selection excludes wired HERO and other devices; validates matched battery',()=>{
 const caps={hasBatteryStatus:true};
 const devices=[{id:'x',extendedDisplayName:'G502 X LIGHTSPEED Wireless Gaming Mouse',capabilities:caps},{id:'wired',extendedDisplayName:'G502 HERO',capabilities:caps},{id:'keyboard',extendedDisplayName:'G915 LIGHTSPEED',capabilities:caps}];
 const [d]=L.mouseDevice(devices);assert.equal(d.id,'x');assert.equal(L.mouseDevice(devices).length,1);
 assert.equal(L.mouseResult(d,{deviceId:'x',percentage:0,charging:true}).data.batteryPercent,0);
 assert.equal(L.mouseResult(d,{deviceId:'wired',percentage:95}),null);
 assert.equal(L.mouseResult(d,{deviceId:'x',percentage:101}),null);
});

test('weather carries provider day/night flag and never guesses an unsupported code',()=>{
 const p={current:{time:1700000000,temperature_2m:5,weather_code:0,is_day:0},current_units:{temperature_2m:'°C'}};
 assert.equal(L.weatherResult(p).data.isDay,false);
 assert.equal(L.weatherResult({...p,current:{...p.current,is_day:1}}).data.isDay,true);
 const unknown=L.weatherResult({...p,current:{...p.current,weather_code:255,is_day:2}});
 assert.equal(unknown.data.isDay,null);assert.equal(unknown.data.description,'Погода неизвестна');
});
