param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$wsRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'assert-dependencies.ps1')
$wsDependencies=Read-WsDependencyManifest $wsRoot
$wsCache=Join-Path $wsRoot '.build-cache';$wsBin=Join-Path $wsRoot 'bin'
[void](New-Item -ItemType Directory -Force -Path $wsCache);[void](New-Item -ItemType Directory -Force -Path $wsBin)
$wsZip=Join-Path $wsCache ('node-'+$wsDependencies.node.version+'-win-x64.zip')
if(!(Test-Path -LiteralPath $wsZip)){
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 Invoke-WebRequest -UseBasicParsing -Uri $wsDependencies.node.url -OutFile $wsZip
}
if((Get-FileHash -LiteralPath $wsZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wsDependencies.node.sha256){throw 'Pinned Node archive SHA256 mismatch.'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$wsArchive=[IO.Compression.ZipFile]::OpenRead($wsZip)
try{
 foreach($wsItem in @(@('node.exe','node.exe'),@('LICENSE','Node-LICENSE.txt'))){
  $wsEntry=$wsArchive.GetEntry($wsDependencies.node.directory+'/'+$wsItem[0])
  if(!$wsEntry){throw 'Required file is missing from the verified Node archive.'}
  $wsInput=$wsEntry.Open();$wsOutput=[IO.File]::Create((Join-Path $wsBin $wsItem[1]))
  try{$wsInput.CopyTo($wsOutput)}finally{$wsOutput.Dispose();$wsInput.Dispose()}
 }
}finally{$wsArchive.Dispose()}
Copy-Item -LiteralPath (Join-Path $wsBin 'Node-LICENSE.txt') -Destination (Join-Path $wsRoot 'licenses\Node-LICENSE.txt') -Force
Assert-WsDependencyIntegrity $wsRoot
$wsVersion=& (Join-Path $wsBin 'node.exe') --version
if($wsVersion -ne ('v'+$wsDependencies.node.version)){throw 'Unexpected pinned Node version.'}
if(!$SkipBuild){& (Join-Path $PSScriptRoot 'build.ps1') -SkipNodeCopy;if(!$?){throw 'Clean build failed.'}}
Write-Host 'Pinned Node runtime ready; no installed Node or npm packages are required.'
