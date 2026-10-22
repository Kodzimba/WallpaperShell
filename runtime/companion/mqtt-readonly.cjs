'use strict';
// MQTT 3.1.1 over validated WSS. Deliberately has no PUBLISH implementation.
const {EventEmitter}=require('node:events');
const MAX=256*1024;
function u16(n){const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;}
function str(s){const b=Buffer.from(s);if(b.length>65535)throw new Error('MQTT string too long');return Buffer.concat([u16(b.length),b]);}
function packet(type,body=Buffer.alloc(0)){
 if(![0x10,0x40,0x82,0xc0,0xe0].includes(type))throw new Error('Read-only MQTT packet rejected');
 if(body.length>MAX)throw new Error('MQTT packet too large');
 let n=body.length,bytes=[];do{let v=n%128;n=Math.floor(n/128);bytes.push(v|(n?128:0));}while(n);
 return Buffer.concat([Buffer.from([type,...bytes]),body]);
}
class Reader extends EventEmitter{
 constructor(){super();this.buffer=Buffer.alloc(0);}
 push(chunk){
  this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>MAX+5)throw new Error('MQTT buffer limit');
  while(this.buffer.length>1){
   const b=this.buffer;let size=0,m=1,i=1,complete=false;
   for(;i<b.length&&i<=4;i++){size+=(b[i]&127)*m;m*=128;if(!(b[i]&128)){i++;complete=true;break;}}
   if(!complete){if(i>4)throw new Error('MQTT length invalid');return;}
   if(size>MAX)throw new Error('MQTT frame limit');if(b.length<i+size)return;
   this.buffer=b.subarray(i+size);this.emit('packet',b[0],b.subarray(i,i+size));
  }
 }
}
class ReadOnlyMqtt extends EventEmitter{
 constructor({url,clientId,username,password,topics}){
  super();this.topics=new Set(topics);this.connected=false;this.stopped=false;this.lastPacket=Date.now();
  const ws=this.ws=new WebSocket(url,'mqtt');ws.binaryType='arraybuffer';const reader=new Reader();
  this.deadline=setTimeout(()=>this.fail('MQTT connect timeout'),15000);
  ws.addEventListener('open',()=>this.send(packet(0x10,Buffer.concat([str('MQTT'),Buffer.from([4,0xc2,0,60]),str(clientId),str(username),str(password)]))));
  ws.addEventListener('message',event=>{try{if(!(event.data instanceof ArrayBuffer))throw new Error();reader.push(Buffer.from(event.data));}catch{this.fail('MQTT frame rejected');}});
  ws.addEventListener('error',()=>this.fail('MQTT transport unavailable'));
  ws.addEventListener('close',()=>{this.cleanup();this.emit('closed');});
  reader.on('packet',(type,body)=>{
   this.lastPacket=Date.now();
   if(type===0x20){
    if(this.connected||body.length!==2||body[1]!==0){this.fail('MQTT authentication refused');return;}
    this.connected=true;clearTimeout(this.deadline);
    this.send(packet(0x82,Buffer.concat([u16(1),...topics.flatMap(t=>[str(t),Buffer.from([1])])])));
    this.ping=setInterval(()=>{if(Date.now()-this.lastPacket>90000)this.fail('MQTT keepalive timeout');else this.send(packet(0xc0));},25000);
   }else if(type===0x90){
    if(body.length!==2+topics.length||body.readUInt16BE(0)!==1||body.subarray(2).some(q=>![0,1,128].includes(q))){this.fail('MQTT subscription invalid');return;}
    const accepted=[...body.subarray(2)].map(q=>q!==128);if(!accepted.some(Boolean)){this.fail('MQTT subscriptions refused');return;}
    this.emit('ready',accepted);
   }else if((type>>4)===3){
    if(!this.connected||body.length<2)return;const length=body.readUInt16BE(0);if(body.length<2+length)return;
    const topic=body.subarray(2,2+length).toString(),qos=(type>>1)&3;let start=2+length;
    if(qos>1){this.fail('Unsupported MQTT QoS');return;}
    if(qos===1){if(body.length<start+2)return;this.send(packet(0x40,body.subarray(start,start+2)));start+=2;}
    if(this.topics.has(topic))this.emit('message',{topic,payload:body.subarray(start),retained:!!(type&1),duplicate:!!(type&8)});
   }
  });
 }
 send(b){if(!this.stopped&&this.ws.readyState===WebSocket.OPEN)this.ws.send(b);}
 cleanup(){clearTimeout(this.deadline);clearInterval(this.ping);this.connected=false;}
 fail(reason){if(this.stopped)return;this.emit('failure',reason);this.stop();}
 stop(){if(this.stopped)return;this.stopped=true;this.cleanup();try{if(this.ws.readyState===WebSocket.OPEN)this.ws.send(packet(0xe0));this.ws.close();}catch{}}
}
module.exports={Reader,ReadOnlyMqtt,packet};
