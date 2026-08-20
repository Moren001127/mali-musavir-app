import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { tryDecrypt } from '../common/crypto';
import { gibFaturaPayload, GIB_ZORUNLU_ALANLAR, GIB_KALEM_ALANLARI } from './gib-earsiv-payload';

/**
 * GİB e-Arşiv Portalı'na TASLAK fatura gönderimi.
 *
 * GÜVENLİK SÖZÜ (kullanıcı kuralı: tek adımda resmî belge oluşmaz):
 *   • Burada YALNIZ TASLAK oluşturulur. Taslak resmî belge DEĞİLDİR, portaldan silinir,
 *     vergi doğurmaz, beyana girmez.
 *   • İMZALAMA / KESİNLEŞTİRME BU SERVİSTE YOKTUR. Ayrı adım, ayrı onay ve SMS kodu ister.
 *   • kuruTest=true ile GİB'e HİÇBİR ŞEY gönderilmez; yalnız gidecek veri döner.
 *
 * Sözleşme kaynağı: gib-earsiv-payload.ts (portalın kendi isteğinden yakalandı).
 */
const BASE = 'https://earsivportal.efatura.gov.tr/earsiv-services';

@Injectable()
export class FaturaKesGibService {
  private readonly logger = new Logger(FaturaKesGibService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async gibLogin(kod: string, sifre: string): Promise<string | null> {
    const body = new URLSearchParams();
    body.set('assoscmd', 'anologin');
    body.set('rtype', 'json');
    body.set('userid', kod);
    body.set('sifre', sifre);
    body.set('sifre2', sifre);
    body.set('parola', '1');
    const res = await fetch(`${BASE}/assos-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const j: any = await res.json().catch(() => null);
    return j?.token || null;
  }

  private async dispatch(token: string, cmd: string, pageName: string, jp: any) {
    const body = new URLSearchParams();
    body.set('callid', randomUUID());
    body.set('token', token);
    body.set('cmd', cmd);
    body.set('pageName', pageName);
    body.set('jp', JSON.stringify(jp));
    const res = await fetch(`${BASE}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: AbortSignal.timeout(40_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`GİB JSON döndürmedi: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  }

  /** Mükellefin GİB e-Arşiv (GIB_IVD) kimliğini çöz. */
  private async kimlik(tenantId: string, taxpayerId: string) {
    const row: any = await (this.prisma as any).portalCredential.findFirst({
      where: { tenantId, taxpayerId, provider: 'GIB_IVD', isActive: true },
      select: { userCode: true, username: true, encryptedPassword: true, encryptedSecondaryPassword: true },
    });
    if (!row) throw new BadRequestException('Bu mükellefin GİB e-Arşiv (İVD) kimliği tanımlı değil');
    const kod = row.userCode || row.username;
    // İki şifre alanı da denenir: bazı mükellefte e-Arşiv şifresi ikincil alanda tutuluyor.
    const sifreler = [tryDecrypt(row.encryptedSecondaryPassword), tryDecrypt(row.encryptedPassword)]
      .filter((s): s is string => !!s && s.length > 0);
    if (!kod || !sifreler.length) throw new BadRequestException('GİB kullanıcı kodu ya da şifresi eksik');
    return { kod: String(kod), sifreler };
  }

  /**
   * Taslağı GİB'e gönder (ya da kuru testte yalnız göstereceğini göster).
   * Sonuç: GİB'de TASLAK oluşur — resmî belge DEĞİL.
   */
  async gibeGonder(tenantId: string, draftId: string, opts: { kuruTest?: boolean } = {}) {
    const draft: any = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    if (draft.durum === 'KESILDI') throw new BadRequestException('Bu fatura zaten kesinleşmiş');
    if (draft.durum === 'IPTAL') throw new BadRequestException('İptal edilmiş taslak gönderilemez');
    if (draft.durum === 'GIB_TASLAK') {
      throw new BadRequestException('Bu taslak GİB’e zaten gönderilmiş — mükerrer taslak oluşmasın diye durduruldu');
    }

    const payload = gibFaturaPayload({
      aliciVkn: draft.aliciVkn,
      aliciUnvan: draft.aliciUnvan,
      aliciAdres: draft.aliciAdres,
      aliciVd: draft.aliciVd,
      aliciEposta: draft.aliciEposta,
      faturaTarihi: new Date(draft.faturaTarihi),
      aciklama: draft.aciklama,
      miktar: Number(draft.miktar),
      birim: draft.birim === 'ADET' ? 'C62' : draft.birim,
      matrah: Number(draft.matrah),
      kdvOrani: Number(draft.kdvOrani),
      kdvTutari: Number(draft.kdvTutari),
      toplam: Number(draft.toplam),
    });

    // SÖZLEŞME DENETİMİ: eksik alanla GİB'e gitmek anlamsız hata döndürür
    //   ("Bir hata meydana geldi") ve neyin yanlış olduğu ANLAŞILMAZ. Önce burada dur.
    const eksik = GIB_ZORUNLU_ALANLAR.filter((a) => !(a in payload));
    const kalem = (payload.malHizmetTable || [])[0] || {};
    const kalemEksik = GIB_KALEM_ALANLARI.filter((a) => !(a in kalem));
    if (eksik.length || kalemEksik.length) {
      throw new BadRequestException(
        `GİB veri sözleşmesi eksik — gönderilmedi. Eksik alan: ${[...eksik, ...kalemEksik.map((k) => 'kalem.' + k)].join(', ')}`,
      );
    }

    if (opts.kuruTest) {
      this.logger.log(`[FATURA-KES/KURU] ${draftId} · GİB'e GİDECEK veri hazırlandı, GÖNDERİLMEDİ`);
      return {
        kuruTest: true,
        gonderildi: false,
        cmd: 'EARSIV_PORTAL_FATURA_OLUSTUR',
        pageName: 'RG_BASITFATURA',
        alanSayisi: Object.keys(payload).length,
        payload,
      };
    }

    const { kod, sifreler } = await this.kimlik(tenantId, draft.taxpayerId);
    let token: string | null = null;
    for (const s of sifreler) {
      token = await this.gibLogin(kod, s).catch(() => null);
      if (token) break;
    }
    if (!token) throw new BadRequestException('GİB e-Arşiv girişi başarısız — kullanıcı kodu/şifre kontrol edilmeli');

    const sonuc: any = await this.dispatch(token, 'EARSIV_PORTAL_FATURA_OLUSTUR', 'RG_BASITFATURA', payload);
    const mesaj = typeof sonuc?.data === 'string' ? sonuc.data : '';
    // GİB başarıda belge numarasını metin içinde döndürür; hata metni de aynı alandan gelir.
    const basarisiz = !mesaj || /hata|ba[şs]ar[ıi]s[ıi]z|ge[çc]ersiz/i.test(mesaj);
    if (basarisiz) {
      await (this.prisma as any).salesInvoiceDraft.update({
        where: { id: draftId },
        data: { hata: `GİB reddetti: ${mesaj || JSON.stringify(sonuc).slice(0, 300)}` },
      });
      throw new BadRequestException(`GİB taslağı oluşturmadı: ${mesaj || 'yanıt boş'}`);
    }

    const belgeNo = (mesaj.match(/[A-Z]{3}\d{13}/) || [])[0] || null;
    await (this.prisma as any).salesInvoiceDraft.update({
      where: { id: draftId },
      data: { durum: 'GIB_TASLAK', faturaNo: belgeNo, hata: null },
    });
    this.logger.log(`[FATURA-KES/GIB] ${draftId} · GİB TASLAĞI oluşturuldu${belgeNo ? ' · ' + belgeNo : ''} (KESİNLEŞTİRİLMEDİ)`);
    return { kuruTest: false, gonderildi: true, durum: 'GIB_TASLAK', faturaNo: belgeNo, gibMesaj: mesaj.slice(0, 300) };
  }
}
