import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getEFaturaAdapter, SUPPORTED_PROVIDERS } from './efatura-adapter.factory';
import { EFaturaCredentials } from './efatura-adapter.interface';
import { tryDecrypt } from '../common/crypto';

/** Sağlayıcıların ünvan yerine koyduğu anlamsız değerler (Paraşüt giden faturada "Mükellef" yazıyor). */
function isPlaceholderTitle(value: any): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  if (/^[0-9]{10,11}$/.test(text)) return true;                 // ünvan yerine VKN/TCKN
  return /^(m[üu]kellef|firma|al[ıi]c[ıi]|sat[ıi]c[ıi]|-|bilinmiyor)$/i.test(text);
}

/**
 * UBL-TR faturasından taraf ünvanını çıkarır.
 *   which='CUSTOMER' → AccountingCustomerParty (alıcı) · 'SUPPLIER' → AccountingSupplierParty (satıcı)
 * Öncelik: PartyName/Name → PartyLegalEntity/RegistrationName → Person(FirstName+FamilyName).
 * Ad alanı ön ek (cac:/cbc:) taşıyabilir ya da taşımayabilir → ön ek opsiyonel eşleşir.
 */
function partyTitleFromUbl(xml: any, which: 'CUSTOMER' | 'SUPPLIER'): string | null {
  const text = String(xml || '');
  if (!text || text.length < 40) return null;
  const tag = which === 'CUSTOMER' ? 'AccountingCustomerParty' : 'AccountingSupplierParty';
  const blockRe = new RegExp(`<(?:\\w+:)?${tag}[\\s\\S]*?</(?:\\w+:)?${tag}>`, 'i');
  const block = text.match(blockRe)?.[0];
  if (!block) return null;
  const pick = (re: RegExp) => block.match(re)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const name =
    pick(/<(?:\w+:)?PartyName>[\s\S]*?<(?:\w+:)?Name>([\s\S]*?)<\/(?:\w+:)?Name>/i) ||
    pick(/<(?:\w+:)?RegistrationName>([\s\S]*?)<\/(?:\w+:)?RegistrationName>/i) ||
    [
      pick(/<(?:\w+:)?FirstName>([\s\S]*?)<\/(?:\w+:)?FirstName>/i),
      pick(/<(?:\w+:)?FamilyName>([\s\S]*?)<\/(?:\w+:)?FamilyName>/i),
    ].filter(Boolean).join(' ').trim();
  return name && !isPlaceholderTitle(name) ? name : null;
}

/**
 * ⛔ ESKİ İKİNCİ ÇEKİM SİSTEMİ — GECE AKIŞINDAN ÇIKARILDI (2026-09-26, denetim bulgusu — YÜKSEK).
 *   Bu servis (adaptör tabanlı efatura_inbox senkronu) talimatlı mükellefte ana yolun YANINDA
 *   ikinci kez çalışıyordu ve üç zarar veriyordu:
 *     1) eLogo'ya yanlış biçimli giriş → 10 hatalı girişte hesap KİLİDİ riski,
 *     2) GetDocumentDone / SetInvoicesTaken / MarkInvoice ile faturaları entegratörde "alındı"
 *        işaretliyordu → mükellefin başka programları o faturaları artık göremiyordu,
 *     3) Uyumsoft'un ESKİ adresine gidiyordu (yeni platform kullanıcıyı tanımıyor).
 *   Ana çekim yolu FaturaMuhasebelestirmeService.fetchConfiguredIntegrations zaten çekiyor.
 *   • syncAll artık hiçbir şey yapmaz (ESKI_EFATURA_SYNC=acik env'i verilmedikçe).
 *   • "alındı" işaretleme (markAsTransferred) burada ve adaptörlerde KAPALI.
 *   • listInbox (efatura_inbox okuma) çalışmaya devam eder — Fatura Merkezi ekranı kullanıyor.
 */
const ESKI_SYNC_ACIK = () => String(process.env.ESKI_EFATURA_SYNC || '').trim().toLowerCase() === 'acik';
const ALINDI_ISARETLE = false as boolean;

