# WallpaperShell installer

`WallpaperShell-Setup-x64.exe` is a single executable for Windows x64 (Windows 10 build 17763 or newer). It installs to the current user's local `Programs/WallpaperShell` directory. Desktop and Start Menu shortcuts point directly to the application with the correct working directory and the original crescent icon. The desktop shortcut is selected by default. A window-mode shortcut and uninstall entry are also available in the Start Menu.

The installer bundles the complete reviewed portable payload and the small official Microsoft WebView2 and .NET Framework 4.8 web bootstrappers. Node.js is already included. Existing runtimes are reused. Missing runtimes are downloaded and installed by Microsoft's bootstrappers, so that case requires internet access; .NET installation can require a Windows administrator approval and a restart. Setup requests no administrator privileges for its own per-user files. A requested restart is shown to the user, never forced; the post-install launch is suppressed while a restart is pending.

Build inputs are pinned in `tools/installer-dependencies.json`. The build checks SHA256 and a valid Authenticode signature from the expected Microsoft or Pyrsys publisher before executing the compiler or embedding a bootstrapper. Inno Setup is extracted in its official portable mode inside the build cache. Its compiler, resources and language inputs are checked against individual pinned hashes. The installer checks each embedded prerequisite's SHA256 again immediately before execution. If Microsoft changes a bootstrapper, builds stop until its verified digest is deliberately refreshed.

The install directory is fixed to the user's own local Programs directory. Reparse points in the root, ancestors or individual payload targets are rejected before prerequisite installation and again before each file copy. An older installer cannot overwrite a newer `app-release.json`, including versions installed by the in-app ZIP updater. Repeat installation preserves private local files and the selected theme. Only a fresh missing theme preference is initialized to Luna Blue. Uninstall removes recorded application files, shortcuts and registration, preserving runtime settings and profiles. Shared Microsoft runtimes are not uninstalled. WallpaperShell autostart, notification identity, certificates and trust settings are not installed automatically.

Build after producing a verified ZIP:

```powershell
./tools/package-release.ps1 -OutputDirectory ./dist/release
./tools/package-installer.ps1 -ReleaseDirectory ./dist/release
```

The output contains the installer, portable ZIP and one `.sha256` file for each. The in-app updater continues to use the portable ZIP, so installed copies remain writable without an elevation prompt for ordinary application updates.

`tools/test-installer.ps1` compiles shared Pascal policy into an inert test executable which exits before any installation. `tools/test-installed-package.ps1` is restricted to a clean disposable GitHub-hosted runner. It performs actual silent install, shortcut/icon checks, repair, downgrade and junction rejection, and uninstall with synthetic settings. It never launches the wallpaper and refuses an existing installation. It must not be run on a user's PC or a self-hosted runner. No local prerequisite installation is used for development verification.

The generated setup is currently unsigned by a WallpaperShell publisher certificate. Inno Setup's copyright and original engine attribution remain intact; its license is included under `licenses/installer`.

Official references: [WebView2 deployment and registry detection](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution), [.NET redistributable deployment](https://learn.microsoft.com/en-us/dotnet/framework/install/guide-for-developers), [Inno Setup](https://jrsoftware.org/), [official portable compiler mode](https://github.com/jrsoftware/issrc/blob/is-7_1_0/isportable.iss).
