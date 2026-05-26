import { Injectable } from '@nestjs/common';

@Injectable()
export class WhatsAppBotPostFilterService {
  filterTaxpayerReply(raw: string): string {
    let text = String(raw || '').trim();
    text = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[*_`>#]/g, '')
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

    const maxChars = Number(process.env.WHATSAPP_BOT_REPLY_MAX_CHARS || 900);
    if (text.length > maxChars) text = text.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
    return text || 'Notunuzu aldik. Ofis kontrolunden sonra size donus yapilacak.';
  }

  private looksRisky(text: string): boolean {
    return /access token|api key|password|parola|sifre|secret/i.test(text);
  }
}
