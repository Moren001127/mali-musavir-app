'use client';

import { useState, useRef, useEffect, useMemo, Fragment, type KeyboardEvent, type MouseEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isletmeRef, ISLETME_ISLEM_TURU, ISLETME_KDV_ORAN, defaultBelgeTuruKod, normalizeDocumentType, getKayitAltList, defaultKayitAltKod, kayitAltKisaAd, isletmeAutoKayitTuru, isletmeAutoKayitAltKod, KURUM_TURU_SECENEKLERI, DEFTER_TURU_ETIKETLERI, kurumTuruEtiketi } from '@mali-musavir/shared';

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
/** AI BEKÇİSİ BANDI (2026-09-15): birim maliyet bekçisi otomatik kuyruğu duraklattıysa üstte tek satır uyarı + "Devam et". */
function AiBekciBandi() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['fm-ai-bekci'],
    queryFn: () => api.get('/fatura-muhasebelestirme/ai-bekci').then((r) => r.data),
    refetchInterval: 60000,
    retry: false,
  });
  const devam = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/ai-bekci/devam').then((r) => r.data),
    onSuccess: () => { toast.success('AI kuyruğu devam ettirildi'); qc.invalidateQueries({ queryKey: ['fm-ai-bekci'] }); },
    onError: () => toast.error('Devam ettirilemedi'),
  });
  const d: any = q.data;
  if (!d?.durduruldu) return null;
  const bitis = d.bitis ? new Date(d.bitis).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div style={{ margin: '0 0 10px', padding: '10px 14px', borderRadius: 10, border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.10)', color: '#92400e', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <b>AI bekçisi otomatik kuyruğu duraklattı</b>
      <span style={{ flex: 1, minWidth: 240 }}>{String(d.neden || '')}{bitis ? ` · kendiliğinden ${bitis}'de açılır` : ''}. Belgeler kaybolmadı, bekliyor. Model/düşünme ayarını kontrol edin.</span>
      <button type="button" disabled={devam.isPending} onClick={() => devam.mutate()} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #b45309', background: '#fff', color: '#92400e', fontWeight: 700, cursor: 'pointer' }}>
        {devam.isPending ? 'Açılıyor…' : 'Devam et'}
      </button>
    </div>
  );
}

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
  // OKUNMADI (HAM) — Faz 0 (PLAN/15): belge içeriği hiç okunmadı/sınıflanmadı → "Kod eksik"ten AYRI sayılır.
  //   • Aktar yalnız belgeyi koydu (ocrData.matchDeferred) ya da
  //   • entegratör (provider-api) belgesi: readMode/engine boş + hiç sınıflandırma (giderTuru/matrahKategori) yok.
  //   Kodları tam olan ham belge yine "Eşleşti" sayılır (kural eşleştirmesi yapılmış); yalnız boş kodlu /
  //   satırsız ham belge "Okunmadı (ham)" olur → doğru eylem "AI ile oku"dur, elle kod atamak değil.
  const od: any = doc.ocrData || {};
  const hamOkuma = od.matchDeferred === true
    || (!od.readMode && !od.engine && od.source === 'provider-api' && !od.giderTuru && !od.matrahKategori);
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
    const rateLineCount = lines.filter((l: any) => ['matrah', 'vergi', 'vergi-sorumlu', 'diger_vergi'].includes(String(l.group || ''))).length;
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
  const nonAmountIssues = issues.filter((i: any) => i?.code && i?.severity !== 'WARNING' && i?.severity !== 'INFO'
    && !['INCOMPLETE_AMOUNTS', 'TOTAL_MISMATCH', 'BALANCE_MISMATCH'].includes(i.code)
    && !(i.code === 'RETURN_NEEDS_REVERSAL' && hasReturnLine));
  // Faz 2 (PLAN/15) — TEK UYARI MODELİ: ocrData.uyarilar[] {kod, seviye: bilgi|uyari|engel, ...}.
  //   MUKERRER (engel) → onay/Luca engelli; DEMIRBAS karar verilmemiş → "Karar bekliyor" (kilit değil, mor kutu).
  const uyOzet = uyariOzetFE(od.uyarilar);
  if (uyOzet.mukerrer) return { k: 'miss', t: 'Mükerrer — engel', cat: 'mukerrer' };
  // DEMİRBAŞ (sabit kıymet) alış/satışı: sahip kararı bekler ("Luca'da elle işledim → kapat" / "yine de işle").
  //   Karar verildiyse (yine_de_isle) belge normal akışa döner. "Çelişki"den AYRI/ÖNCE göster.
  if (uyOzet.kararBekliyor || (issues.some((i: any) => i?.code === 'FIXED_ASSET_MANUAL') && !uyOzet.demirbasKarar)) return { k: 'asset', t: 'Demirbaş — karar bekliyor', cat: 'demirbas' };
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
    if (hamOkuma) return { k: 'ham', t: 'Okunmadı (ham)', cat: 'ham' };
    return { k: 'warn', t: ready.reason || 'Eşleşmedi', cat: 'incele' };
  }
  // Hiç satır yok → ham (Aktar sadece) ise "Okunmadı (ham)", değilse matrah/KDV okunamamış.
  if (!lines.length) return hamOkuma ? { k: 'ham', t: 'Okunmadı (ham)', cat: 'ham' } : { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
  // Hangi grupların KODU boş? (cari hesap / gelir-gider / KDV) — tam söyle.
  const sale = (doc.invoiceKind || 'ALIS') === 'SATIS';
  const blank = (g: string) => { const gl = lines.filter((l: any) => String(l.group || '') === g); return gl.length > 0 && gl.some((l: any) => !l.accountCode); };
  const missing: string[] = [];
  if (blank('cari')) missing.push('cari hesap');
  if (blank('matrah')) missing.push(sale ? 'gelir kodu' : 'gider kodu');
  if (blank('vergi')) missing.push('KDV kodu');
  if (blank('vergi-sorumlu')) missing.push('sorumlu sıf. KDV hesabı');
  if (blank('tevkifat')) missing.push('tevkifat 360 hesabı');
  if (blank('diger_vergi')) missing.push('KDV dışı vergi hesabı');
  if (missing.length) {
    // Ham belgede boş kod "Kod eksik" değil "Okunmadı (ham)"dır — önce okunmalı.
    if (hamOkuma) return { k: 'ham', t: 'Okunmadı (ham)', cat: 'ham' };
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
// ── Faz 2 (PLAN/15) — UYARI KATMANI (frontend yardımcıları) ──
//   Backend tek model: {kod, seviye: bilgi|uyari|engel, baslik, aciklama, oneri?, eylemler?, meta?}; eski kayıtlar
//   {kod, baslik, mesaj, siddet} da gelebilir → burada normalize edilir. Renk dili: bilgi gri-mavi, uyarı amber,
//   engel kırmızı, DEMİRBAŞ karar bekliyor mor.
type UyariFE = { kod: string; seviye: 'bilgi' | 'uyari' | 'engel'; baslik: string; aciklama: string; oneri?: string; eylemler?: Array<{ id: string; etiket: string }>; meta?: any };
function uyariNormalizeFE(u: any): UyariFE | null {
  if (!u || !u.kod) return null;
  const sid = String(u.siddet || '').toLowerCase();
  const seviye: UyariFE['seviye'] = u.seviye === 'engel' || u.seviye === 'uyari' || u.seviye === 'bilgi' ? u.seviye : sid === 'hata' ? 'engel' : sid === 'uyari' ? 'uyari' : 'bilgi';
  return { kod: String(u.kod), seviye, baslik: String(u.baslik || u.kod), aciklama: String(u.aciklama ?? u.mesaj ?? ''), oneri: u.oneri || undefined, eylemler: Array.isArray(u.eylemler) ? u.eylemler : undefined, meta: u.meta || undefined };
}
function uyariListeFE(raw: any): UyariFE[] {
  return (Array.isArray(raw) ? raw : []).map(uyariNormalizeFE).filter(Boolean) as UyariFE[];
}
function uyariOzetFE(raw: any): { engel: boolean; kararBekliyor: boolean; demirbasKarar: string | null; tevkifatli: boolean; mukerrer: boolean; adet: number } {
  const list = uyariListeFE(raw);
  const dem = list.find((u) => u.kod === 'DEMIRBAS');
  return {
    engel: list.some((u) => u.seviye === 'engel'),
    kararBekliyor: !!dem && !dem.meta?.karar,
    demirbasKarar: dem?.meta?.karar || null,
    tevkifatli: list.some((u) => u.kod === 'TEVKIFAT_VAR'),
    mukerrer: list.some((u) => u.kod === 'MUKERRER'),
    adet: list.length,
  };
}
/** Belgede tevkifat var mı (uyarı çipi ya da ocrData tevkifat verisi) — "Seçilenleri onayla" ayrı grup için. */
function docTevkifatliFE(d: any): boolean {
  const od: any = d?.ocrData || {};
  if (uyariOzetFE(od.uyarilar).tevkifatli) return true;
  return Number(od.tevkifatOrani || 0) > 0 || Number(od.tevkifatKdv || od.kdvTevkifat || 0) > 0;
}
const UYARI_RENK: Record<string, { fg: string; bg: string; bd: string }> = {
  bilgi: { fg: '#3b5b8a', bg: '#eef2f8', bd: '#c9d6ea' },
  uyari: { fg: '#b45309', bg: '#fff5e6', bd: '#f4d19b' },
  engel: { fg: '#c0353a', bg: '#fdeaea', bd: '#f0b9b9' },
  karar: { fg: '#7c3aed', bg: '#f3e8ff', bd: '#e3d4fb' },
};
function uyariRenkFE(u: UyariFE) {
  if (u.kod === 'DEMIRBAS' && !u.meta?.karar) return UYARI_RENK.karar;
  return UYARI_RENK[u.seviye] || UYARI_RENK.bilgi;
}
function uyariKisaFE(u: UyariFE): string {
  if (u.kod === 'DEMIRBAS') return u.meta?.satisFisEksik ? 'Demirbaş — fiş eksik' : u.meta?.karar ? 'Demirbaş ✓' : 'Karar bekliyor';
  if (u.kod === 'TEVKIFAT_VAR') return u.seviye === 'engel' && !u.meta?.oranMetni ? 'Tevkifat — oran?' : `Tevkifatlı${u.meta?.oranMetni ? ' ' + u.meta.oranMetni : ''}${u.meta?.kod ? ' · ' + u.meta.kod : ''}`;
  if (u.kod === 'TEVKIFAT_EKSIK') return u.meta?.aliciKdvMukellefiSoru ? 'Alıcı KDV mük.?' : u.meta?.digerHizmet216 ? 'Tevkifat 216?' : `Tevkifat eksik?${u.meta?.oran ? ' ' + u.meta.oran : ''}`;
  if (u.kod === 'MUKERRER') return 'Mükerrer';
  if (u.kod === 'ALICI_TIPI_GEREKLI') return 'Alıcı tipi?';
  if (u.kod === 'ICERIK_HESAP_UYUMSUZ') return 'İçerik↔hesap';
  if (u.kod === 'TUTAR_TUTARSIZ') return 'Tutar tutarsız';
  if (u.kod === 'IADE') return 'İade';
  if (u.kod === 'IPTAL') return 'İptal/taslak';
  if (u.kod === 'KKEG_SUPHESI') return 'KKEG?';
  if (u.kod === 'HAFIZA_CELISKI') return 'Hafıza çelişkisi';
  if (u.kod === 'SAHIPLIK_TERS') return 'Sahiplik?';
  if (u.kod === 'OKUNMADI') return 'Okunmadı';
  if (u.kod === 'STOPAJ_EKSIK') return 'Stopaj eksik';
  if (u.kod === 'HESAP_KODU') return 'Hesap kodu';
  return u.baslik.length > 22 ? u.baslik.slice(0, 21) + '…' : u.baslik;
}
/** Liste satırı uyarı çipleri (küçük, tıklanınca detay açılır). */
function UyariCipler({ raw, onClick, max = 4 }: { raw: any; onClick?: () => void; max?: number }) {
  const list = uyariListeFE(raw);
  if (!list.length) return null;
  const gor = list.slice(0, max);
  return (
    <span className="uycips" onClick={onClick} title={list.map((u) => `${u.seviye === 'engel' ? '⛔' : u.seviye === 'uyari' ? '⚠' : 'ℹ'} ${u.baslik}: ${u.aciklama}`).join('\n\n')}>
      {gor.map((u, i) => { const r = uyariRenkFE(u); return <span key={i} className="uycip" style={{ color: r.fg, background: r.bg, borderColor: r.bd }}>{uyariKisaFE(u)}</span>; })}
      {list.length > max ? <span className="uycip" style={{ color: '#64748b', background: '#f1f5f9', borderColor: '#e2e8f0' }}>+{list.length - max}</span> : null}
    </span>
  );
}
const KURUM_TURU_SECENEK: Array<{ value: string; label: string }> = [
  { value: 'kamu', label: 'Kamu idaresi (5018 cetvel)' }, { value: 'belediye', label: 'Belediye' }, { value: 'universite', label: 'Üniversite' },
  { value: 'banka', label: 'Banka / sigorta' }, { value: 'kit', label: 'KİT / kamu şirketi' },
  // B.3 — diğer belirlenmiş alıcılar (KDVGUT I/C-2.1.3.1/b): BİST şirketi, OSB, meslek kuruluşu, döner sermaye, emekli sandığı, kalkınma ajansı, %50+ iştirakleri.
  { value: 'belirlenmis_diger', label: 'Diğer belirlenmiş alıcı (BİST şirketi, OSB, meslek kuruluşu, döner sermaye, emekli sandığı, kalkınma ajansı, %50+ iştiraki)' },
  { value: 'diger', label: 'Diğer (normal KDV mükellefi)' },
  // B.4 — satışta TCKN'li alıcı sorusunun cevabı: nihai tüketici / şahıs → tevkifat uygulanmaz.
  { value: 'kdv_mukellefi_degil', label: 'KDV mükellefi değil (nihai tüketici / şahıs)' },
];
/** Belge detayı / editör "Uyarılar" kutusu — kod + seviye + öneri + tek-tık eylemler (demirbaş 3 düğme, öneriyi uygula,
 *  ilk belgeyi aç, alıcı tipini seç, tevkifat fişini kur, yönü çevir). Sunucu eylemleri burada; ekran-içi olanlar callback. */
function UyariKutusu({ doc, taxpayerId, onIlkBelge, onTevkifatFisi, onYonuCevir, onAcEditor }: {
  doc: any; taxpayerId: string;
  onIlkBelge?: (id: string) => void; onTevkifatFisi?: () => void; onYonuCevir?: () => void; onAcEditor?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const list = uyariListeFE((doc?.ocrData as any)?.uyarilar);
  const [aliciSec, setAliciSec] = useState<string>('');
  const [aliciAcik, setAliciAcik] = useState(false);
  const [notAcik, setNotAcik] = useState(false);
  const [notTxt, setNotTxt] = useState('');
  // Kullanıcı bulgusu (2026-09-12): editörde kutu kırpılıyor/yer kaplıyordu → yalnız bilgi notu varsa KAPALI başlar,
  //   engel/uyarı varsa açık; başlığa tıklayınca açılır/kapanır. Belge değişince yeniden hesaplanır.
  const onemliVar = list.some((u) => u.seviye === 'engel' || u.seviye === 'uyari');
  const [acik, setAcik] = useState<boolean>(onemliVar);
  useEffect(() => { setAcik(onemliVar); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [doc?.id, onemliVar]);
  const demirbasMut = useMutation({
    mutationFn: (p: { karar: string; not?: string }) => api.post(`/fatura-muhasebelestirme/documents/${doc.id}/demirbas-karari`, p),
    onSuccess: (_r, p) => {
      toast.success(p.karar === 'elle_islendi' ? 'Belge kapatıldı — Luca\'da elle işlendi (Luca\'ya gitmez)' : p.karar === 'yine_de_isle' ? 'Demirbaş fişi kuruldu — hesabı kontrol edip onaylayın' : 'Demirbaş değil olarak işaretlendi — bir daha sorulmaz');
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Demirbaş kararı kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const aliciMut = useMutation({
    mutationFn: (p: any) => api.post('/fatura-muhasebelestirme/alici-tipi', p),
    onSuccess: (r: any) => { toast.success(`Alıcı tipi kaydedildi (${r?.data?.yenidenDogrulanan ?? 0} belge yeniden doğrulandı)`); setAliciAcik(false); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Alıcı tipi kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const eylemMut = useMutation({
    mutationFn: (p: { eylem: string }) => api.post(`/fatura-muhasebelestirme/documents/${doc.id}/uyari-eylem`, p),
    onSuccess: () => { toast.success('Öneri uygulandı'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Eylem başarısız: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // A.2 — sahip "mükerrer değil" kararı: engel + duplicateOfId kalkar (aynı numaralı FARKLI belge).
  const mukerrerMut = useMutation({
    mutationFn: (p: { karar: string; not?: string }) => api.post(`/fatura-muhasebelestirme/documents/${doc.id}/mukerrer-karari`, p),
    onSuccess: (_r, p) => { toast.success(p.karar === 'mukerrer_degil' ? 'Mükerrer değil olarak işaretlendi — engel kalktı' : 'Mükerrer olduğu teyit edildi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Mükerrer kararı kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  if (!list.length) return null;
  const busy = demirbasMut.isPending || aliciMut.isPending || eylemMut.isPending || mukerrerMut.isPending;
  const btn = (renk: { fg: string; bd: string }, extra?: any) => ({ padding: '4px 10px', borderRadius: 7, border: `1px solid ${renk.bd}`, background: '#fff', color: renk.fg, fontWeight: 700, fontSize: 11.5, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, ...(extra || {}) });
  return (
    <div className={`uykutu${acik ? '' : ' kapali'}`}>
      <button type="button" className="uykutu-h" onClick={() => setAcik((v) => !v)} title={acik ? 'Uyarıları gizle' : 'Uyarıları göster'}><span>{acik ? '▾' : '▸'} Uyarılar{!acik && list[0] ? <em className="uykutu-oz"> · {list.map((u) => u.baslik).slice(0, 2).join(' · ')}{list.length > 2 ? ` +${list.length - 2}` : ''}</em> : null}</span><small>{list.length} kayıt · engel {list.filter((u) => u.seviye === 'engel').length} · uyarı {list.filter((u) => u.seviye === 'uyari').length}</small></button>
      {acik && list.map((u, i) => {
        const r = uyariRenkFE(u);
        const ikon = u.kod === 'DEMIRBAS' && !u.meta?.karar ? '🟣' : u.seviye === 'engel' ? '⛔' : u.seviye === 'uyari' ? '⚠️' : 'ℹ️';
        const eylemler = u.eylemler || [];
        return (
          <div key={i} className="uysatir" style={{ borderLeftColor: r.fg, background: r.bg }}>
            <div className="uybaslik" style={{ color: r.fg }}>{ikon} {u.baslik}{u.meta?.teyit_gerekli ? <em title="Oran/kapsam/eşik mevzuat teyidi bekliyor"> · teyit gerekli</em> : null}</div>
            <div className="uyacik">{u.aciklama}</div>
            {u.oneri ? <div className="uyoneri"><b>Öneri:</b> {u.oneri}</div> : null}
            {eylemler.length > 0 && (
              <div className="uyeylem">
                {eylemler.map((e) => {
                  if (e.id.startsWith('demirbas:')) {
                    const karar = e.id.split(':')[1];
                    const renk = karar === 'elle_islendi' ? UYARI_RENK.karar : karar === 'yine_de_isle' ? UYARI_RENK.bilgi : UYARI_RENK.uyari;
                    return <button key={e.id} type="button" style={btn(renk)} disabled={busy} title={karar === 'elle_islendi' ? 'Belge kapanır: APPROVED + Luca "elle işlendi" — Luca\'ya gönderilmez' : karar === 'yine_de_isle' ? 'Bilanço: 25x + KDV (satışta 679/689 taslağı); İşletme: Sabit Kıymet Alışı' : 'Uyarı kalkar, normal gider/gelir akışı; bu satıcı+içerik için bir daha sorulmaz'}
                      onClick={() => { if (karar === 'elle_islendi' && !window.confirm('Belge "Luca\'da elle işlendi" olarak KAPATILACAK ve Luca\'ya gönderilmeyecek. Onaylıyor musun?')) return; demirbasMut.mutate({ karar, not: notTxt || undefined }); }}>{e.etiket}</button>;
                  }
                  if (e.id === 'ilk-belgeyi-ac') return <button key={e.id} type="button" style={btn(UYARI_RENK.engel)} onClick={() => { const ilk = String(u.meta?.ilkBelgeId || ''); if (ilk) onIlkBelge?.(ilk); }}>{e.etiket}{u.meta?.ilkBelgeNo ? ` (${u.meta.ilkBelgeNo})` : ''}</button>;
                  if (e.id.startsWith('mukerrer:')) {
                    const karar = e.id.split(':')[1];
                    return <button key={e.id} type="button" style={btn(UYARI_RENK.bilgi)} disabled={busy} title="Aynı belge numaralı ama FARKLI bir belgeyse: engel ve mükerrer izi kalkar; kararınız belgeye yazılır"
                      onClick={() => { if (karar === 'mukerrer_degil' && !window.confirm('Bu belge mükerrer DEĞİL olarak işaretlenecek; onay/Luca engeli kalkacak. İlk belgeyle karşılaştırdınız mı?')) return; mukerrerMut.mutate({ karar, not: notTxt || undefined }); }}>{e.etiket}</button>;
                  }
                  if (e.id === 'oneriyi-uygula') return <button key={e.id} type="button" style={btn(UYARI_RENK.uyari)} disabled={busy} onClick={() => eylemMut.mutate({ eylem: 'oneriyi-uygula' })}>{e.etiket}{u.meta?.onerilenHesap ? ` → ${u.meta.onerilenHesap}` : ''}</button>;
                  if (e.id === 'alici-tipi-sec') return <button key={e.id} type="button" style={btn(UYARI_RENK.uyari)} onClick={() => { setAliciAcik((v) => !v); if (!aliciSec && u.meta?.tahmin) setAliciSec(String(u.meta.tahmin)); }}>{e.etiket}{u.meta?.tahmin ? ` (tahmin: ${u.meta.tahmin})` : ''}</button>;
                  if (e.id === 'tevkifat-fisi-kur') return <button key={e.id} type="button" style={btn(UYARI_RENK.engel)} onClick={() => (onTevkifatFisi ? onTevkifatFisi() : onAcEditor?.(doc.id))}>{e.etiket}</button>;
                  if (e.id === 'yonu-cevir') return <button key={e.id} type="button" style={btn(UYARI_RENK.engel)} onClick={() => (onYonuCevir ? onYonuCevir() : onAcEditor?.(doc.id))}>{e.etiket}</button>;
                  return <button key={e.id} type="button" style={btn(UYARI_RENK.bilgi)} onClick={() => onAcEditor?.(doc.id)}>{e.etiket}</button>;
                })}
                {u.kod === 'DEMIRBAS' && !u.meta?.karar ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" style={btn(UYARI_RENK.bilgi, { fontWeight: 600 })} onClick={() => setNotAcik((v) => !v)}>{notAcik ? 'Notu gizle' : 'Not ekle'}</button>
                    {notAcik ? <input value={notTxt} onChange={(ev) => setNotTxt(ev.target.value)} placeholder="karar notu (isteğe bağlı)" style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d6dbe4', fontSize: 12, minWidth: 220 }} /> : null}
                  </span>
                ) : null}
                {(u.kod === 'ALICI_TIPI_GEREKLI' || u.meta?.aliciKdvMukellefiSoru === true) && aliciAcik ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: '#64748b' }}>{u.meta?.taraf === 'cari' ? 'Müşteri (cari kartı)' : 'Mükellef'}: <b>{u.meta?.aliciUnvan || '—'}</b></span>
                    <select value={aliciSec} onChange={(ev) => setAliciSec(ev.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d6dbe4', fontSize: 12 }}>
                      <option value="">— seç —</option>
                      {KURUM_TURU_SECENEK.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button type="button" style={btn(UYARI_RENK.uyari)} disabled={busy || !aliciSec}
                      onClick={() => aliciMut.mutate({ taraf: u.meta?.taraf === 'cari' ? 'cari' : 'mukellef', taxpayerId, vkn: u.meta?.aliciVkn || undefined, unvan: u.meta?.aliciUnvan || undefined, kurumTuru: aliciSec, documentId: doc.id })}>Kaydet</button>
                  </span>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// KDV tevkifatı işlem türü kodları (GİB / KDV2 beyannamesi) — Muhasebeleştir'deki
// "Tevkifat Kodu" seçici bunu kullanır (Mihsap'taki yapıya birebir). Kod seçilince
// tevkifat satırlarının oranı boşsa otomatik dolar; kullanıcı oranı ayrıca değiştirebilir.
// İlk 8 kayıt (201-208) kullanıcının Mihsap ekranından birebir alındı.
// 209 ve sonrası için varsayılan oranlar BDP'den (Beyanname Düzenleme Programı) TEYİT EDİLMELİ.
// Mihsap/BDP resmî tevkifat kod listesiyle BİREBİR eşitlendi (kullanıcı ekran görüntüleriyle
//   teyit, 2026-07-18). ESKİ LİSTE 217 sonrası BİR KOD KAYIKTI (Yük Taşımacılığı 223 değil 224,
//   Reklam 225, Demir-Çelik 227) ve 201/203 oranları eskiydi — beyannameye yanlış kod gidiyordu.
//   2xx = kısmi tevkifat (alıcı KDV2 işlem türü), 1xx = tam tevkifat (10/10), 250 = diğer (oran elle),
//   3xx = Mihsap ekranındaki "(Satış)" seçici kodları (oran belge oranından gelir). NOT (B.10): GİB tarafında
//   satıcı KDV1/UBL tevkifat kodu 6xx'tir (2xx+400; 224 ↔ 624), isteğe bağlı tam tevkifat 8xx; "3xx" GİB kodu değildir.
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
        {/* Kapalı görünüm (2026-09-12): kod kalın+tabular, hesap adı gri — tek metin olarak "kod — ad" yazan giriş kutusundan daha okunur. */}
        {!open && value ? <span className="cselshow" aria-hidden="true"><b>{value}</b>{selName ? <span>{selName}</span> : null}</span> : null}
        <input ref={inpRef} className={!open && value ? 'cselinp gizli' : 'cselinp'} value={open ? value : (value && selName ? `${value} — ${selName}` : value)} placeholder="kod ya da isim yaz"
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
  // Kullanıcı isteği (2026-09-12): "Varsayılan / Kural" YAZISI hesap adını kısıtlıyordu → metin kalktı, yalnız 7px renk
  //   noktası; kaynak bilgisi ipucu balonunda (üzerine gel). Yeşil=siz/VKN, mavi=öğrenilmiş, amber=AI tahmini, gri=kural/varsayılan.
  return <span className="kaynak-nokta" title={`Hesap kodu kaynağı: ${r.t}`} style={{ background: r.fg }} />;
}

// PLAN/15 Faz 3 FE (2026-09-13) — İşletme ALIŞ stopaj türü seçenekleri. Arka uç ocrData.isletme.stopajKod'a
//   022 (e-SMM / serbest meslek) ya da 041 (işyeri kirası) yazar; boş olabilir. Listede olmayan kod gelirse ekranda ayrıca gösterilir.
const ISL_STOPAJ_SECENEK: Array<{ value: string; label: string }> = [
  { value: '', label: '—' }, { value: '022', label: '022 Serbest Meslek' }, { value: '041', label: '041 Kira' },
];

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
  akis: 'Belgeler · <b>Belge Akışı</b>',
  faturaKes: 'Belgeler · <b>Fatura Kes</b>',
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
function useDocuments(taxpayerId: string, period: string, status?: 'PENDING') {
  // period='all' (2026-09-15): Gelen Faturalar DÖNEMSİZ — Mihsap Gelen Belgeler gibi bütün bekleyenler tek listede
  //   (Muzaffer Bey: "gelen faturalarda tarih filtresi olmasın, karışıklık olmasın"). Sunucu period almayınca süzmez.
  const tum = period === 'all';
  return useQuery({
    queryKey: ['fm2', 'documents', taxpayerId, period, status || ''],
    // Hatayı YUTMA — react-query isError versin ki "Yüklenemedi, tekrar dene" gösterelim
    // (eskiden catch([]) ile ağ hatası "veri yok" gibi görünüyordu).
    queryFn: async () => {
      const r = await api.get('/fatura-muhasebelestirme/documents', {
        params: { taxpayerId: taxpayerId || undefined, period: tum ? undefined : period, status, limit: tum ? 2000 : 300 },
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
  // Gelen Faturalar dönemsiz olduğu için Alış/Satış rozetleri de dönemsiz sayılır (liste ile rozet aynı sayıyı desin).
  const summaryTumQ = useQuery({
    queryKey: ['fm2', 'summary', taxpayerId, taxpayerId ? 'all' : period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/summary', { params: { taxpayerId: taxpayerId || undefined, ...(taxpayerId ? {} : { period }) } })
        .then((r) => r.data || {})
        .catch(() => ({})),
  });
  const sumTum: any = summaryTumQ.data || {};
  const badge = (n: any) => (Number(n) > 0 ? <span className="ct">{Number(n)}</span> : null);

  const go = (s: string) => setScreen(s);
  // Kullanıcı kararı (2026-09-12): mükellef e-Fatura mükellefiyse e-Fatura Sorgu açık, GİB e-Arşiv Sorgu kilitli; değilse tersi.
  //   Mükellef seçili değilken ikisi de açık (ekranlar zaten 'önce mükellef seç' der). Kilitli ekrandayken mükellef değişirse
  //   açık olana geçilir. Kaynak: Mükellefler listesindeki 'e-Fatura mükellefi mi?' anahtarı (Taxpayer.isEFaturaMukellefi).
  const seciliTp: any = taxpayerId ? taxpayers.find((t) => String(t.id) === String(taxpayerId)) : null;
  const efaturaMi: boolean | null = seciliTp ? seciliTp.isEFaturaMukellefi === true : null;
  const earsivKilit = efaturaMi === true;
  const efaturaKilit = efaturaMi === false;
  useEffect(() => {
    if (screen === 'earsivSorgu' && earsivKilit) setScreen('efaturaSorgu');
    else if (screen === 'efaturaSorgu' && efaturaKilit) setScreen('earsivSorgu');
  }, [screen, earsivKilit, efaturaKilit]);
  const sorguGit = (hedef: 'earsivSorgu' | 'efaturaSorgu') => {
    if (hedef === 'earsivSorgu' && earsivKilit) { toast.info('Bu mükellef e-Fatura mükellefi — satışları entegratörden gelir; e-Fatura Sorgu ekranını kullan.'); return; }
    if (hedef === 'efaturaSorgu' && efaturaKilit) { toast.info('Bu mükellef e-Fatura mükellefi değil — satışları GİB e-Arşiv Sorgu ile çekilir. (Mükellefler listesinden e-Fatura işaretlenebilir.)'); return; }
    setScreen(hedef);
  };

  const nav = (
    <nav className="nav">
      <div className="ncap">Çalışma</div>
      <div className={`nitem${screen === 'genel' ? ' on' : ''}`} style={{ ['--icc' as any]: '#7c3aed' }} onClick={() => go('genel')}><Ico html={I.chart} /> Genel Bakış</div>
      <div className={`nitem${screen === 'mukellefler' ? ' on' : ''}`} style={{ ['--icc' as any]: '#2563eb' }} onClick={() => go('mukellefler')}><Ico html={I.users} /> Mükellefler</div>

      <div className="ncap">Belgeler</div>
      <div className={`nitem${screen === 'earsivSorgu' ? ' on' : ''}${earsivKilit ? ' off' : ''}`} style={{ ['--icc' as any]: '#0f766e' }} onClick={() => sorguGit('earsivSorgu')} title={earsivKilit ? 'Kilitli: bu mükellef e-Fatura mükellefi — GİB e-Arşiv sorgusu kullanılmaz' : undefined}><Ico html={I.file} /> GIB e-Arşiv Sorgu{earsivKilit ? <span className="nlock" aria-label="kilitli">🔒</span> : null}</div>
      <div className={`nitem${screen === 'efaturaSorgu' ? ' on' : ''}${efaturaKilit ? ' off' : ''}`} style={{ ['--icc' as any]: '#2563eb' }} onClick={() => sorguGit('efaturaSorgu')} title={efaturaKilit ? 'Kilitli: bu mükellef e-Fatura mükellefi değil — GİB e-Arşiv Sorgu kullanılır' : undefined}><Ico html={I.plug} /> e-Fatura Sorgu{efaturaKilit ? <span className="nlock" aria-label="kilitli">🔒</span> : null}</div>
      <div className={`nitem${screen === 'faturaKes' ? ' on' : ''}`} style={{ ['--icc' as any]: '#b45309' }} onClick={() => go('faturaKes')}><Ico html={I.file} /> Fatura Kes</div>
      <div className={`nitem${screen === 'faturalar' || screen === 'satis' ? ' on' : ''}`} style={{ ['--icc' as any]: '#15803d' }} onClick={() => go('faturalar')}><Ico html={I.file} /> Gelen Faturalar</div>
      <div className={`nsub${screen === 'faturalar' ? ' on' : ''}`} onClick={() => go('faturalar')}><span className="d" /> Alış Faturaları {badge(sumTum.alisPending)}</div>
      <div className={`nsub${screen === 'satis' ? ' on' : ''}`} onClick={() => go('satis')}><span className="d" /> Satış Faturaları {badge(sumTum.satisPending)}</div>
      <div className={`nitem${screen === 'muhasebe' ? ' on' : ''}`} style={{ ['--icc' as any]: '#7c3aed' }} onClick={() => go('muhasebe')}><Ico html={I.ledger} /> Muhasebeleştir {badge(sum.pending)}</div>
      <div className={`nitem${screen === 'aktarilanlar' ? ' on' : ''}`} style={{ ['--icc' as any]: '#0891b2' }} onClick={() => go('aktarilanlar')}><Ico html={I.check} /> Aktarım {badge(Math.max(0, (Number(sum.approved) || 0) - (Number(sum.posted) || 0)))}</div>
      <div className={`nitem${screen === 'arsiv' ? ' on' : ''}`} style={{ ['--icc' as any]: '#d97706' }} onClick={() => go('arsiv')}><Ico html={I.ledger} /> Arşivim {badge(sum.posted)}</div>
      <div className={`nitem${screen === 'akis' ? ' on' : ''}`} style={{ ['--icc' as any]: '#0891b2' }} onClick={() => go('akis')}><Ico html={I.file} /> Belge Akışı</div>

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
          <AiBekciBandi />
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
              {/* Gelen Faturalar (bekleyen alış/satış) DÖNEMSİZ — Mihsap Gelen Belgeler gibi; seçici burada gösterilmez. */}
              {!((screen === 'faturalar' || screen === 'satis') && taxpayerId) ? (
                <div className="ctxpick">
                  <span className="ctxpick-l">Dönem</span>
                  <FmPeriod value={period} onChange={setPeriod} />
                </div>
              ) : (
                <div className="ctxpick" title="Gelen Faturalar dönem süzmez: Mihsap Gelen Belgeler gibi bütün bekleyen belgeler tek listede">
                  <span className="ctxpick-l">Dönem</span>
                  <span className="mu" style={{ fontSize: 13, fontWeight: 600, padding: '6px 2px' }}>Tüm dönemler</span>
                </div>
              )}
            </div>
          </div>

          <div className="content">
            {(screen === 'faturalar' || screen === 'satis') && <ScreenFaturalar taxpayerId={taxpayerId} period={period} kind={screen === 'satis' ? 'SATIS' : 'ALIS'} isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} taxpayerNace={(taxpayers.find((t) => t.id === taxpayerId) as any)?.naceKodu || ''} taxpayerFaaliyet={(taxpayers.find((t) => t.id === taxpayerId) as any)?.faaliyetAciklama || ''} onOpenSorgu={() => sorguGit(screen === 'satis' ? (efaturaMi === true ? 'efaturaSorgu' : 'earsivSorgu') : 'efaturaSorgu')} onOpenMuhasebe={(id) => { try { localStorage.setItem('fm-open-doc', id); } catch { /* yok say */ } setScreen('muhasebe'); }} />}
            {screen === 'earsivSorgu' && <ScreenSorgu taxpayerId={taxpayerId} period={period} source="earsiv" onOpenEntegrator={() => go('entegrator')} />}
            {screen === 'efaturaSorgu' && <ScreenSorgu taxpayerId={taxpayerId} period={period} source="efatura" onOpenEntegrator={() => go('entegrator')} />}
            {screen === 'mukellefler' && <ScreenMukellefler taxpayers={taxpayers} period={period} onOpen={(id) => { setTaxpayerId(id); setScreen('faturalar'); }} />}
            {screen === 'kurallar' && <ScreenKurallar taxpayerId={taxpayerId} period={period} />}
            {screen === 'muhasebe' && <ScreenMuhasebe taxpayerId={taxpayerId} period={period} isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} taxpayerNace={(taxpayers.find((t) => t.id === taxpayerId) as any)?.naceKodu || ''} taxpayerFaaliyet={(taxpayers.find((t) => t.id === taxpayerId) as any)?.faaliyetAciklama || ''} taxpayerAd={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return t ? taxpayerLabel(t) : ''; })()} full={editorFull} onToggleFull={() => setEditorFull((v) => !v)} onOpenMukellefler={() => setScreen('mukellefler')} />}
            {screen === 'aktarilanlar' && <ScreenAktarilanlar taxpayerId={taxpayerId} period={period} mode="bekleyen" isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} />}
            {screen === 'arsiv' && <ScreenAktarilanlar taxpayerId={taxpayerId} period={period} mode="arsiv" isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} />}
            {screen === 'entegrator' && <ScreenEntegrator taxpayerId={taxpayerId} period={period} />}
            {screen === 'kdv' && <ScreenKdv taxpayerId={taxpayerId} period={period} />}
            {screen === 'faturaKes' && <ScreenFaturaKes taxpayerId={taxpayerId} taxpayers={taxpayers} />}
            {screen === 'ayarlar' && <ScreenAyarlar taxpayerId={taxpayerId} />}
            {screen === 'genel' && <ScreenGenel taxpayers={taxpayers} period={period} onOpen={(id) => { setTaxpayerId(id); setScreen('faturalar'); }} />}
            {screen === 'akis' && <ScreenAkis taxpayerId={taxpayerId} taxpayers={taxpayers} onOpenMuhasebe={(id, tpId, donem) => { try { localStorage.setItem('fm-open-doc', id); } catch { /* yok say */ } if (tpId) setTaxpayerId(tpId); if (donem) setPeriod(donem); setScreen('muhasebe'); }} />}
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
  // Faz 2: MANUAL_DONE = demirbaş "Luca'da elle işledim → kapat" — Luca'ya gitmez, arşivde "elle işlendi" görünür.
  return d?.lucaStatus === 'POSTED' || d?.lucaStatus === 'MANUAL_DONE';
}
function isWaitingTransfer(d: any): boolean {
  return !isArchived(d) && (d?.status === 'APPROVED' || ['QUEUED', 'POSTING', 'FAILED'].includes(d?.lucaStatus));
}
function isInAktarim(d: any): boolean {
  return isWaitingTransfer(d) || isArchived(d);
}
/* ── PLAN16-B: Gelen Faturalar — güven rozeti + "Ne yapmam gerekiyor" kümeleri (saf yardımcılar) ── */
type GfGuven = { seviye: 'yuksek' | 'orta' | 'dusuk'; neden: string };
type GfKume = 'hazir' | 'karar' | 'incele' | 'ham';
const GF_KAYNAK_AD: Record<string, string> = { KULLANICI: 'senden', HAFIZA: 'hafızadan', VKN: "VKN'den", AI: 'AI tahmini', KURAL: 'kelime kuralından', ISIM: 'isimden', VARSAYILAN: 'varsayılan' };
const GF_GUVEN_ETIKET: Record<GfGuven['seviye'], string> = { yuksek: 'Yüksek', orta: 'Orta', dusuk: 'Düşük' };
/** Belge güveni: backend `guven` (computeDocConfidence) + satır KAYNAĞI ile tek satır sebep.
 *  İşletme defterinde hesap kodu/cari olmadığından backend "Cari eksik" der → orada kayıt türünden türetilir. */
function gfGuvenOf(d: any, isIsletme: boolean): GfGuven {
  const uyariAdet = uyariListeFE((d?.ocrData as any)?.uyarilar).length;
  if (isIsletme) {
    const ready = isletmeDocReady(d);
    if (!ready.ok) return { seviye: 'dusuk', neden: ready.reason || 'Kayıt türü çözülemedi' };
    return { seviye: 'orta', neden: uyariAdet ? 'Kayıt türü çözüldü · uyarı var' : 'Kayıt türü çözüldü — teyit et' };
  }
  const g = d?.guven;
  const seviye: GfGuven['seviye'] = g?.seviye === 'yuksek' || g?.seviye === 'orta' || g?.seviye === 'dusuk' ? g.seviye : 'dusuk';
  const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
  const kaynakOf = (grp: string) => { const l = lines.find((x) => String(x?.group || '') === grp && x?.accountCode); return GF_KAYNAK_AD[String(l?.kaynak || '').toUpperCase()] || ''; };
  const cariK = kaynakOf('cari');
  const hesapK = kaynakOf('matrah');
  if (seviye === 'yuksek') return { seviye, neden: `${cariK ? `cari ${cariK}` : 'cari eşleşti'} · ${hesapK ? `hesap ${hesapK}` : 'hesap kesin'}` };
  if (seviye === 'orta') return { seviye, neden: `${hesapK ? `hesap ${hesapK}` : 'AI tahmini'} — teyit et${uyariAdet ? ' · uyarı var' : ''}` };
  return { seviye, neden: String(g?.neden || 'Eksik / çelişkili') };
}
/** "Ne yapmam gerekiyor" kümesi — her belge TAM BİR kümeye düşer:
 *  ham = okunmamış/okunuyor/okunamadı · karar = demirbaş kararı / mükerrer(+şüphe) / tevkifat eksik / alıcı tipi / engel ·
 *  hazir = kodlar TAM (Eşleşti) + engel/karar uyarısı yok + çelişki yok · incele = kod eksik / çelişki / tutar.
 *  Kullanıcı bulgusu (2026-09-12): eskiden 'güven yüksek' şartı vardı → eşleşen 14 belge 'İncele'de kalıyor, hazır 0 çıkıyordu;
 *  güven artık şart değil (toplu onayda hafıza çelişkisi/demirbaş/mükerrer zaten arka uçta atlanır ve atlananlar paneli gösterilir). */
function gfKumeOf(d: any, du: { cat: string }, guven: GfGuven): GfKume {
  if (du.cat === 'ham' || du.cat === 'okunuyor' || du.cat === 'okunamadi') return 'ham';
  const list = uyariListeFE((d?.ocrData as any)?.uyarilar);
  const kararKod = (u: UyariFE) => (u.kod === 'DEMIRBAS' ? !u.meta?.karar : ['MUKERRER', 'MUKERRER_GORSEL', 'MUKERRER_FIS', 'TEVKIFAT_EKSIK', 'ALICI_TIPI_GEREKLI'].includes(u.kod));
  if (du.cat === 'demirbas' || du.cat === 'mukerrer' || !!d?.duplicateOfId || list.some((u) => u.seviye === 'engel' || kararKod(u))) return 'karar';
  const engelVar = list.some((u) => u.seviye === 'engel');
  if (!engelVar && du.cat === 'ready' && d?.status !== 'APPROVED') return 'hazir';
  return 'incele';
}
function ScreenFaturalar({ taxpayerId, period, kind = 'ALIS', isIsletme = false, taxpayerNace = '', taxpayerFaaliyet = '', onOpenSorgu, onOpenMuhasebe }: { taxpayerId: string; period: string; kind?: 'ALIS' | 'SATIS'; isIsletme?: boolean; taxpayerNace?: string; taxpayerFaaliyet?: string; onOpenSorgu?: () => void; onOpenMuhasebe?: (id: string) => void }) {
  const qc = useQueryClient();
  // Mükellef seçiliyken DÖNEMSİZ (Mihsap Gelen Belgeler gibi); "Tüm mükellefler" görünümü ağır kaçmasın diye dönemli kalır.
  const docsQ = useDocuments(taxpayerId, taxpayerId ? 'all' : period, 'PENDING');
  const all: any[] = docsQ.data || [];
  // PLAN16-B: "Oto-eşleşme karnesi" kutusu KALDIRILDI (kullanıcı kararı) — yerine "Ne yapmam gerekiyor" şeridi
  //   + belge bazında güven rozeti. Backend ucu (eslesme-karnesi) duruyor, bu ekran çağırmıyor.
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
  // Faz 2 — iptal/red/taslak sayacı (belge oluşturulmayan inbox satırları + CANCELLED belgeler).
  const iptalSayacQ = useQuery({
    queryKey: ['fm2', 'iptal-sayac', taxpayerId, taxpayerId ? 'all' : period],
    queryFn: () => api.get('/fatura-muhasebelestirme/documents/iptal-sayac', { params: { taxpayerId: taxpayerId || undefined, ...(taxpayerId ? {} : { period }) } }).then((r) => r.data || null).catch(() => null),
    enabled: !!taxpayerId,
  });
  const iptalSayac: any = iptalSayacQ.data;
  const dd = (d: any) => deriveDurum(d, isIsletme, '');
  // Durum filtresi (Hepsi / Eşleşti / İncele / Kod eksik / Çelişki / …) — ikincil (küçük) sayaç satırı.
  const [durumF, setDurumF] = useState('all');
  const durumCount = (cat: string) => cat === 'all' ? docsAll.length : docsAll.filter((d) => dd(d).cat === cat).length;
  // PLAN16-B — "Ne yapmam gerekiyor" kümesi (hazir/karar/incele/ham): tıkla süz, tekrar tıkla kalkar.
  //   Durum süzgeciyle birlikte çalışır (VE). Belge başına güven + küme bir kez hesaplanır (Map).
  const [gorevF, setGorevF] = useState<GfKume | ''>('');
  const gfBilgi = useMemo(() => {
    const m = new Map<string, { guven: GfGuven; kume: GfKume }>();
    for (const d of docsAll) { const guven = gfGuvenOf(d, isIsletme); m.set(d.id, { guven, kume: gfKumeOf(d, deriveDurum(d, isIsletme, ''), guven) }); }
    return m;
  }, [docsAll, isIsletme]);
  const gfKumeSayac = useMemo(() => {
    const s: Record<GfKume, number> = { hazir: 0, karar: 0, incele: 0, ham: 0 };
    gfBilgi.forEach((v) => { s[v.kume]++; });
    return s;
  }, [gfBilgi]);
  // PLAN/15 Faz 3 FE — "AI önerisi uygulanan: %X" ölçütü: matrah satırı DOLU belgeler içinde kaynağı KULLANICI olmayan
  //   (öğrenilmiş/AI/kural/varsayılan — yani öneri olduğu gibi kalan) belgelerin payı. lines[] yoksa (işletme defteri) dolu=0 → çip gizli.
  const gfOran = useMemo(() => {
    const s = { dolu: 0, elle: 0, ogren: 0, ai: 0, vars: 0, kural: 0, diger: 0 };
    for (const d of docsAll) {
      const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
      const l = lines.find((x) => String(x?.group || '') === 'matrah' && x?.accountCode);
      if (!l) continue;
      s.dolu++;
      const k = String(l.kaynak || '').toUpperCase();
      if (k === 'KULLANICI') s.elle++;
      else if (k === 'HAFIZA' || k === 'HAFIZA_AD') s.ogren++;
      else if (k === 'AI') s.ai++;
      else if (k === 'VARSAYILAN') s.vars++;
      else if (k === 'KURAL' || k === 'ISIM' || k === 'VKN') s.kural++;
      else s.diger++;
    }
    const oto = s.dolu - s.elle;
    return { ...s, oto, yuzde: s.dolu ? Math.round((oto / s.dolu) * 100) : 0 };
  }, [docsAll]);
  // Sütun sıralama (başlığa tıkla): güven · tarih · tutar · firma. Varsayılan = tarih (eskiden yeniye, mevcut davranış).
  const [sortKey, setSortKey] = useState<'guven' | 'tarih' | 'tutar' | 'firma'>('tarih');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const sirala = (k: 'guven' | 'tarih' | 'tutar' | 'firma') => {
    if (sortKey === k) { setSortDir((v) => (v === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(k);
    // İlk tık: güven → Düşük önce (işi olan üstte), tutar → büyük önce, tarih/firma → artan.
    setSortDir(k === 'tutar' ? 'desc' : 'asc');
  };
  const docs = useMemo(
    () => {
      let base = durumF === 'all' ? docsAll : docsAll.filter((d) => deriveDurum(d, isIsletme, '').cat === durumF);
      if (gorevF) base = base.filter((d) => gfBilgi.get(d.id)?.kume === gorevF);
      // TARİH SIRASI (kullanıcı isteği: liste karışık gelmesin) — kronolojik eskiden yeniye,
      //   eşit tarihte belge no'ya göre. Alış ve Satış listelerinin ikisinde de geçerli.
      const dnum = (d: any) => { const s = String(d.faturaTarihi || d.createdAt || '').slice(0, 10); return s ? Number(s.replace(/-/g, '')) || 0 : 0; };
      const tarihCmp = (a: any, b: any) => dnum(a) - dnum(b) || String(a.belgeNo || '').localeCompare(String(b.belgeNo || ''), 'tr');
      const guvenSira: Record<string, number> = { dusuk: 0, orta: 1, yuksek: 2 };
      const firmaAd = (d: any) => String(((d.invoiceKind || 'ALIS') === 'SATIS' ? d.customerName : d.vendorName) || '');
      const cmp = (a: any, b: any): number => {
        if (sortKey === 'guven') return (guvenSira[gfBilgi.get(a.id)?.guven.seviye || 'dusuk'] - guvenSira[gfBilgi.get(b.id)?.guven.seviye || 'dusuk']) || tarihCmp(a, b);
        if (sortKey === 'tutar') return (Number(a.totalAmount || 0) - Number(b.totalAmount || 0)) || tarihCmp(a, b);
        if (sortKey === 'firma') return firmaAd(a).localeCompare(firmaAd(b), 'tr') || tarihCmp(a, b);
        return tarihCmp(a, b);
      };
      const sorted = [...base].sort(cmp);
      return sortDir === 'desc' ? sorted.reverse() : sorted;
    },
    [docsAll, durumF, gorevF, gfBilgi, sortKey, sortDir, isIsletme],
  );
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Mükellef/dönem/sekme değişince ESKİ seçim ve durum filtresi taşınmasın — yoksa "AI ile oku"
  //   önceki ekranda seçilmiş (artık görünmeyen) belgeleri de okuturdu.
  useEffect(() => { setSel(new Set()); setDurumF('all'); setGorevF(''); }, [taxpayerId, period, kind]);
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

  // Geçici köprü (Muzaffer Bey 2026-09-15): entegratörler ve mobil fiş yükleme hazır olana kadar Mihsap "Gelen Belgeler"deki
  //   (yalnız ONAY BEKLEYEN) faturalar bu listeye çekilir — Belge Yükle'nin yanındaki "Mihsap'tan çek".
  const mihsapCekMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/import-from-mihsap', { taxpayerId, donem: period, faturaTuru: kind }).then((r) => r.data),
    onSuccess: (r: any) => {
      const yeni = Number(r?.created || 0); const tekrar = Number(r?.reprocessed || 0); const zaten = Number(r?.skipped || 0); const hata = Number(r?.failed || 0);
      // Gelen Belgeler dönemsizdir; liste de dönemsiz → çekilen her belge bu listede (dönem notu gerekmez).
      if (yeni || tekrar) toast.success(`Mihsap'tan ${yeni} yeni belge çekildi${tekrar ? `, ${tekrar} yeniden okunuyor` : ''}${zaten ? ` (${zaten} zaten vardı)` : ''}. Okuma arka planda.`, { duration: 8000 });
      else toast(`Mihsap'ta onay bekleyen yeni ${kind === 'SATIS' ? 'satış' : 'alış'} belgesi yok${zaten ? ` (${zaten} zaten aktarılmış)` : ''}.`, { duration: 6000 });
      if (hata) toast.error(`${hata} belge aktarılamadı: ${(r?.errors || []).slice(0, 2).join(' · ')}`);
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error("Mihsap'tan çekilemedi: " + (e?.response?.data?.message || e?.message || 'hata'), { duration: 9000 }),
  });
  // Manuel belge yükleme (JPEG/PDF/XML/ZIP) — OCR arka planda işler
  const fileRef = useRef<HTMLInputElement>(null);
  // Yükleme yönü: "Belge Yükle"ye basınca Gelir(Satış)/Gider(Alış) seçilir, dosya seçici ona göre açılır.
  //   Yön artık aktif sekmeye değil kullanıcı seçimine bağlı (ref → mutate sırasında okunur).
  const uploadDirRef = useRef<'ALIS' | 'SATIS'>(kind);
  const [uploadPick, setUploadPick] = useState(false);
  // MÜKERRER YÜKLEME PENCERESİ (Muzaffer Bey 2026-09-15): toast yetersizdi (dosya adı listesi) → tarih / belge no / tutar / satıcı ile pencere.
  const [mukerrerYukleme, setMukerrerYukleme] = useState<null | { atlananlar: any[]; yuklenen: number; digerAtlanan: any[] }>(null);
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
      const atlananlar = Array.isArray(r?.data?.atlananlar) ? r.data.atlananlar : [];
      const digerAtlanan = skipped.filter((s: any) => !s?.zatenYuklu);
      if (n) toast.success(`Belge yüklendi · ${n}. Okuma arka planda başladı.`);
      if (atlananlar.length || digerAtlanan.length) setMukerrerYukleme({ atlananlar, yuklenen: Number(n) || 0, digerAtlanan });
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Yüklenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/fatura-muhasebelestirme/documents/${id}`),
    onSuccess: () => { toast.success('Belge silindi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Silinemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // PLAN16-B — TOPLU SİL: seçilenler tek tek DELETE (toplu uç yok); Luca'ya gitmiş/elle işlenmiş (POSTED/MANUAL_DONE) atlanır.
  const bulkDelMut = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0; const hata: string[] = [];
      for (const id of ids) {
        try { await api.delete(`/fatura-muhasebelestirme/documents/${id}`); ok++; }
        catch (e: any) { hata.push(e?.response?.data?.message || e?.message || 'hata'); }
      }
      return { ok, hata };
    },
    onSuccess: ({ ok, hata }) => {
      if (ok > 0) toast.success(`${ok} belge silindi`);
      if (hata.length) toast.error(`${hata.length} belge silinemedi: ${hata[0]}`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Toplu silme başarısız: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const topluSil = () => {
    // Yalnız ŞU AN görünür listedeki seçimler (bayat/başka sekme seçimi gitmesin) + aktarılmış/elle işlenmiş atlanır.
    const ids = docs.filter((d: any) => sel.has(d.id) && !isArchived(d)).map((d: any) => d.id);
    const atlanan = sel.size - ids.length;
    if (!ids.length) { toast.error(atlanan > 0 ? 'Seçilenler Luca\'ya aktarılmış/elle işlenmiş — silinemez' : 'Önce belge seç'); return; }
    if (!window.confirm(`${ids.length} belge silinsin mi?${atlanan > 0 ? `\n(${atlanan} belge aktarılmış/elle işlenmiş olduğundan atlanacak)` : ''}\nBu işlem geri alınamaz.`)) return;
    bulkDelMut.mutate(ids);
  };
  // PLAN16-B — DEMİRBAŞ KARARI satır içinde (UyariKutusu açılmadan): aynı uç, aynı mesajlar.
  const demirbasSatirMut = useMutation({
    mutationFn: (p: { id: string; karar: string }) => api.post(`/fatura-muhasebelestirme/documents/${p.id}/demirbas-karari`, { karar: p.karar }),
    onSuccess: (_r, p) => {
      toast.success(p.karar === 'elle_islendi' ? 'Belge kapatıldı — Luca\'da elle işlendi (Luca\'ya gitmez)' : p.karar === 'yine_de_isle' ? 'Demirbaş fişi kuruldu — hesabı kontrol edip onaylayın' : 'Demirbaş değil olarak işaretlendi — bir daha sorulmaz');
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Demirbaş kararı kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const demirbasKarar = (id: string, karar: string) => {
    if (karar === 'elle_islendi' && !window.confirm('Belge "Luca\'da elle işlendi" olarak KAPATILACAK ve Luca\'ya gönderilmeyecek. Onaylıyor musun?')) return;
    demirbasSatirMut.mutate({ id, karar });
  };
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
    queryKey: ['fm-ocr-progress', taxpayerId, taxpayerId ? 'all' : period, kind],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/ocr-progress', { params: { taxpayerId, kind, ...(taxpayerId ? {} : { period }) } })).data,
    enabled: !!taxpayerId,
    // Okuma AKTİFKEN hızlı (3sn); boştayken seyrelt (15sn) → çoklu bilgisayarda gereksiz yük düşer,
    //   başka makinede başlayan okuma yine (15sn içinde) yakalanır. Cache'ten güncel duruma bakılır.
    // 2026-09-15 (Muzaffer Bey: "sayaç o anda okunan sayıyla aynı olmuyor, çok sonradan doluyor"): eski kod
    //   qc.getQueryData(['fm-ocr-progress', taxpayerId, period]) ile 3 parçalı anahtara bakıyordu; sorgu anahtarı 4 parçalı
    //   (kind dahil) olduğundan hiç bulunamıyor, okuma sürerken de 15 sn'de bir yenileniyordu (liste 2,5 sn'de yenilenince
    //   sayaç geride kalıyordu). React Query v5 imzası: sorgu nesnesinin kendi verisi.
    refetchInterval: (q: any) => (q?.state?.data?.active ? 3000 : 15000),
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
  const grpLabel = (g: string) => g === 'matrah' ? 'Matrah' : g === 'vergi' ? 'KDV' : g === 'vergi-sorumlu' ? 'Sorumlu Sıf. KDV' : g === 'cari' ? 'Cari' : g === 'tevkifat' ? 'Tevkifat' : g === 'diger_vergi' ? 'KDV dışı vergi' : (g || '—');
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

  // Faz 2 — tevkifatlı belgeler ayrı onay grubu ("Seçilenleri onayla" bunları otomatik onaylamaz).
  const [tevkGrup, setTevkGrup] = useState<Array<{ id: string; belgeNo?: string; firma: string; tutar: any; oran: string }> | null>(null);
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
    // Faz 2 — TEVKİFATLI belgeler AYRI ONAY GRUBU: normal belgeler hemen onaylanır; tevkifatlılar (191+360 / 391 net)
    //   oran-kod-hesap tutarlılığı göz önünde ayrıca onaylanır (aşağıdaki "Tevkifatlı N belgeyi onayla" paneli).
    const tevk = hazir.filter((d) => docTevkifatliFE(d));
    const normal = hazir.filter((d) => !docTevkifatliFE(d));
    if (tevk.length) setTevkGrup(tevk.map((d) => ({ id: d.id, belgeNo: d.belgeNo, firma: (d.invoiceKind === 'SATIS' ? d.customerName : d.vendorName) || '', tutar: d.totalAmount, oran: uyariListeFE((d.ocrData as any)?.uyarilar).find((u) => u.kod === 'TEVKIFAT_VAR')?.meta?.oranMetni || '' })));
    if (normal.length) approveMut.mutate({ ids: normal.map((d) => d.id) });
    else if (tevk.length) toast.info(`Seçilenlerin ${tevk.length}'i tevkifatlı — tablonun altındaki gruptan onayla`, { duration: 5000 });
  };
  // PLAN16-B — "HAZIR OLANLARI ONAYLA": yalnız "Onaya hazır" kümesi (güven yüksek = matrah+cari KULLANICI/HAFIZA/VKN
  //   kaynaklı [backend computeDocConfidence] + uyarı yok + kodlar tam + okunmuş). Süzgeçten bağımsız, gelen kutusunun tamamı.
  //   (İşletme'de hesap kodu olmadığından yüksek güven üretilmez → düğme görünmez; oradaki akış "Onayla".)
  const hazirDocs = useMemo(() => docsAll.filter((d: any) => gfBilgi.get(d.id)?.kume === 'hazir'), [docsAll, gfBilgi]);
  const hazirOnayla = () => {
    if (!hazirDocs.length) { toast.error('Onaya hazır (yüksek güvenli, uyarısız) belge yok'); return; }
    approveMut.mutate({ ids: hazirDocs.map((d: any) => d.id) });
  };
  const gfBusy = approveMut.isPending || bulkDelMut.isPending || recodeMut.isPending;

  return (
    <section className="screen">
      <div className="h2">{kind === 'SATIS' ? 'Bekleyen Satış Faturaları' : 'Bekleyen Alış Faturaları'}</div>
      <div className="sub">{kind === 'SATIS' ? 'Mükellefin kestiği satış faturaları — kuralla otomatik eşleşir.' : 'Entegratörden çekilen gelen faturalar — kuralla otomatik eşleşir, sadece eksik/çelişkili olana bakarsın.'} <b>Bütün dönemler</b> tek listede (Mihsap Gelen Belgeler gibi); onaylanan belge Muhasebeleştir/Aktarım'a geçer.</div>
      {/* PLAN16-B — "NE YAPMAM GEREKİYOR" şeridi: 4 küme sayacı (tıkla süz, tekrar tıkla kalkar) + "Hazır olanları onayla". */}
      {docsAll.length > 0 && (
        <div className="card gf-strip">
          <div className="gf-strip-h">
            <span className="gf-strip-t">Ne yapmam gerekiyor?</span>
            <span className="gf-strip-s">{docsAll.length} belge · {gorevF ? 'küme süzgeci açık — tekrar tıkla kaldır' : 'kümeye tıkla, liste süzülsün'}</span>
            {/* PLAN/15 Faz 3 FE — ölçüt çipi (sağ uç): matrah satırı dolu belgelerde öneri olduğu gibi kalanların payı. */}
            {gfOran.dolu > 0 && (
              <span className="gf-oran-cip" title={`Matrahı dolu ${gfOran.dolu} belge — Muzaffer Bey elle düzeltti: ${gfOran.elle} · Öğrenilmişten: ${gfOran.ogren} · AI: ${gfOran.ai} · Varsayılan: ${gfOran.vars}${gfOran.kural ? ` · Kural/isim: ${gfOran.kural}` : ''}${gfOran.diger ? ` · Kaynağı belirsiz: ${gfOran.diger}` : ''}`}>
                AI önerisi uygulanan: <b>%{gfOran.yuzde}</b>
              </span>
            )}
          </div>
          <div className="gf-strip-row">
            <div className="filttiles gf-tiles">
              {([
                { v: 'hazir', l: 'Onaya hazır', c: '#15803d', t: 'Güven YÜKSEK (cari + hesap senden/hafızadan/VKN\'den) · uyarı yok · kodlar tam · okunmuş → "Hazır olanları onayla" bunları onaylar' },
                { v: 'karar', l: 'Karar bekliyor', c: '#7c3aed', t: 'Demirbaş kararı · mükerrer / mükerrer şüphesi · tevkifat eksik · alıcı tipi · engel — sahip karar verir' },
                { v: 'incele', l: 'İncele', c: '#d97706', t: 'Güven düşük/orta · kod eksik · çelişki · tutar okunamadı — bir bak, düzelt, onayla' },
                { v: 'ham', l: 'Okunmadı (ham)', c: '#64748b', t: 'İçerik henüz okunmadı / okunuyor / okunamadı — "AI ile oku"' },
              ] as Array<{ v: GfKume; l: string; c: string; t: string }>).map((t) => (
                <button key={t.v} type="button" className={`ftile gf-tile${gorevF === t.v ? ' on' : ''}`} style={{ ['--tc' as any]: t.c }} title={t.t} onClick={() => setGorevF((v) => (v === t.v ? '' : t.v))}>
                  <span className="ftdot" />
                  <span className="fttx"><span className="ftn">{gfKumeSayac[t.v]}</span><span className="ftl">{t.l}</span></span>
                </button>
              ))}
            </div>
            <div className="sp" />
            <button type="button" className="btn gf-hazir" disabled={gfBusy || hazirDocs.length === 0} onClick={hazirOnayla}
              title={hazirDocs.length ? 'Yalnız "Onaya hazır" kümesini (yüksek güven + uyarısız + kodlar tam) TEK TIKLA onayla — Luca kuyruğuna alınır. Süzgeçten bağımsız, gelen kutusunun tamamı.' : 'Onaya hazır belge yok — güven, sen düzelttikçe/onayladıkça (hafıza) büyür'}>
              <Ico html={I.checkSm} size={14} /> {approveMut.isPending ? 'İşleniyor…' : `Hazır olanları onayla${hazirDocs.length ? ` (${hazirDocs.length})` : ''}`}
            </button>
          </div>
        </div>
      )}
      <div className="filttiles gf-sub">
        {([
          { v: 'all', l: 'Tümü', c: 'var(--accent)' },
          { v: 'ready', l: 'Eşleşti', c: '#15803d' },
          { v: 'eksik', l: 'Kod eksik', c: '#d97706' },
          { v: 'ham', l: 'Okunmadı (ham)', c: '#64748b' },
          { v: 'incele', l: 'Eşleşmedi', c: '#c2710c' },
          { v: 'celiski', l: 'Çelişki', c: '#e5484d' },
          { v: 'tutar', l: 'Tutar okunamadı', c: '#db6e1e' },
          // Faz 2: demirbaş = kilit değil, sahip kararı bekleyen kutu (mor); mükerrer = engel (kırmızı).
          { v: 'demirbas', l: 'Karar bekliyor', c: '#7c3aed' },
          { v: 'mukerrer', l: 'Mükerrer', c: '#e5484d' },
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
        {/* Faz 2 — entegratörden iptal/red/GİB hata/taslak gelip BELGE OLUŞTURULMAYAN satırlar (bilgi kartı; listede yer almazlar). */}
        {Number(iptalSayac?.toplam) > 0 && (
          <button type="button" className="ftile" style={{ ['--tc' as any]: '#64748b', cursor: 'default' }} title={`Entegratörden iptal/red/GİB hata/taslak durumuyla gelen ${iptalSayac.inbox} satır belge oluşturulmadan atlandı${iptalSayac.belge ? `; ${iptalSayac.belge} belge iptal temizliğiyle kapatıldı` : ''}.\n${(iptalSayac.ornekler || []).slice(0, 5).map((o: any) => `${o.faturaNo || '-'} · ${o.durum || o.neden}`).join('\n')}`}>
            <span className="ftdot" />
            <span className="fttx"><span className="ftn">{iptalSayac.toplam}</span><span className="ftl">İptal / taslak</span></span>
          </button>
        )}
      </div>
      <div className="card invcard">
        <div className="ch invactions">
          <h3>{docsQ.isLoading ? 'Yükleniyor…' : <>{docs.length} belge{sel.size > 0 ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}> · {sel.size} seçili</span> : null}{(gorevF || durumF !== 'all') && docs.length !== docsAll.length ? <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}> · süzgeç: {docsAll.length} içinden</span> : null}</>}</h3><div className="sp" />
          <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.jpe,.jfif,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif,.avif,.xml,.ubl,.zip" style={{ display: 'none' }} onChange={(e) => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; if (files.length) uploadMut.mutate(files); }} />
          <button className="btn sm upload" disabled={!taxpayerId || uploadMut.isPending} onClick={() => setUploadPick(true)} title={!taxpayerId ? 'Önce mükellef seç' : 'Gelir/Gider seç, sonra JPEG / PDF / XML belge yükle'}><Ico html={I.upload} size={13} /> {uploadMut.isPending ? 'Yükleniyor…' : 'Belge Yükle'}</button>
          <button className="btn sm upload" disabled={!taxpayerId || mihsapCekMut.isPending} onClick={() => mihsapCekMut.mutate()} title={!taxpayerId ? 'Önce mükellef seç' : `Mihsap'ta onay bekleyen (Gelen Belgeler) ${kind === 'SATIS' ? 'satış' : 'alış'} faturalarını bu listeye çeker (bütün dönemler)`}><Ico html={I.upload} size={13} /> {mihsapCekMut.isPending ? "Mihsap'tan çekiliyor…" : "Mihsap'tan çek"}</button>
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
          {mukerrerYukleme && (
            <div className="gh-ov" onMouseDown={() => setMukerrerYukleme(null)}>
              <div className="gh-box" role="dialog" aria-modal="true" style={{ width: 'min(760px, 96vw)' }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="gh-box-h luca">
                  <small>BELGE YÜKLEME</small>
                  <b>{mukerrerYukleme.atlananlar.length ? `Mükerrer yükleme tespit edildi — ${mukerrerYukleme.atlananlar.length} dosya yüklenmedi` : `${mukerrerYukleme.digerAtlanan.length} dosya yüklenemedi`}</b>
                </div>
                <div className="gh-box-b">
                  {mukerrerYukleme.yuklenen > 0 && <p><b>{mukerrerYukleme.yuklenen}</b> yeni belge yüklendi ve okumaya alındı.</p>}
                  {mukerrerYukleme.atlananlar.length > 0 && (
                    <>
                      <p className="gh-box-uyari">Aşağıdaki dosyalar bu mükellefte <b>zaten yüklü</b> olan belgelerle birebir aynı (aynı dosya ya da aynı ETTN). Yeniden yüklenmedi; mükerrer kayıt oluşmadı.</p>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                          <thead><tr style={{ textAlign: 'left', color: 'var(--faint)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                            <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Yüklenen dosya</th>
                            <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Mevcut belge</th>
                            <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Tarih</th>
                            <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>Tutar</th>
                            <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Satıcı / Cari</th>
                            <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Neden</th>
                          </tr></thead>
                          <tbody>
                            {mukerrerYukleme.atlananlar.map((a: any, i: number) => (
                              <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '7px 8px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</td>
                                <td style={{ padding: '7px 8px' }}>
                                  {a.mevcutId
                                    ? <button type="button" className="gf-clear" style={{ fontFamily: 'Consolas, ui-monospace, monospace', color: '#0f766e', fontWeight: 700 }} onClick={() => { setMukerrerYukleme(null); setFisDetayId(a.mevcutId); }} title="Mevcut belgeyi listede aç">{a.mevcutBelgeNo || '(no yok)'} ↗</button>
                                    : (a.mevcutBelgeNo || '—')}
                                  {a.mevcutDurum ? <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{String(a.mevcutDurum).replace('NEEDS_REVIEW', 'inceleniyor').replace('APPROVED', 'onaylı').replace('READY', 'hazır')}</div> : null}
                                </td>
                                <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{a.mevcutTarih ? new Date(a.mevcutTarih).toLocaleDateString('tr-TR') : '—'}</td>
                                <td style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{a.mevcutTutar != null ? `${fmtMoney(a.mevcutTutar)} ₺` : '—'}</td>
                                <td style={{ padding: '7px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.mevcutSatici || ''}>{a.mevcutSatici || '—'}</td>
                                <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{a.tur === 'ettn' ? 'Aynı ETTN (e-belge)' : 'Birebir aynı dosya'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {mukerrerYukleme.digerAtlanan.length > 0 && (
                    <p>Ayrıca okunamayan/desteklenmeyen dosyalar: {mukerrerYukleme.digerAtlanan.map((s: any) => `${s.name || 'isimsiz'} (${s.reason || 'atlandı'})`).join(', ')}</p>
                  )}
                </div>
                <div className="gh-box-f">
                  <button type="button" className="btn primary" onClick={() => setMukerrerYukleme(null)}>Tamam</button>
                </div>
              </div>
            </div>
          )}
          <button className="btn sm fix" disabled={!taxpayerId || recodeMut.isPending} onClick={() => recodeMut.mutate()} title="Belgeleri TEKRAR OKUMADAN hesap kodlarını plana göre yeniden eşleştir — yanlış carileri düzeltir/temizler (saniyeler sürer)"><Ico html={I.wand} size={13} /> {recodeMut.isPending ? 'Düzeltiliyor…' : 'Kodları düzelt'}</button>
          {/* Kullanıcı bulgusu (2026-09-12): toplu işlemler sayfanın altında mantıksızdı → ÜST araç çubuğunda, seçim
              yokken kilitli, seçim sayısıyla. Seçim bilgisi + temizle de burada. */}
          <span className="gf-topsep" aria-hidden="true" />
          {sel.size > 0
            ? <span className="gf-selinfo"><b>{sel.size}</b> seçili <button type="button" className="gf-clear" onClick={() => setSel(new Set())} title="Seçimi temizle">✕</button></span>
            : (docs.length > 0 ? <span className="gf-hint">Toplu işlem için satır seç</span> : null)}
          <button type="button" className="btn sm ai" disabled={aiBusy || sel.size === 0} onClick={aiOku} title={sel.size === 0 ? 'Önce satır seç' : 'Seçili faturaları yapay zeka (Max) ile oku — sunucuda okur, sayfa değişince durmaz'}><Ico html={I.spark} size={13} /> {aiBusy ? 'Başlatılıyor…' : `AI ile oku${sel.size ? ` (${sel.size})` : ''}`}</button>
          <button type="button" className="btn sm primary gf-onayla" disabled={approveMut.isPending || sel.size === 0} onClick={muhasebelestir} title={sel.size === 0 ? 'Önce satır seç' : 'Seçili, kodu tam olan belgeleri toplu onayla (Luca kuyruğuna alır). Tevkifatlılar ayrı grupta sorulur; demirbaş kararı bekleyen / mükerrer atlanır.'}><Ico html={I.checkSm} size={13} /> {approveMut.isPending ? 'İşleniyor…' : `Onayla${sel.size ? ` (${sel.size})` : ''}`}</button>
          <button type="button" className="btn sm red gf-sil" disabled={bulkDelMut.isPending || sel.size === 0} onClick={topluSil} title={sel.size === 0 ? 'Önce satır seç' : "Seçili belgeleri sil — Luca'ya aktarılmış / elle işlenmiş olanlar atlanır"}><Ico html={I.trash} size={13} /> {bulkDelMut.isPending ? 'Siliniyor…' : `Sil${sel.size ? ` (${sel.size})` : ''}`}</button>
        </div>
        {skipInfo && skipInfo.length > 0 && (() => {
          // Toplu onayda atlananlar — sebep gruplarıyla (hafıza çelişki / diğer hata). (AI denetçi kaldırıldı.)
          const celiski = skipInfo.filter((s) => String(s.reason || '').startsWith('hafiza-celiski'));
          // Faz 2: demirbaş kararı bekleyen ve mükerrer belgeler ayrı gruplar (force ile geçilmez).
          const demirbas = skipInfo.filter((s) => String(s.reason || '') === 'demirbas-karar-bekliyor');
          const mukerrer = skipInfo.filter((s) => String(s.reason || '') === 'mukerrer');
          const diger = skipInfo.filter((s) => !celiski.includes(s) && !demirbas.includes(s) && !mukerrer.includes(s));
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
              {demirbas.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>• <b style={{ color: '#7c3aed' }}>{demirbas.length} belge demirbaş kararı bekliyor</b> — belgeyi açıp "Luca'da elle işledim → kapat" / "yine de işle" / "demirbaş değil" seçin{noLabel(demirbas)}.</span>
                  <button className="btn sm" style={{ borderColor: '#e3d4fb', color: '#7c3aed' }} onClick={() => { setGorevF(''); setDurumF('demirbas'); setFisDetayId(demirbas[0].id); }}>Karar bekleyenleri göster</button>
                </div>
              )}
              {mukerrer.length > 0 && <div>• <b style={{ color: '#c0353a' }}>{mukerrer.length} belge mükerrer</b> — aynı belge no/VKN/tutar/yönde daha eski belge var; kopyayı silin{noLabel(mukerrer)}.</div>}
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
          // Kullanıcı isteği (2026-09-12): eski büyük şerit yerine ince, canlı "okuma bandı" — halka ilerleme (%),
          //   nabız atan kıvılcım, hap sayaçlar, parıltılı ince çubuk; Durdur sağda küçük.
          const R = 19;
          const cevre = 2 * Math.PI * R;
          return (
            <div className={`aiband${ocrProg.active ? '' : ' err'}`}>
              {ocrProg.active ? (
                <>
                  <div className="aiband-ring" title={`${ocrProg.done} / ${tot} belge okundu`}>
                    <svg viewBox="0 0 44 44" aria-hidden="true">
                      <circle className="bg" cx="22" cy="22" r={R} />
                      <circle className="fg" cx="22" cy="22" r={R} style={{ strokeDasharray: `${cevre}`, strokeDashoffset: `${cevre * (1 - pct / 100)}` }} />
                    </svg>
                    <span className="aiband-pct">%{pct}</span>
                  </div>
                  <div className="aiband-mid">
                    <div className="aiband-title">
                      <span className="aiband-spark"><Ico html={I.spark} size={13} /></span>
                      Yapay zeka okuyor<span className="dots" />
                      <span className="aiband-cnt"><b>{ocrProg.done}</b> / {tot} belge</span>
                    </div>
                    <div className="aiband-chips">
                      {ocrProg.reading ? <span className="aiband-chip live"><i />{ocrProg.reading} sırada</span> : null}
                      {etaText ? <span className="aiband-chip">⏱ {etaText}</span> : null}
                      {ocrProg.failed ? <span className="aiband-chip warn">{ocrProg.failed} okunamadı</span> : null}
                      <span className="aiband-note">Sunucuda işlenir — sayfayı değiştirebilir, başka işe geçebilirsin</span>
                    </div>
                    <div className="aiband-track"><div className="aiband-fill" style={{ width: `${pct}%` }} /></div>
                  </div>
                  <button
                    type="button"
                    className="aiband-stop"
                    onClick={aiDurdur}
                    disabled={aiStop}
                    title="Okumayı durdur — bekleyen belgeler sıradan çıkarılır (okunan biter)"
                  >{aiStop ? 'Durduruluyor…' : <>✕ Durdur</>}</button>
                </>
              ) : (
                <><span className="aiband-errdot" /> <span><b>{ocrProg.failed}</b> belge okunamadı — seçip <b>AI ile oku</b> ile tekrar dene</span></>
              )}
            </div>
          );
        })()}
        {kind === 'ALIS' && missing.length > 0 && (
          <div className="eksikbelge" title="Bu satıcılar son aylarda düzenli alış faturası gönderdi ama bu dönem henüz yok — eksik belge olabilir.">
            <Ico html={I.info} size={14} />
            <span><b>{periodLabel(period)}</b>: <b>{missing.length}</b> satıcıdan belge gelmemiş olabilir (düzenli geliyordu): {missing.slice(0, 8).map((m: any) => m.name).join(', ')}{missing.length > 8 ? ` +${missing.length - 8}` : ''}</span>
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
                    <b>{periodLabel(period)}: {s.eksikToplam} satış faturası eksik görünüyor</b> ({s.seri} serisinde şu numaralar yok): <b>{nolar.join(', ')}</b>
                    {ocrProg?.active ? ' — okuma sürüyor, bitince kesinleşir.' : ' — kesilmemiş, iptal edilmiş ya da sisteme gelmemiş olabilir.'}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="twrap gf-twrap">
          <table className="gf-table">
            {/* SABİT sütun düzeni (kullanıcı bulgusu 2026-09-12: sütunlar kayıyor/taşıyordu) — table-layout:fixed +
                colgroup genişlikleri; toplam %100, taşma imkânsız. Firma sütunu esner, diğerleri sabit. */}
            <colgroup>
              <col className="gc-sel" />
              <col className="gc-tarih" />
              <col className="gc-no" />
              <col className="gc-firma" />
              <col className="gc-haric" />
              <col className="gc-kdv" />
              <col className="gc-tutar" />
              {!isIsletme && <col className="gc-hesap" />}
              <col className="gc-durum" />
              <col className="gc-eylem" />
            </colgroup>
            <thead><tr>
              <th><Check checked={allSelected} onToggle={toggleAll} /></th>
              <th className={`gf-sortable${sortKey === 'tarih' ? ' gf-sorted' : ''}`} onClick={() => sirala('tarih')} title="Tarihe göre sırala">Tarih<span className="gf-sort">{sortKey === 'tarih' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span></th>
              <th>Fatura No</th>
              <th className={`gf-sortable${sortKey === 'firma' ? ' gf-sorted' : ''}`} onClick={() => sirala('firma')} title="Firma adına göre sırala">Firma / VKN<span className="gf-sort">{sortKey === 'firma' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span></th>
              <th className="num">KDV Hariç</th>
              <th className="num">KDV</th>
              <th className={`num gf-sortable${sortKey === 'tutar' ? ' gf-sorted' : ''}`} onClick={() => sirala('tutar')} title="Tutara göre sırala">Tutar<span className="gf-sort">{sortKey === 'tutar' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span></th>
              {!isIsletme && <th>Hesap</th>}
              <th>Durum</th>
              <th className="gf-th-eylem">Eylemler</th>
            </tr></thead>
            <tbody>
              {docs.map((d) => {
                const du = dd(d);
                const gfb = gfBilgi.get(d.id);
                const guven: GfGuven = gfb?.guven || gfGuvenOf(d, isIsletme);
                // Demirbaş kararı satır içi: backend eylemleri (etiketler) varsa onlar; yoksa 3 sabit düğme.
                const demUyari = uyariListeFE((d.ocrData as any)?.uyarilar).find((u) => u.kod === 'DEMIRBAS' && !u.meta?.karar);
                const demEylemler: Array<{ id: string; etiket: string }> = demUyari
                  ? ((demUyari.eylemler || []).filter((e) => e.id.startsWith('demirbas:')).length ? (demUyari.eylemler || []).filter((e) => e.id.startsWith('demirbas:')) : [{ id: 'demirbas:elle_islendi', etiket: 'Luca\'da elle işledim → kapat' }, { id: 'demirbas:yine_de_isle', etiket: 'Yine de işle' }, { id: 'demirbas:demirbas_degil', etiket: 'Demirbaş değil' }])
                  : [];
                const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
                // İşletme "Kayıt Türü" sütunu: içerik = ALT türü (örn. "Elektrik Giderleri"). Seçili ise o,
                //   değilse satıcı adından otomatik (Elektrik/Yakıt/Doğalgaz/Su/Telefon/Kargo/HGS…); alt yoksa ana türe düşer.
                // İşletme: içerikten gelen sınıf. ok ise ALT türünü göster (yoksa ana türe düş); değilse boş (Eşleşmedi).
                const sinif = islSinif(d);
                const islKt = sinif.ktAd.replace(/\s*\(.*?\)/g, '').trim();
                const islKayit = isIsletme && sinif.ok ? (kayitAltKisaAd(sinif.altAd) || islKt) : '';
                const islAltFull = sinif.altAd;
                const islMain = sinif.ktAd;
                // Z RAPORU: karşı taraf yok → FİRMA sütununda 'Z RAPORU' (Muzaffer Bey 2026-09-15; eski belgelerde customerName boş).
                const zRapor = String(d.documentType || '').toUpperCase() === 'Z_RAPORU';
                const firma = (sat ? d.customerName : d.vendorName) || (zRapor ? 'Z RAPORU' : '—');
                const vkn = sat ? d.buyerVkn : d.sellerVkn;
                // HESAP KODU sütunu = SADECE matrah/gider kodu. Gider boşsa KDV/cari koduna DÜŞME →
                //   boş kalsın (kullanıcı: gider kodu boşsa bu sütun da boş olmalı).
                const matrahLine = (Array.isArray(d.lines) ? d.lines : []).find((l: any) => String(l.group) === 'matrah' && l.accountCode);
                const code = accountCodeOnly(matrahLine?.accountCode || '');
                // Hesap ADI: satır açıklaması (eşleştirmede hesap adı buraya yazılır); yoksa yalnız kod.
                const codeAd = code ? String(matrahLine?.description || '').trim() : '';
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
                // Engel sayısı Faz 2 modelinden (seviye=engel); eski kayıtlarda siddet=hata → uyariListeFE normalize eder.
                const docUyariHata = uyariListeFE(docUyarilar).filter((u) => u.seviye === 'engel').length;
                const docUyariRenk = docUyariHata > 0 ? '#dc2626' : '#d97706';
                // Satırda yalnız KARAR/ENGEL/UYARI seviyesi sayılır; bilgi çipleri (ilk kez satıcı, tevkifat var) satırda GÖSTERİLMEZ
                //   (kullanıcı: "bir sürü bilgi yazmaya gerek yok"); tamamı İncele / uyarı kutusunda.
                const onemliUyari = uyariListeFE(docUyarilar).filter((u) => u.seviye === 'engel' || u.seviye === 'uyari').length;
                // Kullanıcı isteği (2026-09-12): tevkifatlı ve demirbaş belge, eşleşmiş olsa da satırda küçük etiketle görünsün.
                const tevkUyari = uyariListeFE(docUyarilar).find((u) => u.kod === 'TEVKIFAT_VAR');
                const tevkEtiket = (tevkUyari || docTevkifatliFE(d)) ? `Tevkifatlı${tevkUyari?.meta?.oranMetni ? ' ' + String(tevkUyari.meta.oranMetni) : ''}` : '';
                const demirbasEtiket = uyariListeFE(docUyarilar).some((u) => u.kod === 'DEMIRBAS') || (d.ocrData as any)?.fixedAsset?.is === true ? (demEylemler.length ? 'Demirbaş — karar bekliyor' : 'Demirbaş') : '';
                const durumIpucu = du.cat === 'okunamadi' && d.lucaErrorMessage ? `Neden: ${d.lucaErrorMessage}` : du.cat === 'celiski' ? ((Array.isArray(d.validationIssues) ? d.validationIssues : (Array.isArray(d.ocrData?.validationIssues) ? d.ocrData.validationIssues : [])).filter((i: any) => i?.code && i.code !== 'INCOMPLETE_AMOUNTS' && i?.severity !== 'WARNING' && i?.severity !== 'INFO').map((i: any) => i.message).filter(Boolean).join(' · ') || du.t) : du.t;
                return (
                  <Fragment key={d.id}>
                  <tr className={`${ocrCls || ''}${fisAcik ? ' detay-on' : ''}`.trim() || undefined}>
                    <td><Check checked={sel.has(d.id)} onToggle={() => toggle(d.id)} /></td>
                    <td className="gf-tarih">{fmtDate(d.faturaTarihi || d.createdAt)}</td>
                    <td className="gf-no" title={d.belgeNo || ''}>{d.belgeNo || '—'}</td>
                    <td className="firm gf-firma"><b title={firma}>{firma}</b><small>{vkn ? `VKN ${vkn}` : '—'}{(d as any).duplicateOfId ? <> · <a href="#ilk" className="gf-muk" title={(d as any).duplicateReason || 'Bu fatura daha önce yüklenmiş'} onClick={(ev) => { ev.preventDefault(); const ilk = String((d as any).duplicateOfId || ''); if (docs.some((x: any) => x.id === ilk)) setFisDetayId(ilk); else onOpenMuhasebe?.(ilk); }}>⚠ mükerrer · ilk belgeyi aç</a></> : null}</small></td>
                    <td className="num gf-sayi">{matrah != null ? fmtMoney(matrah) : '—'}</td>
                    <td className="num gf-sayi">{kdv != null ? fmtMoney(kdv) : '—'}</td>
                    <td className="num gf-sayi gf-tutar"><b>{fmtMoney(d.totalAmount)}</b></td>
                    {!isIsletme && <td className="gf-hesap">{code ? <><span className="hk">{code}</span>{codeAd ? <small title={codeAd}>{codeAd}</small> : null}</> : <span className="hk no">— yok —</span>}</td>}
                    <td className="gf-durum">
                      {/* TEK durum hapı; üzerine gelince sebep. Güven yalnız DÜŞÜK ise küçük kırmızı nokta (sebep ipucunda) — orta/yüksek yazılmaz. */}
                      <button type="button" className={`pill ${du.k} gf-durumhap`} title={`${durumIpucu}${guven.seviye === 'dusuk' ? ` · güven düşük: ${guven.neden}` : ''}${onemliUyari ? ` · ${onemliUyari} uyarı — tıkla, incele` : ''}`} onClick={() => setFisDetayId(fisAcik ? '' : d.id)}>
                        {guven.seviye === 'dusuk' ? <i className="gf-guvennok" aria-label="güven düşük" /> : null}{du.t}{onemliUyari > 0 ? <i className="gf-uyn" style={{ color: docUyariRenk }}>⚠{onemliUyari}</i> : null}
                      </button>
                      {(tevkEtiket || demirbasEtiket) && (
                        <div className="gf-ozel">
                          {tevkEtiket ? <span className="gf-ozel-cip tevk" title={tevkUyari ? `${tevkUyari.baslik}: ${tevkUyari.aciklama || ''}` : 'Tevkifatlı fatura'}>{tevkEtiket}</span> : null}
                          {demirbasEtiket ? <span className="gf-ozel-cip dem" title="Demirbaş (sabit kıymet) — 25x hesap / karar">{demirbasEtiket}</span> : null}
                        </div>
                      )}
                      {/* DEMİRBAŞ KARARI satır içi 3 küçük düğme (yalnız karar bekleyen belgede; aynı uç). */}
                      {demEylemler.length > 0 && (
                        <div className="gf-demirbas">
                          {demEylemler.map((e) => { const karar = e.id.split(':')[1]; return (
                            <button key={e.id} type="button" className={`gf-dem ${karar}`} disabled={demirbasSatirMut.isPending}
                              title={karar === 'elle_islendi' ? 'Belge kapanır: Luca\'da elle işlendi — Luca\'ya gönderilmez' : karar === 'yine_de_isle' ? 'Bilanço: 25x + KDV (satışta 679/689 taslağı); İşletme: Sabit Kıymet Alışı' : 'Uyarı kalkar, normal gider/gelir akışı; bu satıcı+içerik için bir daha sorulmaz'}
                              onClick={() => demirbasKarar(d.id, karar)}>{karar === 'elle_islendi' ? 'Elle işledim → kapat' : e.etiket}</button>
                          ); })}
                        </div>
                      )}
                    </td>
                    {/* Eylemler: 4 küçük ikon düğme (ipuçlu) — tek satır, sabit 140px; taşmaz. */}
                    <td className="gf-eylem"><div className="gf-acts">
                      <button type="button" className={`gf-act incele${fisAcik ? ' on' : ''}`} onClick={() => setFisDetayId(fisAcik ? '' : d.id)} title={fisAcik ? 'Detayı gizle' : (isIsletme ? 'İncele: kayıt türü + uyarılar + AI yorumu' : 'İncele: yevmiye fişi + uyarılar + AI yorumu')} aria-label="İncele"><Ico html={I.ledger} size={14} /></button>
                      <button type="button" className="gf-act duzenle" onClick={() => onOpenMuhasebe?.(d.id)} title="Düzenle: Muhasebeleştir ekranında aç" aria-label="Düzenle"><Ico html={I.edit} size={14} /></button>
                      <button type="button" className="gf-act onizle" onClick={() => openDocFile(d.id)} title="Önizle: belgeyi aç (PDF/görsel/XML)" aria-label="Önizle"><Ico html={I.eye} size={14} /></button>
                      <button type="button" className="gf-act sil" disabled={delMut.isPending || bulkDelMut.isPending} title="Sil" aria-label="Sil" onClick={() => { if (window.confirm(`Bu belge silinsin mi?\n${firma} · ${fmtMoney(d.totalAmount)} ₺${d.belgeNo ? ' · ' + d.belgeNo : ''}`)) delMut.mutate(d.id); }}><Ico html={I.trash} size={14} /></button>
                    </div></td>
                  </tr>
                  {fisAcik && (
                    <tr className="detayrow">
                      <td colSpan={isIsletme ? 9 : 10}>
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
                          {/* Faz 2 — TEK UYARI MODELİ kutusu: kod + seviye + öneri + tek-tık eylemler (demirbaş kararı, ilk belgeyi aç, alıcı tipi, öneriyi uygula). */}
                          {docUyarilar.length > 0 && (
                            <UyariKutusu doc={d} taxpayerId={taxpayerId}
                              onIlkBelge={(ilk) => { if (docs.some((x: any) => x.id === ilk)) setFisDetayId(ilk); else onOpenMuhasebe?.(ilk); }}
                              onAcEditor={(id) => onOpenMuhasebe?.(id)} />
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
                          {(() => { const sB = fisLines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0); const sA = fisLines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0); const msgs: string[] = []; if (fisLines.length > 0 && Math.abs(sB - sA) > 0.5) msgs.push(`Yevmiye dengesiz: Borç ${fmtMoney(sB)} ₺ ≠ Alacak ${fmtMoney(sA)} ₺ (${Math.abs(sB - sA).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ fark) — bir satır eksik/fazla.`); (Array.isArray(d.validationIssues) ? d.validationIssues : (Array.isArray(d.ocrData?.validationIssues) ? d.ocrData.validationIssues : [])).filter((i: any) => i?.code && i?.severity !== 'WARNING' && i?.severity !== 'INFO' && !['INCOMPLETE_AMOUNTS', 'TOTAL_MISMATCH', 'BALANCE_MISMATCH'].includes(i.code) && !(i.code === 'RETURN_NEEDS_REVERSAL' && fisLines.some((l: any) => /^61[01]/.test(String(l.accountCode || ''))))).forEach((i: any) => i.message && msgs.push(i.message)); return msgs.length ? <div className="celiskibanner"><b>Çelişki sebebi:</b>{msgs.map((m: string, k: number) => <div key={k}>• {m}</div>)}</div> : null; })()}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              {!docsQ.isLoading && docs.length === 0 && (
                <tr><td colSpan={isIsletme ? 11 : 12}><div className="empty">{docsAll.length > 0 && (gorevF || durumF !== 'all')
                  ? <>Bu süzgeçte belge yok. <a href="#tumu" onClick={(ev) => { ev.preventDefault(); setGorevF(''); setDurumF('all'); }}>Süzgeçleri kaldır</a> ({docsAll.length} belge)</>
                  : <>Bu dönemde {kind === 'SATIS' ? 'satış' : 'alış'} faturası yok. Üstten mükellef/dönem seç ya da entegratörden çek.</>}</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {tevkGrup && tevkGrup.length > 0 && (
          // Faz 2 — TEVKİFATLI AYRI ONAY GRUBU: "Onayla" bu belgeleri otomatik onaylamaz; burada (toplu çubuğun üstünde) görünür, ayrıca onaylanır.
          <div className="gf-tevk">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 13 }}>Tevkifatlı belgeler — ayrı onay grubu ({tevkGrup.length})</b>
              <span style={{ opacity: 0.8 }}>191 tam KDV + 360 sorumlu (alış) / 391 net KDV (satış) fişleri; oran ↔ tevkifat kodu ↔ hesap uyumunu kontrol edip onaylayın.</span>
              <div className="sp" />
              <button className="btn sm primary" disabled={approveMut.isPending} onClick={() => { approveMut.mutate({ ids: tevkGrup.map((t) => t.id) }); setTevkGrup(null); }}>Tevkifatlı {tevkGrup.length} belgeyi onayla</button>
              <button className="btn sm" onClick={() => setTevkGrup(null)}>Kapat</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tevkGrup.slice(0, 12).map((t) => <span key={t.id} className="uycip" style={{ color: UYARI_RENK.bilgi.fg, background: '#fff', borderColor: UYARI_RENK.bilgi.bd, cursor: 'pointer' }} onClick={() => setFisDetayId(t.id)}>{t.belgeNo || '—'} · {t.firma.slice(0, 22)} · {fmtMoney(t.tutar)} ₺{t.oran ? ` · ${t.oran}` : ''}</span>)}
              {tevkGrup.length > 12 ? <span className="uycip" style={{ color: '#64748b', background: '#fff', borderColor: '#e2e8f0' }}>+{tevkGrup.length - 12}</span> : null}
            </div>
          </div>
        )}
        {/* Toplu işlemler ÜST araç çubuğunda (kullanıcı kararı 2026-09-12: alt çubuk kaldırıldı). */}
        <div className="foot">
          <div className="selinfo">{docsAll.length} belge · {sayac.ok} {isIsletme ? 'hazır' : 'eşleşti'}{isIsletme ? '' : ` · ${sayac.miss} eksik kod`} · {sayac.warn} {isIsletme ? 'tutar/çelişki' : 'çelişki'}{durumF !== 'all' || gorevF ? ` · (süzgeç: ${docs.length})` : ''}</div>
          <div className="sp" />
          {docsAll.length >= 300 && <div className="pg">İlk 300 gösteriliyor — dönem/durum filtresiyle daralt</div>}
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: MÜKELLEFLER ===================== */
/* ===================== PLAN16-A: SORGU EKRANI YARDIMCILARI ===================== */
// Hazır tarih aralığı hapları (Sorgu şeridi). 'donem' = takvimdeki ayın tamamı (eski varsayılan: aralık
//   boş, sunucu ay dönemini kullanır), 'ozel' = elle girilen aralık. Diğerleri rangeFrom/rangeTo'yu
//   otomatik doldurur ve ay dönemini uyumlu tutar.
type SorguAralikHap = 'donem' | 'bu-ay' | 'gecen-ay' | 'son-30' | 'ceyrek' | 'ozel';
const SORGU_ARALIK_HAPLAR: Array<{ v: SorguAralikHap; l: string; t: string }> = [
  { v: 'donem', l: 'Seçili ay', t: 'Takvimdeki ayın tamamı (aralık girilmez)' },
  { v: 'bu-ay', l: 'Bu ay', t: 'Ayın 1’inden bugüne' },
  { v: 'gecen-ay', l: 'Geçen ay', t: 'Geçen ayın tamamı' },
  { v: 'son-30', l: 'Son 30 gün', t: 'Bugün dahil son 30 gün' },
  { v: 'ceyrek', l: 'Bu çeyrek', t: 'Çeyreğin ilk gününden bugüne' },
  { v: 'ozel', l: 'Özel', t: 'Başlangıç ve bitiş tarihini elle gir' },
];
function sorguYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** "2026-09-01" → "01.09.2026" (saat dilimi kaymasız, düz metin dönüşümü). */
function sorguTarihTr(ymd: string): string {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd || '');
}
/** Hap → {from,to,donem}. 'donem' ve 'ozel' için null (aralık boş kalır / elle girilir). */
function sorguAralikHesapla(hap: SorguAralikHap, bugun: Date = new Date()): { from: string; to: string; donem: string } | null {
  const y = bugun.getFullYear();
  const m = bugun.getMonth();
  const ay = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, '0')}`;
  if (hap === 'bu-ay') return { from: sorguYmd(new Date(y, m, 1)), to: sorguYmd(bugun), donem: ay(y, m) };
  if (hap === 'gecen-ay') {
    const ilk = new Date(y, m - 1, 1);
    return { from: sorguYmd(ilk), to: sorguYmd(new Date(y, m, 0)), donem: ay(ilk.getFullYear(), ilk.getMonth()) };
  }
  if (hap === 'son-30') return { from: sorguYmd(new Date(y, m, bugun.getDate() - 29)), to: sorguYmd(bugun), donem: ay(y, m) };
  if (hap === 'ceyrek') return { from: sorguYmd(new Date(y, Math.floor(m / 3) * 3, 1)), to: sorguYmd(bugun), donem: ay(y, m) };
  return null;
}
/** Aralığın kaç takvim ayına yayıldığı — liste uçları tek ayı süzdüğü için uyarı gösterilir. */
function sorguAralikAyAdedi(from: string, to: string): number {
  const a = String(from || '').match(/^(\d{4})-(\d{2})/);
  const b = String(to || '').match(/^(\d{4})-(\d{2})/);
  if (!a || !b) return 0;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) + 1;
}
/** Aralığın kapsadığı takvim ayları ('YYYY-MM' listesi; en çok 12). Liste uçları tek ay çektiği için çok-aylı
 *  aralıkta her ay ayrı istenip birleştirilir (kullanıcı bulgusu 2026-09-12: 'Son 30 gün / Bu çeyrek' seçince tablo
 *  yalnız seçili ayı gösteriyordu). */
function sorguAralikAylari(from: string, to: string): string[] {
  const a = String(from || '').match(/^(\d{4})-(\d{2})/);
  const b = String(to || '').match(/^(\d{4})-(\d{2})/);
  if (!a || !b) return [];
  const out: string[] = [];
  let y = Number(a[1]); let m = Number(a[2]);
  const yb = Number(b[1]); const mb = Number(b[2]);
  while ((y < yb || (y === yb && m <= mb)) && out.length < 12) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
/** Satırın tarihinden 'YYYY-MM' (geçersizse yedek ay). */
function sorguSatirAyi(tarih: any, yedek: string): string {
  const d = tarih ? new Date(tarih) : null;
  if (!d || Number.isNaN(d.getTime())) return yedek;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** Satır tarihi [from, to] içinde mi (gün bazlı, kapsayıcı)? Tarihsiz satır aralıktaki ay etiketiyle geçer. */
function sorguTarihAralikta(tarih: any, ayEtiketi: string, from: string, to: string, aylar: string[]): boolean {
  const d = tarih ? new Date(tarih) : null;
  if (!d || Number.isNaN(d.getTime())) return !ayEtiketi || aylar.includes(ayEtiketi);
  const ymd = sorguYmd(d);
  return ymd >= from && ymd <= to;
}
/** İş dönem etiketi ("2026-09" ya da aralıklı sorguda "2026-09-01_2026-09-12") seçili ay/aralıkla
 *  örtüşüyor mu? Eski birebir karşılaştırma aralıklı işleri kaçırıyordu → "çekiliyor" şeridi çıkmıyordu. */
function sorguIsDonemUyar(jobDonem: string, donem: string, from: string, to: string): boolean {
  const jd = String(jobDonem || '').trim();
  if (!jd || jd === donem) return true;
  if (from && to && jd === `${from}_${to}`) return true;
  const m = jd.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (!m) return jd.startsWith(donem);
  return m[1] <= `${donem}-31` && m[2] >= `${donem}-01`;
}
/** Saat etiketi: bugünse "12:41", değilse "26.08 12:41". */
function sorguSaat(v: any): string {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const saat = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === new Date().toDateString()) return saat;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${saat}`;
}
/** ONAY hapı: GİB/entegratör durum metnini sınıfa indirger (Onaylandı / Otomatik / Onay bekliyor /
 *  İptal / Red / İtiraz / Silinmiş). İptal-itiraz metni öncelikli; tanınmayan metin olduğu gibi kalır. */
function sorguOnayHap(onay: any, iptal?: any): { k: 'onay' | 'oto' | 'bekliyor' | 'iptal' | 'red' | 'itiraz' | 'silinmis' | 'diger'; l: string } {
  const o = String(onay || '').trim();
  const oN = o.toLocaleLowerCase('tr-TR');
  const iN = String(iptal || '').trim().toLocaleLowerCase('tr-TR');
  if (iN && iN !== 'yok' && iN !== '-' && iN !== '—') {
    if (/iptal|cancel/.test(iN)) return { k: 'iptal', l: 'İptal' };
    if (/itiraz/.test(iN)) return { k: 'itiraz', l: 'İtiraz' };
    if (/red|reject/.test(iN)) return { k: 'red', l: 'Red' };
  }
  if (/iptal|cancel/.test(oN)) return { k: 'iptal', l: 'İptal' };
  if (/itiraz/.test(oN)) return { k: 'itiraz', l: 'İtiraz' };
  if (/^red|\bred\b|reddedil|reject/.test(oN)) return { k: 'red', l: 'Red' };
  if (/silin|delete/.test(oN)) return { k: 'silinmis', l: 'Silinmiş' };
  if (/onaylanmad|bekl|wait|pending|taslak|draft|imzasız|imzasiz/.test(oN)) return { k: 'bekliyor', l: 'Onay bekliyor' };
  if (/otomatik|auto/.test(oN)) return { k: 'oto', l: 'Otomatik' };
  if (/onayland|approved|success|imzal|signed|kabul|accept|\bok\b/.test(oN)) return { k: 'onay', l: 'Onaylandı' };
  return { k: 'diger', l: o || '—' };
}
/** e-Arşiv iş ilerlemesi: payload.progress.current/total varsa belirli (login denemesi sayacı hariç);
 *  yoksa ilerleme mesajındaki "N/M satir"; o da yoksa belirsiz animasyon. */
function sorguIsIlerleme(job: any): { belirli: boolean; cur: number; tot: number; pct: number; mesaj: string } {
  const p = job?.payload?.progress && typeof job.payload.progress === 'object' ? job.payload.progress : null;
  const mesaj = String(p?.message || '').trim();
  const step = String(p?.step || '').toLowerCase();
  let cur = /login/.test(step) ? NaN : Number(p?.current);
  let tot = /login/.test(step) ? NaN : Number(p?.total);
  if (!(tot > 0)) {
    const m = mesaj.match(/(\d+)\s*\/\s*(\d+)\s*sat[ıi]r/i);
    if (m) { cur = Number(m[1]); tot = Number(m[2]); }
  }
  const belirli = tot > 0 && Number.isFinite(cur) && cur >= 0;
  return { belirli, cur: belirli ? cur : 0, tot: belirli ? tot : 0, pct: belirli ? Math.min(100, Math.round((cur / tot) * 100)) : 0, mesaj };
}
/** Entegratör rozeti rengi (sağlayıcı koduna göre sabit palet; bilinmeyen → accent). */
const SORGU_PROV_RENK: Record<string, string> = {
  GIB_PORTAL: '#b45309', TURMOB_EFATURA: '#b91c1c', TURKCELL: '#ca8a04', PARASUT: '#7c3aed', ELOGO: '#2563eb',
  UYUMSOFT: '#2563eb', MIKRO: '#7c3aed', IZIBIZ: '#4f46e5', KOLAYSOFT: '#15803d', FORIBA: '#b45309', LOGO_ISBASI: '#a16207', NILVERA: '#0891b2',
  ECZACIKART: '#15803d',
};
function sorguProvRenk(provider: any): string {
  return SORGU_PROV_RENK[String(provider || '').toUpperCase()] || 'var(--accent)';
}

function ScreenSorgu({ taxpayerId, period, source, onOpenEntegrator }: { taxpayerId: string; period: string; source: 'earsiv' | 'efatura'; onOpenEntegrator?: () => void }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Set<string>>(new Set());
  // SERBEST TARİH ARALIĞI (Mihsap örneği — kullanıcı talebi): boş bırakılırsa eski davranış (üstteki
  //   ay/dönem seçici) geçerli kalır; doldurulursa Sorgula bu aralığa göre çalışır.
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  // PLAN16-A — Sorgu şeridi: hazır aralık hapı + şeritteki dönem takvimi. Şerit dönemi üst çubuktaki
  //   dönemden başlar, üst çubuk değişince yeniden eşitlenir; haplar aralığı doldurup ayı uyumlu tutar.
  const [aralikHap, setAralikHap] = useState<SorguAralikHap>('donem');
  const [sorguDonem, setSorguDonem] = useState(period);
  // PLAN16-A — Özet sayaç süzgeci, tablo içi arama, sütun sıralama, e-Fatura son sorgu zamanı.
  const [ozetF, setOzetF] = useState<'' | 'aktarilabilir' | 'aktarilmis' | 'iptal' | 'bekleyen'>('');
  const [ara, setAra] = useState('');
  const [sirala, setSirala] = useState<{ k: 'tarih' | 'tutar' | 'unvan'; d: 'asc' | 'desc' }>({ k: 'tarih', d: 'desc' });
  const [efaturaSonSorguAt, setEfaturaSonSorguAt] = useState(0);
  // Etkin dönem: tüm veri çağrıları (liste, sorgu, aktarım, eşitleme) bu ayı kullanır.
  const donem = sorguDonem || period;
  const aralikHapRef = useRef<SorguAralikHap>('donem');
  aralikHapRef.current = aralikHap;
  useEffect(() => {
    // Üst çubuktaki dönem değişti → şerit takvimi ona uyar; "bugüne" bağlı haplar anlamını yitirir → Seçili ay.
    setSorguDonem(period);
    if (aralikHapRef.current !== 'ozel' && aralikHapRef.current !== 'donem') { setAralikHap('donem'); setRangeFrom(''); setRangeTo(''); }
  }, [period]);
  useEffect(() => { setOzetF(''); setAra(''); }, [source, taxpayerId]);
  const aralikUygula = (hap: SorguAralikHap) => {
    setAralikHap(hap);
    if (hap === 'donem') { setRangeFrom(''); setRangeTo(''); return; }
    const r = sorguAralikHesapla(hap);
    if (!r) return; // Özel: mevcut alanlar korunur, kullanıcı elle girer
    setRangeFrom(r.from); setRangeTo(r.to); setSorguDonem(r.donem);
  };
  const donemSec = (v: string) => {
    setSorguDonem(v);
    // Takvimden ay seçildi: "Bu ay / Geçen ay" bugüne bağlıdır, artık o ayı anlatmaz → Seçili ay (tam ay).
    if (aralikHap === 'bu-ay' || aralikHap === 'gecen-ay') { setAralikHap('donem'); setRangeFrom(''); setRangeTo(''); }
  };
  // Aralık doğrulama: başlangıç > bitiş = sorgu YAPILMAZ (buton kilitli + uyarı). Tek alan doluysa
  //   aralık sorguya GİTMEZ (backend ay dönemine düşer) — kullanıcıya sessizce değil, açıkça söyle.
  const rangeInvalid = !!rangeFrom && !!rangeTo && rangeFrom > rangeTo;
  const rangePartial = !rangeInvalid && (!!rangeFrom !== !!rangeTo);
  const rangeAktif = !!rangeFrom && !!rangeTo && !rangeInvalid;
  const aralikAyAdedi = rangeAktif ? sorguAralikAyAdedi(rangeFrom, rangeTo) : 1;
  // Çok-aylı aralıkta liste her ayı ayrı çekip birleştirir (tek ay = eski davranış). Anahtar: ay listesi.
  const listeAylar: string[] = rangeAktif && aralikAyAdedi > 1 ? sorguAralikAylari(rangeFrom, rangeTo) : [donem];
  const listeAylarKey = listeAylar.join(',');
  const cokAyli = listeAylar.length > 1;
  const cokAyliSuz = (satirlar: any[], tarihAlani: string, ayAlani?: string) => {
    if (!cokAyli) return satirlar;
    const gorulen = new Set<string>();
    return satirlar.filter((r: any) => {
      const k = String(r?.id || r?.sourceRefId || r?.uuid || '');
      if (k) { if (gorulen.has(k)) return false; gorulen.add(k); }
      return sorguTarihAralikta(r?.[tarihAlani], ayAlani ? String(r?.[ayAlani] || '') : '', rangeFrom, rangeTo, listeAylar);
    });
  };
  const [efaturaChannel, setEfaturaChannel] = useState<'IN_EFATURA' | 'OUT_EFATURA' | 'OUT_EARSIV'>('IN_EFATURA');
  const [lastEfaturaSync, setLastEfaturaSync] = useState<any>(null);
  const [efaturaPollUntil, setEfaturaPollUntil] = useState(0);
  const [efaturaSyncPollUntil, setEfaturaSyncPollUntil] = useState(0);
  const efaturaDirection: 'IN' | 'OUT' = efaturaChannel === 'IN_EFATURA' ? 'IN' : 'OUT';
  // Aktif (pending/running) e-Arşiv işi var mı? Cache'teki iş listesinden bakılır → polling hızını ayarlar.
  const isEarsivJobActive = (jobs: any): boolean =>
    Array.isArray(jobs) && jobs.some((j: any) => ['pending', 'running'].includes(String(j.status || '').toLowerCase()));
  const earsivQ = useQuery({
    queryKey: ['fm-earsiv-sorgu', taxpayerId, listeAylarKey],
    queryFn: async () => {
      const parcalar = await Promise.all(listeAylar.map(async (ay) => (await api.get('/portal-automation/earsiv/invoices', { params: { taxpayerId, period: ay, limit: 500 } })).data));
      return cokAyliSuz(parcalar.flatMap((x: any) => (Array.isArray(x) ? x : [])), 'issuedAt', 'period');
    },
    enabled: !!taxpayerId && source === 'earsiv',
    // Aktif iş varken hızlı (2sn) → satırlar canlı insin; iş yokken seyrelt (10sn) → boş yük olmasın.
    refetchInterval: () => source === 'earsiv'
      ? (isEarsivJobActive(qc.getQueryData(['fm-earsiv-jobs', taxpayerId])) ? 2000 : 10000)
      : false,
  });
  const jobsQ = useQuery({
    queryKey: ['fm-earsiv-jobs', taxpayerId],
    queryFn: async () => {
      // limit 12→40: liste kiracı geneli döner, mükellefe göre burada süzülür; çok mükellefli ofiste
      //   "son sorgu" bilgisi 12 kayıtla kaybolabiliyordu (PLAN16-A).
      const r = await api.get('/portal-automation/jobs', { params: { jobType: 'EARSIV_PORTAL_FETCH', limit: 40 } });
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
    // Aralıklı sorgu işleri "AA-GG_AA-GG" etiketi taşır → birebir eşitlik yerine örtüşme (PLAN16-A).
    if (!sorguIsDonemUyar(jobPeriod, donem, rangeFrom, rangeTo)) return false;
    const updated = new Date(j.updatedAt || j.createdAt || 0).getTime();
    return !updated || Date.now() - updated < 10 * 60 * 1000;
  });
  const waitForFirstRows = !!activeJob && rows.length === 0;
  // İŞ SÜRÜYOR göstergesi (kullanıcı: "faturalar çekiliyor şeridi çıkmıyor"): satır gelmiş olsa bile
  //   iş (belge indirme/prefetch) hâlâ pending/running ise gösterge kalsın (hesap planındaki gibi).
  const earsivJobRunning = !!activeJob;
  const lastJob = (jobsQ.data || [])[0];
  // "Son sorgu: 12:41 · 26 satır" bilgisi — seçili ay/aralıkla örtüşen son TAMAMLANMIŞ iş (PLAN16-A).
  const sonBitenIs = (jobsQ.data || []).find((j: any) =>
    ['done', 'success', 'completed', 'failed', 'cancelled'].includes(String(j.status || '').toLowerCase())
    && sorguIsDonemUyar(String(j?.payload?.donem || j?.donem || '').trim(), donem, rangeFrom, rangeTo));
  const earsivSonSorgu = sonBitenIs
    ? { saat: sorguSaat(sonBitenIs.finishedAt || sonBitenIs.updatedAt), satir: Number(sonBitenIs.recordCount || 0), durum: String(sonBitenIs.status || '').toLowerCase(), hata: String(sonBitenIs.errorMessage || '') }
    : null;
  const earsivIlerleme = sorguIsIlerleme(activeJob);
  useEffect(() => {
    if (source !== 'earsiv' || !taxpayerId) return;
    const status = String(lastJob?.status || '').toLowerCase();
    if (['done', 'success', 'completed', 'failed'].includes(status)) {
      qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu', taxpayerId] });
    }
  }, [source, taxpayerId, donem, lastJob?.id, lastJob?.status, lastJob?.updatedAt, qc]);
  // AKTARIM anlamı e-Fatura ile AYNI (kullanıcı bulgusu 2026-09-12): 'aktarıldı' = Fatura Merkezi'ne alındı (zatenVar);
  //   Luca durumu (lucaDurumu) yalnız ek bilgi. Eski 'aktarildi' alanı yalnız Luca POSTED'i sayıyordu → 10 aktarılmış
  //   fatura 'aktarılabilir' görünüyor, sayaç ilerlemiyor ve mükerrer aktarım riski doğuyordu.
  const earsivAktarildi = (r: any) => !!(r?.zatenVar || r?.muhasebeBelgeId || r?.aktarildi);
  const processable = rows.filter((r) => r.isProcessable && !earsivAktarildi(r));
  const selectedRefs = [...sel];
  const toggle = (ref: string) => setSel((prev) => { const n = new Set(prev); n.has(ref) ? n.delete(ref) : n.add(ref); return n; });

  const sorgulaMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/integrations/fetch', {
      taxpayerId,
      direction: 'SATIS',
      donem,
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
      // Aktarım ucu tek ayı süzer → çok-aylı listede seçimler AYINA göre gruplanır, her ay ayrı çağrılır.
      const refAyi = new Map<string, string>();
      rows.forEach((r: any) => { if (r?.sourceRefId) refAyi.set(String(r.sourceRefId), sorguSatirAyi(r.issuedAt, String(r.period || donem))); });
      const gruplar = new Map<string, string[]>();
      refs.forEach((ref: string) => { const ay = cokAyli ? (refAyi.get(String(ref)) || donem) : donem; gruplar.set(ay, [...(gruplar.get(ay) || []), ref]); });
      if (!gruplar.size) gruplar.set(donem, []);
      let sync: any = null; let imported = 0; let processed = 0;
      for (const [ay, ayRefs] of gruplar) {
        sync = await api.post('/portal-automation/earsiv/accounting-sync', { taxpayerId, period: ay, selectedRefs: ayRefs });
        imported += Number(sync?.data?.imported || 0);
        processed += Number(sync?.data?.processed || 0);
      }
      sync = { ...sync, data: { ...(sync?.data || {}), imported, processed } };
      if (imported === 0 && processed === 0 && refs.length > 0) {
        let fallback: any = null;
        for (const [ay, ayRefs] of gruplar) {
          fallback = await api.post('/fatura-muhasebelestirme/integrations/fetch', {
            taxpayerId,
            direction: 'SATIS',
            donem: ay,
            providers: ['GIB_PORTAL'],
            mode: 'download',
            selectedRefs: ayRefs,
          });
        }
        return { ...sync, data: { ...(sync.data || {}), fallbackQueued: true, fallback: fallback?.data } };
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
    mutationFn: () => api.post('/portal-automation/earsiv/accounting-sync', { taxpayerId, period: donem }),
    onSuccess: (r: any) => {
      toast.success(`Senkron tamamlandı · ${r?.data?.imported || 0} yeni belge`);
      qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu'] });
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Durum eşitlenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // PLAN16-A — süren e-Arşiv işini iptal et (POST /portal-automation/jobs/:id/cancel, gövde boş).
  //   e-Fatura senkronu için iptal ucu YOK → orada iptal düğmesi gösterilmez.
  const cancelMut = useMutation({
    mutationFn: (jobId: string) => api.post(`/portal-automation/jobs/${jobId}/cancel`, {}),
    onSuccess: () => {
      toast.success('Sorgu iptal edildi.');
      qc.invalidateQueries({ queryKey: ['fm-earsiv-jobs'] });
      qc.invalidateQueries({ queryKey: ['fm-earsiv-sorgu'] });
    },
    onError: (e: any) => toast.error('İptal edilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });

  const integrations: any[] = Array.isArray(integrationsQ.data) ? integrationsQ.data : [];
  const efaturaProviders = integrations
    .filter((p) => String(p.kind || '').toLowerCase() === 'efatura' || /EFATURA|ELOGO|UYUMSOFT|MIKRO|IZIBIZ|KOLAYSOFT|FORIBA|PARASUT|TURMOB/i.test(String(p.provider || '')))
    .sort((a, b) => (String(a.provider || '') === 'TURMOB_EFATURA' ? -1 : 0) - (String(b.provider || '') === 'TURMOB_EFATURA' ? -1 : 0));
  const providerConnected = (p: any) => Boolean(p?.connected ?? p?.configured);
  const connectedEfaturaProviders = efaturaProviders.filter(providerConnected);
  // Mükellefe BAĞLI (ya da en azından bu mükellef için tanımlanmış/yapılandırılmış) sağlayıcı yoksa NULL:
  //   katalogdaki ilk sağlayıcıya (TÜRMOB) DÜŞME — kullanıcı bulgusu (2026-09-12): entegratörü hiç olmayan
  //   mükellefte "TURMOB Alış e-Fatura · kimlik eksik" kırmızı görünüyordu; doğrusu "Entegratör tanımlı değil".
  const activeEfaturaProvider = connectedEfaturaProviders[0]
    || efaturaProviders.find((p) => p?.taxpayerScoped || p?.configured)
    || null;
  const efaturaInboxQ = useQuery({
    queryKey: ['fm-efatura-inbox', taxpayerId, listeAylarKey, efaturaDirection, efaturaChannel],
    queryFn: async () => {
      const parcalar = await Promise.all(listeAylar.map(async (ay) => (await api.get('/fatura-muhasebelestirme/efatura-inbox', { params: { taxpayerId, period: ay, direction: efaturaDirection, channel: efaturaChannel, limit: 2000 } })).data));
      return cokAyliSuz(parcalar.flatMap((x: any) => (Array.isArray(x) ? x : [])), 'faturaDate');
    },
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
    // TÜRKÇE 'İ' TUZAĞI (2026-09-15, ŞENNİK SN22026000000267 "İptal (TÜRMOB etiketi)"): /i bayrağı 'İ' (U+0130) harfini 'i'ye katlamaz →
    //   satır "İptal" görünürken sayaç "aktarılabilir" sayıyordu. tr-TR küçük harfe çevirip bak. silin: GİB "Silinmiş" aktarılmaz.
    const durumMetni = `${raw?.approvalStatus || ''} ${raw?.iptalItiraz || ''}`.toLocaleLowerCase('tr-TR');
    return !/iptal|itiraz|red|cancel|silin/.test(durumMetni);
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
  useEffect(() => {
    setLastEfaturaSync(null);
    setSel(new Set());
  }, [source, taxpayerId, donem, efaturaChannel]);
  const efaturaFetchMut = useMutation({
    mutationFn: (v: { provider: string }) => api.post('/fatura-muhasebelestirme/efatura-sync', {
      taxpayerId,
      direction: efaturaDirection,
      channel: efaturaChannel,
      period: donem,
      ...(rangeFrom && rangeTo ? { dateFrom: rangeFrom, dateTo: rangeTo } : {}),
      providers: [v.provider],
      limit: 2000,
    }),
    onSuccess: (r: any) => {
      const data = r?.data || null;
      setEfaturaSonSorguAt(Date.now());
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
    mutationFn: async () => {
      const ids = efaturaSelectedIds.length ? efaturaSelectedIds : efaturaTransferableIds;
      // İçe aktarım ucu tek ayı süzer → çok-aylı listede id'ler AYINA göre gruplanır, her ay ayrı çağrılır.
      const idAyi = new Map<string, string>();
      efaturaRows.forEach((r: any) => { if (r?.id) idAyi.set(String(r.id), sorguSatirAyi(r.faturaDate, donem)); });
      const gruplar = new Map<string, string[]>();
      ids.forEach((id: string) => { const ay = cokAyli ? (idAyi.get(String(id)) || donem) : donem; gruplar.set(ay, [...(gruplar.get(ay) || []), id]); });
      if (!gruplar.size) gruplar.set(donem, []);
      let son: any = null; let imported = 0; let processed = 0; let failed = 0; let queued = false;
      for (const [ay, ayIds] of gruplar) {
        son = await api.post('/fatura-muhasebelestirme/efatura-inbox/import', {
          taxpayerId, direction: efaturaDirection, channel: efaturaChannel, period: ay, ids: ayIds, limit: 2000, background: true,
        });
        imported += Number(son?.data?.imported || 0); processed += Number(son?.data?.processed || 0); failed += Number(son?.data?.failed || 0);
        if (son?.data?.queued) queued = true;
      }
      return { ...son, data: { ...(son?.data || {}), imported, processed, failed, ...(queued ? { queued: true } : {}) } };
    },
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

  // ══ PLAN16-A GÖRÜNÜM KATMANI — özet sayaçları, sayaç süzgeci, tablo içi arama, sütun sıralama.
  //    Yalnız GÖSTERİMİ düzenler; yukarıdaki veri/uç mantığına dokunmaz.
  const araN = ara.trim().toLocaleLowerCase('tr-TR');
  const araUyar = (...parcalar: any[]) => !araN || parcalar.some((p) => String(p || '').toLocaleLowerCase('tr-TR').includes(araN));
  const siralaTikla = (k: 'tarih' | 'tutar' | 'unvan') => setSirala((s) => (s.k === k ? { k, d: s.d === 'asc' ? 'desc' : 'asc' } : { k, d: k === 'unvan' ? 'asc' : 'desc' }));
  const siralaOk = (k: 'tarih' | 'tutar' | 'unvan') => (sirala.k === k ? (sirala.d === 'asc' ? '▲' : '▼') : '↕');
  const zaman = (v: any) => { const t = new Date(v || 0).getTime(); return v && Number.isFinite(t) ? t : -Infinity; };
  const sayi = (v: any) => { const n = Number(v); return v == null || !Number.isFinite(n) ? -Infinity : n; };
  const karsilastir = (a: { tarih: number; tutar: number; unvan: string }, b: { tarih: number; tutar: number; unvan: string }) => {
    const yon = sirala.d === 'asc' ? 1 : -1;
    if (sirala.k === 'unvan') return yon * a.unvan.localeCompare(b.unvan, 'tr-TR');
    const av = sirala.k === 'tarih' ? a.tarih : a.tutar;
    const bv = sirala.k === 'tarih' ? b.tarih : b.tutar;
    if (av === bv) return b.tarih - a.tarih || 0;
    return yon * (av < bv ? -1 : 1);
  };
  type SqAkt = { k: 'ok' | 'kuyruk' | 'muh' | 'yok'; l: string; t: string };
  // e-Arşiv satırları: ONAY hapı (onayDurumu + iptalDurumu), AKTARIM (lucaDurumu/aktarildi/zatenVar), seçilebilirlik.
  const earsivGorunum = rows.map((r) => {
    const onay = sorguOnayHap(r.onayDurumu, r.iptalDurumu);
    const luca = String(r.lucaDurumu || '').toUpperCase();
    const muh = String(r.muhasebeDurumu || '').toUpperCase();
    const akt: SqAkt = !earsivAktarildi(r)
      ? { k: 'yok', l: '—', t: "Henüz Fatura Merkezi'ne aktarılmadı" }
      : (luca === 'POSTED' || luca === 'MANUAL_DONE')
        ? { k: 'ok', l: "✓ aktarıldı · Luca'da", t: "Fatura Merkezi'ne aktarıldı ve Luca'ya işlendi" }
        : (luca === 'QUEUED' || luca === 'POSTING' || muh === 'APPROVED')
          ? { k: 'ok', l: '✓ aktarıldı · onaylı', t: "Fatura Merkezi'nde onaylandı — Luca aktarım kuyruğunda" }
          : { k: 'ok', l: '✓ aktarıldı', t: "Fatura Merkezi'ne aktarıldı (Gelen Faturalar) — henüz onaylanmadı" };
    return { r, onay, akt, secilebilir: !!r.isProcessable && !earsivAktarildi(r) && !!r.sourceRefId, tarih: zaman(r.issuedAt), tutar: sayi(r.toplam), unvan: String(r.buyerName || '') };
  });
  const earsivSayac = {
    toplam: rows.length,
    aktarilabilir: processable.length,
    aktarilmis: rows.filter((r) => earsivAktarildi(r)).length,
    // Onay bekleyen (imzasız) belge sunucuda artık işlenmez (isProcessable=false, 2026-09-15) → iptal sayacına DEĞİL, kendi sayacına.
    iptal: earsivGorunum.filter((g) => !g.r.isProcessable && g.onay.k !== 'bekliyor').length,
    bekleyen: earsivGorunum.filter((g) => g.onay.k === 'bekliyor').length,
  };
  const earsivSuz = earsivGorunum.filter((g) => {
    if (ozetF === 'aktarilabilir' && !(g.r.isProcessable && !earsivAktarildi(g.r))) return false;
    if (ozetF === 'aktarilmis' && !earsivAktarildi(g.r)) return false;
    if (ozetF === 'iptal' && (g.r.isProcessable || g.onay.k === 'bekliyor')) return false;
    if (ozetF === 'bekleyen' && g.onay.k !== 'bekliyor') return false;
    return araUyar(g.r.buyerName, g.r.buyerVkn, g.r.belgeNo, g.r.referenceNo, g.r.ettn);
  }).sort(karsilastir);
  const earsivGorunenSecilebilir = earsivSuz.filter((g) => g.secilebilir).map((g) => String(g.r.sourceRefId));
  const earsivHepsiSecili = earsivGorunenSecilebilir.length > 0 && earsivGorunenSecilebilir.every((ref) => sel.has(ref));
  const earsivGorunenSec = () => setSel((prev) => {
    const n = new Set(prev);
    if (earsivHepsiSecili) earsivGorunenSecilebilir.forEach((ref) => n.delete(ref)); else earsivGorunenSecilebilir.forEach((ref) => n.add(ref));
    return n;
  });
  // e-Fatura satırları: karşı taraf ünvanı (backend UBL'den çözüp receiverTitle/senderTitle döndürüyor;
  //   eskisi yedek), ONAY hapı (approvalStatus + iptalItiraz), AKTARIM (aktarıldı / kuyrukta / belge iniyor / inemedi).
  const efaturaGorunum = efaturaRows.map((r) => {
    const raw = r.rawJson && typeof r.rawJson === 'object' ? r.rawJson : {};
    const title = efaturaDirection === 'OUT'
      ? (r.receiverTitle || raw.receiverTitle || raw.alici || r.receiverVkn)
      : (r.senderTitle || raw.senderTitle || raw.satici);
    const taxNo = efaturaDirection === 'OUT' ? (r.receiverVkn || raw.receiverVkn || raw.aliciVergiNo) : (r.senderVkn || raw.senderVkn || raw.saticiVergiNo);
    const approvalRaw = raw.onayDurumu || raw.approvalStatus || raw.status || raw.invoiceStatus || '';
    const onay = sorguOnayHap(approvalRaw, raw.iptalItiraz);
    const transferred = efaturaIsTransferred(r);
    const docStatus = efaturaDocumentStatus(r);
    const missingOriginal = docStatus === 'MISSING' || docStatus === 'SUMMARY_ONLY';
    const rowId = String(r.id || '').trim();
    const selectable = efaturaCanImport(r) && !!rowId;
    const iptalMi = !transferred && !efaturaCanImport(r);
    const kuyrukta = !transferred && selectable && docStatus === 'READY' && (efaturaImportMut.isPending || efaturaQueuedImport || efaturaImportRunning);
    const akt: SqAkt = transferred
      ? { k: 'ok', l: '✓ aktarıldı', t: 'Bekleyen listeye aktarıldı' }
      : kuyrukta
        ? { k: 'kuyruk', l: '⏳ kuyrukta', t: 'Aktarım sırasında' }
        : docStatus === 'PENDING_DOWNLOAD'
          ? { k: 'kuyruk', l: '⏳ belge iniyor', t: 'Belge arka planda indiriliyor' }
          : missingOriginal
            ? { k: 'yok', l: '— inemedi', t: 'Orijinal belge indirilemedi; aktarımda yeniden denenir' }
            : { k: 'yok', l: '—', t: 'Aktarılmadı' };
    const prov = String(r.entegrator || '');
    const provLabel = integrations.find((p) => String(p?.provider || '') === prov)?.label || prov || 'Entegratör';
    return { r, title, taxNo, approvalRaw, onay, akt, transferred, missingOriginal, rowId, selectable, iptalMi, prov, provLabel, tarih: zaman(r.faturaDate), tutar: sayi(r.toplam), unvan: String(title || '') };
  });
  const efaturaSayac = {
    toplam: efaturaRows.length,
    aktarilabilir: efaturaTransferableRows.length,
    aktarilmis: efaturaTransferredCount,
    iptal: efaturaGorunum.filter((g) => g.iptalMi).length,
    bekleyen: efaturaGorunum.filter((g) => !g.iptalMi && g.onay.k === 'bekliyor').length,
  };
  const efaturaSuz = efaturaGorunum.filter((g) => {
    if (ozetF === 'aktarilabilir' && !g.selectable) return false;
    if (ozetF === 'aktarilmis' && !g.transferred) return false;
    if (ozetF === 'iptal' && !g.iptalMi) return false;
    if (ozetF === 'bekleyen' && !(!g.iptalMi && g.onay.k === 'bekliyor')) return false;
    return araUyar(g.title, g.taxNo, g.r.faturaNo, g.r.uuid);
  }).sort(karsilastir);
  const efaturaGorunenSecilebilir = efaturaSuz.filter((g) => g.selectable).map((g) => g.rowId);
  const efaturaHepsiSecili = efaturaGorunenSecilebilir.length > 0 && efaturaGorunenSecilebilir.every((id) => sel.has(id));
  const efaturaGorunenSec = () => setSel((prev) => {
    const n = new Set(prev);
    if (efaturaHepsiSecili) efaturaGorunenSecilebilir.forEach((id) => n.delete(id)); else efaturaGorunenSecilebilir.forEach((id) => n.add(id));
    return n;
  });
  const sayac = source === 'earsiv' ? earsivSayac : efaturaSayac;
  const ozetKartlar: Array<{ v: '' | 'aktarilabilir' | 'aktarilmis' | 'iptal' | 'bekleyen'; l: string; c: string; n: number }> = [
    { v: '', l: 'Toplam', c: 'var(--accent)', n: sayac.toplam },
    { v: 'aktarilabilir', l: 'Aktarılabilir', c: '#15803d', n: sayac.aktarilabilir },
    { v: 'aktarilmis', l: 'Aktarılmış', c: '#2563eb', n: sayac.aktarilmis },
    { v: 'iptal', l: 'İptal / İtiraz / Red', c: '#e5484d', n: sayac.iptal },
    { v: 'bekleyen', l: 'Onay bekleyen', c: '#d97706', n: sayac.bekleyen },
  ];
  // e-Fatura sorgu aşaması (arka plan senkron dâhil) sürüyor mu? Sunucu durumu + yerel poll penceresi.
  const efaturaBgProvider = ['TURKCELL', 'TURMOB_EFATURA'].includes(String(activeEfaturaProvider?.provider));
  const efaturaBgSyncRunning = efaturaBgProvider
    && (efaturaSyncPollUntil > Date.now() || efaturaSyncStatus?.state === 'running')
    && (!efaturaSyncStatus || (efaturaSyncStatus.state !== 'done' && efaturaSyncStatus.state !== 'error'));
  const efaturaSorguSuruyor = efaturaFetchMut.isPending || (efaturaQueuedActive && efaturaQueuedSync) || efaturaBgSyncRunning;
  // e-Fatura "son sorgu" bilgisi: arka plan senkronun sunucu kaydı (finishedAt + added) daha yeniyse o;
  //   değilse bu oturumdaki son Sorgula yanıtı (fetched toplamı).
  const efaturaSrvBitisAt = efaturaSyncStatus?.finishedAt ? new Date(efaturaSyncStatus.finishedAt).getTime() : 0;
  const efaturaSonSorgu = (efaturaSrvBitisAt && efaturaSrvBitisAt >= efaturaSonSorguAt && ['done', 'error'].includes(String(efaturaSyncStatus?.state)))
    ? { saat: sorguSaat(efaturaSyncStatus.finishedAt), satir: Number(efaturaSyncStatus.added || 0), yeni: true, hata: efaturaSyncStatus.state === 'error' ? String(efaturaSyncStatus.error || 'sorgu tamamlanamadı') : '' }
    : efaturaSonSorguAt
      ? { saat: sorguSaat(efaturaSonSorguAt), satir: efaturaStatusRows.reduce((a, p) => a + Number(p?.fetched || 0), 0) || efaturaRows.length, yeni: false, hata: '' }
      : null;
  const providerKimlikDetay = (p: any) => [
    p?.username ? `kullanıcı: ${p.username}` : null,
    p?.hasApiKey ? 'API anahtarı tanımlı' : null,
    p?.hasPassword ? 'şifre tanımlı' : null,
    p?.lastSyncAt ? `son çekim: ${fmtDate(p.lastSyncAt)}` : null,
  ].filter(Boolean).join(' · ');
  const sorgulaDisabled = source === 'earsiv'
    ? (!taxpayerId || rangeInvalid || sorgulaMut.isPending || waitForFirstRows || earsivJobRunning)
    : (!taxpayerId || rangeInvalid || !providerConnected(activeEfaturaProvider) || efaturaOverlayBusy);
  const sorgulaMetin = source === 'earsiv'
    ? (sorgulaMut.isPending ? 'Sorgulanıyor…' : earsivJobRunning ? 'Sorgu sürüyor…' : 'Sorgula')
    : ((efaturaFetchMut.isPending || efaturaQueuedSync) ? 'Sorgulanıyor…' : 'Sorgula');
  const sorgula = () => {
    if (source === 'earsiv') { sorgulaMut.mutate(); return; }
    if (activeEfaturaProvider?.provider) efaturaFetchMut.mutate({ provider: activeEfaturaProvider.provider });
  };
  const aralikMetin = rangeAktif ? `${sorguTarihTr(rangeFrom)} – ${sorguTarihTr(rangeTo)}` : `${periodLabel(donem)} (ayın tamamı)`;
  const gorunenAdet = source === 'earsiv' ? earsivSuz.length : efaturaSuz.length;
  const toplamAdet = source === 'earsiv' ? rows.length : efaturaRows.length;
  const secimAdet = source === 'earsiv' ? selectedRefs.length : efaturaSelectedIds.length;
  const efaturaKanalSecenek: Array<{ v: 'IN_EFATURA' | 'OUT_EFATURA' | 'OUT_EARSIV'; l: string }> = [
    { v: 'IN_EFATURA', l: 'Alış e-Fatura' }, { v: 'OUT_EFATURA', l: 'Satış e-Fatura' }, { v: 'OUT_EARSIV', l: 'Satış e-Arşiv' },
  ];

  return (
    <section className="screen sorgu-screen sq-screen">
      <div className="h2">{source === 'earsiv' ? 'GİB e-Arşiv Sorgu' : 'e-Fatura Sorgu'}</div>

      {/* ── SORGU ŞERİDİ (tek kart): dönem takvimi + hazır aralık hapları + tarih aralığı + Sorgula + ilerleme/iptal + son sorgu ── */}
      <div className="card sq-strip">
        <div className="sq-row">
          <span className="sq-lbl">Dönem</span>
          <FmPeriod value={donem} onChange={donemSec} />
          <span className="sq-lbl">Aralık</span>
          <div className="sq-haps">
            {SORGU_ARALIK_HAPLAR.map((h) => (
              <button key={h.v} type="button" className={`sq-hap${aralikHap === h.v ? ' on' : ''}`} title={h.t} onClick={() => aralikUygula(h.v)}>{h.l}</button>
            ))}
          </div>
          {aralikHap === 'ozel' && (
            <div className="sq-dates">
              <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} aria-label="Başlangıç tarihi" />
              <span className="drsep">—</span>
              <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} aria-label="Bitiş tarihi" />
              {(rangeFrom || rangeTo) && <button type="button" className="sq-x" title="Aralığı temizle" onClick={() => { setRangeFrom(''); setRangeTo(''); }}>×</button>}
            </div>
          )}
          <div className="sp" />
          <button type="button" className="btn sq-main" disabled={sorgulaDisabled} title={rangeInvalid ? 'Tarih aralığı hatalı: başlangıç bitişten sonra' : !taxpayerId ? 'Önce mükellef seç' : (source === 'efatura' && !activeEfaturaProvider) ? 'Bu mükellefe e-Fatura entegratörü tanımlanmamış — Entegratörler ekranından tanımla' : (source === 'efatura' && !providerConnected(activeEfaturaProvider)) ? 'Entegratör kimliği eksik/pasif — Entegratörler ekranından tamamla' : undefined} onClick={sorgula}>
            <Ico html={I.sync} size={14} /> {sorgulaMetin}
          </button>
        </div>
        <div className="sq-row sq-meta">
          <span className="sq-pill"><Ico html={I.clock} size={12} /> Sorgu aralığı: <b>{aralikMetin}</b></span>
          {rangeAktif && aralikAyAdedi > 1 && (
            <span className="sq-pill" title="Aralık birden çok aya yayılıyor; tablo tüm ayları birleştirip aralıktaki belgeleri gösterir.">Tablo <b>{aralikAyAdedi} ayı</b> birleşik gösteriyor</span>
          )}
          {rangeInvalid && <span className="sq-pill err">Başlangıç bitişten sonra olamaz — düzeltmeden sorgulanamaz</span>}
          {rangePartial && <span className="sq-pill warn">İki tarih de gerekli — tek tarihle aralık gitmez, {periodLabel(donem)} ayı kullanılır</span>}
          {source === 'earsiv' ? (
            earsivSonSorgu ? (
              <span className="sq-last">son sorgu: <b>{earsivSonSorgu.saat || '—'}</b>{earsivSonSorgu.durum === 'failed' ? <> · <b className="sq-kirmizi">başarısız</b></> : earsivSonSorgu.durum === 'cancelled' ? ' · iptal edildi' : <> · <b>{earsivSonSorgu.satir}</b> satır</>}</span>
            ) : <span className="sq-last">henüz sorgu yok</span>
          ) : (
            efaturaSonSorgu ? (
              <span className="sq-last">son sorgu: <b>{efaturaSonSorgu.saat || '—'}</b>{efaturaSonSorgu.hata ? <> · <b className="sq-kirmizi">tamamlanamadı</b></> : <> · <b>{efaturaSonSorgu.satir}</b> {efaturaSonSorgu.yeni ? 'yeni' : 'satır'}</>}</span>
            ) : <span className="sq-last">bu oturumda sorgu yok</span>
          )}
        </div>
        {/* İLERLEME: e-Arşiv — aktif iş (jobs) + iptal; e-Fatura — sorgu/arka plan senkron (iptal ucu yok) */}
        {source === 'earsiv' && earsivJobRunning && (
          <div className="sq-prog">
            <span className="sq-spin" aria-hidden="true" />
            <span className="sq-ptx">{earsivIlerleme.belirli ? <><b>{earsivIlerleme.cur}</b> / {earsivIlerleme.tot} satır</> : <>Faturalar çekiliyor… <b>{rows.length}</b> satır geldi</>}</span>
            <span className="sq-track"><span className={`sq-fill${earsivIlerleme.belirli ? '' : ' belirsiz'}`} style={earsivIlerleme.belirli ? { width: `${earsivIlerleme.pct}%` } : undefined} /></span>
            {earsivIlerleme.mesaj ? <span className="sq-psub" title={earsivIlerleme.mesaj}>{earsivIlerleme.mesaj}</span> : <span className="sq-psub">satır geliyor…</span>}
            <button type="button" className="btn sm sq-cancel" disabled={cancelMut.isPending || !activeJob?.id} onClick={() => { if (activeJob?.id) cancelMut.mutate(String(activeJob.id)); }}>{cancelMut.isPending ? 'İptal ediliyor…' : 'İptal'}</button>
          </div>
        )}
        {source === 'earsiv' && !earsivJobRunning && sorgulaMut.isPending && (
          <div className="sq-prog"><span className="sq-spin" aria-hidden="true" /><span className="sq-ptx">Sorgu kuyruğa alınıyor…</span><span className="sq-track"><span className="sq-fill belirsiz" /></span></div>
        )}
        {/* Kullanıcı isteği (2026-09-12): sorgu + belge indirme TEK sayaçta (eskiden tablo üstünde ikinci bir bant daha vardı). */}
        {source === 'efatura' && (efaturaSorguSuruyor || efaturaDownloading) && (
          <div className="sq-prog">
            <span className="sq-spin" aria-hidden="true" />
            <span className="sq-ptx">{efaturaFetchMut.isPending ? 'Sorgu gönderiliyor…' : efaturaSorguSuruyor ? <>Sorgulanıyor… <b>{efaturaRows.length}</b> fatura geldi{efaturaDownloading ? <> · belgeler iniyor <b>{efaturaDownloadReady}</b>/{efaturaDownloadTotal}</> : null}</> : <>Belgeler indiriliyor… <b>{efaturaDownloadReady}</b> / {efaturaDownloadTotal} hazır{efaturaDownloadMissing ? ` · ${efaturaDownloadMissing} inemedi` : ''}</>}</span>
            <span className="sq-track">{efaturaDownloading ? <span className="sq-fill" style={{ width: `${efaturaDownloadTotal ? Math.round((efaturaDownloadReady / efaturaDownloadTotal) * 100) : 0}%` }} /> : <span className="sq-fill belirsiz" />}</span>
            {efaturaSyncStatus?.rateLimited
              ? <span className="sq-psub">Hız sınırı uygulandı; otomatik bekleyip devam ediyor — TAMAMLANMADI.</span>
              : efaturaBgSyncRunning && Number(efaturaSyncStatus?.rounds) > 0
                ? <span className="sq-psub">{efaturaSyncStatus.rounds}. tur · {Number(efaturaSyncStatus.added || 0)} yeni</span>
                : <span className="sq-psub">satır geliyor…</span>}
          </div>
        )}
        {/* HATA / DURUM BANTLARI */}
        {source === 'earsiv' && earsivSonSorgu && earsivSonSorgu.durum === 'failed' && !earsivJobRunning && (
          <div className="banner sq-err"><Ico html={I.info} size={15} /><span><b>Son sorgu başarısız</b>{earsivSonSorgu.saat ? ` (${earsivSonSorgu.saat})` : ''}{earsivSonSorgu.hata ? `: ${earsivSonSorgu.hata}` : ' — GİB’e ulaşılamamış olabilir.'} Tekrar Sorgula ile deneyin.</span></div>
        )}
        {source === 'efatura' && efaturaStatusRows.length > 0 && efaturaStatusTone === 'bad' && (
          <div className="banner sq-err"><Ico html={I.info} size={15} /><span>{efaturaStatusRows.map((p, i) => <span key={`${p?.provider || i}-${i}`} style={{ display: 'block' }}><b>{efaturaProviderLabel(p)}</b>: {efaturaStatusText(p)}</span>)}</span></div>
        )}
        {source === 'efatura' && efaturaStatusRows.length > 0 && efaturaStatusTone !== 'bad' && !efaturaQueuedActive && (
          <div className={`banner ${efaturaStatusTone === 'warn' ? 'sq-warn' : 'sq-ok'}`}><Ico html={I.info} size={15} /><span>{efaturaStatusRows.map((p, i) => <span key={`${p?.provider || i}-${i}`} style={{ display: 'block' }}><b>{efaturaProviderLabel(p)}</b>: {efaturaStatusText(p)}</span>)}</span></div>
        )}
        {source === 'efatura' && efaturaBgProvider && efaturaSyncStatus && efaturaSyncStatus.state === 'done' && efaturaSyncPollUntil > Date.now() && (
          <div className="banner sq-ok"><Ico html={I.checkSm} size={14} /><span><b>Sorgu tamamlandı</b> — dönemdeki tüm faturalar çekildi ({efaturaRows.length} fatura).</span></div>
        )}
        {source === 'efatura' && efaturaBgProvider && efaturaSyncStatus && efaturaSyncStatus.state === 'error' && efaturaSyncPollUntil > Date.now() && (
          <div className="banner sq-err"><Ico html={I.info} size={15} /><span><b>Sorgu tamamlanamadı</b> ({efaturaRows.length} fatura indirildi). Bir süre sonra tekrar Sorgula — inmeyenler tamamlanır.</span></div>
        )}
      </div>

      {/* ── SONUÇ ÖZETİ ŞERİDİ: renkli sayaç kartları; tıkla → tabloyu süz, tekrar tıkla → süzgeç kalkar ── */}
      <div className="filttiles sq-tiles">
        {ozetKartlar.map((t) => (
          <button key={t.v || 'toplam'} type="button" className={`ftile${ozetF === t.v ? ' on' : ''}`} style={{ ['--tc' as any]: t.c }} title={t.v ? 'Tıkla: tabloyu süz · tekrar tıkla: süzgeci kaldır' : 'Tüm satırlar'} onClick={() => setOzetF((f) => (f === t.v ? '' : t.v))}>
            <span className="ftdot" />
            <span className="fttx"><span className="ftn">{t.n}</span><span className="ftl">{t.l}</span></span>
          </button>
        ))}
        {source === 'earsiv' && <span className="sq-pill gray sq-tilenote" title="GİB’de iptal, itirazlı veya reddedilmiş faturalar listede kalır; aktarıma alınmaz.">İptal / itiraz tabloda görünür, aktarılmaz</span>}
      </div>

      {source === 'earsiv' ? (
        <div className={`card sourcepanel sq-panel${earsivOverlayBusy ? ' isbusy' : ''}${earsivJobRunning ? ' sq-running' : ''}`}>
          <div className="ch sourcehead sq-head">
            <h3>
              <span className="sq-src" style={{ ['--sc' as any]: sorguProvRenk('GIB_PORTAL') }}><i>GİB</i>e-Arşiv Portal</span>
              <span className="mu">{periodLabel(donem)}</span>
            </h3>
            <div className="sp" />
            <label className="sq-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Ünvan, belge no, VKN ara…" />
              {ara && <button type="button" onClick={() => setAra('')} title="Aramayı temizle">×</button>}
            </label>
            <span className="mu">{gorunenAdet}{gorunenAdet !== toplamAdet ? ` / ${toplamAdet}` : ''} satır</span>
          </div>
          {/* ÜST TOPLU İŞLEM ÇUBUĞU — tablonun ÜSTÜNDE (kullanıcı kararı 2026-09-12: alt çubuk yok); seçim varken vurgulanır */}
          {rows.length > 0 && (
            <div className={`sq-bulk${secimAdet ? ' secili' : ''}`}>
              {secimAdet
                ? <span className="sq-selinfo"><b>{secimAdet}</b> fatura seçili</span>
                : <span className="sq-selinfo mu">Seçim yoksa aktarılabilir satırların tümü aktarılır</span>}
              {secimAdet > 0 && <button type="button" className="btn sm ghost" onClick={() => setSel(new Set())}>Seçimi temizle</button>}
              <button type="button" className="btn sm ghost" disabled={!taxpayerId || syncMut.isPending || rows.length === 0} onClick={() => syncMut.mutate()} title="Listedeki faturaların muhasebe / Luca durumunu yeniden eşitler"><Ico html={I.checkSm} size={13} /> {syncMut.isPending ? 'Eşitleniyor…' : 'Durumu eşitle'}</button>
              <span className="sq-pill gray" title="İptal, itirazlı veya reddedilmiş faturalar tabloda görünür ama aktarıma alınmaz.">İptal / itiraz aktarılmaz</span>
              <div className="sp" />
              <button type="button" className="btn sm primary" disabled={!taxpayerId || aktarMut.isPending || waitForFirstRows || processable.length === 0} onClick={() => aktarMut.mutate()}><Ico html={I.download} size={13} /> {aktarMut.isPending ? 'Aktarılıyor…' : `${secimAdet ? secimAdet : processable.length} faturayı aktar`}</button>
            </div>
          )}
          {(earsivQ.isError || jobsQ.isError) && (
            <div className="yuklenemedi">
              <span><Ico html={I.info} size={14} /> Liste alınamadı (bağlantı/sunucu hatası) — "kayıt yok" demek değil.</span>
              <button className="btn sm" onClick={() => { earsivQ.refetch(); jobsQ.refetch(); }}><Ico html={I.sync} size={12} /> Tekrar dene</button>
            </div>
          )}
          <div className="sourcetablewrap sq-tablewrap">
            {earsivOverlayBusy && (
              <div className="queryveil">
                <div className="querydoc" aria-hidden="true"><span /><i /><i /><i /></div>
                <b>{aktarMut.isPending ? 'Faturalar aktarılıyor…' : 'Faturalar getiriliyor…'}</b>
              </div>
            )}
            <table className="sourcetable sq-table">
              <thead>
                <tr>
                  <th className="center"><Check checked={earsivHepsiSecili} disabled={earsivGorunenSecilebilir.length === 0} onToggle={earsivGorunenSec} title="Görünen aktarılabilir satırların hepsini seç / bırak" /></th>
                  <th>Kaynak</th>
                  <th className={`sortable${sirala.k === 'unvan' ? ' sorted' : ''}`} onClick={() => siralaTikla('unvan')} title="Ünvana göre sırala">Alıcı / VKN <span className="sq-sort">{siralaOk('unvan')}</span></th>
                  <th>Belge No</th>
                  <th className={`sortable${sirala.k === 'tarih' ? ' sorted' : ''}`} onClick={() => siralaTikla('tarih')} title="Tarihe göre sırala">Tarih <span className="sq-sort">{siralaOk('tarih')}</span></th>
                  <th>Tür</th>
                  <th className={`num sortable${sirala.k === 'tutar' ? ' sorted' : ''}`} onClick={() => siralaTikla('tutar')} title="Tutara göre sırala (tutar yalnız muhasebeleştirilmiş satırlarda bilinir)">Tutar <span className="sq-sort">{siralaOk('tutar')}</span></th>
                  <th>Onay</th>
                  <th className="center">Görsel</th>
                  <th className="center">Aktarım</th>
                </tr>
              </thead>
              <tbody>
                {earsivSuz.map(({ r, onay, akt, secilebilir }) => (
                  <tr key={r.id} className={`${!r.isProcessable ? 'blocked' : earsivAktarildi(r) ? 'done' : ''}${secilebilir && sel.has(r.sourceRefId) ? ' sel' : ''}`}>
                    <td className="center">
                      {secilebilir ? (
                        <Check checked={sel.has(r.sourceRefId)} onToggle={() => toggle(r.sourceRefId)} />
                      ) : (
                        <Check checked={false} disabled title={earsivAktarildi(r) ? 'Zaten aktarılmış' : 'Aktarıma alınmaz'} />
                      )}
                    </td>
                    <td><span className="sq-src" style={{ ['--sc' as any]: sorguProvRenk('GIB_PORTAL') }}><i>GİB</i>e-Arşiv</span></td>
                    <td><div className="sq-party"><b>{r.buyerName || '—'}</b><small>{r.buyerVkn || '—'}</small></div></td>
                    <td><span className="sq-mono">{r.belgeNo || r.referenceNo || '—'}</span></td>
                    <td>{fmtDate(r.issuedAt)}</td>
                    <td><span className="sq-pill gray">e-Arşiv</span></td>
                    <td className="num">{r.toplam != null ? fmtMoney(r.toplam) : '—'}</td>
                    <td>
                      <span className={`sq-onay ${onay.k}`} title={`${r.onayDurumu || ''}${r.iptalDurumu && r.iptalDurumu !== 'Yok' ? ` · ${r.iptalDurumu}` : ''}`}>{onay.l}</span>
                      {r.iptalDurumu && r.iptalDurumu !== 'Yok' && <small className="sq-onaysub">{r.iptalDurumu}</small>}
                    </td>
                    <td className="center">
                      {r.muhasebeBelgeId ? (
                        <span className="eye" onClick={() => openDocFile(r.muhasebeBelgeId)} title="Fatura görselini aç" style={{ color: '#0891b2', margin: '0 auto' }}><Ico html={I.eye} size={15} /></span>
                      ) : '—'}
                    </td>
                    <td className="center"><span className={`sq-akt ${akt.k}`} title={akt.t}>{akt.l}</span></td>
                  </tr>
                ))}
                {!earsivSuz.length && (
                  <tr><td colSpan={10} className="emptyrow">{
                    !taxpayerId
                      ? 'Önce mükellef seç.'
                      : rows.length
                        ? 'Süzgece / aramaya uyan satır yok.'
                        : lastJob && /fail/i.test(String(lastJob.status || ''))
                          ? `Son sorgu başarısız oldu${(lastJob as any)?.errorMessage ? `: ${(lastJob as any).errorMessage}` : ''} — GİB'e ulaşılamamış olabilir, tekrar deneyin.`
                          : lastJob && /done|success/i.test(String(lastJob.status || ''))
                            ? 'GİB bu dönem için e-Arşiv faturası döndürmedi (0 kayıt). Mükellef bu dönemde GİB portalından e-Arşiv kesmediyse (entegratör/e-Fatura kullanıyorsa) bu normaldir; kestiyse tarih aralığını kontrol edip tekrar deneyin.'
                            : 'Önce Sorgula ile GİB listesini getir.'
                  }</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`card sourcepanel sq-panel${efaturaOverlayBusy ? ' isbusy' : ''}${efaturaSorguSuruyor ? ' sq-running' : ''}`}>
          <div className="ch sourcehead sq-head">
            <div className="segmini">
              {efaturaKanalSecenek.map((k) => (
                <button key={k.v} type="button" className={efaturaChannel === k.v ? 'on' : ''} onClick={() => setEfaturaChannel(k.v)}>{k.l}</button>
              ))}
            </div>
            {/* Entegratör adı + kimlik rozeti (integrations: connected = configured && isActive; hasApiKey/hasPassword/username ayrıntı) */}
            <div className="sq-prov">
              {activeEfaturaProvider ? (
                <span className="sq-src" style={{ ['--sc' as any]: sorguProvRenk(activeEfaturaProvider?.provider) }} title={providerKimlikDetay(activeEfaturaProvider) || undefined}>
                  <i>{provKisalt(String(activeEfaturaProvider.label || ''), String(activeEfaturaProvider.provider || ''))}</i>
                  {efaturaProviderLabel(activeEfaturaProvider)}
                </span>
              ) : (
                // Bu mükellefe hiç e-Fatura entegratörü bağlanmamış: sağlayıcı adı UYDURMA, nötr (gri) söyle + kısayol ver.
                <span className="sq-pill gray" title="Bu mükellef için e-Fatura entegratörü (TÜRMOB / eLogo / Uyumsoft / Paraşüt / Turkcell…) tanımlanmamış. Entegratörler ekranından tanımlayınca burada sorgu yapılabilir.">● Entegratör tanımlı değil</span>
              )}
              {!activeEfaturaProvider ? (
                onOpenEntegrator ? <button type="button" className="btn sm ghost" onClick={onOpenEntegrator} title="Entegratörler ekranını aç">Entegratörler'de tanımla →</button> : null
              ) : providerConnected(activeEfaturaProvider) ? (
                <span className="sq-pill ok" title={providerKimlikDetay(activeEfaturaProvider) || 'Kimlik bilgisi tanımlı'}>● kimlik hazır</span>
              ) : activeEfaturaProvider.configured && activeEfaturaProvider.isActive === false ? (
                <span className="sq-pill warn" title="Bağlantı tanımlı ama pasif — Entegratörler ekranından etkinleştir">● bağlantı pasif</span>
              ) : (
                <span className="sq-pill err" title="Entegratörler ekranından kullanıcı/şifre ya da API anahtarı tanımla">● kimlik eksik</span>
              )}
              {connectedEfaturaProviders.length > 1 && (
                <span className="sq-pill gray" title={connectedEfaturaProviders.map((p) => p.label || p.provider).join(' · ')}>+{connectedEfaturaProviders.length - 1} bağlı entegratör daha</span>
              )}
            </div>
            <div className="sp" />
            <label className="sq-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Ünvan, belge no, VKN ara…" />
              {ara && <button type="button" onClick={() => setAra('')} title="Aramayı temizle">×</button>}
            </label>
            <span className="mu">{gorunenAdet}{gorunenAdet !== toplamAdet ? ` / ${toplamAdet}` : ''} satır</span>
          </div>
          {/* ÜST TOPLU İŞLEM ÇUBUĞU — tablonun ÜSTÜNDE (kullanıcı kararı 2026-09-12: alt çubuk yok); seçim varken vurgulanır */}
          {efaturaRows.length > 0 && (
            <div className={`sq-bulk${secimAdet ? ' secili' : ''}`}>
              {secimAdet
                ? <span className="sq-selinfo"><b>{secimAdet}</b> fatura seçili</span>
                : <span className="sq-selinfo mu">Seçim yoksa aktarılabilir satırların tümü aktarılır (eşleştirme yapılmaz; sonra "AI ile oku")</span>}
              {secimAdet > 0 && <button type="button" className="btn sm ghost" onClick={() => setSel(new Set())}>Seçimi temizle</button>}
              <span className="sq-pill gray" title="İptal, itirazlı veya reddedilmiş faturalar tabloda görünür ama aktarıma alınmaz.">İptal / itiraz aktarılmaz</span>
              <div className="sp" />
              <button type="button" className="btn sm primary" disabled={!taxpayerId || efaturaOverlayBusy || efaturaDownloading || efaturaTransferableRows.length === 0} onClick={() => efaturaImportMut.mutate()} title={efaturaDownloading ? 'Belgeler iniyor; bitince aktarabilirsin (görseller önceden inecek)' : undefined}>
                <Ico html={I.download} size={13} /> {efaturaDownloading ? 'Belgeler iniyor…' : (efaturaImportMut.isPending || efaturaQueuedImport) ? 'Aktarılıyor…' : `${secimAdet ? secimAdet : efaturaTransferableRows.length} faturayı aktar`}
              </button>
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
          {/* ARKA PLAN ÇEKİM DURUMU (sorgu/bitti/hata) ve sağlayıcı durum satırları PLAN16-A ile üstteki
              sorgu şeridine taşındı (ilerleme çubuğu + renkli bantlar); mantık aynen orada. */}
          {efaturaInboxQ.isError && (
            <div className="yuklenemedi">
              <span><Ico html={I.info} size={14} /> Liste alınamadı (bağlantı/sunucu hatası) — "kayıt yok" demek değil.</span>
              <button className="btn sm" onClick={() => efaturaInboxQ.refetch()}><Ico html={I.sync} size={12} /> Tekrar dene</button>
            </div>
          )}
          <div className="sourcetablewrap efatura sq-tablewrap">
            {efaturaOverlayBusy && (
              <div className="queryveil">
                <div className="querydoc" aria-hidden="true"><span /><i /><i /><i /></div>
                <b>{(efaturaImportMut.isPending || efaturaQueuedImport) ? 'Faturalar aktarılıyor…' : 'Faturalar getiriliyor…'}</b>
              </div>
            )}
            <table className="sourcetable sq-table">
              <thead>
                <tr>
                  <th className="center"><Check checked={efaturaHepsiSecili} disabled={efaturaGorunenSecilebilir.length === 0} onToggle={efaturaGorunenSec} title="Görünen aktarılabilir satırların hepsini seç / bırak" /></th>
                  <th>Entegratör</th>
                  <th className={`sortable${sirala.k === 'unvan' ? ' sorted' : ''}`} onClick={() => siralaTikla('unvan')} title="Ünvana göre sırala">Ünvan / VKN <span className="sq-sort">{siralaOk('unvan')}</span></th>
                  <th>Belge No</th>
                  <th className={`sortable${sirala.k === 'tarih' ? ' sorted' : ''}`} onClick={() => siralaTikla('tarih')} title="Tarihe göre sırala">Tarih <span className="sq-sort">{siralaOk('tarih')}</span></th>
                  <th>Tür</th>
                  <th className={`num sortable${sirala.k === 'tutar' ? ' sorted' : ''}`} onClick={() => siralaTikla('tutar')} title="Tutara göre sırala">Tutar <span className="sq-sort">{siralaOk('tutar')}</span></th>
                  <th>Onay</th>
                  <th className="center">Aktarım</th>
                </tr>
              </thead>
              <tbody>
                {efaturaSuz.map(({ r, title, taxNo, approvalRaw, onay, akt, transferred, missingOriginal, rowId, selectable, prov, provLabel }) => (
                  <tr key={r.id} className={`${transferred ? 'done' : ''}${missingOriginal ? ' missingdoc' : ''}${selectable && sel.has(rowId) ? ' sel' : ''}`}>
                    <td className="center">
                      <Check
                        checked={selectable && sel.has(rowId)}
                        disabled={!selectable}
                        title={transferred ? 'Zaten aktarılmış' : missingOriginal ? 'Aktarımda orijinal belge yeniden indirilecek' : selectable ? 'Aktarım için seç' : 'Satır kimliği yok'}
                        onToggle={() => toggle(rowId)}
                      />
                    </td>
                    <td><span className="sq-src" style={{ ['--sc' as any]: sorguProvRenk(prov) }} title={prov}><i>{provKisalt(provLabel, prov)}</i>{provLabel}</span></td>
                    <td><div className="sq-party"><b>{title || '—'}</b><small>{taxNo || '—'}</small></div></td>
                    <td><span className="sq-mono">{r.faturaNo || '—'}</span></td>
                    <td>{fmtDate(r.faturaDate)}</td>
                    <td><span className="sq-pill gray">{r.invoiceProfile || 'e-Fatura'}</span></td>
                    <td className="num">{r.toplam != null ? fmtMoney(r.toplam) : '—'}</td>
                    <td><span className={`sq-onay ${onay.k}`} title={String(approvalRaw || '') || undefined}>{onay.l}</span></td>
                    <td className="center"><span className={`sq-akt ${akt.k}`} title={akt.t}>{akt.l}</span></td>
                  </tr>
                ))}
                {!efaturaSuz.length && (
                  (efaturaInboxQ.isLoading || (efaturaInboxQ.isFetching && !efaturaInboxQ.data))
                    // İLK YÜKLEME (kullanıcı bulgusu #10): ekran ÖNCE boş "sorgu satırı yok" flaşlıyordu →
                    //   veri gelene kadar boş mesaj yerine yükleniyor göster; mükellef/dönem değişince de böyle.
                    ? <tr><td colSpan={9} className="emptyrow loadingrow">Faturalar yükleniyor…</td></tr>
                    : <tr><td colSpan={9} className="emptyrow">{
                      !taxpayerId
                        ? 'Önce mükellef seç.'
                        : efaturaRows.length
                          ? 'Süzgece / aramaya uyan satır yok.'
                          : `Bu yönde ${efaturaChannelTitle} sorgu satırı yok. Üstteki Sorgula ile getir.`
                    }</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===================== PLAN16-F2: MÜKELLEFLER — SADE LİSTE + AÇILIR TANIM ALANI (kullanıcı kararı 2026-09-12) ===================== */
// Kullanıcı: "liste aşırı karışık; NACE/faaliyet metni tabloda görünmesin; tanımlı mı değil mi onay/uyarı versin;
//   açılır-kapanır alanda tanımlansın; NACE öner olmasın; e-Fatura mı anahtarı olsun." Tabloda yalnız ✓/⚠ işareti,
//   defter hapı, belge yolu hapı (e-Fatura / GİB e-Arşiv) ve sayılar. Satırın altında açılır tanım alanı:
//   NACE kodu · faaliyet açıklaması · sektör · defter türü · e-Fatura mükellefi · kurum türü (tevkifat kuralı için).
//   Uç: PATCH /taxpayers/:id/faaliyet (yalnız değişen alanlar; '' = temizle; isEFaturaMukellefi boolean).
//   e-Fatura işareti sol menüdeki sorgu ekranlarını kilitler (FaturaMerkeziPage: e-Fatura → e-Fatura Sorgu açık,
//   GİB e-Arşiv Sorgu kilitli; değilse tersi).
type MfForm = { naceKodu: string; faaliyetAciklama: string; sektorEtiketi: string; kurumTuru: string; defterTuru: string; isEFaturaMukellefi: boolean };
const MF_METIN_ALANLAR: Array<'naceKodu' | 'faaliyetAciklama' | 'sektorEtiketi' | 'kurumTuru' | 'defterTuru'> = ['naceKodu', 'faaliyetAciklama', 'sektorEtiketi', 'kurumTuru', 'defterTuru'];
const MF_NACE_DESENI = /^\d{2}(\.\d{2}){0,2}$/; // shared NACE_KODU_DESENI ile aynı: 56 · 56.10 · 56.10.06
const MF_DEFTER_SECENEKLERI = (Object.keys(DEFTER_TURU_ETIKETLERI) as Array<keyof typeof DEFTER_TURU_ETIKETLERI>).map((v) => ({ v: String(v), l: DEFTER_TURU_ETIKETLERI[v] }));
const MF_KURUM_SECENEKLERI = KURUM_TURU_SECENEKLERI.map((o) => ({ v: String(o.value), l: o.label }));
type MfSuzgec = 'tumu' | 'tanimsiz' | 'efatura' | 'earsiv' | 'isletme' | 'bilanco';

/** Defter türü etiketi — defterTuru öncelikli, boşsa Mihsap defter türünden türetilir. */
function mfDefterEtiketi(t: any): '' | 'İşletme' | 'Bilanço' {
  const kaynak = `${t?.defterTuru || ''} ${t?.mihsapDefterTuru || ''}`;
  if (/i[şs]letme|defter.?beyan|basit/i.test(kaynak)) return 'İşletme';
  if (t?.defterTuru || /bilan[cç]o/i.test(kaynak)) return 'Bilanço';
  return '';
}

/** Satırın tanım durumu: "tanımlı" = NACE + faaliyet açıklaması + defter türü dolu. Sektör/kurum türü isteğe bağlı (eksikse ipucunda söylenir). */
function mfTanimDurumu(t: any) {
  const nace = String(t?.naceKodu || '').trim();
  const aciklama = String(t?.faaliyetAciklama || '').trim();
  const sektor = String(t?.sektorEtiketi || '').trim();
  const kurumKodu = String(t?.kurumTuru || '').trim().toLowerCase();
  const kurum = kurumTuruEtiketi(kurumKodu) || '';
  const defter = mfDefterEtiketi(t);
  const efatura = t?.isEFaturaMukellefi === true;
  const zorunluEksik: string[] = [];
  if (!nace) zorunluEksik.push('NACE kodu');
  if (!aciklama) zorunluEksik.push('faaliyet açıklaması');
  if (!defter) zorunluEksik.push('defter türü');
  const istegeBagliEksik: string[] = [];
  if (!sektor) istegeBagliEksik.push('sektör');
  if (!kurum) istegeBagliEksik.push('kurum türü');
  const tanimli = zorunluEksik.length === 0;
  const ipucu = tanimli
    ? `Tanımlı — NACE ${nace} · ${aciklama}${sektor ? ` · ${sektor}` : ''}${kurum ? ` · ${kurum}` : ''}${istegeBagliEksik.length ? ` (boş: ${istegeBagliEksik.join(', ')})` : ''}`
    : `Tanımsız — boş: ${zorunluEksik.join(', ')}`;
  return { nace, aciklama, sektor, kurumKodu, kurum, defter, efatura, tanimli, zorunluEksik, ipucu };
}

/** Mükellef kaydından form değerleri. */
function mfFormDegerleri(t: any): MfForm {
  const defter = mfDefterEtiketi(t);
  const kurumKodu = String(t?.kurumTuru || '').trim().toLowerCase();
  return {
    naceKodu: String(t?.naceKodu || '').trim(),
    faaliyetAciklama: String(t?.faaliyetAciklama || '').trim(),
    sektorEtiketi: String(t?.sektorEtiketi || '').trim(),
    kurumTuru: kurumTuruEtiketi(kurumKodu) ? kurumKodu : '',
    defterTuru: defter === 'İşletme' ? 'ISLETME' : defter === 'Bilanço' ? 'BILANCO' : '',
    isEFaturaMukellefi: t?.isEFaturaMukellefi === true,
  };
}

/** Yalnız DEĞİŞEN alanlar (PATCH gövdesi; '' → arka uçta temizle). */
function mfDegisenAlanlar(ilk: MfForm, son: MfForm): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const k of MF_METIN_ALANLAR) if (son[k].trim() !== ilk[k].trim()) out[k] = son[k].trim();
  if (son.isEFaturaMukellefi !== ilk.isEFaturaMukellefi) out.isEFaturaMukellefi = son.isEFaturaMukellefi;
  return out;
}

/** Kaydet öncesi ekran doğrulaması (arka uç zod şemasıyla aynı sınırlar). Hata yoksa null. */
function mfFormHatasi(f: MfForm): string | null {
  if (f.naceKodu.trim() && !MF_NACE_DESENI.test(f.naceKodu.trim())) return 'NACE kodu 56 · 56.10 · 56.10.06 biçiminde olmalı';
  if (f.faaliyetAciklama.trim().length > 300) return 'Faaliyet açıklaması en fazla 300 karakter';
  if (f.sektorEtiketi.trim().length > 60) return 'Sektör en fazla 60 karakter';
  return null;
}

/** NACE yazımını toparla: "561006" → "56.10.06". */
function mfNaceDuzelt(s: string): string {
  const ham = String(s || '').trim();
  const rakam = ham.replace(/\D/g, '');
  if (!ham.includes('.') && (rakam.length === 2 || rakam.length === 4 || rakam.length === 6)) return (rakam.match(/.{2}/g) || []).join('.');
  return ham;
}

/** Axios/Nest hata metni (Nest 400'de message dizi olabilir). */
function mfHataMetni(e: any): string {
  const m = e?.response?.data?.message ?? e?.message ?? 'hata';
  return Array.isArray(m) ? m.join(' · ') : String(m);
}

/** Hap grubu seçim (açılır liste yerine — tablo kabı kaydığından açılır kutu kırpılırdı). */
function MfHapSecim({ deger, secenekler, onChange, bosEtiket }: { deger: string; secenekler: Array<{ v: string; l: string }>; onChange: (v: string) => void; bosEtiket: string }) {
  return (
    <div className="mk-haplar">
      <button type="button" className={`mk-hap${deger === '' ? ' on' : ''}`} onClick={() => onChange('')}>{bosEtiket}</button>
      {secenekler.map((o) => (
        <button key={o.v} type="button" className={`mk-hap${deger === o.v ? ' on' : ''}`} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

/** Satırın altında açılan tanım alanı. */
function MfTanimAlani({ deger, onChange, onKaydet, onVazgec, kaydediliyor, degisti }: {
  deger: MfForm; onChange: (d: MfForm) => void; onKaydet: () => void; onVazgec: () => void; kaydediliyor: boolean; degisti: boolean;
}) {
  const set = (k: keyof MfForm, v: string | boolean) => onChange({ ...deger, [k]: v } as MfForm);
  const klavye = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onVazgec(); }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') { e.preventDefault(); onKaydet(); }
  };
  return (
    <div className="mk-tanim" onKeyDown={klavye}>
      <div className="mk-tanim-grid">
        <label className="mk-alan">
          <span className="mk-alan-l">NACE kodu</span>
          <input value={deger.naceKodu} onChange={(e) => set('naceKodu', e.target.value)} onBlur={(e) => set('naceKodu', mfNaceDuzelt(e.target.value))} placeholder="56.10.06" inputMode="numeric" />
        </label>
        <label className="mk-alan mk-alan-genis">
          <span className="mk-alan-l">Faaliyet açıklaması</span>
          <input value={deger.faaliyetAciklama} onChange={(e) => set('faaliyetAciklama', e.target.value)} placeholder="ör. Motorlu kara taşıtlarının bakım ve onarımı" maxLength={300} />
        </label>
        <label className="mk-alan">
          <span className="mk-alan-l">Sektör</span>
          <input value={deger.sektorEtiketi} onChange={(e) => set('sektorEtiketi', e.target.value)} placeholder="ör. oto tamirhane" maxLength={60} />
        </label>
        <div className="mk-alan">
          <span className="mk-alan-l">Defter türü</span>
          <MfHapSecim deger={deger.defterTuru} secenekler={MF_DEFTER_SECENEKLERI} onChange={(v) => set('defterTuru', v)} bosEtiket="Belirsiz" />
        </div>
        <div className="mk-alan">
          <span className="mk-alan-l">e-Fatura mükellefi mi?</span>
          <button type="button" className={`mk-switch${deger.isEFaturaMukellefi ? ' on' : ''}`} onClick={() => set('isEFaturaMukellefi', !deger.isEFaturaMukellefi)} aria-pressed={deger.isEFaturaMukellefi}>
            <span className="mk-switch-k" />
            <span className="mk-switch-t">{deger.isEFaturaMukellefi ? 'Evet — e-Fatura Sorgu açık, GİB e-Arşiv Sorgu kilitli' : 'Hayır — GİB e-Arşiv Sorgu açık, e-Fatura Sorgu kilitli'}</span>
          </button>
        </div>
        <div className="mk-alan mk-alan-genis">
          <span className="mk-alan-l">Kurum türü <small>(KDV tevkifatı "belirlenmiş alıcı" kuralı için; normal mükellef = Diğer)</small></span>
          <MfHapSecim deger={deger.kurumTuru} secenekler={MF_KURUM_SECENEKLERI} onChange={(v) => set('kurumTuru', v)} bosEtiket="Bilinmiyor" />
        </div>
      </div>
      <div className="mk-tanim-eylem">
        <span className="mk-tanim-not">{degisti ? 'Kaydedilmemiş değişiklik var' : 'Değişiklik yok'} · Enter kaydeder, Esc kapatır</span>
        <div className="sp" />
        <button type="button" className="btn sm ghost" onClick={onVazgec} disabled={kaydediliyor}>Vazgeç</button>
        <button type="button" className="btn sm primary" onClick={onKaydet} disabled={kaydediliyor || !degisti}>{kaydediliyor ? 'Kaydediliyor…' : 'Kaydet'}</button>
      </div>
    </div>
  );
}

/** Ünvandan 2 harf (avatar). */
function mfBasHarf(ad: string): string {
  const p = String(ad || '').trim().split(/\s+/).filter(Boolean);
  const a = (p[0] || '?')[0] || '?';
  const b = p.length > 1 ? (p[1][0] || '') : ((p[0] || '')[1] || '');
  return (a + b).toLocaleUpperCase('tr');
}

function ScreenMukellefler({ taxpayers, period, onOpen }: { taxpayers: any[]; period: string; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
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
  const [suzgec, setSuzgec] = useState<MfSuzgec>('tumu');
  // TEK açık tanım alanı (satırın altında).
  const [form, setForm] = useState<{ id: string; d: MfForm } | null>(null);
  const kaydetMut = useMutation({
    mutationFn: (v: { id: string; body: Record<string, string | boolean> }) => api.patch(`/taxpayers/${v.id}/faaliyet`, v.body).then((r) => r.data),
    onSuccess: (r: any, v) => {
      const n = Array.isArray(r?.degisenAlanlar) ? r.degisenAlanlar.length : Object.keys(v.body).length;
      toast.success(`Tanım kaydedildi · ${n} alan güncellendi`);
      setForm((f) => (f && f.id === v.id ? null : f));
      qc.invalidateQueries({ queryKey: ['fm2', 'taxpayers'] });
    },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + mfHataMetni(e)),
  });
  const pendingOf = (s: any) => Number(s?.pendingAlis || 0) + Number(s?.pendingSatis || 0);
  const nq = q.trim().toLocaleLowerCase('tr');
  const hepsi = taxpayers.map((t) => ({ t, s: byId.get(t.id) || {}, f: mfTanimDurumu(t) }));
  const sayac = {
    tumu: hepsi.length,
    isletme: hepsi.filter((x) => x.f.defter === 'İşletme').length,
    bilanco: hepsi.filter((x) => x.f.defter === 'Bilanço').length,
    tanimsiz: hepsi.filter((x) => !x.f.tanimli).length,
    efatura: hepsi.filter((x) => x.f.efatura).length,
    earsiv: hepsi.filter((x) => !x.f.efatura).length,
  };
  const suzgecUyar = (x: { s: any; f: ReturnType<typeof mfTanimDurumu> }): boolean => {
    switch (suzgec) {
      case 'tanimsiz': return !x.f.tanimli;
      case 'efatura': return x.f.efatura;
      case 'earsiv': return !x.f.efatura;
      case 'isletme': return x.f.defter === 'İşletme';
      case 'bilanco': return x.f.defter === 'Bilanço';
      default: return true;
    }
  };
  const list = hepsi
    .filter((x) => suzgecUyar(x))
    .filter((x) => !nq || [taxpayerLabel(x.t), x.t.taxNumber, x.f.nace, x.f.aciklama, x.f.sektor].some((s) => String(s || '').toLocaleLowerCase('tr').includes(nq)))
    .sort((a, b) => taxpayerLabel(a.t).localeCompare(taxpayerLabel(b.t), 'tr'));
  const formMukellef = form ? taxpayers.find((x) => String(x.id) === String(form.id)) : null;
  const formDegisiklik = form && formMukellef ? mfDegisenAlanlar(mfFormDegerleri(formMukellef), form.d) : {};
  const formDegisti = Object.keys(formDegisiklik).length > 0;
  const formuAcKapat = (t: any) => {
    if (form && form.id === t.id) { if (formDegisti && !confirm('Kaydedilmemiş değişiklik var, kapatılsın mı?')) return; setForm(null); return; }
    if (form && formDegisti && !confirm('Açık tanımda kaydedilmemiş değişiklik var, vazgeçilsin mi?')) return;
    setForm({ id: t.id, d: mfFormDegerleri(t) });
  };
  const kaydet = () => {
    if (!form || kaydetMut.isPending) return;
    const hata = mfFormHatasi(form.d);
    if (hata) { toast.error(hata); return; }
    if (!formDegisti) { toast.info('Değişiklik yok'); return; }
    kaydetMut.mutate({ id: form.id, body: formDegisiklik });
  };
  // Kullanıcı kararı (2026-09-12): solda Tümü · İşletme · Bilanço; sağda Tanımsız · e-Fatura · GİB e-Arşiv. Başka sayaç yok.
  const solSayac: Array<{ v: MfSuzgec; l: string; c: string }> = [
    { v: 'tumu', l: 'Tümü', c: 'var(--accent)' },
    { v: 'isletme', l: 'İşletme', c: '#15803d' },
    { v: 'bilanco', l: 'Bilanço', c: '#7c3aed' },
  ];
  const sagSayac: Array<{ v: MfSuzgec; l: string; c: string }> = [
    { v: 'tanimsiz', l: 'Tanımsız', c: '#e5484d' },
    { v: 'efatura', l: 'e-Fatura', c: '#0891b2' },
    { v: 'earsiv', l: 'GİB e-Arşiv', c: '#b45309' },
  ];
  const sayacDugme = (t: { v: MfSuzgec; l: string; c: string }) => (
    <button key={t.v} type="button" className={`mk-sayac${suzgec === t.v ? ' on' : ''}`} style={{ ['--tc' as any]: t.c }} onClick={() => setSuzgec(suzgec === t.v && t.v !== 'tumu' ? 'tumu' : t.v)} title={t.v === 'tumu' ? 'Tüm mükellefler' : `Yalnız ${t.l.toLocaleLowerCase('tr')} olanları göster`}>
      <b>{sayac[t.v]}</b><span>{t.l}</span>
    </button>
  );

  return (
    <section className="screen">
      <div className="mk-sayaclar">
        <div className="mk-sayac-grup">{solSayac.map(sayacDugme)}</div>
        <div className="mk-sayac-grup sag">{sagSayac.map(sayacDugme)}</div>
      </div>
      <div className="card mk-card">
        <div className="ch mk-head">
          <h3>{list.length} mükellef <span className="mu">· {periodLabel(period)}{suzgec !== 'tumu' ? ` · ${[...solSayac, ...sagSayac].find((t) => t.v === suzgec)?.l}` : ''}</span></h3>
          <div className="sp" />
          <div className="mukara">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input placeholder="Mükellef, VKN, faaliyet ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="mk-twrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th>Mükellef</th>
                <th>Profil</th>
                <th>Tanım</th>
                <th>Bu dönem</th>
                <th className="mk-th-eylem" />
              </tr>
            </thead>
            <tbody>
              {list.map(({ t, s, f }) => {
                const pending = pendingOf(s);
                const issue = Number(s.hasIssue || 0);
                const posted = Number(s.postedToLuca || 0);
                const approved = Number(s.approvedAlis || 0) + Number(s.approvedSatis || 0);
                const acik = form?.id === t.id;
                const ad = taxpayerLabel(t);
                return (
                  <Fragment key={t.id}>
                    <tr className={`mk-tr${acik ? ' mk-acik' : ''}${issue > 0 ? ' mk-sorunlu' : ''}`} onClick={() => onOpen(t.id)}>
                      <td>
                        <div className="mk-kim">
                          <span className={`mk-avatar ${f.defter === 'Bilanço' ? 'bil' : f.defter === 'İşletme' ? 'isl' : 'bos'}`}>{mfBasHarf(ad)}</span>
                          <div className="mk-kim-tx">
                            <b>{ad}</b>
                            {t.taxNumber ? <small>VKN {t.taxNumber}</small> : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="mk-profil">
                          {f.defter ? <span className={`mk-pill ${f.defter === 'İşletme' ? 'isl' : 'bil'}`}>{f.defter}</span> : <span className="mk-pill bos">defter belirsiz</span>}
                          {f.efatura ? <span className="mk-pill efat" title="e-Fatura mükellefi — faturalar entegratörden (e-Fatura Sorgu) gelir">e-Fatura</span> : <span className="mk-pill earsiv" title="e-Fatura mükellefi değil — satışlar GİB e-Arşiv Sorgu ile çekilir">GİB e-Arşiv</span>}
                        </div>
                      </td>
                      <td>
                        {f.tanimli
                          ? <span className="mk-tanimli ok" title={f.ipucu}><i>✓</i> tanımlı</span>
                          : <span className="mk-tanimli uyar" title={f.ipucu}><i>!</i> tanımsız</span>}
                      </td>
                      <td>
                        <div className="mk-donem">
                          {pending > 0 ? <span className="mk-say bekleyen">{pending} bekleyen</span> : null}
                          {approved > 0 ? <span className="mk-say onayli">{approved} onaylı</span> : null}
                          {posted > 0 ? <span className="mk-say luca">{posted} Luca'da</span> : null}
                          {issue > 0 ? <span className="mk-say sorunlu">{issue} sorunlu</span> : null}
                          {pending + approved + posted + issue === 0 ? <span className="mk-say yok">belge yok</span> : null}
                        </div>
                      </td>
                      <td className="mk-eylem" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className={`btn sm ghost mk-duzenle${acik ? ' on' : ''}`} onClick={() => formuAcKapat(t)} title={acik ? 'Tanım alanını kapat' : 'Faaliyet / defter / e-Fatura tanımı'}>{acik ? 'Kapat ▴' : (f.tanimli ? 'Düzenle' : 'Tanımla')}</button>
                        <button type="button" className="btn sm mk-ac" onClick={() => onOpen(t.id)} title="Bu mükellefin faturalarını aç">Aç →</button>
                      </td>
                    </tr>
                    {acik && form && (
                      <tr className="mk-formrow" onClick={(e) => e.stopPropagation()}>
                        <td colSpan={5}>
                          <MfTanimAlani
                            deger={form.d}
                            onChange={(d) => setForm({ id: t.id, d })}
                            onKaydet={kaydet}
                            onVazgec={() => setForm(null)}
                            kaydediliyor={kaydetMut.isPending}
                            degisti={formDegisti}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!sumQ.isLoading && list.length === 0 && (
                <tr><td colSpan={5}><div className="empty">Mükellef bulunamadı{suzgec !== 'tumu' || nq ? <> — <a href="#" onClick={(e) => { e.preventDefault(); setSuzgec('tumu'); setQ(''); }}>süzgeçleri temizle</a></> : null}.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
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
            const firma = (sat ? d.customerName : d.vendorName) || (String(d.documentType || '').toUpperCase() === 'Z_RAPORU' ? 'Z RAPORU' : '(firma yok)');
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
                // PDF: tarayıcının kendi görüntüleyici çerçevesi (üst araç çubuğu + sol küçük-resim
                //   paneli) alanın yarısını yiyip faturayı küçültüyordu. toolbar=0&navpanes=0 ile
                //   yalnız BELGE kalır; view=FitH genişliğe sığdırır. (Kullanıcı: "sadece fatura
                //   sığacak şekilde görülsün".) Zaten '#' taşıyan URL'e dokunulmaz.
                ? <iframe className="bppdf" src={url.includes('#') ? url : `${url}#toolbar=0&navpanes=0&statusbar=0&view=FitH`} title="Belge" />
                : <div className="bpempty">Belge görüntüsü yok</div>}
      </div>
    </div>
  );
}

/* ===================== EKRAN: MUHASEBELEŞTİR ===================== */
function ScreenMuhasebe({ taxpayerId, period, isIsletme = false, taxpayerNace = '', taxpayerFaaliyet = '', taxpayerAd = '', full = false, onToggleFull, onOpenMukellefler }: { taxpayerId: string; period: string; isIsletme?: boolean; taxpayerNace?: string; taxpayerFaaliyet?: string; taxpayerAd?: string; full?: boolean; onToggleFull?: () => void; onOpenMukellefler?: () => void }) {
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
          // PLAN/15 Faz 3 FE — stopaj türü (022 e-SMM / 041 kira; boş olabilir). PATCH isletme'yi bütünüyle yazar,
          //   buraya girmezse arka ucun bulduğu kod kaydetmede silinirdi.
          stopajKod: isl.stopajKod || '',
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
  // İADE YÖNÜ (denetim bulgusu): bölüm tarafları sabitti (satışta cari yalnız BORÇ) → iade belgede kullanıcı
  //   yönü çeviremiyor, RETURN_DIRECTION_REVERSED kalıcı "Çelişki" oluyordu. Artık: belge iade ise
  //   (ocrData.isReturn) ya da satırlar zaten ters kurulmuşsa (satışta cari ALACAK / alışta cari BORÇ) bölüm
  //   tarafları TAKAS edilir; "Yönü çevir" düğmesi tüm satırların borç↔alacağını takas eder (PATCH lines ile kaydolur).
  const [yonTers, setYonTers] = useState(false);
  useEffect(() => {
    const sale = String(selDoc?.invoiceKind || '').includes('SATIS');
    const cari = (selDoc?.lines || []).find((l: any) => String(l.group || '') === 'cari');
    const cariBorc = Number(cari?.debit || 0) > 0, cariAlacak = Number(cari?.credit || 0) > 0;
    const satirlarTers = !!cari && (sale ? (cariAlacak && !cariBorc) : (cariBorc && !cariAlacak));
    // Bölüm tarafı SATIRLARIN gerçek durumunu izler (tutarlar doğru kutuda görünsün); iade ama normal kurulmuş eski
    //   belgede kullanıcı 'Yönü çevir' ile takas eder.
    setYonTers(satirlarTers);
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
      // PLAN/15 Faz 3 FE — stopaj türü (022/041) arka uçtan gelir; kullanıcı seçiciden değiştirebilir.
      stopajKod: saved.stopajKod || '',
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
    setIsl((s: any) => ({ ...s, belgeTuruKod: (() => { const dt = normalizeDocumentType(selDoc?.documentType || selDoc?.ocrData?.belgeTuru || selDoc?.ocrData?.documentType); return dt ? defaultBelgeTuruKod(dt, kind) : ''; })(), alisSatisKod: '1', plakaNo: kind === 'SATIS' ? '' : s.plakaNo, stopajKod: kind === 'SATIS' ? '' : (s.stopajKod || ''), satirlar: (s.satirlar || []).map((x: any) => ({ ...x, kayitTuruKod: ktKod, kayitAltKod: defaultKayitAltKod(kind, ktKod, ktAd) })) }));
  };
  // İşletme: aktarıma çıkan değerlerin özeti (alt çubuk).
  const islBelgeAd = islRef.belgeTuru.find((x) => x.kod === isl.belgeTuruKod)?.ad || '—';
  const islKayitAd = (islSatirlar.length > 1 ? `${islSatirlar.length} satır` : (islRef.kayitTuru.find((x) => x.kod === islSatirlar[0]?.kayitTuruKod)?.ad || '—'));
  // ── PLAN/15 Faz 3 FE (2026-09-13) — arka ucun yeni işletme alanları ──
  // "İncele" gerekçesi: tür seçilemeyince arka uç ocrData.isletme.neden yazar ve kayitTuruKod BOŞ kalır (form '4'/'2' ile başlar
  //   ama bu kullanıcı seçimi değildir). Kayıt türü kaydedilmişse gerekçe gösterilmez.
  const islSaved: any = (isIsletme && selDoc?.ocrData?.isletme) || {};
  const islNeden = String(islSaved.neden || '').trim();
  const islKayitTuruBos = !String(islSaved.kayitTuruKod || islSaved.satirlar?.[0]?.kayitTuruKod || '').trim();
  const islNedenGoster = isIsletme && !!islNeden && islKayitTuruBos;
  const islFaaliyetTanimsiz = /faaliyet\S*\s+tan[ıi]ms[ıi]z/i.test(islNeden) || (!String(taxpayerFaaliyet || '').trim() && !String(taxpayerNace || '').trim());
  // Stopaj seçenekleri: listede olmayan kod geldiyse (ileride başka tür) seçicide ayrıca göster.
  const islStopajSecenek = isl.stopajKod && !ISL_STOPAJ_SECENEK.some((x) => x.value === isl.stopajKod)
    ? [...ISL_STOPAJ_SECENEK, { value: String(isl.stopajKod), label: `${isl.stopajKod} (diğer)` }] : ISL_STOPAJ_SECENEK;
  // KKEG şüphesi (uyarı katmanı KKEG_SUPHESI) → satırda "KKEG?" çipi; tıklanınca üstteki Uyarılar kutusuna kaydırır (kapalıysa açar).
  const kkegUyari = isIsletme ? uyariListeFE((selDoc?.ocrData as any)?.uyarilar).find((u) => u.kod === 'KKEG_SUPHESI') : undefined;
  const fispaneRef = useRef<HTMLDivElement>(null);
  const kkegOdakla = () => {
    const kutu = fispaneRef.current?.querySelector<HTMLElement>('.uykutu');
    if (!kutu) return;
    if (kutu.classList.contains('kapali')) kutu.querySelector<HTMLButtonElement>('.uykutu-h')?.click();
    setTimeout(() => kutu.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

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
                <div className="fispane" ref={fispaneRef}>
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
                {/* Faz 2 — Uyarılar kutusu (editör): demirbaş kararı 3 düğme, öneriyi uygula, ilk belgeyi aç, alıcı tipini seç, tevkifat fişi, yönü çevir. */}
                <UyariKutusu doc={selDoc} taxpayerId={taxpayerId}
                  onIlkBelge={(ilk) => { if (all.some((x: any) => x.id === ilk)) setSelId(ilk); else toast.info('İlk belge bu dönem/listede değil — Gelen Belgeler ekranından arayın'); }}
                  onTevkifatFisi={() => { setMeta((m: any) => ({ ...m, tevkifatli: true })); applyTevkifatMut.mutate(); }}
                />
                <div className="twrap">
                  {isIsletme ? (
                    <div className="islforms">
                      {/* PLAN/15 Faz 3 FE — kayıt türü boşken "İncele" gerekçesi (ince amber satır). Faaliyet tanımsızsa Mükellefler kısayolu. */}
                      {islNedenGoster && (
                        <div className="isl-neden" title={islNeden}>
                          <span><b>Neden boş:</b> {islNeden}</span>
                          {islFaaliyetTanimsiz ? (onOpenMukellefler
                            ? <button type="button" className="isl-neden-link" onClick={onOpenMukellefler}>Mükellefler ekranından faaliyeti tanımlayın</button>
                            : <em>Mükellefler ekranından faaliyeti tanımlayın</em>) : null}
                        </div>
                      )}
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
                      {/* PLAN/15 Faz 3 FE — Plaka arka uçta otomatik dolabilir (metinden); Stopaj (022/041) seçicisi plakanın yanında (yalnız gider). */}
                      <div className="islgrid" style={{ gridTemplateColumns: islRef.plaka ? 'repeat(3, minmax(0, 1fr))' : '1fr' }}>
                        <div className="dm"><span className="dml">Evrak No</span><input className="dmi" value={meta.belgeNo || ''} onChange={(e) => setMeta({ ...meta, belgeNo: e.target.value })} /></div>
                        {islRef.plaka && (<div className="dm"><span className="dml">Plaka No</span><input className="dmi" value={isl.plakaNo || ''} placeholder="34 ABC 123 (otomatik bulunabilir)" onChange={(e) => setIslF('plakaNo', e.target.value)} /></div>)}
                        {islRef.plaka && (<div className="dm"><span className="dml">Stopaj</span>
                          <PlainSelect value={isl.stopajKod || ''} onChange={(v) => setIslF('stopajKod', v)} options={islStopajSecenek} />
                        </div>)}
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
                              <div className="dm"><span className="dml">K. Alt Türü
                                {/* PLAN/15 Faz 3 FE — KKEG şüphesi çipi: tıkla → üstteki Uyarılar kutusuna kaydır */}
                                {kkegUyari ? <button type="button" className="isl-kkeg" title={kkegUyari.aciklama} onClick={kkegOdakla}>KKEG?</button> : null}
                              </span>
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
                      {/* İADE / yön: bölüm tarafları takaslı; kullanıcı düğmeyle çevirebilir. */}
                      {/* Kullanıcı kararı (2026-09-12): 'Yönü çevir' KALDIRILDI — iade belgesinde ters kaydı sistem kurar (revalidate). */}
                      {/* Fiş grup/yön: düzenlenmekte olan meta.invoiceKind'i izle (kaydı beklemeden
                          ALIŞ↔SATIŞ dönsün); meta yoksa selDoc.invoiceKind'e düş. */}
                      {(String(meta.invoiceKind || selDoc.invoiceKind || '').includes('SATIS')
                        ? [
                            // SATIŞ: matrah(600)+KDV(391) ALACAK, cari(120) BORÇ
                            { key: 'matrah', keys: ['matrah', 'diger_vergi'], label: 'Matrah (Gelir)', side: 'credit' as const },
                            { key: 'vergi', keys: ['vergi'], label: 'Hesaplanan KDV', side: 'credit' as const },
                            { key: 'cari', keys: ['cari'], label: 'Cari Hesap', side: 'debit' as const },
                          ]
                        : [
                            // ALIŞ: matrah+KDV BORÇ, cari ALACAK. Tevkifatlıda "İndirilecek KDV" kutusu
                            // İÇİNDE normal+sorumlu sıf. satırları BİRLİKTE (kullanıcı: ayrı kutu olmasın,
                            // "+ satır ekle" ile aynı yerde) — hangi satırın "sorumlu" olduğu SEÇİLEN HESAP
                            // KODUNA göre otomatik belirlenir (bkz. CodeSelect onChange). 360 (KDV2) AYRI
                            // bölüm kalır — Mihsap'taki gibi gerçekten farklı bir hesap/işlem.
                            // KDV dışı vergi (ÖİV/telsiz — Faz 0) matrah kutusunda görünür: gider satırıdır, kodu 7xx.
                            { key: 'matrah', keys: ['matrah', 'diger_vergi'], label: 'Matrah', side: 'debit' as const },
                            { key: 'vergi', keys: ['vergi', 'vergi-sorumlu'], label: 'İndirilecek KDV', side: 'debit' as const },
                            // Tevkifat (360 · KDV2) grubu ALIŞ'ta HER ZAMAN sabit görünür (kullanıcı: Mihsap
                            // gibi alan hep dursun). Tevkifatlı faturada satırlar otomatik dolar; tevkifatsızda
                            // boş kalır (satır yoksa denge/toplam'a etki etmez, "+ satır ekle" ile elle girilir).
                            { key: 'tevkifat', keys: ['tevkifat'], label: 'Tevkifat — Ödenecek KDV (360 · KDV2)', side: 'credit' as const },
                            { key: 'cari', keys: ['cari'], label: 'Cari Hesap', side: 'credit' as const },
                          ]
                      ).map((g0) => (yonTers ? { ...g0, side: (g0.side === 'debit' ? 'credit' : 'debit') as 'debit' | 'credit' } : g0)).map((g) => {
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
                                  // YALNIZ 'İndirilecek KDV' kutusu (2026-09-13 canlı hata): matrah kutusu da iki backend-grup
                                  //   (matrah + diger_vergi) kapsadığından bu dal matrah satırını 'vergi' grubuna TAŞIYORDU →
                                  //   "+ satır ekle"yle açılan matrah satırı kod yazılınca İndirilecek KDV kutusuna kayıyordu.
                                  if (g.key === 'vergi' && g.keys.length > 1) {
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
/* ── PLAN16-G: Geri al (TERS FİŞ YOK) — yerel yardımcılar (yalnız bu ekran; deriveDurum'a dokunulmaz) ── */
/** Luca'dan geri alınmış belge işareti: ocrData.lucaElleDuzeltilecek → "bekliyor" (amber çip + Düzelttim);
 *  ocrData.lucaElleDuzeltildi → "duzeltildi" (yeşil çip). İkisi de yoksa null. Fiş no eski kayıttan (eskiLucaFisNo) da okunur. */
function ghElleDurumu(d: any): { durum: 'bekliyor' | 'duzeltildi' | null; fisNo: string; tarih: string; not: string } {
  const ocr: any = d?.ocrData || {};
  const bekleyen = ocr.lucaElleDuzeltilecek;
  if (bekleyen) return { durum: 'bekliyor', fisNo: String(bekleyen.lucaFisNo || ocr.eskiLucaFisNo || ''), tarih: String(bekleyen.tarih || ''), not: String(bekleyen.not || '') };
  const kapanan = ocr.lucaElleDuzeltildi;
  if (kapanan) return { durum: 'duzeltildi', fisNo: String(kapanan.lucaFisNo || ocr.eskiLucaFisNo || ''), tarih: String(kapanan.tarih || ''), not: String(kapanan.not || '') };
  return { durum: null, fisNo: '', tarih: '', not: '' };
}
/** Tarih + saat (tr-TR) — teyit kutusundaki aktarım zamanı ve entegratör "son çekim" bilgisi için. */
function ghTarihSaat(v: any): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
}
/** Backend reopen yanıtındaki geriAlma {lucaStatusEski, lucaFisNo, elleDuzeltilecek, ogrenmeGeriAlindi, ogrenmeToplam, demirbasKarariSilindi} → tek satır toast özeti. */
function ghGeriAlmaOzeti(g: any): string {
  const parca: string[] = ["Onay geri alındı — belge Gelen Faturalar'a döndü"];
  if (g) {
    const toplam = Number(g.ogrenmeToplam || 0);
    const geri = Number(g.ogrenmeGeriAlindi || 0);
    if (toplam > 0) parca.push(geri === toplam ? `öğrenme ${geri} kayıt geri alındı` : `öğrenme ${geri}/${toplam} kayıt geri alındı`);
    if (g.elleDuzeltilecek) parca.push(`Luca fiş ${g.lucaFisNo || '?'} elle düzeltilecek`);
    if (g.demirbasKarariSilindi) parca.push('demirbaş kararı silindi (yeniden sorulur)');
  }
  return parca.join(' · ');
}
/** "Geri al" düğmesi ikonu (küçük geri ok) — dosya başındaki I sözlüğüne dokunmamak için yerel. */
const GH_ICO_UNDO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>';

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
  // PLAN16-G: GERİ AL (TERS FİŞ YOK) — sayfa içi teyit kutusu (confirm() yerine). Luca'ya gitmiş (POSTED) belgede
  //   backend 409 { teyitGerekli, lucaFisNo, lucaPostedAt } döner → kutu "Luca" moduna geçer (fiş no + tarih + not);
  //   onaylanınca { onay:true, not } ile tekrar çağrılır. Geri alınan belge Gelen Faturalar'a döner (NEEDS_REVIEW),
  //   hesap satırları korunur, öğrenme geri alınır; Luca'daki fiş ELLE düzeltilir (portaldan bir daha gönderilmez).
  const [geriAl, setGeriAl] = useState<null | { id: string; belgeNo: string; firma: string; tutar: any; luca: boolean; lucaFisNo: string; lucaPostedAt: string; mesaj: string; not: string }>(null);
  const reopenMut = useMutation({
    mutationFn: (v: { id: string; onay?: boolean; not?: string }) =>
      api.post(`/fatura-muhasebelestirme/documents/${v.id}/reopen`, { ...(v.onay ? { onay: true } : {}), ...(v.not ? { not: v.not } : {}) }),
    onSuccess: (r: any) => {
      setGeriAl(null);
      const g = r?.data?.geriAlma;
      toast.success(ghGeriAlmaOzeti(g), { duration: g?.elleDuzeltilecek ? 10000 : 6000 });
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any, v) => {
      const d = e?.response?.data || {};
      if (e?.response?.status === 409 && d.teyitGerekli) {
        // Luca'ya gitmiş — kutu Luca modunda (sunucunun fiş no + tarihiyle) açılır/güncellenir.
        setGeriAl((p) => ({
          ...(p && p.id === v.id ? p : { id: v.id, belgeNo: '', firma: '', tutar: null, not: '' }),
          id: v.id, luca: true, lucaFisNo: String(d.lucaFisNo || ''), lucaPostedAt: String(d.lucaPostedAt || ''), mesaj: String(d.mesaj || d.message || ''),
        }));
        return;
      }
      toast.error('Geri alınamadı: ' + (d.message || e?.message || 'hata'), { duration: 8000 });
    },
  });
  // PLAN16-G: "Luca'da elle düzelttim" — lucaElleDuzeltilecek işareti kapanır (çip yeşile döner; belge Luca'ya yine gitmez).
  const duzelttimMut = useMutation({
    mutationFn: (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/luca-elle-duzeltildi`, {}),
    onSuccess: () => { toast.success("Luca'daki fiş elle düzeltildi olarak işaretlendi"); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('İşaretlenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // Satırdan "Geri al": POSTED ise kutu doğrudan Luca modunda açılır (satırdaki fiş no/tarihle); değilse sade teyit.
  //   Sunucu yine de 409 derse onError kutuyu Luca moduna çevirir.
  const geriAlAc = (d: any) => {
    const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
    setGeriAl({
      id: d.id, belgeNo: String(d.belgeNo || ''), firma: String((sat ? d.customerName : d.vendorName) || '—'), tutar: d.totalAmount,
      luca: d.lucaStatus === 'POSTED', lucaFisNo: String(d.lucaFisNo || ''), lucaPostedAt: String(d.lucaPostedAt || ''), mesaj: '', not: '',
    });
  };
  // YÖN bazlı toplu aktarım: "Alış'ı aktar" / "Satış'ı aktar" → o yönü TEK fişe çevirir.
  const [aktarYon, setAktarYon] = useState<'' | 'ALIS' | 'SATIS'>('');
  const batchMut = useMutation({
    mutationFn: (direction: 'ALIS' | 'SATIS') => api.post('/fatura-muhasebelestirme/batch-post-to-luca', { taxpayerId, period, direction }),
    onSuccess: (r: any) => {
      const d = r?.data || {};
      const yon = aktarYon === 'SATIS' ? 'Satış' : 'Alış';
      // A.6 — demirbaş kararı bekleyen / Luca'da elle işlenmiş belgeler gönderilmedi: sayıyı göster.
      toast.success(`${yon} TEK fiş olarak Luca'ya gönderildi · ${d.documentCount ?? 0} belge${d.skippedInvalid ? ` · ${d.skippedInvalid} veri hatası nedeniyle hariç` : ''}${d.skippedDemirbas ? ` · ${d.skippedDemirbas} belge demirbaş kararı bekliyor (gönderilmedi)` : ''}${d.skippedElleIslendi ? ` · ${d.skippedElleIslendi} belge Luca'da elle işlenmiş (gönderilmedi)` : ''}. Ajan açıkken işlenir.`, { duration: d.skippedDemirbas ? 9000 : undefined });
      if (d.skippedDemirbas) toast.info(`${d.skippedDemirbas} belge demirbaş kararı bekliyor — Gelen Belgeler'de belgeyi açıp karar verin, sonra tekrar aktarın.`, { duration: 9000 });
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
    // PLAN16-G: Luca'dan geri alınıp yeniden onaylanan belge de MANUAL_DONE olur (fiş Luca'da elle düzeltilir) — ipucu ayrı.
    if (s === 'MANUAL_DONE') return <span className="pill asset" title={ghElleDurumu(d).durum ? "Luca'dan geri alınmış belge — fiş Luca'da elle düzeltilir; portaldan tekrar gönderilmez" : "Demirbaş kararı: Luca'da elle işlendi — portaldan gönderilmedi"}>Luca'da elle işlendi</span>;
    if (s === 'POSTING') return <span className="pill warn">Aktarılıyor…</span>;
    if (s === 'FAILED' || s === 'ERROR') return <span className="pill miss" title={d.lucaErrorMessage || ''}>Hata</span>;
    return <span className="pill n">Aktarıma hazır</span>;
  };
  const grpLabel = (g: string) => g === 'matrah' ? 'Matrah' : g === 'vergi' ? 'KDV' : g === 'vergi-sorumlu' ? 'Sorumlu Sıf. KDV' : g === 'cari' ? 'Cari' : g === 'tevkifat' ? 'Tevkifat' : g === 'diger_vergi' ? 'KDV dışı vergi' : (g || '—');
  const renderRow = (d: any) => {
    const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
    const firma = (sat ? d.customerName : d.vendorName) || (String(d.documentType || '').toUpperCase() === 'Z_RAPORU' ? 'Z RAPORU' : '—');
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
          <td>
            {lucaPill(d)}
            {d.lucaFisNo ? <span className="gh-fis" title="Luca yevmiye fiş numarası">fiş {d.lucaFisNo}</span> : null}
            {(() => {
              // PLAN16-G: Luca'dan geri alınmış belge çipi — amber "elle düzeltilecek · fiş N" + Düzelttim; kapanınca yeşil.
              const el = ghElleDurumu(d);
              if (!el.durum) return null;
              const busy = duzelttimMut.isPending && duzelttimMut.variables === d.id;
              const bekliyor = el.durum === 'bekliyor';
              return (
                <div className="gh-elle">
                  <span className={`gh-cip ${bekliyor ? 'amber' : 'yesil'}`} title={`${bekliyor ? 'Geri alındı' : 'Elle düzeltildi'} ${ghTarihSaat(el.tarih)}${el.not ? ` · not: ${el.not}` : ''}${bekliyor ? " — Luca'daki fişi elle düzeltip 'Düzelttim' de. Portaldan tekrar gönderilmez." : ' — portaldan tekrar gönderilmez.'}`}>
                    {bekliyor ? "Luca'da elle düzeltilecek" : "Luca'da elle düzeltildi"}{el.fisNo ? <> · fiş <b>{el.fisNo}</b></> : null}
                  </span>
                  {bekliyor && (
                    <button type="button" className="gh-duzelttim" disabled={busy} onClick={() => duzelttimMut.mutate(d.id)} title="Luca'daki fişi elle düzelttim — işareti kapat">{busy ? 'İşaretleniyor…' : 'Düzelttim'}</button>
                  )}
                </div>
              );
            })()}
          </td>
          {/* td'ye display:flex VERME (hücre tablo düzeninden çıkar) — flex'i içteki div'e koy. */}
          <td className="actcol"><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(d.lucaStatus === 'FAILED' || d.lucaStatus === 'ERROR') && (
              <button className="aico retry" disabled={retryMut.isPending} onClick={() => retryMut.mutate(d.id)} title={d.lucaErrorMessage || "Luca'ya tekrar gönder"}><Ico html={I.sync} size={13} /></button>
            )}
            {/* PLAN16-G: etiketli "Geri al" (hover'a saklanmaz). APPROVED/QUEUED/FAILED/POSTED → açık; POSTING → kilitli. Toplu geri al YOK. */}
            {(d.status === 'APPROVED' || ['QUEUED', 'FAILED', 'POSTED', 'POSTING'].includes(d.lucaStatus)) && (
              <button type="button" className={`gh-geri${d.lucaStatus === 'POSTED' ? ' luca' : ''}`}
                disabled={d.lucaStatus === 'POSTING' || (reopenMut.isPending && reopenMut.variables?.id === d.id)}
                onClick={() => geriAlAc(d)}
                title={d.lucaStatus === 'POSTING' ? 'Aktarım sürüyor — bitince geri alabilirsin' : d.lucaStatus === 'POSTED' ? "Onayı geri al — Luca'ya gitmiş: fişi Luca'da elle düzeltmen gerekir (ters fiş yok)" : "Onayı geri al — belge Gelen Faturalar'a döner, hesap satırları korunur (ters fiş yok)"}>
                <Ico html={GH_ICO_UNDO} size={12} /> Geri al
              </button>
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
                  // KDV dışı vergi (ÖİV/telsiz — Faz 0) işletme defterinde gider tutarına dahil (luca-excel ile aynı).
                  const matrah = lines.filter((l: any) => String(l.group) === 'matrah' || String(l.group) === 'diger_vergi').reduce((s: number, l: any) => s + Number(l.debit || 0) + Number(l.credit || 0), 0);
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
    const hazirTum = dd.filter((d) => d.status === 'APPROVED' && !['POSTED', 'POSTING', 'MANUAL_DONE'].includes(d.lucaStatus));
    // A.6 — demirbaş kararı bekleyen / "Luca'da elle işlendi" kararlı belgeler aktarıma GİRMEZ (backend de eler); kartta ayrı sayı.
    const kararBekleyen = hazirTum.filter((d) => uyariOzetFE((d.ocrData as any)?.uyarilar).kararBekliyor);
    const elleIslenen = hazirTum.filter((d) => String((d.ocrData as any)?.demirbasKarar?.karar || '') === 'elle_islendi');
    const hazir = hazirTum.filter((d) => !kararBekleyen.includes(d) && !elleIslenen.includes(d));
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
            {!arsiv && kararBekleyen.length > 0 && (
              <span style={{ marginLeft: 8, color: '#7c3aed', fontWeight: 700 }} title={`Demirbaş kararı verilmeden Luca'ya gönderilmez: ${kararBekleyen.slice(0, 5).map((d) => d.belgeNo || d.id).join(', ')}${kararBekleyen.length > 5 ? '…' : ''}`}>
                · {kararBekleyen.length} belge demirbaş kararı bekliyor (gönderilmez)
              </span>
            )}
            {!arsiv && elleIslenen.length > 0 && (
              <span style={{ marginLeft: 8, color: '#64748b', fontWeight: 600 }} title="Demirbaş kararı: Luca'da elle işlendi — portaldan gönderilmez">· {elleIslenen.length} belge Luca'da elle işlenmiş</span>
            )}
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
      {/* PLAN16-G: sayfa içi teyit kutusu — sade (accent) ya da Luca'ya gitmiş (amber: fiş no + tarih + not). Ters fiş YOK. */}
      {geriAl && (
        <div className="gh-ov" onMouseDown={() => { if (!reopenMut.isPending) setGeriAl(null); }}>
          <div className="gh-box" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className={`gh-box-h${geriAl.luca ? ' luca' : ''}`}>
              <small>{geriAl.luca ? "LUCA'YA GİTMİŞ BELGE" : 'ONAYI GERİ AL'}</small>
              <b>{geriAl.luca ? "Luca'daki fişi elle düzeltmen gerekir" : 'Onay geri alınsın mı?'}</b>
            </div>
            <div className="gh-box-b">
              <div className="gh-box-meta">
                <span><small>Belge</small><b title={geriAl.belgeNo}>{geriAl.belgeNo || '—'}</b></span>
                <span><small>Firma</small><b title={geriAl.firma}>{geriAl.firma || '—'}</b></span>
                <span><small>Tutar</small><b>{fmtMoney(geriAl.tutar)} ₺</b></span>
                {geriAl.luca && <span><small>Luca fiş no</small><b className="gh-mono">{geriAl.lucaFisNo || '—'}</b></span>}
                {geriAl.luca && <span><small>Aktarım</small><b>{ghTarihSaat(geriAl.lucaPostedAt)}</b></span>}
              </div>
              {geriAl.luca ? (
                <>
                  <p className="gh-box-uyari">{(geriAl.mesaj || "Luca'ya gitmiş — geri alırsan Luca'daki fişi elle düzeltmen gerekir").replace(/[.\s]+$/, '')}. <b>Ters fiş üretilmez</b>, Luca'ya hiçbir şey gönderilmez.</p>
                  <p>Belge <b>Gelen Faturalar</b>'a döner; hesap satırları korunur, öğrenilen eşleşme geri alınır. Yeniden onaylandığında Luca'ya <b>otomatik gitmez</b> — Luca'daki fişi elle düzeltip satırdaki <b>"Düzelttim"</b> düğmesine basarsın.</p>
                  <label className="gh-box-not">
                    <small>Not (isteğe bağlı)</small>
                    <textarea rows={2} maxLength={300} value={geriAl.not} placeholder="Örn. KDV oranı yanlıştı — Luca'daki fiş düzeltilecek" onChange={(e) => { const v = e.target.value; setGeriAl((p) => (p ? { ...p, not: v } : p)); }} />
                  </label>
                </>
              ) : (
                <p>Belge <b>Gelen Faturalar</b>'a döner; hesap satırları korunur, öğrenilen eşleşme geri alınır, demirbaş kararı varsa silinir (yeniden sorulur). <b>Ters fiş üretilmez</b>, Luca'ya hiçbir şey gönderilmez.</p>
              )}
            </div>
            <div className="gh-box-f">
              <button type="button" className="btn ghost" disabled={reopenMut.isPending} onClick={() => setGeriAl(null)}>Vazgeç</button>
              <button type="button" className={`btn ${geriAl.luca ? 'gh-amber' : 'primary'}`} disabled={reopenMut.isPending}
                onClick={() => reopenMut.mutate(geriAl.luca ? { id: geriAl.id, onay: true, not: geriAl.not.trim() || undefined } : { id: geriAl.id })}>
                <Ico html={GH_ICO_UNDO} size={13} /> {reopenMut.isPending ? 'Geri alınıyor…' : geriAl.luca ? "Geri al (Luca'da elle düzelteceğim)" : 'Geri al'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===================== EKRAN: ENTEGRATÖRLER ===================== */
const PROVIDER_OPTS = [
  { v: 'PARASUT', l: 'Paraşüt' },
  { v: 'TURKCELL', l: 'Turkcell e-Şirket' },
  { v: 'ECZACIKART', l: 'Eczacıkart' },
  { v: 'TURMOB_EFATURA', l: 'TÜRMOB e-Fatura' },
  { v: 'UYUMSOFT', l: 'Uyumsoft' },
  { v: 'IZIBIZ', l: 'İzibiz' },
  { v: 'NILVERA', l: 'Nilvera' },
  { v: 'GIB_PORTAL', l: 'GİB e-Arşiv' },
  { v: 'ELOGO', l: 'e-Logo' },
  // Mikro = e-Mikro / Mikrogrup e-Portal (eportal.mikrogrup.com). Kimlik: e-Portal e-postası + parolası.
  { v: 'MIKRO', l: 'Mikro (e-Portal)' },
];
function provKisalt(label: string, provider: string): string {
  if (provider === 'TURMOB_EFATURA') return 'TR';
  if (provider === 'PARASUT') return 'PŞ';
  if (provider === 'GIB_PORTAL') return 'GİB';
  return (label || provider).replace(/[^A-Za-zÇĞİÖŞÜ]/g, '').slice(0, 2).toUpperCase();
}
/* ── PLAN16-H: gece çekim saati seçenekleri — 00:00…06:00 yarım saat adımlı (backend 00:00–06:59 kabul eder; varsayılan 02:00) ── */
// Saat başı adımlar: sunucu cron'u her saat başı (HH:05) tikler ve dakikayı yok sayar — yarım saat seçeneği yanıltıcıydı (2026-09-12).
const GH_GECE_SAATLERI: string[] = ['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00'];
const GH_GECE_VARSAYILAN_SAAT = '02:00';

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
  // Mikro (e-Mikro/e-Portal) yalnız kullanıcı+parola ister; client_id/secret/firma no BOŞ kalır.
  const isMikro = provider === 'MIKRO';
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
  // PLAN16-H: gece çekim ANAHTARI + saat — mükellef × entegratör bazında TEK TEK ("hepsini aç/kapat" YOK; varsayılan KAPALI).
  //   Anahtar: { active }; saat değişince { active: mevcut talimat, saat }. Backend 400 metinleri (mükellef seçilmedi /
  //   saat 00:00–06:59 dışı / entegratör tanımlı değil) toast'la aynen gösterilir.
  const talimatMut = useMutation({
    mutationFn: (v: { provider: string; active: boolean; saat?: string }) =>
      api.post('/fatura-muhasebelestirme/integrations/talimat', { taxpayerId: taxpayerId || undefined, provider: v.provider, active: v.active, ...(v.saat ? { saat: v.saat } : {}) }),
    onSuccess: (r: any, v) => {
      const d = r?.data || {};
      const saat = String(d.saat || v.saat || GH_GECE_VARSAYILAN_SAAT);
      if (v.saat) toast.success(`Çekim saati ${saat} olarak kaydedildi${d.talimat ? '' : ' (anahtar kapalı — açınca bu saatte çeker)'}`, { duration: 5000 });
      else toast.success(d.talimat ? `Gece çekimi AÇILDI — her gece ${saat}, yalnız bu mükellef × entegratör` : 'Gece çekimi kapatıldı', { duration: 6000 });
      qc.invalidateQueries({ queryKey: ['fm2', 'integrations'] });
    },
    onError: (e: any) => toast.error('Talimat güncellenemedi: ' + (e?.response?.data?.message || e?.message || 'hata'), { duration: 8000 }),
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
        {/* PLAN16-H: "Tüm mükellefler" görünümünde anahtar YOK — gece çekimi mükellef bazında açılır. */}
        <div className="card"><div className="empty">Mükellef seçilmedi.<br /><small>Gece çekimi mükellef bazında açılır — bu görünümde anahtar gösterilmez.</small></div></div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="h2">Entegratörler</div>
      <div className="sub">Mükellefin faturalarını çektiğimiz kaynaklar. Şifreler şifreli saklanır; gece çekimi mükellef bazında anahtarla açılır (varsayılan kapalı).</div>
      {/* PLAN16-H: bilgi bandı — gece çekimi VARSAYILAN KAPALI; tek tek açılır; global NIGHTLY_EFATURA=off tümünü durdurur. */}
      <div className="gh-band" role="note">
        <Ico html={I.info} size={16} />
        <div>
          <b>Gece çekimi varsayılan KAPALI.</b> Sistem oturunca mükellef bazında, her entegratör için tek tek açılır ("hepsini aç/kapat" yok).
          Çekim saati 00:00–06:00 arasından seçilir (varsayılan 02:00); açıkken içinde bulunulan dönem çekilir.
          Global <code>NIGHTLY_EFATURA=off</code> ile tümü durdurulabilir.
        </div>
      </div>
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
                  <div className="erow"><span>Son çekim</span><span title={c.lastSyncAt ? 'Son gece / elle çekim zamanı' : 'Henüz çekim yapılmadı'}>{c.lastSyncAt ? ghTarihSaat(c.lastSyncAt) : '—'}</span></div>
                  {(() => {
                    // PLAN16-H: gece çekim anahtarı (varsayılan KAPALI) + saat seçimi. Yalnız bağlı (connected) sağlayıcıda
                    //   etkin; değilse kilitli + ipucu "önce kimlik tanımla". Hepsini aç/kapat YOK — her kart kendi anahtarı.
                    const acik = c.talimat === true;
                    const kilit = !c.connected;
                    const busy = talimatMut.isPending && talimatMut.variables?.provider === c.provider;
                    const saat = String(c.saat || GH_GECE_VARSAYILAN_SAAT);
                    const saatler = GH_GECE_SAATLERI.includes(saat) ? GH_GECE_SAATLERI : [...GH_GECE_SAATLERI, saat].sort();
                    return (
                      <>
                        <div className="erow gh-gece">
                          <span>Gece çekim</span>
                          <span className="gh-gece-ctl">
                            <button type="button" role="switch" aria-checked={acik} className={`gh-switch${acik ? ' on' : ''}`} disabled={kilit || busy}
                              title={kilit ? 'Önce kimlik tanımla — bağlı olmayan entegratörde gece çekimi açılamaz' : acik ? 'Gece çekimini kapat' : 'Gece çekimini aç (yalnız bu mükellef × entegratör)'}
                              onClick={() => talimatMut.mutate({ provider: c.provider, active: !acik })}><i /></button>
                            <b className={`gh-gece-durum${acik ? ' on' : ''}`}>{busy ? '…' : acik ? 'Açık' : 'Kapalı'}</b>
                            <select className="gh-saat" value={saat} disabled={kilit || busy} title="Çekim saati (00:00–06:00, saat başı) — koşu o saatin ilk dakikalarında başlar"
                              onChange={(e) => talimatMut.mutate({ provider: c.provider, active: acik, saat: e.target.value })}>
                              {saatler.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </span>
                        </div>
                        <div className={`gh-gece-hint${kilit ? ' kilit' : acik ? ' on' : ''}`}>
                          {kilit
                            ? 'Kilitli — önce kimlik tanımla (entegratör bağlı değil).'
                            : acik
                              ? `Her gece ${saat} · içinde bulunulan dönem çekilir${c.talimatUpdatedAt ? ` · son değişiklik ${fmtDate(c.talimatUpdatedAt)}` : ''}`
                              : 'Kapalı — sistem oturunca bu mükellef için aç.'}
                        </div>
                      </>
                    );
                  })()}
                  <div className="ebtns">
                    <button className="btn ghost sm" disabled={fetchMut.isPending} onClick={() => fetchMut.mutate(c.provider)}>{fetchMut.isPending ? 'Sorgulanıyor…' : 'Sorgula'}</button>
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
                <div className="fld"><label>{isMikro ? 'Kullanıcı adı (e-Portal e-postası)' : 'Kullanıcı adı'}</label><input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={isMikro ? 'eportal.mikrogrup.com girişindeki e-posta' : 'mükellefin giriş kullanıcısı'} /></div>
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
/* ===================== PLAN16-D: KDV TEYİT — yardımcılar (yalnız ScreenKdv kullanır) =====================
   Arka uç: GET /fatura-muhasebelestirme/kdv-teyit?taxpayerId&period → aynı dönem DÖRT kaynak
   (Fatura Merkezi · KDV Kontrol · Luca mizanı 191/391 · önceki beyanname). FM ESAS alınır; diğer
   kaynaklarla fark `uyari` ise KIRMIZI, eşleşiyorsa yeşil ✓, kaynak yoksa gri "—".
   Drilldown: rozetler + FM sayıları belge listesi açar (tek istek: documents?limit=500, id kümesiyle süzülür).
   Kısıt: tek dosya / FaturaMerkeziPage'e dokunma yasak → "Muhasebeleştir'de aç" localStorage + reload ile. */
const KT_SATIRLAR: Array<{ k: string; ad: string }> = [
  { k: 'hesaplanan', ad: 'Hesaplanan KDV' },
  { k: 'indirilecek', ad: 'İndirilecek KDV' },
  { k: 'devreden', ad: 'Önceki dönemden devreden' },
  { k: 'odenecek', ad: 'Ödenecek' },
  { k: 'sonrakiDevreden', ad: 'Sonraki döneme devreden' },
];
const KT_KAYNAKLAR: Array<{ k: 'kdvKontrol' | 'lucaMizan' | 'oncekiBeyanname'; ad: string; yok: string }> = [
  { k: 'kdvKontrol', ad: 'KDV Kontrol', yok: 'KDV Kontrol oturumu yok' },
  { k: 'lucaMizan', ad: 'Luca mizanı (191/391)', yok: 'Luca mizanı çekilmemiş' },
  { k: 'oncekiBeyanname', ad: 'Önceki beyanname', yok: 'önceki beyanname yok' },
];
// Başlık rozetleri: kaynak.<k> sayısı → drilldown.<liste>; tıklanınca belge listesi açılır.
const KT_ROZETLER: Array<{ k: string; liste: string; ad: string; sinif: string }> = [
  { k: 'onaysiz', liste: 'onaysizBelgeler', ad: 'onaysız', sinif: 'onaysiz' },
  { k: 'iptalHaric', liste: 'iptalHaricBelgeler', ad: 'iptal hariç', sinif: 'iptal' },
  { k: 'mukerrerHaric', liste: 'mukerrerHaricBelgeler', ad: 'mükerrer hariç', sinif: 'mukerrer' },
  { k: 'tevkifatli', liste: 'tevkifatliBelgeler', ad: 'tevkifatlı', sinif: 'tevkifat' },
  { k: 'iade', liste: 'iadeBelgeler', ad: 'iade', sinif: 'iade' },
];
// Belge durumu → Türkçe etiket + mevcut .pill rengi (şema: NEEDS_REVIEW | READY | APPROVED | REJECTED | CANCELLED).
const KT_DURUM: Record<string, { t: string; c: string }> = {
  APPROVED: { t: 'Onaylı', c: 'ok' }, READY: { t: 'Onaya hazır', c: 'proc' }, NEEDS_REVIEW: { t: 'İncele', c: 'warn' },
  REJECTED: { t: 'Red', c: 'miss' }, CANCELLED: { t: 'İptal', c: 'miss' },
};
type KtListe = { anahtar: string; baslik: string; ids: string[] };
const ktYuzde = (y: any) => { const n = Number(y); return isFinite(n) ? `%${Math.round(n)}` : ''; };
const ktImzali = (n: any) => { const v = Number(n) || 0; return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtMoney(Math.abs(v)); };

/** Teyit hücresi: fark uyarısı → kırmızı + "fark −48.842,38 (%63)" + açıklama; eşleşme → yeşil ✓; kaynak yok → gri. */
function KtHucre({ deger, fark, kaynakYok, yokMetni }: { deger: any; fark: any; kaynakYok: boolean; yokMetni: string }) {
  if (kaynakYok) return <td className="num kt-cell yok" title={yokMetni}>— <small>({yokMetni})</small></td>;
  if (deger == null || !isFinite(Number(deger))) return <td className="num kt-cell yok" title="Bu kaynakta bu satır bulunmuyor">— <small>(bu kaynakta yok)</small></td>;
  if (fark && fark.uyari) {
    return (
      <td className="num kt-cell fark" title={fark.aciklama || `Fatura Merkezi esas: ${fmtMoney(fark.fmEsas)} ₺`}>
        <b>{fmtMoney(deger)}</b>
        <span className="kt-fark">fark {ktImzali(fark.fark)}{fark.yuzde != null ? ` (${ktYuzde(fark.yuzde)})` : ''}</span>
        {fark.aciklama ? <span className="kt-acik">{fark.aciklama}</span> : null}
      </td>
    );
  }
  return <td className="num kt-cell ok" title="Fatura Merkezi ile uyumlu"><b>{fmtMoney(deger)}</b> <span className="kt-ok" aria-label="uyumlu">✓</span></td>;
}

/** Drilldown belge listesi — belge no · tarih · karşı taraf · tutar · durum · "Muhasebeleştir'de aç".
 *  `earsiv:` önekli id = GİB sorgu satırı (FM'de belge yok). */
function KtBelgeListesi({ liste, docs, yukleniyor, hata, onKapat, onTekrar }: { liste: KtListe; docs: any[]; yukleniyor: boolean; hata: boolean; onKapat: () => void; onTekrar: () => void }) {
  const byId = useMemo(() => { const m = new Map<string, any>(); for (const d of docs || []) m.set(String(d.id), d); return m; }, [docs]);
  const muhasebedeAc = (id: string) => {
    // Tek dosya kısıtı: ScreenKdv'ye yeni prop eklenemez (FaturaMerkeziPage yasak) → ana sayfa açılışta
    // localStorage 'fm-screen' + 'fm-open-doc' okur; sayfa yenilenince Muhasebeleştir'de belge açılır.
    try { localStorage.setItem('fm-open-doc', id); localStorage.setItem('fm-screen', 'muhasebe'); } catch { /* yok say */ }
    window.location.reload();
  };
  return (
    <div className="kt-liste">
      <div className="kt-liste-h">
        <span>{liste.baslik} <span className="kt-cnt">{liste.ids.length}</span></span>
        <button type="button" className="btn sm ghost" onClick={onKapat}>Kapat</button>
      </div>
      {hata ? (
        <div className="yuklenemedi"><span><Ico html={I.info} size={14} /> Belgeler yüklenemedi (bağlantı/sunucu hatası).</span><button className="btn sm" onClick={onTekrar}><Ico html={I.sync} size={12} /> Tekrar dene</button></div>
      ) : yukleniyor ? (
        <div className="empty">Belgeler yükleniyor…</div>
      ) : liste.ids.length === 0 ? (
        <div className="empty">Bu listede belge yok.</div>
      ) : (
        <div className="kt-twrap">
          <table className="kt-table kt-belge">
            <thead><tr><th>Belge no</th><th>Tarih</th><th>Karşı taraf</th><th className="num">Tutar</th><th>Durum</th><th></th></tr></thead>
            <tbody>
              {liste.ids.map((id) => {
                const sid = String(id);
                if (sid.startsWith('earsiv:')) return <tr key={sid}><td colSpan={5} className="kt-gib">GİB sorgu satırı (FM'de belge yok) <small>{sid.slice(7)}</small></td><td></td></tr>;
                const d = byId.get(sid);
                if (!d) return <tr key={sid}><td colSpan={5} className="kt-gib">Belge listede bulunamadı (500 belge sınırı ya da silinmiş) <small>{sid}</small></td><td></td></tr>;
                const sat = String(d.invoiceKind || 'ALIS').toUpperCase() === 'SATIS';
                const du = KT_DURUM[String(d.status)] || { t: String(d.status || '—'), c: 'ham' };
                return (
                  <tr key={sid}>
                    <td className="kt-mono">{d.belgeNo || '—'}</td>
                    <td>{fmtDate(d.faturaTarihi || d.createdAt)}</td>
                    <td><b>{(sat ? d.customerName : d.vendorName) || '—'}</b> <span className={`pill ${sat ? 'satis' : 'alis'}`}>{sat ? 'Satış' : 'Alış'}</span></td>
                    <td className="num">{fmtMoney(d.totalAmount)} ₺</td>
                    <td><span className={`pill ${du.c}`}>{du.t}</span></td>
                    <td><button type="button" className="kt-ac" onClick={() => muhasebedeAc(sid)} title="Muhasebeleştir ekranında aç (sayfa yenilenir)">Muhasebeleştir'de aç →</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Teyit paneli — kartların altında, kategori dağılımının üstünde. */
function KtTeyitPaneli({ teyit, acik, onAc, children }: { teyit: any; acik: KtListe | null; onAc: (anahtar: string, baslik: string, ids: any) => void; children?: JSX.Element | null | false }) {
  const fm = teyit?.faturaMerkezi || {};
  const kay = fm.kaynak || {};
  const dd = teyit?.drilldown || {};
  const farklar: any[] = Array.isArray(teyit?.farklar) ? teyit.farklar : [];
  const satir = (k: string) => farklar.find((f) => f && f.satir === k) || null;
  const uyari = Number(teyit?.uyariSayisi) || 0;
  const tumBelge = () => Array.from(new Set([...(Array.isArray(dd.hesaplananBelgeler) ? dd.hesaplananBelgeler : []), ...(Array.isArray(dd.indirilecekBelgeler) ? dd.indirilecekBelgeler : [])].map(String)));
  const kk = teyit?.kdvKontrol || {};
  const lm = teyit?.lucaMizan || {};
  const ob = teyit?.oncekiBeyanname || {};
  return (
    <div className="card kt-card">
      <div className="ch">
        <h3>Teyit — aynı dönem, dört kaynak</h3>
        {uyari > 0 ? <span className="kt-hap fark">{uyari} fark</span> : <span className="kt-hap uyum">✓ tüm kaynaklar uyumlu</span>}
        <span className="kt-esik">Fatura Merkezi esas · eşik ±{fmtMoney(teyit?.esikTL ?? 1)} ₺</span>
      </div>
      <div className="kt-rozet">
        <span className="kt-rozl">kaynak:</span>
        <button type="button" className={`kt-roz belge${acik?.anahtar === 'belge' ? ' on' : ''}`} onClick={() => onAc('belge', 'Dönem belgeleri (hesaplanan + indirilecek)', tumBelge())} title="Toplamlara giren tüm belgeler"><span className="n">{kay.belge ?? 0}</span> belge</button>
        {Number(kay.gibYalniz) > 0 && (
          <button type="button" className={`kt-roz gib${acik?.anahtar === 'gibYalniz' ? ' on' : ''}`} onClick={() => onAc('gibYalniz', 'GİB sorgu satırları (FM\'de belge yok)', tumBelge().filter((x) => x.startsWith('earsiv:')))} title="GİB sorgusunda var, Fatura Merkezi'nde belge yok"><span className="n">{kay.gibYalniz}</span> GİB-yalnız</button>
        )}
        {KT_ROZETLER.map((r) => {
          const n = Number(kay[r.k]) || 0;
          return (
            <button key={r.k} type="button" className={`kt-roz ${r.sinif}${n === 0 ? ' bos' : ''}${acik?.anahtar === r.k ? ' on' : ''}`} disabled={n === 0} onClick={() => onAc(r.k, `${r.ad.charAt(0).toLocaleUpperCase('tr-TR')}${r.ad.slice(1)} belgeler`, dd[r.liste])} title={n === 0 ? `${r.ad} belge yok` : 'Belge listesini aç'}>
              <span className="n">{n}</span> {r.ad}
            </button>
          );
        })}
      </div>
      <div className="kt-twrap">
        <table className="kt-table">
          <thead>
            <tr>
              <th>Satır</th>
              <th className="num">Fatura Merkezi</th>
              {KT_KAYNAKLAR.map((s) => <th key={s.k} className="num">{s.ad}</th>)}
            </tr>
          </thead>
          <tbody>
            {KT_SATIRLAR.map((s) => {
              const f = satir(s.k);
              const fmDeger = f ? f.fm : fm[s.k];
              const tik = s.k === 'hesaplanan'
                ? { a: 'hesaplanan', b: 'Hesaplanan KDV belgeleri (satış)', ids: dd.hesaplananBelgeler }
                : s.k === 'indirilecek' ? { a: 'indirilecek', b: 'İndirilecek KDV belgeleri (alış)', ids: dd.indirilecekBelgeler } : null;
              return (
                <tr key={s.k} className={f?.uyari ? 'kt-uyari' : undefined}>
                  <td><b>{s.ad}</b>{f?.etiket ? <small className="kt-etk">{f.etiket}</small> : null}</td>
                  <td className="num kt-fm">
                    {tik ? (
                      <button type="button" className={`kt-fmbtn${acik?.anahtar === tik.a ? ' on' : ''}`} onClick={() => onAc(tik.a, tik.b, tik.ids)} title="Belge listesini aç">
                        {fmtMoney(fmDeger)} <small>{(Array.isArray(tik.ids) ? tik.ids : []).length} belge</small>
                      </button>
                    ) : <b>{fmtMoney(fmDeger)}</b>}
                  </td>
                  {KT_KAYNAKLAR.map((k) => (
                    <KtHucre key={k.k} deger={f ? f[k.k] : null} fark={f?.fark?.[k.k] || null} kaynakYok={!!teyit?.[k.k]?.yok} yokMetni={k.yok} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="kt-kaynak">
        <span><b>KDV Kontrol:</b> {kk.yok ? 'oturum yok' : `${kk.satisFaturaAdet ?? 0} satış · ${kk.alisFaturaAdet ?? 0} alış faturası`}</span>
        <span><b>Luca mizanı:</b> {lm.yok ? 'çekilmemiş' : `${lm.hesapAdet ?? 0} hesap · ${fmtDate(lm.cekildiAt)}`}</span>
        <span><b>Önceki beyanname:</b> {ob.yok ? 'yok' : `${periodLabel(String(ob.donem || ''))} · devreden ${fmtMoney(ob.devreden)} ₺`}</span>
      </div>
      {Array.isArray(teyit?.notlar) && teyit.notlar.length > 0 && (
        <div className="kt-notlar">
          {teyit.notlar.map((n: string, i: number) => <div key={i} className="kt-not"><Ico html={I.info} size={13} /> <span>{n}</span></div>)}
        </div>
      )}
      {children}
    </div>
  );
}

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

  // PLAN16-D — Teyit: aynı dönem dört kaynak. Hata YUTULMAZ (isError → "Tekrar dene").
  const teyitQ = useQuery({
    queryKey: ['fm2', 'kdv-teyit', taxpayerId, period],
    queryFn: () => api.get('/fatura-muhasebelestirme/kdv-teyit', { params: { taxpayerId, period } }).then((r) => r.data),
    enabled: !!taxpayerId,
  });
  const teyit: any = teyitQ.data;
  // Açık drilldown listesi (rozet / FM sayısı / "Hesap atanmamış"). Aynı anahtara tekrar tıklayınca kapanır.
  const [ktListe, setKtListe] = useState<KtListe | null>(null);
  // Drilldown belgeleri — TEK istek; yalnız bir liste açıkken çekilir, id kümesiyle süzülür.
  const ktDocsQ = useQuery({
    queryKey: ['fm2', 'kt-docs', taxpayerId, period],
    queryFn: async () => {
      const r = await api.get('/fatura-muhasebelestirme/documents', { params: { taxpayerId, period, limit: 500 } });
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: !!taxpayerId && !!ktListe,
  });
  const ktAc = (anahtar: string, baslik: string, ids: any) => {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    setKtListe((c) => (c && c.anahtar === anahtar ? null : { anahtar, baslik, ids: list }));
  };
  // Kısayollar (kategori tablosu "Hesap atanmamış" satırı): "Kodları düzelt" = ScreenFaturalar'daki recodeMut ile
  // AYNI gövde (reapply-codes {taxpayerId}); "AI ile oku" = aiOku ile aynı kalıp (ai-read-batch {documentIds}).
  const qc = useQueryClient();
  const recodeMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/documents/reapply-codes', { taxpayerId }),
    onSuccess: () => { toast.success('Hesap kodları yeniden eşleştirildi — rapor yenileniyor'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: () => toast.error('Yeniden eşleştirme başarısız'),
  });
  const [ktAiBusy, setKtAiBusy] = useState(false);
  const ktAiOku = async (ids: string[]) => {
    const temiz = ids.filter((x) => x && !String(x).startsWith('earsiv:'));
    if (!temiz.length) { toast.error('Hesap atanmamış belge yok'); return; }
    setKtAiBusy(true);
    try {
      const r = await api.post('/fatura-muhasebelestirme/documents/ai-read-batch', { documentIds: temiz });
      toast.success(`${r?.data?.queued ?? temiz.length} belge okuma sırasına alındı — Gelen Faturalar şeridinden izle (sayfa değişse de sürer)`);
      qc.invalidateQueries({ queryKey: ['fm-ocr-progress'] });
    } catch { toast.error('Okuma başlatılamadı'); }
    finally { setKtAiBusy(false); }
  };
  // Hesap atanmamış belge id'leri: önce rapor (kdv-client-report), yoksa teyit drilldown'u.
  const haIds: string[] = (Array.isArray(rep?.hesapAtanmamis?.belgeler) && rep.hesapAtanmamis.belgeler.length
    ? rep.hesapAtanmamis.belgeler
    : (teyit?.drilldown?.hesapAtanmamisBelgeler || [])).map(String);

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
        <div className="card"><div className="empty">Mükellef seçilmedi. Teyit (Fatura Merkezi · KDV Kontrol · Luca mizanı · önceki beyanname) için mükellef seç.</div></div>
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

          {/* PLAN16-D — Teyit paneli: aynı dönem dört kaynak; FM esas, farklar kırmızı, drilldown belge listesi. */}
          {teyitQ.isError ? (
            <div className="card kt-card">
              <div className="ch"><h3>Teyit — aynı dönem, dört kaynak</h3></div>
              <div className="yuklenemedi" style={{ margin: '10px 16px 14px' }}>
                <span><Ico html={I.info} size={14} /> Teyit yüklenemedi (bağlantı/sunucu hatası) — "fark yok" değil.</span>
                <button className="btn sm" onClick={() => teyitQ.refetch()}><Ico html={I.sync} size={12} /> Tekrar dene</button>
              </div>
            </div>
          ) : teyitQ.isLoading ? (
            <div className="card kt-card">
              <div className="ch"><h3>Teyit — aynı dönem, dört kaynak</h3></div>
              <div className="empty">Teyit hesaplanıyor (KDV Kontrol · Luca mizanı · önceki beyanname)…</div>
            </div>
          ) : teyit ? (
            <KtTeyitPaneli teyit={teyit} acik={ktListe} onAc={ktAc}>
              {ktListe && ktListe.anahtar !== 'hesapAtanmamis' ? (
                <KtBelgeListesi liste={ktListe} docs={ktDocsQ.data || []} yukleniyor={ktDocsQ.isLoading} hata={ktDocsQ.isError} onKapat={() => setKtListe(null)} onTekrar={() => ktDocsQ.refetch()} />
              ) : null}
            </KtTeyitPaneli>
          ) : null}

          <div className="card">
            <div className="ch"><h3>Kategori dağılımı</h3></div>
            <div className="twrap">
              <table>
                <thead><tr><th>Kategori</th><th>Yön</th><th className="num">Matrah</th><th className="num">KDV</th><th className="num">Toplam</th><th className="num">Adet</th></tr></thead>
                <tbody>
                  {(rep.categoryRows || []).map((c: any) => {
                    // PLAN16-D: "Sınıflandırılamayan" yerine "Hesap atanmamış (N)" + kısayollar. N = KODSUZ belge sayısı
                    //   (c.hesapAtanmamisCount / rep.hesapAtanmamis.count); satır kovası ayrıca 25x/18x gibi "diğer alışları" da içerir.
                    const hesapYok = c.alias === 'hesapAtanmamis' || c.key === 'unclassified';
                    const haN = Number(c.hesapAtanmamisCount ?? rep?.hesapAtanmamis?.count ?? 0);
                    return (
                      <tr key={c.key}>
                        <td>
                          {hesapYok ? (
                            <span className="kt-ha">
                              <button type="button" className={`kt-fmbtn${ktListe?.anahtar === 'hesapAtanmamis' ? ' on' : ''}`} onClick={() => ktAc('hesapAtanmamis', 'Hesap atanmamış belgeler', haIds)} title="Hesap atanmamış belge listesini aç">
                                Hesap atanmamış ({haN})
                              </button>
                              {Number(c.count) > haN && <small className="kt-etk">satırda diğer alışlar da var ({c.count} belge)</small>}
                              <span className="kt-kisayol">
                                <button type="button" className="btn sm fix" disabled={!taxpayerId || recodeMut.isPending} onClick={() => recodeMut.mutate()} title="Belgeleri TEKRAR OKUMADAN hesap kodlarını plana göre yeniden eşleştir (saniyeler sürer)"><Ico html={I.wand} size={12} /> {recodeMut.isPending ? 'Düzeltiliyor…' : 'Kodları düzelt'}</button>
                                <button type="button" className="btn sm ai" disabled={ktAiBusy || haIds.length === 0} onClick={() => ktAiOku(haIds)} title={haIds.length === 0 ? 'Hesap atanmamış belge yok' : 'Hesap atanmamış belgeleri yapay zeka (Max) ile oku — sunucuda okur, sayfa değişince durmaz'}><Ico html={I.spark} size={12} /> {ktAiBusy ? 'Başlatılıyor…' : `AI ile oku${haIds.length ? ` (${haIds.length})` : ''}`}</button>
                              </span>
                            </span>
                          ) : <b>{c.label}</b>}
                        </td>
                        <td><span className={`pill ${c.side === 'SATIS' ? 'satis' : 'alis'}`}>{c.side === 'SATIS' ? 'Satış' : 'Alış'}</span></td>
                        <td className="num">{fmtMoney(c.base)}</td>
                        <td className="num">{fmtMoney(c.vat)}</td>
                        <td className="num">{fmtMoney(c.total)}</td>
                        <td className="num">{c.count ?? '—'}</td>
                      </tr>
                    );
                  })}
                  {(rep.categoryRows || []).length === 0 && <tr><td colSpan={6}><div className="empty">Kategori verisi yok.</div></td></tr>}
                </tbody>
              </table>
            </div>
            {ktListe && ktListe.anahtar === 'hesapAtanmamis' ? (
              <KtBelgeListesi liste={ktListe} docs={ktDocsQ.data || []} yukleniyor={ktDocsQ.isLoading} hata={ktDocsQ.isError} onKapat={() => setKtListe(null)} onTekrar={() => ktDocsQ.refetch()} />
            ) : null}
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
/* ═══════════════════════════════════════════════════════════════════════════
   FATURA KES — satış faturası hazırlama (2026-08-20)

   GÜVENLİK: Bu ekran hiçbir yere belge GÖNDERMEZ. Yalnız taslak hazırlar ve
   önizler. GİB'e/entegratöre gönderim AYRI bir adım olarak, AYRI onayla
   eklenecektir — tek tıkla resmî fatura oluşmaz.
   ═══════════════════════════════════════════════════════════════════════════ */
// Taslak durumlari — kullaniciya NE OLDUGU acikca yazilir ("gonderilmedi" / "GIB'de taslak").
//   GIB_TASLAK RESMI BELGE DEGILDIR: imzalanmamistir, portaldan silinebilir, vergi dogurmaz.
const FK_DURUM: Record<string, { etiket: string; bg: string; renk: string }> = {
  TASLAK: { etiket: 'gönderilmedi', bg: '#fef3c7', renk: '#92400e' },
  GONDERILIYOR: { etiket: 'GİB yanıtı belirsiz — portaldan kontrol edin', bg: '#ffedd5', renk: '#9a3412' },
  GIB_TASLAK: { etiket: "GİB'de taslak · imzasız", bg: '#dbeafe', renk: '#1e40af' },
  KESILDI: { etiket: 'kesildi', bg: '#dcfce7', renk: '#166534' },
  IPTAL: { etiket: 'iptal', bg: '#f5f5f4', renk: '#78716c' },
};

/** Islem dugmesi bicimi. Islevler hover'a SAKLANMAZ (tasarim kurali) — hep gorunur. */
const fkIslem = (renk: string): any => ({
  fontSize: 12, fontWeight: 600, color: renk, background: '#fff',
  border: '1px solid ' + renk + '33', borderRadius: 8, padding: '4px 10px', cursor: 'pointer',
});

const FK_BIRLER = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz'];
const FK_ONLAR = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan'];
function fkUcBasamak(n: number): string {
  const y = Math.floor(n / 100), o = Math.floor((n % 100) / 10), b = n % 10;
  return (y ? (y === 1 ? 'Yüz' : FK_BIRLER[y] + 'Yüz') : '') + FK_ONLAR[o] + FK_BIRLER[b];
}
/**
 * Tutari yaziya cevirir — gerceklik hissi icin fatura altindaki "Yalniz ... TL" satiri.
 * Sunucudaki yaziyla() ile AYNI kural: "Bin" tek basina yazilir (BirBin degil).
 * NOT: bu yalniz EKRAN icindir; belgeye giden metni entegrator/sunucu uretir.
 */
function tutarYaziyla(n: number): string {
  if (!Number.isFinite(n)) return '';
  const tam = Math.floor(Math.abs(n));
  const kurus = Math.round((Math.abs(n) - tam) * 100);
  if (tam === 0 && !kurus) return 'Sıfır';
  const mil = Math.floor(tam / 1000000), bin = Math.floor((tam % 1000000) / 1000), kalan = tam % 1000;
  let s = '';
  if (mil) s += fkUcBasamak(mil) + 'Milyon';
  if (bin) s += (bin === 1 ? 'Bin' : fkUcBasamak(bin) + 'Bin');
  s += fkUcBasamak(kalan);
  return kurus ? s + ' TL ' + fkUcBasamak(kurus) + ' Kuruş' : s + ' TL';
}

function ScreenFaturaKes({ taxpayerId, taxpayers }: { taxpayerId: string; taxpayers: any[] }) {
  const qc = useQueryClient();
  // TÜRKİYE GÜNÜ (denetim 2026-08-20): toISOString UTC verir; gece 00:00-03:00 arasında
  //   varsayılan tarih bir gün geri geliyor ve max=bugun yüzünden bugünü seçmek imkânsızlaşıyordu.
  const bugun = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [aliciVkn, setAliciVkn] = useState('');
  const [aliciUnvan, setAliciUnvan] = useState('');
  const [aliciVd, setAliciVd] = useState('');
  const [aliciAdres, setAliciAdres] = useState('');
  const [tarih, setTarih] = useState(bugun);
  const [aciklama, setAciklama] = useState('');
  const [matrah, setMatrah] = useState('');
  const [kdvOrani, setKdvOrani] = useState(20);
  const [miktar, setMiktar] = useState('1');
  const [birim, setBirim] = useState('ADET');
  const [acikTaslak, setAcikTaslak] = useState<string | null>(null);

  const mukellef = taxpayers.find((t) => t.id === taxpayerId);

  // KANAL: fatura hangi kapıdan kesilecek? Entegratörlü mükellefte GİB'den kesmek belge
  //   numarasını çakıştırdığı için sunucu engelliyor; kullanıcı bunu ÖNCEDEN görmeli.
  const kanalQ = useQuery({
    queryKey: ['fatura-kes', 'kanal', taxpayerId],
    queryFn: () => api.get('/fatura-kes/kanal', { params: { taxpayerId } }).then((r) => r.data as any),
    enabled: !!taxpayerId,
  });

  const listQ = useQuery({
    queryKey: ['fatura-kes', 'taslak', taxpayerId],
    queryFn: () => api.get('/fatura-kes/taslak', { params: { taxpayerId: taxpayerId || undefined, limit: 50 } }).then((r) => r.data as any[]),
  });

  // Tutarlar ANLIK hesaplanır — kullanıcı hazırlamadan önce ne olacağını görür.
  // PARA HATASI DÜZELTİLDİ (denetim 2026-08-20): "en sağdaki ayraç ondalıktır" kuralı
  //   "8.000" değerini 8 TL okuyordu (kutunun kendi ipucu metni de "8.000,00" diyor).
  //   Sunucudaki sayi() ile AYNI kural: virgül ondalık; yalnız nokta ise TEK nokta +
  //   1-2 haneli kesir ondalık, aksi hâlde TR binlik ayracı.
  const mNum = (() => {
    const t = String(matrah).trim().replace(/\s|₺|TL/gi, '');
    if (!t) return NaN;
    const sonVirgul = t.lastIndexOf(',');
    const sonNokta = t.lastIndexOf('.');
    let d: string;
    if (sonVirgul >= 0) {
      d = t.slice(0, sonVirgul).replace(/\D/g, '') + '.' + t.slice(sonVirgul + 1).replace(/\D/g, '');
    } else if (sonNokta >= 0) {
      const kesir = t.slice(sonNokta + 1);
      const tekNokta = t.indexOf('.') === sonNokta;
      d = tekNokta && /^\d{1,2}$/.test(kesir)
        ? t.slice(0, sonNokta).replace(/\D/g, '') + '.' + kesir
        : t.replace(/\D/g, '');
    } else {
      d = t.replace(/\D/g, '');
    }
    return d && d !== '.' ? Number(d) : NaN;
  })();
  const kdvNum = Number.isFinite(mNum) ? Math.round(mNum * kdvOrani) / 100 : NaN;
  const toplamNum = Number.isFinite(mNum) ? mNum + kdvNum : NaN;
  const tl = (n: number) => (Number.isFinite(n) ? n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

  const vknGecerli = /^\d{10}$|^\d{11}$/.test(aliciVkn.replace(/\D/g, ''));
  const hazir = !!taxpayerId && vknGecerli && aliciUnvan.trim().length > 1 && aciklama.trim().length > 1 && Number.isFinite(mNum) && mNum > 0;

  const olusturMut = useMutation({
    mutationFn: () =>
      api.post('/fatura-kes/taslak', {
        taxpayerId,
        aliciVkn: aliciVkn.replace(/\D/g, ''),
        aliciUnvan: aliciUnvan.trim(),
        aliciVd: aliciVd.trim() || undefined,
        aliciAdres: aliciAdres.trim() || undefined,
        faturaTarihi: tarih,
        aciklama: aciklama.trim(),
        matrah,
        kdvOrani,
        miktar,
        birim,
        kaynak: 'PORTAL',
      }).then((r) => r.data),
    onSuccess: (d: any) => {
      toast.success('Taslak hazırlandı — hiçbir yere gönderilmedi');
      qc.invalidateQueries({ queryKey: ['fatura-kes', 'taslak'] });
      setAcikTaslak(d?.id || null);
      setAciklama('');
      setMatrah('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Taslak oluşturulamadı'),
  });

  // İPTAL: GİB'e gönderilmiş taslakta "iptal" YALNIZ BİZDEKİ kaydı kapatır — GİB'deki
  //   taslak durmaya devam eder ve imzalanabilir. Kullanıcı bunu ÖNCEDEN görmeli.
  const [iptalOnay, setIptalOnay] = useState<any>(null);
  // GİB'deki belgenin KENDİ görüntüsünü getir (salt okuma).
  const gorselMut = useMutation({
    mutationFn: (id: string) => api.post(`/fatura-kes/taslak/${id}/gorsel`).then((r) => r.data),
    onSuccess: (d: any, id: string) => {
      if (d?.ok) {
        toast.success(d.faturaNo ? `GİB görüntüsü alındı · ${d.faturaNo}` : 'GİB görüntüsü alındı');
        qc.invalidateQueries({ queryKey: ['fatura-kes', 'taslak'] });
        qc.invalidateQueries({ queryKey: ['fatura-kes', 'onizleme', id] });
        setAcikTaslak(id);
      } else toast.error(d?.not || 'GİB görüntüsü bulunamadı');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'GİB görüntüsü alınamadı'),
  });

  const iptalMut = useMutation({
    mutationFn: (id: string) => api.delete(`/fatura-kes/taslak/${id}`).then((r) => r.data),
    onSuccess: (d: any) => {
      setIptalOnay(null);
      if (d?.gibdeDuruyor) toast(d.uyari || "Bizde iptal edildi — GİB'deki taslak duruyor", { icon: '⚠️', duration: 8000 });
      else toast.success('Taslak iptal edildi');
      qc.invalidateQueries({ queryKey: ['fatura-kes', 'taslak'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İptal edilemedi'),
  });

  // GİB'E GÖNDER — GİB'de TASLAK oluşur, RESMİ BELGE DEĞİL (imzalama yapılmaz, SMS adımına gelinmez).
  //   Tek tıkla gönderim YOK: kullanıcı ayrı kutuda ne olacağını görüp açıkça onaylar.
  // İPTAL EDİLENLER VARSAYILAN GİZLİ: iptal edilmiş taslak liste doldurup işi
  //   gölgeliyordu (kullanıcı bulgusu: "bir sürü fatura görünüyor").
  const [iptalleriGoster, setIptalleriGoster] = useState(false);
  const [gibOnay, setGibOnay] = useState<any>(null);

  // TANIM SIRASI ONEMLI: bu satir iptalleriGoster'i ANINDA okur (.filter hemen calisir).
  //   Onceki halinde state tanimindan ONCE duruyordu -> render aninda
  //   "Cannot access 'iptalleriGoster' before initialization" ile EKRAN KOMPLE PATLIYORDU.
  //   TypeScript yakalamaz, cunku kullanim bir ok fonksiyonunun icinde.
  const gorunenTaslaklar = (listQ.data || []).filter((x: any) => iptalleriGoster || x.durum !== 'IPTAL');
  const [gibdeIsrar, setGibdeIsrar] = useState(false);
  const gibMut = useMutation({
    mutationFn: (id: string) => api.post(`/fatura-kes/taslak/${id}/gib`, { kuruTest: false, gibdeIsrar }).then((r) => r.data),
    onSuccess: (d: any) => {
      setGibOnay(null);
      setGibdeIsrar(false);
      toast.success(d?.faturaNo ? `GİB'de taslak oluştu · ${d.faturaNo}` : "GİB'de taslak oluştu — imzalanmadı");
      qc.invalidateQueries({ queryKey: ['fatura-kes', 'taslak'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'GİB taslağı oluşturulamadı'),
  });

  // RENK AÇIKÇA VERİLİR (kullanıcı bulgusu 2026-08-20): tarih ve KDV oranı kutularında
  //   yazı GÖRÜNMÜYORDU. Düz metin kutuları görünürken <select> ve <input type=date>'in
  //   TARAYICI-İÇİ metni kayboluyordu — bu iç metin `color`/`-webkit-text-fill-color`
  //   ile boyanır ve sayfa CSS'i onu eziyordu. Sayfanın kendi tarih alanları (.dmi) da
  //   rengi zaten açıkça tanımlıyor; aynısını burada da yapıyoruz.
  const inp: any = {
    padding: '9px 11px', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 14,
    width: '100%', background: '#fff', color: '#1c1917', WebkitTextFillColor: '#1c1917',
    fontFamily: 'inherit', appearance: 'auto', WebkitAppearance: 'auto', opacity: 1,
  };
  const lbl: any = { fontSize: 11, letterSpacing: '.08em', color: '#78716c', fontWeight: 600, marginBottom: 5, display: 'block' };

  return (
    <div style={{ padding: 14 }}>
      {!taxpayerId && (
        <div style={{ padding: 16, background: '#fafaf9', borderRadius: 10, color: '#57534e', fontSize: 14 }}>Önce üstten bir mükellef seç.</div>
      )}

      {taxpayerId && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 14, alignItems: 'start', fontSize: 12 }}>
          {/* ---------- BELGE: gerçek e-Fatura çıktısının düzeni (sade, tek ekran) ---------- */}
          <div style={{ background: '#fff', border: '1px solid #d6d3d1', padding: 14 }}>
            {kanalQ.data?.uyari && (
              <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8, lineHeight: 1.4 }}>{kanalQ.data.uyari}</div>
            )}

            {/* ÜST: satıcı · belge türü · belge bilgileri */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px 232px', gap: 10, alignItems: 'start' }}>
              <div style={{ border: '1px solid #9ca3af', padding: '6px 8px', lineHeight: 1.45 }}>
                <div style={{ fontWeight: 700 }}>
                  {mukellef ? (mukellef.companyName || [mukellef.firstName, mukellef.lastName].filter(Boolean).join(' ')) : ''}
                </div>
                <div style={{ color: '#44403c' }}>{mukellef?.address || ''}</div>
                <div style={{ marginTop: 3 }}>
                  <span style={{ display: 'inline-block', width: 78, color: '#57534e' }}>Vergi Dairesi</span>: {mukellef?.taxOffice || '—'}
                </div>
                <div>
                  <span style={{ display: 'inline-block', width: 78, color: '#57534e' }}>VKN</span>: {mukellef?.taxNumber || '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center', paddingTop: 6 }}>
                <div style={{ width: 54, height: 54, margin: '0 auto', border: '1px solid #9ca3af', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#78716c', fontSize: 9, lineHeight: 1.2 }}>GİB</div>
                <div style={{ marginTop: 4, fontWeight: 600 }}>{kanalQ.data?.kanal === 'ENTEGRATOR' ? 'e-Fatura' : 'e-Arşiv'}</div>
              </div>
              <div style={{ border: '1px solid #9ca3af' }}>
                <div style={{ background: '#3f4a5a', color: '#fff', padding: '3px 8px', fontSize: 11 }}>Belge Bilgileri</div>
                <div style={{ padding: '6px 8px', lineHeight: 1.7 }}>
                  <div><span style={{ display: 'inline-block', width: 92, color: '#57534e' }}>Senaryo</span>: TİCARİ FATURA</div>
                  <div><span style={{ display: 'inline-block', width: 92, color: '#57534e' }}>Fatura Tipi</span>: SATIŞ</div>
                  <div><span style={{ display: 'inline-block', width: 92, color: '#57534e' }}>Fatura No</span>: <span style={{ color: '#78716c' }}>onayda verilecek</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 92, color: '#57534e' }}>Fatura Tarihi</span>:
                    <input type="date" style={{ ...inp, padding: '1px 4px', fontSize: 12, width: 118, border: '1px solid #e7e5e4' }} value={tarih} max={bugun} onChange={(e) => setTarih(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* SAYIN (alıcı) */}
            <div style={{ border: '1px solid #9ca3af', borderTop: 'none', padding: '6px 8px', marginTop: -1, maxWidth: '62%' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>SAYIN</div>
              <input style={{ ...inp, padding: '3px 5px', fontSize: 12, border: '1px solid #e7e5e4', marginBottom: 3 }} value={aliciUnvan} onChange={(e) => setAliciUnvan(e.target.value)} placeholder="Ünvan ya da ad soyad" />
              <input style={{ ...inp, padding: '3px 5px', fontSize: 12, border: '1px solid #e7e5e4' }} value={aliciAdres} onChange={(e) => setAliciAdres(e.target.value)} placeholder="Mahalle, cadde, no — İLÇE / İL" />
              <div style={{ display: 'flex', gap: 12, marginTop: 5, alignItems: 'center' }}>
                <span style={{ color: '#57534e' }}>Vergi Dairesi:</span>
                <input style={{ ...inp, padding: '2px 5px', fontSize: 12, width: 130, border: '1px solid #e7e5e4' }} value={aliciVd} onChange={(e) => setAliciVd(e.target.value)} />
                <span style={{ color: '#57534e' }}>VKN/TCKN:</span>
                <input style={{ ...inp, padding: '2px 5px', fontSize: 12, width: 120, border: aliciVkn && !vknGecerli ? '1px solid #dc2626' : '1px solid #e7e5e4', fontFamily: 'ui-monospace,monospace' }} value={aliciVkn} onChange={(e) => setAliciVkn(e.target.value)} inputMode="numeric" />
              </div>
            </div>

            {/* KALEM TABLOSU */}
            <div style={{ marginTop: 12, border: '1px solid #9ca3af' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '30px minmax(0,1fr) 62px 74px 104px 74px 92px', background: '#3f4a5a', color: '#fff', fontSize: 11 }}>
                <div style={{ padding: '4px 5px', borderRight: '1px solid #64748b' }}>Sıra</div>
                <div style={{ padding: '4px 5px', borderRight: '1px solid #64748b' }}>Mal / Hizmet</div>
                <div style={{ padding: '4px 5px', borderRight: '1px solid #64748b', textAlign: 'right' }}>Miktar</div>
                <div style={{ padding: '4px 5px', borderRight: '1px solid #64748b' }}>Birim</div>
                <div style={{ padding: '4px 5px', borderRight: '1px solid #64748b', textAlign: 'right' }}>Birim Fiyat</div>
                <div style={{ padding: '4px 5px', borderRight: '1px solid #64748b', textAlign: 'right' }}>KDV Oranı</div>
                <div style={{ padding: '4px 5px', textAlign: 'right' }}>Tutar</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '30px minmax(0,1fr) 62px 74px 104px 74px 92px', alignItems: 'center', borderTop: '1px solid #d6d3d1' }}>
                <div style={{ padding: '4px 5px', textAlign: 'center', color: '#57534e' }}>1</div>
                <div style={{ padding: 3 }}>
                  <input style={{ ...inp, padding: '3px 5px', fontSize: 12, border: '1px solid #e7e5e4' }} value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Nakliye hizmet bedeli" />
                </div>
                <div style={{ padding: 3 }}>
                  <input style={{ ...inp, padding: '3px 5px', fontSize: 12, border: '1px solid #e7e5e4', textAlign: 'right' }} value={miktar} onChange={(e) => setMiktar(e.target.value)} inputMode="decimal" />
                </div>
                <div style={{ padding: 3 }}>
                  <select style={{ ...inp, padding: '3px 2px', fontSize: 12, border: '1px solid #e7e5e4' }} value={birim} onChange={(e) => setBirim(e.target.value)}>
                    {['ADET', 'KG', 'GRAM', 'TON', 'LİTRE', 'METRE', 'M2', 'M3', 'KM', 'PAKET', 'KUTU', 'KOLİ', 'ÇİFT', 'DÜZİNE', 'TAKIM', 'SAAT', 'GÜN', 'AY', 'YIL'].map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                <div style={{ padding: 3 }}>
                  <input style={{ ...inp, padding: '3px 5px', fontSize: 12, border: '1px solid #e7e5e4', textAlign: 'right' }} value={matrah} onChange={(e) => setMatrah(e.target.value)} placeholder="8.000,00" inputMode="decimal" />
                </div>
                <div style={{ padding: 3 }}>
                  <select style={{ ...inp, padding: '3px 2px', fontSize: 12, border: '1px solid #e7e5e4', textAlign: 'right' }} value={kdvOrani} onChange={(e) => setKdvOrani(Number(e.target.value))}>
                    {[20, 10, 1, 0].map((o) => (<option key={o} value={o}>%{o}</option>))}
                  </select>
                </div>
                <div style={{ padding: '4px 5px', textAlign: 'right' }}>{tl(mNum)}</div>
              </div>
            </div>

            {/* TOPLAMLAR */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <div style={{ width: 320, border: '1px solid #9ca3af', lineHeight: 1.9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 8px' }}>
                  <span>Mal / Hizmet Toplam Tutarı</span><span>{tl(mNum)} TL</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 8px' }}>
                  <span>Vergiler Hariç Toplam Tutar</span><span>{tl(mNum)} TL</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 8px' }}>
                  <span>Hesaplanan KDV (%{kdvOrani})</span><span>{tl(kdvNum)} TL</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 8px', borderTop: '1px solid #d6d3d1', fontWeight: 700 }}>
                  <span>Ödenecek Tutar</span><span>{tl(toplamNum)} TL</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ color: '#44403c' }}>
                Yalnız {Number.isFinite(toplamNum) && toplamNum > 0 ? tutarYaziyla(toplamNum) : '—'}
              </div>
              <button
                disabled={!hazir || olusturMut.isPending}
                onClick={() => olusturMut.mutate()}
                style={{ padding: '7px 16px', border: 'none', fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', borderRadius: 4, cursor: hazir ? 'pointer' : 'not-allowed', background: hazir ? '#b45309' : '#d6d3d1' }}
              >
                {olusturMut.isPending ? 'Hazırlanıyor…' : 'Taslak hazırla'}
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#78716c' }}>
              Bu ekran fatura göndermez. Fatura numarası ve imza yalnız onay adımında verilir.
            </div>
          </div>

          {/* ---------- TASLAKLAR (sade liste) ---------- */}
          <div style={{ background: '#fff', border: '1px solid #d6d3d1' }}>
            <div style={{ padding: '5px 9px', borderBottom: '1px solid #e7e5e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#57534e' }}>
              <span style={{ fontWeight: 700 }}>TASLAKLAR</span>
              {(listQ.data || []).some((x: any) => x.durum === 'IPTAL') && (
                <button onClick={() => setIptalleriGoster((v) => !v)} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                  {iptalleriGoster ? 'iptalleri gizle' : 'iptaller (' + (listQ.data || []).filter((x: any) => x.durum === 'IPTAL').length + ')'}
                </button>
              )}
            </div>
            <div style={{ maxHeight: 620, overflowY: 'auto' }}>
              {listQ.isLoading && (<div style={{ padding: 10, color: '#a8a29e' }}>Yükleniyor…</div>)}
              {listQ.isError && (<div style={{ padding: 10, color: '#b91c1c' }}>Taslaklar getirilemedi.</div>)}
              {!listQ.isLoading && !listQ.isError && gorunenTaslaklar.length === 0 && (<div style={{ padding: 10, color: '#a8a29e' }}>Henüz taslak yok.</div>)}
              {gorunenTaslaklar.map((d: any) => {
                const dur = FK_DURUM[d.durum] || FK_DURUM.TASLAK;
                return (
                  <div key={d.id} style={{ padding: '6px 9px', borderBottom: '1px solid #f5f5f4', lineHeight: 1.45 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ color: '#1c1917', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.aliciUnvan}</span>
                      <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{tl(d.toplam)}</span>
                    </div>
                    <div style={{ color: '#78716c', fontSize: 11 }}>
                      {new Date(d.faturaTarihi).toLocaleDateString('tr-TR')} · <span style={{ color: dur.renk }}>{dur.etiket}</span>{d.faturaNo ? ' · ' + d.faturaNo : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 11, marginTop: 2 }}>
                      <button onClick={() => setAcikTaslak(d.id)} style={fkIslem('#2563eb')}>önizle</button>
                      {d.durum === 'GIB_TASLAK' && !d.faturaNo && (
                        <button disabled={gorselMut.isPending} onClick={() => gorselMut.mutate(d.id)} style={fkIslem('#0f766e')}>GİB görüntüsü</button>
                      )}
                      {d.durum === 'TASLAK' && (
                        <button onClick={() => { setGibdeIsrar(false); setGibOnay(d); }} style={fkIslem('#b45309')}>gönder</button>
                      )}
                      {d.durum !== 'KESILDI' && d.durum !== 'IPTAL' && d.durum !== 'GONDERILIYOR' && (
                        <button onClick={() => (d.durum === 'GIB_TASLAK' ? setIptalOnay(d) : iptalMut.mutate(d.id))} style={fkIslem('#b91c1c')}>iptal</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {iptalOnay && (
        <div onClick={() => !iptalMut.isPending && setIptalOnay(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,.5)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(520px,100%)', overflow: 'hidden', boxShadow: '0 24px 60px rgba(28,25,23,.28)' }}>
            <div style={{ padding: '16px 20px', background: 'radial-gradient(120% 140% at 0% 0%, #fecaca 0%, #ef4444 55%, #991b1b 100%)', color: '#fff' }}>
              <div style={{ fontSize: 11, letterSpacing: '.1em', opacity: .9, fontWeight: 600 }}>DİKKAT</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>GİB&apos;deki taslak SİLİNMEZ</div>
            </div>
            <div style={{ padding: '18px 20px', fontSize: 14, color: '#292524', lineHeight: 1.6 }}>
              <b>{iptalOnay.aliciUnvan}</b>{iptalOnay.faturaNo ? ` · ${iptalOnay.faturaNo}` : ''}<br />
              Bu iptal <b>yalnız bizdeki kaydı</b> kapatır. Fatura GİB&apos;de <b>taslak olarak durmaya devam eder</b> ve
              oradan imzalanırsa <b>resmî fatura olur</b>. Gerçekten kaldırmak için GİB portalından da silinmeli.
            </div>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', padding: '0 20px 18px' }}>
              <button disabled={iptalMut.isPending} onClick={() => setIptalOnay(null)} style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid #e7e5e4', background: '#fff', fontSize: 14, cursor: 'pointer', color: '#57534e' }}>Vazgeç</button>
              <button disabled={iptalMut.isPending} onClick={() => iptalMut.mutate(iptalOnay.id)} style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 14, fontWeight: 600, color: '#fff', cursor: iptalMut.isPending ? 'wait' : 'pointer', background: 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
                {iptalMut.isPending ? 'İptal ediliyor…' : 'Anladım, bizdeki kaydı iptal et'}
              </button>
            </div>
          </div>
        </div>
      )}

      {gibOnay && (
        <div onClick={() => { if (!gibMut.isPending) { setGibdeIsrar(false); setGibOnay(null); } }} style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,.5)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(520px,100%)', overflow: 'hidden', boxShadow: '0 24px 60px rgba(28,25,23,.28)' }}>
            <div style={{ padding: '16px 20px', background: 'radial-gradient(120% 140% at 0% 0%, #fde68a 0%, #f59e0b 55%, #b45309 100%)', color: '#fff' }}>
              <div style={{ fontSize: 11, letterSpacing: '.1em', opacity: .9, fontWeight: 600 }}>GİB E-ARŞİV</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>Taslak GİB&apos;e gönderilsin mi?</div>
            </div>
            <div style={{ padding: '18px 20px', fontSize: 14, color: '#292524', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 12 }}>
                <b>{gibOnay.aliciUnvan}</b><br />
                {new Date(gibOnay.faturaTarihi).toLocaleDateString('tr-TR')} · {String(gibOnay.aciklama || '')}<br />
                <b style={{ fontSize: 16 }}>{tl(gibOnay.toplam)} ₺</b> <span style={{ color: '#78716c' }}>(matrah {tl(gibOnay.matrah)} + KDV {tl(gibOnay.kdvTutari)})</span>
              </div>
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 9, padding: '11px 13px', fontSize: 13, color: '#0c4a6e' }}>
                GİB&apos;de <b>taslak</b> oluşur. <b>İmzalanmaz</b> — resmî belge değildir, vergi doğurmaz, portaldan silinebilir.
                Kesinleştirme (SMS onayı) ayrı bir adımdır, bu düğme oraya gitmez.
              </div>

              {kanalQ.data?.sebep === 'ENTEGRATOR' && (
                <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, padding: '11px 13px', fontSize: 13, color: '#78350f', cursor: 'pointer' }}>
                  <input type="checkbox" checked={gibdeIsrar} onChange={(e) => setGibdeIsrar(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>
                    Bu mükellef <b>{kanalQ.data.saglayici}</b> ile bağlı. Faturalarını oradan kesiyorsa GİB&apos;den kesmek
                    belge numarasını çakıştırır. <b>Kestiğini biliyorum, yine de GİB&apos;den kesilsin.</b>
                  </span>
                </label>
              )}

              {kanalQ.data?.sebep === 'KIMLIK_YOK' && (
                <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '11px 13px', fontSize: 13, color: '#7f1d1d' }}>
                  Bu mükellefin GİB e-Arşiv kimliği tanımlı değil — gönderilemez.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', padding: '0 20px 18px' }}>
              <button disabled={gibMut.isPending} onClick={() => { setGibdeIsrar(false); setGibOnay(null); }} style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid #e7e5e4', background: '#fff', fontSize: 14, cursor: 'pointer', color: '#57534e' }}>Vazgeç</button>
              {(() => {
                const engelli = kanalQ.data?.sebep === 'KIMLIK_YOK' || (kanalQ.data?.sebep === 'ENTEGRATOR' && !gibdeIsrar);
                return (
              <button disabled={gibMut.isPending || engelli} onClick={() => gibMut.mutate(gibOnay.id)} style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 14, fontWeight: 600, color: '#fff', cursor: gibMut.isPending ? 'wait' : engelli ? 'not-allowed' : 'pointer', background: engelli ? '#d6d3d1' : 'linear-gradient(135deg,#b45309,#d97706)' }}>
                {gibMut.isPending ? 'Gönderiliyor…' : "Evet, GİB'e gönder"}
              </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {acikTaslak && (
        <div onClick={() => setAcikTaslak(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(780px,100%)', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f5f5f4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 14 }}>Taslak önizleme</b>
              <button onClick={() => setAcikTaslak(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#78716c' }}>×</button>
            </div>
            <FaturaKesOnizleme id={acikTaslak} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Önizleme HTML'ini API'den çekip gösterir (iframe src'de token taşımamak için). */
function FaturaKesOnizleme({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['fatura-kes', 'onizleme', id],
    queryFn: () => api.get(`/fatura-kes/taslak/${id}`).then((r) => r.data as any),
  });
  const gercek = !!q.data?.gercekBelge;
  return (
    <>
      {q.data && (
        <div style={{ padding: '7px 16px', fontSize: 12, background: gercek ? '#ecfdf5' : '#fffbeb', color: gercek ? '#065f46' : '#92400e', borderBottom: '1px solid #f5f5f4' }}>
          {gercek
            ? `GİB'deki belgenin kendi görüntüsü${q.data.faturaNo ? ' · ' + q.data.faturaNo : ''}`
            : 'Bu bir ÖNİZLEME — belge GİB\'de henüz oluşmadı, numara ve karekod yok'}
        </div>
      )}
      <iframe
        title="taslak-onizleme"
        srcDoc={q.data?.onizlemeHtml || '<p style="font-family:system-ui;padding:24px;color:#78716c">Yükleniyor…</p>'}
        style={{ border: 'none', width: '100%', height: '70vh', background: '#fff' }}
      />
    </>
  );
}

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

/* ===================== PLAN16-E: BELGE AKIŞI (ofis geneli, tüm mükellefler) ===================== */
// Arka uç: GET /fatura-muhasebelestirme/documents/akis (belge-akisi.service.ts). Sekme/durum sözlüğü ORADA tek
//   kaynak; burada yalnız görünüm + süzgeç + eylemler. Sayaçlar süzgeçten bağımsız, OFİS GENELİ.
//   WhatsApp sekmesi YOK (kullanıcı kararı). Üst çubuktaki DÖNEM ve MÜKELLEF bu ekranda GEÇMEZ (karar 2026-09-12):
//   sisteme giren bütün belgeler geliş zamanına göre yeniden eskiye; mükellef yalnız isteğe bağlı YEREL süzgeç.
//   Sadeleştirme 2026-09-12: sayaç kartları, kaynak süzgeci, tarih alanları, kırmızı "akış durmuş" kartı KALDIRILDI.
// Kullanıcı kararı (2026-09-12): kaynak sekmeleri (Yüklenen/Entegratör/GİB) KALKTI — tüm belgeler tek listede,
//   kaynak zaten Belge sütununda rozet. Yalnız 'tumu' ve 'silinen' (denetim izi) kaldı.
type AkSekme = 'tumu' | 'silinen';
const AK_LIMIT = 50;
const AK_SEKMELER: Array<{ v: AkSekme; l: string; t: string }> = [
  { v: 'tumu', l: 'Tüm belgeler', t: 'Sisteme giren bütün belgeler — yükleme, entegratör, GİB (kaynak satırda rozet)' },
  { v: 'silinen', l: 'Silinenler', t: 'Silinmiş belgeler (denetim izi): kim, ne zaman, eski durumu' },
];
/** Durum hapı renkleri — okunuyor cyan · okundu gri-mavi · karar bekliyor mor · onaylı yeşil · Luca'da koyu yeşil ·
 *  hata kırmızı · iptal gri · silindi gri-kırmızı. */
const AK_DURUM: Record<string, { l: string; fg: string; bg: string; bd: string }> = {
  okunuyor: { l: 'Okunuyor', fg: '#0e7490', bg: '#e0f7fa', bd: '#a5e3ec' },
  okundu: { l: 'Okundu', fg: '#3b5b8a', bg: '#eef2f8', bd: '#c9d6ea' },
  karar_bekliyor: { l: 'Karar bekliyor', fg: '#7c3aed', bg: '#f3e8ff', bd: '#e3d4fb' },
  onayli: { l: 'Onaylı', fg: '#15803d', bg: '#e7f6ec', bd: '#bfe5cc' },
  lucada: { l: "Luca'da", fg: '#0b5e2f', bg: '#d7f0e0', bd: '#9fd6b5' },
  hata: { l: 'Hata', fg: '#b91c1c', bg: '#fdeaea', bd: '#f3c0c0' },
  iptal: { l: 'İptal', fg: '#64748b', bg: '#eef1f5', bd: '#d8dfe9' },
  silindi: { l: 'Silindi', fg: '#9f3a3a', bg: '#f3eaea', bd: '#dcc4c4' },
};
const AK_DURUM_SECENEK: Array<{ v: string; l: string }> = [
  { v: '', l: 'Durum: Tümü' }, { v: 'okunuyor', l: 'Okunuyor' }, { v: 'okundu', l: 'Okundu' }, { v: 'karar_bekliyor', l: 'Karar bekliyor' },
  { v: 'onayli', l: 'Onaylı' }, { v: 'lucada', l: "Luca'da" }, { v: 'hata', l: 'Hata' }, { v: 'iptal', l: 'İptal' },
];
/** Zaman hapları — geliş zamanına göre; from/to sunucuda gün bazlı ve kapsayıcı (YYYY-MM-DD). Varsayılan 30 gün. */
type AkZaman = 'bugun' | '7' | '30' | '';
const AK_ZAMAN: Array<{ v: AkZaman; l: string; t: string }> = [
  { v: 'bugun', l: 'Bugün', t: 'Bugün sisteme giren belgeler' },
  { v: '7', l: '7 gün', t: 'Son 7 günde sisteme giren belgeler' },
  { v: '30', l: '30 gün', t: 'Son 30 günde sisteme giren belgeler (varsayılan)' },
  { v: '', l: 'Tümü', t: 'Zaman süzgeci yok — bütün belgeler' },
];
function akGunStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Zaman hapı → from/to. Bugün: from=to=bugün (kanıtlı kalıp); 7/30 gün: yalnız from (bugün dahil geriye N gün). */
function akZamanAralik(z: AkZaman): { from?: string; to?: string } {
  if (!z) return {};
  const bugun = new Date();
  if (z === 'bugun') { const s = akGunStr(bugun); return { from: s, to: s }; }
  const gun = z === '7' ? 7 : 30;
  const d = new Date(bugun);
  d.setDate(d.getDate() - (gun - 1));
  return { from: akGunStr(d) };
}
/** Kaynak rozeti rengi: entegratörler SORGU_PROV_RENK paletinden, GİB amber, Mihsap/e-fatura kutusu indigo, mobil cyan, yükleme accent. */
function akKaynakRenk(kod: any): string {
  const s = String(kod || '').toLowerCase();
  if (s.startsWith('integration-')) return sorguProvRenk(s.slice('integration-'.length));
  if (s === 'mihsap' || s.startsWith('efatura-')) return '#4f46e5';
  if (s === 'earsiv' || s.startsWith('gib-')) return sorguProvRenk('GIB_PORTAL');
  if (s.startsWith('mobile')) return '#0891b2';
  if (s.startsWith('whatsapp')) return '#15803d';
  return 'var(--accent)';
}
function akKaynakKisalt(etiket: any, kod: any): string {
  const s = String(kod || '').toLowerCase();
  const e = String(etiket || '');
  if (s.startsWith('integration-')) return provKisalt(e, s.slice('integration-'.length).toUpperCase());
  if (s === 'earsiv' || s.startsWith('gib-')) return 'GİB';
  if (s.startsWith('mobile')) return 'MB';
  return provKisalt(e, e) || '?';
}
/** Geliş zamanı: GG.AA SS:DD (tam tarih araç ipucunda). */
function akFmtZaman(v: any): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Belgenin dönemi (YYYY-MM) — "Aç" Muhasebeleştir'e giderken üst çubuk dönemi buna çevrilir (o ekran mükellef+dönemle süzer). */
function akDonemOf(r: any): string {
  const d = new Date(r?.faturaTarihi || r?.gelisZamani || '');
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** Silinebilir mi: silinen sekmesi hariç; Luca'ya gitmiş (POSTED) / elle işlenmiş (MANUAL_DONE) silinmez. */
function akSilinebilir(r: any): boolean {
  if (!r || r.durum === 'silindi') return false;
  const luca = String(r.lucaStatus || '').toUpperCase();
  return r.durum !== 'lucada' && luca !== 'POSTED' && luca !== 'MANUAL_DONE';
}
/** AI ile okunabilir mi: onaylı / Luca'ya gitmiş belge yeniden okunmaz (fiş satırları değişir; önce "Geri al"); okunuyor olan da atlanır. */
function akOkunabilir(r: any): boolean {
  if (!r || r.durum === 'silindi' || r.durum === 'okunuyor') return false;
  return r.durum !== 'onayli' && r.durum !== 'lucada' && String(r.status || '').toUpperCase() !== 'APPROVED';
}

// Üst çubuktaki taxpayerId prop'u bu ekranda BİLEREK kullanılmaz (karar 2026-09-12): ekran ofis geneli; mükellef yerel süzgeç.
function ScreenAkis({ taxpayers, onOpenMuhasebe }: { taxpayerId: string; taxpayers: any[]; onOpenMuhasebe: (id: string, taxpayerId?: string, donem?: string) => void }) {
  const qc = useQueryClient();
  const [sekme, setSekme] = useState<AkSekme>('tumu');
  // Mükellef süzgeci YEREL ve isteğe bağlı: araç çubuğundaki seçici ya da "akış durmuş" listesinden tıklama doldurur; üst çubuğu değiştirmez.
  const [tp, setTp] = useState('');
  const [yon, setYon] = useState<'' | 'ALIS' | 'SATIS'>('');
  const [durum, setDurum] = useState('');
  const [zaman, setZaman] = useState<AkZaman>('30');
  const [q, setQ] = useState('');
  const [qD, setQD] = useState(''); // 400 ms gecikmeli arama
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [durmusAcik, setDurmusAcik] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const { from = '', to = '' } = akZamanAralik(zaman);
  useEffect(() => { const t = setTimeout(() => setQD(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  // Süzgeç değişince 1. sayfa + seçim temizlenir (bayat id ile toplu işlem gitmesin); sayfa değişince yalnız seçim.
  useEffect(() => { setPage(1); setSel(new Set()); }, [sekme, tp, yon, durum, zaman, qD]);
  useEffect(() => { setSel(new Set()); }, [page]);

  const akisQ = useQuery({
    queryKey: ['fm2', 'akis', sekme, tp, yon, durum, from, to, qD, page],
    queryFn: async () => {
      const r = await api.get('/fatura-muhasebelestirme/documents/akis', {
        params: { sekme, taxpayerId: tp || undefined, yon: yon || undefined, durum: durum || undefined, from: from || undefined, to: to || undefined, q: qD || undefined, page, limit: AK_LIMIT },
      });
      return r.data || {};
    },
    refetchInterval: 15_000, // canlı sayaç çipleri (15 sn)
    placeholderData: (prev: any) => prev, // sayfa/süzgeç değişirken eski liste solgun kalır, ekran zıplamaz
  });
  // Sekme haplarındaki toplamlar: her sekmenin SÜZGEÇSİZ, OFİS GENELİ sayısı; 120 sn'de bir.
  const sekmeSayQ = useQuery({
    queryKey: ['fm2', 'akis-sekme-say'],
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(AK_SEKMELER.map(async (s) => {
        try {
          const r = await api.get('/fatura-muhasebelestirme/documents/akis', { params: { sekme: s.v, page: 1, limit: 1 } });
          out[s.v] = Number(r?.data?.toplam) || 0;
        } catch { out[s.v] = -1; }
      }));
      return out;
    },
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
  // Ofis geneli sayaçlar + "akış durmuş" listesi: mükellef süzgeci açıkken sunucu yanıtı o mükellefe daralır;
  //   son SÜZGEÇSİZ yanıt burada tutulur ki bant ve çipler ofis geneli kalsın.
  const [ofisGeneli, setOfisGeneli] = useState<{ sayac: any; durmus: any[] }>({ sayac: {}, durmus: [] });
  useEffect(() => {
    if (tp || !akisQ.data || akisQ.isPlaceholderData) return;
    const d: any = akisQ.data;
    setOfisGeneli({ sayac: d.sayaclar || {}, durmus: Array.isArray(d.akisDurmus) ? d.akisDurmus : [] });
  }, [tp, akisQ.data, akisQ.isPlaceholderData]);
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/fatura-muhasebelestirme/documents/${id}`),
    onSuccess: () => { toast.success('Belge silindi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Silinemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // TOPLU SİL: toplu uç yok → tek tek DELETE; Luca'ya gitmiş / elle işlenmiş olanlar çağrılmadan atlanır.
  const bulkDelMut = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0; const hata: string[] = [];
      for (const id of ids) {
        try { await api.delete(`/fatura-muhasebelestirme/documents/${id}`); ok++; }
        catch (e: any) { hata.push(e?.response?.data?.message || e?.message || 'hata'); }
      }
      return { ok, hata };
    },
    onSuccess: ({ ok, hata }) => {
      if (ok > 0) toast.success(`${ok} belge silindi`);
      if (hata.length) toast.error(`${hata.length} belge silinemedi: ${hata[0]}`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Toplu silme başarısız: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });

  const veri: any = akisQ.data || {};
  const satirlar: any[] = Array.isArray(veri.satirlar) ? veri.satirlar : [];
  const toplam = Number(veri.toplam) || 0;
  const sayac: any = tp ? ofisGeneli.sayac : (veri.sayaclar || ofisGeneli.sayac || {});
  const akisDurmus: any[] = tp ? ofisGeneli.durmus : (Array.isArray(veri.akisDurmus) ? veri.akisDurmus : ofisGeneli.durmus);
  const sekmeSay: Record<string, number> = sekmeSayQ.data || {};
  const silinen = sekme === 'silinen';
  // "Süzgeçleri temizle" yalnız varsayılandan sapınca (30 gün varsayılan sayılmaz).
  const suzgecVar = !!(tp || yon || durum || qD || zaman !== '30');
  const sayfaSayisi = Math.max(1, Math.ceil(toplam / AK_LIMIT));
  const ilk = toplam === 0 ? 0 : (page - 1) * AK_LIMIT + 1;
  const son = Math.min(toplam, page * AK_LIMIT);
  // Süzgeç daralınca sayfa taşarsa son sayfaya çek (yalnız gerçek veriyle; yer tutucu veriyle değil).
  useEffect(() => { if (!akisQ.isPlaceholderData && akisQ.data && page > sayfaSayisi) setPage(sayfaSayisi); }, [page, sayfaSayisi, akisQ.isPlaceholderData, akisQ.data]);

  const secilebilir: any[] = silinen ? [] : satirlar;
  const gorunurSecili = secilebilir.filter((r) => sel.has(r.id));
  const allSelected = secilebilir.length > 0 && secilebilir.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(secilebilir.map((r) => r.id)));
  const suzgecTemizle = () => { setTp(''); setYon(''); setDurum(''); setZaman('30'); setQ(''); setQD(''); };
  // Sayaç çipi tıklaması: durum süzgeci (tekrar tıkla kalkar). Silinen sekmesinde durum süzgeci geçmediğinden Yüklenen'e dönülür.
  const durumTikla = (v: string) => { if (silinen) setSekme('tumu'); setDurum((d) => (d === v ? '' : v)); };
  const sayacCipler: Array<{ v: string; l: string; n: number; cls: string; t: string }> = [
    { v: 'okunuyor', l: 'okunuyor', n: Number(sayac.okunuyor) || 0, cls: 'cyan', t: 'OCR / AI okuması süren belgeler — tıkla: durum süzgeci' },
    { v: 'karar_bekliyor', l: 'karar bekleyen', n: Number(sayac.kararBekleyen) || 0, cls: 'mor', t: 'Demirbaş / mükerrer / tevkifat eksik / alıcı tipi / engel — sahip kararı bekliyor — tıkla: durum süzgeci' },
    { v: 'hata', l: 'hata', n: Number(sayac.hata) || 0, cls: 'kirmizi', t: 'Okunamadı / Luca hatası / doğrulama hatası — tıkla: durum süzgeci' },
  ].filter((c) => c.n > 0);
  const bugunGelen = Number(sayac.bugunGelen) || 0;
  const zamanEtiket = AK_ZAMAN.find((z) => z.v === zaman)?.l || '';
  // AI ile oku — sunucu kuyruğu (ScreenFaturalar.aiOku ile aynı uç ve gövde: { documentIds }).
  const aiOku = async (rows: any[]) => {
    const ids = rows.filter(akOkunabilir).map((r) => r.id);
    const atlanan = rows.length - ids.length;
    if (!ids.length) { toast.error(atlanan > 0 ? "Seçilenler onaylı / Luca'da ya da zaten okunuyor — yeniden okunmaz" : 'Önce belge seç'); return; }
    setAiBusy(true);
    try {
      const r = await api.post('/fatura-muhasebelestirme/documents/ai-read-batch', { documentIds: ids });
      toast.success(`${r?.data?.queued ?? ids.length} belge okuma sırasına alındı — sunucuda okunur, sayfa değişse de sürer${atlanan > 0 ? ` (${atlanan} belge atlandı: onaylı / Luca'da / okunuyor)` : ''}`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['fm-ocr-progress'] });
      qc.invalidateQueries({ queryKey: ['fm2', 'akis'] });
    } catch (e: any) { toast.error('Okuma başlatılamadı: ' + (e?.response?.data?.message || e?.message || 'hata')); }
    finally { setAiBusy(false); }
  };
  const topluSil = () => {
    const ids = gorunurSecili.filter(akSilinebilir).map((r) => r.id);
    const atlanan = gorunurSecili.length - ids.length;
    if (!ids.length) { toast.error(atlanan > 0 ? "Seçilenler Luca'ya aktarılmış / elle işlenmiş — silinemez" : 'Önce belge seç'); return; }
    if (!window.confirm(`${ids.length} belge silinsin mi?${atlanan > 0 ? `\n(${atlanan} belge Luca'da / elle işlenmiş olduğundan atlanacak)` : ''}\nBu işlem geri alınamaz.`)) return;
    bulkDelMut.mutate(ids);
  };
  // Aç: bekleyen belge → Muhasebeleştir (üst çubuk mükellef+dönem belgeye çevrilir ki listede bulunsun);
  //   onaylı / Luca'ya gitmiş belge o listede yer almaz → belgenin kendisi (PDF/görsel/XML) ekranda açılır.
  const acBelge = (r: any) => {
    if (r.durum === 'onayli' || r.durum === 'lucada' || String(r.status || '').toUpperCase() === 'APPROVED') { openDocFile(r.id); return; }
    onOpenMuhasebe(r.id, r.taxpayerId || undefined, akDonemOf(r) || undefined);
  };
  const tpSecenek: Array<{ v: string; l: string }> = [{ v: '', l: 'Tüm mükellefler' }, ...taxpayers.map((t) => ({ v: String(t.id), l: taxpayerLabel(t) }))];
  if (tp && !tpSecenek.some((o) => o.v === tp)) tpSecenek.push({ v: tp, l: akisDurmus.find((m) => String(m.taxpayerId) === tp)?.ad || satirlar.find((r) => String(r.taxpayerId) === tp)?.mukellefAd || 'Seçili mükellef' });
  const sutunSayisi = silinen ? 7 : 8;

  return (
    <section className="screen">
      <div className="h2">Belge Akışı</div>
      <div className="sub">Sisteme giren bütün belgeler, giriş zamanına göre — nereden geldi, hangi aşamada.</div>
      {/* AKIŞ DURMUŞ — ince amber bant; "listeyi gör" → altında kaydırılabilir liste; ada tıkla → yerel mükellef süzgeci */}
      {akisDurmus.length > 0 && (
        <div className="ak-band">
          <div className="ak-band-h">
            <span className="ak-band-ic" aria-hidden>⚠</span>
            <span><b>{akisDurmus.length}</b> aktif mükellefte 30+ gündür belge gelmiyor</span>
            <span className="ak-band-sep">—</span>
            <button type="button" className="ak-link amber" onClick={() => setDurmusAcik((v) => !v)}>{durmusAcik ? 'gizle' : 'listeyi gör'}</button>
          </div>
          {durmusAcik && (
            <div className="ak-band-list">
              {akisDurmus.map((m) => { const id = String(m.taxpayerId); return (
                <button key={id} type="button" className={`ak-band-row${tp === id ? ' on' : ''}`} title={m.sonBelgeTarihi ? `Son belge: ${fmtDate(m.sonBelgeTarihi)} — tıkla: yalnız bu mükellef` : 'Hiç belge gelmemiş — tıkla: yalnız bu mükellef'} onClick={() => setTp((v) => (v === id ? '' : id))}>
                  <span>{m.ad || 'Mükellef'}</span><i>{m.gunSayisi} gün</i>
                </button>
              ); })}
            </div>
          )}
        </div>
      )}
      {/* SEKMELER (hap, ofis geneli sayılarla) + sağda küçük sayaç çipleri (yalnız >0) */}
      <div className="ak-tabs">
        {AK_SEKMELER.map((s) => { const n = sekmeSay[s.v]; return (
          <button key={s.v} type="button" className={`ak-tab${sekme === s.v ? ' on' : ''}`} title={s.t} onClick={() => setSekme(s.v)}>
            {s.l}{typeof n === 'number' && n >= 0 ? <b>{n}</b> : null}
          </button>
        ); })}
        {sayacCipler.length > 0 && (
          <div className="ak-sayac">
            {sayacCipler.map((c, i) => (
              <span key={c.v} className="ak-sayac-item">
                {i > 0 && <span className="ak-sayac-sep">·</span>}
                <button type="button" className={`ak-sayac-cip ${c.cls}${durum === c.v ? ' on' : ''}`} title={c.t} onClick={() => durumTikla(c.v)}>{c.l} <b>{c.n}</b></button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="card invcard ak-card">
        {/* ARAÇ ÇUBUĞU (tek satır, sarmalanır): [seçim + toplu işlemler] · arama · zaman hapları · yön hapları · mükellef · temizle ··· durum · sayfalama */}
        <div className="ch ak-bar">
          {!silinen && gorunurSecili.length > 0 && (
            <div className="ak-sel">
              <span className="ak-selinfo"><b>{gorunurSecili.length}</b> seçili</span>
              <button type="button" className="ak-x" onClick={() => setSel(new Set())} title="Seçimi temizle">✕</button>
              <span className="ak-sep">·</span>
              <button type="button" className="btn sm ai" disabled={aiBusy} onClick={() => aiOku(gorunurSecili)} title="Seçili belgeleri yapay zeka (Max) ile oku — sunucuda okur, sayfa değişince durmaz (onaylı / Luca'da olanlar atlanır)"><Ico html={I.spark} size={12} /> {aiBusy ? 'Başlatılıyor…' : 'AI ile oku'}</button>
              <button type="button" className="btn sm ghost ak-sil" disabled={bulkDelMut.isPending} onClick={topluSil} title="Seçili belgeleri sil — Luca'ya aktarılmış / elle işlenmiş olanlar atlanır"><Ico html={I.trash} size={12} /> {bulkDelMut.isPending ? 'Siliniyor…' : 'Sil'}</button>
            </div>
          )}
          <label className="sq-search ak-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ünvan, belge no, VKN ara…" />
            {q && <button type="button" onClick={() => setQ('')} title="Aramayı temizle">×</button>}
          </label>
          <div className="ak-haplar" role="group" aria-label="Geliş zamanı">
            {AK_ZAMAN.map((z) => (
              <button key={z.v || 'tumu'} type="button" className={`ak-hap${zaman === z.v ? ' on' : ''}`} title={z.t} onClick={() => setZaman(z.v)}>
                {z.l}{z.v === 'bugun' && akisQ.data ? ` (${bugunGelen})` : ''}
              </button>
            ))}
          </div>
          <div className="ak-haplar" role="group" aria-label="Yön (ikisi de kapalı = tümü)">
            <button type="button" className={`ak-hap alis${yon === 'ALIS' ? ' on' : ''}`} title="Yalnız alış belgeleri (tekrar tıkla kalkar)" onClick={() => setYon((v) => (v === 'ALIS' ? '' : 'ALIS'))}>Alış</button>
            <button type="button" className={`ak-hap satis${yon === 'SATIS' ? ' on' : ''}`} title="Yalnız satış belgeleri (tekrar tıkla kalkar)" onClick={() => setYon((v) => (v === 'SATIS' ? '' : 'SATIS'))}>Satış</button>
          </div>
          <FmSelect value={tp} onChange={setTp} options={tpSecenek} search searchPlaceholder="Mükellef ara…" emptyLabel="Tüm mükellefler" minWidth={150}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>} />
          {suzgecVar && <button type="button" className="ak-link" onClick={suzgecTemizle} title="Arama, zaman, yön, mükellef ve durumu varsayılana döndür">Süzgeçleri temizle</button>}
          <div className="sp" />
          {!silinen && <FmSelect value={durum} onChange={setDurum} options={AK_DURUM_SECENEK} emptyLabel="Durum: Tümü" minWidth={118} />}
          <div className="ak-pg">
            <button type="button" className="ak-pgbtn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} title="Önceki sayfa">‹</button>
            <span>{toplam > 0 ? `${ilk}–${son} / ${toplam}` : '0 / 0'}</span>
            <button type="button" className="ak-pgbtn" disabled={page >= sayfaSayisi} onClick={() => setPage((p) => Math.min(sayfaSayisi, p + 1))} title="Sonraki sayfa">›</button>
          </div>
        </div>
        {akisQ.isError && (
          <div className="yuklenemedi">
            <span><Ico html={I.info} size={14} /> Belge akışı yüklenemedi (bağlantı/sunucu hatası) — "kayıt yok" değil.</span>
            <button className="btn sm" onClick={() => akisQ.refetch()}><Ico html={I.sync} size={12} /> Tekrar dene</button>
          </div>
        )}
        {/* TABLO (7 sütun, sade) — kendi kabında kayar (sayfa yatay kaymaz); sticky YOK */}
        <div className={`ak-twrap${akisQ.isPlaceholderData ? ' ak-loading' : ''}`}>
          <table className="ak-table">
            <thead><tr>
              {!silinen && <th style={{ width: 30 }}><Check checked={allSelected} onToggle={toggleAll} disabled={secilebilir.length === 0} /></th>}
              <th>Belge</th>
              <th>Mükellef</th>
              <th>Karşı taraf</th>
              <th>Tarih</th>
              <th className="num">Tutar</th>
              <th>Durum</th>
              {silinen ? <th>Silinme</th> : <th>Eylemler</th>}
            </tr></thead>
            <tbody>
              {satirlar.map((r) => {
                const d = AK_DURUM[String(r.durum)] || AK_DURUM.okundu;
                const sat = r.yon === 'SATIS';
                const okunabilir = akOkunabilir(r);
                // "AI ile oku" yalnız okunmamış (OCR SUCCESS/DONE değil) ya da hatalı satırda; onaylı / Luca'da / okunuyor zaten elenir.
                const ocr = String(r.ocrStatus || '').toUpperCase();
                const okumaGerek = !silinen && okunabilir && (r.durum === 'hata' || (ocr !== 'SUCCESS' && ocr !== 'DONE'));
                return (
                  <tr key={r.id} className={r.durum === 'okunuyor' ? 'scanning' : undefined}>
                    {!silinen && <td><Check checked={sel.has(r.id)} onToggle={() => toggle(r.id)} /></td>}
                    <td className="ak-belge">
                      <span className="ak-mono" title={r.belgeNo || ''}>{r.belgeNo || '—'}</span>
                      <span className="ak-alt">
                        {r.kaynak ? <span className="sq-src" style={{ ['--sc' as any]: akKaynakRenk(r.kaynakKod) }} title={r.kaynakKod ? `Kaynak: ${r.kaynak} (${r.kaynakKod})` : `Kaynak: ${r.kaynak}`}><i>{akKaynakKisalt(r.kaynak, r.kaynakKod)}</i>{r.kaynak}</span> : null}
                        {r.yon ? <span className={`ak-yon ${sat ? 'satis' : 'alis'}`}>{sat ? 'Satış' : 'Alış'}</span> : null}
                        {!r.kaynak && !r.yon ? <span className="mu">—</span> : null}
                      </span>
                    </td>
                    <td className="ak-mk">
                      <b title={r.mukellefAd || ''}>{r.mukellefAd || '—'}</b>
                      <small title={r.gelisZamani ? `Sisteme giriş: ${new Date(r.gelisZamani).toLocaleString('tr-TR')}` : ''}>geliş: {akFmtZaman(r.gelisZamani)}</small>
                    </td>
                    <td className="ak-firm"><b title={r.karsiTaraf || ''}>{r.karsiTaraf || '—'}</b><small>{r.karsiVkn ? `VKN ${r.karsiVkn}` : '—'}</small></td>
                    <td className="ak-tarih">{fmtDate(r.faturaTarihi)}</td>
                    <td className="num ak-tutar">{r.tutar == null ? '—' : fmtMoney(r.tutar)}</td>
                    <td className="ak-durumcell">
                      <span className={`ak-durum${r.durum === 'okunuyor' ? ' okunuyor' : ''}`} style={{ color: d.fg, background: d.bg, borderColor: d.bd }} title={[r.durumEtiketi || d.l, r.status ? `durum: ${r.status}` : '', r.ocrStatus ? `okuma: ${r.ocrStatus}` : '', r.lucaStatus ? `Luca: ${r.lucaStatus}` : '', r.lucaFisNo ? `fiş no: ${r.lucaFisNo}` : '', silinen && r.eskiDurum ? `eski durum: ${r.eskiDurum}` : ''].filter(Boolean).join(' · ')}>{r.durumEtiketi || d.l}</span>
                      <UyariCipler raw={r.uyarilar} max={2} />
                    </td>
                    {silinen
                      ? <td className="ak-silcell" title={r.silinmeZamani ? new Date(r.silinmeZamani).toLocaleString('tr-TR') : ''}>Silinme: {akFmtZaman(r.silinmeZamani)} · {r.silen?.ad || 'bilinmiyor'}</td>
                      : <td className="ak-actcell"><div className="ak-acts">
                        <button type="button" className="gf-act duzenle" onClick={() => acBelge(r)} title={r.durum === 'onayli' || r.durum === 'lucada' ? 'Onaylı / Luca\'ya gitmiş belge: dosyayı (PDF/görsel/XML) ekranda aç' : 'Muhasebeleştir ekranında aç (mükellef + dönem belgeye çevrilir)'}>Aç</button>
                        {okumaGerek && <button type="button" className="gf-act incele" disabled={aiBusy} onClick={() => aiOku([r])} title="Bu belgeyi yapay zeka (Max) ile oku — sunucuda okur">AI ile oku</button>}
                        {akSilinebilir(r) && <button type="button" className="gf-act sil" disabled={delMut.isPending || bulkDelMut.isPending} title="Belgeyi sil (Luca'ya gitmemiş)" onClick={() => { if (window.confirm(`Bu belge silinsin mi?\n${r.karsiTaraf || '—'} · ${r.tutar == null ? '—' : fmtMoney(r.tutar) + ' ₺'}${r.belgeNo ? ' · ' + r.belgeNo : ''}\nBu işlem geri alınamaz.`)) delMut.mutate(r.id); }}>Sil</button>}
                      </div></td>}
                  </tr>
                );
              })}
              {akisQ.isLoading && (
                <tr><td colSpan={sutunSayisi}><div className="empty">Yükleniyor…</div></td></tr>
              )}
              {!akisQ.isLoading && !akisQ.isError && satirlar.length === 0 && (
                <tr><td colSpan={sutunSayisi}><div className="empty">
                  Bu sekmede {zaman === 'bugun' ? 'bugün ' : zaman ? `son ${zamanEtiket}de ` : ''}kayıt yok
                  {suzgecVar
                    ? <> — <a href="#temizle" onClick={(ev) => { ev.preventDefault(); suzgecTemizle(); }}>süzgeçleri temizle</a></>
                    : zaman ? <> — <a href="#tumu" onClick={(ev) => { ev.preventDefault(); setZaman(''); }}>tümünü göster</a></> : null}
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Alt bilgi tek satır (sayfalama düğmeleri üst çubukta; alt çubuk YOK) */}
        <div className="foot ak-foot">
          <div className="selinfo">{toplam > 0 ? `${ilk}–${son} / ${toplam}` : 'Kayıt yok'} · geliş zamanına göre yeniden eskiye</div>
        </div>
      </div>
    </section>
  );
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
#fm-root .nitem.off{opacity:.42;cursor:not-allowed}
#fm-root .nitem.off:hover{background:transparent;color:#566273}
#fm-root .nitem .nlock{margin-left:auto;font-size:11px;opacity:.9}
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
#fm-root .pill.ham{background:#eef1f5;color:#64748b}
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
#fm-root .fyon{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px;border-radius:9px;background:#f4f6fa;border:1px dashed #cfd7e3;font-size:12px;color:#475569}
#fm-root .fyon.ters{background:#fff4e5;border-color:#f3c98b;color:#9a5b00;font-weight:600}
#fm-root .fyonbtn{border:1px solid #cfd7e3;background:#fff;border-radius:7px;padding:4px 10px;font-size:12px;font-weight:600;color:#1f2937;cursor:pointer}
#fm-root .fyonbtn:hover{background:#eef2f7}
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
/* Faz 2 — uyarı çipleri (liste satırı) ve Uyarılar kutusu (detay/editör). Renk dili: bilgi gri-mavi, uyarı amber, engel kırmızı, karar bekliyor mor. */
#fm-root .uycips{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;cursor:pointer;max-width:200px}
#fm-root .uycip{display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:999px;border:1px solid;font-size:10.5px;font-weight:700;white-space:nowrap;line-height:1}
#fm-root .uykutu{margin:0 0 8px;border:1px solid #dfe5ee;border-radius:9px;background:linear-gradient(135deg,#fbfcfe,#f5f7fb);overflow:hidden;max-width:940px}
#fm-root .uykutu-h{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;font-size:12px;font-weight:800;color:#334155;border-bottom:1px solid #e7ecf3;background:radial-gradient(circle at 0 0,rgba(124,58,237,.06),transparent 60%)}
#fm-root .uykutu-h small{font-weight:600;color:#64748b}
#fm-root .uysatir{padding:6px 10px 7px;border-left:3px solid;border-bottom:1px solid rgba(0,0,0,.04);font-size:12px;line-height:1.45}
#fm-root .uysatir:last-child{border-bottom:0}
#fm-root .uybaslik{font-weight:800;margin-bottom:2px}
#fm-root .uybaslik em{font-style:normal;font-weight:600;font-size:11px;opacity:.75}
#fm-root .uyacik{color:#334155;white-space:normal;word-break:break-word;overflow-wrap:anywhere}
#fm-root .uyoneri{margin-top:3px;color:#475569;font-size:11.5px}
#fm-root .uyeylem{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px}
#fm-root .fispane .uykutu{margin:6px 10px 4px}

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
/* KRITIK (DOM incelemesi): fispane overflow HIDDEN idi -> icerik kisa ekranda KIRPILIP kayboluyordu
   (CARI TOPLAM). overflow-y:auto -> kirpma yerine KAYDIRMA; hicbir sey kaybolmaz. + icerik bir tik kisaltildi. */
#fm-root .screen-muhasebe .muhmain .fispane{overflow-y:auto}
#fm-root .screen-muhasebe .muhmain .fgrps{gap:8px}
#fm-root .screen-muhasebe .muhmain .fgrp .fgh{padding:5px 13px 4px}
#fm-root .screen-muhasebe .muhmain .fgrp .frow{padding:5px 13px;gap:10px}
#fm-root .screen-muhasebe .muhmain .fgrp .fgt{padding:3px 13px}
#fm-root .screen-muhasebe .muhmain .fgrp .frowadd{padding:2px 13px}
/* footer (docmeta/Denge/butonlar) SIKI → sections'in aktığı .twrap'a yer aç → son bölümün TOPLAM'ı tam sığsın */
#fm-root .screen-muhasebe .muhmain .docmeta-bottom{margin:6px 0 0;padding:4px 7px;gap:3px 8px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dm{gap:1px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dml{font-size:9px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dmi,#fm-root .screen-muhasebe .muhmain .docmeta-bottom .psel .pselfield{height:24px}
#fm-root .screen-muhasebe .muhmain .balance{min-height:0;margin:6px 0 0;padding:5px 11px}
#fm-root .screen-muhasebe .muhmain .wactions{margin-top:6px}
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

/* === PLAN16-A: SORGU EKRANLARI === */
/* Ekran: sabit yükseklikli dikey akış; içerik sığmazsa yalnız DİKEY kayar (yatay asla), tablo kendi kabında kayar. */
#fm-root .sq-screen{overflow-y:auto;overflow-x:hidden;gap:0}
#fm-root .sq-screen > .h2{margin-bottom:10px}
/* Sorgu şeridi (tek kart): üst renk çizgisi + sağ üst radial parıltı + hafif accent degrade — hepsi
   arka plan katmanı (overflow:hidden YOK → FmPeriod takvim penceresi kırpılmaz) */
#fm-root .sq-strip{position:relative;overflow:visible;flex:0 0 auto;padding:14px 16px 13px;margin-bottom:12px;border:1px solid var(--accent-line);background:linear-gradient(90deg,var(--accent),#2dd4bf 60%,#60a5fa) top/100% 3px no-repeat,radial-gradient(circle at 100% 0%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 42%),linear-gradient(135deg,color-mix(in srgb,var(--accent) 9%,#fff) 0%,#fff 52%,color-mix(in srgb,var(--accent) 5%,#fff) 100%);box-shadow:0 16px 34px -28px var(--accent)}
#fm-root .sq-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative}
/* Takvim penceresi (ilk satırda) alt satırların/tablonun üstünde kalsın */
#fm-root .sq-strip > .sq-row:first-child{z-index:30}
#fm-root .sq-row + .sq-row{margin-top:9px}
#fm-root .sq-lbl{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.55px;color:var(--faint)}
#fm-root .sq-strip .fmdd-btn{background:#fff}
/* Takvim penceresi şeritte SOLA hizalı açılır (üst çubuktaki sağa hizalı sürüm burada sol kenardan taşıp kırpılırdı) */
#fm-root .sq-strip .fmdd-pop{left:0;right:auto}
/* Hazır aralık hapları */
#fm-root .sq-haps{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--line2);border-radius:999px;background:#fff}
#fm-root .sq-hap{height:28px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--muted);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s,box-shadow .12s}
#fm-root .sq-hap:hover{background:var(--accent-soft);color:var(--accent)}
#fm-root .sq-hap.on{background:var(--accent);color:#fff;box-shadow:0 6px 14px -8px var(--accent)}
/* Özel tarih aralığı alanları */
#fm-root .sq-dates{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line2);border-radius:10px;padding:2px 10px;transition:border-color .12s,box-shadow .12s}
#fm-root .sq-dates:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#fm-root .sq-dates input{height:29px;border:0;background:transparent;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--text);outline:none;cursor:pointer}
#fm-root .sq-dates .drsep{color:var(--faint);font-weight:700}
#fm-root .sq-dates .sq-x{border:0;background:none;color:var(--faint);font-size:17px;line-height:1;cursor:pointer;padding:0 2px}
#fm-root .sq-dates .sq-x:hover{color:var(--red)}
/* Sorgula — gradyan ana düğme (accent ailesi) */
#fm-root .btn.sq-main{height:40px;padding:0 20px;border:0;border-radius:11px;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0f766e 0%,var(--accent) 55%,#14b8a6 100%);box-shadow:0 10px 20px -10px var(--accent);transition:transform .12s,box-shadow .14s,filter .14s}
#fm-root .btn.sq-main:hover:not(:disabled){filter:brightness(1.06);transform:translateY(-1px);box-shadow:0 14px 26px -10px var(--accent);color:#fff;border-color:transparent}
#fm-root .btn.sq-main:disabled{opacity:.55;cursor:not-allowed;transform:none}
/* Şerit meta satırı: aralık bilgisi, uyarı hapları, son sorgu */
#fm-root .sq-meta{font-size:12px;color:var(--muted)}
#fm-root .sq-meta b{color:var(--text);font-weight:700}
#fm-root .sq-pill{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:700;background:var(--accent-soft);color:var(--th-text);border:1px solid var(--accent-line);white-space:nowrap;line-height:1}
#fm-root .sq-pill .ico{color:var(--accent)}
#fm-root .sq-pill.warn{background:#fff7e6;color:#9a5d0a;border-color:#f3d9a4}
#fm-root .sq-pill.err{background:#fdeaea;color:#b91c1c;border-color:#f3c0c0}
#fm-root .sq-pill.ok{background:#e7f6ec;color:#15803d;border-color:#bfe5cc}
#fm-root .sq-pill.gray{background:#f1f4f8;color:#526070;border-color:#dfe5ee}
#fm-root .sq-meta .sq-pill b{color:inherit}
#fm-root .sq-last{margin-left:auto;font-size:12px;color:var(--muted);white-space:nowrap}
#fm-root .sq-last b{color:var(--text)}
#fm-root .sq-kirmizi{color:#b91c1c!important}
/* İlerleme çubuğu (aktif iş / arka plan senkron) + iptal */
#fm-root .sq-prog{display:flex;align-items:center;gap:12px;margin-top:10px;padding:10px 13px;border-radius:11px;background:#fff;border:1px solid var(--accent-line);position:relative;z-index:1;box-shadow:0 8px 20px -18px var(--accent)}
#fm-root .sq-prog .sq-spin{width:15px;height:15px;border-radius:50%;border:2px solid var(--accent-line);border-top-color:var(--accent);animation:efspin .7s linear infinite;flex-shrink:0}
#fm-root .sq-prog .sq-ptx{font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap}
#fm-root .sq-prog .sq-ptx b{color:var(--accent);font-weight:800;font-variant-numeric:tabular-nums}
#fm-root .sq-prog .sq-psub{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:38%}
#fm-root .sq-prog .sq-track{flex:1;min-width:120px;height:7px;border-radius:99px;background:var(--accent-soft);overflow:hidden;position:relative}
#fm-root .sq-prog .sq-fill{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),#2dd4bf);transition:width .4s ease}
#fm-root .sq-prog .sq-fill.belirsiz{width:42%;position:absolute;left:0;top:0;animation:fmBar 1.15s ease-in-out infinite}
#fm-root .sq-prog .btn.sq-cancel{height:30px;padding:0 12px;border:1px solid #f3c0c0;color:#b91c1c;background:#fff;font-weight:800}
#fm-root .sq-prog .btn.sq-cancel:hover:not(:disabled){background:#fdeaea;border-color:#e59a9a;color:#991b1b}
/* Hata / uyarı / tamam bantları (.banner kırmızı-amber-yeşil varyantları) */
#fm-root .banner.sq-err,#fm-root .banner.sq-warn,#fm-root .banner.sq-ok{margin:10px 0 0;position:relative;z-index:1;align-items:center;font-size:12.5px}
#fm-root .banner.sq-err{background:#fdeaea;border:1px solid #f3b9b9;color:#7f1d1d}
#fm-root .banner.sq-err b{color:#991b1b}
#fm-root .banner.sq-err .ico{color:#b91c1c}
#fm-root .banner.sq-warn{background:#fff7e6;border:1px solid #f3d9a4;color:#7c4a03}
#fm-root .banner.sq-warn .ico{color:#b45309}
#fm-root .banner.sq-ok{background:#e7f6ec;border:1px solid #bfe5cc;color:#14532d}
#fm-root .banner.sq-ok .ico{color:#15803d}
/* Sonuç özeti şeridi (.ftile sayaçları) */
#fm-root .sq-tiles{margin:0 0 12px;flex:0 0 auto;align-items:center}
#fm-root .sq-tilenote{margin-left:auto}
/* Tablo kartı: ekranın kalanını doldurur, tablo kabı kendi içinde kayar (sayfa değil) */
#fm-root .sq-panel{flex:1 1 auto;min-height:300px}
#fm-root .sq-panel.sq-running{position:relative}
#fm-root .sq-panel.sq-running::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent 0%,var(--accent) 50%,transparent 100%);background-size:45% 100%;background-repeat:no-repeat;animation:fmshimmer 1.15s linear infinite;z-index:6;border-radius:12px 12px 0 0}
#fm-root .card .sq-head{gap:10px;flex-wrap:wrap;padding:11px 14px}
#fm-root .card .sq-head h3{font-size:14px;font-weight:800;color:#0d1626;display:flex;align-items:center;gap:9px;margin:0}
#fm-root .sq-head .mu{font-size:11.5px;white-space:nowrap}
#fm-root .sq-panel .efdownbar{margin:10px 14px 2px}
#fm-root .sq-panel .yuklenemedi{margin:10px 14px 0}
#fm-root .sq-search{display:flex;align-items:center;gap:7px;height:34px;padding:0 11px;border:1.5px solid var(--line2);border-radius:10px;background:#fff;min-width:250px;transition:border-color .12s,box-shadow .12s}
#fm-root .sq-search:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#fm-root .sq-search svg{color:var(--faint);flex-shrink:0}
#fm-root .sq-search input{border:0;outline:0;background:none;font-family:inherit;font-size:12.5px;color:var(--text);width:100%}
#fm-root .sq-search button{border:0;background:none;color:var(--faint);cursor:pointer;font-size:16px;line-height:1;padding:0 2px}
#fm-root .sq-search button:hover{color:var(--red)}
#fm-root .sq-prov{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#fm-root .sq-tablewrap{overflow:auto;flex:1 1 auto;min-height:140px;max-height:none;position:relative}
/* Tablo: rozet, ünvan+VKN alt alta, belge no mono, sıralanabilir başlıklar (sticky YOK) */
#fm-root .sq-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;table-layout:auto;min-width:900px}
#fm-root .sq-table thead th{height:38px;background:#f6faf9;color:#35564f;font-size:10.5px;letter-spacing:.35px;text-transform:uppercase;font-weight:800;padding:0 11px;border-bottom:1px solid var(--line2);white-space:nowrap;text-align:left}
#fm-root .sq-table thead th.sortable{cursor:pointer;user-select:none}
#fm-root .sq-table thead th.sortable:hover{color:var(--accent);background:var(--accent-soft)}
#fm-root .sq-table thead th.sorted{color:var(--accent)}
#fm-root .sq-table thead th .sq-sort{display:inline-block;margin-left:3px;font-size:9px;opacity:.5}
#fm-root .sq-table thead th.sorted .sq-sort{opacity:1}
#fm-root .sq-table tbody td{height:46px;padding:7px 11px;border-bottom:1px solid #eef1f4;vertical-align:middle;white-space:nowrap;font-size:12.5px}
#fm-root .sq-table tbody tr:hover td{background:#fafcfb}
#fm-root .sq-table tbody tr.sel td{background:color-mix(in srgb,var(--accent) 7%,#fff)}
#fm-root .sq-table tbody tr.blocked td{color:#9a5c5c;background:#fffafa}
#fm-root .sq-table tbody tr.done td{background:#f8fdfb}
#fm-root .sq-table tbody tr.missingdoc td{background:#fffdf7}
#fm-root .sq-table td.num,#fm-root .sq-table th.num{text-align:right;font-variant-numeric:tabular-nums}
#fm-root .sq-table td.center,#fm-root .sq-table th.center{text-align:center}
#fm-root .sq-table th:last-child,#fm-root .sq-table td:last-child{text-align:center}
#fm-root .sq-table .sq-party{display:flex;flex-direction:column;gap:1px;min-width:180px;max-width:330px;white-space:normal}
#fm-root .sq-table .sq-party b{font-weight:650;color:#17212f;line-height:1.3;overflow-wrap:anywhere}
#fm-root .sq-table .sq-party small{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--faint);letter-spacing:.2px}
#fm-root .sq-table .sq-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:#334155;letter-spacing:.1px}
#fm-root .sq-table .sq-pill{height:22px;font-size:10.5px}
/* Entegratör / kaynak rozeti: --sc sağlayıcı rengi */
#fm-root .sq-src{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 3px;border-radius:999px;font-size:11px;font-weight:800;background:color-mix(in srgb,var(--sc,var(--accent)) 10%,#fff);color:var(--sc,var(--accent));border:1px solid color-mix(in srgb,var(--sc,var(--accent)) 32%,#fff);white-space:nowrap;letter-spacing:.1px}
#fm-root .sq-src i{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--sc,var(--accent));color:#fff;font-size:8.5px;font-style:normal;font-weight:900;letter-spacing:.2px;flex-shrink:0}
/* ONAY hapı */
#fm-root .sq-onay{display:inline-flex;align-items:center;gap:5px;height:23px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:750;white-space:nowrap;border:1px solid transparent;line-height:1}
#fm-root .sq-onay::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
#fm-root .sq-onay.onay{background:#e7f6ec;color:#15803d;border-color:#bfe5cc}
#fm-root .sq-onay.oto{background:#e8f0ff;color:#1d4ed8;border-color:#c9daff}
#fm-root .sq-onay.bekliyor{background:#fff4e0;color:#b45309;border-color:#f6d7a4}
#fm-root .sq-onay.iptal,#fm-root .sq-onay.red,#fm-root .sq-onay.itiraz{background:#fdeaea;color:#b91c1c;border-color:#f3c0c0}
#fm-root .sq-onay.silinmis,#fm-root .sq-onay.diger{background:#f1f4f8;color:#64748b;border-color:#dfe5ee}
#fm-root .sq-onaysub{display:block;margin-top:3px;font-size:10px;color:#9a5c5c;line-height:1.1}
/* AKTARIM durumu */
#fm-root .sq-akt{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:750;white-space:nowrap}
#fm-root .sq-akt.ok{color:#15803d}
#fm-root .sq-akt.kuyruk{color:#b45309}
#fm-root .sq-akt.muh{color:#0f766e}
#fm-root .sq-akt.yok{color:#94a3b8;font-weight:600}
/* Alt toplu işlem çubuğu — tablonun hemen altında, sabit DEĞİL */
#fm-root .sq-bulk{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid var(--line);background:#fbfcfe;flex:0 0 auto;border-radius:0}
#fm-root .sq-bulk.secili{background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 13%,#fff),color-mix(in srgb,var(--accent) 4%,#fff));border-bottom-color:var(--accent-line)}
#fm-root .sq-bulk .sq-selinfo{font-size:12.5px;color:var(--text)}
#fm-root .sq-bulk .sq-selinfo.mu{font-size:11.5px;color:var(--muted)}
#fm-root .sq-bulk .sq-selinfo b{color:var(--accent);font-weight:800}
#fm-root .sq-bulk .btn{height:34px;border-radius:9px}
#fm-root .sq-bulk .btn.primary{background:linear-gradient(135deg,#0f766e,var(--accent) 60%,#14b8a6);border:0;color:#fff;box-shadow:0 8px 18px -10px var(--accent)}
#fm-root .sq-bulk .btn.primary:hover:not(:disabled){filter:brightness(1.06);color:#fff}
#fm-root .sq-bulk .btn.primary:disabled{opacity:.5;box-shadow:none}
/* Dar ekran: haplar ve arama alt satıra iner, yatay taşma olmaz */
@media(max-width:1180px){
  #fm-root .sq-search{min-width:200px}
  #fm-root .sq-prog .sq-psub{display:none}
}

/* === PLAN16-B: GELEN FATURALAR === */
/* "Ne yapmam gerekiyor" şeridi: tek kart, üst renk çizgisi + sağ üst radial parıltı + hafif accent degrade (sq-strip dili) */
#fm-root .card.gf-strip{position:relative;overflow:hidden;margin:0 0 10px;padding:12px 16px 13px;border:1px solid var(--accent-line);background:linear-gradient(90deg,var(--accent),#2dd4bf 60%,#60a5fa) top/100% 3px no-repeat,radial-gradient(circle at 100% 0%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 42%),linear-gradient(135deg,color-mix(in srgb,var(--accent) 9%,#fff) 0%,#fff 52%,color-mix(in srgb,var(--accent) 5%,#fff) 100%);box-shadow:0 16px 34px -28px var(--accent)}
#fm-root .gf-strip-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:9px}
#fm-root .gf-strip-t{font-size:14px;font-weight:800;color:#0d1626;letter-spacing:-.2px}
#fm-root .gf-strip-s{font-size:11.5px;color:var(--muted)}
#fm-root .gf-strip-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
#fm-root .gf-strip .filttiles.gf-tiles{margin:0;gap:8px}
#fm-root .gf-tile .ftn{font-size:21px}
#fm-root .gf-tile .ftl{font-size:11.5px}
#fm-root .gf-tile.on{box-shadow:inset 0 0 0 2px var(--tc,var(--accent)),0 10px 22px -14px var(--tc,var(--accent))}
/* "Hazır olanları onayla" — yeşil gradyan ana düğme */
#fm-root .btn.gf-hazir{height:40px;padding:0 18px;border:0;border-radius:11px;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(135deg,#15803d 0%,#16a34a 55%,#22c55e 100%);box-shadow:0 10px 20px -10px #15803d;transition:transform .12s,box-shadow .14s,filter .14s}
#fm-root .btn.gf-hazir:hover:not(:disabled){filter:brightness(1.06);transform:translateY(-1px);box-shadow:0 14px 26px -10px #15803d;color:#fff;border-color:transparent}
#fm-root .btn.gf-hazir:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
/* İkincil (ayrıntılı durum) sayaç satırı — daha küçük, sessiz */
#fm-root .filttiles.gf-sub{gap:6px;margin:0 0 10px}
#fm-root .gf-sub .ftile{padding:4px 10px 4px 8px;border-radius:9px;gap:7px;border-width:1px;background:color-mix(in srgb,var(--tc,var(--accent)) 4%,#fff)}
#fm-root .gf-sub .ftile .ftdot{width:7px;height:7px}
#fm-root .gf-sub .ftile .fttx{flex-direction:row;align-items:baseline;gap:5px}
#fm-root .gf-sub .ftile .ftn{font-size:13px}
#fm-root .gf-sub .ftile .ftl{font-size:10.5px;font-weight:650}
#fm-root .gf-sub .ftile:hover{transform:none;box-shadow:none}
#fm-root .gf-sub .ftile.on{background:color-mix(in srgb,var(--tc,var(--accent)) 14%,#fff);box-shadow:inset 0 0 0 1.5px var(--tc,var(--accent))}
#fm-root .gf-hint{font-size:11.5px;color:var(--faint);margin-left:4px}
/* Tablo: kendi kabında kayar (sayfa değil); sıralanabilir başlıklar (sticky YOK) */
#fm-root .gf-twrap{overflow:auto}
#fm-root .gf-table thead th.gf-sortable{cursor:pointer;user-select:none;transition:color .12s,background .12s}
#fm-root .gf-table thead th.gf-sortable:hover{color:var(--accent);background:var(--accent-soft)}
#fm-root .gf-table thead th.gf-sorted{color:var(--accent)}
#fm-root .gf-table thead th .gf-sort{display:inline-block;margin-left:4px;font-size:9px;opacity:.45}
#fm-root .gf-table thead th.gf-sorted .gf-sort{opacity:1}
#fm-root .gf-table tbody td{vertical-align:middle}
/* Hesap kodu + adı alt alta */
#fm-root .gf-table td.gf-hesap{max-width:170px}
#fm-root .gf-table td.gf-hesap small{display:block;font-size:10.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;line-height:1.25;margin-top:1px}
/* Güven rozeti: hap + tek satır sebep */
#fm-root .gf-table td.gf-guvencell{max-width:190px}
#fm-root .gf-guven{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;border:1px solid transparent;line-height:1}
#fm-root .gf-guven::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
#fm-root .gf-guven.yuksek{background:#e7f6ec;color:#15803d;border-color:#bfe5cc}
#fm-root .gf-guven.orta{background:#fff4e0;color:#b45309;border-color:#f6d7a4}
#fm-root .gf-guven.dusuk{background:#fdeaea;color:#b91c1c;border-color:#f3c0c0}
#fm-root .gf-neden{display:block;font-size:10.5px;color:var(--muted);line-height:1.25;margin-top:3px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Demirbaş kararı satır içi 3 küçük düğme (mor küme) */
#fm-root .gf-demirbas{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;max-width:220px}
#fm-root .gf-dem{height:22px;padding:0 8px;border-radius:7px;border:1px solid #e3d4fb;background:#fff;color:#7c3aed;font-family:inherit;font-size:10.5px;font-weight:700;cursor:pointer;white-space:nowrap;line-height:1;transition:background .12s,border-color .12s,color .12s}
#fm-root .gf-dem:hover:not(:disabled){background:#f3e8ff;border-color:#c4b5fd}
#fm-root .gf-dem.yine_de_isle{color:#3b5b8a;border-color:#c9d6ea}
#fm-root .gf-dem.yine_de_isle:hover:not(:disabled){background:#eef2f8;border-color:#a9bcd9}
#fm-root .gf-dem.demirbas_degil{color:#b45309;border-color:#f4d19b}
#fm-root .gf-dem.demirbas_degil:hover:not(:disabled){background:#fff5e6;border-color:#e9b96f}
#fm-root .gf-dem:disabled{opacity:.55;cursor:wait}
/* Eylemler: etiketli, görünür, 2×2 ızgara (hover'a saklanmaz) */
#fm-root th.gf-actcol{text-align:left}
#fm-root td.gf-actcol{padding-top:7px;padding-bottom:7px}
#fm-root .gf-acts{display:grid;grid-template-columns:1fr 1fr;gap:4px;min-width:150px}
#fm-root .gf-act{display:inline-flex;align-items:center;justify-content:flex-start;gap:5px;height:25px;padding:0 8px;border-radius:7px;border:1px solid var(--line2);background:#fff;color:#34415a;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;line-height:1;transition:background .12s,border-color .12s,color .12s,transform .1s,box-shadow .12s}
#fm-root .gf-act .ico{display:inline-flex;flex-shrink:0}
#fm-root .gf-act:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 3px 7px -3px rgba(15,23,42,.18)}
#fm-root .gf-act.incele{color:#1d4ed8;border-color:#c9daff;background:#f4f7ff}
#fm-root .gf-act.incele:hover:not(:disabled),#fm-root .gf-act.incele.on{background:#e8f0ff;border-color:#93b4ff}
#fm-root .gf-act.duzenle{color:#6d28d9;border-color:#e3d4fb;background:#faf7ff}
#fm-root .gf-act.duzenle:hover:not(:disabled){background:#f3e8ff;border-color:#c4b5fd}
#fm-root .gf-act.onizle{color:#0f766e;border-color:#bfe6e1;background:#f2fbf9}
#fm-root .gf-act.onizle:hover:not(:disabled){background:#e3f4f2;border-color:#7fd1c6}
#fm-root .gf-act.sil{color:#b91c1c;border-color:#f3c0c0;background:#fff7f7}
#fm-root .gf-act.sil:hover:not(:disabled){background:#fdeaea;border-color:#e59a9a}
#fm-root .gf-act:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
#fm-root .gf-act .gf-actn{font-style:normal;font-size:10px;font-weight:800;margin-left:2px}
/* Tevkifatlı ayrı onay grubu — tablonun altında, toplu çubuğun üstünde */
#fm-root .gf-tevk{margin:10px 14px 0;padding:9px 12px;border:1px solid #c9d6ea;border-radius:9px;background:#eef2f8;font-size:12.5px;color:#3b5b8a;display:flex;flex-direction:column;gap:6px}
/* Toplu alt çubuk — tablonun hemen altında, sabit DEĞİL */
/* Toplu işlemler ÜST araç çubuğunda (alt çubuk kaldırıldı — kullanıcı kararı 2026-09-12) */
#fm-root .invactions .gf-topsep{width:1px;height:22px;background:var(--line2);margin:0 2px}
#fm-root .invactions .gf-selinfo{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text);padding:0 6px}
#fm-root .invactions .gf-selinfo b{color:var(--accent);font-weight:800}
#fm-root .invactions .gf-clear{border:1px solid var(--line2);background:#fff;color:var(--muted);border-radius:999px;width:20px;height:20px;font-size:11px;line-height:1;cursor:pointer;display:grid;place-items:center}
#fm-root .invactions .gf-clear:hover{border-color:var(--accent);color:var(--accent)}
#fm-root .invactions .btn.gf-onayla{background:linear-gradient(135deg,#15803d,#1aa050);border:0;color:#fff}
#fm-root .invactions .btn.gf-onayla:hover:not(:disabled){filter:brightness(1.05);color:#fff}
#fm-root .invactions .btn.gf-sil{background:#fff;color:#b91c1c;border:1px solid #f3c0c0}
#fm-root .invactions .btn.gf-sil:hover:not(:disabled){background:#fdeaea;border-color:#e59a9a;color:#991b1b;filter:none}
#fm-root .invactions .btn:disabled{opacity:.45;box-shadow:none;filter:none}
/* === PLAN16-B2: AI OKUMA BANDI (kullanıcı isteği 2026-09-12 — ince, canlı, halka ilerlemeli) === */
#fm-root .aiband{position:relative;display:flex;align-items:center;gap:16px;margin:10px 12px 12px;padding:12px 16px 12px 14px;border-radius:14px;border:1px solid var(--accent-line);background:linear-gradient(100deg,color-mix(in srgb,var(--accent) 14%,#fff) 0%,#fff 46%,color-mix(in srgb,var(--accent) 6%,#fff) 100%);overflow:hidden;box-shadow:0 12px 28px -22px var(--accent)}
#fm-root .aiband::before{content:"";position:absolute;left:-50px;top:-70px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 24%,transparent) 0%,transparent 64%);pointer-events:none}
#fm-root .aiband::after{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--accent),#22c55e)}
#fm-root .aiband-ring{position:relative;width:58px;height:58px;flex-shrink:0;display:grid;place-items:center}
#fm-root .aiband-ring svg{position:absolute;inset:0;width:58px;height:58px;transform:rotate(-90deg)}
#fm-root .aiband-ring circle{fill:none;stroke-width:4}
#fm-root .aiband-ring circle.bg{stroke:color-mix(in srgb,var(--accent) 18%,#fff)}
#fm-root .aiband-ring circle.fg{stroke:var(--accent);stroke-linecap:round;transition:stroke-dashoffset .6s ease}
#fm-root .aiband-pct{position:relative;font-size:13px;font-weight:900;color:var(--accent);font-variant-numeric:tabular-nums;letter-spacing:-.3px}
#fm-root .aiband-mid{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
#fm-root .aiband-title{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:800;color:var(--text);flex-wrap:wrap}
#fm-root .aiband-spark{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:var(--accent);color:#fff;box-shadow:0 6px 14px -8px var(--accent);animation:aibandPulse 1.8s ease-in-out infinite}
@keyframes aibandPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
#fm-root .aiband-title .dots::after{content:"...";display:inline-block;width:16px;text-align:left;animation:aidots 1.5s steps(4,end) infinite}
#fm-root .aiband-cnt{margin-left:6px;font-size:12.5px;font-weight:700;color:var(--muted)}
#fm-root .aiband-cnt b{color:var(--accent);font-size:14.5px;font-variant-numeric:tabular-nums}
#fm-root .aiband-chips{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
#fm-root .aiband-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:#fff;border:1px solid var(--accent-line);color:var(--accent)}
#fm-root .aiband-chip.live i{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:aiqpulse 1.4s infinite}
#fm-root .aiband-chip.warn{background:#fff7ed;border-color:#f3dcab;color:#b45309}
#fm-root .aiband-note{font-size:11px;color:var(--faint);font-weight:600;margin-left:2px}
#fm-root .aiband-track{height:5px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,#fff);overflow:hidden}
#fm-root .aiband-fill{position:relative;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),#22c55e);transition:width .5s ease;min-width:6px;overflow:hidden}
#fm-root .aiband-fill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);animation:aishim 1.6s linear infinite}
#fm-root .aiband-stop{position:relative;flex-shrink:0;display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 14px;border-radius:9px;border:1px solid #f3c0c0;background:#fff;color:#b91c1c;font-size:12px;font-weight:800;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
#fm-root .aiband-stop:hover:not(:disabled){background:#dc2626;border-color:#dc2626;color:#fff}
#fm-root .aiband-stop:disabled{opacity:.55;cursor:default}
#fm-root .aiband.err{background:#fff7f7;border-color:#f3c4c4;color:#92400e;font-size:12.5px;gap:9px;box-shadow:none}
#fm-root .aiband.err::before,#fm-root .aiband.err::after{display:none}
#fm-root .aiband-errdot{width:9px;height:9px;border-radius:50%;background:#c0353a;flex-shrink:0}
/* Kaynak / entegratör hapları — kullanıcı bulgusu (2026-09-12): gereksiz büyüktü → tablo satırında kompakt, başlıkta orta */
#fm-root .sq-table .sq-src{height:20px;padding:0 7px 0 2px;gap:5px;font-size:10px;font-weight:700;letter-spacing:0;border-width:1px}
#fm-root .sq-table .sq-src i{width:15px;height:15px;font-size:7px}
#fm-root .sq-head .sq-src{height:22px;font-size:10.5px;font-weight:700}
#fm-root .sq-head .sq-src i{width:16px;height:16px;font-size:7.5px}
#fm-root .sq-table td .sq-pill{height:20px;padding:0 8px;font-size:10.5px}
/* Kullanıcı bulgusu (2026-09-12): Eylemler sütunu sağa yapışıkken Güven sütununun üstüne biniyordu → yapışkanlık kaldırıldı, sütunlar sıkılaştırıldı; Tip sütunu kaldırıldı (ekran zaten Alış/Satış). */
#fm-root .gf-table td.actcol,#fm-root .gf-table th.actcol{position:static;box-shadow:none}
#fm-root .gf-table td:nth-child(4) b{display:block;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .gf-table .gf-neden{max-width:120px}
#fm-root .gf-table .gf-hesap small,#fm-root .gf-table .gf-hesap span{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .gf-table .gf-acts{min-width:0;grid-template-columns:auto auto}
#fm-root .gf-table .gf-act{height:24px;padding:0 7px;font-size:11px}
#fm-root .gf-table td,#fm-root .gf-table th{padding-left:9px;padding-right:9px}
/* === PLAN16-B3: GELEN FATURALAR — SABİT SÜTUN DÜZENİ (kullanıcı bulgusu 2026-09-12: sütunlar kayıyor/taşıyordu) === */
#fm-root .gf-twrap{overflow:auto}
#fm-root .gf-table{table-layout:fixed;width:100%;min-width:1120px;border-collapse:separate;border-spacing:0}
#fm-root .gf-table col.gc-sel{width:40px}
#fm-root .gf-table col.gc-tarih{width:86px}
#fm-root .gf-table col.gc-no{width:140px}
#fm-root .gf-table col.gc-firma{width:auto}
#fm-root .gf-table col.gc-haric{width:108px}
#fm-root .gf-table col.gc-kdv{width:92px}
#fm-root .gf-table col.gc-tutar{width:112px}
#fm-root .gf-table col.gc-hesap{width:172px}
#fm-root .gf-table col.gc-durum{width:150px}
#fm-root .gf-table col.gc-eylem{width:152px}
#fm-root .gf-table th,#fm-root .gf-table td{padding:9px 10px;overflow:hidden;vertical-align:middle}
#fm-root .gf-table th.gf-th-eylem{text-align:right}
#fm-root .gf-table td.gf-tarih{white-space:nowrap;font-variant-numeric:tabular-nums}
#fm-root .gf-table td.gf-no{font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:nowrap;text-overflow:ellipsis}
#fm-root .gf-table td.gf-firma b{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .gf-table td.gf-firma small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .gf-table td.gf-firma .gf-muk{color:#b91c1c;font-weight:700;text-decoration:underline}
#fm-root .gf-table td.gf-sayi{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;padding-left:6px;padding-right:8px}
#fm-root .gf-table td.gf-tutar b{font-weight:600;color:var(--text)}
#fm-root .gf-table th.num{text-align:right}
#fm-root .gf-table td.gf-hesap{max-width:none}
#fm-root .gf-table td.gf-hesap .hk{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .gf-table td.gf-hesap small{display:block;font-size:10.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;line-height:1.25;margin-top:1px}
#fm-root .gf-table td.gf-durum{white-space:nowrap}
#fm-root .gf-table .gf-durumhap{cursor:pointer;font-family:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis;display:inline-flex;align-items:center;gap:5px}
#fm-root .gf-table .gf-durumhap:hover{filter:brightness(.96)}
#fm-root .gf-table .gf-guvennok{width:7px;height:7px;border-radius:50%;background:#dc2626;box-shadow:0 0 0 2px #fee2e2;flex-shrink:0}
#fm-root .gf-table .gf-uyn{font-style:normal;font-size:10px;font-weight:800;margin-left:2px}
#fm-root .gf-table .gf-demirbas{margin-top:5px;display:flex;flex-wrap:wrap;gap:4px}
#fm-root .gf-table td.gf-eylem{text-align:right;white-space:nowrap;padding:7px 8px 7px 6px}
#fm-root .gf-table td:first-child,#fm-root .gf-table th:first-child{padding-left:8px;padding-right:6px}
#fm-root .gf-table .gf-acts{display:inline-flex;gap:4px;min-width:0}
#fm-root .gf-table .gf-act{width:29px;height:28px;padding:0;justify-content:center;font-size:0}
#fm-root .gf-table .gf-act .ico{display:inline-flex}
#fm-root .gf-table .gf-ozel{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}
#fm-root .gf-table .gf-ozel-cip{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap;border:1px solid transparent}
#fm-root .gf-table .gf-ozel-cip.tevk{background:#eef2ff;color:#3730a3;border-color:#c7d2fe}
#fm-root .gf-table .gf-ozel-cip.dem{background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe}
/* Editör uyarı kutusu: başlık satırının altında, sabit yükseklik, kaydırılabilir; kapalıyken tek satır (kullanıcı bulgusu 2026-09-12) */
#fm-root .screen-muhasebe .muhmain .fispane > .uykutu{order:2;flex:0 0 auto;max-height:230px;overflow:auto;margin:0 0 8px}
#fm-root .uykutu-h{width:100%;border:0;cursor:pointer;text-align:left;font-family:inherit}
#fm-root .uykutu.kapali{max-height:none;overflow:hidden}
#fm-root .uykutu.kapali .uykutu-h{border-bottom:0}
#fm-root .uykutu-oz{font-style:normal;font-weight:600;color:#64748b;font-size:11.5px}
/* Kullanıcı isteği (2026-09-12): Sorgu tablolarında ONAY sütunu bilgi amaçlı — renkli hap yerine düz yazı (yalnız red/iptal kırmızı) */
#fm-root .sq-onay,#fm-root .sq-onay.onay,#fm-root .sq-onay.oto,#fm-root .sq-onay.bekliyor{background:transparent;border-color:transparent;color:var(--muted);font-weight:600;padding:0;height:auto}
#fm-root .sq-onay::before{background:#cbd5e1}
#fm-root .sq-onay.red,#fm-root .sq-onay.iptal,#fm-root .sq-onay.itiraz{color:#b91c1c;background:transparent;border-color:transparent;padding:0;height:auto}
#fm-root .sq-onay.red::before,#fm-root .sq-onay.iptal::before,#fm-root .sq-onay.itiraz::before{background:#e5484d}
#fm-root .sq-onay.silinmis,#fm-root .sq-onay.diger{background:transparent;border-color:transparent;padding:0;height:auto}
/* Süzgeç boş sonuç bağlantısı */
#fm-root .gf-table .empty a{color:var(--accent);font-weight:700;text-decoration:underline}

/* === PLAN16-F3: MUKELLEFLER — sayaclar sol/sag, 5 sutunlu sade tablo (kullanıcı kararı 2026-09-12) === */
#fm-root .mk-sayaclar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
#fm-root .mk-sayac-grup{display:flex;gap:8px;flex-wrap:wrap}
#fm-root .mk-sayac{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px 0 12px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px;font-weight:700;color:var(--muted);transition:border-color .12s,background .12s,box-shadow .12s;box-shadow:0 1px 2px rgba(16,24,40,.04)}
#fm-root .mk-sayac::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--tc,var(--accent))}
#fm-root .mk-sayac b{font-size:15px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums}
#fm-root .mk-sayac:hover{border-color:var(--tc,var(--accent))}
#fm-root .mk-sayac.on{border-color:var(--tc,var(--accent));background:color-mix(in srgb,var(--tc,var(--accent)) 10%,#fff);color:var(--tc,var(--accent));box-shadow:inset 0 0 0 1px var(--tc,var(--accent))}
#fm-root .mk-sayac.on b{color:var(--tc,var(--accent))}
#fm-root .mk-head h3 .mu{font-weight:400;color:var(--faint);font-size:12px}
#fm-root .mk-twrap{overflow:auto;max-height:calc(100vh - 250px)}
#fm-root .mk-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
#fm-root .mk-table th{text-align:left;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--th-text);background:var(--th);padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
#fm-root .mk-table td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
#fm-root .mk-tr{cursor:pointer;transition:background .1s}
#fm-root .mk-tr:hover td{background:#f8fafc}
#fm-root .mk-tr.mk-sorunlu td:first-child{box-shadow:inset 3px 0 0 #e5484d}
#fm-root .mk-kim{display:flex;align-items:center;gap:11px;min-width:0}
#fm-root .mk-avatar{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-size:12px;font-weight:900;letter-spacing:.3px;flex-shrink:0;color:#fff}
#fm-root .mk-avatar.isl{background:linear-gradient(135deg,#15803d,#22a35a)}
#fm-root .mk-avatar.bil{background:linear-gradient(135deg,#6d28d9,#8b5cf6)}
#fm-root .mk-avatar.bos{background:linear-gradient(135deg,#94a3b8,#b8c2d0)}
#fm-root .mk-kim-tx{display:flex;flex-direction:column;min-width:0}
#fm-root .mk-kim-tx b{font-size:13px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px}
#fm-root .mk-kim-tx small{font-size:11px;color:var(--faint);font-weight:600}
#fm-root .mk-profil{display:flex;gap:6px;flex-wrap:wrap}
#fm-root .mk-pill{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:10.5px;font-weight:700;white-space:nowrap;border:1px solid transparent}
#fm-root .mk-pill.isl{background:#ecfdf5;color:#15803d;border-color:#bbf7d0}
#fm-root .mk-pill.bil{background:#f3f0ff;color:#6d28d9;border-color:#ddd6fe}
#fm-root .mk-pill.bos{background:#f8fafc;color:#94a3b8;border-color:#e2e8f0}
#fm-root .mk-pill.efat{background:#ecfeff;color:#0e7490;border-color:#a5f3fc}
#fm-root .mk-pill.earsiv{background:#fff7ed;color:#b45309;border-color:#fed7aa}
#fm-root .mk-tanimli{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;white-space:nowrap}
#fm-root .mk-tanimli i{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-style:normal;font-weight:900;color:#fff}
#fm-root .mk-tanimli.ok{color:#15803d}#fm-root .mk-tanimli.ok i{background:#16a34a}
#fm-root .mk-tanimli.uyar{color:#b91c1c}#fm-root .mk-tanimli.uyar i{background:#e5484d;box-shadow:0 0 0 3px #fee2e2}
#fm-root .mk-donem{display:flex;gap:6px;flex-wrap:wrap}
#fm-root .mk-say{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap}
#fm-root .mk-say.bekleyen{background:#eff6ff;color:#1d4ed8}
#fm-root .mk-say.onayli{background:#ecfdf5;color:#15803d}
#fm-root .mk-say.luca{background:#f0fdfa;color:#0f766e}
#fm-root .mk-say.sorunlu{background:#fef2f2;color:#b91c1c}
#fm-root .mk-say.yok{color:var(--faint);font-weight:600;padding:0}
#fm-root .mk-th-eylem{width:190px}
#fm-root .mk-eylem{white-space:nowrap;text-align:right}
#fm-root .mk-eylem .btn{height:30px;padding:0 11px;font-size:12px;border-radius:8px;margin-left:6px;box-shadow:none}
#fm-root .mk-eylem .btn.mk-ac{background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent-line)}
#fm-root .mk-eylem .btn.mk-ac:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .mk-eylem .btn.mk-duzenle.on{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root tr.mk-acik td{background:color-mix(in srgb,var(--accent) 6%,#fff)}
#fm-root tr.mk-formrow td{padding:0 14px 14px 59px;background:color-mix(in srgb,var(--accent) 6%,#fff);cursor:default}
#fm-root .mk-tanim{border:1px solid var(--accent-line);border-radius:12px;background:#fff;padding:14px 16px 12px;box-shadow:0 10px 24px -20px var(--accent)}
#fm-root .mk-tanim-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 16px}
#fm-root .mk-alan{display:flex;flex-direction:column;gap:5px;min-width:0}
#fm-root .mk-alan-genis{grid-column:span 2}
#fm-root .mk-alan-l{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}
#fm-root .mk-alan-l small{text-transform:none;letter-spacing:0;font-weight:600;color:var(--faint)}
#fm-root .mk-alan input{border:1px solid var(--line2);border-radius:8px;padding:7px 10px;font-size:12.5px;font-weight:600;color:var(--text);background:#fff;min-height:34px;width:100%}
#fm-root .mk-alan input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#fm-root .mk-haplar{display:flex;flex-wrap:wrap;gap:5px}
#fm-root .mk-hap{height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--line2);background:#fff;color:var(--muted);font-size:11.5px;font-weight:700;cursor:pointer}
#fm-root .mk-hap:hover{border-color:var(--accent);color:var(--accent)}
#fm-root .mk-hap.on{background:var(--accent);border-color:var(--accent);color:#fff}
#fm-root .mk-switch{display:inline-flex;align-items:center;gap:9px;border:0;background:transparent;padding:2px 0;cursor:pointer;text-align:left}
#fm-root .mk-switch-k{width:38px;height:22px;border-radius:999px;background:#cbd5e1;position:relative;flex-shrink:0;transition:background .15s}
#fm-root .mk-switch-k::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .15s}
#fm-root .mk-switch.on .mk-switch-k{background:var(--accent)}
#fm-root .mk-switch.on .mk-switch-k::after{left:19px}
#fm-root .mk-switch-t{font-size:12px;font-weight:600;color:var(--muted)}
#fm-root .mk-switch.on .mk-switch-t{color:var(--accent)}
#fm-root .mk-tanim-eylem{display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
#fm-root .mk-tanim-not{font-size:11px;color:var(--faint);font-weight:600}
@media (max-width:1100px){#fm-root .mk-tanim-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#fm-root .mk-alan-genis{grid-column:span 2}}
/* === PLAN16-GH: GERI AL + GECE ANAHTARI === */
/* §G — Aktarım/Arşivim satırı: etiketli "Geri al" düğmesi (hover'a saklanmaz; amber; Luca'ya gitmişte gradyan) */
#fm-root .gh-geri{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border-radius:8px;border:1px solid #f0d6ad;background:#fbf4e9;color:#a85d08;font-family:inherit;font-size:11.5px;font-weight:800;cursor:pointer;white-space:nowrap;line-height:1;transition:background .12s,border-color .12s,color .12s,transform .1s,box-shadow .12s}
#fm-root .gh-geri .ico{display:inline-flex}
#fm-root .gh-geri:hover:not(:disabled){background:#cf7a0e;border-color:#cf7a0e;color:#fff;transform:translateY(-1px);box-shadow:0 6px 12px -8px #cf7a0e}
#fm-root .gh-geri.luca{border-color:#e9b96f;background:linear-gradient(135deg,#fff1d6,#fbf4e9)}
#fm-root .gh-geri:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
/* Luca fiş no — küçük mono rozet (Durum hapının yanında) */
#fm-root .gh-fis{display:inline-block;margin-left:6px;font-family:"Consolas","SF Mono",ui-monospace,monospace;font-size:11px;font-weight:700;color:#0f766e;background:#ecf7f5;border:1px solid #bfe6e1;border-radius:6px;padding:1px 6px;vertical-align:middle;letter-spacing:.2px}
/* "Luca'da elle düzeltilecek · fiş N" (amber) / "elle düzeltildi" (yeşil) çipi + Düzelttim düğmesi */
#fm-root .gh-elle{display:flex;align-items:center;gap:6px;margin-top:5px;white-space:nowrap}
#fm-root .gh-cip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;border:1px solid transparent;font-size:10.5px;font-weight:700;line-height:1;white-space:nowrap;cursor:help}
#fm-root .gh-cip::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
#fm-root .gh-cip b{font-family:"Consolas","SF Mono",ui-monospace,monospace;font-weight:800}
#fm-root .gh-cip.amber{background:#fff5e6;color:#b45309;border-color:#f4d19b}
#fm-root .gh-cip.yesil{background:#e7f6ec;color:#15803d;border-color:#bfe5cc}
#fm-root .gh-duzelttim{height:22px;padding:0 9px;border-radius:7px;border:1px solid #bfe5cc;background:#fff;color:#15803d;font-family:inherit;font-size:10.5px;font-weight:800;cursor:pointer;white-space:nowrap;line-height:1;transition:background .12s,color .12s,border-color .12s}
#fm-root .gh-duzelttim:hover:not(:disabled){background:#15803d;border-color:#15803d;color:#fff}
#fm-root .gh-duzelttim:disabled{opacity:.55;cursor:wait}
/* Teyit kutusu (sayfa içi; confirm() yerine) — başlık radial gradyan; Luca modunda amber */
#fm-root .gh-ov{position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:grid;place-items:center;padding:16px}
#fm-root .gh-box{width:min(540px,96vw);background:#fff;color:var(--text);border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45)}
#fm-root .gh-box-h{position:relative;padding:16px 20px;color:#fff;background:radial-gradient(120% 140% at 0% 0%,color-mix(in srgb,var(--accent) 55%,#fff) 0%,var(--accent) 55%,color-mix(in srgb,var(--accent) 70%,#000) 100%)}
#fm-root .gh-box-h.luca{background:radial-gradient(120% 140% at 0% 0%,#fde68a 0%,#f59e0b 55%,#b45309 100%)}
#fm-root .gh-box-h small{display:block;font-size:10.5px;letter-spacing:.1em;font-weight:700;opacity:.9}
#fm-root .gh-box-h b{display:block;font-size:17px;font-weight:800;margin-top:2px;line-height:1.3}
#fm-root .gh-box-b{padding:16px 20px 6px;font-size:13px;line-height:1.6;color:#292524;display:flex;flex-direction:column;gap:10px}
#fm-root .gh-box-b p{margin:0}
#fm-root .gh-box-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px 14px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfcfd}
#fm-root .gh-box-meta span{display:flex;flex-direction:column;gap:1px;min-width:0}
#fm-root .gh-box-meta small{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:var(--faint)}
#fm-root .gh-box-meta b{font-size:13px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .gh-box-meta b.gh-mono{font-family:"Consolas","SF Mono",ui-monospace,monospace;color:#0f766e}
#fm-root .gh-box-uyari{padding:10px 12px;border-radius:9px;background:#fff7e6;border:1px solid #f3d9a4;color:#7c4a03;font-weight:600}
#fm-root .gh-box-not{display:flex;flex-direction:column;gap:4px}
#fm-root .gh-box-not small{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--faint)}
#fm-root .gh-box-not textarea{width:100%;resize:vertical;min-height:52px;border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font-family:inherit;font-size:12.5px;color:var(--text);background:#fff}
#fm-root .gh-box-not textarea:focus{outline:none;border-color:#f59e0b;box-shadow:0 0 0 2px #fff4e0}
#fm-root .gh-box-f{display:flex;gap:9px;justify-content:flex-end;padding:12px 20px 18px}
#fm-root .btn.gh-amber{background:linear-gradient(135deg,#b45309,#f59e0b);color:#fff;border-color:transparent;box-shadow:0 8px 18px -10px #b45309}
#fm-root .btn.gh-amber:hover:not(:disabled){filter:brightness(1.05);color:#fff;border-color:transparent;background:linear-gradient(135deg,#b45309,#f59e0b)}
/* §H — Entegratörler: bilgi bandı (gradyan + sağ üst radial parıltı + sol accent şerit; düz gri kutu değil) */
#fm-root .gh-band{position:relative;overflow:hidden;display:flex;align-items:flex-start;gap:10px;margin:0 0 14px;padding:12px 16px 12px 18px;border-radius:12px;border:1px solid var(--accent-line);background:radial-gradient(circle at 100% 0%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 40%),linear-gradient(135deg,color-mix(in srgb,var(--accent) 8%,#fff),#fff 60%);font-size:12.5px;line-height:1.55;color:var(--text);box-shadow:0 12px 26px -22px var(--accent)}
#fm-root .gh-band::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--accent),#2dd4bf)}
#fm-root .gh-band .ico{color:var(--accent);margin-top:2px;flex-shrink:0}
#fm-root .gh-band b{font-weight:800;color:#0d1626}
#fm-root .gh-band code{font-family:"Consolas","SF Mono",ui-monospace,monospace;font-size:11.5px;background:#fff;border:1px solid var(--accent-line);border-radius:5px;padding:0 5px;color:var(--accent)}
/* Gece çekim satırı: anahtar + durum + saat (mükellef × entegratör; "hepsini aç/kapat" YOK) */
#fm-root .ecard .erow.gh-gece{align-items:center;padding:7px 0}
#fm-root .gh-gece-ctl{display:inline-flex;align-items:center;gap:8px}
#fm-root .gh-switch{position:relative;width:38px;height:22px;padding:0;border-radius:999px;border:1px solid #cbd5e1;background:#d9dee7;cursor:pointer;transition:background .16s,border-color .16s,box-shadow .16s;flex-shrink:0}
#fm-root .gh-switch i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.35);transition:left .16s}
#fm-root .gh-switch.on{background:var(--accent);border-color:var(--accent);box-shadow:0 6px 14px -9px var(--accent)}
#fm-root .gh-switch.on i{left:18px}
#fm-root .gh-switch:hover:not(:disabled){border-color:var(--accent)}
#fm-root .gh-switch:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#fm-root .gh-switch:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
#fm-root .gh-gece-durum{font-size:11.5px;font-weight:800;color:var(--faint);min-width:42px}
#fm-root .gh-gece-durum.on{color:var(--accent)}
#fm-root .gh-saat{height:26px;padding:0 6px;border:1px solid var(--line2);border-radius:7px;background:#fff;color:var(--text);font-family:"Consolas","SF Mono",ui-monospace,monospace;font-size:12px;font-weight:700;cursor:pointer}
#fm-root .gh-saat:focus{outline:none;border-color:var(--accent)}
#fm-root .gh-saat:disabled{opacity:.5;cursor:not-allowed}
#fm-root .gh-gece-hint{font-size:11px;color:var(--faint);padding:0 0 4px;line-height:1.4}
#fm-root .gh-gece-hint.on{color:var(--accent);font-weight:600}
#fm-root .gh-gece-hint.kilit{color:#b45309}
/* === PLAN16-D: KDV TEYIT === */
/* Panel: petrol vurgulu başlık şeridi (düz gri kutu YOK); tablo kendi kabında kayar (sayfa yatay KAYMAZ). */
#fm-root .kt-card{border-color:var(--accent-line);background:linear-gradient(180deg,#fff 0,#fff 100%)}
#fm-root .kt-card > .ch{background:radial-gradient(120% 140% at 0% 0%,var(--accent-soft) 0,#fff 62%);border-bottom-color:var(--accent-line)}
#fm-root .kt-card > .ch h3::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:middle;box-shadow:0 0 0 3px var(--accent-soft)}
#fm-root .kt-hap{font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;white-space:nowrap;line-height:1.5}
#fm-root .kt-hap.fark{background:#fdeaea;color:#c0353a;border:1px solid #f0b3b3}
#fm-root .kt-hap.uyum{background:#e7f6ec;color:#15803d;border:1px solid #b7e3c6}
#fm-root .kt-esik{margin-left:auto;font-size:11px;color:var(--faint);font-weight:600}
/* Rozetler: "kaynak: N belge (X onaysız, …)" — tıklanabilir, sıfır olan soluk. */
#fm-root .kt-rozet{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 16px 6px;font-size:11.5px;color:var(--muted)}
#fm-root .kt-rozl{font-weight:700;color:var(--muted);margin-right:2px}
#fm-root .kt-roz{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;border:1px solid var(--line2);background:#fff;color:#334155;cursor:pointer;font-family:inherit;line-height:1.5;transition:border-color .14s,background .14s,color .14s}
#fm-root .kt-roz .n{font-weight:800;font-variant-numeric:tabular-nums}
#fm-root .kt-roz:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
#fm-root .kt-roz.on{background:var(--accent);border-color:var(--accent);color:#fff}
#fm-root .kt-roz.bos{opacity:.5;cursor:default}
#fm-root .kt-roz.belge{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
#fm-root .kt-roz.belge.on{background:var(--accent);color:#fff}
#fm-root .kt-roz.onaysiz:not(.bos):not(.on){background:#fdf2e0;border-color:#f3d6a6;color:#b45309}
#fm-root .kt-roz.iptal:not(.bos):not(.on),#fm-root .kt-roz.mukerrer:not(.bos):not(.on){background:#fdeaea;border-color:#f0b3b3;color:#c0353a}
#fm-root .kt-roz.tevkifat:not(.bos):not(.on){background:#f3e8ff;border-color:#e3d4fb;color:#7c3aed}
#fm-root .kt-roz.iade:not(.bos):not(.on){background:#e6eefc;border-color:#c9d9f8;color:#2563eb}
#fm-root .kt-roz.gib:not(.on){background:#eef1f5;border-color:#d5dbe3;color:#475569}
/* Teyit tablosu */
#fm-root .kt-twrap{overflow:auto;padding:4px 0 0}
#fm-root .kt-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:720px}
#fm-root .kt-table th{background:var(--th);color:var(--th-text);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
#fm-root .kt-table td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
#fm-root .kt-table tbody tr:last-child td{border-bottom:none}
#fm-root .kt-table th.num,#fm-root .kt-table td.num{text-align:right;font-variant-numeric:tabular-nums}
#fm-root .kt-table tr.kt-uyari td:first-child{box-shadow:inset 3px 0 0 #e0394a}
#fm-root .kt-etk{display:block;font-size:10.5px;color:var(--faint);font-weight:600;margin-top:1px}
#fm-root .kt-cell.ok{color:#15803d}
#fm-root .kt-cell.ok .kt-ok{display:inline-block;margin-left:4px;font-weight:800;color:#15803d}
#fm-root .kt-cell.fark{background:#fdeaea;color:#b02a37}
#fm-root .kt-cell.fark b{color:#b02a37}
#fm-root .kt-fark{display:block;font-size:10.5px;font-weight:800;color:#c0353a;margin-top:2px;white-space:nowrap}
#fm-root .kt-acik{display:block;font-size:10.5px;font-weight:600;color:#9a3a42;margin-top:1px;white-space:normal;max-width:220px;margin-left:auto}
#fm-root .kt-cell.yok{color:var(--faint);font-weight:600}
#fm-root .kt-cell.yok small{display:block;font-size:10.5px;font-style:italic;font-weight:500;white-space:nowrap}
/* FM sayısı = tıklanır (belge listesi) — işlev hover'a saklanmaz: noktalı alt çizgi hep görünür. */
#fm-root .kt-fmbtn{background:none;border:none;padding:0;font:inherit;font-weight:800;color:var(--accent);cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;font-variant-numeric:tabular-nums}
#fm-root .kt-fmbtn small{display:block;font-size:10.5px;font-weight:600;color:var(--faint);text-decoration:none}
#fm-root .kt-fmbtn:hover,#fm-root .kt-fmbtn.on{text-decoration-style:solid}
#fm-root .kt-fmbtn.on{color:#0f766e}
/* Kaynak bilgi satırı + notlar bandı */
#fm-root .kt-kaynak{display:flex;flex-wrap:wrap;gap:6px 18px;padding:9px 16px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line)}
#fm-root .kt-kaynak b{color:var(--text);font-weight:700}
#fm-root .kt-notlar{margin:0 16px 14px;padding:9px 12px;border-radius:10px;background:var(--accent-soft);border:1px solid var(--accent-line);font-size:12px;color:var(--text);line-height:1.5}
#fm-root .kt-not{display:flex;align-items:flex-start;gap:8px}
#fm-root .kt-not + .kt-not{margin-top:4px}
#fm-root .kt-not .ico{color:var(--accent);margin-top:2px}
/* Drilldown belge listesi (panel altında) */
#fm-root .kt-liste{border-top:1px solid var(--accent-line)}
#fm-root .kt-liste-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 16px;background:radial-gradient(110% 160% at 0% 0%,var(--accent-soft) 0,#fff 70%);font-size:12.5px;font-weight:700;color:var(--text)}
#fm-root .kt-cnt{margin-left:6px;padding:1px 8px;border-radius:20px;background:var(--accent);color:#fff;font-size:11px;font-weight:800;vertical-align:middle}
#fm-root .kt-liste .kt-twrap{max-height:380px;overflow:auto}
#fm-root .kt-liste .kt-table{min-width:640px}
#fm-root .kt-mono{font-family:"Consolas","SF Mono",ui-monospace,monospace;font-size:12px}
#fm-root .kt-gib{color:var(--faint);font-style:italic}
#fm-root .kt-gib small{font-family:"Consolas","SF Mono",ui-monospace,monospace;font-style:normal;margin-left:6px}
#fm-root .kt-ac{background:none;border:1px solid var(--accent-line);border-radius:7px;padding:3px 9px;font:inherit;font-size:11.5px;font-weight:700;color:var(--accent);cursor:pointer;white-space:nowrap}
#fm-root .kt-ac:hover{background:var(--accent-soft)}
/* Kategori tablosu: "Hesap atanmamış (N)" + kısayollar (Kodları düzelt · AI ile oku) */
#fm-root .kt-ha{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
#fm-root .kt-kisayol{display:inline-flex;gap:6px;align-items:center}
#fm-root .kt-kisayol .btn.sm{padding:4px 9px;font-size:11px;gap:5px}
/* === PLAN16-E: BELGE AKISI === */
/* Sade düzen (2026-09-12): sayaç kartı YOK, alt çubuk YOK, sticky YOK; haplar küçük (20px, 10.5px); petrol accent. */
/* Akış durmuş — ince amber bilgi bandı; "listeyi gör" → altında kaydırılabilir liste; ada tıkla → yerel mükellef süzgeci */
#fm-root .ak-band{margin:0 0 10px;padding:7px 12px;border:1px solid #f3d9a4;border-radius:9px;background:#fff7e6;color:#7c4a03;font-size:12px}
#fm-root .ak-band-h{display:flex;align-items:center;gap:6px;flex-wrap:wrap;line-height:1.4}
#fm-root .ak-band-h b{font-weight:800;color:#92400e}
#fm-root .ak-band-ic{color:#b45309;font-size:13px;line-height:1}
#fm-root .ak-band-sep{color:#c99a4a}
#fm-root .ak-link{border:0;background:none;color:var(--accent);font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:2px;padding:0 2px;white-space:nowrap}
#fm-root .ak-link:hover{color:#0f766e}
#fm-root .ak-link.amber{color:#92400e}
#fm-root .ak-link.amber:hover{color:#7c2d12}
#fm-root .ak-band-list{display:flex;flex-wrap:wrap;gap:4px;max-height:132px;overflow:auto;margin-top:7px;padding-top:7px;border-top:1px dashed #f3d9a4}
#fm-root .ak-band-row{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 4px 0 8px;border-radius:999px;border:1px solid #f3d9a4;background:#fff;color:#7c4a03;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;max-width:260px;transition:background .12s,border-color .12s}
#fm-root .ak-band-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .ak-band-row i{font-style:normal;font-size:10px;font-weight:800;color:#92400e;background:#fdecc8;border-radius:999px;padding:1px 6px;line-height:1.3;flex-shrink:0}
#fm-root .ak-band-row:hover{border-color:#d9a441;background:#fffbf2}
#fm-root .ak-band-row.on{background:#b45309;border-color:#b45309;color:#fff}
#fm-root .ak-band-row.on i{background:rgba(255,255,255,.25);color:#fff}
/* Sekme hapları (ofis geneli sayılar) + sağda küçük sayaç çipleri (yalnız >0; tıkla: durum süzgeci) */
#fm-root .ak-tabs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px}
#fm-root .ak-tab{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;border:1.5px solid var(--line2);background:#fff;color:#34415a;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:background .12s,border-color .12s,color .12s,box-shadow .12s}
#fm-root .ak-tab b{font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:999px;background:#eef1f5;color:var(--muted);line-height:1.4;font-variant-numeric:tabular-nums}
#fm-root .ak-tab:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
#fm-root .ak-tab.on{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 8px 16px -10px var(--accent)}
#fm-root .ak-tab.on b{background:rgba(255,255,255,.22);color:#fff}
#fm-root .ak-sayac{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);padding-left:6px}
#fm-root .ak-sayac-item{display:inline-flex;align-items:center;gap:6px}
#fm-root .ak-sayac-sep{color:var(--faint)}
#fm-root .ak-sayac-cip{border:0;background:none;padding:0 2px;font-family:inherit;font-size:11.5px;font-weight:600;cursor:pointer;color:var(--muted);white-space:nowrap;border-radius:6px}
#fm-root .ak-sayac-cip b{font-weight:800;font-variant-numeric:tabular-nums}
#fm-root .ak-sayac-cip.cyan b{color:#0891b2}
#fm-root .ak-sayac-cip.mor b{color:#7c3aed}
#fm-root .ak-sayac-cip.kirmizi b{color:#dc2626}
#fm-root .ak-sayac-cip:hover,#fm-root .ak-sayac-cip.on{text-decoration:underline;text-underline-offset:2px}
#fm-root .ak-sayac-cip.on{color:var(--text)}
/* Araç çubuğu (tek satır, sarmalanır): seçim+toplu · arama · zaman hapları · yön hapları · mükellef · temizle ··· durum · sayfalama */
#fm-root .card.ak-card{overflow:hidden}
#fm-root .card .ch.ak-bar{gap:8px;padding:9px 12px;background:#fbfcfe}
#fm-root .ak-bar .fmdd-btn{height:30px;font-size:12px;padding:0 9px}
#fm-root .ak-sel{display:inline-flex;align-items:center;gap:6px;padding:3px 6px 3px 9px;border-radius:9px;background:var(--accent-soft);border:1px solid var(--accent-line)}
#fm-root .ak-selinfo{font-size:12px;color:var(--text);white-space:nowrap}
#fm-root .ak-selinfo b{color:var(--accent);font-weight:800}
#fm-root .ak-sep{color:var(--faint);font-size:12px}
#fm-root .ak-x{border:1px solid var(--line2);background:#fff;color:var(--muted);border-radius:999px;width:18px;height:18px;font-size:10px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
#fm-root .ak-x:hover{border-color:var(--red);color:var(--red)}
#fm-root .ak-sel .btn.sm{padding:4px 9px;font-size:11.5px;gap:4px}
#fm-root .ak-sel .btn.ak-sil{color:#b91c1c;border-color:#f3c0c0}
#fm-root .ak-sel .btn.ak-sil:hover:not(:disabled){background:#fdeaea;border-color:#e59a9a;color:#991b1b}
#fm-root .sq-search.ak-search{min-width:200px;height:30px;padding:0 9px;flex:1 1 200px;max-width:320px}
#fm-root .sq-search.ak-search input{font-size:12px}
#fm-root .ak-haplar{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:#eef1f5}
#fm-root .ak-hap{height:22px;padding:0 9px;border-radius:999px;border:0;background:none;color:#4b5563;font-family:inherit;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s,box-shadow .12s}
#fm-root .ak-hap:hover{color:var(--accent)}
#fm-root .ak-hap.on{background:#fff;color:var(--accent);box-shadow:0 1px 3px rgba(15,23,42,.14)}
#fm-root .ak-hap.alis.on{color:#2563eb}
#fm-root .ak-hap.satis.on{color:#15803d}
#fm-root .ak-pg{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
#fm-root .ak-pgbtn{width:26px;height:26px;border-radius:7px;border:1px solid var(--line2);background:#fff;color:#34415a;font-size:15px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0;transition:border-color .12s,color .12s,background .12s}
#fm-root .ak-pgbtn:hover:not(:disabled){border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
#fm-root .ak-pgbtn:disabled{opacity:.4;cursor:default}
/* Tablo (7 sütun): kendi kabında kayar; sticky YOK; çift satır hücreler (alt satır küçük gri) */
#fm-root .ak-twrap{overflow:auto;transition:opacity .15s}
#fm-root .ak-twrap.ak-loading{opacity:.55}
#fm-root .ak-table{min-width:860px}
#fm-root .ak-table tbody td{vertical-align:middle;padding-top:9px;padding-bottom:9px}
#fm-root .ak-table td b{display:block;font-weight:600;color:#0e1726;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .ak-table td small{display:block;font-size:10.5px;color:var(--faint);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
#fm-root td.ak-belge{max-width:230px}
#fm-root .ak-mono{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .ak-alt{display:flex;align-items:center;gap:5px;margin-top:3px}
#fm-root .ak-table .sq-src{height:20px;padding:0 7px 0 2px;gap:5px;font-size:10px;font-weight:700;letter-spacing:0;max-width:150px;overflow:hidden;text-overflow:ellipsis}
#fm-root .ak-table .sq-src i{width:15px;height:15px;font-size:7px;flex-shrink:0}
#fm-root .ak-yon{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:700;line-height:1}
#fm-root .ak-yon.alis{background:#eaf1ff;color:#2563eb}
#fm-root .ak-yon.satis{background:#e7f6ec;color:#15803d}
#fm-root td.ak-mk{max-width:200px}
#fm-root td.ak-firm{max-width:210px}
#fm-root td.ak-tarih{color:#334155;font-variant-numeric:tabular-nums}
#fm-root td.ak-tutar{font-weight:600;color:#0e1726}
#fm-root td.ak-durumcell{max-width:220px}
#fm-root .ak-durum{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:999px;border:1px solid;font-size:10.5px;font-weight:800;white-space:nowrap;line-height:1}
#fm-root .ak-durum::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
#fm-root .ak-durum.okunuyor::before{animation:fmrowpulse 1.2s ease-in-out infinite}
#fm-root .ak-table .uycips{max-width:210px;margin-top:4px;cursor:default}
#fm-root td.ak-actcell{padding-top:7px;padding-bottom:7px}
#fm-root .ak-acts{display:flex;flex-wrap:nowrap;gap:4px}
#fm-root .ak-acts .gf-act{height:23px;padding:0 8px;font-size:11px}
#fm-root td.ak-silcell{font-size:11.5px;color:#7f1d1d;font-variant-numeric:tabular-nums}
#fm-root .foot.ak-foot{padding:9px 16px}
#fm-root .ak-foot .selinfo{font-size:12px;color:var(--muted)}
/* ═══════════ MUHASEBE FİŞ — CİLA v3 (2026-09-12): YAPI AYNI, yalnız tipografi + renk uyumu ═══════════
   Kullanıcı: "yapıyı bozma; yazı kalitesi, tablo, renk uyumu iyileşsin; Varsayılan/Kural yazısı yer kaplamasın".
   Tek aile: slate metin (#0f172a / #475569 / #94a3b8), açık gri çizgi (#e3e8ef), grup kimliği yalnız başlıktaki
   renk noktası + çok hafif başlık tonu. Girdi kutuları aynı yükseklik/kenar/yarıçap. Kaynak rozeti metinsiz nokta. */
#fm-root .screen-muhasebe .muhmain .fispane{background:#fff;border-left:1px solid #eceff3}
#fm-root .screen-muhasebe .muhmain .fgrps{gap:8px}
#fm-root .screen-muhasebe .muhmain .fgrp{border:1px solid #e3e8ef;border-left:1px solid #e3e8ef;border-radius:10px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04)}
#fm-root .screen-muhasebe .muhmain .fgrp[data-g="matrah"]{--gk:#2f6fb0;--gt:#f3f7fb}
#fm-root .screen-muhasebe .muhmain .fgrp[data-g="vergi"]{--gk:#b8860b;--gt:#fbf8ee}
#fm-root .screen-muhasebe .muhmain .fgrp[data-g="tevkifat"]{--gk:#b0475b;--gt:#fbf2f4}
#fm-root .screen-muhasebe .muhmain .fgrp[data-g="cari"]{--gk:#2f8f5b;--gt:#f1f8f4}
#fm-root .screen-muhasebe .muhmain .fgrp .fgh{padding:6px 12px 5px;gap:8px;background:var(--gt,#f8fafc);border-bottom:1px solid #edf1f5;color:#1e293b;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
#fm-root .screen-muhasebe .muhmain .fgrp .fgh > *:first-child{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:700;letter-spacing:.5px;color:#1e293b}
#fm-root .screen-muhasebe .muhmain .fgrp .fgh > *:first-child::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--gk,#94a3b8);flex:0 0 auto}
#fm-root .screen-muhasebe .muhmain .fgrp .fgh .fgs{margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.6px;padding:2px 7px;border-radius:5px;background:#fff;border:1px solid #e3e8ef;color:#64748b;opacity:1;text-transform:uppercase}
#fm-root .screen-muhasebe .muhmain .fgrp .frow{padding:5px 8px 5px 10px;gap:6px;border-top:0;border-bottom:1px solid #f1f4f8}
#fm-root .screen-muhasebe .muhmain .fgrp .frow:hover{background:#fbfcfe}
/* hesap alanı: kod KOYU + tabular, ad gri; rozet metni kalktığı için ada daha çok yer */
#fm-root .screen-muhasebe .muhmain .csel .cselfield{height:28px;border-color:#dbe2ea;border-radius:7px;padding:0 5px 0 7px;background:#fff;transition:border-color .12s,box-shadow .12s}
#fm-root .screen-muhasebe .muhmain .csel .cselfield:hover{border-color:#b9c5d3}
#fm-root .screen-muhasebe .muhmain .csel .cselfield.on{border-color:#2f6fb0;box-shadow:0 0 0 3px rgba(47,111,176,.12)}
#fm-root .screen-muhasebe .muhmain .csel .cselinp{font-size:12.5px;font-weight:600;color:#0f172a}
#fm-root .csel .cselfield .cselinp.gizli,#fm-root .screen-muhasebe .muhmain .csel .cselfield .cselinp.gizli{color:transparent;-webkit-text-fill-color:transparent;caret-color:transparent}
#fm-root .csel .cselshow{position:absolute;left:7px;right:19px;top:0;bottom:0;display:flex;align-items:center;gap:6px;pointer-events:none;overflow:hidden;white-space:nowrap}
#fm-root .csel .cselshow b{flex:0 0 auto;font-size:12.5px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;letter-spacing:-.1px}
#fm-root .csel .cselshow span{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;font-weight:500;color:#64748b}
#fm-root .csel .cselfield .cselcar{border-color:#94a3b8}
/* kaynak noktası (metinsiz) */
#fm-root .kaynak-nokta{flex:0 0 auto;width:7px;height:7px;border-radius:999px;display:inline-block;cursor:help;opacity:.9}
/* oran · tutar · sil — aynı yükseklik/kenar */
#fm-root .screen-muhasebe .muhmain .fgrp .frow .rsel{flex:0 0 48px}
#fm-root .screen-muhasebe .muhmain .rsel .rselfield{height:28px;border-color:#dbe2ea;border-radius:7px;font-size:12px;font-weight:600;color:#334155;background:#fff}
#fm-root .screen-muhasebe .muhmain .rsel .rselfield.on{border-color:#2f6fb0;box-shadow:0 0 0 3px rgba(47,111,176,.12)}
#fm-root .screen-muhasebe .muhmain .fgrp .frow .linum{flex:0 0 92px;width:92px}
#fm-root .screen-muhasebe .muhmain .fgrp .frow .money{height:28px;border:1px solid #dbe2ea;border-radius:7px;padding:0 7px;font-size:12.5px;font-weight:600;color:#0f172a;background:#fff;font-variant-numeric:tabular-nums;letter-spacing:-.1px;text-align:right}
#fm-root .screen-muhasebe .muhmain .fgrp .frow .money:focus{border-color:#2f6fb0;box-shadow:0 0 0 3px rgba(47,111,176,.12);outline:0}
#fm-root .screen-muhasebe .muhmain .fgrp .frow .frowdel{width:18px;height:22px;flex:0 0 18px;border:0;border-radius:6px;background:transparent;color:#94a3b8;opacity:.6;font-size:15px}
#fm-root .screen-muhasebe .muhmain .fgrp .frow .frowdel:hover{opacity:1;color:#dc2626;background:#fef2f2}
#fm-root .screen-muhasebe .muhmain .fgrp .frowadd{padding:4px 12px;font-size:11px;font-weight:600;color:#94a3b8;background:transparent;border-top:1px dashed #e6eaf0}
#fm-root .screen-muhasebe .muhmain .fgrp .frowadd:hover{color:#2f6fb0;background:#f8fafc}
#fm-root .screen-muhasebe .muhmain .fgrp .fgt{padding:5px 12px;background:#fbfcfd;border-top:1px solid #edf1f5;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#94a3b8}
#fm-root .screen-muhasebe .muhmain .fgrp .fgt b{font-size:12.5px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums;letter-spacing:-.1px;text-transform:none}
/* PlainSelect (tevkifat oranı X/10, tevkifat kodu, meta seçiciler) aynı dil */
#fm-root .screen-muhasebe .muhmain .fgrp .psel .pselfield{height:28px;border-color:#dbe2ea;border-radius:7px;font-size:12px;font-weight:600;color:#334155}
/* uyarılar kutusu: grup kartlarıyla aynı kenar/yarıçap; başlık sakin */
#fm-root .screen-muhasebe .muhmain .fispane > .uykutu{border:1px solid #e3e8ef;border-radius:10px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04)}
#fm-root .screen-muhasebe .muhmain .uykutu-h{padding:6px 12px;font-size:11.5px;font-weight:700;color:#1e293b;background:#f8fafc;border-bottom:1px solid #edf1f5}
#fm-root .screen-muhasebe .muhmain .uykutu-h small{font-size:10.5px;font-weight:600;color:#94a3b8}
#fm-root .screen-muhasebe .muhmain .uykutu-oz{font-size:11px;font-weight:500;color:#64748b}
/* belge bilgileri (alt): etiket küçük gri, kutular aynı yükseklik/kenar */
#fm-root .screen-muhasebe .muhmain .docmeta-bottom{border:1px solid #e3e8ef;border-radius:10px;background:#fbfcfd;padding:7px 9px;gap:4px 8px;margin-top:8px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dml{font-size:9.5px;font-weight:700;letter-spacing:.5px;color:#94a3b8;text-transform:uppercase}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dmi,#fm-root .screen-muhasebe .muhmain .docmeta-bottom .psel .pselfield{height:26px;border:1px solid #dbe2ea;border-radius:7px;background:#fff;font-size:12px;font-weight:600;color:#0f172a;padding:0 7px}
#fm-root .screen-muhasebe .muhmain .docmeta-bottom .dmi:focus{border-color:#2f6fb0;box-shadow:0 0 0 3px rgba(47,111,176,.12);outline:0}
/* denge şeridi + düğmeler */
#fm-root .screen-muhasebe .muhmain .balance{margin:8px 0 0;padding:6px 11px;border-radius:9px;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;font-size:12.5px;font-weight:700;gap:8px}
#fm-root .screen-muhasebe .muhmain .balance .bnote{font-size:11.5px;font-weight:500;color:#64748b}
#fm-root .screen-muhasebe .muhmain .wactions .btn{height:32px;border-radius:8px;font-size:12.5px;font-weight:700}
/* ═══════════ /MUHASEBE FİŞ CİLA v3 ═══════════ */
/* === PLAN15-F3-FE === */
/* İşletme editörü: kayıt türü boşken "İncele" gerekçesi — ince amber satır (12px), formun üstünde */
#fm-root .isl-neden{display:flex;align-items:center;flex-wrap:wrap;gap:3px 10px;margin:0 0 8px;padding:5px 9px;border:1px solid #f4d19b;border-left:3px solid #b45309;border-radius:7px;background:#fdf2e0;color:#b45309;font-size:12px;font-weight:600;line-height:1.35}
#fm-root .isl-neden b{font-weight:800}
#fm-root .isl-neden em{font-style:normal;color:#92400e}
#fm-root .isl-neden-link{border:0;background:transparent;padding:0;color:#b45309;font:inherit;font-weight:800;text-decoration:underline;text-underline-offset:2px;cursor:pointer;white-space:nowrap}
#fm-root .isl-neden-link:hover{color:#92400e}
/* İşletme satırı: "KKEG?" çipi (alt tür etiketinin yanında; tıkla → Uyarılar kutusuna kaydır) */
#fm-root .islgrid .dml .isl-kkeg{display:inline-flex;align-items:center;height:15px;margin-left:6px;padding:0 6px;border-radius:999px;border:1px solid #f4d19b;background:#fff5e6;color:#b45309;font-family:inherit;font-size:10px;font-weight:800;line-height:1;cursor:pointer;vertical-align:middle}
#fm-root .islgrid .dml .isl-kkeg:hover{background:#fdf2e0;border-color:#b45309}
/* Gelen Faturalar şeridi: "AI önerisi uygulanan: %X" ölçüt çipi — başlık satırının sağ ucu, küçük, sakin */
#fm-root .gf-strip-h .gf-oran-cip{display:inline-flex;align-items:center;gap:4px;margin-left:auto;height:22px;padding:0 9px;border-radius:999px;border:1px solid var(--accent-line);background:color-mix(in srgb,var(--accent) 7%,#fff);color:var(--muted);font-size:11px;font-weight:600;white-space:nowrap;cursor:help;align-self:center}
#fm-root .gf-strip-h .gf-oran-cip b{color:var(--accent);font-weight:800;font-variant-numeric:tabular-nums}
/* === /PLAN15-F3-FE === */
`;
