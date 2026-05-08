$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\moren\.verdent\verdent-projects\mali-mavirlik-ofisim-iin\mali-musavir-app'

Write-Host "=== v1.36.16: full automation restored + System Health Watchdog + module hash lock ===" -ForegroundColor Cyan

Remove-Item -Force -ErrorAction SilentlyContinue .git\index.lock
Remove-Item -Force -ErrorAction SilentlyContinue .git\HEAD.lock

# Agent — ASIL DOSYALAR (web=Vercel, api=Railway, ikisi de senkron olmali)
git add 'apps/web/public/moren-agent.js'
git add 'apps/api/public/agent-runtime.js'

# YENI: Sistem Saglik Watchdog (backend cron + endpoint + frontend bell)
git add 'apps/api/src/system-health/system-health.service.ts'
git add 'apps/api/src/system-health/system-health.controller.ts'
git add 'apps/api/src/system-health/system-health.module.ts'
git add 'apps/api/src/app.module.ts'
git add 'apps/api/prisma/schema.prisma'
git add 'apps/api/prisma/migrations/20260507000000_system_health/migration.sql'
git add 'apps/web/src/components/layout/SystemHealthBell.tsx'
git add 'apps/web/src/components/layout/TopBar.tsx'

# YENI: Modul kilit hash baseline + pre-commit hook
git add '.locked-modules.json'
git add 'scripts/check-locked-modules.cjs'
git add '.husky/pre-commit'

# YENI: Locked Modules CRUD (DB tablosu + service + controller + admin sayfasi)
git add 'apps/api/src/system-health/locked-modules.service.ts'
git add 'apps/api/prisma/migrations/20260507000001_locked_modules/migration.sql'
git add 'apps/web/src/app/(panel)/panel/sistem/kilitli-moduller/page.tsx'
git add 'apps/web/src/components/layout/Sidebar.tsx'

# YENI v1.36.21: Pause/Resume + Belge<->Mihsap karsilastirma + IHO fixes
git add 'apps/api/src/agent-events/agent-events.service.ts'
git add 'apps/api/src/agent-events/agent-events.controller.ts'
git add 'apps/api/prisma/migrations/20260507000002_agent_control_state/migration.sql'
git add 'apps/api/src/isletme-hesap-ozeti/isletme-hesap-ozeti.service.ts'
git add 'apps/api/src/kdv-control/excel-parser.service.ts'
git add 'apps/web/src/lib/log-format.ts'
git add 'apps/web/src/app/(panel)/panel/ajanlar/mihsap/page.tsx'

# Vercel cache header fix (moren-agent.js no-cache)
git add 'apps/web/next.config.js'

# Kilitli moduller listesi (Claude bu modullere izinsiz dokunamaz)
git add 'KILITLI_MODULLER.md'

# Duyuru sablonu (statik HTML, 2.7MB JS gomulu)
git add 'apps/web/public/duyuru-sablonu.html'
git add 'apps/web/src/app/(panel)/panel/duyurular/page.tsx'

# Backend
git add 'apps/api/src/taxpayers/taxpayers.service.ts'
git add 'apps/api/src/vendor-memory/vendor-memory.service.ts'
git add 'apps/api/src/vendor-memory/vendor-memory.controller.ts'

# IHO: KDV Kontrol Excel'inden DONEM BASI STOK ayri parse edilsin
git add 'apps/api/src/kdv-control/excel-parser.service.ts'
git add 'apps/api/src/isletme-hesap-ozeti/isletme-hesap-ozeti.service.ts'

# Shared schema (Zod)
git add 'packages/shared/src/schemas/taxpayer.schemas.ts'

# Frontend
git add 'apps/web/src/app/(panel)/panel/banka-takip/page.tsx'
git add 'apps/web/src/app/(panel)/panel/mukellefler/[id]/page.tsx'
git add 'apps/web/src/app/(panel)/panel/mukellefler/yeni/page.tsx'
git add 'apps/web/src/app/(panel)/panel/firma-hafizasi/page.tsx'
git add 'apps/web/src/app/(panel)/panel/ajanlar/mihsap/page.tsx'
git add 'apps/web/src/lib/vendor-memory.ts'
git add 'apps/web/src/components/layout/Sidebar.tsx'
git add 'apps/web/src/app/(panel)/panel/onay-kuyrugu/page.tsx'
git add 'apps/web/src/lib/log-format.ts'
git add 'apps/web/src/app/(panel)/panel/ajanlar/_components/LogCard.tsx'

