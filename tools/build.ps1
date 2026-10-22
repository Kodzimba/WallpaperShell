param([switch]$SkipNodeCopy)
$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
if(!$SkipNodeCopy){& (Join-Path $PSScriptRoot 'bootstrap-build.ps1') -SkipBuild;if(!$?){throw 'Pinned Node bootstrap failed.'}}
& (Join-Path $PSScriptRoot 'assert-dependencies.ps1')
if(!$?){throw 'Build dependency integrity check failed.'}
$pgBin=Join-Path $pgRoot 'bin'
[void](New-Item -ItemType Directory -Path $pgBin -Force)
$pgVendor=Join-Path $pgRoot 'runtime\companion\vendor\webview2'
foreach($pgName in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')){Copy-Item -LiteralPath (Join-Path $pgVendor $pgName) -Destination (Join-Path $pgBin $pgName) -Force}
Copy-Item -LiteralPath (Join-Path $pgVendor 'LICENSE.txt') -Destination (Join-Path $pgBin 'WebView2-LICENSE.txt') -Force
if(Test-Path -LiteralPath (Join-Path $pgRoot 'licenses\Node-LICENSE.txt')){Copy-Item -LiteralPath (Join-Path $pgRoot 'licenses\Node-LICENSE.txt') -Destination (Join-Path $pgBin 'Node-LICENSE.txt') -Force}
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& (Join-Path $pgBin 'node.exe') (Join-Path $PSScriptRoot 'generate-application-icon.cjs')
if($LASTEXITCODE -ne 0){throw 'Application icon packaging failed.'}
& (Join-Path $PSScriptRoot 'build-worker-interop.ps1')
if(!$?){throw 'Worker interop compilation failed.'}
$pgSources=@(Get-ChildItem -LiteralPath (Join-Path $pgRoot 'src') -Filter '*.cs' | ForEach-Object FullName)
$pgSources+=Join-Path $pgRoot 'runtime\companion\PrivateBootstrap.cs'
$pgArgs=@('/nologo','/target:winexe','/platform:x64','/optimize+',('/out:'+(Join-Path $pgBin 'WallpaperShell.exe')),('/win32manifest:'+(Join-Path $pgRoot 'src\app.manifest')),'/reference:System.dll','/reference:System.Core.dll','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll',('/reference:'+(Join-Path $pgBin 'Microsoft.Web.WebView2.Core.dll')),('/reference:'+(Join-Path $pgBin 'Microsoft.Web.WebView2.WinForms.dll')))
$pgFramework=Split-Path -Parent $pgCompiler
$pgArgs+='/reference:System.Xml.dll'
$pgArgs+='/win32icon:'+(Join-Path $pgRoot 'identity\application.ico')
$pgArgs+='/reference:System.IO.Compression.dll'
$pgArgs+='/reference:System.IO.Compression.FileSystem.dll'
foreach($pgAssembly in @('System.Runtime','System.Collections','System.Threading.Tasks','System.ObjectModel','System.Runtime.InteropServices.WindowsRuntime','System.Runtime.WindowsRuntime')){$pgArgs+='/reference:'+(Join-Path $pgFramework ($pgAssembly+'.dll'))}
$pgArgs+=@(Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'System32\WinMetadata') -Filter '*.winmd' | ForEach-Object {'/reference:'+ $_.FullName})
$pgArgs+=$pgSources
& $pgCompiler @pgArgs
if($LASTEXITCODE -ne 0){throw 'C# app compilation failed.'}
@'
<?xml version="1.0" encoding="utf-8"?>
<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup></configuration>
'@ | Set-Content -LiteralPath (Join-Path $pgBin 'WallpaperShell.exe.config') -Encoding UTF8
& (Join-Path $pgBin 'node.exe') (Join-Path $PSScriptRoot 'adapt-ui.cjs')
if($LASTEXITCODE -ne 0){throw 'UI adaptation failed.'}
& (Join-Path $pgBin 'node.exe') (Join-Path $PSScriptRoot 'sync-luna.cjs')
if($LASTEXITCODE -ne 0){throw 'Luna Blue assembly failed.'}
& (Join-Path $pgBin 'node.exe') -e "const path=require('node:path'),root=process.argv[1];require(path.join(root,'runtime/companion/launcher-overlay.cjs')).compile(path.join(root,'runtime')).then(()=>console.log('Native menu built')).catch(e=>{console.error(e.message);process.exitCode=1})" $pgRoot
if($LASTEXITCODE -ne 0){throw 'Native menu compilation failed.'}
& (Join-Path $PSScriptRoot 'build-launcher.ps1')
if(!$?){throw 'Portable launcher compilation failed.'}
& (Join-Path $PSScriptRoot 'build-updater.ps1')
if(!$?){throw 'Updater compilation failed.'}
Write-Host 'WallpaperShell built. Open RUN.cmd to launch a separate window.'
