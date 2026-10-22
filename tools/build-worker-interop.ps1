param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
if(!$OutputDirectory){$OutputDirectory=Join-Path $pgRoot 'bin'}
$pgCompanion=Join-Path $pgRoot 'runtime\companion'
$pgGenerated=Join-Path $pgRoot 'verification\worker-interop-source'
[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
[void](New-Item -ItemType Directory -Path $pgGenerated -Force)
$pgCompiler=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
function Export-WorkerInlineSource([string]$Name){
 $pgScript=[IO.File]::ReadAllText((Join-Path $pgCompanion ($Name+'.ps1')))
 $pgMatch=[regex]::Match($pgScript,"(?ms)Add-Type @'\r?\n(.*?)\r?\n'@")
 if(!$pgMatch.Success){throw ('Missing inline worker fallback source: '+$Name)}
 $pgSource=Join-Path $pgGenerated ($Name+'.cs')
 [IO.File]::WriteAllText($pgSource,$pgMatch.Groups[1].Value,[Text.UTF8Encoding]::new($false))
 return $pgSource
}
# Compile the exact fallback definitions. Loading these assemblies initializes
# no providers: capture, wheel hook and stdin reader still require explicit calls
# at their original single worker call sites. WinRT stays in the media worker.
$pgSensorSource=Export-WorkerInlineSource 'windows-sensors'
$pgRouteSource=Export-WorkerInlineSource 'device-probe'
$pgMediaSource=Export-WorkerInlineSource 'windows-media'
& $pgCompiler /nologo /target:library /platform:anycpu /optimize+ ('/out:'+(Join-Path $OutputDirectory 'PaperGreen.SensorInterop.dll')) /reference:System.dll /reference:System.Core.dll $pgSensorSource $pgRouteSource (Join-Path $pgCompanion 'DesktopInterop.cs') (Join-Path $pgCompanion 'LauncherWheel.cs')
if($LASTEXITCODE -ne 0){throw 'Sensor interop compilation failed.'}
& $pgCompiler /nologo /target:library /platform:anycpu /optimize+ ('/out:'+(Join-Path $OutputDirectory 'PaperGreen.MediaInterop.dll')) /reference:System.dll $pgMediaSource
if($LASTEXITCODE -ne 0){throw 'Media interop compilation failed.'}
Write-Host 'Worker interop built; runtime source compilation remains a standalone fallback.'
