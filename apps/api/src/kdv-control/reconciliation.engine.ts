import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KdvRecord, ReceiptImage } from '@prisma/client';

export interface MatchCandidate {
  kdvRecord: KdvRecord;
  image: ReceiptImage;
  score: number;
  reasons: string[];
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

    const usedImageIds = new Set<string>();
    const usedRecordIds = new Set<string>();
    const createData: any[] = [];

    // Her kayıt için en iyi görsel eşleşmesini bul
    for (const record of records) {
      const candidates: MatchCandidate[] = [];

      for (const image of images) {
        if (usedImageIds.has(image.id)) continue;
        const { score, reasons } = this.calculateScore(record, image);
        if (score > 0.3) {
          candidates.push({ kdvRecord: record, image, score, reasons });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      if (best) {
        usedImageIds.add(best.image.id);
        usedRecordIds.add(record.id);

        const status = this.scoreToStatus(best.score, best.image);
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
   * Üç kritere bakılır: Tarih (%30) + Belge No (%50) + KDV Tutarı (%20)
   */
  private calculateScore(
    record: KdvRecord,
    image: ReceiptImage,
  ): { score: number; reasons: string[] } {
    // Kullanıcı onaylı değerleri tercih et
    const imgBelgeNo = image.confirmedBelgeNo || image.ocrBelgeNo;
    const imgDate = image.confirmedDate || image.ocrDate;
    const imgKdv = image.confirmedKdvTutari || image.ocrKdvTutari;

    let score = 0;
    const reasons: string[] = [];

    // Belge No (%50 ağırlık) — en önemli kriter
    if (record.belgeNo && imgBelgeNo) {
      const similarity = this.stringSimilarity(
        record.belgeNo.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        imgBelgeNo.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      );
      if (similarity >= 0.9) score += 0.5;
      else if (similarity >= 0.7) {
        score += 0.3;
        reasons.push(`Belge no kısmi eşleşme: ${record.belgeNo} ≠ ${imgBelgeNo}`);
      } else {
        reasons.push(`Belge no uyumsuz: ${record.belgeNo} ≠ ${imgBelgeNo}`);
      }
    } else if (!record.belgeNo || !imgBelgeNo) {
      score += 0.1; // Biri eksikse tam puan verme
    }

    // KDV Tutarı (%20 ağırlık) — görsel KDV yoksa Excel değerini referans al (Z-raporu desteği)
    const imgKdvEffective = imgKdv ?? null;
    if (record.kdvTutari && imgKdvEffective) {
      const recordKdv = parseFloat(record.kdvTutari.toString());
      const imgKdvNum = parseFloat(
        imgKdvEffective.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''),
      );
      if (!isNaN(imgKdvNum)) {
        const diff = Math.abs(recordKdv - imgKdvNum) / (recordKdv || 1);
        if (diff < 0.01) score += 0.2;
        else if (diff < 0.05) { score += 0.1; reasons.push(`KDV tutarı yakın ama farklı: ${recordKdv} ≠ ${imgKdvNum}`); }
        else { reasons.push(`KDV tutarı uyumsuz: ${recordKdv} ≠ ${imgKdvNum}`); }
      }
    } else if (!imgKdvEffective && record.kdvTutari) {
      // Görsel KDV okunamadı — tarih+belgeNo eşleşirse KDV skoru eksik sayma, bonus ver
      score += 0.05; // Görselde KDV yoksa hafif bonus (ceza değil)
    }

    // Tarih (%30 ağırlık)
    if (record.belgeDate && imgDate) {
      const recordDate = new Date(record.belgeDate);
      const parsedImgDate = this.parseTrDate(imgDate);
      if (parsedImgDate) {
        const sameDay =
          recordDate.toDateString() === parsedImgDate.toDateString();
        if (sameDay) {
          score += 0.3;
        } else {
          // Aynı ay mı?
          const sameMonth =
            recordDate.getMonth() === parsedImgDate.getMonth() &&
            recordDate.getFullYear() === parsedImgDate.getFullYear();
          if (sameMonth) {
            score += 0.1;
            reasons.push(`Tarih aynı ay ama farklı gün: ${this.fmtDate(recordDate)} ≠ ${imgDate}`);
          } else {
            reasons.push(`Tarih uyumsuz: ${this.fmtDate(recordDate)} ≠ ${imgDate}`);
          }
        }
      }
    }

    return { score: Math.min(score, 1), reasons };
  }

  private scoreToStatus(score: number, image: ReceiptImage): string {
    // Sadece FAILED durum NEEDS_REVIEW'a zorla; LOW_CONFIDENCE artık normal akışta
    if (image.ocrStatus === 'FAILED' && !image.isManuallyConfirmed) return 'NEEDS_REVIEW';
    if (score >= 0.80) return 'MATCHED';
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
