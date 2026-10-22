# Уведомления Windows

WallpaperShell работает без регистрации пакета. Для чтения системных уведомлений Windows отдельно требует package identity и разрешение пользователя. Доступ запрашивается только кнопкой подключения в приложении. Сообщения и значки хранятся в памяти доверенного интерфейса, не включаются в HTTP, диагностику или переносимые раскладки.

Из корня распакованного приложения можно безопасно проверить готовность:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\setup-notifications.ps1
```

Для создания sparse package нужны MakeAppx и SignTool из официального Windows SDK. Скрипт ищет установленный SDK; также принимает явные `-MakeAppxPath` и `-SignToolPath`. Он не устанавливает SDK и не меняет Developer Mode. Команда `-Action Pack` создаёт неподписанный пакет из manifest и включённых значков.

Подпись, доверие сертификату и регистрация — отдельные действия владельца компьютера. Для локальной разработки `-Action CreateLocalCertificate` создаёт ключ в CurrentUser\My без экспорта закрытого ключа. `-Action Build -CertificateThumbprint THUMBPRINT` подписывает пакет выбранным сертификатом. `TrustLocalCertificate` добавляет только его публичную часть в CurrentUser\TrustedPeople. Если Windows требует доверия компьютера, отдельное действие `TrustMachineCertificate` требует администратора и добавляет публичный сертификат только в LocalMachine\TrustedPeople. Скрипт не добавляет корневой центр сертификации. Для распространения предпочтительна доверенная подпись издателя.

После осознанного выбора сертификата и области доверия `-Action Register -CertificateThumbprint THUMBPRINT` регистрирует собственный пакет для текущего пользователя. Затем перезапустите WallpaperShell и нажмите кнопку подключения уведомлений. Доверие сертификату само по себе не даёт доступа к уведомлениям. `-Action Remove` удаляет только собственную identity текущего пользователя, сохраняя файлы приложения и сертификат.

Имена `PaperGreen.App`, `CN=PaperGreen.Local` и applicationId `PaperGreen` сохранены для совместимости существующих установок. Они не означают доверие к сертификату другого компьютера. Сертификаты и готовые MSIX-пакеты не входят в публичный архив.

Telegram, Discord и другие источники должны сами отправлять системные уведомления. Внутренняя история переписки не читается. Показ индивидуального автора зависит от сведений, предоставленных исходным приложением.

Источники: [Microsoft notification listener](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener), [package identity with external location](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps), [Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/).
