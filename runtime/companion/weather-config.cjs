'use strict';
const fs=require('node:fs'),path=require('node:path');
// Source distributions never infer a location or read another application's profile.
function validateWeatherConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='city,enabled,latitude,longitude'||value.enabled!==true)return null;
 const {latitude,longitude,city}=value;
 if(typeof latitude!=='number'||!Number.isFinite(latitude)||latitude< -90||latitude>90||typeof longitude!=='number'||!Number.isFinite(longitude)||longitude< -180||longitude>180||typeof city!=='string'||!city.trim()||city.length>64||/[\u0000-\u001f\u007f<>]/.test(city))return null;
 return {enabled:true,latitude,longitude,city:city.trim()};
}
function readWeatherConfig(root,{io=fs}={}){
 try{const file=path.join(root,'data/weather.json');if(io.statSync(file).size>4096)return null;return validateWeatherConfig(JSON.parse(io.readFileSync(file,'utf8')));}catch{return null;}
}
function weatherUrl(config){
 const value=validateWeatherConfig(config);if(!value)throw Error('Weather is not configured');
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 for(const [key,item]of Object.entries({latitude:value.latitude,longitude:value.longitude,current:'temperature_2m,weather_code,is_day',timezone:'UTC',timeformat:'unixtime'}))url.searchParams.set(key,item);
 return url.href;
}
module.exports={validateWeatherConfig,readWeatherConfig,weatherUrl};
