@echo off
REM Luca Local Agent — Tek tıkla kurulum scripti
REM Bu dosyayı çift tıkla, gerisi otomatik.

echo.
echo === Luca Local Agent Kurulumu ===
echo.

cd /d "%~dp0"

REM Node kurulu mu kontrol
node --version >nul 2>&1
if errorlevel 1 (
  echo HATA: Node.js bulunamadi.
  echo Once Node.js LTS yukle: https://nodejs.org/en/download/
  pause
  exit /b 1
)
echo Node.js bulundu:
node --version
echo.

REM npm install
echo Bagimliliklar yukleniyor (1-2 dakika)...
call npm install
if errorlevel 1 (
  echo npm install basarisiz oldu.
  pause
  exit /b 1
)
echo.

REM Playwright chromium indir
echo Playwright Chromium indiriliyor (~150 MB, 3-5 dakika)...
call npx playwright install chromium
if errorlevel 1 (
  echo Playwright kurulum basarisiz oldu.
  pause
  exit /b 1
)
echo.

REM config.json yoksa kopyala
if not exist config.json (
  echo config.json olusturuluyor...
  copy config.example.json config.json >nul
  echo.
  echo === SIRA SENDE ===
  echo.
  echo config.json dosyasini Notepad ile ac ve sunlari doldur:
  echo   - api.agentToken    -- Portal Ayarlar > Moren Agent'den kopyala
  echo   - luca.uyeNo       -- Luca uye numaran
  echo   - luca.username    -- Luca kullanici adin
  echo   - luca.password    -- Luca parolan
  echo.
  notepad config.json
)

echo.
echo === KURULUM TAMAM ===
echo.
echo Test icin: npm start
echo Veya bu klasorde 'baslat.bat' calistir.
echo.
pause
