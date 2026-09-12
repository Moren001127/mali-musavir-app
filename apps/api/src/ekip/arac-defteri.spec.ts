import * as fs from 'fs';
import * as path from 'path';
import { ARAC_DEFTERI, aracAcikMi, aracKademesi, aracKaydi, ekipMihsapKomutuYasagi, kademeOzeti } from './arac-defteri';
import { AJAN_TANIMLARI, MODEL_KIMLIKLERI, ajanBul } from './ajan-tanimlari';
import { FATURA_MERKEZI_AJAN_ARACLARI, FM_AJAN_ARAC_ADLARI, MOREN_AI_TOOLS } from '../moren-ai/tools';

/**
 * Araç defteri + yetki kademesi kilit testleri (PLAN/13-AJAN-KADROSU.md §4):
 *  - resmi_gonderim hiçbir ajana, hiçbir modda açılmaz
 *  - kuru test luca_yaz / disari_gonder kapatır; oku / portal_yaz açık kalır
 *  - her ajanın araç listesindeki her ad defterde var
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

describe('ajan-tanimlari', () => {
  const SABIT_IDLER = [
    'koordinator', 'evrak', 'fatura', 'banka-kasa', 'beyanname', 'bordro-sgk', 'edefter',
    'luca-operator', 'denetci', 'analist', 'mevzuat', 'risk', 'musteri',
  ];

  it('13 ajan, id\'ler sabit ve tekil', () => {
    expect(AJAN_TANIMLARI).toHaveLength(13);
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
  const FM_PORTAL_YAZ = ['fm_hesap_ata', 'fm_ai_ile_oku', 'fm_isaretle', 'fm_onayla'];
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

  it('kademeler: okuma=oku, hesap_ata/ai_ile_oku/isaretle/onayla=portal_yaz, luca_gonder=luca_yaz', () => {
    for (const ad of FM_OKU) expect(aracKademesi(ad)).toBe('oku');
    for (const ad of FM_PORTAL_YAZ) expect(aracKademesi(ad)).toBe('portal_yaz');
    expect(aracKademesi('fm_luca_gonder')).toBe('luca_yaz');
  });

  it('kuru test: fm okuma + portal_yaz açık, fm_luca_gonder kapalı (kuru_test); canlıda açık', () => {
    const fatura = ajanBul('fatura')!;
    for (const ad of [...FM_OKU, 'fm_hesap_ata', 'fm_ai_ile_oku', 'fm_isaretle']) {
      expect(aracAcikMi(fatura, ad, true).acik).toBe(true);
    }
    const kuru = aracAcikMi(fatura, 'fm_luca_gonder', true);
    expect(kuru.acik).toBe(false);
    expect(kuru.neden).toBe('kuru_test');
    expect(aracAcikMi(fatura, 'fm_luca_gonder', false).acik).toBe(true);
  });

  it('fatura ajanı: fm okuma + yazma + fm_luca_gonder listede; fm_onayla YOK; Luca yazma (luca_yaz/luca_sec/luca_tikla) YOK', () => {
    const fatura = ajanBul('fatura')!;
    expect(fatura.araclar).toEqual(expect.arrayContaining([...FM_OKU, 'fm_hesap_ata', 'fm_ai_ile_oku', 'fm_isaretle', 'fm_luca_gonder']));
    expect(fatura.araclar).not.toContain('fm_onayla');
    for (const ad of ['luca_yaz', 'luca_sec', 'luca_tikla', 'luca_beceri_kaydet']) expect(fatura.araclar).not.toContain(ad);
    // Fatura Merkezi liste + e-Arşiv kıyası kalır; entegratör çekimi önizlemesi (preview) kalır — Mihsap komutu runner'da reddedilir.
    expect(fatura.araclar).toEqual(expect.arrayContaining(['list_fatura_merkezi', 'list_earsiv_invoices', 'preview_agent_command', 'create_pending_action']));
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

  it('fm_* fatura ajanı dışındaki ajanlara açılmadı (koordinatör/denetçi dahil)', () => {
    for (const ajan of AJAN_TANIMLARI) {
      if (ajan.id === 'fatura') continue;
      const fm = ajan.araclar.filter((ad) => ad.startsWith('fm_'));
      expect({ ajan: ajan.id, fm }).toEqual({ ajan: ajan.id, fm: [] });
    }
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

  it('kadro/fatura/kimlik.md "Kullandığım araçlar" ↔ ajan-tanimlari fatura.araclar BİREBİR', () => {
    const md = fs.readFileSync(path.join(__dirname, '../../kadro/fatura/kimlik.md'), 'utf8');
    const bolum = md.split('## Kullandığım araçlar')[1] || '';
    expect(bolum.length).toBeGreaterThan(0);
    const mdAraclar = new Set([...bolum.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]));
    const kod = new Set(ajanBul('fatura')!.araclar);
    expect({ koddaVarMdYok: [...kod].filter((x) => !mdAraclar.has(x)), mdVarKoddaYok: [...mdAraclar].filter((x) => !kod.has(x)) })
      .toEqual({ koddaVarMdYok: [], mdVarKoddaYok: [] });
    // Mihsap araçları kimlik.md'de de yok
    for (const ad of MIHSAP_ARACLARI) expect(mdAraclar.has(ad)).toBe(false);
    expect(mdAraclar.has('fm_onayla')).toBe(false);
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
