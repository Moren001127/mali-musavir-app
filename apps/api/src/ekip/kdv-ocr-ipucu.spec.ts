/**
 * Ekip KDV Kontrol OCR teyit yardımcıları (2026-09-22) — kanıt kapısı, eşleşme ipucu, yeniden okuma önerisi.
 * Canlı örnek: YILMAZ GÖKTAŞ 2026/08 — Azure matrahı KDV sanmış (4.335,00 %20; Luca 43,35 %1).
 */
import {
  belgedeTutarVarMi,
  belgedekiTutarlar,
  eslesmeIpucu,
  kirilimAritmetik,
  tarihBicimleri,
  tarihNormalize,
  teyitDogrula,
  tutarMetni,
  tutarSayi,
  yenidenOkumaOnerisi,
} from './kdv-ocr-ipucu';

describe('tutar / tarih yardımcıları', () => {
  it('tutarSayi: TR/EN biçimler, Decimal, boş', () => {
    expect(tutarSayi('4.335,00')).toBe(4335);
    expect(tutarSayi('43,35')).toBe(43.35);
    expect(tutarSayi('17301.3')).toBe(17301.3);
    expect(tutarSayi('1,234,567')).toBe(1234567);
    expect(tutarSayi({ toNumber: () => 68.2 })).toBe(68.2);
    expect(tutarSayi('')).toBeNull();
    expect(tutarSayi(null)).toBeNull();
    expect(tutarMetni(43.349)).toBe('43,35');
  });

  it('belgedekiTutarlar: [MAX] json + [AZURE] metin içindeki sayılar kuruş kümesine girer', () => {
    const raw = '[MAX] {"kdvTutari":"43,35","matrah":"4.335,00"}\n[AZURE]\nANKA TROPİK 4.335,00 %1 43,35 TOPLAM 4.378,35';
    const set = belgedekiTutarlar(raw);
    expect(belgedeTutarVarMi(raw, 43.35, set)).toBe(true);
    expect(belgedeTutarVarMi(raw, 4335, set)).toBe(true);
    expect(belgedeTutarVarMi(raw, 4378.35, set)).toBe(true);
    expect(belgedeTutarVarMi(raw, 86.7, set)).toBe(false); // ajanın uydurduğu rakam
  });

  it('tarih biçimleri ve normalize', () => {
    expect(tarihBicimleri('15.08.2026')).toEqual(['15.08.2026', '15/08/2026', '15-08-2026', '2026-08-15', '15.8.2026']);
    expect(tarihNormalize('2026-08-05')).toBe('05.08.2026');
    expect(tarihNormalize('35.08.2026')).toBeNull();
    expect(tarihNormalize('dün')).toBeNull();
  });

  it('kirilimAritmetik: matrah × oran ≈ tutar; matrahsız satır denetlenmez', () => {
    expect(kirilimAritmetik([{ oran: 1, tutar: 173.01, matrah: 17301.3 }])).toEqual({ uyumlu: true, sorunlar: [], denetlenen: 1 });
    const kotu = kirilimAritmetik([{ oran: 20, tutar: 4335, matrah: 4335 }]);
    expect(kotu.uyumlu).toBe(false);
    expect(kotu.sorunlar[0]).toMatch(/4335,00 × %20 = 867,00 ≠ tutar 4335,00/);
    expect(kirilimAritmetik([{ oran: 20, tutar: 120 }])).toEqual({ uyumlu: null, sorunlar: [], denetlenen: 0 });
  });
});

