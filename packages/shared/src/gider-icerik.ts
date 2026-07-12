/**
 * EVRENSEL İÇERİK → GİDER sınıflandırıcı (deterministik, AI'sız, tüm mükelleflerde ortak).
 *
 * Amaç: fatura kalem metninden gider TÜRÜNÜ ve bir "İSİM İPUCU" üretmek. İsim ipucu, mükellefin
 * GERÇEK hesap planındaki hesabın ADIYLA eşleşmek içindir (kod firmaya göre değişir: bir firmada
 * 740.01.002 "ARAÇ BAKIM", başkasında 770.10.005 "TAŞIT BAKIM" olabilir — ikisi de aynı isim ipucuyla
 * bulunur). Yani kural EVRENSELdir; kod her firmada kendi plan-adından çözülür.
 *
 * İki faydası:
 *  1) Tutarlılık + doğruluk: aynı içerik HER ZAMAN aynı kategoriye → AI'ın tutarsız/saçma kod ataması biter.
 *  2) Yanlış demirbaş engeli: içerik bir GİDER/HİZMET kuralına uyuyorsa (yedek parça, bakım, nakliye,
 *     akaryakıt, diagnostik…) bu bir SABİT KIYMET DEĞİLDİR → demirbaş tespiti yanlış-pozitif vermez.
 *
 * Kaynak desenler GVK40_ALT_KURAL (isletme-referans) ile aynı mantıkta; burada İŞLETME koduna değil
 * bilanço/genel için İSİM İPUCUNA eşlenir. Sıra önemlidir: SPESİFİK → GENEL, ilk eşleşen kazanır.
 */

export interface GiderIcerikSonuc {
  /** Mükellefin plan hesabının ADIYLA eşleşmek için isim ipucu (ör. "araç taşıt bakım onarım"). */
  hint: string;
  /** matrahKategori (KAT_PREFIX ile grup seçimi): genel_gider / pazarlama / hammadde / ticari_mal. */
  kategori: string;
  /** Bu içerik bir gider/hizmettir → sabit kıymet DEĞİL (demirbaş yanlış-pozitifini engeller). */
  demirbas: false;
}

