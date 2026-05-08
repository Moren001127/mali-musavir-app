# PORTAL toplu push: agent v1.35.3 + e-Arşiv sadeleştirme + Aç/Yazdır/Toplu PDF
#
# Kullanım:
#   cd C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app
#   .\push-agent-v1.35.1.ps1

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=== PORTAL toplu push (agent v1.35.3 + e-Arşiv yenileme) ===" -ForegroundColor Cyan
Write-Host ""

Set-Location 'C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app'

# Native komut hatalarını da yakala
function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments=$true)]$Args)
    & git @Args
    if ($LASTEXITCODE -ne 0) { throw "git $($Args -join ' ') -> exit $LASTEXITCODE" }
}

Write-Host "[1/7] Git lock dosyaları temizleniyor..." -ForegroundColor Yellow
Remove-Item -Force -ErrorAction SilentlyContinue .git\index.lock
Remove-Item -Force -ErrorAction SilentlyContinue .git\HEAD.lock
Remove-Item -Force -ErrorAction SilentlyContinue .git\refs\heads\main.lock

Write-Host "[2/7] Index sağlığı kontrol ediliyor..." -ForegroundColor Yellow
$idxOk = $true
try {
    git status --short 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $idxOk = $false }
} catch { $idxOk = $false }
if (-not $idxOk) {
    Write-Host "    Index bozuk, yeniden oluşturuluyor..." -ForegroundColor DarkYellow
    if (Test-Path .git\index) {
        $indexBackup = ".git\index.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item .git\index $indexBackup -Force -ErrorAction SilentlyContinue
        Remove-Item -Force .git\index
    }
    git read-tree HEAD
    git update-index --refresh 2>&1 | Out-Null
}

Write-Host "[3/7] İlgili dosyaları stage ediyoruz (sadece bu görevin dosyaları)..." -ForegroundColor Yellow
$files = @(
    'apps/api/public/agent-runtime.js',
    'apps/web/src/app/(panel)/panel/e-arsiv/page.tsx',
    'apps/web/src/app/(panel)/panel/mukellefler/yeni/page.tsx',
    'apps/web/src/app/(panel)/panel/mukellefler/[id]/page.tsx',
    'apps/web/src/components/layout/Sidebar.tsx',
    'apps/api/src/earsiv/earsiv.module.ts',
    'apps/api/src/earsiv/earsiv.controller.ts',
    'apps/api/src/earsiv/earsiv-render.service.ts'
)
# Önce reset, sonra sadece bu dosyaları add (diğer dirty dosyalara dokunma)
foreach ($f in $files) {
    git reset HEAD -- $f 2>&1 | Out-Null
}
foreach ($f in $files) {
    if (Test-Path $f) {
        Invoke-Git add -- $f
    } else {
        # Yeni dosya ise add ile ekle
        Invoke-Git add -- $f
    }
}

Write-Host "[4/7] Stage edilen değişiklikler:" -ForegroundColor Yellow
git diff --cached --stat

Write-Host "[5/7] Commit mesajı dosyaya yazılıyor (apostrof sorunu olmasın diye)..." -ForegroundColor Yellow
$msgFile = Join-Path $env:TEMP 'agent-portal-push-msg.txt'
$lines = @(
    'feat: agent v1.35.3 + e-Arsiv sadelesme + Ac/Yazdir/Toplu PDF',
    '',
    '== AGENT v1.35.3 ==',
    '- Tam otomatik firma degisimi (mizan + kdv + earsiv + tum Luca jobs)',
    '- Yanlis firma -> SirketCombo otomatik degistir, confirm/alert override',
    '- Reload bekleme 60sn -> 15sn',
    '- Popup Secilenleri Indir TEK TIK (network izlenir, max 2 click)',
    '- buraya tiklayiniz linki once click ediliyor',
    '- ZIP yakalama yontemleri: fetch + XHR + window.open + anchor download',
    '- ZIP timeout 45sn -> 60sn',
    '',
    '== E-ARSIV MODULU SADELESTIRME ==',
    '- Modul adi: Gelen E-Arsiv Sorgulama (eski: E-Arsiv / E-Fatura)',
    '- Sadece ALIS + EARSIV (satis ve e-fatura sekmeleri kaldirildi)',
    '- ZIP Yukle butonu kaldirildi (Lucadan Cek tek yol)',
    '- Mukellef formundan isEFaturaMukellefi alani kaldirildi',
    '',
    '== AC / YAZDIR / TOPLU PDF ==',
    '- Her satir icin [Ac] butonu (yeni sekmede HTML fatura goruntusu)',
    '- Her satir icin [Yazdir] butonu (HTML acilir + auto window.print)',
    '- Toplu Yazdir butonu (secili faturalari TEK HTMLde page-break ile birlestirir,',
    '  tarayicida print dialog acilir, kullanici PDF olarak kaydedebilir)',
    '- Backend: GET /api/earsiv/:id/html?print=1 endpointi',
    '- Backend: POST /api/earsiv/print-bulk endpointi',
    '- EarsivRenderService: UBL-TR XMLi Turkce fatura HTMLine donusturur',
    '  (kalem detayi XMLden cikarilir, fallback: ozet tablo)'
)
$lines | Out-File -FilePath $msgFile -Encoding utf8 -Force

Write-Host "[6/7] Commit oluşturuluyor..." -ForegroundColor Yellow
Invoke-Git commit -F $msgFile

Write-Host "[7/7] git push origin main..." -ForegroundColor Yellow
Invoke-Git push origin main

Remove-Item -Force -ErrorAction SilentlyContinue $msgFile

Write-Host ""
Write-Host "BAŞARILI: agent v1.35.3 + e-Arşiv yenileme push edildi." -ForegroundColor Green
Write-Host ""
Write-Host "Son 3 commit:" -ForegroundColor Cyan
git log --oneline -3
Write-Host ""
Write-Host "Sonraki adımlar:" -ForegroundColor Cyan
Write-Host "  1. Railway deploy bitsin (~2-3 dk)"
Write-Host "  2. Luca tarayıcı sekmesini Ctrl+F5 ile yenile (agent v1.35.3 yüklenir)"
Write-Host "  3. Portal'da E-Arşiv sayfasına git -> 'Gelen E-Arşiv Sorgulama' başlığını gör"
Write-Host "  4. Mükellef seç, Luca'dan Çek, sonra her fatura için [Aç] [Yazdır] dene"
Write-Host "  5. Birkaçını seç, üstte [Toplu Yazdır] ile tek PDF üret"
