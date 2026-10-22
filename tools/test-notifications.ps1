param()
$ErrorActionPreference='Stop'
$pgRoot=Split-Path -Parent $PSScriptRoot
$pgOutput=Join-Path $pgRoot 'verification\notifications'
[void](New-Item -ItemType Directory -Path $pgOutput -Force)
$pgFramework=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319'
$pgArgs=@('/nologo','/target:exe','/platform:x64',('/out:'+(Join-Path $pgOutput 'NotificationsTests.exe')),'/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Xml.dll')
foreach($pgAssembly in @('System.Runtime','System.Collections','System.Threading.Tasks','System.ObjectModel','System.Runtime.InteropServices.WindowsRuntime','System.Runtime.WindowsRuntime')){
 $pgArgs+='/reference:'+(Join-Path $pgFramework ($pgAssembly+'.dll'))
}
$pgArgs+=@(Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'System32\WinMetadata') -Filter '*.winmd' | ForEach-Object {'/reference:'+ $_.FullName})
$pgArgs+=@((Join-Path $pgRoot 'src\Notifications.cs'),(Join-Path $pgRoot 'src\NativeNotificationsSource.cs'),(Join-Path $pgRoot 'src\NotificationActivation.cs'),(Join-Path $pgRoot 'src\NotificationPortrait.cs'),(Join-Path $pgRoot 'tests\NotificationsTests.cs'))
& (Join-Path $pgFramework 'csc.exe') @pgArgs
if($LASTEXITCODE -ne 0){throw 'Notification source/test compilation failed.'}
& (Join-Path $pgOutput 'NotificationsTests.exe')
if($LASTEXITCODE -ne 0){throw 'Notification pure tests failed.'}
