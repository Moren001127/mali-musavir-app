# MOREN PORTAL GELİŞTİRME AI EKİBİ — Plan

## Amaç

Patron'un (Muzaffer Bey) her geliştirme talebini, ayrı bir AI ekibi üstlenir.
Mevcut `Moren Ofis` ekibi günlük mali müşavirlik işlerini (mükellef, vergi,
beyanname) yaparken, bu yeni ekip portal'ın **kendisini geliştirir**.

Patron, "şu modüle şunu ekle" der → ekip GitHub'a kod yazar → PR açar → patron
onaylar → otomatik deploy. Patron, Claude Code ile aylarca konuşma derdinden
kurtulur.

## 5 ajan

| Ajan | Rol | Model | Görev |
|---|---|---|---|
| **EREN** (32) | Proje Yöneticisi | Gemini 2.5 Flash | Talebi parçalara böl, görev kartları aç, ekibi yönlendir, durum raporla |
| **MELİS** (27) | UI/UX & Görsel Tasarım | Claude Sonnet 4.6 | Tasarım kararları, renk/tipografi, mockup, CSS/Tailwind, ikon seçimi, görsel tutarlılık |
| **SEDA** (29) | Senior Developer | Claude Sonnet 4.6 | Backend/frontend kod yaz, dosya düzenle, commit at, PR aç |
| **OKAN** (31) | Kod Denetçisi | Claude Sonnet 4.6 | PR'ları gözden geçir, hata/güvenlik/mimari kontrol |
| **BERK** (28) | DevOps Mühendisi | GPT-5 mini | Migration koş, build doğrula, deploy izle, smoke test |

## Sistem mimarisi

```
PATRON YAZIYOR
   ↓
EREN — talebi analiz, görev kartı
   ↓
   ├─ Görsel/UI içeriyorsa: MELİS önce mockup + tasarım kararı
   ↓                              ↓ (tasarım onaylı)
SEDA — branch açar, kod yazar (MELİS'in spec'i ile birlikte)
   ↓
OKAN — PR'da inceler, MELİS görsel uyum kontrolü yapar
   ↓
BERK — merge sonrası migration + deploy + smoke test
   ↓
EREN — patrona "tamamlandı, şu URL'de" raporu
```

**MELİS ne zaman devreye girer:**
- ✓ Yeni sayfa/modül tasarımı
- ✓ Renk/tipografi/ikon seçimi
- ✓ Layout değişikliği, responsive uyum
- ✓ Animasyon/transition kararları
- ✓ Tailwind class refactor (DRY tutarlılık)
- ✓ Görsel asset (SVG, illustration) tasarım
- ✗ Backend logic (oraya karışmaz)

## Teknik gereksinimler

1. **GitHub fine-grained PAT** — `Moren001127/mali-musavir-app` reposunda write
   yetkili. Patron yaratacak, Railway env'a `MOREN_DEV_GITHUB_TOKEN` ekleyecek.

2. **Worktree desteği** — her görev kendi branch'inde, paralel iş çakışmaz.
   `apps/api/.dev-worktrees/` altında geçici checkout'lar.

3. **Tool API'ler** — agent'a verilecek fonksiyonlar:
   - `read_file(path)`, `write_file(path, content)`, `edit_file(path, oldStr, newStr)`
   - `bash(cmd)` — sınırlı: sadece test/build/git komutları, `rm -rf` yasak
   - `grep(pattern, path)`, `glob(pattern)`
   - `git_branch(name)`, `git_commit(msg)`, `git_push()`, `gh_pr_create(...)`

4. **Self-eval** — her SEDA commit'inden sonra TypeScript build + lint çalıştır.
   Hata varsa SEDA otomatik düzeltir, ya da OKAN'a "kontrol et" der.

5. **Safety guards:**
   - Patron onayı olmadan main'e direkt push YOK (sadece PR)
   - `package.json` değişiklikleri = patron onayı
   - Dependency ekleme = patron onayı
   - DB migration yaratma = patron onayı (preview SQL gösterir)
   - Production database SİLME = yasak (hardcoded)

## Modül yapısı

```
apps/api/src/moren-dev/
├── moren-dev.module.ts
├── moren-dev.controller.ts
├── moren-dev.service.ts (orchestrator)
├── agents/
│   ├── eren.ts (manager persona)
│   ├── melis.ts (designer persona)
│   ├── seda.ts (developer persona)
│   ├── okan.ts (reviewer persona)
│   └── berk.ts (devops persona)
├── tools/
│   ├── file-tools.ts (read/write/edit)
│   ├── git-tools.ts (branch/commit/push)
│   ├── gh-tools.ts (PR creation, comment)
│   ├── bash-tool.ts (sandboxed exec)
│   └── eval-tool.ts (build + lint + test)
└── workflows/
    ├── feature-request.ts
    ├── bug-fix.ts
    └── refactor.ts

apps/web/src/app/(panel)/panel/moren-dev/
├── page.tsx (Dev ekibi sahnesi — kod editor görselli)
└── _components/
    ├── DevTeam.tsx (4 ajan görsel)
    ├── TaskBoard.tsx (kart kanban)
    ├── PrList.tsx (açık PR'lar)
    └── Activity.tsx (canlı log akışı)
```

