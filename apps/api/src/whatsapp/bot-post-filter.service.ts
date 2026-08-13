import { Injectable } from '@nestjs/common';

// "Moren AI" / "yapay zeka" gibi ifadeleri gizlemek için doğal karşılık.
// "ofisimiz" gramer bozuyordu ("ben yapay zeka" → "ben ofisimiz"); "ofisin dijital asistanı" doğru.
const OFFICE_FALLBACK = 'ofisin dijital asistanı';
// Binlik ayraçtan sonra kaçan boşluğu temizle: "26. 000" → "26.000", "249. 359" → "249.359".
const fixNumberSpacing = (s: string) => String(s || '').replace(/(\d)\.\s+(\d{3})(?=\D|$)/g, '$1.$2');
// Emoji/sembol SÜZ — mali müşavirlik için profesyonel/sade dursun (kullanıcı talimatı: "çok fazla
// emoji"). ₺, •, — gibi gerekli karakterler emoji aralıklarının DIŞINDA, korunur. Emoji + ardındaki
// tek boşluk birlikte silinir ("🧾 KDV" → "KDV").
// ARALIK DUZELTMESI: ▶ (U+25B6), ─ (U+2500), ℹ (U+2139) hicbir araliga girmiyordu.
// Desendeki [ \t]? bu isaretlerin ARDINDAKI BOSLUGU yiyordu ama isaretin kendisini
// silmiyordu → "▶YARIN ONCELIK" gibi kelimeye yapisik cikti. Canli dokumde ▶ gecen
// 68 giden mesajin 68'inde de bozuktu (24 Haziran - 12 Agustos, hala suruyordu).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2100}-\u{214F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2500}-\u{257F}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]️?[ \t]?/gu;
// Emoji yerine BOSLUK birakilir; sonra coklu bosluk sikistirilir. Bosa silince
// "🧾KDV" gibi girdilerde kelimeler birbirine yapisiyordu.
const stripEmojis = (s: string) => String(s || '')
  .replace(EMOJI_RE, ' ')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n[ \t]+/g, '\n')
  .trim();

// SIK YAZIM HATALARI — canli dokumde tekrar eden, kesin duzeltilebilir olanlar.
// "mukellefde" 7 mesajda 14 kez gecmis (dogrusu "mukellefte" 53 mesajda 144 kez).
const YAZIM_DUZELTMELERI: Array<[RegExp, string]> = [
  [/\bmükellefde\b/g, 'mükellefte'],
  [/\bMükellefde\b/g, 'Mükellefte'],
  [/\bbeyannameyleriniz/g, 'beyannameleriniz'],
  [/\bgayri müsellim\b/gi, 'gayri mükellef'],
  [/\bmüssellim\b/gi, 'mükellef'],
];
const yazimDuzelt = (s: string) => YAZIM_DUZELTMELERI.reduce((acc, [re, to]) => acc.replace(re, to), String(s || ''));

