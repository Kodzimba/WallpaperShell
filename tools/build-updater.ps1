param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
if(!$OutputDirectory){$OutputDirectory=Join-Path $pgRoot 'bin'}
[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $pgCompiler /nologo /target:winexe /platform:x64 /optimize+ ('/out:'+(Join-Path $OutputDirectory 'WallpaperShell.Updater.exe')) /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $pgRoot 'src\AppUpdates.cs') (Join-Path $PSScriptRoot 'UpdateInstallerMain.cs')
if($LASTEXITCODE -ne 0){throw 'Updater compilation failed.'}
Write-Host 'WallpaperShell updater built; no install or helper execution performed.'
