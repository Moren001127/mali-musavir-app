import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * FATURA KES — satış faturası hazırlama motoru.
 *
 * GÜVENLİK MODELİ (kullanıcı kuralı: tek mesajla resmî belge oluşmaz):
 *   TASLAK     → yalnız bizde. Hiçbir yere gönderilmez, önizleme üretilir.
 *   GIB_TASLAK → GİB e-Arşiv portalında taslak. Resmî belge DEĞİL, silinebilir.
 *   KESILDI    → kesinleştirilmiş resmî belge. AYRI komut + AYRI onay ister.
 *   IPTAL      → vazgeçildi.
 *
 * Bu serviste YALNIZ taslak hazırlama ve önizleme vardır; GİB'e gönderim
 * bilinçli olarak AYRI bir adımda (ayrı serviste) ele alınır.
 */

export type FaturaKesInput = {
  taxpayerId: string;
  aliciVkn: string;
  aliciUnvan: string;
  aliciAdres?: string | null;
  aliciVd?: string | null;
  aliciEposta?: string | null;
  faturaTarihi: string | Date;
  aciklama: string;
  matrah: number | string;
  kdvOrani?: number;
  miktar?: number | string;
  birim?: string;
  kanal?: 'GIB_EARSIV' | 'ENTEGRATOR';
  kaynak?: 'PORTAL' | 'WHATSAPP';
  komutMetni?: string | null;
  idempotencyKey?: string | null;
};

/** GİB'in kabul ettiği KDV oranları. Liste dışı oran sessizce %20'ye çevrilmez — reddedilir. */
const GECERLI_KDV = [0, 1, 10, 20];

@Injectable()
export class FaturaKesService {
  private readonly logger = new Logger(FaturaKesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** TR biçimli ya da düz sayıyı Decimal'e çevirir. "1.234,56" ve "1234.56" ikisi de doğru okunur. */
  private sayi(v: any): number {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    let s = String(v).trim().replace(/\s|₺|TL/gi, '');
    // KURAL: ondalık ayracı EN SAĞDAKİ ayraçtır (parseDecimal ile aynı mantık).
    const son = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    if (son < 0) return Number(s);
    const tam = s.slice(0, son).replace(/[.,]/g, '');
    const kesir = s.slice(son + 1).replace(/[^0-9]/g, '');
    return Number(`${tam}.${kesir}`);
  }

  private yuvarla(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Taslak oluştur. Hiçbir yere gönderilmez — yalnız hesaplanır, kaydedilir, önizlenir.
   * Doğrulama BİLEREK katıdır: eksik/şüpheli veriyle GİB'e gidilmesindense burada durulur.
   */
  /**
   * KANAL TESPİTİ — fatura hangi kapıdan kesilecek?
   *
   * Mükellef bir entegratöre bağlıysa satış faturalarını ORADAN kesiyordur. Aynı mükellef için
   * GİB portalından da fatura kesmek BELGE NUMARASINI ÇAKIŞTIRIR: iki ayrı sistem ayrı seri
   * üretir, aynı numara iki kez doğabilir. Bu yüzden entegratörlü mükellefte GİB gönderimi
   * VARSAYILAN OLARAK DURDURULUR — kullanıcı bile bile isterse açıkça geçer.
   *
   * Canlı veri (2026-08-20): 76 aktif mükellefin 76'sında GİB e-Arşiv kimliği var,
   * 11'i ayrıca entegratöre bağlı (ELOGO/PARASUT/TURMOB_EFATURA/UYUMSOFT/TURKCELL/MIKRO).
   * Entegratör adaptörleri şu an SADECE OKUMA yapıyor — oradan fatura kesme henüz yok.
   */
  async kanalTespit(
    tenantId: string,
    taxpayerId: string,
  ): Promise<{ kanal: 'GIB_EARSIV' | 'ENTEGRATOR'; saglayici: string | null; gibdenKesilebilir: boolean; uyari: string | null }> {
    // Entegratör olmayan bağlantılar (mesajlaşma/eposta/Luca) kanal sayılmaz.
    const KANAL_DISI = new Set(['EMAIL_SMTP', 'WHATSAPP_BAILEYS', 'WHATSAPP_META', 'LUCA_WORKER_ACCOUNTS']);
    const baglantilar = await (this.prisma as any).integrationConnection
      .findMany({ where: { tenantId, isActive: true }, select: { provider: true, config: true } })
      .catch(() => [] as any[]);

    for (const b of baglantilar || []) {
      const saglayici = String(b?.provider || '').toUpperCase();
      if (!saglayici || KANAL_DISI.has(saglayici)) continue;
      const mukellefler = (b?.config as any)?.taxpayers || {};
      if (mukellefler && mukellefler[taxpayerId]) {
        return {
          kanal: 'ENTEGRATOR',
          saglayici,
          gibdenKesilebilir: false,
          uyari:
            `Bu mükellef ${saglayici} entegratörüne bağlı. Faturalarını oradan kesiyorsa ` +
            `GİB portalından kesmek belge numarasını çakıştırır. Entegratörden kesme henüz yok.`,
        };
      }
    }

    const gib = await (this.prisma as any).portalCredential
      .findFirst({ where: { tenantId, taxpayerId, provider: 'GIB_IVD', isActive: true }, select: { id: true } })
      .catch(() => null);
    if (!gib) {
      return {
        kanal: 'GIB_EARSIV',
        saglayici: null,
        gibdenKesilebilir: false,
        uyari: 'Bu mükellefin GİB e-Arşiv kimliği tanımlı değil — fatura kesilemez.',
      };
    }
    return { kanal: 'GIB_EARSIV', saglayici: null, gibdenKesilebilir: true, uyari: null };
  }

  async createDraft(tenantId: string, userId: string | null, input: FaturaKesInput) {
    if (!input?.taxpayerId) throw new BadRequestException('Mükellef seçilmeli');

    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: input.taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, isActive: true },
    });
    if (!taxpayer) throw new NotFoundException('Mükellef bulunamadı');
    if (taxpayer.isActive === false) throw new BadRequestException('Pasif mükellef adına fatura kesilemez');

