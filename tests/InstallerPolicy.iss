[Setup]
AppName=WallpaperShell inert installer policy tests
AppVersion=1.0
DefaultDirName={tmp}\WallpaperShell-policy-never-installed
PrivilegesRequired=lowest
SetupArchitecture=x64
Uninstallable=no
CreateUninstallRegKey=no
OutputBaseFilename=InstallerPolicyTests
OutputDir=..\verification\installer-policy

[Code]
#include "../installer/policy.iss"
var Checks: Integer;

procedure Check(Condition: Boolean; Name: String);
begin
  Checks := Checks + 1;
  if not Condition then RaiseException(Name);
end;

function InitializeSetup: Boolean;
var Report: String;
begin
  Result := False;
  Report := ExpandConstant('{param:REPORT|}'); if Report = '' then Exit;
  try
    Check(ValidRuntimeVersion('1.0.0.0'), 'small valid runtime');
    Check(ValidRuntimeVersion('144.0.3719.92'), 'current runtime shape');
    Check(not ValidRuntimeVersion(''), 'absent runtime');
    Check(not ValidRuntimeVersion('0.0.0.0'), 'zero runtime');
    Check(not ValidRuntimeVersion('144.0.3719'), 'partial runtime');
    Check(not ValidRuntimeVersion('1..0.0'), 'empty runtime component');
    Check(not ValidRuntimeVersion('1.2.3.4' + #10), 'newline runtime');
    Check(not ValidRuntimeVersion('99999.0.0.0'), 'runtime overflow');
    Check(not ValidRuntimeVersion('1.2.3.4.5'), 'extra runtime component');
    Check(PrerequisiteSucceeded(0), 'successful prerequisite');
    Check(PrerequisiteSucceeded(3010), 'prerequisite requests reboot');
    Check(not PrerequisiteSucceeded(1603), 'failed prerequisite');
    Check(not PrerequisiteSucceeded(1223), 'denied UAC');
    Check(not PrerequisiteSucceeded(1641), 'unexpected forced restart not success');
    Check(SameInstallRoot('C:\Synthetic\WallpaperShell\', 'c:\synthetic\wallpapershell'), 'own canonical root');
    Check(not SameInstallRoot('C:\Synthetic\WallpaperShell-other', 'C:\Synthetic\WallpaperShell'), 'prefix sibling rejected');
    Check(not SameInstallRoot('C:\Synthetic\WallpaperShell\..\Other', 'C:\Synthetic\WallpaperShell'), 'traversal rejected');
    Check(not SameInstallRoot('D:\Synthetic\WallpaperShell', 'C:\Synthetic\WallpaperShell'), 'different volume rejected');
    Check(CompareAppVersion('0.2.1','0.2.1') = 0, 'same version repair');
    Check(CompareAppVersion('0.2.0','0.2.1') < 0, 'upgrade');
    Check(CompareAppVersion('0.2.2','0.2.1') > 0, 'downgrade denied');
    Check(CompareAppVersion('1.0.0','0.99.99') > 0, 'major downgrade denied');
    Check(CompareAppVersion('0.1.bad','0.2.1') > 0, 'malformed old version fails closed');
    Check(CompareAppVersion('0.02.1','0.2.1') > 0, 'noncanonical version denied');
    Check(CompareAppVersion('0.2.1' + #10,'0.2.1') > 0, 'newline version denied');
    Check(ReadAppVersion('{"schemaVersion":1,"version":"0.2.1"}') = '0.2.1', 'manifest version');
    Check(ReadAppVersion('broken') = '', 'invalid manifest');
    Check(ReadAppVersion('{"version":false}') = '', 'non-string manifest');
    Check(ReadAppVersion('{"version": "0.2.1"}') = '0.2.1', 'spaced manifest');
    SaveStringToFile(Report, 'PASS ' + IntToStr(Checks), False);
  except SaveStringToFile(Report, 'FAIL ' + GetExceptionMessage, False); end;
end;
