(function(){
 'use strict';
 const canvas=document.getElementById('liquidCanvas'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let gl=null,program=null,shadow=null,buffer=null,quad=null,vertices=0,frame=0,last=0,clock=0,paused=false,motion=true,fps=24,audio=0,target=0,ready=false,draws=0,lastDraw=0,aspect=800/752,palette={background:[202/255,1,0]};
 const vertex=`attribute vec2 a;uniform float time;uniform float energy;uniform float aspect;varying vec3 normal;varying vec3 point;
 const float PI=3.14159265;
 vec3 corner(float i){float r=PI*.5-i*2.*PI/3.;return vec3(cos(r)*1.32,sin(r)*1.32,0.);}
 vec3 center(float t){float q=mod(t/(2.*PI)*6.,6.);float i=floor(q/2.);float f=mod(q,2.);vec3 v=corner(i),prev=corner(i-1.),next=corner(i+1.);vec3 start=mix(v,prev,.22),end=mix(v,next,.22);vec3 c;if(f<1.){c=mix(mix(start,v,f),mix(v,end,f),f);}else{c=mix(end,mix(next,v,.22),f-1.);}c.z=.15*sin(t*3.+.5)+energy*.32*sin(t*3.-time*1.8);c.xy*=1.+energy*.07*sin(t*3.+time*4.);return c;}
 vec3 shape(vec2 uv){float t=uv.x,u=uv.y;vec3 c=center(t);vec3 tangent=normalize(center(t+.002)-center(t-.002));vec3 radial=normalize(cross(tangent,vec3(0.,0.,1.)));vec3 binormal=normalize(cross(radial,tangent));float twist=.32*sin(t*3.+.6)+.22+energy*.5*sin(t*3.-time*2.);float x=sign(cos(u))*pow(abs(cos(u)),.42),y=sign(sin(u))*pow(abs(sin(u)),.42);float w=.31+energy*(.11+.03*sin(t*12.-time*3.));return c+w*((cos(twist)*radial+sin(twist)*binormal)*x+(-sin(twist)*radial+cos(twist)*binormal)*y);}
 mat3 rotate(){float x=.26+sin(time*.43)*.12,y=-.3+sin(time*.32)*.28+energy*.2,z=-.11+sin(time*.23)*.06+energy*.05;mat3 rx=mat3(1,0,0,0,cos(x),sin(x),0,-sin(x),cos(x));mat3 ry=mat3(cos(y),0,-sin(y),0,1,0,sin(y),0,cos(y));mat3 rz=mat3(cos(z),sin(z),0,-sin(z),cos(z),0,0,0,1);return rz*ry*rx;}
 void main(){vec3 p=shape(a);vec3 dt=shape(a+vec2(.001,0.))-shape(a-vec2(.001,0.));vec3 du=shape(a+vec2(0.,.001))-shape(a-vec2(0.,.001));mat3 r=rotate();normal=normalize(r*cross(du,dt));point=r*p;point.y+=.02;gl_Position=vec4(point.x/(1.8*aspect),point.y/1.8,point.z/5.,1.);}`;
 const fragment=`precision mediump float;varying vec3 normal;varying vec3 point;
 float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
 void main(){vec3 n=normalize(normal);if(!gl_FrontFacing)n=-n;float grain=hash(floor(point*240.));n=normalize(n+(grain-.5)*.055);vec3 light=normalize(vec3(-1.3,2.,3.));float diffuse=max(dot(n,light),0.);float fill=max(dot(n,normalize(vec3(1.,-.1,1.))),0.);float spec=pow(max(dot(reflect(-light,n),vec3(0,0,1)),0.),24.);float rim=pow(1.-abs(n.z),3.);float shade=.019+diffuse*.12+fill*.028+spec*.23+rim*.07+(grain-.5)*.012;vec3 material=vec3(shade)*vec3(.94,.96,1.);gl_FragColor=vec4(material,1.);}`;
 function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Polymer shader compile');return s;}
 function link(v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Polymer shader link');return p;}
 function fitCanvas(){
  const width=canvas.clientWidth,height=canvas.clientHeight;
  if(!(width>0&&height>0))return;
  aspect=width/height;
  // Match the displayed aspect while retaining the previous GPU pixel budget.
  const scale=Math.min(800/width,752/height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 }
 function init(){
  gl=canvas.getContext('webgl',{alpha:false,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:false});if(!gl)throw Error('WebGL unavailable');
  program=link(vertex,fragment);const mesh=[];const nt=192,nu=24,PI=Math.PI*2;
  for(let i=0;i<nt;i++)for(let j=0;j<nu;j++){const t=i/nt*PI,u=j/nu*PI,dt=PI/nt,du=PI/nu;mesh.push(t,u,t+dt,u,t,u+du,t+dt,u,t+dt,u+du,t,u+du);}
  buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh),gl.STATIC_DRAW);vertices=mesh.length/2;
  shadow=link('attribute vec2 a;varying vec2 uv;void main(){uv=a*.5+.5;gl_Position=vec4(a,0,1);}','precision mediump float;uniform vec3 backgroundColor;uniform float aspect;varying vec2 uv;void main(){vec2 p=(uv-vec2(.5,.16))/vec2(.36/aspect,.027);float s=exp(-dot(p,p))*.22;gl_FragColor=vec4(backgroundColor*(1.-s),1.);}');
  quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);canvas.width=800;canvas.height=752;fitCanvas();
  ready=true;canvas.dataset.renderer='webgl-geometry';draw();start();
 }
 function draw(){if(!ready)return;draws++;lastDraw=performance.now();gl.viewport(0,0,canvas.width,canvas.height);gl.disable(gl.DEPTH_TEST);gl.useProgram(shadow);gl.uniform3fv(gl.getUniformLocation(shadow,'backgroundColor'),palette.background);gl.uniform1f(gl.getUniformLocation(shadow,'aspect'),aspect);gl.bindBuffer(gl.ARRAY_BUFFER,quad);let at=gl.getAttribLocation(shadow,'a');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,6);gl.clear(gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);at=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);gl.uniform1f(gl.getUniformLocation(program,'time'),motion&&!reduce.matches?clock:0);gl.uniform1f(gl.getUniformLocation(program,'energy'),motion&&!reduce.matches?audio:0);gl.uniform1f(gl.getUniformLocation(program,'aspect'),aspect);gl.drawArrays(gl.TRIANGLES,0,vertices);}
 function running(){return ready&&!paused&&motion&&!reduce.matches&&!document.hidden;}
 function tick(now){frame=0;if(!running())return;if(now-last>=1000/fps){const dt=Math.min(.1,(now-last)/1000)||0;last=now;clock+=dt;audio+=(target-audio)*(1.-Math.exp(-dt*(target>audio?20.:7.)));target*=Math.exp(-dt*1.8);draw();}frame=requestAnimationFrame(tick);}
 function start(){cancelAnimationFrame(frame);frame=0;last=performance.now();if(running())frame=requestAnimationFrame(tick);else draw();}
 canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;cancelAnimationFrame(frame);canvas.dataset.renderer='context-lost';});canvas.addEventListener('webglcontextrestored',()=>{try{init();}catch{}});
 window.VGLiquid={setPalette:value=>{if(!value||!Array.isArray(value.background)||value.background.length!==3||!value.background.every(v=>Number.isFinite(v)&&v>=0&&v<=1))return;palette={background:value.background};if(ready)draw();},diagnostics:()=>({frames:draws,frameAge:Math.max(0,performance.now()-lastDraw),clock,audio,aspect,cssWidth:canvas.clientWidth||0,cssHeight:canvas.clientHeight||0,bufferWidth:canvas.width,bufferHeight:canvas.height,glError:gl?.getError(),contextLost:!!gl?.isContextLost()}),setPaused:value=>{if(paused===!!value)return;paused=!!value;start();},setMotion:value=>{if(motion===!!value)return;motion=!!value;start();},setFps:value=>{fps=Math.max(10,Math.min(24,Number(value)||24));},setAudio:value=>{const level=Number(value?.energy||0)*.4+Number(value?.bass||0)*.6;target=Number.isFinite(level)?Math.max(0,Math.min(1,level)):0;},state:()=>ready?running()?'polymer':'still':'unavailable',audioState:()=>target>.005?'reactive':'silent'};
 function resize(){fitCanvas();draw();}
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe(canvas);else window.addEventListener?.('resize',resize);
 reduce.addEventListener('change',start);document.addEventListener('visibilitychange',start);
 if(window.VGAppearance)palette=window.VGAppearance.palette();
 try{init();}catch{canvas.dataset.renderer='unavailable';canvas.setAttribute('aria-label','WebGL недоступен: сцена не отрисована');}
})();
