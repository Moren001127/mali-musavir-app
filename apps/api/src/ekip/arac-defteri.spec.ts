import * as fs from 'fs';
import * as path from 'path';
import { ARAC_DEFTERI, KADEME_SIRASI, KURU_TESTTE_KAPALI_KADEMELER, aracAcikMi, aracKademesi, aracKatalogMetni, aracKaydi, ekipMihsapKomutuYasagi, kademeOzeti } from './arac-defteri';
import { AJAN_TANIMLARI, MODEL_KIMLIKLERI, ajanBul } from './ajan-tanimlari';
import { EKIP_IS_ZINCIRI_ARACLARI, FATURA_MERKEZI_AJAN_ARACLARI, FM_AJAN_ARAC_ADLARI, MOREN_AI_TOOLS } from '../moren-ai/tools';
import { PORTAL_ARAC_ADLARI } from './ekip-runner.service';

/**
 * Araç defteri + yetki kademesi kilit testleri (PLAN/13-AJAN-KADROSU.md §4):
 *  - resmi_gonderim hiçbir ajana, hiçbir modda açılmaz
 *  - kuru test luca_yaz / disari_gonder / portal_yaz_agir kapatır; oku / portal_yaz açık kalır (PLAN/17 §1.2)
 *  - her ajanın araç listesindeki her ad defterde var; kimlik.md "Kullandığım araçlar" ↔ liste 13 ajanda birebir
 *  - kdv_kontrol_kilitle / kilit_ac hiçbir ajan listesinde yok (kilit sahipte)
 */
describe('arac-defteri', () => {
  const tumAjan = { id: 'test-hepsi', araclar: ARAC_DEFTERI.map((a) => a.ad) };

  it('defter boş değil ve adlar tekil', () => {
    expect(ARAC_DEFTERI.length).toBeGreaterThan(60);
    const adlar = ARAC_DEFTERI.map((a) => a.ad);
    expect(new Set(adlar).size).toBe(adlar.length);
  });

  it('portal, luca, eylem ve ekip kaynakları temsil ediliyor', () => {
    expect(aracKaydi('get_mizan')?.kaynak).toBe('portal');
    expect(aracKaydi('luca_ekran_oku')?.kaynak).toBe('luca');
    expect(aracKaydi('send_whatsapp_template')?.kaynak).toBe('eylem');
    expect(aracKaydi('ekip_pano')?.kaynak).toBe('ekip');
    // Akış yapıları araç değildir
    expect(aracKaydi('for_each')).toBeNull();
  });

  it('kademe eşlemesi beklenen değerleri veriyor', () => {
    expect(aracKademesi('get_mizan')).toBe('oku');
    expect(aracKademesi('save_ai_memory')).toBe('portal_yaz');
    expect(aracKademesi('luca_yaz')).toBe('luca_yaz');
    expect(aracKademesi('luca_tikla')).toBe('luca_yaz');
    expect(aracKademesi('post_to_luca')).toBe('luca_yaz');
    // Luca'da iş açar (yerel ajan tarayıcı sürer) → pilot koşuda 'oku' sayılıp gerçek iş açmıştı
    expect(aracKademesi('fetch_kdv_from_luca')).toBe('luca_yaz');
    // KDV1 ön hazırlık yalnız okur (KDV Kontrol verisinden beyanname paketi)
    expect(aracKademesi('get_kdv1_on_hazirlik')).toBe('oku');
    expect(aracKaydi('get_kdv1_on_hazirlik')?.kaynak).toBe('portal');
    expect(aracKaydi('get_kdv1_on_hazirlik')?.parametreler).toEqual(['taxpayerId*', 'donem*']);
    expect(aracKademesi('send_whatsapp_template')).toBe('disari_gonder');
    expect(aracKademesi('send_sms')).toBe('disari_gonder');
    expect(aracKademesi('send_email')).toBe('disari_gonder');
    expect(aracKademesi('gib_beyanname_gonder')).toBe('resmi_gonderim');
    expect(aracKademesi('olmayan_arac')).toBeNull();
  });

  it('resmi_gonderim ASLA açılmaz — listede olsa bile, kuru test veya canlı fark etmez', () => {
    const resmi = ARAC_DEFTERI.filter((a) => a.kademe === 'resmi_gonderim').map((a) => a.ad);
    expect(resmi).toEqual(expect.arrayContaining(['gib_beyanname_gonder', 'sgk_bildirge_gonder', 'edefter_berat_yukle']));
    for (const ad of resmi) {
      for (const dryRun of [true, false]) {
        const e = aracAcikMi(tumAjan, ad, dryRun);
        expect(e.acik).toBe(false);
        expect(e.neden).toBe('resmi_gonderim');
      }
      for (const ajan of AJAN_TANIMLARI) {
        expect(aracAcikMi(ajan, ad, false).acik).toBe(false);
      }
    }
  });

  it('kuru test luca_yaz ve disari_gonder kapatır; canlıda açar', () => {
    for (const ad of ['luca_yaz', 'luca_sec', 'luca_tikla', 'post_to_luca', 'fetch_kdv_from_luca', 'send_whatsapp_template', 'send_sms', 'send_email', 'send_whatsapp_freeform']) {
      const kuru = aracAcikMi(tumAjan, ad, true);
      expect(kuru.acik).toBe(false);
      expect(kuru.neden).toBe('kuru_test');
      expect(aracAcikMi(tumAjan, ad, false).acik).toBe(true);
    }
  });

  it('oku ve portal_yaz kuru testte de açık', () => {
    for (const ad of ['get_mizan', 'get_kdv1_on_hazirlik', 'luca_ekran_oku', 'luca_menu_git', 'save_ai_memory', 'set_monthly_status', 'luca_beceri_kaydet', 'ekip_isler']) {
      expect(aracAcikMi(tumAjan, ad, true).acik).toBe(true);
    }
  });

  it('fetch_kdv_from_luca: beyanname ajanında kuru testte kapalı (kuru_test), canlıda açık', () => {
    const beyanname = ajanBul('beyanname')!;
    const kuru = aracAcikMi(beyanname, 'fetch_kdv_from_luca', true);
    expect(kuru.acik).toBe(false);
    expect(kuru.neden).toBe('kuru_test');
    expect(kuru.kademe).toBe('luca_yaz');
    expect(aracAcikMi(beyanname, 'fetch_kdv_from_luca', false).acik).toBe(true);
  });

  it('ajanın listesinde olmayan araç kapalı; defterde olmayan araç kapalı', () => {
    const dar = { id: 'dar', araclar: ['get_mizan'] };
    expect(aracAcikMi(dar, 'get_mizan', true).acik).toBe(true);
    expect(aracAcikMi(dar, 'list_taxpayers', true).neden).toBe('ajana_kapali');
    expect(aracAcikMi(dar, 'uydurma_arac', true).neden).toBe('defterde_yok');
  });
});

