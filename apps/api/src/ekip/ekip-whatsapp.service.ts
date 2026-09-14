import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { OwnerOnlyGuard } from '../auth/guards/owner-only.guard';
import { ajanSec, canliModIstendi, whatsappGoreviOlustur } from '../moren-ai/ses-koordinator';
import { EkipKosuOlayi, EkipKosuSonucu, EkipRunnerService } from './ekip-runner.service';
import { SUREC_KIMLIGI } from './ekip-bekci';
import { ajanBul } from './ajan-tanimlari';
import { EkipOnayService } from './ekip-onay.service';
import { EkipAkisService } from './ekip-akis.service';
import { bildirimAcikMi, bildirimTuru } from './ekip-akis';
import {
  ISTEK_KIMLIK_UZUNLUGU,
  SahipKomutTuru,
  WHATSAPP_KOORDINATOR_ILK_CEVAP_MS,
  baslangicMesaji,
  bitisMesaji,
  iletildiMetni,
  insanKonusu,
  istekMesaji,
  kuruDenemeMetni,
  onayMesaji,
  sahipCevabiOlustur,
} from './ekip-whatsapp';

/**
 * EKİP ↔ WHATSAPP KÖPRÜSÜ (PLAN/19 §C, 2026-09-14).
 *
 * Muzaffer Bey WhatsApp botuna "şu işi yapın" yazar → bot controller (sahip dalı, ekipYoluMu kapısı) sahipMesaji() →
 * Koordinatör koşusu (kaynak:'whatsapp', whatsappHedef=telefon; varsayılan KURU TEST, "canlı yap" geçerse canlı).
 *  - 20 sn (WHATSAPP_KOORDINATOR_ILK_CEVAP_MS) içinde biterse rapor kısa metin olarak döner (controller gönderir).
 *  - Bitmezse "iletildi, sonucu buradan yazacağım" döner; koşu arka planda sürer, bitince ✅/❌ mesajı bu servis atar.
 *  - Çocuk koşular (ekip_ajan_baslat; payload.whatsappHedef kopyalanır) ▶️ başladı / ✅ bitti / ❌ yapamadı yazar;
 *    onay kaydı 🔔, "sizden istenen" 📌 (kök sync penceresindeyse biriktirilir: sync cevap zaten söyler).
 *  - Komutlar: ONAYLIYORUM / REDDET #PRV-XXXX (ekip-onay.service), YAPILDI #kimlik (ekip-akis.service.istekKapat).
 *
 * KORUMALAR: kuruMesaj (bot __dryRun) → koşu başlatılmaz, hiçbir şey gönderilmez · kimliksiz HTTP kaynağı → komut yürütülmez ·
 * OwnerNotifier KULLANILMAZ (AUTOMATION tipini WhatsApp'a vermiyor + 10 sn tekil düşürüyor) → doğrudan whatsapp.sendMessage
 * (koordinator.service sabahOzeti kalıbı, quote:false) · gönderim başarısızsa 3 deneme (30 sn ara) · aynı vakada 5 sn tampon.
 * Runner'a bağımlılık tek yönlü: runner bu servisi bilmez, olayları bitisDinleyiciEkle dinleyicisine verir.
 *
 * 2026-09-15 (Muzaffer Bey: "gereksiz kodlar" + "işi bitirdi ama hâlâ sürüyor görünüyor"):
 *  - Başlıklar insan dilinde (insanKonusu); Koordinatör işi personele devrettiyse kendi "✅ bitirdi" mesajı ATILMAZ
 *    (▶️ personel başladı / ✅ personel bitirdi zaten anlatıyor; Koordinatör'ün "bitirdi"si iş bitmeden bitti sanılıyordu).
 *  - BİTİŞ İŞARETİ: her bitiş olayı işlendiğinde (gönderildi / bilinçli atlandı / sync cevapla verildi) payload.whatsappBitis yazılır.
 *  - DRENAJ TARAMASI (@Interval 60 sn): dağıtımda eski kopya koşuyu bitirir ama WhatsApp soketi kapandığı için ✅/❌ mesajını
 *    atamaz → yeni kopya, bu süreç başladıktan sonra BAŞKA süreçte bitmiş ve işaretsiz ekip işlerini bulup mesajı kendisi atar.
 */

