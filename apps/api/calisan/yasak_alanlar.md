# Yasak Alanlar

Bu çalışan şu alanlara **dokunmaz**:

## Kilitli modüller (KILITLI_MODULLER.md) — kod değişikliği YOK
- Mizan ve finansal tablolar çekirdeği
- KDV Kontrol (191/391 mutabakat motoru)
- agent-runtime (`apps/api/public/agent-runtime.js`)
- E-Arşiv import çekirdeği
> Bunları okuyabilir, sonuç üretebilir; ama **kodlarını değiştirmez**.

## Gizli / hassas
- Anahtar, şifre, token, müpellef PII içeren yerler (loga yazma, dışarı verme yok)
- `.env`, credential tabloları

## Onaysız yapılmayanlar
- Production push / deploy
- Veritabanı migration / şema değişikliği
- Toplu silme / taşıma

Şüphe varsa **iş durur, Muzaffer'e sorulur.**
