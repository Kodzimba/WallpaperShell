'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fixture=require('./helpers/luna-scene-fixture.cjs');

test('idle scene retains its first image with no RAF, timers, spectrum or style work',()=>{
 const f=fixture();f.load();const loaded={...f.counts};f.advance(10000);
 assert.deepEqual(f.counts,loaded);assert.equal(f.counts.water,1);assert.equal(f.counts.raf,0);assert.equal(f.counts.timers,0);
 assert.equal(f.counts.spectrum,1);assert.equal(f.counts.shaderDeletes,2);assert.equal(f.work.size,0);
 assert.equal(f.nodes.lunaWater.width,1600);assert.equal(f.nodes.lunaWater.height,900);
 assert.equal(f.uniforms.dropCount,0);assert.equal(f.api.diagnostics().glError,0);
 assert.equal(f.api.diagnostics().clock,0);assert.equal(f.api.diagnostics().waterFps,0);assert.equal(f.api.diagnostics().renderFps,0);assert(f.api.diagnostics().sleeping&&f.api.diagnostics().waterSleeping);
 assert.equal(f.attributes.depth,false);assert.equal(f.attributes.stencil,false);assert.equal(f.attributes.preserveDrawingBuffer,false);
});

test('pointer immediately wakes the full water cadence and returns to the idle budget when ripples expire',()=>{
 const f=fixture();f.load();f.advance(1000);const before=f.counts.water;f.pointer();f.advance(17);const clock=f.api.diagnostics().clock;
 assert.equal(f.counts.water,before+1);assert.equal(f.api.diagnostics().waterFps,24);assert.equal(f.api.diagnostics().renderFps,24);
 f.advance(2000);assert(f.counts.water-before>=39);assert(f.counts.water-before<=49);assert(Math.abs(f.api.diagnostics().clock-clock-2)<.06);
 f.advance(6000);assert.equal(f.api.diagnostics().waterFps,0);assert.equal(f.api.diagnostics().pointerDrops,0);assert.equal(f.work.size,0);const water=f.counts.water;f.advance(5000);assert.equal(f.counts.water,water);f.pointer();f.advance(17);assert.equal(f.counts.water,water+1);
});

test('music keeps moon brightness and spectrum responsive while water sleeps',()=>{
 const f=fixture();f.load();f.advance(1000);const before={...f.counts};for(let i=0;i<50;i++){f.audio(.2+(i%7)*.01);f.advance(40);}
 assert.equal(f.api.diagnostics().renderFps,24);assert.equal(f.api.diagnostics().waterFps,0);assert(f.counts.spectrum-before.spectrum>=38);assert.equal(f.counts.water,before.water);assert(f.api.diagnostics().audio>.1);assert(f.styleWrites.filter>2);assert.notEqual(f.nodes.lunaMoon.style.filter,'brightness(0.790) drop-shadow(0 0 12.0px rgba(163,210,255,0.190))');
});

test('the single opaque moon keeps its brightness response on a promoted layer without animated drop-shadow',()=>{
 const f=fixture();f.load();assert.equal(f.api.diagnostics().moonMaterial,'brightness-only');assert.equal(f.nodes.lunaMoon.style.willChange,'filter,transform');assert.equal(f.nodes.lunaMoon.style.opacity,undefined);assert.equal(f.nodes.lunaMoon.style.filter,'brightness(0.790)');
 f.audio(.8);f.advance(150);assert(Number(f.nodes.lunaMoon.style.filter.match(/[\d.]+/)[0])>1.2);assert(!f.nodes.lunaMoon.style.filter.includes('drop-shadow'));assert(Number(f.nodes.glow.style.opacity)>.19);f.api.setPaused(true);assert.equal(f.nodes.lunaMoon.style.filter,'brightness(0.790)');assert.equal(f.work.size,0);
});

test('continuous silent and noisy-silent native packets do not wake the 24fps layer or label silence as sound',()=>{
 const f=fixture();f.load();const loaded={...f.counts};for(let i=0;i<250;i++){f.audio(i%2?0:1e-7);f.advance(40);}
 assert.equal(f.api.diagnostics().renderFps,0);assert.deepEqual(f.counts,loaded);assert.equal(f.work.size,0);assert.equal(f.nodes.lunaSignal.textContent,'ОЖИДАНИЕ ЗВУКА');
});

