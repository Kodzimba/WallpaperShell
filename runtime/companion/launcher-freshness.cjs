'use strict';
const DAY=24*60*60*1000;
function normalize(value){
 const records={};
 if(!value||typeof value!=='object'||Array.isArray(value))return records;
 for(const [id,record]of Object.entries(value))if(/^[a-f0-9]{64}$/.test(id)&&record&&typeof record.identity==='string'&&record.identity.length>0&&record.identity.length<=160&&Number.isSafeInteger(record.at)&&record.at>=0)records[id]={identity:record.identity,at:record.at};
 return records;
}
function observe(previous,initialized,files,now){
 const before=normalize(previous),byIdentity=new Map(Object.values(before).map(record=>[record.identity,record])),records={};
 for(const file of files){
  const same=before[file.id]?.identity===file.identity?before[file.id]:byIdentity.get(file.identity);
  // The first migration uses creation time, so existing old files do not all
  // become "new". Later arrivals retain their first observation across restarts.
  const baseline=Number.isFinite(file.createdAt)&&file.createdAt>0&&file.createdAt<=now?Math.floor(file.createdAt):0;
  records[file.id]={identity:file.identity,at:same?same.at:initialized?now:baseline};
 }
 const changed=Object.keys(before).length!==Object.keys(records).length||Object.entries(records).some(([id,record])=>before[id]?.identity!==record.identity||before[id]?.at!==record.at);
 return {records,changed};
}
function until(record){return record?.at>0?record.at+DAY:null;}
module.exports={DAY,normalize,observe,until};
