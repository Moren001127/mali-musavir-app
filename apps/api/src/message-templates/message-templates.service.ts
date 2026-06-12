import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { claudeTextViaMax, MAX_MODEL_CHEAP } from '../common/max-inference';

export interface AiSuggestDto {
  mode?: 'generate' | 'improve';
  amac?: string;       // sıfırdan yaz: ne anlatsın
  body?: string;       // iyileştir: mevcut metin
  instruction?: string; // iyileştir: nasıl değiştirilsin
  kanal?: string;
  context?: 'sablon' | 'duyuru'; // sablon: {alan}'lı mesaj; duyuru: parantezsiz tam afiş metni
}

// AI çıktısını temizle: kod bloğu / tırnak / "Şablon:" gibi önekleri at.
function cleanAiText(s: string): string {
  let t = String(s || '').trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  t = t.replace(/^["'«»“”]+/, '').replace(/["'«»“”]+$/, '').trim();
  t = t.replace(/^(Şablon|Mesaj|Metin|İşte|Cevap)\s*[:：-]\s*/i, '').trim();
  return t;
}

export interface TemplateDto {
  ad?: string;
  kanal?: string;       // WHATSAPP | EMAIL | BOTH
  kategori?: string;    // evrak | beyanname | sgk | odeme | tebligat | ekstre | genel
  emailSubject?: string | null;
  body?: string;
  attachPdf?: boolean;
  auto?: boolean;
  autoEvent?: string | null;
  sirano?: number;
  isActive?: boolean;
}

// Önizleme için örnek veri — placeholder'lar bununla doldurulur.
const SAMPLE: Record<string, string> = {
  ad: 'SABRİ YAŞIN',
  unvan: 'YORGUN NAKLİYAT LOJİSTİK VE DEPOLAMA TİC. LTD. ŞTİ.',
  donem: 'Şubat 2026',
  'dönem': 'Şubat 2026',
  sonGun: '10 Mart 2026',
  beyannameListesi: 'KDV1 - Tahakkuk - Son Ödeme: 28.2.2026 - 791,00 TL',
  sgkListesi: 'MUHSGK - Tahakkuk - Son Ödeme: 26.2.2026 - 1.064,70 TL',
  vergiListesi: 'KDV1 - Son Ödeme: 28.2.2026 - 791,00 TL',
  sgkOdemeListesi: 'MUHSGK - Son Ödeme: 26.2.2026 - 1.064,70 TL',
  toplam: '791,00',
  tutar: '791,00',
  vade: '28.2.2026',
  bakiye: '3.500,00',
  link: 'https://www.morenmusavirlik.com/b/abc123',
  kurum: 'Gelir İdaresi Başkanlığı',
};

// Owner'ın az önce onayladığı 8 şablon — ilk açılışta hazır gelir.
const DEFAULTS: TemplateDto[] = [
  { ad: 'Evrak Talep', kanal: 'BOTH', kategori: 'evrak', emailSubject: 'Evrak Talebi - {dönem}',
    body: 'Sayın {ad},\n\n{dönem} dönemi evraklarınızı (fatura, banka ekstresi, gider belgeleri) en geç {sonGun} tarihine kadar tarafımıza iletmenizi rica ederiz.\n\nTeşekkür ederiz.' },
  { ad: 'Evrak Alındı (otomatik)', kanal: 'BOTH', kategori: 'evrak', auto: true, autoEvent: 'EVRAK_ALINDI', emailSubject: 'Evraklarınız Alınmıştır - {dönem}',
    body: 'Sayın {ad},\n\n{dönem} dönemi evraklarınız tarafımıza ulaşmıştır. İşlemlerinize başlanmıştır.\n\nBilginize.' },
  { ad: 'Beyanname Bildirimi', kanal: 'BOTH', kategori: 'beyanname', emailSubject: 'Beyanname Dökümanlarınız - {dönem}',
    body: 'Merhaba {ad},\n\nAşağıdaki beyanname dökümanları bilginize sunulmuştur:\n\n{beyannameListesi}\n\nToplam: {toplam} TL\n\n{link}' },
  { ad: 'SGK Bildirimi', kanal: 'BOTH', kategori: 'sgk', emailSubject: 'SGK Dökümanlarınız - {dönem}',
    body: 'Sayın {ad},\n\nAşağıdaki SGK dökümanları bilgilerinize sunulmuştur:\n\n{sgkListesi}\n\nToplam: {toplam} TL\n\n{link}' },
  { ad: 'Vergi Ödeme Hatırlatma', kanal: 'BOTH', kategori: 'odeme', emailSubject: 'Vergi Ödeme Hatırlatması',
    body: 'Sayın {ad},\n\nAşağıdaki vergi ödemelerinizin son günü yaklaşmaktadır:\n\n{vergiListesi}\n\nToplam: {toplam} TL\n\nBilginize.' },
  { ad: 'SGK Ödeme Hatırlatma', kanal: 'BOTH', kategori: 'odeme', emailSubject: 'SGK Ödeme Hatırlatması',
    body: 'Sayın {ad},\n\nAşağıdaki SGK ödemelerinizin son günü yaklaşmaktadır:\n\n{sgkOdemeListesi}\n\nToplam: {toplam} TL\n\nBilginize.' },
  { ad: 'E-Tebligat Bildirimi', kanal: 'BOTH', kategori: 'tebligat', attachPdf: true, emailSubject: 'E-Tebligat Bildirimi',
    body: 'Sayın {ad},\n\nFirmanıza {kurum} tarafından e-Tebligat gelmiştir. Tebligat içeriği ekte sunulmuştur.\n\nİncelemeniz için bilginize.' },
  { ad: 'Cari Hesap Ekstresi', kanal: 'BOTH', kategori: 'ekstre', attachPdf: true, emailSubject: 'Cari Hesap Ekstreniz',
    body: 'Sayın {ad},\n\nHesap dökümü ekte sunulmuş olup {bakiye} TL bakiyeniz görülmektedir. Ödeme yapmanızı rica ederiz.' },
];

const OFFICE = process.env.MOREN_OFFICE_NAME || 'MOREN MALİ MÜŞAVİRLİK';

@Injectable()
export class MessageTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private get model(): any {
    return (this.prisma as any).messageTemplate;
  }

  /** Placeholder'ları örnek veriyle doldur (önizleme). Bilinmeyen {x} olduğu gibi kalır. */
  renderPreview(body: string, kanal?: string): string {
    const filled = String(body || '').replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m);
    // WhatsApp'ta gönderen markası mesajın başına otomatik eklenir.
    if ((kanal || 'BOTH') !== 'EMAIL') {
      return `Gönderen: ${OFFICE}\n\n${filled}`;
    }
    return filled;
  }

  async list(tenantId: string) {
    await this.ensureSeeded(tenantId);
    return this.model.findMany({
      where: { tenantId },
      orderBy: [{ sirano: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(tenantId: string, dto: TemplateDto) {
    const max = await this.model.aggregate({ where: { tenantId }, _max: { sirano: true } }).catch(() => null);
    return this.model.create({
      data: {
        tenantId,
        ad: dto.ad || 'Yeni Şablon',
        kanal: dto.kanal || 'BOTH',
        kategori: dto.kategori || 'genel',
        emailSubject: dto.emailSubject ?? null,
        body: dto.body || '',
        attachPdf: dto.attachPdf ?? false,
        auto: dto.auto ?? false,
        autoEvent: dto.autoEvent ?? null,
        sirano: dto.sirano ?? ((max?._max?.sirano ?? 0) + 1),
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(tenantId: string, id: string, dto: TemplateDto) {
    const existing = await this.model.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Şablon bulunamadı.');
    const data: any = {};
    for (const k of ['ad', 'kanal', 'kategori', 'emailSubject', 'body', 'attachPdf', 'auto', 'autoEvent', 'sirano', 'isActive'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    return this.model.update({ where: { id }, data });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.model.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Şablon bulunamadı.');
    await this.model.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * AI ile şablon yaz / iyileştir. SADECE Max aboneliğinden (claudeTextViaMax) — ücretli API yok.
   * Çıktı kullanıcının düzenlediği bir ÖNERİ; otomatik gönderim yok.
   */
  async aiSuggest(tenantId: string, dto: AiSuggestDto): Promise<{ ok: boolean; body: string; error?: string }> {
    const isDuyuru = dto.context === 'duyuru';
    const system = isDuyuru
      ? [
          'Sen bir Türk Serbest Muhasebeci Mali Müşavirlik ofisinin asistanısın.',
          'Tüm mükelleflere yönelik KURUMSAL bir DUYURU/afiş metni yazarsın: profesyonel, kibar, net ve kısa.',
          'SÜSLÜ PARANTEZ {alan} KULLANMA — doğrudan tamamlanmış, herkese hitap eden bir metin yaz (genelde "Sayın müvekkilimiz," ile başlar).',
          'SADECE metni döndür: açıklama yapma, tırnak/kod bloğu/başlık ekleme. Türkçe yaz.',
        ].join(' ')
      : [
          'Sen bir Türk Serbest Muhasebeci Mali Müşavirlik ofisinin yazışma asistanısın.',
          'Mükelleflere gönderilecek PROFESYONEL, kibar, KISA ve net bir mesaj metni yazarsın.',
          'Uygun yerlerde şu değişken alanları SÜSLÜ PARANTEZ ile kullan: {ad} {unvan} {dönem} {sonGun} {tutar} {toplam} {vade} {bakiye} {link} {kurum} {beyannameListesi} {sgkListesi}.',
          'SADECE mesaj metnini döndür: açıklama yapma, tırnak/kod bloğu/başlık ekleme. Türkçe yaz.',
        ].join(' ');

    const mode = dto.mode === 'improve' ? 'improve' : 'generate';
    const prompt = mode === 'improve'
      ? (isDuyuru
          ? `Aşağıdaki duyuru metnini yeniden yaz. İstenen değişiklik: ${dto.instruction || 'daha akıcı ve profesyonel yap'}.\n\nMetin:\n${dto.body || ''}`
          : `Aşağıdaki mesaj şablonunu, içindeki {alan} değişkenlerini KORUYARAK yeniden yaz.\nİstenen değişiklik: ${dto.instruction || 'daha akıcı ve profesyonel yap'}.\n\nŞablon:\n${dto.body || ''}`)
      : (isDuyuru
          ? `Şu konuda mükelleflere kurumsal bir duyuru metni yaz: ${dto.amac || 'genel bilgilendirme'}.`
          : `Şu amaca uygun, mükellefe gönderilecek bir mesaj şablonu yaz: ${dto.amac || 'genel bilgilendirme'}.`);

    const t0 = Date.now();
    const res = await claudeTextViaMax({ prompt, system, model: MAX_MODEL_CHEAP, maxTurns: 1, timeoutMs: 30000 });

    // Maliyet görünürlüğü (Max kotasından düşer; best-effort kayıt).
    this.prisma.aiUsageLog.create({
      data: { tenantId, source: isDuyuru ? 'duyuru-ai' : 'mesaj-sablon-ai', model: res.model, costUsd: res.costUsd || 0, durationMs: Date.now() - t0, karar: res.ok ? 'ok' : 'error' },
    }).catch(() => null);

    if (!res.ok || !res.text.trim()) {
      return { ok: false, body: '', error: res.error || 'AI yanıtı alınamadı. Max bağlantısını kontrol edin.' };
    }
    return { ok: true, body: cleanAiText(res.text) };
  }

  private async ensureSeeded(tenantId: string) {
    const count = await this.model.count({ where: { tenantId } }).catch(() => 0);
    if (count > 0) return;
    await this.model.createMany({
      data: DEFAULTS.map((d, i) => ({
        tenantId,
        ad: d.ad,
        kanal: d.kanal || 'BOTH',
        kategori: d.kategori || 'genel',
        emailSubject: d.emailSubject ?? null,
        body: d.body || '',
        attachPdf: d.attachPdf ?? false,
        auto: d.auto ?? false,
        autoEvent: d.autoEvent ?? null,
        sirano: i,
        isActive: true,
      })),
    }).catch(() => null);
  }
}
