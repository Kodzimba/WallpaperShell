'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=function sceneFixture(source){
 let now=1000,nextId=0,probeError=0;const work=new Map(),events=new Map(),images=[],uniforms={},attributes={},counts={raf:0,timers:0,water:0,spectrum:0,strokes:0,styles:0,shaderDeletes:0,errorProbes:0};
 function eventTarget(name){return {addEventListener(type,fn){events.set(name+':'+type,fn);}};}
 const styleWrites={};const style=()=>new Proxy({},{set(object,key,value){counts.styles++;styleWrites[key]=(styleWrites[key]||0)+1;object[key]=value;return true;}});
 const gl=new Proxy({getShaderParameter:()=>true,getProgramParameter:()=>true,isContextLost:()=>false,getError:()=>{counts.errorProbes++;return probeError;},createShader:()=>({}),createProgram:()=>({}),createBuffer:()=>({}),createTexture:()=>({}),getUniformLocation:(_,key)=>key,uniform1f:(key,value)=>uniforms[key]=value,uniform1i:(key,value)=>uniforms[key]=value,uniform2f:(key,...values)=>uniforms[key]=values,uniform4fv:(key,values)=>uniforms[key]=Array.from(values),drawArrays:()=>counts.water++,deleteShader:()=>counts.shaderDeletes++},{get:(object,key)=>key in object?object[key]:(()=>{})});
 const ctx=new Proxy({clearRect:()=>counts.spectrum++,stroke:()=>counts.strokes++},{get:(object,key)=>key in object?object[key]:(()=>{})});
 const nodes={stage:{...eventTarget('stage'),getBoundingClientRect:()=>({left:0,top:0,width:1920,height:1080})},lunaWater:{...eventTarget('water'),getContext:(_,options)=>{Object.assign(attributes,options);return gl;}},lunaMoon:{style:style()},lunaSpectrum:{width:800,height:800,clientWidth:570,clientHeight:570,getContext:()=>ctx},lunaSignal:{textContent:''},glow:{style:style()}};
 nodes.lunaMoon.cloneNode=()=>({style:style(),setAttribute(){}});nodes.lunaMoon.after=highlight=>{nodes.highlight=highlight;};
 const document={...eventTarget('document'),hidden:false,getElementById:id=>nodes[id],querySelector:selector=>selector==='.luna-glow'?nodes.glow:null};
 const reduce={...eventTarget('reduce'),matches:false};
 function schedule(fn,at,kind){const id=++nextId;work.set(id,{fn,at,kind});return id;}
 const context={...eventTarget('window'),document,performance:{now:()=>now},matchMedia:()=>reduce,Image:class{constructor(){images.push(this);this.width=1920;this.height=1080;}},requestAnimationFrame:fn=>schedule(fn,(Math.floor(now/(1000/60)+.000001)+1)*(1000/60),'raf'),cancelAnimationFrame:id=>work.delete(id),setTimeout:(fn,delay)=>schedule(fn,now+Math.max(0,delay),'timers'),clearTimeout:id=>work.delete(id)};context.window=context;
 vm.runInNewContext(source||fs.readFileSync(path.join(__dirname,'../../runtime/themes/luna-blue/scene.js'),'utf8'),context);
 function emit(scope,type,event={}){events.get(scope+':'+type)?.(event);}
 return {api:context.VGLiquid,counts,styleWrites,nodes,uniforms,attributes,reduce,document,work,emit,setProbeError(value){probeError=value;},load(){images.at(-1).onload();},advance(ms){const end=now+ms;for(let safety=0;safety<100000;safety++){const next=[...work].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;work.delete(next[0]);now=next[1].at;counts[next[1].kind]++;next[1].fn(now);}now=end;},pointer(x=950,y=500){emit('stage','pointermove',{clientX:x,clientY:y,target:{closest:()=>false}});},audio(value=.1){context.VGLiquid.setAudio({energy:value});emit('window','daylight:audio',{detail:Array(64).fill(value)});}};
};
