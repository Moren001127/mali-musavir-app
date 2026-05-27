import { Injectable } from '@nestjs/common';

@Injectable()
export class WhatsAppBotPostFilterService {
  filterTaxpayerReply(raw: string, options?: { recentReplies?: string[]; mode?: 'taxpayer' | 'owner' | 'unknown' }): string {
    let text = String(raw || '').trim();

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

    // 5. Klasik düzeltmeler
    text = text
      .replace(/\bMoren AI\b/gi, 'ofisimiz')
      .replace(/\byapay zeka\b/gi, 'ofisimiz')
      .replace(/\bhemen\b/gi, 'kontrol sonrasi')
      .replace(/\bbugun kesin\b/gi, 'kontrol sonrasi')
      .replace(/\byarin kesin\b/gi, 'kontrol sonrasi')
      .replace(/\s+/g, ' ')
      .trim();

    if (this.looksRisky(text)) {
      return 'Notunuzu aldik. Kayitlariniz ofis tarafindan kontrol edilip size net bilgi verilecek.';
    }

    text = this.avoidRepeatedPhrases(text, options?.recentReplies || []);
    // Owner mali musavir uzun teknik cevap alir; ayrica '17.000 TL' gibi sayilarda
    // nokta cumle bitisi sanildigi icin limitSentences cevaplari yanlislikla kesiyordu.
    // Sadece taxpayer/unknown mode'larinda kisitla.
    if (options?.mode !== 'owner') {
      text = this.limitSentences(text);
    }

    // Owner'a daha uzun cevap izni (mevzuat tarifesi vs.), digerlerine kisa.
    const defaultMax = options?.mode === 'owner' ? 1300 : 480;
    const maxChars = Number(process.env.WHATSAPP_BOT_REPLY_MAX_CHARS || defaultMax);
    if (text.length > maxChars) text = text.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
    return text || 'Mesajinizi aldik; ilgili kayda ekledik.';
  }

  private looksRisky(text: string): boolean {
    return /access token|api key|password|parola|sifre|secret/i.test(text);
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
    const sentences = text.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) || [];
    if (sentences.length <= 2) return text;
    return sentences.slice(0, 2).join(' ').trim();
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
