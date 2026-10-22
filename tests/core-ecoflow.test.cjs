'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../runtime/companion/ecoflow.cjs');
test('official documented HMAC vector matches nested ASCII-sorted signature',()=>{
 // Public documentation example credentials, not a user account or production keys.
 const c={accessKey:'Fp4SvIprYSDPXtYJidEtUAd1o',secretKey:'WIbFEKre0s6sLnh4ei7SPUeYnptHG6V'};
 assert.equal(E.headers(c,{sn:'123456789',params:{cmdSet:11,id:24,eps:0}},345164,1671171709428).sign,'07c13b65e037faf3b153d51613638fa80003c4c38d2407379a7f52851af1473e');
});
test('DELTA 3 MAX mapping keeps zeros, rejects missing acquisition time and does not substitute Max Plus fields',()=>{
 assert.throws(()=>E.mapDeltaMax({cmsBattSoc:50},null));
 const r=E.mapDeltaMax({cmsBattSoc:0,powInSumW:0,powOutSumW:100},'2026-10-18T21:00:00Z');
 assert.deepEqual(r.data,{batteryPercent:0,inputWatts:0,outputWatts:100});
 assert.equal(E.mapDeltaMax({'pd.soc':90},r.updatedAt).data.batteryPercent,null);
});
test('EcoFlow adapter rejects control paths before performing any request',async()=>{
 await assert.rejects(E.get({},'/iot-open/sign/device/quota',{}),/Read-only path rejected/);
});
