import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as AdmZip from 'adm-zip';
import * as iconv from 'iconv-lite';
import { PDFParse } from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { tryDecrypt } from '../common/crypto';
import { canSpendOnApi } from '../common/ai-usage-logger';
import {
  parseMukellefKlasoru, parseBeyanTipiKlasoru, mapBeyanTipi,
  parsePdfAd, formatDonem, adBenzerlik, normalizeAd,
} from './hattat-zip-parser';

/**
 * ZIP entry'sinin adını Türkçe encoding'e göre decode et.
 * Hattat Windows programı ZIP üretirken CP437/CP850/Win1254 encoding kullanıyor.
 * Önce UTF-8 flag'e bak, yoksa Win1254 dene, yoksa orjinal bırak.
 */
function decodeZipEntryName(entry: any): string {
  // Eğer UTF-8 flag set ise entryName zaten UTF-8
  const flags = entry?.header?.flags;
  const utf8 = typeof flags === 'number' && (flags & 0x800) !== 0;
  if (utf8) return entry.entryName;

  // Raw byte buffer'ı al (rawEntryName) — Windows Turkish encoding'i dene
  try {
    const raw: Buffer | undefined = entry.rawEntryName;
    if (raw && Buffer.isBuffer(raw) && raw.length > 0) {
      // Windows-1254 (Türkçe) → UTF-8
      return iconv.decode(raw, 'win1254');
    }
  } catch {}
  return entry.entryName || '';
}

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

type BeyanPdfRole = 'beyanname' | 'tahakkuk' | 'unknown';

