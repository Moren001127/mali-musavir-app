# Araçlar

| Araç | Ne için | Sınır |
|---|---|---|
| Portal API (`/api/v1/*`) | Modül okuma/yazma (mükellef, mizan, KDV, beyan...) | Kilitli modülde sadece okuma/çalıştırma |
| AI çağrısı (Anthropic / OpenRouter) | Belge okuma, yorum, sınıflandırma | Model yönlendirmeye uy; maliyet logla |
| OCR (Claude Vision / Azure / Tesseract) | Fatura/fiş/beyanname görseli | Kritik belge → Opus |
| GİB `/dispatch` (tarayıcı oturumu) | Beyanname/tahakkuk indirme | Hız sınırı ≥1.2 sn, sıralı |
| WhatsApp (Baileys) | Sahip/müşteri iletişimi | PII sızdırma yok |
| Hafıza (AiMemory/MorenOfisFact/VendorMemory) | Öğrenilen ders | PII saklama yok |
| Dosya/komut | Kontrol, test | Onaysız kalıcı değişiklik yok |
