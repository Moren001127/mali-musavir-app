import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { tryDecrypt } from '../common/crypto';
import { gibFaturaPayload, gibTarih, GIB_ZORUNLU_ALANLAR, GIB_KALEM_ALANLARI } from './gib-earsiv-payload';
import { FaturaKesService } from './fatura-kes.service';

/**
 * GİB e-Arşiv Portalı'na TASLAK fatura gönderimi.
 *
 * GÜVENLİK SÖZÜ (kullanıcı kuralı: tek adımda resmî belge oluşmaz):
 *   • Burada YALNIZ TASLAK oluşturulur. Taslak resmî belge DEĞİLDİR, portaldan silinir,
 *     vergi doğurmaz, beyana girmez.
 *   • İMZALAMA / KESİNLEŞTİRME BU SERVİSTE YOKTUR. Ayrı adım, ayrı onay ve SMS kodu ister.
 *   • kuruTest=true ile GİB'e HİÇBİR ŞEY gönderilmez; yalnız gidecek veri döner.
 *
 * Sözleşme kaynağı: gib-earsiv-payload.ts (portalın kendi isteğinden yakalandı).
 */
const BASE = 'https://earsivportal.efatura.gov.tr/earsiv-services';

@Injectable()
export class FaturaKesGibService {
  private readonly logger = new Logger(FaturaKesGibService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly faturaKes: FaturaKesService,
  ) {}

  /**
   * TÜRKİYE ÇIKIŞI — projedeki diğer tüm GİB e-Arşiv çağrıları TURMOB_PROXY_URL üzerinden
   * çıkıyor (portal-automation runner ile aynı desen). Bu servis doğrudan çıkıyordu; env
   * tanımlıysa artık aynı kapıyı kullanır. Env yoksa DAVRANIŞ DEĞİŞMEZ (doğrudan çıkış).
   */
  private _dispatcher: any = undefined;
  private gibFetch(url: string, init: any) {
    if (this._dispatcher === undefined) {
      const purl = String(process.env.TURMOB_PROXY_URL || process.env.PORTAL_TR_PROXY_URL || '').trim();
      if (purl) {
        try {
          this._dispatcher = new (require('undici').ProxyAgent)(purl);
          this.logger.log('[FATURA-KES/GIB] Turkiye proxy aktif');
        } catch (e: any) {
          this.logger.warn(`[FATURA-KES/GIB] proxy kurulamadi: ${e?.message}`);
          this._dispatcher = null;
        }
      } else {
        this._dispatcher = null;
      }
    }
    return fetch(url, this._dispatcher ? { ...init, dispatcher: this._dispatcher } : init);
  }

  /** GİB'in kendi mesajını (varsa) düz metne çevir — teşhis buradan çıkıyor. */
  private gibMesaji(j: any): string {
    if (!j) return '';
    const m = Array.isArray(j.messages)
      ? j.messages.map((x: any) => String(x?.text || '').trim()).filter(Boolean).join(' | ')
      : '';
    return m || String(j.message || '').trim();
  }