describe('teyitDogrula — kanıt kapısı', () => {
  const gorsel = {
    originalName: 'EAR2026000001616.html',
    ocrBelgeNo: 'EAR2026000001616',
    ocrDate: '15.08.2026',
    ocrKdvTutari: '4335,00',
    ocrKdvTevkifat: null,
    ocrKdvBreakdown: [{ oran: 20, tutar: 4335, matrah: null }],
    ocrRawText: '[MAX] {"belgeNo":"EAR2026000001616","tarih":"15.08.2026","kdvTutari":"43,35","kdvBreakdown":[{"oran":1,"tutar":"43,35","matrah":"4.335,00"}]}\n[AZURE]\nANKA TROPİK MEYV. 15.08.2026 4.335,00 %1 43,35',
  };

  it('belgede görülen KDV + kırılım kabul; dto ekrandaki Teyit Et biçiminde', () => {
    const r = teyitDogrula({ kdvTutari: '43,35', kdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], kdvTevkifat: null }, gorsel);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dto).toEqual({ kdvTutari: '43,35', kdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], kdvTevkifat: null });
      expect(r.degisenler.join(' | ')).toMatch(/kdv 4335,00 → 43,35/);
      expect(r.kanit).toEqual(expect.arrayContaining(['kırılım %1: belge metni', 'kdv: belge metni']));
    }
  });

  it('belgede görülmeyen rakam (ajanın uydurduğu 86,70) REDDEDİLİR', () => {
    const r = teyitDogrula({ kdvTutari: '86,70' }, gorsel);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.neden).toMatch(/86,70 belge metninde görülmedi/);
  });

  it('kırılım tutarı metinde yok ama matrah × oran ile türer → kabul; toplam KDV ile tutmayan kırılım → ret', () => {
    const g2 = { ...gorsel, ocrRawText: '[AZURE]\nMATRAH 4.335,00 KDV ORANI %1' };
    const ok = teyitDogrula({ kdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }] }, g2);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.dto.kdvTutari).toBe('43,35');
    const ret = teyitDogrula({ kdvTutari: '43,35', kdvBreakdown: [{ oran: 1, tutar: 40, matrah: 4335 }] }, gorsel);
    expect(ret.ok).toBe(false);
  });

  it('belge no dosya adında geçiyorsa kabul, geçmiyorsa ret; tarih metinde yoksa ret', () => {
    const ok = teyitDogrula({ belgeNo: 'EAR2026000001616' }, { ...gorsel, ocrBelgeNo: 'TR1.2' });
    expect(ok.ok).toBe(true);
    const ret = teyitDogrula({ belgeNo: 'EAR2026000009999' }, gorsel);
    expect(ret.ok).toBe(false);
    const tarihRet = teyitDogrula({ tarih: '16.08.2026' }, gorsel);
    expect(tarihRet.ok).toBe(false);
    const tarihOk = teyitDogrula({ tarih: '2026-08-15' }, { ...gorsel, ocrDate: '15.08.2020' });
    expect(tarihOk.ok).toBe(true);
    if (tarihOk.ok) expect(tarihOk.dto.date).toBe('15.08.2026');
  });

  it('görsel kanıtı: metinde geçmeyen tutar, matrah verilmiş ve matrah × oran tutuyorsa kabul; aritmetik tutmuyorsa ret; görsel kanıtı yoksa yine ret', () => {
    const bos = { ...gorsel, ocrRawText: 'DMR MEYVE SEBZE — metin okunamadı', ocrKdvTutari: null, ocrKdvBreakdown: null };
    const ok = teyitDogrula({ kdvBreakdown: [{ oran: 1, tutar: 68.2, matrah: 6820 }], kdvTevkifat: null }, bos, { gorselKaniti: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.dto).toEqual({ kdvBreakdown: [{ oran: 1, tutar: 68.2, matrah: 6820 }], kdvTutari: '68,20', kdvTevkifat: null });
      expect(ok.kanit).toEqual(['kırılım %1: görsel (ekip belgeye baktı) + aritmetik']);
    }
    const kotu = teyitDogrula({ kdvBreakdown: [{ oran: 1, tutar: 136.4, matrah: 6820 }] }, bos, { gorselKaniti: true });
    expect(kotu.ok).toBe(false);
    if (!kotu.ok) expect(kotu.neden).toMatch(/matrah × oran tutmuyor/);
    const matrahsiz = teyitDogrula({ kdvBreakdown: [{ oran: 1, tutar: 68.2 }] }, bos, { gorselKaniti: true });
    expect(matrahsiz.ok).toBe(false);
    const gorselsiz = teyitDogrula({ kdvBreakdown: [{ oran: 1, tutar: 68.2, matrah: 6820 }] }, bos);
    expect(gorselsiz.ok).toBe(false);
  });

  it('mevcut OCR değeriyle aynı alan kanıt istemez (olduğu gibi teyit); tevkifat metinde yoksa ret', () => {
    const ayni = teyitDogrula({ kdvTutari: '4335,00' }, { ...gorsel, ocrRawText: '' });
    expect(ayni.ok).toBe(true);
    if (ayni.ok) expect(ayni.degisenler).toEqual([]);
    const tev = teyitDogrula({ kdvTevkifat: '21,68' }, gorsel);
    expect(tev.ok).toBe(false);
  });
});

