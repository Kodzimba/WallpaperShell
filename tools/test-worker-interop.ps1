$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgFixtures=Join-Path $pgRoot ('verification\worker-interop-fixtures\'+[Guid]::NewGuid().ToString('N'))
$pgPowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
try{
 $pgCompiled=Join-Path $pgFixtures 'compiled\bin'
 & (Join-Path $PSScriptRoot 'build-worker-interop.ps1') -OutputDirectory $pgCompiled
 foreach($pgMode in @('compiled','missing','invalid')){
  $pgFixture=Join-Path $pgFixtures $pgMode
  $pgCompanion=Join-Path $pgFixture 'runtime\companion'
  [void](New-Item -ItemType Directory -Path $pgCompanion -Force)
  foreach($pgName in @('DesktopInterop.cs','LauncherWheel.cs')){Copy-Item -LiteralPath (Join-Path $pgRoot ('runtime\companion\'+$pgName)) -Destination (Join-Path $pgCompanion $pgName)}
  if($pgMode -eq 'invalid'){
   [void](New-Item -ItemType Directory -Path (Join-Path $pgFixture 'bin') -Force)
   foreach($pgName in @('Sensor','Media')){[IO.File]::WriteAllText((Join-Path $pgFixture ('bin\PaperGreen.'+$pgName+'Interop.dll')),'invalid fixture assembly')}
  }
  & $pgPowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $pgRoot 'tests\WorkerInteropTests.ps1') -FixtureRoot $pgFixture -Mode $pgMode
  if($LASTEXITCODE -ne 0){throw ('Worker interop test failed: '+$pgMode)}
 }
}finally{
 $pgVerified=[IO.Path]::GetFullPath($pgFixtures)
 $pgAllowed=[IO.Path]::GetFullPath((Join-Path $pgRoot 'verification\worker-interop-fixtures'))+[IO.Path]::DirectorySeparatorChar
 if(!$pgVerified.StartsWith($pgAllowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe worker fixture cleanup path.'}
 if(Test-Path -LiteralPath $pgVerified){Remove-Item -LiteralPath $pgVerified -Recurse -Force}
}