  /**
   * GİB girişi. Başarısızsa GİB'İN KENDİ MESAJINI döndürür.
   * (Denetim 2026-08-20: mesaj yutuluyordu ve her hataya "kullanıcı kodu/şifre kontrol
   *  edilmeli" deniyordu. Oysa gerçek sebep çoğu kez "Sisteme aynı anda birden fazla giriş
   *  yapamazsınız" oluyor — yanlış teşhis kullanıcıyı şifre değiştirmeye yöneltiyordu.)
   */
  private async gibLogin(kod: string, sifre: string): Promise<{ token: string | null; mesaj: string }> {
    const body = new URLSearchParams();
    body.set('assoscmd', 'anologin');
    body.set('rtype', 'json');
    body.set('userid', kod);
    body.set('sifre', sifre);
    body.set('sifre2', sifre);
    body.set('parola', '1');
    const res = await this.gibFetch(`${BASE}/assos-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const j: any = await res.json().catch(() => null);
    return { token: j?.token || null, mesaj: this.gibMesaji(j) };
  }

  private async dispatch(token: string, cmd: string, pageName: string, jp: any) {
    const body = new URLSearchParams();
    body.set('callid', randomUUID());
    body.set('token', token);
    body.set('cmd', cmd);
    body.set('pageName', pageName);
    body.set('jp', JSON.stringify(jp));
    const res = await this.gibFetch(`${BASE}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      signal: AbortSignal.timeout(40_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`GİB JSON döndürmedi: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  }

  /**
   * GİB GÜVENLİ ÇIKIŞ — ATLANMAZ.
   *
   * Çıkış yapılmazsa oturum GİB'de açık kalır ve bir sonraki giriş şu cevapla REDDEDİLİR:
   *   "Sisteme aynı anda birden fazla giriş yapamazsınız.
   *    Lütfen 'Güvenli Çıkış' seçeneğini kullanarak çıkış yapınız."
   *
   * CANLI KANIT (2026-08-20): fatura gönderiminden sonra EDELER'in girişi kilitlendi;
   * aynı makineden BAŞKA mükellef sorunsuz girebiliyordu → sebep IP değil, AÇIK OTURUM.
   * Bu yalnız bizi değil MÜKELLEFİN KENDİ girişini de kilitlediği için zorunlu adımdır.
   */
  private async gibLogout(token: string): Promise<void> {
    try {
      const body = new URLSearchParams();
      body.set('assoscmd', 'logout');
      body.set('rtype', 'json');
      body.set('token', token);
      await this.gibFetch(`${BASE}/assos-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      this.logger.log('[FATURA-KES/GIB] guvenli cikis yapildi — oturum serbest');
    } catch (e: any) {
      this.logger.warn(`[FATURA-KES/GIB] GUVENLI CIKIS YAPILAMADI: ${e?.message} — mukellefin GIB girisi bir sure kilitli kalabilir`);
    }
  }

  /** GİB satırlarında alan adları değişkendir; ilk dolu olanı al. */
  private oku(row: any, adlar: string[]): string {
    for (const a of adlar) {
      const v = row?.[a];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  /**
   * BELGE NUMARASI + GÖRSEL — AYNI OTURUMDA ALINIR.
   *
   * GİB oluşturma cevabında numara YOKTUR ("Faturanız başarıyla oluşturulmuştur" der, numarayı
   * vermez). Sonradan ayrı bir girişle bakmak İMKANSIZ: GİB aynı anda tek oturuma izin verir,
   * güvenli çıkış yapılmadan ikinci giriş reddedilir. Bu yüzden numara ve görsel, çıkıştan
   * ÖNCE, aynı oturumda alınır.
   *
   * EŞLEŞTİRME GERÇEK VERİYE DAYANIR (2026-08-20 canlı liste çıktısı). Liste satırında
   * DÖNEN ALANLAR YALNIZCA ŞUNLARDIR:
   *   belgeNumarasi, aliciVknTckn, aliciUnvanAdSoyad, belgeTarihi, belgeTuru, onayDurumu, ettn
   * TUTAR ALANI YOKTUR — ilk yazdığım tutar eşleştirmesi bu yüzden hiçbir zaman tutmazdı.
   *
   * Kural: aynı gün + aynı alıcı VKN + henüz imzalanmamış ("Onaylanmadı") + bizim
   * veritabanımızda ETTN'i kayıtlı OLMAYAN satır. Tek aday kalırsa alınır; birden fazla
   * kalırsa TAHMİN EDİLMEZ (yanlış belgeyi kaydetmektense boş bırakılır).
   */
  private async belgeyiBul(token: string, payload: Record<string, any>, tenantId: string, taxpayerId: string) {
    const tarih = String(payload.faturaTarihi || '');
    const liste: any = await this.dispatch(token, 'EARSIV_PORTAL_TASLAKLARI_GETIR', 'RG_TASLAKLAR', {
      baslangic: tarih,
      bitis: tarih,
      hangiTip: '5000/30000',
      onayDurumu: 'Hepsi',
    }).catch(() => null);
    const rows: any[] = Array.isArray(liste?.data) ? liste.data : [];
    if (!rows.length) return { faturaNo: null, ettn: null, onay: null, not: 'GİB listesi boş döndü' };

    const vkn = String(payload.vknTckn || '');

    // Bu mükellefte DAHA ÖNCE kaydettiğimiz ETTN'ler — aynı alıcıya kesilmiş eski faturayı
    //   yanlışlıkla "yeni belge" sanmamak için elenir.
    const oncekiler = await (this.prisma as any).salesInvoiceDraft
      .findMany({ where: { tenantId, taxpayerId, ettn: { not: null } }, select: { ettn: true } })
      .catch(() => [] as any[]);
    const bilinen = new Set((oncekiler || []).map((x: any) => String(x.ettn)));

    const adaylar = rows.filter((r) => {
      const rv = this.oku(r, ['aliciVknTckn', 'vknTckn', 'vkn', 'aliciVkn']);
      if (rv && rv !== vkn) return false;
      const onay = this.oku(r, ['onayDurumu', 'durum']);
      if (/silin|iptal/i.test(onay)) return false; // silinmiş/iptal satır bizim belgemiz değil
      if (onay && !/onaylanmad/i.test(onay)) return false; // yeni oluşan belge İMZASIZDIR
      const ettn = this.oku(r, ['ettn', 'uuid', 'faturaUuid', 'belgeUuid']);
      if (ettn && bilinen.has(ettn)) return false; // zaten bizde kayıtlı → eski belge
      return true;
    });

    if (adaylar.length !== 1) {
      return {
        faturaNo: null,
        ettn: null,
        onay: null,
        not:
          adaylar.length === 0
            ? 'Listede eşleşen imzasız belge bulunamadı'
            : `${adaylar.length} aday eşleşti — tahmin edilmedi`,
      };
    }
    const r = adaylar[0];
    return {
      faturaNo: this.oku(r, ['belgeNumarasi', 'faturaNo', 'faturaNumarasi', 'belgeNo']) || null,
      ettn: this.oku(r, ['ettn', 'uuid', 'faturaUuid', 'belgeUuid']) || null,
      onay: this.oku(r, ['onayDurumu', 'durum']) || null,
      not: null,
    };
  }

  /** Faturanın GİB'deki kendi görüntüsü (HTML). Bizim önizlememiz değil, GERÇEK belge. */
  private async gorselAl(token: string, ettn: string, onay: string) {
    const r: any = await this.dispatch(token, 'EARSIV_PORTAL_FATURA_GOSTER', 'RG_TASLAKLAR', {
      ettn,
      onayDurumu: onay || 'Onaylanmadı',
    }).catch(() => null);
    const html = typeof r?.data === 'string' ? r.data : '';
    if (!html || html.length < 100 || !/</.test(html)) return null;
    return html.slice(0, 400_000); // aşırı büyük belge satırı şişirmesin
  }

  /** Mükellefin GİB e-Arşiv (GIB_IVD) kimliğini çöz. */
  private async kimlik(tenantId: string, taxpayerId: string) {
    const row: any = await (this.prisma as any).portalCredential.findFirst({
      where: { tenantId, taxpayerId, provider: 'GIB_IVD', isActive: true },
      select: { userCode: true, username: true, encryptedPassword: true, encryptedSecondaryPassword: true },
    });
    if (!row) throw new BadRequestException('Bu mükellefin GİB e-Arşiv (İVD) kimliği tanımlı değil');
    const kod = row.userCode || row.username;
    // İki şifre alanı da denenir: bazı mükellefte e-Arşiv şifresi ikincil alanda tutuluyor.
    const sifreler = [tryDecrypt(row.encryptedSecondaryPassword), tryDecrypt(row.encryptedPassword)]
      .filter((s): s is string => !!s && s.length > 0);
    if (!kod || !sifreler.length) throw new BadRequestException('GİB kullanıcı kodu ya da şifresi eksik');
    return { kod: String(kod), sifreler };
  }

  /**
   * GİB'DEKİ BELGENİN KENDİ GÖRÜNTÜSÜNÜ GETİR (ve eksikse numarayı tamamla).
   *
   * Neden gerekli: numara+görsel çekme düzeltmesinden ÖNCE gönderilmiş kayıtlarda
   * belge numarası ve görüntü boş kaldı. GİB tek oturuma izin verdiği için bunu
   * sonradan almanın tek yolu ayrı bir giriş+çıkış turudur.
   *
   * SALT OKUMA: hiçbir belge oluşturmaz, imzalamaz, silmez.
   */
  async gorseliTazele(tenantId: string, draftId: string) {
    const draft: any = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    if (draft.durum !== 'GIB_TASLAK' && draft.durum !== 'KESILDI') {
      throw new BadRequestException('Bu kayıt GİB’e gönderilmemiş — getirilecek GİB görüntüsü yok');
    }

    const { kod, sifreler } = await this.kimlik(tenantId, draft.taxpayerId);
    let token: string | null = null;
    let girisMesaji = '';
    for (const sf of sifreler) {
      const r = await this.gibLogin(kod, sf).catch((e: any) => ({ token: null, mesaj: e?.message || '' }));
      token = r.token;
      if (r.mesaj) girisMesaji = r.mesaj;
      if (token) break;
    }
    if (!token) {
      throw new BadRequestException(
        girisMesaji ? `GİB girişi başarısız — GİB'in cevabı: ${girisMesaji}` : 'GİB girişi başarısız',
      );
    }

    try {
      let faturaNo = draft.faturaNo || null;
      let ettn = draft.ettn || null;
      let onay = 'Onaylanmadı';
      if (!ettn) {
        const bulunan = await this.belgeyiBul(
          token,
          { faturaTarihi: gibTarih(new Date(draft.faturaTarihi)), vknTckn: String(draft.aliciVkn || '') },
          tenantId,
          draft.taxpayerId,
        );
        if (!bulunan.ettn) {
          return { ok: false, not: bulunan.not || 'GİB listesinde eşleşen belge bulunamadı' };
        }
        faturaNo = bulunan.faturaNo;
        ettn = bulunan.ettn;
        onay = bulunan.onay || onay;
      }
      const gorsel = await this.gorselAl(token, ettn as string, onay).catch(() => null);
      await (this.prisma as any).salesInvoiceDraft.update({
        where: { id: draftId },
        data: { faturaNo, ettn, gorselHtml: gorsel, hata: gorsel ? null : draft.hata },
      });
      this.logger.log(`[FATURA-KES/GIB] ${draftId} · gorsel tazelendi${faturaNo ? ' · ' + faturaNo : ''}`);
      return { ok: true, faturaNo, ettn, gorselVar: !!gorsel };
    } finally {
      await this.gibLogout(token);
    }
  }

  /**
   * Taslağı GİB'e gönder (ya da kuru testte yalnız göstereceğini göster).
   * Sonuç: GİB'de TASLAK oluşur — resmî belge DEĞİL.
   */
  async gibeGonder(tenantId: string, draftId: string, opts: { kuruTest?: boolean; gibdeIsrar?: boolean } = {}) {
    const draft: any = await (this.prisma as any).salesInvoiceDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!draft) throw new NotFoundException('Taslak bulunamadı');
    if (draft.durum === 'KESILDI') throw new BadRequestException('Bu fatura zaten kesinleşmiş');
    if (draft.durum === 'IPTAL') throw new BadRequestException('İptal edilmiş taslak gönderilemez');
    if (draft.durum === 'GIB_TASLAK') {
      throw new BadRequestException('Bu taslak GİB’e zaten gönderilmiş — mükerrer taslak oluşmasın diye durduruldu');
    }
    if (draft.durum === 'GONDERILIYOR') {
      throw new BadRequestException(
        'Bu taslağın GİB gönderimi sürüyor ya da yanıtı belirsiz kaldı. Körü körüne tekrar göndermek MÜKERRER FATURA doğurur — önce GİB portalından belge oluşup oluşmadığına bakın.',
      );
    }

    // KANAL DENETİMİ: mükellef entegratöre bağlıysa GİB portalından kesmek belge numarasını
    //   çakıştırır (iki sistem ayrı seri üretir). Varsayılan DUR; kullanıcı bile bile geçebilir.
    const kanalBilgi = await this.faturaKes.kanalTespit(tenantId, draft.taxpayerId);
    // KİMLİK YOKSA ISRAR DA GEÇMEZ — şifresiz zaten gönderilemez.
    if (kanalBilgi.sebep === 'KIMLIK_YOK') {
      throw new BadRequestException(kanalBilgi.uyari || 'Bu mükellefin GİB e-Arşiv kimliği yok');
    }
    // ENTEGRATÖRLÜ mükellefte varsayılan DUR; kullanıcı bile bile onaylarsa geçilir.
    if (!kanalBilgi.gibdenKesilebilir && !opts.gibdeIsrar) {
      throw new BadRequestException(kanalBilgi.uyari || 'Bu mükellefte GİB portalından fatura kesilemez');
    }

    const payload = gibFaturaPayload({
      aliciVkn: draft.aliciVkn,
      aliciUnvan: draft.aliciUnvan,
      aliciAdres: draft.aliciAdres,
      aliciVd: draft.aliciVd,
      aliciEposta: draft.aliciEposta,
      faturaTarihi: new Date(draft.faturaTarihi),
      aciklama: draft.aciklama,
      miktar: Number(draft.miktar),
      birim: draft.birim === 'ADET' ? 'C62' : draft.birim,
      matrah: Number(draft.matrah),
      kdvOrani: Number(draft.kdvOrani),
      kdvTutari: Number(draft.kdvTutari),
      toplam: Number(draft.toplam),
    });

    // SÖZLEŞME DENETİMİ: eksik alanla GİB'e gitmek anlamsız hata döndürür
    //   ("Bir hata meydana geldi") ve neyin yanlış olduğu ANLAŞILMAZ. Önce burada dur.
    const eksik = GIB_ZORUNLU_ALANLAR.filter((a) => !(a in payload));
    const kalem = (payload.malHizmetTable || [])[0] || {};
    const kalemEksik = GIB_KALEM_ALANLARI.filter((a) => !(a in kalem));
    if (eksik.length || kalemEksik.length) {
      throw new BadRequestException(
        `GİB veri sözleşmesi eksik — gönderilmedi. Eksik alan: ${[...eksik, ...kalemEksik.map((k) => 'kalem.' + k)].join(', ')}`,
      );
    }

    if (opts.kuruTest) {
      this.logger.log(`[FATURA-KES/KURU] ${draftId} · GİB'e GİDECEK veri hazırlandı, GÖNDERİLMEDİ`);
      return {
        kuruTest: true,
        gonderildi: false,
        cmd: 'EARSIV_PORTAL_FATURA_OLUSTUR',
        pageName: 'RG_BASITFATURA',
        alanSayisi: Object.keys(payload).length,
        payload,
      };
    }

    // ATOMİK KİLİT (denetim 2026-08-20 — KRİTİK):
    //   GİB isteği alıp belgeyi oluşturduktan SONRA cevap gecikirse (40 sn zaman aşımı) ya da
    //   bağlantı koparsa, eskiden hiçbir şey yazılmıyordu: durum 'TASLAK' kalıyor, ekranda
    //   "gönderilemedi" yazıyordu. Kullanıcı tekrar basınca GİB'de AYNI faturadan İKİ taslak
    //   oluşuyordu. Aynı anda iki tıklama da aynı deliği kullanıyordu.
    //   Çözüm: gönderimden ÖNCE durumu atomik olarak 'GONDERILIYOR' yap. Yalnızca GİB'in
    //   AÇIKÇA reddettiği (belge oluşmadığı kesin) durumda 'TASLAK'a geri alınır.
    const kilit = await (this.prisma as any).salesInvoiceDraft.updateMany({
      where: { id: draftId, tenantId, durum: 'TASLAK' },
      data: { durum: 'GONDERILIYOR', hata: 'GİB’e gönderiliyor, yanıt bekleniyor' },
    });
    if (kilit.count !== 1) {
      throw new BadRequestException('Bu taslak için gönderim zaten sürüyor ya da yapılmış — GİB taslak listesini kontrol edin');
    }

    const { kod, sifreler } = await this.kimlik(tenantId, draft.taxpayerId);
    let token: string | null = null;
    let girisMesaji = '';
    for (const s of sifreler) {
      const r = await this.gibLogin(kod, s).catch((e: any) => ({ token: null, mesaj: e?.message || '' }));
      token = r.token;
      if (r.mesaj) girisMesaji = r.mesaj;
      if (token) break;
    }
    if (!token) {
      // GİB'in kendi cümlesi teşhisin ta kendisi: "aynı anda birden fazla giriş yapamazsınız"
      //   ile "şifre yanlış" bambaşka işlerdir; yutulursa yanlış yere bakılır.
      await (this.prisma as any).salesInvoiceDraft
        .update({ where: { id: draftId }, data: { durum: 'TASLAK', hata: `GİB girişi başarısız: ${girisMesaji || 'sebep bildirilmedi'}` } })
        .catch(() => null);
      throw new BadRequestException(
        girisMesaji
          ? `GİB e-Arşiv girişi başarısız — GİB'in cevabı: ${girisMesaji}`
          : 'GİB e-Arşiv girişi başarısız — kullanıcı kodu/şifre kontrol edilmeli',
      );
    }

    let sonuc: any;
    let belge: any = { faturaNo: null, ettn: null, onay: null, not: null };
    let gorsel: string | null = null;
    try {
      try {
        sonuc = await this.dispatch(token, 'EARSIV_PORTAL_FATURA_OLUSTUR', 'RG_BASITFATURA', payload);
      } catch (e: any) {
        // YANIT BELİRSİZ: GİB belgeyi OLUŞTURMUŞ OLABİLİR. Durumu 'TASLAK'a GERİ ALMIYORUZ —
        //   geri alsak düğme yeniden çıkar ve tek tıkla mükerrer fatura kesilir.
        await (this.prisma as any).salesInvoiceDraft
          .update({
            where: { id: draftId },
            data: { hata: `GİB yanıtı alınamadı (${e?.message || 'bağlantı/zaman aşımı'}) — belge GİB'de OLUŞMUŞ OLABİLİR, portaldan kontrol edin` },
          })
          .catch(() => null);
        throw e;
      }
      // Numara ve görsel ÇIKIŞTAN ÖNCE alınır — sonradan ayrı girişle bakmak mümkün değil.
      const mesajOn = typeof sonuc?.data === 'string' ? sonuc.data : '';
      if (mesajOn && !/hata|ba[şs]ar[ıi]s[ıi]z|ge[çc]ersiz/i.test(mesajOn)) {
        belge = await this.belgeyiBul(token, payload, tenantId, draft.taxpayerId).catch(() => belge);
        if (belge?.ettn) gorsel = await this.gorselAl(token, belge.ettn, belge.onay).catch(() => null);
      }
    } finally {
      // HATA OLSA DA ÇIK: açık kalan oturum mükellefin kendi girişini de kilitler.
      await this.gibLogout(token);
    }
    const mesaj = typeof sonuc?.data === 'string' ? sonuc.data : '';
    // BELİRSİZ SONUÇ ≠ RED. data string değilse GİB ne dediği anlaşılmıyor demektir; belge
    //   oluşmuş olabilir. Bu durumda 'TASLAK'a geri alma YAPILMAZ (mükerrer riski), kayda
    //   "kontrol edin" notu düşülür ve kullanıcı uyarılır.
    if (!mesaj) {
      const gibNot = this.gibMesaji(sonuc) || JSON.stringify(sonuc).slice(0, 200);
      await (this.prisma as any).salesInvoiceDraft
        .update({ where: { id: draftId }, data: { hata: `GİB yanıtı anlaşılamadı: ${gibNot} — belge GİB'de OLUŞMUŞ OLABİLİR, portaldan kontrol edin` } })
        .catch(() => null);
      throw new BadRequestException(`GİB yanıtı anlaşılamadı: ${gibNot}. Belge oluşmuş olabilir — GİB portalından kontrol edin.`);
    }
    const basarisiz = /hata|ba[şs]ar[ıi]s[ıi]z|ge[çc]ersiz/i.test(mesaj);
    if (basarisiz) {
      // GİB AÇIKÇA reddetti → belge oluşmadı; tekrar denenebilsin diye TASLAK'a geri alınır.
      await (this.prisma as any).salesInvoiceDraft.update({
        where: { id: draftId },
        data: { durum: 'TASLAK', hata: `GİB reddetti: ${mesaj || JSON.stringify(sonuc).slice(0, 300)}` },
      });
      throw new BadRequestException(`GİB taslağı oluşturmadı: ${mesaj || 'yanıt boş'}`);
    }

    // Numara önce listeden (kesin), olmazsa mesaj içinden (nadiren geçiyor).
    const belgeNo = belge?.faturaNo || (mesaj.match(/[A-Z]{3}\d{13}/) || [])[0] || null;
    await (this.prisma as any).salesInvoiceDraft.update({
      where: { id: draftId },
      data: {
        durum: 'GIB_TASLAK',
        faturaNo: belgeNo,
        ettn: belge?.ettn || null,
        gorselHtml: gorsel,
        hata: belgeNo ? null : (belge?.not ? `Belge oluştu ama numara okunamadı: ${belge.not}` : null),
      },
    });
    this.logger.log(
      `[FATURA-KES/GIB] ${draftId} · GİB TASLAĞI oluşturuldu${belgeNo ? ' · ' + belgeNo : ' · numara okunamadi'}` +
        `${gorsel ? ' · gorsel alindi' : ''} (KESİNLEŞTİRİLMEDİ)`,
    );
    return {
      kuruTest: false,
      gonderildi: true,
      durum: 'GIB_TASLAK',
      faturaNo: belgeNo,
      ettn: belge?.ettn || null,
      gorselVar: !!gorsel,
      not: belge?.not || null,
      gibMesaj: mesaj.slice(0, 300),
    };
  }
}