describe('eslesmeIpucu — eşleşme hatası OCR kaynaklı mı?', () => {
  const luca = [
    { id: 'k1', belgeNo: 'EAR2026000001616', belgeDate: new Date('2026-08-15T00:00:00Z'), karsiTaraf: 'ANKA TROP�K MEYVEL-EAR', kdvTutari: '43.35', kdvOrani: '1' },
    { id: 'k2', belgeNo: 'DMA2026000003962', belgeDate: new Date('2026-08-08T00:00:00Z'), karsiTaraf: 'DMR MEYVE SEBZE GI', kdvTutari: '68.2', kdvOrani: '1' },
    { id: 'k3', belgeNo: 'GTA2026000003334', belgeDate: new Date('2026-08-11T00:00:00Z'), karsiTaraf: 'GÜLEK TARIM', kdvTutari: '1.36', kdvOrani: '1' },
    { id: 'k4', belgeNo: 'GTA2026000003334', belgeDate: new Date('2026-08-11T00:00:00Z'), karsiTaraf: 'GÜLEK TARIM', kdvTutari: '72', kdvOrani: '20' },
    { id: 'k5', belgeNo: 'XYZ1', belgeDate: new Date('2026-08-20T00:00:00Z'), karsiTaraf: 'BAŞKA', kdvTutari: '10', kdvOrani: '20' },
  ];
  const gorseller = [
    { id: 'i1', belgeNo: 'EAR2026000001616', tarih: '15.08.2026', satici: 'ANKA TROPİK MEYV.', kdv: 4335, tevkifat: 0, kirilim: [{ oran: 20, tutar: 4335 }], ocrStatus: 'SUCCESS' },
    { id: 'i2', belgeNo: 'DMA2026000003962', tarih: '08.08.2026', satici: 'MEYVE SEBZE GIDA', kdv: null, tevkifat: 0, kirilim: null, ocrStatus: 'NEEDS_REVIEW' },
    { id: 'i3', belgeNo: 'GTA2026000003334', tarih: '11.08.2026', satici: 'GÜLEK TARIM', kdv: 207.6, tevkifat: 0, kirilim: [{ oran: 1, tutar: 135.6 }, { oran: 20, tutar: 72 }], ocrStatus: 'SUCCESS' },
    { id: 'i4', belgeNo: 'EAR2026000009999', tarih: '20.08.2026', satici: 'BAŞKA', kdv: 10, tevkifat: 0, kirilim: null, ocrStatus: 'SUCCESS' },
    { id: 'i5', belgeNo: 'YOK1', tarih: '21.08.2026', satici: 'KİMSE', kdv: 5, tevkifat: 0, kirilim: null, ocrStatus: 'SUCCESS' },
    { id: 'i6', belgeNo: 'EAR2026000001616', tarih: '15.08.2026', satici: 'ANKA', kdv: 86.7, tevkifat: 0, kirilim: null, ocrStatus: 'SUCCESS', isManuallyConfirmed: true },
  ];

  it('luca_yok: aynı belge no Luca’da var, fatura 100 katı → MATRAH_KDV_SANILMIS (yeniden oku)', () => {
    const ip = eslesmeIpucu({ sinif: 'luca_yok', imageId: 'i1', kdvRecordId: null }, gorseller, luca)!;
    expect(ip.tur).toBe('MATRAH_KDV_SANILMIS');
    expect(ip.ocrSupheli).toBe(true);
    expect(ip.adayKdvRecordIds).toEqual(['k1']);
    expect(ip.metin).toMatch(/100 katı/);
  });

  it('fatura_yok: Luca satırının görseli belge no ile bulunur → aynı ipucu, adayImageId dolu', () => {
    const ip = eslesmeIpucu({ sinif: 'fatura_yok', imageId: null, kdvRecordId: 'k1' }, gorseller, luca)!;
    expect(ip.tur).toBe('MATRAH_KDV_SANILMIS');
    expect(ip.adayImageId).toBe('i1');
  });

  it('incele: KDV okunamamış → KDV_OKUNAMADI; çok oranlı tutar farkı → TUTAR_FARKI', () => {
    expect(eslesmeIpucu({ sinif: 'incele', imageId: 'i2', kdvRecordId: 'k2' }, gorseller, luca)!.tur).toBe('KDV_OKUNAMADI');
    const ip = eslesmeIpucu({ sinif: 'incele', imageId: 'i3', kdvRecordId: 'k3' }, gorseller, luca)!;
    expect(ip.tur).toBe('TUTAR_FARKI');
    expect(ip.adayKdvRecordIds).toEqual(['k3', 'k4']);
  });

  it('belge no yok ama aynı gün + satıcı → BELGE_NO_FARKI; hiç aday yok → ADAY_YOK (OCR şüpheli değil)', () => {
    const ip = eslesmeIpucu({ sinif: 'luca_yok', imageId: 'i4', kdvRecordId: null }, gorseller, luca)!;
    expect(ip.tur).toBe('BELGE_NO_FARKI');
    expect(ip.adayKdvRecordIds).toEqual(['k5']);
    const yok = eslesmeIpucu({ sinif: 'luca_yok', imageId: 'i5', kdvRecordId: null }, gorseller, luca)!;
    expect(yok).toMatchObject({ tur: 'ADAY_YOK', ocrSupheli: false });
    const lucaYok = eslesmeIpucu({ sinif: 'fatura_yok', imageId: null, kdvRecordId: 'k5' }, gorseller.filter((g) => g.id !== 'i4'), luca)!;
    expect(lucaYok.tur).toBe('ADAY_YOK');
  });

  it('Muzaffer Bey’in teyit ettiği görsel → TEYITLI_FARK, dokunulmaz', () => {
    const ip = eslesmeIpucu({ sinif: 'luca_yok', imageId: 'i6', kdvRecordId: null }, gorseller, luca)!;
    expect(ip).toMatchObject({ tur: 'TEYITLI_FARK', ocrSupheli: false });
  });
});