// ─── PLAN/17 §1.2-§3: portal_yaz_agir kademesi + KDV Kontrol zinciri araçları (2026-09-13) ───
describe('portal_yaz_agir + KDV Kontrol zinciri araçları (PLAN/17)', () => {
  const tumAjan = { id: 'test-hepsi', araclar: ARAC_DEFTERI.map((a) => a.ad) };
  const AGIR = ['kdv_kontrol_oturum_bul_olustur', 'kdv_kontrol_fatura_bagla', 'kdv_kontrol_ocr_baslat', 'kdv_kontrol_eslestir'];
  const OKU = ['luca_is_bekle', 'kdv_kontrol_ocr_bekle', 'kdv_kontrol_sonuc_satirlari', 'mali_yorum_oku', 'mali_donemler_listele', 'ekip_is_durum'];

  it('kademe sırasında portal_yaz_agir portal_yaz ile luca_yaz arasında; kuru testte kapalı kademeler 3 tane', () => {
    expect(KADEME_SIRASI).toEqual(['oku', 'portal_yaz', 'portal_yaz_agir', 'luca_yaz', 'disari_gonder', 'resmi_gonderim']);
    expect([...KURU_TESTTE_KAPALI_KADEMELER].sort()).toEqual(['disari_gonder', 'luca_yaz', 'portal_yaz_agir']);
    expect(kademeOzeti([...AGIR, ...OKU]).portal_yaz_agir).toBe(4);
  });

  it('kademe eşlemesi ADA GÖRE sabit (tools.ts şemasından bağımsız)', () => {
    for (const ad of AGIR) expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'portal_yaz_agir' });
    for (const ad of OKU) expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'oku' });
    expect(aracKademesi('kdv_kontrol_luca_cek')).toBe('luca_yaz');
    expect(aracKademesi('ekip_ajan_baslat')).toBe('portal_yaz');
    for (const ad of [...AGIR, ...OKU, 'kdv_kontrol_luca_cek']) {
      expect({ ad, kaynak: aracKaydi(ad)?.kaynak }).toEqual({ ad, kaynak: ad.startsWith('ekip_') ? 'ekip' : 'portal' });
      expect(aracKaydi(ad)?.parametreler?.length).toBeGreaterThan(0);
    }
    expect(aracKaydi('ekip_ajan_baslat')?.kaynak).toBe('ekip');
    expect(aracKaydi('ekip_ajan_baslat')?.parametreler).toEqual(['ajanId*', 'gorev*', 'taxpayerId', 'canli']);
  });

  it('zincir araçları (tools.ts EKIP_IS_ZINCIRI_ARACLARI) runner PORTAL_ARAC_ADLARI listesinde → "Çalıştırıcı bulunamadı" çıkmaz; şema tools.ts, kademe ada göre (doğrulayıcı 2026-09-13)', () => {
    for (const t of EKIP_IS_ZINCIRI_ARACLARI) {
      expect({ ad: t.name, runnerda: PORTAL_ARAC_ADLARI.has(t.name) }).toEqual({ ad: t.name, runnerda: true });
      const k = aracKaydi(t.name)!;
      expect({ ad: t.name, var: !!k, kademe: k?.kademe }).toEqual({ ad: t.name, var: true, kademe: aracKademesi(t.name) });
      if (t.name.startsWith('ekip_')) continue; // runner kendi işler (EKIP_ARACLARI)
      // parametreler tools.ts şemasından: zorunlular yıldızlı
      const zorunlu: string[] = (t.input_schema as any)?.required || [];
      for (const z of zorunlu) expect({ ad: t.name, param: `${z}*`, listede: k.parametreler }).toEqual({ ad: t.name, param: `${z}*`, listede: expect.arrayContaining([`${z}*`]) });
      expect(k.kaynak).toBe('portal');
    }
    // MOREN_AI_TOOLS'a sızmadı (otomasyon kataloğu / genel bot bu araçları görmemeli)
    const genel = new Set(MOREN_AI_TOOLS.map((t) => t.name));
    for (const t of EKIP_IS_ZINCIRI_ARACLARI) expect({ ad: t.name, genelde: genel.has(t.name) }).toEqual({ ad: t.name, genelde: false });
  });

  it('kuru test: portal_yaz_agir ve kdv_kontrol_luca_cek KAPALI (kuru_test); canlıda açık; okuma araçları kuru testte de açık', () => {
    for (const ad of [...AGIR, 'kdv_kontrol_luca_cek']) {
      const kuru = aracAcikMi(tumAjan, ad, true);
      expect({ ad, acik: kuru.acik, neden: kuru.neden }).toEqual({ ad, acik: false, neden: 'kuru_test' });
      expect(kuru.mesaj).toMatch(/yapılacaktı/);
      expect(aracAcikMi(tumAjan, ad, false).acik).toBe(true);
    }
    for (const ad of OKU) expect({ ad, acik: aracAcikMi(tumAjan, ad, true).acik }).toEqual({ ad, acik: true });
    expect(aracAcikMi(tumAjan, 'ekip_ajan_baslat', true).acik).toBe(true);
  });

  it('beyanname ajanı: 7 kdv_kontrol_* aracı + luca_is_bekle + get_agent_status listede; kuru testte oturum açma/OCR/eşleştirme çalışmaz', () => {
    const b = ajanBul('beyanname')!;
    expect(b.araclar).toEqual(expect.arrayContaining([...AGIR, 'kdv_kontrol_luca_cek', 'kdv_kontrol_ocr_bekle', 'kdv_kontrol_sonuc_satirlari', 'luca_is_bekle', 'get_agent_status']));
    for (const ad of [...AGIR, 'kdv_kontrol_luca_cek']) expect(aracAcikMi(b, ad, true).neden).toBe('kuru_test');
    for (const ad of ['kdv_kontrol_ocr_bekle', 'kdv_kontrol_sonuc_satirlari', 'luca_is_bekle', 'get_agent_status']) expect(aracAcikMi(b, ad, true).acik).toBe(true);
  });

  it('kdv_kontrol_kilitle / kdv_kontrol_kilit_ac HİÇBİR ajan listesinde yok; girerse bile kuru testte kapalı', () => {
    for (const ajan of AJAN_TANIMLARI) {
      const kilit = ajan.araclar.filter((ad) => /^kdv_kontrol_kilit/.test(ad));
      expect({ ajan: ajan.id, kilit }).toEqual({ ajan: ajan.id, kilit: [] });
    }
    // Defterde kayıtlı olsalar da kademe portal_yaz_agir → kuru testte kapalı (tools.ts'e girerse 'oku' sayılmasın)
    for (const ad of ['kdv_kontrol_kilitle', 'kdv_kontrol_kilit_ac']) {
      const k = aracKademesi(ad);
      if (k) expect(k).toBe('portal_yaz_agir');
    }
  });

  it('kdv_kontrol_* araçları yalnız beyanname ajanında; luca_is_bekle fatura/denetci/beyanname; mali_* analist + koordinatör', () => {
    for (const ajan of AJAN_TANIMLARI) {
      const kdv = ajan.araclar.filter((ad) => ad.startsWith('kdv_kontrol_'));
      expect({ ajan: ajan.id, kdv: kdv.length > 0 }).toEqual({ ajan: ajan.id, kdv: ajan.id === 'beyanname' });
    }
    for (const id of ['fatura', 'denetci', 'beyanname']) expect(ajanBul(id)!.araclar).toContain('luca_is_bekle');
    expect(ajanBul('analist')!.araclar).toEqual(expect.arrayContaining(['mali_donemler_listele', 'mali_yorum_oku']));
    const k = ajanBul('koordinator')!;
    expect(k.araclar).toEqual(expect.arrayContaining(['get_gelir_tablosu', 'get_mizan', 'list_mizan_periods', 'get_kdv_summary', 'mali_donemler_listele', 'ekip_ajan_baslat', 'ekip_is_durum']));
    expect(ajanBul('luca-operator')!.araclar).toContain('create_pending_action');
    // ekip_ajan_baslat yalnız koordinatörde (iç içe zincir yok)
    for (const ajan of AJAN_TANIMLARI) {
      if (ajan.id === 'koordinator') continue;
      expect({ ajan: ajan.id, baslat: ajan.araclar.includes('ekip_ajan_baslat') }).toEqual({ ajan: ajan.id, baslat: false });
    }
  });

  it('katalog metni kademeyi parantez içinde gösterir (prompt satırı ile aynı adlar)', () => {
    const metin = aracKatalogMetni(['kdv_kontrol_eslestir', 'kdv_kontrol_luca_cek', 'luca_is_bekle']);
    expect(metin).toContain('kdv_kontrol_eslestir (portal_yaz_agir)');
    expect(metin).toContain('kdv_kontrol_luca_cek (luca_yaz)');
    expect(metin).toContain('luca_is_bekle (oku)');
  });
});

