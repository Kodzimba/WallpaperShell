'use strict';
// Bounded protobuf wire reader; only documented Delta 3 telemetry fields are mapped.
function fields(b){
 if(!Buffer.isBuffer(b)||b.length>262144)throw new Error('Protobuf limit');let i=0;const out=new Map();
 function integer(){let n=0n;for(let k=0;k<10;k++){if(i>=b.length)throw new Error('Truncated varint');const x=b[i++];if(k===9&&x>1)throw new Error('Varint overflow');n|=BigInt(x&127)<<BigInt(7*k);if(!(x&128))return Number(n);}throw new Error('Varint overflow');}
 while(i<b.length){
  const tag=integer(),id=Math.floor(tag/8),wire=tag%8;if(!id||id>536870911)throw new Error('Invalid tag');let value;
  if(wire===0)value=integer();
  else if(wire===2){const size=integer();if(size>b.length-i)throw new Error('Truncated bytes');value=b.subarray(i,i+size);i+=size;}
  else if(wire===5){if(i+4>b.length)throw new Error('Truncated float');value=b.readFloatLE(i);i+=4;}
  else if(wire===1){if(i+8>b.length)throw new Error('Truncated fixed64');value=b.subarray(i,i+8);i+=8;}
  else throw new Error('Unsupported wire type');
  if(!out.has(id))out.set(id,[]);out.get(id).push({wire,value});
 }return out;
}
function one(f,id,wire){const v=f.get(id)?.at(-1);return v?.wire===wire?v.value:undefined;}
function decode(payload){
 const outer=fields(payload),frames=[];
 for(const h of outer.get(1)||[]){
  if(h.wire!==2)continue;const f=fields(h.value),func=one(f,8,0),cmd=one(f,9,0),data=one(f,1,2);
  const frame={func,cmd,deviceTime:one(f,18,0),sequence:one(f,14,0),encrypted:one(f,6,0)||0,values:{}};
  if(data&&frame.encrypted===0){const p=fields(data);
   if(func===254&&cmd===21){for(const [id,key] of [[3,'inputWatts'],[4,'outputWatts'],[262,'batteryPercent']]){const v=one(p,id,5);if(Number.isFinite(v)&&v>=0&&(key!=='batteryPercent'||v<=100))frame.values[key]=v;}}
   if(func===32&&cmd===2){const pack=one(p,1,2);if(pack){const v=fields(pack),soc=one(v,15,5)??one(v,9,0);if(Number.isFinite(soc)&&soc>=0&&soc<=100)frame.values.batteryPercent=soc;}}
  }
  frames.push(frame);
 }return frames;
}
module.exports={fields,one,decode};