@Injectable()
export class EFaturaSyncService {
  private readonly logger = new Logger(EFaturaSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bir mükellef + entegratör için delta sync çalıştır.
   * Yeni faturalar efatura_inbox tablosuna yazılır, mevcut olanlar atlanır.
   * Döner: kaç fatura yeni eklendi
   */
  async syncTaxpayer(
    tenantId: string,
    taxpayerId: string,
    provider: string,
    credentials: EFaturaCredentials,
    opts: { direction?: 'IN' | 'OUT'; limit?: number } = {},
  ): Promise<{ added: number; skipped: number; errors: string[] }> {
    const adapter = getEFaturaAdapter(provider);
    if (!adapter) {
      return { added: 0, skipped: 0, errors: [`Adapter bulunamadi: ${provider}`] };
    }

    const providerUpper = provider.toUpperCase();
    const direction = opts.direction || 'IN';
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // son 30 gün
      const pageSize = opts.limit || 100;
      const MAX_PAGES = 50; // sonsuz döngü koruması — üst sınır

      const seenUuids = new Set<string>(); // bu çalıştırmada görülen uuid'ler (aynı sayfa tekrarına karşı)
      const newUuids: string[] = []; // DB'de markedAt işaretlenecekler
      const newMarkIds: string[] = []; // entegratöre gidecek kimlikler (Uyumsoft: InvoiceId)

      for (let page = 0; page < MAX_PAGES; page++) {
        const { invoices, hasMore } = await adapter.fetchInvoices(credentials, {
          direction,
          startDate,
          limit: pageSize,
          page,
        });

        const batch = invoices.filter((inv) => inv.uuid && !seenUuids.has(inv.uuid));
        // FATURA KAYBI DÜZELTMESİ (2026-08-20): eskiden boş sayfada `break` vardı. Bazı sağlayıcılarda
        //   (örn e-Logo) liste ucu TARİH FİLTRESİ ALMAZ; tarih süzgeci belge indirildikten SONRA
        //   uygulanır. Dolayısıyla bir sayfanın tamamı tarih aralığı dışında kalabilir — bu, listenin
        //   bittiği anlamına GELMEZ. Orada durmak sonraki sayfalardaki faturaları sessizce kaybettiriyordu.
        //   Artık yalnız sağlayıcı "başka sayfa yok" (hasMore=false) dediğinde duruyoruz.
        batch.forEach((inv) => seenUuids.add(inv.uuid));

        // Gerçek yeni/mevcut ayrımı: mevcut uuid'leri tek sorguyla çek
        const existingRows = await (this.prisma as any).eFaturaInbox.findMany({
          where: { tenantId, taxpayerId, entegrator: providerUpper, uuid: { in: batch.map((inv) => inv.uuid) } },
          select: { uuid: true },
        });
        const existingUuids = new Set<string>(existingRows.map((row: any) => row.uuid));

        for (const inv of batch) {
          if (existingUuids.has(inv.uuid)) {
            skipped++; // zaten var — yeniden yazma, yeniden mark'lama
            continue;
          }
          try {
            await (this.prisma as any).eFaturaInbox.upsert({
              where: { tenantId_taxpayerId_entegrator_uuid: { tenantId, taxpayerId, entegrator: providerUpper, uuid: inv.uuid } },
              create: {
                tenantId,
                taxpayerId,
                entegrator: providerUpper,
                uuid: inv.uuid,
                ettn: inv.ettn,
                senderVkn: inv.senderVkn,
                senderTitle: inv.senderTitle,
                receiverVkn: inv.receiverVkn,
                faturaNo: inv.faturaNo,
                faturaDate: inv.faturaDate,
                matrah: inv.matrah != null ? String(inv.matrah) : null,
                kdv: inv.kdv != null ? String(inv.kdv) : null,
                toplam: inv.toplam != null ? String(inv.toplam) : null,
                paraBirimi: inv.paraBirimi || 'TRY',
                direction,
                invoiceProfile: inv.invoiceProfile,
                ublXmlRaw: inv.ublXmlRaw,
                rawJson: inv.rawJson || {},
              },
              update: {}, // yarış durumunda zaten varsa hiçbir şeyi değiştirme
            });
            added++;
            newUuids.push(inv.uuid);
            newMarkIds.push(inv.markId || inv.uuid);
          } catch (err: any) {
            if (err?.code === 'P2002') {
              skipped++; // unique constraint — zaten var
            } else {
              errors.push(`${inv.uuid}: ${err?.message}`);
            }
          }
        }

        if (!hasMore) break;
      }

      // Entegratöre "aktarıldı" bayrağı at — Delta sync için kritik.
      // Yalnız bu çalıştırmada YENİ alınanlar gönderilir; mevcutlar tekrar mark'lanmaz.
      // DEVRE DIŞI (2026-09-26): 'alındı' işaretleme başka programların faturayı görmesini engelliyordu — bkz. dosya başı.
      if (ALINDI_ISARETLE && newMarkIds.length > 0) {
        try {
          await adapter.markAsTransferred(credentials, newMarkIds);
          await (this.prisma as any).eFaturaInbox.updateMany({
            // tenant+taxpayer scope: aynı UUID başka mükellefte de olabilir,
            // yalnız bu mükellefin satırları işaretlensin.
            where: { tenantId, taxpayerId, entegrator: providerUpper, uuid: { in: newUuids } },
            data: { markedAt: new Date() },
          });
        } catch (markErr: any) {
          this.logger.warn(`${provider} mark hatasi: ${markErr?.message}`);
        }
      }

      this.logger.log(
        `[${provider}/${taxpayerId}] sync: ${added} yeni, ${skipped} mevcut, ${errors.length} hata`,
      );
    } catch (err: any) {
      errors.push(err?.message || String(err));
      this.logger.error(`[${provider}/${taxpayerId}] sync genel hata: ${err?.message}`);
    }

    return { added, skipped, errors };
  }