describe('ajan-tanimlari', () => {
  const SABIT_IDLER = [
    'koordinator', 'fatura', 'banka-kasa', 'beyanname', 'bordro-sgk', 'edefter',
    'luca-operator', 'denetci', 'analist', 'mevzuat', 'risk', 'musteri',
  ];

  it('12 ajan (Evrak Sorumlusu 2026-09-13 kaldırıldı), id\'ler sabit ve tekil', () => {
    expect(AJAN_TANIMLARI).toHaveLength(12);
    expect(AJAN_TANIMLARI.map((a) => a.id).sort()).toEqual([...SABIT_IDLER].sort());
    for (const id of SABIT_IDLER) expect(ajanBul(id)?.id).toBe(id);
    expect(ajanBul('yok')).toBeNull();
  });

  it('her ajanın araç listesindeki tüm adlar defterde var ve tekil', () => {
    for (const ajan of AJAN_TANIMLARI) {
      expect(ajan.araclar.length).toBeGreaterThan(0);
      const eksik = ajan.araclar.filter((ad) => !aracKaydi(ad));
      expect({ ajan: ajan.id, eksik }).toEqual({ ajan: ajan.id, eksik: [] });
      expect(new Set(ajan.araclar).size).toBe(ajan.araclar.length);
    }
  });

  it('hiçbir ajanın listesinde resmi_gonderim aracı yok', () => {
    for (const ajan of AJAN_TANIMLARI) {
      expect(kademeOzeti(ajan.araclar).resmi_gonderim).toBe(0);
    }
  });

  it('model kimlikleri gerçek model adları ve kimlik klasörü sabit kalıpta', () => {
    for (const ajan of AJAN_TANIMLARI) {
      expect(MODEL_KIMLIKLERI[ajan.model]).toMatch(/^claude-(opus|sonnet|haiku)-/);
      expect(ajan.kimlikKlasoru).toBe(`apps/api/kadro/${ajan.id}`);
    }
  });

  it('beyanname/bordro/edefter ajanlarında GİB/SGK/berat gönderimi yok; koordinatör ekip araçlarına sahip', () => {
    for (const id of ['beyanname', 'bordro-sgk', 'edefter']) {
      const a = ajanBul(id)!;
      expect(a.araclar).not.toContain('gib_beyanname_gonder');
      expect(a.araclar).not.toContain('sgk_bildirge_gonder');
      expect(a.araclar).not.toContain('edefter_berat_yukle');
    }
    const k = ajanBul('koordinator')!;
    expect(k.araclar).toEqual(expect.arrayContaining(['ekip_isler', 'ekip_pano', 'get_operation_briefing', 'get_tax_calendar']));
  });

  it('get_kdv1_on_hazirlik beyanname, koordinatör ve denetçide var; kuru testte de açık', () => {
    for (const id of ['beyanname', 'koordinator', 'denetci']) {
      const a = ajanBul(id)!;
      expect(a.araclar).toContain('get_kdv1_on_hazirlik');
      expect(aracAcikMi(a, 'get_kdv1_on_hazirlik', true).acik).toBe(true);
    }
  });
});

