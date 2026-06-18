import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tryDecrypt } from '../common/crypto';

/**
 * Masaüstü uygulaması (Moren Masaüstü) için servis.
 *
 * Amaç: Hattat tarzı masaüstü uygulamasının (1) giriş yapmış müşavirin firma
 * listesini, (2) her firma için hangi devlet portalına şifre kayıtlı olduğunu
 * öğrenmesi ve (3) bir kısayola tıkladığında o portalın AÇIK (çözülmüş)
 * kullanıcı adı/şifresini güvenli şekilde alıp gömülü tarayıcıda otomatik
 * giriş yapması.
 *
 * Şifreleme anahtarı (ENCRYPTION_KEY) sadece sunucudadır; masaüstüne hiç
 * inmez. Açık şifre yalnızca tek firma/portal isteğinde, JWT korumalı
 * olarak, TLS üzerinden döner.
 *
 * Yeni tablo/şema EKLENMEDİ — mevcut `PortalCredential` (GIB_EBEYANNAME /
 * GIB_IVD / SGK_EBILDIRGE) kullanılır. 12 kısayol bu 3 şifre grubuna eşlenir.
 */

export const DESKTOP_PROVIDERS = ['GIB_EBEYANNAME', 'GIB_IVD', 'SGK_EBILDIRGE'] as const;
export type DesktopProvider = (typeof DESKTOP_PROVIDERS)[number];

// Provider'ın sahiplik tipi — JOB_META ile tutarlı.
//  GIB_EBEYANNAME → müşavir geneli (TENANT), diğerleri mükellef bazlı (TAXPAYER).
const PROVIDER_OWNER: Record<DesktopProvider, 'TENANT' | 'TAXPAYER'> = {
  GIB_EBEYANNAME: 'TENANT',
  GIB_IVD: 'TAXPAYER',
  SGK_EBILDIRGE: 'TAXPAYER',
};

export type DesktopPortal = {
  key: string;
  label: string;
  group: string;
  url: string;
  provider: DesktopProvider;
  logo: string; // portal-logolari/ içindeki dosya adı
};

/**
 * Masaüstündeki kısayol kataloğu — TEK KAYNAK. Masaüstü uygulaması bu listeyi
 * /desktop/shortcuts'tan çeker; logoları `logo` alanıyla, giriş adresini `url`
 * ile, şifre durumunu `provider` ile eşler.
 *
 * NOT: SGK portal adresleri SGK arayüzü değiştikçe güncellenebilir; tek
 * kaynak burası olduğu için masaüstü güncellemesi gerektirmez.
 */
export const DESKTOP_PORTALS: DesktopPortal[] = [
  { key: 'dijital_vd',    label: 'Dijital Vergi Dairesi',   group: 'Vergi / GİB', url: 'https://dijital.gib.gov.tr',                provider: 'GIB_IVD',        logo: 'dijitalVergiDairesiLogo.png' },
  { key: 'interaktif_vd', label: 'İnteraktif Vergi Dairesi', group: 'Vergi / GİB', url: 'https://ivd.gib.gov.tr',                    provider: 'GIB_IVD',        logo: 'ivd.png' },
  { key: 'internet_vd',   label: 'İnternet Vergi Dairesi',   group: 'Vergi / GİB', url: 'https://intvrg.gib.gov.tr',                 provider: 'GIB_IVD',        logo: 'intvd.png' },
  { key: 'ebeyanname',    label: 'e-Beyanname',              group: 'Vergi / GİB', url: 'https://ebeyanname.gib.gov.tr/index.html',  provider: 'GIB_EBEYANNAME', logo: 'YeniEBeyanname.svg' },
  { key: 'edefter',       label: 'e-Defter',                 group: 'Muhasebe',    url: 'https://uyg.edefter.gov.tr',                provider: 'GIB_IVD',        logo: 'EDefter.svg' },
  { key: 'sgk_ebildirge',   label: 'e-Bildirge',         group: 'SGK', url: 'https://uyg.sgk.gov.tr/WBildirimNet/amp/loginldap.xhtml', provider: 'SGK_EBILDIRGE', logo: 'sgk_ebildirge.png' },
  { key: 'sgk_ebildirgev2', label: 'e-Bildirge V2',      group: 'SGK', url: 'https://uyg.sgk.gov.tr/eBildirgeV2/',                  provider: 'SGK_EBILDIRGE', logo: 'sgk_ebildirgev2.png' },
  { key: 'sgk_isveren',     label: 'İşveren Sistemi',    group: 'SGK', url: 'https://uyg.sgk.gov.tr/IsverenSistemi/',              provider: 'SGK_EBILDIRGE', logo: 'sgk_isveren.png' },
  { key: 'sgk_erapor',      label: 'e-Rapor',            group: 'SGK', url: 'https://uyg.sgk.gov.tr/Ws_Rapor/',                     provider: 'SGK_EBILDIRGE', logo: 'sgk_erapor.png' },
  { key: 'sgk_isgiris',     label: 'İşe Giriş / Çıkış',  group: 'SGK', url: 'https://uyg.sgk.gov.tr/SigortaliTescil/amp/loginldap.xhtml', provider: 'SGK_EBILDIRGE', logo: 'sgk_isgiriscikis.png' },
  { key: 'sgk_ebildirim',   label: 'e-Bildirim',         group: 'SGK', url: 'https://uyg.sgk.gov.tr/HizmetBordrosu/',               provider: 'SGK_EBILDIRGE', logo: 'Sgk_ebildirim.png' },
  { key: 'earsiv',        label: 'E-Arşiv Fatura',           group: 'Muhasebe',    url: 'https://earsivportal.efatura.gov.tr',       provider: 'GIB_IVD',        logo: '__earsiv__' },
];

