param(
 [Parameter(Mandatory=$true)][string]$ZipPath,
 [Parameter(Mandatory=$true)][string]$Version,
 [string]$Repository='Kodzimba/WallpaperShell',
 [string]$ExpectedSha256='-'
)
$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
[void](New-Item -ItemType Directory -Path (Join-Path $pgRoot 'verification') -Force)
$pgOutput=Join-Path $pgRoot 'verification\ValidateUpdatePackage.exe'
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $pgCompiler /nologo /target:exe /platform:x64 /optimize+ ('/out:'+$pgOutput) /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $pgRoot 'src\AppUpdates.cs') (Join-Path $PSScriptRoot 'ValidateUpdatePackageMain.cs')
if($LASTEXITCODE -ne 0){throw 'Package validator compilation failed.'}
& $pgOutput ([IO.Path]::GetFullPath($ZipPath)) $Version $Repository $ExpectedSha256
if($LASTEXITCODE -ne 0){throw 'Update package validation failed; no payload code was executed.'}
