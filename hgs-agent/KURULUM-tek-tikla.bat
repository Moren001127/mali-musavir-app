@echo off
REM HGS Agent Otomatik Baslatma Kurulumu
REM Bu dosyaya CIFT TIKLA — bir kerelik kurulum yapilir.
REM Sonra bilgisayar her acildiginda HGS Agent otomatik baslar.

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0hgs-kurulum.ps1"
pause
