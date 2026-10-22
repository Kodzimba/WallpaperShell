'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2'};
function regularAsset(file){
 try{let current=root;const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))return false;for(const part of relative.split(path.sep)){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())return false;}return fs.statSync(file).isFile();}catch{return false;}
}
function serve(req,res,url){
 if(!['GET','HEAD'].includes(req.method))return false;
 let name;try{name=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return true;}
 const classic=name.startsWith('/classic/'),luna=name.startsWith('/luna-blue/'),base=path.join(root,classic?'themes/classic':luna?'themes/luna-blue':'wallpaper');
 if(name==='/')name='/index.html';if(classic)name=name.slice('/classic'.length);if(luna)name=name.slice('/luna-blue'.length);
 if(name.split('/').some(p=>p.startsWith('.')&&p!=='.controls-key.js')){res.writeHead(403).end();return true;}
 if(!mime[path.extname(name)])return false;
 if(req.headers.origin&&!['http://127.0.0.1:8767','http://localhost:8767'].includes(req.headers.origin)){res.writeHead(403).end();return true;}
 if(name==='/.controls-key.js'){res.writeHead(404).end();return true;}
 let file=path.resolve(base,'.'+name);if(!file.startsWith(base+path.sep)||name.split('/').some(p=>p.startsWith('.')&&p!=='.controls-key.js')){res.writeHead(403).end();return true;}
 if(name==='/app-host.js')file=path.join(root,'wallpaper/app-host.js');
 if(['/app-maintenance.js','/app-maintenance.css','/window-policy.js','/window-policy.css','/widget-model.js','/layout-client.js','/layout-ui.js','/layout-ui.css','/layout-editor-core.js','/layout-editor.js','/layout-editor.css','/layout-integration.js','/custom-widget-model.js','/builder-session.js','/custom-widget-renderer.js','/builder-ui.js','/builder.css','/devices-ui.js','/devices-ui.css','/layout-transfer-core.js','/layout-file-bridge.js','/layout-transfer-ui.js','/layout-transfer.css'].includes(name))file=path.join(root,'wallpaper',name.slice(1));
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://127.0.0.1:8767 http://localhost:8767; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 if(!regularAsset(file)){res.writeHead(404).end();return true;}
 try{const content=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]});res.end(req.method==='HEAD'?undefined:content);}catch{res.writeHead(404).end('Not found');}return true;
}
module.exports={serve};
