import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EkipKosuSonucu, EkipRunnerService } from './ekip-runner.service';
import { geceOzetSatiri } from '../fatura-muhasebelestirme/gece-cekim';
import { EkipAkisService } from './ekip-akis.service';
import { MODEL_KIMLIKLERI, ajanBul } from './ajan-tanimlari';
import { ogrenmeSatirlariniSuz } from '../moren-ai/ses-koordinator';
import { EkipKotaService } from './ekip-kota.service';

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
 *
 * PLAN/19 H1 (2026-09-14): cron TÜM kiracıları dolaşmaz — MOREN_OWNER_TENANT_ID varsa yalnız o; yoksa mükellefi olmayan
 * kiracılar atlanır. Gönderim istenen koşuda WhatsApp kapalıysa / sahip numarası yoksa koşu HİÇ başlamaz (Max kotası
 * boşa gitmesin); portaldan "Şimdi üret" (gonder:false) bu kapıdan geçmez.
 */
@Injectable()
export class KoordinatorService {
  private readonly logger = new Logger('KoordinatorService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: EkipRunnerService,
    private readonly whatsapp: WhatsAppService,
    private readonly akis: EkipAkisService,
    @Optional() private readonly kota?: EkipKotaService,
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
      // PLAN/19 H2-a (2026-09-14): özetin kendisi "onay bekleyen" kaydı olarak açılıyordu (sahte onay maddesi).
      "Bu özeti Muzaffer Bey'e WhatsApp'tan SİSTEM gönderir; sen göndermezsin ve onay kaydı AÇMAZSIN (create_pending_action çağırma, 'Onayınızı bekleyen' satırına bu özeti yazma; gerçekten onay isteyen başka bir iş yoksa 'yok' yaz).",
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

  /**
   * Gönderim istenen koşu için ön kontrol (PLAN/19 H1-c): WhatsApp otomasyonu kapalıysa ya da sahip numarası yoksa
   * koşu boşuna başlamasın. Engel varsa insan dilinde neden, yoksa null.
   */
  private async gonderimEngeli(tenantId: string): Promise<string | null> {
    const aktif = await this.whatsapp.isAutomationActive(tenantId).catch(() => false);
    if (!aktif) return 'WhatsApp otomasyonu kapalı; sabah özeti üretilmedi, gönderilmedi';
    if (!this.sahipNumaralari().length) return 'MOREN_OWNER_WHATSAPP_PHONES tanımlı değil; sabah özeti üretilmedi, gönderilmedi';
    return null;
  }

  /** Koşu başlamadan dönülen boş sonuç (atlandı) — portal kartı `hata` alanını gösterir, cron `atlandi` ile ayırt eder. */
  private atlanmisSonuc(neden: string): EkipKosuSonucu & { gonderildi: number; atlandi: string } {
    return {
      isId: '',
      ajanId: 'koordinator',
      rapor: '',
      toolUses: [],
      kuruTestYapilacaktilar: [],
      onayBekleyen: [],
      ogrenilen: [],
      model: MODEL_KIMLIKLERI[ajanBul('koordinator')?.model || 'sonnet'],
      durationMs: 0,
      costUsd: 0,
      hata: neden,
      gonderildi: 0,
      atlandi: neden,
    };
  }

  /**
   * Koordinatörü koştur ve Muzaffer Bey’e gönder. Dönen sonuç iş dosyasıyla aynıdır.
   * gonder istenen çağrıda (varsayılan) WhatsApp kapalı / numara yoksa koşu HİÇ başlamaz, `atlandi` dolu döner (PLAN/19 H1-c);
   * gonder:false (portal "Şimdi üret") bu kontrolden geçmez, yalnız üretir.
   */
  async sabahOzeti(tenantId: string, opts: { gonder?: boolean } = {}): Promise<EkipKosuSonucu & { gonderildi: number; atlandi?: string }> {
    const gonder = opts.gonder !== false;
    if (gonder) {
      const engel = await this.gonderimEngeli(tenantId);
      if (engel) {
        this.logger.warn(`[Koordinator] ${tenantId} atlandı: ${engel}`);
        return this.atlanmisSonuc(engel);
      }
    }
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
    if (gonder && metin && !sonuc.hata) {
      // Ön kontrol geçti; koşu sırasında kapanmışsa sendMessage kendi içinde yine göndermez (false döner).
      for (const tel of this.sahipNumaralari()) {
        const ok = await this.whatsapp.sendMessage(tel, metin, tenantId, { quote: false }).catch((e: any) => {
          this.logger.warn(`[Koordinator] gönderim hatası ${tel}: ${e?.message || e}`);
          return false;
        });
        if (ok) gonderildi++;
      }
      if (!gonderildi) this.logger.warn(`[Koordinator] ${tenantId}: sabah özeti hiçbir numaraya gitmedi`);
    }
    return { ...sonuc, gonderildi };
  }

  /**
   * Ajan cevabından Muzaffer Bey’e gidecek metni ayıkla: "RAPOR:" sonrası; ÖĞRENDİM / Öğrendiklerim (kalın, madde imli,
   * başlık+alt madde biçimleri dahil — ogrenmeSatirlariniSuz, PLAN/19 H2-c) ve SORU satırları düşer.
   */
  private raporMetni(rapor: string): string {
    const t = String(rapor || '');
    const i = t.search(/RAPOR\s*[*_`]*:/i);
    const satirlar = (i >= 0 ? t.slice(i).replace(/^RAPOR\s*[*_`]*:\s*[*_`]*\s*/i, '') : t).split(/\r?\n/);
    const govde = ogrenmeSatirlariniSuz(satirlar)
      .filter((s) => !/^\s*[-*•]?\s*[*_`]*SORU\s*[*_`]*\s*:/i.test(s))
      .join('\n')
      .trim();
    return govde.slice(0, 3500);
  }

  /**
   * Sabah özeti hangi kiracılar için koşar (PLAN/19 H1-a/b):
   *  - MOREN_OWNER_TENANT_ID tanımlıysa yalnız o (DB'de yoksa uyarı, boş liste);
   *  - değilse mükellef sayısı 0 olan kiracılar atlanır (log: "<tenant> atlandı: mükellef yok").
   */
  private async sabahKiracilari(): Promise<Array<{ id: string }>> {
    const sahipKiracisi = String(process.env.MOREN_OWNER_TENANT_ID || '').trim();
    if (sahipKiracisi) {
      const t = await (this.prisma as any).tenant.findUnique({ where: { id: sahipKiracisi }, select: { id: true } }).catch(() => null);
      if (!t) {
        this.logger.warn(`[Koordinator] ${sahipKiracisi} atlandı: MOREN_OWNER_TENANT_ID DB'de bulunamadı`);
        return [];
      }
      return [{ id: t.id }];
    }
    const rows: Array<{ id: string; _count?: { taxpayers?: number } }> = await (this.prisma as any).tenant.findMany({
      select: { id: true, _count: { select: { taxpayers: true } } },
    });
    const out: Array<{ id: string }> = [];
    for (const r of rows || []) {
      if (!(Number(r?._count?.taxpayers) > 0)) {
        this.logger.log(`[Koordinator] ${r.id} atlandı: mükellef yok`);
        continue;
      }
      out.push({ id: r.id });
    }
    return out;
  }

  @Cron('0 30 8 * * *', { timeZone: 'Europe/Istanbul' })
  async sabahCron(): Promise<void> {
    if (String(process.env.EKIP_SABAH_OZETI || '').toLowerCase() !== 'on') return;
    if (this.kota && !this.kota.acikMi()) return this.logger.warn('[Koordinator] Max kotası dolu; sabah özeti atlandı (PLAN/20 kota bekçisi)');
    let tenants: Array<{ id: string }> = [];
    try {
      tenants = await this.sabahKiracilari();
    } catch (e: any) {
      this.logger.warn(`[Koordinator] tenant listesi alınamadı: ${e?.message || e}`);
      return;
    }
    for (const t of tenants) {
      try {
        const r = await this.sabahOzeti(t.id);
        if (r.atlandi) continue; // neden sabahOzeti içinde loglandı ("<tenant> atlandı: …")
        this.logger.log(`[Koordinator] ${t.id} sabah özeti: iş ${r.isId}, ${r.gonderildi} numaraya gitti${r.hata ? `, hata: ${r.hata}` : ''}`);
      } catch (e: any) {
        this.logger.warn(`[Koordinator] ${t.id} sabah özeti hatası: ${e?.message || e}`);
      }
    }
  }
}
