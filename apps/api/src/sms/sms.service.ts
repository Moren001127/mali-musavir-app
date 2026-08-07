import { Injectable, Logger } from '@nestjs/common';

export interface SmsResult {
  sent: boolean;
  jobId?: string;
  code?: string;
  error?: string;
}

/**
 * NetGSM SMS gönderimi (başlık: MOREN). Yapılandırma env üzerinden:
 *   NETGSM_USERCODE, NETGSM_PASSWORD, NETGSM_HEADER (varsayılan "MOREN").
 * NetGSM HTTP API: GET https://api.netgsm.com.tr/sms/send/get
 *   (usercode, password, gsmno, message, msgheader, dil=TR).
 * Yanıt: "00 <bulkid>" başarı; aksi hata kodu (20/30/40/50/70/80/85...).
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  isConfigured(): boolean {
    return Boolean(process.env.NETGSM_USERCODE && process.env.NETGSM_PASSWORD);
  }

  /** Telefonu NetGSM biçimine indir: 5XXXXXXXXX (baştaki 0/90/+90 temizlenir). */
  private normalizeGsm(raw: string): string {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('90')) d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    return d;
  }

  async sendSms(to: string, message: string, opts?: { header?: string }): Promise<SmsResult> {
    const usercode = process.env.NETGSM_USERCODE;
    const password = process.env.NETGSM_PASSWORD;
    const header = (opts?.header || process.env.NETGSM_HEADER || 'MOREN').trim();
    if (!usercode || !password) {
      return { sent: false, error: 'NetGSM yapılandırılmamış (NETGSM_USERCODE / NETGSM_PASSWORD env gerekli)' };
    }
    const gsm = this.normalizeGsm(to);
    const msg = String(message || '').trim();
    if (gsm.length < 10) return { sent: false, error: `Geçersiz telefon numarası: ${to}` };
    if (!msg) return { sent: false, error: 'Mesaj boş' };

    const params = new URLSearchParams({
      usercode, password, gsmno: gsm, message: msg, msgheader: header, dil: 'TR',
    });
    try {
      const res = await fetch('https://api.netgsm.com.tr/sms/send/get?' + params.toString(), { method: 'GET' });
      const txt = (await res.text()).trim();
      const code = txt.split(/\s+/)[0];
      // 00 = başarı (bulkid ile), 01/02 bazı sürümlerde de başarı sayılır.
      if (code === '00' || code === '01' || code === '02') {
        return { sent: true, code, jobId: txt.split(/\s+/)[1] || undefined };
      }
      this.logger.warn(`NetGSM SMS başarısız (${gsm}): ${txt.slice(0, 120)}`);
      return { sent: false, code, error: this.explainCode(code, txt) };
    } catch (e: any) {
      this.logger.warn(`NetGSM SMS gönderilemedi (${gsm}): ${e?.message || e}`);
      return { sent: false, error: e?.message || 'NetGSM bağlantı hatası' };
    }
  }

  private explainCode(code: string, raw: string): string {
    const map: Record<string, string> = {
      '20': 'Mesaj metni/karakter hatası ya da standart maksimum aşıldı',
      '30': 'Geçersiz kullanıcı adı/şifre ya da API erişim izni yok (IP)',
      '40': 'Mesaj başlığı (msgheader) sistemde tanımlı değil (MOREN başlığını NetGSM panelinde onaylatın)',
      '50': 'Alıcı İYS onaylı değil (ticari SMS)',
      '51': 'Aboneliğinize tanımlı gönderici adı bulunamadı',
      '70': 'Parametre hatası (eksik/yanlış alan)',
      '80': 'Gönderim sınır aşımı',
      '85': 'Mükerrer gönderim sınırı (aynı numaraya 1 dk içinde 20+)',
    };
    return map[code] ? `NetGSM: ${map[code]} (kod ${code})` : `NetGSM hata: ${raw.slice(0, 120)}`;
  }
}
