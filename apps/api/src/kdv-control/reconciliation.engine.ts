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

/** OCR breakdown JSON yapısı — {oran, tutar, matrah?} */
interface BreakdownItem {
  oran: number;
  tutar: number;
  matrah?: number | null;
}

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
      const matrah =
        it?.matrah == null
          ? null
          : typeof it.matrah === 'number'
            ? it.matrah
            : parseFloat(String(it.matrah).replace(/\./g, '').replace(',', '.'));
      return {
        oran: Number.isFinite(oran) ? oran : 0,
        tutar: Number.isFinite(tutar) ? tutar : 0,
        matrah: Number.isFinite(matrah as number) ? (matrah as number) : null,
      };
    })
    .filter((b: BreakdownItem) => b.tutar > 0 || (b.oran === 0 && (b.matrah ?? 0) > 0));
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
    const { records, virtualGroups, virtualExpectedBreakdown } = this.aggregateMultiRateRecords(rawRecords);

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
        const { score, reasons, strictMatch } = this.calculateScore(record, image, mihsapBelgeTarihi, expectedBreakdown);
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
        const expectedBreakdown = virtualExpectedBreakdown.get(record.id) || null;
        const { score, reasons, strictMatch } = this.calculateScore(record, image, mihsapBelgeTarihi, expectedBreakdown);
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
    /** Multi-rate virtual record için Luca tarafının beklediği breakdown.
     *  Verildiyse OCR breakdown'u ile kalem-kalem karşılaştırılır. */
    expectedBreakdown: Array<{ oran: number; tutar: number }> | null = null,
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
    let rateExact = false;       // KDV oranı eşleşti mi (multi-rate kontrolü için)
    let rateMismatched = false;  // Oran kesin uyumsuz (ör. Luca %20, OCR breakdown'unda %20 yok)

    // ── BELGE NO ─────────────────────────────────────────────
    // E-fatura format'ı (3 harf + 13 rakam = 16 char): TAM EŞLEŞME ZORUNLU.
    //   Bu numaralar GİB tarafından merkezi atanır, yıllık seri unique. 1 karakter
    //   farkı bile FARKLI BELGE'dir (örn. GIB...0008 ≠ GIB...0007). Fuzzy match yok.
    // ÖKC fişi (≤6 char): Leading zero stripped tam eşleşme.
    // Diğer (gider pusulası/SMM/dekont): %95+ similarity ile kısmi (1 karakter
    //   tolerans uzun belge no'larda).
    const belgeNoWeight = isOkcFisi ? 0.45 : 0.7;
    const isEFaturaFormat = (s: string): boolean =>
      /^[A-Z]{3}\d{13}$/.test(s); // EFA/ESR/BEF/GHN/GIB/EFT/IRU/KMI + 4 yıl + 9 sıra
    if (record.belgeNo && imgBelgeNo) {
      const normA = this.normalizeBelgeNo(record.belgeNo);
      const normB = this.normalizeBelgeNo(imgBelgeNo);
      // Leading zero-stripped karşılaştırma — "0599" = "599"
      // ÖKC fişlerde Luca genelde sıfır önekli kayıt ("0599"), OCR çıplak ("599")
      const strippedA = this.stripLeadingZeros(normA);
      const strippedB = this.stripLeadingZeros(normB);

      const isEFaturaPair = isEFaturaFormat(normA) || isEFaturaFormat(normB);

      if (normA === normB || strippedA === strippedB) {
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
        } else if (similarity >= 0.75) {
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
    const recordRate = record.kdvOrani != null
      ? parseFloat(record.kdvOrani.toString())
      : null;
    const imageBreakdown = getImageBreakdown(image);

    if (record.kdvTutari && imgKdv) {
      const recordKdv = parseFloat(record.kdvTutari.toString());

      // Bu BİR ORANLI Luca kaydı + OCR breakdown var → oran-bazlı karşılaştırma
      if (recordRate != null && recordRate > 0 && imageBreakdown.length > 0) {
        const matchingItem = imageBreakdown.find(
          (b) => Math.abs(b.oran - recordRate) < 0.5,
        );
        if (matchingItem) {
          // Oran var — şimdi tutarı kıyasla
          rateExact = true;
          const diff = Math.abs(matchingItem.tutar - recordKdv) / (recordKdv || 1);
          if (diff < 0.01) {
            score += 0.3;
            kdvExact = true;
          } else if (diff < 0.05) {
            score += 0.12;
            reasons.push(
              `%${recordRate} KDV farkı: Luca ${this.fmtAmt(recordKdv)} ≠ Fatura ${this.fmtAmt(matchingItem.tutar)} (%${Math.round(diff * 100)})`,
            );
          } else {
            reasons.push(
              `%${recordRate} KDV uyumsuz: Luca ${this.fmtAmt(recordKdv)} ≠ Fatura ${this.fmtAmt(matchingItem.tutar)}`,
            );
          }
        } else {
          // Luca'da %20 var ama OCR breakdown'unda %20 yok — KESİN UYUMSUZ
          rateMismatched = true;
          const ranges = imageBreakdown.map((b) => `%${b.oran}`).join(', ');
          reasons.push(
            `KDV oranı uyumsuz: Luca %${recordRate} → Faturada bulunamadı (faturada: ${ranges || 'yok'})`,
          );
        }
      } else {
        // Klasik toplam karşılaştırması — virtual record veya tek oran + breakdown yok
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
      }
    } else if (!imgKdv && record.kdvTutari) {
      score += 0.1;
      reasons.push('Görselden KDV tutarı okunamadı');
    }

    // ── SATICI KARŞILAŞTIRMASI (arka plan, UI'da görünmez) ──
    // Aynı belge no'lu farklı firmaların faturaları eşleşmesin.
    // ÖKC fişlerinde 0001, 0002 gibi kısa numaralar; e-fatura'da bile aynı seri
    // numarası farklı satıcılarda tekrarlayabilir.
    //
    // Karşılaştırma stratejisi:
    //   - Luca tarafı: record.karsiTaraf (örn. "ÖZ ELA TURİZM TAŞIMACILIK İNŞAAT...")
    //   - OCR tarafı:  image.ocrSatici (örn. "GÜRTUR PERSONEL TAŞIMACILIĞI...")
    //   - Normalize edilip (UPPER, noktalama temizliği, "LTD ŞTİ"/"A.Ş."/"TİC."
    //     gibi suffix'ler atılır) similarity karşılaştırılır.
    //   - %50+ benzerlik = aynı firma kabul edilir (kısaltmalar tolere edilir)
    //   - %50- = farklı firma → score sert düşürülür, MATCHED engellenir.
    let saticiMismatch = false;
    const recordSatici = (record.karsiTaraf || '').trim();
    const imgSatici = ((image as any).ocrSatici || '').trim();
    if (recordSatici && imgSatici) {
      const sim = this.companyNameSimilarity(recordSatici, imgSatici);
      if (sim >= 0.5) {
        // Aynı firma — küçük bir bonus
        score = Math.min(1, score + 0.05);
      } else {
        // Farklı firma → büyük penalty + MATCHED engellenir
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
    if (expectedBreakdown && expectedBreakdown.length > 1 && imageBreakdown.length > 0) {
      let allRatesMatched = true;
      for (const exp of expectedBreakdown) {
        const item = imageBreakdown.find((b) => Math.abs(b.oran - exp.oran) < 0.5);
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
        // Toplam zaten eşleştiği için kdvExact=true, ek bonus
        rateExact = true;
        score = Math.min(1, score + 0.05);
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
    // EK KURAL 2: Satıcı bilgisi varsa ve uyumsuzsa MATCHED ASLA verilmez
    // (aynı belge no'lu farklı firma).
    const strictMatch = belgeNoExact && kdvExact && dateExact && !rateMismatched && !saticiMismatch;

    // Oran uyumsuzluğu varsa skoru sert düşür — drift bekle, aday bile olmasın
    if (rateMismatched) {
      score = Math.max(0, score - 0.4);
    }
    // Satıcı uyumsuzsa: aday listesine bile girmesin
    if (saticiMismatch) {
      score = Math.max(0, score - 0.5);
    }

    return { score: Math.min(score, 1), reasons, strictMatch };
  }

  /**
   * İki firma adının benzerliğini (0–1) hesaplar.
   *
   * Türk firma adlarında kısaltma/varyasyon yaygın:
   *   "ÖZ ELA TURİZM TAŞIMACILIK İNŞAAT TİCARET LİMİTED ŞİRKETİ"
   *   "ÖZ ELA TURİZM TAŞ. İNŞ. TİC. LTD. ŞTİ."
   *   "Öz Ela Turizm Taşımacılık"
   * Bu varyasyonların hepsi aynı firma olarak kabul edilmeli.
   *
   * Strateji:
   *   1. Normalize: upper case, noktalama temizliği, çoklu boşluk tek boşluk
   *   2. Suffix temizliği: LTD ŞTİ / A.Ş. / TİC. / İNŞ. / TURİZM gibi yaygın
   *      kelimeler atılır (varyasyon yaratıyorlar)
   *   3. Token-based Jaccard similarity: kelime kümeleri kesişimi / birleşim
   *   4. Edge: çok kısa (1-2 kelime) firma adlarında string similarity'ye düş
   */
  private companyNameSimilarity(a: string, b: string): number {
    const normalize = (s: string): string[] => {
      const upper = s
        .toLocaleUpperCase('tr-TR')
        .replace(/[.,;:'"\-/\\()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // Yaygın firma suffix/prefix'lerini at — varyasyon yaratıyorlar
      const SUFFIX_REMOVE = new Set([
        'LTD', 'ŞTİ', 'STI', 'AŞ', 'A.Ş', 'A.Ş.', 'ANONİM', 'ANONIM', 'LİMİTED', 'LIMITED',
        'ŞİRKETİ', 'SIRKETI', 'TİCARET', 'TICARET', 'TİC', 'TIC',
        'SANAYİ', 'SANAYI', 'SAN', 'İNŞAAT', 'INSAAT', 'İNŞ', 'INS',
        'VE', 'İLE', 'ILE',
      ]);
      return upper.split(' ').filter((w) => w.length > 1 && !SUFFIX_REMOVE.has(w));
    };

    const tokensA = normalize(a);
    const tokensB = normalize(b);
    if (tokensA.length === 0 || tokensB.length === 0) {
      // Fallback: ham string similarity
      return this.stringSimilarity(
        a.toLocaleUpperCase('tr-TR').replace(/\s+/g, ''),
        b.toLocaleUpperCase('tr-TR').replace(/\s+/g, ''),
      );
    }

    // Jaccard similarity
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    const intersection = [...setA].filter((t) => setB.has(t)).length;
    const union = new Set([...setA, ...setB]).size;
    const jaccard = union > 0 ? intersection / union : 0;

    // Tek-kelime kısa firma adları için ek string similarity (Jaccard yetersiz)
    if (Math.min(tokensA.length, tokensB.length) <= 2) {
      const stringSim = this.stringSimilarity(tokensA.join(''), tokensB.join(''));
      return Math.max(jaccard, stringSim);
    }

    return jaccard;
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
    /**
     * Virtual record id → [{oran, tutar}] — Luca tarafından beklenen
     * KDV oranları ve tutarları. calculateScore içinde OCR breakdown'u
     * ile karşılaştırılır (kalem-kalem doğrulama).
     */
    virtualExpectedBreakdown: Map<string, Array<{ oran: number; tutar: number }>>;
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
    const virtualExpectedBreakdown = new Map<string, Array<{ oran: number; tutar: number }>>();

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
      // Beklenen breakdown — aynı oran iki satırda ise toplanır
      const expectedByRate = new Map<number, number>();
      for (const r of group) {
        const tutar = parseFloat(r.kdvTutari?.toString() || '0');
        kdvToplam += tutar;
        matrahToplam += parseFloat(r.kdvMatrahi?.toString() || '0');
        const oran = r.kdvOrani != null ? parseFloat(r.kdvOrani.toString()) : 0;
        if (oran > 0 && tutar > 0) {
          expectedByRate.set(oran, (expectedByRate.get(oran) || 0) + tutar);
        }
      }
      const base = group[0];
      const virtualId = `__virtual__:${key}`;
      const virtual: KdvRecord = {
        ...base,
        id: virtualId,
        kdvTutari: kdvToplam as any,
        // Multi-rate virtual'da kdvOrani null — calculateScore total karşılaştırması yapacak,
        // expected breakdown ayrı parametre olarak iletilecek.
        kdvOrani: null,
        ...(matrahToplam > 0 ? { kdvMatrahi: matrahToplam as any } : {}),
      };
      result.push(virtual);
      virtualGroups.set(virtualId, group.map((r) => r.id));
      if (expectedByRate.size > 0) {
        virtualExpectedBreakdown.set(
          virtualId,
          Array.from(expectedByRate.entries())
            .map(([oran, tutar]) => ({ oran, tutar }))
            .sort((a, b) => b.oran - a.oran),
        );
      }
      this.logger.log(
        `Çok oranlı KDV aggregate: belge=${base.belgeNo} · ${group.length} satır → toplam KDV=${kdvToplam.toFixed(2)} · oranlar=[${Array.from(expectedByRate.entries()).map(([o, t]) => `%${o}:${t.toFixed(2)}`).join(', ')}]`,
      );
    }

    return { records: result, virtualGroups, virtualExpectedBreakdown };
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
