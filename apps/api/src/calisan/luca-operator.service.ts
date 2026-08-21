import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { MOREN_AI_TOOLS } from '../moren-ai/tools';
import { logAiUsage } from '../common/ai-usage-logger';
import { MAX_MODEL_CHEAP } from '../common/max-inference';
import { LucaService } from '../luca/luca.service';

/**
 * LUCA OPERATÖRÜ — Max aboneliği (ücretsiz) + ARAÇLI beyin, AKIŞLI (streaming) cevap.
 *
 * Agent SDK (CLAUDE_CODE_OAUTH_TOKEN) üzerinde çalışır → token başına fatura YOK.
 * Mevcut `ToolExecutorService` (47 aracın tek beyni) tek "portal" yönlendirici aracı
 * üzerinden Max çağrısına bağlanır — araç beyni ÇOĞALTILMAZ.
 *
 * FAZ 1 GÜVENLİK: sadece OKUMA + onaylı komut (ALLOWED_TOOLS). Luca'ya yazma YOK.
 * Dosya/bash gibi yerleşik SDK araçları canUseTool ile kapalı.
 *
 * AKIŞ: includePartialMessages ile token token metin + araç adımları emit edilir
 * (frontend canlı gösterir; bekleme hissi azalır).
 */

// ESM-only Agent SDK'yı CommonJS NestJS içine güvenli yükle (calisan.service ile aynı desen).
const _esmImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;
let _sdk: any = null;
async function loadSdk(): Promise<any> {
  if (!_sdk) _sdk = await _esmImport('@anthropic-ai/claude-agent-sdk');
  return _sdk;
}

const MODEL_CRITICAL = 'claude-opus-4-8';
const MODEL_DEFAULT = 'claude-sonnet-4-6';
const MODEL_CHEAP = MAX_MODEL_CHEAP; // claude-haiku-4-5 — kısa/basit sorular (hız)
const CRITICAL_PATTERNS: RegExp[] = [
  /beyanname|tahakkuk|muhtasar|muhsgk|geçici vergi|gecici vergi|kurumlar|kdv\s?[12]/i,
  /mizan|bilanço|bilanco|gelir tablosu|e-?defter|yevmiye|denetim/i,
  /tevkifat|mutabakat|matrah|amortisman|tarhiyat/i,
];

// SDK in-process MCP araç adı: mcp__<server>__<tool>
const PORTAL_TOOL = 'mcp__portal__portal';

// FAZ 1 — operatöre açık araçlar (OKUMA + onaylı komut). Luca'ya yazma yok.
const ALLOWED_TOOLS = new Set<string>([
  'list_taxpayers', 'get_taxpayer', 'list_taxpayers_monthly_status',
  'list_mizan_periods', 'get_mizan', 'get_gelir_tablosu', 'get_bilanco',
  'get_kdv_summary', 'list_invoices', 'get_payroll_summary', 'list_sgk_declarations',
  'list_documents', 'get_tax_calendar', 'compare_periods', 'calculate_financial_ratios',
  'search_all', 'list_beyan_kayitlari', 'get_beyan_ozet', 'get_beyanname_readiness_summary',
  'get_beyanname_config', 'get_agent_status', 'get_luca_agent_jobs', 'get_mihsap_agent_jobs',
  'get_operation_briefing', 'get_taxpayer_work_status', 'get_collection_risk_summary',
  'get_portal_capability_map', 'search_ai_memory',
  // NOT: 'create_confirmed_agent_command' KAPALI (kullanici kurali 2026-08-22) —
  // portalda is/komut olusturup kayit yazan tek yol oydu. Operator portalda
  // hicbir moduile yazmaz; Luca ekraninda calisir. 'preview_agent_command'
  // yalnizca onizleme uretir (yazmaz), acik kaliyor.
  'preview_agent_command',
]);

// Operator isi bekleme suresi. Operator tarayicisi soguk acilista (ayri Chrome
// profili + Luca girisi) 30-60 sn alabilir; sonraki komutlar saniyeler icinde doner.
const OPERATOR_JOB_TIMEOUT_MS = 90000;

interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