    const vkn = String(input.aliciVkn || '').replace(/\D/g, '');
    if (vkn.length !== 10 && vkn.length !== 11) {
      throw new BadRequestException('Alıcı VKN 10 hane, TCKN 11 hane olmalı');
    }
    const unvan = String(input.aliciUnvan || '').trim();
    if (unvan.length < 2) throw new BadRequestException('Alıcı ünvanı / adı soyadı gerekli');

    const aciklama = String(input.aciklama || '').trim();
    if (aciklama.length < 2) throw new BadRequestException('Fatura içeriği (açıklama) gerekli');

    const matrah = this.yuvarla(this.sayi(input.matrah));
    if (!Number.isFinite(matrah) || matrah <= 0) throw new BadRequestException('Tutar (KDV hariç) 0’dan büyük olmalı');

    const kdvOrani = input.kdvOrani === undefined || input.kdvOrani === null ? 20 : Number(input.kdvOrani);
    if (!GECERLI_KDV.includes(kdvOrani)) {
      throw new BadRequestException(`KDV oranı geçersiz (${kdvOrani}). Geçerli oranlar: ${GECERLI_KDV.join(', ')}`);
    }

    const miktarNum = input.miktar === undefined || input.miktar === null || input.miktar === '' ? 1 : this.sayi(input.miktar);
    if (!Number.isFinite(miktarNum) || miktarNum <= 0) throw new BadRequestException('Miktar 0’dan büyük olmalı');

    const tarih = new Date(input.faturaTarihi);
    if (isNaN(tarih.getTime())) throw new BadRequestException('Fatura tarihi geçersiz');
    // GELECEK TARİH ENGELİ: e-Arşiv'de ileri tarihli fatura düzenlenemez; sessizce göndermek
    //   yerine burada durdurulur (GİB tarafında anlaşılmaz hata dönüyor).
    const bugunSonu = new Date();
    bugunSonu.setHours(23, 59, 59, 999);
    if (tarih.getTime() > bugunSonu.getTime()) {
      throw new BadRequestException('Fatura tarihi ileri tarihli olamaz');
    }

