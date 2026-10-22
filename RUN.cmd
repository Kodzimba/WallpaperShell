@echo off
cd /d "%~dp0"
if not exist "bin\WallpaperShell.exe" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "tools\build.ps1"
if not exist "bin\WallpaperShell.exe" exit /b 1
start "" "bin\WallpaperShell.exe"
