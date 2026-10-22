'use strict';
// One owner for the expensive sources. A missing shared heartbeat does not
// refresh data; their original measurement times continue to expire normally.
class SourceCoordinator {
 constructor({readShared,startLocal,stopLocal,applyShared,isLocalBusy=()=>false,schedule=setTimeout,cancel=clearTimeout}){Object.assign(this,{readShared,startLocal,stopLocal,applyShared,isLocalBusy,schedule,cancel});this.mode='starting';this.failures=0;this.stopped=false;this.checking=false;this.timer=null;}
 async check(){
  if(this.stopped||this.checking)return;this.checking=true;
  try{
   const snapshot=await this.readShared();if(this.stopped)return;this.failures=0;
   if(this.mode==='local'&&this.isLocalBusy())return;
   if(this.mode==='local')this.stopLocal();this.mode='shared';this.applyShared(snapshot);
  }catch{
   if(this.stopped)return;this.failures++;
   if(this.mode==='starting'||this.mode==='shared'&&this.failures>=3){this.mode='local';this.startLocal();}
  }finally{this.checking=false;}
 }
 async tick(){await this.check();if(!this.stopped)this.timer=this.schedule(()=>this.tick(),2000);}
 start(){this.tick();}
 stop(){this.stopped=true;this.cancel(this.timer);if(this.mode==='local')this.stopLocal();}
}
module.exports={SourceCoordinator};