// [regex, isim-ipucu, matrahKategori] — SIRA: spesifik → genel, ilk eşleşen kazanır.
// NOT: regex'ler icerikNorm SONRASI (ascii, küçük harf) metne uygulanır — Türkçe karakter YOK.
const ICERIK_KURAL: Array<[RegExp, string, string]> = [
  // ── ARAÇ / TAŞIT (spesifik — genel bakım/sigorta/kira'dan ÖNCE) ──
  // MADENİ/MOTOR YAĞI = araç bakım-işletme malzemesi, AKARYAKIT DEĞİL. Akaryakıt kuralından
  // ÖNCE yakala: satıcı akaryakıtçı (ör. ELİT PETROLCÜLÜK) olduğu için OCR/AI kalemi
  // giderTuru="akaryakıt" etiketlese bile "Motor Yağı" YAKIT sanılmasın (kullanıcı vakası:
  // 740.01.001 ARAÇ YAKIT'a gidiyordu; doğrusu ARAÇ BAKIM ONARIM — plan hesabı adıyla çözülür).
  [/motor yagi|madeni yag|\bmotor yag\b|sanziman yagi|vites yagi|hidrolik yag|dislibox yagi|\bgres\b|yag degisim|antifriz|\badblue\b/, 'araç taşıt bakım onarım', 'genel_gider'],
  [/akaryakit|motorin|\bbenzin\b|\bmazot\b|\bdizel\b|\blpg\b|\bopet\b|\bshell\b|aytemiz|petrol ofisi|\bpetrol\b|totalenergies|yakit gideri|\byakit\b/, 'akaryakıt yakıt taşıt', 'genel_gider'],
  // NOT: eski hâlinde \bfiltre\b / \biscilik\b / \bmuayene\b / teshis TEK BAŞINA eşleşiyordu —
  //   "FİLTRE KAHVE", "MONTAJ İŞÇİLİĞİ" (inşaat), doktor "muayene" ücreti yanlışlıkla araç-bakım
  //   sayılıp CLS-SKIP ile AI'ı da atlatıyordu → bağlam şartına bağlandı.
  [/oto servis|oto tamir|oto bakim|arac bakim|tasit bakim|arac tamir|tasit tamir|\blastik\b|yedek parca|oto yedek|\bbalata\b|oto elektrik|oto yikama|rot balans|rot ayari|balans ayari|sokme takma|oto cam|periyodik bakim|\bakumulator\b|oto lastik|motor yagi|fren balata|(yag|hava|polen|yakit|klima|kabin)\s*filtre|filtre\s*(degisim|bakim)|diagnostik|ariza teshis|agir vasita|(oto|arac|tasit|motor|kaporta|boya)\s*iscilik|arac muayene|tasit muayene|fenni muayene|tuvturk/, 'araç taşıt bakım onarım', 'genel_gider'],
  [/arac kira|oto kira|rent.?a.?car|filo kira|tasit kira|otomobil kira/, 'araç taşıt kiralama', 'genel_gider'],
  [/\bkasko\b|trafik sigorta|zorunlu trafik|arac sigorta|tasit sigorta|motorlu tasit sigorta/, 'araç taşıt sigorta kasko', 'genel_gider'],
  [/otopark|park ucret|\bvale\b|kapali otopark/, 'otopark', 'genel_gider'],
  [/\bhgs\b|\bogs\b|otoyol|gecis ucret|\bkgm\b|kopru gecis|otoyol gecis/, 'otoyol köprü geçiş', 'genel_gider'],
  [/motorlu tasitlar vergisi|\bmtv\b/, 'motorlu taşıtlar vergisi', 'genel_gider'],
  // ── ENERJİ / HABERLEŞME / İŞYERİ ──
  [/elektrik|enerjisa|\bbedas\b|\bayedas\b|\btedas\b|\buedas\b|enerji perakende|elektrik dagitim/, 'elektrik enerji', 'genel_gider'],
  [/dogalgaz|\bigdas\b|baskentgaz|\bizgaz\b|gaz dagitim|\bbursagaz\b/, 'doğalgaz gaz', 'genel_gider'],
  // NOT: eski hâlinde tek başına "su" kelimesi eşleşiyordu → "SU POMPASI/SU DEPOSU" İSKİ gideri
  //   sanılıyordu; artık kurum adı ya da fatura bağlamı şart (damacana/içme suyu ofis gideri sayılır).
  [/\biski\b|\baski\b|\bizsu\b|\bbuski\b|su ve kanalizasyon|su idaresi|su tuketim|su fatura|su bedeli|sebeke suyu|damacana|icme suyu/, 'su', 'genel_gider'],
  [/telefon|turkcell|vodafone|turk telekom|\bgsm\b|mobil hat/, 'telefon iletişim haberleşme', 'genel_gider'],
  [/internet|\bfaks\b|\bfiber\b|\bttnet\b|superonline|hosting|alan adi|\bdomain\b|web hosting/, 'internet haberleşme', 'genel_gider'],
  [/\baidat\b|site aidat|yonetim gideri|ortak gider|apartman aidat/, 'aidat ortak gider', 'genel_gider'],
  [/\bkira\b(?!lama)|kira gider|isyeri kira|dukkan kira|ofis kira|magaza kira|gayrimenkul kira/, 'kira', 'genel_gider'],
  // ── PROFESYONEL / DIŞARIDAN HİZMET ──
  [/muhasebe|mali musavir|\bsmmm\b|\bymm\b|\bmusavirlik\b|musavirlik hizmet|defter tutma/, 'müşavirlik muhasebe danışmanlık', 'genel_gider'],
  [/avukat|hukuk buro|hukuki danis|hukuk musavir|vekalet ucret|hukuk hizmet/, 'avukatlık hukuk danışmanlık', 'genel_gider'],
  [/danisman|\bdanismanlik\b|disaridan saglanan|\btaseron\b|\bfason\b|teknik destek|yazilim hizmet|bilisim hizmet/, 'danışmanlık dışarıdan hizmet', 'genel_gider'],
  // ── NAKLİYE / KARGO ──
  [/nakliye|tasimacilik|\bnavlun\b|lojistik|sevkiyat|tasima hizmet|tasima bedeli|nakliye bedeli/, 'nakliye taşıma', 'genel_gider'],
  [/\bkargo\b|\bptt\b|aras kargo|yurtici kargo|\bmng\b|surat kargo|\bups\b|\bdhl\b|fedex|\bposta\b/, 'kargo posta', 'pazarlama'],
  // ── DİĞER HİZMET ──
  [/ozel guvenlik|guvenlik hizmet|guvenlik personel|koruma hizmet|devriye hizmet/, 'güvenlik', 'genel_gider'],
  [/\bkomisyon\b/, 'komisyon', 'genel_gider'],
  [/google reklam|google ads|facebook reklam|meta reklam|internet reklam|dijital reklam|\breklam\b|\bilan\b|tanitim|billboard|\bafis\b|promosyon|pazarlama/, 'reklam ilan pazarlama tanıtım', 'pazarlama'],
  [/\bsigorta\b|\bdask\b|isyeri sigorta|yangin sigorta|\bpolice\b|\bpolicesi\b/, 'sigorta', 'genel_gider'],
  [/\bnoter\b/, 'noter', 'genel_gider'],
  [/banka masraf|banka komisyon|\beft\b|havale ucret|hesap isletim|\bbsmv\b|pos komisyon|kredi karti komisyon/, 'banka komisyon masraf', 'genel_gider'],
  [/is sagligi|is guvenligi|\bisg\b|\bosgb\b|isyeri hekim|ortak saglik guvenlik/, 'iş sağlığı güvenliği', 'genel_gider'],
  [/\babonelik\b|\buyelik\b|\bpremium\b|membership|platform hizmet|bulut hizmet|yazilim abonelik|lisans bedeli/, 'abonelik üyelik lisans', 'genel_gider'],
  // ── OFİS / SARF / GİYİM / GIDA ──
  [/kirtasiye|\btoner\b|kartus|fotokopi kagidi|yazici kagidi|\bdosya\b|\bklasor\b/, 'kırtasiye', 'genel_gider'],
  [/is guvenligi ayakkabi|koruyucu eldiven|reflektif yelek|ikaz yelegi|is elbisesi|koruyucu ekipman|\bbaret\b|is ayakkabi|koruyucu kiyafet/, 'iş güvenliği koruyucu giyim', 'genel_gider'],
  [/\bgiyim\b|kiyafet|uniforma|\bayakkabi\b|\btekstil\b|konfeksiyon|personel kiyafet/, 'giyim kıyafet', 'genel_gider'],
  [/temizlik|\bcay\b|\bkahve\b|deterjan|\bpecete\b|hijyen|kagit havlu|cop poseti|temizlik malzeme/, 'temizlik ofis', 'genel_gider'],
  [/is yemegi|\bagirlama\b|\btemsil\b|misafir ikram|toplanti ikram/, 'temsil ağırlama', 'genel_gider'],
  [/ambalaj|\bposet\b|\bstrec\b|\bkoli\b|tek kullanim|sarf malzeme|\bsarf\b|paketleme/, 'sarf malzeme ambalaj', 'genel_gider'],
  // ── KONAKLAMA / SEYAHAT ──
  [/konaklama|\botel\b|\bhotel\b|\bpansiyon\b/, 'konaklama', 'genel_gider'],
  [/seyahat|otobus bileti|ucak bileti|\bthy\b|pegasus|tren bileti|seyahat gider/, 'seyahat ulaşım', 'genel_gider'],
  // ── GENEL BAKIM / FİNANS (en sonda) ──
  [/bakim onarim|\bonarim\b|\btamir\b|servis bedeli|tadilat|tesisat onarim/, 'bakım onarım', 'genel_gider'],
  [/\bfaiz\b|finansman gider|kredi faiz|vade farki/, 'faiz finansman', 'genel_gider'],
];

function icerikNorm(s: any): string {
  // NFKD + birleşik-işaret temizliği: Türkçe "İ" toLowerCase'te "i" + U+0307 (birleşik nokta) olup
  //   regex'i bozuyordu (NAKLİYE -> "nakli̇ye" != "nakliye"). NFKD ş/ğ/ü/ö/ç'yi de taban+işarete
  //   ayırır, U+0300-U+036F işaretleri silinince hepsi ascii olur. ı (U+0131) decompose OLMAZ -> elle.
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
}

/**
 * Fatura içeriğini (kalem adları + giderTuru + satıcı ünvanı) deterministik gider kategorisine eşler.
 * Eşleşme yoksa null (zorlama yok → AI'a kalır). demirbas her zaman false: bir gider kuralına uyan
 * içerik sabit kıymet değildir (yanlış demirbaş tespitini engellemek için kullanılır).
 */
export function giderIcerikSinifla(text?: string | null): GiderIcerikSonuc | null {
  const t = icerikNorm(text);
  if (!t.trim()) return null;
  for (const [re, hint, kategori] of ICERIK_KURAL) {
    if (re.test(t)) return { hint, kategori, demirbas: false };
  }
  return null;
}
