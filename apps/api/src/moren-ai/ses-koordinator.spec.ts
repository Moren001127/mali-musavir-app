import {
  ajanSec,
  canliModIstendi,
  ogrenmeSatirlariniSuz,
  raporMetniAyikla,
  sesCevabiOlustur,
  sesGoreviOlustur,
  sesIcinSadelestir,
  sesKoordinatorAcik,
  whatsappGoreviOlustur,
} from './ses-koordinator';

describe('ses-koordinator — env kapısı', () => {
  it('varsayılan AÇIK; yalnız off kapatır', () => {
    expect(sesKoordinatorAcik({} as any)).toBe(true);
    expect(sesKoordinatorAcik({ EKIP_SES_KOORDINATOR: 'on' } as any)).toBe(true);
    expect(sesKoordinatorAcik({ EKIP_SES_KOORDINATOR: 'OFF' } as any)).toBe(false);
    expect(sesKoordinatorAcik({ EKIP_SES_KOORDINATOR: ' off ' } as any)).toBe(false);
  });
});

describe('ses-koordinator — canlı mod kalıbı', () => {
  it('sözlü canlı isteğini yakalar', () => {
    for (const q of [
      'Tahir Sucu için KDV tahakkukunu canlı yap',
      'bunu gerçek çalıştır',
      'canlı modda çalıştır lütfen',
      'kuru test olmasın, gerçekten kaydet',
      'Kuru testi kapat',
    ]) expect(canliModIstendi(q)).toBe(true);
  });

  it('normal soruları ve olumsuz kalıpları canlı saymaz', () => {
    for (const q of [
      'Haziran KDV\'ler ne durumda?',
      'canlı yapma, sadece bak',
      'kuru test olsun',
      'gerçek kişi mi bu mükellef',
      '',
    ]) expect(canliModIstendi(q)).toBe(false);
  });
});

describe('ses-koordinator — rapor ayıklama', () => {
  it('RAPOR/SORU bölümlerini alır, ÖĞRENDİM satırını atar, markdown temizler', () => {
    const rapor = [
      'Önce araçları çağırdım.',
      '**RAPOR:** Haziran döneminde **3 mükellef** beyanname bekliyor.',
      '- İlgi Oto: KDV kontrol bitti.',
      'SORU: Tahir Sucu için devam edeyim mi?',
      'ÖĞRENDİM: Sahip haziranı önce sorar.',
    ].join('\n');
    const r = raporMetniAyikla(rapor);
    expect(r.rapor).toBe('Haziran döneminde 3 mükellef beyanname bekliyor. İlgi Oto: KDV kontrol bitti.');
    expect(r.soru).toBe('Tahir Sucu için devam edeyim mi?');
    expect(r.rapor).not.toContain('ÖĞRENDİM');
  });

  it('RAPOR yoksa tüm metni kullanır', () => {
    expect(raporMetniAyikla('Veri yok.').rapor).toBe('Veri yok.');
    expect(sesIcinSadelestir('# Başlık\n* madde bir\n`kod`')).toBe('Başlık\nmadde bir\nkod');
  });

  // PLAN/19 H2-c (2026-09-14): "Öğrendiklerim:" (küçük harf, kalın, madde imli, başlık) satırları da sesli metne / WhatsApp'a karışmasın
  it('Öğrendiklerim / ÖĞRENDİM her biçimde düşer: küçük harf, **kalın**, "- madde", "### başlık", numaralı', () => {
    const rapor = [
      'RAPOR: Bugün 2 beyanname hazır.',
      'Öğrendiklerim: get_tax_calendar boş dönebiliyor.',
      '**Öğrendiklerim:** ikinci ders kalın.',
      '- ÖĞRENDİM: madde imli ders.',
      '### ÖĞRENDİM: başlık biçimli ders',
      '1. öğrendiklerim: numaralı küçük harf',
      '**ÖĞRENDİM**: kalın ama iki nokta dışarıda',
      'Son satır kalır.',
    ].join('\n');
    const r = raporMetniAyikla(rapor);
    expect(r.rapor).toBe('Bugün 2 beyanname hazır. Son satır kalır.');
    expect(r.rapor).not.toMatch(/ğrendi/i);
  });

  it('tek başına "Öğrendiklerim:" başlığının altındaki maddeler de düşer; madde olmayan ilk dolu satır başlığı kapatır', () => {
    const satirlar = [
      'Günaydın. 3 mükellef bekliyor.',
      '**Öğrendiklerim:**',
      '- compare_periods kaynak adı küçük harf olmalı.',
      '2) ikinci ders numaralı.',
      '',
      '• üçüncü ders boş satırdan sonra.',
      'SORU: devam edeyim mi?',
      '- bu madde SORU satırından sonra, kalır.',
    ];
    expect(ogrenmeSatirlariniSuz(satirlar)).toEqual(['Günaydın. 3 mükellef bekliyor.', '', 'SORU: devam edeyim mi?', '- bu madde SORU satırından sonra, kalır.']);
    // Sesli cevap: dersler yok, soru var
    const r = raporMetniAyikla(`RAPOR:\n${satirlar.join('\n')}`);
    expect(r.rapor).toBe('Günaydın. 3 mükellef bekliyor.');
    expect(r.soru).toBe('devam edeyim mi? bu madde SORU satırından sonra, kalır.');
  });

  it('çıplak "### ÖĞRENDİM" / "**Öğrendiklerim**" başlığı (iki noktasız) ve altındaki maddeler düşer', () => {
    const satirlar = ['Özet satırı.', '### ÖĞRENDİM', '1. get_gelir_tablosu Q2 boş döndü.', '**Öğrendiklerim**', '- ikinci ders', 'Kapanış.'];
    expect(ogrenmeSatirlariniSuz(satirlar)).toEqual(['Özet satırı.', 'Kapanış.']);
  });

  it('benzer ama farklı kelimeler düşmez ("Öğrendiklerimiz:", "Öğrendim ki …", metin ortasındaki öğrendim)', () => {
    const satirlar = ['Öğrendiklerimiz: ekip notu kalır.', 'Bugün öğrendim ki veri yok.', 'Öğrendim ki mizan kilitli.', '- Öğrendiklerim listesi uzun değil.'];
    expect(ogrenmeSatirlariniSuz(satirlar)).toEqual(satirlar);
  });
});