test('pause, motion and hidden lifecycle cancel both timer and RAF; repeated values cannot restart frames',()=>{
 const f=fixture();f.load();const first=[...f.work.keys()];for(let i=0;i<20;i++){f.api.setPaused(false);f.api.setMotion(true);}assert.deepEqual([...f.work.keys()],first);
 f.audio();f.advance(100);assert(f.api.diagnostics().audio>0);assert(f.counts.strokes>0);
 f.api.setPaused(true);assert.equal(f.work.size,0);const paused={...f.counts};f.audio(1);f.advance(1000);assert.deepEqual(f.counts,paused);assert.equal(f.api.diagnostics().audio,0);
 f.api.setPaused(false);f.advance(100);assert.equal(f.api.diagnostics().audio,0);assert.equal(f.work.size,0);f.audio();assert(f.work.size>0);
 f.document.hidden=true;f.emit('document','visibilitychange');const hidden={...f.counts};f.advance(1000);assert.equal(f.work.size,0);assert.deepEqual(f.counts,hidden);
 f.document.hidden=false;f.emit('document','visibilitychange');f.advance(100);assert.equal(f.work.size,0);f.pointer();assert(f.work.size>0);
 f.api.setMotion(false);assert.equal(f.work.size,0);const off={...f.counts};f.advance(1000);assert.deepEqual(f.counts,off);
 f.api.setMotion(true);f.audio();f.advance(100);f.emit('window','pagehide');assert.equal(f.work.size,0);f.emit('window','pageshow');assert.equal(f.work.size,0);f.audio();assert(f.work.size>0);
});

test('real finite audio animates the moon and spectrum then reaches a fully idle overlay after silence',()=>{
 const f=fixture();f.load();f.audio(.2);f.advance(100);assert(f.api.diagnostics().audio>.1);assert(f.counts.strokes>0);assert.notEqual(f.nodes.lunaMoon.style.transform,'scale(1.0000)');
 f.advance(5000);assert.equal(f.api.diagnostics().audio,0);assert.equal(f.nodes.lunaMoon.style.transform,'scale(1.0000)');const styles=f.counts.styles,clears=f.counts.spectrum;f.advance(2000);assert.equal(f.counts.styles,styles);assert.equal(f.counts.spectrum,clears);
 f.api.setAudio({energy:Infinity});f.emit('window','daylight:audio',{detail:Array(64).fill(NaN)});f.advance(100);assert.equal(f.api.diagnostics().audio,0);
});

test('pointer ripples keep their strength and 24-drop limit, expire, and do not upload stale drop slots',()=>{
 const f=fixture();f.load();for(let i=0;i<30;i++){f.pointer(500+i*10,400);f.advance(50);}assert.equal(f.api.diagnostics().pointerDrops,24);assert.equal(f.uniforms.dropCount,24);assert(f.uniforms['drops[0]'][3]>.5);
 f.advance(7500);assert.equal(f.api.diagnostics().pointerDrops,0);assert.equal(f.uniforms.dropCount,0);
 f.reduce.matches=true;f.emit('reduce','change');assert.equal(f.work.size,0);const before=f.counts.water;f.pointer();f.advance(500);assert.equal(f.counts.water,before);
});

test('restored WebGL context rebuilds resources and resumes without creating extra render loops',()=>{
 const f=fixture();f.load();f.advance(100);f.emit('water','webglcontextlost',{preventDefault(){}});const before=f.counts.water;f.advance(100);assert.equal(f.counts.water,before);assert.equal(f.nodes.lunaWater.hidden,true);
 f.emit('water','webglcontextrestored');f.load();f.advance(100);assert(f.counts.water>before);assert.equal(f.nodes.lunaWater.hidden,false);assert.equal(f.counts.shaderDeletes,4);assert.equal(f.work.size,0);const restored=f.counts.water;f.pointer();f.advance(17);assert(f.counts.water>restored);
});

test('reduced motion restores the quiet moon material, stops both schedulers and resumes only on new interaction',()=>{
 const f=fixture();f.load();f.audio(.7);f.pointer();f.advance(150);assert.notEqual(f.nodes.lunaMoon.style.transform,'scale(1.0000)');f.reduce.matches=true;f.emit('reduce','change');assert.equal(f.nodes.lunaMoon.style.transform,'scale(1.0000)');assert.equal(f.work.size,0);const reduced={...f.counts};f.audio(.7);f.pointer();f.advance(1000);assert.deepEqual(f.counts,reduced);f.reduce.matches=false;f.emit('reduce','change');assert.equal(f.work.size,0);f.audio(.7);f.advance(100);assert.notEqual(f.nodes.lunaMoon.style.transform,'scale(1.0000)');
});

test('routine telemetry never polls the GPU error queue; explicit QA probes report their age and refresh cached errors',()=>{
 const f=fixture();f.load();assert.equal(f.counts.errorProbes,1);assert.equal(f.api.diagnostics().glErrorProbeAge,0);
 f.advance(2000);f.setProbeError(1282);for(let i=0;i<100;i++)assert.equal(f.api.diagnostics().glError,0);assert.equal(f.counts.errorProbes,1);assert.equal(f.api.diagnostics().glErrorProbeAge,2000);
 const probe=f.api.diagnostics({probeErrors:true});assert.equal(probe.glError,1282);assert.equal(probe.glErrorProbeAge,0);assert.equal(f.counts.errorProbes,2);
 f.advance(500);assert.equal(f.api.diagnostics().glError,1282);assert.equal(f.api.diagnostics().glErrorProbeAge,500);assert.equal(f.counts.errorProbes,2);
});
