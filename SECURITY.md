# Security reports

Please do not put vulnerabilities, account data, notification contents, local paths, capabilities, tokens or crash dumps in a public issue. If GitHub private vulnerability reporting is enabled for this repository, use its **Security → Report a vulnerability** form. Otherwise contact the repository owner privately through a channel they explicitly provide; no security mailbox or response-time promise is established here.

Include the WallpaperShell version, Windows version, affected feature, expected result and minimal reproduction using synthetic data. A redacted screenshot is optional. Never attach the app's data directory, WebView profile, notification feed, signing certificates or private keys.

This project can display sensitive local desktop information. Treat other processes running as the same Windows user and changes to the installed app files as outside its isolation boundary. Use Windows permissions to protect the installation and keep the Evergreen WebView2 Runtime updated. Release checksums protect against corruption and identify expected release bytes; they do not replace an independently trusted publisher signature or protect a compromised release account.

Only the currently reviewed release is evaluated; there is no long-term support commitment for older versions. Dependency findings should identify the actual bundled component: the WebView2 SDK wrappers and the separately installed browser Runtime have different versions and update paths.