// ─── FATURA MERKEZİ AJAN ARAÇLARI (fm_*) + Mihsap'ın ekipten çıkışı (PLAN/15 Faz 5) ───
describe('fm_* araçları ve Mihsap kapanışı (PLAN/15 Faz 5)', () => {
  const FM_OKU = ['fm_belge_listele', 'fm_belge_detay', 'fm_donem_ozeti', 'fm_uyumsuzluklar', 'fm_hesap_plani_ara'];
  // PLAN/19 H7 (2026-09-14): hesap_ata / ai_ile_oku / isaretle portal_yaz → portal_yaz_agir — kuru test pilotunda
  // fm_ai_ile_oku Max kotası harcıyor, fm_hesap_ata / fm_isaretle belgeye gerçek yazıyordu. fm_onayla portal_yaz kaldı (zaten ekibe kapalı).
  const FM_PORTAL_YAZ_AGIR = ['fm_hesap_ata', 'fm_ai_ile_oku', 'fm_isaretle'];
  const FM_PORTAL_YAZ = [...FM_PORTAL_YAZ_AGIR, 'fm_onayla'];
  /** Koordinatöre açılan fm OKUMA araçları (PLAN/19 H3, 2026-09-14) — yazan fm araçları yine yalnız fatura ajanında. */
  const KOORDINATOR_FM_OKU = ['fm_donem_ozeti', 'fm_uyumsuzluklar'];
  /** Fatura ajanından çıkarılan Mihsap dönemi araçları — hiçbirine geri dönmemeli. */
  const MIHSAP_ARACLARI = [
    'list_invoices', 'fetch_invoices_for_period', 'extract_invoice_fields', 'ocr_pdf', 'classify_with_claude',
    'generate_fis_word_from_invoices', 'post_to_luca', 'get_mihsap_agent_jobs',
    'isle_alis', 'isle_satis', 'isle_alis_isletme', 'isle_satis_isletme',
  ];

  it('10 fm aracı tanımlı; genel bot listesinde (MOREN_AI_TOOLS) YOK; defterde kaynak=portal', () => {
    expect(FM_AJAN_ARAC_ADLARI).toEqual([...FM_OKU, ...FM_PORTAL_YAZ, 'fm_luca_gonder']);
    expect(FATURA_MERKEZI_AJAN_ARACLARI).toHaveLength(10);
    const genel = new Set(MOREN_AI_TOOLS.map((t) => t.name));
    for (const ad of FM_AJAN_ARAC_ADLARI) {
      expect(genel.has(ad)).toBe(false);
      expect(aracKaydi(ad)?.kaynak).toBe('portal');
      expect(aracKaydi(ad)?.parametreler?.length).toBeGreaterThan(0);
    }
    expect(aracKaydi('fm_belge_listele')?.parametreler).toEqual(['taxpayerId*', 'donem*', 'yon', 'durum', 'limit']);
    expect(aracKaydi('fm_hesap_ata')?.parametreler).toEqual(['belgeId*', 'satir', 'hesapKodu', 'kayitTuruKod', 'kayitAltKod', 'gerekce*']);
  });

  it('kademeler: okuma=oku, hesap_ata/ai_ile_oku/isaretle=portal_yaz_agir (PLAN/19 H7), onayla=portal_yaz, luca_gonder=luca_yaz', () => {
    for (const ad of FM_OKU) expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'oku' });
    for (const ad of FM_PORTAL_YAZ_AGIR) expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'portal_yaz_agir' });
    expect(aracKademesi('fm_onayla')).toBe('portal_yaz');
    expect(aracKademesi('fm_luca_gonder')).toBe('luca_yaz');
  });

  it('kuru test: fm okuma açık; hesap_ata/ai_ile_oku/isaretle KAPALI (kuru_test, "yapılacaktı"); fm_luca_gonder kapalı; canlıda hepsi açık', () => {
    const fatura = ajanBul('fatura')!;
    for (const ad of FM_OKU) expect({ ad, acik: aracAcikMi(fatura, ad, true).acik }).toEqual({ ad, acik: true });
    // PLAN/19 H7 (2026-09-14): eskiden kuru testte de çalışıyordu (Max kotası / gerçek yazma) — artık kesilir.
    for (const ad of [...FM_PORTAL_YAZ_AGIR, 'fm_luca_gonder']) {
      const kuru = aracAcikMi(fatura, ad, true);
      expect({ ad, acik: kuru.acik, neden: kuru.neden }).toEqual({ ad, acik: false, neden: 'kuru_test' });
      expect(kuru.mesaj).toMatch(/yapılacaktı/);
      expect({ ad, canli: aracAcikMi(fatura, ad, false).acik }).toEqual({ ad, canli: true });
    }
  });

  it('fatura ajanı: fm okuma + yazma + fm_luca_gonder listede; fm_onayla YOK; Luca yazma (luca_yaz/luca_sec/luca_tikla) YOK', () => {
    const fatura = ajanBul('fatura')!;
    expect(fatura.araclar).toEqual(expect.arrayContaining([...FM_OKU, 'fm_hesap_ata', 'fm_ai_ile_oku', 'fm_isaretle', 'fm_luca_gonder']));
    expect(fatura.araclar).not.toContain('fm_onayla');
    for (const ad of ['luca_yaz', 'luca_sec', 'luca_tikla', 'luca_beceri_kaydet']) expect(fatura.araclar).not.toContain(ad);
    // Fatura Merkezi liste + e-Arşiv kıyası kalır. preview_agent_command ÇIKARILDI (2026-09-15, Muzaffer Bey: onay kodu istemiyor):
    //   e-Arşiv/e-Fatura çekimi PRV önizlemesi yerine fm_cekim_* zinciriyle (R5) yürür.
    expect(fatura.araclar).toEqual(expect.arrayContaining(['list_fatura_merkezi', 'list_earsiv_invoices', 'create_pending_action']));
    expect(fatura.araclar).not.toContain('preview_agent_command');
  });

  // ─── FATURA ÇEKİMİ ZİNCİRİ fm_cekim_* (R5, 2026-09-15) ───
  it('fm_cekim_*: 4 araç defterde (kaynak portal, şema tools.ts); kademe baslat/aktar=luca_yaz, durum/bekle=oku; yalnız fatura ajanında', () => {
    const CEKIM_YAZ = ['fm_cekim_baslat', 'fm_cekim_aktar'];
    const CEKIM_OKU = ['fm_cekim_durum', 'fm_cekim_bekle'];
    for (const ad of CEKIM_YAZ) expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'luca_yaz' });
    for (const ad of CEKIM_OKU) expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'oku' });
    for (const ad of [...CEKIM_YAZ, ...CEKIM_OKU]) {
      expect(aracKaydi(ad)?.kaynak).toBe('portal');
      expect(aracKaydi(ad)?.parametreler).toEqual(expect.arrayContaining(['taxpayerId*', 'donem*']));
      expect(PORTAL_ARAC_ADLARI.has(ad)).toBe(true); // runner "Çalıştırıcı bulunamadı" demez
    }
    expect(aracKaydi('fm_cekim_bekle')?.parametreler).toContain('maxSaniye');
    const fatura = ajanBul('fatura')!;
    expect(fatura.araclar).toEqual(expect.arrayContaining([...CEKIM_YAZ, ...CEKIM_OKU]));
    // Kuru test: baslat/aktar KESİLİR ("yapılacaktı"); durum/bekle kuru testte de okur; canlıda hepsi açık.
    for (const ad of CEKIM_YAZ) {
      const kuru = aracAcikMi(fatura, ad, true);
      expect({ ad, acik: kuru.acik, neden: kuru.neden }).toEqual({ ad, acik: false, neden: 'kuru_test' });
      expect(kuru.mesaj).toMatch(/yapılacaktı/);
      expect({ ad, canli: aracAcikMi(fatura, ad, false).acik }).toEqual({ ad, canli: true });
    }
    for (const ad of CEKIM_OKU) expect({ ad, acik: aracAcikMi(fatura, ad, true).acik }).toEqual({ ad, acik: true });
    // Başka hiçbir ajanda yok (koordinatör dahil: çekim işini ekip_ajan_baslat ile fatura ajanına verir).
    for (const ajan of AJAN_TANIMLARI) {
      if (ajan.id === 'fatura') continue;
      const cekim = ajan.araclar.filter((ad) => ad.startsWith('fm_cekim_'));
      expect({ ajan: ajan.id, cekim }).toEqual({ ajan: ajan.id, cekim: [] });
    }
    // Genel bot listesine sızmadı.
    const genel = new Set(MOREN_AI_TOOLS.map((t) => t.name));
    for (const ad of [...CEKIM_YAZ, ...CEKIM_OKU]) expect({ ad, genelde: genel.has(ad) }).toEqual({ ad, genelde: false });
  });

  it('fm_onayla HİÇBİR ajanın listesinde yok — onay sahibindir', () => {
    for (const ajan of AJAN_TANIMLARI) {
      expect({ ajan: ajan.id, fmOnayla: ajan.araclar.includes('fm_onayla') }).toEqual({ ajan: ajan.id, fmOnayla: false });
      expect(aracAcikMi(ajan, 'fm_onayla', false).neden).toBe('ajana_kapali');
    }
  });

  it('fatura / koordinatör / denetçi listelerinde Mihsap aracı yok', () => {
    for (const id of ['fatura', 'koordinator', 'denetci']) {
      const a = ajanBul(id)!;
      const kalan = a.araclar.filter((ad) => MIHSAP_ARACLARI.includes(ad));
      expect({ ajan: id, mihsap: kalan }).toEqual({ ajan: id, mihsap: [] });
    }
  });

  it('fm_* fatura ajanı dışında yalnız koordinatörde ve yalnız OKUMA (fm_donem_ozeti, fm_uyumsuzluklar — PLAN/19 H3); yazan fm araçları başka ajana açılmadı', () => {
    for (const ajan of AJAN_TANIMLARI) {
      if (ajan.id === 'fatura') continue;
      const fm = ajan.araclar.filter((ad) => ad.startsWith('fm_')).sort();
      // PLAN/19 H3 (2026-09-14): Koordinatör sabah özeti / soru için Fatura Merkezi ÖZETİNİ kendi okur; yazma yine yalnız fatura.
      expect({ ajan: ajan.id, fm }).toEqual({ ajan: ajan.id, fm: ajan.id === 'koordinator' ? [...KOORDINATOR_FM_OKU].sort() : [] });
    }
    for (const ad of KOORDINATOR_FM_OKU) expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'oku' });
  });

  // PLAN/19 H3 (2026-09-14): Koordinatörün kendi okuyabildiği araçlar — hepsi 'oku', kuru testte de açık.
  it('koordinatör PLAN/19 okuma araçlarına sahip; hepsi oku kademesi ve kuru testte açık; 5 ajana get_tax_calendar eklendi', () => {
    const k = ajanBul('koordinator')!;
    const yeni = [
      'list_etebligat', 'list_tax_payable', 'get_cari_hareketler', 'get_bank_status', 'list_fatura_merkezi', 'fm_donem_ozeti',
      'fm_uyumsuzluklar', 'list_earsiv_invoices', 'list_documents', 'list_sgk_declarations', 'get_isletme_hesap_ozeti',
      'mali_yorum_oku', 'list_edefter_sessions', 'get_accounting_reference',
    ];
    expect(k.araclar).toEqual(expect.arrayContaining(yeni));
    for (const ad of yeni) {
      expect({ ad, kademe: aracKademesi(ad) }).toEqual({ ad, kademe: 'oku' });
      expect({ ad, acik: aracAcikMi(k, ad, true).acik }).toEqual({ ad, acik: true });
    }
    for (const id of ['fatura', 'banka-kasa', 'luca-operator', 'denetci', 'risk']) {
      expect({ id, takvim: ajanBul(id)!.araclar.includes('get_tax_calendar') }).toEqual({ id, takvim: true });
    }
    expect(aracKademesi('get_tax_calendar')).toBe('oku');
  });

  it('ekipMihsapKomutuYasagi: mihsap* ajanı ya da isle_* eylemi ekipte reddedilir; Luca/diğer komutlar ve başka araçlar serbest', () => {
    for (const arac of ['preview_agent_command', 'create_confirmed_agent_command', 'create_agent_command']) {
      expect(ekipMihsapKomutuYasagi(arac, { agent: 'mihsap', action: 'isle_alis', payload: {} })).toMatch(/KAPALI/);
      expect(ekipMihsapKomutuYasagi(arac, { agent: 'Mihsap-Fatura-Isleme-Agent', action: 'x' })).toMatch(/KAPALI/);
      expect(ekipMihsapKomutuYasagi(arac, { agent: 'luca', action: 'isle_satis_isletme' })).toMatch(/KAPALI/);
      expect(ekipMihsapKomutuYasagi(arac, { agent: 'luca', action: 'fetch_earsiv', payload: {} })).toBeNull();
      expect(ekipMihsapKomutuYasagi(arac, { agent: 'whatsapp', action: 'document_request' })).toBeNull();
      expect(ekipMihsapKomutuYasagi(arac, {})).toBeNull();
    }
    expect(ekipMihsapKomutuYasagi('fm_belge_listele', { agent: 'mihsap', action: 'isle_alis' })).toBeNull();
    expect(ekipMihsapKomutuYasagi('get_mizan', { agent: 'mihsap' })).toBeNull();
  });

  /** kimlik.md "Kullandığım araçlar" bölümündeki `araç_adı` işaretli adlar (bölüm sonuna kadar). */
  function kimlikAraclari(ajanId: string): Set<string> {
    const md = fs.readFileSync(path.join(__dirname, `../../kadro/${ajanId}/kimlik.md`), 'utf8');
    const bolum = md.split('## Kullandığım araçlar')[1] || '';
    expect({ ajanId, bolumVar: bolum.length > 0 }).toEqual({ ajanId, bolumVar: true });
    return new Set([...bolum.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]));
  }

  it('kadro/fatura/kimlik.md "Kullandığım araçlar" ↔ ajan-tanimlari fatura.araclar BİREBİR', () => {
    const mdAraclar = kimlikAraclari('fatura');
    const kod = new Set(ajanBul('fatura')!.araclar);
    expect({ koddaVarMdYok: [...kod].filter((x) => !mdAraclar.has(x)), mdVarKoddaYok: [...mdAraclar].filter((x) => !kod.has(x)) })
      .toEqual({ koddaVarMdYok: [], mdVarKoddaYok: [] });
    // Mihsap araçları kimlik.md'de de yok
    for (const ad of MIHSAP_ARACLARI) expect(mdAraclar.has(ad)).toBe(false);
    expect(mdAraclar.has('fm_onayla')).toBe(false);
  });

  // PLAN/17 §3 (2026-09-13): kilit testi 13 ajana genişletildi — araç eklerken/çıkarırken iki yer birlikte güncellenir.
  it('13 ajanın kimlik.md "Kullandığım araçlar" bölümü ↔ ajan-tanimlari araclar BİREBİR', () => {
    for (const ajan of AJAN_TANIMLARI) {
      const mdAraclar = kimlikAraclari(ajan.id);
      const kod = new Set(ajan.araclar);
      expect({
        ajan: ajan.id,
        koddaVarMdYok: [...kod].filter((x) => !mdAraclar.has(x)),
        mdVarKoddaYok: [...mdAraclar].filter((x) => !kod.has(x)),
      }).toEqual({ ajan: ajan.id, koddaVarMdYok: [], mdVarKoddaYok: [] });
    }
  });

  it('13 ajanın receteler.md dosyası var ve boş değil (runner "REÇETELERİN" bloğu bunu okur)', () => {
    for (const ajan of AJAN_TANIMLARI) {
      const dosya = path.join(__dirname, `../../kadro/${ajan.id}/receteler.md`);
      const icerik = fs.existsSync(dosya) ? fs.readFileSync(dosya, 'utf8') : '';
      expect({ ajan: ajan.id, var: icerik.trim().length > 200 }).toEqual({ ajan: ajan.id, var: true });
    }
  });
});

