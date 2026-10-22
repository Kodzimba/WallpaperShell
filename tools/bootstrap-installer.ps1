param([string]$Root=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'

function Get-WsInstallerManifest([string]$ProjectRoot) {
 $wsManifest=Get-Content -LiteralPath (Join-Path $ProjectRoot 'tools\installer-dependencies.json') -Raw | ConvertFrom-Json
 if($wsManifest.schemaVersion -ne 1 -or $wsManifest.inno.version -cne '7.1.0'){throw 'Invalid installer dependency manifest.'}
 $wsUrls=@{inno='https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe';webview2='https://go.microsoft.com/fwlink/p/?LinkId=2124703';dotnet48='https://go.microsoft.com/fwlink/?LinkId=2085155'}
 foreach($wsName in $wsUrls.Keys){$wsItem=$wsManifest.$wsName;if($wsItem.url -cne $wsUrls[$wsName] -or $wsItem.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $wsItem.fileName -cnotmatch '^[A-Za-z0-9.-]+\.exe$'){throw 'Installer dependency URL, filename or digest rejected.'}}
 if($wsManifest.inno.publisher -cne 'Pyrsys B.V.' -or $wsManifest.webview2.publisher -cne 'Microsoft Corporation' -or $wsManifest.dotnet48.publisher -cne 'Microsoft Corporation'){throw 'Installer dependency publisher rejected.'}
 return $wsManifest
}

function Assert-WsInstallerInput([string]$File,$Dependency) {
 if(!(Test-Path -LiteralPath $File -PathType Leaf) -or ((Get-Item -LiteralPath $File).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Installer input is missing or linked.'}
 if((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Dependency.sha256){throw 'Installer input SHA256 mismatch; refusing to execute or embed it.'}
 $wsSignature=Get-AuthenticodeSignature -LiteralPath $File
 $wsPublisher=[regex]::Escape($Dependency.publisher)
 if($wsSignature.Status -ne 'Valid' -or $wsSignature.SignerCertificate.Subject -notmatch ('^CN='+$wsPublisher+', O='+$wsPublisher+',')){throw 'Installer input Authenticode publisher rejected.'}
}

function Assert-WsCompilerFiles([string]$CompilerRoot,$Manifest) {
 $wsPrefix=[IO.Path]::GetFullPath($CompilerRoot).TrimEnd('\')+'\'
 if(@($Manifest.inno.files.PSObject.Properties).Count -lt 12){throw 'Incomplete compiler integrity manifest.'}
 foreach($wsEntry in $Manifest.inno.files.PSObject.Properties){
  if($wsEntry.Name -notmatch '^[A-Za-z0-9./-]+$' -or $wsEntry.Name.Contains('..') -or $wsEntry.Value -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid compiler input path.'}
  $wsFile=[IO.Path]::GetFullPath((Join-Path $CompilerRoot $wsEntry.Name))
  if(!$wsFile.StartsWith($wsPrefix,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $wsFile -PathType Leaf) -or ((Get-Item -LiteralPath $wsFile).Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-FileHash -LiteralPath $wsFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $wsEntry.Value){throw 'Extracted compiler input integrity rejected.'}
 }
}

function Initialize-WsInstaller([string]$ProjectRoot) {
 $wsManifest=Get-WsInstallerManifest $ProjectRoot
 $wsCache=Join-Path $ProjectRoot '.build-cache\installer-inputs';[void](New-Item -ItemType Directory -Force -Path $wsCache)
 foreach($wsName in @('inno','webview2','dotnet48')){
  $wsItem=$wsManifest.$wsName;$wsFile=Join-Path $wsCache $wsItem.fileName
  if(!(Test-Path -LiteralPath $wsFile)){Invoke-WebRequest -UseBasicParsing -Uri $wsItem.url -OutFile $wsFile}
  Assert-WsInstallerInput $wsFile $wsItem
 }
 $wsCompilerRoot=Join-Path $ProjectRoot ('.build-cache\inno-'+$wsManifest.inno.version)
 if(!(Test-Path -LiteralPath (Join-Path $wsCompilerRoot 'ISCC.exe'))){
  if(Test-Path -LiteralPath $wsCompilerRoot){throw 'Partial compiler cache exists; use a new clean cache.'}
  $wsProcess=Start-Process -FilePath (Join-Path $wsCache $wsManifest.inno.fileName) -ArgumentList @('/SP-','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER','/NOICONS','/PORTABLE=1',('/DIR="'+$wsCompilerRoot+'"')) -WindowStyle Hidden -Wait -PassThru
  if($wsProcess.ExitCode -ne 0){throw 'Portable compiler extraction failed.'}
 }
 Assert-WsCompilerFiles $wsCompilerRoot $wsManifest
 Write-Host 'Installer compiler and embedded Microsoft bootstrappers verified; no Runtime installed.'
 return $wsCompilerRoot
}
if($MyInvocation.InvocationName -ne '.'){[void](Initialize-WsInstaller ([IO.Path]::GetFullPath($Root)))}