/** Kök koşu izi (vakaId = kök iş id'si): sync/arka plan durumu, biriken olaylar, kayıt bağlamı. */
interface VakaIzi {
  tenantId: string;
  telefon: string;
  /** Owner WhatsApp aiConversation'ı (arka plan mesajları asistan mesajı olarak da yazılır — hafıza = Muzaffer Bey'in gördüğü). */
  konusmaId: string | null;
  /** Owner WhatsApp kişi kaydı (communicationLog.taxpayerId). */
  sahipKisiId: string | null;
  /** Kök koşu ilk cevap sınırını aşıp arka plana atıldı (tasarımdaki "bekleyenKokler"): bitince ✅/❌ buradan gider. */
  kokArkaPlanda: boolean;
  kokBitti: boolean;
  /** Kök sync penceresindeyken gelen olaylar (onay/istek): zaman aşımında akıtılır, sync bitişte atılır (cevap zaten içerir). */
  birikenler: EkipKosuOlayi[];
  /** Kök koşu sırasında açılan "sizden istenen" kalemleri — sync cevaba girer. */
  istekler: Array<{ id: string; baslik: string }>;
  /** Koordinatör bu vakada personele iş verdi (çocuk koşu başladı) → kökün kendi ✅ mesajı atlanır. */
  cocukBasladi: boolean;
}

interface GonderimHedefi {
  tenantId: string;
  telefon: string;
  vakaId: string;
  konusmaId: string | null;
  sahipKisiId: string | null;
}

/** Servis içi iz sayısı tavanı (süreç belleği; en eski düşer). */
const VAKA_IZI_TAVAN = 200;
/** Drenaj taraması: bu süreç başladıktan sonra bitmiş işler; bitişten en az bu kadar sonra (kendi dinleyicimize fırsat). */
const DRENAJ_BITIS_GECIKME_MS = 20_000;
const DRENAJ_TARAMA_MS = 60_000;
const SUREC_BASLANGICI = new Date(Number(SUREC_KIMLIGI.split('@')[1]) || Date.now());
const MUKELLEF_AD_ONBELLEK_TAVAN = 500;
export const EKIP_WHATSAPP_MODEL_ETIKETI = 'ekip-koordinator:whatsapp';

const SAHIP_KULLANICI_YOK = 'Portal kullanıcınızı bulamadım (MOREN_OWNER_EMAIL / MOREN_BUTCE_OWNER_EMAIL); canlı koşu ve onay için gerekli. Kuru test için mesajı "canlı yap" demeden yazın.';
const KIMLIKSIZ_KAYNAK = "Bu istek gerçek WhatsApp bağlantısından gelmediği için Koordinatör'e İLETİLMEDİ / işlem YAPILMADI.";

@Injectable()
export class EkipWhatsappService implements OnModuleInit {
  private readonly logger = new Logger('EkipWhatsappService');

  /** İlk cevap sınırı (ms); spec kısaltır. */
  ilkCevapMs = WHATSAPP_KOORDINATOR_ILK_CEVAP_MS;
  /** Gönderim başarısızsa yeniden deneme aralığı / sayısı; aynı vakada tampon süresi. Spec kısaltır. */
  protected yenidenDenemeMs = 30_000;
  protected yenidenDenemeSayisi = 3;
  protected tamponMs = 5_000;

