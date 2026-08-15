import { ButceFaizOranlariService, azamiOranlariAyikla, AzamiOran } from './butce-faiz-oranlari.service';

/**
 * TCMB azami kart faizi ayıklaması — SAF girdi, ağ YOK.
 *
 * Bu testin kıymeti şu: TCMB sayfası bir gün değişirse ayıklama sessizce yanlış
 * sayı üretmemeli, null dönmeli. Yanlış oran sahte "faiz değişti" bildirimi doğurur
 * ve kullanıcıyı kartlarını yanlış oranla güncellemeye çağırır — boş sonuçtan kötüdür.
 */

/** TCMB sayfasının gerçek biçimi: Excel'den yapıştırılmış, iç içe span'lı, &nbsp;'li */
const h = (metin: string) =>
  `<span style="font-size:14px;"><span style="color:#323a47"><span style="font-weight:700">&nbsp;${metin}&nbsp;</span></span></span>`;

const ETIKET_SATIRI = `
  <tr>
    <td class="xl78">${h('Azami Akdi Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Gecikme Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Akdi Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Gecikme Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Akdi Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Gecikme Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami&nbsp; Akdi Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Gecikme Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Akdi Faiz Oranı (%)')}</td>
    <td class="xl78">${h('Azami Gecikme Faiz Oranı (%)')}</td>
  </tr>`;

/** tarih | referans | (akdi,gecikme) × 5 */
const veriSatiri = (tarih: string, oranlar: string[]) =>
  `<tr><td class="xl80">${h(tarih)}</td>${oranlar.map((o) => `<td class="xl80">${h(o)}</td>`).join('')}</tr>`;

const TCMB_HTML = `
<div class="content">
<table dir="ltr" class="table" style="width:1000px;">
  <colgroup><col span="3" /></colgroup>
  <tbody>
    <tr>
      <td rowspan="6">${h('Geçerlilik Tarihi')}</td>
      <td rowspan="6">${h('Referans Oran (%)')}</td>
      <td colspan="8">${h('Türk Lirası')}</td>
      <td colspan="2">${h('Yabancı Para')}</td>
    </tr>
    <tr>
      <td colspan="8">${h('Kredi Kartı İşlemlerinde Uygulanacak')}</td>
      <td colspan="2" rowspan="4">${h('Kredi Kartı İşlemlerinde Uygulanacak')}</td>
    </tr>
    <tr>
      <td colspan="6">${h('Dönem Borcu')}</td>
      <td colspan="2" rowspan="3">${h('Nakit Çekim veya Kullanım İşlemlerinde Uygulanacak**')}</td>
    </tr>
    <tr>
      <td colspan="2">${h('30.000 TL altında')}</td>
      <td colspan="2">${h('30.000-180.000 TL arasında')}</td>
      <td colspan="2">${h('180.000 TL üzerinde*')}</td>
    </tr>
    <tr>
      <td colspan="6">${h('*Dönem borcuna bakılmaksızın kurumsal kredi kartları için de geçerlidir.')}</td>
    </tr>
    ${ETIKET_SATIRI}
    ${veriSatiri('1/9/2026', ['3,20', '3,40', '3,70', '3,90', '4,20', '4,40', '4,70', '4,40', '4,70', '3,05', '3,35'])}
    ${veriSatiri('1/8/2026', ['3,11', '3,25', '3,55', '3,75', '4,05', '4,25', '4,55', '4,25', '4,55', '2,98', '3,28'])}
    ${veriSatiri('1/7/2026', ['3,11', '3,25', '3,55', '3,75', '4,05', '4,25', '4,55', '4,25', '4,55', '2,98', '3,28'])}
    ${veriSatiri('1/6/2026', ['3,09', '3,20', '3,50', '3,70', '4,00', '4,20', '4,50', '4,20', '4,50', '2,90', '3,20'])}
  </tbody>
</table>
</div>`;

const AGUSTOS = new Date('2026-08-16T00:00:00.000Z');

