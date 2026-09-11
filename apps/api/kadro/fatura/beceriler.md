# Fatura Muhasebecisi — Beceriler

## 1. Dönem faturalarını işleme (ana zincir)
1. `get_taxpayer` → mükellef türü (bilanço / işletme), e-belge durumu, hesap planı.
2. Çekim: `get_mihsap_agent_jobs` / `get_luca_agent_jobs` ile son çekim tarihine bak; eksikse `preview_agent_command` ile çekim komutu hazırla (onay → `create_confirmed_agent_command`).
3. `list_earsiv_invoices` (ham) ile `list_fatura_merkezi` (işlenen) karşılaştır → işlenmemişleri bul.
4. Her fatura için: içerik → gider türü → hesap adayı → ad uyuşuyor mu? Evet → ata. Hayır → BOŞ + şüpheli listesi.
5. Cari: VKN ile `get_firma_hafizasi`; yoksa yeni cari önerisi (onaya).
6. KDV/tevkifat kontrolü (kurallar.md).
7. Fiş taslakları: her fiş dengeli mi kontrol.
8. Luca aktarım paketi hazırla → Luca Operatörü'ne (kuru test).
9. Rapor: işlenen N, şüpheli M (nedenleriyle), Luca'ya yapacaktım K fiş.

## 2. Şüpheli fatura ayırma
- Şüphe nedenleri: hesap adı uyuşmuyor / oran okunamadı / aritmetik tutmuyor / cari belirsiz / mükerrer olabilir / demirbaş olabilir / iade.
- Her şüpheli için tek satır: fatura no / satıcı / tutar / neden / ne bekleniyor (sahipten tek seçim).

## 3. Düzeltmeden öğrenme
1. Sahip bir faturanın hesabını düzelttiyse: aynı satıcı + aynı içerik için kural öner ("ELİT PETROL motor yağı → 740.01.002").
2. Kural genellenebilirse `save_ai_memory`; kaydettiğini tek cümle geri oku.
3. Tek seferlik düzeltmeyi kural yapma.

## 4. Luca'ya fiş aktarım (Operatör'e talimat şablonu)
```
Mükellef: <ad> (Luca firma: <ad>)  Dönem: <yyyy-mm>
Yöntem: Excel Fiş Aktarım / Hızlı Fiş
Fiş sayısı: N  Toplam borç=alacak: X TL
Adımlar: menü yolu → dosya seç → önizleme oku → (KURU TEST: Kaydet BASMA)
Doğrulama: Luca önizlemesindeki satır sayısı ve toplam = paket ile aynı mı
```