    const kdvTutari = this.yuvarla((matrah * kdvOrani) / 100);
    const toplam = this.yuvarla(matrah + kdvTutari);

    // MÜKERRER KORUMASI: aynı komut/istek iki kez gelirse İKİNCİ TASLAK OLUŞMAZ.
    //   WhatsApp'ta mesaj tekrarı çok olası; idempotencyKey ile aynı kayıt döner.
    const key = String(input.idempotencyKey || '').trim() || null;
    if (key) {
      const mevcut = await (this.prisma as any).salesInvoiceDraft.findFirst({
        where: { tenantId, idempotencyKey: key },
      });
      if (mevcut) {
        this.logger.log(`[FATURA-KES] mukerrer istek — mevcut taslak donduruldu (${mevcut.id})`);
        return this.sonuc(mevcut, taxpayer);
      }
    }

    // Kanal ELLE DEĞİL tespitle belirlenir: entegratörlü mükellefte GİB'e gönderim engellenir.
    const kanalBilgi = await this.kanalTespit(tenantId, taxpayer.id);

    const draft = await (this.prisma as any).salesInvoiceDraft.create({
      data: {
        tenantId,
        taxpayerId: taxpayer.id,
        kanal: kanalBilgi.kanal,
        durum: 'TASLAK',
        aliciVkn: vkn,
        aliciUnvan: unvan,
        aliciAdres: input.aliciAdres?.trim() || null,
        aliciVd: input.aliciVd?.trim() || null,
        aliciEposta: input.aliciEposta?.trim() || null,
        faturaTarihi: tarih,
        aciklama,
        miktar: new Prisma.Decimal(miktarNum.toFixed(3)),
        birim: String(input.birim || 'ADET').trim().toUpperCase().slice(0, 16),
        matrah: new Prisma.Decimal(matrah.toFixed(2)),
        kdvOrani,
        kdvTutari: new Prisma.Decimal(kdvTutari.toFixed(2)),
        toplam: new Prisma.Decimal(toplam.toFixed(2)),
        kaynak: input.kaynak === 'WHATSAPP' ? 'WHATSAPP' : 'PORTAL',
        komutMetni: input.komutMetni || null,
        idempotencyKey: key,
        createdBy: userId || null,
      },
    });