  /**
   * efatura_inbox listesi — mükellef/dönem bazlı filtre destekli
   */
  async listInbox(
    tenantId: string,
    opts: { taxpayerId?: string; direction?: string; period?: string; channel?: string; limit?: string } = {},
  ) {
    const where: Record<string, any> = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.direction) where.direction = opts.direction.toUpperCase();
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (opts.period) {
      const match = String(opts.period).match(/^(\d{4})-(\d{2})$/);
      const year = match ? Number(match[1]) : Number.NaN;
      const month = match ? Number(match[2]) : Number.NaN;
      const start = Number.isFinite(year) && Number.isFinite(month)
        ? new Date(Date.UTC(year, month - 1, 1))
        : new Date(`${opts.period}-01T00:00:00.000Z`);
      const end = Number.isFinite(year) && Number.isFinite(month)
        ? new Date(Date.UTC(year, month, 1))
        : new Date(start);
      if (!Number.isFinite(year) || !Number.isFinite(month)) end.setUTCMonth(end.getUTCMonth() + 1);
      periodStart = start;
      periodEnd = end;
    }
    const limit = Math.min(parseInt(opts.limit || '200', 10) || 200, 3000);
    const channel = String(opts.channel || '').toUpperCase();

    // ── BULGU 6 (2026-09-25): DÖNEM + KANAL SÜZGECİ ARTIK SQL'DE ──────────────────────────────
    //   ESKİ HÂL: dönem süzgeci yalnız `if (!opts.channel)` iken SQL'e giriyordu. Arayüz HER ZAMAN
    //   kanal gönderdiği için (fatura-merkezi ekranı IN_EFATURA ile açılıyor) dönem süzmesi pratikte
    //   HİÇ SQL'e girmiyordu: sorgu `syncedAt desc` ile ilk 5.000 satırı çekiyor, dönem/kanal
    //   ayıklaması bellekte yapılıyordu. Çok faturalı mükellefte (kodun kendi notu: TURKCELL 47k+
    //   fatura) eski aylar bu sınırın arkasında kalıp listede HİÇ görünmüyordu — sessiz eksik.
    //   YENİ HÂL: dönem her zaman, kanal da JSON yol süzgeciyle SQL'e giriyor → sınır artık
    //   "süzülmüş" kümeye uygulanıyor, eksik kalan satır kalmıyor. Sınıra dayanılırsa (aşağıda)
    //   günlüğe uyarı düşülüp satırlara bilgi ekleniyor; sessiz kırpma yok.
    const kosullar: any[] = [];
    if (periodStart && periodEnd) {
      //   faturaDate=null satırlar (TÜRMOB özet satırları) dışta BIRAKILMAZ: onların dönemi eskiden
      //   olduğu gibi bellekte rawJson.period ile karşılaştırılır.
      kosullar.push({ OR: [{ faturaDate: { gte: periodStart, lt: periodEnd } }, { faturaDate: null }] });
    }
    if (channel) {
      //   Kanal ayrı kolon değil, rawJson.channel içinde. Postgres JSON yol süzgeci ile SQL'e taşındı
      //   (aynı kalıp ocrData.ettn süzgecinde de kullanılıyor). Yazan taraf kanalı BÜYÜK harfe
      //   çeviriyor (fatura-muhasebelestirme.service.ts: `String(opts.channel || ...).toUpperCase()`);
      //   yine de küçük harfli eski kayıt varsa elenmesin diye iki biçim birlikte aranıyor.
      const kanalCesitleri = [...new Set([channel, channel.toLowerCase()])];
      kosullar.push({ OR: kanalCesitleri.map((v) => ({ rawJson: { path: ['channel'], equals: v } })) });
    }
    if (kosullar.length) where.AND = kosullar;

