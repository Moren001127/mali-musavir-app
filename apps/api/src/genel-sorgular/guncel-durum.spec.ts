import { enSonSonuclar, guncelSatirlar, type HamSonuc } from './guncel-durum';

const tp = (id: string) => ({ id, companyName: id.toUpperCase(), firstName: null, lastName: null, taxNumber: '1' });
const ham = (o: Partial<HamSonuc> & { taxpayerId: string; tur: string; sorguTarihi: string }): HamSonuc =>
  ({ id: `${o.taxpayerId}-${o.sorguTarihi}`, taxpayer: tp(o.taxpayerId), donem: null, veri: {}, ...o });

describe('güncel durum — koşu geçmişi değil, mükellef başına en son sonuç', () => {
  it('vergi borcu: her gün sorgulansa da mükellef başına TEK satır (en yeni), toplam borca göre sıralı', () => {
    const rows = [
      ham({ taxpayerId: 'a', tur: 'VERGI_BORCU', sorguTarihi: '2026-09-22T02:00:00Z', veri: { toplam: 100, vadesiGecmis: 100, kalemler: [{}] } }),
      ham({ taxpayerId: 'a', tur: 'VERGI_BORCU', sorguTarihi: '2026-09-21T02:00:00Z', veri: { toplam: 900, vadesiGecmis: 900, kalemler: [{}, {}] } }),
      ham({ taxpayerId: 'b', tur: 'VERGI_BORCU', sorguTarihi: '2026-09-20T02:00:00Z', veri: { toplam: 500, vadesiGecmis: 0, kalemler: [{}] } }),
    ];
    const { rows: r, ozet } = guncelSatirlar('VERGI_BORCU', enSonSonuclar('VERGI_BORCU', rows));
    expect(r).toHaveLength(2);
    expect(r[0].taxpayerId).toBe('b'); // 500 > 100 (a'nın ESKİ 900'ü sayılmaz)
    expect(r[1]).toMatchObject({ taxpayerId: 'a', toplam: 100, kalemSayisi: 1 });
    expect(ozet.mukellef).toBe(2);
  });

  it('e-haciz: bildiri başına satır; bildirisi olmayan mükellef listelenmez ama özette sayılır', () => {
    const rows = [
      ham({ taxpayerId: 'a', tur: 'E_HACIZ', sorguTarihi: '2026-09-22T02:00:00Z', veri: { bildiriler: [{ bildiriNo: '1', tutar: '10.5', durum: 'HACİZ TATBİK EDİLMİŞTİR' }, { bildiriNo: '2', tutar: 3, durum: 'HACİZ TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR' }] } }),
      ham({ taxpayerId: 'b', tur: 'E_HACIZ', sorguTarihi: '2026-09-22T02:00:00Z', veri: { bildiriler: [] } }),
    ];
    const { rows: r, ozet } = guncelSatirlar('E_HACIZ', enSonSonuclar('E_HACIZ', rows));
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ bildiriNo: '1', tutar: 10.5, tatbikEdildi: true });
    expect(r[1].tatbikEdildi).toBe(false);
    expect(ozet).toMatchObject({ mukellef: 2, bos: 1 });
  });

  it('POS ve gelen e-arşiv: mükellef + AY başına en son sonuç; satırlar banka / fatura başına açılır', () => {
    const rows = [
      ham({ taxpayerId: 'a', tur: 'POS', donem: '2026-08', sorguTarihi: '2026-09-22T02:00:00Z', veri: { satirlar: [{ unvan: 'X', tutar: 5 }] } }),
      ham({ taxpayerId: 'a', tur: 'POS', donem: '2026-08', sorguTarihi: '2026-09-21T02:00:00Z', veri: { satirlar: [{ unvan: 'ESKİ', tutar: 999 }] } }),
      ham({ taxpayerId: 'a', tur: 'POS', donem: '2026-07', sorguTarihi: '2026-09-21T02:00:00Z', veri: { satirlar: [{ unvan: 'Y', tutar: 7 }, { unvan: 'Z', tutar: 1 }] } }),
    ];
    const { rows: r } = guncelSatirlar('POS', enSonSonuclar('POS', rows));
    expect(r.map((x) => `${x.donem}:${x.unvan}`)).toEqual(['2026-08:X', '2026-07:Y', '2026-07:Z']);

    const e = [ham({ taxpayerId: 'a', tur: 'GELEN_EARSIV', donem: '2026-08', sorguTarihi: '2026-09-22T02:00:00Z', veri: { faturalar: [{ faturaNo: 'F1', odenecekTutar: '10.00', duzenlenmeTarihi: '2026-08-01' }, { faturaNo: 'F2', odenecekTutar: 20, duzenlenmeTarihi: '2026-08-05' }] } })];
    const { rows: f } = guncelSatirlar('GELEN_EARSIV', enSonSonuclar('GELEN_EARSIV', e));
    expect(f.map((x) => x.faturaNo)).toEqual(['F2', 'F1']); // tarih desc
    expect(f[1].odenecekTutar).toBe(10);
  });

  it('yoklama: tutanak başına satır (yoklama + denetim), tarih desc', () => {
    const rows = [ham({ taxpayerId: 'a', tur: 'YOKLAMA_DENETIM', sorguTarihi: '2026-09-22T02:00:00Z', veri: { yoklamalar: [{ yoklamaKodu: 'Y1', tarih: '2025-09-26T12:32:16', yoklamaTuru: 'Nakil İşe Başlama', pdfDocumentId: 'd1', pdfVarMi: true }], denetimler: [{ belgeKodu: 'D1', denetimAdi: 'Genel', tarih: '2026-03-11' }] } })];
    const { rows: r } = guncelSatirlar('YOKLAMA_DENETIM', enSonSonuclar('YOKLAMA_DENETIM', rows));
    expect(r.map((x) => x.kod)).toEqual(['D1', 'Y1']);
    expect(r[1]).toMatchObject({ kayit: 'YOKLAMA', pdfDocumentId: 'd1' });
  });
});