describe('azamiOranlariAyikla — TCMB tablosu', () => {
  it('yürürlükteki satırdan ilk TL kademesinin akdi + gecikme oranını çıkarır', () => {
    const s = azamiOranlariAyikla(TCMB_HTML, AGUSTOS);
    expect(s).not.toBeNull();
    // "Referans Oran" (3,11) oran DEĞİLDİR; ilk akdi oranı 3,25 olmalı
    expect(s!.akdi).toBe(3.25);
    expect(s!.gecikme).toBe(3.55);
    expect(s!.gecerlilikTarihi).toBe('2026-08-01');
  });

  it('bütün kademeleri tablodaki sırayla verir (3 TL dilimi + nakit çekim + yabancı para)', () => {
    const s = azamiOranlariAyikla(TCMB_HTML, AGUSTOS)!;
    expect(s.kademeler).toEqual([
      { akdi: 3.25, gecikme: 3.55 },
      { akdi: 3.75, gecikme: 4.05 },
      { akdi: 4.25, gecikme: 4.55 },
      { akdi: 4.25, gecikme: 4.55 },
      { akdi: 2.98, gecikme: 3.28 },
    ]);
  });

  it('TCMB önceden yayımladığı GELECEK ayın satırını seçmez', () => {
    // Tabloda 1/9/2026 satırı var ama bugün 16 Ağustos — Eylül oranı henüz yürürlükte değil
    const s = azamiOranlariAyikla(TCMB_HTML, AGUSTOS)!;
    expect(s.gecerlilikTarihi).toBe('2026-08-01');
    // Eylül geldiğinde aynı HTML yeni satırı seçer
    const eylul = azamiOranlariAyikla(TCMB_HTML, new Date('2026-09-03T00:00:00.000Z'))!;
    expect(eylul.gecerlilikTarihi).toBe('2026-09-01');
    expect(eylul.akdi).toBe(3.4); // Eylül satırı: referans 3,20 → ilk TL kademesi 3,40 / 3,70
    expect(eylul.gecikme).toBe(3.7);
  });

  it('01.08.2026 biçimindeki tarihi de okur', () => {
    const html = TCMB_HTML.replace('1/8/2026', '01.08.2026').replace('1/9/2026', '01.09.2026');
    const s = azamiOranlariAyikla(html, AGUSTOS)!;
    expect(s.gecerlilikTarihi).toBe('2026-08-01');
    expect(s.akdi).toBe(3.25);
  });

  it('TCMB araya yeni bir dönem borcu dilimi eklerse kırılmaz', () => {
    // Sütun sayısına değil başlık etiketlerine dayandığı için 6. kademe eklenince de çalışır
    const html = TCMB_HTML.replace(
      ETIKET_SATIRI,
      ETIKET_SATIRI.replace(
        '</tr>',
        `<td>${h('Azami Akdi Faiz Oranı (%)')}</td><td>${h('Azami Gecikme Faiz Oranı (%)')}</td></tr>`,
      ),
    ).replace(
      veriSatiri('1/8/2026', ['3,11', '3,25', '3,55', '3,75', '4,05', '4,25', '4,55', '4,25', '4,55', '2,98', '3,28']),
      veriSatiri('1/8/2026', [
        '3,11', '3,25', '3,55', '3,75', '4,05', '4,25', '4,55', '4,25', '4,55', '2,98', '3,28', '5,00', '5,30',
      ]),
    );
    const s = azamiOranlariAyikla(html, AGUSTOS)!;
    expect(s.akdi).toBe(3.25);
    expect(s.kademeler).toHaveLength(6);
    expect(s.kademeler[5]).toEqual({ akdi: 5, gecikme: 5.3 });
  });

  it('başlıklar BÜYÜK HARFE dönerse yine eşleşir (Türkçe İ tuzağı)', () => {
    const html = TCMB_HTML.replace(/Azami Akdi Faiz Oranı/g, 'AZAMİ AKDİ FAİZ ORANI').replace(
      /Azami Gecikme Faiz Oranı/g,
      'AZAMİ GECİKME FAİZ ORANI',
    );
    const s = azamiOranlariAyikla(html, AGUSTOS);
    expect(s?.akdi).toBe(3.25);
  });
});

