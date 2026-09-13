# Mağaza Ekran Görüntüleri — 2026-09-13

Hazır görüntüler: `store/screenshots-2026-09/<cihaz>/<nn>-<ekran>.png` (32 dosya, 4 cihaz × 8 ekran).
Eski `screenshots/` klasörü (Temmuz, eski tasarım) silindi.

## Hangi ekranlar (sıra = mağazada gösterim sırası)
| # | Dosya | Ekran | Neden |
|---|---|---|---|
| 1 | `01-secim` | Giriş türü seçimi (Mali Müşavir / Mükellef) | "Tek uygulama, iki dünya" — ilk izlenim |
| 2 | `02-giris` | Giriş formu (Beni hatırla, Face ID ile açılış) | Güvenli giriş |
| 3 | `03-ozet` | Müşavir Özet (beyanname durumu, iş akışı) | Ana ekran |
| 4 | `04-moduller` | Modüller ızgarası | Kapsam |
| 5 | `05-belge-tara` | Belge Tara (kamera → Fatura İşleme Merkezi) | Yerel özellik (VisionKit) |
| 6 | `06-moren-ai` | MOREN AI sohbeti | Fark yaratan özellik |
| 7 | `07-kdv-panosu` | KDV Durum Panosu | Modül örneği |
| 8 | `08-mukellef-ozet` | Mükellef Özet | Mükellef tarafı |

Mağazalar en az 2–3 görüntü ister; önerilen set: 1, 3, 5, 6, 8 (+ Android için 4).

## Boyutlar (piksel) ve hangi klasör
| Klasör | Boyut | Nereye yüklenir |
|---|---|---|
| `iphone-6.9/` | 1320 × 2868 | App Store Connect → iPhone 6.9" (iPhone 16 Pro Max) — **zorunlu set** (6.7"/6.5" ile de kabul edilir) |
| `iphone-6.7/` | 1290 × 2796 | App Store Connect → iPhone 6.7" (14/15 Pro Max) |
| `iphone-6.5/` | 1284 × 2778 | App Store Connect → iPhone 6.5" (11 Pro Max sınıfı; 1242×2688 de kabul) |
| `android/` | 1080 × 2400 | Play Console → Telefon ekran görüntüleri (en az 2, en çok 8; 16:9–9:16 arası) |

Play ayrıca **1024 × 500 "öne çıkan grafik"** ister (bu klasörde YOK — logo + "Mali müşavirlik cepte" yazısıyla ayrıca hazırlanacak).
iPad görüntüsü gerekmez (`supportsTablet: false`).

## Nasıl üretildi / yeniden üretme
1. Önizleme sunucusunu aç: `cd apps/mobile && node scripts/onizleme-sunucu.cjs` (http://localhost:4620).
2. `node store/screenshots-2026-09/uret.cjs` (isteğe bağlı `--sadece iphone-6.7`).
   - Kurulu Chrome'u başsız açar, DevTools protokolüyle telefon boyutu (mantıksal 440×956 / 430×932 / 428×926 / 360×800) ve **3× ölçek** verir.
   - `_uret.html` aynı kökten `assets/app.html`'i çerçeve içinde açıp ekranı seçer (`?ekran=ozet&persona=adv`).
   - Not: parent'ın tarif ettiği 390×844 → 3× yolu 1170×2532 (6.1") verir; mağazanın **zorunlu** boyutları için yukarıdaki mantıksal ölçüler kullanıldı.
3. Görüntüler **örnek verilidir** (RN köprüsü yok, canlı veri inmez): "Doğan Ticaret Ltd." gibi uydurma mükellefler; gerçek isim/VKN yok.
   Özet ekranındaki sayaç kartlarında "yükleniyor…" yazar (canlı veri bekler) — gerçek verili görüntü istenirse telefonda
   (üretim derlemesi) giriş yapıp ekran görüntüsü alınır; boyut zaten cihazın kendisinden gelir.
4. Üst 44 px durum çubuğu bandı boştur (saat/pil yok) — mağazalar durum çubuğu olmayan görüntüyü kabul eder; istenirse
   tasarım aracında saat/pil eklenebilir.

## Tarayıcı aracıyla deneme
Claude'un tarayıcı aracı ekran görüntüsünü dosyaya kaydetmiyor; bu yüzden üretim başsız Chrome + DevTools ile yapıldı
(yukarıdaki betik). Aynı çıktı her seferinde birebir üretilir.
