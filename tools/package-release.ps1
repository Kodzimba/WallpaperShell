param([string]$OutputDirectory,[switch]$SkipBuild)
$ErrorActionPreference='Stop'
$wsRoot=Split-Path -Parent $PSScriptRoot
if(!$OutputDirectory){$OutputDirectory=Join-Path $wsRoot 'dist'}
if(!$SkipBuild){& (Join-Path $PSScriptRoot 'bootstrap-build.ps1');if(!$?){throw 'Release build failed.'}}
& (Join-Path $PSScriptRoot 'assert-dependencies.ps1')
if(!$?){throw 'Package dependency integrity check failed.'}
[void](New-Item -ItemType Directory -Force -Path $OutputDirectory)
$wsStage=Join-Path $OutputDirectory ('payload-'+[Guid]::NewGuid().ToString('N'))
$wsJson=& (Join-Path $wsRoot 'bin\node.exe') (Join-Path $PSScriptRoot 'publication.cjs') stage $wsStage
if($LASTEXITCODE -ne 0){throw 'Release staging failed.'}
$wsInfo=$wsJson | ConvertFrom-Json;$wsZip=Join-Path $OutputDirectory $wsInfo.assetName
if(Test-Path -LiteralPath $wsZip){throw 'Release ZIP already exists; choose a new output directory.'}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$wsStream=[IO.File]::Open($wsZip,[IO.FileMode]::CreateNew)
try{
 $wsArchive=[IO.Compression.ZipArchive]::new($wsStream,[IO.Compression.ZipArchiveMode]::Create,$true)
 try{
  $wsManifest=Get-Content -LiteralPath (Join-Path $wsStage 'package-manifest.json') -Raw | ConvertFrom-Json
  $wsNames=@($wsManifest.files.path)+@('package-manifest.json')
  [Array]::Sort($wsNames,[StringComparer]::Ordinal)
  foreach($wsName in $wsNames){
   $wsEntry=$wsArchive.CreateEntry($wsName,[IO.Compression.CompressionLevel]::Optimal)
   $wsEntry.LastWriteTime=[DateTimeOffset]::new(1980,1,1,0,0,0,[TimeSpan]::Zero)
   $wsInput=[IO.File]::OpenRead((Join-Path $wsStage $wsName));$wsEntryStream=$wsEntry.Open()
   try{$wsInput.CopyTo($wsEntryStream)}finally{$wsEntryStream.Dispose();$wsInput.Dispose()}
  }
 }finally{$wsArchive.Dispose()}
}finally{$wsStream.Dispose()}
$wsHash=(Get-FileHash -LiteralPath $wsZip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($wsZip+'.sha256'),($wsHash+'  '+$wsInfo.assetName+"`n"),[Text.UTF8Encoding]::new($false))
Write-Host ('Release prepared: '+$wsInfo.assetName+'; '+$wsInfo.files+' manifest files. No upload performed.')
