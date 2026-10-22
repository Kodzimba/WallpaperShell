'use strict';
// Build the new theme from the existing semantic widgets and shared controllers.
// Accounts, preferences and capabilities are never copied into theme assets.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../runtime'),source=path.join(root,'wallpaper'),dest=path.join(root,'themes/luna-blue');
fs.mkdirSync(dest,{recursive:true});
let html=fs.readFileSync(path.join(source,'index.html'),'utf8');
html=html.replace('<title>Paper Green</title>','<title>Luna Blue · Парящие острова</title>').replace('data-theme="paper-green"','data-theme="luna-blue"');
// Additional built-ins remain off in Luna's default v3 layout, but are available
// in the constructor without maintaining another hardware controller.
html=html.replace('  <div id="eventNotice"','  <section class="widget compact pet" data-widget="pet" aria-label="Пэт Codex"><div class="widget-content"><header class="drag-handle"><span>CODEX / PET DOCK</span><span class="dot"></span></header><div class="pet-space" aria-hidden="true">☾</div><div class="compact-info"><b id="petState">НЕТ СВЯЗИ</b><span id="petDetail" class="source-note">Место для твоего Пэта</span></div></div></section>\n  <div id="eventNotice"');
html=html.replace(/<div class="masthead"><span>PAPER GREEN<\/span><div id="daylightPower"><\/div><\/div>/,'<div class="masthead"><span>◒ &nbsp; LUNA BLUE<small>ПАРЯЩИЕ ОСТРОВА</small></span><div id="daylightPower"></div></div>').replace('Живые обои Paper Green','Живые обои Luna Blue');
html=html.replace(/<section class="scene"[\s\S]*?<\/section>/,'<div class="luna-background" aria-hidden="true"><img src="/luna-blue/assets/marble-water.png" alt=""><canvas id="lunaWater"></canvas><div class="luna-shade"></div></div><section class="scene luna-moon" aria-label="Луна и аудиоспектр"><div class="luna-glow"></div><img id="lunaMoon" src="/luna-blue/assets/moon.png" alt="Серебряный полумесяц"><canvas id="lunaSpectrum" width="800" height="800"></canvas><span id="lunaSignal" class="luna-signal">СИСТЕМНЫЙ ЗВУК</span></section>');
html=html.replace('Движение фигуры','Анимация воды и Луны');
html=html.replace('<span>РАБОЧИЙ СТОЛ</span>','<span>Рабочий стол</span>');
html=html.replace(/(src|href)="([^"#:]+\.(?:js|css))"/g,(_,attr,name)=>`${attr}="/${name}"`);
html=html.replace('<script src="/core.js"></script>','<script src="/core.js"></script><script src="/widget-model.js"></script><script src="/luna-blue/core.js"></script>');
html=html.replace('<script src="/polymer.js"></script>','<script src="/luna-blue/scene.js"></script>');
html=html.replace('<script src="/widget-model.js"></script><script src="/layout-client.js"></script>','<script src="/layout-client.js"></script>');
// Luna's stylesheet is appended after the shared styles below.
// Base styles are linked at the end of the source; Luna overrides must come last.
html=html.replace('</body>','<link rel="stylesheet" href="/luna-blue/luna.css"><link rel="stylesheet" href="/luna-blue/composition.css"><script src="/luna-blue/luna.js"></script></body>');
fs.writeFileSync(path.join(dest,'index.html'),html);
// File-only native popup uses the same policy and host with theme-local resources.
let overlay=fs.readFileSync(path.join(source,'launcher-overlay.html'),'utf8');
overlay=overlay.replace('<span>РАБОЧИЙ СТОЛ</span>','<span>Рабочий стол</span>');
overlay=overlay.replace('data-theme="paper-green"','data-theme="luna-blue"').replace('</body>','<link rel="stylesheet" href="luna.css"><link rel="stylesheet" href="composition.css"></body>');
fs.writeFileSync(path.join(dest,'launcher-overlay.html'),overlay);
for(const name of ['styles.css','launcher.css','daylight.css','launcher-overlay.css','appearance.css','appearance.js','launcher-overlay.js','launcher.js'])fs.copyFileSync(path.join(source,name),path.join(dest,name));
// A clean checkout has no local capability. The backend creates it on first run.
fs.mkdirSync(path.join(dest,'assets'),{recursive:true});
for(const name of ['DaylightCondensed.ttf','Oswald.ttf','DejaVuSans-Bold.ttf','DejaVuSansMono.ttf','FONT-LICENSE.txt'])if(fs.existsSync(path.join(source,'assets',name)))fs.copyFileSync(path.join(source,'assets',name),path.join(dest,'assets',name));
console.log('Luna Blue theme assembled from shared widgets.');
