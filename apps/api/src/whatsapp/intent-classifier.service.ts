import { Injectable } from '@nestjs/common';

export type WhatsAppIntent =
  | 'EVRAK_TESLIM'
  | 'BEYANNAME_ONAY_TALEBI'
  | 'ODEME_BILDIRIMI'
  | 'TARIH_TALEBI'
  | 'BILGI_SORUSU'
  | 'SIKAYET'
  | 'SELAMLAMA'
  | 'GENEL';

export interface ClassifiedWhatsAppIntent {
  intent: WhatsAppIntent;
  confidence: number;
}

@Injectable()
export class IntentClassifierService {
  private readonly replies: Record<WhatsAppIntent, string[]> = {
    SELAMLAMA: [
      'Merhaba, iyi gunler. Size nasil yardimci olabiliriz?',
      'Merhaba, buradayiz. Hangi konuda destek istersiniz?',
      'Merhaba, mesajinizi aldik. Size nasil yardimci olabiliriz?',
      'Iyi gunler, yardimci olmaya haziriz. Konuyu kisaca yazabilirsiniz.',
    ],
    EVRAK_TESLIM: [
      'Evrak bilginiz alindi, ilgili kayda eklendi.',
      'Teslim ettiginiz belge not edildi, ekip gerekli incelemeyi yapacak.',
      'Evrak mesajiniz kayda alindi; eksik ya da ek ihtiyac olursa size bilgi verilecek.',
      'Bilgi icin tesekkurler, belge sureci takibe alindi.',
    ],
    BEYANNAME_ONAY_TALEBI: [
      'Onay bilginiz alindi; son kontrol tamamlaninca size net bilgi verilecek.',
      'Notunuzu aldik, beyanname sureci mali musavir kontrolunden sonra ilerletilecek.',
      'Onayiniz kayda gecti; gerekli kontrol yapildiktan sonra bilgilendirme yapilacak.',
    ],
    ODEME_BILDIRIMI: [
      'Odeme bilginiz alindi, kayitlarla eslestirme yapilacak.',
      'Dekont/odeme notunuz kayda alindi; kontrol sonrasi sistemde islenecek.',
      'Bilgi icin tesekkurler, odeme kaydi incelenecek.',
      'Odeme bildiriminiz alindi; uyum kontrolu yapildiktan sonra bilgi verilecek.',
    ],
    TARIH_TALEBI: [
      'Notunuzu aldik, uygunluk durumuna gore size bilgi verilecek.',
      'Takvim notunuz kayda alindi; ofis uygunluguna gore donulecek.',
      'Mesajiniz alindi, randevu/ziyaret uygunlugu kontrol edilecek.',
    ],
    SIKAYET: [
      'Geri donus suresindeki aksaklik icin kusura bakmayin. Mali musaviriniz size oncelikle ulasacaktir.',
      'Mesajiniz bize ulasti, ofisimiz en kisa surede size donecek. Ilginiz icin tesekkur ederiz.',
      'Notunuzu aldik, mali musavirinize dogrudan iletildi.',
      'Siteminizi anliyoruz; konuyu oncelikli olarak ilgili kisiye aktardik.',
    ],
    BILGI_SORUSU: [],
    GENEL: [],
  };

  classify(text: string): ClassifiedWhatsAppIntent {
    const t = this.normalize(text);

    if (this.looksLikeComplaint(t)) {
      return { intent: 'SIKAYET', confidence: 0.9 };
    }
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

  cannedReply(intent: WhatsAppIntent, recentReplies: string[] = []): string | null {
    const options = this.replies[intent] || [];
    if (!options.length) return null;
    const recent = recentReplies.map((reply) => this.normalize(reply));
    const freshOptions = options.filter((option) => {
      const normalized = this.normalize(option);
      return !recent.some((reply) => reply.includes(normalized.slice(0, 48)));
    });
    const pool = freshOptions.length ? freshOptions : options;
    return pool[Math.floor(Math.random() * pool.length)] || pool[0] || null;
  }

  shouldCreateOfficeTask(intent: WhatsAppIntent): boolean {
    return ['EVRAK_TESLIM', 'BEYANNAME_ONAY_TALEBI', 'ODEME_BILDIRIMI', 'TARIH_TALEBI', 'SIKAYET'].includes(intent);
  }

  private looksLikeComplaint(t: string): boolean {
    if (/\b(ilgilen[a-z]*|geri donus yok|donmedi|kizgin|sinirli|cok bekledim|rica ediyorum|lutfen artik|yeter|neden|niye)\b/.test(t)) {
      return true;
    }
    if (/\b(neden|niye)\b/.test(t) && /\b(donmedi|donus|bekledim|ilgilen[a-z]*|olmadi|olmadiniz|cevap|yanit)\b/.test(t)) {
      return true;
    }
    if (/\bsoyler misin\b/.test(t) && /\bkadar\b/.test(t)) {
      return true;
    }
    return false;
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
