'use strict';
const {weatherInfo}=require('../wallpaper/core.js');
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
function rates(previous, current) {
  const elapsed = current?.monotonicSeconds - previous?.monotonicSeconds;
  if (!previous?.network || !current?.network || previous.network.id !== current.network.id || !(elapsed > 0 && elapsed < 30)) return {rxBytesPerSecond:null,txBytesPerSecond:null};
  const rate = key => valid(current.network[key]) && valid(previous.network[key]) && current.network[key] >= previous.network[key] ? (current.network[key]-previous.network[key])/elapsed : null;
  return {rxBytesPerSecond:rate('rx'),txBytesPerSecond:rate('tx')};
}
function gpuCsv(line) {
  const columns = line.trim().split(',').map(s=>s.trim());
  if (columns.length !== 3 || !columns[0]) throw new Error('Invalid NVIDIA response');
  const parse = s => /^\d+(\.\d+)?$/.test(s) ? Number(s)*1048576 : null;
  return {gpuName:columns[0],vramUsedBytes:parse(columns[1]),vramTotalBytes:parse(columns[2])};
}
function weatherResult(payload,config=null) {
  const c=payload?.current;
  if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.time) || payload.current_units?.temperature_2m !== '°C') throw new Error('Invalid Open-Meteo data');
  const code=Number.isInteger(c.weather_code)?c.weather_code:null,isDay=c.is_day===1?true:c.is_day===0?false:null;
  const {description}=weatherInfo(code,isDay);
  return {status:'ok',updatedAt:new Date(c.time*1000).toISOString(),identity:'Open-Meteo',data:{...(require('./weather-config.cjs').validateWeatherConfig(config)?{city:config.city.trim()}:{}),temperatureC:c.temperature_2m,description,weatherCode:code,isDay,provider:'Open-Meteo',attribution:'CC BY 4.0 · open-meteo.com'}};
}
function mouseDevice(devices) {
 return devices.filter(require('./device-provider.cjs').isMouse);
}
function mouseResult(device,payload,now=new Date().toISOString()) {
 if (payload?.deviceId!==device?.id || !valid(payload.percentage) || payload.percentage>100) return null;
 return {status:'ok',updatedAt:now,identity:`G HUB cache / ${device.extendedDisplayName} / ${device.id}`,detail:'Время чтения кэша G HUB; время радиозамера устройство не сообщает',data:{batteryPercent:payload.percentage,charging:typeof payload.charging==='boolean'?payload.charging:null,model:device.extendedDisplayName}};
}
module.exports={rates,gpuCsv,weatherResult,mouseDevice,mouseResult};

