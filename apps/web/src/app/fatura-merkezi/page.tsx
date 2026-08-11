'use client';

import { useState, useRef, useEffect, useMemo, Fragment, type KeyboardEvent, type MouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isletmeRef, ISLETME_ISLEM_TURU, ISLETME_KDV_ORAN, defaultBelgeTuruKod, normalizeDocumentType, getKayitAltList, defaultKayitAltKod, kayitAltKisaAd, isletmeAutoKayitTuru, isletmeAutoKayitAltKod } from '@mali-musavir/shared';

// Entegratör "Sorgula/Çek" sonucunu kullanıcıya GÖSTER. Eskiden onSuccess sadece "çekiliyor" diyordu;
// backend providers[].reason ("yetkiniz yok" gibi) ve created/fetched sayılarını dönüyor ama yutuluyordu.
function showFetchResult(d: any) {
  const provs: any[] = Array.isArray(d?.providers) ? d.providers : [];
  const failed = provs.filter((p) => p?.status === 'FAILED' || (p?.errors && p.errors.length));
  const partialFailed = provs.filter((p) => Number(p?.failed || 0) > 0);
  const queued = provs.filter((p) => p?.status === 'QUEUED_VIA_LUCA' || p?.status === 'QUEUED_GIB_PORTAL' || p?.status === 'QUEUED_EFATURA_SYNC');
  const skipped = provs.filter((p) => p?.status === 'SKIPPED');
  if (failed.length) {
    toast.error('Çekilemedi — ' + failed.map((p) => `${p.label || p.provider}: ${p.reason || p.errors?.[0]?.message || 'hata'}`).join(' · '), { duration: 9000 });
  } else if (partialFailed.length) {
    toast.warning(partialFailed.map((p) => `${p.label || p.provider}: ${Number(p.failed || 0)} satir yazilamadi`).join(' · '), { duration: 9000 });
  } else if (Number(d?.created) > 0) {
    toast.success(`${d.created} fatura çekildi${Number(d?.alreadyQueued) ? ` · ${d.alreadyQueued} zaten vardı` : ''}`);
  } else if (queued.length) {
    toast.success(queued[0].reason || 'Sorgu arka plana alindi; liste otomatik yenilenecek.', { duration: 8000 });
  } else if (skipped.length) {
    toast(skipped.map((p) => `${p.label || p.provider}: ${p.reason}`).join(' · '), { duration: 8000 });
  } else if (Number(d?.fetched) === 0) {
    toast('Bu dönemde entegratörde fatura bulunamadı');
  } else {
    toast.success('Sorgu tamamlandı');
  }
}

/**
 * Fatura İşleme Merkezi v2 — ana sayfa (CANLI)
 *
 * Tüm ekranlar canlı backend'e bağlıdır (/fatura-muhasebelestirme/*, /vendor-memory):
 *  - Genel Bakış      → per-taxpayer-summary
 *  - Mükellefler      → per-taxpayer-summary + taxpayers
 *  - Alış/Satış       → documents (+ getir/eşitle/muhasebeleştir aksiyonları)
 *  - Muhasebeleştir   → documents + approve/batch-post + talimat
 *  - Aktarılanlar     → documents (APPROVED / POSTED)
 *  - Eşleştirme Kur.  → vendor-memory (öğrenilen) + belge istisnaları
 *  - Entegratörler    → integrations CRUD + fetch + talimat
 *  - KDV Raporu       → kdv-client-report
 *  - Ayarlar          → account-plan + talimat
 *
 * Tema #fm-root altında izole edilmiştir; portal globals.css'i etkilemez.
 */

// SVG ikonları string olarak gömüyoruz (kebab attribute'ler React'i bozmasın diye)
function Ico({ html, size = 17 }: { html: string; size?: number }) {
  return (
    <span
      className="ico"
      style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const I = {
  grid: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  users: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  file: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  ledger: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 17V7h6v10"/><path d="M5 3h14a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2-3-2V4a1 1 0 0 1 1-1z"/></svg>',
  check: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
  rules: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h12"/></svg>',
  plug: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  chart: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
  gear: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  download: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  upload: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M20 16.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5"/></svg>',
  sync: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  wand: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 4 5 5"/><path d="M14 5 3 16l5 5L19 10"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg>',
  spark: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.4 3.4l1.55 4.25 4.25 1.55-4.25 1.55L9.4 15l-1.55-4.25L3.6 9.2l4.25-1.55z"/><path d="M17.8 4.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/><path d="M17.3 14.4l.55 1.5 1.5.55-1.5.55-.55 1.5-.55-1.5-1.5-.55 1.5-.55z"/></svg>',
  checkSm: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>',
  filter: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></svg>',
  eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  plus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
  clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z"/></svg>',
  expand: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></svg>',
  compress: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
};

function fmtMoney(v: any): string {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(v: any): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR');
}
const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** "2026-06" → "Haziran 2026" */
function periodLabel(p: string): string {
  const m = String(p || '').match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return p || '';
  return `${AY_ADLARI[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}
// Durum: TAM olarak neyin eksik olduğunu söyler (cari/gelir/gider/KDV kodu boş mu).
// cat = filtreleme kategorisi.
function deriveDurum(doc: any, isIsletme = false, autoKtKod = ''): { k: string; t: string; cat: string } {
  if (doc.status === 'APPROVED') return { k: 'ok', t: 'Onaylandı ✓', cat: 'onayli' };
  if (doc.status === 'PROCESSING') return { k: 'proc', t: 'Okunuyor…', cat: 'okunuyor' };
  if (String(doc.ocrStatus || '').toUpperCase() === 'FAILED') return { k: 'miss', t: 'Okunamadı', cat: 'okunamadi' };
  const lines: any[] = Array.isArray(doc.lines) ? doc.lines : [];
  const issues = Array.isArray(doc.validationIssues) ? doc.validationIssues : (Array.isArray(doc.ocrData?.validationIssues) ? doc.ocrData.validationIssues : []);
  // ÇELİŞKİ = GÜNCEL SATIRLARDAN hesaplanır. Backend validationIssues ESKİ/ALAKASIZ olabilir: rematch
  //   satırları düzeltir ama revalidate olmadan eski kayıt kalır (ör. satırlar 202=202 dengeli ama eski
  //   "yevmiye toplamı 404" mesajı = borç+alacak'ın yanlış toplandığı eski okumadan). TUTAR çelişkisini
  //   (denge) güncel satırlardan türetiriz; tutar-DIŞI issue'lar (sahiplik/iade/tevkifat/SMM) satır-
  //   bağımsız olduğundan backend'den alınır.
  const sumB = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  const sumA = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
  const dengesiz = lines.length > 0 && Math.abs(sumB - sumA) > 0.5; // borç ≠ alacak = GERÇEK denge hatası
  // TOPLAM UYUMU: satırlar kendi içinde dengeli olsa da yevmiye toplamı belge tutarından sapabilir —
  //   backend approve'da TOTAL_MISMATCH ile reddeder ama liste "Eşleşti" derdi. Backend'le AYNI mantık:
  //   yevmiye toplamı = max(borç, alacak); tolerans = Math.max(0.5, oranSatırıSayısı*0.05) (çok-oranlı
  //   kuruş yuvarlaması). totalAmount 0/boşsa kontrol atlanır. İşletme defteri tek-taraflı → uygulanmaz.
  const totalAmt = Number(doc.totalAmount || 0);
  let toplamUyumsuz = false;
  if (!isIsletme && lines.length > 0 && totalAmt > 0) {
    const yevmiyeToplam = Math.max(sumB, sumA);
    const rateLineCount = lines.filter((l: any) => ['matrah', 'vergi', 'vergi-sorumlu'].includes(String(l.group || ''))).length;
    const totalTol = Math.max(0.5, rateLineCount * 0.05);
    toplamUyumsuz = Math.abs(yevmiyeToplam - totalAmt) > totalTol;
  }
  // İADE: 610/611 ters-kayıt satırı KONDUYSA "iade normal kayıt yapılamaz" (RETURN_NEEDS_REVERSAL)
  //   uyarısı GÜNCEL DEĞİLDİR (610 eklendi/rematch attı, revalidate olmadan eski kayıt kalır). Güncel
  //   satırdan türet: 610 varsa bu issue'yu yok say → geriye sadece gerçek eksik (cari) kalır.
  // ALIŞTAN iade matrahı 610 DEĞİL (orijinal stok/gider 153/770) ama KDV "İADE" adlı 391'e işlenir →
  //   o satır da kaydın iade olduğunu gösterir; RETURN_NEEDS_REVERSAL yanlış alarm vermesin.
  const hasReturnLine = lines.some((l: any) => {
    const c = String(l.accountCode || '');
    return /^61[01]/.test(c) || (/^(191|391)/.test(c) && /İADE|IADE/i.test(String(l.description || '')));
  });
  const nonAmountIssues = issues.filter((i: any) => i?.code && i?.severity !== 'WARNING'
    && !['INCOMPLETE_AMOUNTS', 'TOTAL_MISMATCH', 'BALANCE_MISMATCH'].includes(i.code)
    && !(i.code === 'RETURN_NEEDS_REVERSAL' && hasReturnLine));
  // DEMİRBAŞ (sabit kıymet) alış/satışı: otomatik işlenmez → Luca'da manuel. "Çelişki"den AYRI/ÖNCE göster.
  if (issues.some((i: any) => i?.code === 'FIXED_ASSET_MANUAL')) return { k: 'asset', t: 'Demirbaş — manuel', cat: 'demirbas' };
  const vissue = dengesiz || toplamUyumsuz || nonAmountIssues.length > 0;
  if (vissue) return { k: 'warn', t: toplamUyumsuz && !dengesiz && !nonAmountIssues.length ? 'Çelişki — toplam belge tutarından farklı' : 'Çelişki — kontrol et', cat: 'celiski' };
  // İŞLETME DEFTERİ (Defter-Beyan): tek-taraflı — hesap planı/kodu YOK, cari kodu açılmaz.
  //   Sınıflandırma = Kayıt Türü (Mal/Hizmet Satışı) MÜKELLEFİN FAALİYETİNE göre otomatik belirlenir.
  //   Tutar okunmuş + kayıt türü çözülmüşse "Eşleşti"; çözülemezse "İncele" (Bilanço kod eksiği UYGULANMAZ).
  if (isIsletme) {
    const p = kdvParts(doc);
    const hasAmt = (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || Number(doc.totalAmount) > 0;
    const ready = isletmeDocReady(doc);
    if (!hasAmt) return { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
    if (ready.ok || autoKtKod) return { k: 'ok', t: 'Eşleşti ✓', cat: 'ready' };
    return { k: 'warn', t: ready.reason || 'Eşleşmedi', cat: 'incele' };
  }
  // Hiç satır yok → matrah/KDV okunamamış.
  if (!lines.length) return { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
  // Hangi grupların KODU boş? (cari hesap / gelir-gider / KDV) — tam söyle.
  const sale = (doc.invoiceKind || 'ALIS') === 'SATIS';
  const blank = (g: string) => { const gl = lines.filter((l: any) => String(l.group || '') === g); return gl.length > 0 && gl.some((l: any) => !l.accountCode); };
  const missing: string[] = [];
  if (blank('cari')) missing.push('cari hesap');
  if (blank('matrah')) missing.push(sale ? 'gelir kodu' : 'gider kodu');
  if (blank('vergi')) missing.push('KDV kodu');
  if (blank('vergi-sorumlu')) missing.push('sorumlu sıf. KDV hesabı');
  if (blank('tevkifat')) missing.push('tevkifat 360 hesabı');
  if (missing.length) {
    const cap = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
    const t = missing.length === 1 ? `${cap(missing[0])} boş` : `Eksik: ${missing.join(', ')}`;
    return { k: 'miss', t, cat: 'eksik' };
  }
  const incomplete =
    doc.validationStatus === 'INCOMPLETE' ||
    doc.ocrData?.validationStatus === 'INCOMPLETE' ||
    issues.some((i: any) => i?.code === 'INCOMPLETE_AMOUNTS');
  if (incomplete) return { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
  return { k: 'ok', t: 'Eşleşti ✓', cat: 'ready' };
}
function taxpayerLabel(t: any): string {
  return t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.taxNumber || 'Mükellef';
}
// KDV tevkifatı işlem türü kodları (GİB / KDV2 beyannamesi) — Muhasebeleştir'deki
// "Tevkifat Kodu" seçici bunu kullanır (Mihsap'taki yapıya birebir). Kod seçilince
// tevkifat satırlarının oranı boşsa otomatik dolar; kullanıcı oranı ayrıca değiştirebilir.
// İlk 8 kayıt (201-208) kullanıcının Mihsap ekranından birebir alındı.
// 209 ve sonrası için varsayılan oranlar BDP'den (Beyanname Düzenleme Programı) TEYİT EDİLMELİ.
// Mihsap/BDP resmî tevkifat kod listesiyle BİREBİR eşitlendi (kullanıcı ekran görüntüleriyle
//   teyit, 2026-07-18). ESKİ LİSTE 217 sonrası BİR KOD KAYIKTI (Yük Taşımacılığı 223 değil 224,
//   Reklam 225, Demir-Çelik 227) ve 201/203 oranları eskiydi — beyannameye yanlış kod gidiyordu.
//   2xx = kısmi tevkifat (alış), 1xx = tam tevkifat (10/10), 250 = diğer (oran elle),
//   3xx = satış bildirim kodları (oran belge oranından gelir).
const TEVKIFAT_KODLARI: { kod: string; oran: string; ad: string }[] = [
  { kod: '201', oran: '4/10', ad: 'Yapım İşleri ile Bu İşlerle Birlikte İfa Edilen Mühendislik-Mimarlık ve Etüt-Proje Hizmetleri' },
  { kod: '202', oran: '9/10', ad: 'Etüt, Plan-Proje, Danışmanlık, Denetim ve Benzeri Hizmetler' },
  { kod: '203', oran: '7/10', ad: 'Makine, Teçhizat, Demirbaş ve Taşıtlara Ait Tadil, Bakım ve Onarım Hizmetleri' },
  { kod: '204', oran: '5/10', ad: 'Yemek Servis Hizmeti' },
  { kod: '205', oran: '5/10', ad: 'Organizasyon Hizmeti' },
  { kod: '206', oran: '9/10', ad: 'İşgücü Temin Hizmetleri' },
  { kod: '207', oran: '9/10', ad: 'Özel Güvenlik Hizmeti' },
  { kod: '208', oran: '9/10', ad: 'Yapı Denetim Hizmetleri' },
  { kod: '209', oran: '7/10', ad: 'Fason Olarak Yaptırılan Tekstil ve Konfeksiyon İşleri, Çanta ve Ayakkabı Dikim İşleri ve Bu İşlere Aracılık Hizmetleri' },
  { kod: '210', oran: '9/10', ad: 'Turistik Mağazalara Verilen Müşteri Bulma/Götürme Hizmetleri' },
  { kod: '211', oran: '9/10', ad: 'Spor Kulüplerinin Yayın, Reklâm ve İsim Hakkı Gelirlerine Konu İşlemleri' },
  { kod: '212', oran: '9/10', ad: 'Temizlik Hizmeti' },
  { kod: '213', oran: '9/10', ad: 'Çevre ve Bahçe Bakım Hizmetleri' },
  { kod: '214', oran: '5/10', ad: 'Servis Taşımacılığı Hizmeti' },
  { kod: '215', oran: '7/10', ad: 'Her Türlü Baskı ve Basım Hizmetleri' },
  { kod: '216', oran: '5/10', ad: 'Diğer Hizmetler (5018 Sayılı Kanuna Ekli Cetveller Kapsamındaki İdare, Kurum ve Kuruluşlara)' },
  { kod: '217', oran: '7/10', ad: 'Hurda Metalden Elde Edilen Külçe Teslimleri' },
  { kod: '218', oran: '7/10', ad: 'Hurda Metalden Elde Edilenler Dışındaki Bakır, Çinko, Alüminyum ve Kurşun Külçe Teslimleri' },
  { kod: '219', oran: '7/10', ad: 'Bakır, Çinko, Alüminyum ve Kurşun Ürünlerinin Teslimi' },
  { kod: '220', oran: '7/10', ad: 'İstisnadan Vazgeçenlerin Hurda ve Atık Teslimi' },
  { kod: '221', oran: '9/10', ad: 'Metal, Plastik, Lastik, Kauçuk, Kâğıt ve Cam Hurda ve Atıklarından Elde Edilen Hammadde Teslimi' },
  { kod: '222', oran: '9/10', ad: 'Pamuk, Tiftik, Yün ve Yapağı ile Ham Post ve Deri Teslimleri' },
  { kod: '223', oran: '5/10', ad: 'Ağaç ve Orman Ürünleri Teslimi' },
  { kod: '224', oran: '2/10', ad: 'Yük Taşımacılığı Hizmeti' },
  { kod: '225', oran: '3/10', ad: 'Ticari Reklam Hizmetleri' },
  { kod: '226', oran: '2/10', ad: 'Diğer Teslimler' },
  { kod: '227', oran: '5/10', ad: 'Demir-Çelik Ürünlerinin Teslimi' },
  { kod: '250', oran: '', ad: 'DİĞERLERİ (oranı elle seç)' },
  { kod: '101', oran: '10/10', ad: 'İkametgâhı, İşyeri, Kanuni Merkezi ve İş Merkezi Türkiye\'de Bulunmayanlarca Yapılan İşlemler' },
  { kod: '102', oran: '10/10', ad: 'Serbest Meslek Faaliyeti Çerçevesinde Yapılan Teslim ve Hizmetler' },
  { kod: '103', oran: '10/10', ad: 'Kiralama İşlemleri' },
  { kod: '104', oran: '10/10', ad: 'Reklam Verme İşlemleri' },
  { kod: '106', oran: '10/10', ad: 'İthal Edilen Malın Bedelinde Sonradan Ortaya Çıkan Ödemeler' },
  { kod: '150', oran: '10/10', ad: 'Diğerleri (Tam Tevkifat)' },
  { kod: '301', oran: '', ad: 'Yapım İşleri ile Bu İşlerle Birlikte İfa Edilen Mühendislik-Mimarlık ve Etüt-Proje Hizmetleri (Satış)' },
  { kod: '302', oran: '', ad: 'Etüt, Plan-Proje, Danışmanlık, Denetim ve Benzeri Hizmetler (Satış)' },
  { kod: '303', oran: '', ad: 'Makine, Teçhizat, Demirbaş ve Taşıtlara Ait Tadil, Bakım ve Onarım Hizmetleri (Satış)' },
  { kod: '304', oran: '', ad: 'Yemek Servis Hizmeti (Satış)' },
  { kod: '305', oran: '', ad: 'Organizasyon Hizmeti (Satış)' },
  { kod: '306', oran: '', ad: 'İşgücü Temin Hizmetleri (Satış)' },
  { kod: '307', oran: '', ad: 'Özel Güvenlik Hizmeti (Satış)' },
  { kod: '308', oran: '', ad: 'Yapı Denetim Hizmetleri (Satış)' },
  { kod: '309', oran: '', ad: 'Fason Olarak Yaptırılan Tekstil ve Konfeksiyon İşleri (Satış)' },
  { kod: '310', oran: '', ad: 'Turistik Mağazalara Verilen Müşteri Bulma/Götürme Hizmetleri (Satış)' },
  { kod: '311', oran: '', ad: 'Spor Kulüplerinin Yayın, Reklâm ve İsim Hakkı Gelirlerine Konu İşlemleri (Satış)' },
  { kod: '312', oran: '', ad: 'Temizlik Hizmeti (Satış)' },
  { kod: '313', oran: '', ad: 'Çevre ve Bahçe Bakım Hizmetleri (Satış)' },
  { kod: '314', oran: '', ad: 'Servis Taşımacılığı Hizmeti (Satış)' },
  { kod: '315', oran: '', ad: 'Her Türlü Baskı ve Basım Hizmetleri (Satış)' },
  { kod: '316', oran: '', ad: 'Hurda Metalden Elde Edilen Külçe Teslimi (Satış)' },
  { kod: '317', oran: '', ad: 'Hurda Metalden Elde Edilenler Dışındaki Bakır, Çinko, Alüminyum ve Kurşun Külçe Teslimleri (Satış)' },
  { kod: '318', oran: '', ad: 'Bakır, Çinko, Alüminyum ve Kurşun Ürünlerinin Teslimi (Satış)' },
  { kod: '319', oran: '', ad: 'İstisnadan Vazgeçenlerin Hurda ve Atık Teslimi (Satış)' },
  { kod: '320', oran: '', ad: 'Metal, Plastik, Lastik, Kauçuk, Kâğıt ve Cam Hurda ve Atıkları Teslimi (Satış)' },
  { kod: '321', oran: '', ad: 'Pamuk, Tiftik, Yün ve Yapağı ile Ham Post ve Deri Teslimleri (Satış)' },
  { kod: '322', oran: '', ad: 'Ağaç ve Orman Ürünleri Teslimi (Satış)' },
  { kod: '323', oran: '', ad: 'Yük Taşımacılığı Hizmeti (Satış)' },
  { kod: '324', oran: '', ad: 'Ticari Reklam Hizmetleri (Satış)' },
  { kod: '325', oran: '', ad: 'Demir-Çelik Ürünlerinin Teslimi (Satış)' },
];
// Hesap kodu seçici — Mihsap gibi: KUTUNUN İÇİNE doğrudan yazılır (ayrı arama kutusu yok),
// yazdıkça altta kod/isim listesi filtrelenir; tıkla seç ya da Enter. Tek temiz ok.
function CodeSelect({ value, accounts, onChange, onAddNew }: { value: string; accounts: any[]; onChange: (code: string) => void; onAddNew?: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inpRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0); // yön tuşuyla gezilen satır
  const sel = accounts.find((a) => String(a.code) === String(value));
  const selName = sel?.name || '';
  // Panel overflow:hidden gruplarca kırpılmasın diye position:fixed; alan konumunu ölç.
  const measure = () => {
    const el = boxRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(440, Math.max(r.width, 300));
    let left = r.left; if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    setPos({ top: r.bottom + 4, left, width });
  };
  useEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    const onDoc = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current && boxRef.current.contains(t)) return;
      if (popRef.current && popRef.current.contains(t)) return;
      setOpen(false);
    };
    const reflow = () => measure();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', reflow, true); window.removeEventListener('resize', reflow); };
  }, [open]);
  // Filtre DAİMA kutudaki metne (value) göre → tıklayınca dropdown seçili koda filtreli
  // açılır (baştan tüm plan değil); silmeye başlayınca anında güncellenir. Kutu boşsa tüm liste.
  const term = String(value || '').trim().toLocaleLowerCase('tr');
  const codeTrim = String(value || '').trim();
  // Yazılan kod planda TAM olarak yoksa "+" çıkar (Mihsap modeli — yeni hesap aç).
  const exactExists = !codeTrim || accounts.some((a) => String(a.code) === codeTrim);
  const list = (term
    ? accounts.filter((a) => String(a.code || '').toLocaleLowerCase('tr').includes(term) || String(a.name || '').toLocaleLowerCase('tr').includes(term))
    : accounts
  ).slice(0, 80);
  const pick = (code: string) => { onChange(code); setOpen(false); inpRef.current?.blur(); };
  const actIdx = list.length ? Math.min(active, list.length - 1) : 0;
  // Açılınca aktif satırı mevcut seçili koda getir (yoksa baş).
  useEffect(() => {
    if (!open) return;
    const i = list.findIndex((a) => String(a.code) === String(value));
    setActive(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Yön tuşuyla gezilen satırı liste içinde görünür tut.
  useEffect(() => {
    if (!open || !popRef.current) return;
    const el = popRef.current.querySelector('.cselopt.act') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [actIdx, open]);
  return (
    <div className="csel" ref={boxRef}>
      <div className={`cselfield${open ? ' on' : ''}`} title={value ? (selName ? `${value} — ${selName}` : value) : ''}>
        <input ref={inpRef} className="cselinp" value={open ? value : (value && selName ? `${value} — ${selName}` : value)} placeholder="kod ya da isim yaz"
          onFocus={() => { setOpen(true); measure(); setTimeout(() => inpRef.current?.select(), 0); }}
          onChange={(e) => { const r = e.target.value; onChange(r.includes(' — ') ? r.split(' — ')[0].trim() : r); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); inpRef.current?.blur(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); } else { setActive((i) => Math.min(list.length - 1, Math.min(i, list.length - 1) + 1)); } }
            else if (e.key === 'ArrowUp') { if (open) { e.preventDefault(); setActive((i) => Math.max(0, Math.min(i, list.length - 1) - 1)); } }
            else if (e.key === 'Enter') { e.preventDefault(); if (open && list.length) { pick(String(list[Math.min(active, list.length - 1)].code)); } else if (list.length === 1) { pick(String(list[0].code)); } else { setOpen(false); } }
          }} />
        <span className="cselcar" onMouseDown={(e) => { e.preventDefault(); if (open) { setOpen(false); } else { setOpen(true); inpRef.current?.focus(); measure(); setTimeout(() => inpRef.current?.select(), 0); } }} />
      </div>
      {open && pos && (
        <div className="cselpop" ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}>
          <div className="csellist">
            {onAddNew && !exactExists && (
              <div onMouseDown={(e) => { e.preventDefault(); setOpen(false); onAddNew(codeTrim); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', cursor: 'pointer', color: '#16a34a', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                title="Bu hesap Luca planında yok — yeni hesap aç">
                <span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', border: '2px solid #16a34a', fontSize: 15, lineHeight: 1 }}>+</span>
                Yeni hesap aç: <b>{codeTrim}</b>
              </div>
            )}
            {list.length === 0 && exactExists && <div className="cselempty">Eşleşen hesap yok — yazdığın kod aynen kullanılır</div>}
            {list.map((a, idx) => (
              <div key={a.id || a.code} className={`cselopt${String(a.code) === String(value) ? ' sel' : ''}${idx === actIdx ? ' act' : ''}`} onMouseEnter={() => setActive(idx)} onMouseDown={(e) => { e.preventDefault(); pick(String(a.code)); }}>
                <b>{a.code}</b>{a.name ? <span>{a.name}</span> : null}
              </div>
            ))}
            {!term && accounts.length > 80 && <div className="cselmore">… {accounts.length - 80} hesap daha — yazarak daralt</div>}
          </div>
        </div>
      )}
    </div>
  );
}
// Türk para girişi — kutuda binlik/ondalık ayrılmış (1.234,56) görünür, okunur; düzenlenince
// "1.234,56" ya da "1234,56" ya da "1234.56" hepsi doğru sayıya çevrilir.
function parseTrNumber(s: string): number {
  if (!s) return 0;
  let t = String(s).trim().replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  const decSep = lastComma > lastDot ? ',' : (lastDot > lastComma ? '.' : '');
  if (decSep) { const thousands = decSep === ',' ? '.' : ','; t = t.split(thousands).join('').replace(decSep, '.'); }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}
function MoneyInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState('');
  const display = focused
    ? raw
    : (value ? value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  return (
    <input className="li linum money" inputMode="decimal" value={display} placeholder="0,00"
      onFocus={() => { setFocused(true); setRaw(value ? String(value).replace('.', ',') : ''); }}
      onChange={(e) => { setRaw(e.target.value); onChange(parseTrNumber(e.target.value)); }}
      onBlur={() => setFocused(false)} />
  );
}
// KDV oranı seçici — temiz özel dropdown (native siyah liste + tek başına "%" YOK).
function RateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const opts = ['0', '1', '10', '20'];
  const all = value && !opts.includes(value) ? [...opts, value] : opts;
  const measure = () => {
    const el = boxRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 3, left: r.left, width: Math.max(r.width, 64) });
  };
  useEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    const onDoc = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reflow = () => measure();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', reflow, true); window.removeEventListener('resize', reflow); };
  }, [open]);
  return (
    <div className="rsel" ref={boxRef}>
      <div className={`rselfield${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span>%{value || '—'}</span><span className="rselcar" />
      </div>
      {open && pos && (
        <div className="rselpop" ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}>
          {all.map((o) => (
            <div key={o} className={`rselopt${o === value ? ' sel' : ''}`} onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}>%{o}</div>
          ))}
        </div>
      )}
    </div>
  );
}
// Genel temiz açılır liste (native siyah select yerine) — Fatura Türü, Belge Türü vb.
function PlainSelect({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ left: number; width: number; maxH: number; top?: number; bottom?: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => String(o.value) === String(value));
  const filtered = search ? options.filter((o) => o.label.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'))) : options;
  // Viewport-duyarlı: altta yer yoksa YUKARI aç; her durumda yüksekliği ekrana sığdır (ekrandan taşmaz).
  const measure = () => {
    const el = boxRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const flipUp = below < 240 && above > below;
    const maxH = Math.max(140, Math.min(330, flipUp ? above : below));
    setPos(flipUp
      ? { left: r.left, width: r.width, maxH, bottom: vh - r.top + 3 }
      : { left: r.left, width: r.width, maxH, top: r.bottom + 3 });
  };
  useEffect(() => {
    if (!open) { setPos(null); setSearch(''); return; }
    measure();
    const onDoc = (e: globalThis.MouseEvent) => { const t = e.target as Node; if (boxRef.current?.contains(t) || popRef.current?.contains(t)) return; setOpen(false); };
    const reflow = () => measure();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', reflow, true); window.removeEventListener('resize', reflow); };
  }, [open]);
  return (
    <div className="psel" ref={boxRef}>
      <div className={`pselfield${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className={cur ? '' : 'ph'}>{cur ? cur.label : '—'}</span><span className="pselcar" />
      </div>
      {open && pos && (
        <div className="pselpop" ref={popRef} style={{ position: 'fixed', left: pos.left, minWidth: pos.width, maxHeight: pos.maxH, ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }) }}>
          <input className="pselsrch" placeholder="Ara…" value={search} autoFocus onChange={(e) => setSearch(e.target.value)} onMouseDown={(e) => e.stopPropagation()} />
          {filtered.map((o) => (
            <div key={o.value} className={`pselopt${String(o.value) === String(value) ? ' sel' : ''}`} onMouseDown={(e) => { e.preventDefault(); onChange(o.value); setOpen(false); }}>{o.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}
function periodOptions(): { v: string; l: string }[] {
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const out: { v: string; l: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 24; i++) {
    const y = d.getFullYear();
    const m = d.getMonth();
    out.push({ v: `${y}-${String(m + 1).padStart(2, '0')}`, l: `${aylar[m]} ${y}` });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
/**
 * Belgeyi EKRANDA (modal) açar — ayrı sekme/tarayıcı açmaz.
 * Uç ya `url` (presigned/data-uri pdf/resim) ya da `inlineHtml`
 * (e-arşiv/e-fatura HTML/XML render) döner. Sonucu 'fm-view-doc' olayıyla
 * DocModal'a iletir; modal iframe içinde tam ekrana yakın gösterir.
 */
async function openDocFile(id: string) {
  try {
    const r = await api.get(`/fatura-muhasebelestirme/documents/${id}/file-url`);
    const d: any = r.data || {};
    const url = typeof d.url === 'string' ? d.url : typeof d.fileUrl === 'string' ? d.fileUrl : '';
    const html = typeof d.inlineHtml === 'string' ? d.inlineHtml : '';
    if (!url && !html) { toast.error('Belge dosyası bulunamadı'); return; }
    window.dispatchEvent(new CustomEvent('fm-view-doc', { detail: { url, html, mime: String(d.mimeType || '') } }));
  } catch {
    toast.error('Belge açılamadı');
  }
}

/** Belge görüntüleme modalı — belge ekrana sığdırılır (boşluksuz) + yaklaştır/uzaklaştır. */
function DocModal() {
  const [doc, setDoc] = useState<{ url?: string; html?: string; mime?: string } | null>(null);
  const [scale, setScale] = useState(1);
  const [blobUrl, setBlobUrl] = useState('');
  const [dim, setDim] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const viewRef = useRef<HTMLDivElement>(null);
  const fittedRef = useRef(false);
  // Klavye kısayolu, modalın açık olup olmadığını güncel görsün diye ref (efekt tek kez bağlanır).
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    const onView = (e: any) => { setDoc(e.detail || null); setScale(1); setDim({ w: 0, h: 0 }); fittedRef.current = false; };
    const onKey = (e: globalThis.KeyboardEvent) => {
      // Modal KAPALIYKEN veya bir input/textarea/contenteditable odaktayken kısayolları yok say.
      if (!docRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === 'Escape') setDoc(null);
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(4, +(s + 0.2).toFixed(2)));
      if (e.key === '-' || e.key === '_') setScale((s) => Math.max(0.3, +(s - 0.2).toFixed(2)));
    };
    window.addEventListener('fm-view-doc', onView as any);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('fm-view-doc', onView as any); window.removeEventListener('keydown', onKey); };
  }, []);

  const rawUrl = doc?.url || '';
  const isImgMime = (doc?.mime || '').startsWith('image/') || /^data:image\//i.test(rawUrl) ||
    /\.(jpe?g|jpe|jfif|png|gif|webp|bmp|tiff?|heic|heif|avif)(\?|#|$)/i.test(rawUrl);

  // data: URL'i blob URL'e çevir → iframe same-origin olur (içeriği ÖLÇEBİLİRİZ) ve gömülü XSLT render olur
  useEffect(() => {
    setBlobUrl('');
    if (!rawUrl || isImgMime || doc?.html || !/^data:/i.test(rawUrl)) return;
    let created = '';
    let alive = true;
    fetch(rawUrl).then((r) => r.blob()).then((b) => {
      if (!alive) return;
      created = URL.createObjectURL(b);
      setBlobUrl(created);
    }).catch(() => {});
    return () => { alive = false; if (created) setTimeout(() => URL.revokeObjectURL(created), 500); };
  }, [rawUrl, isImgMime, doc?.html]);

  const fitToWidth = (w: number) => {
    const vw = viewRef.current?.clientWidth || 0;
    // Sığdır: GENİŞ belgeyi (A4 fatura) panoya KÜÇÜLT; DAR belgeyi (fiş/ÖKC) BÜYÜTME —
    // en çok doğal boyut (%100). Eskiden dar fiş genişliğe doldurulup %257 gibi saçma
    // şekilde şişiyordu. Daha büyük istenirse + ile yakınlaştırılır.
    if (w > 0 && vw > 0) setScale(Math.min(1, Math.max(0.3, +((vw - 6) / w).toFixed(3))));
  };
  const onFrameLoad = (e: any) => {
    if (fittedRef.current) return;
    try {
      const cd = e.currentTarget.contentDocument;
      if (!cd || !cd.body) return; // cross-origin (ham data: URL) — blob gelince ölçeriz
      // İÇERİĞİN gerçek genişliği: body iframe enini verir; faturanın asıl genişliği
      // en geniş çocuk öğededir (tablo/kapsayıcı). Onu ölçüp ekrana sığdırıyoruz.
      let w = 0;
      for (const ch of Array.from(cd.body.children) as any[]) {
        w = Math.max(w, ch.scrollWidth || 0, ch.offsetWidth || 0, ch.getBoundingClientRect?.().width || 0);
      }
      if (!w) w = cd.body.scrollWidth || 0;
      const h = Math.max(cd.body.scrollHeight || 0, cd.documentElement?.scrollHeight || 0);
      if (w > 0) { fittedRef.current = true; setDim({ w: Math.ceil(w), h: Math.ceil(h) }); fitToWidth(w); }
    } catch { /* cross-origin — atla */ }
  };
  const onImgLoad = (e: any) => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    const w = e.currentTarget.naturalWidth || 0;
    const h = e.currentTarget.naturalHeight || 0;
    // Resimde de gerçek boyutu sakla → "Sığdır" butonu (fit) resimde de çalışsın.
    if (w > 0) setDim({ w: Math.ceil(w), h: Math.ceil(h) });
    fitToWidth(w);
  };

  if (!doc) return null;
  const isImg = !doc.html && isImgMime;
  const frameSrc = blobUrl || rawUrl;
  const zoomStyle: any = { zoom: scale };
  const sizeStyle: any = dim.w ? { width: dim.w, height: dim.h || undefined, maxWidth: 'none', margin: '0 auto' } : {};
  const dec = () => setScale((s) => Math.max(0.3, +(s - 0.2).toFixed(2)));
  const inc = () => setScale((s) => Math.min(4, +(s + 0.2).toFixed(2)));
  const fit = () => { if (dim.w) fitToWidth(dim.w); else setScale(1); };

  return (
    <div className="docov" onClick={() => setDoc(null)}>
      <div className="docbox" onClick={(e) => e.stopPropagation()}>
        <div className="docbar">
          <b>Belge görüntüle</b>
          <div className="sp" />
          <div className="zoomctl">
            <button className="zbtn" onClick={dec} title="Uzaklaştır (−)">−</button>
            <span className="zval">{Math.round(scale * 100)}%</span>
            <button className="zbtn" onClick={inc} title="Yaklaştır (+)">+</button>
            <button className="zbtn zreset" onClick={fit} title="Sığdır">Sığdır</button>
          </div>
          {rawUrl ? <a className="btn sm ghost" href={frameSrc} target="_blank" rel="noopener noreferrer">Yeni sekmede aç</a> : null}
          <button className="btn sm" onClick={() => setDoc(null)}>Kapat ✕</button>
        </div>
        <div className="docview" ref={viewRef}>
          {doc.html
            ? <iframe className="docframe" style={{ ...zoomStyle, ...sizeStyle }} srcDoc={doc.html} title="Belge" onLoad={onFrameLoad} />
            : isImg
              ? <img className="docimg" style={{ ...zoomStyle, ...sizeStyle }} src={rawUrl} alt="Belge" onLoad={onImgLoad} />
              : frameSrc
                ? <iframe className="docframe" style={{ ...zoomStyle, ...sizeStyle }} src={frameSrc} title="Belge" onLoad={onFrameLoad} />
                : <div className="empty">Belge yok</div>}
        </div>
      </div>
    </div>
  );
}

/** Listede KDV Hariç (matrah) + KDV — önce fiş satırlarından, yoksa ocrData'dan. */
function kdvParts(d: any): { matrah: number | null; kdv: number | null } {
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const sale = (d.invoiceKind || 'ALIS') === 'SATIS';
  let matrah = 0, kdv = 0, has = false;
  for (const l of lines) {
    const amt = Number(sale ? l.credit : l.debit) || 0;
    if (l.group === 'matrah') { matrah += amt; has = true; }
    else if (l.group === 'vergi' || l.group === 'vergi-sorumlu') { kdv += amt; has = true; }
  }
  if (has) return { matrah, kdv };
  const om = d.ocrData?.matrah, ok = d.ocrData?.kdvTutari;
  const m = om != null ? Number(om) : null;
  const k = ok != null ? Number(ok) : null;
  if (m != null || k != null) return { matrah: m, kdv: k };
  // Son çare: OCR KDV kırılımı (kdvBreakdown) varsa topla
  const bd = Array.isArray(d.ocrData?.kdvBreakdown) ? d.ocrData.kdvBreakdown : [];
  let mb = 0, kb = 0;
  for (const b of bd) { kb += Number(b?.tutar ?? b?.amount ?? 0) || 0; mb += Number(b?.matrah ?? b?.base ?? 0) || 0; }
  if (kb || mb) {
    const tot = Number(d.totalAmount || 0);
    return { matrah: mb || (tot ? Math.max(tot - kb, 0) : null), kdv: kb || null };
  }
  return { matrah: null, kdv: null };
}

function accountCodeOnly(value: any): string {
  const raw = String(value || '').trim();
  if (!raw || /^[-—–\s]*(yok|eksik)?[-—–\s]*$/i.test(raw)) return '';
  const m = raw.match(/^([0-9]{1,3}(?:[.\-][\p{L}\p{N}]+)*)/u);
  const code = (m?.[1] || raw.split(/\s+[—–-]\s+|=/)[0]).trim();
  // HESAP ADI BULAŞMASI (kullanıcı bulgusu: "740.01.002-ARAÇ", "770.01.005-MUTFAK"): rakam
  //   içermeyen kuyruk segmentleri hesap ADIdır, at. Türkçe karakterli GERÇEK cari segmentleri
  //   (120.01.İ027 — rakam içerir) korunur.
  const parts = code.split(/([.\-])/);
  let out = parts[0] || '';
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const seg = parts[i + 1] || '';
    if (!/\d/.test(seg)) break;
    out += parts[i] + seg;
  }
  return out;
}

// Fiş satırı hesap kodu KAYNAK rozeti — kod nereden geldi? (fiş editöründe kodun yanında küçük pill)
const KAYNAK_ROZET: Record<string, { t: string; bg: string; fg: string }> = {
  KULLANICI: { t: 'Siz seçtiniz', bg: '#e7f6ec', fg: '#15803d' },
  HAFIZA: { t: 'Öğrenilmiş', bg: '#eaf1ff', fg: '#2563eb' },
  VKN: { t: 'VKN eşleşmesi', bg: '#e7f6ec', fg: '#15803d' },
  AI: { t: 'AI tahmini', bg: '#fdf2e0', fg: '#b45309' },
  KURAL: { t: 'Kural', bg: '#eef1f5', fg: '#64748b' },
  ISIM: { t: 'İsim eşleşmesi', bg: '#eef1f5', fg: '#64748b' },
  VARSAYILAN: { t: 'Varsayılan', bg: '#eef1f5', fg: '#64748b' },
};
function KaynakRozet({ kaynak }: { kaynak?: string | null }) {
  const r = kaynak ? KAYNAK_ROZET[String(kaynak)] : null;
  if (!r) return null;
  // Sadeleştirme (2026-08-11): her satırdaki renkli DOLGULU rozet "muhasebe kodu alanını" görsel olarak
  //   kalabalıklaştırıyordu. Artık dolgu YOK — küçük renk NOKTASI + sakin renkli metin; bilgi metinde+tooltip'te.
  return (
    <span title={`Hesap kodu kaynağı: ${r.t}`} style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, lineHeight: 1.2, color: r.fg, whiteSpace: 'nowrap', letterSpacing: '.2px' }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: r.fg, flex: '0 0 auto' }} />{r.t}
    </span>
  );
}

function isletmeRowReady(kind: 'ALIS' | 'SATIS', row: any): boolean {
  const kt = String(row?.kayitTuruKod || '').trim();
  if (!kt) return false;
  const altList = getKayitAltList(kind, kt);
  return !altList.length || !!String(row?.kayitAltKod || '').trim();
}

function isletmeDocReady(d: any): { ok: boolean; hasAmount: boolean; reason: string } {
  const p = kdvParts(d);
  const hasAmount = (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || Number(d?.totalAmount) > 0;
  if (!hasAmount) return { ok: false, hasAmount, reason: 'Tutar okunamadı' };
  const kind: 'ALIS' | 'SATIS' = String(d?.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
  const isl = d?.ocrData?.isletme || {};
  const normalizedType = normalizeDocumentType(d?.documentType || d?.ocrData?.belgeTuru || d?.ocrData?.documentType);
  const belgeTuruKod = String(isl.belgeTuruKod || (normalizedType ? defaultBelgeTuruKod(normalizedType, kind) : '')).trim();
  if (!belgeTuruKod) return { ok: false, hasAmount, reason: 'Belge türü yok' };
  const rawRows = Array.isArray(isl.satirlar) && isl.satirlar.length ? isl.satirlar : [isl];
  const rows = rawRows.filter((r: any) =>
    !Array.isArray(isl.satirlar) ||
    Number(r?.matrah || 0) > 0 ||
    Number(r?.kdvTutar || 0) > 0 ||
    Number(r?.krediliTutar || 0) > 0,
  );
  if (!rows.length) return { ok: false, hasAmount, reason: 'Kayıt satırı yok' };
  if (!rows.every((r: any) => isletmeRowReady(kind, r))) return { ok: false, hasAmount, reason: 'Kayıt türü eksik' };
  return { ok: true, hasAmount, reason: '' };
}

const TITLES: Record<string, string> = {
  faturalar: 'Belgeler · <b>Bekleyen Alış Faturaları</b>',
  satis: 'Belgeler · <b>Bekleyen Satış Faturaları</b>',
  kurallar: 'Kurulum · <b>Eşleştirme Kuralları</b>',
  muhasebe: 'Belgeler · <b>Muhasebeleştir &amp; Aktar</b>',
  aktarilanlar: 'Belgeler · <b>Aktarım</b>',
  arsiv: 'Belgeler · <b>Arşivim</b>',
  entegrator: 'Kurulum · <b>Entegratörler</b>',
  kdv: 'Kurulum · <b>KDV Raporu</b>',
  ayarlar: 'Kurulum · <b>Hesap Planı</b>',
  mukellefler: 'Çalışma · <b>Mükellefler</b>',
  earsivSorgu: 'Belgeler · <b>GIB e-Arşiv Sorgu</b>',
  efaturaSorgu: 'Belgeler · <b>e-Fatura Sorgu</b>',
  genel: '<b>Genel Bakış</b>',
};

/** Kontrollü onay kutusu */
function Check({ checked, onToggle, disabled, title }: { checked?: boolean; onToggle?: () => void; disabled?: boolean; title?: string }) {
  const toggle = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    if (!disabled) onToggle?.();
  };
  return (
    <span
      className={`cb${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`}
      title={title}
      role="checkbox"
      aria-checked={!!checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(e);
        }
      }}
    >
      {checked ? <Ico html={I.checkSm} size={11} /> : null}
    </span>
  );
}

/** Belge listesi ortak sorgusu — aynı queryKey ekranlar arası cache paylaşır */
function useDocuments(taxpayerId: string, period: string) {
  return useQuery({
    queryKey: ['fm2', 'documents', taxpayerId, period],
    // Hatayı YUTMA — react-query isError versin ki "Yüklenemedi, tekrar dene" gösterelim
    // (eskiden catch([]) ile ağ hatası "veri yok" gibi görünüyordu).
    queryFn: async () => {
      const r = await api.get('/fatura-muhasebelestirme/documents', {
        params: { taxpayerId: taxpayerId || undefined, period, limit: 300 },
      });
      return Array.isArray(r.data) ? r.data : [];
    },
  });
}

// Profesyonel özel dropdown (native <select>'in OS-render açılır listesi yerine) — Mükellef/Dönem seçici.
function FmSelect({ value, onChange, options, icon, search = false, searchPlaceholder = 'Ara…', emptyLabel = '—', minWidth = 150 }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ v: string; l: string }>;
  icon?: JSX.Element;
  search?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e: any) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const cur = options.find((o) => o.v === value);
  const nq = q.trim().toLocaleLowerCase('tr-TR');
  const filtered = search && nq ? options.filter((o) => o.l.toLocaleLowerCase('tr-TR').includes(nq)) : options;
  return (
    <div className={`fmdd${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="fmdd-btn" style={{ minWidth }} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span className="fmdd-val">{cur ? cur.l : emptyLabel}</span>
        <svg className="fmdd-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="fmdd-pop">
          {search && (
            <div className="fmdd-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
            </div>
          )}
          <div className="fmdd-list">
            {filtered.map((o) => (
              <button type="button" key={o.v || '__all'} className={`fmdd-opt${o.v === value ? ' on' : ''}`} onClick={() => { onChange(o.v); setOpen(false); setQ(''); }}>
                <span className="fmdd-optl">{o.l}</span>
                {o.v === value && <svg className="fmdd-ok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>}
              </button>
            ))}
            {filtered.length === 0 && <div className="fmdd-empty">Sonuç yok</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Takvim tarzı dönem seçici — yıl gezinme + 3×4 ay kutusu (uzun liste yerine).
const AYLAR_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
function FmPeriod({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = periodOptions();
  const avail = new Set(opts.map((o) => o.v));
  const years = [...new Set(opts.map((o) => Number(o.v.slice(0, 4))))].sort((a, b) => a - b);
  const minY = years[0], maxY = years[years.length - 1];
  const cur = value || opts[0].v;
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(Number(cur.slice(0, 4)));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setViewY(Number((value || opts[0].v).slice(0, 4))); }, [open]); // eslint-disable-line
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e: any) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const label = opts.find((o) => o.v === value)?.l || value;
  return (
    <div className={`fmdd fmper${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="fmdd-btn" style={{ minWidth: 150 }} onClick={() => setOpen((o) => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        <span className="fmdd-val">{label}</span>
        <svg className="fmdd-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="fmdd-pop fmper-pop">
          <div className="fmper-head">
            <button type="button" className="fmper-nav" disabled={viewY <= minY} onClick={() => setViewY((y) => Math.max(minY, y - 1))} aria-label="Önceki yıl">‹</button>
            <span className="fmper-y">{viewY}</span>
            <button type="button" className="fmper-nav" disabled={viewY >= maxY} onClick={() => setViewY((y) => Math.min(maxY, y + 1))} aria-label="Sonraki yıl">›</button>
          </div>
          <div className="fmper-grid">
            {AYLAR_KISA.map((ad, i) => {
              const v = `${viewY}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button type="button" key={v} className={`fmper-m${v === value ? ' sel' : ''}`} disabled={!avail.has(v)} onClick={() => { onChange(v); setOpen(false); }}>{ad}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FaturaMerkeziPage() {
  const [screen, setScreen] = useState('genel');
  const accent = 'petrol';
  const [taxpayerId, setTaxpayerId] = useState('');
  const nowP = new Date();
  const [period, setPeriod] = useState(`${nowP.getFullYear()}-${String(nowP.getMonth() + 1).padStart(2, '0')}`);
  // Belge işleme tam ekran — sol menü gizlenir, ekran tamamen editöre kalır.
  const [editorFull, setEditorFull] = useState(false);
  useEffect(() => { if (screen !== 'muhasebe') setEditorFull(false); }, [screen]);

  // Seçimi (mükellef + dönem + ekran) KALICI yap — sayfa yenilenince kaybolmasın.
  useEffect(() => {
    try {
      const t = localStorage.getItem('fm-taxpayerId'); if (t) setTaxpayerId(t);
      const p = localStorage.getItem('fm-period'); if (p) setPeriod(p);
      const s = localStorage.getItem('fm-screen'); if (s) setScreen(s === 'sorgu' ? 'earsivSorgu' : s);
    } catch { /* localStorage yoksa atla */ }
  }, []);
  useEffect(() => { try { localStorage.setItem('fm-taxpayerId', taxpayerId); } catch {} }, [taxpayerId]);
  useEffect(() => { try { localStorage.setItem('fm-period', period); } catch {} }, [period]);
  useEffect(() => { try { localStorage.setItem('fm-screen', screen); } catch {} }, [screen]);

  const taxpayersQ = useQuery({
    queryKey: ['fm2', 'taxpayers'],
    queryFn: () =>
      api
        .get('/taxpayers', { params: { scope: 'directory', status: 'active' } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
  });
  const taxpayers: any[] = taxpayersQ.data || [];
  // localStorage'dan gelen mükellef id'si listede YOKSA (silinmiş/pasif) temizle — yoksa etiket
  //   "Tüm mükellefler" görünür ama sorgular ölü id ile filtrelenir → her ekran boş kalır.
  //   Liste boşken dokunma (geçici yükleme/hata durumunda seçimi kaybetme).
  useEffect(() => {
    if (!taxpayerId || !Array.isArray(taxpayersQ.data) || taxpayersQ.data.length === 0) return;
    if (!taxpayersQ.data.some((t: any) => String(t.id) === String(taxpayerId))) setTaxpayerId('');
  }, [taxpayerId, taxpayersQ.data]);

  // Menü rozetleri için canlı özet (mükellef + dönem)
  const summaryQ = useQuery({
    queryKey: ['fm2', 'summary', taxpayerId, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/summary', { params: { taxpayerId: taxpayerId || undefined, period } })
        .then((r) => r.data || {})
        .catch(() => ({})),
  });
  const sum: any = summaryQ.data || {};
  const badge = (n: any) => (Number(n) > 0 ? <span className="ct">{Number(n)}</span> : null);

  const go = (s: string) => setScreen(s);

  const nav = (
    <nav className="nav">
      <div className="ncap">Çalışma</div>
      <div className={`nitem${screen === 'genel' ? ' on' : ''}`} style={{ ['--icc' as any]: '#7c3aed' }} onClick={() => go('genel')}><Ico html={I.chart} /> Genel Bakış</div>
      <div className={`nitem${screen === 'mukellefler' ? ' on' : ''}`} style={{ ['--icc' as any]: '#2563eb' }} onClick={() => go('mukellefler')}><Ico html={I.users} /> Mükellefler</div>

      <div className="ncap">Belgeler</div>
      <div className={`nitem${screen === 'earsivSorgu' ? ' on' : ''}`} style={{ ['--icc' as any]: '#0f766e' }} onClick={() => go('earsivSorgu')}><Ico html={I.file} /> GIB e-Arşiv Sorgu</div>
      <div className={`nitem${screen === 'efaturaSorgu' ? ' on' : ''}`} style={{ ['--icc' as any]: '#2563eb' }} onClick={() => go('efaturaSorgu')}><Ico html={I.plug} /> e-Fatura Sorgu</div>
      <div className={`nitem${screen === 'faturalar' || screen === 'satis' ? ' on' : ''}`} style={{ ['--icc' as any]: '#15803d' }} onClick={() => go('faturalar')}><Ico html={I.file} /> Gelen Faturalar</div>
      <div className={`nsub${screen === 'faturalar' ? ' on' : ''}`} onClick={() => go('faturalar')}><span className="d" /> Alış Faturaları {badge(sum.alisPending)}</div>
      <div className={`nsub${screen === 'satis' ? ' on' : ''}`} onClick={() => go('satis')}><span className="d" /> Satış Faturaları {badge(sum.satisPending)}</div>
      <div className={`nitem${screen === 'muhasebe' ? ' on' : ''}`} style={{ ['--icc' as any]: '#7c3aed' }} onClick={() => go('muhasebe')}><Ico html={I.ledger} /> Muhasebeleştir {badge(sum.pending)}</div>
      <div className={`nitem${screen === 'aktarilanlar' ? ' on' : ''}`} style={{ ['--icc' as any]: '#0891b2' }} onClick={() => go('aktarilanlar')}><Ico html={I.check} /> Aktarım {badge(Math.max(0, (Number(sum.approved) || 0) - (Number(sum.posted) || 0)))}</div>
      <div className={`nitem${screen === 'arsiv' ? ' on' : ''}`} style={{ ['--icc' as any]: '#d97706' }} onClick={() => go('arsiv')}><Ico html={I.ledger} /> Arşivim {badge(sum.posted)}</div>

      <div className="ncap">Kurulum</div>
      <div className={`nitem${screen === 'kurallar' ? ' on' : ''}`} style={{ ['--icc' as any]: '#475569' }} onClick={() => go('kurallar')}><Ico html={I.rules} /> Eşleştirme Kuralları</div>
      <div className={`nitem${screen === 'entegrator' ? ' on' : ''}`} style={{ ['--icc' as any]: '#0d9488' }} onClick={() => go('entegrator')}><Ico html={I.plug} /> Entegratörler</div>
      <div className={`nitem${screen === 'kdv' ? ' on' : ''}`} style={{ ['--icc' as any]: '#be123c' }} onClick={() => go('kdv')}><Ico html={I.chart} /> KDV Raporu</div>
      <div className={`nitem${screen === 'ayarlar' ? ' on' : ''}`} style={{ ['--icc' as any]: '#15803d' }} onClick={() => go('ayarlar')}><Ico html={I.ledger} /> Hesap Planı</div>
    </nav>
  );

  return (
    <div id="fm-root" data-accent={accent}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <DocModal />
      <div className={`app screen-${screen}${editorFull ? ' editorfull' : ''}`}>
        <aside className="side">
          <div className="brand">
            <a className="backlink" href="/panel" title="Portala Dön" aria-label="Portala Dön">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            </a>
            <div className="brandrow">
              <div className="brandtx" role="button" title="Ana sayfa — Genel Bakış" onClick={() => go('genel')} style={{ cursor: 'pointer' }}>
                <div className="brandlogo">Moren</div>
                <div className="brandmod">Fatura Merkezi</div>
              </div>
            </div>
          </div>
          {nav}
        </aside>

        <div className="main">
          <div className="top">
            <div className="crumb" dangerouslySetInnerHTML={{ __html: TITLES[screen] || '' }} />
            <div className="sp" />
            <div className="ctxbar">
              <div className="ctxpick">
                <span className="ctxpick-l">Mükellef</span>
                <FmSelect
                  value={taxpayerId}
                  onChange={setTaxpayerId}
                  options={[{ v: '', l: 'Tüm mükellefler' }, ...taxpayers.map((t) => ({ v: t.id, l: taxpayerLabel(t) }))]}
                  search
                  searchPlaceholder="Mükellef ara…"
                  emptyLabel="Tüm mükellefler"
                  minWidth={210}
                  icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
                />
              </div>
              <div className="ctxpick">
                <span className="ctxpick-l">Dönem</span>
                <FmPeriod value={period} onChange={setPeriod} />
              </div>
            </div>
          </div>

          <div className="content">
            {(screen === 'faturalar' || screen === 'satis') && <ScreenFaturalar taxpayerId={taxpayerId} period={period} kind={screen === 'satis' ? 'SATIS' : 'ALIS'} isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} taxpayerNace={(taxpayers.find((t) => t.id === taxpayerId) as any)?.naceKodu || ''} taxpayerFaaliyet={(taxpayers.find((t) => t.id === taxpayerId) as any)?.faaliyetAciklama || ''} onOpenSorgu={() => setScreen(screen === 'satis' ? 'earsivSorgu' : 'efaturaSorgu')} onOpenMuhasebe={(id) => { try { localStorage.setItem('fm-open-doc', id); } catch { /* yok say */ } setScreen('muhasebe'); }} />}
            {screen === 'earsivSorgu' && <ScreenSorgu taxpayerId={taxpayerId} period={period} source="earsiv" />}
            {screen === 'efaturaSorgu' && <ScreenSorgu taxpayerId={taxpayerId} period={period} source="efatura" />}
            {screen === 'mukellefler' && <ScreenMukellefler taxpayers={taxpayers} period={period} onOpen={(id) => { setTaxpayerId(id); setScreen('faturalar'); }} />}
            {screen === 'kurallar' && <ScreenKurallar taxpayerId={taxpayerId} period={period} />}
            {screen === 'muhasebe' && <ScreenMuhasebe taxpayerId={taxpayerId} period={period} isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} taxpayerNace={(taxpayers.find((t) => t.id === taxpayerId) as any)?.naceKodu || ''} taxpayerFaaliyet={(taxpayers.find((t) => t.id === taxpayerId) as any)?.faaliyetAciklama || ''} taxpayerAd={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return t ? taxpayerLabel(t) : ''; })()} full={editorFull} onToggleFull={() => setEditorFull((v) => !v)} />}
            {screen === 'aktarilanlar' && <ScreenAktarilanlar taxpayerId={taxpayerId} period={period} mode="bekleyen" isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} />}
            {screen === 'arsiv' && <ScreenAktarilanlar taxpayerId={taxpayerId} period={period} mode="arsiv" isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} />}
            {screen === 'entegrator' && <ScreenEntegrator taxpayerId={taxpayerId} period={period} />}
            {screen === 'kdv' && <ScreenKdv taxpayerId={taxpayerId} period={period} />}
            {screen === 'ayarlar' && <ScreenAyarlar taxpayerId={taxpayerId} />}
            {screen === 'genel' && <ScreenGenel taxpayers={taxpayers} period={period} onOpen={(id) => { setTaxpayerId(id); setScreen('faturalar'); }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================== EKRAN: ALIŞ / SATIŞ FATURALARI ===================== */
// İşlenmiş belge pipeline'ı İKİ alt-kümeye ayrılır:
//   isArchived         = Luca'ya AKTARILMIŞ (POSTED) → "Arşivim" modülü
//   isWaitingTransfer  = işlenmiş ama henüz aktarılmamış (onaylı/hazır/hata) → "Aktarım" modülü
// "Gelen Faturalar" (gelen kutusu) = ikisinin de DIŞI (isInAktarim'in TERSİ). Üç ekran çakışmaz.
function isArchived(d: any): boolean {
  return d?.lucaStatus === 'POSTED';
}
function isWaitingTransfer(d: any): boolean {
  return !isArchived(d) && (d?.status === 'APPROVED' || ['QUEUED', 'POSTING', 'FAILED'].includes(d?.lucaStatus));
}
function isInAktarim(d: any): boolean {
  return isWaitingTransfer(d) || isArchived(d);
}
function ScreenFaturalar({ taxpayerId, period, kind = 'ALIS', isIsletme = false, taxpayerNace = '', taxpayerFaaliyet = '', onOpenSorgu, onOpenMuhasebe }: { taxpayerId: string; period: string; kind?: 'ALIS' | 'SATIS'; isIsletme?: boolean; taxpayerNace?: string; taxpayerFaaliyet?: string; onOpenSorgu?: () => void; onOpenMuhasebe?: (id: string) => void }) {
  const qc = useQueryClient();
  const docsQ = useDocuments(taxpayerId, period);
  const all: any[] = docsQ.data || [];
  // OTO-EŞLEŞME KARNESİ (iyileştirme #4): otomatik oran + en çok "bakılmalı" çıkan cariler.
  const [karneAcik, setKarneAcik] = useState(false);
  const karneQ = useQuery({
    queryKey: ['fm2', 'karne', taxpayerId, period],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/eslesme-karnesi', { params: { taxpayerId, period } })).data,
    enabled: !!taxpayerId,
  });
  const karne: any = karneQ.data || null;
  // Gelen kutusu: yalnız HENÜZ İŞLENMEMİŞ gelen belgeler. Onaylanan/aktarıma alınan/aktarılan
  //   belgeler buradan çıkar (Aktarım arşivinde görünür) — kullanıcı talebi.
  // useMemo: docsAll/docs referansı her render'da yenilenmesin → justDone/richNotes efektleri
  //   (bağımlılığı docs) gereksiz yere her render koşmaz.
  const docsAll = useMemo(
    () => all.filter((d) => (d.invoiceKind || 'ALIS') === kind && !isInAktarim(d)),
    [all, kind],
  );
  // İşletme sınıfı = AI'ın fatura OKUMA anında faaliyet+içerikle verdiği karar (ocrData.isletme).
  //   Kaydedilmiş satır varsa o; yoksa AI'ın sınıfı. AI sınıf vermediyse ok:false → "Eşleşmedi" + boş.
  const islSinif = (d: any): { ktAd: string; altAd: string; ok: boolean } => {
    if (!isIsletme) return { ktAd: '', altAd: '', ok: false };
    const isl = d.ocrData?.isletme;
    const ktKod = isl?.satirlar?.[0]?.kayitTuruKod || isl?.kayitTuruKod;
    if (ktKod) {
      let altAd = isl?.satirlar?.[0]?.kayitAltAd || isl?.kayitAltAd || '';
      if (String(ktKod) === '4') {
        const kindd = String(d.invoiceKind || 'ALIS').toUpperCase() === 'SATIS' ? 'SATIS' : 'ALIS';
        const kalemler = Array.isArray(d.ocrData?.kalemler) ? d.ocrData.kalemler : [];
        // ÇOK ORANLI fatura (%1 gıda + %20 temizlik gibi): tek tür tüm faturayı temsil edemez →
        //   EN BÜYÜK matrahlı KDV oranı grubunun içeriğine göre temsili alt tür göster (AI'ın tek
        //   yanlış türünü ezer; satır bazlı doğru tür Muhasebeleştir'de görünür).
        const gruplar: Record<string, { tutar: number; ad: string[] }> = {};
        for (const k of kalemler) { const o = String(Math.round(Number(k?.oran) || 0)); (gruplar[o] = gruplar[o] || { tutar: 0, ad: [] }); gruplar[o].tutar += Number(k?.tutar) || 0; gruplar[o].ad.push(String(k?.ad || '')); }
        const oranlar = Object.keys(gruplar);
        if (oranlar.length > 1) {
          const enBuyuk = oranlar.sort((a, b) => gruplar[b].tutar - gruplar[a].tutar)[0];
          const altKod = isletmeAutoKayitAltKod(kindd, '4', gruplar[enBuyuk].ad.join(' '));
          if (altKod) altAd = getKayitAltList(kindd, '4').find((x: any) => x.kod === altKod)?.ad || altAd;
        }
        // Hâlâ boşsa: belge metninden içerik türet (gösterim için).
        if (!altAd) {
          const islText = [d.ocrData?.giderTuru, d.ocrData?.muhasebeNeden, d.vendorName, d.customerName].filter(Boolean).join(' ');
          const altKod = islText ? isletmeAutoKayitAltKod(kindd, '4', islText) : '';
          if (altKod) altAd = getKayitAltList(kindd, '4').find((x: any) => x.kod === altKod)?.ad || '';
        }
      }
      return {
        ktAd: isl?.satirlar?.[0]?.kayitTuruAd || isl?.kayitTuruAd || '',
        altAd,
        ok: true,
      };
    }
    return { ktAd: '', altAd: '', ok: false };
  };
  const dd = (d: any) => deriveDurum(d, isIsletme, '');
  // Durum filtresi (Hepsi / Eşleşti / İncele / Kod eksik / Çelişki / …)
  const [durumF, setDurumF] = useState('all');
  const durumCount = (cat: string) => cat === 'all' ? docsAll.length : docsAll.filter((d) => dd(d).cat === cat).length;
  const docs = useMemo(
    () => {
      const base = durumF === 'all' ? docsAll : docsAll.filter((d) => deriveDurum(d, isIsletme, '').cat === durumF);
      // TARİH SIRASI (kullanıcı isteği: liste karışık gelmesin) — kronolojik eskiden yeniye,
      //   eşit tarihte belge no'ya göre. Alış ve Satış listelerinin ikisinde de geçerli.
      const dnum = (d: any) => { const s = String(d.faturaTarihi || d.createdAt || '').slice(0, 10); return s ? Number(s.replace(/-/g, '')) || 0 : 0; };
      return [...base].sort((a, b) => dnum(a) - dnum(b) || String(a.belgeNo || '').localeCompare(String(b.belgeNo || ''), 'tr'));
    },
    [docsAll, durumF, isIsletme],
  );
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Mükellef/dönem/sekme değişince ESKİ seçim ve durum filtresi taşınmasın — yoksa "AI ile oku"
  //   önceki ekranda seçilmiş (artık görünmeyen) belgeleri de okuturdu.
  useEffect(() => { setSel(new Set()); setDurumF('all'); }, [taxpayerId, period, kind]);
  const toggle = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const allSelected = docs.length > 0 && docs.every((d) => sel.has(d.id));
  const toggleAll = () =>
    setSel(() => (allSelected ? new Set() : new Set(docs.map((d) => d.id))));

  const sayac = { ok: 0, miss: 0, warn: 0 };
  docsAll.forEach((d) => {
    const k = dd(d).k;
    if (k === 'miss') sayac.miss++;
    else if (k === 'warn') sayac.warn++;
    else sayac.ok++;
  });

  // Geçici köprü: Mihsap "bekleyen evraklar"daki faturaları portala aktarır
  // (entegratör çekme tamamlanana kadar Mihsap'ı fatura kaynağı olarak kullanırız).
  // Manuel belge yükleme (JPEG/PDF/XML/ZIP) — OCR arka planda işler
  const fileRef = useRef<HTMLInputElement>(null);
  // Yükleme yönü: "Belge Yükle"ye basınca Gelir(Satış)/Gider(Alış) seçilir, dosya seçici ona göre açılır.
  //   Yön artık aktif sekmeye değil kullanıcı seçimine bağlı (ref → mutate sırasında okunur).
  const uploadDirRef = useRef<'ALIS' | 'SATIS'>(kind);
  const [uploadPick, setUploadPick] = useState(false);
  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f, f.name || 'belge'));
      fd.append('taxpayerId', taxpayerId);
      fd.append('source', 'fatura-merkezi');
      fd.append('documentType', uploadDirRef.current === 'SATIS' ? 'SATIS_FATURA' : 'ALIS_FATURA');
      fd.append('invoiceKind', uploadDirRef.current);
      fd.append('period', period);
      return api.post('/fatura-muhasebelestirme/documents/upload', fd);
    },
    onSuccess: (r: any) => {
      const n = Array.isArray(r?.data) ? r.data.length : (r?.data?.uploaded ?? r?.data?.count ?? r?.data?.created ?? null);
      const skipped = Array.isArray(r?.data?.skipped) ? r.data.skipped : [];
      toast.success(`Belge yüklendi${n != null ? ` · ${n}` : ''}. OCR arka planda işleniyor.`);
      if (skipped.length) toast.warning(`${skipped.length} dosya atlandı: ${skipped.slice(0, 3).map((s: any) => s.name || 'isimsiz').join(', ')}${skipped.length > 3 ? '…' : ''}`);
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Yüklenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/fatura-muhasebelestirme/documents/${id}`),
    onSuccess: () => { toast.success('Belge silindi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Silinemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // Hızlı: belgeleri tekrar OKUMADAN hesap kodlarını plana göre yeniden eşleştir (yanlış cari temizlenir).
  const recodeMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/documents/reapply-codes', { taxpayerId }),
    onSuccess: () => { toast.success('Hesap kodları yeniden eşleştirildi — yanlış cariler düzeltildi/temizlendi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: () => toast.error('Yeniden eşleştirme başarısız'),
  });
  // Toplu onay TEK istekte (approve-batch) — belge-başına döngü yok; Katman-2 denetçi kararları
  // sunucuda uygulanır, atlananlar sebep gruplarıyla aşağıdaki panelde gösterilir.
  const [skipInfo, setSkipInfo] = useState<Array<{ id: string; belgeNo?: string; reason: string }> | null>(null);
  const approveMut = useMutation({
    mutationFn: async (p: { ids: string[]; force?: boolean }) => {
      const r = await api.post('/fatura-muhasebelestirme/documents/approve-batch', { ids: p.ids, ...(p.force ? { force: true } : {}) });
      return (r?.data || {}) as { approved: number; skipped: Array<{ id: string; belgeNo?: string; reason: string }> };
    },
    onSuccess: ({ approved, skipped }) => {
      const sk = Array.isArray(skipped) ? skipped : [];
      // Başarısızları YUTMA: "0 belge muhasebeleştirildi" yeşil toast yalan olur.
      if (Number(approved) > 0) toast.success(`${approved} belge muhasebeleştirildi`);
      if (sk.length > 0) toast.warning(`${sk.length} belge onaylanmadı — sebepler listede`, { duration: 7000 });
      setSkipInfo(sk.length > 0 ? sk : null);
      if (Number(approved) > 0) setSel(new Set()); // hepsi atlandıysa seçim kalsın — kullanıcı düzeltip tekrar dener
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Muhasebeleştirme başarısız: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });

  // Matrah/KDV kırılımı çıkmamış belgelere (ör. Mihsap'tan yalnız toplamı gelen satışlar) oranla fiş üret

  // AI ile oku — seçili faturalar SUNUCU kuyruğunda okunur (sayfa değişince DURMAZ).
  // İlerleme aşağıdaki tarama şeridinden izlenir.
  const [aiBusy, setAiBusy] = useState(false);
  const aiOku = async () => {
    // Çifte emniyet: yalnız ŞU AN görünür listedeki seçimler okunur (bayat/başka sekme seçimi gitmesin).
    const visibleIds = new Set(docs.map((d: any) => d.id));
    const ids = [...sel].filter((id) => visibleIds.has(id));
    if (!ids.length) { toast.error('Önce belge seç'); return; }
    setAiBusy(true);
    try {
      const r = await api.post('/fatura-muhasebelestirme/documents/ai-read-batch', { documentIds: ids });
      toast.success(`${r?.data?.queued ?? ids.length} belge okuma sırasına alındı — şeritten izle (sayfa değişse de sürer)`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['fm-ocr-progress'] });
    } catch { toast.error('Okuma başlatılamadı'); }
    finally { setAiBusy(false); }
  };
  // Okumayı DURDUR — bekleyenleri kuyruktan çıkarır + CANCELLED yapar (şerit durur). Aktif okunan belge biter.
  const [aiStop, setAiStop] = useState(false);
  const aiDurdur = async () => {
    setAiStop(true);
    try {
      const r = await api.post('/fatura-muhasebelestirme/documents/ai-read-cancel', { taxpayerId });
      const c = Number(r?.data?.cancelled || 0);
      toast.success(c > 0 ? `Okuma durduruldu — ${c} belge sıradan çıkarıldı` : 'Okuma durduruldu');
      qc.invalidateQueries({ queryKey: ['fm-ocr-progress'] });
      qc.invalidateQueries({ queryKey: ['fm2'] });
    } catch { toast.error('Durdurulamadı'); }
    finally { setAiStop(false); }
  };
  // OCR/okuma ilerlemesi — sunucudan periyodik çekilir (3sn). Sayfaya dönünce mevcut
  // durumu gösterir; okuma sunucuda sürdüğü için kapanmaz.
  const ocrProgQ = useQuery({
    // #11: sayaç KIND'e göre — satış okurken satış adedini, alış okurken alış adedini göstersin (toplam değil).
    queryKey: ['fm-ocr-progress', taxpayerId, period, kind],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/ocr-progress', { params: { taxpayerId, period, kind } })).data,
    enabled: !!taxpayerId,
    // Okuma AKTİFKEN hızlı (3sn); boştayken seyrelt (15sn) → çoklu bilgisayarda gereksiz yük düşer,
    //   başka makinede başlayan okuma yine (15sn içinde) yakalanır. Cache'ten güncel duruma bakılır.
    refetchInterval: () => {
      const d: any = qc.getQueryData(['fm-ocr-progress', taxpayerId, period]);
      return d?.active ? 3000 : 15000;
    },
  });
  const ocrProg: any = ocrProgQ.data;
  // Faz F/6: eksik belge takibi — sadece Alış'ta, düzenli gelip bu dönem gelmeyen satıcılar.
  const missingQ = useQuery({
    queryKey: ['fm-missing', taxpayerId, period, kind],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/missing-suppliers', { params: { taxpayerId, period } })).data,
    enabled: !!taxpayerId && kind === 'ALIS',
  });
  const missing: any[] = missingQ.data?.missing || [];
  // Faz4: eksik belge avcısı — Satış'ta belge-no ardışıklık boşlukları (kesilmemiş/gelmemiş fatura sinyali).
  const gapsQ = useQuery({
    queryKey: ['fm-eksik-no', taxpayerId, period, kind],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/eksik-belgeler', { params: { taxpayerId, period } })).data,
    enabled: !!taxpayerId && kind === 'SATIS',
  });
  const noGaps: any = gapsQ.data;
  // HESAP PLANI durumu — bilanço mükellefinde plan aktarılmamışsa eşleştirme yapılamaz; net uyarı için.
  //   (İşletme defterinde plan olmaz → sorgu çalıştırma.)
  const planSumQ = useQuery({
    queryKey: ['fm-plan-sum', taxpayerId, period],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/summary', { params: { taxpayerId, period } })).data,
    enabled: !!taxpayerId,
  });
  // accountPlanMissing'i backend belirler (İşletme defterinde zaten false döner) → frontend isIsletme
  //   kapısına GÜVENME (frontend/backend İşletme tespiti İ harfi normalizasyonunda ayrışabiliyordu).
  const planMissing = !!planSumQ.data?.accountPlanMissing;
  // Okuma bitince listeyi tazele (yeni veriler insin).
  const prevReadingRef = useRef(0);
  useEffect(() => {
    const r = Number(ocrProg?.reading || 0);
    if (prevReadingRef.current > 0 && r === 0) qc.invalidateQueries({ queryKey: ['fm2'] });
    prevReadingRef.current = r;
  }, [ocrProg?.reading, qc]);
  // Okuma SÜRERKEN listeyi periyodik tazele → "şu an okunan" satır (ocrStatus IN_PROGRESS) canlansın.
  useEffect(() => {
    if (!ocrProg?.active) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ['fm2'] }), 2500);
    return () => clearInterval(t);
  }, [ocrProg?.active, qc]);
  // AI okuma — geçen süre + TAHMİNİ kalan süre (ETA). Aktif başlayınca başlangıç anını + o anki "okundu"
  //   sayısını sakla; hız = (o andan beri okunan / geçen süre) → kalan = sıradaki / hız. Saniyelik tik ile canlı.
  const readStartRef = useRef<{ ms: number; done: number } | null>(null);
  const [, setEtaTick] = useState(0);
  useEffect(() => {
    if (!ocrProg?.active) { readStartRef.current = null; return; }
    if (!readStartRef.current) readStartRef.current = { ms: Date.now(), done: Number(ocrProg?.done || 0) };
    const t = setInterval(() => setEtaTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [ocrProg?.active]);
  // Okuması YENİ BİTEN satıra kısa "tamamlandı" vurgusu (IN_PROGRESS → değil geçişi yakalanır).
  const prevOcrRef = useRef<Record<string, string>>({});
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevOcrRef.current; const cur: Record<string, string> = {}; const bitti: string[] = [];
    for (const d of docs) { cur[d.id] = d.ocrStatus || ''; if (prev[d.id] === 'IN_PROGRESS' && (d.ocrStatus || '') !== 'IN_PROGRESS') bitti.push(d.id); }
    prevOcrRef.current = cur;
    if (!bitti.length) return;
    setJustDone((s) => { const n = new Set(s); bitti.forEach((id) => n.add(id)); return n; });
    const t = setTimeout(() => setJustDone((s) => { const n = new Set(s); bitti.forEach((id) => n.delete(id)); return n; }), 2200);
    return () => clearTimeout(t);
  }, [docs]);
  // Yevmiye fişi / kayıt türü detayı — listede aç-kapa (Muhasebeleştir'e gitmeden NEYLE eşleşti görünür).
  const [fisDetayId, setFisDetayId] = useState('');
  const grpLabel = (g: string) => g === 'matrah' ? 'Matrah' : g === 'vergi' ? 'KDV' : g === 'vergi-sorumlu' ? 'Sorumlu Sıf. KDV' : g === 'cari' ? 'Cari' : g === 'tevkifat' ? 'Tevkifat' : (g || '—');
  // ZENGİN AI YORUMU — belge detayı (defter ikonu) açılınca lazy üret. Belgede ocrData.muhasebeNedenZengin
  //   yoksa tek-belge çağrısı yapılır (eşleştirme SONRASI; yön+hesap kesin → AI yalnız içeriği yorumlar).
  //   fetchedRef bir kez çağrı garantisi (docs tazelense de yeniden istemez); deterministik muhasebeNeden
  //   yorum gelene kadar anlık gösterilir.
  const [richNotes, setRichNotes] = useState<Record<string, { loading?: boolean; text?: string; zengin?: boolean }>>({});
  const richFetchedRef = useRef<Set<string>>(new Set());
  const richUpgradeRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const id = fisDetayId;
    if (!id) return;
    const d = docs.find((x: any) => x.id === id);
    if (!d) return;
    if (String((d.ocrData as any)?.muhasebeNedenZengin || '')) return; // DB'de zaten var
    if (richFetchedRef.current.has(id)) return; // zaten istendi
    richFetchedRef.current.add(id);
    setRichNotes((s) => ({ ...s, [id]: { loading: true } }));
    // Unmount / belge değişince iptal edebilmek için zamanlayıcı id'lerini topla (cleanup'ta temizlenir).
    const timers: number[] = [];
    // Backend deterministik yorumu ANINDA döndürür (zengin=false), zengin AI yorumunu arka planda üretir.
    //   İlk yanıtta deterministik gösterilir; zengin gelmediyse 14 sn sonra BİR KEZ tekrar istenir (upgrade).
    const iste = (isUpgrade: boolean) =>
      api.post(`/fatura-muhasebelestirme/documents/${id}/muhasebe-yorum`)
        .then((r) => {
          const t = String(r.data?.neden || '');
          const zengin = r.data?.zengin === true;
          // Upgrade isteğinde zengin gelmediyse dokunma (deterministik ön yorum kalsın).
          if (isUpgrade && !zengin) return;
          setRichNotes((s) => ({ ...s, [id]: { loading: false, text: t, zengin } }));
          if (!zengin && !isUpgrade && !richUpgradeRef.current.has(id)) {
            richUpgradeRef.current.add(id);
            // Zengin AI yorumu arka planda üretilir; süresi değişken (Max). Tek 14sn denemesi yavaş üretimi
            //   KAÇIRIYORDU → belge açık kalsa da boş görünüyordu. Birkaç kez yokla (6/13/22 sn).
            [6000, 13000, 22000].forEach((ms) => timers.push(window.setTimeout(() => { iste(true).catch(() => {}); }, ms)));
          }
        })
        .catch(() => { if (!isUpgrade) setRichNotes((s) => ({ ...s, [id]: { loading: false, text: '', zengin: false } })); });
    iste(false);
    return () => { timers.forEach((t) => clearTimeout(t)); };
  }, [fisDetayId, docs]);
  // "Faaliyet: … / Yorum: …" iki bölümü satır satır, etiketleri vurgulu göster (deterministik tek cümlede düz).
  const renderNeden = (text: string) => text.split('\n').map((ln, i) => {
    const m = ln.match(/^\s*(Faaliyet|Yorum)\s*:\s*(.*)$/i);
    return <div key={i} style={{ marginTop: i ? 3 : 0 }}>{m ? <><b style={{ color: '#6d28d9' }}>{m[1]}:</b> {m[2]}</> : ln}</div>;
  });

  const muhasebelestir = () => {
    // İşletme defteri: hesap kodu YOK — tutarı olan hazır. Bilanço: TÜM satırların kodu dolu (cari dahil).
    const isReadyDoc = (d: any) => {
      if (d.status === 'APPROVED') return false;
      if (isIsletme) return isletmeDocReady(d).ok;
      return Array.isArray(d.lines) && d.lines.length > 0 && d.lines.every((l: any) => l.accountCode);
    };
    const hazir = docs.filter((d) => sel.has(d.id) && isReadyDoc(d));
    if (hazir.length === 0) {
      toast.error(sel.size === 0 ? 'Önce belge seç' : (isIsletme ? 'Seçilenlerde belge türü/kayıt türü eksik, tutar okunamamış ya da zaten onaylı' : 'Seçilenlerde eksik hesap kodu var (cari/KDV/gider) ya da zaten onaylı'));
      return;
    }
    approveMut.mutate({ ids: hazir.map((d) => d.id) });
  };
  // GÜVEN SKORU (iyileştirme #1): backend her belgeye `guven.seviye` (yuksek|orta|dusuk) verir.
  //   "yuksek" = öğrenilmiş/kesin eşleşme → otomatik onaya hazır. Müşavir tek tıkla güvenlileri onaylar,
  //   geriye yalnız "bakılmalı" (orta+düşük) kalır → asıl zaman tasarrufu. (İşletme'de güven backend'de
  //   satır kodu aramaz; orada mevcut "Seçilenleri onayla" akışı kullanılır — güvenli-buton yalnız kod olan bilançoda anlamlı.)
  const guvenliDocs = docs.filter((d: any) => d.status !== 'APPROVED' && d?.guven?.seviye === 'yuksek');
  const bakilmaliCount = docs.filter((d: any) => d.status !== 'APPROVED' && d?.guven && d.guven.seviye !== 'yuksek').length;
  const guvenliOnayla = () => {
    if (!guvenliDocs.length) { toast.error('Otomatik onaya hazır (yüksek güvenli) belge yok'); return; }
    approveMut.mutate({ ids: guvenliDocs.map((d: any) => d.id) });
  };

  return (
    <section className="screen">
      <div className="h2">{kind === 'SATIS' ? 'Bekleyen Satış Faturaları' : 'Bekleyen Alış Faturaları'}</div>
      <div className="sub">{kind === 'SATIS' ? 'Mükellefin kestiği satış faturaları — kuralla otomatik eşleşir.' : 'Entegratörden çekilen gelen faturalar — kuralla otomatik eşleşir, sadece eksik/çelişkili olana bakarsın.'}</div>
      {karne && karne.toplam > 0 && (() => {
        // BÜYÜK yüzde = "hesap atandı" oranı (listedeki "Eşleşti" ile tutarlı). "Güvenli" AYRI ve daha
        //   katı ölçüt (öğrenilmiş + carisi dolu) — sen onayladıkça büyür. Eski büyük yüzde=güvenli oranı
        //   olduğu için "76 Eşleşti ama %0" çelişkisi görünüyordu (kullanıcı bulgusu 2026-08-11).
        const oran = Number(karne.hesapAtananOran ?? karne.otomatikOran) || 0;
        const atanan = Number(karne.hesapAtanan ?? 0);
        const oc = oran >= 70 ? '#15803d' : oran >= 40 ? '#d97706' : '#e5484d';
        return (
          <div style={{ margin: '0 0 8px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'linear-gradient(135deg,#f8fafc,#ffffff)', overflow: 'hidden' }}>
            <div onClick={() => setKarneAcik((v) => !v)} style={{ cursor: karne.zayifSaticilar?.length ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Oto-eşleşme karnesi</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: oc }} title={`${atanan}/${karne.toplam} belgeye otomatik hesap kodu atandı`}>%{oran}</span>
              <span style={{ fontSize: 12, color: '#64748b' }}>hesap atandı ({atanan}/{karne.toplam})</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#15803d' }} title="Öğrenilmiş kaynaktan (sen onaylamış) + carisi dolu + uyarısız. Sen düzelttikçe/onayladıkça artar; ilk okumada 0 olması normaldir.">{karne.yuksek} güvenli</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#d97706' }} title="Bir bakılması gereken (orta + düşük güven) belge sayısı.">{karne.bakilmali} bakılmalı</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#94a3b8' }}>{karne.onaylanmis} onaylı</span>
              {karne.zayifSaticilar?.length ? <span style={{ fontSize: 12, color: '#64748b' }}>{karneAcik ? '▲' : '▼'}</span> : null}
            </div>
            {karneAcik && karne.zayifSaticilar?.length > 0 && (
              <div style={{ padding: '0 15px 12px', borderTop: '1px solid #eef2f7' }}>
                <div style={{ fontSize: 11.5, color: '#94a3b8', margin: '10px 0 6px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>En çok bakılan cariler (kural/öğretme buraya)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {karne.zayifSaticilar.map((z: any) => (
                    <span key={z.ad} title={z.neden} style={{ fontSize: 12, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 8, padding: '4px 9px', fontWeight: 600 }}>
                      {z.ad} <b style={{ color: '#c2410c' }}>{z.adet}</b>{z.neden ? <span style={{ color: '#c2710c', fontWeight: 500 }}> · {z.neden}</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      <div className="filttiles">
        {([
          { v: 'all', l: 'Tümü', c: 'var(--accent)' },
          { v: 'ready', l: 'Eşleşti', c: '#15803d' },
          { v: 'eksik', l: 'Kod eksik', c: '#d97706' },
          { v: 'incele', l: 'Eşleşmedi', c: '#c2710c' },
          { v: 'celiski', l: 'Çelişki', c: '#e5484d' },
          { v: 'tutar', l: 'Tutar okunamadı', c: '#db6e1e' },
          { v: 'demirbas', l: 'Demirbaş', c: '#7c3aed' },
          { v: 'okunuyor', l: 'Okunuyor', c: '#0891b2' },
          { v: 'okunamadi', l: 'Okunamadı', c: '#e5484d' },
        ] as Array<{ v: string; l: string; c: string }>).map((t) => {
          const n = durumCount(t.v);
          if (t.v !== 'all' && n === 0) return null;
          return (
            <button key={t.v} type="button" className={`ftile${durumF === t.v ? ' on' : ''}`} style={{ ['--tc' as any]: t.c }} onClick={() => setDurumF(t.v)}>
              <span className="ftdot" />
              <span className="fttx"><span className="ftn">{n}</span><span className="ftl">{t.l}</span></span>
            </button>
          );
        })}
      </div>
      <div className="card invcard">
        <div className="ch invactions">
          <h3>{docsQ.isLoading ? 'Yükleniyor…' : <>{docs.length} belge{sel.size > 0 ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}> · {sel.size} seçili</span> : null}{guvenliDocs.length > 0 ? <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}> · {guvenliDocs.length} güvenli</span> : null}{bakilmaliCount > 0 ? <span style={{ fontSize: 12, fontWeight: 700, color: '#d97706' }}> · {bakilmaliCount} bakılmalı</span> : null}</>}</h3><div className="sp" />
          <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.jpe,.jfif,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif,.avif,.xml,.ubl,.zip" style={{ display: 'none' }} onChange={(e) => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; if (files.length) uploadMut.mutate(files); }} />
          <button className="btn sm upload" disabled={!taxpayerId || uploadMut.isPending} onClick={() => setUploadPick(true)} title={!taxpayerId ? 'Önce mükellef seç' : 'Gelir/Gider seç, sonra JPEG / PDF / XML belge yükle'}><Ico html={I.upload} size={13} /> {uploadMut.isPending ? 'Yükleniyor…' : 'Belge Yükle'}</button>
          {uploadPick && (
            <div onMouseDown={() => setUploadPick(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,0.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
              <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(440px, 96vw)', background: '#fff', color: '#1a1a1a', borderRadius: 16, padding: '24px 26px', boxShadow: '0 24px 70px rgba(0,0,0,0.45)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Yüklenecek belgeler ne?</div>
                <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 18 }}>Seçimine göre yön (gelir/gider) belirlenir. Z raporu seçilince otomatik gelir işlenir.</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <button
                    onClick={() => { uploadDirRef.current = 'SATIS'; fileRef.current?.click(); setUploadPick(false); }}
                    style={{ padding: '16px 10px', borderRadius: 12, border: '1.5px solid #b7e4c7', background: 'linear-gradient(135deg,#eafaf0,#f3fdf7)', color: '#15803d', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
                  >Gelir<div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.8, marginTop: 3 }}>Satış faturası / Z raporu</div></button>
                  <button
                    onClick={() => { uploadDirRef.current = 'ALIS'; fileRef.current?.click(); setUploadPick(false); }}
                    style={{ padding: '16px 10px', borderRadius: 12, border: '1.5px solid #c7d6ef', background: 'linear-gradient(135deg,#eef3fb,#f5f8fd)', color: '#1d4ed8', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
                  >Gider<div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.8, marginTop: 3 }}>Alış faturası / ÖKC fişi</div></button>
                </div>
                <button onClick={() => setUploadPick(false)} style={{ marginTop: 16, width: '100%', padding: '9px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Vazgeç</button>
              </div>
            </div>
          )}
          <button className="btn sm fix" disabled={!taxpayerId || recodeMut.isPending} onClick={() => recodeMut.mutate()} title="Belgeleri TEKRAR OKUMADAN hesap kodlarını plana göre yeniden eşleştir — yanlış carileri düzeltir/temizler (saniyeler sürer)"><Ico html={I.wand} size={13} /> {recodeMut.isPending ? 'Düzeltiliyor…' : 'Kodları düzelt'}</button>
          <button className="btn sm ai" disabled={aiBusy || sel.size === 0} onClick={aiOku} title="Seçili faturaları yapay zeka (Max) ile oku — sunucuda okur, sayfa değişince durmaz"><Ico html={I.spark} size={13} /> {aiBusy ? 'Başlatılıyor…' : `AI ile oku${sel.size ? ` (${sel.size})` : ''}`}</button>
          {guvenliDocs.length > 0 && (
            <button className="btn sm" style={{ ['--tc' as any]: '#15803d', background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff', border: '1px solid #15803d' }} disabled={approveMut.isPending} onClick={guvenliOnayla} title="Öğrenilmiş/kesin eşleşen (yüksek güvenli) belgeleri TEK TIKLA onayla — geriye yalnız bakılması gerekenler kalır. Güven büyüdükçe (sen düzelttikçe) bu sayı artar.">
              <Ico html={I.checkSm} size={13} /> {approveMut.isPending ? 'İşleniyor…' : `Güvenli ${guvenliDocs.length}'i onayla`}
            </button>
          )}
          <button className="btn sm primary" disabled={approveMut.isPending} onClick={muhasebelestir} title="Seçili, kodu tam olan belgeleri toplu onayla (Luca kuyruğuna alır). Tek tek inceleme için soldaki 'Muhasebeleştir' ekranını kullan."><Ico html={I.checkSm} size={13} /> {approveMut.isPending ? 'İşleniyor…' : `Seçilenleri onayla${sel.size ? ` (${sel.size})` : ''}`}</button>
        </div>
        {skipInfo && skipInfo.length > 0 && (() => {
          // Toplu onayda atlananlar — sebep gruplarıyla (hafıza çelişki / diğer hata). (AI denetçi kaldırıldı.)
          const celiski = skipInfo.filter((s) => String(s.reason || '').startsWith('hafiza-celiski'));
          const diger = skipInfo.filter((s) => !celiski.includes(s));
          const noLabel = (arr: typeof skipInfo) => { const ns = arr.map((s) => s.belgeNo).filter(Boolean); return ns.length ? ` (${ns.slice(0, 5).join(', ')}${ns.length > 5 ? '…' : ''})` : ''; };
          return (
            <div style={{ margin: '8px 12px 0', padding: '9px 12px', border: '1px solid #f0d9b3', borderRadius: 9, background: '#fff9ef', fontSize: 12.5, color: '#7c4a03', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ fontSize: 13 }}>Toplu onayda atlanan belgeler ({skipInfo.length})</b>
                <div className="sp" />
                <button className="btn sm" onClick={() => setSkipInfo(null)}>Kapat</button>
              </div>
              {celiski.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>• <b>{celiski.length} belge öğrenilmiş hesapla çelişiyor</b> — bu satıcılar için geçmişte hep farklı hesap onaylanmış; belgeleri açıp kontrol edin{noLabel(celiski)}.</span>
                  <button className="btn sm" style={{ borderColor: '#e0b4b4', color: '#c0353a' }} disabled={approveMut.isPending}
                    onClick={() => approveMut.mutate({ ids: celiski.map((s) => s.id), force: true })}
                    title="Hafıza çelişkisi uyarısını görmezden gel, yalnız bu belgeleri force ile onayla">Yine de onayla ({celiski.length})</button>
                </div>
              )}
              {diger.length > 0 && <div>• {diger.length} belge onaylanamadı: {diger.slice(0, 3).map((s) => `${s.belgeNo ? s.belgeNo + ' — ' : ''}${s.reason}`).join(' · ')}{diger.length > 3 ? ' …' : ''}</div>}
            </div>
          );
        })()}
        {docsQ.isError && (
          <div className="yuklenemedi">
            <span><Ico html={I.info} size={14} /> Belgeler yüklenemedi (bağlantı/sunucu hatası) — "veri yok" değil.</span>
            <button className="btn sm" onClick={() => docsQ.refetch()}><Ico html={I.sync} size={12} /> Tekrar dene</button>
          </div>
        )}
        {!!taxpayerId && planMissing && (
          <div className="planuyari">
            <Ico html={I.info} size={17} />
            <div>
              <b>Bu mükellefin hesap planı aktarılmamış.</b> Eşleştirilecek hesap olmadığı için kodlar (gelir/gider, cari, KDV) atanamıyor — bu yüzden belgeler "eksik" görünüyor.
              <br /><b>Çözüm:</b> Luca'dan bu mükellefin <b>hesap planını çekin</b> (Hesap Planı ekranı), sonra "Kodları düzelt" ile otomatik eşleşir.
            </div>
          </div>
        )}
        {ocrProg && (ocrProg.active || ocrProg.failed > 0) && (() => {
          const tot = Math.max(1, (ocrProg.done || 0) + (ocrProg.reading || 0) + (ocrProg.failed || 0));
          const pct = Math.min(100, Math.round(((ocrProg.done || 0) / tot) * 100));
          // TAHMİNİ kalan süre (ETA): başlangıçtan beri okunan / geçen süre = hız; kalan = sıradaki / hız.
          const st = readStartRef.current;
          const elapsed = st ? (Date.now() - st.ms) / 1000 : 0;
          const doneSince = st ? Math.max(0, (ocrProg.done || 0) - st.done) : 0;
          const rate = doneSince > 0 && elapsed > 1.5 ? doneSince / elapsed : 0; // belge/sn
          const remaining = Number(ocrProg.reading || 0);
          const etaSec = rate > 0 ? Math.round(remaining / rate) : 0;
          const etaText = remaining <= 0 ? '' : etaSec > 0 ? (etaSec < 60 ? `~${etaSec} sn` : `~${Math.round(etaSec / 60)} dk`) : 'hesaplanıyor…';
          return (
            <div className={`aibar${ocrProg.active ? '' : ' err'}`}>
              {ocrProg.active ? (
                <>
                  <div className="aiscan"><i /><i /><i /><i /><span className="beam" /></div>
                  <div className="aimid">
                    <div className="ait">Belgeler yapay zeka ile okunuyor<span className="dots" /></div>
                    <div className="aisub">
                      <b>{ocrProg.done}</b> / {tot} belge okundu
                      {ocrProg.reading ? <> <span className="aichip"><span className="qdot" />{ocrProg.reading} sırada</span></> : null}
                      {etaText ? <> <span className="aichip eta">⏱ {etaText}</span></> : null}
                      {ocrProg.failed ? <> <span className="aichip warn">{ocrProg.failed} okunamadı</span></> : null}
                    </div>
                    <div className="aitrack"><div className="aifill" style={{ width: `${pct}%` }} /></div>
                    <div className="ainote">Sunucuda işlenir — sayfayı değiştirebilir, başka işe geçebilirsin</div>
                  </div>
                  <div className="airight">
                    <div className="aipct">%{pct}</div><small>OKUNDU</small>
                    <button
                      className="aistop"
                      onClick={aiDurdur}
                      disabled={aiStop}
                      title="Okumayı durdur — bekleyen belgeler sıradan çıkarılır (okunan biter)"
                    >{aiStop ? 'Durduruluyor…' : <>✕ Durdur</>}</button>
                  </div>
                </>
              ) : (
                <><span className="aidot err" /> <span><b>{ocrProg.failed}</b> belge okunamadı — seçip <b>AI ile oku</b> ile tekrar dene</span></>
              )}
            </div>
          );
        })()}
        {kind === 'ALIS' && missing.length > 0 && (
          <div className="eksikbelge" title="Bu satıcılar son aylarda düzenli alış faturası gönderdi ama bu dönem henüz yok — eksik belge olabilir.">
            <Ico html={I.info} size={14} />
            <span><b>{missing.length}</b> satıcıdan bu dönem belge gelmemiş olabilir (düzenli geliyordu): {missing.slice(0, 8).map((m: any) => m.name).join(', ')}{missing.length > 8 ? ` +${missing.length - 8}` : ''}</span>
          </div>
        )}
        {kind === 'SATIS' && noGaps && noGaps.toplamEksik > 0 && (
          <div className="eksikbelge" title="Satış faturası numaraları ardışık gitmeli — listede olmayan numara kesilmemiş, iptal edilmiş ya da sisteme gelmemiş fatura demek olabilir.">
            <Ico html={I.info} size={14} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {(noGaps.seriler || []).filter((s: any) => s.eksikToplam > 0).map((s: any) => {
                // Sade gösterim: numaraları TEK TEK yaz (30'a kadar aç; fazlasında aralık kısaltması).
                const kuyruk = (v: any) => String(parseInt(String(v).slice(String(s.seri).length), 10) || v);
                const nolar: string[] = [];
                for (const b of (s.bosluklar || [])) {
                  const bas = parseInt(String(b.baslangic).slice(String(s.seri).length), 10);
                  if (s.eksikToplam <= 30 && Number.isFinite(bas)) { for (let n = bas; n < bas + b.adet; n++) nolar.push(String(n)); }
                  else nolar.push(b.adet === 1 ? kuyruk(b.baslangic) : `${kuyruk(b.baslangic)}–${kuyruk(b.bitis)} arası ${b.adet} adet`);
                }
                return (
                  <span key={s.seri}>
                    <b>{s.eksikToplam} satış faturası eksik görünüyor</b> ({s.seri} serisinde şu numaralar yok): <b>{nolar.join(', ')}</b>
                    {ocrProg?.active ? ' — okuma sürüyor, bitince kesinleşir.' : ' — kesilmemiş, iptal edilmiş ya da sisteme gelmemiş olabilir.'}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="twrap">
          <table>
            <thead><tr><th style={{ width: 30 }}><Check checked={allSelected} onToggle={toggleAll} /></th><th>Tarih</th><th>Fatura No</th><th>Firma Adı</th><th>Tip</th><th className="num">KDV Hariç</th><th className="num">KDV</th><th className="num">Tutar</th>{!isIsletme && <th>Hesap Kodu</th>}<th>Durum</th><th className="actcol" style={{ width: 40 }} /></tr></thead>
            <tbody>
              {docs.map((d) => {
                const du = dd(d);
                const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
                // İşletme "Kayıt Türü" sütunu: içerik = ALT türü (örn. "Elektrik Giderleri"). Seçili ise o,
                //   değilse satıcı adından otomatik (Elektrik/Yakıt/Doğalgaz/Su/Telefon/Kargo/HGS…); alt yoksa ana türe düşer.
                // İşletme: içerikten gelen sınıf. ok ise ALT türünü göster (yoksa ana türe düş); değilse boş (Eşleşmedi).
                const sinif = islSinif(d);
                const islKt = sinif.ktAd.replace(/\s*\(.*?\)/g, '').trim();
                const islKayit = isIsletme && sinif.ok ? (kayitAltKisaAd(sinif.altAd) || islKt) : '';
                const islAltFull = sinif.altAd;
                const islMain = sinif.ktAd;
                const firma = (sat ? d.customerName : d.vendorName) || '—';
                const vkn = sat ? d.buyerVkn : d.sellerVkn;
                // HESAP KODU sütunu = SADECE matrah/gider kodu. Gider boşsa KDV/cari koduna DÜŞME →
                //   boş kalsın (kullanıcı: gider kodu boşsa bu sütun da boş olmalı).
                const code = (() => {
                  const ls = Array.isArray(d.lines) ? d.lines : [];
                  return accountCodeOnly(ls.find((l: any) => String(l.group) === 'matrah' && l.accountCode)?.accountCode || '');
                })();
                const { matrah, kdv } = kdvParts(d);
                const ocrCls = d.ocrStatus === 'IN_PROGRESS' ? 'scanning' : justDone.has(d.id) ? 'justdone' : d.ocrStatus === 'PENDING' ? 'queued' : undefined;
                const fisAcik = fisDetayId === d.id;
                // Muhasebe fişi STANDART SIRA (kullanıcı isteği): her KDV oranı için Matrah→KDV birlikte,
                //   sonra Tevkifat, en altta Cari. Ör: Matrah %1 → KDV %1 → Matrah %20 → KDV %20 → Tevkifat → Cari.
                //   Yalnız GÖRÜNTÜLEME sırası; BORÇ/ALACAK ve tutar mantığı DEĞİŞMEZ.
                const fisSira = (l: any): number => {
                  const g = String(l?.group || '');
                  if (g === 'cari') return 100000;
                  if (g === 'tevkifat') return 90000;
                  if (g === 'vergi-sorumlu') return 80000;
                  const oran = Number(l?.rate ?? l?.oran ?? 0) || 0; // matrah/vergi: orana göre grupla, matrah önce KDV sonra
                  return oran * 10 + (g === 'vergi' ? 1 : 0);
                };
                const fisLines: any[] = (Array.isArray(d.lines) ? [...d.lines] : [])
                  .sort((a: any, b: any) => fisSira(a) - fisSira(b));
                const docUyarilar: any[] = Array.isArray((d.ocrData as any)?.uyarilar) ? (d.ocrData as any).uyarilar : [];
                const docUyariHata = docUyarilar.filter((u: any) => u?.siddet === 'hata').length;
                const docUyariRenk = docUyariHata > 0 ? '#dc2626' : '#d97706';
                return (
                  <Fragment key={d.id}>
                  <tr className={`${ocrCls || ''}${fisAcik ? ' detay-on' : ''}`.trim() || undefined}>
                    <td><Check checked={sel.has(d.id)} onToggle={() => toggle(d.id)} /></td>
                    <td>{fmtDate(d.faturaTarihi || d.createdAt)}</td>
                    <td>{d.belgeNo || '—'}</td>
                    <td className="firm"><b>{firma}</b><small>{vkn ? `VKN ${vkn}` : '—'}</small>{(d as any).duplicateOfId ? <small style={{ color: '#c0353a', fontWeight: 700 }} title={(d as any).duplicateReason || 'Bu fatura daha önce yüklenmiş'}>⚠ {(d as any).duplicateReason || 'Mükerrer — daha önce yüklenmiş'}</small> : null}</td>
                    <td><span className={`pill ${sat ? 'satis' : 'alis'}`}>{sat ? 'Satış' : 'Alış'}</span></td>
                    <td className="num">{matrah != null ? fmtMoney(matrah) : '—'}</td>
                    <td className="num">{kdv != null ? fmtMoney(kdv) : '—'}</td>
                    <td className="num">{fmtMoney(d.totalAmount)}</td>
                    {!isIsletme && <td>{code ? <span className="hk">{code}</span> : <span className="hk no">— yok —</span>}</td>}
                    <td><span className={`pill ${du.k}`} title={du.cat === 'okunamadi' && d.lucaErrorMessage ? `Neden: ${d.lucaErrorMessage}` : du.cat === 'celiski' ? ((Array.isArray(d.validationIssues) ? d.validationIssues : (Array.isArray(d.ocrData?.validationIssues) ? d.ocrData.validationIssues : [])).filter((i: any) => i?.code && i.code !== 'INCOMPLETE_AMOUNTS' && i?.severity !== 'WARNING').map((i: any) => i.message).filter(Boolean).join(' · ') || du.t) : du.t}>{du.t}</span>{du.cat === 'okunamadi' && d.lucaErrorMessage ? <div className="oneden">{d.lucaErrorMessage}</div> : null}{du.cat === 'celiski' ? <div className="oneden" style={{ fontSize: 10.5, opacity: 0.85 }}>↓ sebebi fiş detayında</div> : null}</td>
                    {/* DİKKAT: td'ye display:flex verme — hücre tablo düzeninden çıkıp durum sütununun
                        üstüne biniyordu (kullanıcı bulgusu). Flex hizalama İÇ div'de. */}
                    <td className="actcol"><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {docUyarilar.length > 0 && (
                        <span className="dnt-bdg" style={{ color: docUyariRenk, borderColor: docUyariRenk }} title={docUyarilar.map((u: any) => `⚠ ${u.baslik}: ${u.mesaj}`).join('\n\n')} onClick={() => setFisDetayId(fisAcik ? '' : d.id)}>
                          ⚠{docUyarilar.length}
                        </span>
                      )}
                      <span className="eye" onClick={() => setFisDetayId(fisAcik ? '' : d.id)} title={fisAcik ? 'Detayı gizle' : (isIsletme ? 'Kayıt türünü göster' : 'Yevmiye fişini göster')} style={{ color: fisAcik ? 'var(--accent,#2563eb)' : '#2563eb' }}><Ico html={I.ledger} size={15} /></span>
                      <span className="eye" onClick={() => onOpenMuhasebe?.(d.id)} title="Muhasebeleştir ekranında aç" style={{ color: '#7c3aed' }}><Ico html={I.edit} size={15} /></span>
                      <span className="eye" onClick={() => openDocFile(d.id)} title="Belgeyi aç" style={{ color: '#0891b2' }}><Ico html={I.eye} size={15} /></span>
                      <span className="eye del" title="Belgeyi sil" onClick={() => { if (window.confirm(`Bu belge silinsin mi?\n${firma} · ${fmtMoney(d.totalAmount)} ₺${d.belgeNo ? ' · ' + d.belgeNo : ''}`)) delMut.mutate(d.id); }} style={{ color: '#dc2626' }}><Ico html={I.trash} size={14} /></span>
                    </div></td>
                  </tr>
                  {fisAcik && (
                    <tr className="detayrow">
                      <td colSpan={isIsletme ? 10 : 11}>
                        <div className="detaybox">
                          {(() => {
                            const rn = richNotes[d.id];
                            // AI'ın "içerik şifreli/okunamadı/nitelik belirlenemedi" gibi YANILTICI mazeret
                            //   yorumlarını gösterme (kalem zaten okunmuş, belge eşleşmiş olabiliyor). Eski
                            //   belgelerde DB'de kalmış olabilir → tekrar-okumadan ekranda da süz.
                            const isBahane = (s: string) => /şifre|şifrel|encrypt|decode|okunama|açıklanama|aciklanama|belirlenem|tespit edilem|anlaşılam|anlasilam|çözülem|cozulem|deşifre/i.test(s || '');
                            // Öncelik: zengin (mükellef-gözü, lazy fetch) > DB'deki zengin > okuma-anı AI yorumu (fallback).
                            const zenginRaw = (rn?.zengin ? String(rn?.text || '') : '') || String((d.ocrData as any)?.muhasebeNedenZengin || '');
                            const zengin = isBahane(zenginRaw) ? '' : zenginRaw;
                            // Deterministik (zengin olmayan) lazy yanıt da "ön yorum" olarak gösterilir.
                            const onYorumRaw = (String((d.ocrData as any)?.aiYorum || '').trim()) || (!rn?.zengin ? String(rn?.text || '').trim() : '');
                            const onYorum = isBahane(onYorumRaw) ? '' : onYorumRaw;
                            const text = (zengin || onYorum).trim();
                            const isOnYorum = !zengin.trim() && !!onYorum;
                            const loading = !!rn?.loading && !text;
                            if (!text && !loading) return null;
                            return (
                              <div style={{ padding: '7px 10px', marginBottom: 8, background: 'rgba(124,58,237,0.08)', borderLeft: '3px solid #7c3aed', borderRadius: 5, fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: 940 }}>
                              <b style={{ color: '#7c3aed' }}>💡 AI değerlendirmesi{isOnYorum ? <span style={{ fontWeight: 400, opacity: 0.65, fontSize: 11 }}> · ön yorum</span> : null}:</b>{' '}
                              {loading ? <span style={{ opacity: 0.7 }}>yorumlanıyor…</span> : renderNeden(text)}
                            </div>
                            );
                          })()}
                          {/* AI denetçi rozeti kaldırıldı (kullanıcı talebi 2026-07-27) — yalnız AI değerlendirmesi gösterilir. */}
                          {docUyarilar.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              {docUyarilar.map((u: any, i: number) => {
                                const isHata = u?.siddet === 'hata';
                                const isUyari = u?.siddet === 'uyari';
                                const renk = isHata ? '#dc2626' : isUyari ? '#d97706' : '#2563eb';
                                const bg = isHata ? 'rgba(220,38,38,0.07)' : isUyari ? 'rgba(217,119,6,0.07)' : 'rgba(37,99,235,0.07)';
                                return (
                                  <div key={i} style={{ padding: '6px 10px', marginBottom: 4, background: bg, borderLeft: `3px solid ${renk}`, borderRadius: 5, fontSize: 12, lineHeight: 1.5 }}>
                                    <b style={{ color: renk }}>{isHata ? '🚨' : isUyari ? '⚠️' : 'ℹ️'} {u.baslik}:</b>{' '}{u.mesaj}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {Array.isArray((d.ocrData as any)?.kalemler) && (d.ocrData as any).kalemler.length > 0 ? (
                            <div style={{ padding: '6px 10px', marginBottom: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--line)', borderRadius: 5, fontSize: 11.5, maxWidth: 940 }}>
                              <b style={{ color: 'var(--faint)' }}>📋 Fatura kalemleri</b>
                              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {(d.ocrData as any).kalemler.map((k: any, i: number) => (
                                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                    <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{k.ad}{k.oran ? ` · %${k.oran}` : ''}</span>
                                    <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, color: 'var(--faint)' }}>{fmtMoney(k.tutar)} ₺</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {isIsletme ? (
                            <div style={{ padding: '4px 2px', fontSize: 13 }}>{(() => {
                              const s = islSinif(d);
                              if (!s.ok) return <span className="hk no">Kayıt türü belirlenemedi — "AI ile oku" ile yeniden okut ya da Muhasebeleştir'de seç.</span>;
                              return (
                                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                                  <span><b style={{ opacity: 0.7, fontWeight: 600 }}>Kayıt Türü:</b> {s.ktAd}</span>
                                  {s.altAd ? <span><b style={{ opacity: 0.7, fontWeight: 600 }}>K. Alt Türü:</b> {s.altAd}</span> : null}
                                </div>
                              );
                            })()}</div>
                          ) : fisLines.length ? (
                            <table className="detaytbl">
                              <thead><tr><th>Tür</th><th>Hesap Kodu</th><th>Açıklama</th><th className="num">Borç</th><th className="num">Alacak</th></tr></thead>
                              <tbody>
                                {fisLines.map((l: any, i: number) => (
                                  <tr key={l.id || i}>
                                    <td>{grpLabel(String(l.group || ''))}{l.rate ? ` %${String(l.rate).replace(/[^0-9.,]/g, '')}` : ''}</td>
                                    <td>{accountCodeOnly(l.accountCode) ? <span className="hk">{accountCodeOnly(l.accountCode)}</span> : <span className="hk no">eksik</span>}</td>
                                    <td>{l.accountCode ? (l.description || '—') : '—'}</td>
                                    <td className="num">{Number(l.debit) ? fmtMoney(l.debit) : ''}</td>
                                    <td className="num">{Number(l.credit) ? fmtMoney(l.credit) : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : <div className="empty" style={{ padding: 10 }}>Fiş satırı yok — önce "AI ile oku".</div>}
                          {(() => { const sB = fisLines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0); const sA = fisLines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0); const msgs: string[] = []; if (fisLines.length > 0 && Math.abs(sB - sA) > 0.5) msgs.push(`Yevmiye dengesiz: Borç ${fmtMoney(sB)} ₺ ≠ Alacak ${fmtMoney(sA)} ₺ (${Math.abs(sB - sA).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ fark) — bir satır eksik/fazla.`); (Array.isArray(d.validationIssues) ? d.validationIssues : (Array.isArray(d.ocrData?.validationIssues) ? d.ocrData.validationIssues : [])).filter((i: any) => i?.code && i?.severity !== 'WARNING' && !['INCOMPLETE_AMOUNTS', 'TOTAL_MISMATCH', 'BALANCE_MISMATCH'].includes(i.code) && !(i.code === 'RETURN_NEEDS_REVERSAL' && fisLines.some((l: any) => /^61[01]/.test(String(l.accountCode || ''))))).forEach((i: any) => i.message && msgs.push(i.message)); return msgs.length ? <div className="celiskibanner"><b>Çelişki sebebi:</b>{msgs.map((m: string, k: number) => <div key={k}>• {m}</div>)}</div> : null; })()}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {!docsQ.isLoading && docs.length === 0 && (
                <tr><td colSpan={11}><div className="empty">Bu dönemde {kind === 'SATIS' ? 'satış' : 'alış'} faturası yok. Üstten mükellef/dönem seç ya da entegratörden çek.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="foot">
          <div className="selinfo">{docsAll.length} belge · {sayac.ok} {isIsletme ? 'hazır' : 'eşleşti'}{isIsletme ? '' : ` · ${sayac.miss} eksik kod`} · {sayac.warn} {isIsletme ? 'tutar/çelişki' : 'çelişki'}{durumF !== 'all' ? ` · (filtre: ${docs.length})` : ''}</div>
          <div className="sp" />
          {docsAll.length >= 300 && <div className="pg">İlk 300 gösteriliyor — dönem/durum filtresiyle daralt</div>}
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: MÜKELLEFLER ===================== */
function ScreenSorgu({ taxpayerId, period, source }: { taxpayerId: string; period: string; source: 'earsiv' | 'efatura' }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Set<string>>(new Set());
  // SERBEST TARİH ARALIĞI (Mihsap örneği — kullanıcı talebi): boş bırakılırsa eski davranış (üstteki
  //   ay/dönem seçici) geçerli kalır; doldurulursa Sorgula bu aralığa göre çalışır.
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  // Aralık doğrulama: başlangıç > bitiş = sorgu YAPILMAZ (buton kilitli + uyarı). Tek alan doluysa
  //   aralık sorguya GİTMEZ (backend ay dönemine düşer) — kullanıcıya sessizce değil, açıkça söyle.
  const rangeInvalid = !!rangeFrom && !!rangeTo && rangeFrom > rangeTo;
  const rangePartial = !rangeInvalid && (!!rangeFrom !== !!rangeTo);
  const [efaturaChannel, setEfaturaChannel] = useState<'IN_EFATURA' | 'OUT_EFATURA' | 'OUT_EARSIV'>('IN_EFATURA');
  const [lastEfaturaSync, setLastEfaturaSync] = useState<any>(null);
  const [efaturaPollUntil, setEfaturaPollUntil] = useState(0);
  const [efaturaSyncPollUntil, setEfaturaSyncPollUntil] = useState(0);
  const efaturaDirection: 'IN' | 'OUT' = efaturaChannel === 'IN_EFATURA' ? 'IN' : 'OUT';
  // Aktif (pending/running) e-Arşiv işi var mı? Cache'teki iş listesinden bakılır → polling hızını ayarlar.
  const isEarsivJobActive = (jobs: any): boolean =>
    Array.isArray(jobs) && jobs.some((j: any) => ['pending', 'running'].includes(String(j.status || '').toLowerCase()));
  const earsivQ = useQuery({
    queryKey: ['fm-earsiv-sorgu', taxpayerId, period],
    queryFn: async () => (await api.get('/portal-automation/earsiv/invoices', { params: { taxpayerId, period, limit: 500 } })).data,
    enabled: !!taxpayerId && source === 'earsiv',
    // Aktif iş varken hızlı (2sn) → satırlar canlı insin; iş yokken seyrelt (10sn) → boş yük olmasın.
    refetchInterval: () => source === 'earsiv'
      ? (isEarsivJobActive(qc.getQueryData(['fm-earsiv-jobs', taxpayerId])) ? 2000 : 10000)
      : false,
  });
  const jobsQ = useQuery({
    queryKey: ['fm-earsiv-jobs', taxpayerId],
    queryFn: async () => {
      const r = await api.get('/portal-automation/jobs', { params: { jobType: 'EARSIV_PORTAL_FETCH', limit: 12 } });
      return Array.isArray(r.data) ? r.data.filter((j: any) => !taxpayerId || j.taxpayerId === taxpayerId) : [];
    },
    enabled: !!taxpayerId && source === 'earsiv',
    // Aktif iş varken hızlı (1.5sn); iş yokken seyrelt (8sn). Yeni iş sorgulanınca onSuccess invalidate eder.
    refetchInterval: () => source === 'earsiv'
      ? (isEarsivJobActive(qc.getQueryData(['fm-earsiv-jobs', taxpayerId])) ? 1500 : 8000)
      : false,
  });
  const integrationsQ = useQuery({
    queryKey: ['fm-integrations-sorgu', taxpayerId],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/integrations', { params: { taxpayerId: taxpayerId || undefined } })).data,
    enabled: !!taxpayerId,
  });
  const rows: any[] = Array.isArray(earsivQ.data) ? earsivQ.data : [];
  const activeJob = (jobsQ.data || []).find((j: any) => {
    const status = String(j.status || '').toLowerCase();
    if (!['pending', 'running'].includes(status)) return false;
    const jobPeriod = String(j?.payload?.donem || j?.donem || '').trim();
    if (jobPeriod && jobPeriod !== period) return false;
    const updated = new Date(j.updatedAt || j.createdAt || 0).getTime();
    return !updated || Date.now() - updated < 10 * 60 * 1000;
  });
  const waitForFirstRows = !!activeJob && rows.length === 0;
  // İŞ SÜRÜYOR göstergesi (kullanıcı: "faturalar çekiliyor şeridi çıkmıyor"): satır gelmiş olsa bile
  //   iş (belge indirme/prefetch) hâlâ pending/running ise gösterge kalsın (hesap planındaki gibi).
  const earsivJobRunning = !!activeJob;
  const lastJob = (jobsQ.data || [])[0];
  useEffect(() => {
    if (source !== 'earsiv' || !taxpayerId) return;
    const status = String(lastJob?.status || '').toLowerCase();
    if (['done', 'success', 'completed', 'failed'].includes(status)) {
      qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu', taxpayerId, period] });
    }
  }, [source, taxpayerId, period, lastJob?.id, lastJob?.status, lastJob?.updatedAt, qc]);
  const processable = rows.filter((r) => r.isProcessable && !r.aktarildi);
  const selectedRefs = [...sel];
  const toggle = (ref: string) => setSel((prev) => { const n = new Set(prev); n.has(ref) ? n.delete(ref) : n.add(ref); return n; });
  const toggleAll = () => setSel(() => selectedRefs.length === processable.length ? new Set() : new Set(processable.map((r) => r.sourceRefId).filter(Boolean)));

  const sorgulaMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/integrations/fetch', {
      taxpayerId,
      direction: 'SATIS',
      donem: period,
      ...(rangeFrom && rangeTo ? { dateFrom: rangeFrom, dateTo: rangeTo } : {}),
      providers: ['GIB_PORTAL'],
      mode: 'query',
    }),
    onSuccess: (r: any) => {
      showFetchResult(r?.data);
      qc.invalidateQueries({ queryKey: ['fm-earsiv-jobs'] });
      qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu'] });
      [1500, 3500, 6500].forEach((ms) => {
        window.setTimeout(() => {
          qc.invalidateQueries({ queryKey: ['fm-earsiv-jobs'] });
          qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu'] });
        }, ms);
      });
    },
    onError: (e: any) => toast.error('Sorgu başlatılamadı: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const aktarMut = useMutation({
    mutationFn: async () => {
      const refs = selectedRefs.length ? selectedRefs : processable.map((r) => r.sourceRefId).filter(Boolean);
      const sync = await api.post('/portal-automation/earsiv/accounting-sync', {
        taxpayerId,
        period,
        selectedRefs: refs,
      });
      const imported = Number(sync?.data?.imported || 0);
      const processed = Number(sync?.data?.processed || 0);
      if (imported === 0 && processed === 0 && refs.length > 0) {
        const fallback = await api.post('/fatura-muhasebelestirme/integrations/fetch', {
          taxpayerId,
          direction: 'SATIS',
          donem: period,
          providers: ['GIB_PORTAL'],
          mode: 'download',
          selectedRefs: refs,
        });
        return { ...sync, data: { ...(sync.data || {}), fallbackQueued: true, fallback: fallback.data } };
      }
      return sync;
    },
    onSuccess: (r: any) => {
      const imported = Number(r?.data?.imported || 0);
      const processed = Number(r?.data?.processed || 0);
      if (r?.data?.fallbackQueued) showFetchResult(r?.data?.fallback);
      else toast.success(imported > 0 ? `${imported} fatura bekleyen satışa aktarıldı.` : `${processed} fatura kontrol edildi; yeni aktarım yok.`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['fm-earsiv-jobs'] });
      qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu'] });
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Aktarım başlatılamadı: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const earsivOverlayBusy = aktarMut.isPending || waitForFirstRows || sorgulaMut.isPending;
  const syncMut = useMutation({
    mutationFn: () => api.post('/portal-automation/earsiv/accounting-sync', { taxpayerId, period }),
    onSuccess: (r: any) => {
      toast.success(`Senkron tamamlandı · ${r?.data?.imported || 0} yeni belge`);
      qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu'] });
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
  });

  const integrations: any[] = Array.isArray(integrationsQ.data) ? integrationsQ.data : [];
  const efaturaProviders = integrations
    .filter((p) => String(p.kind || '').toLowerCase() === 'efatura' || /EFATURA|ELOGO|UYUMSOFT|MIKRO|IZIBIZ|KOLAYSOFT|FORIBA|PARASUT|TURMOB/i.test(String(p.provider || '')))
    .sort((a, b) => (String(a.provider || '') === 'TURMOB_EFATURA' ? -1 : 0) - (String(b.provider || '') === 'TURMOB_EFATURA' ? -1 : 0));
  const providerConnected = (p: any) => Boolean(p?.connected ?? p?.configured);
  const connectedEfaturaProviders = efaturaProviders.filter(providerConnected);
  const activeEfaturaProvider = connectedEfaturaProviders[0] || efaturaProviders[0];
  const efaturaInboxQ = useQuery({
    queryKey: ['fm-efatura-inbox', taxpayerId, period, efaturaDirection, efaturaChannel],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/efatura-inbox', { params: { taxpayerId, period, direction: efaturaDirection, channel: efaturaChannel, limit: 2000 } })).data,
    enabled: !!taxpayerId && source === 'efatura',
    refetchInterval: source === 'efatura' && efaturaPollUntil > Date.now() ? 2500 : 6000,
  });
  const efaturaRows: any[] = Array.isArray(efaturaInboxQ.data) ? efaturaInboxQ.data : [];
  // Arka plan sorgu (Turkcell gibi çok-faturalı) durumu — kullanıcı çekimin BİTİP bitmediğini görebilsin.
  const efaturaSyncStatusQ = useQuery({
    queryKey: ['fm-efatura-syncstatus', taxpayerId, efaturaChannel],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/efatura-sync/status', { params: { taxpayerId, channel: efaturaChannel } })).data,
    enabled: !!taxpayerId && source === 'efatura' && ['TURKCELL', 'TURMOB_EFATURA'].includes(String(activeEfaturaProvider?.provider)),
    // Mount'ta bir kez çek (enabled) → sayfaya her girişte sunucudaki CANLI durum gelir (kalıcı sayaç).
    refetchOnMount: 'always',
    refetchInterval: (arg: any) => {
      const s = arg?.state?.data ?? arg;
      if (s?.state === 'running' || s?.import?.state === 'running') return 4000; // sorgu YA DA aktar sürüyor
      return efaturaSyncPollUntil > Date.now() ? 4000 : false;
    },
  });
  const efaturaSyncStatus: any = efaturaSyncStatusQ.data || null;
  // AKTAR (import) sunucu durumu — ekran değişip geri gelince de görünür (yerel state'e bağlı DEĞİL).
  //   Bayat koruması: son güncelleme 90sn'den eskiyse iş ölmüş say, şeridi gizle.
  const efaturaImportStatus: any = efaturaSyncStatus?.import || null;
  const efaturaImportRunning = !!efaturaImportStatus && efaturaImportStatus.state === 'running'
    && (!efaturaImportStatus.updatedAt || (Date.now() - new Date(efaturaImportStatus.updatedAt).getTime()) < 90000);
  const efaturaImportSrvDone = efaturaImportStatus ? (Number(efaturaImportStatus.processed || 0)) : 0;
  const efaturaImportSrvTotal = efaturaImportStatus ? (Number(efaturaImportStatus.total || 0)) : 0;
  const efaturaIsTransferred = (r: any) => {
    if (r?.hasAccountingDocument === true) return true;
    if (r?.hasAccountingDocument === false) return false;
    return Boolean(r?.documentId);
  };
  const efaturaDocumentStatus = (r: any) => {
    const raw = r?.rawJson && typeof r.rawJson === 'object' ? r.rawJson : {};
    return String(raw?.documentDownloadStatus || (r?.ublXmlRaw ? 'READY' : '')).toUpperCase();
  };
  // Arka plan belge indirme sayacı — satırların documentDownloadStatus'undan türetilir.
  //   PENDING_DOWNLOAD = TÜRMOB sorgusundan sonra arka planda iniyor. Bitene kadar (pending>0)
  //   "Aktar" pasif → TÜRMOB tek-oturum çakışması olmaz, görsel önceden iner → Aktar anında.
  const efaturaDownloadTotal = efaturaRows.length;
  const efaturaDownloadReady = efaturaRows.filter((r) => efaturaDocumentStatus(r) === 'READY').length;
  const efaturaDownloadPending = efaturaRows.filter((r) => efaturaDocumentStatus(r) === 'PENDING_DOWNLOAD').length;
  const efaturaDownloadMissing = efaturaRows.filter((r) => efaturaDocumentStatus(r) === 'MISSING').length;
  const efaturaDownloading = efaturaDownloadPending > 0;
  const efaturaCanImport = (r: any) => {
    if (efaturaIsTransferred(r)) return false;
    const raw = r?.rawJson && typeof r.rawJson === 'object' ? r.rawJson : {};
    return !/iptal|itiraz|red|cancel/i.test(`${raw?.approvalStatus || ''} ${raw?.iptalItiraz || ''}`);
  };
  const efaturaTransferableRows = efaturaRows.filter(efaturaCanImport);
  const efaturaTransferableIds = efaturaTransferableRows.map((r) => String(r.id || '').trim()).filter(Boolean);
  const efaturaSelectedIds = [...sel].filter((id) => efaturaTransferableIds.includes(id));
  // Aktarım (import) sayacı — satırların "aktarıldı mı" durumundan türetilir (indirme sayacı gibi).
  //   Aktar arka planda kademeli çalışır; bu sayaç "X / Y aktarıldı" diye dolar. Hedef = aktarılabilir
  //   (görseli READY olan) satırlar; görseli inmeyen (MISSING) satırlar transfer olamaz → hedefe katılmaz
  //   (yoksa sayaç 41/43'te takılırdı). Onlar "Durum"da "inemedi" olarak ayrı görünür.
  const efaturaTransferredCount = efaturaRows.filter((r) => efaturaIsTransferred(r)).length;
  const efaturaPendingImportable = efaturaTransferableRows.filter((r) => efaturaDocumentStatus(r) === 'READY').length;
  const efaturaTransferTotal = efaturaTransferredCount + efaturaPendingImportable;
  const toggleEfaturaAll = () => setSel(() => efaturaSelectedIds.length === efaturaTransferableIds.length ? new Set() : new Set(efaturaTransferableIds));
  useEffect(() => {
    setLastEfaturaSync(null);
    setSel(new Set());
  }, [source, taxpayerId, period, efaturaChannel]);
  const efaturaFetchMut = useMutation({
    mutationFn: (v: { provider: string }) => api.post('/fatura-muhasebelestirme/efatura-sync', {
      taxpayerId,
      direction: efaturaDirection,
      channel: efaturaChannel,
      period,
      ...(rangeFrom && rangeTo ? { dateFrom: rangeFrom, dateTo: rangeTo } : {}),
      providers: [v.provider],
      limit: 2000,
    }),
    onSuccess: (r: any) => {
      const data = r?.data || null;
      setLastEfaturaSync(data);
      if (data?.background) {
        // Turkcell gibi çok-faturalı: kopuk arka plan çekim. Durum ucunu bir süre poll et (ilerleme/bitiş görünsün).
        setEfaturaSyncPollUntil(Date.now() + 30 * 60 * 1000);
        setEfaturaPollUntil(Date.now() + 30 * 60 * 1000);
        toast.success('Sorgu arka planda basladi; ilerleme ve bitiş durumu ekranda gösterilecek.');
      } else if (data?.queued) {
        setEfaturaPollUntil(Date.now() + 5 * 60 * 1000);
        toast.success('Sorgu arka planda basladi; tablo otomatik yenilenecek.');
      } else {
        showFetchResult(data);
        // TÜRMOB sorgu listeyi anında döndürür; belgeler ARKA PLANDA iniyorsa hızlı poll'u
        //   koru (sayaç canlı dolsun, indirme bitince Aktar pasiflikten çıksın).
        const hasPending = Array.isArray(data?.providers) && data.providers.some((p: any) => Number(p?.pendingDocument || 0) > 0);
        setEfaturaPollUntil(hasPending ? Date.now() + 5 * 60 * 1000 : 0);
      }
      qc.invalidateQueries({ queryKey: ['fm-efatura-inbox'] });
      qc.invalidateQueries({ queryKey: ['fm2'] });
      [1200, 3000, 7000, 15000, 30000, 60000, 120000].forEach((ms) => {
        window.setTimeout(() => {
          qc.invalidateQueries({ queryKey: ['fm-efatura-inbox'] });
          qc.invalidateQueries({ queryKey: ['fm2'] });
        }, ms);
      });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'hata';
      if (/network error|failed to fetch|timeout|aborted/i.test(String(msg))) {
        setEfaturaPollUntil(0);
        toast.error('Sorgu tamamlanamadi: baglanti koptu. Tekrar Sorgula ile deneyin.');
        qc.invalidateQueries({ queryKey: ['fm-efatura-inbox'] });
        return;
      }
      toast.error('e-Fatura sorgusu başlatılamadı: ' + msg);
    },
  });

  useEffect(() => {
    const e: any = efaturaFetchMut.error;
    if (!e) return;
    const msg = e?.response?.data?.message || e?.message || 'hata';
    if (/network error|failed to fetch|timeout|aborted/i.test(String(msg))) {
      setLastEfaturaSync({ failed: 1, providers: [{ provider: activeEfaturaProvider?.provider || 'TURMOB_EFATURA', label: activeEfaturaProvider?.label || 'TURMOB e-Fatura', status: 'FAILED', reason: 'Baglanti koptu; sorgu tamamlanmadi.' }] });
      return;
    }
    setLastEfaturaSync({ failed: 1, providers: [{ provider: activeEfaturaProvider?.provider || 'TURMOB_EFATURA', label: activeEfaturaProvider?.label || 'TURMOB e-Fatura', status: 'FAILED', reason: msg }] });
  }, [efaturaFetchMut.error, activeEfaturaProvider?.provider, activeEfaturaProvider?.label]);

  const efaturaImportMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/efatura-inbox/import', {
      taxpayerId,
      direction: efaturaDirection,
      channel: efaturaChannel,
      period,
      ids: efaturaSelectedIds.length ? efaturaSelectedIds : efaturaTransferableIds,
      limit: 2000,
      background: true,
    }),
    onSuccess: (r: any) => {
      const data = r?.data || {};
      if (data?.queued) {
        setEfaturaPollUntil(Date.now() + 5 * 60 * 1000);
        setLastEfaturaSync({
          providers: [{
            provider: activeEfaturaProvider?.provider || 'TURMOB_EFATURA',
            label: activeEfaturaProvider?.label || 'TURMOB e-Fatura',
            status: 'QUEUED_EFATURA_IMPORT',
            reason: data?.reason || 'Faturalar bekleyen listeye aktariliyor (eslestirme yok); bitince "AI ile oku" ile eslestirin.',
          }],
        });
        toast.success('Faturalar aktariliyor (eslestirme yapilmadan). Bitince "AI ile oku" ile hesap/cari/tevkifat eslestir.');
        setSel(new Set());
        qc.invalidateQueries({ queryKey: ['fm-efatura-inbox'] });
        qc.invalidateQueries({ queryKey: ['fm2'] });
        [1200, 3000, 7000, 15000, 30000, 60000, 120000].forEach((ms) => {
          window.setTimeout(() => {
            qc.invalidateQueries({ queryKey: ['fm-efatura-inbox'] });
            qc.invalidateQueries({ queryKey: ['fm2'] });
          }, ms);
        });
        return;
      }
      setEfaturaPollUntil(0);
      const imported = Number(r?.data?.imported || 0);
      const processed = Number(r?.data?.processed || 0);
      const failed = Number(r?.data?.failed || 0);
      if (failed > 0) toast.warning(`${imported} fatura aktarildi (eslestirme yok — "AI ile oku" ile eslestirin), ${failed} fatura belge indirilemedigi icin atlandi.`);
      else toast.success(imported > 0 ? `${imported} fatura bekleyen listeye aktarildi (eslestirme yok). "AI ile oku" ile hesap/cari/tevkifat eslestir.` : `${processed} fatura kontrol edildi; yeni aktarim yok.`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['fm-efatura-inbox'] });
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('e-Fatura aktarimi baslatilamadi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const efaturaStatusRows: any[] = Array.isArray(lastEfaturaSync?.providers) ? lastEfaturaSync.providers : [];
  const efaturaChannelTitle = efaturaChannel === 'OUT_EARSIV'
    ? 'Satış e-Arşiv'
    : efaturaChannel === 'OUT_EFATURA'
      ? 'Satış e-Fatura'
      : 'Alış e-Fatura';
  const efaturaProviderLabel = (p: any = activeEfaturaProvider) => {
    const provider = String(p?.provider || activeEfaturaProvider?.provider || '').toUpperCase();
    if (provider === 'TURMOB_EFATURA') return `TURMOB ${efaturaChannelTitle}`;
    return p?.label || p?.provider || 'Entegrator';
  };
  const efaturaStatusTone = efaturaStatusRows.some((p) => String(p?.status || '').toUpperCase() === 'FAILED' || Number(p?.failed || 0) > 0)
    ? 'bad'
    : efaturaStatusRows.some((p) => Number(p?.fetched || 0) === 0)
      ? 'warn'
      : 'ok';
  const efaturaStatusText = (p: any) => {
    const st = String(p?.status || '').toUpperCase();
    if (st === 'FAILED') return p?.reason || 'Sorgu hatasi';
    if (st === 'SKIPPED') return p?.reason || 'Atlandi';
    if (st === 'QUEUED_EFATURA_SYNC') return p?.reason || 'Sorgu arka planda calisiyor; tablo otomatik yenilenecek.';
    if (st === 'QUEUED_EFATURA_IMPORT') return p?.reason || 'Aktarim arka planda calisiyor; tablo otomatik yenilenecek.';
    // CANLI durum — satirlardan turetilir (sync-anindaki "0 indirildi" yanıltıcısı yerine gercek sayilar;
    //   liste (efaturaRows) ve "X faturayi aktar" butonu ile AYNI kumeyi sayar → tutarli).
    const parts = [
      `${efaturaRows.length} fatura listede`,
      `${efaturaDownloadReady} belge hazir`,
      efaturaDownloadPending ? `${efaturaDownloadPending} indiriliyor` : null,
      efaturaDownloadMissing ? `${efaturaDownloadMissing} inemedi` : null,
    ].filter(Boolean);
    // Backend teşhis uyarısı (0-sonuç: liste boş mu döndü, süzgeç mi eledi) varsa GÖSTER.
    return [String(p?.warning || '') || null, parts.join(' · ')].filter(Boolean).join(' — ');
  };
  const efaturaQueuedSync = efaturaStatusRows.some((p) => String(p?.status || '').toUpperCase() === 'QUEUED_EFATURA_SYNC');
  const efaturaQueuedImport = efaturaStatusRows.some((p) => String(p?.status || '').toUpperCase() === 'QUEUED_EFATURA_IMPORT');
  const efaturaQueuedActive = efaturaPollUntil > Date.now() && (efaturaQueuedSync || efaturaQueuedImport);
  const efaturaOverlayBusy = efaturaFetchMut.isPending || efaturaImportMut.isPending || efaturaQueuedActive;
  useEffect(() => {
    const queued = efaturaStatusRows.some((p) => String(p?.status || '').toUpperCase() === 'QUEUED_EFATURA_SYNC');
    if (!queued || efaturaFetchMut.isPending || efaturaImportMut.isPending || efaturaRows.length === 0) return;
    setEfaturaPollUntil(0);
    setLastEfaturaSync({
      providers: [{
        provider: activeEfaturaProvider?.provider || 'TURMOB_EFATURA',
        label: activeEfaturaProvider?.label || 'TURMOB e-Fatura',
        status: 'SUCCESS',
        fetched: efaturaRows.length,
        downloaded: efaturaRows.filter((row: any) => {
          const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
          return String(raw?.documentDownloadStatus || '').toUpperCase() === 'READY';
        }).length,
        added: 0,
        updated: 0,
        skipped: efaturaRows.filter((row: any) => efaturaIsTransferred(row)).length,
        missingDocument: efaturaRows.filter((row: any) => {
          const raw = row?.rawJson && typeof row.rawJson === 'object' ? row.rawJson : {};
          return String(raw?.documentDownloadStatus || '').toUpperCase() === 'MISSING';
        }).length,
        failed: 0,
      }],
    });
  }, [efaturaRows, efaturaStatusRows, efaturaFetchMut.isPending, efaturaImportMut.isPending, activeEfaturaProvider?.provider, activeEfaturaProvider?.label]);

  useEffect(() => {
    if (!efaturaQueuedImport || efaturaFetchMut.isPending || efaturaImportMut.isPending || efaturaInboxQ.isFetching) return;
    if (efaturaRows.length === 0) return;
    // Import BİTENE kadar "aktarılıyor" kalsın: aktarılabilir (görseli READY, henüz aktarılmamış) satır
    //   varsa daha bitmedi → sayaç dolmaya devam etsin (erken SUCCESS'e geçip kapanmasın).
    if (efaturaPendingImportable > 0) return;
    const transferred = efaturaRows.filter((row: any) => efaturaIsTransferred(row)).length;
    const missingDocument = efaturaRows.filter((row: any) => efaturaDocumentStatus(row) === 'MISSING').length;
    if (transferred === 0 && missingDocument === 0) return;
    setEfaturaPollUntil(0);
    setLastEfaturaSync({
      providers: [{
        provider: activeEfaturaProvider?.provider || 'TURMOB_EFATURA',
        label: activeEfaturaProvider?.label || 'TURMOB e-Fatura',
        status: 'SUCCESS',
        fetched: efaturaRows.length,
        downloaded: transferred,
        added: 0,
        updated: 0,
        skipped: transferred,
        missingDocument,
        failed: 0,
      }],
    });
  }, [efaturaQueuedImport, efaturaRows, efaturaFetchMut.isPending, efaturaImportMut.isPending, efaturaInboxQ.isFetching, activeEfaturaProvider?.provider, activeEfaturaProvider?.label]);

  return (
    <section className="screen sorgu-screen">
      <div className="h2">{source === 'earsiv' ? 'GIB e-Arşiv Portal Sorgusu' : 'e-Fatura Entegratör Sorgusu'}</div>

      <div className="card daterange">
        <span className="drlabel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          Tarih aralığı
        </span>
        <div className="drio">
          <input className="dmi" type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
          <span className="drsep">—</span>
          <input className="dmi" type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
        </div>
        {(rangeFrom || rangeTo) && (
          <button type="button" className="btn sm ghost" onClick={() => { setRangeFrom(''); setRangeTo(''); }}>Temizle</button>
        )}
        {rangeInvalid ? (
          <span className="drmsg err">Başlangıç tarihi bitişten sonra olamaz — düzeltmeden sorgulanamaz.</span>
        ) : rangePartial ? (
          <span className="drmsg warn">Aralık için İKİ tarih de gerekli — tek tarihle aralık sorguya gitmez, üstteki dönem (ay) kullanılır.</span>
        ) : (
          <span className="drmsg hint">Boş bırakılırsa üstteki dönem (ay) kullanılır.</span>
        )}
      </div>

      {source === 'earsiv' ? (
        <div className={`card sourcepanel ${(earsivOverlayBusy || earsivJobRunning) ? 'isbusy' : ''}`}>
          <div className="ch sourcehead">
            <span className="mu">{earsivJobRunning ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0891b2', fontWeight: 600 }}><span className="qspin" /> Faturalar çekiliyor…</span> : lastJob ? `Son iş: ${lastJob.status} · ${fmtDate(lastJob.updatedAt || lastJob.createdAt)}` : 'Henüz sorgu yok'}</span>
            <div className="sp" />
            <button className="btn sm fetch" disabled={!taxpayerId || rangeInvalid || sorgulaMut.isPending || waitForFirstRows} title={rangeInvalid ? 'Tarih aralığı hatalı: başlangıç bitişten sonra' : undefined} onClick={() => sorgulaMut.mutate()}><Ico html={I.sync} size={13} /> {sorgulaMut.isPending ? 'Sorgulanıyor…' : 'Sorgula'}</button>
            <button className="btn sm primary" disabled={!taxpayerId || aktarMut.isPending || waitForFirstRows || processable.length === 0} onClick={() => aktarMut.mutate()}><Ico html={I.download} size={13} /> {aktarMut.isPending ? 'Aktarılıyor…' : `${selectedRefs.length ? selectedRefs.length : processable.length} faturayı aktar`}</button>
            <button className="btn sm ghost" disabled={!taxpayerId || syncMut.isPending || rows.length === 0} onClick={() => syncMut.mutate()}><Ico html={I.checkSm} size={13} /> Durumu eşitle</button>
          </div>
          <div className="sourcehint">İptal, itirazlı veya reddedilmiş faturalar tabloda görünür ama aktarıma alınmaz.</div>
          {(earsivQ.isError || jobsQ.isError) && (
            <div className="yuklenemedi">
              <span><Ico html={I.info} size={14} /> Liste alınamadı (bağlantı/sunucu hatası) — "kayıt yok" demek değil.</span>
              <button className="btn sm" onClick={() => { earsivQ.refetch(); jobsQ.refetch(); }}><Ico html={I.sync} size={12} /> Tekrar dene</button>
            </div>
          )}
          <div className="sourcetablewrap">
            {earsivOverlayBusy && (
              <div className="queryveil">
                <div className="querydoc" aria-hidden="true"><span /><i /><i /><i /></div>
                <b>{aktarMut.isPending ? 'Faturalar aktariliyor...' : 'Faturalar getiriliyor...'}</b>
              </div>
            )}
            <table className="sourcetable earsivtable">
              <thead>
                <tr>
                  <th><Check checked={processable.length > 0 && selectedRefs.length === processable.length} onToggle={toggleAll} /></th>
                  <th>Alıcı</th><th>VKN/TCKN</th><th>Belge No</th><th>Tarih</th><th>Onay</th><th>İptal/İtiraz</th><th>Görsel</th><th>Aktarım</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={!r.isProcessable ? 'blocked' : r.aktarildi ? 'done' : ''}>
                    <td>
                      {r.isProcessable && !r.aktarildi ? (
                        <Check checked={sel.has(r.sourceRefId)} onToggle={() => toggle(r.sourceRefId)} />
                      ) : (
                        <Check checked={false} disabled title={r.aktarildi ? 'Zaten aktarilmis' : 'Aktarima alinmaz'} />
                      )}
                    </td>
                    <td className="partyname">{r.buyerName || '—'}</td>
                    <td>{r.buyerVkn || '—'}</td>
                    <td>{r.belgeNo || r.referenceNo || '—'}</td>
                    <td>{fmtDate(r.issuedAt)}</td>
                    <td className="plainstatus">{r.onayDurumu || '—'}</td>
                    <td>{r.iptalDurumu || 'Yok'}</td>
                    <td>
                      {r.muhasebeBelgeId ? (
                        <span className="eye" onClick={() => openDocFile(r.muhasebeBelgeId)} title="Fatura görselini aç" style={{ color: '#0891b2' }}><Ico html={I.eye} size={15} /></span>
                      ) : '—'}
                    </td>
                    <td>
                      {r.aktarildi ? (
                        <span title="Luca'ya aktarıldı" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#15803d', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }}>✓ Aktarıldı</span>
                      ) : r.zatenVar ? (
                        <span title="Muhasebeleştirildi — Luca'ya henüz aktarılmadı" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#b8862b', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }}>◐ Muhasebe</span>
                      ) : (
                        <span title="Henüz muhasebeleştirilmedi / aktarılmadı" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#94a3b8', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>× Yok</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={12} className="emptyrow">{
                    !taxpayerId
                      ? 'Önce mükellef seç.'
                      : lastJob && /fail/i.test(String(lastJob.status || ''))
                        ? `Son sorgu başarısız oldu${(lastJob as any)?.errorMessage ? `: ${(lastJob as any).errorMessage}` : ''} — GİB'e ulaşılamamış olabilir, tekrar deneyin.`
                        : lastJob && /done|success/i.test(String(lastJob.status || ''))
                          ? 'GİB bu dönem için e-Arşiv faturası döndürmedi (0 kayıt). Mükellef bu dönemde GİB portalından e-Arşiv kesmediyse (entegratör/e-Fatura kullanıyorsa) bu normaldir; kestiyse tarih aralığını kontrol edip tekrar deneyin.'
                          : 'Önce Sorgula ile GIB listesini getir.'
                  }</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`card sourcepanel ${efaturaOverlayBusy ? 'isbusy' : ''}`}>
          <div className="ch sourcehead">
            <div className="segmini">
              <button className={efaturaChannel === 'IN_EFATURA' ? 'on' : ''} onClick={() => setEfaturaChannel('IN_EFATURA')}>Alış e-Fatura</button>
              <button className={efaturaChannel === 'OUT_EFATURA' ? 'on' : ''} onClick={() => setEfaturaChannel('OUT_EFATURA')}>Satış e-Fatura</button>
              <button className={efaturaChannel === 'OUT_EARSIV' ? 'on' : ''} onClick={() => setEfaturaChannel('OUT_EARSIV')}>Satış e-Arşiv</button>
            </div>
          </div>
          <div className="sourcebar">
            <div>
              <b>{efaturaProviderLabel(activeEfaturaProvider) || 'Entegrator yok'}</b>
              <span>{providerConnected(activeEfaturaProvider) ? 'Kimlik bilgisi hazir' : 'Entegratorler ekranindan sifre tanimlanmali'}</span>
            </div>
            <button className="btn sm fetch" disabled={!taxpayerId || rangeInvalid || !providerConnected(activeEfaturaProvider) || efaturaOverlayBusy} title={rangeInvalid ? 'Tarih aralığı hatalı: başlangıç bitişten sonra' : undefined} onClick={() => efaturaFetchMut.mutate({ provider: activeEfaturaProvider.provider })}>
              <Ico html={I.sync} size={13} /> {(efaturaFetchMut.isPending || efaturaQueuedSync) ? 'Sorgulaniyor...' : 'Sorgula'}
            </button>
            <button className="btn sm primary" disabled={!taxpayerId || efaturaOverlayBusy || efaturaDownloading || efaturaTransferableRows.length === 0} onClick={() => efaturaImportMut.mutate()} title={efaturaDownloading ? 'Belgeler iniyor; bitince aktarabilirsin (görseller önceden inecek)' : undefined}>
              <Ico html={I.download} size={13} /> {efaturaDownloading ? 'Belgeler iniyor…' : (efaturaImportMut.isPending || efaturaQueuedImport) ? 'Aktariliyor...' : `${efaturaSelectedIds.length ? efaturaSelectedIds.length : efaturaTransferableRows.length} faturayi aktar`}
            </button>
          </div>
          {efaturaDownloading && (
            <div className="efdownbar">
              <span className="efspin" aria-hidden="true" />
              <span className="eftext">Belgeler indiriliyor… <b>{efaturaDownloadReady}</b> / {efaturaDownloadTotal} hazır{efaturaDownloadMissing ? ` · ${efaturaDownloadMissing} inemedi` : ''}</span>
              <span className="eftrack"><span className="effill" style={{ width: `${efaturaDownloadTotal ? Math.round((efaturaDownloadReady / efaturaDownloadTotal) * 100) : 0}%` }} /></span>
            </div>
          )}
          {/* AKTAR ŞERİDİ: SUNUCU durumundan beslenir (efaturaImportRunning) → sayfayı değiştirip geri
              gelince de görünür. Yerel isPending/queued yalnız ilk anı köprüler; sonra sunucu sayacı. */}
          {!efaturaDownloading && (efaturaImportMut.isPending || efaturaQueuedImport || efaturaImportRunning) && (
            <div className="efdownbar import">
              <span className="efspin" aria-hidden="true" />
              {efaturaImportRunning && efaturaImportSrvTotal > 0
                ? <>
                    <span className="eftext">Faturalar aktarılıyor… <b>{efaturaImportSrvDone}</b> / {efaturaImportSrvTotal} işlendi (eşleştirme yok — bitince "AI ile oku")</span>
                    <span className="eftrack"><span className="effill" style={{ width: `${Math.min(100, Math.round((efaturaImportSrvDone / efaturaImportSrvTotal) * 100))}%` }} /></span>
                  </>
                : <>
                    <span className="eftext">Faturalar aktarılıyor… <b>{efaturaTransferredCount}</b> / {efaturaTransferTotal} muhasebeye geçti</span>
                    <span className="eftrack"><span className="effill" style={{ width: `${efaturaTransferTotal ? Math.round((efaturaTransferredCount / efaturaTransferTotal) * 100) : 0}%` }} /></span>
                  </>}
            </div>
          )}
          {/* ARKA PLAN ÇEKİM DURUMU: Sorgula'ya basar basmaz (yerel poll) VE sunucu 'running' iken görünür
              → sayfayı değiştirip geri gelince de sunucu durumundan devam eder. */}
          {['TURKCELL', 'TURMOB_EFATURA'].includes(String(activeEfaturaProvider?.provider)) && (efaturaSyncPollUntil > Date.now() || efaturaSyncStatus?.state === 'running') && (!efaturaSyncStatus || (efaturaSyncStatus.state !== 'done' && efaturaSyncStatus.state !== 'error')) && (
            <div className={`efdownbar ${efaturaSyncStatus?.rateLimited ? 'import' : ''}`}>
              <span className="efspin" aria-hidden="true" />
              <span className="eftext">
                {efaturaSyncStatus?.rateLimited
                  ? <><b>Sorgu sürüyor — TAMAMLANMADI.</b> Hız sınırı uygulandı; otomatik bekleyip devam ediyor. Şu ana kadar <b>{efaturaRows.length}</b> fatura indirildi.</>
                  : <>Sorgulanıyor… entegratörden faturalar çekiliyor. Şu ana kadar <b>{efaturaRows.length}</b> fatura geldi. Bitince burada belirtilecek.</>}
              </span>
            </div>
          )}
          {['TURKCELL', 'TURMOB_EFATURA'].includes(String(activeEfaturaProvider?.provider)) && efaturaSyncStatus && efaturaSyncStatus.state === 'done' && efaturaSyncPollUntil > Date.now() && (
            <div className="providerdiag ok">
              <b>Durum</b>
              <span>Sorgu tamamlandı — dönemdeki tüm faturalar çekildi ({efaturaRows.length} fatura).</span>
            </div>
          )}
          {['TURKCELL', 'TURMOB_EFATURA'].includes(String(activeEfaturaProvider?.provider)) && efaturaSyncStatus && efaturaSyncStatus.state === 'error' && efaturaSyncPollUntil > Date.now() && (
            <div className="providerdiag err">
              <b>Durum</b>
              <span>Sorgu tamamlanamadı ({efaturaRows.length} fatura indirildi). Bir süre sonra tekrar Sorgula — inmeyenler tamamlanır.</span>
            </div>
          )}
          {efaturaStatusRows.length > 0 && (
            <div className={`providerdiag ${efaturaStatusTone}`}>
              <b>Durum</b>
              {efaturaStatusRows.map((p, i) => (
                <span key={`${p?.provider || i}-${i}`}>
                  {efaturaProviderLabel(p)}: {efaturaStatusText(p)}
                </span>
              ))}
            </div>
          )}
          {efaturaInboxQ.isError && (
            <div className="yuklenemedi">
              <span><Ico html={I.info} size={14} /> Liste alınamadı (bağlantı/sunucu hatası) — "kayıt yok" demek değil.</span>
              <button className="btn sm" onClick={() => efaturaInboxQ.refetch()}><Ico html={I.sync} size={12} /> Tekrar dene</button>
            </div>
          )}
          <div className="sourcetablewrap efatura">
            {efaturaOverlayBusy && (
              <div className="queryveil">
                <div className="querydoc" aria-hidden="true"><span /><i /><i /><i /></div>
                <b>{(efaturaImportMut.isPending || efaturaQueuedImport) ? 'Faturalar aktariliyor...' : 'Faturalar getiriliyor...'}</b>
              </div>
            )}
            <table className="sourcetable">
              <thead>
                <tr>
                  <th><Check checked={efaturaTransferableIds.length > 0 && efaturaSelectedIds.length === efaturaTransferableIds.length} disabled={efaturaTransferableIds.length === 0} onToggle={toggleEfaturaAll} /></th>
                  <th>Entegratör</th><th>Unvan</th><th>VKN/TCKN</th><th>Belge No</th><th>Tarih</th><th>Tür</th><th>Onay</th><th>Aktarım</th>
                </tr>
              </thead>
              <tbody>
                {efaturaRows.map((r) => {
                  const raw = r.rawJson || {};
                  const title = efaturaDirection === 'OUT' ? (raw.receiverTitle || raw.alici || r.receiverVkn) : (r.senderTitle || raw.senderTitle || raw.satici);
                  const taxNo = efaturaDirection === 'OUT' ? (r.receiverVkn || raw.receiverVkn || raw.aliciVergiNo) : (r.senderVkn || raw.senderVkn || raw.saticiVergiNo);
                  const approval = raw.onayDurumu || raw.approvalStatus || raw.status || raw.invoiceStatus || '—';
                  const transferred = efaturaIsTransferred(r);
                  const docStatus = efaturaDocumentStatus(r);
                  const missingOriginal = docStatus === 'MISSING' || docStatus === 'SUMMARY_ONLY';
                  const rowId = String(r.id || '').trim();
                  const selectable = efaturaCanImport(r) && !!rowId;
                  return (
                    <tr key={r.id} className={`${transferred ? 'done' : ''}${missingOriginal ? ' missingdoc' : ''}`}>
                      <td>
                        <Check
                          checked={selectable && sel.has(rowId)}
                          disabled={!selectable}
                          title={transferred ? 'Zaten aktarilmis' : missingOriginal ? 'Aktarimda orijinal belge yeniden indirilecek' : selectable ? 'Aktarim icin sec' : 'Satir kimligi yok'}
                          onToggle={() => toggle(rowId)}
                        />
                      </td>
                      <td>{r.entegrator}</td>
                      <td className="partyname">{title || '—'}</td>
                      <td>{taxNo || '—'}</td>
                      <td>{r.faturaNo || '—'}</td>
                      <td>{fmtDate(r.faturaDate)}</td>
                      <td>{r.invoiceProfile || 'e-Fatura'}</td>
                      <td className="plainstatus">{approval}</td>
                      <td>
                        <span className={`transferstate ${transferred ? 'ok' : 'no'}`} title={transferred ? 'Aktarıldı' : missingOriginal ? 'Orijinal belge indirilemedi' : 'Aktarılmadı'} aria-label={transferred ? 'Aktarıldı' : 'Aktarılmadı'}>
                          {transferred ? <span className="okico">✓</span> : <span className="xico">×</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!efaturaRows.length && (
                  (efaturaInboxQ.isLoading || (efaturaInboxQ.isFetching && !efaturaInboxQ.data))
                    // İLK YÜKLEME (kullanıcı bulgusu #10): ekran ÖNCE boş "sorgu satırı yok" flaşlıyordu →
                    //   veri gelene kadar boş mesaj yerine yükleniyor göster; mükellef/dönem değişince de böyle.
                    ? <tr><td colSpan={9} className="emptyrow loadingrow">Faturalar yükleniyor…</td></tr>
                    : <tr><td colSpan={9} className="emptyrow">{taxpayerId ? `Bu yönde ${efaturaChannelTitle} sorgu satırı yok. Entegratör satırından Sorgula ile getir.` : 'Önce mükellef seç.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ScreenMukellefler({ taxpayers, period, onOpen }: { taxpayers: any[]; period: string; onOpen: (id: string) => void }) {
  const sumQ = useQuery({
    queryKey: ['fm2', 'per-taxpayer', period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/per-taxpayer-summary', { params: { period } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
  });
  const rows: any[] = sumQ.data || [];
  const byId = new Map(rows.map((r) => [r.taxpayerId, r]));
  const [q, setQ] = useState('');
  const pendingOf = (s: any) => Number(s.pendingAlis || 0) + Number(s.pendingSatis || 0);
  const list = taxpayers
    .filter((t) => !q.trim() || taxpayerLabel(t).toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')))
    .map((t) => ({ t, s: byId.get(t.id) || {} }))
    .sort((a, b) => taxpayerLabel(a.t).localeCompare(taxpayerLabel(b.t), 'tr'));
  const tot = rows.reduce((acc, r) => ({
    pending: acc.pending + pendingOf(r),
    posted: acc.posted + Number(r.postedToLuca || 0),
    issue: acc.issue + Number(r.hasIssue || 0),
    attention: acc.attention + ((pendingOf(r) > 0 || Number(r.hasIssue || 0) > 0) ? 1 : 0),
  }), { pending: 0, posted: 0, issue: 0, attention: 0 });

  return (
    <section className="screen">
      <div className="mgrid">
        <div className="mcard" style={{ ['--mc' as any]: '#2563eb' }}>
          <div className="mci" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          </div>
          <div className="ml">Bekleyen belge</div><div className="mv">{tot.pending}</div>
        </div>
        <div className="mcard" style={{ ['--mc' as any]: '#0d9488' }}>
          <div className="mci" style={{ background: '#f0fdfa', color: '#0d9488' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <div className="ml">Luca'ya aktarılan</div><div className="mv">{tot.posted}</div>
        </div>
        <div className="mcard" style={{ ['--mc' as any]: '#e5484d' }}>
          <div className="mci" style={{ background: '#fff1f1', color: '#e5484d' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          </div>
          <div className="ml">Sorunlu (kontrol)</div><div className="mv" style={{ color: tot.issue > 0 ? '#e5484d' : undefined }}>{tot.issue}</div>
        </div>
        <div className="mcard" style={{ ['--mc' as any]: '#d97706' }}>
          <div className="mci" style={{ background: '#fffbeb', color: '#d97706' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </div>
          <div className="ml">Dikkat gereken</div><div className="mv" style={{ color: tot.attention > 0 ? '#d97706' : undefined }}>{tot.attention}</div>
        </div>
      </div>
      <div className="card">
        <div className="ch">
          <h3>{list.length} mükellef <span style={{ fontWeight: 400, color: 'var(--faint)', fontSize: 12 }}>· {periodLabel(period)}</span></h3>
          <div className="sp" />
          <div className="mukara">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input placeholder="Mükellef ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <table className="mktbl">
          <thead>
            <tr>
              <th style={{ width: 6 }} />
              <th>Mükellef</th>
              <th>Defter</th>
              <th className="num">Bekleyen</th>
              <th className="num">Onaylı</th>
              <th className="num">Luca</th>
              <th className="num">Sorunlu</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {list.map(({ t, s }) => {
              const pending = Number(s.pendingAlis || 0) + Number(s.pendingSatis || 0);
              const issue = Number(s.hasIssue || 0);
              const posted = Number(s.postedToLuca || 0);
              const approved = Number(s.approvedAlis || 0) + Number(s.approvedSatis || 0);
              const rowState = issue > 0 ? 'issue' : pending > 0 ? 'pending' : 'ok';
              const defterLabel = /i[şs]letme|defter.?beyan|basit/i.test(`${t.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`) ? 'İşletme' : t.defterTuru ? 'Bilanço' : '';
              return (
                <tr key={t.id} className={`mktr mktr-${rowState}`} onClick={() => onOpen(t.id)}>
                  <td><span className={`mkstatus mkstatus-${rowState}`}>{rowState === 'issue' ? '!' : pending > 0 ? pending : '✓'}</span></td>
                  <td>
                    <b className="mkfirma">{taxpayerLabel(t)}</b>
                    {t.taxNumber ? <small className="mkvkn">VKN {t.taxNumber}</small> : null}
                  </td>
                  <td>{defterLabel ? <span className="mkdef">{defterLabel}</span> : null}</td>
                  <td className="num">{pending > 0 ? <span className="mknum mknum-pending">{pending}</span> : <span className="faint">—</span>}</td>
                  <td className="num">{approved > 0 ? <span className="mknum mknum-ok">{approved}</span> : <span className="faint">—</span>}</td>
                  <td className="num">{posted > 0 ? <span className="mknum mknum-posted">{posted}</span> : <span className="faint">—</span>}</td>
                  <td className="num">{issue > 0 ? <span className="mknum mknum-issue">{issue}</span> : <span className="faint">—</span>}</td>
                  <td><button className="mkbtn" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}>Aç →</button></td>
                </tr>
              );
            })}
            {!sumQ.isLoading && list.length === 0 && (
              <tr><td colSpan={8}><div className="empty">Mükellef bulunamadı.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ===================== EKRAN: EŞLEŞTİRME KURALLARI ===================== */
function ScreenKurallar({ taxpayerId, period }: { taxpayerId: string; period: string }) {
  const rulesQ = useQuery({
    queryKey: ['fm2', 'vendor-memory', taxpayerId],
    queryFn: () =>
      api
        .get('/vendor-memory', { params: { taxpayerId: taxpayerId || undefined, limit: 200 } })
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.items || [])))
        .catch(() => []),
  });
  const rules: any[] = rulesQ.data || [];

  const qc = useQueryClient();
  const [rVkn, setRVkn] = useState('');
  const [rName, setRName] = useState('');
  const [rCode, setRCode] = useState('');
  const [rRate, setRRate] = useState(''); // '' = tüm oranlar, '1'/'10'/'20' = o orana özel
  const ruleMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/vendor-rule', { taxpayerId, vendorVkn: rVkn, vendorName: rName || undefined, accountCode: rCode, kdvOrani: rRate || undefined }),
    onSuccess: (r: any) => {
      const n = r?.data?.applied;
      toast.success(`Kural kaydedildi${n != null ? ` · ${n} belgeye uygulandı` : ''}`);
      setRVkn(''); setRName(''); setRCode(''); setRRate('');
      qc.invalidateQueries({ queryKey: ['fm2', 'vendor-memory'] }); qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Kural kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const delRuleMut = useMutation({
    mutationFn: (decisionId: string) => api.delete(`/fatura-muhasebelestirme/vendor-rule/${decisionId}`),
    onSuccess: () => { toast.success('Kural silindi'); qc.invalidateQueries({ queryKey: ['fm2', 'vendor-memory'] }); },
    onError: (e: any) => toast.error('Silinemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });

  // Satır-içi "Kod ata" — o satıcı için hesap kodu seç, anında kural olarak kaydet (öğrenilir).
  const [assignId, setAssignId] = useState<string>('');
  const planQ = useQuery({
    queryKey: ['fm2', 'account-plan-pick', taxpayerId],
    queryFn: () => api.get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, limit: 5000 } }).then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
    enabled: !!taxpayerId,
  });
  const accountPlan: any[] = planQ.data || [];
  const assignMut = useMutation({
    mutationFn: (v: { vkn: string; name: string; code: string }) => api.post('/fatura-muhasebelestirme/vendor-rule', { taxpayerId, vendorVkn: v.vkn, vendorName: v.name || undefined, accountCode: v.code }),
    onSuccess: (r: any) => { const n = r?.data?.applied; toast.success(`Kod atandı${n != null ? ` · ${n} belgeye uygulandı` : ''}`); setAssignId(''); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Atanamadı: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });

  const docsQ = useDocuments(taxpayerId, period);
  const docs: any[] = docsQ.data || [];
  const istisnalar = docs
    .filter((d) => {
      const du = deriveDurum(d);
      return du.k === 'miss' || du.k === 'warn';
    })
    .slice(0, 12);

  return (
    <section className="screen">
      <div className="h2">Eşleştirme Kuralları</div>
      <div className="sub">Bir belgeyi onayladığında sistem o satıcı + içerik için hesap kodunu <b>öğrenir</b>; sonraki benzer belgeleri otomatik eşleştirir. Aşağıda öğrenilmiş kurallar ve henüz kurala uymayan istisnalar var.</div>

      <div className="card">
        <div className="ch"><h3>Kural ekle</h3><div className="sp" /><span className="mu">satıcı VKN (+ istenirse KDV oranı) → hesap kodu · o satıcının bekleyen + sonraki faturalarına otomatik uygulanır</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 0.7fr 1fr auto', gap: 11, padding: '15px 16px', alignItems: 'end' }}>
          <div className="fld"><label>Satıcı VKN / TCKN</label><input value={rVkn} onChange={(e) => setRVkn(e.target.value)} placeholder="10–11 hane" /></div>
          <div className="fld"><label>Satıcı adı (opsiyonel)</label><input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="firma adı" /></div>
          <div className="fld"><label>KDV oranı</label>
            <select value={rRate} onChange={(e) => setRRate(e.target.value)} title="Bu kural sadece bu KDV oranlı faturalara uygulansın. 'Tüm oranlar' = ayrım yapma.">
              <option value="">Tüm oranlar</option>
              <option value="1">%1</option>
              <option value="10">%10</option>
              <option value="20">%20</option>
              <option value="0">%0</option>
            </select>
          </div>
          <div className="fld"><label>Hesap kodu</label><input value={rCode} onChange={(e) => setRCode(e.target.value)} placeholder="örn. 153.01.001" /></div>
          <button className="btn primary sm" style={{ height: 35 }} disabled={!taxpayerId || ruleMut.isPending || !rVkn.trim() || !rCode.trim()} onClick={() => ruleMut.mutate()} title={!taxpayerId ? 'Önce üstten mükellef seç' : ''}><Ico html={I.plus} size={13} /> {ruleMut.isPending ? 'Kaydediliyor…' : 'Kaydet'}</button>
        </div>
        {!taxpayerId && <div className="empty" style={{ padding: '4px 16px 14px' }}>Kural mükellefe göre tanımlanır — önce üstten bir mükellef seç.</div>}
        <div className="lrow" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}><Ico html={I.info} size={15} /><span style={{ fontSize: 12 }}>Bu kural <b>tahmin değildir</b> — yalnız senin verdiğin kodu o satıcının faturalarına uygular. Belge onayladıkça da otomatik öğrenir.</span></div>
      </div>

      <div className="card">
        <div className="ch"><h3>Öğrenilen kurallar{taxpayerId ? '' : ' (tüm mükellefler)'}</h3><div className="sp" /><span className="mu">{rulesQ.isLoading ? 'yükleniyor…' : `${rules.reduce((s: number, r: any) => s + (r.decisions || []).filter((d: any) => d.kararTipi === 'fatura' && /^\d/.test(String(d.kategori || ''))).length, 0)} kural`}</span></div>
        <div className="twrap">
          <table>
            <thead><tr><th>Satıcı / Alıcı</th><th>VKN</th><th>KDV Oranı</th><th>Hesap Kodu</th><th className="num">Onay</th><th>Son kullanım</th><th className="actcol" style={{ width: 40 }} /></tr></thead>
            <tbody>
              {rules.flatMap((r: any) => (r.decisions || [])
                .filter((d: any) => d.kararTipi === 'fatura' && /^\d/.test(String(d.kategori || '')))
                .sort((a: any, b: any) => (b.onayAdedi || 0) - (a.onayAdedi || 0))
                .map((d: any) => {
                  const rate = String(d.altKategori || '').replace(/[^0-9]/g, '');
                  return (
                    <tr key={d.id}>
                      <td className="firm"><b>{r.firmaUnvan || '(unvan yok)'}</b></td>
                      <td>{r.firmaKimlikNo || '—'}</td>
                      <td>{rate ? <span className="pill alis">%{rate}</span> : <span className="mu">Tüm oranlar</span>}</td>
                      <td><span className="hk">{d.kategori}</span></td>
                      <td className="num">{d.onayAdedi || 0}</td>
                      <td>{fmtDate(d.sonKullanim)}</td>
                      <td className="actcol"><span className="eye del" title="Bu kuralı sil" onClick={() => { if (window.confirm(`Kural silinsin mi?\n${r.firmaUnvan || r.firmaKimlikNo} · ${rate ? '%' + rate : 'tüm oranlar'} → ${d.kategori}`)) delRuleMut.mutate(d.id); }}><Ico html={I.trash} size={14} /></span></td>
                    </tr>
                  );
                }))}
              {!rulesQ.isLoading && rules.length === 0 && (
                <tr><td colSpan={7}><div className="empty">Henüz öğrenilmiş kural yok. Belge onayladıkça ya da yukarıdan kural ekledikçe burası dolar.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="ch"><h3>Kurala uymayan istisnalar</h3><span className="mu">{period} · eksik kod ya da içerik çelişkisi</span></div>
        {!docsQ.isLoading && istisnalar.length === 0 ? (
          <div className="empty">Bu dönemde istisna yok — tüm belgeler eşleşmiş görünüyor.</div>
        ) : (
          istisnalar.map((d) => {
            const du = deriveDurum(d);
            const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
            const firma = (sat ? d.customerName : d.vendorName) || '(firma yok)';
            const ini = firma.replace(/[^A-Za-zÇĞİÖŞÜ ]/g, '').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '??';
            return (
              <div key={d.id} className="lrow">
                <div className="ico">{ini}</div>
                <div className="lx"><b>{firma}</b> — {du.cat === 'eksik' ? `${du.t.toLocaleLowerCase('tr-TR')} — elle ya da öğrenmeyle atanmalı.` : du.cat === 'tutar' ? 'matrah/KDV okunamadı, tutar girilmeli.' : du.cat === 'okunamadi' ? 'belge okunamadı, tekrar oku.' : 'içerik geçmişle çelişiyor, kontrol gerekiyor.'} <small style={{ color: 'var(--faint)' }}>{d.belgeNo ? `· ${d.belgeNo}` : ''} · {fmtMoney(d.totalAmount)} ₺</small></div>
                {(() => {
                  const vkn = String((sat ? d.buyerVkn : d.sellerVkn) || '').replace(/\D/g, '');
                  const adi = (sat ? d.customerName : d.vendorName) || '';
                  if (!vkn) return null;
                  if (assignId === d.id) {
                    return (
                      <div className="kodatainl">
                        <div style={{ width: 220 }}><CodeSelect value={''} accounts={accountPlan} onChange={(code) => { if (code && !assignMut.isPending) assignMut.mutate({ vkn, name: adi, code }); }} /></div>
                        <button className="btn sm ghost" onClick={() => setAssignId('')}>İptal</button>
                      </div>
                    );
                  }
                  return <button className="btn sm primary" disabled={!taxpayerId} title={!taxpayerId ? 'Önce üstten mükellef seç' : 'Bu satıcıya hesap kodu ata (öğrenilir)'} onClick={() => setAssignId(d.id)}>Kod ata</button>;
                })()}
                <button className="btn sm" onClick={() => openDocFile(d.id)}>Belgeyi aç</button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/** Muhasebeleştir ekranında belgeyi (fatura görüntüsü/HTML) fişin yanında gösterir. */
function InlineBelge({ id }: { id: string }) {
  const [d, setD] = useState<any | null>(null);
  const [zoom, setZoom] = useState(1);   // çarpan: 1 = Sığdır = %100 (tüm fatura); 1.5 = %150 yakın
  const [fit, setFit] = useState(1);
  const [imgW, setImgW] = useState(0);   // resmin doğal genişliği → açık width ile tam sığdırma
  const [blobUrl, setBlobUrl] = useState(''); // XML data: URL → blob (same-origin, ölçülebilir + XSLT render)
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const contentWRef = useRef(0); // ölçülen içerik genişliği → panel yeniden boyutlanınca refit
  // TİTREME FIX (kullanıcı bulgusu 2026-08-11): kaydırma-çubuğu ↔ ResizeObserver ↔ fit SALINIMINI kes.
  //   iframe genişliğe sığınca çubuk çıkıp clientWidth'i ~15px oynatıyor → refit → yeniden salınım →
  //   sürekli titreme. Çözüm: (a) scrollbar-gutter:stable (çubuk yeri sabit rezerve; aşağıda bpview),
  //   (b) fit'i yalnız KAYDA DEĞER (≥0.02) değişimde uygula (mikro-salınımı yok say).
  const fitRef = useRef(1);
  const applyFit = (v: number) => {
    const nv = Math.min(2.4, Math.max(0.3, Number(v) || 1));
    if (Math.abs(nv - fitRef.current) < 0.02) return; // mikro değişim → yok say (titreme kaynağı)
    fitRef.current = nv;
    setFit(nv);
  };
  // HTML belge: belgeyi panonun GENİŞLİĞİNE sığdır (fit-to-width) → yanlarda boşluk
  // kalmaz, fatura tam genişlikte ve okunur görünür; uzunsa dikey kaydırılır.
  const measure = () => {
    const f = frameRef.current, w = wrapRef.current;
    if (!f || !w) return;
    try {
      const doc = f.contentDocument;
      if (!doc || !doc.body) return;
      // 1) İçeriğin gerçek genişliği = en geniş çocuk öğe (tablo/kapsayıcı).
      //    Eski "60px daraltma" tablolarda min-content'i şişirip fit'i küçültüyordu.
      f.style.width = '100%';
      let cw = 0;
      for (const ch of Array.from(doc.body.children) as any[]) {
        cw = Math.max(cw, ch.scrollWidth || 0, ch.offsetWidth || 0, ch.getBoundingClientRect?.().width || 0);
      }
      if (!cw) cw = Math.max(doc.body.scrollWidth || 0, doc.documentElement.scrollWidth || 0);
      cw = Math.min(Math.max(cw, 320), 2200);
      f.style.width = cw + 'px';
      // 2) İçerik yüksekliğine sığdır → kısa belgede altta boşluk kalmasın.
      const scrollH = Math.max(doc.body.scrollHeight || 0, doc.documentElement.scrollHeight || 0);
      if (scrollH > 40) f.style.height = Math.ceil(scrollH) + 'px';
      // 3) Genişliğe sığdır — GENİŞ belgeyi küçült; DAR fişi BÜYÜTME (en çok %100). Tam-ekran
      //    önizlemeyle tutarlı (kullanıcı isteği). Daha büyük için zoom (+) kullanılır.
      contentWRef.current = cw;
      const paneW = (w.clientWidth || 600) - 16;
      applyFit(paneW / cw);
    } catch { /* cross-origin */ }
  };
  // Panel yeniden boyutlanınca (Büyüt/Küçült/pencere) ölçülen içerik genişliğine göre yeniden sığdır.
  const refit = () => {
    const w = wrapRef.current, cw = contentWRef.current;
    if (!w || !cw) { measure(); return; }
    const paneW = (w.clientWidth || 600) - 16;
    applyFit(paneW / cw);
  };
  // Resim de genişliğe sığdırılır ama DAR fiş BÜYÜTÜLMEZ (en çok %100) — tam-ekran önizlemeyle
  // tutarlı; geniş resim panoya küçültülür. Daha büyük için zoom (+).
  const onImgLoad = (e: any) => {
    const w = wrapRef.current;
    const nw = e.currentTarget?.naturalWidth || 0;
    if (!w || !nw) return;
    setImgW(Math.ceil(nw));
    contentWRef.current = nw;
    const paneW = (w.clientWidth || 600) - 16;
    applyFit(paneW / nw);
  };
  // Görseller geç yüklendiğinden birkaç kez yeniden ölç.
  const onFrameLoad = () => { measure(); setTimeout(measure, 250); setTimeout(measure, 900); setTimeout(measure, 2000); };
  useEffect(() => {
    let alive = true;
    setD(null); setZoom(1); setFit(1); fitRef.current = 1; setImgW(0);
    api.get(`/fatura-muhasebelestirme/documents/${id}/file-url`)
      .then((r) => { if (alive) setD(r.data || {}); })
      .catch(() => { if (alive) setD({}); });
    return () => { alive = false; };
  }, [id]);
  // Belge paneli yeniden boyutlanınca (Büyüt/Küçült/pencere) faturayı OTOMATİK yeniden sığdır.
  useEffect(() => {
    const w = wrapRef.current;
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(refit); };
    let ro: any = null;
    if (w && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onResize); ro.observe(w); }
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); if (ro) ro.disconnect(); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  // XML (e-arşiv) data: URL'i blob URL'e çevir → same-origin olur, ölçüp sığdırabiliriz.
  useEffect(() => {
    setBlobUrl('');
    const u = (d && (typeof d.url === 'string' ? d.url : d.fileUrl)) || '';
    const mt = String(d?.mimeType || '');
    const xml = !!u && !mt.startsWith('image/') && !(typeof d?.inlineHtml === 'string' && d.inlineHtml) &&
      (/^data:(application|text)\/xml/i.test(u) || mt.includes('xml'));
    if (!xml || !/^data:/i.test(u)) return;
    let created = '';
    let alive = true;
    fetch(u).then((r) => r.blob()).then((b) => { if (!alive) return; created = URL.createObjectURL(b); setBlobUrl(created); }).catch(() => {});
    return () => { alive = false; if (created) setTimeout(() => URL.revokeObjectURL(created), 500); };
  }, [d]);
  if (!d) return <div className="belgebox"><div className="bpempty">Belge yükleniyor…</div></div>;
  const url = typeof d.url === 'string' ? d.url : typeof d.fileUrl === 'string' ? d.fileUrl : '';
  const html = typeof d.inlineHtml === 'string' ? d.inlineHtml : '';
  const isImg = !html && (
    (d.mimeType || '').startsWith('image/') ||
    /^data:image\//i.test(url) ||
    /\.(jpe?g|jpe|jfif|png|gif|webp|bmp|tiff?|heic|heif|avif)(\?|#|$)/i.test(url)
  );
  // e-Arşiv XML: PDF gibi ham iframe'e koymak yerine blob + ölç-ve-sığdır (boşluk olmasın)
  const isXml = !html && !isImg && !!url && (/^data:(application|text)\/xml/i.test(url) || (d.mimeType || '').includes('xml'));
  const isPdf = !html && !isImg && !isXml && !!url;
  // e-faturanın kendi iç kaydırmasını/yükseklik kilidini kapat → içerik düz aksın,
  // "ekran içinde ekran" (iç içe kaydırma) olmasın; gerçek yükseklik ölçülebilsin.
  const htmlDoc = html
    ? `<style>html,body{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important}</style>${html}`
    : '';
  // zoom = çarpan (1 = Sığdır = genişliğe sığdır). Gerçek ölçek = taban(fit/contain) × zoom.
  const appliedScale = (html || isXml || isImg ? fit : 1) * zoom;
  const canZoom = html || isImg || isXml;
  const dz = (delta: number) => setZoom((z) => Math.min(5, Math.max(0.25, Math.round((z + delta) * 100) / 100)));
  return (
    <div className="belgebox">
      <div className="bpbar">
        <span>Belge <span className="bphint">(çift tıkla → tam ekran)</span></span>
        <div className="bpzoom">
          {canZoom ? (
            <>
              <button type="button" onClick={() => dz(-0.25)} title="Uzaklaştır">−</button>
              <span className="bpz">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => dz(0.25)} title="Yakınlaştır">+</button>
              <button type="button" onClick={() => { setZoom(1); refit(); setTimeout(refit, 60); }} title="Faturayı ekrana sığdır">Sığdır</button>
            </>
          ) : null}
          <button type="button" onClick={() => openDocFile(id)} title="Tam ekran aç">⛶</button>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" title="Yeni sekmede aç">↗</a> : null}
        </div>
      </div>
      <div ref={wrapRef} className="bpview" style={{ overflow: 'auto', scrollbarGutter: 'stable' }} onDoubleClick={() => openDocFile(id)}>
        {html
          ? <iframe ref={frameRef} onLoad={onFrameLoad} className="bpframe-h" srcDoc={htmlDoc} title="Belge" sandbox="allow-same-origin allow-scripts" scrolling="no" style={{ zoom: appliedScale } as any} />
          : isImg
            ? <img className="bpimg" src={url} alt="Belge" onLoad={onImgLoad} style={{ zoom: appliedScale, ...(imgW ? { width: imgW, maxWidth: 'none' } : {}) } as any} />
            : isXml
              ? <iframe ref={frameRef} onLoad={onFrameLoad} className="bpframe-h" src={blobUrl || url} title="Belge" scrolling="no" style={{ zoom: appliedScale } as any} />
              : isPdf
                ? <iframe className="bppdf" src={url.includes('#') ? url : `${url}#view=FitH`} title="Belge" />
                : <div className="bpempty">Belge görüntüsü yok</div>}
      </div>
    </div>
  );
}

/* ===================== EKRAN: MUHASEBELEŞTİR ===================== */
function ScreenMuhasebe({ taxpayerId, period, isIsletme = false, taxpayerNace = '', taxpayerFaaliyet = '', taxpayerAd = '', full = false, onToggleFull }: { taxpayerId: string; period: string; isIsletme?: boolean; taxpayerNace?: string; taxpayerFaaliyet?: string; taxpayerAd?: string; full?: boolean; onToggleFull?: () => void }) {
  const qc = useQueryClient();
  const docsQ = useDocuments(taxpayerId, period);
  // İSABET PANOSU — dokunmasız işleme oranı (dönem bazlı; sayılar backend'te hazırlanır).
  const isabetQ = useQuery({
    queryKey: ['fm2', 'isabet-ozeti', taxpayerId, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/isabet-ozeti', { params: { taxpayerId: taxpayerId || undefined, period } })
        .then((r) => r.data || null)
        .catch(() => null),
    enabled: !!taxpayerId,
  });
  const isabet: any = isabetQ.data;
  const all: any[] = docsQ.data || [];
  const dirOf = (d: any) => (String(d.invoiceKind || '').includes('SATIS') ? 'SATIS' : 'ALIS');
  const [dir, setDir] = useState<'ALIS' | 'SATIS'>('ALIS');
  const cAlis = all.filter((d) => dirOf(d) === 'ALIS').length;
  const cSatis = all.filter((d) => dirOf(d) === 'SATIS').length;
  const allF = all.filter((d) => dirOf(d) === dir);
  // HAZIR = TÜM satırların kodu dolu (cari dahil). Eskiden "herhangi bir satır" yeterdi →
  // cari boşken bile "hazır/muhasebeleştirilebilir" görünüyordu (yanlış).
  const hasCode = (d: any) => Array.isArray(d.lines) && d.lines.length > 0 && d.lines.every((l: any) => l.accountCode);
  const ready = (d: any) => (isIsletme ? isletmeDocReady(d).ok : hasCode(d));
  const hazir = allF.filter((d) => d.status !== 'APPROVED' && ready(d));
  const eksik = allF.filter((d) => d.status !== 'APPROVED' && !ready(d));

  const [selId, setSelId] = useState<string>('');
  // Liste ekranındaki "Muhasebeleştir" ikonu localStorage'a hedef belgeyi yazar → bu ekran
  //   açılınca o belgeyi otomatik seçer (hatalı belgeyi listede tekrar aramaya gerek kalmaz).
  const hedefDocRef = useRef<string>('');
  useEffect(() => {
    try { const t = localStorage.getItem('fm-open-doc'); if (t) { setSelId(t); hedefDocRef.current = t; localStorage.removeItem('fm-open-doc'); } } catch { /* yok say */ }
  }, []);
  // HEDEF BELGENİN YÖNÜNE GEÇ: ekran hep ALIŞ sekmesiyle açılıyordu — hedef SATIŞ belgesiyse
  //   listede bulunamayıp İLK ALIŞ belgesi gösteriliyordu (kullanıcı: "ilgili faturayı açmıyor").
  //   Belgeler yüklenince hedefin yönü neyse sekme oraya çevrilir (tek seferlik; sonra elle geçiş serbest).
  useEffect(() => {
    if (!hedefDocRef.current || !all.length) return;
    const hedef = all.find((d) => d.id === hedefDocRef.current);
    if (!hedef) return;
    const yon = dirOf(hedef) as 'ALIS' | 'SATIS';
    if (yon !== dir) setDir(yon);
    hedefDocRef.current = '';
  }, [all, dir]);
  // SOL MENÜDEN DİREKT GİRİŞ: hedef belge yokken ekran hep ALIŞ sekmesiyle açılıyordu; o yönde
  //   bekleyen belge yoksa (ör. tüm belgeler SATIŞ) "Hazır belge yok" boş ekranı çıkıyordu.
  //   İlk yüklemede aktif yön boş ama diğer yön doluysa oraya geç (tek seferlik; sonra elle geçiş serbest).
  const dirAutoRef = useRef(false);
  useEffect(() => {
    if (dirAutoRef.current || hedefDocRef.current || !all.length) return;
    const bekleyen = (d: any) => d.status !== 'APPROVED';
    if (all.some((d) => dirOf(d) === dir && bekleyen(d))) { dirAutoRef.current = true; return; }
    const oteki: 'ALIS' | 'SATIS' = dir === 'ALIS' ? 'SATIS' : 'ALIS';
    if (all.some((d) => dirOf(d) === oteki && bekleyen(d))) setDir(oteki);
    dirAutoRef.current = true;
  }, [all, dir]);
  const navList = [...hazir, ...eksik];
  const selDoc = navList.find((d) => d.id === selId) || hazir[0] || eksik[0];
  const navIdx = selDoc ? navList.findIndex((d) => d.id === selDoc.id) : -1;
  const goNav = (delta: number) => {
    if (navIdx < 0) return;
    const next = navList[navIdx + delta];
    if (next) setSelId(next.id);
  };
  // Ok tuşu handler'ı GÜNCEL liste/konuma gitsin diye ref'te tut — içerik değişince (aynı uzunlukta
  //   bile) eski navList'e kapanma sorunu (stale closure) böylece olmaz; efekt tek kez bağlanır.
  const navRef = useRef({ list: navList, idx: navIdx });
  navRef.current = { list: navList, idx: navIdx };
  // Klavye ok tuşlarıyla önceki/sonraki belgeye geç (form alanındayken serbest bırak).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const { list, idx } = navRef.current;
      if (idx < 0) return;
      if (e.key === 'ArrowLeft') { const p = list[idx - 1]; if (p) setSelId(p.id); }
      else if (e.key === 'ArrowRight') { const n = list[idx + 1]; if (n) setSelId(n.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Belge bilgileri elle düzenleme (tarih/tür/belge türü/belge no/VKN) — PATCH ile kaydeder.
  const [meta, setMeta] = useState<any>({});
  // Tevkifat işlem türü kodu (GİB, Mihsap'taki "Tevkifat Kodu" alanı) — TEVKIFAT_KODLARI'ndan
  // seçilir, kaydette PATCH gövdesine `tevkifat: { kod, oran }` olarak gider.
  const [tevkifatKodu, setTevkifatKodu] = useState<string>('');
  useEffect(() => {
    const d = selDoc;
    setTevkifatKodu(String(d?.ocrData?.tevkifat?.kod || ''));
    setMeta(d ? {
      faturaTarihi: d.faturaTarihi ? String(d.faturaTarihi).slice(0, 10) : '',
      invoiceKind: String(d.invoiceKind || 'ALIS').includes('SATIS') ? 'SATIS' : 'ALIS',
      documentType: d.documentType || '',
      belgeNo: d.belgeNo || '',
      vkn: (String(d.invoiceKind || '').includes('SATIS') ? d.buyerVkn : d.sellerVkn) || '',
      tevkifatli: Number(d?.ocrData?.tevkifatOrani) > 0,
      tevkifatPay: Number(d?.ocrData?.tevkifatOrani) > 0 ? Math.round(Number(d.ocrData.tevkifatOrani) * 10) : 5,
      kdvRate: Number(d?.ocrData?.kdvOrani) || 20,
      cariUnvan: (String(d.invoiceKind || '').includes('SATIS') ? d.customerName : d.vendorName) || '',
    } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDoc?.id]);
  // Tevkifatlı fatura: KDV oranı + tevkifat oranıyla 2×191 + 360 fişi kurar (set-kdv-rate, backend).
  const applyTevkifatMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/documents/set-kdv-rate', {
      documentIds: [selDoc.id],
      kdvOrani: Number(meta.kdvRate) || 20,
      tevkifatOrani: (Number(meta.tevkifatPay) || 5) / 10,
    }),
    onSuccess: () => { toast.success('Tevkifatlı fiş kuruldu (2×191 + 360)'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Tevkifat uygulanamadı: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const saveMetaMut = useMutation({
    mutationFn: () => {
      const isSale = String(meta.invoiceKind).includes('SATIS');
      // İşletme: seçilen sınıflandırmayı kod+etiket olarak ocrData.isletme'ye yaz (Luca CSV bunu kullanır).
      const islPayload = isIsletme ? (() => {
        const ref = isletmeRef(meta.invoiceKind);
        const satirlar = islSatirlar.map((st: any) => {
          const alt = getKayitAltList(meta.invoiceKind, st.kayitTuruKod).find((x: any) => x.kod === st.kayitAltKod);
          return {
            kayitTuruKod: st.kayitTuruKod, kayitTuruAd: ref.kayitTuru.find((x) => x.kod === st.kayitTuruKod)?.ad,
            kayitAltKod: st.kayitAltKod || '', kayitAltAd: alt?.ad || '',
            kdvOranKod: st.kdvOranKod, matrah: Number(st.matrah) || 0, kdvTutar: Number(st.kdvTutar) || 0,
            krediliTutar: Number(st.krediliTutar) || 0, donem: !!alt?.donem, hesapKodu: st.hesapKodu || '',
            tevkifatOrani: st.tevkifatOrani || '', tevkifatTutar: Number(st.tevkifatTutar) || 0,
            stopajOrani: st.stopajOrani || '', stopajTutar: Number(st.stopajTutar) || 0,
          };
        });
        const s0: any = satirlar[0] || {};
        return {
          belgeTuruKod: isl.belgeTuruKod, belgeTuruAd: ref.belgeTuru.find((x) => x.kod === isl.belgeTuruKod)?.ad,
          alisSatisKod: isl.alisSatisKod, alisSatisAd: ref.alisSatisTuru.find((x) => x.kod === isl.alisSatisKod)?.ad,
          islemTuruKod: isl.islemTuruKod, islemTuruAd: ISLETME_ISLEM_TURU.find((x) => x.kod === isl.islemTuruKod)?.ad,
          plakaNo: isl.plakaNo || '', kayitTarihi: isl.kayitTarihi || '', satirlar,
          // geriye uyum (tek-satır okuyan eski yollar için ilk satır + toplamlar)
          kayitTuruKod: s0.kayitTuruKod, kayitTuruAd: s0.kayitTuruAd, kayitAltKod: s0.kayitAltKod, kayitAltAd: s0.kayitAltAd,
          kdvOranKod: s0.kdvOranKod, matrah: islTotMatrah, kdvTutar: islTotKdv, krediliTutar: s0.krediliTutar, donem: s0.donem,
          hesapKodu: s0.hesapKodu, tevkifatOrani: s0.tevkifatOrani, tevkifatTutar: s0.tevkifatTutar, stopajOrani: s0.stopajOrani, stopajTutar: s0.stopajTutar,
        };
      })() : undefined;
      return api.patch(`/fatura-muhasebelestirme/documents/${selDoc.id}`, {
        faturaTarihi: meta.faturaTarihi || undefined,
        invoiceKind: meta.invoiceKind,
        documentType: meta.documentType || undefined,
        belgeNo: meta.belgeNo || undefined,
        ...(isSale
          ? { buyerVkn: meta.vkn || undefined, customerName: meta.cariUnvan || undefined }
          : { sellerVkn: meta.vkn || undefined, vendorName: meta.cariUnvan || undefined }),
        ...(islPayload ? { isletme: islPayload } : {}),
        // Tevkifat işlem türü (GİB kodu) — backend bu alanı yakında kalıcılaştıracak
        // (ocrData.tevkifat); şimdiden göndermek zararsız. Oran: kullanıcı satırda
        // değiştirdiyse o (X/10), yoksa kodun varsayılanı.
        ...(!isIsletme && !isSale && tevkifatKodu ? (() => {
          const kd = TEVKIFAT_KODLARI.find((k) => k.kod === tevkifatKodu);
          const rowRate = String(lineDraft.find((l: any) => l.group === 'tevkifat' && /^\d+\/10$/.test(String(l.rate || '')))?.rate || '');
          return { tevkifat: { kod: tevkifatKodu, oran: rowRate || kd?.oran || '' } };
        })() : {}),
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // Fiş satırları elle düzenleme (hesap kodu / borç / alacak) — PATCH lines ile kaydeder.
  const [lineDraft, setLineDraft] = useState<any[]>([]);
  useEffect(() => {
    setLineDraft((selDoc?.lines || []).map((l: any) => ({
      group: l.group, accountCode: l.accountCode || '', description: l.description || '',
      rate: l.rate || '', debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
      kaynak: l.kaynak || null, // hesap kodunun nereden geldiği (KULLANICI/HAFIZA/AI/…) — rozet için
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDoc?.id]);
  // Tevkifat bölümü Mihsap'taki gibi KATLANIR: tevkifatsız belgede KAPALI tek başlık (ok ile açılır);
  //   tevkifatlı belgede (dolu satır varsa) otomatik AÇIK gelir.
  const [tevkAcik, setTevkAcik] = useState(false);
  useEffect(() => {
    const dolu = (selDoc?.lines || []).some((l: any) => String(l.group || '') === 'tevkifat'
      && (String(l.accountCode || '').trim() || Number(l.credit || 0) > 0 || Number(l.debit || 0) > 0));
    setTevkAcik(!!dolu);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDoc?.id]);
  const lines: any[] = lineDraft;
  const setLine = (i: number, k: string, v: any) => setLineDraft((arr) => arr.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = (group: string) => setLineDraft((arr) => [...arr, { group, accountCode: '', description: '', rate: '', debit: 0, credit: 0 }]);
  const delLine = (i: number) => setLineDraft((arr) => arr.filter((_, j) => j !== i));
  // Luca'dan çekilen hesap planı — kod alanlarında otomatik tamamlama (datalist).
  const planQ = useQuery({
    queryKey: ['fm2', 'account-plan-pick', taxpayerId],
    queryFn: () => api.get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, limit: 2000 } })
      .then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
    enabled: !!taxpayerId,
  });
  const accountPlan: any[] = planQ.data || [];
  // ── Mihsap modeli: Luca'da olmayan hesabı aç ("+" → "Yeni Hesap Planı Ekle" modalı) ──
  const [addAcc, setAddAcc] = useState<{ code: string; name: string; isCari: boolean; vkn: string } | null>(null);
  const openAddAccount = (code: string) => {
    const c = String(code || '').trim();
    const cari = /^(120|320|329|331)/.test(c);
    const sale = String(selDoc?.invoiceKind || 'ALIS') === 'SATIS';
    const firma = sale ? (selDoc?.customerName || '') : (selDoc?.vendorName || '');
    const vkn = String((sale ? selDoc?.buyerVkn : selDoc?.sellerVkn) || '').replace(/\D/g, '');
    setAddAcc({ code: c, name: cari ? String(firma || '') : '', isCari: cari, vkn: cari ? vkn : '' });
  };
  const createAccMut = useMutation({
    mutationFn: (v: { code: string; name: string; isCari: boolean; vkn: string }) =>
      api.post('/fatura-muhasebelestirme/account-plan', { taxpayerId, code: v.code, name: v.name, isCari: v.isCari, vkn: v.vkn || undefined }).then((r) => r.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['fm2', 'account-plan-pick', taxpayerId] });
      qc.invalidateQueries({ queryKey: ['fm2'] });
      toast.success(`"${v.code}" hesabı açıldı — aktarımda Luca'ya da otomatik açılacak.`);
      setAddAcc(null);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hesap açılamadı'),
  });
  const borc = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  const alacak = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
  const dengeli = lines.length > 0 && Math.abs(borc - alacak) < 0.01;
  const saveLinesMut = useMutation({
    mutationFn: async () => {
      await api.patch(`/fatura-muhasebelestirme/documents/${selDoc.id}`, {
        lines: lineDraft.map((l) => ({ group: l.group || 'matrah', accountCode: l.accountCode || null, description: l.description || null, rate: l.rate || null, debit: String(l.debit || 0), credit: String(l.credit || 0) })),
      });
      // Matrah hesap kodunu o satıcıya ÖĞRET (ayrı "Gerçek hesap kodu" paneline gerek kalmadı).
      const vkn = String(selDoc?.sellerVkn || '').replace(/\D/g, '');
      const matrahCode = (lineDraft.find((l: any) => (l.group || 'matrah') === 'matrah' && l.accountCode))?.accountCode;
      if (String(selDoc?.invoiceKind || 'ALIS') !== 'SATIS' && vkn && matrahCode) {
        await api.post('/fatura-muhasebelestirme/vendor-rule', { taxpayerId, vendorVkn: vkn, vendorName: selDoc?.vendorName || undefined, accountCode: matrahCode }).catch(() => {});
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const gg = selDoc ? kdvParts(selDoc) : { matrah: null, kdv: null };
  const amountReady = (Number(gg.matrah) || 0) > 0 || (Number(gg.kdv) || 0) > 0 || Number(selDoc?.totalAmount) > 0;

  // ── İşletme defteri (Mihsap-birebir, ÇOKLU SATIR) ──
  // faturaTuru = invoiceKind (SATIS=Gelir, ALIS=Gider). Üst bilgi tek; her KDV oranı / gider türü ayrı satır.
  const islKind = String(meta.invoiceKind || 'ALIS').includes('SATIS') ? 'SATIS' : 'ALIS';
  const islRef = isletmeRef(islKind);
  const oranToKdvKod = (oran: any) => { const r = Math.round(Number(oran) || 0); return [20, 10, 1, 0].includes(r) ? `KDV${r}` : 'KDV20'; };
  const mkSatir = (kind: 'SATIS' | 'ALIS', matrah: number, kdvKod: string, kdvTutar: number) => {
    // Sınıf = AI'ın okuma anında verdiği karar (ocrData.isletme). AI vermediyse form başlangıcı:
    //   satış Hizmet, gider İndirilecek (kullanıcı Muhasebeleştir'de değiştirir).
    const ai = selDoc?.ocrData?.isletme;
    const ktKod = ai?.kayitTuruKod || (kind === 'SATIS' ? '2' : '4');
    const ktAd = isletmeRef(kind).kayitTuru.find((x) => x.kod === ktKod)?.ad;
    // KALEM-BAZLI ALT TÜR: Çok oranlı faturada (%1 gıda + %20 temizlik gibi) HER SATIR
    //   KENDİ KDV oranındaki kalemlerin içeriğine göre alt tür alır — tek tür tüm faturaya
    //   yapışmaz. Sadece İndirilecek Giderler'de (ktKod='4') ve kalem varsa.
    let altKod = '';
    const oran = ({ KDV20: 20, KDV10: 10, KDV1: 1, KDV0: 0 } as Record<string, number>)[kdvKod] ?? -1;
    const kalemler = Array.isArray(selDoc?.ocrData?.kalemler) ? selDoc.ocrData.kalemler : [];
    const satirText = oran >= 0
      ? kalemler.filter((k: any) => Math.round(Number(k?.oran)) === oran).map((k: any) => String(k?.ad || '')).join(' ').trim()
      : '';
    if (ktKod === '4' && satirText) altKod = isletmeAutoKayitAltKod(kind, '4', satirText) || '';
    if (!altKod) altKod = ai?.kayitAltKod || '';
    if (!altKod) altKod = defaultKayitAltKod(kind, ktKod, ktAd);
    if (!altKod) {
      const islText = [selDoc?.ocrData?.giderTuru, selDoc?.ocrData?.muhasebeNeden, selDoc?.vendorName, selDoc?.customerName].filter(Boolean).join(' ');
      if (islText) altKod = isletmeAutoKayitAltKod(kind, ktKod, islText) || '';
    }
    return { kayitTuruKod: ktKod, kayitAltKod: altKod, matrah: Number(matrah) || 0, kdvOranKod: kdvKod, kdvTutar: Number(kdvTutar) || 0, krediliTutar: 0, hesapKodu: '', tevkifatOrani: '', tevkifatTutar: 0, stopajOrani: '', stopajTutar: 0 };
  };
  const [isl, setIsl] = useState<any>({ satirlar: [] });
  const [islExp, setIslExp] = useState<Record<string, boolean>>({});
  const [islMenu, setIslMenu] = useState<number | null>(null);
  useEffect(() => {
    if (!isIsletme || !selDoc) { setIsl({ satirlar: [] }); return; }
    const saved: any = (selDoc.ocrData?.isletme) || {};
    const kind = String(selDoc.invoiceKind || 'ALIS').includes('SATIS') ? 'SATIS' : 'ALIS';
    const p = kdvParts(selDoc);
    const r = Math.round(Number(selDoc.ocrData?.kdvOrani) || 20);
    const kdvKod = [20, 10, 1, 0].includes(r) ? `KDV${r}` : 'KDV20';
    const bd = Array.isArray(selDoc.ocrData?.kdvBreakdown)
      ? selDoc.ocrData.kdvBreakdown.filter((b: any) => (Number(b?.matrah ?? b?.base) || 0) > 0 || (Number(b?.tutar ?? b?.amount) || 0) > 0) : [];
    let satirlar: any[];
    if (Array.isArray(saved.satirlar) && saved.satirlar.length) satirlar = saved.satirlar;
    else if (bd.length > 1) satirlar = bd.map((b: any) => mkSatir(kind, Number(b.matrah ?? b.base) || 0, oranToKdvKod(b.oran ?? b.rate), Number(b.tutar ?? b.amount) || 0));
    else satirlar = [mkSatir(kind, Number(p.matrah) || 0, kdvKod, Number(p.kdv) || 0)];
    setIsl({
      // Belge türü: OKUNDUYSA onu göster; okunmadıysa (documentType boş) BOŞ bırak — VARSAYMA, kullanıcı seçer.
      belgeTuruKod: saved.belgeTuruKod || (() => { const dt = normalizeDocumentType(selDoc.documentType || selDoc.ocrData?.belgeTuru || selDoc.ocrData?.documentType); return dt ? defaultBelgeTuruKod(dt, kind) : ''; })(),
      alisSatisKod: saved.alisSatisKod || '1',
      islemTuruKod: saved.islemTuruKod || '1100',
      plakaNo: saved.plakaNo || '',
      kayitTarihi: saved.kayitTarihi || (selDoc.faturaTarihi ? String(selDoc.faturaTarihi).slice(0, 10) : ''),
      satirlar,
    });
    setIslExp({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDoc?.id, isIsletme]);
  const setIslF = (k: string, v: any) => setIsl((s: any) => ({ ...s, [k]: v }));
  const recalcKdv = (matrah: number, kdvKod: string) => {
    const o = ({ KDV20: 0.2, KDV10: 0.1, KDV1: 0.01, KDV0: 0 } as Record<string, number>)[kdvKod] ?? 0.2;
    return Math.round(matrah * o * 100) / 100;
  };
  const islSatirlar: any[] = Array.isArray(isl.satirlar) ? isl.satirlar : [];
  const setSatir = (i: number, patch: any) => setIsl((s: any) => ({ ...s, satirlar: (s.satirlar || []).map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) }));
  const addSatir = () => setIsl((s: any) => ({ ...s, satirlar: [...(s.satirlar || []), mkSatir(islKind, 0, 'KDV20', 0)] }));
  const delSatir = (i: number) => setIsl((s: any) => { const arr = (s.satirlar || []).filter((_: any, j: number) => j !== i); return { ...s, satirlar: arr.length ? arr : [mkSatir(islKind, 0, 'KDV20', 0)] }; });
  // Dahili (iç yüzde) KDV ayır: Matrah'taki tutarı KDV-DAHİL kabul et, KDV'yi ayır, KDV-hariç tutarı Matrah'a yaz.
  const dahiliKdvAyir = (i: number, oranPct: number) => {
    const st = islSatirlar[i] || {};
    const dahil = Number(st.matrah) || 0;
    const o = oranPct / 100;
    const haric = Math.round((dahil / (1 + o)) * 100) / 100;
    const kdv = Math.round((dahil - haric) * 100) / 100;
    setSatir(i, { matrah: haric, kdvTutar: kdv, kdvOranKod: `KDV${oranPct}` });
    setIslMenu(null);
  };
  useEffect(() => {
    if (islMenu === null) return;
    const close = () => setIslMenu(null);
    const t = setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [islMenu]);
  const islTotMatrah = islSatirlar.reduce((a, x) => a + (Number(x.matrah) || 0), 0);
  const islTotKdv = islSatirlar.reduce((a, x) => a + (Number(x.kdvTutar) || 0), 0);
  const currentIslReady = !!isl.belgeTuruKod && islSatirlar.length > 0 && islSatirlar.every((st: any) => isletmeRowReady(islKind, st));
  const ggReady = isIsletme ? (amountReady && currentIslReady) : dengeli;
  const expKey = (i: number, sec: string) => `${i}:${sec}`;
  const toggleExp = (i: number, sec: string) => setIslExp((e) => ({ ...e, [expKey(i, sec)]: !e[expKey(i, sec)] }));
  // Fatura Türü (Gelir/Gider) değişince üst + tüm satırların kayıt türünü yeni bağlama göre sıfırla.
  const setIslKind = (kind: 'SATIS' | 'ALIS') => {
    if (!isIsletme) return;
    const ktKod = kind === 'SATIS' ? '2' : '4';
    const ktAd = isletmeRef(kind).kayitTuru.find((x) => x.kod === ktKod)?.ad;
    setIsl((s: any) => ({ ...s, belgeTuruKod: (() => { const dt = normalizeDocumentType(selDoc?.documentType || selDoc?.ocrData?.belgeTuru || selDoc?.ocrData?.documentType); return dt ? defaultBelgeTuruKod(dt, kind) : ''; })(), alisSatisKod: '1', plakaNo: kind === 'SATIS' ? '' : s.plakaNo, satirlar: (s.satirlar || []).map((x: any) => ({ ...x, kayitTuruKod: ktKod, kayitAltKod: defaultKayitAltKod(kind, ktKod, ktAd) })) }));
  };
  // İşletme: aktarıma çıkan değerlerin özeti (alt çubuk).
  const islBelgeAd = islRef.belgeTuru.find((x) => x.kod === isl.belgeTuruKod)?.ad || '—';
  const islKayitAd = (islSatirlar.length > 1 ? `${islSatirlar.length} satır` : (islRef.kayitTuru.find((x) => x.kod === islSatirlar[0]?.kayitTuruKod)?.ad || '—'));

  // Gerçek hesap kodunu elle ver — o satıcının tüm faturalarına uygulanır + öğrenilir (770 tahmini yerine)
  // Talimat (gece otomatik) — entegratör kayıtlarından türetilir
  const approveMut = useMutation({
    mutationFn: (p: { id: string; force?: boolean }) => api.post(`/fatura-muhasebelestirme/documents/${p.id}/approve`, p.force ? { force: true } : undefined),
    onSuccess: () => { toast.success('Onaylandı — Luca kuyruğuna alındı'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => {
      const msg = String(e?.response?.data?.message || e?.message || 'hata');
      toast.error('Onay başarısız: ' + msg);
    },
  });
  // Faz E: TEK kaydet (bilgi+satır birlikte, tek bildirim). Ctrl+S buna bağlı.
  const saveAll = async (silent = false) => {
    // Seçili belge yoksa Ctrl+S sessizce patlıyordu (selDoc.id undefined) → kısa uyarı ver, erken çık.
    if (!selDoc) { if (!silent) toast.error('Kaydedilecek belge seçili değil'); return; }
    await saveMetaMut.mutateAsync();
    if (!isIsletme) await saveLinesMut.mutateAsync();
    if (!silent) toast.success('Kaydedildi');
  };
  // Faz E: Kaydet + Onayla → başarılıysa OTOMATİK sonraki belgeye geç (akış kopmasın).
  const saveApprove = async () => {
    if (!selDoc) return;
    try {
      await saveAll(true);
      const nextId = navList[navIdx + 1]?.id;
      await approveMut.mutateAsync({ id: selDoc.id });
      if (nextId) setSelId(nextId);
    } catch { /* mutasyon hatasını gösterir */ }
  };
  // Faz E: klavye kısayolları — Ctrl+S Kaydet, Ctrl+Enter Kaydet+Onayla (form alanında da çalışır).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); saveAll().catch(() => {});
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault(); if (ggReady) saveApprove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDoc?.id, navIdx, navList.length, ggReady, isIsletme, meta, lineDraft]);
  // v2.3: Onaylı (QUEUED/FAILED) belgeleri tek toplu işle Luca'ya GÖNDER.
  // approve sadece kuyruğa alır; gerçek aktarım bu butonla (batch-post-to-luca) tetiklenir.
  if (!taxpayerId) {
    return (
      <section className="screen">
        <div className="h2">Muhasebeleştir &amp; Aktar</div>
        <div className="sub">Önce üstten bir mükellef seç.</div>
        <div className="card"><div className="empty">Mükellef seçilmedi.</div></div>
      </section>
    );
  }

  return (
    <section className="screen">
      {addAcc && (
        <div onMouseDown={() => setAddAcc(null)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(620px, 96vw)', background: '#fff', color: '#1a1a1a', borderRadius: 14, padding: '22px 26px', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Yeni Hesap Planı Ekle</h3>
              <button type="button" onClick={() => setAddAcc(null)} style={{ background: 'none', border: 0, fontSize: 22, cursor: 'pointer', color: '#999' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gap: 5, marginTop: 16 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Hesap Kodu</label>
              <input value={addAcc.code} onChange={(e) => setAddAcc({ ...addAcc, code: e.target.value })}
                style={{ padding: '11px 13px', borderRadius: 9, border: '1px solid #ddd', fontSize: 15 }} />
            </div>
            <div style={{ display: 'grid', gap: 5, marginTop: 16 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Hesap Adı</label>
              <input value={addAcc.name} maxLength={64} onChange={(e) => setAddAcc({ ...addAcc, name: e.target.value })}
                style={{ padding: '11px 13px', borderRadius: 9, border: '1px solid #ddd', fontSize: 15 }} />
              <span style={{ fontSize: 12, color: '#999' }}>{addAcc.name.length}/64 karakter</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 15, fontWeight: 600, color: '#374151' }}>
              Cari Hesap Mı? : <input type="checkbox" checked={addAcc.isCari} onChange={(e) => setAddAcc({ ...addAcc, isCari: e.target.checked })} style={{ width: 18, height: 18 }} />
            </label>
            {addAcc.isCari && (
              <div style={{ display: 'grid', gap: 5, marginTop: 16 }}>
                <label style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Vergi No / T.C. Kimlik No</label>
                <input value={addAcc.vkn} onChange={(e) => setAddAcc({ ...addAcc, vkn: e.target.value.replace(/\D/g, '') })}
                  style={{ padding: '11px 13px', borderRadius: 9, border: '1px solid #ddd', fontSize: 15 }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
              <button type="button" onClick={() => {
                const c = String(addAcc.code || '').trim();
                const exists = accountPlan.some((a) => String(a.code) === c);
                if (exists) toast.warning(`"${c}" hesabı planda zaten var.`);
                else toast.success(`"${c}" planda yok — açabilirsin.`);
              }} style={{ padding: '11px 18px', borderRadius: 9, border: 0, background: '#ef4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                🔍 Hesap Planı Kontrol
              </button>
              <button type="button" disabled={createAccMut.isPending || !addAcc.code.trim() || !addAcc.name.trim()} onClick={() => createAccMut.mutate(addAcc)}
                style={{ padding: '11px 30px', borderRadius: 9, border: 0, background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: (createAccMut.isPending || !addAcc.code.trim() || !addAcc.name.trim()) ? 0.55 : 1 }}>
                {createAccMut.isPending ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="card muhcard" style={{ padding: 0, marginTop: 2 }}>
        <div className="wmain muhmain">
            {selDoc ? (
              <>
                <div className="fiseditor">
                <div className="belgepane"><InlineBelge id={selDoc.id} /></div>
                <div className="fispane">
                <div className="ph">
                  <span className="navbtns">
                    <button type="button" className="navb" disabled={navIdx <= 0} onClick={() => goNav(-1)} title="Önceki belge (←)">‹</button>
                    <span className="navpos">{navIdx >= 0 ? `${navIdx + 1}/${navList.length}` : ''}</span>
                    <button type="button" className="navb" disabled={navIdx < 0 || navIdx >= navList.length - 1} onClick={() => goNav(1)} title="Sonraki belge (→)">›</button>
                  </span>
                  <span className="phname">{isIsletme ? (selDoc.invoiceKind === 'SATIS' ? 'Gelir faturası' : 'Gider faturası') : (selDoc.invoiceKind === 'SATIS' ? 'Satış faturası' : 'Alış faturası')}</span>
                  <span className="muhfilter" aria-label="Fatura yönü filtresi">
                    <button type="button" className={dir === 'ALIS' ? 'on' : ''} onClick={() => { setDir('ALIS'); setSelId(''); }}>Alış <b>{cAlis}</b></button>
                    <button type="button" className={dir === 'SATIS' ? 'on' : ''} onClick={() => { setDir('SATIS'); setSelId(''); }}>Satış <b>{cSatis}</b></button>
                  </span>
                  <button type="button" className="fifull" onClick={() => onToggleFull?.()} title={full ? 'Küçült — menüyü geri getir' : 'Büyüt — menüyü gizle, tam ekran işle'}><Ico html={full ? I.compress : I.expand} size={14} /><span>{full ? 'Küçült' : 'Büyüt'}</span></button>
                  <div className="sp" />
                </div>
                {meta.tevkifatli && !isIsletme && !String(meta.invoiceKind || '').includes('SATIS') && (
                  <div className="tevpanel">
                    <span className="tlbl">Tevkifat (alış)</span>
                    <div style={{ maxWidth: 110, flex: '0 0 110px' }}><PlainSelect value={String(meta.kdvRate || 20)} onChange={(v) => setMeta({ ...meta, kdvRate: Number(v) })} options={[{ value: '20', label: 'KDV %20' }, { value: '10', label: 'KDV %10' }, { value: '1', label: 'KDV %1' }]} /></div>
                    <div style={{ maxWidth: 90, flex: '0 0 90px' }}><PlainSelect value={String(meta.tevkifatPay || 5)} onChange={(v) => setMeta({ ...meta, tevkifatPay: Number(v) })} options={[2, 3, 4, 5, 7, 9, 10].map((p) => ({ value: String(p), label: `${p}/10` }))} /></div>
                    <button className="btn sm primary" disabled={applyTevkifatMut.isPending} onClick={() => applyTevkifatMut.mutate()}>{applyTevkifatMut.isPending ? 'Kuruluyor…' : 'Tevkifat fişini kur'}</button>
                    <span className="tnote">191 (tam KDV indirimi) + 320 net cari + 360 (KDV2 sorumlu sıf.) fişi oluşturur</span>
                  </div>
                )}
                <div className="twrap">
                  {isIsletme ? (
                    <div className="islforms">
                      {/* ÜST BİLGİ — kompakt (.islgrid: kartsız, sıkı; ekrana sığar) */}
                      <div className="islgrid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                        <div className="dm"><span className="dml">Fatura Türü</span>
                          <PlainSelect value={islKind} onChange={(v) => { const k = v === 'SATIS' ? 'SATIS' : 'ALIS'; setMeta({ ...meta, invoiceKind: k }); setIslKind(k); }} options={[{ value: 'SATIS', label: 'Gelir' }, { value: 'ALIS', label: 'Gider' }]} />
                        </div>
                        <div className="dm"><span className="dml">Belge Türü</span>
                          <PlainSelect value={isl.belgeTuruKod || ''} onChange={(v) => setIslF('belgeTuruKod', v)} options={islRef.belgeTuru.map((x) => ({ value: x.kod, label: x.ad }))} />
                        </div>
                        <div className="dm"><span className="dml">Alış/Satış Türü</span>
                          <PlainSelect value={isl.alisSatisKod || ''} onChange={(v) => setIslF('alisSatisKod', v)} options={islRef.alisSatisTuru.map((x) => ({ value: x.kod, label: x.ad }))} />
                        </div>
                      </div>
                      <div className="islgrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                        <div className="dm"><span className="dml">Evrak Tarihi</span><input className="dmi" type="date" value={meta.faturaTarihi || ''} onChange={(e) => setMeta({ ...meta, faturaTarihi: e.target.value })} /></div>
                        <div className="dm"><span className="dml">Kayıt Tarihi</span><input className="dmi" type="date" value={isl.kayitTarihi || meta.faturaTarihi || ''} onChange={(e) => setIslF('kayitTarihi', e.target.value)} /></div>
                      </div>
                      <div className="islgrid" style={{ gridTemplateColumns: islRef.plaka ? 'repeat(2, minmax(0, 1fr))' : '1fr' }}>
                        <div className="dm"><span className="dml">Evrak No</span><input className="dmi" value={meta.belgeNo || ''} onChange={(e) => setMeta({ ...meta, belgeNo: e.target.value })} /></div>
                        {islRef.plaka && (<div className="dm"><span className="dml">Plaka No</span><input className="dmi" value={isl.plakaNo || ''} placeholder="34 ABC 123" onChange={(e) => setIslF('plakaNo', e.target.value)} /></div>)}
                      </div>
                      <div className="islgrid" style={{ gridTemplateColumns: '1fr' }}>
                        <div className="dm"><span className="dml">{String(meta.invoiceKind).includes('SATIS') ? 'Alıcı TCKN/VKN' : 'Satıcı TCKN/VKN'}</span><input className="dmi" value={meta.vkn || ''} onChange={(e) => setMeta({ ...meta, vkn: e.target.value })} /></div>
                      </div>
                      <input value={meta.cariUnvan || ''} placeholder="* cari ünvanı" onChange={(e) => setMeta({ ...meta, cariUnvan: e.target.value })}
                        style={{ width: '100%', margin: '0 0 8px', padding: '8px 11px', background: '#eef5fc', border: '1px solid #bcd7f2', borderRadius: 7, color: '#1862ad', fontSize: 13, fontWeight: 600 }} />
                      {islRef.islemTuru && (
                        <div className="islgrid" style={{ gridTemplateColumns: '1fr' }}>
                          <div className="dm"><span className="dml">İşlem Türü</span>
                            <PlainSelect value={isl.islemTuruKod || '1100'} onChange={(v) => setIslF('islemTuruKod', v)} options={ISLETME_ISLEM_TURU.map((x) => ({ value: x.kod, label: x.ad }))} />
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f1b2d', margin: '2px 2px' }}>Toplam Tutar: <span style={{ color: '#16a34a' }}>{fmtMoney(islTotMatrah + islTotKdv)} ₺</span></div>
                      {/* SATIRLAR — her KDV oranı / gider türü ayrı (Mihsap birebir) */}
                      {islSatirlar.map((st: any, i: number) => {
                        const altList = getKayitAltList(islKind, st.kayitTuruKod);
                        return (
                          <div key={i} style={{ position: 'relative', background: '#e9f1fb', border: '1px solid #c5dbf3', borderRadius: 9, padding: '14px 10px 8px', marginTop: 10 }}>
                            <span style={{ position: 'absolute', top: -10, left: 10, background: '#1d9e75', color: '#fff', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 5, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{i + 1}</span>
                            <div className="islgrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                              <div className="dm"><span className="dml">Kayıt Türü</span>
                                <PlainSelect value={st.kayitTuruKod || ''} onChange={(v) => setSatir(i, { kayitTuruKod: v, kayitAltKod: '' })} options={islRef.kayitTuru.map((x) => ({ value: x.kod, label: x.ad }))} />
                              </div>
                              <div className="dm"><span className="dml">K. Alt Türü</span>
                                <PlainSelect value={st.kayitAltKod || ''} onChange={(v) => setSatir(i, { kayitAltKod: v })} options={[{ value: '', label: '—' }, ...altList.map((x) => ({ value: x.kod, label: x.ad }))]} />
                              </div>
                            </div>
                            <div className="islgrid" style={{ gridTemplateColumns: `repeat(${islRef.kredili ? 4 : 3}, minmax(0, 1fr))`, marginTop: 6 }}>
                              {islRef.kredili && (<div className="dm"><span className="dml">Kredili Tutar</span><MoneyInput value={Number(st.krediliTutar) || 0} onChange={(n) => setSatir(i, { krediliTutar: n })} /></div>)}
                              <div className="dm"><span className="dml">Matrah</span><MoneyInput value={Number(st.matrah) || 0} onChange={(n) => setSatir(i, { matrah: n, kdvTutar: recalcKdv(n, st.kdvOranKod) })} /></div>
                              <div className="dm"><span className="dml">Kdv Oranı</span>
                                <PlainSelect value={st.kdvOranKod || 'KDV20'} onChange={(v) => setSatir(i, { kdvOranKod: v, kdvTutar: recalcKdv(Number(st.matrah) || 0, v) })} options={ISLETME_KDV_ORAN.map((x) => ({ value: x.kod, label: x.ad }))} />
                              </div>
                              <div className="dm"><span className="dml">Kdv Tutarı</span><MoneyInput value={Number(st.kdvTutar) || 0} onChange={(n) => setSatir(i, { kdvTutar: n })} /></div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 9 }}>
                              <div>
                                <span onClick={() => toggleExp(i, 'hesap')} style={{ fontSize: 12, color: '#1862ad', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>Hesap Kodu <span style={{ color: '#7a93b5' }}>{islExp[expKey(i, 'hesap')] ? '⌃' : '⌄'}</span></span>
                                {islExp[expKey(i, 'hesap')] && (
                                  <div className="islgrid" style={{ gridTemplateColumns: '1fr', marginTop: 5 }}><div className="dm"><span className="dml">Luca Hesap Kodu (opsiyonel)</span>
                                    <input className="dmi" value={st.hesapKodu || ''} list="fm-isl-acc" placeholder="örn. 770.01" onChange={(e) => setSatir(i, { hesapKodu: e.target.value })} />
                                  </div></div>
                                )}
                              </div>
                              {islRef.tevkifat && (
                                <div>
                                  <span onClick={() => toggleExp(i, 'tevkifat')} style={{ fontSize: 12, color: '#1862ad', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>Tevkifat İşlemleri <span style={{ color: '#7a93b5' }}>{islExp[expKey(i, 'tevkifat')] ? '⌃' : '⌄'}</span></span>
                                  {islExp[expKey(i, 'tevkifat')] && (
                                    <div className="islgrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 5 }}>
                                      <div className="dm"><span className="dml">Tevkifat Oranı</span>
                                        <PlainSelect value={st.tevkifatOrani || ''} onChange={(v) => setSatir(i, { tevkifatOrani: v, tevkifatTutar: v ? Math.round((Number(st.kdvTutar) || 0) * (Number(v.split('/')[0]) / Number(v.split('/')[1])) * 100) / 100 : 0 })} options={[{ value: '', label: 'Yok' }, ...['2/10', '3/10', '4/10', '5/10', '7/10', '9/10', '10/10'].map((o) => ({ value: o, label: o }))]} />
                                      </div>
                                      <div className="dm"><span className="dml">Tevkifat Tutarı (sorumlu KDV)</span><MoneyInput value={Number(st.tevkifatTutar) || 0} onChange={(n) => setSatir(i, { tevkifatTutar: n })} /></div>
                                    </div>
                                  )}
                                </div>
                              )}
                              <div>
                                <span onClick={() => toggleExp(i, 'stopaj')} style={{ fontSize: 12, color: '#1862ad', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>Stopaj İşlemleri <span style={{ color: '#7a93b5' }}>{islExp[expKey(i, 'stopaj')] ? '⌃' : '⌄'}</span></span>
                                {islExp[expKey(i, 'stopaj')] && (
                                  <div className="islgrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 5 }}>
                                    <div className="dm"><span className="dml">Stopaj Oranı (%)</span>
                                      <input className="dmi" value={st.stopajOrani || ''} placeholder="örn. 20" onChange={(e) => { const o = e.target.value.replace(/[^0-9.,]/g, ''); setSatir(i, { stopajOrani: o, stopajTutar: Math.round((Number(st.matrah) || 0) * (parseFloat(String(o).replace(',', '.')) || 0) / 100 * 100) / 100 }); }} />
                                    </div>
                                    <div className="dm"><span className="dml">Stopaj Tutarı</span><MoneyInput value={Number(st.stopajTutar) || 0} onChange={(n) => setSatir(i, { stopajTutar: n })} /></div>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f1b2d' }}>Toplam (KDV Dahil): <span style={{ color: '#16a34a' }}>{fmtMoney((Number(st.matrah) || 0) + (Number(st.kdvTutar) || 0))} ₺</span></span>
                              <div style={{ display: 'flex', gap: 8, position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                                <button type="button" title="Dahili KDV ayır" onClick={() => setIslMenu(islMenu === i ? null : i)} style={{ width: 30, height: 30, borderRadius: '50%', border: 0, background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 19, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⋮</button>
                                <button type="button" title="Satırı sil" onClick={() => delSatir(i)} style={{ width: 30, height: 30, borderRadius: '50%', border: 0, background: '#ef4444', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6m5 4v6m4-6v6" /></svg>
                                </button>
                                {islMenu === i && (
                                  <div style={{ position: 'absolute', bottom: 38, right: 0, background: '#fff', border: '1px solid #d7dee8', borderRadius: 10, boxShadow: '0 12px 30px rgba(15,23,42,.18)', padding: 6, zIndex: 60, minWidth: 195 }}>
                                    {[20, 10, 1].map((p) => (
                                      <div key={p} onClick={() => dahiliKdvAyir(i, p)} style={{ padding: '9px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#eef2f7')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>%{p} Dahili Kdv Ayır</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <datalist id="fm-isl-acc">{accountPlan.slice(0, 500).map((a: any) => (<option key={a.code} value={a.code}>{a.name}</option>))}</datalist>
                      {/* + Yeni satır (Mihsap ortada) — farklı KDV oranı / gider türü */}
                      <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0 6px' }}>
                        <button type="button" onClick={addSatir} title="Yeni satır ekle (farklı KDV oranı / gider türü)" style={{ width: 34, height: 34, borderRadius: '50%', border: 0, background: '#2563eb', color: '#fff', fontSize: 22, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(37,99,235,.35)' }}>+</button>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', color: '#0f1b2d' }}>Genel Toplam (KDV Dahil): <span style={{ color: '#16a34a' }}>{fmtMoney(islTotMatrah + islTotKdv)} ₺</span></div>
                    </div>
                  ) : (
                    <div className="fgrps">
                      {/* Fiş grup/yön: düzenlenmekte olan meta.invoiceKind'i izle (kaydı beklemeden
                          ALIŞ↔SATIŞ dönsün); meta yoksa selDoc.invoiceKind'e düş. */}
                      {(String(meta.invoiceKind || selDoc.invoiceKind || '').includes('SATIS')
                        ? [
                            // SATIŞ: matrah(600)+KDV(391) ALACAK, cari(120) BORÇ
                            { key: 'matrah', keys: ['matrah'], label: 'Matrah (Gelir)', side: 'credit' as const },
                            { key: 'vergi', keys: ['vergi'], label: 'Hesaplanan KDV', side: 'credit' as const },
                            { key: 'cari', keys: ['cari'], label: 'Cari Hesap', side: 'debit' as const },
                          ]
                        : [
                            // ALIŞ: matrah+KDV BORÇ, cari ALACAK. Tevkifatlıda "İndirilecek KDV" kutusu
                            // İÇİNDE normal+sorumlu sıf. satırları BİRLİKTE (kullanıcı: ayrı kutu olmasın,
                            // "+ satır ekle" ile aynı yerde) — hangi satırın "sorumlu" olduğu SEÇİLEN HESAP
                            // KODUNA göre otomatik belirlenir (bkz. CodeSelect onChange). 360 (KDV2) AYRI
                            // bölüm kalır — Mihsap'taki gibi gerçekten farklı bir hesap/işlem.
                            { key: 'matrah', keys: ['matrah'], label: 'Matrah', side: 'debit' as const },
                            { key: 'vergi', keys: ['vergi', 'vergi-sorumlu'], label: 'İndirilecek KDV', side: 'debit' as const },
                            // Tevkifat (360 · KDV2) grubu ALIŞ'ta HER ZAMAN sabit görünür (kullanıcı: Mihsap
                            // gibi alan hep dursun). Tevkifatlı faturada satırlar otomatik dolar; tevkifatsızda
                            // boş kalır (satır yoksa denge/toplam'a etki etmez, "+ satır ekle" ile elle girilir).
                            { key: 'tevkifat', keys: ['tevkifat'], label: 'Tevkifat — Ödenecek KDV (360 · KDV2)', side: 'credit' as const },
                            { key: 'cari', keys: ['cari'], label: 'Cari Hesap', side: 'credit' as const },
                          ]
                      ).map((g) => {
                        // Tevkifat bölümü KATLANIR (Mihsap tarzı): kapalıyken gövde hiç çizilmez; açıkken
                        //   boş satır dahil her şey görünür — süzgece gerek yok.
                        const rows = lineDraft.map((l: any, i: number) => ({ l, i })).filter(({ l }) => g.keys.includes(l.group || 'matrah'));
                        const tot = rows.reduce((s, { l }) => s + (Number(g.side === 'debit' ? l.debit : l.credit) || 0), 0);
                        return (
                          <div key={g.key} className="fgrp" data-g={g.key}>
                            <div
                              className={g.key === 'tevkifat' ? 'fgh fgh-tgl' : 'fgh'}
                              onClick={g.key === 'tevkifat' ? () => setTevkAcik((v) => {
                                const acilacak = !v;
                                // Mihsap gibi: bölüm açılınca hesap kodu + oran + tutar satırı DİREKT görünür —
                                //   satır yoksa boş bir tane eklenir (Tevkifat Kodu seçilince oranı otomatik dolar).
                                if (acilacak && !lineDraft.some((l: any) => (l.group || '') === 'tevkifat')) addLine('tevkifat');
                                return acilacak;
                              }) : undefined}
                              title={g.key === 'tevkifat' ? (tevkAcik ? 'Bölümü kapat' : 'Bölümü aç') : undefined}
                            >
                              <span>{g.label}</span>
                              <span className="fgs">
                                {g.side === 'debit' ? 'Borç' : 'Alacak'}
                                {g.key === 'tevkifat' && <span className={tevkAcik ? 'fgchev up' : 'fgchev'}>⌄</span>}
                              </span>
                            </div>
                            {(g.key !== 'tevkifat' || tevkAcik) && (<>
                            {rows.map(({ l, i }) => (
                              <div key={i} className="frow">
                                <CodeSelect value={l.accountCode || ''} accounts={accountPlan} onChange={(code) => {
                                  setLine(i, 'accountCode', code);
                                  setLine(i, 'kaynak', 'KULLANICI'); // elle seçildi — rozet "Siz seçtiniz" olsun

                                  // "İndirilecek KDV" kutusu birden fazla backend-grup kapsıyorsa (vergi +
                                  //   vergi-sorumlu): seçilen hesabın ADI "sorumlu" içeriyorsa satırı OTOMATİK
                                  //   vergi-sorumlu grubuna taşı — rematch'in 191-normal/191-sorumlu hesabını
                                  //   doğru ayırt etmesi (ve yevmiyenin doğru kurulması) buna bağlı.
                                  if (g.keys.length > 1) {
                                    // Hesap planı {code, name} döner (accountCode/accountName DEĞİL). Kod planda
                                    //   yoksa mevcut grubu KORU — vergi-sorumlu satırını körlemesine vergi'ye düşürme.
                                    const acc = (accountPlan || []).find((a: any) => String(a.code) === String(code));
                                    if (acc) {
                                      const isResp = /sorumlu/i.test(String(acc.name || ''));
                                      setLine(i, 'group', isResp ? 'vergi-sorumlu' : 'vergi');
                                    }
                                  }
                                }} onAddNew={(code) => openAddAccount(code)} />
                                <KaynakRozet kaynak={l.kaynak} />
                                {g.key !== 'cari' && g.key !== 'tevkifat'
                                  ? <RateSelect value={String(l.rate || '').replace(/[^0-9]/g, '')} onChange={(v) => setLine(i, 'rate', v ? `%${v}` : '')} />
                                  : null}
                                {g.key === 'tevkifat' ? (
                                  // Tevkifat oranı — Mihsap'taki gibi X/10 seçici (satır rate'inde saklanır,
                                  // PATCH lines ile zaten kaydediliyor). Eski kayıtlarda rate '%20' gibi
                                  // gelebilir — listede yoksa mevcut değeri koru (RateSelect deseni).
                                  <div style={{ flex: '0 0 68px', width: 68 }}>
                                    <PlainSelect value={String(l.rate || '')} onChange={(v) => setLine(i, 'rate', v)} options={(() => {
                                      const opts = ['1/10', '2/10', '3/10', '4/10', '5/10', '6/10', '7/10', '8/10', '9/10', '10/10'];
                                      const cur = String(l.rate || '');
                                      const all = cur && !opts.includes(cur) ? [...opts, cur] : opts;
                                      return [{ value: '', label: '—' }, ...all.map((o) => ({ value: o, label: o }))];
                                    })()} />
                                  </div>
                                ) : null}
                                <MoneyInput value={Number((g.side === 'debit' ? l.debit : l.credit) || 0)} onChange={(n) => setLine(i, g.side, n)} />
                                <button type="button" className="frowdel" title="Satırı sil" onClick={() => delLine(i)}>×</button>
                              </div>
                            ))}
                            {g.key === 'tevkifat' && (
                              // Mihsap'taki "Tevkifat Kodu" alanı — GİB işlem türü kodu (aranabilir).
                              // Kod seçilince oranı BOŞ olan tevkifat satırlarına kodun oranı yazılır
                              // (dolu oranlara dokunulmaz — kullanıcı oranı ayrıca değiştirebilir).
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderTop: '1px dashed var(--line2)' }}>
                                <span style={{ flex: '0 0 auto', fontSize: 11.5, fontWeight: 700, color: '#8a3341' }}>Tevkifat Kodu</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <PlainSelect value={tevkifatKodu} onChange={(kod) => {
                                    setTevkifatKodu(kod);
                                    const oran = TEVKIFAT_KODLARI.find((k) => k.kod === kod)?.oran || '';
                                    if (kod && oran) setLineDraft((arr) => arr.map((l: any) => (l.group === 'tevkifat' && !l.rate ? { ...l, rate: oran } : l)));
                                  }} options={[{ value: '', label: '—' }, ...TEVKIFAT_KODLARI.map((k) => ({ value: k.kod, label: k.oran ? `${k.kod} - (${k.oran}) ${k.ad}` : `${k.kod} - ${k.ad}` }))]} />
                                </div>
                              </div>
                            )}
                            <div className="frowadd" onClick={() => addLine(g.keys[0])}>+ satır ekle</div>
                            <div className="fgt"><span>Toplam</span><b>{fmtMoney(tot)} ₺</b></div>
                            </>)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {!isIsletme && (
                <div className="docmeta docmeta-bottom">
                  <div className="dm"><span className="dml">Tarih</span><input className="dmi" type="date" value={meta.faturaTarihi || ''} onChange={(e) => setMeta({ ...meta, faturaTarihi: e.target.value })} /></div>
                  <div className="dm"><span className="dml">Fatura Türü</span>
                    <PlainSelect value={`${meta.invoiceKind || 'ALIS'}${meta.tevkifatli ? '_TEV' : ''}`} onChange={(v) => { const k = v.startsWith('SATIS') ? 'SATIS' : 'ALIS'; setMeta({ ...meta, invoiceKind: k, tevkifatli: v.endsWith('_TEV') }); setIslKind(k); }} options={[
                      { value: 'ALIS', label: 'Alış' },
                      { value: 'ALIS_TEV', label: 'Tevkifatlı Alış' },
                      { value: 'SATIS', label: 'Satış' },
                      { value: 'SATIS_TEV', label: 'Tevkifatlı Satış' },
                    ]} />
                  </div>
                  <div className="dm"><span className="dml">Belge Türü</span>
                    <PlainSelect value={meta.documentType || ''} onChange={(v) => setMeta({ ...meta, documentType: v })} options={[
                      { value: '', label: '—' },
                      { value: 'E_FATURA', label: 'e-Fatura' },
                      { value: 'E_ARSIV', label: 'e-Arşiv' },
                      { value: 'E_SMM', label: 'e-SMM (Serbest Meslek)' },
                      { value: 'OKC_FIS', label: 'ÖKC Fiş' },
                      { value: 'Z_RAPORU', label: 'Z Raporu' },
                      { value: 'DIGER', label: 'Diğer' },
                    ]} />
                  </div>
                  <div className="dm"><span className="dml">Belge No</span><input className="dmi" value={meta.belgeNo || ''} onChange={(e) => setMeta({ ...meta, belgeNo: e.target.value })} /></div>
                  <div className="dm"><span className="dml">{String(meta.invoiceKind).includes('SATIS') ? 'Alıcı VKN' : 'Satıcı VKN'}</span><input className="dmi" value={meta.vkn || ''} onChange={(e) => setMeta({ ...meta, vkn: e.target.value })} /></div>
                  <div className="dm"><span className="dml">Cari Ünvanı</span><input className="dmi" value={meta.cariUnvan || ''} placeholder="satıcı/alıcı ünvanı" onChange={(e) => setMeta({ ...meta, cariUnvan: e.target.value })} /></div>
                </div>
                )}
                {isIsletme ? (
                  <div className="balance">
                    <Ico html={I.checkSm} size={16} /><b>{islKind === 'SATIS' ? 'Gelir' : 'Gider'} · {islBelgeAd}</b>
                    <span className="bnote">{islKayitAd} · Matrah {fmtMoney(islTotMatrah)} ₺ + KDV {fmtMoney(islTotKdv)} ₺ = {fmtMoney(islTotMatrah + islTotKdv)} ₺{isl.plakaNo ? ` · ${isl.plakaNo}` : ''}</span>
                  </div>
                ) : (
                  <div className="balance" style={!dengeli ? { background: '#fdeaea', borderColor: '#f3c9c9' } : undefined}>
                    <Ico html={I.checkSm} size={16} /><b style={!dengeli ? { color: '#c0353a' } : undefined}>{dengeli ? 'Denge tamam' : 'Denge tutmuyor'}</b>
                    <span className="bnote">Borç {fmtMoney(borc)} {dengeli ? '=' : '≠'} Alacak {fmtMoney(alacak)} ₺</span>
                  </div>
                )}
                <div className="wactions">
                  {isabet && (Number(isabet.toplam) > 0 || Number(isabet.boslukVar) > 0) ? (
                    // İSABET PİLİ — üst bara sığmıyordu; Kaydet satırının SOL boşluğuna taşındı
                    //   (kullanıcı isteği). Detay sayılar ipucu balonunda.
                    <span
                      title={`İsabet panosu (bu dönem):\nDokunmasız: %${Number(isabet.dokunmasizOran) || 0} (${Number(isabet.dokunmasiz) || 0}/${Number(isabet.toplam) || 0}) — hiçbir satırı elle düzeltilmeden onaylanan\nElle düzeltilen: ${Number(isabet.kullaniciDuzeltmeli) || 0}\nEksik kodlu (bekleyen): ${Number(isabet.boslukVar) || 0}`}
                      style={{ display: 'inline-flex', alignItems: 'center', flex: '0 1 auto', minWidth: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', padding: '3px 10px', borderRadius: 999, background: 'rgba(21,128,61,0.07)', border: '1px solid rgba(21,128,61,0.22)', fontSize: 11.5, fontWeight: 700, color: '#15803d', whiteSpace: 'nowrap' }}
                    >
                      Dokunmasız %{Number(isabet.dokunmasizOran) || 0}
                    </span>
                  ) : null}
                  <div className="sp" />
                  <button className="btn sm" disabled={saveMetaMut.isPending || saveLinesMut.isPending} title="Bilgileri ve satırları kaydet — Luca'ya GÖNDERMEZ (kısayol: Ctrl+S)"
                    onClick={() => { saveAll().catch(() => {}); }}>
                    <Ico html={I.checkSm} size={13} /> {(saveMetaMut.isPending || saveLinesMut.isPending) ? 'Kaydediliyor…' : 'Kaydet'}
                  </button>
                  <button className="btn primary sm" disabled={approveMut.isPending || saveMetaMut.isPending || saveLinesMut.isPending || !ggReady} title="Kaydet + Onayla, otomatik sonraki belgeye geç (kısayol: Ctrl+Enter). Luca'ya aktarım AKTARILANLAR ekranından toplu."
                    onClick={() => saveApprove()}>
                    <Ico html={I.checkSm} size={13} /> {approveMut.isPending ? 'Onaylanıyor…' : 'Kaydet ve Onayla'}
                  </button>
                </div>
                </div></div>
              </>
            ) : (
              <div className="empty">Hazır belge yok ya da soldan bir belge seç.</div>
            )}
          </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: AKTARILANLAR ===================== */
function ScreenAktarilanlar({ taxpayerId, period, mode = 'bekleyen', isIsletme = false }: { taxpayerId: string; period: string; mode?: 'bekleyen' | 'arsiv'; isIsletme?: boolean }) {
  const arsiv = mode === 'arsiv';
  const qc = useQueryClient();
  const docsQ = useDocuments(taxpayerId, period);
  const all: any[] = docsQ.data || [];
  // Aktarım = aktarım BEKLEYEN (işlenmiş, henüz Luca'da değil); Arşivim = AKTARILMIŞ (POSTED).
  const docs = all.filter(arsiv ? isArchived : isWaitingTransfer);
  const retryMut = useMutation({
    mutationFn: (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/retry-luca`),
    onSuccess: () => { toast.success("Luca'ya yeniden gönderildi"); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Tekrar denenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // Faz C: onayı geri al (Luca'ya gitmemişse) — tekrar düzenlenebilir.
  const reopenMut = useMutation({
    mutationFn: (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/reopen`),
    onSuccess: () => { toast.success('Onay geri alındı — Muhasebeleştir\'de düzenleyebilirsin'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Geri alınamadı: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // YÖN bazlı toplu aktarım: "Alış'ı aktar" / "Satış'ı aktar" → o yönü TEK fişe çevirir.
  const [aktarYon, setAktarYon] = useState<'' | 'ALIS' | 'SATIS'>('');
  const batchMut = useMutation({
    mutationFn: (direction: 'ALIS' | 'SATIS') => api.post('/fatura-muhasebelestirme/batch-post-to-luca', { taxpayerId, period, direction }),
    onSuccess: (r: any) => {
      const d = r?.data || {};
      const yon = aktarYon === 'SATIS' ? 'Satış' : 'Alış';
      toast.success(`${yon} TEK fiş olarak Luca'ya gönderildi · ${d.documentCount ?? 0} belge${d.skippedInvalid ? ` · ${d.skippedInvalid} veri hatası nedeniyle hariç` : ''}. Ajan açıkken işlenir.`);
      setAktarYon('');
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => { setAktarYon(''); toast.error("Luca'ya aktarılamadı: " + (e?.response?.data?.message || e?.message || 'hata')); },
  });
  const [detayId, setDetayId] = useState<string>('');
  // ONAY = "Aktarıma hazır" (tek tek Luca'ya GİTMEZ). Gerçek aktarım yön butonuyla toplu olur.
  const lucaPill = (d: any) => {
    const s = d.lucaStatus;
    if (s === 'POSTED') return <span className="pill ok">Aktarıldı ✓</span>;
    if (s === 'POSTING') return <span className="pill warn">Aktarılıyor…</span>;
    if (s === 'FAILED' || s === 'ERROR') return <span className="pill miss" title={d.lucaErrorMessage || ''}>Hata</span>;
    return <span className="pill n">Aktarıma hazır</span>;
  };
  const grpLabel = (g: string) => g === 'matrah' ? 'Matrah' : g === 'vergi' ? 'KDV' : g === 'vergi-sorumlu' ? 'Sorumlu Sıf. KDV' : g === 'cari' ? 'Cari' : g === 'tevkifat' ? 'Tevkifat' : (g || '—');
  const renderRow = (d: any) => {
    const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
    const firma = (sat ? d.customerName : d.vendorName) || '—';
    const code = (() => {
      const ls = Array.isArray(d.lines) ? d.lines : [];
      return accountCodeOnly((ls.find((l: any) => String(l.group) === 'matrah' && l.accountCode) || ls.find((l: any) => l.accountCode))?.accountCode || '');
    })();
    const acik = detayId === d.id;
    const lines: any[] = Array.isArray(d.lines) ? d.lines : [];
    return (
      <Fragment key={d.id}>
        <tr className={acik ? 'detay-on' : ''}>
          <td>{fmtDate(d.faturaTarihi || d.createdAt)}</td>
          <td>{d.belgeNo || '—'}</td>
          <td className="firm"><b>{firma}</b></td>
          <td className="num">{fmtMoney(d.totalAmount)}</td>
          <td>{code ? <span className="hk">{code}</span> : <span className="hk no">—</span>}</td>
          <td>{lucaPill(d)}</td>
          {/* td'ye display:flex VERME (hücre tablo düzeninden çıkar) — flex'i içteki div'e koy. */}
          <td className="actcol"><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(d.lucaStatus === 'FAILED' || d.lucaStatus === 'ERROR') && (
              <button className="aico retry" disabled={retryMut.isPending} onClick={() => retryMut.mutate(d.id)} title={d.lucaErrorMessage || "Luca'ya tekrar gönder"}><Ico html={I.sync} size={13} /></button>
            )}
            {d.status === 'APPROVED' && !['POSTED', 'POSTING'].includes(d.lucaStatus) && (
              <button className="aico reopen" disabled={reopenMut.isPending} onClick={() => { if (confirm('Onayı geri al? Belge tekrar düzenlenebilir olacak.')) reopenMut.mutate(d.id); }} title="Onayı geri al (Luca'ya gitmemişse)">↩</button>
            )}
            <button className={`aico detay${acik ? ' on' : ''}`} onClick={() => setDetayId(acik ? '' : d.id)} title={acik ? 'Fiş detayını gizle' : 'Fiş (yevmiye) detayını göster'}>{acik ? '▾' : '▸'}</button>
            <button className="aico eye" onClick={() => openDocFile(d.id)} title="Belgeyi önizle"><Ico html={I.eye} size={14} /></button>
          </div></td>
        </tr>
        {acik && (
          <tr className="detayrow">
            <td colSpan={7}>
              <div className="detaybox">
                {isIsletme ? (() => {
                  // İŞLETME DEFTERİ: hesap kodu / borç-alacak YOK; Gelir-Gider listesi bilgileri gösterilir.
                  const isl: any = (d.ocrData && (d.ocrData as any).isletme) || {};
                  const ktAd = isl.kayitTuruAd || '';
                  const altAd = isl.kayitAltAd || '';
                  const matrah = lines.filter((l: any) => String(l.group) === 'matrah').reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
                  const kdv = lines.filter((l: any) => String(l.group) === 'vergi').reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
                  const acikl = (d.ocrData && (d.ocrData as any).aciklama) || (sat ? d.customerName : d.vendorName) || '';
                  if (!ktAd && !matrah) return <div className="empty" style={{ padding: 10 }}>Kayıt türü / tutar belirlenemedi — Muhasebeleştir'de kontrol et.</div>;
                  return (
                    <table className="detaytbl">
                      <thead><tr><th>İşlem</th><th>Kayıt Türü</th><th>Kayıt Alt Türü</th><th>Açıklama</th><th className="num">Matrah</th><th className="num">KDV</th><th className="num">Tutar</th></tr></thead>
                      <tbody>
                        <tr>
                          <td>{sat ? 'Gelir' : 'Gider'}</td>
                          <td>{ktAd || <span className="hk no">—</span>}</td>
                          <td>{altAd || '—'}</td>
                          <td>{acikl || '—'}</td>
                          <td className="num">{matrah ? fmtMoney(matrah) : ''}</td>
                          <td className="num">{kdv ? fmtMoney(kdv) : ''}</td>
                          <td className="num">{fmtMoney(d.totalAmount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  );
                })() : lines.length ? (
                  <table className="detaytbl">
                    <thead><tr><th>Tür</th><th>Hesap Kodu</th><th>Açıklama</th><th className="num">Borç</th><th className="num">Alacak</th></tr></thead>
                    <tbody>
                      {lines.map((l: any, i: number) => (
                        <tr key={l.id || i}>
                          <td>{grpLabel(String(l.group || ''))}{l.rate ? ` %${String(l.rate).replace(/[^0-9.,]/g, '')}` : ''}</td>
                          <td>{accountCodeOnly(l.accountCode) ? <span className="hk">{accountCodeOnly(l.accountCode)}</span> : <span className="hk no">eksik</span>}</td>
                          <td>{l.description || '—'}</td>
                          <td className="num">{Number(l.debit) ? fmtMoney(l.debit) : ''}</td>
                          <td className="num">{Number(l.credit) ? fmtMoney(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div className="empty" style={{ padding: 10 }}>Bu belgenin fiş satırı yok.</div>}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
  // Toplu fiş Excel'i Luca'ya GİTMEDEN indir (kullanıcı elle yükler/arşivler). Auth gerektiği
  // için axios (blob) ile çekip tarayıcıda indirme tetiklenir.
  const [indiriliyor, setIndiriliyor] = useState<'' | 'ALIS' | 'SATIS'>('');
  const indirExcel = async (yon: 'ALIS' | 'SATIS') => {
    setIndiriliyor(yon);
    try {
      const r = await api.get('/fatura-muhasebelestirme/batch-excel', { params: { taxpayerId, period, direction: yon }, responseType: 'blob' });
      const cd = String(r.headers?.['content-disposition'] || '');
      const m = cd.match(/filename="?([^"]+)"?/);
      const fname = m ? m[1] : `luca-fis-${yon.toLowerCase()}-${period}.xlsx`;
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a'); a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      toast.error('Excel indirilemedi — dengeli/kodlu belge olmayabilir.');
    } finally { setIndiriliyor(''); }
  };
  const renderSection = (yon: 'ALIS' | 'SATIS') => {
    const isSat = yon === 'SATIS';
    const dd = docs.filter((d) => ((d.invoiceKind || 'ALIS') === 'SATIS') === isSat);
    const label = isSat ? 'Satış' : 'Alış';
    const hazir = dd.filter((d) => d.status === 'APPROVED' && !['POSTED', 'POSTING'].includes(d.lucaStatus));
    const toplam = hazir.reduce((s, d) => s + (Number(d.totalAmount) || 0), 0);
    const busy = batchMut.isPending && aktarYon === yon;
    return (
      <div className="card" key={yon}>
        <div className="aktarbar">
          <div className="akbil">
            <span className={`pill ${isSat ? 'satis' : 'alis'}`}>{label} Faturaları</span>{' '}
            {arsiv
              ? (dd.length ? <><b>{dd.length}</b> belge Luca'ya aktarıldı ✓</> : <>Aktarılmış {label.toLowerCase()} belge yok</>)
              : (hazir.length > 0
                  ? <><b>{hazir.length}</b> belge aktarıma hazır · toplam <b>{fmtMoney(toplam)} ₺</b></>
                  : <>Aktarıma hazır {label.toLowerCase()} belge yok</>)}
          </div>
          {!arsiv && (
            <>
              <div className="sp" />
              <button className="btn sm" disabled={indiriliyor === yon || dd.length === 0} onClick={() => indirExcel(yon)} title="Bu yöndeki toplu fişi Excel olarak indir — Luca'ya elle yükle ya da arşivle">
                {indiriliyor === yon ? 'İndiriliyor…' : '⬇ Excel İndir'}
              </button>
              <button className="btn primary" disabled={batchMut.isPending || hazir.length === 0} onClick={() => { setAktarYon(yon); batchMut.mutate(yon); }}>
                <Ico html={I.send} size={14} /> {busy ? 'Aktarılıyor…' : `${label}'ı tek fiş olarak aktar${hazir.length ? ` (${hazir.length})` : ''}`}
              </button>
            </>
          )}
        </div>
        <div className="twrap">
          <table>
            <thead><tr><th>Tarih</th><th>Fatura No</th><th>Firma</th><th className="num">Tutar</th><th>Hesap Kodu</th><th>Durum</th><th className="actcol" style={{ width: 40 }} /></tr></thead>
            <tbody>
              {dd.map(renderRow)}
              {dd.length === 0 && (
                <tr><td colSpan={7}><div className="empty">{arsiv ? `Aktarılmış ${label.toLowerCase()} belge yok.` : `Aktarıma hazır ${label.toLowerCase()} belge yok.`}</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <section className="screen">
      <div className="h2">{arsiv ? "Arşivim — Luca'ya Aktarılanlar" : "Aktarım — Luca'ya Toplu Fiş"}</div>
      <div className="sub">{arsiv
        ? <>Luca'ya aktarılmış (fişi kesilmiş) faturaların arşivi ({period}). Buradakiler işlenmiş ve Luca'da.</>
        : <>İşlenmiş, Luca'ya aktarım <b>BEKLEYEN</b> faturalar. <b>Alış</b> ve <b>Satış</b> AYRI birer <b>tek toplu fiş</b> olarak aktarılır ({period}). Aktarılınca <b>Arşivim</b>'e geçer.</>}</div>
      {docsQ.isLoading
        ? <div className="card"><div className="ch"><h3>Yükleniyor…</h3></div></div>
        : <>{renderSection('ALIS')}{renderSection('SATIS')}</>}
    </section>
  );
}

/* ===================== EKRAN: ENTEGRATÖRLER ===================== */
const PROVIDER_OPTS = [
  { v: 'PARASUT', l: 'Paraşüt' },
  { v: 'TURKCELL', l: 'Turkcell e-Şirket' },
  { v: 'TURMOB_EFATURA', l: 'TÜRMOB e-Fatura' },
  { v: 'UYUMSOFT', l: 'Uyumsoft' },
  { v: 'IZIBIZ', l: 'İzibiz' },
  { v: 'NILVERA', l: 'Nilvera' },
  { v: 'GIB_PORTAL', l: 'GİB e-Arşiv' },
  { v: 'ELOGO', l: 'e-Logo' },
];
function provKisalt(label: string, provider: string): string {
  if (provider === 'TURMOB_EFATURA') return 'TR';
  if (provider === 'PARASUT') return 'PŞ';
  if (provider === 'GIB_PORTAL') return 'GİB';
  return (label || provider).replace(/[^A-Za-zÇĞİÖŞÜ]/g, '').slice(0, 2).toUpperCase();
}

function ScreenEntegrator({ taxpayerId, period }: { taxpayerId: string; period: string }) {
  const qc = useQueryClient();
  const intQ = useQuery({
    queryKey: ['fm2', 'integrations', taxpayerId],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/integrations', { params: { taxpayerId: taxpayerId || undefined } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
    enabled: !!taxpayerId,
  });
  const configured: any[] = (intQ.data || []).filter((x: any) => x.configured);

  const [provider, setProvider] = useState('PARASUT');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const isParasut = provider === 'PARASUT';
  const isTurkcell = provider === 'TURKCELL';
  const resetForm = () => { setUsername(''); setPassword(''); setApiKey(''); setApiSecret(''); setAccountId(''); };
  const openAdd = () => { setEditMode(false); resetForm(); setProvider('PARASUT'); setShowAddForm(true); };
  const openEdit = (c: any) => { setEditMode(true); setProvider(c.provider); setUsername(c.username || ''); setAccountId(c.accountId || ''); setApiKey(''); setApiSecret(''); setPassword(''); setShowAddForm(true); };

  const saveMut = useMutation({
    mutationFn: () =>
      api.post('/fatura-muhasebelestirme/integrations', {
        provider,
        taxpayerId: taxpayerId || undefined,
        username: username || undefined,
        password: password || undefined,
        apiKey: apiKey || undefined,
        apiSecret: apiSecret || undefined,
        accountId: accountId || undefined,
        isActive: true,
      }),
    onSuccess: () => {
      toast.success(editMode ? 'Entegratör güncellendi' : 'Entegratör kaydedildi');
      qc.invalidateQueries({ queryKey: ['fm2', 'integrations'] });
      resetForm(); setEditMode(false); setShowAddForm(false);
    },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const fetchMut = useMutation({
    mutationFn: (prov: string) =>
      api.post('/fatura-muhasebelestirme/integrations/fetch', { taxpayerId: taxpayerId || undefined, providers: [prov], direction: 'ALIS', donem: period }),
    onSuccess: (r: any) => { showFetchResult(r?.data); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Sorgu başarısız: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const talimatMut = useMutation({
    mutationFn: (v: { provider: string; active: boolean }) =>
      api.post('/fatura-muhasebelestirme/integrations/talimat', { taxpayerId: taxpayerId || undefined, provider: v.provider, active: v.active }),
    onSuccess: () => { toast.success('Talimat güncellendi'); qc.invalidateQueries({ queryKey: ['fm2', 'integrations'] }); },
    onError: () => toast.error('Talimat güncellenemedi'),
  });
  const delMut = useMutation({
    mutationFn: (prov: string) =>
      api.delete('/fatura-muhasebelestirme/integrations', { params: { taxpayerId: taxpayerId || undefined, provider: prov } }),
    onSuccess: () => { toast.success('Entegratör kaldırıldı'); qc.invalidateQueries({ queryKey: ['fm2', 'integrations'] }); },
    onError: () => toast.error('Kaldırılamadı'),
  });

  if (!taxpayerId) {
    return (
      <section className="screen">
        <div className="h2">Entegratörler</div>
        <div className="sub">Entegratör bağlantıları mükellefe göre tanımlanır — önce üstten bir mükellef seç.</div>
        <div className="card"><div className="empty">Mükellef seçilmedi.</div></div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="h2">Entegratörler</div>
      <div className="sub">Mükellefin faturalarını çektiğimiz kaynaklar. Şifreler şifreli saklanır; çekme her gece otomatik yapılır.</div>
      <div className="card">
        <div className="ch"><h3>Bağlı Entegratörler</h3><div className="sp" /></div>
        <div style={{ padding: 16 }}>
          {intQ.isLoading ? (
            <div className="empty">Yükleniyor…</div>
          ) : configured.length === 0 ? (
            <div className="empty">Bu mükellefte tanımlı entegratör yok. Aşağıdan ekle.</div>
          ) : (
            <div className="egrid">
              {configured.map((c: any) => (
                <div key={c.provider} className="ecard">
                  <div className="eh">
                    <div className="ei">{provKisalt(c.label, c.provider)}</div>
                    <div className="en"><b>{c.label || c.provider}</b><small>{c.username ? `Kullanıcı: ${c.username}` : c.kind}</small></div>
                    <span className={`pill ${c.isActive ? 'ok' : 'warn'}`} style={{ marginLeft: 'auto' }}>{c.isActive ? 'Bağlı' : 'Pasif'}</span>
                  </div>
                  <div className="erow"><span>Son çekim</span><span>{c.lastSyncAt ? fmtDate(c.lastSyncAt) : '—'}</span></div>
                  <div className="erow"><span>Gece otomatik</span><span>{c.talimat ? 'Açık' : 'Kapalı'}</span></div>
                  <div className="ebtns">
                    <button className="btn ghost sm" disabled={fetchMut.isPending} onClick={() => fetchMut.mutate(c.provider)}>{fetchMut.isPending ? 'Sorgulanıyor…' : 'Sorgula'}</button>
                    <button className="btn ghost sm" disabled={talimatMut.isPending} onClick={() => talimatMut.mutate({ provider: c.provider, active: !c.talimat })}>{c.talimat ? 'Otomatiği kapat' : 'Otomatiği aç'}</button>
                    <button className="btn ghost sm" onClick={() => openEdit(c)}>Güncelle</button>
                    <button className="btn ghost sm" disabled={delMut.isPending} onClick={() => { if (window.confirm(`${c.label || c.provider} kaldırılsın mı?`)) delMut.mutate(c.provider); }}>Kaldır</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            {!showAddForm && (
              <button className="btn primary entadd" type="button" onClick={openAdd}><span className="entplus">+</span> Yeni entegratör ekle</button>
            )}
            {showAddForm && (<>
            <div className="ph entaddhead" style={{ marginBottom: 10 }}>{editMode ? 'Entegratör bilgilerini güncelle' : 'Yeni entegratör ekle'}<button className="entclose" type="button" onClick={() => { setShowAddForm(false); setEditMode(false); }}>Vazgeç</button></div>
            <div className="eform">
              <div className="erw">
                <div className="fld"><label>Entegratör</label>
                  <select value={provider} disabled={editMode} onChange={(e) => setProvider(e.target.value)}>
                    {PROVIDER_OPTS.map((p) => (<option key={p.v} value={p.v}>{p.l}</option>))}
                  </select>
                </div>
                <div className="fld"><label>{isTurkcell ? 'API Key' : `client_id${isParasut ? '' : ' (varsa)'}`}</label><input autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isParasut ? 'Paraşüt destekten alınan' : isTurkcell ? 'Turkcell panelinden alınan API anahtarı' : '—'} /></div>
              </div>
              <div className="erw">
                <div className="fld"><label>client_secret</label><input type="password" autoComplete="new-password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="••••••••" /></div>
                <div className="fld"><label>{isParasut ? 'Firma No (opsiyonel)' : 'Hesap / Firma No'}</label><input autoComplete="off" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder={isParasut ? 'boş bırak → otomatik bulunur' : '—'} /></div>
              </div>
              <div className="erw">
                <div className="fld"><label>Kullanıcı adı</label><input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mükellefin giriş kullanıcısı" /></div>
                <div className="fld"><label>Şifre</label><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editMode ? 'değiştirmek için yaz — boş bırakırsan eski şifre korunur' : '••••••••'} /></div>
              </div>
              <div className="erw">
                <div className="fld" /><div className="fld endcol">
                  <button className="btn primary" style={{ height: 35 }} disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                    <Ico html={I.checkSm} size={13} /> {saveMut.isPending ? 'Kaydediliyor…' : 'Kaydet'}
                  </button>
                </div>
              </div>
            </div></>)}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: KDV RAPORU ===================== */
function ScreenKdv({ taxpayerId, period }: { taxpayerId: string; period: string }) {
  const repQ = useQuery({
    queryKey: ['fm2', 'kdv-report', taxpayerId, period],
    queryFn: () =>
      api.get('/fatura-muhasebelestirme/kdv-client-report', { params: { taxpayerId, period } })
        .then((r) => r.data)
        .catch(() => null),
    enabled: !!taxpayerId,
  });
  const rep: any = repQ.data;

  // WhatsApp bilgilendirme — önce ÖNIZLEME (dryRun), kullanıcı modalda ONAYLAYINCA gönderilir.
  const [waAcik, setWaAcik] = useState(false);
  const [waYukleniyor, setWaYukleniyor] = useState(false);
  const [waOnizleme, setWaOnizleme] = useState<{ telefon: string; mesaj: string } | null>(null);
  const [waTelefon, setWaTelefon] = useState('');
  const waOnizle = async () => {
    setWaYukleniyor(true);
    try {
      const r = await api.post('/fatura-muhasebelestirme/kdv-raporu/whatsapp', { taxpayerId, period, dryRun: true });
      setWaOnizleme({ telefon: r.data?.telefon || '', mesaj: r.data?.mesaj || '' });
      setWaTelefon(r.data?.telefon || '');
      setWaAcik(true);
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Önizleme hazırlanamadı'); }
    finally { setWaYukleniyor(false); }
  };
  const waGonder = async () => {
    setWaYukleniyor(true);
    try {
      await api.post('/fatura-muhasebelestirme/kdv-raporu/whatsapp', { taxpayerId, period, dryRun: false, telefon: waTelefon.trim() });
      toast.success('WhatsApp bilgilendirme gönderildi ✅');
      setWaAcik(false);
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Gönderilemedi'); }
    finally { setWaYukleniyor(false); }
  };
  // PDF çıktı — markalı temiz yazdırma penceresi (tarayıcının "PDF olarak kaydet"i ile PDF alınır).
  const pdfYazdir = () => {
    if (!rep) return;
    const p = (n: any) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const kat = (rep.categoryRows || []).map((c: any) => `<tr><td>${c.label}</td><td>${c.side === 'SATIS' ? 'Satış' : 'Alış'}</td><td class="n">${p(c.base)}</td><td class="n">${p(c.vat)}</td><td class="n">${p(c.total)}</td><td class="n">${c.count ?? ''}</td></tr>`).join('');
    const oran = (rep.vatByRate || []).map((v: any) => `<tr><td>${v.side === 'SATIS' ? 'Satış' : 'Alış'}</td><td class="n">${v.rate == null ? 'Diğer' : '%' + v.rate}</td><td class="n">${p(v.base)}</td><td class="n">${p(v.vat)}</td></tr>`).join('');
    const notlar = (rep.assessment || []).map((s: string) => `<li>${s}</li>`).join('');
    const dv = rep.devreden;
    const sonuc = dv
      ? (Number(rep.totals?.payableVat) > 0
        ? `Ödenecek KDV (tahmini): <b>${p(rep.totals.payableVat)} ₺</b>`
        : `Sonraki Döneme Devreden KDV (tahmini): <b>${p(rep.totals?.carryForwardVat)} ₺</b> (ödeme çıkmıyor)`)
      : 'Devreden KDV: önceki dönem beyanname kaydı bulunamadığından hesaba katılmadı.';
    const w = window.open('', '_blank', 'width=920,height=720');
    if (!w) { toast.error('Açılır pencere engellendi — tarayıcı iznini kontrol et'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>KDV Raporu — ${rep.taxpayer?.name || ''} ${rep.periodLabel || ''}</title><style>
      body{font-family:'Segoe UI',Arial,sans-serif;color:#1c2733;margin:28px}
      .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1f3a5f;padding-bottom:10px;margin-bottom:6px}
      .hd h1{margin:0;font-size:20px;color:#1f3a5f} .hd .alt{color:#8a6410;font-weight:700;font-size:12px;letter-spacing:.6px;text-align:right}
      .mt{font-size:12.5px;color:#4c5a68;margin:2px 0 12px}
      .kartlar{display:flex;gap:10px;margin:12px 0 14px} .k{flex:1;border:1px solid #d8e0e8;border-radius:8px;padding:8px 12px}
      .k .l{font-size:10px;font-weight:700;color:#6b7885;text-transform:uppercase;letter-spacing:.5px} .k .v{font-size:16px;font-weight:800;margin-top:2px;color:#1f3a5f}
      .sonuc{font-size:13.5px;font-weight:700;color:#1f3a5f;background:#eef4f9;border:1px solid #d8e0e8;border-radius:8px;padding:8px 12px}
      h2{font-size:13px;color:#1f3a5f;margin:16px 0 6px} table{width:100%;border-collapse:collapse;font-size:11.5px}
      th{background:#eef4f9;color:#1f3a5f;text-align:left;padding:5px 8px;border:1px solid #d8e0e8} td{padding:5px 8px;border:1px solid #e3e9ef} td.n,th.n{text-align:right}
      ul{font-size:11.5px;color:#374553;margin:6px 0;padding-left:18px} li{margin-bottom:4px}
      .not{margin-top:14px;font-size:10.5px;color:#8a94a0;border-top:1px solid #e3e9ef;padding-top:8px}
    </style></head><body>
      <div class="hd"><div><h1>KDV Raporu — ${rep.periodLabel || ''}</h1><div class="mt">${rep.taxpayer?.name || ''}${rep.taxpayer?.taxNumber ? ' · VKN/TCKN: ' + rep.taxpayer.taxNumber : ''}</div></div><div class="alt">MOREN<br/>MALİ MÜŞAVİRLİK</div></div>
      <div class="kartlar">
        <div class="k"><div class="l">Hesaplanan KDV (Satış)</div><div class="v">${p(rep.totals?.calculatedVat)} ₺</div></div>
        <div class="k"><div class="l">İndirilecek KDV (Alış)</div><div class="v">${p(rep.totals?.deductibleVat)} ₺</div></div>
        <div class="k"><div class="l">Önceki Dönem Devreden</div><div class="v">${dv ? p(dv.tutar) + ' ₺' : '—'}</div></div>
        <div class="k"><div class="l">Belge Sayısı</div><div class="v">${rep.quality?.invoiceCount ?? 0}</div></div>
      </div>
      <div class="sonuc">${sonuc}</div>
      <h2>Kategori Dağılımı</h2><table><tr><th>Kategori</th><th>Yön</th><th class="n">Matrah</th><th class="n">KDV</th><th class="n">Toplam</th><th class="n">Adet</th></tr>${kat}</table>
      ${oran ? `<h2>Orana Göre KDV</h2><table><tr><th>Yön</th><th class="n">Oran</th><th class="n">Matrah</th><th class="n">KDV</th></tr>${oran}</table>` : ''}
      ${notlar ? `<h2>Değerlendirme</h2><ul>${notlar}</ul>` : ''}
      <div class="not">Bu rapor fatura kayıtlarına göre hazırlanan beyan öncesi taslaktır; kesin tutarlar beyanname ile netleşir. · Üretim: ${new Date().toLocaleString('tr-TR')}</div>
    </body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* pencere kapatıldıysa */ } }, 350);
  };

  if (!taxpayerId) {
    return (
      <section className="screen">
        <div className="h2">KDV Raporu</div>
        <div className="sub">Mükellefin fatura kayıtlarına göre KDV özeti — önce üstten bir mükellef seç.</div>
        <div className="card"><div className="empty">Mükellef seçilmedi.</div></div>
      </section>
    );
  }

  const t = rep?.totals || {};
  return (
    <section className="screen">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="h2">KDV Raporu</div>
          <div className="sub">{rep?.taxpayer?.name || ''} · {rep?.periodLabel || period} — fatura kayıtlarına göre (beyan öncesi taslak).</div>
        </div>
        <button className="btn sm" disabled={!rep} onClick={pdfYazdir} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Markalı yazdırma görünümü açılır — yazıcıdan 'PDF olarak kaydet' ile PDF alırsın">
          {/* Kırmızı PDF belge ikonu */}
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="#d93025" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path fill="#ffffff" opacity=".35" d="M15 2v5h5z" /><text x="12" y="17.5" textAnchor="middle" fontSize="7" fontWeight="800" fill="#fff">PDF</text></svg>
          PDF çıktı al
        </button>
        <button className="btn sm" disabled={!rep || waYukleniyor} onClick={waOnizle} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#25D366', borderColor: '#1ebe57', color: '#fff', fontWeight: 700 }} title="Mükellefe WhatsApp'tan dönem KDV bilgilendirmesi — önce önizleme görürsün, onayınla gönderilir">
          {/* Resmi WhatsApp logosu */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
          {waYukleniyor && !waAcik ? 'Hazırlanıyor…' : 'WhatsApp bilgi ver'}
        </button>
      </div>

      {repQ.isLoading ? (
        <div className="card"><div className="empty">Yükleniyor…</div></div>
      ) : !rep ? (
        <div className="card"><div className="empty">Bu dönem için veri bulunamadı.</div></div>
      ) : (
        <>
          {/* KDV özet kartları — tasarım imzası: sol renk şeridi + yumuşak degrade + alt açıklama.
              Sonuç kartı DİNAMİK: devir çıkıyorsa "Sonraki Döneme Devreden KDV", ödeme çıkıyorsa
              "Ödenecek KDV" (kullanıcı isteği). */}
          <div className="kdvstats">
            <div className="kdvst kdvst-hes"><div className="kl">Hesaplanan KDV</div><div className="kv">{fmtMoney(t.calculatedVat)}</div><div className="ka">satış faturaları</div></div>
            <div className="kdvst kdvst-ind"><div className="kl">İndirilecek KDV</div><div className="kv">{fmtMoney(t.deductibleVat)}</div><div className="ka">alış / gider faturaları</div></div>
            <div className="kdvst kdvst-frk"><div className="kl">Dönem KDV Farkı</div><div className="kv" style={{ color: Number(t.periodVatDifference) < 0 ? '#b02a37' : undefined }}>{fmtMoney(t.periodVatDifference)}</div><div className="ka">hesaplanan − indirilecek</div></div>
            <div className="kdvst kdvst-dev" title={rep?.devreden ? `Kaynak: ${rep.devreden.donem} dönemi KDV1 beyannamesindeki "Sonraki Döneme Devreden KDV" satırı` : 'Önceki dönem KDV1 beyannamesi sistemde bulunamadı'}>
              <div className="kl">Önceki Dönemden Devreden</div>
              <div className="kv">{rep?.devreden ? fmtMoney(rep.devreden.tutar) : '—'}</div>
              <div className="ka">{rep?.devreden ? 'beyannameden okundu ✓' : 'beyanname kaydı yok'}</div>
            </div>
            {rep?.devreden && Number(t.payableVat) > 0 ? (
              <div className="kdvst kdvst-ode"><div className="kl">Ödenecek KDV (tahmini)</div><div className="kv">{fmtMoney(t.payableVat)}</div><div className="ka">fark − devreden · beyanla netleşir</div></div>
            ) : (
              <div className="kdvst kdvst-son"><div className="kl">Sonraki Döneme Devreden (tahmini)</div><div className="kv">{rep?.devreden ? fmtMoney(t.carryForwardVat) : '—'}</div><div className="ka">{rep?.devreden ? 'ödeme çıkmıyor' : 'devreden bilinmeden hesaplanamaz'}</div></div>
            )}
            <div className="kdvst kdvst-bel"><div className="kl">Belge</div><div className="kv">{rep?.quality?.invoiceCount ?? '—'}</div><div className="ka">{rep?.quality?.sourceCounts?.sales ?? 0} satış · {rep?.quality?.sourceCounts?.purchase ?? 0} alış</div></div>
          </div>

          <div className="card">
            <div className="ch"><h3>Kategori dağılımı</h3></div>
            <div className="twrap">
              <table>
                <thead><tr><th>Kategori</th><th>Yön</th><th className="num">Matrah</th><th className="num">KDV</th><th className="num">Toplam</th><th className="num">Adet</th></tr></thead>
                <tbody>
                  {(rep.categoryRows || []).map((c: any) => (
                    <tr key={c.key}>
                      <td><b>{c.label}</b></td>
                      <td><span className={`pill ${c.side === 'SATIS' ? 'satis' : 'alis'}`}>{c.side === 'SATIS' ? 'Satış' : 'Alış'}</span></td>
                      <td className="num">{fmtMoney(c.base)}</td>
                      <td className="num">{fmtMoney(c.vat)}</td>
                      <td className="num">{fmtMoney(c.total)}</td>
                      <td className="num">{c.count ?? '—'}</td>
                    </tr>
                  ))}
                  {(rep.categoryRows || []).length === 0 && <tr><td colSpan={6}><div className="empty">Kategori verisi yok.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {Array.isArray(rep.vatByRate) && rep.vatByRate.length > 0 && (
            <div className="card">
              <div className="ch"><h3>Orana göre KDV</h3></div>
              <div className="twrap">
                <table>
                  <thead><tr><th>Yön</th><th className="num">Oran</th><th className="num">Matrah</th><th className="num">KDV</th></tr></thead>
                  <tbody>
                    {rep.vatByRate.map((v: any, i: number) => (
                      <tr key={i}>
                        <td><span className={`pill ${v.side === 'SATIS' ? 'satis' : 'alis'}`}>{v.side === 'SATIS' ? 'Satış' : 'Alış'}</span></td>
                        <td className="num">{v.rate == null ? 'Diğer' : `%${v.rate}`}</td>
                        <td className="num">{fmtMoney(v.base)}</td>
                        <td className="num">{fmtMoney(v.vat)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ba/Bs taslağı KALDIRILDI — Ba/Bs bildirimi artık verilmiyor (kullanıcı, 2026-07-19). */}
          {Array.isArray(rep.assessment) && rep.assessment.length > 0 && (
            <div className="card">
              <div className="ch"><h3>Değerlendirme</h3></div>
              <div style={{ padding: '6px 16px 14px' }}>
                {rep.assessment.map((line: string, i: number) => (
                  <div key={i} className="lrow" style={{ borderBottom: i === rep.assessment.length - 1 ? 'none' : undefined }}>
                    <div className="ico"><Ico html={I.info} size={14} /></div>
                    <div className="lx">{line}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {waAcik && waOnizleme && (
        // WhatsApp ÖNIZLEME + ONAY modali — mesaj mükellefe YALNIZ "Onayla ve Gönder" ile gider.
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'grid', placeItems: 'center' }} onClick={() => !waYukleniyor && setWaAcik(false)}>
          <div style={{ width: 540, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto', background: '#fff', borderRadius: 12, padding: '16px 18px', boxShadow: '0 18px 50px rgba(0,0,0,.25)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#1f3a5f', marginBottom: 4 }}>💬 WhatsApp bilgilendirme — önizleme</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Mesaj aşağıdaki numaraya gönderilecek; numarayı düzenleyebilirsin. Onaylamadan hiçbir şey gönderilmez.</div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.4px' }}>Telefon</label>
            <input value={waTelefon} onChange={(e) => setWaTelefon(e.target.value)} style={{ width: '100%', height: 32, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 10px', margin: '4px 0 10px', fontSize: 13, fontFamily: 'inherit' }} />
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.55, background: '#ecfdf3', border: '1px solid #bbe5c8', borderRadius: 10, padding: '10px 12px', color: '#14532d' }}>{waOnizleme.mesaj}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn sm" disabled={waYukleniyor} onClick={() => setWaAcik(false)}>Vazgeç</button>
              <button className="btn sm primary" disabled={waYukleniyor || !waTelefon.trim()} onClick={waGonder}>{waYukleniyor ? 'Gönderiliyor…' : 'Onayla ve Gönder'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===================== EKRAN: AYARLAR ===================== */
function ScreenAyarlar({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const planQ = useQuery({
    queryKey: ['fm2', 'account-plan', taxpayerId, q],
    queryFn: () =>
      api.get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, q: q || undefined, limit: 5000 } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
    enabled: !!taxpayerId,
  });
  const accounts: any[] = planQ.data || [];
  const localCount = accounts.filter((a) => a.local && !a.syncedToLuca).length;

  // İŞ DURUMU (kullanıcı bulgusu — "ne yapıyor bilmiyorum, sonuçlandığını görmüyorum"): "Luca'dan yenile"
  //   fire-and-forget'ti; çekme dakikalarca sürerken ekranda hiçbir gösterge yoktu. ACCOUNT_PLAN job'ını
  //   poll et → bu mükellef için pending/running iş varsa "çekiliyor" şeridi göster, bitince kalksın.
  const jobsQ = useQuery({
    queryKey: ['fm2', 'account-plan-jobs', taxpayerId],
    queryFn: () => api.get('/luca/jobs', { params: { tip: 'ACCOUNT_PLAN', limit: 5 } }).then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
    enabled: !!taxpayerId,
    refetchInterval: 3000,
  });
  const planBusy = (jobsQ.data || []).some((j: any) =>
    String(j.tip) === 'ACCOUNT_PLAN' && String(j.mukellefId) === String(taxpayerId) &&
    ['pending', 'running'].includes(String(j.status || '').toLowerCase()));

  const refreshMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/account-plan/refresh', { taxpayerId }),
    onSuccess: () => { toast.success('Hesap planı yenileme Luca kuyruğuna alındı'); qc.invalidateQueries({ queryKey: ['fm2', 'account-plan'] }); jobsQ.refetch(); },
    onError: (e: any) => toast.error('Yenilenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const pushMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/account-plan/push-to-luca', { taxpayerId }),
    onSuccess: () => { toast.success("Yerel hesaplar Luca'ya gönderiliyor"); qc.invalidateQueries({ queryKey: ['fm2', 'account-plan'] }); },
    onError: (e: any) => toast.error('Gönderilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });

  if (!taxpayerId) {
    return (
      <section className="screen">
        <div className="h2">Hesap Planı</div>
        <div className="sub">Hesap planı mükellefe göre yönetilir — önce üstten bir mükellef seç.</div>
        <div className="card"><div className="empty">Mükellef seçilmedi.</div></div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="h2">Hesap Planı</div>
      <div className="sub">Mükellefin hesap planı — Luca'dan çekilir, yerel açılan hesaplar Luca'ya gönderilebilir.</div>
      <div className="card">
        <div className="ch planhead">
          <h3>Hesap Planı{accounts.length ? <span className="cnt">{accounts.length}{q ? ' eşleşme' : ' hesap'}</span> : null}</h3>
          <div className="sp" />
          <input className="fmsel" style={{ maxWidth: 220 }} placeholder="Kod / ad ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm ghost" disabled={refreshMut.isPending || planBusy} onClick={() => refreshMut.mutate()}><Ico html={I.sync} size={13} /> {(refreshMut.isPending || planBusy) ? 'Çekiliyor…' : "Luca'dan yenile"}</button>
          <button className="btn sm primary" disabled={pushMut.isPending || localCount === 0} onClick={() => pushMut.mutate()} title={localCount === 0 ? 'Gönderilecek yerel hesap yok' : ''}><Ico html={I.send} size={13} /> {pushMut.isPending ? 'Gönderiliyor…' : `Yerelleri gönder${localCount ? ` (${localCount})` : ''}`}</button>
        </div>
        <div className="twrap planwrap" style={{ position: 'relative' }}>
          {planBusy && (
            <div className="queryveil">
              <div className="querydoc" aria-hidden="true"><span /><i /><i /><i /></div>
              <b>Hesap planı Luca'dan çekiliyor…</b>
            </div>
          )}
          <table>
            <thead><tr><th>Kod</th><th>Hesap Adı</th><th>Durum</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id || a.code}>
                  <td><span className="hk">{a.code}</span></td>
                  <td>{a.name || '—'}</td>
                  <td>{a.local && !a.syncedToLuca ? <span className="pill warn">yerel · gönderilmedi</span> : <span className="pill ok">Luca'da</span>}</td>
                </tr>
              ))}
              {!planQ.isLoading && accounts.length === 0 && (
                <tr><td colSpan={3}><div className="empty">Hesap planı yok. "Luca'dan yenile" ile çek.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: GENEL BAKIŞ ===================== */
// Yumuşak (Catmull-Rom) eğri — alan grafiği için
function smoothLine(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function ScreenGenel({ taxpayers, period, onOpen }: { taxpayers: any[]; period: string; onOpen: (id: string) => void }) {
  const sumQ = useQuery({
    queryKey: ['fm2', 'per-taxpayer', period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/per-taxpayer-summary', { params: { period } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
  });
  const rows: any[] = sumQ.data || [];
  const pendingOf = (r: any) => Number(r.pendingAlis || 0) + Number(r.pendingSatis || 0);
  const tot = rows.reduce(
    (a, r) => ({
      pending: a.pending + pendingOf(r),
      posted: a.posted + Number(r.postedToLuca || 0),
      issue: a.issue + Number(r.hasIssue || 0),
    }),
    { pending: 0, posted: 0, issue: 0 },
  );
  // ── Grafik verileri ──
  const donutTotal = tot.pending + tot.posted + tot.issue;
  const alisTot = rows.reduce((a, r) => a + Number(r.pendingAlis || 0), 0);
  const satisTot = rows.reduce((a, r) => a + Number(r.pendingSatis || 0), 0);
  const completionPct = donutTotal > 0 ? Math.round((tot.posted / donutTotal) * 100) : 0;
  // ── Belge yükü dağılımı — EN ÇOK BEKLEYEN MÜKELLEFLER (yatay bar; ad+sayı okunur, tıklanınca aç) ──
  const tpById = new Map<string, any>((taxpayers || []).map((t: any) => [t.id, t]));
  const loadAll = rows
    .map((r: any) => ({ id: r.taxpayerId as string, name: taxpayerLabel(tpById.get(r.taxpayerId) || {}), alis: Number(r.pendingAlis || 0), satis: Number(r.pendingSatis || 0), pending: pendingOf(r), issue: Number(r.hasIssue || 0) }))
    .filter((x) => x.pending > 0)
    .sort((a, b) => b.pending - a.pending);
  const loadCount = loadAll.length;
  const loadMax = loadAll[0]?.pending || 1;
  // SAF GRAFİK (firma adı YOK) — alış (mavi) + satış (yeşil) yumuşak alan eğrileri; mükellef bazında
  //   bekleyen belge dağılımı. Kullanıcı isteği: sadece grafik görünsün, isim/lejant listesi olmasın.
  const GW = 1000, GH = 210, GP = 6;
  const buildPts = (vals: number[], ymax: number) => {
    let s = vals;
    if (s.length === 0) return [] as { x: number; y: number }[];
    if (s.length === 1) s = [s[0], s[0]];
    const n = s.length;
    return s.map((v, i) => ({ x: GP + (i / (n - 1)) * (GW - 2 * GP), y: (GH - GP) - (v / ymax) * (GH - 2 * GP) }));
  };
  const gYmax = Math.max(1, ...loadAll.map((x) => Math.max(x.alis, x.satis)));
  const alisLine = smoothLine(buildPts(loadAll.map((x) => x.alis), gYmax));
  const satisLine = smoothLine(buildPts(loadAll.map((x) => x.satis), gYmax));
  const areaOf = (line: string) => (line ? `${line} L ${GW - GP} ${GH} L ${GP} ${GH} Z` : '');
  const ringDash = (completionPct / 100) * 402.12;
  return (
    <section className="screen">
      <div className="h2">Genel Bakış</div>
      <div className="sub">{period} dönemi — belge durumu, dağılım ve dikkat gerektiren mükellefler.</div>
      {/* ── RENKLİ ÖZET KUTUCUKLARI ── */}
      <div className="ovtiles">
        <div className="ovtile t-indigo">
          <div className="ovtic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg></div>
          <div className="ovtnum">{donutTotal}</div>
          <div className="ovtl">Toplam Belge</div>
        </div>
        <div className="ovtile t-amber">
          <div className="ovtic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></svg></div>
          <div className="ovtnum">{tot.pending}</div>
          <div className="ovtl">Bekleyen</div>
        </div>
        <div className="ovtile t-blue">
          <div className="ovtic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" /></svg></div>
          <div className="ovtnum">{alisTot}</div>
          <div className="ovtl">Bekleyen Alış</div>
        </div>
        <div className="ovtile t-teal">
          <div className="ovtic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9" /><path d="M7 14l5-5 5 5" /><path d="M4 3h16" /></svg></div>
          <div className="ovtnum">{satisTot}</div>
          <div className="ovtl">Bekleyen Satış</div>
        </div>
        <div className="ovtile t-red">
          <div className="ovtic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg></div>
          <div className="ovtnum">{tot.issue}</div>
          <div className="ovtl">Sorunlu</div>
        </div>
        <div className="ovtile t-green">
          <div className="ovtic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg></div>
          <div className="ovtnum">{tot.posted}</div>
          <div className="ovtl">Luca'ya Aktarıldı</div>
        </div>
      </div>
      {/* ── DALGA GRAFİĞİ + İŞLENME HALKASI ── */}
      <div className="ovcharts">
        <div className="card ovwave">
          <div className="ch"><h3>Belge yükü dağılımı</h3><div className="sp" /><span className="ovleg"><i className="ovlegd alis" />Alış<i className="ovlegd satis" />Satış</span></div>
          {loadCount > 0 ? (
            <div className="ovwavebody">
              <svg viewBox="0 0 1000 210" preserveAspectRatio="none" className="ovwavesvg">
                <defs>
                  <linearGradient id="fmA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity="0.30" /><stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" /></linearGradient>
                  <linearGradient id="fmS" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ca678" stopOpacity="0.28" /><stop offset="100%" stopColor="#0ca678" stopOpacity="0.02" /></linearGradient>
                </defs>
                {areaOf(alisLine) && <path d={areaOf(alisLine)} fill="url(#fmA)" />}
                {areaOf(satisLine) && <path d={areaOf(satisLine)} fill="url(#fmS)" />}
                {alisLine && <path d={alisLine} fill="none" stroke="#2563eb" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
                {satisLine && <path d={satisLine} fill="none" stroke="#0ca678" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
            </div>
          ) : (
            <div className="empty">Bekleyen belge yok — her şey güncel. 🎉</div>
          )}
          <div className="ovwavefoot">
            <span><b>{loadCount}</b> mükellefte bekleyen belge var</span>
            <span className="sp" />
            <span>en yüksek <b>{loadMax}</b> belge</span>
          </div>
        </div>
        <div className="card ovring">
          <div className="ch"><h3>İşlenme oranı</h3></div>
          <div className="ovringbody">
            <div className="ovringwrap">
              <svg viewBox="0 0 160 160">
                <defs>
                  <linearGradient id="fmring" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#37b24d" /><stop offset="100%" stopColor="#20c997" /></linearGradient>
                </defs>
                <circle cx="80" cy="80" r="64" fill="none" stroke="#eef1f7" strokeWidth="16" />
                <circle cx="80" cy="80" r="64" fill="none" stroke="url(#fmring)" strokeWidth="16" strokeLinecap="round" strokeDasharray={`${ringDash} 402.12`} transform="rotate(-90 80 80)" />
              </svg>
              <div className="ovringc"><span className="ovringpct">%{completionPct}</span><span className="ovringcl">işlendi</span></div>
            </div>
            <div className="ovringleg">
              <div className="ovrl"><i className="ovd db" /><span>Bekleyen</span><b>{tot.pending}</b></div>
              <div className="ovrl"><i className="ovd dr" /><span>Sorunlu</span><b>{tot.issue}</b></div>
              <div className="ovrl"><i className="ovd dg" /><span>Aktarıldı</span><b>{tot.posted}</b></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===================== CSS (#fm-root scope) ===================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Kaushan+Script&family=Cormorant+Garamond:ital,wght@1,600&display=swap');
#fm-root{--bg:#eef1f7;--side:#ffffff;--line:#e6eaf1;--line2:#d8dfe9;--text:#0e1726;--muted:#566379;--faint:#94a0b2;--accent:#2f54d6;--accent-soft:#eef1fe;--accent-line:#d2dbfb;--th:#f1f4fb;--th-text:#3a4673;--blue:#2f54d6;--red:#e0394a;--green:#15924f;--amber:#cf7a0e;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;font-size:13.5px;line-height:1.5;color:var(--text)}
#fm-root[data-accent="yesil"]{--accent:#15803d;--accent-soft:#e7f4ec;--accent-line:#c2e6cf;--th:#edf6f0;--th-text:#166534}
#fm-root[data-accent="lacivert"]{--accent:#1e3a8a;--accent-soft:#eaecf7;--accent-line:#c7cdeb;--th:#eef0f8;--th-text:#27408b}
#fm-root[data-accent="mavi"]{--accent:#2563eb;--accent-soft:#e8f0ff;--accent-line:#cfe0ff;--th:#eef4ff;--th-text:#1d4ed8}
#fm-root[data-accent="petrol"]{--accent:#0d9488;--accent-soft:#e3f4f2;--accent-line:#bfe6e1;--th:#ecf7f5;--th-text:#0f766e}
#fm-root[data-accent="mor"]{--accent:#5b5bd6;--accent-soft:#eef0fc;--accent-line:#dadcfb;--th:#f4f3fc;--th-text:#5a4fa3}
#fm-root[data-accent="amber"]{--accent:#c2710c;--accent-soft:#fbf1e2;--accent-line:#f0d6ad;--th:#fbf4e9;--th-text:#a85d08}
#fm-root[data-accent="slate"]{--accent:#2f54d6;--accent-soft:#eef1fe;--accent-line:#d2dbfb;--th:#f1f4fb;--th-text:#3a4673}
#fm-root[data-accent="bordo"]{--accent:#b91c1c;--accent-soft:#fbeaea;--accent-line:#f1c9c9;--th:#fbeeee;--th-text:#991b1b}
#fm-root *{box-sizing:border-box;margin:0;padding:0}
#fm-root .app{display:flex;min-height:100vh;background:var(--bg);position:relative}
#fm-root .app::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;z-index:6;background:var(--accent)}
#fm-root .side{width:246px;flex-shrink:0;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;padding:0 0 14px;box-shadow:none}
#fm-root .brand{padding:12px 12px 11px;border-bottom:1px solid #e2e8f0;background:#fff}
#fm-root .backlink{display:inline-flex;align-items:center;gap:4px;color:var(--muted);font-size:11px;font-weight:700;text-decoration:none;margin-bottom:10px;transition:color .15s;opacity:.78}
#fm-root .backlink:hover{color:var(--accent);opacity:1}
#fm-root .brandplate{display:flex;align-items:center;gap:10px;padding:9px 8px;border:1px solid #dbe3ef;border-radius:8px;background:#f8fafc;box-shadow:none}
#fm-root .brandmark{width:34px;height:34px;border-radius:7px;display:grid;place-items:center;background:#111827;color:#fff;font-size:12px;font-weight:900;letter-spacing:.3px;box-shadow:none}
#fm-root .brandcopy{min-width:0}
#fm-root .brandeyebrow{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.7px;color:#64748b;line-height:1;margin-bottom:4px}
#fm-root .brandmod{font-size:15px;font-weight:900;color:#0f172a;letter-spacing:0;line-height:1.1;margin-bottom:2px}
#fm-root .brandco{font-size:10.5px;font-weight:700;color:#526070;opacity:.95;white-space:normal;line-height:1.25}
#fm-root .nav{padding:10px 10px 0;overflow:auto}
#fm-root .ncap{font-size:10px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:14px 10px 6px}
#fm-root .nitem{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:8px;color:#566273;font-weight:700;font-size:13px;cursor:pointer;margin-bottom:3px;transition:background .14s,color .14s,box-shadow .14s}
#fm-root .nitem:hover{background:#f4f7fb;color:#172033}
#fm-root .nitem > span:first-child{width:29px;height:29px;border-radius:8px;display:grid;place-items:center;color:var(--icc,var(--faint));background:color-mix(in srgb,var(--icc,var(--faint)) 11%,#fff);border:1px solid color-mix(in srgb,var(--icc,var(--faint)) 18%,#fff);transition:color .12s,background .12s,border-color .12s}
#fm-root .nitem.on > span:first-child{color:#fff;background:var(--accent);border-color:var(--accent);box-shadow:0 7px 16px -11px var(--accent)}
#fm-root .nitem.on{background:var(--accent-soft);color:var(--accent);box-shadow:inset 3px 0 0 var(--accent),0 8px 18px -18px rgba(91,91,214,.55)}
#fm-root .nitem .ct{margin-left:auto;font-size:10.5px;font-weight:700;background:#eef1f5;color:var(--muted);border-radius:999px;padding:1px 7px}
#fm-root .nitem.on .ct{background:#fff;color:var(--accent)}
#fm-root .nsub{display:flex;align-items:center;gap:10px;padding:7px 11px 7px 38px;border-radius:8px;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer}
#fm-root .nsub:hover{background:#f7f8fb;color:var(--text)}
#fm-root .nsub.on{color:var(--accent);font-weight:700}
#fm-root .nsub .d{height:6px;width:6px;border-radius:50%;background:currentColor;opacity:.5}
#fm-root .main{flex:1;min-width:0;display:flex;flex-direction:column}
#fm-root .top{display:flex;align-items:center;gap:12px;padding:12px 22px;background:#fff;border-bottom:1px solid var(--line);flex-wrap:wrap;box-shadow:none}
#fm-root .crumb{font-size:12px;color:var(--faint)}
#fm-root .crumb b{color:var(--text);font-weight:600}
#fm-root .sp{flex:1}
#fm-root .selbox{display:flex;align-items:center;gap:8px;border:1px solid var(--line2);border-radius:9px;padding:6px 11px;font-size:12.5px;font-weight:600;background:#fff;cursor:pointer}
#fm-root .selbox small{color:var(--faint);font-weight:600}
#fm-root .selbox::after{content:"▾";color:var(--faint);font-weight:400;margin-left:2px}
#fm-root .fmsel{border:1px solid var(--line2);border-radius:9px;padding:7px 10px;font-size:12.5px;font-weight:600;background:#fff;color:var(--text);cursor:pointer;max-width:210px}
#fm-root .fmsel:focus{outline:none;border-color:var(--accent)}
#fm-root .empty{padding:34px 16px;text-align:center;color:var(--faint);font-size:12.5px}
#fm-root .mgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
#fm-root .fmstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
#fm-root .fmstat{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 16px 15px 19px;position:relative;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.04)}
#fm-root .fmstat::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--sc,var(--accent))}
#fm-root .fmstat::after{display:none}
#fm-root .fmstat .fmsl{font-size:10.5px;color:#64748b;font-weight:700;display:flex;align-items:center;gap:8px;text-transform:uppercase;letter-spacing:.5px}
#fm-root .fmstat .fmsl::before{content:'';width:9px;height:9px;border-radius:3px;background:var(--sc,var(--accent))}
#fm-root .fmstat .fmsv{display:block;font-size:31px;font-weight:800;line-height:1;margin-top:11px;font-variant-numeric:tabular-nums;color:#0e1726;letter-spacing:-.5px}
#fm-root .mcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
#fm-root .mcard .ml{font-size:12px;color:var(--muted)}
#fm-root .mcard .mv{font-size:26px;font-weight:700;margin-top:5px}
#fm-root .fld input,#fm-root .fld select{border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font-size:12.5px;font-weight:600;color:var(--text);background:#fff;min-height:35px;width:100%}
#fm-root .fld input:focus,#fm-root .fld select:focus{outline:none;border-color:var(--accent)}
#fm-root .fld input::placeholder{color:var(--faint);font-weight:400}
#fm-root .btn:disabled{opacity:.5;cursor:default;box-shadow:none;transform:none}
#fm-root .lic{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
#fm-root .stat{height:9px;width:9px;border-radius:50%;background:var(--green)}
#fm-root .theme{display:none}
#fm-root .theme small{font-size:10.5px;color:var(--faint);font-weight:700;margin-right:1px}
#fm-root .tsw{height:18px;width:18px;border-radius:50%;cursor:pointer;border:2px solid #fff;outline:1px solid var(--line2)}
#fm-root .tsw:hover{transform:scale(1.12)}
#fm-root .tsw.on{outline:2px solid var(--text)}
#fm-root .content{padding:12px 22px;flex:1}
#fm-root .h2{font-size:21px;font-weight:800;letter-spacing:-.3px;color:#0e1726;margin-bottom:3px}
#fm-root .sub{font-size:12.5px;color:var(--muted);margin-bottom:14px}
#fm-root .ph-empty{padding:10px 0}
#fm-root .btn{display:inline-flex;align-items:center;gap:8px;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;border:1px solid #e3e8f0;background:#fff;color:#283242;cursor:pointer;box-shadow:0 1px 1.5px rgba(16,24,40,.04);transition:color .14s ease,border-color .14s ease,background .14s ease,box-shadow .14s ease}
#fm-root .btn:hover:not(:disabled){border-color:var(--accent-line);background:var(--accent-soft);color:var(--accent);box-shadow:0 1px 2px rgba(16,24,40,.05)}
#fm-root .btn:active:not(:disabled){background:var(--th)}
#fm-root .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .btn.blue{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line)}
#fm-root .btn.red{background:var(--red);color:#fff;border-color:var(--red)}
/* Dolgulu butonlar: hover'da hafif koyulaşma (tutarlı his — renk korunur) */
#fm-root .btn.primary:hover:not(:disabled),#fm-root .btn.blue:hover:not(:disabled),#fm-root .btn.red:hover:not(:disabled){filter:brightness(.94)}
#fm-root .btn.ghost{background:#fff;color:var(--muted)}
#fm-root .btn.sm{padding:7px 11px;font-size:12px}
#fm-root .btn .ico svg{display:block;stroke-linecap:round;stroke-linejoin:round}
#fm-root .btn.upload{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line);box-shadow:none}
#fm-root .btn.upload:hover:not(:disabled){background:var(--th);border-color:var(--accent-line);color:var(--accent)}
#fm-root .btn.fix{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line);box-shadow:none}
#fm-root .btn.fix:hover:not(:disabled){background:var(--th);border-color:var(--accent-line);color:var(--accent)}
#fm-root .btn.ai{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 6px 14px -8px rgba(47,84,214,.55)}
#fm-root .btn.ai:hover:not(:disabled){filter:brightness(.95)}
#fm-root .btn.soft{background:#fbfcfd;border-color:#dce3ec;color:#526070}
#fm-root .btn.soft:hover:not(:disabled){background:#f3f7fb;color:var(--text);border-color:#cbd5e1}
#fm-root .btn.soon:disabled{opacity:.72;background:#f8fafc;color:#64748b;border-color:#e2e8f0}
#fm-root .soonbadge{font-size:9px;font-weight:800;line-height:1;padding:3px 5px;border-radius:999px;background:#e2e8f0;color:#475569;letter-spacing:.2px}
#fm-root .card{background:#fff;border:1px solid var(--line);border-radius:14px;margin-bottom:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
/* ── Genel Bakış: renkli kutucuklar + dalga + halka ── */
#fm-root .ovtiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:13px;margin-bottom:16px}
#fm-root .ovtile{position:relative;border-radius:16px;padding:15px 16px 14px;color:#fff;overflow:hidden;box-shadow:0 10px 22px -14px var(--tsh,rgba(20,30,60,.5));min-height:104px;display:flex;flex-direction:column}
#fm-root .ovtile::after{content:'';position:absolute;right:-18px;top:-18px;width:82px;height:82px;border-radius:50%;background:rgba(255,255,255,.14)}
#fm-root .ovtic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.22);position:relative;z-index:1}
#fm-root .ovtic svg{width:19px;height:19px}
#fm-root .ovtnum{font-size:29px;font-weight:900;line-height:1;margin-top:11px;font-variant-numeric:tabular-nums;letter-spacing:-.5px;position:relative;z-index:1}
#fm-root .ovtl{font-size:12px;font-weight:700;opacity:.95;margin-top:4px;position:relative;z-index:1}
#fm-root .ovtile.t-indigo{background:linear-gradient(135deg,#4263eb,#5c7cfa);--tsh:rgba(66,99,235,.5)}
#fm-root .ovtile.t-amber{background:linear-gradient(135deg,#f08c00,#f9a825);--tsh:rgba(240,140,0,.5)}
#fm-root .ovtile.t-blue{background:linear-gradient(135deg,#1971c2,#339af0);--tsh:rgba(25,113,194,.5)}
#fm-root .ovtile.t-teal{background:linear-gradient(135deg,#0ca678,#20c997);--tsh:rgba(12,166,120,.5)}
#fm-root .ovtile.t-red{background:linear-gradient(135deg,#e03131,#ff6b6b);--tsh:rgba(224,49,49,.5)}
#fm-root .ovtile.t-green{background:linear-gradient(135deg,#2f9e44,#51cf66);--tsh:rgba(47,158,68,.5)}
#fm-root .ovcharts{display:grid;grid-template-columns:1.7fr 1fr;gap:16px;margin-bottom:16px}
#fm-root .ovcharts .card{margin-bottom:0}
#fm-root .ovwavebody{padding:14px 8px 4px}
#fm-root .ovwavesvg{display:block;width:100%;height:200px}
#fm-root .ovleg{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--muted)}
#fm-root .ovlegd{width:9px;height:9px;border-radius:3px;display:inline-block}
#fm-root .ovlegd.alis{background:#2563eb;margin-left:4px}
#fm-root .ovlegd.satis{background:#0ca678;margin-left:10px}
#fm-root .ovwavefoot{display:flex;align-items:center;gap:8px;padding:10px 16px 14px;font-size:12px;color:var(--muted);border-top:1px solid var(--line)}
#fm-root .ovwavefoot b{color:var(--text);font-weight:800}
#fm-root .ovwavefoot .sp{flex:1}
#fm-root .ovringbody{display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 16px 20px}
#fm-root .ovringwrap{position:relative;width:160px;height:160px}
#fm-root .ovringwrap svg{width:160px;height:160px;display:block}
#fm-root .ovringc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
#fm-root .ovringpct{font-size:34px;font-weight:900;color:#0e1726;line-height:1;letter-spacing:-1px;font-variant-numeric:tabular-nums}
#fm-root .ovringcl{font-size:11px;font-weight:700;color:var(--muted);margin-top:3px}
#fm-root .ovringleg{width:100%;display:flex;flex-direction:column;gap:8px}
#fm-root .ovrl{display:flex;align-items:center;gap:9px;font-size:12.5px;font-weight:600;color:var(--muted);padding:7px 12px;background:#f7f9fc;border-radius:9px}
#fm-root .ovrl b{margin-left:auto;color:var(--text);font-weight:800;font-variant-numeric:tabular-nums}
#fm-root .ovd{width:9px;height:9px;border-radius:50%;display:inline-block}
#fm-root .ovd.db{background:#f59f00}
#fm-root .ovd.dr{background:#e03131}
#fm-root .ovd.dg{background:#2f9e44}
#fm-root .ovbarcard{margin-bottom:16px}
#fm-root .ovbars{display:flex;flex-direction:column;gap:10px;padding:16px 18px}
#fm-root .ovbar{display:grid;grid-template-columns:minmax(90px,160px) 1fr 34px;align-items:center;gap:11px;cursor:pointer}
#fm-root .ovbar:hover .ovbf{filter:brightness(1.08)}
#fm-root .ovbar:hover .ovbn{color:var(--accent)}
#fm-root .ovbn{font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .ovbt{height:13px;background:#eef1f7;border-radius:7px;overflow:hidden}
#fm-root .ovbf{height:100%;border-radius:7px;background:linear-gradient(90deg,#2f54d6,#6b8bea);transition:width .35s}
#fm-root .ovbc{font-size:12.5px;font-weight:800;color:var(--text);text-align:right;font-variant-numeric:tabular-nums}
/* ── Aktarım satır aksiyon ikonları (renkli) ── */
#fm-root .aico{width:30px;height:30px;padding:0;display:inline-grid;place-items:center;border-radius:8px;border:1px solid var(--line2);background:#fff;cursor:pointer;font-size:14px;line-height:1;color:#64748b;transition:transform .12s,background .14s,color .14s,border-color .14s,filter .14s}
#fm-root .aico:hover:not(:disabled){transform:translateY(-1px)}
#fm-root .aico:disabled{opacity:.5;cursor:default}
#fm-root .aico.retry{color:#e0394a;border-color:#f1c9ce;background:#fdeef0}
#fm-root .aico.reopen{color:#cf7a0e;border-color:#f0d6ad;background:#fbf4e9}
#fm-root .aico.detay{color:#2f54d6;border-color:#d2dbfb;background:#eef1fe}
#fm-root .aico.detay.on{color:#fff;background:#2f54d6;border-color:#2f54d6}
#fm-root .aico.eye{color:#0d9488;border-color:#bfe6e1;background:#e3f4f2}
#fm-root .aico:hover:not(:disabled){filter:brightness(.97)}
@media(max-width:900px){#fm-root .ovcharts{grid-template-columns:1fr}}
#fm-root .card .ch{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap;background:#fff}
#fm-root .card .ch h3{font-size:13.5px;font-weight:700}
#fm-root .mu{font-size:11px;color:var(--faint)}
#fm-root .filt{display:grid;grid-template-columns:repeat(5,1fr) auto auto;gap:11px;padding:15px 16px;align-items:end}
#fm-root .fld{display:flex;flex-direction:column;gap:4px;min-width:0}
#fm-root .fld label{font-size:10.5px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.3px}
#fm-root .fin{border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font-size:12.5px;font-weight:600;color:var(--text);background:#fff;min-height:35px;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden}
#fm-root .fin.sel::after{content:"▾";color:var(--faint);margin-left:auto}
#fm-root .fin.ph{color:var(--faint);font-weight:500}
#fm-root .fin.acc{color:var(--accent)}
#fm-root .twrap{overflow-x:auto}
#fm-root table{width:100%;border-collapse:collapse;font-size:12.5px}
#fm-root thead th{text-align:left;font-weight:700;color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;padding:12px 11px;background:#fbfcfe;border-bottom:1px solid var(--line2);white-space:nowrap}
#fm-root tbody td{padding:11px 11px;border-bottom:1px solid var(--line);white-space:nowrap}
/* Hesap Planı — yüzlerce satır; sıkışık, okunur, gereksiz boşluk yok */
#fm-root .planwrap{max-height:calc(100vh - 230px);overflow:auto}
#fm-root .planwrap table{font-size:12px}
#fm-root .planwrap thead th{position:sticky;top:0;z-index:2;padding:7px 11px;font-size:10px}
#fm-root .planwrap tbody td{padding:4px 11px;border-bottom:1px solid #f1f3f7}
#fm-root .planwrap tbody tr:hover td{background:#fafbfc}
#fm-root .planwrap .hk{font-size:13px}
#fm-root .planwrap .pill{padding:1px 7px;font-size:10px}
#fm-root .ch h3 .cnt{margin-left:8px;padding:1px 8px;border-radius:20px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:700;vertical-align:middle}
#fm-root tbody tr:hover{background:#fafbfd}
/* Aksiyon (göz) sütunu daima görünür kalsın — geniş tabloda sağda kesilmesin */
#fm-root td.actcol{position:sticky;right:0;background:#fff;box-shadow:-6px 0 6px -6px rgba(0,0,0,.12)}
#fm-root tr.detay-on > td{background:#f7faff}
#fm-root .detayrow > td{padding:0;background:#f7faff;border-bottom:1px solid var(--line)}
/* Detay kutusu ana listenin YATAY-KAYAN genişliğinden BAĞIMSIZ — ekran sol kenarına yapışır
   (position:sticky;left) ve viewport genişliğine sığar; böylece ALACAK sütunu hep görünür, taşmaz. */
#fm-root .detaybox{position:sticky;left:0;width:calc(100vw - 360px);max-width:1010px;box-sizing:border-box;padding:8px 14px 12px;overflow-x:auto}
#fm-root .detaytbl{width:100%;max-width:920px;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}
#fm-root .celiskibanner{margin-top:8px;max-width:920px;padding:7px 11px;background:#fdf2e0;border:1px solid #f0c987;border-radius:7px;font-size:12px;color:#92400e;line-height:1.55}
#fm-root .celiskibanner b{display:block;margin-bottom:2px;color:#b45309}
#fm-root .detaytbl th{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--text);text-align:left;padding:8px 10px;background:#f4f7f9;border-bottom:2px solid var(--line)}
#fm-root .detaytbl td{font-size:13.5px;padding:8px 10px;border-bottom:1px solid var(--line)}
#fm-root .detaytbl tr:last-child td{border-bottom:none}
#fm-root .detaytbl .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-right:14px;min-width:96px}
#fm-root .detaytbl td:nth-child(1){white-space:nowrap}
#fm-root .detaytbl td:nth-child(2){white-space:nowrap}
#fm-root .detaytbl td:nth-child(3){max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .detayrow td{padding:0}
#fm-root .detaybox .detaytbl{max-width:100%}
#fm-root .babs2{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:8px 14px 14px}
#fm-root .babscol{border:1px solid var(--line);border-radius:10px;overflow:hidden}
#fm-root .babsh{font-size:12px;font-weight:700;padding:8px 12px;background:#fbfcfd;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
#fm-root .babsh .mu{margin-left:auto;font-weight:500}
@media (max-width:880px){#fm-root .babs2{grid-template-columns:1fr}}
#fm-root th.actcol{position:sticky;right:0;background:var(--th)}
#fm-root tbody tr:hover td.actcol{background:#fafbfd}
#fm-root .num{text-align:right;font-variant-numeric:tabular-nums}
#fm-root .cb{height:16px;width:16px;border-radius:4px;border:1.5px solid var(--line2);display:inline-grid;place-items:center;cursor:pointer;background:#fff;vertical-align:middle;color:#fff}
#fm-root .cb.on{background:var(--accent);border-color:var(--accent)}
#fm-root .cb.disabled{cursor:not-allowed;opacity:1;background:#f8fafc;border-color:#d8e1ea}
#fm-root .cb.disabled:not(.on)::after{content:'';width:5px;height:5px;border-radius:999px;background:#cbd5e1}
#fm-root .cb.disabled:hover{border-color:var(--line2)}
#fm-root td.firm{max-width:230px}
#fm-root .firm b{font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .firm small{display:block;color:var(--faint);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .hk{font-family:"Consolas","SF Mono",ui-monospace,monospace;font-weight:700;color:var(--accent);font-size:13px;letter-spacing:.4px}
#fm-root .hk.no{color:var(--red)}
#fm-root .pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;white-space:nowrap;display:inline-block}
#fm-root td .pill.miss,#fm-root td .pill.warn,#fm-root td .pill.asset{white-space:normal;max-width:180px;line-height:1.25;text-align:center}
#fm-root .pill.alis{background:#eaf1ff;color:#2563eb}
#fm-root .pill.satis{background:#e7f6ec;color:#15803d}
#fm-root .pill.ok{background:#e7f6ec;color:#15803d}
#fm-root .pill.miss{background:#fdeaea;color:#c0353a}
#fm-root .pill.warn{background:#fdf2e0;color:#b45309}
#fm-root .pill.proc{background:#e6eefc;color:#2563eb}
#fm-root .pill.asset{background:#f3e8ff;color:#7c3aed;border:1px solid #e3d4fb}
#fm-root .aibar{display:flex;align-items:center;gap:15px;margin:10px 16px 12px;padding:14px 18px;border-radius:14px;background:var(--accent-soft);border:1px solid var(--accent-line);box-shadow:none}
#fm-root .aibar.err{background:#fdeeee;border-color:#f3c9c9;color:#92400e;font-size:12.5px;gap:9px;align-items:center}
#fm-root .aibar .aidot.err{width:9px;height:9px;border-radius:50%;background:#c0353a;flex-shrink:0}
#fm-root .aibar .aiscan{height:42px;width:32px;border-radius:6px;border:1.5px solid var(--accent);background:#fff;position:relative;overflow:hidden;flex-shrink:0;box-shadow:0 2px 7px rgba(21,128,61,.2)}
#fm-root .aibar .aiscan i{position:absolute;left:5px;height:2px;border-radius:2px;background:var(--accent-line)}
#fm-root .aibar .aiscan i:nth-child(1){top:9px;width:18px}#fm-root .aibar .aiscan i:nth-child(2){top:15px;width:22px}#fm-root .aibar .aiscan i:nth-child(3){top:21px;width:14px}#fm-root .aibar .aiscan i:nth-child(4){top:27px;width:20px}
#fm-root .aibar .aiscan .beam{position:absolute;left:0;right:0;height:12px;background:linear-gradient(transparent,rgba(21,128,61,.5),transparent);animation:aibeam 1.5s ease-in-out infinite}
@keyframes aibeam{0%{top:-12px}100%{top:42px}}
#fm-root .aibar .aimid{flex:1;min-width:0}
#fm-root .aibar .ait{font-size:13px;font-weight:700;color:var(--accent);display:flex;align-items:center}
#fm-root .aibar .ait .dots::after{content:'...';animation:aidots 1.5s steps(4,end) infinite;display:inline-block;width:16px;text-align:left}
@keyframes aidots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
#fm-root .aibar .aisub{font-size:11px;color:var(--muted);margin-top:2px}
#fm-root .aibar .aisub b{color:var(--text);font-weight:700}
#fm-root .aibar .aitrack{height:6px;border-radius:5px;background:var(--accent-soft);overflow:hidden;margin-top:8px;position:relative}
#fm-root .aibar .aifill{height:100%;border-radius:5px;background:linear-gradient(90deg,var(--accent),#22c55e 55%,#34d399);position:relative;overflow:hidden;transition:width .45s cubic-bezier(.4,0,.2,1)}
#fm-root .aibar .aifill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);animation:aishim 1.7s ease-in-out infinite}
@keyframes aishim{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
#fm-root .aibar .airight{text-align:center;flex-shrink:0}
#fm-root .aibar .aipct{font-size:22px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;letter-spacing:-.5px;line-height:1}
#fm-root .aibar .airight small{font-size:9px;color:var(--faint);font-weight:700;letter-spacing:.6px}
/* AI okuma — satır bazlı canlı görsel (genel temayı bozmaz). Okunan: mavi pulse + sol şerit;
   yeni biten: kısa yeşil flash; sırada bekleyen: hafif soluk. */
#fm-root tbody tr.queued{opacity:.5}
#fm-root tbody tr.scanning{animation:fmrowscan 1.2s ease-in-out infinite}
#fm-root tbody tr.scanning td:first-child{position:relative}
#fm-root tbody tr.scanning td:first-child::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:3px;background:#2563eb;animation:fmrowpulse 1.2s ease-in-out infinite}
#fm-root tbody tr.justdone{animation:fmrowdone 2s ease-out}
@keyframes fmrowscan{0%,100%{background:transparent}50%{background:rgba(37,99,235,.10)}}
@keyframes fmrowpulse{0%,100%{opacity:.3}50%{opacity:1}}
@keyframes fmrowdone{0%{background:rgba(34,197,94,.24)}100%{background:transparent}}
#fm-root .ocrpct{font-weight:700;color:var(--accent,#2563eb);font-variant-numeric:tabular-nums;margin-left:auto}
@keyframes ocrstripes{from{background-position:0 0}to{background-position:20px 0}}
@keyframes ocrglow{0%,100%{opacity:.35}50%{opacity:.9}}
#fm-root .ocrtxt{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
#fm-root .ocrtxt b{color:var(--text)}
#fm-root .ocrhint{color:var(--faint)}
#fm-root .ocrdot{width:8px;height:8px;border-radius:50%;background:var(--accent,#2563eb);animation:ocrpulse 1s ease-in-out infinite;flex-shrink:0}
#fm-root .ocrdot.err{background:#c0353a;animation:none}
@keyframes ocrpulse{0%,100%{opacity:.35}50%{opacity:1}}
#fm-root .durumfiltre{display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px 2px}
#fm-root .dfchip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border:1px solid var(--line2);border-radius:13px;background:#fff;color:var(--muted);font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit}
#fm-root .dfchip:hover{border-color:var(--accent-line);color:var(--accent)}
#fm-root .dfchip.on{background:var(--accent);border-color:var(--accent);color:#fff}
#fm-root .oneden{font-size:10px;color:#c0353a;margin-top:3px;max-width:200px;line-height:1.3}
#fm-root .yuklenemedi{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 16px 0;padding:9px 12px;background:#fdeaea;border:1px solid #f0b3b3;border-radius:9px;font-size:12px;color:#a23a3a}
#fm-root .yuklenemedi span{display:inline-flex;align-items:center;gap:6px}
#fm-root .eksikbelge{display:flex;align-items:flex-start;gap:8px;margin:10px 16px 0;padding:9px 12px;background:#fef6e7;border:1px solid #f0d28a;border-radius:9px;font-size:12px;color:#8a6314}
#fm-root .eksikbelge b{color:#6b4d0f}
#fm-root .planuyari{display:flex;align-items:flex-start;gap:11px;margin:11px 16px 0;padding:13px 16px;background:linear-gradient(135deg,#fff4e0,#fff9f0);border:1.5px solid #f0c878;border-radius:12px;font-size:12.5px;line-height:1.5;color:#7a5410;box-shadow:0 4px 14px -8px rgba(180,120,20,.35)}
#fm-root .planuyari svg{flex-shrink:0;margin-top:1px;color:#c8881a}
#fm-root .planuyari b{color:#5c3f08;font-weight:800}
#fm-root .dfchip .dfn{font-size:10px;font-weight:800;background:var(--accent-soft);color:var(--accent);border-radius:10px;padding:1px 7px;min-width:18px;text-align:center}
#fm-root .dfchip.on .dfn{background:rgba(255,255,255,.28);color:#fff}
#fm-root .pill.n{background:#eef1f5;color:#64748b}
#fm-root .eye{height:28px;width:28px;border-radius:8px;border:1px solid var(--line2);display:grid;place-items:center;color:var(--muted);cursor:pointer;transition:transform .1s ease,border-color .12s ease,background .12s ease,box-shadow .12s ease}
#fm-root .eye:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft,#eef4ff);transform:translateY(-1px);box-shadow:0 3px 7px -3px rgba(15,23,42,.18)}
#fm-root .eye:active{transform:translateY(0)}
#fm-root .eye.del:hover{border-color:#f3c9c9;color:var(--red);background:#fdeaea}
#fm-root .foot{display:flex;align-items:center;gap:14px;padding:13px 16px;border-top:1px solid var(--line);flex-wrap:wrap}
#fm-root .selinfo{font-size:12px;color:var(--muted)}
#fm-root .pg{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted)}
#fm-root .pg .pb{height:28px;min-width:28px;border:1px solid var(--line2);border-radius:7px;display:grid;place-items:center;cursor:pointer;background:#fff}
#fm-root .pg .pb.act{border-color:var(--accent);color:var(--accent)}
#fm-root .ruleadd{display:grid;grid-template-columns:1.3fr 1.2fr .8fr .8fr .8fr auto;gap:11px;padding:15px 16px;align-items:end;background:#fbfcfd;border-bottom:1px solid var(--line)}
#fm-root .lrow{display:flex;align-items:center;gap:11px;padding:12px 16px;border-bottom:1px solid var(--line);font-size:12.5px}
#fm-root .lrow:last-child{border-bottom:none}
#fm-root .lrow .ico{height:30px;width:30px;border-radius:8px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:800;flex-shrink:0}
#fm-root .lrow .lx{flex:1}
#fm-root .work{display:grid;grid-template-columns:330px 1fr;gap:0}
#fm-root .wlist{border-right:1px solid var(--line);max-height:520px;overflow:auto}
#fm-root .wgrp{font-size:10.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.4px;padding:11px 16px 7px;display:flex;align-items:center;justify-content:space-between;background:#fbfcfd}
#fm-root .wrow{padding:11px 16px;border-bottom:1px solid var(--line);cursor:pointer}
#fm-root .wrow:hover{background:#fafbfd}
#fm-root .wrow.on{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
#fm-root .wrow .wt{display:flex;align-items:center;justify-content:space-between;gap:8px}
#fm-root .wrow b{font-size:12.5px}
#fm-root .wrow small{font-size:11px;color:var(--faint)}
#fm-root .wright{padding:18px}
#fm-root .ph{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
#fm-root .ph .phname{min-width:0}
#fm-root .navbtns{display:inline-flex;align-items:center;gap:3px;flex-shrink:0}
#fm-root .navb{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line2);border-radius:6px;background:#fff;color:var(--text);font-size:16px;line-height:1;cursor:pointer;font-family:inherit;padding:0}
#fm-root .navb:hover:not(:disabled){background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .navb:disabled{opacity:.35;cursor:default}
#fm-root .navpos{font-size:10.5px;font-weight:600;color:var(--faint);min-width:34px;text-align:center}
#fm-root .nacechip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:1px solid var(--accent-line);border-radius:11px;background:var(--accent-soft);color:var(--accent);font-size:10.5px;font-weight:700;text-transform:none;letter-spacing:0;cursor:help;flex-shrink:0}
#fm-root .docmeta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 12px;padding:8px 12px;margin-bottom:9px;background:#fbfcfd;border:1px solid var(--line);border-radius:9px}
#fm-root .docmeta .dm{display:flex;flex-direction:column;gap:1px}
#fm-root .docmeta .dml{font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.4px}
#fm-root .docmeta .dmv{font-size:13px;font-weight:600;color:var(--text)}
#fm-root .docmeta .dmi{width:100%;height:30px;padding:0 8px;border:1px solid var(--line2);border-radius:7px;font-size:13px;font-weight:600;color:var(--text);background:#fff;font-family:inherit}
#fm-root .docmeta .dmi:focus{outline:none;border-color:var(--accent)}
#fm-root .islgrid{display:grid;gap:5px 10px;margin-bottom:7px;align-items:end}
#fm-root .islgrid .dm{display:flex;flex-direction:column;gap:2px;min-width:0}
#fm-root .islgrid .dml{font-size:11px;font-weight:600;color:#6b7480;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .islgrid .dmi{width:100%;height:31px;padding:0 8px;border:1px solid var(--line2);border-radius:7px;font-size:13px;font-weight:600;color:var(--text);background:#fff;font-family:inherit}
#fm-root .islgrid .dmi:focus{outline:none;border-color:var(--accent)}
#fm-root .islgrid .li{width:100%;min-width:0;height:31px;box-sizing:border-box}
#fm-root .islgrid .psel{width:100%;min-width:0}
#fm-root .islgrid .psel .pselfield{min-width:0}
#fm-root .islgrid .psel .pselfield span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Temiz açılır liste (native siyah select yerine) */
#fm-root .psel{position:relative;width:100%}
#fm-root .psel .pselfield{display:flex;align-items:center;gap:6px;height:30px;border:1px solid var(--line2);border-radius:7px;background:#fff;padding:0 9px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text)}
#fm-root .psel .pselfield.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
#fm-root .psel .pselfield > span:first-child{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .psel .pselfield .ph{color:#9aa6b2;font-weight:400}
#fm-root .psel .pselcar{flex:0 0 auto;width:7px;height:7px;border-right:1.6px solid #94a3b2;border-bottom:1.6px solid #94a3b2;transform:rotate(45deg) translateY(-2px);transition:transform .15s,border-color .15s}
#fm-root .psel .pselfield.on .pselcar{transform:rotate(-135deg) translateY(2px);border-color:var(--accent)}
#fm-root .psel .pselpop{z-index:9000;background:#fff;border:1px solid var(--line2);border-radius:9px;box-shadow:0 12px 30px rgba(15,23,42,.18);overflow-y:auto;max-height:330px;width:max-content;max-width:min(680px,92vw);padding:4px;display:flex;flex-direction:column}
#fm-root .psel .pselsrch{flex-shrink:0;margin:4px 4px 2px;padding:5px 8px;border:1px solid var(--line2);border-radius:6px;font-size:12px;outline:none;background:var(--bg2,#f8fafc);color:var(--text)}
#fm-root .psel .pselopt{padding:7px 11px;border-radius:6px;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap}
#fm-root .psel .pselopt:hover,#fm-root .psel .pselopt.sel{background:var(--accent-soft);color:var(--accent)}
/* Aktarılanlar — Luca aktarım barı */
#fm-root .aktarbar{display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:11px 15px;background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:10px;font-size:13px}
#fm-root .aktarbar .akbil b{color:var(--accent);font-weight:800}
#fm-root .amini{font-size:11px;color:var(--muted)}
#fm-root .amini b{color:var(--accent)}
#fm-root .kodatainl{display:flex;align-items:center;gap:8px}
#fm-root .tevpanel{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 13px;margin-bottom:12px;background:#fbf4e9;border:1px solid #f0d6ad;border-radius:10px}
#fm-root .tevpanel .tlbl{font-size:12px;font-weight:800;color:#a85d08;text-transform:uppercase;letter-spacing:.4px}
#fm-root .tevpanel .tnote{font-size:11.5px;color:var(--muted);flex-basis:100%}
#fm-root .li{height:28px;border:1px solid var(--line2);border-radius:6px;padding:0 7px;font-size:12.5px;font-weight:600;color:var(--text);background:#fff;font-family:inherit}
#fm-root .li:focus{outline:none;border-color:var(--accent)}
#fm-root .licode{width:120px}
#fm-root .linum{width:120px;text-align:right}
#fm-root .fgrps{display:flex;flex-direction:column;gap:7px}
#fm-root .fgrp{border:1px solid var(--line2);border-radius:9px;overflow:hidden}
#fm-root .fgrp .fgh{display:flex;justify-content:space-between;align-items:center;padding:3px 10px;background:var(--th);color:var(--th-text);font-size:11.5px;font-weight:700}
#fm-root .fgrp .fgh .fgs{font-size:9.5px;opacity:.85;text-transform:uppercase;letter-spacing:.4px}
#fm-root .fgrp .frow{display:flex;align-items:center;gap:6px;padding:3px 10px;border-top:1px solid var(--line)}
#fm-root .fgrp .frow .li{height:26px}
#fm-root .fgrp .frow .csel{flex:1;min-width:0;position:relative}
#fm-root .csel .cselfield{display:flex;align-items:center;gap:4px;height:27px;border:1px solid var(--line2);border-radius:6px;background:#fff;padding:0 7px 0 9px}
#fm-root .csel .cselfield.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
#fm-root .csel .cselinp{flex:1;min-width:0;border:0;outline:0;background:transparent;padding:0;height:100%;font-size:12.5px;font-weight:600;color:var(--text);font-family:inherit;font-variant-numeric:tabular-nums}
#fm-root .csel .cselinp::placeholder{color:#9aa6b2;font-weight:400}
#fm-root .csel .cselcar{flex:0 0 auto;width:7px;height:7px;border-right:1.6px solid #94a3b2;border-bottom:1.6px solid #94a3b2;transform:rotate(45deg) translateY(-2px);transition:transform .15s,border-color .15s;cursor:pointer}
#fm-root .csel .cselfield.on .cselcar{transform:rotate(-135deg) translateY(2px);border-color:var(--accent)}
#fm-root .csel .cselpop{z-index:9000;background:#fff;border:1px solid var(--line2);border-radius:10px;box-shadow:0 12px 34px rgba(15,23,42,.18);overflow:hidden}
#fm-root .csel .csellist{max-height:248px;overflow:auto;padding:4px}
#fm-root .csel .cselopt{display:flex;align-items:baseline;gap:9px;padding:6px 9px;border-radius:6px;cursor:pointer}
#fm-root .csel .cselopt:hover,#fm-root .csel .cselopt.sel{background:var(--accent-soft)}
#fm-root .csel .cselopt.act{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
#fm-root .csel .cselopt b{flex:0 0 auto;font-size:12px;font-weight:800;color:#1f2937;font-variant-numeric:tabular-nums}
#fm-root .csel .cselopt span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#374151}
#fm-root .csel .cselempty,#fm-root .csel .cselmore{padding:9px 11px;font-size:11.5px;color:var(--muted)}
#fm-root .fgrp .frow .fdesc{flex:1;min-width:0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .fgrp .frow .linum{flex:0 0 96px;width:96px;min-width:0;text-align:right}
#fm-root .fgrp .frow .money{font-variant-numeric:tabular-nums;font-weight:700;font-size:13px;color:var(--text)}
/* KDV oranı — temiz özel dropdown (native siyah liste değil) */
#fm-root .fgrp .frow .rsel{flex:0 0 50px;position:relative}
#fm-root .rsel .rselfield{display:flex;align-items:center;justify-content:center;gap:4px;height:27px;border:1px solid var(--line2);border-radius:6px;background:#fff;cursor:pointer;font-size:12.5px;font-weight:700;color:var(--text)}
#fm-root .rsel .rselfield.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
#fm-root .rsel .rselcar{width:6px;height:6px;border-right:1.6px solid #94a3b2;border-bottom:1.6px solid #94a3b2;transform:rotate(45deg) translateY(-2px);transition:transform .15s}
#fm-root .rsel .rselfield.on .rselcar{transform:rotate(-135deg) translateY(2px);border-color:var(--accent)}
#fm-root .rsel .rselpop{z-index:9000;background:#fff;border:1px solid var(--line2);border-radius:8px;box-shadow:0 10px 26px rgba(15,23,42,.16);overflow:hidden;padding:3px}
#fm-root .rsel .rselopt{padding:6px 12px;border-radius:5px;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text);text-align:center}
#fm-root .rsel .rselopt:hover,#fm-root .rsel .rselopt.sel{background:var(--accent-soft);color:var(--accent)}
#fm-root .fgrp .fgt{display:flex;justify-content:space-between;padding:3px 10px;border-top:1px solid var(--line2);background:#fbfcfd;font-size:12px}
#fm-root .fgrp .fgt b{font-weight:800}
#fm-root .fgrp .frow .frowdel{width:22px;height:22px;flex:0 0 22px;border:1px solid var(--line2);border-radius:6px;background:#fff;color:var(--red);font-size:15px;font-weight:700;cursor:pointer;line-height:1;display:grid;place-items:center}
#fm-root .fgrp .frow .frowdel:hover{background:#fdeaea;border-color:#f3c9c9}
#fm-root .fgrp .frowadd{padding:3px 10px;border-top:1px dashed var(--line2);color:var(--accent);font-size:11.5px;font-weight:700;cursor:pointer}
#fm-root .fgrp .frowadd:hover{background:var(--accent-soft)}
#fm-root .wmain{padding:18px}
#fm-root .wstrip{display:flex;gap:9px;overflow-x:auto;padding:11px 16px;border-top:1px solid var(--line);background:#fbfcfd}
#fm-root .wfilter{flex:0 0 auto;display:flex;gap:4px;align-items:center;padding-right:10px;margin-right:2px;border-right:1px solid var(--line2)}
#fm-root .wfilter button{padding:6px 11px;border:1px solid var(--line2);border-radius:8px;background:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;color:#475569}
#fm-root .wfilter button.on{background:#2dd4bf;border-color:#2dd4bf;color:#06302b}
#fm-root .wchip{flex:0 0 auto;max-width:230px;padding:8px 12px;border:1px solid var(--line2);border-radius:9px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:2px}
#fm-root .wchip:hover{border-color:var(--accent-line)}
#fm-root .wchip.on{border-color:var(--accent);background:var(--accent-soft);box-shadow:inset 0 -2px 0 var(--accent)}
#fm-root .wchip.miss{border-style:dashed}
#fm-root .wchip b{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:206px}
#fm-root .wchip small{font-size:11px;color:var(--muted)}
#fm-root .fiseditor{display:flex;gap:18px;align-items:flex-start}
#fm-root .belgepane{flex:0 0 64%;max-width:64%;position:sticky;top:8px}
#fm-root .app.editorfull .belgepane{flex:0 0 72%;max-width:72%}
#fm-root .bphint{font-weight:400;color:var(--faint);font-size:10.5px}
#fm-root .fispane{flex:1;min-width:0;display:flex;flex-direction:column}
#fm-root .fispane > .docmeta{order:7}
#fm-root .fispane > .tevpanel{order:8}
#fm-root .fispane > .wactions{order:9}
#fm-root .ph .fifull{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border:1px solid var(--accent-line);border-radius:7px;background:var(--accent-soft);color:var(--accent);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;text-transform:none;letter-spacing:0}
#fm-root .ph .fifull:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .sektorbar{display:flex;align-items:center;gap:6px;margin:-6px 0 12px;padding:5px 10px;background:#f1f6f3;border:1px solid var(--accent-line);border-radius:8px;font-size:11px;color:var(--muted)}
#fm-root .sektorbar b{color:var(--text);font-weight:700}
#fm-root .sektorbar i{color:#b45309;font-style:normal;font-weight:600}
#fm-root .app.editorfull .side{display:none}
#fm-root .belgebox{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
#fm-root .belgebox .bpbar{display:flex;align-items:center;justify-content:space-between;padding:7px 11px;border-bottom:1px solid var(--line);background:#fbfcfd;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
#fm-root .belgebox .bpbar a{color:var(--accent);text-decoration:none;font-weight:700;text-transform:none;letter-spacing:0}
#fm-root .belgebox .bpzoom{display:flex;align-items:center;gap:6px}
#fm-root .belgebox .bpzoom button{width:24px;height:24px;border:1px solid var(--line2);border-radius:6px;background:#fff;color:var(--text);font-size:15px;font-weight:700;cursor:pointer;display:grid;place-items:center;line-height:1}
#fm-root .belgebox .bpzoom button:last-of-type{width:auto;padding:0 9px;font-size:11px}
#fm-root .belgebox .bpzoom button:hover{border-color:var(--accent);color:var(--accent)}
#fm-root .belgebox .bpzoom .bpz{font-size:11px;font-weight:700;color:var(--muted);min-width:38px;text-align:center}
#fm-root .belgebox .bpview{height:auto;max-height:86vh;min-height:200px;overflow:auto;background:#eef1f5;display:flex;align-items:flex-start;justify-content:center;padding:10px}
#fm-root .belgebox .bpframe-h{width:100%;border:0;background:#fff;display:block}
#fm-root .belgebox .bpimg{display:block;max-width:100%;max-height:100%;object-fit:contain;transition:transform .12s ease}
#fm-root .belgebox .bppdf{width:100%;height:84vh;min-height:580px;border:0;background:#fff}
#fm-root .belgebox .bpempty{height:200px;display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:12px}
@media(max-width:1100px){#fm-root .fiseditor{flex-direction:column}#fm-root .belgepane{flex:none;max-width:100%;width:100%;position:static}}
#fm-root .ph .mu{margin-left:auto;font-weight:500}
#fm-root .balance{display:flex;align-items:center;gap:10px;margin-top:8px;padding:7px 12px;border-radius:9px;background:#e9f7ee;border:1px solid #c7ecd3;color:#15803d;font-weight:700}
#fm-root .balance .bnote{color:var(--muted);font-size:12px;margin-left:auto;font-weight:400}
#fm-root .banner{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:10px;font-size:12px;margin-bottom:14px;line-height:1.55}
#fm-root .banner.info{background:var(--accent-soft);border:1px solid var(--accent-line);color:var(--text)}
#fm-root .banner b{font-weight:700}
#fm-root .wactions{display:flex;gap:9px;margin-top:14px;flex-wrap:wrap;align-items:center}
#fm-root .auto{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;border-top:1px solid var(--line);background:#fbfcfd}
#fm-root .auto .at{font-size:12.5px;font-weight:700}
#fm-root .auto .as{font-size:11px;color:var(--faint)}
#fm-root .seg{display:inline-flex;background:#fff;border:1px solid var(--line2);border-radius:9px;padding:3px}
#fm-root .seg button{border:none;background:transparent;color:var(--muted);font-size:12px;font-weight:600;padding:6px 12px;border-radius:7px;cursor:pointer}
#fm-root .seg button.on{background:var(--accent);color:#fff}
#fm-root .seg button:disabled{opacity:.55;cursor:default}
#fm-root .autoseg{margin-left:auto}
#fm-root .src{font-size:10px;color:var(--accent);display:flex;align-items:center;gap:4px;margin-top:2px}
#fm-root .egrid{display:grid;grid-template-columns:repeat(2,1fr);gap:13px}
#fm-root .ecard{border:1px solid var(--line);border-radius:12px;padding:15px 16px;background:#fff}
#fm-root .ecard .eh{display:flex;align-items:center;gap:11px;margin-bottom:10px}
#fm-root .ecard .ei{height:38px;width:38px;border-radius:10px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-weight:800;font-size:13px}
#fm-root .ecard .en b{font-size:13.5px}
#fm-root .ecard .en small{display:block;color:var(--faint);font-size:11px}
#fm-root .ecard .erow{display:flex;align-items:center;justify-content:space-between;font-size:12px;padding:5px 0;border-top:1px dashed var(--line)}
#fm-root .ecard .ebtns{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}
#fm-root .eform{border:1px dashed var(--line2);border-radius:12px;padding:16px;background:#fbfcfd}
#fm-root .eform .erw{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:11px}
#fm-root .endcol{justify-content:flex-end}
/* Belge görüntüleme modalı (ekranda büyük, ayrı sekme yok) */
#fm-root .docov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:grid;place-items:center;z-index:60;padding:10px}
#fm-root .docbox{background:#fff;border-radius:14px;width:min(1040px,97vw);height:96vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.35)}
#fm-root .docbar{display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid var(--line);flex-shrink:0}
#fm-root .zoomctl{display:flex;align-items:center;gap:4px;margin-right:6px}
#fm-root .zbtn{min-width:30px;height:30px;padding:0 8px;border:1px solid var(--line);background:#f8fafc;border-radius:7px;cursor:pointer;font-size:16px;font-weight:700;line-height:1;color:#0f172a;display:inline-flex;align-items:center;justify-content:center}
#fm-root .zbtn:hover{background:#eef2f7}
#fm-root .zbtn.zreset{font-size:12px;font-weight:600}
#fm-root .zval{min-width:46px;text-align:center;font-size:12.5px;font-weight:600;color:#334155}
#fm-root .docview{flex:1;min-height:0;overflow:auto;background:#fff;text-align:center}
#fm-root .docbar b{font-size:13.5px}
#fm-root .docframe{display:block;width:100%;height:100%;border:none;background:#fff}
#fm-root .docimg{display:inline-block;max-width:100%;height:auto;vertical-align:top;border-radius:6px;box-shadow:0 3px 16px rgba(0,0,0,.18);background:#fff}
/* ── Buton renk genişletmeleri ── */
#fm-root .btn.purple{background:#7c3aed;color:#fff;border-color:#7c3aed}
#fm-root .btn.purple:hover:not(:disabled){background:#6d28d9;border-color:#6d28d9}
#fm-root .btn.teal{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .btn.teal:hover:not(:disabled){filter:brightness(.94)}
/* ── Header seçici etiket grubu ── */
#fm-root .topfiltbar{display:flex;align-items:center;gap:8px}
#fm-root .topfilt{display:flex;align-items:center;gap:7px;background:var(--accent-soft);border:1.5px solid var(--accent-line);border-radius:10px;padding:5px 10px 5px 10px}
#fm-root .topfilt svg{color:var(--accent);flex-shrink:0;opacity:.8}
#fm-root .filtsel{border:none;background:transparent;font-size:13px;font-weight:700;color:var(--text);cursor:pointer;outline:none;min-width:130px;font-family:inherit}
#fm-root .topselwrap{display:none}
/* ── Özet kart (mcard) — renkli sol şerit + ikon ── */
#fm-root .mcard{background:#fff;border:1px solid var(--line);border-radius:13px;padding:14px 16px;position:relative;overflow:hidden;box-shadow:0 1px 3px rgba(15,27,45,.05),0 4px 12px rgba(15,27,45,.04);display:flex;flex-direction:column;gap:6px}
#fm-root .mcard::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:13px 0 0 13px;background:var(--mc,var(--accent))}
#fm-root .mci{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;flex-shrink:0;align-self:flex-start;margin-bottom:2px}
#fm-root .mcard .ml{font-size:11.5px;color:var(--muted);font-weight:600}
#fm-root .mcard .mv{font-size:28px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.5px;color:var(--text)}
/* ── Mükellef arama kutusu ── */
#fm-root .mukara{display:flex;align-items:center;gap:8px;border:1.5px solid var(--line2);border-radius:10px;padding:7px 12px;background:#fff;color:var(--muted);min-width:220px}
#fm-root .mukara:focus-within{border-color:var(--accent);color:var(--accent)}
#fm-root .mukara input{border:none;outline:none;background:transparent;font-size:13px;font-weight:600;color:var(--text);width:100%;font-family:inherit}
#fm-root .mukara input::placeholder{color:var(--faint);font-weight:400}
/* ── Mükellef listesi — kart satırlar ── */
#fm-root .mktbl{width:100%;border-collapse:collapse;font-size:13px}
#fm-root .mktbl thead th{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--faint);padding:8px 12px;border-bottom:1.5px solid var(--line);text-align:left;white-space:nowrap}
#fm-root .mktbl thead th.num{text-align:right}
#fm-root .mktr{cursor:pointer;transition:background .1s}
#fm-root .mktr:hover{background:#f8fafc}
#fm-root .mktr td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
#fm-root .mktr:last-child td{border-bottom:none}
#fm-root .mktr td.num{text-align:right}
#fm-root .mkdot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
#fm-root .mkdot-issue{background:#e5484d}
#fm-root .mkdot-pending{background:#d97706}
#fm-root .mkdot-ok{background:#22c55e}
#fm-root .mkfirma{font-size:13px;font-weight:700;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px}
#fm-root .mkvkn{font-size:11px;color:var(--faint);display:block;margin-top:1px}
#fm-root .mkdef{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:var(--accent-soft);color:var(--accent)}
#fm-root .faint{color:var(--faint)}
#fm-root .mkbtn{display:inline-flex;align-items:center;padding:5px 11px;border-radius:7px;border:1.5px solid var(--accent-line);background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:background .12s,color .12s}
#fm-root .mkbtn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .dnt-bdg{display:inline-flex;align-items:center;height:20px;padding:0 6px;border-radius:5px;border:1.5px solid;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:.3px;flex-shrink:0;white-space:nowrap}

/* Fatura merkezi son görsel katman */
#fm-root .topfiltbar{gap:10px}
#fm-root .topfilt{height:38px;border-radius:8px;background:#eef3ff;border-color:#cdd9ff;box-shadow:inset 0 1px 0 rgba(255,255,255,.8)}
#fm-root .filtsel{font-size:13.5px;font-weight:800;min-width:170px}
#fm-root .btn .ico{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;background:rgba(255,255,255,.55)}
#fm-root .btn.primary,#fm-root .btn.blue,#fm-root .btn.red,#fm-root .btn.ai,#fm-root .btn.teal,#fm-root .btn.purple{box-shadow:0 12px 22px -16px currentColor}
#fm-root .btn.ai{background:linear-gradient(135deg,#7c3aed 0%,#a855f7 54%,#60a5fa 100%);border-color:#8b5cf6}
#fm-root .btn.fix{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .btn.upload{background:linear-gradient(180deg,#eef6ff,#e6f0ff);border-color:#b8d3ff;color:#1d4ed8}
#fm-root .dfchip{height:32px;border-radius:999px;padding:0 14px;border-color:#d8e1ea;background:linear-gradient(180deg,#fff,#f8fafc);font-weight:800}
#fm-root .dfchip .dfn{margin-left:4px;background:#eef3ff;color:#3157d5;border-radius:999px;padding:2px 8px;min-width:24px}
#fm-root .dfchip.on{background:#3157d5;color:#fff;border-color:#3157d5;box-shadow:0 10px 20px -16px rgba(49,87,213,.8)}
#fm-root .dfchip.on .dfn{background:rgba(255,255,255,.22);color:#fff}
#fm-root .aibar{position:relative;align-items:center;gap:18px;margin:18px 18px 16px;padding:18px 20px;border-radius:8px;background:linear-gradient(135deg,#eef3ff 0%,#fbfcff 58%,#f0f7ff 100%);border:1px solid #cdd9ff;box-shadow:0 18px 42px -32px rgba(49,87,213,.75)}
#fm-root .aibar::before{content:'';position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,#3157d5,#6d5df6,#38bdf8)}
#fm-root .aibar .aiscan{width:48px;height:58px;border-radius:8px;border:2px solid #3157d5;box-shadow:0 12px 24px -16px rgba(49,87,213,.85)}
#fm-root .aibar .aiscan i{left:10px;height:3px;background:#bfdbfe}
#fm-root .aibar .aiscan i:nth-child(1){top:15px;width:24px}#fm-root .aibar .aiscan i:nth-child(2){top:24px;width:28px}#fm-root .aibar .aiscan i:nth-child(3){top:33px;width:22px}#fm-root .aibar .aiscan i:nth-child(4){top:42px;width:28px}
#fm-root .aibar .aiscan .beam{height:16px;background:linear-gradient(transparent,rgba(49,87,213,.45),transparent)}
#fm-root .aibar .ait{font-size:16px;font-weight:900;color:#2741a8}
#fm-root .aibar .aisub{font-size:12.5px;color:#64748b}
#fm-root .aibar .aitrack{height:9px;border-radius:999px;background:#dbe6ff}
#fm-root .aibar .aifill{background:linear-gradient(90deg,#3157d5,#6d5df6,#38bdf8)}
#fm-root .aibar .aipct{font-size:32px;font-weight:950;color:#2741a8;letter-spacing:0}
#fm-root .aibar .airight small{font-size:10px;font-weight:900;color:#94a3b8}
#fm-root .aibar.err{background:#fff7f7;border-color:#f3c4c4;box-shadow:none}
/* AI okuma — chip'ler (sırada / tahmini süre / okunamadı), not satırı, düzgün Durdur butonu */
#fm-root .aibar .airight{display:flex;flex-direction:column;align-items:center;gap:1px;flex-shrink:0;min-width:86px}
#fm-root .aibar .aisub{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:3px}
#fm-root .aibar .aichip{display:inline-flex;align-items:center;gap:5px;padding:3px 11px;border-radius:999px;font-size:11px;font-weight:700;background:var(--accent-soft);color:var(--th-text);border:1px solid var(--accent-line);line-height:1.5;font-variant-numeric:tabular-nums}
#fm-root .aibar .aichip.eta{background:#fff;color:var(--accent)}
#fm-root .aibar .aichip.warn{background:#fdf2e0;color:#b45309;border-color:#f3dcab}
#fm-root .aibar .aichip .qdot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 var(--accent);animation:aiqpulse 1.5s ease-out infinite}
@keyframes aiqpulse{0%{box-shadow:0 0 0 0 rgba(13,148,136,.45)}70%{box-shadow:0 0 0 5px rgba(13,148,136,0)}100%{box-shadow:0 0 0 0 rgba(13,148,136,0)}}
#fm-root .aibar .ainote{font-size:11px;color:#9aa6b8;margin-top:8px;font-weight:600}
#fm-root .aibar .aistop{margin-top:11px;display:inline-flex;align-items:center;gap:5px;padding:6px 16px;font-size:12.5px;font-weight:800;color:#dc2626;background:#fff;border:1.5px solid #f1c6c6;border-radius:10px;cursor:pointer;transition:all .16s ease;box-shadow:0 2px 6px -1px rgba(220,38,38,.14)}
#fm-root .aibar .aistop:hover:not(:disabled){background:#dc2626;color:#fff;border-color:#dc2626;box-shadow:0 7px 18px -5px rgba(220,38,38,.55);transform:translateY(-1px)}
#fm-root .aibar .aistop:active:not(:disabled){transform:translateY(0)}
#fm-root .aibar .aistop:disabled{opacity:.55;cursor:default}
#fm-root .mgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0 12px;padding:8px;background:#fff;border:1px solid #dde5ef;border-radius:8px}
#fm-root .mcard{min-height:58px;border:0;border-left:3px solid var(--mc,var(--accent));border-radius:5px;background:#f8fafc;padding:8px 10px;box-shadow:none;gap:4px}
#fm-root .mcard::before{display:none}
#fm-root .mci{display:none}
#fm-root .mcard .ml{font-size:10.5px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.25px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .mcard .mv{font-size:23px;font-weight:900;line-height:1.05;margin-top:4px;letter-spacing:0}
#fm-root .mukara{height:38px;border-radius:8px;background:#f8fafc;border-color:#dce5ee}
#fm-root .mktbl{border-collapse:separate;border-spacing:0}
#fm-root .mktbl thead th{position:sticky;top:0;z-index:1;background:#eef3ff;color:#2741a8;border-top:1px solid #dfe7ef;border-bottom:1px solid #cdd9ff}
#fm-root .mktbl thead th:first-child{border-top-left-radius:8px}
#fm-root .mktbl thead th:last-child{border-top-right-radius:8px}
#fm-root .mktr td{background:#fff;border-bottom:1px solid #e7edf3}
#fm-root .mktr td:first-child{border-left:4px solid transparent}
#fm-root .mktr-issue td:first-child{border-left-color:#e5484d}
#fm-root .mktr-pending td:first-child{border-left-color:#2563eb}
#fm-root .mktr-ok td:first-child{border-left-color:#22c55e}
#fm-root .mktr:hover td{background:#f7fbf8}
#fm-root .mktr:hover .mkbtn{background:#15803d;color:#fff;border-color:#15803d}
#fm-root .mkfirma{font-size:13.5px;color:#172033}
#fm-root .mkdef{border-radius:999px;background:#e7f4ec;border:1px solid #c6e8d0}
#fm-root .mkbtn{border-radius:8px;padding:7px 12px}
#fm-root .mkstatus{width:28px;height:28px;border-radius:8px;display:inline-grid;place-items:center;font-size:12px;font-weight:900;border:1px solid #d8e1ea;background:#f8fafc;color:#475569;font-variant-numeric:tabular-nums}
#fm-root .mkstatus-issue{background:#fff1f1;border-color:#ffcaca;color:#e5484d}
#fm-root .mkstatus-pending{background:#eff6ff;border-color:#bfdbfe;color:#2563eb}
#fm-root .mkstatus-ok{background:#ecfdf5;border-color:#bbf7d0;color:#15803d}
#fm-root .mknum{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:24px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:900;font-variant-numeric:tabular-nums;border:1px solid transparent}
#fm-root .mknum-pending{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
#fm-root .mknum-ok{background:#ecfdf5;border-color:#bbf7d0;color:#15803d}
#fm-root .mknum-posted{background:#f0fdfa;border-color:#99f6e4;color:#0f766e}
#fm-root .mknum-issue{background:#fff1f1;border-color:#ffcaca;color:#e5484d}
#fm-root .screen > .fmstats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0 14px;padding:9px;background:#fff;border:1px solid #dde5ef;border-radius:8px;box-shadow:none}
#fm-root .screen > .fmstats .fmstat{min-height:58px;border:0;border-left:3px solid var(--sc,var(--accent));border-radius:5px;padding:8px 10px;background:#f8fafc;box-shadow:none}
#fm-root .screen > .fmstats .fmstat::before,#fm-root .screen > .fmstats .fmstat::after{display:none}
#fm-root .screen > .fmstats .fmsl{font-size:10px;letter-spacing:.25px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .screen > .fmstats .fmsl::before{width:6px;height:6px;border-radius:999px}
#fm-root .screen > .fmstats .fmsv{font-size:23px;margin-top:5px;color:#111827;letter-spacing:0}
#fm-root .invcard{border-radius:8px;box-shadow:none}
#fm-root .invactions{gap:8px;padding:10px 12px;background:#fff;align-items:center}
#fm-root .invactions h3{font-size:13px;font-weight:800;margin-right:4px}
#fm-root .invactions .btn{height:34px;border-radius:6px;padding:0 11px;font-size:12px;box-shadow:none}
#fm-root .invactions .btn .ico{width:17px;height:17px;border-radius:4px;background:transparent}
#fm-root .invactions .btn.blue{background:#3157d5;border-color:#3157d5}
#fm-root .invactions .btn.primary{background:#173b8f;border-color:#173b8f}
#fm-root .invactions .btn.ai{background:#6d5df6;border-color:#6d5df6}
#fm-root .invactions .btn.fix{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .invactions .btn.upload{background:#f4f7ff;border-color:#c8d6ff;color:#2741a8}
#fm-root .invactions .btn.soon:disabled{background:#f8fafc;border-color:#e2e8f0;color:#94a3b8}
#fm-root .muhfilter{display:inline-flex;align-items:center;gap:3px;height:26px;padding:3px;border:1px solid #dbe3ee;border-radius:7px;background:#f8fafc;flex-shrink:0}
#fm-root .muhfilter button{height:20px;border:0;border-radius:5px;background:transparent;color:#64748b;font-size:11px;font-weight:800;padding:0 8px;cursor:pointer;font-family:inherit}
#fm-root .muhfilter button.on{background:#3157d5;color:#fff}
#fm-root .muhfilter b{font-size:10px;font-weight:900;margin-left:4px;opacity:.9}
#fm-root .fiseditor{gap:14px;align-items:stretch}
#fm-root .belgepane{flex:0 0 min(72%,calc(100vw - 540px));max-width:min(72%,calc(100vw - 540px));position:sticky;top:10px}
#fm-root .app.editorfull .belgepane{flex:0 0 76%;max-width:76%}
#fm-root .fispane{min-width:320px}
#fm-root .belgebox{border-radius:8px;border-color:#d7e3ee;box-shadow:0 14px 32px -28px rgba(15,23,42,.55);height:calc(100vh - 156px);min-height:620px}
#fm-root .app.editorfull .belgebox{height:calc(100vh - 34px)}
#fm-root .belgebox .bpbar{min-height:42px;background:linear-gradient(180deg,#fff,#f8fafc);border-bottom-color:#dde6ef}
#fm-root .belgebox .bpview{height:100%;max-height:none;min-height:0;flex:1;background:#e9eef4;padding:14px}
#fm-root .belgebox .bpframe-h{min-height:100%;box-shadow:0 2px 18px rgba(15,23,42,.12)}
#fm-root .belgebox .bppdf{height:100%;min-height:0}
@media(max-width:1100px){#fm-root .belgebox{height:72vh;min-height:520px}#fm-root .belgepane{flex:none;max-width:100%;width:100%}}

/* Muhasebeleştir: tek ekran, düz belge alanı, kompakt sağ panel */
#fm-root .muhcard{height:calc(100vh - 150px);min-height:700px;border:0;background:transparent;box-shadow:none;display:flex;flex-direction:column;overflow:hidden}
#fm-root .muhmain{padding:0;flex:1;min-height:0}
#fm-root .muhmain .fiseditor{height:100%;min-height:0;gap:8px;align-items:stretch}
#fm-root .muhmain .belgepane{flex:1 1 auto;max-width:none;min-width:0;height:100%;position:sticky;top:0}
#fm-root .app.editorfull .muhmain .belgepane{flex:1 1 auto;max-width:none}
#fm-root .muhmain .fispane{flex:0 0 440px;max-width:440px;min-width:400px;height:100%;overflow:auto;padding:0 0 0 8px}
#fm-root .muhmain .fispane > .ph{order:0;position:sticky;top:0;z-index:6;margin:0;padding:8px 0 6px;background:#fff;border-bottom:1px solid #edf1f5}
#fm-root .muhmain .fispane > .docmeta{order:1}
#fm-root .muhmain .fispane > .tevpanel{order:2}
#fm-root .muhmain .fispane > .twrap{order:3}
#fm-root .muhmain .fispane > .balance{order:4}
#fm-root .muhmain .fispane > .wactions{order:5;position:sticky;bottom:0;z-index:5;margin-top:8px;padding:8px 0;background:linear-gradient(180deg,rgba(255,255,255,.88),#fff 35%)}
#fm-root .muhmain .docmeta{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:8px;margin:8px 0;border-radius:4px;background:#fff;border:1px solid #d6e0ea}
#fm-root .muhmain .docmeta .dm{gap:2px;min-width:0}
#fm-root .muhmain .docmeta .dml{font-size:9.5px;line-height:1;letter-spacing:.35px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .muhmain .docmeta .dmi,#fm-root .muhmain .docmeta .psel .pselfield{height:28px;border-radius:5px;font-size:12.5px;padding:0 7px;min-width:0}
#fm-root .muhmain .docmeta .psel .pselfield span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .muhmain .belgebox{height:100%;min-height:0;border:0;border-radius:0;box-shadow:none;background:#e7edf3}
#fm-root .muhmain .belgebox .bpbar{min-height:36px;padding:6px 10px;background:#fff;border-bottom:1px solid #d7e0ea;text-transform:none;letter-spacing:0}
#fm-root .muhmain .belgebox .bpview{height:calc(100% - 36px);max-height:none;min-height:0;flex:1;padding:8px;background:#e7edf3;border:0}
#fm-root .muhmain .belgebox .bpframe-h{min-height:100%;box-shadow:none;background:#fff}
#fm-root .muhmain .belgebox .bpimg{box-shadow:none;border-radius:0}
#fm-root .muhmain .belgebox .bppdf{height:100%;min-height:0;background:#fff}
#fm-root .muhmain .fgrps{gap:6px}
#fm-root .muhmain .fgrp{border-radius:4px}
#fm-root .muhmain .fgrp .fgh{padding:4px 9px}
#fm-root .muhmain .fgrp .frow{padding:4px 8px;gap:5px}
#fm-root .muhmain .fgrp .fgt{padding:4px 9px}
#fm-root .muhmain .balance{margin:7px 0 0;padding:7px 10px;border-radius:4px}
#fm-root .muhmain .balance .bnote{font-size:11.5px}
#fm-root .muhcard .wstrip{flex:0 0 auto;padding:8px 12px;background:#fff;border-top:1px solid #dde5ee}
#fm-root .muhcard .auto{flex:0 0 auto;padding:9px 14px;background:#fff;border-top:1px solid #edf1f5}
@media(max-width:1280px){#fm-root .muhmain .fispane{flex-basis:410px;max-width:410px;min-width:380px}#fm-root .muhmain .docmeta{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1100px){#fm-root .muhcard{height:auto;min-height:0;overflow:visible}#fm-root .muhmain .fiseditor{height:auto;min-height:0}#fm-root .muhmain .fispane{flex:none;width:100%;max-width:none;min-width:0;height:auto;overflow:visible;padding:0}#fm-root .muhmain .docmeta{grid-template-columns:repeat(2,minmax(0,1fr))}}

/* Son revizyon: mavi tonu kır, üst barı muhasebeleştirmede kaldır, aksiyonları yeniden kur */
#fm-root{--bg:#f4f5f3;--side:#fbfaf7;--line:#e4e1da;--line2:#d7d2c8;--text:#20242a;--muted:#66706c;--faint:#9aa09b;--accent:#374151;--accent-soft:#eef0ed;--accent-line:#d5dbd4;--th:#f0f2ee;--th-text:#3f4a44;--blue:#334155;--green:#16866a;--amber:#b7791f}
#fm-root[data-accent="slate"]{--accent:#374151;--accent-soft:#eef0ed;--accent-line:#d5dbd4;--th:#f0f2ee;--th-text:#3f4a44}
#fm-root .app::before{height:3px;background:var(--accent)}
#fm-root .side{background:#fff;border-right-color:var(--line);box-shadow:none}
#fm-root .brand{padding:14px 12px;border-bottom:1px solid var(--line);background:#fff}
#fm-root .backlink{height:26px;margin:0 0 10px;color:#7a817b;font-size:11px}
#fm-root .brandplate{position:relative;align-items:flex-start;gap:11px;padding:13px 12px;border:1px solid #d8d2c7;border-radius:10px;background:linear-gradient(145deg,#ffffff,#f2f0ea);box-shadow:0 14px 28px -24px rgba(31,41,55,.5)}
#fm-root .brandplate::after{content:'';position:absolute;left:12px;right:12px;bottom:8px;height:2px;border-radius:2px;background:linear-gradient(90deg,#1f2937 0 34%,var(--accent) 34% 68%,#c0842b 68%)}
#fm-root .brandmark{width:38px;height:38px;border-radius:9px;background:#1f2937;color:#fff;font-size:12px;letter-spacing:.4px;box-shadow:inset 0 -2px 0 rgba(255,255,255,.08)}
#fm-root .brandmod{font-size:17px;font-weight:900;color:#161b22;line-height:1.05}
#fm-root .brandco{font-size:11px;font-weight:800;color:#66706c;margin-top:5px;letter-spacing:.1px}
#fm-root .sidecontext{margin-top:10px;padding:10px;border:1px solid #ddd8ce;border-radius:10px;background:#fff;box-shadow:0 10px 22px -24px rgba(31,41,55,.45)}
#fm-root .ctxlabel{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.45px;color:#7a817b;margin-bottom:8px}
#fm-root .ctxfield{display:flex;flex-direction:column;gap:4px;margin-top:8px}
#fm-root .ctxfield span{font-size:9.5px;font-weight:900;text-transform:uppercase;letter-spacing:.35px;color:#9aa09b}
#fm-root .ctxfield select{height:34px;width:100%;border:1px solid var(--line2);border-radius:8px;background:#fff;color:var(--text);font-family:inherit;font-size:12px;font-weight:700;padding:0 9px;outline:none}
#fm-root .ctxfield select:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#fm-root .nitem.on{background:var(--accent-soft);color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
#fm-root .nitem.on > span:first-child{background:#1f2937;border-color:#1f2937}
#fm-root .nitem.on .ct{color:var(--accent)}
#fm-root .nsub.on{color:var(--accent)}
#fm-root .top{background:#fbfaf7;border-bottom-color:#ddd8ce;box-shadow:none}
#fm-root .screen-muhasebe .top{display:none}
#fm-root .screen-muhasebe .content{padding:10px 12px;overflow:hidden}
#fm-root .screen-muhasebe .muhcard{height:calc(100vh - 20px);min-height:0}
#fm-root .screen-muhasebe .muhmain .belgebox{background:#deded8}
#fm-root .screen-muhasebe .muhmain .belgebox .bpview{background:#deded8;padding:6px}
#fm-root .screen-muhasebe .muhmain .belgebox .bpbar{min-height:34px;border-bottom-color:#d5d9d6}
#fm-root .screen-muhasebe .muhmain .fispane{flex-basis:430px;max-width:430px;min-width:398px;padding-left:10px}
#fm-root .muhfilter{height:28px;border-color:#d7d2c8;background:#f5f4f0;border-radius:999px;padding:3px}
#fm-root .muhfilter button{height:22px;border-radius:999px;color:#66706c}
#fm-root .muhfilter button.on{background:#1f2937;color:#fff}
#fm-root .nacechip{border-color:#d6c9ad;background:#fbf4e5;color:#8a5a12}
#fm-root .topfilt{background:#f5f4f0;border-color:#d7d2c8;box-shadow:none}
#fm-root .topfilt svg{color:var(--accent)}
#fm-root .screen > .fmstats{grid-template-columns:repeat(5,minmax(0,1fr));padding:0;border:0;background:transparent;gap:12px;margin:8px 0 16px}
#fm-root .screen > .fmstats .fmstat{min-height:48px;border-left:0;border-radius:7px;background:#fff;padding:7px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px}
#fm-root .screen > .fmstats .fmsl{font-size:9.5px;line-height:1.1;white-space:normal;color:#66706c}
#fm-root .screen > .fmstats .fmsl::before{display:none}
#fm-root .screen > .fmstats .fmsv{font-size:21px;margin:0;color:#20242a}
#fm-root .screen > .fmstats .fmstat::after{content:'';display:block;width:4px;align-self:stretch;border-radius:999px;background:var(--sc,var(--accent));order:-1}
#fm-root .invcard{border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.04);overflow:hidden}
#fm-root .invactions{display:grid;grid-template-columns:auto 1fr;gap:10px 12px;padding:14px 16px;background:#fff;border-bottom-color:var(--line)}
#fm-root .invactions h3{grid-row:1 / span 2;align-self:center;min-width:92px;font-size:19px;line-height:1;font-weight:900;color:#0e1726}
#fm-root .invactions .sp{display:none}
#fm-root .invactions .btn{height:33px;border-radius:999px;padding:0 13px;font-size:11.5px;font-weight:800;border-width:1px;box-shadow:none;justify-self:start;background:#fff;color:#283242;border-color:var(--line2)}
#fm-root .invactions .btn .ico{width:18px;height:18px;border-radius:999px;background:var(--accent-soft);color:inherit}
#fm-root .invactions .btn:hover:not(:disabled){transform:none;border-color:var(--accent-line);box-shadow:none;color:var(--accent);background:var(--accent-soft)}
#fm-root .invactions .btn.blue{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .invactions .btn.upload{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .invactions .btn.fix{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .invactions .btn.ai{background:var(--accent);border-color:var(--accent);color:#fff}
#fm-root .invactions .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
#fm-root .invactions .btn.soon:disabled{background:#f5f6f9;border-color:var(--line);color:#9aa4b2}
#fm-root .soonbadge{background:#e8ecf3;color:#5a6b85}
#fm-root .dfchip.on{background:var(--accent);border-color:var(--accent)}
#fm-root .dfchip .dfn{background:var(--accent-soft);color:var(--accent)}
#fm-root .aibar{background:var(--accent-soft);border-color:var(--accent-line);box-shadow:none}
#fm-root .aibar::before{background:var(--accent)}
#fm-root .aibar .ait,#fm-root .aibar .aipct{color:var(--accent)}
#fm-root .aibar .aiscan{border-color:var(--accent)}
#fm-root .aibar .aifill{background:var(--accent)}
#fm-root thead th{background:#fbfcfe;color:var(--muted)}
#fm-root .mktbl thead th{background:#fbfcfe;color:var(--muted);border-bottom-color:var(--line2)}
#fm-root .mktr-pending td:first-child{border-left-color:var(--accent)}
#fm-root .mknum-pending{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .mktr:hover .mkbtn{background:var(--accent);border-color:var(--accent)}

/* İnce ayar: seçiciler tutarlı üstte, butonlar ve sayaçlar daha hafif/şeffaf */
#fm-root .screen-muhasebe .top{display:flex}
#fm-root .screen-muhasebe .content{padding:10px 18px;overflow:hidden}
#fm-root .screen-muhasebe .muhcard{height:calc(100vh - 112px);min-height:0}
#fm-root .sidecontext{display:none}
#fm-root .top{padding:10px 22px;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
#fm-root .topfiltbar{gap:10px}
#fm-root .topfilt{height:34px;border-radius:9px;background:var(--accent-soft);border:1px solid var(--accent-line);padding:4px 10px;box-shadow:none}
#fm-root .topfilt svg{color:var(--accent);opacity:.8}
#fm-root .filtsel{font-size:12.5px;font-weight:600;letter-spacing:0;min-width:150px;color:#20242a}
#fm-root .brandplate{padding:12px 12px;border-radius:10px;background:rgba(255,255,255,.72);border-color:rgba(31,41,55,.16)}
#fm-root .brandmark{width:34px;height:34px;border-radius:8px;font-size:11px;font-weight:700}
#fm-root .brandmod{font-size:15px;font-weight:700;letter-spacing:0}
#fm-root .brandco{font-size:10.5px;font-weight:500;color:#72796f}
#fm-root .nitem{font-weight:600}
#fm-root .nitem .ct{font-weight:600}
#fm-root .screen > .fmstats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:8px 0 12px;padding:0;background:transparent;border:0}
#fm-root .screen > .fmstats .fmstat{min-height:58px;border:1px solid color-mix(in srgb,var(--sc,var(--accent)) 24%,transparent);border-radius:9px;background:color-mix(in srgb,var(--sc,var(--accent)) 8%,#fff);padding:10px 12px;display:grid;grid-template-columns:1fr auto;align-items:end;box-shadow:none}
#fm-root .screen > .fmstats .fmstat::after{content:'';display:block;grid-column:1 / 3;width:28px;height:3px;margin-top:7px;border-radius:999px;background:color-mix(in srgb,var(--sc,var(--accent)) 70%,transparent);order:3}
#fm-root .screen > .fmstats .fmsl{font-size:10.5px;font-weight:600;line-height:1.12;color:#66706c;text-transform:uppercase;letter-spacing:.28px;white-space:normal}
#fm-root .screen > .fmstats .fmsv{font-size:24px;font-weight:650;line-height:1;color:#20242a;letter-spacing:0;margin:0;font-variant-numeric:tabular-nums}
#fm-root .invcard{border-color:#e1ddd4;background:rgba(255,255,255,.82);box-shadow:none}
#fm-root .invactions{display:flex;align-items:center;gap:8px;padding:12px 14px;background:rgba(255,255,255,.68);border-bottom:1px solid #e1ddd4;flex-wrap:wrap}
#fm-root .invactions h3{font-size:14px;font-weight:650;line-height:1;color:#20242a;min-width:94px;margin:0}
#fm-root .invactions .sp{display:block;flex:1 1 10px}
#fm-root .invactions .btn{height:30px;border-radius:8px;padding:0 10px;font-size:11.5px;font-weight:600;letter-spacing:0;border:1px solid rgba(31,41,55,.14);box-shadow:none;background:rgba(255,255,255,.62);color:#374151}
#fm-root .invactions .btn .ico{width:16px;height:16px;border-radius:5px;background:rgba(255,255,255,.42)}
#fm-root .invactions .btn:hover:not(:disabled){transform:none;box-shadow:none;filter:none}
#fm-root .invactions .btn.blue{background:rgba(31,41,55,.11);border-color:rgba(31,41,55,.2);color:#1f2937}
#fm-root .invactions .btn.fetch{background:rgba(196,138,42,.10);border-color:rgba(196,138,42,.24);color:#785a16}
#fm-root .invactions .btn.upload{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .invactions .btn.fix{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .invactions .btn.ai{background:rgba(71,85,105,.14);border-color:rgba(71,85,105,.22);color:#374151}
#fm-root .invactions .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
#fm-root .invactions .btn.soon:disabled{background:rgba(148,163,184,.10);border-color:rgba(148,163,184,.20);color:#8a918b}
#fm-root .soonbadge{font-size:9px;font-weight:600;background:rgba(31,41,55,.08);color:#7a817b}
#fm-root .dfchip{height:28px;border-radius:9px;padding:0 10px;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.62);border-color:rgba(31,41,55,.13);color:#66706c}
#fm-root .dfchip .dfn{font-size:10.5px;font-weight:600;background:rgba(31,41,55,.08);color:#66706c;border-radius:999px;padding:1px 7px}
#fm-root .dfchip.on{background:rgba(31,41,55,.12);border-color:rgba(31,41,55,.22);color:#1f2937;box-shadow:none}
#fm-root .dfchip.on .dfn{background:rgba(31,41,55,.12);color:#1f2937}
#fm-root .muhfilter button{font-weight:600}
#fm-root .muhfilter b{font-weight:600}

/* Bağlam seçimi tüm modüllerde solda; üstteki seçim barı kullanılmaz */
#fm-root .sidecontext{display:block;margin-top:10px;padding:10px;border:1px solid rgba(31,41,55,.14);border-radius:10px;background:rgba(255,255,255,.68);box-shadow:0 10px 22px -24px rgba(31,41,55,.45)}
#fm-root .ctxlabel{font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.35px;color:#7a817b;margin-bottom:8px}
#fm-root .ctxfield{display:flex;flex-direction:column;gap:4px;margin-top:8px}
#fm-root .ctxfield span{font-size:9.5px;font-weight:650;text-transform:uppercase;letter-spacing:.3px;color:#8b928c}
#fm-root .ctxfield select{height:36px;width:100%;border:1px solid rgba(31,41,55,.16);border-radius:7px;background:rgba(255,255,255,.7);color:#20242a;font-family:inherit;font-size:12.5px;font-weight:600;padding:0 9px;outline:none}
#fm-root .ctxfield select:focus{border-color:rgba(15,118,110,.38);box-shadow:0 0 0 3px rgba(15,118,110,.08)}
#fm-root .topfiltbar{display:none}
#fm-root .top{min-height:38px;padding:8px 22px;background:rgba(251,250,247,.72)}
#fm-root .screen-muhasebe .top{display:none}
#fm-root .screen-muhasebe .content{padding:10px 18px;overflow:hidden}
#fm-root .screen-muhasebe .muhcard{height:calc(100vh - 20px);min-height:0}

/* Belge/kod ekranı son sıkıştırma: boşluk yok, sıcak zemin, sağ panel daha rahat */
#fm-root{--bg:#f7f4ec;--line:#e2d8c8;--line2:#d8cbb8;--accent:#23665b;--accent-soft:#edf7f3;--accent-line:#cde4dc;--th:#f2f7f3;--th-text:#315c52}
#fm-root .app::before{background:linear-gradient(90deg,#23665b,#d19b45,#7b8f69)}
#fm-root .side{background:linear-gradient(180deg,#fffdf8 0%,#f6f1e7 100%);border-right-color:#ded3c1}
#fm-root .brand{background:#fffdf8;border-bottom-color:#ded3c1}
#fm-root .brandplate{background:rgba(255,255,255,.78);border-color:rgba(113,86,45,.18)}
#fm-root .brandplate::after{background:linear-gradient(90deg,#23665b 0 45%,#d19b45 45% 78%,#7b8f69 78%)}
#fm-root .brandmark{background:#24342f}
#fm-root .top{background:rgba(255,253,248,.72);border-bottom-color:#ded3c1}
#fm-root .content{background:#f7f4ec}
#fm-root .screen-muhasebe .content{padding:8px 14px}
#fm-root .screen-muhasebe .muhmain .fiseditor{gap:10px}
#fm-root .screen-muhasebe .muhmain .belgebox{background:#f2eee4}
#fm-root .screen-muhasebe .muhmain .belgebox .bpbar{background:#fffdf8;border-bottom-color:#ded3c1}
#fm-root .screen-muhasebe .muhmain .belgebox .bpview{background:#f2eee4;padding:6px;justify-content:center}
#fm-root .screen-muhasebe .muhmain .belgebox .bpframe-h{background:#fff;box-shadow:0 0 0 1px rgba(113,86,45,.12)}
#fm-root .screen-muhasebe .muhmain .belgebox .bpimg{background:#fff;box-shadow:0 0 0 1px rgba(113,86,45,.12)}
#fm-root .screen-muhasebe .muhmain .fispane{flex-basis:430px;max-width:430px;min-width:398px;padding-left:10px;overflow:auto;scrollbar-gutter:stable;background:#f7f4ec}
#fm-root .muhmain .fispane > .ph{background:#fffdf8;border-bottom-color:#e3dacb;padding:6px 0 5px}
#fm-root .muhmain .docmeta{margin:6px 0;border-color:#d9e3df;background:#fbfefa;padding:7px;gap:5px}
#fm-root .muhmain .docmeta .dmi,#fm-root .muhmain .docmeta .psel .pselfield{height:26px;font-size:12px;border-color:#d9d0c0;background:#fff}
#fm-root .muhmain .fgrp{border-color:#ded5c6;background:#fff}
#fm-root .muhmain .fgrp .fgh{padding:4px 8px;background:#f4f8f4}
#fm-root .muhmain .fgrp .frow{padding:3px 7px}
#fm-root .muhmain .fgrp .fgt{padding:3px 8px}
#fm-root .muhmain .balance{margin:6px 0 0;padding:7px 10px;background:#e9f8ef;border-color:#bfe5ca}
#fm-root .muhmain .fispane > .wactions{position:sticky;bottom:0;margin-top:6px;padding:6px 0 0;background:linear-gradient(180deg,rgba(247,244,236,0),#f7f4ec 34%);min-height:42px}
#fm-root .muhmain .wactions .btn{height:30px;border-radius:8px;font-size:12px;font-weight:600}
#fm-root .muhmain .wactions .btn.primary{background:#24342f;border-color:#24342f;color:#fff}
#fm-root .muhmain .wactions .btn:not(.primary){background:#fff;border-color:#d8cbb8}
#fm-root .btn.primary{background:#23665b;border-color:#23665b}
#fm-root .invactions .btn.primary{background:rgba(35,102,91,.14);border-color:rgba(35,102,91,.28);color:#23665b}
#fm-root[data-accent="slate"]{--accent:#23665b;--accent-soft:#edf7f3;--accent-line:#cde4dc;--th:#f2f7f3;--th-text:#315c52}

/* Final sade beyaz duzen: tum moduller tutarli, muhasebe ekrani ferah */
#fm-root{--bg:#eef1f7;--side:#fff;--line:#e6eaf1;--line2:#d8dfe9;--text:#0e1726;--muted:#566379;--faint:#94a0b2;--accent:#2f54d6;--accent-soft:#eef1fe;--accent-line:#d2dbfb;--th:#f1f4fb;--th-text:#3a4673;--blue:#2f54d6;--green:#15924f;--amber:#cf7a0e}
#fm-root[data-accent="slate"]{--accent:#2f54d6;--accent-soft:#eef1fe;--accent-line:#d2dbfb;--th:#f1f4fb;--th-text:#3a4673}
#fm-root .app,#fm-root .main,#fm-root .content,#fm-root .side,#fm-root .brand,#fm-root .top{background:#fff}
#fm-root .app::before{background:var(--accent)}
#fm-root .side{width:232px;border-right-color:#e5e7eb;box-shadow:none}
#fm-root .brand{padding:10px 12px 12px;border-bottom:1px solid #e5e7eb}
#fm-root .brandplate{display:none!important}
#fm-root .backlink{height:24px;margin:0 0 8px;font-size:11px;color:#7b8490}
#fm-root .sidecontext{display:block;margin:0;padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;box-shadow:none}
#fm-root .ctxlabel{font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.32px;color:#7b8490;margin-bottom:8px}
#fm-root .ctxfield{gap:4px;margin-top:8px}
#fm-root .ctxfield span{font-size:9.5px;font-weight:650;color:#8a939d}
#fm-root .ctxfield select{height:34px;border:1px solid #dbe2e8;border-radius:7px;background:#fff;font-size:12px;font-weight:600;padding:0 8px}
#fm-root .topfiltbar{display:none!important}
#fm-root .top{height:38px;min-height:38px;padding:0 18px;border-bottom:1px solid #eef1f4;align-items:center;box-shadow:none;backdrop-filter:none}
#fm-root .crumb{font-size:12px}
#fm-root .content{padding:14px 18px}
#fm-root .card{background:#fff;border-color:#e5e7eb;box-shadow:none}
#fm-root .card .ch{background:#fff;border-bottom-color:#e5e7eb}
#fm-root table{background:#fff}
#fm-root thead th{background:#f6faf8;color:#35564f}
#fm-root tbody td{border-bottom-color:#eef1f4}
#fm-root .planwrap{max-height:calc(100vh - 152px)}
#fm-root .planwrap thead th{background:#f6faf8}
#fm-root .screen > .fmstats{background:#fff}
#fm-root .screen > .fmstats .fmstat{background:#fff}
#fm-root .invcard{background:#fff;border-color:#e5e7eb}
#fm-root .invactions{background:#fff;border-bottom-color:#e5e7eb}
#fm-root .screen-muhasebe .top{display:none}
#fm-root .screen-muhasebe .content{padding:8px 12px;background:#fff}
#fm-root .screen-muhasebe .muhcard{height:calc(100vh - 16px);min-height:0;background:#fff}
#fm-root .screen-muhasebe .muhmain .fiseditor{gap:10px;align-items:stretch}
#fm-root .screen-muhasebe .muhmain .belgebox,
#fm-root .screen-muhasebe .muhmain .belgebox .bpview,
#fm-root .screen-muhasebe .muhmain .fispane{background:#fff}
#fm-root .screen-muhasebe .muhmain .belgebox .bpbar{background:#fff;border-bottom-color:#e5e7eb}
#fm-root .screen-muhasebe .muhmain .belgebox .bpview{padding:6px}
#fm-root .screen-muhasebe .muhmain .belgebox .bpframe-h,
#fm-root .screen-muhasebe .muhmain .belgebox .bpimg{background:#fff;box-shadow:none}
#fm-root .screen-muhasebe .muhmain .fispane{flex:0 0 430px;max-width:430px;min-width:398px;height:100%;padding-left:10px;overflow:auto}
#fm-root .muhmain .fispane > .ph{background:#fff;border-bottom-color:#e5e7eb;padding:7px 0}
#fm-root .muhmain .docmeta{margin:7px 0;padding:8px;background:#fff;border-color:#e5e7eb;gap:7px}
#fm-root .muhmain .docmeta .dmi,#fm-root .muhmain .docmeta .psel .pselfield{height:29px;font-size:12.5px;background:#fff;border-color:#dbe2e8}
#fm-root .muhmain .fgrp{background:#fff;border-color:#e5e7eb;border-radius:6px}
#fm-root .muhmain .fgrp .fgh{padding:6px 9px;background:#f6faf8}
#fm-root .muhmain .fgrp .frow{padding:5px 8px;gap:6px}
#fm-root .muhmain .fgrp .fgt{padding:5px 9px}
#fm-root .muhmain .balance{margin:8px 0 0;padding:8px 11px;background:#ecfdf5;border-color:#bbf7d0}
#fm-root .muhmain .fispane > .wactions{position:sticky;bottom:0;margin-top:8px;padding:8px 0 0;background:linear-gradient(180deg,rgba(255,255,255,0),#fff 35%);min-height:40px}
#fm-root .screen-earsivSorgu .content,#fm-root .screen-efaturaSorgu .content{overflow:hidden}
#fm-root .sorgu-screen{height:calc(100vh - 92px);display:flex;flex-direction:column;min-height:0}
#fm-root .sorgu-screen > .h2,#fm-root .sorgu-screen > .sub{flex:0 0 auto}
#fm-root .sorgu-screen .sourcegrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}
#fm-root .sourcecard{height:104px;text-align:left;border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:14px;display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto auto;column-gap:12px;align-items:center;cursor:pointer}
#fm-root .sourcecard:hover{border-color:#cbd5e1;background:#fbfefd}
#fm-root .sourcecard.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--accent-soft)}
#fm-root .sourcecard .srcicon{grid-row:1 / 4;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)}
#fm-root .sourcecard b{font-size:15px;color:#17212f}
#fm-root .sourcecard small{font-size:12px;color:#64748b}
#fm-root .sourcecard em{font-style:normal;font-size:11.5px;color:var(--accent);font-weight:650}
#fm-root .sourcepanel{overflow:hidden;display:flex;flex-direction:column;min-height:0;flex:1}
#fm-root .sourcehead{display:flex;align-items:center;gap:9px;padding:12px 14px}
#fm-root .sourcehead h3{font-size:15px;margin:0}
#fm-root .sourcehint{padding:9px 14px;border-bottom:1px solid #e5e7eb;background:#fffbeb;color:#805b16;font-size:12px}
#fm-root .sourcetablewrap{overflow:auto;max-height:none;min-height:0;flex:1;position:relative}
#fm-root .sourcetable{width:100%;border-collapse:separate;border-spacing:0}
#fm-root .sourcetable.earsivtable{table-layout:fixed;min-width:760px}
#fm-root .sourcetable.earsivtable th:nth-child(1),#fm-root .sourcetable.earsivtable td:nth-child(1){width:42px}
#fm-root .sourcetable.earsivtable th:nth-child(3),#fm-root .sourcetable.earsivtable td:nth-child(3){width:120px}
#fm-root .sourcetable.earsivtable th:nth-child(4),#fm-root .sourcetable.earsivtable td:nth-child(4){width:155px}
#fm-root .sourcetable.earsivtable th:nth-child(5),#fm-root .sourcetable.earsivtable td:nth-child(5){width:110px}
#fm-root .sourcetable.earsivtable th:nth-child(6),#fm-root .sourcetable.earsivtable td:nth-child(6){width:110px}
#fm-root .sourcetable.earsivtable th:nth-child(7),#fm-root .sourcetable.earsivtable td:nth-child(7){width:88px}
#fm-root .sourcetable.earsivtable th:nth-child(8),#fm-root .sourcetable.earsivtable td:nth-child(8){width:62px}
#fm-root .sourcetable.earsivtable th:nth-child(9),#fm-root .sourcetable.earsivtable td:nth-child(9){width:92px}
#fm-root .sourcetable th{height:36px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.25px;white-space:nowrap}
#fm-root .sourcetable td{height:42px;font-size:12.5px;vertical-align:middle}
#fm-root .sourcetable.earsivtable td:not(.partyname){white-space:nowrap}
#fm-root .sourcetable th:last-child,#fm-root .sourcetable td:last-child{text-align:center}
#fm-root .sourcetable .partyname{font-weight:400;color:#17212f;white-space:normal;overflow-wrap:anywhere;word-break:normal;line-height:1.35;padding-right:14px}
#fm-root .sourcetable .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#64748b;max-width:220px;overflow:hidden;text-overflow:ellipsis}
#fm-root .sourcetable .plainstatus{color:#334155;font-weight:500}
#fm-root .transferstate{display:inline-grid;place-items:center;width:24px;height:24px;white-space:nowrap;vertical-align:middle}
#fm-root .transferstate .xico,#fm-root .transferstate .okico{width:22px;height:22px;border-radius:999px;display:inline-grid;place-items:center;font-size:16px;line-height:1;font-weight:700}
#fm-root .transferstate .xico{border:1px solid #fecaca;background:#fff1f2;color:#ef4444}
#fm-root .transferstate .okico{border:1px solid #bbf7d0;background:#ecfdf5;color:#16a34a}
#fm-root .sourcetable tr.blocked td{color:#9a5c5c;background:#fffafa}
#fm-root .sourcetable tr.done td{background:#f8fdfb}
#fm-root .sourcetable tr.missingdoc td{background:#fffdf7}
#fm-root .sourcetable tr.missingdoc .cb.disabled{background:#fff7ed;border-color:#fed7aa}
#fm-root .sourcetable tr.missingdoc .cb.disabled:not(.on)::after{background:#f59e0b}
#fm-root .sourcepanel.isbusy .sourcetable,#fm-root .sourcepanel.isbusy .providergrid{opacity:.22;filter:blur(.8px);pointer-events:none}
#fm-root .queryveil{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;background:rgba(255,255,255,.88);backdrop-filter:blur(2px);text-align:center;color:#243042}
#fm-root .queryveil b{display:block;margin:0;font-size:13px;font-weight:700;letter-spacing:.2px;line-height:1.3;color:#243042}
#fm-root .querydoc{position:relative;width:200px;height:8px;border:0;border-radius:999px;background:var(--accent-soft);overflow:hidden;box-shadow:inset 0 0 0 1px var(--accent-line)}
#fm-root .querydoc span{position:absolute;top:0;left:0;height:100%;width:42%;border-radius:999px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:fmBar 1.15s ease-in-out infinite}
#fm-root .querydoc i{display:none}
@keyframes fmBar{0%{left:-42%}100%{left:100%}}
@keyframes fmDot{0%,80%,100%{transform:translateY(0);opacity:.28}40%{transform:translateY(-5px);opacity:1}}
#fm-root .emptyrow{text-align:center;color:#94a3b8;padding:22px!important}
#fm-root .sourcebar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fbfcfe}
#fm-root .sourcebar > div:first-child{min-width:0;margin-right:auto}
#fm-root .sourcebar b{display:block;font-size:13px;color:#17212f;font-weight:650}
#fm-root .sourcebar span{display:block;margin-top:2px;font-size:11.5px;color:#64748b}
#fm-root .providerdiag{display:flex;align-items:center;gap:9px;min-height:34px;padding:7px 14px;border-top:1px solid #edf2f7;border-bottom:1px solid #e5e7eb;background:#f8fafc;color:#475569;font-size:11.5px;overflow:hidden}
#fm-root .providerdiag b{color:#17212f;font-size:12px;white-space:nowrap}
#fm-root .providerdiag span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .providerdiag.ok{background:#f0fdf4;color:#166534}
#fm-root .providerdiag.warn{background:#fff7ed;color:#9a3412}
#fm-root .providerdiag.bad{background:#fff1f2;color:#b91c1c}
#fm-root .providergrid{display:grid;gap:8px;padding:12px}
#fm-root .providerrow{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #e5e7eb;border-radius:9px;padding:10px 12px;background:#fff}
#fm-root .providerrow b{display:block;font-size:13px}
#fm-root .providerrow span{display:block;font-size:11.5px;color:#64748b;margin-top:2px}
#fm-root .provideractions{display:flex;align-items:center;gap:8px}
#fm-root .segmini{display:inline-flex;gap:3px;border:1px solid var(--line2);border-radius:999px;padding:3px;background:#f6f8fc}
#fm-root .segmini button{height:29px;border:0;background:transparent;border-radius:999px;padding:0 14px;font-weight:700;color:var(--muted);cursor:pointer;transition:color .12s,background .12s}
#fm-root .segmini button.on{background:var(--accent);color:#fff;box-shadow:0 2px 6px -2px rgba(47,84,214,.5)}
#fm-root .screen-muhasebe .nacechip{display:none!important}
#fm-root .screen-muhasebe .muhmain .fispane{flex:0 0 416px;max-width:416px;min-width:390px;padding-left:8px}
#fm-root .screen-muhasebe .muhmain .fispane > .ph{min-height:40px;gap:7px;padding:5px 0;align-items:center}
#fm-root .screen-muhasebe .phname{font-size:12.5px;font-weight:650;color:#17212f;white-space:nowrap}
#fm-root .screen-muhasebe .navbtns{height:32px;display:inline-flex;align-items:center;gap:2px;border:1px solid #dbe3ea;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.05);padding:2px}
#fm-root .screen-muhasebe .navb{width:28px;height:26px;border-radius:999px;border:0;background:#f6faf8;color:#17212f;font-size:20px;font-weight:650;display:grid;place-items:center;padding:0;line-height:1}
#fm-root .screen-muhasebe .navb:not(:disabled):hover{background:#e9f5ef;color:#0f766e}
#fm-root .screen-muhasebe .navb:disabled{opacity:.35}
#fm-root .screen-muhasebe .navpos{min-width:48px;text-align:center;color:#334155;font-size:12px;font-weight:650;font-variant-numeric:tabular-nums}
#fm-root .screen-muhasebe .muhfilter{height:32px;border-radius:999px;border:1px solid #cddbd6;background:#f7fbf9;padding:3px;gap:3px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
#fm-root .screen-muhasebe .muhfilter button{height:24px;border-radius:999px;padding:0 10px;font-size:12px;font-weight:650;color:#64706d}
#fm-root .screen-muhasebe .muhfilter button.on{background:#1f7a68;color:#fff;box-shadow:0 1px 4px rgba(31,122,104,.16)}
#fm-root .screen-muhasebe .muhfilter b{margin-left:4px;font-size:10.5px;font-weight:700;opacity:.92}
#fm-root .screen-muhasebe .ph .fifull{height:32px;border-radius:9px;border-color:#b9dcd1;background:#edf8f4;color:#1f7a68;font-size:12px;font-weight:650;padding:0 11px;box-shadow:0 1px 2px rgba(15,23,42,.05)}
#fm-root .screen-muhasebe .ph .fifull:hover{background:#1f7a68;color:#fff;border-color:#1f7a68}
#fm-root .screen-muhasebe .muhmain .balance{min-height:34px;margin:6px 0 0;padding:6px 9px;border-radius:7px;gap:8px}
#fm-root .screen-muhasebe .muhmain .balance b{font-size:12.5px;line-height:1.1}
#fm-root .screen-muhasebe .muhmain .balance .bnote{font-size:11px;line-height:1.2}
#fm-root .screen-muhasebe .muhmain .fgrp .fgt{padding:4px 8px}
#fm-root .screen-muhasebe .muhmain .fispane > .wactions{margin-top:6px;padding-top:6px;min-height:36px}
#fm-root .queryveil{gap:12px;justify-content:center;color:#243042}
#fm-root .queryveil b{font-size:12.5px;font-weight:700;margin-top:0;color:#243042}
#fm-root .querydoc{width:180px;height:8px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--accent-line)}
#fm-root .querydoc span{left:0;top:0;right:auto;width:42%;height:100%;box-shadow:none}

/* Muhasebeleştirme son yerleşim: sol dar, sağ panel geniş, belge+kod alanı tek çerçeve */
#fm-root .side{width:212px}
#fm-root .brand{padding:8px 10px 10px}
#fm-root .sidecontext{padding:9px}
#fm-root .ctxfield select{font-size:11.5px}
#fm-root .screen-muhasebe .muhmain{height:100%;padding:0}
#fm-root .screen-muhasebe .muhmain .fiseditor{height:100%;gap:10px;align-items:stretch;border:1px solid #e4eaee;border-radius:12px;background:#fff;padding:8px;box-shadow:0 1px 4px rgba(15,23,42,.04)}
#fm-root .screen-muhasebe .muhmain .belgepane{flex:1 1 auto;max-width:none;min-width:0;position:relative;top:auto}
#fm-root .screen-muhasebe .muhmain .belgebox{height:100%;border-color:#dfe7ec;border-radius:9px}
#fm-root .screen-muhasebe .muhmain .belgebox .bpview{flex:1;min-height:0;max-height:none}
#fm-root .screen-muhasebe .muhmain .fispane{flex:0 0 452px;max-width:452px;min-width:430px;height:100%;padding-left:10px;border-left:1px solid #eef2f4;overflow:auto}
#fm-root .screen-muhasebe .muhmain .fispane > .ph{order:1;min-height:36px;flex-wrap:nowrap;gap:7px;padding:0 0 7px;margin-bottom:8px;border-bottom:1px solid #edf1f4}
#fm-root .screen-muhasebe .muhmain .fispane > .tevpanel{order:2}
#fm-root .screen-muhasebe .muhmain .fispane > .twrap{order:3}
#fm-root .screen-muhasebe .muhmain .fispane > .docmeta{order:4}
#fm-root .screen-muhasebe .muhmain .fispane > .balance{order:5}
#fm-root .screen-muhasebe .muhmain .fispane > .wactions{order:6}
#fm-root .screen-muhasebe .phname{font-size:12px;font-weight:650;min-width:auto}
#fm-root .screen-muhasebe .ph .fifull{height:32px;border-radius:9px;border-color:#edc783;background:#fff8ec;color:#9a5d0a;font-size:12px;font-weight:650;padding:0 10px;box-shadow:0 1px 2px rgba(154,93,10,.08)}
#fm-root .screen-muhasebe .ph .fifull:hover{background:#b66b08;color:#fff;border-color:#b66b08}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom{grid-template-columns:repeat(3,minmax(0,1fr));margin:7px 0 0;padding:7px;background:#fff;border-color:#e4eaee;border-radius:8px;gap:6px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dmi,
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .psel .pselfield{height:28px;font-size:12px}
#fm-root .screen-muhasebe .muhmain .balance{min-height:30px;margin:6px 0 0;padding:5px 9px;border-radius:7px}
#fm-root .screen-muhasebe .muhmain .fispane > .wactions{margin-top:6px;padding-top:6px;min-height:34px}

/* Sağ muhasebe paneli belge yüksekliğinde kalır; çoklu kod satırları sadece orta bölümde kayar. */
#fm-root .screen-muhasebe .muhmain .fiseditor{min-height:0}
#fm-root .screen-muhasebe .muhmain .belgepane,
#fm-root .screen-muhasebe .muhmain .fispane{min-height:0}
#fm-root .screen-muhasebe .muhmain .fispane{
  display:flex;
  flex-direction:column;
  overflow:hidden;
  scrollbar-gutter:stable;
}
#fm-root .screen-muhasebe .muhmain .fispane > .ph,
#fm-root .screen-muhasebe .muhmain .fispane > .tevpanel,
#fm-root .screen-muhasebe .muhmain .fispane > .docmeta,
#fm-root .screen-muhasebe .muhmain .fispane > .balance,
#fm-root .screen-muhasebe .muhmain .fispane > .wactions{
  flex:0 0 auto;
  position:relative;
  top:auto;
  bottom:auto;
}
#fm-root .screen-muhasebe .muhmain .fispane > .twrap{
  flex:1 1 auto;
  min-height:0;
  overflow:auto;
  padding-right:2px;
  margin-right:-2px;
  border-radius:8px;
}
#fm-root .screen-muhasebe .muhmain .fgrps{gap:9px}
#fm-root .screen-muhasebe .muhmain .fgrp{border-radius:8px}
#fm-root .screen-muhasebe .muhmain .fgrp .fgh{padding:7px 10px}
#fm-root .screen-muhasebe .muhmain .fgrp .frow{padding:6px 9px}
#fm-root .screen-muhasebe .muhmain .fgrp .frowadd{padding:5px 10px}
#fm-root .screen-muhasebe .muhmain .fgrp .fgt{padding:6px 10px}

/* ===================== YENİ YAPISAL DİL (2026-06-29 baştan tasarım) ===================== */
/* Üst bağlam barı — mükellef + dönem seçimi belirgin, etiketli (sol kenardaki tekrar kaldırıldı) */
#fm-root .top{height:auto;min-height:62px;padding:11px 24px;background:#fff;border-bottom:1px solid var(--line);gap:16px;align-items:center;backdrop-filter:none;flex-wrap:wrap}
#fm-root .top .crumb{font-size:13.5px;font-weight:750;color:var(--text)}
#fm-root .top .crumb b{color:var(--text);font-weight:800}
#fm-root .ctxbar{display:flex;align-items:stretch;gap:10px}
#fm-root .ctxpick{display:flex;flex-direction:column;gap:3px}
#fm-root .ctxpick-l{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--faint);padding-left:3px}
#fm-root .ctxpick-f{display:flex;align-items:center;gap:7px;height:36px;padding:0 11px;border:1.5px solid var(--accent-line);background:var(--accent-soft);border-radius:9px;transition:border-color .12s,box-shadow .12s}
#fm-root .ctxpick-f:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#fm-root .ctxpick-f svg{color:var(--accent);flex-shrink:0;opacity:.85}
#fm-root .ctxpick-f select{border:none;background:transparent;font-size:13px;font-weight:700;color:var(--text);cursor:pointer;outline:none;min-width:148px;max-width:240px;font-family:inherit}
/* Kenar çubuğu marka bloğu */
#fm-root .brandrow{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:11px}
#fm-root .brandtx{text-align:center}
#fm-root .brandmk{width:38px;height:38px;border-radius:10px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:900;letter-spacing:.5px;flex-shrink:0;box-shadow:0 8px 18px -12px var(--accent)}
#fm-root .brandtx .brandlogo{font-family:'Kaushan Script',cursive;font-weight:400;font-size:44px;color:#1e3a8a;line-height:1.05;letter-spacing:.3px}
#fm-root .brandtx .brandmod{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:600;font-size:19px;color:var(--muted);letter-spacing:.3px;line-height:1.15;margin-top:3px}
#fm-root .brandtx .brandsub{font-size:10.5px;font-weight:600;color:var(--faint);letter-spacing:.2px;margin-top:2px}
/* İşlevsel filtre kutucukları — sayaç + filtre TEK satır (eski pasif kartlar + ayrı çipler birleşti) */
#fm-root .filttiles{display:flex;flex-wrap:wrap;gap:9px;margin:4px 0 16px}
#fm-root .ftile{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:108px;padding:11px 15px 10px 16px;border:1px solid var(--line);border-radius:12px;background:#fff;cursor:pointer;position:relative;overflow:hidden;text-align:left;transition:border-color .12s,box-shadow .12s,transform .08s,background .12s;box-shadow:0 1px 2px rgba(16,24,40,.05)}
#fm-root .ftile::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--tc,var(--accent));opacity:.9}
#fm-root .ftile:hover{border-color:var(--tc,var(--accent));transform:translateY(-1px);box-shadow:0 8px 18px -11px var(--tc,var(--accent))}
#fm-root .ftile.on{border-color:var(--tc,var(--accent));background:color-mix(in srgb,var(--tc,var(--accent)) 9%,#fff);box-shadow:inset 0 0 0 1px var(--tc,var(--accent))}
#fm-root .ftile .ftn{font-size:24px;font-weight:800;line-height:1;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.6px}
#fm-root .ftile .ftl{font-size:11px;font-weight:650;color:var(--muted);white-space:nowrap}
#fm-root .ftile.on .ftl{color:var(--tc,var(--accent));font-weight:750}
/* e-Fatura arka plan indirme sayacı (TÜRMOB) */
#fm-root .efdownbar{display:flex;align-items:center;gap:10px;margin:10px 0 2px;padding:9px 13px;border:1px solid var(--accent-line);background:var(--accent-soft);border-radius:10px;font-size:12.5px;color:var(--text)}
#fm-root .efdownbar .eftext{font-weight:600}
#fm-root .efdownbar .eftext b{font-weight:800;color:var(--accent)}
#fm-root .efdownbar .efspin{width:15px;height:15px;border-radius:50%;border:2px solid var(--accent-line);border-top-color:var(--accent);animation:efspin .7s linear infinite;flex-shrink:0}
#fm-root .efdownbar .eftrack{flex:1;min-width:80px;height:6px;border-radius:99px;background:var(--accent-line);overflow:hidden}
#fm-root .efdownbar .effill{display:block;height:100%;border-radius:99px;background:var(--accent);transition:width .4s ease}
#fm-root .efdownbar.import{border-color:#bbf7d0;background:#f0fdf4}
#fm-root .efdownbar.import .eftext b{color:#15803d}
#fm-root .efdownbar.import .efspin{border-color:#bbf7d0;border-top-color:#15803d}
#fm-root .efdownbar.import .eftrack{background:#bbf7d0}
#fm-root .efdownbar.import .effill{background:#15803d}
@keyframes efspin{to{transform:rotate(360deg)}}
/* ── Faturalar ekranı görsel yenileme (2026-06-30) — sayaç kartları + toolbar + başlık ── */
#fm-root .screen > .h2{font-size:23px;font-weight:800;letter-spacing:-.45px;color:#0d1626}
#fm-root .screen > .sub{font-size:13px;color:#67718a;margin-bottom:6px;line-height:1.5}
#fm-root .filttiles{gap:8px;margin:5px 0 11px}
#fm-root .ftile{flex-direction:row;align-items:center;gap:9px;min-width:auto;padding:7px 14px 7px 11px;border-radius:11px;border:1.5px solid color-mix(in srgb,var(--tc,var(--accent)) 26%,#eef1f6);background:color-mix(in srgb,var(--tc,var(--accent)) 7%,#fff);box-shadow:none;transition:transform .12s,box-shadow .14s,border-color .12s,background .12s}
#fm-root .ftile::before,#fm-root .ftile::after{display:none;content:none}
#fm-root .ftile .ftdot{width:9px;height:9px;border-radius:50%;background:var(--tc,var(--accent));flex-shrink:0}
#fm-root .ftile .fttx{display:flex;flex-direction:column;gap:2px;align-items:flex-start}
#fm-root .ftile .ftn{font-size:18px;font-weight:800;letter-spacing:-.4px;color:var(--tc,var(--accent));line-height:1}
#fm-root .ftile .ftl{font-size:11px;font-weight:700;color:color-mix(in srgb,var(--tc,var(--accent)) 58%,#475569)}
#fm-root .ftile:hover{transform:translateY(-2px);border-color:var(--tc,var(--accent));box-shadow:0 11px 22px -12px var(--tc,var(--accent))}
#fm-root .ftile.on{background:color-mix(in srgb,var(--tc,var(--accent)) 15%,#fff);border-color:var(--tc,var(--accent));box-shadow:inset 0 0 0 2px var(--tc,var(--accent))}
#fm-root .invactions{display:flex;align-items:center;gap:8px;padding:12px 16px;flex-wrap:wrap;background:#fff}
#fm-root .invactions h3{font-size:14px;font-weight:800;color:#0d1626;letter-spacing:-.2px;display:flex;align-items:baseline;gap:7px}
#fm-root .invactions .btn{height:38px;border-radius:10px;padding:0 15px;font-size:12.5px;font-weight:700;border:1px solid #e4eaf3;background:#fff;color:#34415a;box-shadow:0 1px 2px rgba(16,24,40,.05);transition:transform .12s,box-shadow .14s,background .14s,border-color .14s,filter .14s}
#fm-root .invactions .btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 9px 18px -11px rgba(16,24,40,.35)}
/* Yardımcı grup (Belge Yükle · Kodları düzelt) — nötr, sakin */
#fm-root .invactions .btn.upload{background:#fff;border-color:#dbe3ef;color:#334155}
#fm-root .invactions .btn.upload:hover:not(:disabled){border-color:var(--accent-line);color:var(--accent);background:var(--accent-soft)}
#fm-root .invactions .btn.fix{background:#fff;border-color:#dbe3ef;color:#334155}
/* Ana grup ayracı: "AI ile oku" öncesi ince dikey çizgi + boşluk */
#fm-root .invactions .btn.ai{margin-left:8px;position:relative}
#fm-root .invactions .btn.ai::before{content:'';position:absolute;left:-9px;top:7px;bottom:7px;width:1px;background:#e4eaf3}
/* AI ile oku — marka imzası (lacivert→petrol, sidebar ile uyumlu; mor kaldırıldı) */
#fm-root .invactions .btn.ai{background:linear-gradient(135deg,#123a6b 0%,#12717c 55%,#0d9488 100%);border:none;color:#fff;box-shadow:0 7px 16px -9px rgba(13,148,136,.65)}
#fm-root .invactions .btn.ai:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 13px 24px -10px rgba(13,148,136,.75)}
#fm-root .invactions .btn.primary{background:linear-gradient(135deg,#15803d,#1aa050);border:none;color:#fff;box-shadow:0 7px 16px -9px rgba(21,128,61,.7)}
#fm-root .invactions .btn.primary:hover:not(:disabled){filter:brightness(1.05);transform:translateY(-1px);box-shadow:0 13px 24px -10px rgba(21,128,61,.82)}
#fm-root .invactions .btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;transform:none}
/* ── Hesap Planı görsel yenileme: KOD büyük+net, butonlar, satır okunurluğu ── */
#fm-root .planwrap table{font-size:13px}
#fm-root .planwrap thead th{font-size:11px;padding:9px 13px;letter-spacing:.4px;color:#5a6678}
#fm-root .planwrap tbody td{padding:7px 13px;border-bottom:1px solid #eef1f6}
#fm-root .planwrap .hk{font-family:inherit;font-size:14px;font-weight:700;letter-spacing:0;color:#1e3a8a}
#fm-root .planhead .btn{height:36px;border-radius:10px;padding:0 15px;font-size:12.5px;font-weight:700;transition:background .14s,border-color .14s,filter .14s,box-shadow .14s}
#fm-root .planhead .btn.ghost{background:#fff;border:1px solid #cfe3d6;color:#15803d;box-shadow:0 1px 2px rgba(16,24,40,.04)}
#fm-root .planhead .btn.ghost:hover:not(:disabled){background:#eef7f1;border-color:#a9d4ba}
#fm-root .planhead .btn.primary{background:#15803d;border-color:#15803d;color:#fff;box-shadow:0 8px 16px -10px rgba(21,128,61,.55)}
#fm-root .planhead .btn.primary:hover:not(:disabled){filter:brightness(.95)}
#fm-root .planhead .btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
/* ── Entegratör: ekleme formu "Ekle" butonu arkasında ── */
#fm-root .entadd{height:40px;border-radius:11px;padding:0 18px;font-size:13px;font-weight:700;background:var(--accent);border:1px solid var(--accent);color:#fff;box-shadow:0 8px 18px -10px var(--accent)}
#fm-root .entadd:hover{filter:brightness(.96)}
#fm-root .entadd .entplus{font-size:17px;line-height:1;margin-right:5px;font-weight:400}
#fm-root .entaddhead{display:flex;align-items:center;justify-content:space-between}
#fm-root .entclose{background:none;border:none;color:var(--muted);font-size:12px;font-weight:700;cursor:pointer;padding:4px 8px;border-radius:6px}
#fm-root .entclose:hover{color:var(--text);background:#f1f4f9}
/* ── Mükellef/Dönem özel dropdown (profesyonel açılır liste) ── */
#fm-root .fmdd{position:relative}
#fm-root .fmdd-btn{display:flex;align-items:center;gap:7px;height:36px;padding:0 11px;border:1.5px solid var(--accent-line);background:var(--accent-soft);border-radius:9px;cursor:pointer;font-family:inherit;transition:border-color .12s,box-shadow .12s}
#fm-root .fmdd-btn:hover{border-color:var(--accent)}
#fm-root .fmdd.open .fmdd-btn{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 14%,transparent)}
#fm-root .fmdd-btn > svg:first-child{color:var(--accent);flex-shrink:0;opacity:.85}
#fm-root .fmdd-val{flex:1;text-align:left;font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .fmdd-chev{color:var(--accent);flex-shrink:0;transition:transform .15s}
#fm-root .fmdd.open .fmdd-chev{transform:rotate(180deg)}
#fm-root .fmdd-pop{position:absolute;top:calc(100% + 6px);right:0;min-width:248px;max-width:360px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 42px -16px rgba(16,24,40,.34),0 4px 12px -8px rgba(16,24,40,.18);z-index:60;overflow:hidden;animation:fmddin .12s ease}
@keyframes fmddin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
#fm-root .fmdd-search{display:flex;align-items:center;gap:7px;padding:9px 11px;border-bottom:1px solid var(--line)}
#fm-root .fmdd-search svg{color:var(--faint);flex-shrink:0}
#fm-root .fmdd-search input{border:none;outline:none;background:none;font-size:13px;font-family:inherit;color:var(--text);width:100%}
#fm-root .fmdd-list{max-height:330px;overflow:auto;padding:6px}
#fm-root .fmdd-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:8px 10px;border:none;background:none;border-radius:8px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit;line-height:1.3}
#fm-root .fmdd-opt:hover{background:var(--accent-soft)}
#fm-root .fmdd-opt.on{background:var(--accent-soft);color:var(--accent);font-weight:700}
#fm-root .fmdd-optl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .fmdd-ok{color:var(--accent);flex-shrink:0}
#fm-root .fmdd-empty{padding:14px 12px;text-align:center;color:var(--faint);font-size:12.5px}
/* ── Takvim tarzı dönem seçici (yıl + ay kutusu) ── */
#fm-root .fmper-pop{min-width:250px;padding:11px}
#fm-root .fmper-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
#fm-root .fmper-y{font-size:15px;font-weight:800;color:var(--text);letter-spacing:.4px}
#fm-root .fmper-nav{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--accent);font-size:19px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .12s,border-color .12s}
#fm-root .fmper-nav:hover:not(:disabled){background:var(--accent-soft);border-color:var(--accent-line)}
#fm-root .fmper-nav:disabled{opacity:.32;cursor:not-allowed}
#fm-root .fmper-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
#fm-root .fmper-m{height:42px;border-radius:9px;border:1px solid var(--line);background:#fff;font-size:13px;font-weight:700;color:var(--text);cursor:pointer;transition:background .12s,border-color .12s,color .12s,box-shadow .12s}
#fm-root .fmper-m:hover:not(:disabled){border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
#fm-root .fmper-m.sel{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 6px 14px -8px var(--accent)}
#fm-root .fmper-m:disabled{opacity:.3;cursor:not-allowed}
/* ── Sol panel (nav) yenileme: biraz büyük yazı + hover'da büyüme/renk ── */
#fm-root .ncap{font-size:10.5px}
#fm-root .nitem{font-size:14px;font-weight:700;padding:9px 10px;transition:background .14s,color .14s,transform .13s,box-shadow .14s}
#fm-root .nitem > span:first-child{transition:transform .14s,color .12s,background .12s,border-color .12s}
#fm-root .nitem:hover:not(.on){color:var(--accent);transform:translateX(2px)}
#fm-root .nitem:hover:not(.on) > span:first-child{transform:scale(1.08)}
#fm-root .nsub{font-size:13.5px;font-weight:600;transition:color .14s,transform .13s}
#fm-root .nsub:hover:not(.on){color:var(--accent);transform:translateX(2px)}
/* ── Muhasebeleştir ekranı cilalama: üst butonlar aktif, zoom renkli, bölüm tonları, rakamlar ── */
#fm-root .navb{width:28px;height:28px;border-radius:8px;border:1px solid var(--accent-line);background:var(--accent-soft);color:var(--accent);font-size:17px;transition:background .12s,color .12s,border-color .12s}
#fm-root .navb:hover:not(:disabled){background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .navb:disabled{opacity:.4;cursor:not-allowed}
#fm-root .navpos{font-size:12px;font-weight:700;color:var(--text);min-width:42px}
#fm-root .phname{font-size:13px;font-weight:800;color:#0e1726;letter-spacing:-.2px}
#fm-root .muhfilter{height:30px;border:1px solid var(--accent-line);background:var(--accent-soft);border-radius:9px;padding:3px}
#fm-root .muhfilter button{height:24px;border-radius:7px;color:var(--accent);font-size:11.5px;font-weight:800;padding:0 11px;transition:background .12s,color .12s}
#fm-root .muhfilter button.on{background:var(--accent);color:#fff;box-shadow:0 5px 12px -7px var(--accent)}
#fm-root .muhfilter b{font-weight:900;margin-left:4px}
#fm-root .fifull{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 13px;border-radius:9px;border:1px solid #f0c878;background:#fff8ec;color:#a85d08;font-size:12px;font-weight:800;cursor:pointer;transition:background .12s,border-color .12s}
#fm-root .fifull:hover{background:#fdeecf;border-color:#e3a948}
#fm-root .zbtn{min-width:32px;height:30px;border:1px solid var(--accent-line);background:var(--accent-soft);color:var(--accent);border-radius:8px;font-weight:700;transition:background .12s,color .12s,border-color .12s}
#fm-root .zbtn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .zbtn.zreset{font-size:12px;font-weight:700;padding:0 12px}
#fm-root .fgrp{border-radius:11px}
#fm-root .fgrp .fgh{padding:7px 12px;font-size:12.5px;font-weight:800;letter-spacing:-.1px}
#fm-root .fgrp .fgh .fgs{font-size:9.5px;font-weight:800;opacity:.8}
/* GRUP RENKLERİ — kurumsal uyumlu aile (marka lacivert-petrol + altın; aynı doygunluk/açıklıkta
   dört ton, takım gibi görünsün — kullanıcı: "renkler hoşuma gitmiyor, uyumlu yap"):
   Matrah=lacivert · İndirilecek KDV=altın · Tevkifat=petrol · Cari=derin yeşil */
#fm-root .fgrp[data-g="matrah"]{border-color:#cdd9e5}
#fm-root .fgrp[data-g="matrah"] .fgh{background:#eef4f9;color:#1f4e79}
#fm-root .fgrp[data-g="vergi"]{border-color:#e4d7ba}
#fm-root .fgrp[data-g="vergi"] .fgh{background:#faf4e4;color:#8a6410}
#fm-root .fgrp[data-g="cari"]{border-color:#cfe2d4}
#fm-root .fgrp[data-g="cari"] .fgh{background:#eef7f0;color:#2f6b46}
#fm-root .fgrp[data-g="tevkifat"]{border-color:#e3ccd2}
#fm-root .fgrp[data-g="tevkifat"] .fgh{background:#f8eef1;color:#8a3341}
/* KDV RAPORU özet kartları — tasarım imzası: sol renk şeridi + DOYGUN degrade + renkli değer
   (kullanıcı: "sayaçları biraz daha renklendirelim"). Her kartın kenarı ve tutarı kendi ailesinde. */
#fm-root .kdvstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px;margin:12px 0 14px}
#fm-root .kdvst{position:relative;border-radius:12px;padding:11px 14px 9px 17px;border:1px solid var(--kb,#c9d2da);background:#fff;overflow:hidden;box-shadow:0 1px 3px rgba(16,42,67,.06)}
#fm-root .kdvst::before{content:'';position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--ks,#94a3b8)}
#fm-root .kdvst .kl{font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--ks,#475569);line-height:1.25}
#fm-root .kdvst .kv{font-size:21px;font-weight:800;margin-top:4px;color:var(--kv,#1c2733);font-variant-numeric:tabular-nums}
#fm-root .kdvst .ka{font-size:10.5px;color:#7c8794;margin-top:3px;font-weight:600}
#fm-root .kdvst-hes{--ks:#1f4e79;--kb:#b9d2ea;--kv:#1f4e79;background:linear-gradient(135deg,#dcebfa,#f6fafd 60%)}
#fm-root .kdvst-ind{--ks:#9a6d06;--kb:#e0ca8e;--kv:#7c5a0a;background:linear-gradient(135deg,#f7ecc9,#fdf9ec 60%)}
#fm-root .kdvst-frk{--ks:#475569;--kb:#c2cedb;--kv:#334155;background:linear-gradient(135deg,#e5ebf2,#f8fafc 60%)}
#fm-root .kdvst-dev{--ks:#0d6b66;--kb:#a3d4cf;--kv:#0b5f5a;background:linear-gradient(135deg,#d3ecea,#f0faf9 60%)}
#fm-root .kdvst-son{--ks:#15803d;--kb:#a5dcba;--kv:#15803d;background:linear-gradient(135deg,#d4f1de,#f0fbf4 60%)}
#fm-root .kdvst-ode{--ks:#b02a37;--kb:#e8b3b8;--kv:#b02a37;background:linear-gradient(135deg,#f9dcdf,#fdf2f3 60%)}
#fm-root .kdvst-bel{--ks:#5b6b7c;--kb:#c6cfd8;--kv:#42505f;background:linear-gradient(135deg,#e6ebf0,#f7f9fa 60%)}
/* Katlanır tevkifat başlığı: tıklanır + ok (açıkken yukarı döner). */
#fm-root .fgrp .fgh.fgh-tgl{cursor:pointer;user-select:none}
#fm-root .fgrp .fgh.fgh-tgl:hover{filter:brightness(.97)}
#fm-root .fgrp .fgh .fgchev{display:inline-block;margin-left:7px;font-size:13px;line-height:1;transition:transform .15s;transform:translateY(-1px)}
#fm-root .fgrp .fgh .fgchev.up{transform:rotate(180deg) translateY(-2px)}
/* TEK EKRAN: fiş paneli dikeyde sıkılaştırıldı — kaydırmadan sığsın (ne sıkışık ne gevşek). */
#fm-root .muhmain .fgrps{gap:5px}
#fm-root .muhmain .fgrp .fgh{padding:3px 8px;font-size:11px}
#fm-root .muhmain .fgrp .frow{padding:3px 8px}
#fm-root .muhmain .fgrp .frow .li{height:24px}
#fm-root .muhmain .fgrp .frowadd{padding:2px 8px;font-size:11px}
#fm-root .muhmain .fgrp .fgt{padding:3px 8px;font-size:11.5px}
#fm-root .muhmain .docmeta{margin:6px 0;padding:6px;gap:4px 8px}
#fm-root .muhmain .docmeta .dmi,#fm-root .muhmain .docmeta .psel .pselfield{height:25px;font-size:12px}
#fm-root .fgrp .frow .money{font-size:13.5px;font-weight:600;letter-spacing:-.1px;color:#1f2a3c}
#fm-root .fgrp .fgt{padding:6px 12px;font-size:12.5px}
#fm-root .fgrp .fgt b{font-size:13.5px;font-weight:700;color:#0e1726;letter-spacing:-.1px}
/* ── Renk/tipografi yenileme: nötr seçiciler + ince başlıklar (accent petrol/zümrüt) ── */
#fm-root .fmdd-btn{border:1.5px solid #dfe4ec;background:#fff}
#fm-root .fmdd-btn:hover{border-color:#c4cdda}
#fm-root .fmdd.open .fmdd-btn{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 13%,transparent)}
#fm-root .fmdd-btn > svg:first-child{color:#7a8699;opacity:1}
#fm-root .fmdd-chev{color:#9aa6b6}
#fm-root .ctxpick-l{color:#94a0b2}
#fm-root .h2,#fm-root .screen > .h2{font-weight:600;letter-spacing:-.3px;color:#1b2532}
#fm-root .crumb{font-weight:600;color:#46515f}
#fm-root .crumb b{font-weight:700;color:#1b2532}
/* ── 2026-07-10 revizyon: sidebar tek ekrana sığar, marka bloğu lacivert-petrol degrade,
   "Portala Dön" ikon-buton, e-Fatura/e-Arşiv sorgu tarih aralığı kartı ── */
/* Sidebar: tek ekrana sigar (100vh sticky, nav kendi icinde kayar) */
#fm-root .side{height:100vh;position:sticky;top:0;overflow:hidden}
#fm-root .nav{flex:1;min-height:0;overflow:auto;padding:10px 12px 14px}
/* KOMPLE sol sutun koyu lacivert→petrol degrade + BUYUK marka blogu */
#fm-root .side{background:linear-gradient(168deg,#0e2a58 0%,#123a74 46%,#0d7d73 122%);border-right:1px solid rgba(9,22,50,.55);box-shadow:2px 0 20px -14px rgba(9,22,50,.7)}
#fm-root .app > .side{background:linear-gradient(168deg,#0e2a58 0%,#123a74 46%,#0d7d73 122%)}
#fm-root .brand{position:relative;padding:14px 14px 12px;border-bottom:1px solid rgba(255,255,255,.13);background:transparent}
#fm-root .brand::after{content:none}
#fm-root .brandrow{margin-top:2px}
#fm-root .brandtx .brandlogo{font-size:47px;line-height:1;color:#fff;text-shadow:0 2px 16px rgba(3,14,38,.5)}
#fm-root .brandtx .brandmod{font-size:17px;color:#bcd6e0;margin-top:4px;font-style:italic}
#fm-root .backlink{position:absolute;top:12px;left:12px;margin:0;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;color:#eaf2f6;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.24);opacity:1}
#fm-root .backlink:hover{background:rgba(255,255,255,.28);color:#fff}
/* Bolum basliklari + menu ogeleri koyu zemine gore acildi (rahat aralikli) */
#fm-root .ncap{color:rgba(206,226,238,.58);padding:9px 10px 4px}
#fm-root .nitem{color:#d7e4ef;padding:8px 10px;margin-bottom:2px;font-size:13px}
#fm-root .nitem:hover{background:rgba(255,255,255,.10);color:#fff}
/* Betimleme: her modulun kendi rengi (--icc) koyu zeminde parlak "chip" olarak korunur */
#fm-root .nitem > span:first-child{width:28px;height:28px;color:#fff;background:color-mix(in srgb,var(--icc,#9fb2c9) 82%,#0a1f42);border:1px solid color-mix(in srgb,var(--icc,#9fb2c9) 55%,#fff)}
#fm-root .nitem.on{background:rgba(255,255,255,.15);color:#fff;box-shadow:inset 3px 0 0 #5eead4}
#fm-root .nitem.on > span:first-child{background:#5eead4;color:#0e2a58;border-color:#5eead4;box-shadow:none}
#fm-root .nitem .ct{background:rgba(255,255,255,.22);color:#fff}
#fm-root .nitem.on .ct{background:#fff;color:#0e2a58}
#fm-root .nsub{color:rgba(203,223,236,.82);padding:5px 11px 5px 40px}
#fm-root .nsub:hover{background:rgba(255,255,255,.08);color:#fff}
#fm-root .nsub.on{color:#5eead4;font-weight:700}
#fm-root .nsub .d{opacity:.65}
#fm-root .daterange{display:flex;align-items:center;gap:12px;padding:9px 14px;margin-bottom:10px;flex-wrap:wrap;border:1px solid #e5e7eb}
#fm-root .daterange .drlabel{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
#fm-root .daterange .drlabel svg{color:var(--accent)}
#fm-root .daterange .drio{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:3px 10px;transition:border-color .15s,box-shadow .15s}
#fm-root .daterange .drio:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);background:#fff}
#fm-root .daterange .dmi{height:29px;border:none;background:transparent;font:inherit;font-size:12.5px;font-weight:600;color:var(--text);outline:none;cursor:pointer}
#fm-root .daterange .drsep{color:#94a3b8;font-weight:700}
#fm-root .daterange .drmsg{font-size:12px;font-weight:600;padding:4px 10px;border-radius:8px}
#fm-root .daterange .drmsg.err{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca}
#fm-root .daterange .drmsg.warn{color:#92400e;background:#fffbeb;border:1px solid #fde68a}
#fm-root .daterange .drmsg.hint{color:#8a6a1f;background:#fffdf5;border:1px solid #f3e7c4}

/* ═══════════ MUHASEBE FİŞ — GÖRSEL CİLA v2 (sade / nötr / rafine) ═══════════
   Kullanıcı: v1 fazla renkliydi, daha kaliteli olsun. Renk şeritleri KALDIRILDI; nötr slate
   palet + tipografi hiyerarşisi + ferah boşluk + tabular hizalı rakamlar. Yapı/mantık AYNEN.
   BEĞENİLMEZSE bu blok SİLİNİR → birebir eski hale döner. */
#fm-root .muhmain .fgrps{gap:9px}
#fm-root .muhmain .fgrp{position:relative;background:#fff;border:1px solid #e8ebf1;border-radius:13px;box-shadow:0 1px 2px rgba(15,23,42,.035);overflow:hidden;padding:0}
#fm-root .muhmain .fgrp::before{content:none !important}
#fm-root .muhmain .fgrp[data-g]{border-left:1px solid #e8ebf1}
/* başlık: küçük uppercase, sakin (kompakt) */
#fm-root .muhmain .fgh{padding:10px 15px 8px;background:#fff;border-bottom:1px solid #f1f3f8;display:flex;align-items:center;gap:8px}
#fm-root .muhmain .fgh > *:first-child{font-size:11px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:#3b4759}
#fm-root .muhmain .fgs{margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.9px;padding:2px 8px;border-radius:6px;background:#f4f6fa;color:#8a97ab;text-transform:uppercase}
/* satır: ferah ama kompakt */
#fm-root .muhmain .frow{padding:9px 15px;gap:12px;align-items:center;border-bottom:1px solid #f6f7fb}
#fm-root .muhmain .frow:hover{background:#fbfcfe}
/* rakam: tabular, koyu, sıkı */
#fm-root .muhmain .money{font-variant-numeric:tabular-nums;font-weight:600;color:#111a2b;letter-spacing:-.2px}
/* toplam: sade, İNCE (kullanıcı: fazla kalındı) + kompakt padding (kart sığsın) */
#fm-root .muhmain .fgt{padding:8px 15px;background:#fbfcfe;border-top:1px solid #f1f3f8;font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#9aa6b8}
#fm-root .muhmain .fgt b{font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;color:#1c2740;letter-spacing:-.2px;text-transform:none}
/* + satır: minimal, ikincil */
#fm-root .muhmain .frowadd{padding:8px 15px;color:#98a3b6;font-weight:600;font-size:11.5px;background:transparent;border-top:1px solid #f6f7fb}
#fm-root .muhmain .frowadd:hover{color:#475569;background:#fafbfd}
#fm-root .muhmain .frowdel{opacity:.4;transition:opacity .15s,color .15s}
#fm-root .muhmain .frowdel:hover{opacity:1;color:#dc2626}
/* ═══════════ /MUHASEBE FİŞ GÖRSEL CİLA v2 ═══════════ */

/* e-Arşiv "Faturalar çekiliyor" belirgin animasyonlu gösterge (kullanıcı: şerit çıksın) */
#fm-root .sourcepanel.isbusy{position:relative}
#fm-root .sourcepanel.isbusy::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent 0%,#0891b2 50%,transparent 100%);background-size:45% 100%;background-repeat:no-repeat;animation:fmshimmer 1.15s linear infinite;z-index:6;border-radius:12px 12px 0 0}
@keyframes fmshimmer{0%{background-position:-45% 0}100%{background-position:145% 0}}
#fm-root .qspin{width:12px;height:12px;border:2px solid rgba(8,145,178,.28);border-top-color:#0891b2;border-radius:50%;display:inline-block;animation:fmspin .7s linear infinite;flex:none}
@keyframes fmspin{to{transform:rotate(360deg)}}
/* e-Arşiv liste tablosu: tutar sütunları dolunca sıkışıp başlıklar iç içe giriyordu (GENEL TOPLAM↔ONAY).
   Kompakt font + tek-satır başlık/hücre → sütunlar ayrık kalır; ad sütunu normal sarar. */
#fm-root .earsivtable{font-size:12px}
#fm-root .earsivtable th,#fm-root .earsivtable td{padding:9px 10px;white-space:nowrap;vertical-align:middle}
#fm-root .earsivtable th{font-size:10px;letter-spacing:.3px}
#fm-root .earsivtable td.partyname,#fm-root .earsivtable th:nth-child(2){white-space:normal;min-width:120px;max-width:200px}
#fm-root .earsivtable td.num,#fm-root .earsivtable th.num{text-align:right}
/* ── Muhasebeleştir TAM-EKRAN fiş: HEPSİ TEK EKRANA SIĞSIN (kullanıcı 2026-08-11: cari altındaki
   TOPLAM görünmüyor, scroll gerekiyor). Dikey boşlukları sıkılaştır — bölüm aralığı + başlık/satır/
   toplam/+satır padding'leri + meta alanları + Denge. En sonda tanımlı → en yüksek öncelik. ── */
/* Not (2026-08-11 v2): ilk sıkıştırma FAZLA sıkıydı (TEVKİFAT↔CARİ iç içe, altta boşluk). Bölüm araları
   açıldı + meta/Denge/butonlar arası nefes verildi → içerik ekrana YAYILIP dolsun ama yine tek ekrana sığsın. */
/* ⚠️ KRİTİK (DOM incelemesi): fispane `overflow:hidden` idi → içerik kısa ekranda KIRPILIP kayboluyordu
   (CARİ TOPLAM). auto yapıldı → kırpma yerine KAYDIRMA; hiçbir şey kaybolmaz. + içerik bir tık kısaltıldı. */
#fm-root .screen-muhasebe .muhmain .fispane{overflow-y:auto}
#fm-root .screen-muhasebe .muhmain .fgrps{gap:9px}
#fm-root .screen-muhasebe .muhmain .fgrp .fgh{padding:6px 13px 4px}
#fm-root .screen-muhasebe .muhmain .fgrp .frow{padding:5px 13px;gap:10px}
#fm-root .screen-muhasebe .muhmain .fgrp .fgt{padding:4px 13px}
#fm-root .screen-muhasebe .muhmain .fgrp .frowadd{padding:3px 13px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom{margin:9px 0 0;padding:6px 7px;gap:5px 8px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dm{gap:1px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dmi,#fm-root .screen-muhasebe .muhmain .docmeta-bottom .psel .pselfield{height:26px}
#fm-root .screen-muhasebe .muhmain .balance{min-height:0;margin:8px 0 0;padding:6px 11px}
#fm-root .screen-muhasebe .muhmain .wactions{margin-top:8px}
/* ── DAR EKRAN (<1100px) — kullanıcı bulgusu: CARİ altındaki TOPLAM görünmüyordu. Sebep: panel dar ekranda
   da İÇ KAYDIRMA (height:100%/overflow:auto) + YAPIŞKAN footer → son bölümün toplamı footer'ın altında
   kırpılıyordu. Dar ekranda panel DOĞAL AKAR (iç kaydırma yok, footer/başlık yapışmaz) → hiçbir şey kırpılmaz,
   tüm bölümler + toplamlar görünür (gerekirse SAYFA kaydırılır, ama kırpma OLMAZ). ── */
@media(max-width:1100px){
  #fm-root .screen-muhasebe .muhmain{height:auto;min-height:0}
  #fm-root .screen-muhasebe .muhmain .fiseditor{height:auto;min-height:0}
  #fm-root .screen-muhasebe .muhmain .fispane{height:auto;min-height:0;max-height:none;overflow:visible}
  #fm-root .screen-muhasebe .muhmain .fispane > .ph{position:static}
  #fm-root .screen-muhasebe .muhmain .fispane > .wactions{position:static;background:none}
}
`;