type TaxpayerLite = {
  id: string;
  taxNumber?: string | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

type SafePdfParse = {
  originalName: string;
  buffer: Buffer;
  role: BeyanPdfRole;
  taxpayer: TaxpayerLite | null;
  parsed: ParsedBeyan;
  text: string;
};

type SafeImportGroup = {
  taxpayer: TaxpayerLite;
  beyanTipi: string;
  donem: string;
  files: SafePdfParse[];
  beyanname?: SafePdfParse;
  tahakkuk?: SafePdfParse;
  onayNo: string | null;
  beyanTarihi: string | null;
  tahakkukTutari: number | null;
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

  private isTemporaryTaxType(type?: string | null) {
    return /^(GECICI_VERGI|GGECICI|KGECICI)$/i.test(String(type || ''));
  }

  private normalizeTextKey(value?: string | null) {
    return String(value || '')
      .toLocaleUpperCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private rawNoteText(notlar?: string | null) {
    if (!notlar) return '';
    try {
      const parsed = JSON.parse(notlar);
      return JSON.stringify(parsed?.raw || parsed);
    } catch {
      return String(notlar || '');
    }
  }

  private taxpayerLooksCorporate(taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    const nameKey = this.normalizeTextKey([
      taxpayer?.companyName,
      taxpayer?.firstName,
      taxpayer?.lastName,
    ].filter(Boolean).join(' '));
    if (/\b(LIMITED|LTD|ANONIM|A S|AS|SIRKET|SIRKETI|STI|KOOPERATIF)\b/.test(nameKey)) return true;
    return taxNumber.length === 10;
  }

  private taxpayerLooksPersonal(taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null) {
    const taxNumber = String(taxpayer?.taxNumber || '').replace(/\D/g, '');
    return taxNumber.length === 11 && !this.taxpayerLooksCorporate(taxpayer);
  }

  private canonicalTemporaryType(
    type: string,
    notlar?: string | null,
    taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null,
  ) {
    const current = String(type || '').toUpperCase();
    if (this.isTemporaryTaxType(current) && this.taxpayerLooksCorporate(taxpayer)) return 'KGECICI';
    if (this.isTemporaryTaxType(current) && this.taxpayerLooksPersonal(taxpayer)) return 'GGECICI';
    if (current === 'GGECICI' || current === 'KGECICI') return current;
    if (current !== 'GECICI_VERGI') return current;
    const key = this.normalizeTextKey(this.rawNoteText(notlar)).replace(/\s+/g, '');
    if (/GGECICI|GELIRGECICI|GELIRVERGISIGECICI/.test(key)) return 'GGECICI';
    if (/KGECICI|KURUMGECICI|KURUMLARGECICI|KURUMLARVERGISIGECICI/.test(key)) return 'KGECICI';
    return 'GECICI_VERGI';
  }

  private canonicalTemporaryPeriod(type: string, donem: string) {
    if (!this.isTemporaryTaxType(type)) return donem;
    const monthly = String(donem || '').match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
    if (!monthly) return donem;
    return `${monthly[1]}-Q${Math.ceil(Number(monthly[2]) / 3)}`;
  }

  private canonicalTemporaryIdentity(row: {
    taxpayerId: string;
    beyanTipi: string;
    donem: string;
    notlar?: string | null;
    taxpayer?: { taxNumber?: string | null; companyName?: string | null; firstName?: string | null; lastName?: string | null } | null;
  }) {
    if (!this.isTemporaryTaxType(row.beyanTipi)) return null;
    const beyanTipi = this.canonicalTemporaryType(row.beyanTipi, row.notlar, row.taxpayer);
    const donem = this.canonicalTemporaryPeriod(beyanTipi, row.donem);
    return { taxpayerId: row.taxpayerId, beyanTipi, donem };
  }

  private beyanKaydiMergeScore(row: any) {
    return (row.beyannameUrl ? 8 : 0)
      + (row.pdfUrl ? 8 : 0)
      + (row.xmlUrl ? 2 : 0)
      + (row.tahakkukTutari != null ? 4 : 0)
      + (row.onayNo ? 2 : 0)
      + (/^20\d{2}-Q[1-4]$/i.test(row.donem) ? 1 : 0);
  }

  private async repairTemporaryTaxDuplicates(tenantId: string) {
    const rows = await (this.prisma as any).beyanKaydi.findMany({
      where: { tenantId, beyanTipi: { in: ['GECICI_VERGI', 'GGECICI', 'KGECICI'] } },
      select: {
        id: true,
        tenantId: true,
        taxpayerId: true,
        beyanTipi: true,
        donem: true,
        beyanTarihi: true,
        tahakkukTutari: true,
        odemeTutari: true,
        onayNo: true,
        pdfUrl: true,
        beyannameUrl: true,
        xmlUrl: true,
        kaynak: true,
        importBatchId: true,
        notlar: true,
        createdAt: true,
        taxpayer: { select: { taxNumber: true, companyName: true, firstName: true, lastName: true } },
      },
    });
    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const key = this.canonicalTemporaryIdentity(row);
      if (!key) continue;
      const groupKey = `${key.taxpayerId}|${key.beyanTipi}|${key.donem}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push({ ...row, canonical: key });
    }

    for (const groupRows of groups.values()) {
      if (groupRows.length < 2 && groupRows[0]?.beyanTipi === groupRows[0]?.canonical.beyanTipi && groupRows[0]?.donem === groupRows[0]?.canonical.donem) continue;
      const canonical = groupRows[0].canonical;
      try {
        await (this.prisma as any).$transaction(async (tx: any) => {
          const canonicalExisting = groupRows.find((row) => row.beyanTipi === canonical.beyanTipi && row.donem === canonical.donem);
          const target = canonicalExisting || [...groupRows].sort((a, b) => this.beyanKaydiMergeScore(b) - this.beyanKaydiMergeScore(a))[0];
          const valueFor = (field: string) => target[field] ?? groupRows.find((row) => row[field] != null)?.[field] ?? null;
          await tx.beyanKaydi.update({
            where: { id: target.id },
            data: {
              beyanTipi: canonical.beyanTipi,
              donem: canonical.donem,
              beyanTarihi: valueFor('beyanTarihi'),
              tahakkukTutari: valueFor('tahakkukTutari'),
              odemeTutari: valueFor('odemeTutari'),
              onayNo: valueFor('onayNo'),
              pdfUrl: valueFor('pdfUrl'),
              beyannameUrl: valueFor('beyannameUrl'),
              xmlUrl: valueFor('xmlUrl'),
              kaynak: valueFor('kaynak') || 'gib_agent',
              importBatchId: valueFor('importBatchId'),
              notlar: valueFor('notlar'),
            },
          });

          const duplicateIds = groupRows.filter((row) => row.id !== target.id).map((row) => row.id);
          if (duplicateIds.length) await tx.beyanKaydi.deleteMany({ where: { id: { in: duplicateIds } } });

          const sourceKeys = [
            { beyanTipi: canonical.beyanTipi, donem: canonical.donem },
            ...groupRows.map((row) => ({ beyanTipi: row.beyanTipi, donem: row.donem })),
          ];
          const statuses = await tx.beyanDurumu.findMany({
            where: { tenantId, taxpayerId: canonical.taxpayerId, OR: sourceKeys },
          });
          if (statuses.length) {
            const statusTarget = statuses.find((row: any) => row.beyanTipi === canonical.beyanTipi && row.donem === canonical.donem) || statuses[0];
            const statusValueFor = (field: string) => statusTarget[field] ?? statuses.find((row: any) => row[field] != null)?.[field] ?? null;
            await tx.beyanDurumu.update({
              where: { id: statusTarget.id },
              data: {
                beyanTipi: canonical.beyanTipi,
                donem: canonical.donem,
                durum: statusValueFor('durum') || 'onaylandi',
                onayTarihi: statusValueFor('onayTarihi'),
                tahakkukTutari: statusValueFor('tahakkukTutari'),
                notlar: statusValueFor('notlar'),
              },
            });
            const statusDuplicateIds = statuses.filter((row: any) => row.id !== statusTarget.id).map((row: any) => row.id);
            if (statusDuplicateIds.length) await tx.beyanDurumu.deleteMany({ where: { id: { in: statusDuplicateIds } } });
          }
        });
      } catch (err: any) {
        this.logger.warn(`Gecici vergi mukerrer onarimi atlandi: ${err?.message || err}`);
      }
    }
  }

  /** Tek PDF için Claude'a metadata parse isteği gönder */
  async parseBeyannamePdf(pdfBase64: string, tenantId?: string): Promise<ParsedBeyan> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('ANTHROPIC_API_KEY tanımlı değil');
    // Aylık ücretli API tavanı dolduysa beyanname PDF okuma geçici durur (çağıran catch ile devam eder).
    if (!(await canSpendOnApi(this.prisma, tenantId || 'default', 'beyan-kayitlari'))) {
      throw new BadRequestException('AI aylık maliyet tavanı doldu — beyanname PDF okuma geçici durduruldu.');
    }

    const prompt = `Bu bir Türk vergi beyannamesi tahakkuk fişi PDF'i. Aşağıdaki bilgileri JSON olarak döndür, başka hiçbir şey yazma (sadece saf JSON):

{
  "vkn": "mükellefin 10 haneli VKN'si veya 11 haneli TCKN'si (bulamazsan null)",
  "mukellefAdi": "Mükellef adı veya şirket unvanı (bulamazsan null)",
  "beyanTipi": "BEYANNAME TİPİ kodu — sadece şunlardan biri: KDV1 | KDV2 | MUHSGK | DAMGA | POSET | KURUMLAR | GELIR | BILDIRGE | EDEFTER | GGECICI | KGECICI | GECICI_VERGI | DIGER",
  "donem": "yyyy-mm formatı (aylık beyanlar için, örn 2026-03). Yıllık beyanlar (Kurumlar/Gelir) için yyyy-YIL (örn 2025-YIL)",
  "beyanTarihi": "yyyy-mm-dd (beyannamenin verildiği tarih; bulamazsan null)",
  "tahakkukTutari": "TL cinsinden tahakkuk eden tutar — sadece sayı, kuruşu koru (örn 1085.20). Tahakkuk yoksa null",
  "onayNo": "GİB onay/tahakkuk numarası (string; bulamazsan null)",
  "guven": "YUKSEK | ORTA | DUSUK — verinin ne kadar net okunduğuna göre"
}

ÖNEMLİ kurallar:
- beyanTipi MUTLAKA yukarıdaki seçeneklerden biri olmalı. Emin olamazsan DIGER yaz.
- KDV1 = 1 No'lu KDV Beyannamesi (satıcı/genel KDV). KDV2 = 2 No'lu KDV (tevkifat).
- MUHSGK = Muhtasar ve Prim Hizmet Beyannamesi (birleşik).
- POSET = Geri Kazanım Katılım Payı Beyannamesi (poşet).
- GGECICI = Gelir Geçici Vergi Beyannamesi. KGECICI = Kurum Geçici Vergi Beyannamesi. Sadece ayrım okunamıyorsa GECICI_VERGI yaz.
- VKN numarasından diğer rakamları filtrele (sadece haneleri al).
- Tutar varsa Türkçe para formatını sayıya çevir ve kuruşu koru; örn 1.085,20 -> 1085.20.`;

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
      const validKoder = ['KDV1', 'KDV2', 'MUHSGK', 'DAMGA', 'POSET', 'KURUMLAR', 'GELIR', 'BILDIRGE', 'EDEFTER', 'GGECICI', 'KGECICI', 'GECICI_VERGI', 'DIGER'];
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
      if (typeof t === 'number') return Number.isFinite(t) ? Math.round(t * 100) / 100 : null;
      const raw = String(t).trim();
      const normalized = raw.includes(',')
        ? raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
        : raw.replace(/[^\d.-]/g, '');
      const n = Number(normalized);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
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
  private basename(path: string) {
    return String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || String(path || '');
  }

  private fullPathKey(path: string, text = '') {
    return this.normalizeTextKey(`${path || ''} ${text || ''}`);
  }

  private taxpayerDisplayName(taxpayer?: TaxpayerLite | null) {
    if (!taxpayer) return null;
    return taxpayer.companyName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') || taxpayer.taxNumber || null;
  }

  private buildTaxpayerLookup(taxpayers: TaxpayerLite[]) {
    const byTaxNo = new Map<string, TaxpayerLite>();
    for (const taxpayer of taxpayers) {
      const taxNo = this.normalizeTaxNo(taxpayer.taxNumber);
      if (taxNo) byTaxNo.set(taxNo, taxpayer);
    }
    return byTaxNo;
  }

  private inferPdfRole(originalName: string, text: string, amount: number | null): BeyanPdfRole {
    const pathKey = this.fullPathKey(originalName);
    if (/\bTAHAKKUK\b|\bTAHAKUK\b|\bFIS\b|\bFISI\b/.test(pathKey)) return 'tahakkuk';
    if (/\bBEYANNAME\b|\bEBEYANNAME\b|\bBEYAN\b/.test(pathKey)) return 'beyanname';
    const textKey = this.fullPathKey('', text.slice(0, 4000));
    if (/\bTAHAKKUK\s+FISI\b|\bTAHAKKUK\s+NO\b/.test(textKey)) return 'tahakkuk';
    if (/\bBEYANNAME\b|\bEBEYANNAME\b/.test(textKey)) return 'beyanname';
    if (amount != null) return 'tahakkuk';
    return 'unknown';
  }

  private inferBeyanTipi(originalName: string, text: string, taxpayer?: TaxpayerLite | null): string | null {
    const filenameInfo = parsePdfAd(this.basename(originalName));
    if (filenameInfo) {
      const mapped = mapBeyanTipi(filenameInfo.tip);
      if (mapped && mapped !== 'DIGER') return this.canonicalTemporaryType(mapped, null, taxpayer);
    }

    const parts = String(originalName || '').replace(/\\/g, '/').split('/').filter(Boolean);
    for (const part of parts.reverse()) {
      const folderTip = parseBeyanTipiKlasoru(part);
      if (!folderTip) continue;
      const mapped = mapBeyanTipi(folderTip);
      if (mapped && mapped !== 'DIGER') return this.canonicalTemporaryType(mapped, null, taxpayer);
    }

    const key = this.fullPathKey(originalName, text).replace(/\s+/g, ' ');
    let type: string | null = null;
    if (/\bKGECICI\b|\bKURUM\b.{0,40}\bGECICI\b|\bKURUMLAR\b.{0,40}\bGECICI\b/.test(key)) type = 'KGECICI';
    else if (/\bGGECICI\b|\bGELIR\b.{0,40}\bGECICI\b/.test(key)) type = 'GGECICI';
    else if (/\bGECICI\b.{0,30}\bVERGI\b|\bGECICI_VERGI\b/.test(key)) type = 'GECICI_VERGI';
    else if (/\bKDV2\b|\bKDV\s*2\b|\b2\s*NOLU\b.{0,60}\bKDV\b|\bTEVKIFAT\b/.test(key)) type = 'KDV2';
    else if (/\bKDV1\b|\bKDV\s*1\b|\b1\s*NOLU\b.{0,60}\bKDV\b|\bKATMA\b.{0,30}\bDEGER\b.{0,30}\bVERGISI\b/.test(key)) type = 'KDV1';
    else if (/\bMUHSGK\b|\bMUHTASAR\b|\bPRIM\b.{0,20}\bHIZMET\b/.test(key)) type = 'MUHSGK';
    else if (/\bDAMGA\b/.test(key)) type = 'DAMGA';
    else if (/\bPOSET\b|\bGERI\b.{0,20}\bKAZANIM\b|\bKATILIM\b.{0,20}\bPAYI\b/.test(key)) type = 'POSET';
    else if (/\bKURUMLAR\b/.test(key)) type = 'KURUMLAR';
    else if (/\bGELIR\b/.test(key)) type = 'GELIR';
    else if (/\bEDEFTER\b|\bE\s*DEFTER\b/.test(key)) type = 'EDEFTER';
    else if (/\bBILDIRGE\b/.test(key)) type = 'BILDIRGE';

    return type ? this.canonicalTemporaryType(type, null, taxpayer) : null;
  }

  private inferDonem(originalName: string, text: string, beyanTipi?: string | null): string | null {
    const filenameInfo = parsePdfAd(this.basename(originalName));
    if (filenameInfo) {
      const mapped = beyanTipi || mapBeyanTipi(filenameInfo.tip);
      return this.canonicalTemporaryPeriod(mapped, formatDonem(mapped, filenameInfo.ay, filenameInfo.yil));
    }

    const raw = `${originalName || ''} ${text || ''}`;
    const annual = (beyanTipi === 'KURUMLAR' || beyanTipi === 'GELIR') ? raw.match(/\b(20\d{2})\b/) : null;
    if (annual) return `${annual[1]}-YIL`;

    const rangeYearMonth = raw.match(/\b(20\d{2})\s*[\/.-]\s*(0?[1-9]|1[0-2])\s*[-–—]\s*(20\d{2})\s*[\/.-]\s*(0?[1-9]|1[0-2])\b/);
    if (rangeYearMonth) {
      const monthly = `${rangeYearMonth[3]}-${String(Number(rangeYearMonth[4])).padStart(2, '0')}`;
      return beyanTipi ? this.canonicalTemporaryPeriod(beyanTipi, monthly) : monthly;
    }

    const rangeMonthYear = raw.match(/\b(0?[1-9]|1[0-2])\s*[\/.-]\s*(20\d{2})\s*[-–—]\s*(0?[1-9]|1[0-2])\s*[\/.-]\s*(20\d{2})\b/);
    if (rangeMonthYear) {
      const monthly = `${rangeMonthYear[4]}-${String(Number(rangeMonthYear[3])).padStart(2, '0')}`;
      return beyanTipi ? this.canonicalTemporaryPeriod(beyanTipi, monthly) : monthly;
    }

    const quarter = raw.match(/\b(20\d{2})\s*[-/ ]?\s*Q\s*([1-4])\b/i);
    if (quarter) return `${quarter[1]}-Q${quarter[2]}`;

    const singleYearMonth = raw.match(/\b(20\d{2})\s*[\/.-]\s*(0?[1-9]|1[0-2])\b/);
    if (singleYearMonth) {
      const monthly = `${singleYearMonth[1]}-${String(Number(singleYearMonth[2])).padStart(2, '0')}`;
      return beyanTipi ? this.canonicalTemporaryPeriod(beyanTipi, monthly) : monthly;
    }

    const singleMonthYear = raw.match(/\b(0?[1-9]|1[0-2])\s*[\/.-]\s*(20\d{2})\b/);
    if (singleMonthYear) {
      const monthly = `${singleMonthYear[2]}-${String(Number(singleMonthYear[1])).padStart(2, '0')}`;
      return beyanTipi ? this.canonicalTemporaryPeriod(beyanTipi, monthly) : monthly;
    }

    return null;
  }

  private inferBeyanTarihi(text: string): string | null {
    const match = String(text || '').match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
    if (!match) return null;
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  private inferOnayNo(originalName: string, text: string): string | null {
    const filenameInfo = parsePdfAd(this.basename(originalName));
    if (filenameInfo?.onayNo) return filenameInfo.onayNo;
    const compact = this.fullPathKey(originalName, text);
    const labelled = compact.match(/\b(?:ONAY|TAHAKKUK|FIS|FISI)\s*(?:NO|NUMARASI)?\s*[:#-]?\s*([A-Z0-9-]{6,40})\b/);
    return labelled?.[1] || null;
  }

  private async parsePdfForSafeImport(
    tenantId: string,
    file: { originalName: string; buffer: Buffer },
    taxpayerByTaxNo: Map<string, TaxpayerLite>,
  ): Promise<SafePdfParse | ImportResult> {
    const text = await this.pdfText(file.buffer).catch((err) => {
      this.logger.warn(`PDF metni okunamadi [${file.originalName}]: ${err?.message || err}`);
      return '';
    });
    const taxCandidates = this.extractTaxNumbers(`${file.originalName} ${text}`);
    let taxpayer = taxCandidates.map((taxNo) => taxpayerByTaxNo.get(taxNo)).find(Boolean) || null;

    let aiParsed: ParsedBeyan | null = null;
    let beyanTipi = this.inferBeyanTipi(file.originalName, text, taxpayer);
    let donem = this.inferDonem(file.originalName, text, beyanTipi);
    const fastAmount = this.extractTahakkukAmount(text);
    let role = this.inferPdfRole(file.originalName, text, fastAmount);

    if (!taxpayer || !beyanTipi || !donem || (role === 'tahakkuk' && fastAmount == null)) {
      aiParsed = await this.parseBeyannamePdf(file.buffer.toString('base64'), tenantId).catch((err) => {
        this.logger.warn(`AI fallback atlandi [${file.originalName}]: ${err?.message || err}`);
        return null;
      });
    }

    if (!taxpayer && aiParsed?.vkn) taxpayer = taxpayerByTaxNo.get(this.normalizeTaxNo(aiParsed.vkn)) || null;
    if (!taxpayer) {
      return {
        dosyaAdi: file.originalName,
        durum: 'mukellef_yok',
        sebep: taxCandidates.length ? `PDF icindeki VKN/TCKN portaldaki mukelleflerle eslesmedi: ${taxCandidates.join(', ')}` : 'PDF icinde portaldaki mukellefle eslesen VKN/TCKN bulunamadi',
        parsed: aiParsed || {
          vkn: taxCandidates[0] || null,
          mukellefAdi: null,
          beyanTipi: beyanTipi || null,
          donem: donem || null,
          beyanTarihi: null,
          tahakkukTutari: null,
          onayNo: null,
          guven: text ? 'ORTA' : 'DUSUK',
        },
      };
    }

    beyanTipi = beyanTipi || aiParsed?.beyanTipi || null;
    if (beyanTipi) beyanTipi = this.canonicalTemporaryType(beyanTipi, null, taxpayer);
    donem = donem || this.inferDonem(file.originalName, text, beyanTipi) || aiParsed?.donem || null;
    if (beyanTipi && donem) donem = this.canonicalTemporaryPeriod(beyanTipi, donem);
    if (!beyanTipi || !donem) {
      return {
        dosyaAdi: file.originalName,
        durum: 'parse_hatasi',
        sebep: 'Beyan tipi veya donem guvenli sekilde okunamadi',
        parsed: aiParsed || {
          vkn: this.normalizeTaxNo(taxpayer.taxNumber),
          mukellefAdi: this.taxpayerDisplayName(taxpayer),
          beyanTipi,
          donem,
          beyanTarihi: null,
          tahakkukTutari: null,
          onayNo: null,
          guven: 'DUSUK',
        },
      };
    }

    let tahakkukTutari = role === 'tahakkuk' ? fastAmount : null;
    if (role === 'unknown' && (fastAmount != null || aiParsed?.tahakkukTutari != null)) role = 'tahakkuk';
    if (role === 'unknown') role = 'beyanname';
    if (role === 'tahakkuk' && tahakkukTutari == null) tahakkukTutari = aiParsed?.tahakkukTutari ?? null;

    const parsed: ParsedBeyan = {
      vkn: this.normalizeTaxNo(taxpayer.taxNumber),
      mukellefAdi: aiParsed?.mukellefAdi || this.taxpayerDisplayName(taxpayer),
      beyanTipi,
      donem,
      beyanTarihi: aiParsed?.beyanTarihi || this.inferBeyanTarihi(text),
      tahakkukTutari,
      onayNo: this.inferOnayNo(file.originalName, text) || aiParsed?.onayNo || null,
      guven: text ? 'YUKSEK' : (aiParsed?.guven || 'ORTA'),
    };

    return { originalName: file.originalName, buffer: file.buffer, role, taxpayer, parsed, text };
  }

  private async persistSafeImportGroup(
    tenantId: string,
    batchId: string,
    group: SafeImportGroup,
  ): Promise<ImportResult> {
    const existing = await (this.prisma as any).beyanKaydi.findUnique({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: group.taxpayer.id,
          beyanTipi: group.beyanTipi,
          donem: group.donem,
        },
      },
      select: {
        id: true,
        pdfUrl: true,
        beyannameUrl: true,
        onayNo: true,
        tahakkukTutari: true,
        beyanTarihi: true,
        importBatchId: true,
      },
    });

    const base = `${tenantId}/${group.taxpayer.id}/beyan`;
    let tahakkukKey: string | null = null;
    let beyannameKey: string | null = null;
    const names = group.files.map((file) => file.originalName);

    if (group.tahakkuk && !existing?.pdfUrl) {
      tahakkukKey = `${base}/${group.beyanTipi}_${group.donem}_Tahakkuk_${randomUUID()}.pdf`;
      await this.storage.putBuffer(tahakkukKey, group.tahakkuk.buffer, 'application/pdf', {
        originalName: encodeURIComponent(group.tahakkuk.originalName),
        vkn: this.normalizeTaxNo(group.taxpayer.taxNumber),
        donem: group.donem,
        rolu: 'tahakkuk',
      });
    }

    if (group.beyanname && !existing?.beyannameUrl) {
      beyannameKey = `${base}/${group.beyanTipi}_${group.donem}_Beyanname_${randomUUID()}.pdf`;
      await this.storage.putBuffer(beyannameKey, group.beyanname.buffer, 'application/pdf', {
        originalName: encodeURIComponent(group.beyanname.originalName),
        vkn: this.normalizeTaxNo(group.taxpayer.taxNumber),
        donem: group.donem,
        rolu: 'beyanname',
      });
    }

    const rawNotlar = JSON.stringify({
      import: 'safe_pdf',
      files: names,
      roles: group.files.map((file) => ({ name: file.originalName, role: file.role })),
    });

    const updateData: any = {};
    if (tahakkukKey) updateData.pdfUrl = tahakkukKey;
    if (beyannameKey) updateData.beyannameUrl = beyannameKey;
    if (!existing?.onayNo && group.onayNo) updateData.onayNo = group.onayNo;
    if (group.tahakkukTutari != null && existing?.tahakkukTutari !== group.tahakkukTutari) updateData.tahakkukTutari = group.tahakkukTutari;
    if (!existing?.beyanTarihi && group.beyanTarihi) updateData.beyanTarihi = new Date(group.beyanTarihi);
    if (Object.keys(updateData).length > 0) {
      updateData.importBatchId = existing?.importBatchId || batchId;
      updateData.notlar = rawNotlar;
    }

    let kayit: any;
    let changed = false;
    if (existing) {
      changed = Object.keys(updateData).length > 0;
      kayit = changed
        ? await (this.prisma as any).beyanKaydi.update({ where: { id: existing.id }, data: updateData })
        : existing;
    } else {
      kayit = await (this.prisma as any).beyanKaydi.create({
        data: {
          tenantId,
          taxpayerId: group.taxpayer.id,
          beyanTipi: group.beyanTipi,
          donem: group.donem,
          beyanTarihi: group.beyanTarihi ? new Date(group.beyanTarihi) : null,
          tahakkukTutari: group.tahakkukTutari,
          onayNo: group.onayNo,
          pdfUrl: tahakkukKey,
          beyannameUrl: beyannameKey,
          kaynak: 'drive_import',
          importBatchId: batchId,
          notlar: rawNotlar,
        },
      });
      changed = true;
    }

    await this.syncBeyanDurumuFromKayit(tenantId, {
      taxpayerId: group.taxpayer.id,
      beyanTipi: group.beyanTipi,
      donem: group.donem,
      beyanTarihi: group.beyanTarihi,
      tahakkukTutari: group.tahakkukTutari,
      notlar: rawNotlar,
    }).catch((err) => {
      this.logger.warn(`BeyanDurumu senkronize edilemedi: ${err?.message || err}`);
    });

    return {
      dosyaAdi: names.join(' + '),
      durum: changed ? 'ok' : 'mevcut',
      sebep: existing ? (changed ? 'Mevcut kayit eksik PDF/tutar ile tamamlandi' : 'Bu beyanname/tahakkuk zaten kayitli') : undefined,
      beyanKaydiId: kayit.id,
      parsed: {
        vkn: this.normalizeTaxNo(group.taxpayer.taxNumber),
        mukellefAdi: this.taxpayerDisplayName(group.taxpayer),
        beyanTipi: group.beyanTipi,
        donem: group.donem,
        beyanTarihi: group.beyanTarihi,
        tahakkukTutari: group.tahakkukTutari,
        onayNo: group.onayNo,
        guven: 'YUKSEK',
      },
    };
  }

  private async syncBeyanDurumuFromKayit(
    tenantId: string,
    row: {
      taxpayerId: string;
      beyanTipi: string;
      donem: string;
      beyanTarihi: string | null;
      tahakkukTutari: number | null;
      notlar?: string | null;
    },
  ) {
    const data: any = {
      durum: 'onaylandi',
      notlar: row.notlar || null,
    };
    if (row.beyanTarihi) data.onayTarihi = new Date(row.beyanTarihi);
    if (row.tahakkukTutari != null) data.tahakkukTutari = row.tahakkukTutari;
    await (this.prisma as any).beyanDurumu.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: row.taxpayerId,
          beyanTipi: row.beyanTipi,
          donem: row.donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: row.taxpayerId,
        beyanTipi: row.beyanTipi,
        donem: row.donem,
        ...data,
      },
      update: data,
    });
  }

  async importPdfBatchSafe(
    tenantId: string,
    files: Array<{ originalName: string; buffer: Buffer }>,
  ): Promise<{ batchId: string; results: ImportResult[] }> {
    const batchId = randomUUID();
    const results: ImportResult[] = [];

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, taxNumber: true, companyName: true, firstName: true, lastName: true },
      take: 10000,
    }) as TaxpayerLite[];
    const taxpayerByTaxNo = this.buildTaxpayerLookup(taxpayers);
    const groups = new Map<string, SafeImportGroup>();

    for (const file of files) {
      try {
        const parsed = await this.parsePdfForSafeImport(tenantId, file, taxpayerByTaxNo);
        if ('durum' in parsed) {
          results.push(parsed);
          continue;
        }

        const taxpayer = parsed.taxpayer;
        const beyanTipi = parsed.parsed.beyanTipi;
        const donem = parsed.parsed.donem;
        if (!taxpayer || !beyanTipi || !donem) {
          results.push({
            dosyaAdi: parsed.originalName,
            durum: 'parse_hatasi',
            sebep: 'PDF icindeki mukellef, beyan tipi veya donem guvenli sekilde okunamadi',
            parsed: parsed.parsed,
          });
          continue;
        }

        const key = `${taxpayer.id}|${beyanTipi}|${donem}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            taxpayer,
            beyanTipi,
            donem,
            files: [],
            onayNo: null,
            beyanTarihi: null,
            tahakkukTutari: null,
          };
          groups.set(key, group);
        }

        group.files.push(parsed);
        group.onayNo = group.onayNo || parsed.parsed.onayNo || null;
        group.beyanTarihi = group.beyanTarihi || parsed.parsed.beyanTarihi || null;
        if (parsed.role === 'tahakkuk') {
          group.tahakkuk = group.tahakkuk || parsed;
          if (parsed.parsed.tahakkukTutari != null) group.tahakkukTutari = parsed.parsed.tahakkukTutari;
        } else {
          group.beyanname = group.beyanname || parsed;
        }
      } catch (e: any) {
        this.logger.error(`Guvenli PDF import hatasi [${file.originalName}]: ${e?.message || e}`);
        results.push({
          dosyaAdi: file.originalName,
          durum: 'hata',
          sebep: (e?.message || 'Bilinmeyen hata').slice(0, 200),
        });
      }
    }

    for (const group of groups.values()) {
      try {
        results.push(await this.persistSafeImportGroup(tenantId, batchId, group));
      } catch (e: any) {
        this.logger.error(`Guvenli PDF kayit hatasi [${group.taxpayer.id}/${group.beyanTipi}/${group.donem}]: ${e?.message || e}`);
        results.push({
          dosyaAdi: group.files.map((file) => file.originalName).join(' + '),
          durum: 'hata',
          sebep: (e?.message || 'Kayit sirasinda hata').slice(0, 200),
          parsed: {
            vkn: this.normalizeTaxNo(group.taxpayer.taxNumber),
            mukellefAdi: this.taxpayerDisplayName(group.taxpayer),
            beyanTipi: group.beyanTipi,
            donem: group.donem,
            beyanTarihi: group.beyanTarihi,
            tahakkukTutari: group.tahakkukTutari,
            onayNo: group.onayNo,
            guven: 'ORTA',
          },
        });
      }
    }

    return { batchId, results };
  }

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
    await this.repairTemporaryTaxDuplicates(tenantId).catch((err) => {
      this.logger.warn(`Gecici vergi liste onarimi calismadi: ${err?.message || err}`);
    });

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
        taxpayer: {
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            taxNumber: true,
            email: true,
            emails: true,
            phone: true,
            phones: true,
          },
        },
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

  /** Tahakkuk PDF için presigned URL */
  async bulkDelete(
    tenantId: string,
    opts: { ids?: string[]; taxpayerId?: string; beyanTipi?: string; donem?: string; search?: string } = {},
  ) {
    const where: any = { tenantId };
    if (opts.ids?.length) where.id = { in: opts.ids.slice(0, 2000) };
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

    type BeyanKaydiDeleteRow = {
      id: string;
      taxpayerId: string;
      beyanTipi: string;
      donem: string;
      pdfUrl: string | null;
      beyannameUrl: string | null;
      xmlUrl: string | null;
    };

    const rows = await (this.prisma as any).beyanKaydi.findMany({
      where,
      select: {
        id: true,
        taxpayerId: true,
        beyanTipi: true,
        donem: true,
        pdfUrl: true,
        beyannameUrl: true,
        xmlUrl: true,
      },
    }) as BeyanKaydiDeleteRow[];
    if (rows.length === 0) return { deleted: 0, statusDeleted: 0 };

    for (const row of rows) {
      for (const key of [row.pdfUrl, row.beyannameUrl, row.xmlUrl]) {
        if (key) {
          try { await this.storage.deleteObject(key); } catch {}
        }
      }
    }

    const statusKeys = rows
      .filter((r) => r.taxpayerId && r.beyanTipi && r.donem)
      .map((r) => ({ taxpayerId: r.taxpayerId, beyanTipi: r.beyanTipi, donem: r.donem }));

    return (this.prisma as any).$transaction(async (tx: any) => {
      const statusDeleted = statusKeys.length
        ? await tx.beyanDurumu.deleteMany({ where: { tenantId, OR: statusKeys } })
        : { count: 0 };
      const deleted = await tx.beyanKaydi.deleteMany({ where: { tenantId, id: { in: rows.map((r) => r.id) } } });
      return { deleted: deleted.count, statusDeleted: statusDeleted.count };
    });
  }

  async getPdfUrl(tenantId: string, id: string, filename = 'tahakkuk.pdf'): Promise<string> {
    const kayit = await (this.prisma as any).beyanKaydi.findFirst({
      where: { id, tenantId },
      select: { pdfUrl: true },
    });
    if (!kayit || !kayit.pdfUrl) throw new NotFoundException('Tahakkuk PDF bulunamadı');
    return this.storage.getPresignedDownloadUrl(kayit.pdfUrl, filename);
  }

  async getPdfFile(tenantId: string, id: string, filename = 'tahakkuk.pdf') {
    const kayit = await (this.prisma as any).beyanKaydi.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        taxpayerId: true,
        beyanTipi: true,
        donem: true,
        pdfUrl: true,
        taxpayer: { select: { taxNumber: true } },
      },
    });
    if (!kayit || !kayit.pdfUrl) throw new NotFoundException('Tahakkuk PDF bulunamadi');
    const buffer = await this.storage.getBuffer(kayit.pdfUrl);
    await this.ensureBeyanFileOwnerOrRepair(tenantId, kayit, 'tahakkuk', kayit.pdfUrl, buffer);
    await this.updateTahakkukAmountFromPdf(kayit.id, buffer).catch((err) => {
      this.logger.warn(`Tahakkuk tutari PDF'den guncellenemedi: ${err?.message || err}`);
    });
    return {
      buffer,
      filename,
      mimeType: 'application/pdf',
    };
  }

  /** Beyanname PDF için presigned URL */
  async getBeyannameUrl(tenantId: string, id: string, filename = 'beyanname.pdf'): Promise<string> {
    const kayit = await (this.prisma as any).beyanKaydi.findFirst({
      where: { id, tenantId },
      select: { beyannameUrl: true },
    });
    if (!kayit || !kayit.beyannameUrl) throw new NotFoundException('Beyanname PDF bulunamadı');
    return this.storage.getPresignedDownloadUrl(kayit.beyannameUrl, filename);
  }

  async getBeyannameFile(tenantId: string, id: string, filename = 'beyanname.pdf') {
    const kayit = await (this.prisma as any).beyanKaydi.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        taxpayerId: true,
        beyanTipi: true,
        donem: true,
        beyannameUrl: true,
        taxpayer: { select: { taxNumber: true } },
      },
    });
    if (!kayit || !kayit.beyannameUrl) throw new NotFoundException('Beyanname PDF bulunamadi');
    const buffer = await this.storage.getBuffer(kayit.beyannameUrl);
    await this.ensureBeyanFileOwnerOrRepair(tenantId, kayit, 'beyanname', kayit.beyannameUrl, buffer);
    return {
      buffer,
      filename,
      mimeType: 'application/pdf',
    };
  }

  private async ensureBeyanFileOwnerOrRepair(
    tenantId: string,
    kayit: {
      id: string;
      taxpayerId: string;
      beyanTipi: string;
      donem: string;
      taxpayer?: { taxNumber?: string | null } | null;
    },
    kind: 'beyanname' | 'tahakkuk',
    storageKey: string,
    buffer: Buffer,
  ) {
    const expectedTaxNo = this.normalizeTaxNo(kayit.taxpayer?.taxNumber);
    if (!expectedTaxNo) return;

    const text = await this.pdfText(buffer).catch((err) => {
      this.logger.warn(`${kind} PDF VKN kontrolu yapilamadi: ${err?.message || err}`);
      return '';
    });
    let ownerTaxNo: string | null = null;
    let parsed: ParsedBeyan | null = null;

    if (text) {
      const digits = text.replace(/\D/g, '');
      if (digits.includes(expectedTaxNo)) return;

      const seenTaxNos = this.extractTaxNumbers(text);
      ownerTaxNo = seenTaxNos.find((taxNo) => taxNo !== expectedTaxNo) || null;
    }

    if (!ownerTaxNo) {
      parsed = await this.parseBeyannamePdf(buffer.toString('base64')).catch((err) => {
        this.logger.warn(`${kind} PDF AI VKN kontrolu yapilamadi: ${err?.message || err}`);
        return null;
      });
      const parsedTaxNo = this.normalizeTaxNo(parsed?.vkn);
      if (parsedTaxNo === expectedTaxNo) return;
      ownerTaxNo = parsedTaxNo || null;
    }

    await this.clearBeyanFileLink(kayit.id, kind, storageKey);

    if (ownerTaxNo) {
      const owner = await this.findTaxpayerByTaxNo(tenantId, ownerTaxNo);
      if (owner?.id) {
        await this.moveBeyanFileLinkToOwner(
          tenantId,
          owner.id,
          {
            beyanTipi: parsed?.beyanTipi || kayit.beyanTipi,
            donem: parsed?.donem || kayit.donem,
          },
          kind,
          storageKey,
        );
      }
    }

    throw new NotFoundException(
      `${kind === 'beyanname' ? 'Beyanname' : 'Tahakkuk'} PDF bu mukellefe ait degil; hatali bag temizlendi. Listeyi yenileyin.`,
    );
  }

  private async clearBeyanFileLink(kayitId: string, kind: 'beyanname' | 'tahakkuk', storageKey: string) {
    await (this.prisma as any).beyanKaydi.updateMany({
      where: {
        id: kayitId,
        ...(kind === 'beyanname' ? { beyannameUrl: storageKey } : { pdfUrl: storageKey }),
      },
      data: kind === 'beyanname' ? { beyannameUrl: null } : { pdfUrl: null },
    });
  }

  private async moveBeyanFileLinkToOwner(
    tenantId: string,
    ownerTaxpayerId: string,
    source: { beyanTipi: string; donem: string },
    kind: 'beyanname' | 'tahakkuk',
    storageKey: string,
  ) {
    await (this.prisma as any).beyanKaydi.upsert({
      where: {
        tenantId_taxpayerId_beyanTipi_donem: {
          tenantId,
          taxpayerId: ownerTaxpayerId,
          beyanTipi: source.beyanTipi,
          donem: source.donem,
        },
      },
      create: {
        tenantId,
        taxpayerId: ownerTaxpayerId,
        beyanTipi: source.beyanTipi,
        donem: source.donem,
        kaynak: 'gib_agent',
        ...(kind === 'beyanname' ? { beyannameUrl: storageKey } : { pdfUrl: storageKey }),
      },
      update: kind === 'beyanname' ? { beyannameUrl: storageKey } : { pdfUrl: storageKey },
    });
  }

  private normalizeTaxNo(value?: string | null): string {
    return String(tryDecrypt(value) || value || '').replace(/\D/g, '');
  }

  private async findTaxpayerByTaxNo(tenantId: string, taxNo: string): Promise<{ id: string } | null> {
    const normalized = String(taxNo || '').replace(/\D/g, '');
    if (!normalized) return null;
    const direct = await (this.prisma as any).taxpayer.findFirst({
      where: { tenantId, taxNumber: normalized },
      select: { id: true },
    });
    if (direct?.id) return direct;

    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId },
      select: { id: true, taxNumber: true },
      take: 5000,
    });
    return taxpayers.find((taxpayer: any) => this.normalizeTaxNo(taxpayer.taxNumber) === normalized) || null;
  }

  private extractTaxNumbers(text: string): string[] {
    return Array.from(new Set(
      Array.from(String(text || '').matchAll(/\b\d{10,11}\b/g))
        .map((m) => m[0])
        .filter((value) => value.length === 10 || value.length === 11),
    ));
  }

  private devredenPdfCache = new Map<string, number | null>();

  /**
   * Önceki dönem KDV1 beyannamesinden "Sonraki Döneme Devreden KDV" tutarını okur.
   * Beyanname PDF'i pdf-parse ile metne çevrilir, ilgili satır regex'le bulunur.
   * 0,00 da geçerli sonuçtur (devir yok). Bulunamazsa null. beyanKaydi.id bazlı cache.
   */
  async getSonrakiDonemeDevreden(
    tenantId: string,
    taxpayerId: string,
    donem: string,
  ): Promise<{ tutar: number; beyanKaydiId: string } | null> {
    const kayit = await (this.prisma as any).beyanKaydi.findFirst({
      where: { tenantId, taxpayerId, beyanTipi: 'KDV1', donem },
      select: { id: true, beyannameUrl: true, pdfUrl: true },
    });
    if (!kayit) return null;
    const key = kayit.beyannameUrl || kayit.pdfUrl;
    if (!key) return null;

    if (this.devredenPdfCache.has(kayit.id)) {
      const v = this.devredenPdfCache.get(kayit.id) ?? null;
      return v == null ? null : { tutar: v, beyanKaydiId: kayit.id };
    }

    let tutar: number | null = null;
    try {
      const buf = await this.storage.getBuffer(key);
      // GİB beyanname PDF'inde pdf-parse, "Sonuç Hesapları" etiketlerini bir grup,
      // değerlerini ayrı bir "sadece-tutar" bloğu olarak AMA AYNI SIRADA veriyor.
      // Ham metni satırlara bölüp, "Sonraki Döneme Devreden"in değersiz-etiket
      // grubundaki sırasını bulup değer bloğundan aynı sıradaki tutarı alıyoruz.
      const raw = await this.pdfRawText(buf);
      tutar = this.extractSonrakiFromLines(raw);
      if (tutar == null) tutar = await this.extractSonrakiViaTable(buf);
    } catch (e: any) {
      this.logger.warn(`devreden PDF okunamadi [${kayit.id}]: ${e?.message || e}`);
    }
    this.devredenPdfCache.set(kayit.id, tutar);
    return tutar == null ? null : { tutar, beyanKaydiId: kayit.id };
  }

  private extractSonrakiDonemeDevreden(text: string): number | null {
    const compact = String(text || '').replace(/\s+/g, ' ');
    // "Sonraki Döneme Devreden Katma Değer Vergisi" sonuç tablosunun SON satırıdır.
    // GİB beyanname PDF'inde pdf-parse etiketleri ve değer sütununu AYRI bloklara
    // koyabildiği için tutar etiketin hemen yanında olmayabilir. Bu alan en son
    // satır olduğundan, ETİKETTEN SONRAKİ SON Türk-para tutarı onun değeridir
    // (örn. "Sonraki Döneme Devreden ... 59.084,85"). Tarih/onay no/barkod gibi
    // değerler "1.234,56" para biçimine uymadığı için yanlış yakalanmaz.
    const labelRe = /sonraki\s+d[öo]neme\s+devreden\s+(?:katma\s+de[ğg]er\s+vergisi|kdv)/i;
    const m = labelRe.exec(compact);
    if (!m) return null;
    const after = compact.slice(m.index + m[0].length);
    const amount = this.lastTurkishMoney(after);
    if (amount != null) return amount;
    // Yedek: değer sütunu etiketlerden ÖNCE geldiyse (ters sıralama), etiketten
    // önceki son tutarı dene.
    return this.lastTurkishMoney(compact.slice(0, m.index));
  }

  /**
   * "Sonraki Döneme Devreden KDV" tutarını PDF TABLO ızgarasından okur (koordinat
   * tabanlı). Düz metinde etiket↔değer hizası bozuk geldiği için en güvenilir yol.
   * Tablo bulunamazsa null → çağıran güvenli fallback'e düşer (yanlış değer GÖSTERMEZ).
   */
  private async extractSonrakiViaTable(
    buffer: Buffer,
    dbg?: { taxpayerId: string; donem: string },
  ): Promise<number | null> {
    let parser: any;
    try {
      parser = new PDFParse({ data: buffer });
      const res: any = await parser.getTable();
      const rows: string[][] = [];
      const pushTables = (tables: any) => {
        for (const t of tables || []) {
          for (const row of t || []) {
            if (Array.isArray(row)) rows.push(row.map((c: any) => String(c ?? '').replace(/\s+/g, ' ').trim()));
          }
        }
      };
      for (const p of res?.pages || []) pushTables(p?.tables);
      pushTables(res?.mergedTables);

      let found: number | null = null;
      const hits: string[] = [];
      for (const row of rows) {
        const joined = row.join(' | ');
        const low = joined.toLocaleLowerCase('tr-TR');
        if (low.includes('devreden') || low.includes('eger vergisi') || low.includes('ğer vergisi')) {
          hits.push(joined);
        }
        if (/sonraki\s+d[öo]neme\s+devreden/i.test(joined)) {
          for (let i = row.length - 1; i >= 0; i--) {
            const amt = this.lastTurkishMoney(row[i]);
            if (amt != null) { found = amt; break; }
          }
        }
      }
      if (dbg) {
        this.logger.log(
          `[KDVDEVR-TBL] ${dbg.taxpayerId} ${dbg.donem} rows=${rows.length} found=${found} HITS: ${hits.slice(0, 14).join('  ##  ')}`,
        );
      }
      return found;
    } catch (e: any) {
      if (dbg) this.logger.warn(`[KDVDEVR-TBL] ${dbg.taxpayerId} ${dbg.donem} getTable hata: ${e?.message || e}`);
      return null;
    } finally {
      try {
        const d = parser?.destroy;
        if (typeof d === 'function') await d.call(parser).catch(() => {});
      } catch {
        /* yut */
      }
    }
  }

  /**
   * Ham PDF metni — satır sonları KORUNUR (pdfText collapse ettiği için ayrı).
   */
  private async pdfRawText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return String(result?.text || '');
    } finally {
      const destroy = (parser as any).destroy;
      if (typeof destroy === 'function') await destroy.call(parser).catch(() => {});
    }
  }

  /**
   * "Sonraki Döneme Devreden KDV"yi GİB beyanname ham metninden satır yapısıyla çıkarır.
   * pdf-parse, sonuç alanı etiketlerini değersiz bir grup + ayrı bir "sadece-tutar"
   * bloğu olarak AMA AYNI SIRADA veriyor. Hedef etiketin gruptaki sırasını bulup
   * değer bloğundan aynı sıradaki tutarı alıyoruz. (Düz metin/40-karakter güvenilmez;
   * etiket ile değer metin akışında bitişik değil.) Emin değilse null → güvenli fallback.
   */
  private extractSonrakiFromLines(rawText: string): number | null {
    const lines = String(rawText || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
    const moneyOnly = (s: string) => /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(s) || /^-?\d+,\d{2}$/.test(s);
    const hasMoney = (s: string) => /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/.test(s);
    const isValueFieldLabel = (s: string) => /(katma\s+de[ğg]er\s+vergisi|\bkdv\b)/i.test(s) && !hasMoney(s);
    const targetRe = /sonraki\s+d[öo]neme\s+devreden\s+(?:katma\s+de[ğg]er\s+vergisi|kdv)/i;

    // hedef satırı bul
    let ti = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!targetRe.test(lines[i])) continue;
      if (hasMoney(lines[i])) return this.lastTurkishMoney(lines[i]); // satır-içi değer (nadir)
      ti = i;
      break;
    }
    if (ti < 0) return null;

    // hedefin değersiz-etiket grubundaki sırası (geriye + ileriye ardışık değersiz etiketler)
    let gStart = ti;
    while (gStart - 1 >= 0 && isValueFieldLabel(lines[gStart - 1])) gStart--;
    let gEnd = ti;
    while (gEnd + 1 < lines.length && isValueFieldLabel(lines[gEnd + 1])) gEnd++;
    const targetIdx = ti - gStart;

    // gruptan sonra ilk "sadece-tutar" bloğunu bul (araya giren satır-içi etiketleri atla)
    let j = gEnd + 1;
    while (j < lines.length && !moneyOnly(lines[j]) && j - gEnd <= 8) j++;
    const vals: string[] = [];
    while (j < lines.length && moneyOnly(lines[j])) {
      vals.push(lines[j]);
      j++;
    }
    if (targetIdx >= 0 && targetIdx < vals.length) return this.lastTurkishMoney(vals[targetIdx]);
    return null;
  }

  private async pdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return String(result?.text || '').replace(/\s+/g, ' ').trim();
    } finally {
      const destroy = (parser as any).destroy;
      if (typeof destroy === 'function') await destroy.call(parser).catch(() => {});
    }
  }

  private async updateTahakkukAmountFromPdf(kayitId: string, buffer: Buffer) {
    const text = await this.pdfText(buffer);
    const tahakkukTutari = this.extractTahakkukAmount(text);
    if (tahakkukTutari == null) return;
    await (this.prisma as any).beyanKaydi.update({
      where: { id: kayitId },
      data: { tahakkukTutari },
    });
  }

  private extractTahakkukAmount(text: string): number | null {
    const compact = String(text || '').replace(/\s+/g, ' ');
    const preferredLabels = [
      /terkin\s+sonrasi\s+kalan\s+vergi\s+tutari/i,
      /tahakkuk\s+eden\s+(?:vergi\s+)?tutar/i,
      /tahakkuk\s+tutar[ıi]/i,
      /tahakkuk\s+fi[şs]i\s+tutar[ıi]/i,
      /odenecek\s+(?:vergi\s+)?tutar/i,
      /ödenecek\s+(?:vergi\s+)?tutar/i,
      /odenmesi\s+gereken\s+(?:vergi\s+)?tutar/i,
      /ödenmesi\s+gereken\s+(?:vergi\s+)?tutar/i,
      /toplam\s+tahakkuk/i,
      /toplam\s+vergi/i,
    ];
    for (const label of preferredLabels) {
      const match = compact.match(new RegExp(`${label.source}.{0,180}`, 'i'));
      const amount = match ? this.lastTurkishMoney(match[0]) : null;
      if (amount != null) return amount;
    }

    const lines = String(text || '').split(/\r?\n| {2,}/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!/tahakkuk|odenecek|ödenecek|terkin|kalan vergi|toplam/i.test(line)) continue;
      const amount = this.lastTurkishMoney(line);
      if (amount != null) return amount;
    }
    return null;
  }

  private lastTurkishMoney(text: string): number | null {
    const matches = Array.from(String(text || '').matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d{4,},\d{2}\b|\b\d{1,3},\d{2}\b/g)).map((m) => m[0]);
    for (const raw of matches.reverse()) {
      const normalized = raw.replace(/\./g, '').replace(',', '.');
      const value = Number(normalized);
      if (Number.isFinite(value)) return Math.round(value * 100) / 100;
    }
    return null;
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
      // Türkçe encoding düzelt — Hattat ZIP'i Win1254 üretiyor
      const entryName = decodeZipEntryName(entry);
      if (!/\.pdf$/i.test(entryName)) continue;
      // Normalize separator + drop empty parts
      const parts = entryName.replace(/\\/g, '/').split('/').filter(Boolean);
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

          // PDF'leri yükle — S3 hata verirse kayıt yine oluşsun (graceful fallback)
          const base = `${tenantId}/${taxpayer.id}/beyan`;
          let tahakkukKey: string | null = g.tahakkukBuffer ? `${base}/${g.tip}_${g.donem}_Tahakkuk_${randomUUID()}.pdf` : null;
          let beyannameKey: string | null = g.beyannameBuffer ? `${base}/${g.tip}_${g.donem}_Beyanname_${randomUUID()}.pdf` : null;
          if (tahakkukKey && g.tahakkukBuffer) {
            try {
              await this.storage.putBuffer(tahakkukKey, g.tahakkukBuffer, 'application/pdf', {
                mukellef: encodeURIComponent(ad), tip: g.tip, donem: g.donem, rolu: 'tahakkuk',
              });
            } catch (e: any) {
              this.logger.warn(`S3 upload başarısız (tahakkuk) — kayıt pdfUrl=null olarak eklenecek: ${e?.message}`);
              tahakkukKey = null;
            }
          }
          if (beyannameKey && g.beyannameBuffer) {
            try {
              await this.storage.putBuffer(beyannameKey, g.beyannameBuffer, 'application/pdf', {
                mukellef: encodeURIComponent(ad), tip: g.tip, donem: g.donem, rolu: 'beyanname',
              });
            } catch (e: any) {
              this.logger.warn(`S3 upload başarısız (beyanname) — kayıt beyannameUrl=null olarak eklenecek: ${e?.message}`);
              beyannameKey = null;
            }
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