    //   SIRALAMA: eskiden `syncedAt desc` (çekim anı) idi → eski bir fatura yeniden çekilince listenin
    //   başına çıkıyor, çekilmeyince kayboluyordu (kararsız sıra). Artık FATURA TARİHİ esas; eşitlikte
    //   syncedAt ve id ikincil anahtar (kararlı, tekrarlanabilir sıra). Tarihi olmayan satırlar sona.
    const siralama = [
      { faturaDate: { sort: 'desc', nulls: 'last' } },
      { syncedAt: 'desc' },
      { id: 'desc' },
    ];
    //   Sınırın AŞILDIĞINI anlamak için bir fazla satır çekilir (limit+1). Fazlası varsa liste
    //   gerçekten kırpılmıştır → sessiz kalınmaz.
    const cekilen = await (this.prisma as any).eFaturaInbox.findMany({
      where,
      orderBy: siralama,
      take: limit + 1,
      select: {
        id: true, tenantId: true, taxpayerId: true, entegrator: true, uuid: true, ettn: true, faturaNo: true, faturaDate: true,
        senderVkn: true, senderTitle: true, receiverVkn: true,
        matrah: true, kdv: true, toplam: true, paraBirimi: true,
        direction: true, invoiceProfile: true, isTransferred: true, documentId: true,
        ublXmlRaw: true, rawJson: true, markedAt: true, processedAt: true, syncedAt: true,
      },
    });
    const listeKirpildi = Array.isArray(cekilen) && cekilen.length > limit;
    if (listeKirpildi) {
      this.logger.warn(
        `[efatura-inbox] LİSTE KIRPILDI: süzgece uyan satır sayısı ${limit} sınırını aştı `
        + `(mükellef=${opts.taxpayerId || '-'} dönem=${opts.period || '-'} kanal=${channel || '-'}). `
        + `Dönemi daraltın ya da limit'i yükseltin; liste EKSİK gösteriyor.`,
      );
    }
    //   SQL'de süzülemeyen artık: tarihi olmayan satırın dönem eşleşmesi (rawJson.period) ve kanal
    //   ikinci kapısı (JSON süzgeci tutmadıysa da eski davranış korunsun).
    const rows = (Array.isArray(cekilen) ? cekilen.slice(0, limit) : []).filter((row: any) => {
      const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
      if (channel && String(raw?.channel || '').toUpperCase() !== channel) return false;
      if (periodStart && periodEnd) {
        const rowDate = row.faturaDate ? new Date(row.faturaDate) : null;
        const validRowDate = rowDate && !Number.isNaN(rowDate.getTime());
        const dateMatches = validRowDate && rowDate >= periodStart && rowDate < periodEnd;
        const rawPeriodMatches = String(raw?.period || '') === opts.period;
        if (validRowDate ? !dateMatches : !rawPeriodMatches) return false;
      }
      return true;
    });
    // Legacy "NaN" onarimi: eski parser tamamen-rakam fatura no'yu Number'a cevirip
    // literal "NaN" yazmisti (ANPA GROSS vb.). Yazma yolu korumali ama DB'de bayat
    // kayitlar kaldi → okuma sirasinda null'a cek ve DB'yi kalici temizle.
    const badFaturaNoRe = /^(?:nan|null|undefined)$/i;
    const nanRows = rows.filter((row: any) => row.faturaNo && badFaturaNoRe.test(String(row.faturaNo).trim()));
    if (nanRows.length) {
      await (this.prisma as any).eFaturaInbox.updateMany({
        where: { tenantId, id: { in: nanRows.map((row: any) => row.id) } },
        data: { faturaNo: null },
      });
      nanRows.forEach((row: any) => { row.faturaNo = null; });
    }
    const isSyntheticTurmobInboxXml = (xml: any) => {
      const text = String(xml || '').trim();
      if (!text) return false;
      return /<cbc:Note>\s*TURMOB_SUMMARY_ONLY\s*<\/cbc:Note>/i.test(text)
        || /<cbc:Name>\s*TURMOB_LISTE_OZETI\s*<\/cbc:Name>/i.test(text)
        || /<cbc:ID>\s*TURMOB-SUMMARY/i.test(text)
        || /<Item>\s*<Name>Fatura satiri<\/Name>\s*<\/Item>/i.test(text)
        || (/<Invoice>\s*<ProfileID>/i.test(text) && !/\sxmlns[:=]/i.test(text));
    };
    const missingOriginalDocument = (row: any) => {
      if (String(row?.entegrator || '').toUpperCase() !== 'TURMOB_EFATURA') return false;
      const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
      const downloadStatus = String(raw?.documentDownloadStatus || '').toUpperCase();
      const visual = raw?.originalVisual && typeof raw.originalVisual === 'object' ? raw.originalVisual : null;
      const visualHtml = String(visual?.html || '');
      const fakeTurmobVisual = /TURMOB liste verisiyle|Orijinal belge goruntusu indirilemedi|Fatura satiri/i.test(visualHtml);
      const hasOriginalVisual = !!visual && (
        (/pdf/i.test(String(visual.mimeType || '')) && Boolean(visual.base64)) ||
        (/html/i.test(String(visual.mimeType || '')) && Boolean(visual.html) && !fakeTurmobVisual)
      );
      // SAĞLAM UBL XML = orijinal belge VAR (görsel opsiyonel). Görsel inmese de belge XML'den
      //   oluşur/okunur → "inemedi" sayma. (TORA PETROL gibi 372KB çok-kalemli faturalarda XML
      //   iniyor, Detay görseli inmiyordu → eskiden eksik sayılıp aktarım geri alınıyordu.)
      const hasValidXml = !!String(row?.ublXmlRaw || '').trim() && !isSyntheticTurmobInboxXml(row?.ublXmlRaw);
      if (hasValidXml) return false;
      return downloadStatus === 'MISSING'
        || downloadStatus === 'SUMMARY_ONLY'
        || fakeTurmobVisual
        || isSyntheticTurmobInboxXml(row?.ublXmlRaw)
        || !hasOriginalVisual;
    };
    const docIds = [...new Set(rows.map((row: any) => String(row.documentId || '').trim()).filter(Boolean))];
    let existingDocIds = new Set<string>();
    if (docIds.length) {
      const docWhere: any = { tenantId, id: { in: docIds } };
      if (opts.taxpayerId) docWhere.taxpayerId = opts.taxpayerId;
      const docs = await (this.prisma as any).invoiceAccountingDocument.findMany({
        where: docWhere,
        select: { id: true, source: true, sourceRefId: true },
      });
      existingDocIds = new Set(docs.map((doc: any) => String(doc.id)));
    }

