import { Injectable } from '@nestjs/common';

// "Moren AI" / "yapay zeka" gibi ifadeleri gizlemek için doğal karşılık.
const OFFICE_FALLBACK = 'ofisimiz';

@Injectable()
export class WhatsAppBotPostFilterService {
  filterTaxpayerReply(raw: string, options?: { recentReplies?: string[]; mode?: 'taxpayer' | 'owner' | 'unknown' }): string {
    let text = String(raw || '').trim();

    // Owner (mali müşavir) raporları yapı ister: satır sonları, başlıklar, numaralar
    // KORUNMALI. Sohbet için tasarlanan agresif temizlik bunları eziyordu → ayrı yol.
    if (options?.mode === 'owner') {
      return this.formatOwnerReport(text);
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

    if (this.looksRisky(text)) {
      return 'Bunu bir kontrol edeyim, size net bilgiyle döneyim.';
    }

    // Owner raporlari yukarida formatOwnerReport ile donuyor; buraya sadece
    // taxpayer/unknown (sohbet) cevaplari gelir → kisa tut.
    text = this.avoidRepeatedPhrases(text, options?.recentReplies || []);
    text = this.limitSentences(text);

    const maxChars = Number(process.env.WHATSAPP_BOT_REPLY_MAX_CHARS || 480);
    if (text.length > maxChars) text = text.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
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

    if (this.looksRisky(t)) {
      return 'Bunu bir kontrol edeyim, size net bilgiyle döneyim.';
    }
    const maxChars = Number(process.env.WHATSAPP_BOT_OWNER_MAX_CHARS || 3500);
    if (t.length > maxChars) t = t.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
    return t || '—';
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
