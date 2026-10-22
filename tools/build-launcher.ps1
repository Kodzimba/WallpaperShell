$ErrorActionPreference='Stop'
$wsRoot=Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'assert-dependencies.ps1')
if(!$?){throw 'Launcher dependency integrity check failed.'}
& (Join-Path $wsRoot 'bin\node.exe') -e "const fs=require('node:fs'),path=require('node:path'),root=process.argv[1];require(path.join(root,'runtime/companion/launcher-overlay.cjs')).compile(path.join(root,'runtime')).then(exe=>{const target=path.join(root,'bin/WallpaperShell.Launcher.exe');if(path.resolve(exe)!==target){fs.copyFileSync(exe,target);fs.copyFileSync(path.join(path.dirname(exe),'source.sha256'),path.join(root,'bin/WallpaperShell.Launcher.source.txt'));}console.log('Portable launcher built');}).catch(error=>{console.error(error.message);process.exitCode=1;});" $wsRoot
if($LASTEXITCODE -ne 0){throw 'Portable launcher compilation failed.'}
