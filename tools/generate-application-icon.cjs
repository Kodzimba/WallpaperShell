'use strict';
// Package the existing original geometric crescent pixels in a Windows ICO.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const png=fs.readFileSync(path.join(root,'identity/notifications/Assets/Square150x150Logo.png'));
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=150;header[7]=150;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(header.length,18);
fs.writeFileSync(path.join(root,'identity/application.ico'),Buffer.concat([header,png]));
