(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VGCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 1920, HEIGHT = 1080;
  const layouts = {
    clock:[1310,64,610,242],weather:[1310,306,610,76],calendar:[1310,382,610,266],
    system:[1310,648,610,74],network:[1310,722,610,116],media:[664,650,622,176],
    openwindows:[640,838,640,242],notifications:[1280,838,640,242],
    screens:[24,604,592,66],audio:[24,670,592,84],mouse:[24,754,592,100],ecoflow:[24,854,592,142]
  };
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let partsZone, partsFormatter;
  function dateParts(date = new Date(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
    if (!partsFormatter || partsZone !== zone) {
      partsFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      });
      partsZone = zone;
    }
    const p = Object.fromEntries(partsFormatter.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
    return {year: +p.year, month: +p.month, day: +p.day, hour: p.hour, minute: p.minute, second: p.second};
  }
  function calendar(year, month) {
    return {offset: (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7,
      days: new Date(Date.UTC(year, month, 0)).getUTCDate()};
  }
  function shiftMonth(year, month, delta) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    return {year: d.getUTCFullYear(), month: d.getUTCMonth() + 1};
  }
  function percent(used, total) {
    return finite(used) && used >= 0 && finite(total) && total > 0 ? clamp(used / total * 100, 0, 100) : null;
  }
  function number(value, digits = 0) { return finite(value) ? value.toFixed(digits) : '—'; }
  function nonnegative(value) { return finite(value) && value >= 0 ? value : null; }
  function battery(value) { return finite(value) && value >= 0 && value <= 100 ? value : null; }
  function gib(bytes) { return finite(bytes) && bytes >= 0 ? (bytes / 1073741824).toFixed(1) : '—'; }
  function mbps(bytesPerSecond) { return finite(bytesPerSecond) && bytesPerSecond >= 0 ? (bytesPerSecond * 8 / 1e6).toFixed(1) : '—'; }
  function duration(seconds) {
    if (!finite(seconds) || seconds < 0) return '—:—';
    const s = Math.floor(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  // Each source has its own acquisition time. A fresh HTTP reply cannot refresh old measurements.
  function sourceState(source, now = Date.now(), maxAgeMs = 15000) {
    if (!source || source.status !== 'ok') return source?.status === 'error' ? 'error' : 'unavailable';
    const t = Date.parse(source.updatedAt);
    if (!Number.isFinite(t) || t > now + 30000) return 'unavailable';
    return now - t > maxAgeMs ? 'stale' : 'ok';
  }
  function bridgeUrl(value) {
    if (!value || !String(value).trim()) return '';
    try {
      const u = new URL(String(value).trim());
      if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password) return null;
      u.hash = ''; return u.href;
    } catch (_) { return null; }
  }
  // RAM and VRAM are sampled independently. A fresh field never renews another
  // field's timestamp, and a failed GPU read must not hide a fresh RAM reading.
  function freshSystem(source,now=Date.now(),maxAgeMs=15000){
    if(!source||source.status!=='ok'||!source.data)return source;
    const data={...source.data},times=[],measurements=source.measurements||{},known=[];
    for(const [key,fields]of [['ram',['ramUsedBytes','ramTotalBytes']],['vram',['vramUsedBytes','vramTotalBytes']]]){
      const at=Object.hasOwn(measurements,key)?measurements[key]:source.updatedAt;
      if(Number.isFinite(Date.parse(at)))known.push(at);
      if(sourceState({...source,updatedAt:at},now,maxAgeMs)==='ok'&&fields.some(field=>finite(data[field])))times.push(at);
      else for(const field of fields)data[field]=null;
    }
    const updatedAt=times.length?times.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]:known.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
    return {...source,data,updatedAt};
  }
  function layout(id, value) {
    const base = layouts[id];
    const raw = value && typeof value === 'object' ? value : {};
    const s = finite(raw.s) ? clamp(raw.s, 0.65, Math.min(1.7, WIDTH / base[2], HEIGHT / base[3])) : 1;
    return {x: clamp(finite(raw.x) ? raw.x : base[0], 0, WIDTH - base[2] * s),
      y: clamp(finite(raw.y) ? raw.y : base[1], 0, HEIGHT - base[3] * s), s};
  }
  function mediaPosition(media, now) {
    const base=nonnegative(media.position);if(base===null)return null;
    const at=Date.parse(media.positionAt),rate=finite(media.rate)?media.rate:1;
    const delta=media.playback==='playing'&&Number.isFinite(at)&&now>=at?(now-at)/1000*rate:0;
    return finite(media.duration)&&media.duration>0?clamp(base+delta,0,media.duration):Math.max(0,base+delta);
  }
  function audioBars(samples, count = 40) {
    if (!samples || samples.length !== 128) return Array(count).fill(0);
    return Array.from({length: count}, (_, i) => {
      const start = Math.floor(i * 64 / count), end = Math.max(start + 1, Math.floor((i + 1) * 64 / count));
      let total = 0;
      for (let k = start; k < end; k++) total += clamp(finite(samples[k]) ? samples[k] : 0, 0, 1) + clamp(finite(samples[k + 64]) ? samples[k + 64] : 0, 0, 1);
      return total / ((end - start) * 2);
    });
  }
  function artworkKind(width,height) {
    if (!finite(width)||!finite(height)||width<=0||height<=0) return 'square';
    return width/height>=1.2?'wide':width/height<=.8?'portrait':'square';
  }
  // Open-Meteo WMO interpretation codes; no broad numeric ranges for unknown codes.
  const weatherGroups=[
    [[0],'sun','Ясно'],[[1],'partly','Малооблачно'],[[2],'partly','Переменная облачность'],[[3],'cloud','Облачно'],
    [[45],'fog','Туман'],[[48],'fog','Туман с изморозью'],[[51,53,55],'drizzle','Морось'],[[56,57],'ice-rain','Ледяная морось'],
    [[61,63,65],'rain','Дождь'],[[66,67],'ice-rain','Ледяной дождь'],[[71,73,75],'snow','Снег'],[[77],'snow','Снежные зёрна'],
    [[80,81,82],'showers','Ливень'],[[85,86],'snow-showers','Снегопад'],[[95],'thunder','Гроза'],[[97],'thunder','Сильная гроза'],[[96,99],'hail','Гроза с градом']
  ];
  function weatherInfo(code,isDay) {
    const group=weatherGroups.find(g=>g[0].includes(code));
    if(!group)return {icon:'unknown',description:'Погода неизвестна'};
    let icon=group[1];if(isDay===false){if(icon==='sun')icon='moon';else if(icon==='partly')icon='partly-night';}
    return {icon,description:group[2]};
  }
  function audioHeight(value) {
    // Fixed visual gain, not generated activity or playback volume control.
    if (!finite(value)||value<=.00002) return 0;
    const level=clamp(value-.00002,0,1);
    return Math.round(Math.sqrt(level/(level+.024))*100);
  }
  function audioResponse(samples){
    if(!samples||samples.length!==128)return {bass:0,energy:0};
    let bass=0,energy=0;
    for(let i=1;i<49;i++){const v=(clamp(finite(samples[i])?samples[i]:0,0,1)+clamp(finite(samples[i+64])?samples[i+64]:0,0,1))/2;energy+=v;if(i<=7)bass+=v;}
    const compress=v=>{const level=Math.max(0,v-.00002);return Math.sqrt(level/(level+.04));};
    return {bass:compress(bass/7),energy:compress(energy/48)};
  }
  function runtimeText(minutes){if(!finite(minutes)||minutes<0)return '—';const m=Math.round(minutes);return m>=60?`≈${Math.floor(m/60)} ч${m%60?' '+m%60+' мин':''}`:`≈${m} мин`;}
  function loadPlot(points,now=Date.now()){
    const valid=Array.isArray(points)?points.filter(p=>p&&finite(p.at)&&p.at<=now&&now-p.at<1200000&&finite(p.watts)&&p.watts>=0).slice(-81).sort((a,b)=>a.at-b.at):[];
    const max=Math.max(100,...valid.map(p=>Math.ceil(p.watts/100)*100)),span=Math.min(1200000,Math.max(60000,now-(valid[0]?.at||now)));let prior=null,x=null,y=null;
    const path=valid.map(p=>{const command=prior&&p.at-prior.at<=45000?'L':'M';prior=p;x=240*(1-(now-p.at)/span);y=23-p.watts/max*21;return command+x.toFixed(1)+','+y.toFixed(1);}).join(' ');
    return {path,x,y,minutes:Math.ceil(span/60000)};
  }
  function loadPath(points,now=Date.now()){return loadPlot(points,now).path;}
  return {WIDTH, HEIGHT, layouts, finite, clamp, dateParts, calendar, shiftMonth, percent, number,
    nonnegative, battery, gib, mbps, duration, sourceState, freshSystem, bridgeUrl, layout, audioBars,mediaPosition,artworkKind,audioHeight,weatherInfo,audioResponse,runtimeText,loadPath,loadPlot};
});
