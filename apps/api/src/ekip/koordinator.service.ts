import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EkipKosuSonucu, EkipRunnerService } from './ekip-runner.service';
import { geceOzetSatiri } from '../fatura-muhasebelestirme/gece-cekim';
import { EkipAkisService } from './ekip-akis.service';

/**
 * KOORDİNATÖR (Ofis Müdürü) — PLAN/13-AJAN-KADROSU.md §3.1, §8-D.
 *
 * sabahOzeti(tenantId): koordinatör ajanını "bugünün ofis özeti" göreviyle koşturur
 * (araçlar: get_operation_briefing, list_taxpayers_monthly_status, get_tax_calendar,
 * get_beyanname_readiness_summary, get_collection_risk_summary, ekip_isler/ekip_pano)
 * ve raporu Muzaffer Bey’e WhatsApp ile gönderir.
 *
 * Cron 08:30 Europe/Istanbul; EKIP_SABAH_OZETI=on değilse ÇALIŞMAZ.
 * Muzaffer Bey’e gönderim kalıbı owner-briefing.cron.ts ile aynı: MOREN_OWNER_WHATSAPP_PHONES +
 * WhatsAppService.sendMessage(phone, text, tenantId, {quote:false}); tenant'ta WhatsApp
 * otomasyonu kapalıysa gönderilmez. Koşu her zaman KURU TEST (özet dışarı mesaj üretmez).
 */
@Injectable()
export class KoordinatorService {
  private readonly logger = new Logger('KoordinatorService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: EkipRunnerService,
    private readonly whatsapp: WhatsAppService,
    private readonly akis: EkipAkisService,
  ) {}

