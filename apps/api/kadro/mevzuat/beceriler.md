# Mevzuat Takipçisi — Beceriler

## 1. Günlük tarama (07:30)
1. `get_gundem` → Resmi Gazete özetleri, kur, TÜFE.
2. Vergi/SGK/e-belge ilgili madde var mı? Yoksa "bugün ilgili değişiklik yok" → bitir.
3. Varsa her madde için `research_official_sources` ile resmi metni bul; tarih + kaynak.
4. Değişiklik kartı doldur (aşağıda).
5. `list_taxpayers` + `get_beyanname_config` ile etkilenen mükellefleri süz.
6. Koordinatör'e günlük özet (en fazla 5 kart; fazlası varsa önem sırasıyla ve "devamı var").

## 2. Değişiklik kartı
```
BAŞLIK: (tek satır)
KAYNAK: Resmi Gazete <sayı/tarih> / GİB sirküler <no> / SGK genelge <no>
NE DEĞİŞTİ: (2-3 satır, eski → yeni)
YÜRÜRLÜK: <tarih> (geçmişe etkili mi?)
KİMİ İLGİLENDİRİR: (kapsam: sektör/defter türü/il/e-belge/çalışan)
ETKİLENEN MÜKELLEF: kesin n (liste) / muhtemel m (liste)
İLGİLİ ÇALIŞAN: Beyanname / Bordro-SGK / e-Defter / Fatura / Risk
YAPILMASI GEREKEN: (ofis içi: referans güncelle, takvim güncelle, mükellef bilgilendir — kararı sahip verir)
```

## 3. Soruya cevap ("X oranı değişti mi?")
1. `get_accounting_reference` → portalda kayıtlı değer.
2. `research_official_sources` → güncel resmi değer.
3. Aynıysa "değişmedi, kaynak: …"; farklıysa "değişti: eski → yeni, yürürlük …, portal referansı GÜNCELLENMELİ".

## 4. Yıl başı sabit taraması (Aralık son hafta – Ocak ilk hafta)
- Asgari ücret, SGK tavan, gelir vergisi dilimleri, damga, fatura/amortisman hadleri, yemek/yol istisnası, e-fatura geçiş haddi, gecikme zammı → tek tablo → Koordinatör'e "referans güncelleme listesi".

## 5. Mücbir sebep / süre uzatımı
- İlan görülünce: etkilenen il/ilçe → `list_taxpayers` il süzgeci → mükellef listesi → aynı gün Koordinatör'e KIRMIZI.
