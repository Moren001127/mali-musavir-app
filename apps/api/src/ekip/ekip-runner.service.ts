import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { MOREN_AI_TOOLS, FATURA_MERKEZI_AJAN_ARACLARI, EKIP_IS_ZINCIRI_ARACLARI } from '../moren-ai/tools';
import { ACTION_BY_NAME } from '../automations/action-catalog';
import { ActionDispatcherService } from '../automations/action-dispatcher.service';
import { LucaOperatorService } from '../calisan/luca-operator.service';
import { EkipOnayService } from './ekip-onay.service';
import { logAiUsage } from '../common/ai-usage-logger';
import { AJAN_TANIMLARI, AjanTanimi, MODEL_KIMLIKLERI, ORTAK_KURALLAR_DOSYASI, ajanBul } from './ajan-tanimlari';
import { aracAcikMi, aracKatalogMetni, aracKademesi, ekipMihsapKomutuYasagi } from './arac-defteri';
import { DEVIR_SINIRI, konuBasligi } from './ekip-akis';

/**
 * EKİP RUNNER — bir ajanı bir görevle koşturur (PLAN/13-AJAN-KADROSU.md §5).
 *
 * Beyin: Agent SDK + Max (CLAUDE_CODE_OAUTH_TOKEN), luca-operator.service.ts ile AYNI kalıp:
 * tek in-process MCP "portal" aracı, canUseTool yalnız o araca izin verir, maxTurns 80, akışlı.
 *
 * OMURGA:
 *  - Araç çağrısında KADEME kontrolü (arac-defteri.aracAcikMi): resmi_gonderim her zaman ret;
 *    kuru testte luca_yaz/disari_gonder/portal_yaz_agir çalışmaz → {kuruTest:true, yapilacakti} döner ve iş dosyasına yazılır;
 *    disari_gonder canlıda bile doğrudan gitmez → OwnerApprovalRequest (PRV-xxxx) kaydı açılır.
 *  - İŞ DOSYASI: AgentCommand (agent="ekip:<ajanId>") pending→running→done/failed + AgentEvent (agent='ekip').
 *  - ÖĞRENME: cevaptaki "ÖĞRENDİM:" satırları AiMemory (scope='ekip', source=ajanId) olarak saklanır.
 *  - REÇETE (PLAN/17, 2026-09-13): kadro/<ajan>/receteler.md prompta "## REÇETELERİN" olarak TAM girer; beceriler.md
 *    "## BECERİLERİN (özet)" olarak en çok BECERI_TAVAN_KR karakter girer (daha önce hiç girmiyordu — kök neden #1).
 *  - ARKA PLAN (PLAN/17 Faz C): koşu SSE bağlantısına bağlı değildir; sekme kapanınca sürer, iptal yalnız iptalEt().
 */

// ESM-only Agent SDK'yı CommonJS NestJS içine güvenli yükle (luca-operator ile aynı desen).
const _esmImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;
let _sdk: any = null;
async function loadSdk(): Promise<any> {
  if (!_sdk) _sdk = await _esmImport('@anthropic-ai/claude-agent-sdk');
  return _sdk;
}

const PORTAL_TOOL = 'mcp__portal__portal';
const MAX_TUR = 80;
/** Onay kaydı geçerliliği: ajan koşusu arka planda biter, Muzaffer Bey sonra bakar → 24 saat. */
const ONAY_GECERLILIK_MS = 24 * 60 * 60 * 1000;
// fm_* (Fatura Merkezi ajan araçları) da portal çalıştırıcısından (ToolExecutorService) geçer.
// PLAN/17 §3 (2026-09-13): kdv_kontrol_* / luca_is_bekle zinciri araçları MOREN_AI_TOOLS'ta DEĞİL (otomasyon kataloğuna
// sızmasın diye ayrı liste) → burada da sayılmazsa "Çalıştırıcı bulunamadı" döner. ekip_* adları önce ekipAraciCalistir'a gider.
export const PORTAL_ARAC_ADLARI = new Set<string>(
  [...MOREN_AI_TOOLS, ...FATURA_MERKEZI_AJAN_ARACLARI, ...EKIP_IS_ZINCIRI_ARACLARI].map((t) => t.name),
);
/** Dönem panosu önbelleği: tenant başına 60 sn (SabahBandi + DonemPanosu aynı anda çekince 2×3 araç koşusu olmasın). */
const PANO_ONBELLEK_MS = 60 * 1000;
/** İş dosyası durumları (AgentCommand.status) — /ekip/isler süzgeci yalnız bunları kabul eder. */
const IS_DURUMLARI = new Set<string>(['pending', 'running', 'done', 'failed']);
const KAYNAKLAR = new Set<string>(['portal', 'ses', 'cron', 'koordinator']);
/** beceriler.md prompta bu kadar girer (uzun anlatım insan içindir; reçete tam girer) — PLAN/17 §1.3. */
const BECERI_TAVAN_KR = 6 * 1024;
/** Sistem promptu bu boyutu aşarsa warn (PLAN/17 §1.3-3: tahmini beyanname promptu ≈ 39 KB). */
const PROMPT_UYARI_KR = 50 * 1024; // 2026-09-13: hitap ("Muzaffer Bey") + rapor dili kuralları ile beyanname promptu ~46 KB
/** ekip_ajan_baslat: arka plandaki koşunun iş dosyası kimliğini (baslangic olayı) bu kadar bekler. */
const AJAN_BASLAT_ISID_BEKLEME_MS = 3000;

/** Prisma cuid: 'c' + küçük harf/rakam (kdv-control/ocr/parsers/belge-no.ts ile aynı kalıp). */
const CUID_KALIBI = /^c[a-z0-9]{20,31}$/;

export type EkipKaynak = 'portal' | 'ses' | 'cron' | 'koordinator';

/** /ekip/isler süzgeçleri (hepsi isteğe bağlı; verilmezse eski davranış). */
export interface IsSuzgeci {
  ajanId?: string | null;
  limit?: number;
  /** bugun = Istanbul günü, 7 = son 7 gün, tumu = süzme yok */
  gun?: 'bugun' | '7' | 'tumu' | null;
  /** pending | running | done | failed — virgülle birden fazla ("running,failed") */
  status?: string | null;
  /** true/false → payload.dryRun */
  dryRun?: boolean | null;
  kaynak?: EkipKaynak | null;
}

export interface EkipCalistirParametreleri {
  ajanId: string;
  gorev: string;
  tenantId: string;
  userId?: string | null;
  taxpayerId?: string | null;
  /** Varsayılan true: Luca'ya yazılmaz, dışarı mesaj gitmez; "yapılacaktı" raporu. */
  dryRun?: boolean;
  kaynak: EkipKaynak;
  /** Sesli muhatap: rapor sesli okunacak → kısa cümle, okunur rakam, en fazla 3 madde (sistem promptu eki). */
  sesModu?: boolean;
  emit?: (e: EkipAkisOlayi) => void;
  /**
   * Dış durdurma sinyali (isteğe bağlı): tetiklenince koşu Agent SDK'da durdurulur, iş dosyası failed kapanır.
   * 2026-09-13 (PLAN/17 Faz C): controller SSE kopmasında ARTIK VERMEZ — uzun reçete zincirleri sekme kapanınca
   * ölüyordu; koşu arka planda sürer, iptal yalnız POST /ekip/isler/:id/iptal (iptalEt). Alan başka çağıranlar için kaldı.
   */
  signal?: AbortSignal;
  /**
   * VAKA (iş dosyası zinciri, PLAN/18 §B): kök işin id'si. Verilmezse bu koşu KÖK olur (payload.vakaId = kendi id'si).
   * ekip_ajan_baslat çocuk açarken ve portal "Cevapla/Tekrar" (POST /ekip/koordinator/calistir body.vakaId) verir.
   */
  vakaId?: string | null;
  /** Çocuğu açan iş (kökte null). */
  ustIsId?: string | null;
  /** Vakadaki kaçıncı devir (kökte 0; Koordinatör koşuları devir sayılmaz). */
  devirSayisi?: number;
}

/** Durdurma nedeni — iş dosyasına yazılan hata metnini belirler. */
export type IptalNedeni = 'sahip' | 'baglanti';

export const IPTAL_HATA_METNI: Record<IptalNedeni, string> = {
  sahip: 'iptal edildi (Muzaffer Bey)',
  baglanti: 'iptal edildi (bağlantı koptu)',
};

/** Servis içi çalışan koşu kaydı — isId → AbortController (tenant kontrolü iptalEt'te). */
interface CalisanKosu {
  ac: AbortController;
  tenantId: string;
  ajanId: string;
  neden: IptalNedeni | null;
}

export interface YapilacakIs {
  name: string;
  args: any;
  kademe: string | null;
}

export interface OnayBekleyen {
  previewId: string;
  name: string;
  args: any;
  expiresAt: Date;
  confirmationText: string;
}

/** SSE akış olayları — luca-operator/chat ile uyumlu + ekip ekleri. */
export type EkipAkisOlayi =
  | { type: 'baslangic'; isId: string; ajanId: string; model: string; dryRun: boolean }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; args?: any }
  | { type: 'kuruTest'; name: string; args: any; kademe: string | null }
  | { type: 'onay'; name: string; previewId: string; confirmationText: string }
  | { type: 'red'; name: string; neden: string; mesaj: string }
  | {
      type: 'done';
      isId: string;
      model: string;
      toolUses: Array<{ name: string; args: any }>;
      durationMs: number;
      kuruTestYapilacaktilar: YapilacakIs[];
      onayBekleyen: OnayBekleyen[];
      ogrenilen: string[];
      /** İşin bağlandığı mükellef (görevle verilen ya da ilk taxpayerId'li araç çağrısından). */
      taxpayerId?: string | null;
    }
  | { type: 'error'; error: string; isId?: string };

