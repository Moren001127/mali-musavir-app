import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as AdmZip from 'adm-zip';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  parseMukellefKlasoru, parseBeyanTipiKlasoru, mapBeyanTipi,
  parsePdfAd, formatDonem, adBenzerlik, normalizeAd,
} from './hattat-zip-parser';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // Hızlı + ekonomik; beyanname metadata için yeterli

export type ParsedBeyan = {
  vkn: string | null;
  mukellefAdi: string | null;
  beyanTipi: string | null;
  donem: string | null;
  beyanTarihi: string | null;
  tahakkukTutari: number | null;
  onayNo: string | null;
  guven: 'YUKSEK' | 'ORTA' | 'DUSUK' | null;
};

export type ImportResult = {
  dosyaAdi: string;
  durum: 'ok' | 'mukellef_yok' | 'parse_hatasi' | 'mevcut' | 'hata';
  beyanKaydiId?: string;
  sebep?: string;
  parsed?: ParsedBeyan;
};

/**
 * Beyan Kayıtları — Hattat'tan PDF klasörü import + listeleme.
 *
 * Akış:
 *  1) Kullanıcı çoklu PDF yükler (tahakkuk fişleri)
 *  2) Her PDF Claude'a gönderilir, VKN + tip + dönem + tutar parse edilir
 *  3) VKN'ye göre mükellefe eşleştirilir; varsa BeyanKaydi oluşturulur
 *  4) PDF S3'e yüklenir, pdfUrl olarak kaydedilir
 */