    const staleRows = rows.filter((row: any) => (
      (row.documentId && !existingDocIds.has(String(row.documentId))) ||
      (!row.documentId && (row.isTransferred || row.processedAt)) ||
      (missingOriginalDocument(row) && (row.documentId || row.isTransferred || row.processedAt))
    ));
    if (staleRows.length) {
      await (this.prisma as any).eFaturaInbox.updateMany({
        where: { tenantId, id: { in: staleRows.map((row: any) => row.id) } },
        data: { documentId: null, isTransferred: false, processedAt: null },
      });
    }
    const staleIds = new Set(staleRows.map((row: any) => row.id));

    // ── AYNI FATURA BAŞKA ENTEGRATÖRDEN AKTARILMIŞ MI? (Muzaffer Bey, 2026-09-22) ──
    //   Mükellefte iki entegratör varsa (ör. Paraşüt + Mikro) aynı fatura İKİSİNDE DE görünür.
    //   Belge oluşturma tarafı zaten ETTN ile mükerrer engelliyor; ama liste, Paraşüt'ten aktarılmış
    //   faturayı Mikro satırında "aktarılabilir" gösteriyordu. Artık ETTN eşleşen muhasebe belgesi
    //   varsa satır AKTARILDI görünür (kaynağı da yazılır) → ikinci kez aktarım denenmez.
    const ettnAl = (row: any): string => {
      const dogrudan = String(row?.ettn || '').trim();
      if (dogrudan) return dogrudan.toLowerCase();
      const m = String(row?.ublXmlRaw || '').match(/<cbc:UUID>\s*([0-9a-fA-F-]{20,40})\s*<\/cbc:UUID>/);
      return m ? m[1].trim().toLowerCase() : '';
    };
    // ── BULGU 5 (2026-09-25): ÇAPRAZ EŞLEŞTİRME ANAHTARI = MÜKELLEF + YÖN + ETTN ───────────────
    //   ESKİ HÂL: harita YALNIZ ETTN ile anahtarlanıyordu. Aynı ETTN birden çok mükellefte bulunabilir
    //   (şemadaki kardeş hata çözülmüş: @@unique([tenantId, taxpayerId, entegrator, uuid]) — "aynı UUID
    //   birden çok mükellef/tenant'ta çekilebilir"). Bu yüzden A mükellefinin ALIŞ satırı, B mükellefinin
    //   aynı ETTN'li SATIŞ belgesine bağlanabiliyordu → satır "Aktarıldı" görünüyor, kullanıcı Aktar'a
    //   basmıyor, FATURA HİÇ AKTARILMIYOR (sessiz kayıp); üstüne satıra BAŞKA MÜKELLEFİN documentId'si
    //   yazılıyor (tıklanınca o mükellefin belgesi açılır → gizlilik). Yön hiç karşılaştırılmadığı için
    //   TEK mükellefte bile alış satırı satış belgesine bağlanabiliyordu.
    //   YENİ HÂL: anahtar `${taxpayerId}::${yön}::${ettn}`; belge sorgusu taxpayerId + invoiceKind da okur.
    const caprazAnahtar = (taxpayerId: any, yon: string, ettn: string): string =>
      `${String(taxpayerId || '').trim()}::${yon}::${ettn}`;
    /**
     * Gelen kutusu satırının yönü → belge yönü (invoiceKind). Aktarım yolu AYNI eşlemeyi kullanıyor
     * (fatura-muhasebelestirme.service.ts: `direction === 'OUT' ? 'SATIS' : 'ALIS'`), bu yüzden
     * rawJson.channel değil satırın `direction` kolonu esas alınır — belgeye yazılan yön oradan türüyor.
     */
    const satirYonu = (row: any): 'ALIS' | 'SATIS' =>
      (String(row?.direction || '').trim().toUpperCase() === 'OUT' ? 'SATIS' : 'ALIS');
    const capraz = new Map<string, { documentId: string; kaynak: string }>();
    const bekleyen = rows.filter((row: any) => !staleIds.has(row.id) && !row.documentId && ettnAl(row));
    // GÜVENLİ KESTİRME: mükellef verilmemişse (uç tenant genelinde çağrılmışsa) çapraz eşleştirme HİÇ
    //   çalıştırılmaz. Satırlar "aktarıldı" işaretlenmeden döner — yanlış bilgi vermekten iyidir.
    if (!opts.taxpayerId && bekleyen.length) {
      this.logger.warn(
        `[efatura-inbox] taxpayerId verilmedi → ETTN çapraz eşleştirmesi ÇALIŞTIRILMADI `
        + `(${bekleyen.length} satır "aktarıldı" işaretlenmeyecek). Mükellef seçip yeniden isteyin.`,
      );
    }
    if (opts.taxpayerId && bekleyen.length) {
      const ettnler = [...new Set(bekleyen.map(ettnAl))].slice(0, 300);
      const cesitler = ettnler.flatMap((e: string) => [e, e.toUpperCase()]);
      const tpIdler = [...new Set(bekleyen.map((row: any) => String(row.taxpayerId || '')).filter(Boolean))];
      const yonler = [...new Set(bekleyen.map(satirYonu))];
      try {
        const belgeler = await (this.prisma as any).invoiceAccountingDocument.findMany({
          where: {
            tenantId,
            ...(tpIdler.length ? { taxpayerId: { in: tpIdler } } : {}),
            ...(yonler.length ? { invoiceKind: { in: yonler } } : {}),
            OR: [
              { sourceRefId: { in: cesitler } },
              ...cesitler.map((v) => ({ ocrData: { path: ['ettn'], equals: v } })),
            ],
          },
          // taxpayerId + invoiceKind OKUNMAZSA anahtar kurulamaz → seçime eklendi.
          select: { id: true, source: true, sourceRefId: true, ocrData: true, taxpayerId: true, invoiceKind: true },
          take: 600,
        });
        for (const b of belgeler) {
          const belgeTp = String((b as any)?.taxpayerId || '').trim();
          const belgeYon = String((b as any)?.invoiceKind || '').trim().toUpperCase();
          // Mükellefi ya da yönü belirsiz belgeye BAĞLAMA (yanlış eşleşmektense hiç eşleşmesin).
          if (!belgeTp || (belgeYon !== 'ALIS' && belgeYon !== 'SATIS')) continue;
          const anahtarlar = [String(b.sourceRefId || ''), String((b as any)?.ocrData?.ettn || '')]
            .map((x) => x.trim().toLowerCase()).filter(Boolean);
          for (const a of anahtarlar) {
            const k = caprazAnahtar(belgeTp, belgeYon, a);
            if (!capraz.has(k)) capraz.set(k, { documentId: String(b.id), kaynak: String(b.source || '') });
          }
        }
      } catch (err: any) {
        this.logger.warn(`[efatura-inbox] ETTN çapraz eşleştirmesi başarısız: ${err?.message || err}`);
      }
    }
    /** 'integration-parasut' → 'Paraşüt' gibi okunur kaynak adı. */
    const kaynakAdi = (kaynak: string): string => {
      const k = String(kaynak || '').toLowerCase().replace(/^integration-/, '');
      const sozluk: Record<string, string> = {
        parasut: 'Paraşüt', mikro: 'Mikro', turkcell: 'Turkcell', eczacikart: 'Eczacıkart',
        elogo: 'eLogo', uyumsoft: 'Uyumsoft', izibiz: 'İzibiz', turmob_efatura: 'TÜRMOB',
        'manual-web': 'elle yükleme', mobile: 'mobil', mihsap: 'Mihsap', luca: 'Luca',
      };
      return sozluk[k] || (k ? k.toUpperCase() : 'başka kaynak');
    };

