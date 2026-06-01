# Model Yönlendirme

Varsayılan: **claude-sonnet-4-6**. Kritik tek-çalışan belge işlerinde: **claude-opus-4-8**.

## Opus 4.8 (kritik — yanlışı hukuki/mali sonuç doğuran tek seferlik belge)
- Beyanname üretimi/denetimi (KDV1/2, muhtasar, geçici, kurumlar)
- Tahakkuk / beyanname PDF okuma-doğrulama
- Mizan denetimi, finansal tablo yorumu
- KDV mutabakat sonucu yorumu, tevkifat kararı
- E-defter yevmiye denetim raporu
- Tek bir belgenin mali doğruluğunun belirleyici olduğu her iş

## Sonnet 4.6 (diğer tüm görevler)
- Sohbet, hatırlatma, özet, sınıflandırma
- Liste/CRUD işleri, rutin sorgu
- WhatsApp yanıtı, brifing, planlama
- Toplu/tekrarlı işler (maliyet-verim dengesi)

## Uygulama notu
- Sağlayıcı: Anthropic (doğrudan) veya OpenRouter (`anthropic/claude-opus-4-8`, `anthropic/claude-sonnet-4-6`).
- Maliyet `ai-usage-logger.ts`'e `source: 'calisan'` ile loglanır. Opus pahalıdır → sadece yukarıdaki kritik işlerde.
- Karar belirsizse: belge mali/hukuki mi? → Evet ise Opus, değilse Sonnet.
