# Moren Portal — Claude Çalışma Talimatı

## ⚠️ ÖNCE BUNU OKU
Bu repoda herhangi bir iyileştirmeye / işe başlamadan **ÖNCE** şu dosyayı oku:

> **`bilgi/PROJE-BILGI.md`**

Projenin canlı bilgisi, mimarisi, açık işleri ve kritik kuralları orada tutulur. Önce onu okuyup projeyi öğren, sonra işe başla.

## Kritik kurallar (özet — detay bilgi dosyasında)
- **AI: SADECE Max aboneliği — ücretli API YASAK.** Tüm AI çağrıları `CLAUDE_CODE_OAUTH_TOKEN` (Max) + Agent SDK / `claudeTextViaMax` üzerinden olacak. Token-başı `ANTHROPIC_API_KEY` **kullanılmayacak** (maliyet + aylık tavana takılıp botu susturuyordu). Yeni kod da, mevcut akış düzeltmesi de Max yolundan.
- **Üretim CANLI ve çoklu bilgisayar.** Agent / Chrome extension / portal birden fazla bilgisayarda canlı kullanılıyor. Onaysız production veya `apps/api/public/agent-runtime.js` değişikliği **YAPMA**. Önce teşhis koy, patch'i göster, riski açıkla; kullanıcı "uygula / push et" deyince uygula.
- **Doğru sistem = SUNUCU.** Aktif çalışılan yer deploy edilmiş sürüm (API → Railway, Web → Vercel) = `origin/main`. Yerel kopya **sadece yedek**.
- **Docker kullanılmıyor.** `docker-compose.yml` terk edilmiş kalıntı; yerel çalıştırma için Docker'a uğraşma.
- **Kilitli modüllere dokunma** (`KILITLI_MODULLER.md`): Mizan, KDV Kontrol, agent-runtime, E-Arşiv vb.
- **Push = production deploy. SORMA (kullanıcı talimatı 2026-06-10).** Tip kontrolü (tsc) ve testlerden geçen, doğrulanmış değişiklikleri **her seferinde tekrar onay sormadan** push et. Canlı güvenliğini pre-push hook'ları (kilit kontrolü + regresyon testleri) zaten her push'ta sağlıyor. Kullanıcı "tekrar onay iste" diyene kadar bu geçerli. (Kilitli modüllerde yine teşhis + patch göster, ama push için ayrı onay bekleme.)

## 🔚 OTURUM SONU (her seferinde)
Her işlem / oturum sonunda:
1. **`bilgi/PROJE-BILGI.md`**'yi güncelle — değişen mimari/durum bilgisini ilgili bölüme işle.
2. En alttaki **"Oturum Günlüğü"** bölümüne tarihli tek satır ekle (ne yapıldı).
3. Sonra oturumu bitir.