  private readonly vakalar = new Map<string, VakaIzi>();
  private readonly tampon = new Map<string, { hedef: GonderimHedefi; metinler: string[]; bitisIsIdler: string[]; zamanlayici: NodeJS.Timeout }>();
  private readonly mukellefAdlari = new Map<string, string | null>();
  /** Olay mesajları sırayla işlensin (mükellef adı sorgusu asenkron; ▶️ başladı ✅ bitti sırası bozulmasın). */
  private zincir: Promise<void> = Promise.resolve();

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly runner: EkipRunnerService,
    private readonly ekipOnay: EkipOnayService,
    private readonly ekipAkis: EkipAkisService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.runner.bitisDinleyiciEkle((olay) => this.kosuOlayi(olay));
  }

  // ─── SAHİP KULLANICISI ───

  /** OwnerOnlyGuard.ownerEmail() e-postalı aktif kullanıcı (bu tenant'ta); yoksa null (kuru koşu yine olur, canlı/onay olmaz). */
  async sahipKullaniciId(tenantId: string): Promise<string | null> {
    const email = OwnerOnlyGuard.ownerEmail();
    if (!email) return null;
    try {
      const u = await (this.prisma as any).user.findFirst({
        where: { tenantId, email: { equals: email, mode: 'insensitive' }, isActive: true },
        select: { id: true },
      });
      return u?.id || null;
    } catch (e: any) {
      this.logger.warn(`sahip kullanıcısı okunamadı: ${e?.message || e}`);
      return null;
    }
  }

  // ─── SAHİP MESAJI → KOORDİNATÖR ───

  /**
   * Sahip mesajını Koordinatör'e verir. Dönen metin controller tarafından (ownerCevapGonder, __dryRun kapısı altında) gönderilir.
   *  - kuruMesaj: bot kuru denemesi → koşu YOK, gönderim YOK, yalnız "iletilecekti" metni.
   *  - arkaPlanda:true → ilk cevap sınırı aşıldı; bitince ✅/❌ bu servis yazar.
   */
  async sahipMesaji(p: {
    tenantId: string;
    telefon: string;
    metin: string;
    kuruMesaj?: boolean;
    konusmaId?: string | null;
    sahipKisiId?: string | null;
  }): Promise<{ metin: string; isId: string | null; arkaPlanda: boolean }> {
    const canli = canliModIstendi(p.metin);
    if (p.kuruMesaj) return { metin: kuruDenemeMetni({ canli, oneri: ajanSec(p.metin) }), isId: null, arkaPlanda: false };

    const sahipUserId = await this.sahipKullaniciId(p.tenantId);
    if (canli && !sahipUserId) return { metin: SAHIP_KULLANICI_YOK, isId: null, arkaPlanda: false };

    const gorev = whatsappGoreviOlustur({ question: p.metin, canli });
    const dryRun = !canli;
    let isId = '';
    let arkaPlana = false; // zaman aşımı 'baslangic'ten önce gelirse iz açılırken arka plan sayılsın
    const kosu: Promise<EkipKosuSonucu> = this.runner.calistir({
      ajanId: 'koordinator',
      gorev,
      tenantId: p.tenantId,
      userId: sahipUserId,
      dryRun,
      kaynak: 'whatsapp',
      whatsappHedef: p.telefon,
      emit: (e) => {
        if (e.type !== 'baslangic') return;
        isId = e.isId;
        this.vakaAc(e.isId, {
          tenantId: p.tenantId,
          telefon: p.telefon,
          konusmaId: p.konusmaId || null,
          sahipKisiId: p.sahipKisiId || null,
          kokArkaPlanda: arkaPlana,
          kokBitti: false,
          birikenler: [],
          istekler: [],
          cocukBasladi: false,
        });
      },
    });

    let zamanlayici: NodeJS.Timeout | null = null;
    const zamanAsimi = new Promise<'zaman-asimi'>((resolve) => {
      zamanlayici = setTimeout(() => resolve('zaman-asimi'), this.ilkCevapMs);
      (zamanlayici as any).unref?.();
    });
    const sonuc = await Promise.race([kosu, zamanAsimi]).finally(() => {
      if (zamanlayici) clearTimeout(zamanlayici);
    });

    if (sonuc === 'zaman-asimi') {
      arkaPlana = true;
      const iz = isId ? this.vakalar.get(isId) : null;
      if (iz) {
        iz.kokArkaPlanda = true;
        for (const o of iz.birikenler.splice(0)) this.olayiGonder(o, iz);
      }
      kosu.catch((e: any) => this.logger.warn(`[WhatsApp→Koordinatör] arka plan koşu hatası: ${e?.message || e}`));
      this.logger.log(`[WhatsApp→Koordinatör] ilk cevap sınırı (${Math.round(this.ilkCevapMs / 1000)} sn) aşıldı, iş arka planda: ${isId || '-'}`);
      return { metin: iletildiMetni(isId, dryRun), isId: isId || null, arkaPlanda: true };
    }

    const s = sonuc as EkipKosuSonucu;
    if (s.hata && !s.rapor && !s.isId) {
      // Omurga düzeyinde koşu hiç başlamadı (Max yok / bilinmeyen ajan) — kısa neden.
      return { metin: `Koordinatör'e iletemedim: ${s.hata}`, isId: null, arkaPlanda: false };
    }
    const iz = s.isId ? this.vakalar.get(s.isId) : null;
    if (iz) {
      iz.kokBitti = true;
      iz.birikenler = []; // sync cevap onay/istek satırlarını zaten taşır
    }
    if (s.isId) void this.bitisIsaretle([s.isId], 'sync');
    const metin = sahipCevabiOlustur({
      rapor: s.rapor,
      hata: s.hata,
      dryRun,
      kuruTestSayisi: s.kuruTestYapilacaktilar.length,
      onayBekleyen: s.onayBekleyen,
      istekler: iz?.istekler || [],
    });
    this.logger.log(`[WhatsApp→Koordinatör] ${s.isId} ${s.durationMs}ms araç=${s.toolUses.length} kuruTest=${s.kuruTestYapilacaktilar.length} onay=${s.onayBekleyen.length} canli=${canli}`);
    return { metin, isId: s.isId || null, arkaPlanda: false };
  }

  private vakaAc(vakaId: string, iz: VakaIzi): void {
    this.vakalar.set(vakaId, iz);
    while (this.vakalar.size > VAKA_IZI_TAVAN) {
      const enEski = this.vakalar.keys().next().value;
      if (enEski === undefined) break;
      this.vakalar.delete(enEski);
    }
  }

  // ─── SAHİP KOMUTU (ONAYLIYORUM / REDDET / YAPILDI) ───

  /**
   * Komutu yürütür; dönen metin controller tarafından gönderilir.
   *  - ONAYLIYORUM/REDDET: previewId'li ekip:* kaydı yoksa null (controller eski akışa düşer).
   *  - YAPILDI: tenant'ın açık "sizden istenen" bildirimlerinde id ön eki eşleşen kalem kapatılır.
   *  - kuruMesaj: kayda dokunulmaz, "…yapılacaktı" metni. kimliksizKaynak (HTTP webhook): yürütülmez.
   */
  async komutIsle(p: {
    tenantId: string;
    tur: SahipKomutTuru;
    kimlik: string;
    not?: string;
    kuruMesaj?: boolean;
    kimliksizKaynak?: boolean;
  }): Promise<string | null> {
    const db: any = this.prisma;
    if (p.tur === 'ONAYLIYORUM' || p.tur === 'REDDET') {
      const kayit = await db.ownerApprovalRequest
        .findFirst({ where: { tenantId: p.tenantId, previewId: p.kimlik, agent: { startsWith: 'ekip:' } }, select: { id: true, status: true, action: true } })
        .catch(() => null);
      if (!kayit) return null;
      if (p.kimliksizKaynak) return KIMLIKSIZ_KAYNAK;
      if (p.kuruMesaj) return `Kuru deneme: #${p.kimlik} ${p.tur === 'ONAYLIYORUM' ? 'onaylanıp yürütülecekti' : 'reddedilecekti'} (${kayit.action}); kayda dokunulmadı.`;
      const userId = await this.sahipKullaniciId(p.tenantId);
      if (!userId) return SAHIP_KULLANICI_YOK;
      if (p.tur === 'ONAYLIYORUM') {
        const r: any = await this.ekipOnay.onayla({ tenantId: p.tenantId, userId, previewId: p.kimlik, onayMetni: `ONAYLIYORUM #${p.kimlik}`, kaynak: 'whatsapp' });
        return r?.ok ? `✅ #${p.kimlik} onaylandı, gönderildi (${r.yurutulen || kayit.action}).` : `❌ #${p.kimlik} yürütülemedi: ${r?.error || 'bilinmeyen hata'}`;
      }
      const r: any = await this.ekipOnay.reddet({ tenantId: p.tenantId, userId, previewId: p.kimlik, not: p.not ? `REDDET (WhatsApp): ${p.not}` : 'REDDEDİLDİ (WhatsApp)' });
      return r?.ok ? `#${p.kimlik} reddedildi; mesaj gönderilmeyecek.` : `#${p.kimlik} reddedilemedi: ${r?.error || 'bilinmeyen hata'}`;
    }

    // YAPILDI #kimlik — açık istek bildirimi (ekip, tur:'istek', okunmamış, kapanmamış); ön ek eşleşmesi
    const kimlik = String(p.kimlik || '').toLowerCase();
    const adaylar: any[] = await db.notification
      .findMany({ where: { tenantId: p.tenantId, type: 'AUTOMATION', isRead: false, id: { startsWith: kimlik } }, take: 10 })
      .catch(() => []);
    const acik = adaylar.filter((b) => String(b?.metadata?.automationId || '').startsWith('ekip:') && bildirimTuru(b) === 'istek' && bildirimAcikMi(b));
    if (!acik.length) return `Açık "sizden istenen" kalemi bulunamadı: #${kimlik}. Bildirim kimliğinin ilk ${ISTEK_KIMLIK_UZUNLUGU} karakterini yazın.`;
    if (acik.length > 1) return `#${kimlik} birden fazla kaleme uyuyor (${acik.length}); daha uzun kimlik yazın.`;
    const baslik = String(acik[0].title || 'iş').slice(0, 160);
    if (p.kimliksizKaynak) return KIMLIKSIZ_KAYNAK;
    if (p.kuruMesaj) return `Kuru deneme: "${baslik}" kapatılacaktı; kayda dokunulmadı.`;
    const userId = await this.sahipKullaniciId(p.tenantId);
    const r = await this.ekipAkis.istekKapat(p.tenantId, userId, acik[0].id);
    if (!r.ok) return `Kapatılamadı: ${r.error || 'bilinmeyen hata'}`;
    return r.zatenKapali ? `"${baslik}" zaten kapalıydı.` : `📌 Kapatıldı: ${baslik}`;
  }

  // ─── KOŞU OLAYLARI (runner dinleyicisi) ───

  /**
   * Senkron giriş (runner çağırır): defter işleri hemen (sync cevap bunları okur), mesaj üretimi sıralı zincirde.
   * Gönderim koşulu: whatsappHedef dolu VE (çocuk koşu YA DA kök arka plana atılmış). Kök sync penceresindeyse olay biriktirilir.
   */
  kosuOlayi(o: EkipKosuOlayi): void {
    const k = o.kosu;
    if (!k?.whatsappHedef) return;
    const vakaId = k.vakaId || k.isId;
    const iz = this.vakalar.get(vakaId);
    const cocuk = Boolean(k.ustIsId);
    if (o.tur === 'istek' && iz && !cocuk) iz.istekler.push({ id: o.bildirimId, baslik: o.baslik });
    if (o.tur === 'basladi' && cocuk && iz) iz.cocukBasladi = true;
    if (o.tur === 'basladi' && !cocuk) return; // kök başlangıcı: iz sahipMesaji'nda açıldı, mesaj yok
    if (o.tur === 'bitti' && !cocuk) {
      if (iz) iz.kokBitti = true;
      if (!iz?.kokArkaPlanda) return; // sync bitiş: cevabı sahipMesaji verir (işareti de o yazar)
      // Koordinatör işi personele verdiyse kendi "bitirdi"si yazılmaz — personelin ▶️/✅ mesajları işi anlatır; soru/onay varsa yazılır.
      if (iz.cocukBasladi && !o.basarisiz && !o.sonuc.onayBekleyen?.length && !/(^|\n)\s*SORU\s*:/i.test(o.sonuc.rapor || '')) {
        void this.bitisIsaretle([k.isId], 'atlandi');
        return;
      }
    }
    const hemen = cocuk || iz?.kokArkaPlanda === true;
    if (!hemen) {
      if (iz) iz.birikenler.push(o);
      return;
    }
    this.olayiGonder(o, iz || null);
  }

  private olayiGonder(o: EkipKosuOlayi, iz: VakaIzi | null): void {
    this.zincir = this.zincir
      .then(() => this.olayMetniniYolla(o, iz))
      .catch((e: any) => this.logger.warn(`koşu olayı mesajı üretilemedi (${o.tur}, iş ${o.kosu.isId}): ${e?.message || e}`));
  }

  private async olayMetniniYolla(o: EkipKosuOlayi, iz: VakaIzi | null): Promise<void> {
    const k = o.kosu;
    const mukellefAd = await this.mukellefAdi(k.tenantId, k.taxpayerId);
    const konu = insanKonusu(k.gorev);
    let metin: string;
    switch (o.tur) {
      case 'basladi':
        metin = baslangicMesaji({ ajanAd: k.ajanAd, mukellefAd, konu, dryRun: k.dryRun });
        break;
      case 'onay': {
        const a: any = o.onay?.args || {};
        const hedef = a.to || a.phone || a.email || null;
        metin = onayMesaji({ ajanAd: k.ajanAd, mukellefAd, konu, previewId: o.onay.previewId, arac: o.onay.name, hedef });
        break;
      }
      case 'istek':
        metin = istekMesaji({ ajanAd: k.ajanAd, mukellefAd, baslik: o.baslik, bildirimId: o.bildirimId });
        break;
      case 'bitti':
        metin = bitisMesaji({
          ajanAd: k.ajanAd,
          mukellefAd,
          konu,
          rapor: o.sonuc.rapor,
          hata: o.sonuc.hata,
          basarisiz: o.basarisiz,
          dryRun: k.dryRun,
          kuruTestSayisi: o.sonuc.kuruTestYapilacaktilar.length,
          onayBekleyen: o.sonuc.onayBekleyen,
        });
        break;
      default:
        return;
    }
    this.kuyrukla(
      {
        tenantId: k.tenantId,
        telefon: k.whatsappHedef!,
        vakaId: k.vakaId || k.isId,
        konusmaId: iz?.konusmaId ?? null,
        sahipKisiId: iz?.sahipKisiId ?? null,
      },
      metin,
      o.tur === 'bitti' ? k.isId : null,
    );
  }

  // ─── BİTİŞ İŞARETİ + DRENAJ TARAMASI ───

  /** payload.whatsappBitis = "<nasıl>@<ISO>" — bu işin bitiş mesajı işlendi; drenaj taraması bir daha üretmesin. Hata yutulur. */
  async bitisIsaretle(isIdler: string[], nasil: 'gonderildi' | 'atlandi' | 'sync'): Promise<void> {
    const db: any = this.prisma;
    if (typeof db.$executeRaw !== 'function') return;
    const deger = `${nasil}@${new Date().toISOString()}`;
    for (const isId of isIdler.filter(Boolean)) {
      try {
        await db.$executeRaw`UPDATE agent_commands SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{whatsappBitis}', to_jsonb(${deger}::text)) WHERE id = ${isId}`;
      } catch (e: any) {
        this.logger.warn(`[Ekip→WhatsApp] bitiş işareti yazılamadı ${isId}: ${e?.message || e}`);
      }
    }
  }

  /**
   * Dağıtım drenajı: eski kopyada bitmiş (payload.surec ≠ bu süreç) ama WhatsApp mesajı atılamamış ekip işleri (whatsappHedef dolu,
   * whatsappBitis yok, bu süreç başladıktan sonra bitmiş) → ✅/❌ mesajı buradan. Bekçinin "sunucu yeniden başladı / nabız kesildi"
   * diye kapattığı işler de böyle duyurulur. Kök Koordinatör işi personele devretmişse (ekip_ajan_baslat) atlanır.
   */
  @Interval(DRENAJ_TARAMA_MS)
  async drenajBitisleriniTara(): Promise<number> {
    const db: any = this.prisma;
    if (typeof db?.agentCommand?.findMany !== 'function') return 0;
    const isler: any[] = await db.agentCommand
      .findMany({
        where: {
          agent: { startsWith: 'ekip:' },
          status: { in: ['done', 'failed'] },
          finishedAt: { gte: SUREC_BASLANGICI, lte: new Date(Date.now() - DRENAJ_BITIS_GECIKME_MS) },
        },
        select: { id: true, tenantId: true, agent: true, status: true, payload: true, result: true },
        orderBy: { finishedAt: 'asc' },
        take: 50,
      })
      .catch(() => []);
    let sayi = 0;
    for (const is of isler) {
      const p = is?.payload && typeof is.payload === 'object' ? is.payload : {};
      if (!p.whatsappHedef || p.whatsappBitis || p.surec === SUREC_KIMLIGI) continue;
      const r = is?.result && typeof is.result === 'object' ? is.result : {};
      const ajanId = String(is.agent || '').replace(/^ekip:/, '');
      const ajan = ajanBul(ajanId);
      const kok = !p.ustIsId;
      const devretti = kok && Array.isArray(r.toolUses) && r.toolUses.some((t: any) => t?.name === 'ekip_ajan_baslat');
      const basarisiz = is.status === 'failed';
      if (devretti && !basarisiz) {
        await this.bitisIsaretle([is.id], 'atlandi');
        continue;
      }
      const mukellefAd = await this.mukellefAdi(is.tenantId, p.taxpayerId || r.taxpayerId || null);
      const metin = bitisMesaji({
        ajanAd: ajan?.ad || ajanId,
        mukellefAd,
        konu: insanKonusu(String(p.gorev || '')),
        rapor: String(r.rapor || ''),
        hata: r.hata || null,
        basarisiz,
        dryRun: p.dryRun !== false,
        kuruTestSayisi: Array.isArray(r.kuruTestYapilacaktilar) ? r.kuruTestYapilacaktilar.length : 0,
        onayBekleyen: Array.isArray(r.onayBekleyen) ? r.onayBekleyen : [],
      });
      const iz = this.vakalar.get(p.vakaId || is.id);
      this.kuyrukla(
        { tenantId: is.tenantId, telefon: String(p.whatsappHedef), vakaId: p.vakaId || is.id, konusmaId: iz?.konusmaId ?? null, sahipKisiId: iz?.sahipKisiId ?? null },
        metin,
        is.id,
      );
      sayi++;
    }
    if (sayi) this.logger.log(`[Ekip→WhatsApp] drenaj taraması: başka süreçte bitmiş ${sayi} işin bitiş mesajı kuyruğa alındı`);
    return sayi;
  }

  /** id → görünen ad (companyName | ad soyad); sorgu düşerse null. Küçük önbellek. */
  private async mukellefAdi(tenantId: string, taxpayerId: string | null): Promise<string | null> {
    if (!taxpayerId) return null;
    const anahtar = `${tenantId}:${taxpayerId}`;
    if (this.mukellefAdlari.has(anahtar)) return this.mukellefAdlari.get(anahtar) ?? null;
    let ad: string | null = null;
    try {
      const t = await (this.prisma as any).taxpayer.findFirst({
        where: { id: taxpayerId, tenantId },
        select: { companyName: true, firstName: true, lastName: true },
      });
      ad = t ? String(t.companyName || '').trim() || `${String(t.firstName || '').trim()} ${String(t.lastName || '').trim()}`.trim() || null : null;
    } catch {
      ad = null;
    }
    this.mukellefAdlari.set(anahtar, ad);
    while (this.mukellefAdlari.size > MUKELLEF_AD_ONBELLEK_TAVAN) {
      const enEski = this.mukellefAdlari.keys().next().value;
      if (enEski === undefined) break;
      this.mukellefAdlari.delete(enEski);
    }
    return ad;
  }

  // ─── GÖNDERİM: 5 sn vaka tamponu + 3 deneme ───

  /** Aynı vakada (tenant|telefon|vaka) tampon süresi içinde gelen mesajlar tek WhatsApp mesajında birleşir. */
  private kuyrukla(hedef: GonderimHedefi, metin: string, bitisIsId: string | null = null): void {
    const anahtar = `${hedef.tenantId}|${hedef.telefon}|${hedef.vakaId}`;
    const eldeki = this.tampon.get(anahtar);
    if (eldeki) {
      eldeki.metinler.push(metin);
      if (bitisIsId) eldeki.bitisIsIdler.push(bitisIsId);
      return;
    }
    const zamanlayici = setTimeout(() => {
      const t = this.tampon.get(anahtar);
      this.tampon.delete(anahtar);
      if (!t) return;
      void this.gonderDenemeli(t.hedef, t.metinler.join('\n\n')).then((ok) => {
        if (ok && t.bitisIsIdler.length) return this.bitisIsaretle(t.bitisIsIdler, 'gonderildi');
        return undefined;
      });
    }, this.tamponMs);
    (zamanlayici as any).unref?.();
    this.tampon.set(anahtar, { hedef, metinler: [metin], bitisIsIdler: bitisIsId ? [bitisIsId] : [], zamanlayici });
  }

  /** whatsapp.sendMessage false dönerse (bağlı değil / kapalı) yenidenDenemeSayisi kadar dener; sonra vazgeçer, log. */
  protected async gonderDenemeli(hedef: GonderimHedefi, metin: string): Promise<boolean> {
    for (let deneme = 1; deneme <= this.yenidenDenemeSayisi; deneme++) {
      const ok = await this.whatsapp.sendMessage(hedef.telefon, metin, hedef.tenantId, { quote: false }).catch((e: any) => {
        this.logger.warn(`[Ekip→WhatsApp] gönderim hatası (${deneme}. deneme): ${e?.message || e}`);
        return false;
      });
      if (ok) {
        await this.kayitDus(hedef, metin);
        return true;
      }
      if (deneme < this.yenidenDenemeSayisi) await new Promise((r) => setTimeout(r, this.yenidenDenemeMs));
    }
    this.logger.warn(`[Ekip→WhatsApp] ${this.yenidenDenemeSayisi} denemede gönderilemedi (vaka ${hedef.vakaId}); vazgeçildi. Metin: ${metin.slice(0, 120)}`);
    return false;
  }

  /** Gönderilen mesaj Muzaffer Bey'in hattına da geçsin: communicationLog + aiConversation asistan mesajı (hata yutulur). */
  private async kayitDus(hedef: GonderimHedefi, metin: string): Promise<void> {
    const db: any = this.prisma;
    if (hedef.sahipKisiId) {
      await db.communicationLog
        .create({ data: { taxpayerId: hedef.sahipKisiId, channel: 'WHATSAPP', subject: 'WhatsApp owner ekip bildirimi', content: metin, occurredAt: new Date() } })
        .catch(() => null);
    }
    if (hedef.konusmaId) {
      await db.aiMessage
        .create({
          data: {
            conversationId: hedef.konusmaId,
            role: 'assistant',
            content: metin,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            model: EKIP_WHATSAPP_MODEL_ETIKETI,
            durationMs: 0,
          },
        })
        .catch((e: any) => this.logger.warn(`[Ekip→WhatsApp] asistan mesajı kaydedilemedi: ${e?.message || e}`));
    }
  }

  /** Teşhis/test: kök izi. */
  vakaIzi(vakaId: string): { kokArkaPlanda: boolean; kokBitti: boolean; birikenSayisi: number; istekSayisi: number; cocukBasladi: boolean } | null {
    const iz = this.vakalar.get(vakaId);
    return iz ? { kokArkaPlanda: iz.kokArkaPlanda, kokBitti: iz.kokBitti, birikenSayisi: iz.birikenler.length, istekSayisi: iz.istekler.length, cocukBasladi: iz.cocukBasladi } : null;
  }
}
