param([Parameter(Mandatory=$true)][string]$FixtureRoot,[Parameter(Mandatory=$true)][ValidateSet('compiled','missing','invalid')][string]$Mode)
$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgCompanion=Join-Path $pgRoot 'runtime\companion'
$env:VG_DESKTOP_ROOT=Join-Path $FixtureRoot 'runtime\companion'
$script:pgInlineCompiles=0;$script:pgSourceCompiles=0;$script:pgDllLoads=0;$script:pgAssemblyLoads=0
function Add-Type {
 [CmdletBinding()]param([Parameter(Position=0)][string]$TypeDefinition,[string]$Path,[string[]]$AssemblyName)
 if($PSBoundParameters.ContainsKey('TypeDefinition')){$script:pgInlineCompiles++}
 if($Path){if([IO.Path]::GetExtension($Path) -eq '.dll'){$script:pgDllLoads++}else{$script:pgSourceCompiles++}}
 if($AssemblyName){$script:pgAssemblyLoads++}
 Microsoft.PowerShell.Utility\Add-Type @PSBoundParameters
}
foreach($pgName in @('windows-sensors','device-probe','windows-media')){
 $pgScript=[IO.File]::ReadAllText((Join-Path $pgCompanion ($pgName+'.ps1')))
 $pgMarker=if($pgName -eq 'windows-media'){'$asTask='}else{'$clock'}
 $pgCut=$pgScript.IndexOf($pgMarker,[StringComparison]::Ordinal)
 if($pgCut -lt 0){throw 'Worker load-only boundary missing.'}
 # Evaluate the unchanged loader prefix only, before any provider/loop call.
 . ([scriptblock]::Create($pgScript.Substring(0,$pgCut)))
}
. (Join-Path $pgCompanion 'desktop-control.ps1')
. (Join-Path $pgCompanion 'desktop-control.ps1')
$pgSensorScript=[IO.File]::ReadAllText((Join-Path $pgCompanion 'windows-sensors.ps1'))
$pgWheelLoad=[regex]::Match($pgSensorScript,"(?m)^ if\(-not \('VGLauncherWheel'.*$")
if(!$pgWheelLoad.Success){throw 'Guarded wheel loader missing.'}
. ([scriptblock]::Create($pgWheelLoad.Value))
foreach($pgType in @('VGSensors','PGDeviceRoute','VGDesktop','VGLauncherWheel','VGMediaCover')){if(-not ($pgType -as [type])){throw ('Missing worker type: '+$pgType)}}
if($Mode -eq 'compiled'){
 if($script:pgInlineCompiles -ne 0 -or $script:pgSourceCompiles -ne 0 -or $script:pgDllLoads -ne 2){throw 'Compiled startup must load exactly two assemblies and never compile C#.'}
}elseif($script:pgInlineCompiles -ne 4 -or $script:pgSourceCompiles -ne 1){throw 'Missing/bad assembly must preserve the guarded inline and source fallbacks.'}
if($script:pgAssemblyLoads -ne 1){throw 'WinRT runtime reference must still load exactly once.'}
if(([regex]::Matches($pgSensorScript,'\[VGLauncherWheel\]::Start\(\)')).Count -ne 1){throw 'Wheel hook must retain exactly one original start call.'}
$pgDeviceScript=[IO.File]::ReadAllText((Join-Path $pgCompanion 'device-probe.ps1'))
if(([regex]::Matches($pgDeviceScript,'\[PGDeviceRoute\]::ReadInput\(\)')).Count -ne 1){throw 'Device stdin reader must retain exactly one original start call.'}
Write-Host ('Worker interop '+$Mode+': five types loaded; inline compiles='+$script:pgInlineCompiles+', source compiles='+$script:pgSourceCompiles+'; no providers/hooks/actions started.')
