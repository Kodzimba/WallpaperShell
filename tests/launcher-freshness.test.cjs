'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../runtime/companion/launcher-freshness.cjs'),UI=require('../runtime/wallpaper/launcher.js');
const now=Date.parse('2026-10-21T10:00:00Z'),a='a'.repeat(64),b='b'.repeat(64);
const file=(id,identity,createdAt)=>({id,identity,createdAt});
test('migration marks recent creation only, preserving old and unknown files as old',()=>{
 const result=F.observe({},false,[file(a,'recent',now-3600000),file(b,'old',now-F.DAY*3),file('c'.repeat(64),'unknown',0)],now);
 assert.equal(F.until(result.records[a]),now+F.DAY-3600000);assert(F.until(result.records[b])<now);assert.equal(F.until(result.records['c'.repeat(64)]),null);
});
test('arrivals start twenty-four hours on first observation, not file modification or restart',()=>{
 const first=F.observe({},true,[file(a,'inode-1',now-F.DAY*10)],now);assert.equal(first.records[a].at,now);
 const restarted=F.observe(JSON.parse(JSON.stringify(first.records)),true,[file(a,'inode-1',now-F.DAY*10)],now+F.DAY/2);assert.equal(restarted.changed,false);assert.equal(F.until(restarted.records[a]),now+F.DAY);
 const entry={group:'files',type:'file',newUntil:F.until(restarted.records[a])};assert(UI.isNewFile(entry,now+F.DAY-1));assert.equal(UI.isNewFile(entry,now+F.DAY),false);
});
test('renaming retains age, replacing a file restarts it, and absent files leave no tracking history',()=>{
 const previous={[a]:{identity:'inode-1',at:now-F.DAY*2}};
 const renamed=F.observe(previous,true,[file(b,'inode-1',now-F.DAY*2)],now);assert.equal(renamed.records[b].at,previous[a].at);assert.equal(renamed.records[a],undefined);
 const replaced=F.observe(renamed.records,true,[file(b,'inode-2',now)],now);assert.equal(replaced.records[b].at,now);
 assert.deepEqual(F.observe(replaced.records,true,[],now).records,{});
});
test('bad metadata and non-temporary entries never gain a new badge',()=>{
 assert.deepEqual(F.normalize({[a]:{identity:'file',at:NaN},'../path':{identity:'file',at:now}}),{});
 for(const entry of [{type:'folder',group:'files',newUntil:now+1},{type:'app',group:'work',newUntil:now+1},{type:'file',group:'files',newUntil:'later'},{type:'file',group:'files',newUntil:Infinity},{type:'file',group:'files',newUntil:now+F.DAY+1}])assert.equal(UI.isNewFile(entry,now),false);
});
