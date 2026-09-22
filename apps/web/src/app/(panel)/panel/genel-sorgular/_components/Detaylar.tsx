'use client';

import type { ReactNode } from 'react';
import {
  eHacizVerisi,
  gelenEArsivVerisi,
  posVerisi,
  vergiBorcuVerisi,
  yoklamaVerisi,
  type SorguSonucu,
} from '@/lib/genel-sorgular';
import { tarihKisa, tarihSaat, tutar } from '../_lib/bicim';

/*
 * Satır açılınca gösterilen ayrıntılar — tür başına kenarlıklı alt tablo (Hattat: kalemler düz tabloda).
 * Vadesi geçmiş borç tutarı kırmızı; "tatbik edilmiş" haciz kırmızı; diğer her şey nötr.
 */

function DetayUst({ sonuc, ek }: { sonuc: SorguSonucu; ek?: ReactNode }) {
  return (
    <div className="gs-detay-ust">
      <span>Kaynak: <b>{sonuc.kaynak === 'nightly' ? 'Gece sorgusu' : sonuc.kaynak === 'manual' ? 'Elle sorgu' : sonuc.kaynak || '—'}</b></span>
      <span>WhatsApp: <b>{sonuc.whatsappGonderildiMi ? 'mükellefe gönderildi' : 'gönderilmedi'}</b></span>
      {sonuc.ozet && <span>Özet: <b>{sonuc.ozet}</b></span>}
      {ek}
    </div>
  );
}

