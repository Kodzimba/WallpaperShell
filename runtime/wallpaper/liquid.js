(function () {
  'use strict';
  // Image-space surface deformation, not a fluid-physics simulation or a video loop.
  const canvas=document.getElementById('liquidCanvas'), source=document.querySelector('.art img');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let gl,program,timeUniform,audioUniform,ready=false,lost=false,motion=true,paused=false,fps=20,frame=null,last=0,time=0,frames=0,lastDiagnostic=0;
  let audioAt=-Infinity,bass=0,energy=0,audio={bass:0,energy:0};
  const fallback=()=>{ready=false;canvas.hidden=true;source.parentElement.classList.remove('shader-ready');cancelAnimationFrame(frame);frame=null;};
  function sync(){
    const enabled=ready&&!lost&&motion&&!paused&&!reduced.matches;
    canvas.hidden=!enabled;source.parentElement.classList.toggle('shader-ready',enabled);
    if(!enabled){cancelAnimationFrame(frame);frame=null;}else if(frame===null){last=performance.now();frame=requestAnimationFrame(draw);}
  }
  function draw(now){
    frame=requestAnimationFrame(draw);
    const dt=now-last;
    if(dt<1000/fps)return;
    last=now;time+=Math.min(dt,100)/1000;
    const active=now-audioAt<400,targetBass=active?audio.bass:0,targetEnergy=active?audio.energy:0;
    bass+=(targetBass-bass)*(1-Math.exp(-Math.min(dt,100)/(targetBass>bass?65:400)));
    energy+=(targetEnergy-energy)*(1-Math.exp(-Math.min(dt,100)/(targetEnergy>energy?80:450)));
    gl.uniform1f(timeUniform,time);
    gl.uniform2f(audioUniform,bass,energy);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    ++frames;
    if(now-lastDiagnostic>=1000){canvas.dataset.frames=String(frames);canvas.dataset.audio=bass>.01||energy>.01?'reacting':'quiet';lastDiagnostic=now;}
  }
  function compile(type,text){const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Liquid shader compile');return s;}
  function initialize(){
    try{
      gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
      if(!gl)throw new Error('No WebGL');
      canvas.width=1280;canvas.height=720;
      program=gl.createProgram();
      gl.attachShader(program,compile(gl.VERTEX_SHADER,'attribute vec2 point; varying vec2 uv; void main(){uv=point*0.5+0.5;gl_Position=vec4(point,0.0,1.0);}'));
      gl.attachShader(program,compile(gl.FRAGMENT_SHADER,`
        precision mediump float; varying vec2 uv; uniform sampler2D image; uniform float time; uniform vec2 audio;
        void main(){
          vec2 p=vec2(uv.x,1.0-uv.y); float t=time*0.65;
          vec4 base=texture2D(image,p);
          float field=smoothstep(0.04,0.4,max(base.r,max(base.g,base.b)));
          float edge=smoothstep(0.0,0.12,p.x)*smoothstep(0.0,0.12,1.0-p.x)*smoothstep(0.0,0.12,p.y)*smoothstep(0.0,0.12,1.0-p.y);
          vec2 wave=vec2(sin(p.y*19.0+t)*cos(p.x*11.0-t*0.7),cos(p.x*16.0+t*0.8)*sin(p.y*13.0-t));
          p+=wave*vec2(0.014,0.011)*edge*(0.3+field*0.7)*(1.0+audio.x*0.4);
          vec4 color=texture2D(image,clamp(p,0.001,0.999));
          float violet=max(0.0,color.b-color.g)*0.025*sin(p.x*15.0+p.y*9.0-t);
          float response=max(0.0,color.b-color.g)*audio.y*0.09;
          gl_FragColor=vec4(color.rgb+vec3(violet*0.5+response*0.5,0.0,violet+response),1.0);
        }`));
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Liquid shader link');gl.useProgram(program);
      timeUniform=gl.getUniformLocation(program,'time');
      audioUniform=gl.getUniformLocation(program,'audio');
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
      const point=gl.getAttribLocation(program,'point');gl.enableVertexAttribArray(point);gl.vertexAttribPointer(point,2,gl.FLOAT,false,0,0);
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,source);gl.viewport(0,0,canvas.width,canvas.height);
      ready=true;sync();
    }catch{fallback();}
  }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;fallback();});
  canvas.addEventListener('webglcontextrestored',()=>{lost=false;initialize();});
  reduced.addEventListener('change',sync);
  window.VGLiquid={state(){return !motion?'off':paused?'paused':reduced.matches?'reduced':!ready||lost?'fallback':frames>0?'running':'starting';},audioState(){return !motion||paused||reduced.matches?'paused':performance.now()-audioAt<400&&(audio.bass>.01||audio.energy>.01)?'reacting':'quiet';},setAudio(value){audio={bass:Math.max(0,Math.min(1,Number(value?.bass)||0)),energy:Math.max(0,Math.min(1,Number(value?.energy)||0))};audioAt=performance.now();},setMotion(value){motion=!!value;sync();},setPaused(value){paused=!!value;if(paused){audioAt=-Infinity;bass=0;energy=0;}sync();},setFps(value){fps=Math.max(1,Math.min(20,Number(value)||20));}};
  if(source.complete&&source.naturalWidth)initialize();else source.addEventListener('load',initialize,{once:true});
})();