describe('yenidenOkumaOnerisi', () => {
  const once = { ocrStatus: 'SUCCESS', ocrEngine: 'azure-read', ocrBelgeNo: 'EAR2026000001616', ocrDate: '15.08.2026', ocrKdvTutari: '4335,00', ocrKdvTevkifat: null, ocrKdvBreakdown: [{ oran: 20, tutar: 4335, matrah: null }], ocrValidationScore: 1 };
  const luca = [{ id: 'k1', belgeNo: 'EAR2026000001616', kdvTutari: '43.35', kdvOrani: '1' }];

  it('Max okuması aritmetikle tutuyor, Luca ile uyumlu → teyit; girdi aynen araca gider', () => {
    const sonra = { ...once, ocrEngine: 'max-vision (max-escalation)', ocrKdvTutari: '43,35', ocrKdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }], ocrValidationScore: 1 };
    const o = yenidenOkumaOnerisi(once, sonra, luca);
    expect(o.oneri).toBe('teyit');
    expect(o.teyitGirdisi).toEqual({ belgeNo: 'EAR2026000001616', tarih: '15.08.2026', kdvTutari: '43,35', kdvTevkifat: null, kdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: 4335 }] });
    expect(o.farklar.join(' | ')).toMatch(/kdv 4335,00 → 43,35/);
    expect(o.lucaUyum).toMatchObject({ var: true, uyumlu: true, lucaToplam: 43.35 });
  });

  it('Max alınamadı (Azure’a düştü) → doğrulanamıyorsa muzaffer (belgeye bak); Luca ile uyumluysa teyit; kırılım aritmetiği tutmuyor → muzaffer; geri alındı → muzaffer', () => {
    const azureKotu = yenidenOkumaOnerisi(once, { ...once, ocrEngine: 'azure-read' }, luca);
    expect(azureKotu.oneri).toBe('muzaffer');
    expect(azureKotu.neden).toMatch(/belgeye bak/);
    const azureUyumlu = yenidenOkumaOnerisi({ ...once, ocrStatus: 'NEEDS_REVIEW', ocrKdvTutari: null, ocrKdvBreakdown: null }, { ...once, ocrEngine: 'azure-read', ocrKdvTutari: '43,35', ocrKdvBreakdown: [{ oran: 1, tutar: 43.35, matrah: null }] }, luca);
    expect(azureUyumlu.oneri).toBe('teyit');
    const kotu = { ...once, ocrEngine: 'max-vision', ocrKdvTutari: '4335,00', ocrKdvBreakdown: [{ oran: 20, tutar: 4335, matrah: 4335 }] };
    const o = yenidenOkumaOnerisi(once, kotu, luca);
    expect(o.oneri).toBe('muzaffer');
    expect(o.neden).toMatch(/aritmetiği tutmuyor/);
    expect(yenidenOkumaOnerisi(once, once, luca, true).oneri).toBe('muzaffer');
  });

  it('değerler aynı kaldı → degismedi; Luca ile farklıysa gerçek fark notu', () => {
    const sonra = { ...once, ocrEngine: 'max-vision (max-escalation)' };
    const o = yenidenOkumaOnerisi(once, sonra, luca);
    expect(o.oneri).toBe('degismedi');
    expect(o.neden).toMatch(/gerçek fark, Muzaffer Bey/);
  });

  it('belge Luca’dan farklı ama aritmetik tutuyor → yine teyit (Luca’ya uydurulmaz), lucaUyum uyumsuz', () => {
    const sonra = { ...once, ocrEngine: 'max-vision', ocrKdvTutari: '50,00', ocrKdvBreakdown: [{ oran: 1, tutar: 50, matrah: 5000 }] };
    const o = yenidenOkumaOnerisi(once, sonra, luca);
    expect(o.oneri).toBe('teyit');
    expect(o.lucaUyum.uyumlu).toBe(false);
  });
});
