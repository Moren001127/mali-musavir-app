/**
 * Paket: fm — Fatura İşleme Merkezi (mobil, salt okunur). Bkz. lib/ek/tur.ts sözleşmesi.
 *
 * Portal uçları (apps/api/src/fatura-muhasebelestirme/fatura-muhasebelestirme.controller.ts):
 *   GET summary?period&taxpayerId       → {total,pending,alisPending,satisPending,invalidCount,approved,posted,ocrInProgress,…}
 *   GET dashboard?period                → {rows:[{taxpayerId,name,ledgerType,pendingPurchase,pendingSale,pendingBank,approvedInvoice,approvedBank,totalPending}],totals}
 *   GET per-taxpayer-summary?period     → [{taxpayerId,pendingAlis,pendingSatis,pendingBanka,approvedAlis,approvedSatis,approvedBanka,postedToLuca,hasIssue}]
 *   GET documents?taxpayerId&period&limit → belge listesi (lines + guven dahil; ham kayıt ≈ 4 KB → burada KISALTILIR)
 *   GET kuyruk/durum                    → {pending:{CLASSIFY,AI_READ},running,done24h,failed24h,sonHata[]}
 *   GET documents/:id/file-url          → {url | inlineHtml, mimeType, source}
 *
 * Onay / muhasebeleştirme telefondan YAPILMAZ (Muzaffer Bey kararı: Muhasebeleştir paneli masaüstünde) → aksiyon yok.
 */
import type { EkBaglam, EkPaket } from './tur';

const FM = '/fatura-muhasebelestirme';

// ───────────────────────── Yardımcılar ─────────────────────────

/** Sunucu hatasını kısa Türkçe metne çevir (ekranda "Veri alınamadı · …" olarak görünür). */
function hataMetni(e: any): string {
  const st = e?.response?.status;
  const m = e?.response?.data?.message;
  const msg = Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : '';
  if (st) return 'Sunucu ' + st + (msg ? ' · ' + msg : '');
  if (e?.code === 'ECONNABORTED') return 'Zaman aşımı';
  return msg || e?.message || 'Bağlantı hatası';
}

