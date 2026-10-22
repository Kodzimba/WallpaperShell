'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const M=require('../runtime/wallpaper/widget-model.js'),C=require('../runtime/themes/luna-blue/core.js'),T=require('../runtime/wallpaper/layout-transfer-core.js'),controls=require('../runtime/companion/desktop-controls.cjs'),{createAppearance}=require('../runtime/companion/appearance.cjs');
const root=path.join(__dirname,'..'),theme=path.join(root,'runtime/themes/luna-blue');
test('Luna is a separate layout scope with only the requested widgets and independent default bounds',()=>{
 const catalog=M.catalog('luna-blue'),doc=M.create('luna-blue','display-1');assert.equal(Object.keys(catalog).length,15);
 for(const id of ['ecoflow','screens','audio','pet'])assert.equal(doc.widgets[id].visible,false);for(const [id,bounds] of Object.entries(C.layouts))assert.deepEqual(catalog[id].base,bounds);
 assert.deepEqual(catalog.launcher.base,[65,300,310,400]);assert.deepEqual(catalog.scene.base,[675,90,570,570]);assert.equal(catalog.scene.title,'Луна и спектр');
 const changed=M.patch(doc,{clock:{x:500},scene:{x:900,scale:.8}});assert.equal(changed.widgets.clock.x,500);assert.equal(M.create('paper-green','display-1').widgets.clock.x,1310);assert.equal(M.create('classic','display-1').widgets.clock.x,1296);
 assert.equal(M.patch(doc,{ecoflow:{visible:true}}).widgets.ecoflow.visible,true);M.validate(changed);
});
test('Luna import/export uses the same strict portable format and refuses another theme',()=>{
 const doc=M.create('luna-blue','display-2'),text=T.stringify(doc),plan=T.prepareImport(text,doc);assert.equal(plan.theme,'luna-blue');assert.equal(T.parse(text).widgets.ecoflow.visible,false);assert.throws(()=>T.prepareImport(text,M.create('paper-green','display-2')));
});
test('Luna palette is validated, survives restart and does not overwrite Paper Green appearance',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'luna-appearance-'));fs.mkdirSync(path.join(temp,'companion'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const original=createAppearance(temp),luna=createAppearance(temp,'luna-blue');assert.deepEqual(luna.get(),{mode:'dark',accent:'#b6d8f8',revision:0});luna.set({mode:'light',accent:'#8aabdd'});assert.deepEqual(original.get(),{mode:'light',accent:'#caff00',revision:0});assert.equal(createAppearance(temp,'luna-blue').get().accent,'#8aabdd');
 assert(controls.validAction({kind:'theme',value:'luna-blue'}));assert(controls.validAction({kind:'appearance',theme:'luna-blue',mode:'dark',accent:'#b6d8f8'}));assert(!controls.validAction({kind:'appearance',theme:'../../evil',mode:'dark',accent:'#b6d8f8'}));
});
test('Luna is assembled from shared controllers without excluded DOM, fake media or independent native commands',()=>{
 const html=fs.readFileSync(path.join(theme,'index.html'),'utf8');assert.match(html,/data-theme="luna-blue"/);assert.match(html,/LUNA BLUE/);for(const id of ['ecoflow','screens','audio'])assert(html.includes('data-widget="'+id+'"'));
 for(const controller of ['window-policy','app-host','layout-client','layout-editor','layout-file-bridge','launcher','desktop-hub','settings-ui'])assert(html.includes('/'+controller+'.js'));
 assert(html.includes('/luna-blue/scene.js'));assert(!html.includes('polymer.js'));assert(!html.includes('demo'));assert.equal((html.match(/src="\/widget-model.js"/g)||[]).length,1);
 const scene=fs.readFileSync(path.join(theme,'scene.js'),'utf8');assert.match(scene,/daylight:audio/);assert(!/getUserMedia|AudioContext|demo-rit|setInterval/.test(scene));assert.match(scene,/canInteract/);
 const native=fs.readFileSync(path.join(root,'src/Program.cs'),'utf8');assert(native.includes('ThemeSupport.PagePrefix(app.Theme)'));assert(native.includes('ThemeSupport.DesktopHub(Theme)'));
});
