import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KdvRecord, ReceiptImage } from '@prisma/client';

export interface MatchCandidate {
  kdvRecord: KdvRecord;
  image: ReceiptImage;
  score: number;
  reasons: string[];
  strictMatch: boolean;
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
    // Mevcut sonuçları temizle
    await this.prisma.reconciliationResult.deleteMany({ where: { sessionId } });

    const [rawRecords, images] = await Promise.all([
      this.prisma.kdvRecord.findMany({ where: { sessionId } }),
      this.prisma.receiptImage.findMany({ where: { sessionId } }),
    ]);

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
    const { records, virtualGroups } = this.aggregateMultiRateRecords(rawRecords);

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
        const { score, reasons, strictMatch } = this.calculateScore(record, image, mihsapBelgeTarihi);
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
    const MIN_PAIR_SCORE = 0.4; // 0.3 çok düşüktü — drift yaratıyordu
    const allPairs: MatchCandidate[] = [];
    for (const record of records) {
      if (usedRecordIds.has(record.id)) continue;
      for (const image of images) {
        if (usedImageIds.has(image.id)) continue;
        const mihsapBelgeTarihi = mihsapBelgeTarihleri[image.s3Key || ''] ?? null;
        const { score, reasons, strictMatch } = this.calculateScore(record, image, mihsapBelgeTarihi);
        if (score >= MIN_PAIR_SCORE) {
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
      const status = this.scoreToStatus(pair.score, pair.image, pair.strictMatch);
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

    // Toplu kayıt
    for (const data of createData) {
      await this.prisma.reconciliationResult.create({ data });
    }

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

    // Oturum durumunu güncelle
    await this.prisma.kdvControlSession.update({
      where: { id: sessionId },
      data: { status: 'REVIEWING' },
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
  ): { score: number; reasons: string[]; strictMatch: boolean } {
    const imgBelgeNo = image.confirmedBelgeNo || image.ocrBelgeNo;
    const imgDate = image.confirmedDate || image.ocrDate;
    const imgKdv = image.confirmedKdvTutari || image.ocrKdvTutari;

    // Belge kategorisi: uzun belge no → e-fatura/e-arşiv; kısa → ÖKC fiş
    const belgeNoLen = (record.belgeNo || imgBelgeNo || '').replace(/[^A-Z0-9]/gi, '').length;
    const isOkcFisi = belgeNoLen > 0 && belgeNoLen <= 6;

    let score = 0;
    const reasons: string[] = [];
    let belgeNoExact = false;
    let kdvExact = false;
    let dateExact = false;

    // ── BELGE NO ─────────────────────────────────────────────
    const belgeNoWeight = isOkcFisi ? 0.45 : 0.7;
    if (record.belgeNo && imgBelgeNo) {
      const normA = this.normalizeBelgeNo(record.belgeNo);
      const normB = this.normalizeBelgeNo(imgBelgeNo);
      // Leading zero-stripped karşılaştırma — "0599" = "599"
      // ÖKC fişlerde Luca genelde sıfır önekli kayıt ("0599"), OCR çıplak ("599")
      const strippedA = this.stripLeadingZeros(normA);
      const strippedB = this.stripLeadingZeros(normB);
      if (normA === normB || strippedA === strippedB) {
        // Tam aynı veya leading-zero eşiti → exact
        score += belgeNoWeight;
        belgeNoExact = true;
      } else {
        // Hem ham hem stripped versiyonun en yüksek similarity'sini al
        const simRaw = this.stringSimilarity(normA, normB);
        const simStripped = this.stringSimilarity(strippedA, strippedB);
        const similarity = Math.max(simRaw, simStripped);
        if (similarity >= 0.9) {
          score += belgeNoWeight;
          belgeNoExact = true;
        } else if (similarity >= 0.7) {
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

    // ── KDV TUTARI ─────────────────────────────────────────
    if (record.kdvTutari && imgKdv) {
      const recordKdv = parseFloat(record.kdvTutari.toString());
      const imgKdvNum = parseFloat(
        imgKdv.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''),
      );
      if (!isNaN(imgKdvNum)) {
        const diff = Math.abs(recordKdv - imgKdvNum) / (recordKdv || 1);
        if (diff < 0.01) {
          score += 0.3;
          kdvExact = true;
        } else if (diff < 0.05) {
          score += 0.15;
          reasons.push(`KDV tutar farkı: ${this.fmtAmt(recordKdv)} ≠ ${this.fmtAmt(imgKdvNum)} (%${Math.round(diff * 100)})`);
        } else {
          reasons.push(`KDV tutar uyumsuz: ${this.fmtAmt(recordKdv)} ≠ ${this.fmtAmt(imgKdvNum)}`);
        }
      }
    } else if (!imgKdv && record.kdvTutari) {
      score += 0.1;
      reasons.push('Görselden KDV tutarı okunamadı');
    }

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
    // Bu yüzden MATCHED sadece üç alan da exact eşleştiğinde verilir.
    const strictMatch = belgeNoExact && kdvExact && dateExact;

    return { score: Math.min(score, 1), reasons, strictMatch };
  }

  private fmtAmt(n: number): string {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** İki tarihi aynı gün mü karşılaştırır (saat farkını yok sayar) */
  private sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /**
   * Gün ve ay aynı ama yıl farklıysa → OCR yıl hatası olasılığı.
   * Sapma 5 yıldan fazla ise coincidence olma ihtimali yükseldiği için
   * bu kadarla sınırlıyoruz.
   */
  private likelyOcrYearMisread(a: Date, b: Date): boolean {
    if (a.getDate() !== b.getDate()) return false;
    if (a.getMonth() !== b.getMonth()) return false;
    const yearDiff = Math.abs(a.getFullYear() - b.getFullYear());
    return yearDiff > 0 && yearDiff <= 5;
  }

  private scoreToStatus(score: number, image: ReceiptImage, strictMatch: boolean): string {
    // Sadece FAILED durum NEEDS_REVIEW'a zorla; LOW_CONFIDENCE artık normal akışta
    if (image.ocrStatus === 'FAILED' && !image.isManuallyConfirmed) return 'NEEDS_REVIEW';
    // MATCHED sadece 3 alan (tarih + belge no + KDV) EXACT eşleşirse verilir.
    // Herhangi biri tutmuyorsa PARTIAL_MATCH veya NEEDS_REVIEW.
    if (strictMatch) return 'MATCHED';
    if (score >= 0.65) return 'PARTIAL_MATCH';
    if (score >= 0.45) return 'PARTIAL_MATCH';
    return 'NEEDS_REVIEW';
  }

  /** Belge no'yu karşılaştırma için normalize et: UPPER + sadece alfa-sayısal */
  private normalizeBelgeNo(s: string): string {
    return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Sayısal belge no'larda leading zero'ları çıkar. Karışık (harf+rakam) ise
   * sadece baştaki rakam kısmının leading zero'larını çıkar.
   * "0599" → "599" · "00123" → "123" · "EFA2026000000093" → aynı (harfle başlar)
   */
  private stripLeadingZeros(s: string): string {
    if (!s) return '';
    // Tamamı rakamsa
    if (/^\d+$/.test(s)) return s.replace(/^0+/, '') || '0';
    // Karışık ise değiştirme — "EFA..." sıfırlar ortasında kritik
    return s;
  }

  /** Levenshtein tabanlı basit string benzerliği */
  private stringSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    const dist = this.levenshtein(longer, shorter);
    return (longer.length - dist) / longer.length;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
  }

  /**
   * Luca satırlarını (belge no + tarih) kombinasyonuna göre gruplar.
   * Aynı belge için farklı KDV oranları (ör: %20 + %10) 2 satır gelir;
   * bunları tek virtual record olarak aggregate ediyoruz.
   *
   * Dönüş:
   *   records: reconciliation'ın kullanacağı liste (tek-oranlı + aggregated virtual)
   *   virtualGroups: virtualRecord.id → [origRecordId, origRecordId, ...]
   *     (match sonucunu orijinallere fan-out etmek için)
   *
   * NOT: Sadece belge no ≥ 4 karakter olan satırlar gruplanır. Kısa belge no
   * (ör. ÖKC fiş "0014") farklı günlerde aynı numara alabileceğinden
   * (belge_no + tarih) bile unique değil, aggregate etmiyoruz.
   */
  private aggregateMultiRateRecords(rawRecords: KdvRecord[]): {
    records: KdvRecord[];
    virtualGroups: Map<string, string[]>;
  } {
    const groups = new Map<string, KdvRecord[]>();
    const unaggregated: KdvRecord[] = [];

    for (const rec of rawRecords) {
      const bn = this.normalizeBelgeNo(rec.belgeNo || '');
      if (bn.length < 4 || !rec.belgeDate) {
        unaggregated.push(rec);
        continue;
      }
      const dateKey = new Date(rec.belgeDate).toISOString().slice(0, 10);
      const key = `${bn}|${dateKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }

    const result: KdvRecord[] = [...unaggregated];
    const virtualGroups = new Map<string, string[]>();

    for (const [key, group] of groups) {
      if (group.length === 1) {
        // Tek satır, aggregate etmeye gerek yok
        result.push(group[0]);
        continue;
      }
      // Çok satırlı grup → KDV ve matrah toplayıp virtual record üret.
      // KdvTutari/KdvMatrahi Prisma Decimal tipinde — toString() string-safe,
      // parseFloat ile topla, sonra number olarak geri yerleştir.
      // calculateScore sadece parseFloat(record.kdvTutari.toString()) yapıyor,
      // number'ın .toString()'i zaten sayısal string döndüğü için bu güvenli.
      let kdvToplam = 0;
      let matrahToplam = 0;
      for (const r of group) {
        kdvToplam += parseFloat(r.kdvTutari?.toString() || '0');
        matrahToplam += parseFloat(r.kdvMatrahi?.toString() || '0');
      }
      const base = group[0];
      const virtualId = `__virtual__:${key}`;
      const virtual: KdvRecord = {
        ...base,
        id: virtualId,
        kdvTutari: kdvToplam as any,
        ...(matrahToplam > 0 ? { kdvMatrahi: matrahToplam as any } : {}),
      };
      result.push(virtual);
      virtualGroups.set(virtualId, group.map((r) => r.id));
      this.logger.log(
        `Çok oranlı KDV aggregate: belge=${base.belgeNo} · ${group.length} satır → toplam KDV=${kdvToplam.toFixed(2)}`,
      );
    }

    return { records: result, virtualGroups };
  }

  private parseTrDate(s: string): Date | null {
    // DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY
    const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
    if (m) {
      const d = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
      return isNaN(d.getTime()) ? null : d;
    }
    // YYYY-MM-DD
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private fmtDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }
}
