# =============================================================================
# KULLANIMDAN KALDIRILDI (2026-06-08) — install-service.ps1
# =============================================================================
# Bu script eskiden 'Luca Local Agent' adiyla AYRI bir gorev kuruyordu ve
# install-scheduled-task.ps1 ('Moren Luca Local Agent') ile CAKISIYORDU =>
# ayni PC'de iki agent / her makinede farkli davranis.
#
# Artik tek resmi kurulum: scripts\install-scheduled-task.ps1
# Bu kabuk, geriye uyumluluk icin o scripti cagirir (eski onar-servis.bat yolu
# bozulmasin diye). Eski 'Luca Local Agent' gorevini de install-scheduled-task.ps1
# otomatik temizler.
# =============================================================================

$ErrorActionPreference = 'Stop'
$canonical = Join-Path $PSScriptRoot 'install-scheduled-task.ps1'

Write-Host '=== install-service.ps1 artik kullanimdan kaldirildi ===' -ForegroundColor Yellow
Write-Host 'Tek resmi kurulum scripti calistiriliyor: install-scheduled-task.ps1' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $canonical)) {
    Write-Host "[HATA] Resmi kurulum scripti bulunamadi: $canonical" -ForegroundColor Red
    exit 1
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $canonical
