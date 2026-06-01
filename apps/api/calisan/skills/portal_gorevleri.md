# Skill: Portal Görevleri (kapsam haritası)

Çalışanın yürütebileceği portal işleri ve hangi modüle dokunduğu. 🔒 = kilitli (oku/üret, kod değiştirme).

| Görev | Modül (API) | Model | Not |
|---|---|---|---|
| Mükellef CRUD / arama | `/taxpayers` | Sonnet | Rutin |
| Evrak yükle/ara (S3) | `/documents` | Sonnet | UI kapalı, backend hazır |
| Beyanname takip / durum | `/beyanname-takip`, `/beyan-kayitlari` | **Opus** (belge), Sonnet (liste) | BeyanKaydi↔BeyanDurumu sync eksik |
| **GİB beyanname indirme** | bkz. `gib_beyanname_indir.md` | **Opus** + Sonnet | Plan.md kaynaklı |
| KDV kontrol/mutabakat 🔒 | `/kdv-control` | **Opus** | Sadece çalıştır/yorumla |
| Mizan / bilanço / gelir tablosu 🔒 | `/mizan`,`/bilanco`,`/gelir-tablosu` | **Opus** | Denetim yorumu |
| Fatura muhasebeleştirme + OCR | `/fatura-muhasebelestirme` | **Opus** (belge), Sonnet | VendorMemory öğrenir |
| Cari kasa / ekstre | `/cari-kasa` | Sonnet | Oto tahakkuk |
| E-Arşiv 🔒 | `/earsiv` | Sonnet | Import çekirdeği kilitli |
| E-defter denetim | `/edefter-control` | **Opus** | Yevmiye fişi denetimi |
| Banka takip / OCR | `/banka-takip` | Sonnet | |
| Hatırlatma / bildirim | `/notifications`, `/tasks` | Sonnet | Proaktif |
| WhatsApp iletişim | `/whatsapp` (Baileys) | Sonnet | Sahip/müşteri köprüsü |

## Kural
- Kritik mali belge → Opus 4.8 (model_yonlendirme.md).
- Kilitli modülün kodunu değiştirme; sadece API'sini çağır / çıktısını yorumla.
- Her görev sonunda öğrenileni yaz (ogrenme.md).