// "ÖĞRENDİM:" ayıklama — model kalın/madde/başlık biçimlese de yakalanmalı (canlı koşuda 0 çıkmıştı)
describe('ÖĞRENDİM ayıklama (runner)', () => {
  const { EkipRunnerService } = require('./ekip-runner.service');
  const ayikla = (m: string) => (EkipRunnerService.prototype as any).ogrenilenleriAyikla.call({}, m) as string[];
  it('kalın, madde ve başlık biçimlerini yakalar', () => {
    const metin = [
      '**ÖĞRENDİM:** get_tax_calendar boş dönebiliyor; ofis kuralından hesapla.',
      '- ÖĞRENDİM: ikinci ders burada yazıyor',
      '### ÖĞRENDİM: üçüncü ders başlık gibi',
      'ÖĞRENDİM: kısa', // 8 karakterden kısa → alınmaz
      'Bu satır ders değil.',
    ].join('\n');
    const r = ayikla(metin);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatch(/^get_tax_calendar/);
  });
  it('başlık altındaki maddeleri de alır; sonraki başlıkta durur; "Yok" maddesini almaz', () => {
    const metin = [
      '**ÖĞRENDİM:**',
      '- compare_periods kaynak adı küçük harf olmalı (gelir_tablosu).',
      '- Q2 gelir tablosu yoksa mizan 6xx hesaplarından türet.',
      '',
      '**ONAY BEKLEYEN:**',
      '- Mükellefe özet gönderimi (kuru test).',
      '',
      '### ÖĞRENDİM',
      '1. get_gelir_tablosu Q2 için boş döndü, önce list_mizan_periods bak.',
      'Bu satır madde değil, başlığı kapatır.',
      '- bu madde artık alınmaz çünkü başlık kapandı',
    ].join('\n');
    const r = ayikla(metin);
    expect(r).toEqual([
      'compare_periods kaynak adı küçük harf olmalı (gelir_tablosu).',
      'Q2 gelir tablosu yoksa mizan 6xx hesaplarından türet.',
      'get_gelir_tablosu Q2 için boş döndü, önce list_mizan_periods bak.',
    ]);
    expect(ayikla('ÖĞRENDİM: Yok')).toEqual([]);
  });
});