/** calistir() içindeki tek portal aracının koşu bağlamı — portalAracIsleyici bunun üzerinden çalışır (spec'te sahte kurulur). */
interface KosuBaglami {
  p: EkipCalistirParametreleri;
  ajan: AjanTanimi;
  isId: string;
  dryRun: boolean;
  ctx: { tenantId: string; userId: string | null; taxpayerId: string | null; signal?: AbortSignal };
  emit: (e: EkipAkisOlayi) => void;
  toolUses: Array<{ name: string; args: any }>;
  kuruTestYapilacaktilar: YapilacakIs[];
  onayBekleyen: OnayBekleyen[];
}

export interface EkipKosuSonucu {
  isId: string;
  ajanId: string;
  taxpayerId?: string | null;
  rapor: string;
  toolUses: Array<{ name: string; args: any }>;
  kuruTestYapilacaktilar: YapilacakIs[];
  onayBekleyen: OnayBekleyen[];
  ogrenilen: string[];
  model: string;
  durationMs: number;
  costUsd: number;
  hata?: string;
}

@Injectable()
export class EkipRunnerService {
  private readonly logger = new Logger('EkipRunnerService');

  /**
   * ÇALIŞAN KOŞULAR — isId → AbortController (servis içi, süreç belleği).
   * calistir() iş dosyasını açınca kaydeder, bitince siler. POST /ekip/isler/:id/iptal buradan durdurur
   * (SSE kopması ARTIK durdurmaz — 2026-09-13, PLAN/17 Faz C).
   * Not: tek API süreci varsayımı; başka süreçte koşan iş burada görünmez → {ok:false}.
   */
  private readonly calisanKosular = new Map<string, CalisanKosu>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolExecutorService,
    private readonly dispatcher: ActionDispatcherService,
    private readonly operator: LucaOperatorService,
    private readonly onay: EkipOnayService,
  ) {}

  // ─── KİMLİK DOSYALARI (apps/api/kadro/…) — yoksa boş geçer, hata vermez ───

  /** Kadro kökü adayları: derlenmiş (dist/ekip) ve kaynak (src/ekip) için ../../kadro; ek olarak cwd tabanlı. */
  private kadroKokAdaylari(): string[] {
    return [
      path.resolve(__dirname, '..', '..', 'kadro'),
      path.resolve(process.cwd(), 'apps', 'api', 'kadro'),
      path.resolve(process.cwd(), 'kadro'),
    ];
  }

  /** `apps/api/kadro/...` biçimindeki repo-göreli yolu okur; dosya yoksa ''. */
  private async kadroDosyasiOku(repoYolu: string): Promise<string> {
    const goreli = repoYolu.replace(/^apps\/api\/kadro\/?/, '');
    for (const kok of this.kadroKokAdaylari()) {
      try {
        const icerik = await fs.readFile(path.join(kok, goreli), 'utf8');
        if (icerik && icerik.trim()) return icerik.trim();
      } catch {
        /* aday yok — sıradakine bak */
      }
    }
    return '';
  }

  private async kimlikDosyalari(
    ajan: AjanTanimi,
  ): Promise<{ ortak: string; kimlik: string; kurallar: string; beceriler: string; receteler: string }> {
    // 5. dosya receteler.md (PLAN/17 §1.3): yoksa boş — runner hata vermez.
    const [ortak, kimlik, kurallar, beceriler, receteler] = await Promise.all([
      this.kadroDosyasiOku(ORTAK_KURALLAR_DOSYASI),
      this.kadroDosyasiOku(`${ajan.kimlikKlasoru}/kimlik.md`),
      this.kadroDosyasiOku(`${ajan.kimlikKlasoru}/kurallar.md`),
      this.kadroDosyasiOku(`${ajan.kimlikKlasoru}/beceriler.md`),
      this.kadroDosyasiOku(`${ajan.kimlikKlasoru}/receteler.md`),
    ]);
    return { ortak, kimlik, kurallar, beceriler, receteler };
  }

  /** beceriler.md özeti: tavanı aşarsa ilk BECERI_TAVAN_KR karakter + "…" (reçete tam girer, beceri yalnız özet). */
  private beceriOzeti(beceriler: string): string {
    const t = String(beceriler || '').trim();
    if (!t) return '';
    return t.length <= BECERI_TAVAN_KR ? t : `${t.slice(0, BECERI_TAVAN_KR).trimEnd()}\n…(beceriler.md kırpıldı; tam metin dosyada)`;
  }

  // ─── SİSTEM PROMPTU ───

  /** Sesli muhatap eki — cevap OpenAI Realtime tarafından sesli okunur. */
  private sesModuEki(): string {
    return [
      '## SES MODU (cevabın sesli okunacak)',
      '- Kısa cümleler kur; her cümle tek nefeste okunsun. Tablo, markdown, yıldız, başlık, emoji kullanma.',
      '- Rakamları okunur yaz: "12 bin 500 lira", "yüzde 20", "3 mükellef" — "12.500,00 ₺" gibi yazma.',
      '- Liste gerekiyorsa en fazla 3 madde; her madde tek cümle.',
      '- RAPOR bölümü 2-4 kısa cümle olsun; araç adı ve iç adım söyleme.',
      '- Kuru testte yapılmayan adım varsa TEK cümleyle söyle; onay bekleyen mesaj varsa TEK cümleyle söyle.',
      '',
    ].join('\n');
  }

  private async sistemPromptu(ajan: AjanTanimi, dryRun: boolean, tenantId: string, sesModu = false): Promise<string> {
    const d = await this.kimlikDosyalari(ajan);
    const lucaKullanir = ajan.araclar.some((a) => a.startsWith('luca_'));
    let ofisKurallari = '';
    if (lucaKullanir) {
      const k = await this.operator.getRulesForUi(tenantId).catch(() => [] as any[]);
      if (k?.length) {
        ofisKurallari = [
          '## OFİS KURALLARI (Muzaffer Bey’in kalıcı kararları — geçmiş örnekten ÜSTÜNDÜR)',
          ...k.slice(0, 40).map((x: any) => `- ${x.baslik}: ${String(x.kural || '').slice(0, 300)}`),
          '',
        ].join('\n');
      }
    }
    const varsayilanOrtak = [
      '- Muzaffer Bey: Muzaffer Ören (Moren Mali Müşavirlik). Türkçe konuş, kısa ve net yaz, jargon kullanma.',
      '- Görmediğini görmüş gibi söyleme; veri yoksa "veri yok" de. Sayı uydurma.',
      '- Mükellef PII (şifre, token, TC, IBAN) sızdırma, loglama.',
      '- Emin değilsen varsayma; TEK ve NET bir soru sor.',
    ].join('\n');

    // İŞ ÖĞRENME SIRASI (Luca ekran sırası) yalnız luca-operator'a; diğer 12 ajana "önce portal araçların" satırı (PLAN/17 §1.3-4).
    const lucaOperatoruMu = ajan.id === 'luca-operator';
    const ogrenmeSirasi = lucaOperatoruMu
      ? [
          '## İŞ ÖĞRENME SIRASI (bilmediğin işte "bana göster" DEME, kendin öğren)',
          '1) KAYITLI BECERİ: luca_beceri_listele / search_ai_memory — bu iş daha önce kaydedilmiş mi?',
          '2) EKRANI AÇ-OKU: luca_menu_ara → luca_menu_git → luca_ekran_oku; alan etiketleri ve uyarılar ne istendiğini söyler.',
          '3) ÖNCEKİ DÖNEM KAYDI: aynı işin geçmiş dönemdeki kaydını aç, NASIL doldurulmuş oku; yeni dönemi ona benzet.',
          '4) MUHASEBE BİLGİN: mevzuat/hesap mantığını ekrandan ve geçmişten çıkardığınla birleştir.',
          '5) Bunların hiçbiri cevaplamıyorsa Muzaffer Bey’e TEK ve NET bir soru sor.',
        ]
      : [
          '## İŞ SIRASI',
          "ÖNCE PORTAL ARAÇLARIN (reçeten); Luca yalnız DEVİR ile: reçetesi olan iş portal araçlarıyla, reçetedeki sırayla yapılır; Luca'ya yalnız reçete adımı Luca dediğinde ya da DEVİR ile gidilir. \"Luca Operatörü oturum açsın\" diye portal işini devretme.",
          'Bilmediğin işte "bana göster" DEME: search_ai_memory → araç sonucu → önceki dönem kaydı → muhasebe bilgin; yine olmuyorsa Muzaffer Bey’e TEK ve NET bir soru sor.',
        ];

    const prompt = [
      `Sen Moren Mali Müşavirlik ofisinin yapay çalışan EKİBİNDE "${ajan.ad}" (${ajan.unvan}) adlı ajansın. Ajan kimliğin: ${ajan.id}.`,
      ajan.aciklama,
      '',
      '## ORTAK KURALLAR',
      d.ortak || varsayilanOrtak,
      '',
      '## KİMLİĞİN',
      d.kimlik || `${ajan.ad} — ${ajan.unvan}. ${ajan.aciklama}`,
      '',
      d.kurallar ? `## KURALLARIN\n${d.kurallar}\n` : '',
      // Reçeteler TAM girer; kuru testte kesilen adımdan sonrası ÇAĞRILMAZ (zincir kesme, PLAN/17 §1.4).
      d.receteler
        ? `## REÇETELERİN (bu sırayı izle; adım atlama; kuru testte kesilen adımdan sonrasını ÇAĞIRMA, "yapılacaktı" yaz)\n${d.receteler}\n`
        : '',
      d.beceriler ? `## BECERİLERİN (özet)\n${this.beceriOzeti(d.beceriler)}\n` : '',
      ofisKurallari,
      '## ONAY NOKTALARIN (Muzaffer Bey’in onayı olmadan geçilmez)',
      ...ajan.onayNoktalari.map((o) => `- ${o}`),
      '- RESMİ GÖNDERİM (GİB beyanname, SGK bildirge, e-defter berat) hiçbir koşulda senin işin değil; "gönderdim" DEME.',
      '',
      '## ARAÇ KULLANIMI',
      'Tek aracın "portal": portal({ name: "<araç adı>", args: { ... } }). Yalnız aşağıdaki katalogdaki adlar geçerli.',
      "Parantez içindeki kademe: oku=serbest · portal_yaz=serbest (kayıt altında) · portal_yaz_agir=portala yazar ve yan etkisi var (oturum açar/OCR/eşleştirme; kuru testte çalışmaz) · luca_yaz=Luca'da yazar ya da Luca işi açar (kuru testte çalışmaz) · disari_gonder=mükellefe mesaj (doğrudan gitmez, Muzaffer Bey onay kaydı açılır).",
      'Araç sonucu {kuruTest:true} dönerse o adım YAPILMADI, yalnız kaydedildi; raporunda "yapılacaktı" diye belirt ve o adımın çıktısına bağlı sonraki adımları ÇAĞIRMA. {onayBekliyor:true} dönerse mesaj Muzaffer Bey’in onayına düştü; "gönderildi" DEME.',
      '',
      '## KULLANABİLECEĞİN ARAÇLAR',
      aracKatalogMetni(ajan.araclar),
      '',
      ...ogrenmeSirasi,
      'Öğrendiğin genellenebilir bir kural/alışkanlık varsa cevabının sonunda her biri ayrı satırda "Öğrendiklerim: <kısa cümle>" yaz (tek seferlik talimatı yazma).',
      '',
      `## ÇALIŞMA BİÇİMİ: ${dryRun ? 'KURU TEST' : 'CANLI'}`,
      dryRun
        ? 'KURU TEST: Luca\'ya yazılmaz, mükellefe/dışarıya mesaj gitmez, portalda ağır iş (oturum açma, OCR, eşleştirme) yapılmaz. Bu araçları yine de çağır — sistem çalıştırmaz, "yapılacaktı" olarak kaydeder; kesilen adımın sonrasını çağırma. Raporuna "Kuru testte gerçek yapılan işler: <liste | yok>" satırı yaz. Sonunda ne yapacağını (mükellef, dönem, alan, tutar, dayanak) kısa özetle.'
        : 'CANLI: Luca\'da yazabilirsin; Kaydet/Gönder/Tahakkuk gibi geri dönülmez düğmeler yine onay ister (confirmed=true yalnız Muzaffer Bey açıkça onayladıysa). Dışarı mesajlar Muzaffer Bey’in onayına düşer, doğrudan gitmez. Kilitleme/kilit açma, resolve, fm_onayla, GİB gönderimi, Mihsap çekimi her zaman Muzaffer Bey’de.',
      '',
      '## RAPOR BİÇİMİ (cevabının sonu)',
      sesModu
        ? 'RAPOR: 2-4 kısa cümle — ne yaptın, ne buldun, ne bekliyor (kuru test/onay).'
        : 'RAPOR: 3-8 satır — ne yaptın, ne buldun, ne bekliyor (kuru test/onay), risk varsa yaz.',
      'SORU: (yalnız gerekiyorsa) tek soru.',
      'Öğrendiklerim: (varsa) her satır ayrı.',
      sesModu ? `\n${this.sesModuEki()}` : null,
    ]
      .filter((s) => s !== null && s !== undefined)
      .join('\n');

    // Prompt boyutu (PLAN/17 §1.3-3): debug her koşuda; 45 KB üstü warn (80 tur × prompt = kota).
    const uzunluk = prompt.length;
    const boyutMesaji = `${ajan.id} prompt ${uzunluk} kr (ortak ${d.ortak.length}, kimlik ${d.kimlik.length}, kurallar ${d.kurallar.length}, receteler ${d.receteler.length}, beceriler ${Math.min(d.beceriler.length, BECERI_TAVAN_KR)}/${d.beceriler.length})`;
    if (uzunluk > PROMPT_UYARI_KR) this.logger.warn(`${boyutMesaji} — ${PROMPT_UYARI_KR} kr tavanını aşıyor; reçete/kimlik kırp`);
    else this.logger.debug(boyutMesaji);
    return prompt;
  }

  // ─── İŞ DOSYASI (AgentCommand) + OLAY (AgentEvent) ───

  private async isDosyasiAc(p: EkipCalistirParametreleri, ajan: AjanTanimi, model: string): Promise<string> {
    const payload = {
      gorev: p.gorev,
      dryRun: p.dryRun !== false,
      taxpayerId: p.taxpayerId || null,
      kaynak: p.kaynak,
      sesModu: p.sesModu === true,
      model,
      // VAKA alanları (PLAN/18 §B): kökte vakaId = kendi id'si (create sonrası status→running update'iyle aynı çağrıda yazılır)
      vakaId: p.vakaId || null,
      ustIsId: p.ustIsId || null,
      devirSayisi: Number.isFinite(Number(p.devirSayisi)) ? Number(p.devirSayisi) : 0,
    };
    const row = await (this.prisma as any).agentCommand.create({
      data: {
        tenantId: p.tenantId,
        agent: `ekip:${ajan.id}`,
        action: String(p.gorev || '').slice(0, 80),
        payload,
        status: 'pending',
        createdBy: p.userId || null,
      },
    });
    await (this.prisma as any).agentCommand
      .update({
        where: { id: row.id },
        data: {
          status: 'running',
          startedAt: new Date(),
          ...(p.vakaId ? {} : { payload: { ...payload, vakaId: row.id } }),
        },
      })
      .catch(() => undefined);
    return row.id;
  }

  private async isDosyasiKapat(isId: string, durum: 'done' | 'failed', sonuc: any): Promise<void> {
    await (this.prisma as any).agentCommand
      .update({ where: { id: isId }, data: { status: durum, finishedAt: new Date(), result: sonuc } })
      .catch((e: any) => this.logger.warn(`iş dosyası kapatılamadı ${isId}: ${e?.message || e}`));
  }

  /**
   * İŞ ↔ MÜKELLEF BAĞI: iş dosyası mükellefsiz açıldıysa (payload.taxpayerId boş) ilk geçerli
   * taxpayerId'li araç çağrısı bağı kurar — iş özeti/konsol "hangi mükellef" gösterebilsin.
   * Payload JSON bütünüyle yazıldığından önce okunur; dolu ise DOKUNULMAZ. Hata yutulur.
   */
  private async isDosyasiMukellefBagla(isId: string, taxpayerId: string): Promise<boolean> {
    try {
      const row = await (this.prisma as any).agentCommand.findUnique({ where: { id: isId }, select: { payload: true } });
      const payload = row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {};
      if (payload.taxpayerId) return false;
      await (this.prisma as any).agentCommand.update({ where: { id: isId }, data: { payload: { ...payload, taxpayerId } } });
      return true;
    } catch (e: any) {
      this.logger.warn(`iş dosyası mükellef bağı kurulamadı ${isId}: ${e?.message || e}`);
      return false;
    }
  }

  private async olayYaz(p: EkipCalistirParametreleri, ajanId: string, isId: string, durum: 'basarili' | 'hata', mesaj: string, meta: any): Promise<void> {
    await (this.prisma as any).agentEvent
      .create({
        data: {
          tenantId: p.tenantId,
          agent: 'ekip',
          action: ajanId,
          status: durum,
          message: String(mesaj || '').slice(0, 500),
          meta: { isId, kaynak: p.kaynak, dryRun: p.dryRun !== false, taxpayerId: p.taxpayerId || null, ...meta },
        },
      })
      .catch((e: any) => this.logger.warn(`ekip olayı yazılamadı: ${e?.message || e}`));
  }

  // ─── DIŞARI GÖNDERİM → SAHİP ONAY KAYDI (preview_agent_command kalıbı) ───

  private async yeniPreviewId(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const previewId = `PRV-${randomBytes(2).toString('hex').toUpperCase()}`;
      const exists = await (this.prisma as any).ownerApprovalRequest
        .findUnique({ where: { previewId }, select: { id: true } })
        .catch(() => null);
      if (!exists) return previewId;
    }
    return `PRV-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  private async onayKaydiAc(
    p: EkipCalistirParametreleri,
    ajan: AjanTanimi,
    isId: string,
    name: string,
    args: any,
  ): Promise<OnayBekleyen> {
    const previewId = await this.yeniPreviewId();
    const expiresAt = new Date(Date.now() + ONAY_GECERLILIK_MS);
    const hedef = args?.to || args?.phone || args?.email || args?.taxpayerId || '';
    const impact = `${ajan.ad} (${ajan.id}) "${name}" ile dışarı mesaj göndermek istiyor${hedef ? ` → ${hedef}` : ''}. İş dosyası: ${isId}. Muzaffer Bey’in onayı olmadan gitmez.`;
    await (this.prisma as any).ownerApprovalRequest.create({
      data: {
        tenantId: p.tenantId,
        userId: p.userId || null,
        previewId,
        agent: `ekip:${ajan.id}`,
        action: name,
        payload: { ...(args || {}), isId, taxpayerId: p.taxpayerId || null },
        impact,
        expiresAt,
      },
    });
    await (this.prisma as any).auditLog
      .create({
        data: {
          tenantId: p.tenantId,
          userId: p.userId || null,
          action: 'CREATE',
          resource: 'owner_approval_request',
          resourceId: previewId,
          newData: { previewId, agent: `ekip:${ajan.id}`, action: name, isId, expiresAt },
        },
      })
      .catch(() => null);
    return { previewId, name, args, expiresAt, confirmationText: `ONAYLIYORUM #${previewId}` };
  }

  // ─── EKİBİN İÇ ARAÇLARI ───

  /** Istanbul gününün başlangıcı (UTC Date) — bugün süzgeçleri için tek yer. */
  private gunBasiIstanbul(): Date {
    const istanbulTarih = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return new Date(`${istanbulTarih}T00:00:00+03:00`);
  }

  /** /ekip/isler where koşulu — süzgeçler isteğe bağlı; hiçbiri yoksa eski koşul (tenant + ekip:*). */
  private isWhere(tenantId: string, opts: IsSuzgeci): any {
    const where: any = {
      tenantId,
      agent: opts.ajanId ? `ekip:${opts.ajanId}` : { startsWith: 'ekip:' },
    };
    if (opts.gun === 'bugun') where.createdAt = { gte: this.gunBasiIstanbul() };
    else if (opts.gun === '7') where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
    const durumlar = String(opts.status || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => IS_DURUMLARI.has(s));
    if (durumlar.length === 1) where.status = durumlar[0];
    else if (durumlar.length > 1) where.status = { in: durumlar };
    const and: any[] = [];
    if (opts.dryRun === true || opts.dryRun === false) {
      // payload.dryRun eski kayıtlarda eksik olabilir; eksik = kuru (isOzeti ile aynı kural: dryRun !== false)
      and.push(
        opts.dryRun
          ? { NOT: [{ payload: { path: ['dryRun'], equals: false } }] }
          : { payload: { path: ['dryRun'], equals: false } },
      );
    }
    if (opts.kaynak && KAYNAKLAR.has(opts.kaynak)) and.push({ payload: { path: ['kaynak'], equals: opts.kaynak } });
    if (and.length) where.AND = and;
    return where;
  }

  /** Son iş dosyaları (koordinatör ve pano için). Süzgeçler (gun/status/dryRun/kaynak) isteğe bağlı. */
  async isleriListele(tenantId: string, opts: IsSuzgeci = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 200);
    const rows = await (this.prisma as any).agentCommand.findMany({
      where: this.isWhere(tenantId, opts),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return (rows as any[]).map((r) => this.isOzeti(r));
  }

  /** Süzgeçli liste + süzgece uyan TOPLAM kayıt sayısı (limit'ten bağımsız) — /ekip/isler?gun=&status=&dryRun=&kaynak=. */
  async isleriSuz(tenantId: string, opts: IsSuzgeci = {}) {
    const [isler, toplam] = await Promise.all([
      this.isleriListele(tenantId, opts),
      (this.prisma as any).agentCommand.count({ where: this.isWhere(tenantId, opts) }).catch(() => 0),
    ]);
    return {
      isler,
      toplam,
      suzgec: {
        ajanId: opts.ajanId || null,
        gun: opts.gun || 'tumu',
        status: opts.status || null,
        dryRun: opts.dryRun === true || opts.dryRun === false ? opts.dryRun : null,
        kaynak: opts.kaynak || null,
        limit: Math.min(Math.max(Number(opts.limit) || 30, 1), 200),
      },
    };
  }

  async isGetir(tenantId: string, id: string) {
    const r = await (this.prisma as any).agentCommand.findFirst({ where: { id, tenantId, agent: { startsWith: 'ekip:' } } });
    return r ? { ...this.isOzeti(r), result: r.result || null } : null;
  }

  private isOzeti(r: any) {
    const res = r.result || {};
    return {
      id: r.id,
      ajanId: String(r.agent || '').replace(/^ekip:/, ''),
      gorev: r.payload?.gorev || r.action,
      dryRun: r.payload?.dryRun !== false,
      kaynak: r.payload?.kaynak || null,
      taxpayerId: r.payload?.taxpayerId || null,
      // VAKA alanları (PLAN/18): eski kayıtta vakaId yok → kendisi
      vakaId: r.payload?.vakaId || r.id,
      ustIsId: r.payload?.ustIsId || null,
      devirSayisi: typeof r.payload?.devirSayisi === 'number' ? r.payload.devirSayisi : 0,
      status: r.status,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      model: res.model || r.payload?.model || null,
      durationMs: res.durationMs ?? null,
      toolSayisi: Array.isArray(res.toolUses) ? res.toolUses.length : 0,
      kuruTestSayisi: Array.isArray(res.kuruTestYapilacaktilar) ? res.kuruTestYapilacaktilar.length : 0,
      onayBekleyenSayisi: Array.isArray(res.onayBekleyen) ? res.onayBekleyen.length : 0,
      ogrenilenSayisi: Array.isArray(res.ogrenilen) ? res.ogrenilen.length : 0,
      raporOzet: typeof res.rapor === 'string' ? res.rapor.slice(0, 300) : null,
      hata: res.hata || null,
    };
  }

  /**
   * Pano önbelleği: anahtar tenant+dönem sayısı; değer {t, veri}. `veri` bir Promise'tir — aynı anda gelen
   * iki istek (SabahBandi + DonemPanosu) tek üretimi paylaşır, ikinci istek 3 araç koşusu daha başlatmaz.
   */
  private readonly panoOnbellek = new Map<string, { t: number; veri: Promise<any> }>();

  /** Mükellef × dönem × aşama panosu — 60 sn tenant önbelleği; `yenile=true` önbelleği atlar. */
  async pano(tenantId: string, donemSayisi = 3, yenile = false) {
    const n = Math.min(Math.max(Number(donemSayisi) || 3, 1), 6);
    const anahtar = `${tenantId}:${n}`;
    const simdiMs = Date.now();
    const eldeki = this.panoOnbellek.get(anahtar);
    if (!yenile && eldeki && simdiMs - eldeki.t < PANO_ONBELLEK_MS) {
      const veri = await eldeki.veri;
      return { ...veri, onbellek: { vurdu: true, yasSn: Math.round((Date.now() - eldeki.t) / 1000) } };
    }
    const uretim = this.panoUret(tenantId, n).catch((e) => {
      this.panoOnbellek.delete(anahtar); // hata önbelleğe girmesin
      throw e;
    });
    this.panoOnbellek.set(anahtar, { t: simdiMs, veri: uretim });
    const veri = await uretim;
    return { ...veri, onbellek: { vurdu: false, yasSn: 0 } };
  }

  /** Panoyu gerçekten üretir (önbelleksiz). */
  private async panoUret(tenantId: string, n: number) {
    const simdi = new Date();
    const donemler: string[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(simdi.getFullYear(), simdi.getMonth() - i, 1);
      donemler.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    // Satır biçimi: moren-ai/monthly-status.shared.ts MonthlyStatusRow (portal Aylık Takip ile aynı kaynak).
    const asamalar = (r: any) => ({
      evrak: r.evraklarGeldi === true,
      isleme: r.evraklarIslendi === true,
      kontrol: r.kontrolBitti === true || r.kontrolEdildi === true,
      beyannameHazir: r.beyannameHazir === true,
      beyanname: r.beyannameVerildi === true,
    });
    const sonuc: any[] = [];
    for (const period of donemler) {
      const veri: any = await this.tools
        .execute('list_taxpayers_monthly_status', { period, evrakDurumu: 'tumu', beyannameDurumu: 'tumu' }, { tenantId })
        .catch((e: any) => ({ error: e?.message || String(e) }));
      const rows: any[] = Array.isArray(veri?.mukellefler) ? veri.mukellefler : Array.isArray(veri?.rows) ? veri.rows : [];
      const say = (f: (r: any) => boolean) => rows.filter(f).length;
      sonuc.push({
        istenenDonem: period,
        beyannameDonem: veri?.beyannameDonem || veri?.donem || null,
        islemAyi: veri?.islemAyi || null,
        bosDonemFallback: veri?.bosDonemFallback || false,
        hata: veri?.error || null,
        toplam: rows.length,
        ozet: {
          kayitVar: say((r) => r.kayitVar === true),
          evrak: say((r) => r.evraklarGeldi === true),
          isleme: say((r) => r.evraklarIslendi === true),
          kontrol: say((r) => r.kontrolBitti === true || r.kontrolEdildi === true),
          beyannameHazir: say((r) => r.beyannameHazir === true),
          beyanname: say((r) => r.beyannameVerildi === true),
        },
        mukellefler: rows.map((r) => ({
          taxpayerId: r.id || r.taxpayerId || null,
          ad: r.isim || r.ad || r.companyName || null,
          tip: r.tip || null,
          kayitVar: r.kayitVar === true,
          asamalar: asamalar(r),
        })),
      });
    }
    return { donemler: sonuc, uretildi: new Date() };
  }

  private async ekipAraciCalistir(name: string, args: any, p: EkipCalistirParametreleri, isId?: string | null): Promise<any> {
    const tenantId = p.tenantId;
    if (name === 'ekip_isler') return { ok: true, isler: await this.isleriListele(tenantId, { ajanId: args?.ajanId, limit: args?.limit || 20 }) };
    if (name === 'ekip_pano') return { ok: true, ...(await this.pano(tenantId, args?.donemSayisi)) };
    if (name === 'ekip_onaylar') return { ok: true, ...(await this.onay.listele(tenantId, { durum: args?.durum || 'PENDING', limit: args?.limit || 20 })) };
    if (name === 'ekip_is_durum') return this.isDurumu(tenantId, args);
    if (name === 'ekip_ajan_baslat') return this.ajanBaslat(p, args, isId || null);
    if (name === 'ekip_onayla' || name === 'ekip_reddet') {
      // Onay yürütme yalnız Muzaffer Bey’in/personelin KENDİ oturumundan (portal/ses); cron/koordinatör zinciri kendi kendine onaylayamaz.
      if (!(p.kaynak === 'ses' || p.kaynak === 'portal') || !p.userId) {
        return { ok: false, error: 'Onay yalnız Muzaffer Bey’in kendi komutuyla (portal/ses) yürütülür; bu koşuda kapalı.' };
      }
      const previewId = String(args?.previewId || '').trim();
      if (!previewId) return { ok: false, error: 'previewId zorunlu (PRV-XXXX).' };
      if (name === 'ekip_reddet') return this.onay.reddet({ tenantId, userId: p.userId, previewId, not: args?.not });
      return this.onay.onayla({ tenantId, userId: p.userId, previewId, onayMetni: args?.onayMetni, kaynak: p.kaynak });
    }
    return { ok: false, error: `Bilinmeyen ekip aracı: ${name}` };
  }

  /** ekip_is_durum {isId}: iş dosyasının kısa durumu; bitmişse rapor (en çok 3000 kr). */
  private async isDurumu(tenantId: string, args: any): Promise<any> {
    const isId = String(args?.isId || '').trim();
    if (!isId) return { ok: false, error: 'isId zorunlu.' };
    const r = await this.isGetir(tenantId, isId);
    if (!r) return { ok: false, error: `İş dosyası bulunamadı: ${isId}` };
    const res: any = r.result || {};
    const bitti = r.status === 'done' || r.status === 'failed';
    return {
      ok: true,
      is: {
        id: r.id,
        ajanId: r.ajanId,
        status: r.status,
        bitti,
        gorev: r.gorev,
        dryRun: r.dryRun,
        kaynak: r.kaynak,
        taxpayerId: r.taxpayerId,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
        durationMs: r.durationMs,
        kuruTestSayisi: r.kuruTestSayisi,
        onayBekleyenSayisi: r.onayBekleyenSayisi,
        hata: r.hata,
        rapor: bitti && typeof res.rapor === 'string' ? res.rapor.slice(0, 3000) : null,
        mesaj: bitti ? undefined : 'İş henüz sürüyor; sonra tekrar sor (bekleme aracı yok).',
      },
    };
  }

  /**
   * ekip_ajan_baslat (PLAN/17 §3, Koordinatör): başka ajanı ARKA PLANDA başlatır; beklemez, isId döner.
   *  - Aynı ajan (+ aynı mükellef) için pending/running iş varsa {ok:false, mevcutIsId} (tekrar kilidi).
   *  - Canlı yalnız Muzaffer Bey bu koşuyu canlı açtıysa VE args.canli=true; yoksa kuru test.
   *  - kaynak='koordinator' → çocuk koşuda ekip_onayla kapalı; iç içe bekleme yok (sesli yol 25 sn tavanı).
   */
  private async ajanBaslat(p: EkipCalistirParametreleri, args: any, isId: string | null = null): Promise<any> {
    const hedef = ajanBul(String(args?.ajanId || ''));
    if (!hedef) return { ok: false, error: `Bilinmeyen ajan: ${args?.ajanId || '-'}. Geçerli: ${AJAN_TANIMLARI.map((a) => a.id).join(', ')}` };
    if (hedef.id === 'koordinator') return { ok: false, error: 'Koordinatör kendine iş atamaz.' };
    const gorev = String(args?.gorev || '').trim();
    if (!gorev) return { ok: false, error: 'gorev zorunlu (görev metni şablonu: iş başlığı, mükellef, dönem, istenen, kuru/canlı).' };
    const taxpayerId = CUID_KALIBI.test(String(args?.taxpayerId || '').trim()) ? String(args.taxpayerId).trim() : p.taxpayerId || null;

    const where: any = { tenantId: p.tenantId, agent: `ekip:${hedef.id}`, status: { in: ['pending', 'running'] } };
    if (taxpayerId) where.payload = { path: ['taxpayerId'], equals: taxpayerId };
    const mevcut = await (this.prisma as any).agentCommand
      .findFirst({ where, orderBy: { createdAt: 'desc' }, select: { id: true, status: true } })
      .catch(() => null);
    if (mevcut) {
      return {
        ok: false,
        mevcutIsId: mevcut.id,
        error: `${hedef.ad} için ${taxpayerId ? 'bu mükellefte ' : ''}çalışan/bekleyen iş var (${mevcut.id}, ${mevcut.status}); yenisi açılmadı. ekip_is_durum ile izle.`,
      };
    }

    // VAKA (PLAN/18 §B): çocuk, bu koşunun vakasına bağlanır; devir sayısı = vakadaki Koordinatör-dışı çocuk sayısı + 1.
    // Kural KODDA: DEVIR_SINIRI (2) aşılırsa çocuk AÇILMAZ; Muzaffer Bey’e "Karar sizde" bildirimi (tur:'bilgi') düşer.
    const vakaId = p.vakaId || isId || null;
    const devirSayisi = (vakaId ? await this.vakaDevirSayisi(p.tenantId, vakaId) : 0) + 1;
    if (devirSayisi > DEVIR_SINIRI) {
      const son = vakaId ? await this.vakaSonCocuk(p.tenantId, vakaId) : null;
      const sonAjanId = son ? String(son.agent || '').replace(/^ekip:/, '') : null;
      const sonAjan = sonAjanId ? ajanBul(sonAjanId)?.ad || sonAjanId : '-';
      const sonRapor = String(son?.result?.rapor || son?.result?.hata || '').replace(/\s+/g, ' ').trim().slice(0, 200) || '-';
      const konu = konuBasligi(gorev);
      await this.devirSiniriBildirimi(p, isId, vakaId, taxpayerId, { konu, sonAjan, sonRapor, devirSayisi });
      return {
        ok: false,
        neden: 'devir_siniri',
        vakaId,
        devirSayisi,
        error: `Bu vakada ${devirSayisi}. devire gelindi (sınır ${DEVIR_SINIRI}); yeni ajan açılmadı. Karar Muzaffer Bey’e düşürüldü — raporunda "Karar sizde: ${konu}" yaz, tekrar deneme.`,
      };
    }

    // canli:true ya da dryRun:false (tools.ts şeması) — ikisi de kabul; yine de Muzaffer Bey bu koşuyu canlı açmış olmalı.
    const canli = (args?.canli === true || args?.dryRun === false) && p.dryRun === false;
    const baslangic = await new Promise<{ isId?: string; hata?: string }>((resolve) => {
      let cozuldu = false;
      const bitir = (v: { isId?: string; hata?: string }) => {
        if (cozuldu) return;
        cozuldu = true;
        resolve(v);
      };
      const zamanlayici = setTimeout(() => bitir({}), AJAN_BASLAT_ISID_BEKLEME_MS);
      (zamanlayici as any).unref?.();
      this.calistir({
        ajanId: hedef.id,
        gorev,
        tenantId: p.tenantId,
        userId: p.userId ?? null,
        taxpayerId,
        dryRun: !canli,
        kaynak: 'koordinator',
        vakaId,
        ustIsId: isId,
        devirSayisi,
        emit: (e) => {
          if (e.type === 'baslangic') bitir({ isId: e.isId });
          else if (e.type === 'error' && !cozuldu) bitir({ hata: e.error });
        },
      }).catch((e: any) => {
        this.logger.warn(`ekip_ajan_baslat ${hedef.id} arka plan koşusu hata: ${e?.message || e}`);
        bitir({ hata: e?.message || String(e) });
      });
    });
    if (baslangic.hata) return { ok: false, error: `${hedef.ad} başlatılamadı: ${baslangic.hata}` };
    return {
      ok: true,
      isId: baslangic.isId || null,
      ajanId: hedef.id,
      dryRun: !canli,
      vakaId: vakaId || baslangic.isId || null,
      devirSayisi,
      mesaj: `${hedef.ad} arka planda ${canli ? 'CANLI' : 'kuru testte'} başladı${baslangic.isId ? ` (iş ${baslangic.isId})` : ''}; bu koşuda bekleme, sonucu ekip_is_durum ile izle ya da iş dosyasından oku.`,
    };
  }

  /** Vakadaki Koordinatör-dışı çocuk sayısı (payload.vakaId = vakaId AND agent != ekip:koordinator). Sorgu düşerse 0. */
  private async vakaDevirSayisi(tenantId: string, vakaId: string): Promise<number> {
    try {
      const n = await (this.prisma as any).agentCommand.count({
        where: { tenantId, agent: { startsWith: 'ekip:', not: 'ekip:koordinator' }, payload: { path: ['vakaId'], equals: vakaId } },
      });
      return Number(n) || 0;
    } catch (e: any) {
      this.logger.warn(`vaka devir sayısı okunamadı ${vakaId}: ${e?.message || e}`);
      return 0;
    }
  }

  /** Vakadaki en son Koordinatör-dışı çocuk (kimde kaldı / son rapor için). Yoksa null. */
  private async vakaSonCocuk(tenantId: string, vakaId: string): Promise<any | null> {
    try {
      return (
        (await (this.prisma as any).agentCommand.findFirst({
          where: { tenantId, agent: { startsWith: 'ekip:', not: 'ekip:koordinator' }, payload: { path: ['vakaId'], equals: vakaId } },
          orderBy: { createdAt: 'desc' },
        })) || null
      );
    } catch {
      return null;
    }
  }

  /**
   * Devir sınırı bildirimi — create_pending_action eşdeğeri: "Karar sizde: <konu>", tur:'bilgi', dedupe `ekip:devir:<vakaId>` (60 dk).
   * dispatcher yoksa / düşerse yalnız log (çocuk zaten açılmadı; kural yine geçerli).
   */
  private async devirSiniriBildirimi(
    p: EkipCalistirParametreleri,
    isId: string | null,
    vakaId: string | null,
    taxpayerId: string | null,
    bilgi: { konu: string; sonAjan: string; sonRapor: string; devirSayisi: number },
  ): Promise<void> {
    try {
      await this.dispatcher.dispatch(
        'create_pending_action',
        {
          title: `Karar sizde: ${bilgi.konu}`.slice(0, 200),
          body: `${bilgi.konu} ${bilgi.devirSayisi}. devire geldi; kimde kaldı: ${bilgi.sonAjan}; son rapor: ${bilgi.sonRapor}`,
          taxpayerId: taxpayerId || undefined,
          tur: 'bilgi',
          priority: 'high',
          dedupeKey: vakaId ? `ekip:devir:${vakaId}` : undefined,
          gecikme: 'devir',
        },
        { tenantId: p.tenantId, userId: p.userId ?? null, automationId: `ekip:koordinator:${isId || 'vaka'}`, isId, vakaId, ajanId: 'koordinator' },
      );
    } catch (e: any) {
      this.logger.warn(`devir sınırı bildirimi açılamadı ${vakaId || '-'}: ${e?.message || e}`);
    }
  }

  // ─── ÖĞRENME: "ÖĞRENDİM:" satırları → AiMemory ───

  private ogrenilenleriAyikla(metin: string): string[] {
    const out: string[] = [];
    const BASLIK = /^(?:(?:Ö|O)(?:Ğ|G)REND(?:İ|I)M|(?:Ö|O)(?:ğ|g)rendiklerim)\s*[*_`]*\s*:?\s*[*_`]*\s*(.*)$/i; // 2026-09-13: "Öğrendiklerim:" (insan dili) da tanınır
    const temizle = (s: string) => s.trim().replace(/[*_`]+$/, '').trim().slice(0, 1000);
    // "ÖĞRENDİM:" başlığının altına madde madde yazılan dersler (pilot 3'te 2 ders kaybolmuştu).
    let baslikAltinda = false;
    for (const ham of String(metin || '').split(/\r?\n/)) {
      // Model çoğu zaman "**ÖĞRENDİM:**", "- ÖĞRENDİM:", "### ÖĞRENDİM" gibi biçimliyor; işaretleri soy.
      // Yalnız satır BAŞINDAKİ işaretler soyulur; içerikteki alt çizgi (get_tax_calendar) korunur.
      const maddeMi = /^\s*(?:[-*•]|\d+[.)])\s+/.test(ham);
      const satir = ham.replace(/^[\s*_`#>\-•]+/, '').replace(/^\d+[.)]\s+/, '').trim();
      const m = satir.match(BASLIK);
      if (m) {
        const govde = temizle(m[1] || '');
        if (govde.length >= 8) out.push(govde);
        // Aynı satırda ders yoksa (ya da varsa da) sonraki maddeler bu başlığa ait sayılır.
        baslikAltinda = true;
        continue;
      }
      if (!baslikAltinda) continue;
      if (!satir) {
        // Boş satır başlığı kapatmaz; ancak yeni bir başlık (##, **X:**) ya da madde olmayan düz metin kapatır.
        continue;
      }
      const yeniBaslik = /^(#{1,6}\s|\*\*[^*]{2,40}\*\*\s*:?\s*$|[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ /]{3,40}:)/.test(ham.trim()) || /^(NE YAPTIM|NEYE BAKTIM|NE BULDUM|ONAY BEKLEYEN|RAPOR|SORU|Yaptığım iş|Baktığım kaynaklar|Bulgular|Onayınızı bekleyen)/i.test(satir);
      if (yeniBaslik) {
        baslikAltinda = false;
        continue;
      }
      if (maddeMi && satir.length >= 8 && !/^(yok|—|-)\.?$/i.test(satir)) out.push(temizle(satir));
      else if (!maddeMi) baslikAltinda = false;
    }
    return Array.from(new Set(out)).slice(0, 10);
  }

  private async ogrenilenleriKaydet(p: EkipCalistirParametreleri, ajanId: string, isId: string, satirlar: string[]): Promise<void> {
    for (const s of satirlar) {
      if (/(şifre|sifre|parola|password|token|api\s*key)/i.test(s)) continue; // gizli bilgi hafızaya girmesin
      await (this.prisma as any).aiMemory
        .create({
          data: {
            tenantId: p.tenantId,
            taxpayerId: p.taxpayerId || null,
            scope: 'ekip',
            source: ajanId,
            title: s.slice(0, 120),
            content: `${s}\n\n(iş dosyası: ${isId}, kaynak: ${p.kaynak}${p.dryRun !== false ? ', kuru test' : ''})`,
            importance: 3,
            tags: ['ekip', ajanId],
            createdBy: p.userId || null,
          },
        })
        .catch((e: any) => this.logger.warn(`öğrenilen kaydedilemedi: ${e?.message || e}`));
    }
  }

  // ─── KOŞU ───

  /** Agent SDK yükleyici — spec sahte SDK vermek için üzerine yazar (jest ESM import'u yakalayamaz). */
  protected sdkYukle(): Promise<any> {
    return loadSdk();
  }

  /**
   * Tek portal aracının işleyicisi (calistir içinden sdk.tool'a verilir; spec doğrudan çağırabilir).
   * Sıra: mükellef bağı → kademe kontrolü → dışarı gönderim onayı → çalıştır.
   */
  private portalAracIsleyici(k: KosuBaglami) {
    const { p, ajan, isId, dryRun, ctx, emit, toolUses, kuruTestYapilacaktilar, onayBekleyen } = k;
    // Mükellef bağı bir kez kurulur: görevle geldiyse zaten var; yoksa ilk geçerli cuid'li araç çağrısından.
    let mukellefBagiDenendi = Boolean(ctx.taxpayerId);
    const mukellefBagiKur = async (args: any) => {
      if (mukellefBagiDenendi) return;
      const id = String(args?.taxpayerId || '').trim();
      if (!CUID_KALIBI.test(id)) return;
      mukellefBagiDenendi = true;
      ctx.taxpayerId = id;
      p.taxpayerId = id; // olay kaydı / onay kaydı / AI kullanım günlüğü aynı mükellefi görsün
      await this.isDosyasiMukellefBagla(isId, id);
    };

    return async (a: { name: string; args?: any }) => {
      const name = String(a?.name || '');
      const args = a?.args && typeof a.args === 'object' ? a.args : {};
      const cevap = (r: any) => ({ content: [{ type: 'text', text: JSON.stringify(r) }] });

      // 0) İŞ ↔ MÜKELLEF BAĞI (kademe fark etmez; kuru testte engellenen çağrı da mükellefi söyler)
      await mukellefBagiKur(args);

      // 1) KADEME KONTROLÜ
      const erisim = aracAcikMi(ajan, name, dryRun);
      if (!erisim.acik) {
        if (erisim.neden === 'kuru_test') {
          const kayit: YapilacakIs = { name, args, kademe: erisim.kademe };
          kuruTestYapilacaktilar.push(kayit);
          toolUses.push({ name, args: { ...args, __kuruTest: true } });
          emit({ type: 'kuruTest', name, args, kademe: erisim.kademe });
          return cevap({ kuruTest: true, yapilacakti: { name, args }, mesaj: erisim.mesaj });
        }
        emit({ type: 'red', name, neden: erisim.neden || 'kapali', mesaj: erisim.mesaj || 'kapalı' });
        return cevap({ ok: false, error: erisim.mesaj, neden: erisim.neden });
      }

      // 1b) MİHSAP AJAN KOMUTU ekibe kapalı (PLAN/15 Faz 5) — genel bot etkilenmez, kontrol yalnız burada.
      const mihsapRet = ekipMihsapKomutuYasagi(name, args);
      if (mihsapRet) {
        emit({ type: 'red', name, neden: 'mihsap_kapali', mesaj: mihsapRet });
        return cevap({ ok: false, error: mihsapRet, neden: 'mihsap_kapali' });
      }

      // 2) DIŞARI GÖNDERİM canlıda bile doğrudan gitmez → Muzaffer Bey onay kaydı
      if (erisim.kademe === 'disari_gonder') {
        try {
          const onay = await this.onayKaydiAc(p, ajan, isId, name, args);
          onayBekleyen.push(onay);
          toolUses.push({ name, args: { ...args, __onayBekliyor: onay.previewId } });
          emit({ type: 'onay', name, previewId: onay.previewId, confirmationText: onay.confirmationText });
          return cevap({
            onayBekliyor: true,
            previewId: onay.previewId,
            confirmationText: onay.confirmationText,
            expiresAt: onay.expiresAt,
            mesaj: 'Mesaj gönderilmedi; Muzaffer Bey’in onayına düştü. Raporunda "onay bekliyor" yaz.',
          });
        } catch (e: any) {
          return cevap({ ok: false, error: 'Onay kaydı açılamadı: ' + (e?.message || e) });
        }
      }

      // 3) ÇALIŞTIR
      toolUses.push({ name, args });
      emit({ type: 'tool', name, args });
      try {
        let r: any;
        if (name.startsWith('ekip_')) r = await this.ekipAraciCalistir(name, args, p, isId);
        else if (LucaOperatorService.lucaAraciMi(name)) r = await this.operator.executeOperatorTool(name, args, ctx);
        else if (PORTAL_ARAC_ADLARI.has(name)) r = await this.tools.execute(name, args, ctx);
        else if (ACTION_BY_NAME[name]) {
          // VAKA bağlamı (PLAN/18): create_pending_action metadata'sına tur/vakaId/isId/ajanId/taxpayerId düşer.
          r = await this.dispatcher.dispatch(name, args, {
            tenantId: p.tenantId,
            userId: p.userId ?? null,
            automationId: `ekip:${ajan.id}:${isId}`,
            isId,
            vakaId: p.vakaId || isId,
            ajanId: ajan.id,
            taxpayerId: ctx.taxpayerId,
          });
        } else r = { ok: false, error: `Çalıştırıcı bulunamadı: ${name}` };
        return cevap(r);
      } catch (e: any) {
        return cevap({ ok: false, error: e?.message || String(e) });
      }
    };
  }

  async calistir(p: EkipCalistirParametreleri): Promise<EkipKosuSonucu> {
    const emit = p.emit || (() => undefined);
    const ajan = ajanBul(p.ajanId);
    const dryRun = p.dryRun !== false;
    const gorev = String(p.gorev || '').trim();
    const model = ajan ? MODEL_KIMLIKLERI[ajan.model] : MODEL_KIMLIKLERI.sonnet;
    const bos: EkipKosuSonucu = {
      isId: '',
      ajanId: p.ajanId,
      rapor: '',
      toolUses: [],
      kuruTestYapilacaktilar: [],
      onayBekleyen: [],
      ogrenilen: [],
      model,
      durationMs: 0,
      costUsd: 0,
    };

    if (!ajan) {
      const hata = `Bilinmeyen ajan: ${p.ajanId}. Geçerli: ${AJAN_TANIMLARI.map((a) => a.id).join(', ')}`;
      emit({ type: 'error', error: hata });
      return { ...bos, hata };
    }
    if (!gorev) {
      emit({ type: 'error', error: 'Görev boş olamaz.' });
      return { ...bos, hata: 'Görev boş olamaz.' };
    }
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!token) {
      const hata = 'Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).';
      emit({ type: 'error', error: hata });
      return { ...bos, hata };
    }

    const isId = await this.isDosyasiAc(p, ajan, model);
    emit({ type: 'baslangic', isId, ajanId: ajan.id, model, dryRun });

    // DURDURMA: iş başına AbortController; Muzaffer Bey’in düğmesi (iptalEt) ve bağlantı kopması (p.signal) buna bağlanır.
    const ac = new AbortController();
    const kosuKaydi: CalisanKosu = { ac, tenantId: p.tenantId, ajanId: ajan.id, neden: null };
    this.calisanKosular.set(isId, kosuKaydi);
    const disSinyalIptali = () => this.iptalEt(p.tenantId, isId, 'baglanti');
    if (p.signal) {
      if (p.signal.aborted) disSinyalIptali();
      else p.signal.addEventListener('abort', disSinyalIptali, { once: true });
    }

    // İZOLE AUTH: alt süreç Max OAuth token kullansın; ANTHROPIC_* düşür (luca-operator ile aynı).
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') childEnv[k] = v;
    for (const drop of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
      delete childEnv[drop];
    }
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

    // signal: sunucu tarafı bekleyen araçlar (luca_is_bekle, kdv_kontrol_ocr_bekle) Muzaffer Bey "Durdur" deyince döngüyü keser — 2026-09-13.
    const ctx: KosuBaglami['ctx'] = { tenantId: p.tenantId, userId: p.userId ?? null, taxpayerId: p.taxpayerId ?? null, signal: ac.signal };
    const started = Date.now();
    let answer = '';
    const toolUses: Array<{ name: string; args: any }> = [];
    const kuruTestYapilacaktilar: YapilacakIs[] = [];
    const onayBekleyen: OnayBekleyen[] = [];
    let costUsd = 0;
    let isError = false;
    let hata: string | undefined;

    // VAKA satırı (PLAN/18 §B): ajan create_pending_action çağrısında vakaId olarak bunu verir; iş dosyası zinciri bozulmaz.
    const vakaId = p.vakaId || isId;
    const promptBaslik = [
      `## GÖREV (kaynak: ${p.kaynak}${p.taxpayerId ? `, mükellef id: ${p.taxpayerId}` : ''}, mod: ${dryRun ? 'KURU TEST' : 'CANLI'})`,
      `VAKA: ${vakaId} (create_pending_action çağrılarında vakaId olarak bunu ver; devir ${p.devirSayisi || 0}/${DEVIR_SINIRI})`,
      gorev,
    ].join('\n');

    try {
      const sdk = await this.sdkYukle();
      const sistem = await this.sistemPromptu(ajan, dryRun, p.tenantId, p.sesModu === true);

      const portalTool = sdk.tool(
        'portal',
        'Moren portal / Luca / ekip aracı. name=araç adı, args=parametre nesnesi. Yalnızca sistem mesajında listelenen adlar geçerlidir.',
        { name: z.string(), args: z.record(z.any()).optional() },
        this.portalAracIsleyici({ p, ajan, isId, dryRun, ctx, emit, toolUses, kuruTestYapilacaktilar, onayBekleyen }),
      );

      const server = sdk.createSdkMcpServer({ name: 'portal', version: '1.0.0', tools: [portalTool] });
      const canUseTool = async (toolName: string, input: any) => {
        if (toolName === PORTAL_TOOL) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: 'Bu araç ekibe kapalı.' };
      };

      for await (const m of sdk.query({
        prompt: promptBaslik,
        options: {
          model,
          systemPrompt: sistem,
          mcpServers: { portal: server },
          allowedTools: [PORTAL_TOOL],
          canUseTool,
          maxTurns: MAX_TUR,
          includePartialMessages: true,
          env: childEnv,
          abortController: ac,
        },
      })) {
        if (ac.signal.aborted) break; // durduruldu — SDK kuyruğunda kalan olayları işleme
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
      isError = true;
      hata = e?.message || 'Agent SDK (Max) çağrısı başarısız.';
      if (!ac.signal.aborted) this.logger.error(`ekip ${ajan.id} koşu hatası: ${hata}`);
    } finally {
      if (p.signal) p.signal.removeEventListener('abort', disSinyalIptali);
      this.calisanKosular.delete(isId);
    }

    // DURDURULDU: SDK AbortError ya da döngüden çıkış — hangi yoldan gelirse gelsin tek metin, iş failed.
    const iptalEdildi = ac.signal.aborted;
    if (iptalEdildi) {
      isError = true;
      hata = IPTAL_HATA_METNI[kosuKaydi.neden || 'sahip'];
      this.logger.warn(`ekip ${ajan.id} koşusu durduruldu (${kosuKaydi.neden || 'sahip'}) iş=${isId}`);
    }

    const durationMs = Date.now() - started;
    await logAiUsage(this.prisma, {
      tenantId: p.tenantId,
      source: 'ekip-max',
      model,
      taxpayerId: p.taxpayerId || null,
      fixedCostUsd: costUsd,
      karar: isError ? 'error' : 'ok',
      sebep: ajan.id,
      durationMs,
    }).catch(() => undefined);

    if (isError && !hata) hata = answer.trim() ? undefined : 'Agent SDK (Max) sonucu hata döndü.';
    if (isError && !iptalEdildi && /maximum number of turns|max.*turns/i.test(answer)) {
      answer += '\n\n[Adım sınırına gelindi — iş yarım kaldı.]';
    }

    // Yarım kalan koşudan "öğrenilen" çıkarılmaz (rapor tamamlanmadı).
    const ogrenilen = iptalEdildi ? [] : this.ogrenilenleriAyikla(answer);
    if (ogrenilen.length) await this.ogrenilenleriKaydet(p, ajan.id, isId, ogrenilen);

    const sonuc: EkipKosuSonucu = {
      isId,
      ajanId: ajan.id,
      taxpayerId: ctx.taxpayerId,
      rapor: raporTemizle(answer),
      toolUses,
      kuruTestYapilacaktilar,
      onayBekleyen,
      ogrenilen,
      model,
      durationMs,
      costUsd,
      hata,
    };
    // İptalde yarım cevap olsa da iş FAILED (kadro/durum "çalışıyor" sayaçları ve bugunHata bunu görür).
    const basarisiz = iptalEdildi || (Boolean(hata) && !answer.trim());
    await this.isDosyasiKapat(isId, basarisiz ? 'failed' : 'done', {
      rapor: sonuc.rapor,
      taxpayerId: ctx.taxpayerId,
      toolUses,
      kuruTestYapilacaktilar,
      onayBekleyen,
      ogrenilen,
      model,
      durationMs,
      costUsd,
      hata: hata || null,
    });
    await this.olayYaz(p, ajan.id, isId, basarisiz ? 'hata' : 'basarili', basarisiz ? hata! : gorev, {
      toolSayisi: toolUses.length,
      kuruTestSayisi: kuruTestYapilacaktilar.length,
      onayBekleyenSayisi: onayBekleyen.length,
      ogrenilenSayisi: ogrenilen.length,
      durationMs,
      ...(iptalEdildi ? { iptal: kosuKaydi.neden || 'sahip' } : {}),
    });

    if (basarisiz) {
      emit({ type: 'error', error: hata!, isId });
    } else {
      emit({ type: 'done', isId, model, toolUses, durationMs, kuruTestYapilacaktilar, onayBekleyen, ogrenilen, taxpayerId: ctx.taxpayerId });
    }
    return sonuc;
  }

  /**
   * KOŞUYU DURDUR — yalnız POST /ekip/isler/:id/iptal (Muzaffer Bey’in düğmesi). Aynı tenant'ın çalışan işi ise Agent SDK'ya
   * abort verilir; calistir() bunu görüp iş dosyasını failed + hata=IPTAL_HATA_METNI[neden] kapatır, AgentEvent yazar.
   * Kayıt yoksa (bitmiş / başka süreçte / başka tenant) {ok:false, error}. İkinci çağrı ilk nedeni korur.
   */
  iptalEt(tenantId: string, isId: string, neden: IptalNedeni = 'sahip'): { ok: boolean; isId: string; error?: string } {
    const k = this.calisanKosular.get(isId);
    if (!k || k.tenantId !== tenantId) return { ok: false, isId, error: 'Çalışan koşu bulunamadı (bitmiş olabilir).' };
    if (!k.ac.signal.aborted) {
      k.neden = neden;
      try {
        k.ac.abort();
      } catch (e: any) {
        this.logger.warn(`ekip koşusu durdurulamadı ${isId}: ${e?.message || e}`);
        return { ok: false, isId, error: 'Durdurma sinyali verilemedi.' };
      }
    }
    return { ok: true, isId };
  }

  /** Bu süreçte şu an koşan iş kimlikleri (teşhis/test). */
  calisanIsIdleri(): string[] {
    return Array.from(this.calisanKosular.keys());
  }

  /** Bugün (Istanbul) başlayan ekip koşusu sayısı — /ekip/durum için. */
  async bugunkuKosuSayisi(tenantId: string): Promise<number> {
    return (this.prisma as any).agentCommand
      .count({ where: { tenantId, agent: { startsWith: 'ekip:' }, createdAt: { gte: this.gunBasiIstanbul() } } })
      .catch(() => 0);
  }

  /** Şu an koşan (status=running) ekip işi sayısı — /ekip/durum `calisan`. */
  async calisanSayisi(tenantId: string): Promise<number> {
    return (this.prisma as any).agentCommand
      .count({ where: { tenantId, agent: { startsWith: 'ekip:' }, status: 'running' } })
      .catch(() => 0);
  }

  /** Bugün (Istanbul) hata ile biten ekip işi sayısı — /ekip/durum `bugunHata`. */
  async bugunHataSayisi(tenantId: string): Promise<number> {
    return (this.prisma as any).agentCommand
      .count({ where: { tenantId, agent: { startsWith: 'ekip:' }, status: 'failed', createdAt: { gte: this.gunBasiIstanbul() } } })
      .catch(() => 0);
  }

  /** Raporun ilk anlamlı satırı: "RAPOR:" sonrası; madde/markdown işaretleri soyulur; en çok 200 karakter. */
  private raporIlkSatir(rapor: any): string | null {
    const t = String(rapor || '');
    if (!t.trim()) return null;
    const i = t.search(/RAPOR\s*:/i);
    const govde = i >= 0 ? t.slice(i).replace(/^RAPOR\s*[*_`]*:\s*/i, '') : t;
    for (const ham of govde.split(/\r?\n/)) {
      // Baştaki madde/başlık işaretleri + satır içi kalın (**) / kod (`) işaretleri soyulur; alt çizgi korunur (araç adları)
      const satir = ham.replace(/^[\s*_`#>\-•]+/, '').replace(/\*\*|`/g, '').replace(/[*_]+$/, '').trim();
      if (!satir) continue;
      if (/^(ÖĞRENDİM|OGRENDIM|Öğrendiklerim|SORU)\s*:/i.test(satir)) continue;
      return satir.slice(0, 200);
    }
    return null;
  }

  /**
   * Son sabah özeti koşusu (koordinatör + payload.kaynak='cron'; hem 08:30 cron'u hem portaldaki "Şimdi üret"
   * bu kaynakla yazar) — /ekip/durum `sonSabahOzeti`. Yoksa null.
   */
  async sonSabahOzeti(tenantId: string): Promise<{
    isId: string;
    createdAt: Date;
    finishedAt: Date | null;
    status: string;
    raporIlkSatir: string | null;
    hata: string | null;
  } | null> {
    const r = await (this.prisma as any).agentCommand
      .findFirst({
        where: { tenantId, agent: 'ekip:koordinator', payload: { path: ['kaynak'], equals: 'cron' } },
        orderBy: { createdAt: 'desc' },
      })
      .catch(() => null);
    if (!r) return null;
    const res = r.result && typeof r.result === 'object' ? r.result : {};
    return {
      isId: r.id,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt || null,
      status: r.status,
      raporIlkSatir: this.raporIlkSatir(res.rapor),
      hata: res.hata || null,
    };
  }

  /** id → görünen ad (companyName | ad soyad); sorgu düşerse boş harita (kadro yine döner). */
  private async taxpayerAdlari(tenantId: string, idler: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!idler.length) return out;
    try {
      const rows: any[] = await (this.prisma as any).taxpayer.findMany({
        where: { tenantId, id: { in: idler } },
        select: { id: true, companyName: true, firstName: true, lastName: true },
      });
      for (const t of rows || []) {
        const ad = String(t?.companyName || '').trim() || `${String(t?.firstName || '').trim()} ${String(t?.lastName || '').trim()}`.trim();
        if (ad) out.set(t.id, ad);
      }
    } catch {
      /* ad çözülemedi — null kalır */
    }
    return out;
  }

  /** Ekipten açılmış bekleyen Muzaffer Bey’in onayı sayısı. */
  async bekleyenOnaySayisi(tenantId: string): Promise<number> {
    return (this.prisma as any).ownerApprovalRequest
      .count({ where: { tenantId, agent: { startsWith: 'ekip:' }, status: 'PENDING', expiresAt: { gt: new Date() } } })
      .catch(() => 0);
  }

  /**
   * Kadro özeti (araç sayıları + kademe dökümü) — /ekip/kadro.
   * tenantId verilirse her ajana koşu alanları eklenir: sonKosu (isOzeti şekli, yoksa null), bekleyenOnay,
   * bugunKosu, calisiyor. Sorgu hatasında alanlar boş/0 döner; kadro yine gelir.
   */
  async kadroOzeti(tenantId?: string | null) {
    const sonKosular = new Map<string, any>();
    const bekleyenOnaylar = new Map<string, number>();
    const bugunKosular = new Map<string, number>();
    const calisanlar = new Map<string, number>();
    const suAnlar = new Map<string, any>();
    if (tenantId) {
      const ekipWhere = { tenantId, agent: { startsWith: 'ekip:' } };
      const [sonlar, onaylar, bugunler, kosanlar, kosanIsler] = await Promise.all([
        // distinct + createdAt desc → her ajan için EN SON kayıt
        (this.prisma as any).agentCommand
          .findMany({ where: ekipWhere, orderBy: { createdAt: 'desc' }, distinct: ['agent'] })
          .catch(() => [] as any[]),
        (this.prisma as any).ownerApprovalRequest
          .groupBy({ by: ['agent'], where: { ...ekipWhere, status: 'PENDING', expiresAt: { gt: new Date() } }, _count: { _all: true } })
          .catch(() => [] as any[]),
        (this.prisma as any).agentCommand
          .groupBy({ by: ['agent'], where: { ...ekipWhere, createdAt: { gte: this.gunBasiIstanbul() } }, _count: { _all: true } })
          .catch(() => [] as any[]),
        (this.prisma as any).agentCommand
          .groupBy({ by: ['agent'], where: { ...ekipWhere, status: 'running' }, _count: { _all: true } })
          .catch(() => [] as any[]),
        // 5. sorgu (PLAN/18): her ajanın ŞU AN koştuğu iş → suAn {vakaId, isId, mukellefId, mukellefAd, konu, basladi}
        (this.prisma as any).agentCommand
          .findMany({ where: { ...ekipWhere, status: 'running' }, orderBy: { createdAt: 'desc' }, distinct: ['agent'] })
          .catch(() => [] as any[]),
      ]);
      const ajanIdsi = (agent: any) => String(agent || '').replace(/^ekip:/, '');
      const kosanDizi = Array.isArray(kosanIsler) ? (kosanIsler as any[]).filter((r) => r?.status === 'running') : [];
      const mukellefIdleri = Array.from(new Set(kosanDizi.map((r) => r?.payload?.taxpayerId).filter((x) => typeof x === 'string' && x))) as string[];
      const adlar = await this.taxpayerAdlari(tenantId, mukellefIdleri);
      for (const r of kosanDizi) {
        const mukellefId = r?.payload?.taxpayerId || null;
        suAnlar.set(ajanIdsi(r.agent), {
          vakaId: r?.payload?.vakaId || r.id,
          isId: r.id,
          mukellefId,
          mukellefAd: mukellefId ? adlar.get(mukellefId) || null : null,
          konu: konuBasligi(r?.payload?.gorev || r.action),
          basladi: r.startedAt || r.createdAt || null,
        });
      }
      for (const r of sonlar as any[]) sonKosular.set(ajanIdsi(r.agent), this.isOzeti(r));
      for (const g of onaylar as any[]) bekleyenOnaylar.set(ajanIdsi(g.agent), Number(g?._count?._all || 0));
      for (const g of bugunler as any[]) bugunKosular.set(ajanIdsi(g.agent), Number(g?._count?._all || 0));
      for (const g of kosanlar as any[]) calisanlar.set(ajanIdsi(g.agent), Number(g?._count?._all || 0));
    }
    return AJAN_TANIMLARI.map((a) => {
      const kademeler: Record<string, number> = {};
      for (const ad of a.araclar) {
        const k = aracKademesi(ad) || 'bilinmiyor';
        kademeler[k] = (kademeler[k] || 0) + 1;
      }
      return {
        id: a.id,
        ad: a.ad,
        unvan: a.unvan,
        aciklama: a.aciklama,
        model: a.model,
        modelKimligi: MODEL_KIMLIKLERI[a.model],
        aracSayisi: a.araclar.length,
        kademeler,
        araclar: a.araclar,
        onayNoktalari: a.onayNoktalari,
        tetikler: a.tetikler,
        kimlikKlasoru: a.kimlikKlasoru,
        // Koşu alanları (tenant verildiyse dolu; yoksa null/0)
        sonKosu: sonKosular.get(a.id) || null,
        bekleyenOnay: bekleyenOnaylar.get(a.id) || 0,
        bugunKosu: bugunKosular.get(a.id) || 0,
        calisiyor: (calisanlar.get(a.id) || 0) > 0,
        // PLAN/18: personel sırası yalnız DURUM gösterir — kim çalışıyor, ne üzerinde
        suAn: suAnlar.get(a.id) || null,
      };
    });
  }
}

/** RAPOR TEMİZLİĞİ (Muzaffer Bey'in bulgusu 2026-09-13: "cümlelerin arasında değişik kelimeler var"): model rapor bloğunun
 *  ÖNÜNE süreç cümleleri yazıyor ("İyi, aracı yükledim. Şimdi … çekiyorum…"). Rapor, ilk şablon başlığından ya da
 *  "Yaptığım iş:" satırından başlar; öncesi atılır. Başlık bulunamazsa metin olduğu gibi kalır. Ayrıca "---" ayraç
 *  satırları ve boş satır yığınları sadeleşir. */
export function raporTemizle(metin: string): string {
  const satirlar = String(metin || '').replace(/\r\n/g, '\n').split('\n');
  const baslikMi = (l: string) => /^(Yaptığım iş|NE YAPTIM)\s*:/i.test(l.trim()) || /^[A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9 \/·()-]{4,60} — /.test(l.trim());
  const ilk = satirlar.findIndex(baslikMi);
  const govde = ilk > 0 ? satirlar.slice(ilk) : satirlar;
  return govde
    .filter((l) => !/^\s*-{3,}\s*$/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
