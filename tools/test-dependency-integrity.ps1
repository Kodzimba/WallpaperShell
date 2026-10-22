$ErrorActionPreference='Stop'
$wsProjectRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'assert-dependencies.ps1')
$wsFixture=Join-Path $wsProjectRoot ('verification\dependency-integrity-'+[Guid]::NewGuid().ToString('N'))
$wsChecks=0
function Assert-WsRejected([scriptblock]$Operation) { $wsRejected=$false;try{& $Operation}catch{$wsRejected=$true};if(!$wsRejected){throw 'Malformed or changed dependency was accepted.'};$script:wsChecks++ }
try {
 [void](New-Item -ItemType Directory -Path (Join-Path $wsFixture 'tools') -Force)
 [void](New-Item -ItemType Directory -Path (Join-Path $wsFixture 'bin') -Force)
 $wsVendor=Join-Path $wsFixture 'runtime\companion\vendor\webview2'
 [void](New-Item -ItemType Directory -Path $wsVendor -Force)
 $wsManifest=Read-WsDependencyManifest $wsProjectRoot
 [IO.File]::WriteAllText((Join-Path $wsFixture 'bin\node.exe'),'Synthetic inert bytes; never executed.')
 $wsManifest.node.executableSha256=(Get-FileHash -LiteralPath (Join-Path $wsFixture 'bin\node.exe')).Hash.ToLowerInvariant()
 foreach($wsName in $wsManifest.webview2.files.PSObject.Properties.Name){[IO.File]::WriteAllText((Join-Path $wsVendor $wsName),'Synthetic inert library bytes.');$wsManifest.webview2.files.$wsName=(Get-FileHash -LiteralPath (Join-Path $wsVendor $wsName)).Hash.ToLowerInvariant()}
 $wsJson=$wsManifest | ConvertTo-Json -Depth 8
 $wsManifestFile=Join-Path $wsFixture 'tools\runtime-dependencies.json'
 [IO.File]::WriteAllText($wsManifestFile,$wsJson)
 Assert-WsDependencyIntegrity $wsFixture;$wsChecks++
 [IO.File]::AppendAllText((Join-Path $wsFixture 'bin\node.exe'),'changed')
 Assert-WsRejected {Assert-WsDependencyIntegrity $wsFixture}
 [IO.File]::WriteAllText((Join-Path $wsFixture 'bin\node.exe'),'Synthetic inert bytes; never executed.')
 [IO.File]::AppendAllText((Join-Path $wsVendor 'WebView2Loader.dll'),'changed')
 Assert-WsRejected {Assert-WsDependencyIntegrity $wsFixture}
 [IO.File]::WriteAllText((Join-Path $wsVendor 'WebView2Loader.dll'),'Synthetic inert library bytes.')
 foreach($wsCase in @('url','directory','executableSha256','extra-vendor-path')) {
  $wsChanged=$wsJson | ConvertFrom-Json
  switch($wsCase){
   'url' {$wsChanged.node.url='https://invalid.example/runtime.zip'}
   'directory' {$wsChanged.node.directory='../outside'}
   'executableSha256' {$wsChanged.node.executableSha256=''}
   'extra-vendor-path' {$wsChanged.webview2.files | Add-Member -NotePropertyName '../outside.dll' -NotePropertyValue ('a'*64)}
  }
  [IO.File]::WriteAllText($wsManifestFile,($wsChanged | ConvertTo-Json -Depth 8))
  Assert-WsRejected {Assert-WsDependencyIntegrity $wsFixture}
 }
 Write-Host ('Dependency integrity: '+$wsChecks+' checks passed; no network, binary execution or installed-app writes.')
} finally {
 $wsFull=[IO.Path]::GetFullPath($wsFixture);$wsExpected=[IO.Path]::GetFullPath((Join-Path $wsProjectRoot 'verification'))+[IO.Path]::DirectorySeparatorChar
 if(!$wsFull.StartsWith($wsExpected,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected dependency fixture cleanup path.'}
 if(Test-Path -LiteralPath $wsFull){Remove-Item -LiteralPath $wsFull -Recurse -Force}
}
