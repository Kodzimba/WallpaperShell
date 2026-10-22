#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PayloadDir
  #error PayloadDir is required
#endif
#include GeneratedDir + "\prerequisites.iss"

[Setup]
AppId={{1A8A7FD5-59D3-4D45-9B38-1B80C1588A2C}
AppName=WallpaperShell
AppVersion={#AppVersion}
AppPublisher=WallpaperShell
AppPublisherURL=https://github.com/Kodzimba/WallpaperShell
AppSupportURL=https://github.com/Kodzimba/WallpaperShell/issues
AppUpdatesURL=https://github.com/Kodzimba/WallpaperShell/releases
DefaultDirName={localappdata}\Programs\WallpaperShell
DefaultGroupName=WallpaperShell
PrivilegesRequired=lowest
UsePreviousAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
MinVersion=10.0.17763
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
SetupArchitecture=x64
AppMutex=Local\PaperGreen.App.v1
CloseApplications=no
RestartApplications=no
WizardStyle=modern dynamic
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\bin\WallpaperShell.exe
OutputBaseFilename=WallpaperShell-Setup-x64
Compression=lzma2
SolidCompression=yes
LZMANumBlockThreads=2
DiskSpanning=no
VersionInfoVersion={#AppVersion}.0
Uninstallable=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"

[Files]
#include GeneratedDir + "\payload-files.iss"
Source: "{#PrerequisiteDir}\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy
Source: "{#PrerequisiteDir}\ndp48-web.exe"; Flags: dontcopy

[Icons]
Name: "{userdesktop}\WallpaperShell"; Filename: "{app}\bin\WallpaperShell.exe"; Parameters: "--desktop"; WorkingDir: "{app}"; IconFilename: "{app}\bin\WallpaperShell.exe"; Tasks: desktopicon
Name: "{userprograms}\WallpaperShell\WallpaperShell"; Filename: "{app}\bin\WallpaperShell.exe"; Parameters: "--desktop"; WorkingDir: "{app}"; IconFilename: "{app}\bin\WallpaperShell.exe"
Name: "{userprograms}\WallpaperShell\WallpaperShell (в окне)"; Filename: "{app}\bin\WallpaperShell.exe"; WorkingDir: "{app}"; IconFilename: "{app}\bin\WallpaperShell.exe"
Name: "{userprograms}\WallpaperShell\Удалить WallpaperShell"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\bin\WallpaperShell.exe"; Parameters: "--desktop"; WorkingDir: "{app}"; Description: "Запустить WallpaperShell"; Flags: nowait postinstall skipifsilent; Check: CanLaunch

[Code]
#include "policy.iss"

const
  RuntimeKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
var RestartRequired: Boolean;

function GetFileAttributesW(Name: String): Cardinal;
  external 'GetFileAttributesW@kernel32.dll stdcall';
function GetLastError: Cardinal;
  external 'GetLastError@kernel32.dll stdcall';

function SafeAncestors(Path: String): Boolean;
var Current, Parent: String; Attr, Error: Cardinal;
begin
  Result := False; Current := ExpandFileName(Path);
  if Copy(Current, 1, 2) = '\\' then Exit;
  while Length(Current) > 0 do begin
    Attr := GetFileAttributesW(Current);
    if Attr = $FFFFFFFF then begin
      Error := GetLastError;
      if (Error <> 2) and (Error <> 3) then Exit;
    end else if (Attr and $400) <> 0 then Exit;
    Parent := ExtractFileDir(Current);
    if (Parent = Current) or (Parent = '') then Break;
    Current := Parent;
  end;
  Result := True;
end;

procedure VerifyFileTarget(Relative: String);
begin
  if not SafeAncestors(ExpandConstant('{app}\') + Relative) then
    RaiseException('Путь файла содержит ссылку или недоступен: ' + Relative);
end;

#include GeneratedDir + "\payload-checks.iss"

function HasWebView: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKLM32, RuntimeKey, 'pv', Version) and ValidRuntimeVersion(Version)) or
    (RegQueryStringValue(HKCU32, RuntimeKey, 'pv', Version) and ValidRuntimeVersion(Version)) or
    (RegQueryStringValue(HKLM64, RuntimeKey, 'pv', Version) and ValidRuntimeVersion(Version)) or
    (RegQueryStringValue(HKCU64, RuntimeKey, 'pv', Version) and ValidRuntimeVersion(Version));
end;

procedure ExtractVerified(Name, Digest: String);
begin
  ExtractTemporaryFile(Name);
  if CompareText(GetSHA256OfFile(ExpandConstant('{tmp}\') + Name), Digest) <> 0 then
    RaiseException('Проверка целостности компонента Microsoft не пройдена.');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer; Text: AnsiString; Config: String;
begin
  Result := '';
  if not SameInstallRoot(WizardDirValue, ExpandConstant('{localappdata}\Programs\WallpaperShell')) or
     not SafeAncestors(WizardDirValue) then begin
    Result := 'Нужна собственная папка WallpaperShell на локальном диске без ссылок и перенаправлений.'; Exit;
  end;
  Config := ExpandConstant('{app}\app-release.json');
  if FileExists(Config) then begin
    if not SafeAncestors(Config) or not LoadStringFromFile(Config, Text) then begin Result := 'Не удалось безопасно прочитать установленную версию.'; Exit; end;
    if CompareAppVersion(ReadAppVersion(String(Text)), '{#AppVersion}') > 0 then begin Result := 'Уже установлена более новая версия WallpaperShell. Используйте актуальный установщик.'; Exit; end;
  end;
  try
    CheckPayloadTargets;
    if not IsDotNetInstalled(net48, 0) then begin
      WizardForm.StatusLabel.Caption := 'Установка .NET Framework 4.8…';
      ExtractVerified('ndp48-web.exe', '{#DotNetSHA256}');
      if not ShellExec('runas', ExpandConstant('{tmp}\ndp48-web.exe'), '/q /norestart', '', SW_SHOWNORMAL, ewWaitUntilTerminated, Code) then begin Result := 'Установка .NET Framework не была разрешена Windows. Код: ' + IntToStr(Code); Exit; end;
      if not PrerequisiteSucceeded(Code) then begin Result := 'Не удалось установить .NET Framework. Проверьте интернет и повторите установку. Код: ' + IntToStr(Code); Exit; end;
      RestartRequired := RestartRequired or (Code = 3010);
      if not IsDotNetInstalled(net48, 0) and not RestartRequired then begin Result := '.NET Framework пока недоступен. Повторите установку после завершения обновлений Windows.'; Exit; end;
    end;
    if not HasWebView then begin
      WizardForm.StatusLabel.Caption := 'Установка Microsoft Edge WebView2…';
      ExtractVerified('MicrosoftEdgeWebview2Setup.exe', '{#WebViewSHA256}');
      if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then begin Result := 'Не удалось запустить установку WebView2. Код: ' + IntToStr(Code); Exit; end;
      if not PrerequisiteSucceeded(Code) then begin Result := 'Не удалось установить WebView2. Проверьте интернет и повторите установку. Код: ' + IntToStr(Code); Exit; end;
      RestartRequired := RestartRequired or (Code = 3010);
      if not HasWebView and (Code <> 3010) then begin Result := 'WebView2 пока недоступен. Повторите установку после завершения обновлений Windows.'; Exit; end;
    end;
  except Result := 'Не удалось подготовить компоненты: ' + GetExceptionMessage; end;
end;

function NeedRestart: Boolean;
begin Result := RestartRequired; end;

function CanLaunch: Boolean;
begin Result := not RestartRequired; end;

procedure CurStepChanged(Step: TSetupStep);
var Theme: String;
begin
  if Step = ssPostInstall then begin
    Theme := ExpandConstant('{app}\runtime\companion\.app-theme.json');
    if not FileExists(Theme) and SafeAncestors(Theme) then
      SaveStringToFile(Theme, '{"theme":"luna-blue"}', False);
  end;
end;
