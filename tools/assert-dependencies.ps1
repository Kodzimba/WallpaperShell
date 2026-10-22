param([string]$Root=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'

function Read-WsDependencyManifest([string]$ProjectRoot) {
 $wsManifest=Get-Content -LiteralPath (Join-Path $ProjectRoot 'tools\runtime-dependencies.json') -Raw | ConvertFrom-Json
 $wsNode=$wsManifest.node;$wsWeb=$wsManifest.webview2
 if($wsManifest.schemaVersion -ne 1 -or $wsNode.version -notmatch '^\d+\.\d+\.\d+$' -or $wsWeb.version -notmatch '^\d+\.\d+\.\d+\.\d+$'){throw 'Invalid dependency manifest version.'}
 if($wsNode.directory -cne ('node-v'+$wsNode.version+'-win-x64') -or $wsNode.url -cne ('https://nodejs.org/dist/v'+$wsNode.version+'/'+$wsNode.directory+'.zip')){throw 'Node dependency must use the exact official Windows x64 URL and directory.'}
 if($wsWeb.url -cne ('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/'+$wsWeb.version+'/microsoft.web.webview2.'+$wsWeb.version+'.nupkg')){throw 'WebView2 dependency must use the exact official NuGet URL.'}
 foreach($wsHash in @($wsNode.sha256,$wsNode.executableSha256,$wsWeb.sha256)) {if($wsHash -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid dependency digest.'}}
 $wsExpected=@('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')
 if((($wsWeb.files.PSObject.Properties.Name | Sort-Object) -join ',') -cne (($wsExpected | Sort-Object) -join ',')){throw 'Unexpected WebView2 dependency paths.'}
 foreach($wsName in $wsExpected){if($wsWeb.files.$wsName -cnotmatch '^[a-f0-9]{64}$'){throw 'Invalid WebView2 file digest.'}}
 return $wsManifest
}

function Assert-WsDependencyIntegrity([string]$ProjectRoot) {
 $wsManifest=Read-WsDependencyManifest $ProjectRoot
 $wsFiles=@{'bin\node.exe'=$wsManifest.node.executableSha256}
 foreach($wsName in $wsManifest.webview2.files.PSObject.Properties.Name){$wsFiles['runtime\companion\vendor\webview2\'+$wsName]=$wsManifest.webview2.files.$wsName}
 foreach($wsRelative in $wsFiles.Keys){
  $wsFile=Join-Path $ProjectRoot $wsRelative
  if(!(Test-Path -LiteralPath $wsFile -PathType Leaf) -or ((Get-Item -LiteralPath $wsFile).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'A required dependency is missing or is a link.'}
  if((Get-FileHash -LiteralPath $wsFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne $wsFiles[$wsRelative]){throw 'Dependency SHA256 mismatch; refusing to execute or package it.'}
 }
}
if($MyInvocation.InvocationName -ne '.') {Assert-WsDependencyIntegrity $Root;Write-Host 'Pinned dependency integrity verified.'}
