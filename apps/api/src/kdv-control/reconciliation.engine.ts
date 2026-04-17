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

    const [records, images] = await Promise.all([
      this.prisma.kdvRecord.findMany({ where: { sessionId } }),
      this.prisma.receiptImage.findMany({ where: { sessionId } }),
    ]);

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

    // Her kayıt için en iyi görsel eşleşmesini bul
    for (const record of records) {
      const candidates: MatchCandidate[] = [];

      for (const image of images) {
        if (usedImageIds.has(image.id)) continue;
        const mihsapBelgeTarihi = mihsapBelgeTarihleri[image.s3Key || ''] ?? null;
        const { score, reasons, strictMatch } = this.calculateScore(record, image, mihsapBelgeTarihi);
        if (score > 0.3) {
          candidates.push({ kdvRecord: record, image, score, reasons, strictMatch });
        }
      }

      // Strict eşleşenler öne; sonra skor
      candidates.sort((a, b) => {
        if (a.strictMatch !== b.strictMatch) return a.strictMatch ? -1 : 1;
        return b.score - a.score;
      });
      const best = candidates[0];

      if (best) {
        usedImageIds.add(best.image.id);
        usedRecordIds.add(record.id);

        const status = this.scoreToStatus(best.score, best.image, best.strictMatch);
        createData.push({
          sessionId,
          kdvRecordId: record.id,
          imageId: best.image.id,
          status,
          matchScore: best.score,
          mismatchReasons: best.reasons,
        });
      } else {
        // Eşleşme bulunamadı
        createData.push({
          sessionId,
          kdvRecordId: record.id,
          imageId: null,
          status: 'UNMATCHED',
          matchScore: 0,
          mismatchReasons: ['Eşleşen görsel bulunamadı'],
        });
      }
    }

    // Görsel var ama kayıt yok olanlar
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
      const similarity = this.stringSimilarity(
        record.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        imgBelgeNo.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      );
      if (similarity >= 0.9) {
        score += belgeNoWeight;
        belgeNoExact = true;
      } else if (similarity >= 0.7) {
        score += belgeNoWeight * 0.55;
        reasons.push(`Belge no kısmi: ${record.belgeNo} ≠ ${imgBelgeNo}`);
      } else {
        reasons.push(`Belge no uyumsuz: ${record.belgeNo} ≠ ${imgBelgeNo}`);
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
      } else if (parsedImgDate || mihsapBelgeTarihi) {
        const parts: string[] = [`Luca: ${this.fmtDate(recordDate)}`];
        if (parsedImgDate) parts.push(`Fiş: ${this.fmtDate(parsedImgDate)}`);
        if (mihsapBelgeTarihi) parts.push(`Mihsap: ${this.fmtDate(mihsapBelgeTarihi)}`);
        reasons.push(`Tarih uyumsuz: ${parts.join(' · ')}`);
      }
    } else if (!imgDate && record.belgeDate) {
      reasons.push('Görselden tarih okunamadı');
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
