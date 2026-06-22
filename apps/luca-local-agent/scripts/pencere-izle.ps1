# ============================================================================
# Moren Luca Local Agent — PENCERE IZLE (ac/kapat)
# Ajan tarayici penceresini SABIT acik tutup ne yaptigini izlemek icin
# kuculme-gozcusunu duraklatir (.pencere-gor bayragi). Tekrar calistirinca
# izolasyon (otomatik kuculme) geri gelir.
# ============================================================================
$agentRoot = Split-Path -Parent $PSScriptRoot   # ...\apps\luca-local-agent
$flag = Join-Path $agentRoot '.pencere-gor'
if (Test-Path $flag) {
  Remove-Item $flag -Force -ErrorAction SilentlyContinue
  Write-Host "IZLEME MODU KAPATILDI — pencere tekrar otomatik kuculecek (izolasyon geri)." -ForegroundColor Yellow
} else {
  New-Item -ItemType File -Path $flag -Force | Out-Null
  Write-Host "IZLEME MODU ACILDI — ajan penceresini acip ne yaptigini SABIT izleyebilirsin." -ForegroundColor Green
  Write-Host "Bitince bu scripti TEKRAR calistir -> pencere yine gizlenir (izolasyon)." -ForegroundColor DarkGray
}