describe('ses-koordinator — sesli cevap', () => {
  it('kuru test + onay bekleyen + soru tek cümle olur; canlıda başa CANLI modda gelir', () => {
    const c = sesCevabiOlustur({
      rapor: 'RAPOR: Beş fatura okundu.\nSORU: Devam edeyim mi?',
      kuruTestSayisi: 2,
      onayBekleyen: [{ previewId: 'PRV-1A2B', name: 'send_whatsapp_freeform', confirmationText: 'ONAYLIYORUM #PRV-1A2B' }],
      dryRun: false,
    });
    expect(c.startsWith('CANLI modda.')).toBe(true);
    expect(c).toContain('Beş fatura okundu.');
    expect(c).toContain('Kuru testte 2 adım yapılmadı');
    expect(c).toContain('ONAYLIYORUM #PRV-1A2B');
    expect(c).toContain('Devam edeyim mi?');
  });

  it('zaman aşımında kısa "hâlâ çalışıyorum" der', () => {
    const c = sesCevabiOlustur({ rapor: '', kuruTestSayisi: 0, onayBekleyen: [], dryRun: true, zamanAsimi: true });
    // 2026-09-12: ilk-cevap sınırı → 'iletildi, sonucu gelince söyleyeceğim' (sessiz bekleme yerine)
    expect(c).toMatch(/ilettim/);
    expect(c).toMatch(/söyleyeceğim/);
    expect(c.length).toBeLessThan(200);
  });

  it('hata + boş raporda hatayı kısa söyler; uzun raporu kırpar', () => {
    expect(sesCevabiOlustur({ rapor: '', kuruTestSayisi: 0, onayBekleyen: [], dryRun: true, hata: 'Max bağlı değil' })).toContain('İşi bitiremedim');
    const uzun = Array.from({ length: 40 }, (_, i) => `Cümle ${i + 1} burada.`).join(' ');
    const c = sesCevabiOlustur({ rapor: uzun, kuruTestSayisi: 0, onayBekleyen: [], dryRun: true });
    expect(c.length).toBeLessThanOrEqual(430);
  });
});