## Kanban görsel

Her görev kartı için durumlar:
- 📥 **Yeni** (patron yazdı, EREN okudu)
- 🔍 **Analiz** (EREN parçalıyor)
- 💻 **Kodlanıyor** (SEDA çalışıyor)
- 👀 **İnceleniyor** (OKAN bakıyor)
- 🚀 **Deploy ediliyor** (BERK çalışıyor)
- ✅ **Tamamlandı** (canlıda)
- ⏸ **Onay bekliyor** (patron'a soruldu)

## Görsel ofis sahnesi

Moren Ofis'ten farklı — bu **yazılım stüdyosu**:
- Karanlık tema, ekran ışıkları daha vurgulu
- Her ajanın masasında **kod editörü** ekranı (renkli syntax)
- Whiteboard duvarda — task kanban
- GitHub iconları, branch çizgileri
- "build yeşil" / "build kırmızı" göstergesi

## MELİS — Detaylı tasarımcı profili

- **Yaş:** 27, grafik tasarım + endüstri uygulama deneyimli
- **Kişilik:** Estet, detaycı, "neden bu renk?" "neden bu boşluk?" sorusunu sorar
- **Bildikleri:**
  - Tailwind CSS ileri seviye, design tokens
  - Figma'da düşünme alışkanlığı (kod yazsa da)
  - Tipografi (Fraunces, Plus Jakarta Sans — Moren'in mevcut fontları)
  - Accessible color contrast (WCAG AA minimum)
  - Renk paleti yönetimi (mevcut tema: altın #d4b876, lacivert, gece)
  - SVG illustration (Open Peeps, Storyset)
  - Animasyon: Framer Motion / CSS transitions
- **Onay verir/vermez:**
  - ✓ Boşluk/padding tutarlı mı?
  - ✓ Renk paletine uygun mu?
  - ✓ Font ölçeği doğru mu (8-10-12-14-16 sistemi)?
  - ✓ Mobile responsive mi?
  - ✓ Dark/light okunabilirlik?
  - ✗ Markaya uymayan renk
  - ✗ Inline style ile kaos (Tailwind tutarlılığı)

## Konuşma akışı örneği — UI içeren feature

```
Patron: "Mükellef kartlarını yeniden tasarla, daha modern olsun"

EREN: "Tamam Muzaffer Bey, MELİS önce tasarım kararı versin, sonra SEDA
       uygulayacak. Tahmini 25dk."

MELİS: "Mevcut kartlara baktım. 3 önerim var:
       1. Mevcut: düz kart, KDV/SGK info satırı
       2. Önerim A: Üst rozet (durum), büyük isim, alt grid (4 metrik)
       3. Önerim B: Avatar baş harfler + sağ tarafta hızlı aksiyonlar
       
       B'yi öneriyorum — Moren'in altın aksanı ile daha şık. Renkler:
       - Aktif: bg rgba(212,184,118,0.06)
       - Hover: border altın
       - Risk işareti: kırmızı dot sağ üst
       
       SEDA, Tailwind sınıfları hazır:
       'rounded-lg p-4 border border-white/8 hover:border-[#d4b876]/40 transition-all'
       
       Mockup'ı Figma'da gönderiyorum (link), kabul edersen başlasın."

Patron: "Tamam B"

SEDA: "Branch: design/taxpayer-cards-v2
       MELİS'in spec'i ile uyguluyorum...
       PR #48 açıldı."

MELİS: "PR #48 görsel kontrol:
       ✓ Renkler doğru
       ⚠ Avatar harfler 11px küçük, 13px olsun
       ⚠ Mobile breakpoint'te 1 sütuna düşmüyor
       SEDA düzeltebilir mi?"

SEDA: "Düzeltildi, push edildi."

OKAN: "Kod kalitesi OK, accessibility tab order doğru. Onayladım."

BERK: "Deploy ediyorum...
       Vercel: ready ✓
       Smoke test: /panel/mukellefler render OK
       Canlıda."

EREN: "Muzaffer Bey, mükellef kartları yeni tasarımıyla canlıda.
       MELİS + SEDA 22dk'da bitirdi. Bak ve geri bildirim ver."
```

## Eski örnek — sadece backend (MELİS gerek olmayan)

```
Patron: "Mükellef listesine arama özelliği ekle, ad/VKN ile filtrelesin"

EREN: "Tamam Muzaffer Bey, 3 alt göreve böldüm:
       1. Backend: GET /taxpayers?search=X query param desteği
       2. Frontend: input bar + debounce 300ms
       3. Test: 5 mükelleflik fixture ile
       SEDA başlıyor, 15dk sonra rapor veririm."

SEDA: "Branch açtım: feature/taxpayer-search
       Backend: taxpayers.controller.ts:33 - search param eklendi
       Service: prisma where contains insensitive
       Frontend: page.tsx - SearchInput component
       Build: yeşil ✓
       PR #47 açıldı, OKAN'a yollandı."

OKAN: "PR #47 incelendi:
       ✓ Backend logic doğru
       ✓ Frontend UX iyi
       ⚠ Test eksik — SEDA test ekleyebilir misin?"

SEDA: "Test eklendi: __tests__/taxpayer-search.spec.ts
       npm test geçti ✓
       PR #47 güncellendi."

OKAN: "Tamam, onayladım."

BERK: "PR #47 merge oluyor...
       Migration: yok
       Build: Vercel deploy başladı (2dk tahmin)
       Smoke test: GET /api/v1/taxpayers?search=Ahmet → 200 OK
       Frontend: portal.morenmusavirlik.com/panel/mukellefler ✓
       Canlıda."

EREN: "Muzaffer Bey, 'Mükellef listesine arama' tamamlandı.
       PR #47, 23 dakikada bitti.
       Canlıda test edebilirsin."
```

## Maliyet

| İş türü | LLM çağrı | Aylık tahmin |
|---|---|---|
| Küçük bug fix | SEDA + OKAN ~$0.10 | 30 fix × $0.10 = $3 |
| Orta feature (UI içeren) | EREN+MELİS+SEDA+OKAN ~$0.60 | 10 feature × $0.60 = $6 |
| Büyük refactor / yeni modül | Tüm 5 ekip ~$2.50 | 2 refactor × $2.50 = $5 |
| Sadece görsel iyileştirme | EREN+MELİS+SEDA ~$0.30 | 5 × $0.30 = $1.5 |
| Otomasyon önerileri (DENİZ ile entegre) | $1-2 | $2 |
| **Toplam** | | **~$18-35/ay** |

Patron sürekli Claude Code premium konuşmasından **kurtulur**.
Ayda $30 ile, sürekli çalışan ekip + sadece sonucu görür.

## İlk uygulama planı

**Hafta 1 (Bu hafta, başlangıç):**
- Backend modül iskeleti (orchestrator + 4 ajan persona)
- Tool wrapping (file ops + bash + git)
- Tek görev workflow (feature-request)
- Test: küçük bir bug fix yaptır

**Hafta 2:**
- Kanban UI
- PR review döngüsü
- Build/lint self-eval
- DENİZ ile entegrasyon (Moren Ofis'ten gelen önerileri otomatik task'a çevir)

**Hafta 3:**
- Migration desteği
- Smoke test framework
- Deploy izleme (Railway/Vercel webhook)
- Mobile push notification

**Hafta 4:**
- Çoklu eşzamanlı task (3 görev paralel)
- Daha akıllı routing (hangi ajan paralel ne yapsın)
- Konuşma geçmişi + hafıza (DENİZ tarzı)

## Açık sorular (yarın karar)

1. **Yetki sınırı:** SEDA `package.json` değiştirebilir mi? Dependency ekleyebilir mi? Önerim: HAYIR onaysız, sadece kod dosyaları değiştirsin.

2. **Test gereksinimi:** Her feature için unit test zorunlu mu? Önerim: Critical path (API endpoint, financial logic) için EVET, UI ufak tweak'ler için HAYIR.

3. **Deploy yetkisi:** BERK otomatik production'a deploy edebilsin mi? Yoksa staging only, patron onayı? Önerim: Staging YES, prod sadece patron "deploy" dediği zaman.

4. **Kaç paralel iş:** Aynı anda 3 görev mi, 1 görev mi? Önerim: Başlangıçta 1 (sıralı), oturduktan sonra 3.

## Sonuç

Bu ekiple Muzaffer Bey saatte 5-10 talep yazabilir, gece uyurken bile portalı
gelişir. Claude Code premium aboneliğinden kurtulur, yıllık ~$2000 tasarruf,
üzerine aylık $30 ile sürekli ekip.

Mali müşavirlik işi (Moren Ofis) + portal geliştirme (Moren Dev) — iki ekip,
bir patron, sıfır boşa giden zaman.
