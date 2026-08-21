@echo off
REM ============================================================
REM  LUCA OPERATORU — kullanicinin bilgisayarinda calisan ajan
REM
REM  - Kendi Chrome profilinde AYRI bir pencere acar
REM    (gunluk tarayicinla karismaz: .browser-data-operator)
REM  - YALNIZ operator islerini alir (ekrani oku / yaz-sec-tikla)
REM  - Veri cekme isleri sunucudaki ajanda kalir, onlara dokunmaz
REM  - Pencere ancak portaldan komut verince acilir
REM ============================================================
setlocal
cd /d "%~dp0"
set MOREN_LUCA_CONFIG=%~dp0config.operator.json
echo Luca Operatoru baslatiliyor... (kapatmak icin bu pencereyi kapatin)
node src\agent.js
endlocal
