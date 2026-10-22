[CmdletBinding()]
param(
 [ValidateSet('Inspect','Pack','CreateLocalCertificate','Build','TrustLocalCertificate','TrustMachineCertificate','Register','Remove')][string]$Action='Inspect',
 [string]$CertificateThumbprint,
 [string]$MakeAppxPath,
 [string]$SignToolPath
)
$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgIdentity=Join-Path $pgRoot 'identity\notifications'
$pgOutput=Join-Path $pgRoot 'data\notification-identity'
$pgPackage=Join-Path $pgOutput 'PaperGreen.Identity.msix'
$pgUnsignedPackage=Join-Path $pgOutput 'PaperGreen.Identity.unsigned.msix'
$pgPublicCertificate=Join-Path $pgOutput 'PaperGreen.Local.cer'
$pgExternal=Join-Path $pgRoot 'bin'
$pgName='PaperGreen.App'
$pgPublisher='CN=PaperGreen.Local'

function Find-PgSdkTool([string]$Name,[string]$Explicit) {
 if($Explicit){$pgResolved=(Resolve-Path -LiteralPath $Explicit).Path;if(!(Test-Path -LiteralPath $pgResolved -PathType Leaf)){throw 'SDK tool path must be a file.'};return $pgResolved}
 # Optional portable, official Microsoft.Windows.SDK.BuildTools NuGet. This is
 # project-local and never installs SDK registry keys, services or system files.
 $pgPortable=Join-Path $pgRoot ('verification\notification-sdk\Microsoft.Windows.SDK.BuildTools.10.0.26100.9169\bin\10.0.26100.0\x64\'+$Name)
 if(Test-Path -LiteralPath $pgPortable -PathType Leaf){return $pgPortable}
 $pgCommand=Get-Command $Name -ErrorAction SilentlyContinue
 if($pgCommand){return $pgCommand.Source}
 $pgKit=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
 if(Test-Path -LiteralPath $pgKit){
  foreach($pgVersion in @(Get-ChildItem -LiteralPath $pgKit -Directory | Sort-Object Name -Descending)){
   $pgCandidate=Join-Path $pgVersion.FullName ('x64\'+$Name)
   if(Test-Path -LiteralPath $pgCandidate -PathType Leaf){return $pgCandidate}
  }
 }
 return $null
}
function Get-PgCertificate {
 if(!$CertificateThumbprint){throw 'Pass -CertificateThumbprint from the certificate you selected or created. No certificate is selected automatically.'}
 $pgThumb=$CertificateThumbprint.Replace(' ','').ToUpperInvariant()
 if($pgThumb -notmatch '^[0-9A-F]{40}$'){throw 'Certificate thumbprint must contain 40 hex characters.'}
 $pgCertificate=Get-Item -LiteralPath ('Cert:\CurrentUser\My\'+$pgThumb) -ErrorAction Stop
 if($pgCertificate.Subject -ne $pgPublisher){throw 'Certificate Subject must equal CN=PaperGreen.Local; do not reuse a different publisher identity.'}
 if(!$pgCertificate.HasPrivateKey){throw 'Signing requires the selected certificate private key in CurrentUser\My.'}
 if($pgCertificate.NotAfter -le (Get-Date)){throw 'Selected certificate has expired.'}
 return $pgCertificate
}
function Assert-PgBinaryIdentity {
 if(!(Test-Path -LiteralPath (Join-Path $pgExternal 'WallpaperShell.exe') -PathType Leaf)){throw 'Build WallpaperShell first (tools/build.ps1).'}
 $pgSourceManifest=Join-Path $pgRoot 'src\app.manifest'
 if(Test-Path -LiteralPath $pgSourceManifest -PathType Leaf){
 [xml]$pgExeManifest=Get-Content -LiteralPath $pgSourceManifest -Raw
 $pgNs=New-Object System.Xml.XmlNamespaceManager($pgExeManifest.NameTable)
 $pgNs.AddNamespace('m','urn:schemas-microsoft-com:msix.v1')
 $pgEntry=$pgExeManifest.SelectSingleNode('//m:msix',$pgNs)
 if(!$pgEntry -or $pgEntry.packageName -ne $pgName -or $pgEntry.publisher -ne $pgPublisher -or $pgEntry.applicationId -ne 'PaperGreen'){
  throw 'Embed identity/notifications/app.manifest.fragment.xml into src/app.manifest and rebuild before registration.'
 }
 }
 # Read embedded bytes as well: editing the source manifest alone is insufficient.
 $pgBytes=[IO.File]::ReadAllBytes((Join-Path $pgExternal 'WallpaperShell.exe'))
 $pgExeText=[Text.Encoding]::UTF8.GetString($pgBytes)
 if(!$pgExeText.Contains('urn:schemas-microsoft-com:msix.v1') -or !$pgExeText.Contains('packageName="'+$pgName+'"') -or !$pgExeText.Contains('publisher="'+$pgPublisher+'"') -or !$pgExeText.Contains('applicationId="PaperGreen"')){
  throw 'The EXE does not contain the identity manifest yet. Rebuild it before registration.'
 }
}
function Get-PgPublicCertificate {
 $pgSelected=Get-PgCertificate
 if(!(Test-Path -LiteralPath $pgPublicCertificate -PathType Leaf)){throw 'Build first to export the selected public certificate.'}
 $pgPublic=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($pgPublicCertificate)
 if($pgPublic.Thumbprint -ne $pgSelected.Thumbprint -or $pgPublic.Subject -ne $pgPublisher){throw 'Public certificate does not match the explicitly selected Paper Green signing certificate.'}
 return $pgPublic
}
function New-PgUnsignedPackage {
 if(!$pgMakeAppx){throw 'MakeAppx is required. Use official Microsoft.Windows.SDK.BuildTools NuGet in verification/notification-sdk or pass -MakeAppxPath; no SDK is installed automatically.'}
 [void](New-Item -ItemType Directory -Path $pgOutput -Force)
 $pgStage=Join-Path $pgOutput 'package-content'
 $pgStageAssets=Join-Path $pgStage 'Assets'
 [void](New-Item -ItemType Directory -Path $pgStageAssets -Force)
 Copy-Item -LiteralPath (Join-Path $pgIdentity 'AppxManifest.xml') -Destination (Join-Path $pgStage 'AppxManifest.xml') -Force
 foreach($pgLogo in @('StoreLogo.png','Square44x44Logo.png','Square150x150Logo.png')){
  Copy-Item -LiteralPath (Join-Path $pgIdentity ('Assets\'+$pgLogo)) -Destination (Join-Path $pgStageAssets $pgLogo) -Force
 }
 & $pgMakeAppx pack /o /d $pgStage /nv /p $pgUnsignedPackage
 if($LASTEXITCODE -ne 0){throw 'MakeAppx failed.'}
}

$pgMakeAppx=Find-PgSdkTool 'MakeAppx.exe' $MakeAppxPath
$pgSignTool=Find-PgSdkTool 'SignTool.exe' $SignToolPath
if($Action -eq 'Inspect'){
 $pgAdd=Get-Command Add-AppxPackage -ErrorAction SilentlyContinue
 [pscustomobject]@{
  IdentityName=$pgName;Publisher=$pgPublisher;ApplicationId='PaperGreen';
  WindowsBuild=[Environment]::OSVersion.Version.Build;
  MakeAppxAvailable=[bool]$pgMakeAppx;SignToolAvailable=[bool]$pgSignTool;
  ExternalLocationSupported=[bool]($pgAdd -and $pgAdd.Parameters.ContainsKey('ExternalLocation'));
  UnsignedParameterPresent=[bool]($pgAdd -and $pgAdd.Parameters.ContainsKey('AllowUnsigned'));
  SignedPackageExists=(Test-Path -LiteralPath $pgPackage -PathType Leaf);
  UnsignedPackageExists=(Test-Path -LiteralPath $pgUnsignedPackage -PathType Leaf);
  Executable=(Join-Path $pgExternal 'WallpaperShell.exe')
 }
 return
}
if([Environment]::OSVersion.Version.Build -lt 19041){throw 'Sparse identity needs Windows 10 build 19041 or newer.'}
if($PSVersionTable.PSEdition -eq 'Core' -and $Action -in @('Register','Remove')){throw 'Use Windows PowerShell 5.1 (powershell.exe) for Appx registration.'}

switch($Action){
 'Pack' {
  New-PgUnsignedPackage
  Write-Output 'Review package built at data/notification-identity/PaperGreen.Identity.unsigned.msix. It is not signed, trusted or registered; sign it with Build before Register.'
 }
 'CreateLocalCertificate' {
  # This action is deliberately separate from Build/Register. It creates only a
  # local development signing key; it does not grant trust or register a package.
  [void](New-Item -ItemType Directory -Path $pgOutput -Force)
  $pgCert=New-SelfSignedCertificate -Type Custom -Subject $pgPublisher -FriendlyName 'Paper Green local identity signing' -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(2) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
  [void](Export-Certificate -Cert $pgCert -FilePath $pgPublicCertificate)
  Write-Output ('CertificateThumbprint: '+$pgCert.Thumbprint)
  Write-Output 'Signing key stays in CurrentUser\My. Public certificate exported; no trust granted.'
 }
 'Build' {
  if(!$pgMakeAppx -or !$pgSignTool){throw 'Install Windows SDK Signing Tools / MSIX Packaging Tools (MakeAppx and SignTool), or pass -MakeAppxPath and -SignToolPath. No SDK/Developer Mode is installed automatically.'}
  $pgCert=Get-PgCertificate
  Assert-PgBinaryIdentity
  [void](New-Item -ItemType Directory -Path $pgOutput -Force)
  New-PgUnsignedPackage
  Copy-Item -LiteralPath $pgUnsignedPackage -Destination $pgPackage -Force
  & $pgSignTool sign /fd SHA256 /sha1 $pgCert.Thumbprint /s My $pgPackage
  if($LASTEXITCODE -ne 0){throw 'SignTool failed.'}
  [void](Export-Certificate -Cert $pgCert -FilePath $pgPublicCertificate -Force)
  Write-Output 'Sparse package built and signed. No certificate trust/package registration performed.'
 }
 'TrustLocalCertificate' {
  # Explicit action: current user trust only. Never touch LocalMachine stores,
  # Developer Mode, policy keys, services, Wallpaper Engine or old wallpaper data.
  $pgPublic=Get-PgPublicCertificate
  [void](Import-Certificate -FilePath $pgPublicCertificate -CertStoreLocation 'Cert:\CurrentUser\TrustedPeople')
  Write-Output 'Selected Paper Green public certificate trusted for the current user.'
 }
 'TrustMachineCertificate' {
  # Separate, explicitly requested scope. Default Inspect, Pack, Build and
  # Register never elevate or modify a machine certificate store.
  $pgPublic=Get-PgPublicCertificate
  $pgPrincipal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if(!$pgPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Machine TrustedPeople requires a separate administrator-approved invocation. No trust was changed.'}
  [void](Import-Certificate -FilePath $pgPublicCertificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople')
  Write-Output 'Only the selected Paper Green public signing certificate is trusted in LocalMachine\TrustedPeople. No root authority or private key was imported.'
 }
 'Register' {
  Assert-PgBinaryIdentity
  if(!(Test-Path -LiteralPath $pgPackage -PathType Leaf)){throw 'Build the signed identity package first.'}
  $pgCert=Get-PgCertificate
  $pgSignature=Get-AuthenticodeSignature -LiteralPath $pgPackage
  if(!$pgSignature.SignerCertificate -or $pgSignature.SignerCertificate.Thumbprint -ne $pgCert.Thumbprint){throw 'Package signer must match the explicitly selected Paper Green certificate.'}
  if(!(Test-Path -LiteralPath ('Cert:\CurrentUser\TrustedPeople\'+$pgCert.Thumbprint)) -and !(Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPeople\'+$pgCert.Thumbprint))){throw 'Explicitly trust the selected Paper Green certificate before registration.'}
  # AppxDeployment performs the authoritative package signature/trust check.
  # Generic Authenticode chain status may report an untrusted root even though
  # the specific signer is in CurrentUser\TrustedPeople. Do not add machine/root
  # trust or disable verification; let the normal per-user registration decide.
  if($pgSignature.Status -notin @('Valid','UnknownError')){throw ('Package signature check failed: '+$pgSignature.Status)}
  # Per-user, no forced app termination and no all-user installation.
  Add-AppxPackage -Path $pgPackage -ExternalLocation $pgExternal
  Write-Output 'Paper Green identity registered for this user. Close/relaunch only WallpaperShell, then click Enable in its notifications tile to request Windows consent.'
 }
 'Remove' {
  # Exact own package only. Certificate trust/key removal is a separate manual
  # operation, so an accidental Remove cannot break an unrelated signed package.
  $pgPackages=Get-AppxPackage -Name $pgName
  foreach($pgInstalled in $pgPackages){if($pgInstalled.Name -eq $pgName -and $pgInstalled.Publisher -eq $pgPublisher){Remove-AppxPackage -Package $pgInstalled.PackageFullName}}
  Write-Output 'Own Paper Green identity removed for this user. Application files were preserved.'
 }
}
