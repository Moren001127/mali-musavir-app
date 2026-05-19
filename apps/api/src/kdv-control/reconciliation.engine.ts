import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KdvRecord, ReceiptImage, SessionStatus } from '@prisma/client';
import { detectDoubleOrphans } from '@mali-musavir/shared';
import { isAggregateLucaRecord } from './luca-row-filter';
import { formatAmountTr, parseMoneyLike, parseTrUsAmount } from './reconciliation/validators/amount-check';
import { formatTrDate, likelyOcrYearMisread, parseTrDate, sameDay } from './reconciliation/validators/date-helpers';
import {
  eInvoiceComparableKey,
  normalizeBelgeNo,
  sameBelgeNo,
  stringSimilarity,
  stripLeadingZeros,
} from './reconciliation/validators/belge-no-check';
import {
  buildAmbiguousDocDateAmountKeys as buildKdvAmbiguousDocDateAmountKeys,
  companyNameSimilarity as kdvCompanyNameSimilarity,
  hasSellerMatch as hasKdvSellerMatch,
  hasStrongTwoOfThree as hasKdvStrongTwoOfThree,
  inferRecordRate as inferKdvRecordRate,
  isAccountingDescription as isKdvAccountingDescription,
  recordDocDateAmountKey as kdvRecordDocDateAmountKey,
  recordDocDateKey as kdvRecordDocDateKey,
  recordPartyKey as kdvRecordPartyKey,
  stripLucaDescriptionDocumentSuffix as stripKdvLucaDescriptionDocumentSuffix,
} from './reconciliation/validators/record-helpers';
import { scoreToStatus } from './reconciliation/status/score-to-status';
import { aggregateMultiRateRecords as aggregateKdvMultiRateRecords } from './reconciliation/matching/multi-rate-aggregate';

export interface MatchCandidate {
  kdvRecord: KdvRecord;
  image: ReceiptImage;
  score: number;
  reasons: string[];
  strictMatch: boolean;
}

/** OCR breakdown JSON yapısı — KDV kontrolünde sadece oran + KDV tutarı eşleşir. */
interface BreakdownItem {
  oran: number;
  tutar: number;
  matrah?: number | null;
}

const E_BELGE_NO_REGEX = /^(?:[A-Z]{2,4}\d{12,14}|[A-Z]\d{2}20\d{2}\d{6,12}|\d{13,20})$/;

/**
 * Image'ın breakdown'unu al — onaylanmış varsa onu, yoksa OCR'dakini.
 * Format normalizasyonu yapar (string → number).
 */
function getImageBreakdown(image: ReceiptImage): BreakdownItem[] {
  const raw = (image.confirmedKdvBreakdown ?? image.ocrKdvBreakdown) as any;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it: any) => {
      const oran = typeof it?.oran === 'number' ? it.oran : parseFloat(String(it?.oran || 0));
      const tutar = typeof it?.tutar === 'number'
        ? it.tutar
        : parseFloat(String(it?.tutar || '0').replace(/\./g, '').replace(',', '.'));
      return {
        oran: Number.isFinite(oran) ? oran : 0,
        tutar: Number.isFinite(tutar) ? tutar : 0,
        matrah: null,
      };
    })
    .filter((b: BreakdownItem) => b.tutar > 0);
}

