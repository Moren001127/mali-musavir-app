@echo off
set "PROJECT=%CD%"
set "PATCH=%CD%\.notification-patch"

echo === PROJECT: %PROJECT%
echo === PATCH:   %PATCH%

if not exist "%PROJECT%\apps\api\src\notifications\notifications.module.ts" (
    echo HATA: Proje kokunde degilsin.
    pause
    exit /b 1
)
if not exist "%PATCH%\files\apps\api\src\notifications\notification-types.ts" (
    echo HATA: .notification-patch klasoru yok.
    pause
    exit /b 1
)

if exist ".git\index.lock" del /F /Q ".git\index.lock"
git config core.autocrlf input

echo === Files kopyalaniyor
copy /Y "%PATCH%\files\apps\api\src\notifications\notification-types.ts" "apps\api\src\notifications\"
copy /Y "%PATCH%\files\apps\api\src\notifications\notifications.service.ts" "apps\api\src\notifications\"
copy /Y "%PATCH%\files\apps\api\src\notifications\notifications.controller.ts" "apps\api\src\notifications\"
copy /Y "%PATCH%\files\apps\api\src\schedule\beyanname-deadline.cron.ts" "apps\api\src\schedule\"
copy /Y "%PATCH%\files\apps\api\src\schedule\invoice-overdue.cron.ts" "apps\api\src\schedule\"
if not exist "apps\api\prisma\migrations\20260528020000_notification_preferences" mkdir "apps\api\prisma\migrations\20260528020000_notification_preferences"
copy /Y "%PATCH%\files\apps\api\prisma\migrations\20260528020000_notification_preferences\migration.sql" "apps\api\prisma\migrations\20260528020000_notification_preferences\"
copy /Y "%PATCH%\files\apps\api\src\app.module.ts" "apps\api\src\"
copy /Y "%PATCH%\files\apps\api\src\portal-automation\portal-automation.module.ts" "apps\api\src\portal-automation\"
copy /Y "%PATCH%\files\apps\api\src\luca\luca.module.ts" "apps\api\src\luca\"
copy /Y "%PATCH%\files\apps\api\src\kdv-control\kdv-control.module.ts" "apps\api\src\kdv-control\"
copy /Y "%PATCH%\files\apps\api\src\documents\documents.module.ts" "apps\api\src\documents\"
copy /Y "%PATCH%\files\apps\api\src\pending-decisions\pending-decisions.module.ts" "apps\api\src\pending-decisions\"
copy /Y "%PATCH%\files\apps\api\src\banka-takip\banka-takip.module.ts" "apps\api\src\banka-takip\"
copy /Y "%PATCH%\files\apps\api\src\system-health\system-health.module.ts" "apps\api\src\system-health\"
copy /Y "%PATCH%\files\apps\api\src\auth\auth.module.ts" "apps\api\src\auth\"
copy /Y "%PATCH%\files\apps\api\src\mihsap\mihsap.module.ts" "apps\api\src\mihsap\"

echo === Python patcher
where python >nul 2>nul && (python "%PATCH%\apply_patches.py") || (where py >nul 2>nul && (py "%PATCH%\apply_patches.py") || (echo HATA: Python yok. & pause & exit /b 1))
if errorlevel 1 (echo Patch FAIL. & pause & exit /b 1)

echo === Commit'ler
git add apps/api/src/notifications/notification-types.ts apps/api/src/notifications/notifications.service.ts apps/api/src/notifications/notifications.controller.ts
git commit -m "feat(notifications): centralize types + helper methods (createForTenant, dedupe, preferences)"
git add "apps/web/src/app/(panel)/panel/bildirimler/page.tsx" "apps/web/src/components/layout/TopBar.tsx"
git commit -m "feat(ui): bildirimler sayfasinda 14 yeni tip etiketi + tercihler paneli + 15sn polling"
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260528020000_notification_preferences/
git commit -m "feat(prisma): NotificationPreference modeli + migration"
git add apps/api/src/schedule/task-reminder.cron.ts
git commit -m "feat(notifications): TASK_DUE in-app bildirim"
git add apps/api/src/portal-automation/portal-automation.service.ts apps/api/src/portal-automation/portal-automation.module.ts
git commit -m "feat(notifications): PORTAL_CREDENTIAL_FAIL bildirim"
git add apps/api/src/luca/luca.service.ts apps/api/src/luca/luca.module.ts
git commit -m "feat(notifications): LUCA_SYNC_ERROR bildirim"
git add apps/api/src/schedule/beyanname-deadline.cron.ts apps/api/src/app.module.ts
git commit -m "feat(notifications): TAX_DEADLINE cron"
git add apps/api/src/kdv-control/kdv-control.service.ts apps/api/src/kdv-control/kdv-control.module.ts
git commit -m "feat(notifications): KDV_RESULT bildirim"
git add apps/api/src/documents/documents.service.ts apps/api/src/documents/documents.module.ts
git commit -m "feat(notifications): DOCUMENT_UPLOADED bildirim"
git add apps/api/src/pending-decisions/pending-decisions.service.ts apps/api/src/pending-decisions/pending-decisions.module.ts
git commit -m "feat(notifications): PENDING_DECISION bildirim"
git add apps/api/src/banka-takip/banka-takip.service.ts apps/api/src/banka-takip/banka-takip.module.ts
git commit -m "feat(notifications): BANK_TRANSACTION_ALERT bildirim"
git add apps/api/src/system-health/system-health.service.ts apps/api/src/system-health/system-health.module.ts
git commit -m "feat(notifications): SYSTEM bildirim"
git add apps/api/src/moren-ofis/patrol.service.ts
git commit -m "feat(notifications): AGENT bildirim"
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.module.ts
git commit -m "feat(notifications): AUTH_NEW_DEVICE bildirim"
git add apps/api/src/mihsap/mihsap.service.ts apps/api/src/mihsap/mihsap.module.ts
git commit -m "feat(notifications): MIHSAP_RESULT bildirim"
git add apps/api/src/schedule/invoice-overdue.cron.ts apps/api/src/app.module.ts
git commit -m "feat(notifications): INVOICE_OVERDUE cron"

echo === DONE
git log --oneline -20
pause