function taxpayerDisplayName(t: any): string {
  if (t.type === 'TUZEL_KISI') return (t.companyName || '').trim() || 'İsimsiz Firma';
  const ad = [t.firstName, t.lastName].filter(Boolean).join(' ').trim();
  return ad || (t.companyName || '').trim() || 'İsimsiz Firma';
}

@Injectable()
export class DesktopService {
  private readonly logger = new Logger(DesktopService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Masaüstü ana ekranı için: firma listesi + portal kataloğu + her firmada
   * hangi portalın şifresinin kayıtlı olduğu (şifrenin KENDİSİ dönmez).
   */
  async shortcuts(tenantId: string) {
    const [taxpayers, creds] = await Promise.all([
      (this.prisma as any).taxpayer.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, type: true, firstName: true, lastName: true, companyName: true, taxNumber: true, taxOffice: true },
        orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
      }),
      (this.prisma as any).portalCredential.findMany({
        where: { tenantId, isActive: true },
        select: { provider: true, ownerType: true, ownerId: true, taxpayerId: true, encryptedPassword: true, encryptedSecondaryPassword: true },
      }),
    ]);

    // Şifre fiilen kayıtlı mı? (en az bir şifre alanı dolu)
    const tenantProviders: Record<string, boolean> = {};
    const byTaxpayer: Record<string, Record<string, boolean>> = {};
    for (const c of creds) {
      const hasSecret = !!(c.encryptedPassword || c.encryptedSecondaryPassword);
      if (!hasSecret) continue;
      if (c.ownerType === 'TENANT') {
        tenantProviders[c.provider] = true;
      } else if (c.taxpayerId) {
        (byTaxpayer[c.taxpayerId] ||= {})[c.provider] = true;
      }
    }

    // Görünen ada göre TÜRKÇE alfabetik sırala (DB orderBy companyName/firstName
    // gerçek/tüzel kişiyi karıştırıyordu; kullanıcı listeyi A→Z görmek istiyor).
    const taxpayerList = taxpayers
      .map((t: any) => ({
        id: t.id,
        ad: taxpayerDisplayName(t),
        vkn: t.taxNumber,
        vergiDairesi: t.taxOffice,
        tur: t.type,
      }))
      .sort((a: any, b: any) => a.ad.localeCompare(b.ad, 'tr', { sensitivity: 'base' }));

    return {
      portals: DESKTOP_PORTALS,
      taxpayers: taxpayerList,
      credentials: { tenant: tenantProviders, byTaxpayer },
    };
  }

  /**
   * Tek firma + portal için AÇIK (çözülmüş) giriş bilgilerini döner.
   * Otomatik girişte gömülü tarayıcıya enjekte etmek için kullanılır.
   * Şifre yalnızca burada, JWT korumalı, çözülür; loglanmaz.
   */
  async credential(tenantId: string, body: { taxpayerId?: string; provider?: string }) {
    const provider = String(body?.provider || '').trim().toUpperCase() as DesktopProvider;
    if (!DESKTOP_PROVIDERS.includes(provider)) {
      throw new BadRequestException('Geçersiz portal sağlayıcısı');
    }
    const ownerType = PROVIDER_OWNER[provider];
    const taxpayerId = ownerType === 'TAXPAYER' ? String(body?.taxpayerId || '').trim() : null;
    if (ownerType === 'TAXPAYER' && !taxpayerId) {
      throw new BadRequestException('Mükellef seçimi gerekli');
    }
    const ownerId = ownerType === 'TENANT' ? tenantId : taxpayerId!;

    if (taxpayerId) {
      const tp = await (this.prisma as any).taxpayer.findFirst({ where: { id: taxpayerId, tenantId }, select: { id: true } });
      if (!tp) throw new NotFoundException('Mükellef bulunamadı');
    }

    const cred = await (this.prisma as any).portalCredential.findUnique({
      where: { tenantId_provider_ownerType_ownerId: { tenantId, provider, ownerType, ownerId } },
    });
    if (!cred || cred.isActive === false) {
      throw new NotFoundException('Bu portal için kayıtlı şifre yok');
    }

    // Denetim izi — şifre okunduğunda son erişim zamanını işle (içerik loglanmaz).
    await (this.prisma as any).portalCredential
      .update({ where: { id: cred.id }, data: { lastCheckedAt: new Date() } })
      .catch(() => {});

    return {
      provider,
      username: cred.username || '',
      userCode: cred.userCode || '',
      officeCode: cred.officeCode || '',
      workplaceCode: cred.workplaceCode || '',
      password: tryDecrypt(cred.encryptedPassword) || '',
      secondaryPassword: tryDecrypt(cred.encryptedSecondaryPassword) || '',
    };
  }

  /**
   * Masaüstünden gelen GİB/SGK giriş güvenlik kodu (CAPTCHA) görselini 2captcha
   * ile çözer. Anahtar (TWOCAPTCHA_API_KEY) yalnızca sunucudadır; masaüstüne
   * inmez. Aynı çözücü ayarları portal-automation runner'ında üretimde
   * kullanılıyor (regsense=1 → büyük/küçük harf korunur, GİB kodu çoğu zaman
   * BÜYÜK harf).
   *
   * @param imageBase64  Saf base64 (data: öneki olmadan) PNG/JPEG.
   * @returns { text, captchaId } — yanlış çözümde reportBadCaptcha için captchaId.
   */
  async solveCaptcha(imageBase64: string): Promise<{ text: string; captchaId: string }> {
    const apiKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (!apiKey) {
      throw new BadRequestException('Sunucuda güvenlik kodu çözücü ayarlı değil (TWOCAPTCHA_API_KEY).');
    }
    const base64 = String(imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
    if (!base64 || base64.length < 80) {
      throw new BadRequestException('Geçerli güvenlik kodu görseli gönderilmedi.');
    }
    if (base64.length > 1_500_000) {
      throw new BadRequestException('Güvenlik kodu görseli çok büyük.');
    }

    const inForm = new URLSearchParams();
    inForm.append('key', apiKey);
    inForm.append('method', 'base64');
    inForm.append('body', base64);
    inForm.append('json', '0');
    inForm.append('regsense', '1');
    inForm.append('min_len', '4');
    inForm.append('max_len', '6');

    const inRes = await fetch('https://2captcha.com/in.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: inForm.toString(),
    });
    const inText = (await inRes.text()).trim();
    if (!inText.startsWith('OK|')) throw new BadRequestException(`Güvenlik kodu gönderilemedi: ${inText}`);
    const captchaId = inText.slice(3);

    // Masaüstü etkileşimlidir — kullanıcı tarayıcının önünde bekler. Bu yüzden
    // runner'ın yavaş (5sn) yoklamasını DEĞİL, hızlı yoklamayı kullanırız:
    // ilk denemeden önce kısa bekle (~2sn), sonra sık yokla (~1.5sn). Tipik
    // bekleme ~10sn'den ~4-6sn'ye düşer (2captcha'nın gerçek çözüm süresi alt sınır).
    const maxAttempts = Number(process.env.DESKTOP_2CAPTCHA_MAX_POLL || 40);
    const firstWait = Number(process.env.DESKTOP_2CAPTCHA_FIRST_WAIT_MS || 2000);
    const pollInterval = Number(process.env.DESKTOP_2CAPTCHA_POLL_INTERVAL_MS || 1500);
    await new Promise((r) => setTimeout(r, firstWait));

    for (let i = 0; i < maxAttempts; i++) {
      const resUrl = `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(captchaId)}&json=0`;
      const r = await fetch(resUrl);
      const t = (await r.text()).trim();
      if (t === 'CAPCHA_NOT_READY') {
        await new Promise((rr) => setTimeout(rr, pollInterval));
        continue;
      }
      if (t.startsWith('OK|')) {
        return { text: String(t.slice(3)).replace(/[^0-9A-Za-z]/g, ''), captchaId };
      }
      throw new BadRequestException(`Güvenlik kodu çözülemedi: ${t}`);
    }
    throw new BadRequestException(`Güvenlik kodu zaman aşımı (${maxAttempts} deneme).`);
  }

  /** 2captcha'ya yanlış çözümü bildirir (iade + doğruluk iyileştirmesi). */
  async reportBadCaptcha(captchaId: string): Promise<{ ok: boolean }> {
    const apiKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    const id = String(captchaId || '').trim();
    if (!apiKey || !id) return { ok: false };
    try {
      await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=reportbad&id=${encodeURIComponent(id)}`);
    } catch {
      /* önemsiz */
    }
    return { ok: true };
  }
}