describe('ses-koordinator — görev metni', () => {
  it('bağlam satırları ve SORU/KOMUT', () => {
    const g = sesGoreviOlustur({ question: 'Haziran KDV ne durumda', currentPath: '/panel/kdv-kontrol', taxpayerAdi: 'İlgi Oto', canli: true });
    expect(g).toContain('Aktif portal ekranı: /panel/kdv-kontrol.');
    expect(g).toContain('Seçili mükellef: İlgi Oto.');
    expect(g).toContain('CANLI');
    expect(g.endsWith('SORU/KOMUT: Haziran KDV ne durumda')).toBe(true);
    // belirsiz soru → yönlendirme satırı yok
    expect(g).not.toContain('YÖNLENDİRME ÖNERİSİ');
  });

  it('PLAN/17 §5 eşlemesi varsa "YÖNLENDİRME ÖNERİSİ: <ajan>/<reçete>" satırı eklenir; ajan yoksa nedeni yazar', () => {
    const g1 = sesGoreviOlustur({ question: "Erdoğan Balçık'ın Ağustos KDV kontrolünü yap", canli: false });
    expect(g1).toContain('YÖNLENDİRME ÖNERİSİ: beyanname/R1');
    expect(g1).toMatch(/Luca Operatörü DEĞİL/);
    const g2 = sesGoreviOlustur({ question: "Öz Ela Turizm'in 2. dönem gelir tablosunu analiz et", canli: false });
    expect(g2).toContain('YÖNLENDİRME ÖNERİSİ: analist/R2');
    const g3 = sesGoreviOlustur({ question: 'Mihsap faturalarını çek', canli: false });
    expect(g3).toContain('YÖNLENDİRME ÖNERİSİ: ajan yok — Mihsap');
    expect(g3.endsWith('SORU/KOMUT: Mihsap faturalarını çek')).toBe(true);
  });

  it('whatsappGoreviOlustur (PLAN/19 §C): WhatsApp satırı, canlı satırı, yönlendirme, sonda SORU/KOMUT', () => {
    const g = whatsappGoreviOlustur({ question: "Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın", canli: true });
    const satirlar = g.split('\n');
    expect(satirlar[0]).toBe("Muzaffer Bey WhatsApp'tan yazıyor; cevabın WhatsApp mesajı olarak gidecek: kısa, düz metin, markdown/çift yıldız yok, en çok 1200 karakter.");
    expect(satirlar[1]).toBe('Muzaffer Bey bu görev için CANLI (kuru test dışı) çalışmayı istedi.');
    expect(satirlar[2]).toContain('YÖNLENDİRME ÖNERİSİ: beyanname/R1');
    expect(g.endsWith("SORU/KOMUT: Erdoğan Balçık'ın Ağustos KDV kontrolünü yapın")).toBe(true);
    expect(g).not.toContain('sesli');
    const kuru = whatsappGoreviOlustur({ question: 'işler ne durumda', canli: false });
    expect(kuru).not.toContain('CANLI');
    expect(kuru).not.toContain('YÖNLENDİRME ÖNERİSİ');
    expect(kuru.endsWith('SORU/KOMUT: işler ne durumda')).toBe(true);
  });
});

