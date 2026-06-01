# Moren Portal — Claude Çalışma Talimatı

## ⚠️ ÖNCE BUNU OKU
Bu repoda herhangi bir iyileştirmeye / işe başlamadan **ÖNCE** şu dosyayı oku:

> **`bilgi/PROJE-BILGI.md`**

Projenin canlı bilgisi, mimarisi, açık işleri ve kritik kuralları orada tutulur. Önce onu okuyup projeyi öğren, sonra işe başla.

## Kritik kurallar (özet — detay bilgi dosyasında)
- **Üretim CANLI ve çoklu bilgisayar.** Agent / Chrome extension / portal birden fazla bilgisayarda canlı kullanılıyor. Onaysız production veya `apps/api/public/agent-runtime.js` değişikliği **YAPMA**. Önce teşhis koy, patch'i göster, riski açıkla; kullanıcı "uygula / push et" deyince uygula.
- **Doğru sistem = SUNUCU.** Aktif çalışılan yer deploy edilmiş sürüm (API → Railway, Web → Vercel) = `origin/main`. Yerel kopya **sadece yedek**.
- **Docker kullanılmıyor.** `docker-compose.yml` terk edilmiş kalıntı; yerel çalıştırma için Docker'a uğraşma.
- **Kilitli modüllere dokunma** (`KILITLI_MODULLER.md`): Mizan, KDV Kontrol, agent-runtime, E-Arşiv vb.
- Push = production deploy. Sadece kullanıcı onayıyla push et.

## 🔚 OTURUM SONU (her seferinde)
Her işlem / oturum sonunda:
1. **`bilgi/PROJE-BILGI.md`**'yi güncelle — değişen mimari/durum bilgisini ilgili bölüme işle.
2. En alttaki **"Oturum Günlüğü"** bölümüne tarihli tek satır ekle (ne yapıldı).
3. Sonra oturumu bitir.
