'use strict';
const {authorized}=require('./desktop-controls.cjs');
// The renderer is served from this exact loopback origin. A remote sandboxed
// iframe also sends Origin:null, so null is never a bootstrap trust signal.
function boundary(req,res,key){
 res.setHeader('Cache-Control','no-store');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
 const hosts=['127.0.0.1:8767','localhost:8767'],origins=hosts.map(host=>'http://'+host),origin=req.headers.origin;
 const reject=code=>{res.writeHead(code).end();return null;};
 if(!hosts.includes(req.headers.host))return reject(403);
 let url;try{url=new URL(req.url,'http://127.0.0.1:8767');}catch{return reject(400);}
 const protectedPaths=new Set(['/controls','/power','/launcher','/launcher-input','/launcher-overlay','/devices','/devices/refresh','/builder','/builder/chat','/builder/chat/cancel','/layouts','/diagnostics','/speedtest']);
 const headers=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
 const legacy=['null','file://'].includes(origin),authenticated=legacy&&(authorized(req,key)||authorized(req,key,'speedtest'));
 // The native file:// popup needs a CORS preflight, which carries no secret.
 // Only protected endpoints may preflight; every actual request still needs
 // the capability, and bootstrap/status are never available to opaque origins.
 const preflight=legacy&&req.method==='OPTIONS'&&protectedPaths.has(url.pathname)&&['GET','POST','PATCH'].includes(req.headers['access-control-request-method'])&&headers.includes('x-violetghost-key')&&headers.includes('x-violetghost-action')&&headers.every(s=>['content-type','x-violetghost-key','x-violetghost-action'].includes(s));
 if(origin&&!origins.includes(origin)){
  if(!authenticated&&!preflight)return reject(403);
 }
 if(req.headers['sec-fetch-site']==='cross-site'&&!authenticated&&!preflight)return reject(403);
 if(url.origin!=='http://127.0.0.1:8767'&&url.origin!=='http://localhost:8767')return reject(403);
 // No wildcard CORS. Authenticated legacy clients can send actions, but cannot
 // fetch the bootstrap capability without already possessing it.
 if(origin&&origins.includes(origin))res.setHeader('Access-Control-Allow-Origin',origin);
 if(preflight)res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Vary','Origin');
 return url;
}
module.exports={boundary};