  private sahipNumaralari(): string[] {
    const raw = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '').trim();
    if (!raw) return [];
    return raw
      .split(',')
      .map((p) => {
        let d = String(p).replace(/[^\d]/g, '');
        if (d.startsWith('00')) d = d.slice(2);
        if (d.startsWith('0') && d.length === 11) d = '90' + d.slice(1);
        if (d.length === 10 && d.startsWith('5')) d = '90' + d;
        return d;
      })
      .filter(Boolean);
  }

  private sabahGorevi(geceSatiri: string, akisSatiri: string): string {
    const tarih = new Date().toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });
    return [
      `Bugün ${tarih}. Muzaffer Bey’e WhatsApp'tan gidecek "BUGÜNÜN OFİS ÖZETİ"ni hazırla.`,
      'Sırayla bak: get_operation_briefing → get_tax_calendar → get_beyanname_readiness_summary → get_collection_risk_summary → ekip_pano (son 3 dönem) → ekip_isler (son 20; kuru test / onay bekleyen).',
      // PLAN/16 §H: gece çekimi özeti sistemden hazır gelir (AuditLog GECE_CEKIM, son 24 saat) — araç çağrısı gerekmez.
      `Hazır veri (sistemden, araç çağırmadan aynen kullan): ${geceSatiri}. Bunu 🤖 EKİP başlığına tek madde olarak yaz.`,
      // PLAN/18: üç kutu (sürüyor / onayınızı bekleyen / sizden istenen / dün bitti / gecikti) sistemden hazır gelir.
      `Hazır veri (araç çağırmadan aynen kullan): ${akisSatiri}. 🤖 EKİP başlığını bu üç kutuyla yaz (sürüyor · onayınızı bekleyen · sizden istenen); geciken varsa tek satır "<mükellef · konu · kimde>". ekip_isler/ekip_onaylar'ı yalnız ayrıntı için çağır.`,
      'Sonra "Günaydın." ile başlayan, şu 5 başlığı bu sırayla taşıyan TEK mesaj yaz:',
      '📊 DURUM · ⚠️ RİSKLİ/ACİL · 📝 YAKLAŞAN SÜRELER · 🤖 EKİP (dün ne yaptı, onay bekleyen, gece çekimi) · ▶️ BUGÜN ÖNCELİK',
      'Her başlıkta en fazla üç madde, her madde TEK satır; toplam 1100 karakteri aşma. Çift yıldız ve markdown başlığı kullanma; • madde, Türk sayı biçimi.',
      'SADECE araç çıktısındaki ve hazır verideki rakamları kullan; toplama/yüzde HESAPLAMA, tarih UYDURMA. Veri yoksa "veri alınamadı" yaz (sıfır ile karıştırma).',
      'Araç adı ya da "çağırıyorum" gibi iç adım yazma. Mesaj metnini "RAPOR:" satırından SONRA ver.',
    ].join('\n');
  }

  /**
   * PLAN/16 §H: son 24 saatin GECE_CEKIM AuditLog kayıtlarından "gece çekimi: N belge geldi (X mükellef, Y hata)".
   * Kayıt yoksa / sorgu düşerse "çalışmadı" satırı — akış bozulmaz.
   */
  async geceCekimSatiri(tenantId: string): Promise<string> {
    try {
      const rows = await (this.prisma as any).auditLog.findMany({
        where: { tenantId, action: 'GECE_CEKIM', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        select: { newData: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return geceOzetSatiri((rows || []).map((r: any) => r?.newData));
    } catch (e: any) {
      this.logger.warn(`[Koordinator] ${tenantId}: gece çekimi kayıtları okunamadı: ${e?.message || e}`);
      return 'gece çekimi: veri alınamadı';
    }
  }

  /** Koordinatörü koştur ve Muzaffer Bey’e gönder. Dönen sonuç iş dosyasıyla aynıdır. */
  async sabahOzeti(tenantId: string, opts: { gonder?: boolean } = {}): Promise<EkipKosuSonucu & { gonderildi: number }> {
    const [geceSatiri, akisSatiri] = await Promise.all([this.geceCekimSatiri(tenantId), this.akis.ozetSatiri(tenantId)]);
    const sonuc = await this.runner.calistir({
      ajanId: 'koordinator',
      gorev: this.sabahGorevi(geceSatiri, akisSatiri),
      tenantId,
      userId: null,
      dryRun: true,
      kaynak: 'cron',
    });
    let gonderildi = 0;
    let metin = this.raporMetni(sonuc.rapor);
    // Ajan satırı atladıysa özetin sonuna sistem satırı olarak ekle (gece çekimi bilgisi hep gitsin).
    if (metin && !/gece çekimi/i.test(metin)) metin = `${metin}\n🌙 ${geceSatiri}`.slice(0, 3500);
    const gonder = opts.gonder !== false;
    if (gonder && metin && !sonuc.hata) {
      const aktif = await this.whatsapp.isAutomationActive(tenantId).catch(() => false);
      const numaralar = this.sahipNumaralari();
      if (!aktif) this.logger.warn(`[Koordinator] ${tenantId}: WhatsApp otomasyonu kapalı, sabah özeti gönderilmedi`);
      else if (!numaralar.length) this.logger.warn('[Koordinator] MOREN_OWNER_WHATSAPP_PHONES tanımlı değil, sabah özeti gönderilmedi');
      else {
        for (const tel of numaralar) {
          const ok = await this.whatsapp.sendMessage(tel, metin, tenantId, { quote: false }).catch((e: any) => {
            this.logger.warn(`[Koordinator] gönderim hatası ${tel}: ${e?.message || e}`);
            return false;
          });
          if (ok) gonderildi++;
        }
      }
    }
    return { ...sonuc, gonderildi };
  }

  /** Ajan cevabından Muzaffer Bey’e gidecek metni ayıkla: "RAPOR:" sonrası; ÖĞRENDİM/SORU satırları düşer. */
  private raporMetni(rapor: string): string {
    const t = String(rapor || '');
    const i = t.search(/RAPOR\s*:/i);
    const govde = (i >= 0 ? t.slice(i).replace(/^RAPOR\s*:\s*/i, '') : t)
      .split(/\r?\n/)
      .filter((s) => !/^\s*[-*•]?\s*(ÖĞRENDİM|SORU)\s*:/i.test(s))
      .join('\n')
      .trim();
    return govde.slice(0, 3500);
  }

  @Cron('0 30 8 * * *', { timeZone: 'Europe/Istanbul' })
  async sabahCron(): Promise<void> {
    if (String(process.env.EKIP_SABAH_OZETI || '').toLowerCase() !== 'on') return;
    let tenants: Array<{ id: string }> = [];
    try {
      tenants = await (this.prisma as any).tenant.findMany({ select: { id: true } });
    } catch (e: any) {
      this.logger.warn(`[Koordinator] tenant listesi alınamadı: ${e?.message || e}`);
      return;
    }
    for (const t of tenants) {
      try {
        const r = await this.sabahOzeti(t.id);
        this.logger.log(`[Koordinator] ${t.id} sabah özeti: iş ${r.isId}, ${r.gonderildi} numaraya gitti${r.hata ? `, hata: ${r.hata}` : ''}`);
      } catch (e: any) {
        this.logger.warn(`[Koordinator] ${t.id} sabah özeti hatası: ${e?.message || e}`);
      }
    }
  }
}
