@echo off
REM ===============================================
REM v1.37.76 reconciliation fix deploy — cift tikla calistir
REM ===============================================
REM Bu script:
REM   1) Asili kalan git editor sureclerini oldurur
REM   2) .git/index.lock dosyasini temizler
REM   3) Sadece reconciliation.engine.ts fix'ini stage'ler
REM   4) Commit + push
REM ===============================================

setlocal
cd /d "%~dp0"

echo.
echo === v1.37.76 reconciliation fix deploy basliyor ===
echo Calisma dizini: %CD%
echo.

REM 1) Index lock'u sil
echo [1/4] .git\index.lock temizleniyor...
if exist ".git\index.lock" (
  del /F /Q ".git\index.lock" 2>nul
  if exist ".git\index.lock" (
    echo   HATA: .git\index.lock silinemedi.
    echo   Gorev Yoneticisi'nde notepad/vim/code surecini kapat, tekrar dene.
    pause
    exit /b 1
  )
  echo   Silindi.
) else (
  echo   Zaten yok.
)

REM 2) Diff onizleme
echo [2/4] Degisiklik onizleme:
git --no-pager diff --stat apps/api/src/kdv-control/reconciliation.engine.ts
echo.

REM 3) Stage
echo [3/4] Stage: apps/api/src/kdv-control/reconciliation.engine.ts
git add apps/api/src/kdv-control/reconciliation.engine.ts
if errorlevel 1 (
  echo   HATA: git add basarisiz.
  pause
  exit /b 1
)

REM 4) Commit + push
echo [4/4] Commit ve push...
git commit -m "reconciliation v1.37.76: belge no leading-zero strip yanlis eslestirmeyi onle (Luca 620 vs e-fatura 0620 farkli belgeler)"
if errorlevel 1 (
  echo   HATA: commit basarisiz.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo   HATA: push basarisiz.
  pause
  exit /b 1
)

echo.
echo === DEPLOY TETIKLENDI ===
echo.
echo Sonraki adim:
echo   1) Railway otomatik build alacak (1-2 dakika)
echo   2) Build tamamlandiktan sonra portal'da KDV Kontrol'u tekrar calistir
echo   3) Onceden yanlis eslestirilen kayitlar artik 'UNMATCHED' olarak ayri gorunecek
echo.
pause
endlocal