@Injectable()
export class WhatsAppBotPostFilterService {
  // İÇ ARAÇ-ÇAĞRI METNİ (tool-narration) — model bazen bir tool'u GERÇEKTEN
  // çağırmak yerine "get_xxx çağırıyorum" diye METİN olarak yazıyor. Bu iç adım
  // ASLA kullanıcıya gitmemeli (owner da mükellef de). Tek noktada burada kesilir.
  // 1) Araç adı / protokol token'ı — gerçek Türkçe metinde neredeyse hiç olmaz (kesin sinyal).
  private static readonly TOOL_TOKEN_RE =
    /\b(get|list|search|create|preview|compare|calculate|research|save|set|run|send|update|delete|fetch)_[a-z][a-z0-9_]{2,}\b|\((get|list|search|create|preview|compare|calculate|research|save|run|send|update|delete|fetch)[a-z]{4,}\)|tool_use|tool_result|<\/?function\b|<\/?antml|"name"\s*:\s*"[a-z_]+_[a-z_]+"/i;
  // 1b) Alt-çizgisiz/birleşik İngilizce araç adı (camelCase→küçük): getmybalance,
  //     getaccountingreference, getmykdv, listinvoices… Parantez/virgül şart değil.
  //     Bilinen araç-kelime parçalarıyla sınırlı → Türkçe "getir/getiriyorum" yakalanmaz.
  private static readonly TOOL_CONCAT_RE =
    /\b(get|list|create|preview|fetch|send|set|run|search|compare|calculate|research)(my|all)?(balance|bakiye|kdv|tax|account|reference|invoice|fatura|mizan|beyan|taxpayer|mukellef|profile|profil|document|belge|status|durum|payable|summary|ozet|work|open|recent|message|mesaj|deadline|calendar|takvim|firma|hafiza|payroll|bordro|sgk|collection|risk|operation|brief)[a-z]*\b/i;
  // 2) Çağrı/iç-eylem anlatımı — "X aracını/tool'unu/fonksiyonunu çağırıyorum/kullanıyorum"
  //    VEYA "...çağırıyorum:/çağıracağım:" diye kesik biten cevap (sızıntının tipik şekli).
  //    Tek başına "çağırıyorum" yakalanmaz (meşru "sizi çağırıyorum" yanlış-pozitif olmasın).
  private static readonly TOOL_NARRATION_RE =
    /(arac[ıi](n[ıi])?|tool['’]?u?(nu)?|fonksiyon(u|unu)?)\s*('?[ıi]?)?\s*(ça[ğg][ıi]r|kullan)|(ça[ğg][ıi]r[ıi]yorum|ça[ğg][ıi]raca[ğg][ıi]m)\s*:\s*$/i;

  private hasToolNarration(s: string): boolean {
    return WhatsAppBotPostFilterService.TOOL_TOKEN_RE.test(s)
      || WhatsAppBotPostFilterService.TOOL_CONCAT_RE.test(s)
      || WhatsAppBotPostFilterService.TOOL_NARRATION_RE.test(s);
  }

  // İÇ HATA / DEBUG JARGONU — model bazen aksiyon başarısız olunca ham hata
  // ayrıntısını (ok:false, previewId, "uyumlu agent bulunamadı", "API katmanı")
  // owner'a sızdırıyor. Meşru muhasebe cevabında bunlar ASLA geçmez → kesilir.
  // (Canlı kanıt 2026-06-15: owner'a "ok: false, previewId üretilmedi" + TCKN'li
  //  debugger çıktısı gitti.) Tek noktada burada süzülür.
  private static readonly INTERNAL_DEBUG_RE =
    /previewId|\bok\s*:\s*(false|true)\b|uyumlu\s+agent\s+bulunamad|aksiyonu?\s+i[çc]in\s+uyumlu|API\s+katman|\bca?l[ıi][şs]t[ıi]r[ıi]lamad[ıi]\b.*\bok\b|\bok\b.*previewId/i;

  private stripInternalDebug(text: string): string {
    if (!text || !WhatsAppBotPostFilterService.INTERNAL_DEBUG_RE.test(text)) return text;
    let out = text.split('\n').filter((ln) => !WhatsAppBotPostFilterService.INTERNAL_DEBUG_RE.test(ln)).join('\n');
    if (WhatsAppBotPostFilterService.INTERNAL_DEBUG_RE.test(out)) {
      out = out.split(/(?<=[.!?])\s+/).filter((sn) => !WhatsAppBotPostFilterService.INTERNAL_DEBUG_RE.test(sn)).join(' ');
    }
    return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  // Owner cevabına sızan teknik/AI-altyapı ARIZA itirafını kes: "timeout", "kuyruğa
  // aldım", "veri boş döndü", "portal araçlarını çalıştırırken", api/token/cache...
  // Bunlar müşavire yazılım dili gibi gidiyor (kural: teknik terim yok) → cümleyi ayıkla.
  private static readonly OWNER_TECH_LEAK_RE =
    /\btimeout\b|zaman\s*a[şs][ıi]m[ıi]|veri\s*bo[şs]|bo[şs]\s*d[öo]nm?[üu]?[şs]?|kuyru[ğg]a\s*(al|at)|araçlar[ıi]?n?[ıi]?\s*çal[ıi][şs]t[ıi]r|portal\s*araç|\bapi\b|\btoken\b|\bcache\b|backend|deploy|fonksiyon\s*ça[ğg]|\btool\b/i;

  private stripOwnerTechLeak(text: string): string {
    if (!text || !WhatsAppBotPostFilterService.OWNER_TECH_LEAK_RE.test(text)) return text;
    let out = text.split('\n').filter((ln) => !WhatsAppBotPostFilterService.OWNER_TECH_LEAK_RE.test(ln)).join('\n');
    if (WhatsAppBotPostFilterService.OWNER_TECH_LEAK_RE.test(out)) {
      out = out.split(/(?<=[.!?])\s+/).filter((sn) => !WhatsAppBotPostFilterService.OWNER_TECH_LEAK_RE.test(sn)).join(' ');
    }
    return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  /** Araç-anlatımı içeren satır/cümleleri ayıkla. Geriye sağlam, kullanıcıya
   *  gösterilebilir metin döner; her şey araç-anlatımıysa boş string döner. */
  private stripToolNarration(text: string): string {
    if (!text || !this.hasToolNarration(text)) return text;
    // Önce satır bazında (brifingler çok satırlı), sonra kalanı cümle bazında süpür.
    let out = text.split('\n').filter((ln) => !this.hasToolNarration(ln)).join('\n');
    if (this.hasToolNarration(out)) {
      out = out.split(/(?<=[.!?])\s+/).filter((sn) => !this.hasToolNarration(sn)).join(' ');
    }
    return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  // ── ESKALASYON SİNYALLERİ (controller deterministik ağı kullanır) ──
  // (1) AI-ALTYAPI terimi yanıta sızmış: müşteriye ASLA gitmemeli. Sızdıysa model iç
  //     hata anlatıyordur (Max/altyapı yanıt vermedi) → çıkmaz cevap yerine MÜŞAVİRE devret.
  private static readonly AI_INFRA_RE =
    /\bclaude\b|\banthropic\b|claude\s*max|\bmax\s+(aboneli|ba[ğg]lant|yan[ıi]t)|[üu]cretli\s*api|api\s*hatt[ıi]|api\s*katman|dil\s*modeli|\bllm\b|\bgpt\b|openai/i;

  // (2) İÇİ BOŞ "kontrol edeyim" savsaklaması: kısa + rakamsız + sadece-erteleme kalıbı.
  //     Gerçek veri/rakam içeren cevap ("borcunuz 28.750₺, detayını kontrol edeyim")
  //     TETİKLEMEZ (rakam var). Standart eskalasyon cümlesi de eşleşmez (kalıbı farklı).
  private static readonly STALL_RE =
    /(bir\s+)?kontrol\s+ed(ip|eyim)|bak[ıi]p\s+(size\s+)?d[öo]neyim|net\s+bilgiyle\s+d[öo]neyim|m[üu][şs]avir(imiz)?\s+(kesinle[şs]tir|netle[şs]tir|bakacak)/i;

  /** Yanıt müşteriye gitmemesi gereken AI-altyapı terimi içeriyor mu? (eskalasyon sinyali) */
  mentionsAiInfra(text: string): boolean {
    return WhatsAppBotPostFilterService.AI_INFRA_RE.test(String(text || ''));
  }

  /** Yanıt içi-boş "kontrol edeyim" savsaklaması mı? (kısa + rakamsız + erteleme kalıbı) */
  isContentFreeStall(text: string): boolean {
    const t = String(text || '').trim();
    if (!t || t.length > 100) return false; // uzun = içerikli, stall değil
    if (/\d/.test(t)) return false;          // rakam = gerçek veri/cevap var
    return WhatsAppBotPostFilterService.STALL_RE.test(t);
  }

  /**
   * OWNER KİMLİK GÜVENLİK AĞI: model owner'a yanlış isimle ("Buse") hitap ederse
   * (bilinen halüsinasyon) owner'ın gerçek adına çevir. Birincil çözüm calisan'daki
   * kısa-devre; bu, iş cevaplarına sızan artıkları yakalayan son katman.
   */
  private guardOwnerIdentity(text: string): string {
    const ownerFirst = String(process.env.MOREN_OWNER_DISPLAY_NAME || 'Muzaffer').trim().split(/\s+/)[0] || 'Muzaffer';
    return String(text || '').replace(/\bBuse\b/gi, ownerFirst);
  }

  filterTaxpayerReply(
    raw: string,
    options?: { recentReplies?: string[]; mode?: 'taxpayer' | 'owner' | 'unknown'; sablon?: boolean },
  ): string {
    let text = String(raw || '').trim();

    // SAVUNMA: dahili ESKALE işareti hiçbir koşulda müşteriye/owner'a SIZMASIN
    // (controller normalde temizler; bu son güvenlik katmanı).
    text = text.replace(/\[\[\s*ESKALE\s*\]\]/gi, '').trim();

    // Emoji süz (profesyonel/sade ton).
    text = yazimDuzelt(stripEmojis(text));

    // Owner (mali müşavir) raporları yapı ister: satır sonları, başlıklar, numaralar
    // KORUNMALI. Sohbet için tasarlanan agresif temizlik bunları eziyordu → ayrı yol.
    if (options?.mode === 'owner') {
      return this.formatOwnerReport(this.guardOwnerIdentity(yazimDuzelt(stripEmojis(text))));
    }

    // SABLON CEVAP (hizli-yol veri ozetleri: borc, KDV, vergi, beyanname). Bunlar
    // zaten bicimli ve DOGRULANMIS metin. Sohbet icin yazilmis agresif temizlik
    // (satir sonlarini bosluga cevirme, madde isaretini silme, cumle sayisini
    // kisitlama) tabloyu tek satira eziyordu — canli denemede beyanname listesi
    // okunamaz hale gelmisti. Sablonda sadece dahili sizinti temizligi yapilir.
    if (options?.sablon) {
      let t = this.stripInternalDebug(this.stripToolNarration(text));
      t = fixNumberSpacing(t);
      return t.trim() || 'Bir bakıp size döneyim.';
    }

    // 1. Code block + markdown formatting sil
    text = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/[*_`>#~]/g, '');

    // 2. AI iç-monolog / brifing prefix'lerini sil
    // Cümle başında "Anladım", "Görüyorum", "Müşteri X yapıyor" gibi meta-yorumları kes
    text = text
      .replace(/^\s*(Anlad[ıi]m|G[öo]r[üu]yorum|Tamam|Pekala|Pekâla|Hmm)[\s,:—–-]+/gi, '')
      .replace(/^\s*M[üu][şs]teri\s+[^.]*?(g[öo]nder|yaz|y[öo]nelt|selaml[aa][şs])[^.]*?\.\s*/gi, '')
      .replace(/^\s*Sistem\s+otomat[ıi]k[^.]*?\.\s*/gi, '')
      .replace(/(?:^|\n)\s*(Yap[ıi]lacak|Plan|Aksiyon|Strateji|Önemli not)[\s:]+/gi, '\n')
      .replace(/(?:^|\n)\s*Şimdilik\s*[:]?\s*/gi, '\n')
      .replace(/\bCevap\s*\(WhatsApp\)\s*[:]?\s*/gi, '')
      .replace(/\b(?:cevab[ıi]|yan[ıi]t[ıi])m\s*[:]?\s*/gi, '');

    // 3. Markdown listeler (1. 2. 3.) ve madde işaretleri
    text = text
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^\s*[-•]\s+/gm, '');

    // 4. Çift tırnaklı blokları açığa çıkar ("..." içeriğini bırak)
    text = text.replace(/^"([^"]+)"$/g, '$1');

    // 5. Yapay zeka kimliğini gizle (doğal dili BOZMADAN). Önceki sürüm "hemen"
    // gibi sıradan kelimeleri "kontrol sonrasi" ile değiştirip cümleyi robotik
    // yapıyordu — kaldırıldı. Aşırı taahhüt kontrolü artık prompt'ta.
    text = text
      .replace(/\bMoren AI\b/gi, OFFICE_FALLBACK)
      .replace(/\byapay zeka\b/gi, OFFICE_FALLBACK)
      .replace(/\bdil modeli\b/gi, OFFICE_FALLBACK)
      .replace(/\s+/g, ' ')
      .trim();
    text = fixNumberSpacing(text);

    // İç araç-çağrı metni (get_xxx çağırıyorum) kullanıcıya GİTMESİN.
    text = this.stripToolNarration(text);
    // İç hata/debug jargonu mükellefe de sızmasın.
    text = this.stripInternalDebug(text);
    if (!text) return 'Bunu bir kontrol edeyim, size net bilgiyle döneyim.';

    if (this.looksRisky(text)) {
      return 'Bunu bir kontrol edeyim, size net bilgiyle döneyim.';
    }

    // Owner raporlari yukarida formatOwnerReport ile donuyor; buraya sadece
    // taxpayer/unknown (sohbet) cevaplari gelir → kisa tut.
    text = this.avoidRepeatedPhrases(text, options?.recentReplies || []);
    text = this.limitSentences(text);

    const maxChars = Number(process.env.WHATSAPP_BOT_REPLY_MAX_CHARS || 480);
    if (text.length > maxChars) text = text.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
    // EN SON: sayı boşluğunu tekrar düzelt — limitSentences "26." + boşluğu cümle sınırı
    // sanıp ayırıp birleştirince "26. 000" geri gelebiliyordu; son adımda kesinleştir.
    text = fixNumberSpacing(text);
    return text || 'Bir bakıp size döneyim.';
  }

  /**
   * Owner mali durum/denetim raporları için biçimlendirme: satır sonlarını,
   * numaralı maddeleri KORUR; sadece WhatsApp'a uygun hale getirir.
   * (**kalın** → *kalın*, başlık/alıntı işaretlerini sade, AI kimliğini gizle.)
   */
  private formatOwnerReport(raw: string): string {
    let t = String(raw || '')
      .replace(/```[\s\S]*?```/g, '')        // kod blokları
      .replace(/\*\*([^*]+)\*\*/g, '*$1*')    // **kalın** → WhatsApp *kalın*
      .replace(/__([^_]+)__/g, '*$1*')
      .replace(/^#{1,6}\s*/gm, '')             // # başlık işaretleri
      .replace(/^\s*>\s?/gm, '')               // > alıntı işaretleri
      .replace(/\bMoren AI\b/gi, OFFICE_FALLBACK)
      .replace(/\byapay zeka\b/gi, OFFICE_FALLBACK)
      .replace(/\bdil modeli\b/gi, OFFICE_FALLBACK)
      .replace(/[^\S\n]+/g, ' ')               // yatay boşlukları sıkıştır (\n KORUNUR)
      .replace(/[ \t]+\n/g, '\n')              // satır sonu öncesi boşluk
      .replace(/\n{3,}/g, '\n\n')              // ardışık boş satırları 1'e indir
      .trim();
    t = fixNumberSpacing(t);

    // İç araç-çağrı metni (get_xxx çağırıyorum / "aracını çağırıyorum") owner'a da gitmesin.
    t = this.stripToolNarration(t);
    // İç hata/debug jargonu (ok:false, previewId, "uyumlu agent bulunamadı") sızmasın.
    t = this.stripInternalDebug(t);
    // Teknik/AI-altyapı arıza itirafı (timeout, kuyruğa aldım, veri boş döndü...) sızmasın.
    t = this.stripOwnerTechLeak(t);
    if (!t) return 'Bu işi şu an tamamlayamadım; birazdan tekrar deneyip net bilgiyle döneyim.';

    if (this.looksRisky(t)) {
      return 'Bunu bir kontrol edeyim, size net bilgiyle döneyim.';
    }
    const maxChars = Number(process.env.WHATSAPP_BOT_OWNER_MAX_CHARS || 3500);
    if (t.length > maxChars) t = t.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
    t = fixNumberSpacing(t); // EN SON: binlik ayraç boşluğunu kesinleştir
    return t || '—';
  }

  /**
   * GERÇEK sır SIZINTISI mı? Eskiden "parola/şifre/secret" KELİMESİ geçince tüm
   * cevap yutuluyordu → mükellef "şifremi unuttum, sıfırlar mısın" deyince bot
   * konuyla ilgili HER cevabı atıp jenerik dönüyordu (yanlış-pozitif). Artık
   * yalnız gerçek sır DEĞERİ (token/anahtar formatı veya "şifre: <değer>") yakalanır;
   * konunun adının geçmesi cevabı düşürmez.
   */
  private looksRisky(text: string): boolean {
    return (
      // OpenAI/Anthropic anahtar formatları (uzun rastgele dizi)
      /\bsk-(ant-)?[a-z0-9_-]{16,}\b/i.test(text) ||
      // "access token / api key / bearer / secret = <değer>" (değer varsa sızıntı)
      /\b(access[_\s]?token|api[_\s]?key|bearer|client[_\s]?secret|secret[_\s]?key)\b\s*[:=]\s*\S{3,}/i.test(text) ||
      // "şifre/parola/password : <gerçek değer>" (yalın kelime DEĞİL, ardından değer)
      /\b(parola|[şs]ifre|password)\b\s*[:=]\s*\S{4,}/i.test(text)
    );
  }

  private avoidRepeatedPhrases(text: string, recentReplies: string[]): string {
    if (!recentReplies.length) return text;
    const recent = this.normalize(recentReplies.join(' '));
    let next = text;

    const replacements: Array<{ marker: RegExp; repeated: RegExp; variants: string[] }> = [
      {
        marker: /ofis(e|imiz(e)?)?\s+iletildi/i,
        repeated: /ofis(e|imiz(e)?)?\s+iletildi|ofise dustu|ofise düştü/i,
        variants: ['ilgili kayda eklendi', 'ekibimizin takibine alindi', 'notunuz kayda alindi'],
      },
      {
        marker: /kontrol\s+(edilecek|edilip|sonrasi|sonrası)/i,
        repeated: /kontrol\s+(edilecek|edilip|sonrasi|sonrası)|kontrolunden|kontrolünden/i,
        variants: ['incelenecek', 'kayitlarla eslestirilecek', 'uygunluk durumuna bakilacak'],
      },
      {
        marker: /donus\s+yap(ilacak|acak|acagiz)|dönüş\s+yap(ılacak|acak|acağız)/i,
        repeated: /donus\s+yap|dönüş\s+yap/i,
        variants: ['size bilgi verilecek', 'bilgilendirme yapilacak', 'sonuc paylasilacak'],
      },
    ];

    for (const item of replacements) {
      if (!item.marker.test(next) || !item.repeated.test(recent)) continue;
      next = next.replace(item.marker, this.pick(item.variants));
    }

    return next.replace(/\s+/g, ' ').trim();
  }

  private limitSentences(text: string): string {
    // KRİTİK: "5.000" / "22.05.2026" gibi sayı/tarih içindeki noktayı cümle sonu SAYMA —
    // yoksa cevap sayının ortasından kesilir ("...tarihinde 5." gibi) ve boşluk eklenir.
    // Gerçek cümle sonu = noktalama + (boşluk/metin sonu); sayı içindeki noktanın ardında
    // RAKAM gelir, boşluk değil → bölünmez, kesilmez.
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (sentences.length <= 3) return text;
    return sentences.slice(0, 3).join(' ').trim();
  }

  private pick(options: string[]): string {
    return options[Math.floor(Math.random() * options.length)] || options[0] || '';
  }

  private normalize(raw: string): string {
    return String(raw || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/Ä±/g, 'i')
      .replace(/ÄŸ/g, 'g')
      .replace(/Ã¼/g, 'u')
      .replace(/ÅŸ/g, 's')
      .replace(/Ã¶/g, 'o')
      .replace(/Ã§/g, 'c')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }
}
