@echo off
REM ===============================================
REM OCR v1.37.75 fix deploy — cift tikla calistir
REM ===============================================
REM Bu script:
REM   1) Asili kalan git editor sureclerini oldurur
REM   2) .git/index.lock dosyasini temizler
REM   3) Sadece OCR fix'ini stage'ler (diger uncommitted dosyalara dokunmaz)
REM   4) Commit + push
REM Push'tan sonra Railway/Vercel otomatik deploy alir.
REM ===============================================

setlocal
cd /d "%~dp0"

echo.
echo === OCR v1.37.75 deploy basliyor ===
echo Calisma dizini: %CD%
echo.

REM 1) Asili kalan git/editor sureclerini oldur (varsa)
echo [1/5] Asili git editor sureci kontrolu...
for %%P in (vim.exe nvim.exe notepad.exe code.exe) do (
  tasklist /FI "IMAGENAME eq %%P" 2>nul | find /I "%%P" >nul
  if not errorlevel 1 (
    echo   Bulundu: %%P -- oldurmek icin Y/N?
    set /p kill="Y/N: "
    if /I "!kill!"=="Y" taskkill /F /IM %%P >nul 2>&1
  )
)

REM 2) Index lock'u sil
echo [2/5] .git\index.lock temizleniyor...
if exist ".git\index.lock" (
  del /F /Q ".git\index.lock" 2>nul
  if exist ".git\index.lock" (
    echo   HATA: .git\index.lock silinemedi.
    echo   Manuel yap: Gorev Yoneticisi -^> notepad/vim/code kapat -^> tekrar dene
    pause
    exit /b 1
  )
  echo   Silindi.
) else (
  echo   Zaten yok.
)

REM 3) Diff onizleme
echo [3/5] Degisiklik onizleme:
git --no-pager diff --stat apps/api/src/kdv-control/ocr.service.ts
echo.

REM 4) Sadece OCR fix'ini stage'le
echo [4/5] Stage: apps/api/src/kdv-control/ocr.service.ts
git add apps/api/src/kdv-control/ocr.service.ts
if errorlevel 1 (
  echo   HATA: git add basarisiz.
  pause
  exit /b 1
)
git --no-pager diff --cached --stat apps/api/src/kdv-control/ocr.service.ts
echo.

REM 5) Commit + push
echo [5/5] Commit ve push...
git commit -m "ocr v1.37.75: Z raporu kumulatif/gunluk KDV ayrimi + belge no override + sanity check"
if errorlevel 1 (
  echo   HATA: commit basarisiz. Yukaridaki mesaja bak.
  pause
  exit /b 1
)

git push
if errorlevel 1 (
  echo   HATA: push basarisiz. Internet/yetki kontrol et.
  pause
  exit /b 1
)

echo.
echo === DEPLOY TAMAM ===
echo.
echo Sonraki adim:
echo   1) Railway/Vercel otomatik deploy alacak (yaklasik 1-2 dakika)
echo   2) Portal'da Ctrl+Shift+R ile sayfayi yenile (browser cache)
echo   3) Bir Z raporu test et: belge no Z NO olmali, KDV gercek gunluk deger
echo.
pause
endlocal
