import { Injectable } from '@nestjs/common';

export type WhatsAppIntent =
  | 'EVRAK_TESLIM'
  | 'BEYANNAME_ONAY_TALEBI'
  | 'ODEME_BILDIRIMI'
  | 'TARIH_TALEBI'
  | 'BILGI_SORUSU'
  | 'SELAMLAMA'
  | 'GENEL';

export interface ClassifiedWhatsAppIntent {
  intent: WhatsAppIntent;
  confidence: number;
}

@Injectable()
export class IntentClassifierService {
  classify(text: string): ClassifiedWhatsAppIntent {
    const t = this.normalize(text);

    if (/\b(merhaba|selam|iyi gunler|gunaydin|kolay gelsin|nasilsiniz|naber)\b/.test(t)) {
      return { intent: 'SELAMLAMA', confidence: 0.9 };
    }
    if (/\b(beyanname|beyan|tahakkuk)\b/.test(t) && /\b(onayliyorum|onayladim|imzaladim|gonderebilirsin|gonder|ver)\b/.test(t)) {
      return { intent: 'BEYANNAME_ONAY_TALEBI', confidence: 0.92 };
    }
    if (/\b(odedim|odeme yaptim|havale|eft|dekont|makbuz)\b/.test(t)) {
      return { intent: 'ODEME_BILDIRIMI', confidence: 0.9 };
    }
    if (/\b(evrak|belge|fis|fatura|dosya)\b/.test(t) && /\b(gonderdim|yolladim|attim|ilettim|kargo|biraktim|teslim)\b/.test(t)) {
      return { intent: 'EVRAK_TESLIM', confidence: 0.9 };
    }
    if (/\b(bugun|yarin|carsamba|persembe|cuma|pazartesi|sali|saat|gelecegim|ugrayacagim|uygun musunuz|randevu)\b/.test(t)) {
      return { intent: 'TARIH_TALEBI', confidence: 0.82 };
    }
    if (/\b(kdv|borc|borcu|ne kadar|beyanname hazir|hazir mi|odeme tarihi|son gun|hangi evrak|eksik|durum|bakiye)\b/.test(t)) {
      return { intent: 'BILGI_SORUSU', confidence: 0.8 };
    }

    return { intent: 'GENEL', confidence: 0.5 };
  }

  cannedReply(intent: WhatsAppIntent): string | null {
    switch (intent) {
      case 'SELAMLAMA':
        return 'Merhaba, iyi gunler. Size nasil yardimci olabiliriz?';
      case 'EVRAK_TESLIM':
        return 'Bilginiz ofise dustu. Evraklariniz kontrol edildikten sonra size donus yapilacak.';
      case 'BEYANNAME_ONAY_TALEBI':
        return 'Onayinizi aldik. Mali musavirimiz son kontrolu yaptiktan sonra size net bilgi verecek.';
      case 'ODEME_BILDIRIMI':
        return 'Odeme/dekont bilginiz ofise iletildi. Kontrol sonrasi kayitlara islenecek.';
      case 'TARIH_TALEBI':
        return 'Notunuzu aldik. Ofis takvimine gore kontrol edilip size donus yapilacak.';
      default:
        return null;
    }
  }

  shouldCreateOfficeTask(intent: WhatsAppIntent): boolean {
    return ['EVRAK_TESLIM', 'BEYANNAME_ONAY_TALEBI', 'ODEME_BILDIRIMI', 'TARIH_TALEBI'].includes(intent);
  }

  private normalize(raw: string): string {
    return String(raw || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