/** Akış olayı — frontend'e SSE ile gider. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; model: string; toolUses: Array<{ name: string; args: any }>; durationMs: number }
  | { type: 'error'; error: string };

@Injectable()
export class LucaOperatorService {
  private readonly logger = new Logger('LucaOperatorService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolExecutorService,
    private readonly luca: LucaService,
  ) {}

  /** Zaman aşımı mesajı — operatör tarayıcısı çevrimiçi mi bilgisine göre. */
  private async timeoutHint(tenantId: string, prefix: string): Promise<string> {
    const st = await this.luca
      .getOperatorDeviceStatus(tenantId)
      .catch(() => ({ online: false }) as any);
    if (st?.online) {
      return `${prefix} (zaman aşımı). Operatör tarayıcısı açık görünüyor ama iş bitmedi — Luca girişi güvenlik kodu bekliyor olabilir. Tekrar deneyeyim mi?`;
    }
    return `${prefix} (zaman aşımı). Operatör tarayıcısı çevrimiçi değil — bilgisayarında Luca Operatör ajanı çalışmıyor. Ajanı başlat, sonra tekrar dene.`;
  }

  /** LUCA OPERATÖRÜ — o an açık Luca ekranını oku (EKRAN_OKU işi + sonucu yokla). */
  private async readLucaScreen(ctx: { tenantId: string; userId?: string | null }): Promise<any> {
    let job: any;
    try {
      job = await this.luca.createScreenReadJob(ctx.tenantId, { createdBy: ctx.userId || undefined });
    } catch (e: any) {
      return { ok: false, error: 'Ekran okuma işi oluşturulamadı: ' + (e?.message || e) };
    }
    const jobId = job?.id;
    if (!jobId) return { ok: false, error: 'Ekran okuma işi oluşturulamadı.' };
    const deadline = Date.now() + OPERATOR_JOB_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await this.luca.getScreenSnapshot(jobId, ctx.tenantId).catch(() => null);
      if (r && r.status === 'done' && r.snapshot) return { ok: true, ekran: r.snapshot };
      if (r && r.status === 'failed') return { ok: false, error: r.errorMsg || 'ekran okunamadı' };
    }
    return { ok: false, error: await this.timeoutHint(ctx.tenantId, 'Ekran okunamadı') };
  }

  /** LUCA OPERATÖRÜ — Luca'da işlem yap (yaz/seç/tıkla); sonucu + işlem sonrası ekranı döndürür. */
  private async runLucaAction(
    ctx: { tenantId: string; userId?: string | null },
    payload: {
      action: string;
      etiket?: string;
      hedef?: string;
      deger?: string;
      confirmed?: boolean;
      yol?: string[] | string;
    },
  ): Promise<any> {
    let job: any;
    try {
      job = await this.luca.createActionJob(ctx.tenantId, payload, { createdBy: ctx.userId || undefined });
    } catch (e: any) {
      return { ok: false, error: 'İşlem oluşturulamadı: ' + (e?.message || e) };
    }
    const jobId = job?.id;
    if (!jobId) return { ok: false, error: 'İşlem oluşturulamadı.' };
    const deadline = Date.now() + OPERATOR_JOB_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await this.luca.getScreenSnapshot(jobId, ctx.tenantId).catch(() => null);
      if (r && r.status === 'done' && r.snapshot) return r.snapshot; // { ok, message, screen, blocked? }
      if (r && r.status === 'failed') return { ok: false, error: r.errorMsg || 'işlem başarısız' };
    }
    return { ok: false, error: await this.timeoutHint(ctx.tenantId, 'İşlem tamamlanamadı') };
  }

  // ─── OFİS KURALLARI: ekrandan/geçmişten ÇIKARILAMAYAN kararlar ───
  //
  // Geçmiş kayda bakarak öğrenmenin sınırı var: geçmiş örnek tek bir durumu
  // gösteriyorsa operatör kuralı eksik genelleyebilir. (Gerçek örnek: bir firma
  // sürekli devreden KDV'li olduğu için operatör "fark hep 190'a atılır" sandı;
  // doğrusu "ödenecek çıkarsa 360, çıkmazsa 190".) Bu yüzden kullanıcının
  // söylediği kural KALICI saklanır ve HER sohbette sistem promptuna yüklenir.

  /** Kayıtlı ofis kurallarını getir (en yeni önce). */
  private async ofisKurallari(tenantId: string): Promise<Array<{ id: string; baslik: string; kural: string }>> {
    const rows = await this.prisma.aiMemory
      .findMany({
        where: { tenantId: tenantId || 'default', scope: 'luca-kural', isActive: true },
        // Bütçe dolarsa önemsiz olan düşsün: önem, sonra tazelik.
        orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
        take: 40,
      })
      .catch(() => [] as any[]);
    return (rows as any[]).map((r) => ({ id: r.id, baslik: r.title, kural: String(r.content || '') }));
  }

  /** Kullanıcının söylediği bir kuralı kalıcı kaydet (aynı başlık varsa günceller). */
  private async kuralKaydet(
    ctx: { tenantId: string; userId?: string | null },
    baslik: string,
    kural: string,
    onem?: number,
  ): Promise<any> {
    const b = String(baslik || '').trim();
    const k = String(kural || '').trim();
    if (!b || !k) return { ok: false, error: 'baslik ve kural gerekli' };
    // Kural kalıcıdır ve her istekte prompta girer — içine gizli bilgi girmesin.
    if (/(şifre|sifre|parola|password|token|api\s*key|gizli anahtar)/i.test(`${b} ${k}`)) {
      return { ok: false, error: 'Kural içinde şifre/token gibi gizli bilgi olamaz. Kuralı bu bilgi olmadan yaz.' };
    }
    try {
      await this.prisma.aiMemory
        .updateMany({
          where: { tenantId: ctx.tenantId, scope: 'luca-kural', title: b, isActive: true },
          data: { isActive: false },
        })
        .catch(() => undefined);
      await this.prisma.aiMemory.create({
        data: {
          tenantId: ctx.tenantId,
          scope: 'luca-kural',
          source: 'luca-operator',
          title: b.slice(0, 120),
          content: k.slice(0, 4000),
          importance: Math.min(Math.max(Number(onem) || 5, 3), 5),
          tags: ['luca-kural'],
          createdBy: ctx.userId || null,
        },
      });
      return {
        ok: true,
        message: `Kural kaydedildi: "${b}" — ${k.slice(0, 200)}`,
        hatirlatma: 'Kullanıcıya kaydettiğin kuralın METNİNİ tek cümleyle geri oku ki yanlışı hemen görsün.',
      };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'kural kaydedilemedi' };
    }
  }

  /** Kuralı kaldır (başlığa göre) — kullanıcı "şu kural artık geçerli değil" derse. */
  private async kuralSil(ctx: { tenantId: string }, baslik: string): Promise<any> {
    const b = String(baslik || '').trim();
    if (!b) return { ok: false, error: 'baslik gerekli' };
    const r = await this.prisma.aiMemory
      .updateMany({
        where: { tenantId: ctx.tenantId, scope: 'luca-kural', title: b, isActive: true },
        data: { isActive: false },
      })
      .catch(() => ({ count: 0 }));
    if (!(r as any)?.count) {
      return { ok: false, error: `"${b}" başlıklı kural bulunamadı. luca_kural_listele ile tam başlığa bak.` };
    }
    return { ok: true, message: `Kural kaldırıldı: "${b}".` };
  }

  /** UI: kuralları listele. */
  async getRulesForUi(tenantId: string) {
    const k = await this.ofisKurallari(tenantId || 'default');
    return k;
  }

  /** UI: kuralı sil (pasifle). */
  async deleteRule(tenantId: string, id: string) {
    await this.prisma.aiMemory.updateMany({
      where: { id, tenantId: tenantId || 'default', scope: 'luca-kural' },
      data: { isActive: false },
    });
    return { ok: true };
  }

  // ─── LUCA'DAN TAZE VERİ: mizanı o an Luca'dan çek ───
  //
  // Portalda saklanan mizan, daha önce Luca'dan çekilmiş olabilir ama BAYAT
  // olabilir. Beyanname hazırlarken karşılaştırma yapılacaksa veri o anki
  // Luca fişlerini yansıtmalı. Bu araç mevcut Luca çekme hattını (MIZAN işi →
  // ajan → Excel → portal) tetikler ve bitmesini bekler; okumayı get_mizan yapar.

  /** Mükellefi ada göre bul (tek eşleşme şart; birden çok ise seçtir). */
  private async mukellefBul(tenantId: string, ad: string): Promise<any> {
    const q = String(ad || '').trim();
    if (!q) return { ok: false, error: 'mükellef adı gerekli' };
    const rows = await this.prisma.taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { companyName: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { taxNumber: { contains: q } },
        ],
      },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true, lucaSlug: true },
      take: 8,
    });
    if (!rows.length) return { ok: false, error: `Mükellef bulunamadı: "${q}"` };
    if (rows.length > 1) {
      return {
        ok: false,
        error: 'Birden çok mükellef eşleşti, hangisi?',
        adaylar: rows.map((r) => ({
          id: r.id,
          ad: r.companyName || [r.firstName, r.lastName].filter(Boolean).join(' '),
          vkn: r.taxNumber,
        })),
      };
    }
    return { ok: true, mukellef: rows[0] };
  }

  /**
   * KAPALI — kullanıcı kuralı (2026-08-22): operatör portalda HİÇBİR modüle
   * yazmaz. Bu yol Luca'dan çektiği mizanı portalın Mizan/MizanHesap
   * tablolarına işliyordu; Mizan modülü kullanıcının GELİR TABLOSU hazırlamak
   * için kullandığı kendi verisidir, operatörün çekimiyle karışamaz.
   * Yerine salt-okuma yolu gelecek: Excel Luca'dan indirilip yalnız işin
   * içinde çözümlenecek, portala kaydedilmeyecek.
   */
  private async mizanCek(
    _ctx: { tenantId: string; userId?: string | null },
    _args: { mukellef?: string; taxpayerId?: string; donem?: string },
  ): Promise<any> {
    return {
      ok: false,
      error:
        "Bu yol KAPALI: mizani Luca'dan cekmek portalin Mizan moduluna kayit yaziyordu; o modul kullanicinin gelir tablosu icin kullandigi kendi verisi. Mizan rakami gerekiyorsa Luca ekranindan oku ya da kullanicidan iste.",
    };
  }

  // ─── MENÜ HARİTASI: operatör Luca'yı KENDİ gezerek tanır (elle öğretme gerekmez) ───

  /**
   * Luca menüsünü baştan sona gezip haritasını çıkarır ve saklar.
   * Salt okuma: yalnız "üzerine gel" olayı gönderilir, hiçbir şeye tıklanmaz.
   * Menü, açık firmanın defter türüne göre değiştiği için harita kök başlıklara
   * göre ayrı ayrı saklanır (İşletme Defteri / Muhasebe ...).
   */
  private async cikarMenuHaritasi(
    ctx: { tenantId: string; userId?: string | null },
    opts: { derinlik?: number } = {},
  ): Promise<any> {
    let job: any;
    try {
      job = await this.luca.createKesifJob(
        ctx.tenantId,
        { mod: 'menu', derinlik: Math.min(Math.max(Number(opts.derinlik) || 4, 2), 6), bekle: 420, limit: 900 },
        { createdBy: ctx.userId || undefined },
      );
    } catch (e: any) {
      return { ok: false, error: 'Keşif işi oluşturulamadı: ' + (e?.message || e) };
    }
    const jobId = job?.id;
    if (!jobId) return { ok: false, error: 'Keşif işi oluşturulamadı.' };
    // Menü gezme uzun sürer (her başlık için üzerine gel + bekle): 5 dakikaya kadar.
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await this.luca.getScreenSnapshot(jobId, ctx.tenantId).catch(() => null);
      if (r && r.status === 'failed') return { ok: false, error: r.errorMsg || 'keşif başarısız' };
      if (r && r.status === 'done' && r.snapshot) {
        const snap: any = r.snapshot;
        const dugumler: any[] = Array.isArray(snap?.dugumler) ? snap.dugumler : [];
        if (!dugumler.length) return { ok: false, error: 'Menü okunamadı (boş sonuç).' };
        const kokler = dugumler.filter((d) => !d.ust && d.ad).map((d) => d.ad);
        const baslik = ('menu:' + kokler.slice(0, 3).join(' | ')).slice(0, 120);
        await this.prisma.aiMemory
          .updateMany({
            where: { tenantId: ctx.tenantId, scope: 'luca-map', title: baslik, isActive: true },
            data: { isActive: false },
          })
          .catch(() => undefined);
        await this.prisma.aiMemory.create({
          data: {
            tenantId: ctx.tenantId,
            scope: 'luca-map',
            source: 'luca-operator',
            title: baslik,
            content: JSON.stringify({ kokler, dugumler }).slice(0, 200000),
            importance: 5,
            tags: ['luca-map'],
          },
        });
        return {
          ok: true,
          message: `Luca menü haritası çıkarıldı: ${dugumler.length} başlık. Kök menüler: ${kokler.join(', ')}.`,
          toplam: dugumler.length,
          kokler,
        };
      }
    }
    return { ok: false, error: 'Menü keşfi zaman aşımına uğradı.' };
  }

  /** Kayıtlı menü haritalarını yükle (en yeniden eskiye). */
  private async menuHaritalari(tenantId: string): Promise<Array<{ baslik: string; dugumler: any[] }>> {
    const rows = await this.prisma.aiMemory
      .findMany({
        where: { tenantId, scope: 'luca-map', isActive: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      })
      .catch(() => [] as any[]);
    const out: Array<{ baslik: string; dugumler: any[] }> = [];
    for (const r of rows as any[]) {
      try {
        const c = JSON.parse(r.content);
        if (Array.isArray(c?.dugumler)) out.push({ baslik: r.title, dugumler: c.dugumler });
      } catch {
        /* bozuk kayıt atlanır */
      }
    }
    return out;
  }

  /** Bir düğümün kök menüye kadar olan yolunu "A > B > C" biçiminde üret. */
  private menuYolu(dugumler: any[], dugum: any): string[] {
    const byId = new Map(dugumler.map((d) => [d.id, d]));
    const yol: string[] = [];
    let cur: any = dugum;
    let guard = 0;
    while (cur && guard++ < 12) {
      if (cur.ad) yol.unshift(cur.ad);
      cur = cur.ust ? byId.get(cur.ust) : null;
    }
    return yol;
  }

  /**
   * Menü haritasında ekran arar: "muhtasar" → "İşletme Defteri > Beyannameler >
   * Muhtasar ve Prim Hizmet > Muhtasar Kartı Listesi". Harita yoksa çıkarmasını söyler.
   */
  private async araMenu(tenantId: string, sorgu: string): Promise<any> {
    const q = String(sorgu || '').trim().toLocaleLowerCase('tr-TR');
    if (!q) return { ok: false, error: 'Arama kelimesi gerekli.' };
    const haritalar = await this.menuHaritalari(tenantId);
    if (!haritalar.length) {
      return {
        ok: false,
        error: 'Kayıtlı menü haritası yok. Önce luca_menu_haritasi_cikar ile Luca menüsünü keşfet.',
      };
    }
    const sonuc: Array<{ harita: string; yol: string; seviye: number }> = [];
    for (const h of haritalar) {
      for (const d of h.dugumler) {
        const ad = String(d.ad || '').toLocaleLowerCase('tr-TR');
        if (!ad || !ad.includes(q)) continue;
        const yol = this.menuYolu(h.dugumler, d);
        sonuc.push({ harita: h.baslik, yol: yol.join(' > '), seviye: yol.length });
        if (sonuc.length >= 25) break;
      }
    }
    if (!sonuc.length) {
      return {
        ok: false,
        error: `Menüde "${sorgu}" bulunamadı. Harita eski olabilir; luca_menu_haritasi_cikar ile yenile.`,
      };
    }
    // Derin (yaprak) sonuçlar önce: kullanıcı genelde ekranı arar, başlığı değil.
    sonuc.sort((a, b) => b.seviye - a.seviye);
    return { ok: true, sonuclar: sonuc.slice(0, 12) };
  }

  // ─── FAZ 4: ÖĞRENME / BECERİ KÜTÜPHANESİ (AiMemory üzerinde; migration yok) ───

  /** Bir Luca işini "beceri" olarak kaydet (adımlar = action/etiket/hedef/deger sırası). */
  private async saveSkill(
    ctx: { tenantId: string; userId?: string | null },
    ad: string,
    adimlar: any[],
    aciklama?: string,
  ): Promise<any> {
    if (!ad || !Array.isArray(adimlar) || !adimlar.length) {
      return { ok: false, error: 'ad ve en az bir adım gerekli' };
    }
    try {
      // Aynı isimli eski beceriyi pasifle (güncelleme etkisi)
      await this.prisma.aiMemory.updateMany({
        where: { tenantId: ctx.tenantId, scope: 'luca-skill', title: ad, isActive: true },
        data: { isActive: false },
      }).catch(() => undefined);
      await this.prisma.aiMemory.create({
        data: {
          tenantId: ctx.tenantId,
          scope: 'luca-skill',
          source: 'luca-operator',
          title: ad.slice(0, 120),
          content: JSON.stringify({ aciklama: aciklama || '', adimlar }).slice(0, 12000),
          importance: 4,
          tags: ['luca-skill'],
        },
      });
      return { ok: true, message: `Beceri kaydedildi: "${ad}" (${adimlar.length} adım). Bir dahaki sefere "${ad}" deyince çalıştırabilirim.` };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'beceri kaydedilemedi' };
    }
  }

  /** Kayıtlı becerileri listele. */
  private async listSkills(ctx: { tenantId: string }): Promise<any> {
    try {
      const rows = await this.prisma.aiMemory.findMany({
        where: { tenantId: ctx.tenantId, scope: 'luca-skill', isActive: true },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      });
      const beceriler = rows.map((r) => {
        let c: any = {};
        try { c = JSON.parse(r.content); } catch {}
        return { ad: r.title, aciklama: c.aciklama || '', adimSayisi: (c.adimlar || []).length };
      });
      return { ok: true, beceriler };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }

  /** Bir becerinin adımlarını getir (beyin bunları luca_yaz/sec/tikla ile uygular). */
  private async getSkill(ctx: { tenantId: string }, ad: string): Promise<any> {
    if (!ad) return { ok: false, error: 'ad gerekli' };
    try {
      const rows = await this.prisma.aiMemory.findMany({
        where: { tenantId: ctx.tenantId, scope: 'luca-skill', isActive: true, title: ad },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      });
      if (!rows.length) return { ok: false, error: `Beceri bulunamadı: "${ad}". luca_beceri_listele ile mevcutları görebilirsin.` };
      let c: any = {};
      try { c = JSON.parse(rows[0].content); } catch {}
      return { ok: true, ad: rows[0].title, aciklama: c.aciklama || '', adimlar: c.adimlar || [] };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }

  /** UI: kayıtlı becerileri id ile listele (portal paneli için). */
  async getSkillsForUi(tenantId: string) {
    const rows = await this.prisma.aiMemory.findMany({
      where: { tenantId: tenantId || 'default', scope: 'luca-skill', isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => {
      let c: any = {};
      try { c = JSON.parse(r.content); } catch {}
      return { id: r.id, ad: r.title, aciklama: c.aciklama || '', adimSayisi: (c.adimlar || []).length, updatedAt: r.updatedAt };
    });
  }

  /**
   * UI: operatör tarayıcısı açık mı + öğrenilen menü haritaları.
   * Portal ekranı bunu gösterir; kullanıcı ajanı açmayı unutursa hemen görsün.
   */
  async getOperatorUiDurum(tenantId: string) {
    const tid = tenantId || 'default';
    const cihaz = await this.luca.getOperatorDeviceStatus(tid).catch(() => ({ online: false, deviceId: null }));
    const haritalar = await this.menuHaritalari(tid).catch(() => []);
    return {
      tarayici: {
        acik: Boolean((cihaz as any)?.online),
        cihaz: (cihaz as any)?.deviceId || null,
      },
      haritalar: haritalar.map((h) => ({
        baslik: h.baslik.replace(/^menu:/, ''),
        basliksayisi: h.dugumler.length,
      })),
      kurallar: await this.getRulesForUi(tid).catch(() => []),
    };
  }

  /** UI: beceriyi sil (pasifle). */
  async deleteSkill(tenantId: string, id: string) {
    await this.prisma.aiMemory.updateMany({
      where: { id, tenantId: tenantId || 'default', scope: 'luca-skill' },
      data: { isActive: false },
    });
    return { ok: true };
  }

  private pickModel(text: string): string {
    const t = text || '';
    if (CRITICAL_PATTERNS.some((p) => p.test(t))) return MODEL_CRITICAL;
    // Çok kısa / selamlama / sohbet → hızlı model (Haiku)
    if (t.trim().length <= 40 && !/(mizan|kdv|beyan|fatura|defter|sgk|m[uü]kellef|cari|bilan[cç]o|tahsilat|ajan)/i.test(t)) {
      return MODEL_CHEAP;
    }
    return MODEL_DEFAULT;
  }

  /** Açık araçların kısa kataloğu — sistem promptuna gömülür (MOREN_AI_TOOLS'tan üretilir). */
  private buildToolCatalog(): string {
    return MOREN_AI_TOOLS.filter((t) => ALLOWED_TOOLS.has(t.name))
      .map((t) => {
        const props = t.input_schema?.properties || {};
        const req = t.input_schema?.required || [];
        const params = Object.keys(props);
        const pstr = params.length
          ? ` [param: ${params.map((p) => (req.includes(p) ? `${p}*` : p)).join(', ')}]`
          : '';
        const desc = (t.description || '').split('.')[0].slice(0, 160);
        return `- ${t.name}: ${desc}${pstr}`;
      })
      .join('\n');
  }

  private buildSystemPrompt(
    voiceMode?: boolean,
    kurallar?: Array<{ baslik: string; kural: string }>,
  ): string {
    // Prompt bütçesi: kural sayısı arttıkça sistem promptu şişip dikkati dağıtmasın.
    // Tam metin veritabanında kalır; prompta kısaltılmış hali girer.
    const KURAL_KARAKTER = 300;
    const KURAL_TOPLAM = 12000;
    let kurallarBolumu = '';
    if (kurallar?.length) {
      const satirlar: string[] = [];
      let toplam = 0;
      let atlanan = 0;
      for (const k of kurallar) {
        const metin = k.kural.length > KURAL_KARAKTER ? `${k.kural.slice(0, KURAL_KARAKTER)}…` : k.kural;
        const satir = `- ${k.baslik}: ${metin}`;
        if (toplam + satir.length > KURAL_TOPLAM) {
          atlanan++;
          continue;
        }
        satirlar.push(satir);
        toplam += satir.length;
      }
      if (atlanan) satirlar.push(`- (+${atlanan} kural yer darlığından gösterilmedi — luca_kural_listele ile görebilirsin)`);
      kurallarBolumu = ['## OFİS KURALLARI (kullanıcının kalıcı kararları — HER İŞTE UYGULA)', ...satirlar, ''].join('\n');
    }
    const base = [
      'Sen Moren Mali Müşavirlik portalının "Luca Operatörü" adlı AI çalışanısın. Sahip: Muzaffer Ören.',
      'Kullanıcı (mali müşavir veya personel) ile Türkçe konuşur, portal verisini okur ve istenen işleri hazırlarsın.',
      'Portal verisi için "portal" aracını çağır: name=araç adı, args=parametre nesnesi. Sonucu yorumla.',
      'Luca\'da O AN AÇIK ekranı görmek için: portal({ name: "luca_ekran_oku" }) — mükellef/dönem gerekmez; kullanıcının Chrome\'undaki açık Luca ekranını okur (0-15 sn). Dönen "ekran" (frames/fields/buttons/text) verisini yorumla. Kullanıcı "ekrana bak / ne görüyorsun" derse bunu kullan.',
      'Luca\'da İŞLEM yapabilirsin: alan doldur → portal({name:"luca_yaz", args:{etiket:"<alan>", deger:"<değer>"}}); açılır liste → portal({name:"luca_sec", args:{etiket:"<alan>", deger:"<seçenek>"}}); buton/menü → portal({name:"luca_tikla", args:{hedef:"<metin>"}}). Her işlemden sonra dönen "screen" ile sonucu doğrula; gerekirse luca_ekran_oku ile bak.',
      'PORTALA YAZMA YASAĞI: Portalda HİÇBİR modüle (Mizan dahil) kayıt yazma, veri işleme, içeri aktarma YAPMA. Portal verisini yalnızca OKUYABİLİRSİN. Kullanıcının kendi kayıtları karışmamalı. Luca ekranında iş yapmak bunun dışındadır (orada da geri dönülmez adımda onay istersin).',
      "MIZAN: Mizan rakami gerekiyorsa (a) Luca ekranindan oku, (b) kullanicidan iste, (c) portalda ZATEN duran mizani get_mizan ile oku ve ne zaman cekildigini soyle. Portala YENI mizan cektirme; Mizan modulu kullanicinin gelir tablosu icin kullandigi kendi verisidir.",
      'MENÜ (Luca\'da ekran açma): Bir ekranı bulmak için ÖNCE portal({name:"luca_menu_ara", args:{sorgu:"muhtasar"}}) ile menü yolunu ara; dönen yolu portal({name:"luca_menu_git", args:{yol:"İşletme Defteri > Beyannameler > Muhtasar ve Prim Hizmet > Muhtasar Kartı Listesi"}}) ile aç. Menüde arama "kayıtlı harita yok" derse portal({name:"luca_menu_haritasi_cikar"}) ile Luca menüsünü kendin keşfet (birkaç dakika sürer, sadece okur), sonra aramayı tekrarla. Menüden ekran açmak veri değiştirmez, onay gerektirmez.',
      'Menü yolunu TAHMİN ETME. Ekranı menü haritasında bulamıyorsan kullanıcıya sor.',
      'GÜVENLİK — geri dönülmez adımlar: "Kaydet/Gönder/Onayla/İmzala/Sil/Tahakkuk/Tamamla" gibi butonlara ASLA kendiliğinden tıklama. Önce ne yapacağını ve hangi mükellef/dönem/tutar olduğunu KISACA özetle, kullanıcıdan AÇIK onay iste. Kullanıcı net onay verirse luca_tikla\'yı args.confirmed=true ile çağır. Onay olmadan confirmed=true GÖNDERME — agent zaten onaysız bu butonları bloke eder.',
      'AYRI PENCERE: Luca ekranlarinda rapor/liste sonuclari (or. Fis Listesi) AYRI BIR PENCEREDE acilir. luca_ekran_oku sonucundaki "pencereler" alanina bak — o pencerenin basligi, adresi ve metni oradadir. Bos gorunuyorsa 2-3 saniye bekleyip bir kez daha oku (pencere gec acilmis olabilir).',
      'Bir işi adım adım yap (gör → doldur/seç → kontrol et → onayla → gönder). Emin değilsen dur ve sor.',
      '\u0130Ş ÖĞRENME — KULLANICIYA "BANA GÖSTER" DEME. Bilmediğin bir iş istendiğinde şu sırayla KENDİN öğren:',
      '  1) BECERİ: luca_beceri_listele — bu iş daha önce kaydedilmiş mi?',
      '  2) EKRAN: luca_menu_ara ile ekranı bul, luca_menu_git ile aç, luca_ekran_oku ile OKU. Alan etiketleri, zorunlu alanlar, açılır liste seçenekleri ve uyarı mesajları sana ne istendiğini söyler.',
      '  3) GEÇMİŞ KAYIT (en değerli kaynak): Aynı işin ÖNCEKİ DÖNEMdeki kaydını listeden aç ve NASIL doldurulmuş oku (hangi hesap, hangi kod, hangi seçenek). Bu ofisin kendi alışkanlığıdır; yeni dönemi ona benzeterek hazırla. Kullanıcıya sormadan ÖNCE buraya bak.',
      '  4) MUHASEBE BİLGİN: mevzuat/hesap mantığını zaten biliyorsun; ekrandan ve geçmişten çıkardığınla birleştir.',
      '  5) Ancak bunların HİÇBİRİ cevaplamıyorsa kullanıcıya TEK ve NET bir soru sor ("şu alan için hangi hesabı kullanayım?"). "Bana adım adım göster" deme.',
      'KURU TEST (varsayılan çalışma biçimi): Bir işi ilk kez yaparken tüm alanları doldur/seç, sonra DUR. Geri dönülmez butona (Kaydet/Gönder/Tahakkuk/Fiş Kes/İmzala) DOKUNMA. Kullanıcıya kısa bir özet ver: hangi mükellef, hangi dönem, hangi alana ne yazdın, hangi tutar, neye dayanarak (geçen dönem/ekran/mevzuat). Kullanıcı "tamam/onaylıyorum" derse o zaman confirmed=true ile son adımı at.',
      'ONAYDAN SONRA MUTLAKA KAYDET: İş başarıyla bitince kullanıcı istemese bile luca_beceri_kaydet ile adımları kaydet (mükellef/dönem/tutar yerine "<mükellef>", "<dönem>", "<tutar>" yer tutucuları koy). Böylece aynı iş bir daha sorulmadan yapılır. Kaydettikten sonra kullanıcıya tek cümleyle bildir.',
      'MENÜ HARİTASI FİRMAYA GÖRE DEĞİŞİR: işletme defteri firmalarında kök menü "İşletme Defteri", bilanço firmalarında "Muhasebe"dir. luca_menu_ara sonuçlarında AÇIK FİRMAYA uyan haritayı seç; hangi firma açık emin değilsen luca_ekran_oku ile bak.',
      'ÖĞRENME (beceri kütüphanesi): Bir Luca işini başarıyla bitirince ve kullanıcı "bunu kaydet/öğren" derse, yaptığın adımları sırasıyla luca_beceri_kaydet({ad:"<kısa ad>", aciklama:"...", adimlar:[{action:"git|fill|select|click", etiket, hedef, deger}, ...]}) ile kaydet. Mükellefe/döneme göre değişen değerleri sabit yazma; "<mükellef>", "<dönem>" gibi yer tutucu kullan.',
      'Kullanıcı kayıtlı bir işi isterse ÖNCE luca_beceri_listele ile bak; uygun beceri varsa luca_beceri_getir({ad}) ile adımları al ve her adımı sırayla luca_yaz/luca_sec/luca_tikla ile uygula (her adımdan sonra "screen" ile doğrula; ekran sapmışsa uyum sağla; bulamadığın yerde kullanıcıya sor). Gönder/Kaydet adımına gelince DUR ve kullanıcının onayını al. Beceri yoksa işi adım adım yap ve sonunda "bunu kaydedeyim mi?" diye öner.',
      'Cevabını GEREKSİZ uzatma; net ve kısa tut. Emin değilsen veya bilgi eksikse ASLA varsayma — kullanıcıya kısa bir soru sor.',
      'Kritik mali/hukuki konularda (beyanname, KDV, mizan, tahakkuk) en yüksek doğrulukla çalış; görmediğini görmüş gibi söyleme.',
      'Mükellef PII (şifre, token, TC, IBAN) sızdırma, loglama.',
      'KURAL KAYDETME: Kullanıcı sana bir çalışma kuralı söylediğinde veya seni DÜZELTTİĞİNDE (ör. "ödenecek çıkıyorsa 360, çıkmıyorsa 190"), bunu KENDİLİĞİNDEN portal({name:"luca_kural_kaydet", args:{baslik:"<kısa başlık>", kural:"<kuralın tam metni>"}}) ile kaydet ve KAYDETTİĞİN METNİ tek cümleyle geri oku (kullanıcı yanlışı hemen görsün). Aynı şeyi bir daha sorma.',
      'YALNIZ GENELLENEBİLİR kararı kural yap. "Bu ay şunu yap", "bugünlük böyle olsun" gibi TEK SEFERLİK talimatı kural olarak KAYDETME — o iş bitince geçerliliği kalmaz.',
      'KURAL DEĞİŞİRSE: önce portal({name:"luca_kural_listele"}) ile TAM başlığı bul, AYNI başlıkla kaydet (üzerine yazılır). Kullanıcı bir kuralın kalkmasını isterse portal({name:"luca_kural_sil", args:{baslik:"<tam başlık>"}}) kullan. Çelişen iki kural aynı anda durmasın.',
      'KURALLAR GEÇMİŞ ÖRNEKTEN ÜSTÜNDÜR: Geçmiş kayıt ile aşağıdaki ofis kuralı çelişirse KURAL geçerlidir. Geçmiş kayıt tek bir durumu gösteriyor olabilir; ondan genel kural UYDURMA.',
      '',
      kurallarBolumu,
      '## Kullanabileceğin portal araçları',
      this.buildToolCatalog(),
    ].join('\n');
    if (!voiceMode) return base;
    // Sesli sohbet: kısa, doğal konuşma; ekranda okunup seslendirilecek.
    return (
      base +
      '\n\n## SESLİ MOD (karşılıklı konuşma)\n' +
      'Cevabın ÇOK KISA olsun (en fazla 1-3 cümle), doğal konuşma dilinde. ' +
      'Madde işareti, başlık, markdown ve EMOJİ KULLANMA — düz cümle yaz (sesli okunacak). ' +
      'Uzun liste/açıklama verme; gerekirse "detayını ekranda göstereyim mi?" diye kısaca sor.'
    );
  }

  /**
   * Max + araçlı AKIŞLI sohbet. Her metin parçası/araç adımı `emit` ile gönderilir.
   * Konuşma geçmişi istekte taşınır (Railway'de kalıcı oturum yok).
   */
  async chatStream(
    params: { tenantId: string; userId?: string | null; message: string; history?: ChatHistoryItem[]; voiceMode?: boolean },
    emit: (e: StreamEvent) => void,
  ): Promise<void> {
    const tenantId = params.tenantId || 'default';
    const message = (params.message || '').trim();
    const model = this.pickModel(message);
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    if (!token) {
      emit({ type: 'error', error: 'Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).' });
      return;
    }
    if (!message) {
      emit({ type: 'error', error: 'Mesaj boş olamaz.' });
      return;
    }

    const hist = (params.history || [])
      .filter((h) => h && h.content)
      .slice(-12)
      .map((h) => `${h.role === 'user' ? 'Kullanıcı' : 'Sen (operatör)'}: ${h.content}`)
      .join('\n');
    const prompt = hist
      ? `## Önceki konuşma\n${hist}\n\n## Kullanıcının yeni mesajı\n${message}`
      : message;

    // İZOLE AUTH: subprocess Max OAuth token kullansın; ANTHROPIC_* düşür.
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') childEnv[k] = v;
    }
    for (const drop of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
      delete childEnv[drop];
    }
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

    const ctx = { tenantId, userId: params.userId ?? null };
    // Ofis kuralları her sohbette taze yüklenir (kullanıcı yeni kural söylemiş olabilir).
    const kurallar = await this.ofisKurallari(tenantId).catch(() => [] as any[]);
    const started = Date.now();
    let answer = '';
    const toolUses: Array<{ name: string; args: any }> = [];
    let costUsd = 0;
    let isError = false;

    try {
      const sdk = await loadSdk();

      const portalTool = sdk.tool(
        'portal',
        'Moren portal veri/durum aracı. name=araç adı, args=parametre nesnesi. ' +
          'Yalnızca sistem mesajında listelenen araç adları geçerlidir. ' +
          'Örnek: {"name":"get_mizan","args":{"taxpayerId":"...","period":"2026-05"}}.',
        { name: z.string(), args: z.record(z.any()).optional() },
        async (a: { name: string; args?: any }) => {
          const toolName = String(a?.name || '');
          // Özel: Luca'da o an açık ekranı oku (EKRAN_OKU işi → snapshot)
          if (toolName === 'luca_ekran_oku') {
            toolUses.push({ name: toolName, args: {} });
            emit({ type: 'tool', name: toolName });
            const r = await this.readLucaScreen(ctx);
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          // Luca'da işlem: yaz / seç / tıkla (geri dönülmez tıklama agent tarafında onaysız bloke)
          if (toolName === 'luca_yaz' || toolName === 'luca_sec' || toolName === 'luca_tikla') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const action = toolName === 'luca_yaz' ? 'fill' : toolName === 'luca_sec' ? 'select' : 'click';
            const r = await this.runLucaAction(ctx, {
              action,
              yol: args.yol,
              etiket: args.etiket || args.alan || args.hint,
              hedef: args.hedef || args.metin || args.buton || args.etiket,
              deger: args.deger ?? args.value,
              confirmed: args.confirmed === true,
            });
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          // Luca'dan TAZE mizan çek
          if (toolName === 'luca_mizan_cek') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.mizanCek(ctx, args);
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          // Ofis kuralları: kaydet / listele
          if (toolName === 'luca_kural_kaydet') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.kuralKaydet(
              ctx,
              String(args.baslik || ''),
              String(args.kural || args.metin || ''),
              args.onem,
            );
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (toolName === 'luca_kural_sil') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.kuralSil(ctx, String(args.baslik || ''));
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (toolName === 'luca_kural_listele') {
            toolUses.push({ name: toolName, args: {} });
            emit({ type: 'tool', name: toolName });
            const r = await this.ofisKurallari(ctx.tenantId);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, kurallar: r }) }] };
          }
          // Menü: haritayı çıkar / ara / menüden ekran aç
          if (toolName === 'luca_menu_haritasi_cikar') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.cikarMenuHaritasi(ctx, { derinlik: args.derinlik });
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (toolName === 'luca_menu_ara') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.araMenu(ctx.tenantId, String(args.sorgu || args.q || ''));
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (toolName === 'luca_menu_git') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.runLucaAction(ctx, { action: 'menu', yol: args.yol || args.hedef });
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          // Öğrenme: beceri kaydet / listele / getir
          if (toolName === 'luca_beceri_kaydet') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.saveSkill(ctx, String(args.ad || ''), Array.isArray(args.adimlar) ? args.adimlar : [], args.aciklama);
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (toolName === 'luca_beceri_listele') {
            toolUses.push({ name: toolName, args: {} });
            emit({ type: 'tool', name: toolName });
            const r = await this.listSkills(ctx);
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (toolName === 'luca_beceri_getir') {
            const args = a?.args || {};
            toolUses.push({ name: toolName, args });
            emit({ type: 'tool', name: toolName });
            const r = await this.getSkill(ctx, String(args.ad || ''));
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (!ALLOWED_TOOLS.has(toolName)) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Bu araç operatöre kapalı (Faz 1): ${toolName}` }) }] };
          }
          toolUses.push({ name: toolName, args: a?.args || {} });
          emit({ type: 'tool', name: toolName });
          const result = await this.tools.execute(toolName, a?.args || {}, ctx);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
      );

      const server = sdk.createSdkMcpServer({ name: 'portal', version: '1.0.0', tools: [portalTool] });

      // Güvenlik: yalnızca portal aracı açık; dosya/bash vb. yerleşik araçlar kapalı.
      const canUseTool = async (toolName: string, input: any) => {
        if (toolName === PORTAL_TOOL) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: 'Bu araç operatöre kapalı.' };
      };

      const query = sdk.query;
      for await (const m of query({
        prompt,
        options: {
          model,
          systemPrompt: this.buildSystemPrompt(params.voiceMode, kurallar),
          mcpServers: { portal: server },
          allowedTools: [PORTAL_TOOL],
          canUseTool,
          // Her ekran-oku/yaz/seç/tıkla BİR tur harcıyor: menü keşfi + form doldurma
          // gibi işler 40 turu aşabiliyordu ("Reached maximum number of turns").
          // Max aboneliğiyle çalıştığı için tur başına ek maliyet yok.
          maxTurns: 80,
          includePartialMessages: true,
          env: childEnv,
        },
      })) {
        if (m?.type === 'stream_event') {
          const ev = m.event;
          if (ev?.type === 'content_block_delta' && ev?.delta?.type === 'text_delta') {
            const t = ev.delta.text || '';
            if (t) {
              answer += t;
              emit({ type: 'text', delta: t });
            }
          }
        } else if (m?.type === 'result') {
          isError = Boolean(m.is_error);
          if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
        }
      }
    } catch (e: any) {
      this.logger.error(`Luca operatör (Max) akış hatası: ${e?.message || e}`);
      emit({ type: 'error', error: e?.message || 'Agent SDK (Max) çağrısı başarısız.' });
      return;
    }

    const durationMs = Date.now() - started;
    await logAiUsage(this.prisma, {
      tenantId,
      source: 'luca-operator-max',
      model,
      fixedCostUsd: costUsd,
      karar: isError ? 'error' : 'ok',
      durationMs,
    }).catch(() => undefined);

    if (isError && !answer.trim()) {
      emit({ type: 'error', error: 'Agent SDK (Max) sonucu hata döndü.' });
      return;
    }
    // Adım sınırına takıldıysa kullanıcı ne yapacağını bilsin (yarım kalan iş sessiz kalmasın).
    if (isError && /maximum number of turns|max.*turns/i.test(answer)) {
      emit({
        type: 'text',
        delta: String.fromCharCode(10, 10) + "[Adim sinirina gelindi — is yarim kaldi. 'devam et' dersen kaldigim yerden surdururum.]",
      });
    }
    emit({ type: 'done', model, toolUses, durationMs });
  }
}