@Injectable()
export class ReconciliationEngine {
  private readonly logger = new Logger(ReconciliationEngine.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Bir oturumdaki tüm KDV kayıtları ile görselleri eşleştirir.
   */
  async runReconciliation(sessionId: string): Promise<{
    matched: number;
    partial: number;
    unmatched: number;
    needsReview: number;
  }> {
    // Sonuç yazımı aşağıda transaction + advisory lock ile yapılır. Böylece aynı
    // oturuma iki kontrol aynı anda gelirse sonuç tablosu çift yazılmaz.

    // Session type — alış/satış ayrımı için (tevkifat farkı kontrolü ALIŞ'ta
    // devreye girer, SATIŞ'ta atlanır — Türk muhasebe pratiğine göre alışlarda
    // Luca'da 2 satır gelir, satışlarda tek)
    const session = await this.prisma.kdvControlSession.findUnique({
      where: { id: sessionId },
      select: { type: true },
    });
    // KDV_191 = Bilanço Alış, ISLETME_GIDER = İşletme Alış → ALIŞ
    // KDV_391 = Bilanço Satış, ISLETME_GELIR = İşletme Satış → SATIŞ
    const isAlis = session?.type === 'KDV_191' || session?.type === 'ISLETME_GIDER';
    const isIsletme = session?.type === 'ISLETME_GIDER' || session?.type === 'ISLETME_GELIR';

    const [allRawRecords, images] = await Promise.all([
      this.prisma.kdvRecord.findMany({ where: { sessionId } }),
      this.prisma.receiptImage.findMany({ where: { sessionId } }),
    ]);
    const rawRecords = allRawRecords.filter((record) => !isAggregateLucaRecord(record));
    const skippedAggregateRecords = allRawRecords.length - rawRecords.length;
    if (skippedAggregateRecords > 0) {
      this.logger.log(`Luca toplam/nakli yekun satirlari reconciliation disinda birakildi: ${skippedAggregateRecords}`);
    }

    // ═══════════════════════════════════════════════════════
    // ÇOK ORANLI KDV AGGREGATE — Luca'dan gelen kontrol verisinde
    // aynı belge için farklı KDV oranları ayrı satırlar olarak gelir
    // (ör: aynı faturada %20 + %10). Fatura görselinde ise KDV tek
    // toplam olarak çıkar. Matching'i doğru yapmak için aynı
    // (belge no + tarih) kombinasyonundaki satırları sanal olarak
    // TOPLAYIP tek "virtual record" üretiyoruz; match sonucunu
    // orijinal satırların hepsine fan-out ediyoruz.
    //
    // ÖRNEK:
    //   Luca: [ESR...1204/2026-03-23/kdv=116, ESR...1204/2026-03-23/kdv=42]
    //   Fatura: ESR...1204/2026-03-23/kdv=158
    //   → Virtual: ESR...1204/2026-03-23/kdv=158 → Fatura ile eşleşir
    //   → Sonuç: her iki Luca satırı da bu fatura ile MATCHED işaretlenir
    // ═══════════════════════════════════════════════════════
    const { records, virtualGroups, virtualExpectedBreakdown, virtualOriginalKdvAmounts } = this.aggregateMultiRateRecords(rawRecords, isAlis);
    const ambiguousDocDateAmountKeys = this.buildAmbiguousDocDateAmountKeys(records);

    // Mihsap kaynaklı görseller için Mihsap'ın kayıtlı belge tarihini topla.
    // Bu, Luca evrak tarihi ile OCR fiş tarihi arasında fark varsa
    // "Mihsap bu faturaya belge tarihi olarak ne atamış?" sorusunun yanıtı.
    const mihsapBelgeTarihleri: Record<string, Date | null> = {};
    const mihsapInvoiceIds: string[] = images
      .filter((img) => img.s3Key?.startsWith('mihsap://'))
      .map((img) => img.s3Key!.slice('mihsap://'.length));
    if (mihsapInvoiceIds.length > 0) {
      const invoices = await (this.prisma as any).mihsapInvoice.findMany({
        where: { id: { in: mihsapInvoiceIds } },
        select: { id: true, faturaTarihi: true },
      });
      for (const inv of invoices) {
        mihsapBelgeTarihleri[`mihsap://${inv.id}`] =
          inv.faturaTarihi ? new Date(inv.faturaTarihi) : null;
      }
    }

    const usedImageIds = new Set<string>();
    const usedRecordIds = new Set<string>();
    const createData: any[] = [];

    // Virtual record match sonucunu orijinal satırların hepsine fan-out et.
    // Tek imageId, birden çok kdvRecordId — her biri ayrı ReconciliationResult
    // satırı. Eski @unique kısıtı migration ile kaldırıldı
    // (20260418170000_reconciliation_drop_unique), artık aynı imageId birden
    // fazla kayıt için kullanılabilir.
    const fanOutMatch = (
      record: KdvRecord,
      imageId: string,
      status: string,
      score: number,
      reasons: string[],
    ) => {
      const originalIds = virtualGroups.get(record.id) ?? [record.id];
      for (const origId of originalIds) {
        usedRecordIds.add(origId);
        createData.push({
          sessionId,
          kdvRecordId: origId,
          imageId,
          status,
          matchScore: score,
          mismatchReasons: reasons,
        });
      }
    };

    // ═══════════════════════════════════════════════════════
    // PASS 1 — STRICT EŞLEŞMELER (belge no + KDV + tarih tam aynı)
    // ═══════════════════════════════════════════════════════
    // Greedy sıra bazlı eşleştirmenin klasik sorunu: zayıf skorlu eşleşmeler
    // (örn. Luca 0025/676,04 ↔ Fatura 0002/669,83, sadece KDV benzer)
    // güçlü strict eşleşmeleri çalıyor. Çözüm: önce tüm strict eşleşmeleri
    // sabitle — belge no + KDV + tarih hepsi tam aynıysa bu belge AYNI belge,
    // başka hiçbir şeye bakma.
    for (const record of records) {
      if (usedRecordIds.has(record.id)) continue;
      for (const image of images) {
        if (usedImageIds.has(image.id)) continue;
        const mihsapBelgeTarihi = mihsapBelgeTarihleri[image.s3Key || ''] ?? null;
        const expectedBreakdown = virtualExpectedBreakdown.get(record.id) || null;
        const originalKdvList = virtualOriginalKdvAmounts.get(record.id) || null;
        const sameDocDateAmbiguous = ambiguousDocDateAmountKeys.has(this.recordDocDateAmountKey(record) || '');
        const { score, reasons, strictMatch } = this.calculateScore(
          record,
          image,
          mihsapBelgeTarihi,
          expectedBreakdown,
          isAlis,
          originalKdvList,
          sameDocDateAmbiguous,
          isIsletme,
        );
        if (strictMatch) {
          usedImageIds.add(image.id);
          fanOutMatch(record, image.id, 'MATCHED', score, reasons);
          break; // bu kayıt eşleşti, sıradakine geç
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // PASS 2 — GEVŞEK EŞLEŞMELER (GLOBAL GREEDY — drift-proof)
    // ═══════════════════════════════════════════════════════
    // ÖNCEKİ (hatalı) yaklaşım: her record sırayla gelir, kalan görsellerden
    // en yüksek skorluyu kapardı. Sorun: Record A için skor 0.39 olan
    // Image X atanırken, aslında Record B onu 0.85'le bulacakken Record B
    // sırası gelince zaten X kullanılmış olurdu → "drift" — her Luca kaydı
    // bir sonraki kaydın fişine bağlanırdı.
    //
    // YENİ yaklaşım: TÜM (record × image) çiftlerinin skorunu hesapla,
    // en yüksekten aşağıya doğru bağla. Hem record hem image kullanılmamışsa
    // eşleştir. Böylece en güvenli pairler ÖNCE sabitlenir, zayıflar
    // güçlüleri çalamaz.
    // Eşik 0.4 → 0.55: yalnızca güçlü adaylar listede kalır.
    // Plus: belgeNo TAM eşleşmiyorsa (reasons'da "uyumsuz" varsa) eleyerek
    // alakasız belge no'ların zorla pair olmasını engelle (örn. 0015 ↔ 0888).
    const MIN_PAIR_SCORE = 0.55;
    const allPairs: MatchCandidate[] = [];
    for (const record of records) {
      if (usedRecordIds.has(record.id)) continue;
      for (const image of images) {
        if (usedImageIds.has(image.id)) continue;
        const mihsapBelgeTarihi = mihsapBelgeTarihleri[image.s3Key || ''] ?? null;
        const expectedBreakdown = virtualExpectedBreakdown.get(record.id) || null;
        const originalKdvList = virtualOriginalKdvAmounts.get(record.id) || null;
        const sameDocDateAmbiguous = ambiguousDocDateAmountKeys.has(this.recordDocDateAmountKey(record) || '');
        const { score, reasons, strictMatch } = this.calculateScore(
          record,
          image,
          mihsapBelgeTarihi,
          expectedBreakdown,
          isAlis,
          originalKdvList,
          sameDocDateAmbiguous,
          isIsletme,
        );
        // Belge no exact uyumsuzluğu varsa pair'i ele
        const strongTwoOfThree = this.hasStrongTwoOfThree(record, image, mihsapBelgeTarihi);
        const hardBelgeNoMismatch = reasons.some((r) =>
          /Belge no uyumsuz|E-fatura belge no/i.test(r),
        );
        const hardRateMismatch = reasons.some((r) =>
          /KDV\s+oran/i.test(r) || (/oran/i.test(r) && /bulunamad/i.test(r)),
        );
        const belgeNoTamUyumsuz = hardBelgeNoMismatch || hardRateMismatch;
        const saticiTamUyumsuz = reasons.some((r) =>
          /VKN\/TCKN uyumsuz|Satıcı uyumsuz/i.test(r),
        );
        const ambiguousSellerMissing = isAlis && !isIsletme && sameDocDateAmbiguous && !this.hasSellerMatch(record, image);
        const belgeNoExactPair = this.sameBelgeNo(record.belgeNo || '', image.confirmedBelgeNo || image.ocrBelgeNo || '');
        const belgeNoMismatchAllowedForReview = strongTwoOfThree && hardBelgeNoMismatch && !hardRateMismatch;
        const blocksPair =
          (belgeNoTamUyumsuz && !belgeNoMismatchAllowedForReview) ||
          (saticiTamUyumsuz && reasons.some((r) => /VKN\/TCKN uyumsuz/i.test(r))) ||
          ambiguousSellerMissing;
        if ((score >= MIN_PAIR_SCORE || belgeNoExactPair || strongTwoOfThree) && !blocksPair) {
          allPairs.push({ kdvRecord: record, image, score, reasons, strictMatch });
        }
      }
    }

    // En yüksek skorlu çiftten aşağıya. Eşit skor durumunda: belge no benzerliği
    // yüksek olan, sonra KDV tutarı eşleşmesi olan öncelikli — drift yerine
    // doğru eşleşmeyi tercih eder.
    allPairs.sort((a, b) => b.score - a.score);
    for (const pair of allPairs) {
      if (usedRecordIds.has(pair.kdvRecord.id)) continue;
      if (usedImageIds.has(pair.image.id)) continue;
      usedImageIds.add(pair.image.id);
      const mihsapBelgeTarihi = mihsapBelgeTarihleri[pair.image.s3Key || ''] ?? null;
      const belgeNoExactPair = this.sameBelgeNo(
        pair.kdvRecord.belgeNo || '',
        pair.image.confirmedBelgeNo || pair.image.ocrBelgeNo || '',
      );
      const strongTwoOfThree = this.hasStrongTwoOfThree(pair.kdvRecord, pair.image, mihsapBelgeTarihi);
      const hardBelgeNoMismatch = pair.reasons.some((r) =>
        /Belge no uyumsuz|E-fatura belge no/i.test(r),
      );
      const status = this.scoreToStatus(pair.score, pair.image, pair.strictMatch, belgeNoExactPair || (strongTwoOfThree && !hardBelgeNoMismatch));
      fanOutMatch(pair.kdvRecord, pair.image.id, status, pair.score, pair.reasons);
    }

    // Kalan ORIJINAL recordlar — eşleşen görsel bulunamadı.
    // Virtual record kullandığımız için rawRecords üzerinden yürüyoruz.
    for (const record of rawRecords) {
      if (usedRecordIds.has(record.id)) continue;
      createData.push({
        sessionId,
        kdvRecordId: record.id,
        imageId: null,
        status: 'UNMATCHED',
        matchScore: 0,
        mismatchReasons: ['Eşleşen görsel bulunamadı (skor eşiği altında)'],
      });
    }

    // ═══════════════════════════════════════════════════════
    // PASS 3 — ORPHAN GÖRSELLER (Luca'da karşılığı olmayan faturalar)
    // ═══════════════════════════════════════════════════════
    for (const image of images) {
      if (!usedImageIds.has(image.id)) {
        createData.push({
          sessionId,
          kdvRecordId: null,
          imageId: image.id,
          status: 'UNMATCHED',
          matchScore: 0,
          mismatchReasons: ['Eşleşen Excel kaydı bulunamadı'],
        });
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        await (tx as any).$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
        await tx.reconciliationResult.deleteMany({ where: { sessionId } });
        if (createData.length > 0) {
          if (typeof (tx.reconciliationResult as any).createMany === 'function') {
            await tx.reconciliationResult.createMany({ data: createData });
          } else {
            for (const data of createData) {
              await tx.reconciliationResult.create({ data });
            }
          }
        }
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    // İstatistik
    const stats = createData.reduce(
      (acc, d) => {
        if (d.status === 'MATCHED') acc.matched++;
        else if (d.status === 'PARTIAL_MATCH') acc.partial++;
        else if (d.status === 'NEEDS_REVIEW') acc.needsReview++;
        else acc.unmatched++;
        return acc;
      },
      { matched: 0, partial: 0, unmatched: 0, needsReview: 0 },
    );

    // ─── INVARIANT CHECK (Faz 0 modül-izolasyon kontratı) ──────
    // Engine kendi çıktısını doğrular: aynı record veya image hem MATCHED hem
    // UNMATCHED yazılmamış olmalı. İhlal varsa logger.error + sessionId ile
    // alarm — bug üretildiği anda fark edilir, kullanıcı Excel'i alıp anlayana
    // kadar beklemez. Geriye dönük observability için DB'ye düşmüyor; log
    // tabanlı izlemek yeterli.
    try {
      const violations = detectDoubleOrphans(createData);
      if (violations.length > 0) {
        this.logger.error(
          `[INVARIANT] Çift orphan tespit edildi · sessionId=${sessionId} · ihlal=${violations.length} · örnek=${JSON.stringify(violations.slice(0, 3))}`,
        );
      }
    } catch (e: any) {
      // İhlal kontrolü engine akışını bozmasın — sadece log
      this.logger.warn(`[INVARIANT] Çift-orphan kontrolü hata verdi: ${e?.message}`);
    }

    // Oturum durumunu güncelle
    const nextSessionStatus =
      stats.matched > 0 && stats.partial === 0 && stats.unmatched === 0 && stats.needsReview === 0
        ? SessionStatus.COMPLETED
        : SessionStatus.REVIEWING;

    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: nextSessionStatus },
    });

    this.logger.log(
      `Reconciliation tamamlandı: ${JSON.stringify(stats)}`,
    );
    return stats;
  }

  /**
   * KDV kaydı ile görsel arasındaki eşleşme skorunu hesaplar.
   *
   * İki farklı belge kategorisi var:
   *
   * A) E-FATURA / E-ARŞİV (belge no ≥ 10 hane, ör: "E152026000005355"):
   *    Belge no benzersiz olduğundan tarih kriteri GEREKSIZ.
   *    Belge no + KDV tutarı yeterli. Mükellef fişi geç getirdiyse
   *    Mihsap kayıt dönemine göre zaten doğru aya bağlanır — tarih
   *    karşılaştırılmaz.
   *
   * B) ÖKC FİŞİ (belge no ≤ 6 hane, ör: "0014", "0316"):
   *    Belge no benzersiz DEĞİL (aynı seri farklı günlerde tekrar
   *    eder). Bu yüzden tarih karşılaştırılmak ZORUNDA. Tarih
   *    uyumsuzsa MATCHED olmaz.
   */
  private calculateScore(
    record: KdvRecord,
    image: ReceiptImage,
    mihsapBelgeTarihi: Date | null = null,
    /** Multi-rate virtual record için Luca tarafının beklediği breakdown.
     *  Verildiyse OCR breakdown'u ile kalem-kalem karşılaştırılır. */
    expectedBreakdown: Array<{ oran: number; tutar: number }> | null = null,
    /** ALIŞ session'ı mı? Tevkifat farkı kontrolü sadece ALIŞ'ta devreye girer
     *  (Luca'da NET + Tevkifat ayrı satır → aggregate ile TAM olur, OCR NET ile
     *  karşılaştırınca fark çıkar; tevkifat ekleyerek MATCHED yakalanır).
     *  SATIŞ'ta Luca zaten NET kaydeder → fark olmamalı. */
    isAlis: boolean = false,
    /** Aggregate edilen virtual record için orijinal Luca satırlarındaki KDV
     *  tutarları. ALIŞ'ta Luca'da NET satırı + Tevkifat satırı ayrı kayıtlar;
     *  bunlardan biri OCR NET ile eşleşiyorsa AYNI BELGE'dir. */
    originalRecordKdvList: number[] | null = null,
    sameDocDateAmbiguous: boolean = false,
    isIsletme: boolean = false,
  ): { score: number; reasons: string[]; strictMatch: boolean } {
    const imgBelgeNo = image.confirmedBelgeNo || image.ocrBelgeNo;
    const imgDate = image.confirmedDate || image.ocrDate;
    const imgKdv = image.confirmedKdvTutari || image.ocrKdvTutari;
    const imgTevkifat = parseMoneyLike(
      (image as any).confirmedKdvTevkifat ?? (image as any).ocrKdvTevkifat,
    );

    // Belge kategorisi: uzun belge no → e-fatura/e-arşiv; kısa → ÖKC fiş
    const belgeNoLen = (record.belgeNo || imgBelgeNo || '').replace(/[^A-Z0-9]/gi, '').length;
    const isOkcFisi = belgeNoLen > 0 && belgeNoLen <= 6;

    let score = 0;
    const reasons: string[] = [];
    let belgeNoExact = false;
    let kdvExact = false;
    let dateExact = false;
    let rateExact = false;       // KDV oranı eşleşti mi (multi-rate kontrolü için)
    let rateMismatched = false;  // Oran kesin uyumsuz (ör. Luca %20, OCR breakdown'unda %20 yok)

    // ── BELGE NO ─────────────────────────────────────────────
    // E-fatura format'ı (genelde 3 harf + 13 rakam; bazı kurumlarda 2 harf + 14 rakam):
    // TAM EŞLEŞME ZORUNLU.
    //   Bu numaralar GİB tarafından merkezi atanır, yıllık seri unique. 1 karakter
    //   farkı bile FARKLI BELGE'dir (örn. GIB...0008 ≠ GIB...0007). Fuzzy match yok.
    // ÖKC fişi (≤6 char): Leading zero stripped tam eşleşme.
    // Diğer (gider pusulası/SMM/dekont): %95+ similarity ile kısmi (1 karakter
    //   tolerans uzun belge no'larda).
    const belgeNoWeight = isOkcFisi ? 0.45 : 0.7;
    const isEFaturaFormat = (s: string): boolean => E_BELGE_NO_REGEX.test(s);
    if (record.belgeNo && imgBelgeNo) {
      const normA = this.normalizeBelgeNo(record.belgeNo);
      const normB = this.normalizeBelgeNo(imgBelgeNo);
      // Leading zero-stripped karşılaştırma — "0599" = "599"
      // ÖKC fişlerde Luca genelde sıfır önekli kayıt ("0599"), OCR çıplak ("599")
      const strippedA = this.stripLeadingZeros(normA);
      const strippedB = this.stripLeadingZeros(normB);

      const isEFaturaPair = isEFaturaFormat(normA) || isEFaturaFormat(normB);

      if (this.sameBelgeNo(record.belgeNo, imgBelgeNo)) {
        // Tam aynı veya leading-zero eşiti → exact
        score += belgeNoWeight;
        belgeNoExact = true;
      } else if (isEFaturaPair) {
        // E-FATURA: 1 karakter farkı bile farklı belge — fuzzy match YOK
        // Reason'a yaz, score'a hiç katma → bu çift kesinlikle MATCHED OLMAYACAK
        reasons.push(`E-fatura belge no farklı: ${record.belgeNo} ≠ ${imgBelgeNo}`);
      } else {
        // Diğer (kısa/karışık) belge no — eski Levenshtein, ama daha sıkı eşik
        const simRaw = this.stringSimilarity(normA, normB);
        const simStripped = this.stringSimilarity(strippedA, strippedB);
        const similarity = Math.max(simRaw, simStripped);
        if (similarity >= 0.95) {
          // %95+ similarity (1 karakter farkı 20+ char'da) — exact kabul
          score += belgeNoWeight;
          belgeNoExact = true;
        } else if (similarity >= 0.85) {
          // v1.36.64: %75 → %85 sıkılaştırma. Kısa belge no'larda (4-5 hane) %75 çok loose,
          // permutasyon (0125 ↔ 0521) yanlış match'leri geçirebiliyordu.
          score += belgeNoWeight * 0.55;
          reasons.push(`Belge no kısmi: ${record.belgeNo} ≠ ${imgBelgeNo}`);
        } else {
          reasons.push(`Belge no uyumsuz: ${record.belgeNo} ≠ ${imgBelgeNo}`);
        }
      }
    } else if (!record.belgeNo || !imgBelgeNo) {
      score += 0.15;
      reasons.push(!imgBelgeNo ? 'Görselde belge no okunamadı' : 'Luca kaydında belge no yok');
    }

    // ── KDV TUTARI + ORAN ─────────────────────────────────
    // Multi-rate fix: Luca kaydında bir oran (örn. %20) varsa, OCR breakdown'unda
    // o oranın bulunup bulunmadığı ve tutarın eşleşip eşleşmediği kontrol edilir.
    // Çok oranlı faturalarda virtual record (aggregate) kullanıldığında ise
    // kdvOrani=null gelir → klasik toplam karşılaştırması yapılır.
    const recordRate = this.inferRecordRate(record);
    const imageBreakdown = this.normalizeImageBreakdownRates(image, getImageBreakdown(image));
    const rateAwareImageBreakdown = imageBreakdown.filter((b) => b.oran > 0);

    // v1.36.64: Çelişki düzeltmesi — virtual multi-rate record + breakdown varsa
    // klasik toplam kontrolü skip edilsin (line 547'deki kalem-kalem kontrol yeterli).
    // Önceden hem toplam bonus hem kalem uyumsuzluk warning aynı anda yazılıyordu.
    const hasMultiRateBreakdown =
      expectedBreakdown && expectedBreakdown.length > 1 && rateAwareImageBreakdown.length > 0;

    if (record.kdvTutari && imgKdv && !hasMultiRateBreakdown) {
      const recordKdv = parseFloat(record.kdvTutari.toString());

      // Bu BİR ORANLI Luca kaydı + OCR breakdown var → oran-bazlı karşılaştırma
      if (recordRate != null && recordRate > 0 && rateAwareImageBreakdown.length > 0) {
        const matchingItem = rateAwareImageBreakdown.find(
          (b) => Math.abs(b.oran - recordRate) < 0.5,
        );
        if (matchingItem) {
          // Oran var — şimdi KDV tutarını kıyasla. Burada matrah üzerinden
          // KDV türetmiyoruz; OCR matrahı KDV diye okuduysa sonuç incelemeye kalmalı.
          rateExact = true;
          const candidates = [
            { amount: matchingItem.tutar, label: 'NET' },
            ...(!isAlis && imgTevkifat > 0 && matchingItem.tutar > imgTevkifat
              ? [{ amount: matchingItem.tutar - imgTevkifat, label: 'TAM-Tevkifat' }]
              : []),
            ...(isAlis && imgTevkifat > 0 && imageBreakdown.length === 1
              ? [{ amount: matchingItem.tutar + imgTevkifat, label: 'NET+Tevkifat' }]
              : []),
          ];
          const best = candidates
            .map((c) => ({
              ...c,
              diff: Math.abs(c.amount - recordKdv) / (recordKdv || 1),
            }))
            .sort((a, b) => a.diff - b.diff)[0];
          const diff = best?.diff ?? 1;
          if (diff < 0.01) {
            score += 0.3;
            kdvExact = true;
            if (best?.label === 'NET+Tevkifat') {
              reasons.push(
                `%${recordRate} alış tevkifat eşleşmesi: Luca ${this.fmtAmt(recordKdv)} = Fatura ${this.fmtAmt(matchingItem.tutar)} NET + ${this.fmtAmt(imgTevkifat)} tevkifat`,
              );
            } else if (best?.label === 'TAM-Tevkifat') {
              reasons.push(
                `%${recordRate} satış tevkifat eşleşmesi: Luca ${this.fmtAmt(recordKdv)} = Fatura ${this.fmtAmt(matchingItem.tutar)} TAM - ${this.fmtAmt(imgTevkifat)} tevkifat`,
              );
            }
          } else if (diff < 0.05) {
            score += 0.12;
            reasons.push(
              `%${recordRate} KDV farkı: Luca ${this.fmtAmt(recordKdv)} ≠ Fatura ${this.fmtAmt(best?.amount ?? matchingItem.tutar)} (${best?.label ?? 'OCR'}, %${Math.round(diff * 100)})`,
            );
          } else {
            reasons.push(
              `%${recordRate} KDV uyumsuz: Luca ${this.fmtAmt(recordKdv)} ≠ Fatura ${this.fmtAmt(best?.amount ?? matchingItem.tutar)} (${best?.label ?? 'OCR'})`,
            );
          }
        } else {
          // Luca'da %20 var ama OCR breakdown'unda %20 yok — KESİN UYUMSUZ
          rateMismatched = true;
          const ranges = rateAwareImageBreakdown.map((b) => `%${b.oran}`).join(', ');
          reasons.push(
            `KDV oranı uyumsuz: Luca %${recordRate} → Faturada bulunamadı (faturada: ${ranges || 'yok'})`,
          );
        }
      } else {
        // Klasik toplam karşılaştırması — virtual record veya tek oran + breakdown yok
        // TR/US karma format desteği:
        //   "22,04"     → 22.04  (TR decimal virgül)
        //   "22.04"     → 22.04  (US decimal nokta — OCR çıktısı bu)
        //   "1.234,56"  → 1234.56 (TR binlik nokta + virgül decimal)
        //   "1,234.56"  → 1234.56 (US binlik virgül + nokta decimal)
        //   "2204"      → 2204
        // Kural: son ayırıcı decimal'dir EĞER ondan sonra 1-2 rakam varsa.
        const imgKdvNum = this.parseTrUsAmount(imgKdv);
        if (!isNaN(imgKdvNum)) {
          const kdvCandidates = [
            { amount: imgKdvNum, label: 'OCR' },
            ...(!isAlis && imgTevkifat > 0 && imgKdvNum > imgTevkifat
              ? [{ amount: imgKdvNum - imgTevkifat, label: 'TAM-Tevkifat' }]
              : []),
          ];
          const bestKdv = kdvCandidates
            .map((c) => ({
              ...c,
              diff: Math.abs(recordKdv - c.amount) / (recordKdv || 1),
            }))
            .sort((a, b) => a.diff - b.diff)[0];
          const diff = bestKdv?.diff ?? 1;
          if (diff < 0.01) {
            score += 0.3;
            kdvExact = true;
            if (bestKdv?.label === 'TAM-Tevkifat') {
              reasons.push(
                `Satış tevkifat eşleşmesi: Luca ${this.fmtAmt(recordKdv)} = Fatura ${this.fmtAmt(imgKdvNum)} TAM - ${this.fmtAmt(imgTevkifat)} tevkifat`,
              );
            }
          } else if (diff < 0.05) {
            score += 0.15;
            reasons.push(`KDV tutar farkı: ${this.fmtAmt(recordKdv)} ≠ ${this.fmtAmt(bestKdv?.amount ?? imgKdvNum)} (%${Math.round(diff * 100)})`);
          } else {
            // ─── TEVKİFAT FARKI KONTROLÜ (ALIŞ için kritik) ───
            // Türk muhasebe pratiğinde tevkifatlı faturalar farklı şekillerde
            // kayıt edilir:
            //
            // ALIŞ tarafı (Luca'da 2 ayrı satır):
            //   1. İndirilecek KDV (191 NET)        = NET KDV
            //   2. Sorumlu sıfatıyla indirilecek    = Tevkifat tutarı
            //   İkisi toplamı  = TAM KDV
            //   → aggregateMultiRateRecords aynı belge_no + tarih kombinasyonunu
            //     topladığında virtual.kdvTutari = TAM KDV olur.
            //
            // SATIŞ tarafı (Luca'da tek satır):
            //   "Hesaplanan KDV" = NET KDV (zaten tevkifat düşülmüş)
            //   → Aggregate zaten tek satır, virtual.kdvTutari = NET KDV.
            //
            // OCR ise her iki durumda da NET KDV verir (kdvTutari) + tevkifatı
            // ayrı alanda (kdvTevkifat).
            //
            // Karşılaştırma:
            //   • Satışta:  Luca NET == OCR NET                → ilk diff < 0.01 → MATCHED
            //   • Alışta:   Luca TAM == OCR NET + OCR Tevkifat → bu blok yakalar → MATCHED
            const tamKdvFromOcr = imgKdvNum + (Number.isFinite(imgTevkifat) ? imgTevkifat : 0);
            const tamDiff = Math.abs(recordKdv - tamKdvFromOcr) / (recordKdv || 1);

            // ALIŞ tevkifat senaryosu (3 farklı yakalama yolu):
            //  1. OCR.kdvTutari + OCR.kdvTevkifat = Luca TAM (klasik)
            //  2. Orijinal Luca satırlarından biri (NET satırı) = OCR.kdvTutari
            //     (OCR tevkifat tespit edemese bile)
            //  3. Aggregate Luca / 2 ≈ OCR (tipik %50 tevkifat varsayımı, defansif)
            const lucaOriginalMatch = isAlis
              && Array.isArray(originalRecordKdvList)
              && originalRecordKdvList.length >= 2
              && originalRecordKdvList.some(
                (k) => Math.abs(k - imgKdvNum) / (imgKdvNum || 1) < 0.01,
              );
            const sellerVerifiedForAmbiguous = !isAlis || isIsletme || !sameDocDateAmbiguous || this.hasSellerMatch(record, image);

            if (isAlis && imgTevkifat > 0 && tamDiff < 0.01 && sellerVerifiedForAmbiguous) {
              // YOL 1: OCR tevkifat var, TAM kontrolü tutuyor
              score += 0.3;
              kdvExact = true;
              reasons.push(
                `Alış tevkifat eşleşmesi: Luca ${this.fmtAmt(recordKdv)} (NET+Tevkifat) = Fatura ${this.fmtAmt(imgKdvNum)} (NET) + ${this.fmtAmt(imgTevkifat)} (tevkifat)`,
              );
            } else if (isAlis && sameDocDateAmbiguous && imgTevkifat > 0 && tamDiff < 0.01) {
              score += 0.08;
              reasons.push(
                'Alis tevkifat belirsiz: ayni belge no/tarihte birden fazla firma var; satici/VKN dogrulanmadan tevkifat MATCHED yapilmadi',
              );
            } else if (lucaOriginalMatch && sellerVerifiedForAmbiguous) {
              // YOL 2: Orijinal Luca satırlarından biri OCR NET'e eşit.
              // Alış tevkifatında Luca aynı belgeyi NET + sorumlu sıfatıyla KDV
              // olarak iki satır getirebildiği için bu aynı belge fan-out'udur.
              score += 0.3;
              kdvExact = true;
              reasons.push(
                `Alış tevkifat bileşen eşleşmesi: OCR ${this.fmtAmt(imgKdvNum)} Luca satırlarından biriyle eşleşti; aynı belge tevkifat satırlarına fan-out edildi`,
              );
            } else if (lucaOriginalMatch && sameDocDateAmbiguous) {
              score += 0.08;
              reasons.push(
                'Alis tevkifat belirsiz: ayni belge no/tarihte birden fazla firma var; satici/VKN dogrulanmadan bilesen fan-out MATCHED yapilmadi',
              );
            } else {
              reasons.push(`KDV tutar uyumsuz: ${this.fmtAmt(recordKdv)} ≠ ${this.fmtAmt(imgKdvNum)}`);
            }
          }
        }
      }
    } else if (!imgKdv && record.kdvTutari) {
      score += 0.1;
      reasons.push('Görselden KDV tutarı okunamadı');
    }

    // ── SATICI KARŞILAŞTIRMASI ──
    // PRIMARY: VKN/TCKN match (en güvenilir)
    // FALLBACK: ad benzerliği (similarity ≥ 0.5)
    //
    // Aynı belge no'lu farklı firmaların faturaları eşleşmesin.
    let saticiMismatch = false;
    const recordRawData = (record.rawData || {}) as Record<string, any>;
    const recordSatici = stripKdvLucaDescriptionDocumentSuffix((record.karsiTaraf || '').trim());
    const recordVkn = String(
      (record as any).karsiVergiNo ||
      recordRawData.karsiVergiNo ||
      recordRawData.vergiNo ||
      recordRawData.vkn ||
      recordRawData.tckn ||
      '',
    ).replace(/\D/g, '');
    const imgSatici = ((image as any).ocrSatici || '').trim();
    const imgVkn = String((image as any).ocrSaticiVkn || '').replace(/\D/g, '');

    // 1) VKN/TCKN MATCH — primary (10 veya 11 hane sayı)
    if (recordVkn && imgVkn && (imgVkn.length === 10 || imgVkn.length === 11)) {
      if (recordVkn === imgVkn) {
        // Tam eşleşme → güçlü bonus, isim kontrolü atla
        score = Math.min(1, score + 0.15);
        reasons.push(`VKN/TCKN tam eşleşti (${imgVkn})`);
      } else {
        // VKN'ler farklı → kesin yanlış firma
        saticiMismatch = true;
        reasons.push(
          `VKN/TCKN uyumsuz: Luca ${recordVkn} ≠ Fatura ${imgVkn} — farklı firma`,
        );
      }
    }
    // 2) AD BENZERLİĞİ — VKN yoksa veya farklılaşmadıysa
    else if (isAlis && !isIsletme && recordSatici && imgSatici && !this.isAccountingDescription(recordSatici)) {
      const sim = this.companyNameSimilarity(recordSatici, imgSatici);
      if (sim >= 0.5) {
        score = Math.min(1, score + 0.05);
      } else {
        saticiMismatch = true;
        reasons.push(
          `Satıcı uyumsuz: Luca "${recordSatici.slice(0, 40)}" ≠ Fatura "${imgSatici.slice(0, 40)}"`,
        );
      }
    }

    // ── ÇOK ORANLI VIRTUAL RECORD: KALEM-KALEM BREAKDOWN DOĞRULAMASI ──
    // Multi-rate Luca aggregate'inde her oran için beklenen tutar var.
    // OCR breakdown'unda her oran bulunmalı VE tutarlar eşleşmeli; aksi halde
    // total uyumlu olsa bile MATCHED verme — başka bir belgeyle karıştırma riski.
    if (expectedBreakdown && expectedBreakdown.length > 1 && rateAwareImageBreakdown.length > 0) {
      let allRatesMatched = true;
      for (const exp of expectedBreakdown) {
        const item = rateAwareImageBreakdown.find((b) => Math.abs(b.oran - exp.oran) < 0.5);
        if (!item) {
          allRatesMatched = false;
          rateMismatched = true;
          reasons.push(
            `Çok oranlı uyumsuzluk: Luca'da %${exp.oran} var, faturada bulunamadı`,
          );
          continue;
        }
        const diff = Math.abs(item.tutar - exp.tutar) / (exp.tutar || 1);
        if (diff > 0.01) {
          allRatesMatched = false;
          reasons.push(
            `%${exp.oran} KDV uyumsuz: Luca ${this.fmtAmt(exp.tutar)} ≠ Fatura ${this.fmtAmt(item.tutar)}`,
          );
        }
      }
      if (allRatesMatched) {
        kdvExact = true;
        // Toplam zaten eşleştiği için kdvExact=true, ek bonus
        rateExact = true;
        score = Math.min(1, score + 0.35);
      } else if (record.kdvTutari && imgKdv) {
        const recordKdv = parseFloat(record.kdvTutari.toString());
        const imgKdvNum = this.parseTrUsAmount(imgKdv);
        const totalDiff = Math.abs(recordKdv - imgKdvNum) / (recordKdv || 1);
        if (Number.isFinite(imgKdvNum) && totalDiff < 0.01) {
          kdvExact = true;
          score = Math.min(1, score + 0.3);
          reasons.push(
            `Çok oranlı toplam KDV eşleşti: Luca ${this.fmtAmt(recordKdv)} = Fatura ${this.fmtAmt(imgKdvNum)}; OCR oran kırılımı güvenilir olmadığı için toplam esas alındı`,
          );
          rateMismatched = false;
        }
      }
    }
    // suppress unused-var lint (rateExact rezerve, gelecekte UI'da kullanılabilir)
    void rateExact;

    // ── TARİH ──────────────────────────────────────────────
    if (record.belgeDate && imgDate) {
      const recordDate = new Date(record.belgeDate);
      const parsedImgDate = this.parseTrDate(imgDate);

      if (parsedImgDate && this.sameDay(recordDate, parsedImgDate)) {
        score += 0.25;
        dateExact = true;
      } else if (mihsapBelgeTarihi && this.sameDay(recordDate, mihsapBelgeTarihi)) {
        score += 0.25;
        dateExact = true; // Mihsap'ın belge tarihi Luca ile eşleşiyor → tarih doğrulandı
      } else if (parsedImgDate && this.likelyOcrYearMisread(recordDate, parsedImgDate)) {
        // OCR YIL HATASI OLASILIĞI: Gün+ay aynı, yıl farklı (1-5 yıl sapma).
        // Muhtemelen OCR yıl hanesini yanlış okudu ("6"↔"5", "2024"↔"2026" gibi).
        // Eşleşmedi demek yerine PARTIAL skor ver → kullanıcı İncele panelinde teyit etsin.
        score += 0.18;
        reasons.push(
          `OCR yıl hatası olasılığı — Luca: ${this.fmtDate(recordDate)} vs Fiş: ${this.fmtDate(parsedImgDate)} (gün/ay aynı, yıl farklı)`,
        );
      } else if (parsedImgDate || mihsapBelgeTarihi) {
        const parts: string[] = [`Luca: ${this.fmtDate(recordDate)}`];
        if (parsedImgDate) parts.push(`Fiş: ${this.fmtDate(parsedImgDate)}`);
        if (mihsapBelgeTarihi) parts.push(`Mihsap: ${this.fmtDate(mihsapBelgeTarihi)}`);
        reasons.push(`Tarih uyumsuz: ${parts.join(' · ')}`);
      }
    } else if (!imgDate && record.belgeDate) {
      reasons.push('Görselden tarih okunamadı');
    }

    // ── OCR ŞÜPHE BONUSU ────────────────────────────────────
    // Belge no uyumsuz ama KDV kuruşu kuruşuna aynı + tarih OCR hatası olasılığı
    // → iki kayıt büyük ihtimalle aynı belge, sadece OCR yanlış okumuş.
    // Bu durumu yakalamak için ek bonus — aday listesine girsin, user teyit etsin.
    if (kdvExact && !belgeNoExact && !dateExact && record.belgeDate && imgDate) {
      const parsedImgDate = this.parseTrDate(imgDate);
      if (parsedImgDate && this.likelyOcrYearMisread(new Date(record.belgeDate), parsedImgDate)) {
        score += 0.12;
        reasons.push(
          'Şüpheli eşleşme: KDV tutarı tam aynı + tarihler gün/ay tutuyor → OCR hatası olabilir',
        );
      }
    }

    // ── STRICT MATCH KURALI ─────────────────────────────────
    // User: "tarih + evrak no + KDV üçü aynı anda eşleşmezse kabul edilmeyecek"
    // EK KURAL: Multi-rate faturalarda Luca'nın KDV oranı OCR breakdown'unda
    // bulunamıyorsa MATCHED ASLA verilmez (oran uyumsuzluğu = farklı belge).
    //
    // GIB/EARSIV gibi seri numaraları farklı satıcılarda tekrar edebildiği için
    // satıcı/VKN açıkça uyumsuzsa 3 kritik alan tutsa bile MATCHED verme.
    const sellerMismatchHard =
      saticiMismatch &&
      reasons.some((r) => r.includes('VKN/TCKN uyumsuz') || r.includes('Satıcı uyumsuz'));
    const ambiguousSellerHard = isAlis && !isIsletme && sameDocDateAmbiguous && !this.hasSellerMatch(record, image);
    const sellerMismatchBlocksStrict =
      sellerMismatchHard && reasons.some((r) => r.includes('VKN/TCKN uyumsuz'));
    if (ambiguousSellerHard && belgeNoExact && dateExact) {
      reasons.push(
        'Ayni belge no/tarihte birden fazla firma var; satici/VKN dogrulanmadan tam eslesme verilmedi',
      );
    }
    const strictMatch =
      belgeNoExact && kdvExact && dateExact && !rateMismatched && !sellerMismatchBlocksStrict && !ambiguousSellerHard;

    // Oran uyumsuzluğu varsa skoru sert düşür — drift bekle, aday bile olmasın
    if (rateMismatched) {
      score = Math.max(0, score - 0.4);
    }
    // Satıcı uyumsuzsa skoru sert düşür. Aynı GIB/EARSIV seri numarası farklı
    // satıcılarda tekrar edebildiği için bu artık strict match'i de engeller.
    if (saticiMismatch) {
      score = Math.max(0, score - 0.5);
    }

    return { score: Math.min(score, 1), reasons, strictMatch };
  }

  private companyNameSimilarity(a: string, b: string): number {
    return kdvCompanyNameSimilarity(a, b);
  }

  private fmtAmt(n: number): string {
    return formatAmountTr(n);
  }

  private normalizeImageBreakdownRates(image: ReceiptImage, breakdown: BreakdownItem[]): BreakdownItem[] {
    const okcBreakdown = this.extractOkcItemRateBreakdownFromImageText(image);
    if (okcBreakdown.length >= 1) return okcBreakdown;

    if (breakdown.length !== 1 || !(breakdown[0]?.tutar > 0)) return breakdown;
    const inferred = this.inferSingleBreakdownRateFromImageText(image, breakdown[0].tutar);
    if (!inferred) return breakdown;

    const currentRate = Number(breakdown[0].oran || 0);
    const shouldReplaceRate = currentRate <= 0 || Math.abs(currentRate - inferred.oran) > 0.5;
    if (!shouldReplaceRate && breakdown[0].matrah) return breakdown;

    return [{
      ...breakdown[0],
      oran: shouldReplaceRate ? inferred.oran : currentRate,
      matrah: breakdown[0].matrah ?? inferred.matrah,
    }];
  }

  private inferSingleBreakdownRateFromImageText(
    image: ReceiptImage,
    kdvAmount: number,
  ): { oran: number; matrah: number } | null {
    const rawText = String((image as any).ocrRawText || '');
    if (!rawText || !(kdvAmount > 0)) return null;

    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const fold = (value: string) =>
      value
        .toLocaleUpperCase('tr-TR')
        .replace(/Ş/g, 'S').replace(/İ/g, 'I')
        .replace(/Ğ/g, 'G').replace(/Ç/g, 'C')
        .replace(/Ü/g, 'U').replace(/Ö/g, 'O');
    const amountRe = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{1,2})/g;
    const validRates = [1, 8, 10, 18, 20];

    for (let i = 0; i < lines.length; i++) {
      const foldedLine = fold(lines[i]);
      if (!/\bK\.?\s*D\.?\s*V\.?\b/.test(foldedLine)) continue;
      if (!/MATRAH/.test(foldedLine) || /TEVKIFAT/.test(foldedLine)) continue;

      const window = [lines[i], lines[i + 1] || '', lines[i + 2] || ''].join(' ');
      const matrahMatch = window.match(/matrah[^\d]{0,30}(\d{1,3}(?:[.,]\d{3})*[.,]\d{1,2})/i);
      const matrah = matrahMatch ? this.parseTrUsAmount(matrahMatch[1]) : NaN;
      if (!Number.isFinite(matrah) || matrah <= 0 || matrah <= kdvAmount) continue;

      amountRe.lastIndex = 0;
      const amounts = [...window.matchAll(amountRe)]
        .map((match) => this.parseTrUsAmount(match[1]))
        .filter((amount) => Number.isFinite(amount) && amount > 0);
      const hasKdvAmountInWindow = amounts.some((amount) => Math.abs(amount - kdvAmount) <= 0.05);
      if (!hasKdvAmountInWindow) continue;

      const rawRate = (kdvAmount / matrah) * 100;
      const nearest = validRates.find((rate) => Math.abs(rate - rawRate) <= 0.75);
      if (nearest) return { oran: nearest, matrah };
    }

    return null;
  }

  private extractOkcItemRateBreakdownFromImageText(image: ReceiptImage): BreakdownItem[] {
    const rawText = String((image as any).ocrRawText || '');
    const belgeTipi = String((image as any).ocrBelgeTipi || '').toUpperCase();
    if (!rawText || (belgeTipi && belgeTipi !== 'OKC_FIS')) return [];

    const foldedText = rawText
      .toLocaleUpperCase('tr-TR')
      .replace(/Ş/g, 'S').replace(/İ/g, 'I')
      .replace(/Ğ/g, 'G').replace(/Ç/g, 'C')
      .replace(/Ü/g, 'U').replace(/Ö/g, 'O');
    if (!/\bTOPKDV\b/.test(foldedText) || !/\bFIS\s*NO\b/.test(foldedText)) return [];

    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const fold = (value: string) =>
      value
        .toLocaleUpperCase('tr-TR')
        .replace(/Ş/g, 'S').replace(/İ/g, 'I')
        .replace(/Ğ/g, 'G').replace(/Ç/g, 'C')
        .replace(/Ü/g, 'U').replace(/Ö/g, 'O');
    const rateRe = /(?:%|\/)\s*0?(1|8|10|18|20)(?:[,.]00)?\b/i;
    const amountRe = /([+-])?\s*[*]?\s*([+-])?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/g;
    const skipRe = /TOPKDV|TOPLAM|KDV\s*TUTAR|NAKIT|KREDI|KART|KASIYER|MERSIS|EKU|Z\s*NO|FIS\s*NO|TARIH|SAAT|VERGI|V\.?D\.?|T\.?C\.?/i;
    const grossByRate = new Map<number, number>();
    let pendingRate: number | null = null;

    const parseLastAmount = (value: string): number => {
      amountRe.lastIndex = 0;
      const values = [...value.matchAll(amountRe)]
        .map((match) => {
          const sign = match[1] === '-' || match[2] === '-' ? -1 : 1;
          return sign * this.parseTrUsAmount(match[3]);
        })
        .filter((amount) => Number.isFinite(amount) && Math.abs(amount) > 0 && Math.abs(amount) < 100_000_000);
      return values.length > 0 ? values[values.length - 1] : 0;
    };
    const addGross = (rate: number, gross: number) => {
      if (!gross) return;
      grossByRate.set(rate, (grossByRate.get(rate) || 0) + gross);
    };

    const detectRate = (line: string): { oran: number; index: number; length: number } | null => {
      const direct = line.match(rateRe);
      if (direct && direct.index != null) {
        return { oran: Number(direct[1]), index: direct.index, length: direct[0].length };
      }

      const compact = fold(line).replace(/[^A-Z0-9/$%]/g, '');
      if (/^(?:401|4O1|40I)$/.test(compact)) return { oran: 1, index: 0, length: line.length };
      if (/^(?:710|7IO|7I0)$/.test(compact)) return { oran: 10, index: 0, length: line.length };
      const loose = compact.match(/^[/$S%]0?(1|8|10|18|20)$/);
      if (loose) return { oran: Number(loose[1]), index: 0, length: line.length };

      return null;
    };

    for (const line of lines) {
      const folded = fold(line);
      if (skipRe.test(folded)) {
        pendingRate = null;
        continue;
      }

      const detectedRate = detectRate(line);
      if (detectedRate) {
        const rate = detectedRate.oran;
        const afterRate = line.slice(detectedRate.index + detectedRate.length);
        const gross = parseLastAmount(afterRate) || (afterRate.trim() ? parseLastAmount(line) : 0);
        if (gross) {
          addGross(rate, gross);
          pendingRate = null;
        } else {
          pendingRate = rate;
        }
        continue;
      }

      if (pendingRate) {
        const gross = parseLastAmount(line);
        if (gross > 0) {
          addGross(pendingRate, gross);
          pendingRate = null;
        }
      }
    }

    if (grossByRate.size < 1) return [];

    const breakdown = Array.from(grossByRate.entries())
      .map(([oran, gross]) => ({
        oran,
        tutar: Math.round((gross * oran / (100 + oran)) * 100) / 100,
        matrah: Math.round((gross / (1 + oran / 100)) * 100) / 100,
      }))
      .filter((item) => item.tutar > 0);
    if (breakdown.length < 1) return [];

    const topKdv = this.extractTopKdvFromOkcText(rawText);
    if (topKdv && topKdv > 0) {
      const sum = breakdown.reduce((total, item) => total + item.tutar, 0);
      const grossTotal = Array.from(grossByRate.values()).reduce((total, gross) => total + Math.max(gross, 0), 0);
      const tolerance = Math.max(0.08, topKdv * 0.03);
      const topKdvSuspicious =
        grossTotal > 0 &&
        topKdv / grossTotal > 0.35 &&
        sum / grossTotal > 0.005 &&
        sum / grossTotal < 0.30;
      if (Math.abs(sum - topKdv) > tolerance && !topKdvSuspicious) return [];
    }

    return topKdv && topKdv > 0 ? breakdown : (breakdown.length >= 2 ? breakdown : []);
  }

  private extractTopKdvFromOkcText(rawText: string): number | null {
    const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const amountRe = /[-+]?[*]?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/g;
    const fold = (value: string) =>
      value
        .toLocaleUpperCase('tr-TR')
        .replace(/Ş/g, 'S').replace(/İ/g, 'I')
        .replace(/Ğ/g, 'G').replace(/Ç/g, 'C')
        .replace(/Ü/g, 'U').replace(/Ö/g, 'O');

    const parseLastAmount = (value: string): number => {
      amountRe.lastIndex = 0;
      const values = [...value.matchAll(amountRe)]
        .map((match) => this.parseTrUsAmount(match[1]))
        .filter((amount) => Number.isFinite(amount) && amount > 0);
      return values.length > 0 ? values[values.length - 1] : 0;
    };

    for (let i = 0; i < lines.length; i++) {
      if (!/\bTOPKDV\b/.test(fold(lines[i]))) continue;
      const sameLine = parseLastAmount(lines[i]);
      if (sameLine > 0) return sameLine;
      for (let j = 1; j <= 2 && i + j < lines.length; j++) {
        const next = fold(lines[i + j]);
        if (/TOPLAM|NAKIT|KREDI|KART/.test(next)) break;
        const amount = parseLastAmount(lines[i + j]);
        if (amount > 0) return amount;
      }
    }

    return null;
  }

  /**
   * TR/US karma format desteği — bir string'i sağlam parse eder.
   *
   *   "22,04"     → 22.04   (TR decimal virgül)
   *   "22.04"     → 22.04   (US decimal nokta — OCR'ın toFixed çıktısı)
   *   "1.234,56"  → 1234.56 (TR: nokta binlik, virgül decimal)
   *   "1,234.56"  → 1234.56 (US: virgül binlik, nokta decimal)
   *   "2204"      → 2204    (binlik yok, decimal yok)
   *   "1.234"     → 1234    (3 rakam sonrası → binlik, decimal yok)
   *   "12.34"     → 12.34   (2 rakam sonrası → decimal)
   *
   * Mantık: son ayırıcının yeri ve ondan sonraki rakam sayısına bakar.
   * Eğer sondaki ayırıcıdan sonra 1-2 rakam varsa decimal, 3+ ise binlik.
   */
  private parseTrUsAmount(raw: string | number | null | undefined): number {
    return parseTrUsAmount(raw);
  }

  private sameDay(a: Date, b: Date): boolean {
    return sameDay(a, b);
  }

  /**
   * Gün ve ay aynı ama yıl farklıysa → OCR yıl hatası olasılığı.
   * Sapma 5 yıldan fazla ise coincidence olma ihtimali yükseldiği için
   * bu kadarla sınırlıyoruz.
   */
  private likelyOcrYearMisread(a: Date, b: Date): boolean {
    return likelyOcrYearMisread(a, b);
  }

  private scoreToStatus(score: number, image: ReceiptImage, strictMatch: boolean, forcePartial: boolean = false): string {
    return scoreToStatus(score, image, strictMatch, forcePartial);
  }

  private normalizeBelgeNo(s: string): string {
    return normalizeBelgeNo(s);
  }

  private isAccountingDescription(value: string): boolean {
    return isKdvAccountingDescription(value);
  }

  private recordDocDateKey(record: KdvRecord): string | null {
    return kdvRecordDocDateKey(record);
  }

  private recordDocDateAmountKey(record: KdvRecord): string | null {
    return kdvRecordDocDateAmountKey(record);
  }

  private inferRecordRate(record: KdvRecord): number | null {
    return inferKdvRecordRate(record);
  }

  private buildAmbiguousDocDateAmountKeys(records: KdvRecord[]): Set<string> {
    return buildKdvAmbiguousDocDateAmountKeys(records);
  }

  private hasSellerMatch(record: KdvRecord, image: ReceiptImage): boolean {
    return hasKdvSellerMatch(record, image);
  }

  private sameBelgeNo(a: string, b: string): boolean {
    return sameBelgeNo(a, b);
  }

  private eInvoiceComparableKey(normalizedBelgeNo: string): string {
    return eInvoiceComparableKey(normalizedBelgeNo);
  }

  private hasStrongTwoOfThree(record: KdvRecord, image: ReceiptImage, mihsapBelgeTarihi: Date | null): boolean {
    return hasKdvStrongTwoOfThree(record, image, mihsapBelgeTarihi);
  }

  /**
   * Sayısal belge no'larda leading zero'ları çıkar. Karışık (harf+rakam) ise
   * sadece baştaki rakam kısmının leading zero'larını çıkar.
   * "0599" → "599" · "00123" → "123" · "EFA2026000000093" → aynı (harfle başlar)
   */
  private stripLeadingZeros(s: string): string {
    return stripLeadingZeros(s);
  }

  private stringSimilarity(a: string, b: string): number {
    return stringSimilarity(a, b);
  }

  private aggregateMultiRateRecords(rawRecords: KdvRecord[], isAlis = false): {
    records: KdvRecord[];
    virtualGroups: Map<string, string[]>;
    virtualExpectedBreakdown: Map<string, Array<{ oran: number; tutar: number }>>;
    virtualOriginalKdvAmounts: Map<string, number[]>;
  } {
    return aggregateKdvMultiRateRecords(rawRecords, isAlis, {
      normalizeBelgeNo: (value: string) => this.normalizeBelgeNo(value),
      recordPartyKey: (record: KdvRecord) => this.recordPartyKey(record),
      inferRecordRate: (record: KdvRecord) => this.inferRecordRate(record),
      log: (message: string) => this.logger.log(message),
    });
  }

  private recordPartyKey(rec: KdvRecord): string {
    return kdvRecordPartyKey(rec);
  }

  private parseTrDate(s: string): Date | null {
    return parseTrDate(s);
  }

  private fmtDate(d: Date): string {
    return formatTrDate(d);
  }
}
