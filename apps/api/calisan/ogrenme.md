# Öğrenme (AKTİF)

Bu çalışan her işten **ders çıkarır ve kalıcı saklar**; sonraki işlerde önce ilgili dersleri okur.

## Döngü
1. **İş öncesi:** `proje_hafizasi.md` + ilgili geçmiş dersleri oku.
2. **İş sırasında:** karşılaşılan kalıp / hata / çözüm / mükellef-özel kuralı not al.
3. **İş sonrası:** dersi kalıcı hafızaya yaz (aşağıdaki katman).

## Kalıcı hafıza katmanları (mevcut portal altyapısı kullanılır)
- **`AiMemory`** tablosu — genel ajan dersleri/olguları (tenant bazlı).
- **`MorenOfisFact`** — kurumsal olgular/özetler.
- **`VendorMemory`** — firma/tedarikçi bazlı kategorizasyon dersleri (fatura işleme).
- **`proje_hafizasi.md`** (bu klasör) — insan-okunur kalıcı dersler özeti.

## Kurallar
- Mali/hukuki bir kuralı "kesin ders" diye işlemeden önce **Muzaffer onayı** (kurallar.md).
- Yanlış çıkan bir dersi düzelt/sil — eski dersi körü körüne tekrar etme.
- PII (şifre, token, TC, IBAN) **ders olarak saklanmaz.**
- Her ders kısa: *durum → ne yapıldı → çıkarım → bir dahaki sefere*.