    // BULGU 6: kırpılma bilgisi satırlara da yazılır — liste dizi döndüğü için (iki çağıran da dizi
    //   bekliyor) tek yer burası; sessiz eksik kalmasın, API yanıtında iz kalsın.
    const kirpikBilgi = listeKirpildi
      ? { listeKirpildi: true, listeKirpildiBilgi: `Süzgece uyan satır ${limit} sınırını aştı; liste eksik.` }
      : null;
    return rows
      .slice(0, limit)
      .map((row: any) => {
        const linkedDocId = row.documentId && existingDocIds.has(String(row.documentId)) ? String(row.documentId) : null;
        const hasAccountingDocument = !!linkedDocId;
        // KARŞI TARAF ÜNVANI (kullanıcı bulgusu 2026-08-20: "ünvan kısmında vergi numarası görünüyor"):
        //   efatura_inbox'ta ALICI ünvanı için kolon YOK (yalnız senderTitle var) ve GİDEN faturada
        //   senderTitle mükellefin kendisidir ("Mükellef" yer tutucusu) → ekran alıcı adını bulamayıp
        //   VKN'ye düşüyordu. Ad aslında UBL XML'in içinde duruyor; okuyup döndürüyoruz. Şema
        //   değişikliği/migrasyon GEREKMEZ, mevcut kayıtlarda da anında düzelir.
        const receiverTitle = row.receiverTitle || partyTitleFromUbl(row.ublXmlRaw, 'CUSTOMER');
        const senderTitle = isPlaceholderTitle(row.senderTitle)
          ? (partyTitleFromUbl(row.ublXmlRaw, 'SUPPLIER') || row.senderTitle)
          : row.senderTitle;
        if (staleIds.has(row.id) || missingOriginalDocument(row)) {
          return { ...row, ...kirpikBilgi, senderTitle, receiverTitle, documentId: null, isTransferred: false, processedAt: null, hasAccountingDocument: false };
        }
        // Başka entegratörden AKTARILMIŞ aynı fatura (ETTN eşleşmesi) → satır "Aktarıldı" görünür.
        //   BULGU 5: arama anahtarı satırın MÜKELLEFİ + YÖNÜ + ETTN'i — başka mükellefin ya da ters
        //   yöndeki belgeye bağlanmaz.
        if (!hasAccountingDocument) {
          const satirEttn = ettnAl(row);
          const bulunan = satirEttn
            ? capraz.get(caprazAnahtar(row.taxpayerId, satirYonu(row), satirEttn))
            : undefined;
          if (bulunan) {
            return {
              ...row, ...kirpikBilgi, senderTitle, receiverTitle,
              documentId: bulunan.documentId, isTransferred: true, hasAccountingDocument: true,
              baskaKaynaktanAktarildi: true, aktarimKaynagi: kaynakAdi(bulunan.kaynak),
            };
          }
        }
        return { ...row, ...kirpikBilgi, senderTitle, receiverTitle, documentId: linkedDocId || null, isTransferred: hasAccountingDocument, hasAccountingDocument };
      });
  }

  /**
   * Bir tenant altındaki tüm entegratör bağlantılarını sync et.
   * Kimlik bilgileri config.taxpayers[key] içinde şifreli saklanır —
   * tryDecrypt ile açılarak adapter'a iletilir.
   */
  async syncAll(
    tenantId: string,
    opts: {
      direction?: 'IN' | 'OUT';
      /**
       * PLAN/16 §H: yalnız bu mükellef × sağlayıcı çiftleri senkronlansın (gece cron'u talimat=true olanları verir).
       * Verilmezse eski davranış (bağlantısı olan HER mükellef). Boş dizi → hiçbir şey senkronlanmaz.
       */
      only?: Array<{ taxpayerId: string; provider: string }>;
    } = {},
  ): Promise<{ added: number; skipped: number; errors: string[]; connections: number }> {
    if (!ESKI_SYNC_ACIK()) {
      this.logger.warn(`syncAll çağrıldı ama eski adaptör senkronu KAPALI (tenant ${tenantId}) — ana yol fetchConfiguredIntegrations.`);
      return { added: 0, skipped: 0, errors: [], connections: 0 };
    }
    const connections = await (this.prisma as any).integrationConnection.findMany({
      where: {
        tenantId,
        isActive: true,
        provider: { in: SUPPORTED_PROVIDERS },
      },
    });

    let totalAdded = 0;
    let totalSkipped = 0;
    const totalErrors: string[] = [];
    const izinli = Array.isArray(opts.only)
      ? new Set(opts.only.map((o) => `${String(o.provider || '').toUpperCase()}|${o.taxpayerId}`))
      : null;

    for (const conn of connections) {
      const cfg: any = conn.config || {};
      const taxpayers: Record<string, any> = cfg.taxpayers || {};

      const entries = Object.entries(taxpayers).filter(([k, v]) => v && k !== 'global'
        && (!izinli || izinli.has(`${String(conn.provider).toUpperCase()}|${k}`)));
      // Süzgeç verildiyse 'global' kimlik bilgisiyle toplu senkron YAPILMAZ (mükellef bazlı anahtar kuralı).
      if (izinli && entries.length === 0) continue;

      if (entries.length > 0) {
        for (const [taxpayerId, tpCfg] of entries) {
          const tp: any = tpCfg || {};
          const credentials: EFaturaCredentials = {
            username: tp.username || '',
            password: tryDecrypt(tp.encryptedPassword) || '',
            apiKey: tryDecrypt(tp.encryptedApiKey) || '',
            apiSecret: tryDecrypt(tp.encryptedApiSecret) || '',
            baseUrl: tp.baseUrl || cfg.baseUrl || '',
            firmaNo: tp.firmaNo || cfg.firmaNo || '',
          };
          const r = await this.syncTaxpayer(tenantId, taxpayerId, conn.provider, credentials, opts);
          totalAdded += r.added;
          totalSkipped += r.skipped;
          totalErrors.push(...r.errors);
        }
      } else {
        const global: any = taxpayers.global || {};
        const credentials: EFaturaCredentials = {
          username: global.username || '',
          password: tryDecrypt(global.encryptedPassword) || '',
          apiKey: tryDecrypt(global.encryptedApiKey) || '',
          apiSecret: tryDecrypt(global.encryptedApiSecret) || '',
          baseUrl: global.baseUrl || cfg.baseUrl || '',
          firmaNo: global.firmaNo || cfg.firmaNo || '',
        };
        const r = await this.syncTaxpayer(tenantId, 'global', conn.provider, credentials, opts);
        totalAdded += r.added;
        totalSkipped += r.skipped;
        totalErrors.push(...r.errors);
      }
    }

    return { added: totalAdded, skipped: totalSkipped, errors: totalErrors, connections: connections.length };
  }
}