export function VergiBorcuDetay({ sonuc }: { sonuc: SorguSonucu }) {
  const v = vergiBorcuVerisi(sonuc);
  return (
    <>
      <DetayUst sonuc={sonuc} ek={v.hesaplamaZamani ? <span>GİB hesaplama zamanı: <b>{tarihSaat(v.hesaplamaZamani)}</b></span> : null} />
      <div className="gs-detay-adi">Borç kalemleri ({v.kalemler.length})</div>
      {v.kalemler.length === 0 ? (
        <div className="gs-detay-bos">Bu sorguda borç kalemi yok.</div>
      ) : (
        <table className="gs-alt-tablo">
          <thead>
            <tr>
              <th>Vergi türü</th>
              <th>Dönem</th>
              <th>Vade</th>
              <th className="sag">Asıl borç (₺)</th>
              <th className="sag">Gecikme zammı (₺)</th>
              <th className="sag">Toplam (₺)</th>
              <th>Vergi dairesi</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {v.kalemler.map((k, i) => (
              <tr key={`${k.vergiKodu}-${k.donem}-${i}`}>
                <td>{k.vergiTuru || k.vergiKodu || '—'}</td>
                <td className="gs-sayi">{k.donem || '—'}</td>
                <td className="gs-sayi">{tarihKisa(k.vadeTarihi)}</td>
                <td className="sag">{tutar(k.asilBorc)}</td>
                <td className="sag">{tutar(k.gecikmeZammi)}</td>
                <td className={`sag${k.vadesiGecmisMi ? ' gs-kirmizi' : ''}`}>{tutar(k.toplam)}</td>
                <td>{k.vergiDairesi || k.vergiDairesiKodu || '—'}</td>
                <td className={k.vadesiGecmisMi ? 'gs-kirmizi-yazi' : 'gs-soluk'}>{k.vadesiGecmisMi ? 'Vadesi geçmiş' : 'Vadesi gelmemiş'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Toplam</td>
              <td className="sag">{tutar(v.kalemler.reduce((a, k) => a + k.asilBorc, 0))}</td>
              <td className="sag">{tutar(v.kalemler.reduce((a, k) => a + k.gecikmeZammi, 0))}</td>
              <td className="sag">{tutar(v.toplam)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      )}
      {v.turOzeti.length > 0 && (
        <>
          <div className="gs-detay-adi">Vergi türü özeti</div>
          <table className="gs-alt-tablo">
            <thead>
              <tr>
                <th>Vergi türü</th>
                <th className="sag">Asıl borç (₺)</th>
                <th className="sag">Gecikme zammı (₺)</th>
                <th className="sag">Toplam (₺)</th>
              </tr>
            </thead>
            <tbody>
              {v.turOzeti.map((t, i) => (
                <tr key={`${t.vergiKodu}-${i}`}>
                  <td>{t.vergiTuru || t.vergiKodu}</td>
                  <td className="sag">{tutar(t.asilBorc)}</td>
                  <td className="sag">{tutar(t.gecikmeZammi)}</td>
                  <td className="sag">{tutar(t.toplam)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

export function EHacizDetay({ sonuc }: { sonuc: SorguSonucu }) {
  const v = eHacizVerisi(sonuc);
  return (
    <>
      <DetayUst sonuc={sonuc} />
      <div className="gs-detay-adi">Haciz bildirileri ({v.bildiriler.length})</div>
      {v.bildiriler.length === 0 ? (
        <div className="gs-detay-bos">Bu sorguda e-haciz bildirisi yok.</div>
      ) : (
        <table className="gs-alt-tablo">
          <thead>
            <tr>
              <th>Kapsam</th>
              <th>Bildiri no</th>
              <th>Vergi dairesi</th>
              <th className="sag">Tutar (₺)</th>
              <th>Durum</th>
              <th>Vergi türü / dönem</th>
            </tr>
          </thead>
          <tbody>
            {v.bildiriler.map((b, i) => {
              const tatbik = /TATBİK EDİLMİŞ/i.test(b.durum);
              return (
                <tr key={`${b.bildiriNo}-${i}`}>
                  <td>{b.kapsam === 'ARAC' ? 'Araç' : 'Banka'}</td>
                  <td className="gs-sayi">{b.bildiriNo || '—'}</td>
                  <td>{b.vergiDairesi || b.vergiDairesiKodu || '—'}</td>
                  <td className="sag">{tutar(b.tutar)}</td>
                  <td className={tatbik ? 'gs-kirmizi-yazi' : 'gs-soluk'}>{b.durum || '—'}</td>
                  <td>{b.borclar.length ? b.borclar.map((x) => `${x.vergiTuru} ${x.vergiDonem}`.trim()).join(', ') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Toplam</td>
              <td className="sag">{tutar(v.toplamTutar)}</td>
              <td colSpan={2}>{v.tatbikEdilenSayisi} tatbik edilmiş / {v.bildiriSayisi} bildiri</td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  );
}

export function YoklamaDetay({ sonuc, onTutanak }: { sonuc: SorguSonucu; onTutanak: (documentId: string, baslik: string) => void }) {
  const v = yoklamaVerisi(sonuc);
  return (
    <>
      <DetayUst sonuc={sonuc} />
      <div className="gs-detay-adi">Yoklamalar ({v.yoklamalar.length})</div>
      {v.yoklamalar.length === 0 ? (
        <div className="gs-detay-bos">Bu sorguda yoklama tutanağı yok.</div>
      ) : (
        <table className="gs-alt-tablo">
          <thead>
            <tr>
              <th>Vergi dairesi</th>
              <th>Yoklama kodu</th>
              <th>Türü</th>
              <th>Tarihi</th>
              <th>Tutanak</th>
            </tr>
          </thead>
          <tbody>
            {v.yoklamalar.map((y, i) => (
              <tr key={`${y.yoklamaKodu}-${i}`}>
                <td>{y.vergiDairesi || y.vergiDairesiKodu || '—'}</td>
                <td className="gs-sayi">{y.yoklamaKodu || '—'}</td>
                <td>{y.yoklamaTuru || y.yoklamaTuruKodu || '—'}</td>
                <td className="gs-sayi">{tarihSaat(y.tarih)}</td>
                <td>
                  {y.pdfVarMi && y.pdfDocumentId ? (
                    <button type="button" className="gs-baglanti" onClick={() => onTutanak(y.pdfDocumentId!, `${y.yoklamaTuru || 'Yoklama'} · ${y.yoklamaKodu}`)}>Tutanağı aç</button>
                  ) : (
                    <span className="gs-soluk">PDF yok</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v.denetimler.length > 0 && (
        <>
          <div className="gs-detay-adi">Denetimler ({v.denetimler.length})</div>
          <table className="gs-alt-tablo">
            <thead>
              <tr>
                <th>Belge kodu</th>
                <th>Denetim adı</th>
                <th>Türü</th>
                <th>Tarih</th>
                <th>Sonuç</th>
              </tr>
            </thead>
            <tbody>
              {v.denetimler.map((d, i) => (
                <tr key={`${d.belgeKodu}-${i}`}>
                  <td className="gs-sayi">{d.belgeKodu || '—'}</td>
                  <td>{d.denetimAdi || '—'}</td>
                  <td>{d.denetimTuru || '—'}</td>
                  <td className="gs-sayi">{tarihSaat(d.tarih)}</td>
                  <td>{d.sonuc || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

export function PosDetay({ sonuc }: { sonuc: SorguSonucu }) {
  const v = posVerisi(sonuc);
  return (
    <>
      <DetayUst sonuc={sonuc} />
      <div className="gs-detay-adi">Üye işyerleri ({v.satirlar.length})</div>
      {v.satirlar.length === 0 ? (
        <div className="gs-detay-bos">Bu dönemde POS kaydı yok.</div>
      ) : (
        <table className="gs-alt-tablo">
          <thead>
            <tr>
              <th>Kaynak</th>
              <th>Ünvan</th>
              <th>VKN</th>
              <th>Üye işyeri no</th>
              <th className="sag">Tutar (₺)</th>
            </tr>
          </thead>
          <tbody>
            {v.satirlar.map((p, i) => (
              <tr key={`${p.uyeIsyeriNo}-${i}`}>
                <td>{p.kaynak === 'ODEME_KURULUSU' ? 'Ödeme kuruluşu' : 'Banka'}</td>
                <td>{p.unvan || '—'}</td>
                <td className="gs-sayi">{p.vkn || '—'}</td>
                <td className="gs-sayi">{p.uyeIsyeriNo || '—'}</td>
                <td className="sag">{tutar(p.tutar)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Toplam</td>
              <td className="sag">{tutar(v.toplamTutar)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  );
}

export function GelenEArsivDetay({ sonuc }: { sonuc: SorguSonucu }) {
  const v = gelenEArsivVerisi(sonuc);
  return (
    <>
      <DetayUst
        sonuc={sonuc}
        ek={v.baslangic && v.bitis ? <span>Aralık: <b>{tarihKisa(v.baslangic)} – {tarihKisa(v.bitis)}</b></span> : null}
      />
      <div className="gs-detay-adi">Faturalar ({v.faturalar.length})</div>
      {v.faturalar.length === 0 ? (
        <div className="gs-detay-bos">Bu dönemde gelen e-Arşiv faturası yok.</div>
      ) : (
        <table className="gs-alt-tablo">
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Fatura no</th>
              <th>Satıcı</th>
              <th>VKN</th>
              <th className="sag">Tutar (₺)</th>
              <th className="sag">Vergi (₺)</th>
              <th className="sag">Ödenecek (₺)</th>
              <th>Gönderim</th>
            </tr>
          </thead>
          <tbody>
            {v.faturalar.map((f, i) => (
              <tr key={`${f.faturaNo}-${i}`}>
                <td className="gs-sayi">{tarihKisa(f.duzenlenmeTarihi)}</td>
                <td className="gs-sayi">{f.faturaNo || '—'}</td>
                <td>{f.saticiUnvan || '—'}{f.iptalItirazDurum ? <span className="gs-soluk"> · {f.iptalItirazDurum}</span> : null}</td>
                <td className="gs-sayi">{f.saticiVkn || '—'}</td>
                <td className="sag">{tutar(f.toplamTutar)}</td>
                <td className="sag">{tutar(f.vergilerTutari)}</td>
                <td className="sag">{tutar(f.odenecekTutar)}</td>
                <td>{f.gonderimSekli === 'KAGIT' ? 'Kâğıt' : f.gonderimSekli === 'ELEKTRONIK' ? 'Elektronik' : f.gonderimSekli || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Toplam</td>
              <td className="sag">{tutar(v.faturalar.reduce((a, f) => a + f.toplamTutar, 0))}</td>
              <td className="sag">{tutar(v.faturalar.reduce((a, f) => a + f.vergilerTutari, 0))}</td>
              <td className="sag">{tutar(v.toplamOdenecek)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      )}
      {v.hataliPencereler.length > 0 && (
        <div className="gs-hata-metni" style={{ marginTop: 8 }}>
          {v.hataliPencereler.length} tarih penceresi GİB'den alınamadı: {v.hataliPencereler.map((h) => `${tarihKisa(h.baslangic)}–${tarihKisa(h.bitis)} (${h.hata})`).join('; ')}
        </div>
      )}
    </>
  );
}