# Gecici olarak kapatilan modullerin redirect sayfalari
git add 'apps/web/src/app/(panel)/panel/ajanlar/mihsap/incele/page.tsx'
git add 'apps/web/src/app/(panel)/panel/evraklar/page.tsx'
git add 'apps/web/src/app/(panel)/panel/evraklar/yenileme/page.tsx'
git add 'apps/web/src/app/(panel)/panel/ajanlar/kdv-hazirlik/page.tsx'
git add 'apps/web/src/app/(panel)/panel/ajanlar/sgk/page.tsx'
git add 'apps/web/src/app/(panel)/panel/ajanlar/tebligat/page.tsx'
git add 'apps/web/src/app/(panel)/panel/bordro/page.tsx'
git add 'apps/web/src/app/(panel)/panel/ajanlar/luca/page.tsx'

if ($LASTEXITCODE -ne 0) { exit 1 }

git diff --cached --stat

$msgFile = Join-Path $env:TEMP 'fix-1362.txt'
@(
    'feat: v1.36.11 - IHO menu hover + sabir + multi-frame fix',
    '',
    '=== TARIH SORUNU - KESIN COZUM (agent v1.36.2) ===',
    '',
    'Sorun: Mihsap getFaturaBeforeUpdate API yaniti tarih alanini bos donuyor,',
    'DOM da getFaturaMeta cagrildiginda henuz form yuklenmemis oluyor.',
    'Sonuc: meta.tarih null kaliyor, log ekraninda Tarih X gorunuyor.',
    '',
    'Cozum (3 katmanli):',
    '1. getFaturaMeta zaten 15+ alan adi + sub-obje + DOM tariyor',
    '2. YENI: getFaturaMeta sonrasi tarih hala yoksa 250ms araliklarla 12 deneme',
    '   (3sn toplam) DOM polling - Mihsap form yuklenirken tarihi yakala',
    '3. SON CARE: Hala bulunamadiysa hedef ayin 15ini kullan',
    '   (fatura zaten o ay icin secildi, AI gorselden de tarihi gorur)',
    '',
    'AGENT_VERSION 1.36.0 -> 1.36.2 - kullanici sahsen DevTools console.da',
    '"[Moren Agent] yuklendi v1.36.2" gorerek dogru surumu yukledigini onaylar.',
    '',
    '=== BANKA TAKIP - 3 AYLIK CEYREK DONEM ===',
    '- input type=month yerine Yil + Ceyrek dropdown',
    '- Q1 (Ocak-Mart) / Q2 (Nisan-Haziran) / Q3 (Temmuz-Eylul) / Q4 (Ekim-Aralik)',
    '- Donem hala YYYY-MM (ceyregin ilk ayi)',
    '',
    '=== MUKELLEF KARTI - SADECE DEFTER TURU RADIO ===',
    '- Yeni mukellef + Mukellef edit formuna "Defter Turu" karti',
    '- Bilanco / Isletme Defteri radio (gorsel kart secimi)',
    '- Bilanco secilirse Banka Takip listesinde gorunur',
    '- Backend Zod schema: defterTuru BILANCO|ISLETME enum',
    '- Backend select: defterTuru: true',
    '',
    'NOT: Banka hesabi ekleme/yonetim bolumu mukellef kartindan kaldirildi.',
    'Kullanici istegi uzerine sadece Banka Takip modulu icindeki "Hesaplar"',
    'butonu uzerinden yonetilir (tek yerden, sade akis).',
    '',
    '=== ONAY KUYRUGU - MIHSAP SAYFASINA ENTEGRE ===',
    '- /panel/onay-kuyrugu hala mevcut (detayli gorunum)',
    '- Mihsap Fatura Isleme sayfasina inline "Bekleyen Onaylar" paneli eklendi',
    '- Her satirda: AI onerisi + gecmis beklenen + sapma sebebi',
    '- Inline butonlar: Onayla / Reddet / Duzelt (detay sayfasina)',
    '- 5sn refetch interval, badge ile bekleyen sayisi',
    '- Kullanici fatura islerken ayni ekranda onay verebilir',
    '',
    '=== FIRMA HAFIZASI - MUKELLEF FILTRESI ===',
    '- "Tum Mukellefler" + her mukellef icin dropdown filtre',
    '- Backend: listVendorMemory artik taxpayerId param kabul eder',
    '- Filtre seciliyse sadece o mukellefin kararlari gosterilir',
    '- "Ortak karar" goruyor sikayeti cozuldu - artik ayrim yapilabilir',
    '',
    '=== SIDEBAR - ONAY KUYRUGU TASINDI ===',
    '- /panel/onay-kuyrugu menu maddesi sidebardan kaldirildi',
    '- Bekleyen sayisi badge artik Fatura Isleme menusunde gorunur',
    '- /panel/onay-kuyrugu sayfa redirect: /panel/ajanlar/mihsap a yonlendirir',
    '',
    '=== MIHSAP SAYFA SIRASI DEGISTI ===',
    '- Yeni sira: Komut Bari -> Bekleyen Onaylar (en uste) -> Canli Islem Akisi -> Mukellef Ozeti (alta)',
    '- Kullanici istegi: once onay verilecekler, sonra canli akis, sonra mukellef listesi',
    '',
    '=== HOTFIX: banka-takip page.tsx kapanma eksigi ===',
    '- Hesap Ekle butonu style bloku yarida kesilmisti (Vercel build Syntax Error)',
    '- Buton style/icerik + 3 div + return + fonksiyon kapanisi tamamlandi',
    '',
    '=== LOG TARIH/BELGE TURU KOKTEN COZUM (agent v1.36.3 + frontend) ===',
    'Sorun: Log kartinda Tarih: X gosteriyor, Belge Turu: X gosteriyor.',
    'Sebep:',
    '  1) Bazi mihsap fatura kayitlarinda meta.tarih ve meta.belgeTuru bos donuyordu.',
    '  2) Frontend prefix tablosu KAA/J81/KE3 gibi yaygin e-Fatura prefiksini taniyordu.',
    'Cozum:',
    '  A) agent.js logEvent: her log meta sina otomatik donem (komutun ay i) +',
    '     agentVersion ekler. Boylece tarih hicbir yerden okunamasa bile meta.donem',
    '     sayesinde frontend "ortalama 15.04.2026" gosterebilir.',
    '  B) agent.js getFaturaMeta: belgeTuru icin fisNo prefix tablosu genisletildi:',
    '     KAA, KE3, J81, MK1, MUH gibi gercek seriler tanindi.',
    '  C) frontend log-format.ts: extractFaturaTarihi son care olarak meta.donem den',
    '     ay 15 ini turetir; inferBelgeTuru fisNo prefix tablosu agent ile senkron.',
    'AGENT_VERSION 1.36.6 -> 1.36.10 (console.da v1.36.10 gorulmeli, yoksa eski cache).',
    '',
    '=== v1.36.10 KRITIK FIX: RELOAD-RESUME ===',
    'Sorun: Firma degisiminden sonra (Tamam tiklayinca) Luca sayfa reload ediyordu',
    '       -> agent script olduyor -> menu navigasyonu yapilamiyordu.',
    'Cozum: Tamam tiklamadan once job state localStorage a yazilir (IHO_RESUME_KEY).',
    '       Reload sonrasi yeni agent yuklendiginde 2sn icinde checkIhoResume',
    '       calisir, varsa kalan job u alir, firma secimini ATLAR ve menu',
    '       navigasyonundan devam eder. 5 dk dan eski state ler temizlenir.',
    '',
    '=== v1.36.9 KRITIK FIX: ESKI LUCA JOB SPAM FIXED ===',
    'Sorun: Polling acildiginda backend kuyrukta bekleyen ESKI job lar (EARSIV_ALIS,',
    '       KDV_191 vb.) cikti, agent onlari Mihsap sayfasinda mizan formu arayarak',
    '       process etmeye calisti -> her 15sn de hata spam i.',
    'Cozum: Agent yalnizca IHO_FETCH ve MIZAN tiplerini destekler. Diger eski tipler',
    '       hemen "failed" isaretlenip atlanir, polling listesinden cikar.',
    '',
    '=== KRITIK FIX: LUCA POLLING TEKRAR ACILDI ===',
    'v1.36.4 te kullanici sikayeti uzerine Luca polling kapatilmisti.',
    'IHO_FETCH icin gerekli oldugu icin TEKRAR ACILDI:',
    '  - processLucaJobs basindaki "return;" engeli kaldirildi',
    '  - setInterval(processLucaJobs, 15000) yeniden aktif',
    'Agent her 15sn de backend kuyrugundan IHO_FETCH veya KDV Kontrol job lari ceker.',
    '',
    '=== IHO LUCA TAM OTOMASYON (v1.36.7) ===',
    'Backend: IsletmeHesapOzetiService.lucaCek -> IHO_FETCH job tipi olusturur,',
    '         donem "YYYY-MM-DD_YYYY-MM-DD" formatinda (ceyrek bas-son),',
    '         mukellefAdi meta olarak job a eklenir (firma secim icin).',
    'Agent (agent.js): yeni fonksiyon fetchLucaGelirGiderListesi(job)',
    '  1) #SirketCombo da firma adi text match -> sec -> button.no-bold "Tamam"',
    '  2) Menu: "Isletme Defteri" -> "Gider Islemleri" -> "Gelir/Gider Listesi"',
    '  3) input[name=tarih_ilk/son] (DD/MM/YYYY) + #report_type=XLSX',
    '  4) button.green-btn "Rapor" -> Excel yakala -> upload-iho?ihoId=...',
    'Backend upload-iho zaten parseIsletmeExcelDetayli ile parse edip 4 alani yaziyor.',
    'Kullanici sadece Luca sekmesini acik tutmali; agent kalan her seyi yapiyor.',
    '',
    '=== v1.36.6 HIZLANDIRMA PAKETI (A+B+D+E) ===',
    'A) waitSaved minWait 5sn -> 1.5sn (Bilanco + Isletme dali, 2 yer)',
    '   + URL erken degisirse minWait i de bekleme, direkt saved say',
    'B) onaylaSonrasiF2: 5sn sabit -> 3sn akilli polling',
    '   clickKaydetOnayla: F2 sonrasi 1200ms -> 600ms',
    'D) getFaturaImageBase64 polling 400ms -> 200ms',
    'E) waitSaved URL kontrol 250ms -> 100ms (2 yer)',
    'Tahmini kazanc: fatura basina ~6 saniye (100 fatura ~10 dk azalma).',
    '',
    '=== IHO: KDV Kontrol Excel inden DONEM BASI STOK ayri parse ===',
    'parseIsletmeExcelDetayli artik 4. alan donuyor: donemBasiStok.',
    'Aciklama="DONEM BASI STOK" satiri Alinan Emtia toplamindan ayrilir,',
    'IHO da Donem Basi Stok alanina yazilir (sadece Q1 de dolu).',
    '',
    '=== KRITIK: AGENT KAYNAGI 2 DOSYADA + VERCEL CACHE FIX ===',
    'Tespit: Bookmarklet portal.morenmusavirlik.com/moren-agent.js cekiyor (Vercel).',
    'Ayrica backend /luca/agent/runtime.js -> apps/api/public/agent-runtime.js serve ediyor.',
    'Iki dosya FARKLI sürümlerde olabiliyordu - kullanici eskisini caleslirstirmiyordu.',
    'Cozum:',
    '  1) agent-runtime.js artik moren-agent.js ile TAM SENKRON (her commit te beraber)',
    '  2) next.config.js -> /moren-agent.js endpoint`une no-cache header eklendi',
    '     (Vercel default 1 yil cache yerine her tiklamada fresh JS gelir)',
    '',
    '=== ASIL BUYUK SORUN: emin_degil fatura gorseli alinamadi ===',
    'Sebep: getFaturaImageBase64 sadece top-level documentdaki canvasi ariyor +',
    'boyut esigi 200x200 cok yuksekti + iframe icindeki PDF.js canvasini gormedi.',
    'Sonuc: AI ye gorsel gonderilemedi -> emin_degil -> butun faturalar atlandi',
    '       (TUM ALANLAR DOLU OLMASINA RAGMEN!).',
    'Cozum (agent v1.36.5):',
    '  1) Top-level + tum iframe + iframe.iframe (2 derin) tarama',
    '  2) Canvas yoksa <img> elementlerine bak (naturalW/H ile)',
    '  3) Boyut esigi 200x200 -> 150x150 (kucuk thumbnail bile yeter)',
    '  4) En buyuk canvas i sec (genelde fatura)',
    '  5) Timeout 10sn -> 15sn (PDF render gecikmesi icin)',
    '  6) Bulamazsa console.warn ile debug detayli yazar (kac canvas, kac iframe)',
    '',
    '=== LOG TARIH BADGE + DEFANS (event.ts FALLBACK GERI ALINDI) ===',
    'Onceki yanlis fix: event.ts fallback faturanin tarihini DEGIL kayit anini',
    'kullaniyordu - yaniltici tarih (15.05.2026) gosteriyordu. Geri alindi.',
    'Yeni durum:',
    '  - extractFaturaTarihi yalniz GUVENILIR kaynaklari kullanir:',
    '    meta.tarih > meta.faturaTarihi > mesaj prefix > meta.donem (agent v1.36.3+)',
    '  - Hicbir kaynak yoksa "—" gosterir (X yerine), YANILTICI tarih KOYULMAZ.',
    '  - LogCard her satirda meta.agentVersion badge gosterir:',
    '    yesil v1.36.4 = guncel agent / kirmizi v1.35.x = eski cache',
    '  - Eski sürüm görünüyorsa kullanici bookmarkleti yenilemeli (alttaki talimat).',
    '',
    '=== LUCA OTOMATIK ISLEMI KAPATILDI ===',
    'Sorun: Luca sayfasinda agent her 15 sn de bir bekleyen job sorgulayip',
    'otomatik form doldurup "Rapor" butonuna basiyordu. Kullanici Luca yi',
    'manuel kullanmaya calistiginda firma/donem context i degisip duruyordu.',
    'Cozum:',
    '  - processLucaJobs fonksiyonu basina early-return eklendi',
    '  - setInterval(processLucaJobs, 15000) yorum satirina alindi',
    '  - syncLucaSession (60sn cookie sync) de yorum satirina alindi',
    'Luca modulu tekrar acildiginda bu uc yeri yeniden aktive et.',
    '',
    '=== 8 MODUL GECICI OLARAK KAPATILDI ===',
    'Sidebardan kaldirildi + sayfalar redirecte donusturuldu',
    '(islem yapildikca yeniden acilacak):',
    '- Duzeltme Bekleyen (/panel/ajanlar/mihsap/incele -> mihsap)',
    '- Evrak Yonetimi (/panel/evraklar -> /panel)',
    '- Evrak Yenileme (/panel/evraklar/yenileme -> /panel)',
    '- KDV On-Hazirlik (/panel/ajanlar/kdv-hazirlik -> /panel)',
    '- SGK Bildirge (/panel/ajanlar/sgk -> /panel)',
    '- Tebligat Ozet (/panel/ajanlar/tebligat -> /panel)',
    '- Bordro & SGK (/panel/bordro -> /panel)',
    '- Luca Cekim (/panel/ajanlar/luca -> /panel)',
    'Eski kod git history.de korunuyor - gerektiginde geri alinabilir.',
    '',
    '=== BANKA TAKIP - DURUM FILTRESI ===',
    '- Yeni filtre dropdown: Tumu / Eksigeldi / Hepsigeldi / Islenmedi /',
    '  Hepsiislendi / Hesapsiz',
    '- KPI kartlari tiklanabilir - filtre kisayolu olarak calisir',
    '- Aktif filtre KPI kartinda renkli border + glow ile vurgulanir',
    '- "Filtreyi Kaldir" linki + sayim ("X mukellef gosteriliyor")'
) | Out-File -FilePath $msgFile -Encoding utf8 -Force

git commit -F $msgFile
$ce = $LASTEXITCODE
Remove-Item -Force -ErrorAction SilentlyContinue $msgFile

if ($ce -ne 0) { Write-Host "Commit edilecek bir sey yok" -ForegroundColor Yellow; exit 0 }

git push origin main
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "BASARILI: v1.36.2 push" -ForegroundColor Green
git log --oneline -3