// ─── PLAN/17 §5 — ajanSec (2026-09-13): sahibin iki canlı şikâyeti + tablo satırları ───
describe('ses-koordinator — ajanSec (PLAN/17 §5 yönlendirme)', () => {
  const sec = (c: string) => {
    const r = ajanSec(c);
    return r ? `${r.ajanId ?? 'yok'}/${r.recete ?? '-'}` : null;
  };

  it('sahibin 12 Eylül şikâyetleri: KDV kontrolü → beyanname/R1 (Luca Operatörü DEĞİL); gelir tablosu analizi → analist/R2', () => {
    expect(sec("Erdoğan Balçık'ın Ağustos KDV kontrolünü yap")).toBe('beyanname/R1');
    expect(sec("Öz Ela Turizm'in 2. dönem gelir tablosunu analiz et")).toBe('analist/R2');
    expect(ajanSec("Erdoğan Balçık'ın Ağustos KDV kontrolünü yap")!.neden).toMatch(/portal işi/);
    expect(ajanSec("Öz Ela Turizm'in 2. dönem gelir tablosunu analiz et")!.neden).toMatch(/hazır \(kilitli\) tablo/);
  });

  it('KDV kontrol kalıpları → beyanname/R1 (Türkçe İ/ı/ş normalize)', () => {
    for (const c of [
      "X'in 2026/08 KDV KONTROLÜNÜ başlat, hataları söyle",
      "İlgi Oto'nun alış-satış mutabakatı",
      "Tahir Sucu'nun KDV'sini Luca ile karşılaştır",
      "Luca'da Erdoğan Balçık için KDV kontrolü oturumu aç", // Luca'da geçse de KDV kontrol luca-operator'e GİTMEZ
    ]) expect({ c, r: sec(c) }).toEqual({ c, r: 'beyanname/R1' });
  });

  it('doğrulayıcı kuru test cümleleri (2026-09-13): R1 / R2 / luca-operator', () => {
    expect(sec("Erdoğan Balçık'ın Ağustos KDV kontrolünü yap")).toBe('beyanname/R1');
    expect(sec("Öz Ela'nın 2. dönem gelir tablosunu yorumla")).toBe('analist/R2');
    expect(sec("Luca'da fiş listesini aç")).toBe('luca-operator/ekran');
  });

  it('gelir tablosu / bilanço / İHÖ analiz-yorum → analist/R2', () => {
    for (const c of [
      "X'in Q2 gelir tablosunu yorumla",
      "X'in geçici vergi dönemi kârı nasıl",
      'BİLANÇOYU değerlendir',
      "Ayşegül'ün işletme hesap özetine bak, kârlılık nasıl",
    ]) expect({ c, r: sec(c) }).toEqual({ c, r: 'analist/R2' });
  });

  it('KDV beyannamesi / ödenecek çıkar mı / KDV1 → beyanname/R3; geçici vergi paketi → beyanname/R7', () => {
    expect(sec("X'in KDV beyannamesini hazırla")).toBe('beyanname/R3');
    expect(sec('Bu ay ödenecek KDV çıkar mı')).toBe('beyanname/R3');
    expect(sec("X'in KDV1 rakamları ne")).toBe('beyanname/R3');
    expect(sec("X'in geçici vergi paketini hazırla")).toBe('beyanname/R7');
    expect(sec('Öz Ela geçici vergi beyannamesi')).toBe('beyanname/R7');
  });

  it('muhasebeleştir / hesap ata / Luca\'ya at → fatura/R4; faturaları çek / entegratör / e-arşiv → fatura/R5; Mihsap → ajan yok', () => {
    expect(sec("X'in Ağustos faturalarını muhasebeleştir")).toBe('fatura/R4');
    expect(sec('Hesap ata şu belgelere')).toBe('fatura/R4');
    expect(sec("Onaylı fişleri Luca'ya at")).toBe('fatura/R4');
    expect(sec("X'in faturalarını çek")).toBe('fatura/R5');
    expect(sec('Entegratörden Ağustos faturalarını al')).toBe('fatura/R5');
    expect(sec('E-Arşiv faturalarını indir')).toBe('fatura/R5');
    const m = ajanSec("Mihsap'tan X'in faturalarını çek");
    expect(m).toEqual({ ajanId: null, recete: null, neden: expect.stringMatching(/Mihsap çekimi ekibe kapalı/) });
  });

  // 2026-09-15 (Muzaffer Bey): "faturaları çek ve işle → Fatura İşleme Merkezi; e-Fatura mükellefi ise e-Fatura sorgulama, değilse GİB e-Arşiv".
  it('fatura çekimi kalıpları → fatura/R5, R4\'ten ÖNCE: "çek ve işle" R5 (neden R4\'e geçişi söyler); e-fatura/e-arşiv sorgula; entegratörden çek', () => {
    for (const c of [
      "Erdoğan Balçık'ın Ağustos faturalarını çek ve işle",
      "X'in faturalarını çek, sonra işle",
      'E-Fatura sorgula',
      "Öz Ela'nın Ağustos e-fatura sorgusunu yap",
      'e-Arşiv sorgula',
      "X'in e-arşiv faturalarını sorgula",
      'Entegratörden çek',
      "Tahir Sucu'nun Ağustos faturalarını entegratörden çek",
      "X'in Ağustos faturalarını sorgula",
    ]) expect({ c, r: sec(c) }).toEqual({ c, r: 'fatura/R5' });
    const cekIsle = ajanSec("Erdoğan Balçık'ın Ağustos faturalarını çek ve işle")!;
    expect(cekIsle.neden).toMatch(/Fatura İşleme Merkezi/);
    expect(cekIsle.neden).toMatch(/e-Fatura Sorgu, değilse GİB e-Arşiv/);
    expect(cekIsle.neden).toMatch(/R4’e geçer/);
    expect(cekIsle.neden).not.toMatch(/PRV|önizleme/);
    // yalnız "çek" → R4 notu yok; yalnız "işle" → yine R4
    expect(ajanSec("X'in faturalarını çek")!.neden).not.toMatch(/R4’e geçer/);
    expect(sec("X'in Ağustos faturalarını işle")).toBe('fatura/R4');
    expect(sec("X'in Ağustos faturalarını muhasebeleştir")).toBe('fatura/R4');
    // Mihsap yine kapalı
    expect(ajanSec("Mihsap'tan faturaları çek ve işle")).toMatchObject({ ajanId: null, recete: null });
  });

  it('denetim / mizanda sorun / kasa-ortak / mizan çek → denetci/R6 (mizan çekimi luca-operator\'e gitmez)', () => {
    expect(sec("X'in geçici vergi öncesi denetimini yap")).toBe('denetci/R6');
    expect(sec("Tahir Sucu'nun mizanını denetle")).toBe('denetci/R6');
    expect(sec('Mizanda sorun var mı bak')).toBe('denetci/R6');
    expect(sec("X'in kasa-ortak cari durumu")).toBe('denetci/R6');
    expect(sec("Luca'da X'in mizanını çek")).toBe('denetci/R6');
  });

  it('banka/ekstre → ayrı ajan yok; evrak/hatırlatma → ajan yok (otomasyon); tebligat → musteri/R10; e-defter/berat → edefter/K1', () => {
    expect(ajanSec("X'in banka ekstresi geldi mi")).toMatchObject({ ajanId: null, recete: null });
    expect(ajanSec('Eksik ekstre listesi')).toMatchObject({ ajanId: null, recete: null });
    expect(ajanSec('Kasa-banka kontrolü yap')).toMatchObject({ ajanId: null, recete: null });
    // Evrak Sorumlusu kaldırıldı (2026-09-13): hatırlatma otomasyonun işi, ajan başlatılmaz; eksik listesi Koordinatör'de.
    expect(ajanSec('Ağustos evrakı gelmeyenler kim')).toMatchObject({ ajanId: null, recete: null });
    expect(String(ajanSec('Ağustos evrakı gelmeyenler kim')?.neden)).toContain('OTOMATİK');
    expect(ajanSec("X'e evrak hatırlatması gönder")).toMatchObject({ ajanId: null });
    expect(sec('Yeni tebligat var mı')).toBe('musteri/R10');
    expect(sec("X'in e-defter kontrolü")).toBe('edefter/K1');
    expect(sec('Berat ne zaman')).toBe('edefter/K1');
  });

  it('bordro / SGK / muhtasar → ajan yok, neden "bordro modülü kapalı"', () => {
    for (const c of ["X'in bordrosu hazır mı", 'SGK bildirgesi ver', 'Muhtasar beyannamesi hazırla']) {
      const r = ajanSec(c);
      expect({ c, ajanId: r?.ajanId, neden: r?.neden }).toEqual({ c, ajanId: null, neden: expect.stringMatching(/bordro modülü kapalı/) });
    }
  });

  it('"Luca\'da … aç/doldur/oku/fiş" YALNIZ bu kalıp → luca-operator', () => {
    expect(sec("Luca'da fiş listesi ekranını aç")).toBe('luca-operator/ekran');
    expect(sec("Lucada tahakkuk fişi taslağını doldur")).toBe('luca-operator/ekran');
    expect(sec("Luca'da açık ekranı oku")).toBe('luca-operator/ekran');
  });

  it('belirsiz cümle → null (Koordinatör tek satır soru sorar)', () => {
    for (const c of ['', 'merhaba', 'bugün hava nasıl', "X'in durumu ne", 'Haziran KDV ne durumda']) {
      expect({ c, r: ajanSec(c) }).toEqual({ c, r: null });
    }
  });
});
