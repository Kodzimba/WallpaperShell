# WallpaperShell distribution

The source checkout builds with Windows PowerShell, .NET Framework 4.8, and the Windows WinMetadata files. Run `tools/bootstrap-build.ps1`: it downloads the pinned official Node.js archive, verifies SHA256, and bundles `node.exe`. End users do not need Node, npm, a .NET SDK, sibling projects, or a developer cache. The Microsoft Evergreen WebView2 Runtime remains an OS prerequisite; the three shipped SDK DLLs do not include that runtime.

Use `tools/export-source.ps1 -Destination <new-directory>` for a public snapshot. This is a content allowlist followed by a scanner, not a copy controlled only by `.gitignore`. It excludes local state, profiles, diagnostics, capabilities, signing material, prompts, handoff notes, screenshots, and machine-specific visual-test scripts. A sorted `source-export-manifest.json` records relative paths, sizes and SHA256. Never publish the working folder or its history as a substitute for that snapshot.

Build the exported checkout, then run `tools/package-release.ps1`. The output is `WallpaperShell-win-x64.zip` and the exact sibling `.zip.sha256` checksum asset. ZIP entries have no enclosing directory, sorted names and a fixed 1980 timestamp. The same payload and compression implementation produces the same ZIP; this does not claim byte-reproducible C# binaries across compiler versions.

`package-manifest.json` has `schemaVersion:1`, the exact `app-release.json` version, `platform:"win-x64"`, and `files:[{path,size,sha256}]`. Paths use forward slashes and SHA256 uses lowercase hex. Every payload file except the manifest itself is listed. The updater must verify the downloaded archive hash and every declared file before applying code. Unexpected files, traversal, links, aliases, case collisions and local-state locations are rejected. User data and local capabilities never belong to the update transaction.

Increment `app-release.json` and create the matching `vX.Y.Z` tag only after review. The repository workflow creates or updates a **draft** release. Publishing that draft is a separate maintainer action; an update check ignores drafts and prereleases. The checksum detects corruption; repository access and HTTPS remain part of the trust boundary, and this is not a code-signing claim.

The project preparation scripts do not create a GitHub repository, upload files, send issue contents or change Git remotes. Review the clean snapshot and its scan before initializing or staging a repository. Keep the original local tree as a separate working copy.

Official references: [Node.js LTS releases](https://nodejs.org/en/about/previous-releases), [pinned Node archive checksums](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt), [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).
