# Third-party and asset notices

No project-wide open-source license is selected for this snapshot; third-party components retain their listed licenses.

WallpaperShell bundles Microsoft's WebView2 SDK redistributables with their license, and an official Node.js Windows x64 runtime with its complete license. These components retain their own terms; no Microsoft WebView2 browser runtime or signing certificate is bundled.

DejaVu fonts retain their Bitstream Vera / Arev notices. The public condensed UI face uses Oswald from the official Google Fonts repository under SIL OFL; its license is `licenses/fonts/Oswald-OFL.txt`. An earlier local resource called `DaylightCondensed.ttf` was actually Impact. That proprietary font is deliberately excluded from public source and release packages. Public CSS preserves the UI alias while referring to Oswald instead.

The Luna Blue marble and crescent PNGs were created with imagegen for this theme. Their hashes matched the locally reviewed creation materials; prompts, mood-board references and local paths are not published. Asset evidence and redistribution status are recorded in `licenses/assets-provenance.json`; do not infer rights to unrelated imported artwork from this statement.

The three legacy Classic raster backgrounds are excluded from public distribution because their origin was not established. With the owner's approval, public Classic background references use `assets/public-water.png`, an unchanged copy of the verified Luna Blue marble. Local legacy originals are retained separately.

Notification identity icons are original code-generated geometric crescents produced by `tools/generate-notification-icons.ps1`. They contain no third-party marks or source images. The public Paper Green clock uses a small font metric adjustment for Oswald; Luna Blue and Classic retain their own typography.
