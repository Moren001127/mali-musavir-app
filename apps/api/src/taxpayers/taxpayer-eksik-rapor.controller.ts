import { Controller, Headers, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantFromAgentToken } from '../common/agent-token';
import { TaxpayersService } from './taxpayers.service';

/**
 * MÜKELLEF EKSİK BİLGİ RAPORU — teşhis ucu.
 *
 * "Hangi mükellefin hangi bilgisi eksik" sorusunun tek çağrıda cevabı.
 * Portalda profil tamamlığı zaten hesaplanıyordu ama özet yalnız SAYI
 * döndürüyordu; hangi alanın boş olduğu ekran ekran gezmeden görülemiyordu.
 *
 * AYRI CONTROLLER: TaxpayersController sınıf düzeyinde JWT guard taşıyor;
 * bu uç yerel ajandan çağrılabilsin diye X-Agent-Token kullanıyor. Sınıf
 * guard'ı tek uç için delinemediğinden ayrı sınıf açıldı.
 *
 * SIKI MOD: ofis kısa adı (slug) yedeği kapalı — slug ofis adından türetiliyor
 * ve tahmin edilebilir. Bu uç mükellef adlarını döndürüyor.
 *
 * İÇERİK SINIRI: yalnız AD + EKSİK ALAN ADLARI döner. Telefon, e-posta, adres
 * gibi dolu değerler DÖNMEZ — rapor "neyi doldurmam gerek" içindir, rehber
 * dökümü değildir.
 */
@Controller('taxpayers-rapor')
export class TaxpayerEksikRaporController {
  constructor(
    private prisma: PrismaService,
    private taxpayers: TaxpayersService,
  ) {}

  @Post('eksik-bilgiler')
  async eksikBilgiler(@Headers('x-agent-token') token: string) {
    const tenantId = await resolveTenantFromAgentToken(token, this.prisma as any, { strict: true });
    const ozet: any = await this.taxpayers.getCompletenessSummary(tenantId);

    // Alan bazında ters kırılım: "bu alan kaç mükellefte eksik".
    // Hangi eksiğin yaygın olduğu, tek tek listeye bakarak anlaşılmıyordu.
    const alanSayaci = new Map<string, { alan: string; onem: string; adet: number }>();
    for (const t of ozet.taxpayers || []) {
      for (const e of t.eksikAlanlar || []) {
        const k = e.anahtar;
        const v = alanSayaci.get(k) || { alan: e.alan, onem: e.onem, adet: 0 };
        v.adet++;
        alanSayaci.set(k, v);
      }
    }

    return {
      toplamMukellef: ozet.total,
      ortalamaSkor: ozet.averageScore,
      dagilim: { tam: ozet.tam, iyi: ozet.iyi, eksik: ozet.eksik, kritikEksik: ozet.kritikEksik },
      alanBazinda: Array.from(alanSayaci.values()).sort((a, b) => b.adet - a.adet),
      mukellefler: (ozet.taxpayers || []).map((t: any) => ({
        ad: t.ad,
        skor: t.score,
        durum: t.durum,
        eksikler: (t.eksikAlanlar || []).map((e: any) => e.alan),
      })),
    };
  }
}
