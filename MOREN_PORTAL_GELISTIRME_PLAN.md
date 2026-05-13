# MOREN PORTAL GELİŞTİRME AI EKİBİ — Plan

## Amaç

Patron'un (Muzaffer Bey) her geliştirme talebini, ayrı bir AI ekibi üstlenir.
Mevcut `Moren Ofis` ekibi günlük mali müşavirlik işlerini (mükellef, vergi,
beyanname) yaparken, bu yeni ekip portal'ın **kendisini geliştirir**.

Patron, "şu modüle şunu ekle" der → ekip GitHub'a kod yazar → PR açar → patron
onaylar → otomatik deploy. Patron, Claude Code ile aylarca konuşma derdinden
kurtulur.

## 4 ajan

| Ajan | Rol | Model | Görev |
|---|---|---|---|
| **EREN** (32) | Proje Yöneticisi | Gemini 2.5 Flash | Talebi parçalara böl, görev kartları aç, ekibi yönlendir, durum raporla |
| **SEDA** (29) | Senior Developer | Claude Sonnet 4.6 | Backend/frontend kod yaz, dosya düzenle, commit at, PR aç |
| **OKAN** (31) | Kod Denetçisi | Claude Sonnet 4.6 | PR'ları gözden geçir, hata/güvenlik/mimari kontrol |
| **BERK** (28) | DevOps Mühendisi | GPT-5 mini | Migration koş, build doğrula, deploy izle, smoke test |

## Sistem mimarisi

```
PATRON YAZIYOR
   ↓
EREN — talebi analiz, görev kartı
   ↓
SEDA — branch açar, kod yazar, build çalıştırır
   ↓
OKAN — PR'da inceler, sorun varsa SEDA'ya geri yollar
   ↓
BERK — merge sonrası migration + deploy + smoke test
   ↓
EREN — patrona "tamamlandı, şu URL'de" raporu
```

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

## Konuşma akışı örneği

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
| Orta feature | Tüm ekip ~$0.50 | 10 feature × $0.50 = $5 |
| Büyük refactor | Tüm ekip ~$2 | 2 refactor × $2 = $4 |
| Otomasyon önerileri (DENİZ ile entegre) | $1-2 | $2 |
| **Toplam** | | **~$15-30/ay** |

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