/** Defter türü İşletme (Defter-Beyan) mi? — api isIsletmeLedger ile aynı ölçüt. */
function isletmeMi(ledgerType: any): boolean {
  const s = String(ledgerType || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
  return /isletme|defter.?beyan|basit/.test(s);
}

type UyariSeviye = 'bilgi' | 'uyari' | 'engel';
type Uyari = { kod: string; seviye: UyariSeviye; baslik: string; aciklama: string; meta?: any };

/** Faz 2 uyarı modeli {kod,seviye,baslik,aciklama}; eski kayıtlar {kod,baslik,mesaj,siddet} → normalize (web uyariNormalizeFE ile aynı). */
function uyariListe(raw: any): Uyari[] {
  const out: Uyari[] = [];
  for (const u of Array.isArray(raw) ? raw : []) {
    if (!u || !u.kod) continue;
    const sid = String(u.siddet || '').toLowerCase();
    const seviye: UyariSeviye =
      u.seviye === 'engel' || u.seviye === 'uyari' || u.seviye === 'bilgi' ? u.seviye : sid === 'hata' ? 'engel' : sid === 'uyari' ? 'uyari' : 'bilgi';
    out.push({ kod: String(u.kod), seviye, baslik: String(u.baslik || u.kod), aciklama: String(u.aciklama ?? u.mesaj ?? ''), meta: u.meta || undefined });
  }
  return out;
}

/** Matrah / KDV: önce fiş satırlarından, yoksa ocrData.matrah/kdvTutari, son çare kdvBreakdown (web kdvParts ile aynı). */
function kdvParcala(d: any): { matrah: number | null; kdv: number | null } {
  const lines: any[] = Array.isArray(d.lines) ? d.lines : [];
  const sale = String(d.invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  let matrah = 0, kdv = 0, has = false;
  for (const l of lines) {
    const amt = Number(sale ? l.credit : l.debit) || 0;
    if (l.group === 'matrah') { matrah += amt; has = true; }
    else if (l.group === 'vergi' || l.group === 'vergi-sorumlu') { kdv += amt; has = true; }
  }
  if (has) return { matrah, kdv };
  const od = d.ocrData || {};
  const m = od.matrah != null ? Number(od.matrah) : null;
  const k = od.kdvTutari != null ? Number(od.kdvTutari) : null;
  if (m != null || k != null) return { matrah: m, kdv: k };
  const bd: any[] = Array.isArray(od.kdvBreakdown) ? od.kdvBreakdown : [];
  let mb = 0, kb = 0;
  for (const b of bd) { kb += Number(b?.tutar ?? b?.amount ?? 0) || 0; mb += Number(b?.matrah ?? b?.base ?? 0) || 0; }
  if (kb || mb) {
    const tot = Number(d.totalAmount || 0);
    return { matrah: mb || (tot ? Math.max(tot - kb, 0) : null), kdv: kb || null };
  }
  return { matrah: null, kdv: null };
}

/** Durum rozeti: k = renk anahtarı (ok|proc|miss|warn|ham|asset), t = etiket, cat = süzme kategorisi. */
type Durum = { k: 'ok' | 'proc' | 'miss' | 'warn' | 'ham' | 'asset'; t: string; cat: string };

/**
 * Web fatura-merkezi/page.tsx deriveDurum'un mobil karşılığı — AYNI öncelik sırası:
 * onaylı → okunuyor → okunamadı → mükerrer → demirbaş kararı → çelişki (denge/toplam/doğrulama) → [işletme] → kod eksik → tutar → eşleşti.
 * Tek sadeleştirme: İşletme defterinde "Kayıt Türü" kontrolü kayıt-alt-tür listesine bakmaz (kayitTuruKod dolu mu).
 */
function durumTuret(doc: any, isIsletme: boolean): Durum {
  const status = String(doc.status || '').toUpperCase();
  if (status === 'APPROVED') return { k: 'ok', t: 'Onaylandı ✓', cat: 'onayli' };
  if (status === 'PROCESSING') return { k: 'proc', t: 'Okunuyor…', cat: 'okunuyor' };
  if (String(doc.ocrStatus || '').toUpperCase() === 'FAILED') return { k: 'miss', t: 'Okunamadı', cat: 'okunamadi' };
  const lines: any[] = Array.isArray(doc.lines) ? doc.lines : [];
  const od: any = doc.ocrData || {};
  // Ham belge: Aktar yalnız belgeyi koydu ya da entegratör belgesi hiç sınıflanmadı → "Okunmadı (ham)".
  const hamOkuma = od.matchDeferred === true || (!od.readMode && !od.engine && od.source === 'provider-api' && !od.giderTuru && !od.matrahKategori);
  const issues: any[] = Array.isArray(doc.validationIssues) ? doc.validationIssues : Array.isArray(od.validationIssues) ? od.validationIssues : [];
  const sumB = lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0);
  const sumA = lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0);
  const dengesiz = lines.length > 0 && Math.abs(sumB - sumA) > 0.5;
  const totalAmt = Number(doc.totalAmount || 0);
  let toplamUyumsuz = false;
  if (!isIsletme && lines.length > 0 && totalAmt > 0) {
    const yevmiye = Math.max(sumB, sumA);
    const rateLineCount = lines.filter((l: any) => ['matrah', 'vergi', 'vergi-sorumlu', 'diger_vergi'].includes(String(l.group || ''))).length;
    toplamUyumsuz = Math.abs(yevmiye - totalAmt) > Math.max(0.5, rateLineCount * 0.05);
  }
  const hasReturnLine = lines.some((l: any) => {
    const c = String(l.accountCode || '');
    return /^61[01]/.test(c) || (/^(191|391)/.test(c) && /İADE|IADE/i.test(String(l.description || '')));
  });
  const nonAmountIssues = issues.filter((i: any) => i?.code && i?.severity !== 'WARNING'
    && !['INCOMPLETE_AMOUNTS', 'TOTAL_MISMATCH', 'BALANCE_MISMATCH'].includes(i.code)
    && !(i.code === 'RETURN_NEEDS_REVERSAL' && hasReturnLine));
  const uy = uyariListe(od.uyarilar);
  const dem = uy.find((u) => u.kod === 'DEMIRBAS');
  if (uy.some((u) => u.kod === 'MUKERRER')) return { k: 'miss', t: 'Mükerrer — engel', cat: 'mukerrer' };
  const demirbasKarar = dem?.meta?.karar || null;
  if ((!!dem && !demirbasKarar) || (issues.some((i: any) => i?.code === 'FIXED_ASSET_MANUAL') && !demirbasKarar)) {
    return { k: 'asset', t: 'Demirbaş — karar bekliyor', cat: 'demirbas' };
  }
  if (dengesiz || toplamUyumsuz || nonAmountIssues.length > 0) {
    return { k: 'warn', t: toplamUyumsuz && !dengesiz && !nonAmountIssues.length ? 'Çelişki — toplam farklı' : 'Çelişki — kontrol et', cat: 'celiski' };
  }
  const p = kdvParcala(doc);
  const hasAmt = (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || totalAmt > 0;
  if (isIsletme) {
    if (!hasAmt) return { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
    const isl: any = od.isletme || {};
    const rows: any[] = Array.isArray(isl.satirlar) && isl.satirlar.length ? isl.satirlar : [isl];
    if (rows.every((r) => String(r?.kayitTuruKod || '').trim())) return { k: 'ok', t: 'Eşleşti ✓', cat: 'ready' };
    if (hamOkuma) return { k: 'ham', t: 'Okunmadı (ham)', cat: 'ham' };
    return { k: 'warn', t: 'Kayıt türü eksik', cat: 'incele' };
  }
  if (!lines.length) return hamOkuma ? { k: 'ham', t: 'Okunmadı (ham)', cat: 'ham' } : { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
  const sale = String(doc.invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  const blank = (g: string) => { const gl = lines.filter((l: any) => String(l.group || '') === g); return gl.length > 0 && gl.some((l: any) => !String(l.accountCode || '').trim()); };
  const eksik: string[] = [];
  if (blank('cari')) eksik.push('cari hesap');
  if (blank('matrah')) eksik.push(sale ? 'gelir kodu' : 'gider kodu');
  if (blank('vergi')) eksik.push('KDV kodu');
  if (blank('vergi-sorumlu')) eksik.push('sorumlu sıf. KDV hesabı');
  if (blank('tevkifat')) eksik.push('tevkifat 360 hesabı');
  if (blank('diger_vergi')) eksik.push('KDV dışı vergi hesabı');
  if (eksik.length) {
    if (hamOkuma) return { k: 'ham', t: 'Okunmadı (ham)', cat: 'ham' };
    const cap = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
    return { k: 'miss', t: eksik.length === 1 ? cap(eksik[0]) + ' boş' : 'Eksik: ' + eksik.join(', '), cat: 'eksik' };
  }
  const incomplete = doc.validationStatus === 'INCOMPLETE' || od.validationStatus === 'INCOMPLETE' || issues.some((i: any) => i?.code === 'INCOMPLETE_AMOUNTS');
  if (incomplete) return { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
  return { k: 'ok', t: 'Eşleşti ✓', cat: 'ready' };
}

/** Ham belge kaydını (≈4 KB) telefona gidecek kısa şekle indir — HTML yalnız bu alanları kullanır. */
function belgeKisalt(d: any, isIsletme: boolean) {
  const sat = String(d.invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
  const lines: any[] = Array.isArray(d.lines) ? d.lines : [];
  const od: any = d.ocrData || {};
  const matrahLine = lines.find((l: any) => String(l.group) === 'matrah' && String(l.accountCode || '').trim());
  const { matrah, kdv } = kdvParcala(d);
  const uy = uyariListe(od.uyarilar);
  const isl: any = od.isletme || {};
  return {
    id: String(d.id),
    taxpayerId: d.taxpayerId || '',
    yon: sat ? 'SATIS' : 'ALIS',
    firma: String((sat ? d.customerName : d.vendorName) || '').trim(),
    vkn: String((sat ? d.buyerVkn : d.sellerVkn) || ''),
    belgeNo: String(d.belgeNo || ''),
    tarih: d.faturaTarihi || d.createdAt || null,
    tutar: Number(d.totalAmount) || 0,
    matrah, kdv,
    paraBirimi: String(d.currency || 'TL'),
    status: String(d.status || ''),
    ocrStatus: String(d.ocrStatus || ''),
    lucaStatus: String(d.lucaStatus || ''),
    lucaFisNo: String(d.lucaFisNo || ''),
    lucaHata: String(d.lucaErrorMessage || ''),
    kaynak: String(d.source || ''),
    belgeTuru: String(d.documentType || ''),
    giderTuru: String(od.giderTuru || ''),
    matrahKategori: String(od.matrahKategori || ''),
    kategori: String(od.kategori || ''),
    aiMatrahGuven: String(od.aiMatrahGuven || ''),
    // İşletme defteri: Kayıt Türü ADI (alt tür varsa o; ör. "Hizmet Satışı"), ad yoksa kod
    kayitTuru: String(
      (Array.isArray(isl.satirlar) && isl.satirlar[0] && (isl.satirlar[0].kayitAltAd || isl.satirlar[0].kayitTuruAd))
        || isl.kayitAltAd || isl.kayitTuruAd || od.isletmeKayitTuru
        || (Array.isArray(isl.satirlar) && isl.satirlar[0] && isl.satirlar[0].kayitTuruKod) || isl.kayitTuruKod || '',
    ),
    hesapKodu: matrahLine ? String(matrahLine.accountCode) : '',
    hesapAd: matrahLine ? String(matrahLine.description || '') : '',
    guven: d.guven && d.guven.seviye ? { seviye: String(d.guven.seviye), neden: String(d.guven.neden || '') } : null,
    durum: durumTuret(d, isIsletme),
    // bilgi seviyesi satırda gösterilmez (web kararı); uyarı/engel özet ekranında listelenir
    uyarilar: uy.filter((u) => u.seviye !== 'bilgi').map((u) => ({ s: u.seviye, b: u.baslik, a: u.aciklama })),
    tevkifatli: uy.some((u) => u.kod === 'TEVKIFAT_VAR') || Number(od.tevkifatOrani || 0) > 0 || Number(od.tevkifatKdv || od.kdvTevkifat || 0) > 0,
    demirbas: uy.some((u) => u.kod === 'DEMIRBAS') || od.fixedAsset?.is === true,
    mukerrerIlk: String(d.duplicateOfId || ''),
    fis: lines.map((l: any) => ({ g: String(l.group || ''), k: String(l.accountCode || ''), a: String(l.description || ''), b: Number(l.debit) || 0, c: Number(l.credit) || 0 })),
  };
}

// ───────────────────────── Paket ─────────────────────────

export const paket: EkPaket = {
  yukleyiciler: {
    /** Modül açılınca: özet + kuyruk + pano paralel; mükellef seçiliyse belge listesi, ofis geneliyse mükellef özeti. */
    'fatura-merkezi': async (ctx: EkBaglam) => {
      const donem = ctx.donem;
      const ofis = !ctx.hasClient;
      const hatalar: Record<string, string> = {};
      const al = async <T,>(ad: string, p: Promise<{ data: T }> | null): Promise<T | null> => {
        if (!p) return null;
        try { return (await p).data; } catch (e: any) { hatalar[ad] = hataMetni(e); return null; }
      };
      const [ozet, kuyrukHam, pano, belgeHam, ptsHam] = await Promise.all([
        al<any>('ozet', ctx.api.get(FM + '/summary', { params: { period: donem, taxpayerId: ofis ? undefined : ctx.client } })),
        al<any>('kuyruk', ctx.api.get(FM + '/kuyruk/durum')),
        al<any>('pano', ctx.api.get(FM + '/dashboard', { params: { period: donem } })),
        ofis ? null : al<any>('belgeler', ctx.api.get(FM + '/documents', { params: { taxpayerId: ctx.client, period: donem, limit: 300 }, timeout: 45000 })),
        ofis ? al<any>('mukellefler', ctx.api.get(FM + '/per-taxpayer-summary', { params: { period: donem } })) : null,
      ]);

      const panoRows: any[] = Array.isArray(pano?.rows) ? pano.rows : [];
      const seciliPano = ofis ? null : panoRows.find((r) => String(r.taxpayerId) === String(ctx.client)) || null;
      const isIsletme = isletmeMi(seciliPano?.ledgerType);

      // Belge listesi (mükellef seçiliyken) — kısaltılmış; en yeni tarih üstte
      const belgeler = Array.isArray(belgeHam)
        ? belgeHam.map((d: any) => belgeKisalt(d, isIsletme)).sort((a, b) => String(b.tarih || '').localeCompare(String(a.tarih || '')))
        : null;

      // Mükellef özeti (ofis geneli): pano satırları (ad + defter türü + sayılar) + per-taxpayer-summary (sorun / Luca)
      let mukellefler: any[] | null = null;
      if (ofis) {
        const pts: any[] = Array.isArray(ptsHam) ? ptsHam : [];
        const ptsMap = new Map<string, any>(pts.map((p) => [String(p.taxpayerId), p]));
        const kaynak = panoRows.length ? panoRows : pts.map((p) => ({ taxpayerId: p.taxpayerId }));
        mukellefler = kaynak
          .map((r: any) => {
            const p = ptsMap.get(String(r.taxpayerId)) || {};
            const alis = Number(r.pendingPurchase ?? p.pendingAlis ?? 0) || 0;
            const satis = Number(r.pendingSale ?? p.pendingSatis ?? 0) || 0;
            const banka = Number(r.pendingBank ?? p.pendingBanka ?? 0) || 0;
            const onayli = Number((r.approvedInvoice ?? ((p.approvedAlis || 0) + (p.approvedSatis || 0))) || 0) + Number(r.approvedBank ?? p.approvedBanka ?? 0);
            return {
              id: String(r.taxpayerId),
              ad: String(r.name || ''),
              defter: String(r.ledgerType || ''),
              alis, satis, banka,
              bekleyen: alis + satis + banka,
              onayli,
              luca: Number(p.postedToLuca || 0) || 0,
              sorun: Number(p.hasIssue || 0) || 0,
            };
          })
          .filter((m) => m.bekleyen > 0 || m.onayli > 0 || m.sorun > 0)
          .sort((a, b) => b.bekleyen - a.bekleyen || b.onayli - a.onayli);
        // İki kaynak da alınamadıysa liste "yok" değil "alınamadı"dır (HTML hatayı gösterir)
        if (!panoRows.length && !pts.length && (hatalar.pano || hatalar.mukellefler)) mukellefler = null;
      }

      const kuyruk = kuyrukHam
        ? {
            okuma: Number(kuyrukHam.pending?.AI_READ || 0) || 0,
            sinif: Number(kuyrukHam.pending?.CLASSIFY || 0) || 0,
            calisan: Number(kuyrukHam.running || 0) || 0,
            tamam24: Number(kuyrukHam.done24h || 0) || 0,
            hata24: Number(kuyrukHam.failed24h || 0) || 0,
            sonHata: (Array.isArray(kuyrukHam.sonHata) ? kuyrukHam.sonHata : []).slice(0, 3).map((h: any) => ({ kind: String(h.kind || ''), hata: String(h.hata || ''), zaman: h.zaman || null })),
          }
        : null;

      ctx.pushModule('fatura-merkezi', ctx.client, {
        donem,
        ofis,
        isletme: isIsletme,
        ozet: ozet || null,
        kuyruk,
        belgeler,
        mukellefler,
        hatalar,
        zaman: Date.now(),
      });
    },
  },

  aksiyonlar: {
    /** "Belgeyi gör": file-url → {url|inlineHtml} → HTML'deki belge kutusuna (MOREN.fmDocView ya da applyDocView köprüsü). */
    'fm-belge-gor': async (ctx: EkBaglam, params: any) => {
      const id = String(params?.id || '').trim();
      const ver = (payload: any) =>
        ctx.inject('window.MOREN && (window.MOREN.fmDocView || window.MOREN.applyDocView)(' + JSON.stringify(payload) + ')');
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) { ver(null); return { ok: false, msg: 'Belge kimliği yok' }; }
      try {
        const { data } = await ctx.api.get(FM + '/documents/' + encodeURIComponent(id) + '/file-url', { timeout: 45000 });
        const url = typeof data?.url === 'string' ? data.url : typeof data?.fileUrl === 'string' ? data.fileUrl : '';
        const html = typeof data?.inlineHtml === 'string' ? data.inlineHtml : '';
        const ct = String(data?.mimeType || '');
        const payload = html ? { html, ct: 'text/html', source: String(data?.source || '') } : url ? { url, ct, source: String(data?.source || '') } : null;
        ver(payload);
        return payload ? { ok: true, msg: 'Belge açıldı' } : { ok: false, msg: 'Belge dosyası bulunamadı' };
      } catch (e: any) {
        ver(null);
        return { ok: false, msg: 'Belge açılamadı · ' + hataMetni(e) };
      }
    },
  },
};
