import { enSonSonuclar, guncelSatirlar, panoSatirlari, type GuncelTur, type HamSonuc } from './guncel-durum';

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

describe('mükellef panosu — mükellef başına tek satır, 5 tür yan yana', () => {
  /** Ham kayıtları tür bazına ayırıp en son sonuçlara indirger (servisin yaptığının aynısı). */
  const turBazli = (rows: HamSonuc[]) => {
    const out = {} as Record<GuncelTur, HamSonuc[]>;
    for (const tur of ['VERGI_BORCU', 'E_HACIZ', 'YOKLAMA_DENETIM', 'POS', 'GELEN_EARSIV'] as GuncelTur[]) {
      out[tur] = enSonSonuclar(
        tur,
        rows.filter((r) => r.tur === tur).sort((a, b) => String(b.sorguTarihi).localeCompare(String(a.sorguTarihi))),
      );
    }
    return out;
  };

  it('vadesi geçmiş borçlu mükellef uyari=2 ve en üstte; tatbik edilmiş haciz de uyari=2', () => {
    const { rows, ozet } = panoSatirlari(
      turBazli([
        ham({ taxpayerId: 'sakin', tur: 'YOKLAMA_DENETIM', sorguTarihi: '2026-09-22T02:00:00Z', veri: { yoklamalar: [{ yoklamaKodu: 'Y1', tarih: '2025-09-26T12:32:16' }], denetimler: [] } }),
        ham({ taxpayerId: 'borclu', tur: 'VERGI_BORCU', sorguTarihi: '2026-09-25T03:40:00Z', veri: { toplam: 384303.91, vadesiGecmis: 379614.21, vadesiGelmemis: 4689.7, kalemler: [{}, {}, {}] } }),
        ham({ taxpayerId: 'hacizli', tur: 'E_HACIZ', sorguTarihi: '2026-09-25T03:31:00Z', veri: { bildiriler: [{ bildiriNo: '1', tutar: 113505.77, durum: 'HACİZ TATBİK EDİLMİŞTİR' }, { bildiriNo: '2', tutar: '16887.67', durum: 'HACİZ TATBİK EDİLECEK VARLIK BULUNAMAMIŞTIR' }] } }),
      ]),
    );
    expect(rows.map((r) => r.taxpayerId)).toEqual(['borclu', 'hacizli', 'sakin']); // uyari desc → vadesi geçmiş desc
    expect(rows[0]).toMatchObject({ uyari: 2, sorgulanmayan: 4, sonSorgu: '2026-09-25T03:40:00Z' });
    expect(rows[0].borc).toMatchObject({ toplam: 384303.91, vadesiGecmis: 379614.21, kalemSayisi: 3 });
    expect(rows[1]).toMatchObject({ uyari: 2, borc: null });
    expect(rows[1].haciz).toEqual({ bildiri: 2, tatbik: 1, tutar: 130393.44, sorguTarihi: '2026-09-25T03:31:00Z' });
    expect(rows[2]).toMatchObject({ uyari: 0, sorgulanmayan: 4 });
    expect(rows[2].yoklama).toEqual({ tutanak: 1, sonTarih: '2025-09-26T12:32:16', sorguTarihi: '2026-09-22T02:00:00Z' });
    expect(ozet).toEqual({ mukellef: 3, borclu: 1, hacizli: 1, toplamBorc: 384303.91, vadesiGecmis: 379614.21, enYeniSorgu: '2026-09-25T03:40:00Z' });
  });

  it('"borcu yok" ile "hiç sorgulanmadı" ayrı: sonucu olan mükellefin borc nesnesi dolu (toplam 0) ve uyari=0', () => {
    const { rows, ozet } = panoSatirlari(
      turBazli([
        ham({ taxpayerId: 'temiz', tur: 'VERGI_BORCU', sorguTarihi: '2026-09-25T03:26:00Z', veri: { toplam: 0, vadesiGecmis: 0, vadesiGelmemis: 0, kalemler: [] } }),
        ham({ taxpayerId: 'temiz', tur: 'E_HACIZ', sorguTarihi: '2026-09-25T03:23:00Z', veri: { bildiriler: [] } }),
        ham({ taxpayerId: 'gelmemis', tur: 'VERGI_BORCU', sorguTarihi: '2026-09-25T03:22:00Z', veri: { toplam: 27460, vadesiGecmis: 0, vadesiGelmemis: 27460, kalemler: [{}, {}] } }),
      ]),
    );
    const temiz = rows.find((r) => r.taxpayerId === 'temiz')!;
    expect(temiz.borc).toEqual({ toplam: 0, vadesiGecmis: 0, vadesiGelmemis: 0, kalemSayisi: 0, sorguTarihi: '2026-09-25T03:26:00Z' });
    expect(temiz.haciz).toEqual({ bildiri: 0, tatbik: 0, tutar: 0, sorguTarihi: '2026-09-25T03:23:00Z' });
    expect(temiz).toMatchObject({ uyari: 0, sorgulanmayan: 3, sonSorgu: '2026-09-25T03:26:00Z' });
    expect(temiz.pos).toBeNull(); // hiç sorgulanmadı → null
    // vadesi GELMEMİŞ borç uyari=1 ve temizden önce gelir
    expect(rows.map((r) => r.taxpayerId)).toEqual(['gelmemis', 'temiz']);
    expect(rows[0].uyari).toBe(1);
    expect(ozet).toMatchObject({ mukellef: 2, borclu: 1, hacizli: 0, toplamBorc: 27460 });
  });

  it('dönem süzgeci yokken POS / e-Arşiv mükellefin EN SON ayını alır (ayları TOPLAMAZ); süzgeç verilince o ay', () => {
    const kayitlar = [
      ham({ taxpayerId: 'a', tur: 'POS', donem: '2026-08', sorguTarihi: '2026-09-25T03:27:00Z', veri: { satirlar: [{ tutar: 171204.3 }, { tutar: 88650 }] } }),
      ham({ taxpayerId: 'a', tur: 'POS', donem: '2026-07', sorguTarihi: '2026-08-25T03:27:00Z', veri: { satirlar: [{ tutar: 158420.6 }, { tutar: 92310.15 }, { tutar: 12480 }] } }),
      ham({ taxpayerId: 'a', tur: 'GELEN_EARSIV', donem: '2026-09', sorguTarihi: '2026-09-25T03:44:00Z', veri: { faturalar: [{ odenecekTutar: '10.50' }, { odenecekTutar: 20 }] } }),
      ham({ taxpayerId: 'a', tur: 'GELEN_EARSIV', donem: '2026-08', sorguTarihi: '2026-09-04T03:17:00Z', veri: { faturalar: [{ odenecekTutar: 1000 }] } }),
    ];
    const { rows } = panoSatirlari(turBazli(kayitlar));
    expect(rows[0].pos).toEqual({ tutar: 259854.3, satir: 2, donem: '2026-08', sorguTarihi: '2026-09-25T03:27:00Z' });
    expect(rows[0].earsiv).toEqual({ fatura: 2, tutar: 30.5, donem: '2026-09', sorguTarihi: '2026-09-25T03:44:00Z' });
    expect(rows[0]).toMatchObject({ uyari: 0, sorgulanmayan: 3 });

    const { rows: eski } = panoSatirlari(turBazli(kayitlar), '2026-07');
    expect(eski[0].pos).toEqual({ tutar: 263210.75, satir: 3, donem: '2026-07', sorguTarihi: '2026-08-25T03:27:00Z' });
    expect(eski[0].earsiv).toBeNull(); // o ayda e-Arşiv sonucu yok
    expect(eski[0].sorgulanmayan).toBe(4);
  });
});