describe('azamiOranlariAyikla — bozuk girdide null', () => {
  it('boş / anlamsız girdide null döner', () => {
    expect(azamiOranlariAyikla('')).toBeNull();
    expect(azamiOranlariAyikla('<html><body><p>Sayfa bulunamadı</p></body></html>')).toBeNull();
  });

  it('tablo var ama Akdi/Gecikme başlığı yoksa null (sayfa yapısı değişmiş)', () => {
    const html = `<table><tbody>
      <tr><td>Yürürlük Tarihi</td><td>Reeskont Oranı (%)</td><td>Avans Oranı (%)</td></tr>
      <tr><td>01.01.2026</td><td>30,75</td><td>31,75</td></tr>
    </tbody></table>`;
    expect(azamiOranlariAyikla(html, AGUSTOS)).toBeNull();
  });

  it('başlık var ama altında tarihli veri satırı yoksa null', () => {
    const html = `<table><tbody>${ETIKET_SATIRI}
      <tr><td>Veri hazırlanıyor</td><td>-</td></tr>
    </tbody></table>`;
    expect(azamiOranlariAyikla(html, AGUSTOS)).toBeNull();
  });

  it('oranlar sayı değilse null döner (hücre biçimi bozulmuş)', () => {
    const html = `<table><tbody>${ETIKET_SATIRI}
      ${veriSatiri('1/8/2026', ['-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-'])}
    </tbody></table>`;
    expect(azamiOranlariAyikla(html, AGUSTOS)).toBeNull();
  });

  it('akla yatkın olmayan oranı (ör. %325) kabul etmez', () => {
    // Ondalık ayracı bozulup 3,25 → 325 olursa sessizce geçmemeli
    const html = `<table><tbody>${ETIKET_SATIRI}
      ${veriSatiri('1/8/2026', ['311', '325', '355', '375', '405', '425', '455', '425', '455', '298', '328'])}
    </tbody></table>`;
    expect(azamiOranlariAyikla(html, AGUSTOS)).toBeNull();
  });

  it('gecikme faizi akdi faizden düşükse o kademeyi elemeye alır', () => {
    // Sütunlar yer değiştirmiş gibi görünen satır — hepsi bozuksa null
    const html = `<table><tbody>${ETIKET_SATIRI}
      ${veriSatiri('1/8/2026', ['3,11', '3,55', '3,25', '4,05', '3,75', '4,55', '4,25', '4,55', '4,25', '3,28', '2,98'])}
    </tbody></table>`;
    expect(azamiOranlariAyikla(html, AGUSTOS)).toBeNull();
  });
});

describe('oranlariKarsilastir — farklı oranlı kartlar', () => {
  const svc = new ButceFaizOranlariService({} as any, {} as any);
  const azami: AzamiOran = {
    akdi: 3.25,
    gecikme: 3.55,
    kaynak: 'test',
    cekilmeTarihi: new Date(),
  };

  it('oranı azamiyle aynı olan kart listeye girmez', () => {
    const fark = svc.oranlariKarsilastir(
      [{ id: 'a', bankaAdi: 'X Bank', kartAdi: 'Bonus', aylikFaizOrani: 3.25, gecikmeFaizOrani: 3.55 }],
      azami,
    );
    expect(fark).toHaveLength(0);
  });

  it('Prisma Decimal (string) değerleri de doğru karşılaştırılır', () => {
    const fark = svc.oranlariKarsilastir(
      [{ id: 'a', aylikFaizOrani: '3.250', gecikmeFaizOrani: '3.550' }],
      azami,
    );
    expect(fark).toHaveLength(0);
  });

  it('azaminin ALTINDAKİ kart bildirilir ama tavan aşımı işaretlenmez', () => {
    const [f] = svc.oranlariKarsilastir(
      [{ id: 'b', bankaAdi: 'Y Bank', kartAdi: 'World', aylikFaizOrani: 2.9, gecikmeFaizOrani: 3.2 }],
      azami,
    );
    expect(f.ad).toBe('Y Bank World');
    expect(f.tavanUstunde).toBe(false);
    expect(f.azamiAkdi).toBe(3.25);
  });

  it('azaminin ÜSTÜNDEKİ kart tavan aşımı olarak işaretlenir', () => {
    const [f] = svc.oranlariKarsilastir(
      [{ id: 'c', aylikFaizOrani: 4.25, gecikmeFaizOrani: 4.75 }],
      azami,
    );
    expect(f.tavanUstunde).toBe(true);
  });

  it('azami çekilemediyse (null) hiçbir kartı işaretlemez', () => {
    expect(svc.oranlariKarsilastir([{ aylikFaizOrani: 4.25, gecikmeFaizOrani: 4.75 }], null)).toEqual([]);
  });
});