    this.logger.log(
      `[FATURA-KES] taslak olusturuldu ${draft.id} · ${this.mukellefAdi(taxpayer)} → ${unvan} (${vkn}) · `
      + `${matrah.toFixed(2)} + %${kdvOrani} KDV = ${toplam.toFixed(2)} · GONDERILMEDI`,
    );
    return this.sonuc(draft, taxpayer);
  }

  async listDrafts(tenantId: string, opts: { taxpayerId?: string; durum?: string; limit?: number } = {}) {
    const where: any = { tenantId };
    if (opts.taxpayerId) where.taxpayerId = opts.taxpayerId;
    if (opts.durum) where.durum = opts.durum;
    const rows = await (this.prisma as any).salesInvoiceDraft.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(opts.limit) || 100, 1), 500),
    });
    const ids = [...new Set(rows.map((r: any) => r.taxpayerId))];
    const tps = ids.length
      ? await (this.prisma as any).taxpayer.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
        })
      : [];
    const map = new Map(tps.map((t: any) => [t.id, t]));
    return rows.map((r: any) => this.sonuc(r, map.get(r.taxpayerId)));
  }

  async getDraft(tenantId: string, id: string) {
    const draft = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: draft.taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
    });
    return { ...this.sonuc(draft, taxpayer), onizlemeHtml: this.onizleme(draft, taxpayer) };
  }

  /** Taslağı iptal et. KESILDI durumundaki resmî belge BURADAN silinemez. */
  async cancelDraft(tenantId: string, id: string) {
    const draft = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    if (draft.durum === 'KESILDI') {
      throw new BadRequestException('Bu fatura kesinleşmiş — iptali GİB/entegratör tarafında ayrı süreçtir, buradan silinemez');
    }
    await (this.prisma as any).salesInvoiceDraft.update({ where: { id }, data: { durum: 'IPTAL' } });
    return { ok: true };
  }

  private mukellefAdi(t: any): string {
    if (!t) return '';
    return t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || t.taxNumber || t.id;
  }

  private sonuc(d: any, taxpayer?: any) {
    return {
      id: d.id,
      taxpayerId: d.taxpayerId,
      mukellef: this.mukellefAdi(taxpayer),
      mukellefVkn: taxpayer?.taxNumber || null,
      kanal: d.kanal,
      durum: d.durum,
      aliciVkn: d.aliciVkn,
      aliciUnvan: d.aliciUnvan,
      aliciAdres: d.aliciAdres,
      aliciVd: d.aliciVd,
      faturaTarihi: d.faturaTarihi,
      aciklama: d.aciklama,
      miktar: Number(d.miktar),
      birim: d.birim,
      matrah: Number(d.matrah),
      kdvOrani: d.kdvOrani,
      kdvTutari: Number(d.kdvTutari),
      toplam: Number(d.toplam),
      faturaNo: d.faturaNo,
      ettn: d.ettn,
      hata: d.hata,
      kaynak: d.kaynak,
      createdAt: d.createdAt,
    };
  }

  /** Basit, yazdırılabilir önizleme. GİB'e giden belge DEĞİL — yalnız kontrol içindir. */
  private onizleme(d: any, taxpayer?: any): string {
    const tl = (n: any) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tarih = new Date(d.faturaTarihi).toLocaleDateString('tr-TR');
    const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m] as string));
    return `<!doctype html><meta charset="utf-8">
<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:720px;margin:24px auto;color:#1c1917">
  <div style="border:1px solid #e7e5e4;border-radius:12px;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
      <div>
        <div style="font-size:12px;color:#78716c;letter-spacing:.08em">SATICI</div>
        <div style="font-weight:600;font-size:15px">${esc(this.mukellefAdi(taxpayer))}</div>
        <div style="font-size:13px;color:#57534e">VKN ${esc(taxpayer?.taxNumber || '')}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;color:#78716c;letter-spacing:.08em">TASLAK — GÖNDERİLMEDİ</div>
        <div style="font-size:13px;color:#57534e">Tarih: ${esc(tarih)}</div>
      </div>
    </div>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #f5f5f4">
      <div style="font-size:12px;color:#78716c;letter-spacing:.08em">ALICI</div>
      <div style="font-weight:600">${esc(d.aliciUnvan)}</div>
      <div style="font-size:13px;color:#57534e">VKN/TCKN ${esc(d.aliciVkn)}${d.aliciVd ? ' · ' + esc(d.aliciVd) : ''}</div>
      ${d.aliciAdres ? `<div style="font-size:13px;color:#57534e">${esc(d.aliciAdres)}</div>` : ''}
    </div>
    <table style="width:100%;margin-top:18px;border-collapse:collapse;font-size:14px">
      <thead><tr style="background:#fafaf9">
        <th style="text-align:left;padding:8px 10px;font-weight:600">Açıklama</th>
        <th style="text-align:right;padding:8px 10px;font-weight:600">Miktar</th>
        <th style="text-align:right;padding:8px 10px;font-weight:600">Tutar</th>
      </tr></thead>
      <tbody><tr>
        <td style="padding:10px;border-top:1px solid #f5f5f4">${esc(d.aciklama)}</td>
        <td style="padding:10px;border-top:1px solid #f5f5f4;text-align:right">${tl(d.miktar)} ${esc(d.birim)}</td>
        <td style="padding:10px;border-top:1px solid #f5f5f4;text-align:right">${tl(d.matrah)} ₺</td>
      </tr></tbody>
    </table>
    <div style="margin-top:14px;margin-left:auto;width:260px;font-size:14px">
      <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#57534e">Matrah</span><span>${tl(d.matrah)} ₺</span></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#57534e">KDV %${d.kdvOrani}</span><span>${tl(d.kdvTutari)} ₺</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #e7e5e4;font-weight:600"><span>Toplam</span><span>${tl(d.toplam)} ₺</span></div>
    </div>
  </div>
  <div style="margin-top:10px;font-size:12px;color:#a8a29e">Bu bir ÖNİZLEMEDİR; hiçbir yere gönderilmemiştir.</div>
</div>`;
  }
}