@Injectable()
export class BeyanKayitlariService {
  private readonly logger = new Logger(BeyanKayitlariService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /** Tek PDF için Claude'a metadata parse isteği gönder */
  async parseBeyannamePdf(pdfBase64: string): Promise<ParsedBeyan> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('ANTHROPIC_API_KEY tanımlı değil');

    const prompt = `Bu bir Türk vergi beyannamesi tahakkuk fişi PDF'i. Aşağıdaki bilgileri JSON olarak döndür, başka hiçbir şey yazma (sadece saf JSON):

{
  "vkn": "mükellefin 10 haneli VKN'si veya 11 haneli TCKN'si (bulamazsan null)",
  "mukellefAdi": "Mükellef adı veya şirket unvanı (bulamazsan null)",
  "beyanTipi": "BEYANNAME TİPİ kodu — sadece şunlardan biri: KDV1 | KDV2 | MUHSGK | DAMGA | POSET | KURUMLAR | GELIR | BILDIRGE | EDEFTER | GECICI_VERGI | DIGER",
  "donem": "yyyy-mm formatı (aylık beyanlar için, örn 2026-03). Yıllık beyanlar (Kurumlar/Gelir) için yyyy-YIL (örn 2025-YIL)",
  "beyanTarihi": "yyyy-mm-dd (beyannamenin verildiği tarih; bulamazsan null)",
  "tahakkukTutari": "TL cinsinden tahakkuk eden tutar — sadece sayı, kuruşsuz (örn 12450). Tahakkuk yoksa null",
  "onayNo": "GİB onay/tahakkuk numarası (string; bulamazsan null)",
  "guven": "YUKSEK | ORTA | DUSUK — verinin ne kadar net okunduğuna göre"
}

ÖNEMLİ kurallar:
- beyanTipi MUTLAKA yukarıdaki seçeneklerden biri olmalı. Emin olamazsan DIGER yaz.
- KDV1 = 1 No'lu KDV Beyannamesi (satıcı/genel KDV). KDV2 = 2 No'lu KDV (tevkifat).
- MUHSGK = Muhtasar ve Prim Hizmet Beyannamesi (birleşik).
- POSET = Geri Kazanım Katılım Payı Beyannamesi (poşet).
- GECICI_VERGI = Geçici Vergi Beyannamesi.
- VKN numarasından diğer rakamları filtrele (sadece haneleri al).
- Tutar varsa nokta/virgül temizleyip tam sayı (kuruşsuz) ver.`;

    const payload = {
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    };

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`Anthropic PDF parse hata: ${res.status} — ${errText.slice(0, 300)}`);
      throw new BadRequestException(`AI parse hatası (${res.status})`);
    }

    const data: any = await res.json();
    const text = (data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();

    // JSON'u çıkar (bazen markdown fenced gelebilir)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI cevabı JSON formatında değil: ' + text.slice(0, 120));
    const parsed = JSON.parse(jsonMatch[0]);

    return this.normalizeParsed(parsed);
  }

  private normalizeParsed(raw: any): ParsedBeyan {
    const normalizeVkn = (v: any): string | null => {
      if (!v) return null;
      const clean = String(v).replace(/\D/g, '');
      if (clean.length === 10 || clean.length === 11) return clean;
      return null;
    };
    const normalizeTipi = (t: any): string | null => {
      if (!t) return null;
      const up = String(t).toUpperCase().replace(/\s+/g, '_');
      const validKoder = ['KDV1', 'KDV2', 'MUHSGK', 'DAMGA', 'POSET', 'KURUMLAR', 'GELIR', 'BILDIRGE', 'EDEFTER', 'GECICI_VERGI', 'DIGER'];
      return validKoder.includes(up) ? up : 'DIGER';
    };
    const normalizeDonem = (d: any): string | null => {
      if (!d) return null;
      const s = String(d).trim();
      // yyyy-mm veya yyyy-YIL formatı
      if (/^\d{4}-(\d{2}|YIL)$/.test(s)) return s;
      // yyyy/mm → yyyy-mm
      const m = s.match(/^(\d{4})[-./](\d{1,2})$/);
      if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
      return null;
    };
    const normalizeTarih = (d: any): string | null => {
      if (!d) return null;
      const s = String(d).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return null;
    };
    const normalizeTutar = (t: any): number | null => {
      if (t == null || t === '') return null;
      const n = Number(String(t).replace(/[^\d.]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? Math.round(n) : null;
    };
    const normalizeGuven = (g: any): 'YUKSEK' | 'ORTA' | 'DUSUK' | null => {
      const s = String(g || '').toUpperCase();
      if (s.includes('YUKSEK') || s.includes('YÜKSEK') || s === 'HIGH') return 'YUKSEK';
      if (s.includes('ORTA') || s === 'MEDIUM') return 'ORTA';
      if (s.includes('DUSUK') || s.includes('DÜŞÜK') || s === 'LOW') return 'DUSUK';
      return null;
    };

    return {
      vkn: normalizeVkn(raw.vkn),
      mukellefAdi: raw.mukellefAdi ? String(raw.mukellefAdi).trim() : null,
      beyanTipi: normalizeTipi(raw.beyanTipi),
      donem: normalizeDonem(raw.donem),
      beyanTarihi: normalizeTarih(raw.beyanTarihi),
      tahakkukTutari: normalizeTutar(raw.tahakkukTutari),
      onayNo: raw.onayNo ? String(raw.onayNo).trim() : null,
      guven: normalizeGuven(raw.guven),
    };
  }

  /** Toplu PDF import. Her dosya için parse + DB kaydı + S3 yükleme. */
  async importPdfBatch(
    tenantId: string,
    files: Array<{ originalName: string; buffer: Buffer }>,
  ): Promise<{ batchId: string; results: ImportResult[] }> {
    const batchId = randomUUID();
    const results: ImportResult[] = [];

    for (const file of files) {
      try {
        // 1) PDF'i Claude'a gönder
        const pdfBase64 = file.buffer.toString('base64');
        const parsed = await this.parseBeyannamePdf(pdfBase64);

        if (!parsed.vkn) {
          results.push({ dosyaAdi: file.originalName, durum: 'parse_hatasi', sebep: 'VKN/TCKN bulunamadı', parsed });
          continue;
        }
        if (!parsed.beyanTipi || !parsed.donem) {
          results.push({ dosyaAdi: file.originalName, durum: 'parse_hatasi', sebep: 'Beyan tipi veya dönem bulunamadı', parsed });
          continue;
        }

        // 2) Mükellef bul (VKN ile)
        const taxpayer = await (this.prisma as any).taxpayer.findFirst({
          where: { tenantId, taxNumber: parsed.vkn },
          select: { id: true, taxNumber: true },
        });
        if (!taxpayer) {
          results.push({ dosyaAdi: file.originalName, durum: 'mukellef_yok', sebep: `VKN ${parsed.vkn} kayıtlı değil`, parsed });
          continue;
        }

        // 3) Zaten var mı?
        const existing = await (this.prisma as any).beyanKaydi.findUnique({
          where: { tenantId_taxpayerId_beyanTipi_donem: { tenantId, taxpayerId: taxpayer.id, beyanTipi: parsed.beyanTipi, donem: parsed.donem } },
          select: { id: true },
        });
        if (existing) {
          results.push({ dosyaAdi: file.originalName, durum: 'mevcut', sebep: 'Bu tip/dönem için kayıt zaten var', beyanKaydiId: existing.id, parsed });
          continue;
        }

        // 4) PDF'i S3'e yükle
        const s3Key = `${tenantId}/${taxpayer.id}/beyan/${parsed.beyanTipi}_${parsed.donem}_${randomUUID()}.pdf`;
        await this.storage.putBuffer(s3Key, file.buffer, 'application/pdf', {
          originalName: encodeURIComponent(file.originalName),
          vkn: parsed.vkn,
          donem: parsed.donem,
        });

        // 5) DB'ye yaz
        const kayit = await (this.prisma as any).beyanKaydi.create({
          data: {
            tenantId,
            taxpayerId: taxpayer.id,
            beyanTipi: parsed.beyanTipi,
            donem: parsed.donem,
            beyanTarihi: parsed.beyanTarihi ? new Date(parsed.beyanTarihi) : null,
            tahakkukTutari: parsed.tahakkukTutari,
            onayNo: parsed.onayNo,
            pdfUrl: s3Key,
            kaynak: 'hattat_excel', // PDF ama Hattat kaynaklı olduğu için bu kategoride
            importBatchId: batchId,
          },
        });

        results.push({ dosyaAdi: file.originalName, durum: 'ok', beyanKaydiId: kayit.id, parsed });
      } catch (e: any) {
        this.logger.error(`Import hatası [${file.originalName}]: ${e?.message || e}`);
        results.push({ dosyaAdi: file.originalName, durum: 'hata', sebep: (e?.message || 'Bilinmeyen hata').slice(0, 200) });
      }
    }

    return { batchId, results };
  }

  /** Listele — filtre + mükellef join */
  async list(
    tenantId: string,
    opts: { taxpayerId?: string; beyanTipi?: string; donem?: string; search?: string; limit?: number } = {},
  ) {
    const where: any = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.beyanTipi) where.beyanTipi = opts.beyanTipi;
    if (opts.donem) where.donem = opts.donem;
    if (opts.search && opts.search.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { onayNo: { contains: q, mode: 'insensitive' } },
        { taxpayer: { companyName: { contains: q, mode: 'insensitive' } } },
        { taxpayer: { taxNumber: { contains: q } } },
      ];
    }

    return (this.prisma as any).beyanKaydi.findMany({
      where,
      include: {
        taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true } },
      },
      orderBy: [{ donem: 'desc' }, { beyanTipi: 'asc' }],
      take: opts.limit || 500,
    });
  }

  async delete(tenantId: string, id: string) {
    const kayit = await (this.prisma as any).beyanKaydi.findFirst({
      where: { id, tenantId },
      select: { id: true, pdfUrl: true },
    });
    if (!kayit) throw new NotFoundException('Kayıt bulunamadı');
    // PDF'i de sil
    if (kayit.pdfUrl) {
      try { await this.storage.deleteObject(kayit.pdfUrl); } catch {}
    }
    await (this.prisma as any).beyanKaydi.delete({ where: { id } });
  }

  /** PDF indirmek için presigned URL */
  async getPdfUrl(tenantId: string, id: string, filename = 'beyanname.pdf'): Promise<string> {
    const kayit = await (this.prisma as any).beyanKaydi.findFirst({
      where: { id, tenantId },
      select: { pdfUrl: true },
    });
    if (!kayit || !kayit.pdfUrl) throw new NotFoundException('PDF bulunamadı');
    return this.storage.getPresignedDownloadUrl(kayit.pdfUrl, filename);
  }

  // ══════════════════════════════════════════════════════════
  // HATTAT ZIP IMPORT — klasör yapısı + dosya adı regex parse
  // AI'a gerek yok; Hattat'ın ZIP'i deterministic.
  // ══════════════════════════════════════════════════════════
  async importHattatZip(tenantId: string, zipBuffer: Buffer): Promise<{
    batchId: string;
    ozet: { mukellefBulundu: number; mukellefYok: number; kayitEklendi: number; mevcut: number; parseHatasi: number };
    eslesmeyenler: Array<{ klasor: string; hattatId: string; ad: string; pdfSayisi: number }>;
    sonuclar: ImportResult[];
  }> {
    const batchId = randomUUID();
    const sonuclar: ImportResult[] = [];
    const eslesmeyenler: Array<{ klasor: string; hattatId: string; ad: string; pdfSayisi: number }> = [];
    let mukellefBulundu = 0;
    let mukellefYok = 0;
    let kayitEklendi = 0;
    let mevcut = 0;
    let parseHatasi = 0;

    // ZIP'i aç
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch (e: any) {
      throw new BadRequestException('ZIP dosyası açılamadı: ' + (e?.message || 'bilinmeyen hata'));
    }

    // Mükellef klasörlerine göre grupla
    // Girdi: "MOREN MALI MÜSAVIRLIK/ZEKI ÖZKAYNAK-598407/2025(KDV1-ASIL)/KDV1-3-2025-Tahakkuk-40687199.pdf"
    type PdfEntry = { mukellefKlasor: string; beyanKlasor: string; pdfAdi: string; buffer: Buffer };
    const perMukellef = new Map<string, PdfEntry[]>();

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (!/\.pdf$/i.test(entry.entryName)) continue;
      // Normalize separator + drop empty parts
      const parts = entry.entryName.replace(/\\/g, '/').split('/').filter(Boolean);
      // Son eleman PDF adı. Son-1 beyan tipi klasörü. Son-2 mükellef klasörü.
      if (parts.length < 3) continue;
      const pdfAdi = parts[parts.length - 1];
      const beyanKlasor = parts[parts.length - 2];
      const mukellefKlasor = parts[parts.length - 3];
      const buffer = entry.getData();
      if (!perMukellef.has(mukellefKlasor)) perMukellef.set(mukellefKlasor, []);
      perMukellef.get(mukellefKlasor)!.push({ mukellefKlasor, beyanKlasor, pdfAdi, buffer });
    }

    if (perMukellef.size === 0) {
      throw new BadRequestException('ZIP içinde PDF bulunamadı ya da klasör yapısı beklenenden farklı.');
    }

    // Mevcut mükellef listesini bir kez getir (fuzzy match için)
    const allTaxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, firstName: true, lastName: true, hattatId: true, taxNumber: true },
    });

    for (const [mukellefKlasor, pdfs] of perMukellef.entries()) {
      const parsed = parseMukellefKlasoru(mukellefKlasor);
      if (!parsed) {
        eslesmeyenler.push({ klasor: mukellefKlasor, hattatId: '—', ad: mukellefKlasor, pdfSayisi: pdfs.length });
        continue;
      }
      const { ad, hattatId } = parsed;

      // 1) Önce Hattat ID ile bul (daha önce import edilmişse)
      let taxpayer = allTaxpayers.find((t: any) => t.hattatId === hattatId);

      // 2) Yoksa isim benzerliği ile bul
      if (!taxpayer) {
        let bestScore = 0;
        let bestMatch: any = null;
        for (const t of allTaxpayers) {
          const isim = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim();
          if (!isim) continue;
          const score = adBenzerlik(ad, isim);
          if (score > bestScore) { bestScore = score; bestMatch = t; }
        }
        if (bestMatch && bestScore >= 0.6) {
          taxpayer = bestMatch;
          // Hattat ID'yi kalıcı sakla — sonraki import'larda direkt kullan
          try {
            await (this.prisma as any).taxpayer.update({ where: { id: taxpayer.id }, data: { hattatId } });
            taxpayer.hattatId = hattatId;
          } catch {}
        }
      }

      if (!taxpayer) {
        mukellefYok++;
        eslesmeyenler.push({ klasor: mukellefKlasor, hattatId, ad, pdfSayisi: pdfs.length });
        continue;
      }
      mukellefBulundu++;

      // PDF'leri tip + dönem + onayNo bazında grupla (tahakkuk + beyanname çifti için)
      type Key = string; // `${tip}::${donem}::${onayGrubu}`
      type Grup = {
        tip: string; // mapped (KDV1, MUHSGK, GECICI_VERGI vb.)
        donem: string;
        onayNo: string | null; // tahakkuk fişi varsa onayNo oradan
        tahakkukBuffer?: Buffer; tahakkukAd?: string;
        beyannameBuffer?: Buffer; beyannameAd?: string;
      };
      const gruplar = new Map<Key, Grup>();

      for (const pdf of pdfs) {
        const beyanTipiRaw = parseBeyanTipiKlasoru(pdf.beyanKlasor);
        if (!beyanTipiRaw) continue;
        const mappedTipi = mapBeyanTipi(beyanTipiRaw);
        const info = parsePdfAd(pdf.pdfAdi);
        if (!info) {
          parseHatasi++;
          sonuclar.push({ dosyaAdi: pdf.pdfAdi, durum: 'parse_hatasi', sebep: 'Dosya adı formatı beklenenden farklı' });
          continue;
        }
        const donem = formatDonem(mappedTipi, info.ay, info.yil);
        // Tahakkuk ve beyanname aynı onay grubunda değil (sayıları sequential olabilir).
        // Tip+Dönem anahtarıyla gruplayıp iki rolü ayrı koyuyoruz.
        const key = `${mappedTipi}::${donem}`;
        if (!gruplar.has(key)) {
          gruplar.set(key, { tip: mappedTipi, donem, onayNo: null });
        }
        const g = gruplar.get(key)!;
        if (info.rolu === 'tahakkuk') {
          g.tahakkukBuffer = pdf.buffer;
          g.tahakkukAd = pdf.pdfAdi;
          g.onayNo = info.onayNo; // tahakkuk onay no'su birincil
        } else if (info.rolu === 'beyanname') {
          g.beyannameBuffer = pdf.buffer;
          g.beyannameAd = pdf.pdfAdi;
          if (!g.onayNo) g.onayNo = info.onayNo;
        } else {
          // diger — tahakkuk yerine kullan
          if (!g.tahakkukBuffer) {
            g.tahakkukBuffer = pdf.buffer;
            g.tahakkukAd = pdf.pdfAdi;
          }
          if (!g.onayNo) g.onayNo = info.onayNo;
        }
      }

      for (const g of gruplar.values()) {
        try {
          // Mevcut kayıt?
          const existing = await (this.prisma as any).beyanKaydi.findUnique({
            where: { tenantId_taxpayerId_beyanTipi_donem: { tenantId, taxpayerId: taxpayer.id, beyanTipi: g.tip, donem: g.donem } },
            select: { id: true },
          });
          if (existing) {
            mevcut++;
            sonuclar.push({
              dosyaAdi: `${ad} · ${g.tip} · ${g.donem}`,
              durum: 'mevcut',
              sebep: 'Bu mükellefe bu tip/dönem için zaten kayıt var',
              beyanKaydiId: existing.id,
            });
            continue;
          }

          // PDF'leri yükle
          const base = `${tenantId}/${taxpayer.id}/beyan`;
          const tahakkukKey = g.tahakkukBuffer ? `${base}/${g.tip}_${g.donem}_Tahakkuk_${randomUUID()}.pdf` : null;
          const beyannameKey = g.beyannameBuffer ? `${base}/${g.tip}_${g.donem}_Beyanname_${randomUUID()}.pdf` : null;
          if (tahakkukKey && g.tahakkukBuffer) {
            await this.storage.putBuffer(tahakkukKey, g.tahakkukBuffer, 'application/pdf', {
              mukellef: encodeURIComponent(ad), tip: g.tip, donem: g.donem, rolu: 'tahakkuk',
            });
          }
          if (beyannameKey && g.beyannameBuffer) {
            await this.storage.putBuffer(beyannameKey, g.beyannameBuffer, 'application/pdf', {
              mukellef: encodeURIComponent(ad), tip: g.tip, donem: g.donem, rolu: 'beyanname',
            });
          }

          // DB kayıt
          const kayit = await (this.prisma as any).beyanKaydi.create({
            data: {
              tenantId,
              taxpayerId: taxpayer.id,
              beyanTipi: g.tip,
              donem: g.donem,
              onayNo: g.onayNo,
              pdfUrl: tahakkukKey,
              beyannameUrl: beyannameKey,
              kaynak: 'hattat_excel',
              importBatchId: batchId,
            },
          });
          kayitEklendi++;
          sonuclar.push({
            dosyaAdi: `${ad} · ${g.tip} · ${g.donem}`,
            durum: 'ok',
            beyanKaydiId: kayit.id,
            parsed: {
              vkn: taxpayer.taxNumber || null,
              mukellefAdi: ad,
              beyanTipi: g.tip,
              donem: g.donem,
              beyanTarihi: null,
              tahakkukTutari: null,
              onayNo: g.onayNo,
              guven: 'YUKSEK',
            },
          });
        } catch (e: any) {
          this.logger.error(`Grup kayıt hatası: ${e?.message}`);
          sonuclar.push({
            dosyaAdi: `${ad} · ${g.tip} · ${g.donem}`,
            durum: 'hata',
            sebep: (e?.message || 'bilinmeyen hata').slice(0, 200),
          });
        }
      }
    }

    return {
      batchId,
      ozet: { mukellefBulundu, mukellefYok, kayitEklendi, mevcut, parseHatasi },
      eslesmeyenler,
      sonuclar,
    };
  }

  /** Özet — dashboard için: toplam/aylık/beyan tipi dağılımı */
  async ozet(tenantId: string) {
    const all = await (this.prisma as any).beyanKaydi.findMany({
      where: { tenantId },
      select: { beyanTipi: true, donem: true, tahakkukTutari: true },
    });
    const byTip: Record<string, number> = {};
    let toplamTahakkuk = 0;
    for (const k of all) {
      byTip[k.beyanTipi] = (byTip[k.beyanTipi] || 0) + 1;
      toplamTahakkuk += Number(k.tahakkukTutari || 0);
    }
    return { toplam: all.length, byTip, toplamTahakkuk };
  }
}
