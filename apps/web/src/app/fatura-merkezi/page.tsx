'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

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
  sync: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  checkSm: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>',
  filter: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></svg>',
  eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  plus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
  clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z"/></svg>',
};

const COLORS = [
  { c: 'lacivert', hex: '#1e3a8a' },
  { c: 'mavi', hex: '#2563eb' },
  { c: 'petrol', hex: '#0d9488' },
  { c: 'yesil', hex: '#15803d' },
  { c: 'mor', hex: '#5b5bd6' },
  { c: 'amber', hex: '#c2710c' },
  { c: 'slate', hex: '#475569' },
  { c: 'bordo', hex: '#b91c1c' },
];

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
function deriveDurum(doc: any): { k: string; t: string } {
  const hasCode = Array.isArray(doc.lines) && doc.lines.some((l: any) => l.accountCode);
  const vissue =
    doc.validationStatus === 'INVALID' ||
    doc.ocrData?.validationStatus === 'INVALID' ||
    (Array.isArray(doc.validationIssues) && doc.validationIssues.length > 0);
  if (doc.status === 'APPROVED') return { k: 'ok', t: 'Onaylandı' };
  if (!hasCode) return { k: 'miss', t: 'Eksik hesap kodu' };
  if (vissue) return { k: 'warn', t: 'İçerik çelişkisi' };
  return { k: 'ok', t: 'Muhasebeleştirilebilir' };
}
function taxpayerLabel(t: any): string {
  return t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.taxNumber || 'Mükellef';
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

/** Belge görüntüleme modalı — ekranda büyük gösterir (iframe). */
function DocModal() {
  const [doc, setDoc] = useState<{ url?: string; html?: string; mime?: string } | null>(null);
  useEffect(() => {
    const onView = (e: any) => setDoc(e.detail || null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDoc(null); };
    window.addEventListener('fm-view-doc', onView as any);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('fm-view-doc', onView as any); window.removeEventListener('keydown', onKey); };
  }, []);
  if (!doc) return null;
  const url = doc.url || '';
  const isImg = !doc.html && (
    (doc.mime || '').startsWith('image/') ||
    /^data:image\//i.test(url) ||
    /\.(jpe?g|jpe|jfif|png|gif|webp|bmp|tiff?|heic|heif|avif)(\?|#|$)/i.test(url)
  );
  return (
    <div className="docov" onClick={() => setDoc(null)}>
      <div className="docbox" onClick={(e) => e.stopPropagation()}>
        <div className="docbar">
          <b>Belge görüntüle</b>
          <div className="sp" />
          {url ? <a className="btn sm ghost" href={url} target="_blank" rel="noopener noreferrer">Yeni sekmede aç</a> : null}
          <button className="btn sm" onClick={() => setDoc(null)}>Kapat ✕</button>
        </div>
        {doc.html
          ? <iframe className="docframe" srcDoc={doc.html} title="Belge" sandbox="allow-same-origin" />
          : isImg
            ? <div className="docimgwrap"><img className="docimg" src={url} alt="Belge" /></div>
            : url
              ? <iframe className="docframe" src={url} title="Belge" />
              : <div className="empty">Belge yok</div>}
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
    else if (l.group === 'vergi') { kdv += amt; has = true; }
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

const TITLES: Record<string, string> = {
  faturalar: 'Belgeler · <b>Alış Faturaları</b>',
  satis: 'Belgeler · <b>Satış Faturaları</b>',
  kurallar: 'Kurulum · <b>Eşleştirme Kuralları</b>',
  muhasebe: 'Belgeler · <b>Muhasebeleştir &amp; Aktar</b>',
  aktarilanlar: 'Belgeler · <b>Aktarılanlar</b>',
  entegrator: 'Kurulum · <b>Entegratörler</b>',
  kdv: 'Kurulum · <b>KDV Raporu</b>',
  ayarlar: 'Kurulum · <b>Ayarlar</b>',
  mukellefler: 'Çalışma · <b>Mükellefler</b>',
  genel: '<b>Genel Bakış</b>',
};

/** Kontrollü onay kutusu */
function Check({ checked, onToggle }: { checked?: boolean; onToggle?: () => void }) {
  return (
    <span className={`cb${checked ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle?.(); }}>
      {checked ? <Ico html={I.checkSm} size={11} /> : null}
    </span>
  );
}

/** Belge listesi ortak sorgusu — aynı queryKey ekranlar arası cache paylaşır */
function useDocuments(taxpayerId: string, period: string) {
  return useQuery({
    queryKey: ['fm2', 'documents', taxpayerId, period],
    queryFn: () =>
      api
        .get('/fatura-muhasebelestirme/documents', {
          params: { taxpayerId: taxpayerId || undefined, period, limit: 300 },
        })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
  });
}

export default function FaturaMerkeziPage() {
  const [screen, setScreen] = useState('genel');
  const [accent, setAccent] = useState('yesil');
  const [taxpayerId, setTaxpayerId] = useState('');
  const nowP = new Date();
  const [period, setPeriod] = useState(`${nowP.getFullYear()}-${String(nowP.getMonth() + 1).padStart(2, '0')}`);

  const taxpayersQ = useQuery({
    queryKey: ['fm2', 'taxpayers'],
    queryFn: () =>
      api
        .get('/taxpayers', { params: { scope: 'directory', status: 'active' } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
  });
  const taxpayers: any[] = taxpayersQ.data || [];

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
      <div className={`nitem${screen === 'genel' ? ' on' : ''}`} onClick={() => go('genel')}><Ico html={I.grid} /> Genel Bakış</div>
      <div className={`nitem${screen === 'mukellefler' ? ' on' : ''}`} onClick={() => go('mukellefler')}><Ico html={I.users} /> Mükellefler</div>

      <div className="ncap">Belgeler</div>
      <div className={`nitem${screen === 'faturalar' || screen === 'satis' ? ' on' : ''}`} onClick={() => go('faturalar')}><Ico html={I.file} /> Gelen Faturalar</div>
      <div className={`nsub${screen === 'faturalar' ? ' on' : ''}`} onClick={() => go('faturalar')}><span className="d" /> Alış Faturaları</div>
      <div className={`nsub${screen === 'satis' ? ' on' : ''}`} onClick={() => go('satis')}><span className="d" /> Satış Faturaları</div>
      <div className={`nitem${screen === 'muhasebe' ? ' on' : ''}`} onClick={() => go('muhasebe')}><Ico html={I.ledger} /> Muhasebeleştir {badge(sum.pending)}</div>
      <div className={`nitem${screen === 'aktarilanlar' ? ' on' : ''}`} onClick={() => go('aktarilanlar')}><Ico html={I.check} /> Aktarılanlar {badge(sum.posted)}</div>

      <div className="ncap">Kurulum</div>
      <div className={`nitem${screen === 'kurallar' ? ' on' : ''}`} onClick={() => go('kurallar')}><Ico html={I.rules} /> Eşleştirme Kuralları</div>
      <div className={`nitem${screen === 'entegrator' ? ' on' : ''}`} onClick={() => go('entegrator')}><Ico html={I.plug} /> Entegratörler</div>
      <div className={`nitem${screen === 'kdv' ? ' on' : ''}`} onClick={() => go('kdv')}><Ico html={I.chart} /> KDV Raporu</div>
      <div className={`nitem${screen === 'ayarlar' ? ' on' : ''}`} onClick={() => go('ayarlar')}><Ico html={I.gear} /> Ayarlar</div>
    </nav>
  );

  return (
    <div id="fm-root" data-accent={accent}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <DocModal />
      <div className="app">
        <aside className="side">
          <div className="brand"><span className="lg">M</span><div><b>Fatura Merkezi</b><small>MOREN Müşavirlik</small></div></div>
          {nav}
        </aside>

        <div className="main">
          <div className="top">
            <div className="crumb" dangerouslySetInnerHTML={{ __html: TITLES[screen] || '' }} />
            <div className="sp" />
            <select className="fmsel" value={taxpayerId} onChange={(e) => setTaxpayerId(e.target.value)}>
              <option value="">Tüm mükellefler</option>
              {taxpayers.map((t) => (
                <option key={t.id} value={t.id}>{taxpayerLabel(t)}</option>
              ))}
            </select>
            <select className="fmsel" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periodOptions().map((p) => (
                <option key={p.v} value={p.v}>{p.l}</option>
              ))}
            </select>
            <div className="theme">
              <small>Renk</small>
              {COLORS.map((x) => (
                <span
                  key={x.c}
                  className={`tsw${accent === x.c ? ' on' : ''}`}
                  style={{ background: x.hex }}
                  title={x.c}
                  onClick={() => setAccent(x.c)}
                />
              ))}
            </div>
          </div>

          <div className="content">
            {(screen === 'faturalar' || screen === 'satis') && <ScreenFaturalar taxpayerId={taxpayerId} period={period} kind={screen === 'satis' ? 'SATIS' : 'ALIS'} />}
            {screen === 'mukellefler' && <ScreenMukellefler taxpayers={taxpayers} period={period} onOpen={(id) => { setTaxpayerId(id); setScreen('faturalar'); }} />}
            {screen === 'kurallar' && <ScreenKurallar taxpayerId={taxpayerId} period={period} />}
            {screen === 'muhasebe' && <ScreenMuhasebe taxpayerId={taxpayerId} period={period} isIsletme={String(taxpayers.find((t) => t.id === taxpayerId)?.defterTuru || '').toUpperCase() === 'ISLETME'} />}
            {screen === 'aktarilanlar' && <ScreenAktarilanlar taxpayerId={taxpayerId} period={period} />}
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
function ScreenFaturalar({ taxpayerId, period, kind = 'ALIS' }: { taxpayerId: string; period: string; kind?: 'ALIS' | 'SATIS' }) {
  const qc = useQueryClient();
  const docsQ = useDocuments(taxpayerId, period);
  const all: any[] = docsQ.data || [];
  const docs = all.filter((d) => (d.invoiceKind || 'ALIS') === kind);
  const [sel, setSel] = useState<Set<string>>(new Set());
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
  docs.forEach((d) => {
    const k = deriveDurum(d).k;
    if (k === 'miss') sayac.miss++;
    else if (k === 'warn') sayac.warn++;
    else sayac.ok++;
  });

  const fetchMut = useMutation({
    mutationFn: () =>
      api.post('/fatura-muhasebelestirme/integrations/fetch', {
        taxpayerId, direction: kind, donem: period,
      }),
    onSuccess: () => { toast.success('Belgeler entegratörden çekiliyor'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Çekilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // Geçici köprü: Mihsap "bekleyen evraklar"daki faturaları portala aktarır
  // (entegratör çekme tamamlanana kadar Mihsap'ı fatura kaynağı olarak kullanırız).
  const mihsapMut = useMutation({
    mutationFn: () =>
      api.post('/fatura-muhasebelestirme/import-from-mihsap', { taxpayerId, donem: period, faturaTuru: kind }),
    onSuccess: (r: any) => {
      const d = r?.data || {};
      const parts = [
        d.created != null ? `${d.created} yeni` : null,
        d.reprocessed ? `${d.reprocessed} güncellendi` : null,
        d.skipped ? `${d.skipped} atlandı` : null,
        d.failed ? `${d.failed} hata` : null,
      ].filter(Boolean);
      toast.success(`Mihsap'tan aktarıldı${parts.length ? ' · ' + parts.join(', ') : ''}. OCR arka planda işleniyor.`);
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error("Mihsap'tan aktarılamadı: " + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // Manuel belge yükleme (JPEG/PDF/XML/ZIP) — OCR arka planda işler
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadMut = useMutation({
    mutationFn: async (files: FileList) => {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      fd.append('taxpayerId', taxpayerId);
      fd.append('source', 'fatura-merkezi');
      fd.append('documentType', kind === 'SATIS' ? 'SATIS_FATURA' : 'ALIS_FATURA');
      fd.append('invoiceKind', kind);
      fd.append('period', period);
      return api.post('/fatura-muhasebelestirme/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: (r: any) => {
      const n = Array.isArray(r?.data) ? r.data.length : (r?.data?.count ?? r?.data?.created ?? null);
      toast.success(`Belge yüklendi${n != null ? ` · ${n}` : ''}. OCR arka planda işleniyor.`);
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Yüklenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const syncMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/documents/match-orphans', { period }),
    onSuccess: (r: any) => { toast.success(`Eşitlendi${r?.data?.matched != null ? ` · ${r.data.matched} belge bağlandı` : ''}`); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: () => toast.error('Eşitleme başarısız'),
  });
  const approveMut = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0;
      for (const id of ids) {
        try { await api.post(`/fatura-muhasebelestirme/documents/${id}/approve`); ok++; } catch { /* atla */ }
      }
      return ok;
    },
    onSuccess: (ok) => { toast.success(`${ok} belge muhasebeleştirildi`); setSel(new Set()); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: () => toast.error('Muhasebeleştirme başarısız'),
  });

  // Matrah/KDV kırılımı çıkmamış belgelere (ör. Mihsap'tan yalnız toplamı gelen satışlar) oranla fiş üret
  const [genRate, setGenRate] = useState('20');
  const genMut = useMutation({
    mutationFn: (ids: string[]) => api.post('/fatura-muhasebelestirme/documents/set-kdv-rate', { documentIds: ids, kdvOrani: Number(genRate) }),
    onSuccess: (r: any) => {
      const d = r?.data || {};
      toast.success(`${d.ok ?? 0} belgeye %${genRate} ile fiş oluşturuldu${d.skipped ? ` · ${d.skipped} atlandı (tutar yok)` : ''}`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Fiş oluşturulamadı: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const fisOlustur = () => { if (sel.size === 0) { toast.error('Önce belge seç'); return; } genMut.mutate([...sel]); };

  // AI ile oku — seçili faturaları Max-vision ile tek tek okur (KDV kırılımı otomatik); her belge ayrı çağrı (HTTP timeout olmaz)
  const [aiProg, setAiProg] = useState<{ done: number; total: number } | null>(null);
  const aiOku = async () => {
    const ids = [...sel];
    if (!ids.length) { toast.error('Önce belge seç'); return; }
    setAiProg({ done: 0, total: ids.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i++) {
      try { const r = await api.post('/fatura-muhasebelestirme/documents/ai-read', { documentId: ids[i] }); if (r?.data?.ok) ok++; else fail++; }
      catch { fail++; }
      setAiProg({ done: i + 1, total: ids.length });
    }
    setAiProg(null);
    setSel(new Set());
    toast.success(`AI okudu · ${ok} başarılı${fail ? `, ${fail} okunamadı` : ''}`);
    qc.invalidateQueries({ queryKey: ['fm2'] });
  };

  const muhasebelestir = () => {
    const hazir = docs.filter((d) => sel.has(d.id) && d.status !== 'APPROVED' && Array.isArray(d.lines) && d.lines.some((l: any) => l.accountCode));
    if (hazir.length === 0) {
      toast.error(sel.size === 0 ? 'Önce belge seç' : 'Seçilenlerin hesap kodu yok ya da zaten onaylı');
      return;
    }
    approveMut.mutate(hazir.map((d) => d.id));
  };

  return (
    <section className="screen">
      <div className="h2">{kind === 'SATIS' ? 'Satış Faturaları' : 'Alış Faturaları'}</div>
      <div className="sub">{kind === 'SATIS' ? 'Mükellefin kestiği satış faturaları — kuralla otomatik eşleşir.' : 'Entegratörden çekilen gelen faturalar — kuralla otomatik eşleşir, sadece eksik/çelişkili olana bakarsın.'}</div>
      <div className="card">
        <div className="ch">
          <h3>{docsQ.isLoading ? 'Yükleniyor…' : `${docs.length} belge`}</h3><div className="sp" />
          <button className="btn sm blue" disabled={!taxpayerId || mihsapMut.isPending} onClick={() => mihsapMut.mutate()} title={!taxpayerId ? 'Önce mükellef seç' : "Mihsap 'bekleyen evraklar'daki faturaları portala aktarır"}><Ico html={I.download} size={13} /> {mihsapMut.isPending ? 'Aktarılıyor…' : "Mihsap'tan Aktar"}</button>
          <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.jpe,.jfif,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif,.avif,.xml,.ubl,.zip" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files; if (f && f.length) uploadMut.mutate(f); e.target.value = ''; }} />
          <button className="btn sm" disabled={!taxpayerId || uploadMut.isPending} onClick={() => fileRef.current?.click()} title={!taxpayerId ? 'Önce mükellef seç' : 'JPEG / PDF / XML belge yükle (elle)'}><Ico html={I.plus} size={13} /> {uploadMut.isPending ? 'Yükleniyor…' : 'Belge Yükle'}</button>
          <button className="btn sm" disabled={!taxpayerId || fetchMut.isPending} onClick={() => fetchMut.mutate()} title={!taxpayerId ? 'Önce mükellef seç' : 'Entegratörden çek (henüz tamamlanmadı)'}><Ico html={I.download} size={13} /> {fetchMut.isPending ? 'Çekiliyor…' : 'Belgeleri Getir'}</button>
          <button className="btn sm ghost" disabled={syncMut.isPending} onClick={() => syncMut.mutate()}><Ico html={I.sync} size={13} /> {syncMut.isPending ? 'Eşitleniyor…' : 'Belgeleri Eşitle'}</button>
          <button className="btn sm blue" disabled={!!aiProg || sel.size === 0} onClick={aiOku} title="Seçili faturaları yapay zeka (Max) ile oku — KDV kırılımı otomatik çıkar, oran girmeye gerek yok">{aiProg ? `Okunuyor ${aiProg.done}/${aiProg.total}` : `AI ile oku${sel.size ? ` (${sel.size})` : ''}`}</button>
          <select className="fmsel" style={{ maxWidth: 108 }} value={genRate} onChange={(e) => setGenRate(e.target.value)} title="Fiş üretmek için KDV oranı">
            <option value="20">KDV %20</option>
            <option value="10">KDV %10</option>
            <option value="1">KDV %1</option>
            <option value="0">KDV %0</option>
          </select>
          <button className="btn sm" disabled={genMut.isPending || sel.size === 0} onClick={fisOlustur} title="Seçili belgelere KDV oranıyla fiş üret — matrah/KDV çıkmamış (eksik kod) olanlar için"><Ico html={I.checkSm} size={13} /> {genMut.isPending ? 'Üretiliyor…' : `Fiş oluştur${sel.size ? ` (${sel.size})` : ''}`}</button>
          <button className="btn sm primary" disabled={approveMut.isPending} onClick={muhasebelestir}><Ico html={I.checkSm} size={13} /> {approveMut.isPending ? 'İşleniyor…' : `Muhasebeleştir${sel.size ? ` (${sel.size})` : ''}`}</button>
        </div>
        <div className="twrap">
          <table>
            <thead><tr><th style={{ width: 30 }}><Check checked={allSelected} onToggle={toggleAll} /></th><th>Tarih</th><th>Fatura No</th><th>Firma Adı</th><th>Tip</th><th className="num">KDV Hariç</th><th className="num">KDV</th><th className="num">Tutar</th><th>Hesap Kodu</th><th>Durum</th><th className="actcol" style={{ width: 40 }} /></tr></thead>
            <tbody>
              {docs.map((d) => {
                const du = deriveDurum(d);
                const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
                const firma = (sat ? d.customerName : d.vendorName) || '—';
                const vkn = sat ? d.buyerVkn : d.sellerVkn;
                const code = (Array.isArray(d.lines) ? d.lines.find((l: any) => l.accountCode) : null)?.accountCode || '';
                const { matrah, kdv } = kdvParts(d);
                return (
                  <tr key={d.id}>
                    <td><Check checked={sel.has(d.id)} onToggle={() => toggle(d.id)} /></td>
                    <td>{fmtDate(d.faturaTarihi || d.createdAt)}</td>
                    <td>{d.belgeNo || '—'}</td>
                    <td className="firm"><b>{firma}</b><small>{vkn ? `VKN ${vkn}` : '—'}</small></td>
                    <td><span className={`pill ${sat ? 'satis' : 'alis'}`}>{sat ? 'Satış' : 'Alış'}</span></td>
                    <td className="num">{matrah != null ? fmtMoney(matrah) : '—'}</td>
                    <td className="num">{kdv != null ? fmtMoney(kdv) : '—'}</td>
                    <td className="num">{fmtMoney(d.totalAmount)}</td>
                    <td>{code ? <span className="hk">{code}</span> : <span className="hk no">— yok —</span>}</td>
                    <td><span className={`pill ${du.k}`}>{du.t}</span></td>
                    <td className="actcol"><span className="eye" onClick={() => openDocFile(d.id)}><Ico html={I.eye} size={15} /></span></td>
                  </tr>
                );
              })}
              {!docsQ.isLoading && docs.length === 0 && (
                <tr><td colSpan={11}><div className="empty">Bu dönemde {kind === 'SATIS' ? 'satış' : 'alış'} faturası yok. Üstten mükellef/dönem seç ya da entegratörden çek.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="foot">
          <div className="selinfo">{docs.length} belge · {sayac.ok} muhasebeleştirilebilir · {sayac.miss} eksik kod · {sayac.warn} çelişki</div>
          <div className="sp" />
          <div className="pg">İlk 300 kayıt <span className="pb act">1</span></div>
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: MÜKELLEFLER ===================== */
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
  const list = taxpayers
    .filter((t) => !q.trim() || taxpayerLabel(t).toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')))
    .map((t) => ({ t, s: byId.get(t.id) || {} }));

  return (
    <section className="screen">
      <div className="h2">Mükellefler</div>
      <div className="sub">Her mükellefin {period} dönemindeki fatura işleme durumu. Satıra tıkla → o mükellefin belgelerine geç.</div>
      <div className="card">
        <div className="ch"><h3>{list.length} mükellef</h3><div className="sp" /><input className="fmsel" style={{ maxWidth: 240 }} placeholder="Mükellef ara…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="twrap">
          <table>
            <thead><tr><th>Mükellef</th><th className="num">Bek. alış</th><th className="num">Bek. satış</th><th className="num">Onaylı</th><th className="num">Luca'ya</th><th className="num">Sorunlu</th><th style={{ width: 70 }} /></tr></thead>
            <tbody>
              {list.map(({ t, s }) => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}>
                  <td className="firm"><b>{taxpayerLabel(t)}</b><small>{t.taxNumber ? `VKN ${t.taxNumber}` : ''}</small></td>
                  <td className="num">{s.pendingAlis || 0}</td>
                  <td className="num">{s.pendingSatis || 0}</td>
                  <td className="num">{Number(s.approvedAlis || 0) + Number(s.approvedSatis || 0)}</td>
                  <td className="num">{s.postedToLuca || 0}</td>
                  <td className="num">{Number(s.hasIssue || 0) > 0 ? <span className="pill miss">{s.hasIssue}</span> : '0'}</td>
                  <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}>Aç</button></td>
                </tr>
              ))}
              {!sumQ.isLoading && list.length === 0 && (
                <tr><td colSpan={7}><div className="empty">Mükellef bulunamadı.</div></td></tr>
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
  const ruleMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/vendor-rule', { taxpayerId, vendorVkn: rVkn, vendorName: rName || undefined, accountCode: rCode }),
    onSuccess: (r: any) => {
      const n = r?.data?.applied;
      toast.success(`Kural kaydedildi${n != null ? ` · ${n} belgeye uygulandı` : ''}`);
      setRVkn(''); setRName(''); setRCode('');
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error('Kural kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
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
        <div className="ch"><h3>Kural ekle</h3><div className="sp" /><span className="mu">satıcı VKN → hesap kodu · o satıcının bekleyen + sonraki faturalarına otomatik uygulanır</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr auto', gap: 11, padding: '15px 16px', alignItems: 'end' }}>
          <div className="fld"><label>Satıcı VKN / TCKN</label><input value={rVkn} onChange={(e) => setRVkn(e.target.value)} placeholder="10–11 hane" /></div>
          <div className="fld"><label>Satıcı adı (opsiyonel)</label><input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="firma adı" /></div>
          <div className="fld"><label>Hesap kodu</label><input value={rCode} onChange={(e) => setRCode(e.target.value)} placeholder="örn. 153.01.001" /></div>
          <button className="btn primary sm" style={{ height: 35 }} disabled={!taxpayerId || ruleMut.isPending || !rVkn.trim() || !rCode.trim()} onClick={() => ruleMut.mutate()} title={!taxpayerId ? 'Önce üstten mükellef seç' : ''}><Ico html={I.plus} size={13} /> {ruleMut.isPending ? 'Kaydediliyor…' : 'Kaydet'}</button>
        </div>
        {!taxpayerId && <div className="empty" style={{ padding: '4px 16px 14px' }}>Kural mükellefe göre tanımlanır — önce üstten bir mükellef seç.</div>}
        <div className="lrow" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}><Ico html={I.info} size={15} /><span style={{ fontSize: 12 }}>Bu kural <b>tahmin değildir</b> — yalnız senin verdiğin kodu o satıcının faturalarına uygular. Belge onayladıkça da otomatik öğrenir.</span></div>
      </div>

      <div className="card">
        <div className="ch"><h3>Öğrenilen kurallar{taxpayerId ? '' : ' (tüm mükellefler)'}</h3><div className="sp" /><span className="mu">{rulesQ.isLoading ? 'yükleniyor…' : `${rules.length} satıcı`}</span></div>
        <div className="twrap">
          <table>
            <thead><tr><th>Satıcı / Alıcı</th><th>VKN</th><th>Öğrenilen hesap kodu</th><th className="num">Onay (belge)</th><th>Mükellef</th><th>Son kullanım</th></tr></thead>
            <tbody>
              {rules.map((r) => {
                const top = (r.decisions || []).filter((d: any) => d.kararTipi === 'fatura').sort((a: any, b: any) => (b.onayAdedi || 0) - (a.onayAdedi || 0))[0]
                  || (r.decisions || []).sort((a: any, b: any) => (b.onayAdedi || 0) - (a.onayAdedi || 0))[0];
                const muk = (r.mukellefler || []).map((m: any) => m.ad).slice(0, 2).join(', ');
                return (
                  <tr key={r.id}>
                    <td className="firm"><b>{r.firmaUnvan || '(unvan yok)'}</b></td>
                    <td>{r.firmaKimlikNo || '—'}</td>
                    <td>{top?.kategori ? <span className="hk">{top.kategori}</span> : <span className="hk no">—</span>}{top?.altKategori ? <small style={{ color: 'var(--faint)', marginLeft: 6 }}>{top.altKategori}</small> : null}</td>
                    <td className="num">{r.toplamOnay || 0}</td>
                    <td>{muk || <span className="mu">—</span>}</td>
                    <td>{fmtDate(r.sonKullanim)}</td>
                  </tr>
                );
              })}
              {!rulesQ.isLoading && rules.length === 0 && (
                <tr><td colSpan={6}><div className="empty">Henüz öğrenilmiş kural yok. Belge onayladıkça burası dolar.</div></td></tr>
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
                <div className="lx"><b>{firma}</b> — {du.k === 'miss' ? 'hesap kodu atanmamış, elle ya da öğrenmeyle atanmalı.' : 'içerik geçmişle çelişiyor, kontrol gerekiyor.'} <small style={{ color: 'var(--faint)' }}>{d.belgeNo ? `· ${d.belgeNo}` : ''} · {fmtMoney(d.totalAmount)} ₺</small></div>
                {!sat && d.sellerVkn ? <button className="btn sm primary" onClick={() => { setRVkn(String(d.sellerVkn).replace(/\D/g, '')); setRName(d.vendorName || ''); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Kod ata</button> : null}
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
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let alive = true;
    setD(null);
    setZoom(1);
    api.get(`/fatura-muhasebelestirme/documents/${id}/file-url`)
      .then((r) => { if (alive) setD(r.data || {}); })
      .catch(() => { if (alive) setD({}); });
    return () => { alive = false; };
  }, [id]);
  if (!d) return <div className="belgebox"><div className="bpempty">Belge yükleniyor…</div></div>;
  const url = typeof d.url === 'string' ? d.url : typeof d.fileUrl === 'string' ? d.fileUrl : '';
  const html = typeof d.inlineHtml === 'string' ? d.inlineHtml : '';
  const isImg = !html && (
    (d.mimeType || '').startsWith('image/') ||
    /^data:image\//i.test(url) ||
    /\.(jpe?g|jpe|jfif|png|gif|webp|bmp|tiff?|heic|heif|avif)(\?|#|$)/i.test(url)
  );
  const dz = (f: number) => setZoom((s) => Math.min(6, Math.max(0.4, Math.round((s + f) * 100) / 100)));
  return (
    <div className="belgebox">
      <div className="bpbar">
        <span>Belge</span>
        <div className="bpzoom">
          {isImg ? (
            <>
              <button type="button" onClick={() => dz(-0.25)} title="Uzaklaştır">−</button>
              <span className="bpz">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => dz(0.25)} title="Yakınlaştır">+</button>
              <button type="button" onClick={() => setZoom(1)} title="Genişliğe sığdır">Sığdır</button>
            </>
          ) : null}
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" title="Yeni sekmede aç">↗</a> : null}
        </div>
      </div>
      {html
        ? <iframe className="bpframe" srcDoc={html} title="Belge" sandbox="allow-same-origin" />
        : isImg
          ? <div className="bpimgwrap"><img className="bpimg" src={url} alt="Belge" style={{ width: `${zoom * 100}%`, maxWidth: zoom > 1 ? 'none' : '100%' }} /></div>
          : url
            ? <iframe className="bpframe" src={url} title="Belge" />
            : <div className="bpempty">Belge görüntüsü yok</div>}
    </div>
  );
}

/* ===================== EKRAN: MUHASEBELEŞTİR ===================== */
function ScreenMuhasebe({ taxpayerId, period, isIsletme = false }: { taxpayerId: string; period: string; isIsletme?: boolean }) {
  const qc = useQueryClient();
  const docsQ = useDocuments(taxpayerId, period);
  const all: any[] = docsQ.data || [];
  const hasCode = (d: any) => Array.isArray(d.lines) && d.lines.some((l: any) => l.accountCode);
  const hasAmount = (d: any) => { const p = kdvParts(d); return (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || Number(d.totalAmount) > 0; };
  // İşletme defterinde hesap kodu yok — hazır olma şartı belgenin tutarının olması.
  const ready = (d: any) => (isIsletme ? hasAmount(d) : hasCode(d));
  const hazir = all.filter((d) => d.status !== 'APPROVED' && ready(d));
  const eksik = all.filter((d) => d.status !== 'APPROVED' && !ready(d));

  const [selId, setSelId] = useState<string>('');
  const selDoc = [...hazir, ...eksik].find((d) => d.id === selId) || hazir[0] || eksik[0];

  // Belge bilgileri elle düzenleme (tarih/tür/belge türü/belge no/VKN) — PATCH ile kaydeder.
  const [meta, setMeta] = useState<any>({});
  useEffect(() => {
    const d = selDoc;
    setMeta(d ? {
      faturaTarihi: d.faturaTarihi ? String(d.faturaTarihi).slice(0, 10) : '',
      invoiceKind: String(d.invoiceKind || 'ALIS').includes('SATIS') ? 'SATIS' : 'ALIS',
      documentType: d.documentType || '',
      belgeNo: d.belgeNo || '',
      vkn: (String(d.invoiceKind || '').includes('SATIS') ? d.buyerVkn : d.sellerVkn) || '',
    } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDoc?.id]);
  const saveMetaMut = useMutation({
    mutationFn: () => {
      const isSale = String(meta.invoiceKind).includes('SATIS');
      return api.patch(`/fatura-muhasebelestirme/documents/${selDoc.id}`, {
        faturaTarihi: meta.faturaTarihi || undefined,
        invoiceKind: meta.invoiceKind,
        documentType: meta.documentType || undefined,
        belgeNo: meta.belgeNo || undefined,
        ...(isSale ? { buyerVkn: meta.vkn || undefined } : { sellerVkn: meta.vkn || undefined }),
      });
    },
    onSuccess: () => { toast.success('Belge bilgileri kaydedildi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  // Fiş satırları elle düzenleme (hesap kodu / borç / alacak) — PATCH lines ile kaydeder.
  const [lineDraft, setLineDraft] = useState<any[]>([]);
  useEffect(() => {
    setLineDraft((selDoc?.lines || []).map((l: any) => ({
      group: l.group, accountCode: l.accountCode || '', description: l.description || '',
      rate: l.rate || '', debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selDoc?.id]);
  const lines: any[] = lineDraft;
  const setLine = (i: number, k: string, v: any) => setLineDraft((arr) => arr.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const borc = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  const alacak = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
  const dengeli = lines.length > 0 && Math.abs(borc - alacak) < 0.01;
  const saveLinesMut = useMutation({
    mutationFn: () => api.patch(`/fatura-muhasebelestirme/documents/${selDoc.id}`, {
      lines: lineDraft.map((l) => ({ group: l.group || 'matrah', accountCode: l.accountCode || null, description: l.description || null, rate: l.rate || null, debit: String(l.debit || 0), credit: String(l.credit || 0) })),
    }),
    onSuccess: () => { toast.success('Fiş satırları kaydedildi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const gg = selDoc ? kdvParts(selDoc) : { matrah: null, kdv: null };
  const ggReady = isIsletme ? ((Number(gg.matrah) || 0) > 0 || (Number(gg.kdv) || 0) > 0 || Number(selDoc?.totalAmount) > 0) : dengeli;

  // Gerçek hesap kodunu elle ver — o satıcının tüm faturalarına uygulanır + öğrenilir (770 tahmini yerine)
  const [codeInput, setCodeInput] = useState('');
  const selVkn = String(selDoc?.sellerVkn || '').replace(/\D/g, '');
  const codeMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/vendor-rule', { taxpayerId, vendorVkn: selVkn, vendorName: selDoc?.vendorName || undefined, accountCode: codeInput }),
    onSuccess: (r: any) => { const n = r?.data?.applied; toast.success(`Kod uygulandı${n != null ? ` · ${n} belgeye` : ''} ve öğrenildi`); setCodeInput(''); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Kod uygulanamadı: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });

  // Talimat (gece otomatik) — entegratör kayıtlarından türetilir
  const intQ = useQuery({
    queryKey: ['fm2', 'integrations', taxpayerId],
    queryFn: () =>
      api.get('/fatura-muhasebelestirme/integrations', { params: { taxpayerId: taxpayerId || undefined } })
        .then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
    enabled: !!taxpayerId,
  });
  const configured: any[] = (intQ.data || []).filter((x: any) => x.configured);
  const talimatliVar = configured.some((c: any) => c.talimat);
  const talimatMut = useMutation({
    mutationFn: async (active: boolean) => {
      for (const c of configured) {
        try { await api.post('/fatura-muhasebelestirme/integrations/talimat', { taxpayerId: taxpayerId || undefined, provider: c.provider, active }); } catch { /* atla */ }
      }
    },
    onSuccess: (_d, active) => { toast.success(active ? 'Gece otomatik çekim açıldı' : 'Gece otomatik çekim kapatıldı'); qc.invalidateQueries({ queryKey: ['fm2', 'integrations'] }); },
    onError: () => toast.error('Talimat güncellenemedi'),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/approve`),
    onSuccess: () => { toast.success('Onaylandı — Luca kuyruğuna alındı'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Onay başarısız: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const bulkMut = useMutation({
    mutationFn: async () => {
      let ok = 0;
      for (const d of hazir) {
        try { await api.post(`/fatura-muhasebelestirme/documents/${d.id}/approve`); ok++; } catch { /* tek tek atla */ }
      }
      return ok;
    },
    onSuccess: (ok) => { toast.success(`${ok} belge fişlendi — Luca kuyruğuna alındı`); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: () => toast.error('Toplu fişleme başarısız'),
  });

  // v2.3: Onaylı (QUEUED/FAILED) belgeleri tek toplu işle Luca'ya GÖNDER.
  // approve sadece kuyruğa alır; gerçek aktarım bu butonla (batch-post-to-luca) tetiklenir.
  const queuedDocs = all.filter((d: any) => d.status === 'APPROVED' && ['QUEUED', 'FAILED', 'NOT_STARTED'].includes(d.lucaStatus));
  const batchMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/batch-post-to-luca', { taxpayerId, period }),
    onSuccess: (r: any) => {
      const d = r?.data || {};
      toast.success(`Luca'ya aktarım başlatıldı · ${d.documentCount ?? 0} belge${d.skippedInvalid ? ` · ${d.skippedInvalid} veri hatası nedeniyle hariç` : ''}. Ajan açıkken işlenir.`);
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error("Luca'ya aktarılamadı: " + (e?.response?.data?.message || e?.message || 'hata')),
  });

  if (!taxpayerId) {
    return (
      <section className="screen">
        <div className="h2">Muhasebeleştir &amp; Aktar</div>
        <div className="sub">Önce üstten bir mükellef seç.</div>
        <div className="card"><div className="empty">Mükellef seçilmedi.</div></div>
      </section>
    );
  }

  const firmaOf = (d: any) => (d.invoiceKind === 'SATIS' ? d.customerName : d.vendorName) || '—';

  return (
    <section className="screen">
      <div className="h2">Muhasebeleştir &amp; Aktar</div>
      <div className="sub">Taslak fiş → denge kontrolü → onayla → Luca'ya aktar (elle ya da gece otomatik).</div>
      <div className="card" style={{ padding: 0 }}>
        <div className="wmain">
            {selDoc ? (
              <>
                <div className="banner info"><Ico html={I.info} size={16} /><span>Bilanço usulü mükellefte <b>muhasebe fişi</b> kesilir. İşletme defteri mükellefte bu ekran <b>Gelir-Gider girişi</b>ne döner (KDV/gider, hesap kodu yok).</span></div>
                <div className="fiseditor">
                <div className="belgepane"><InlineBelge id={selDoc.id} /></div>
                <div className="fispane">
                <div className="ph">{firmaOf(selDoc)} · {selDoc.invoiceKind === 'SATIS' ? 'Satış' : 'Alış'} faturası <span className="mu">{selDoc.belgeNo || ''}</span></div>
                <div className="docmeta">
                  <div className="dm"><span className="dml">Tarih</span><input className="dmi" type="date" value={meta.faturaTarihi || ''} onChange={(e) => setMeta({ ...meta, faturaTarihi: e.target.value })} /></div>
                  <div className="dm"><span className="dml">Fatura Türü</span>
                    <select className="dmi" value={meta.invoiceKind || 'ALIS'} onChange={(e) => setMeta({ ...meta, invoiceKind: e.target.value })}>
                      <option value="ALIS">Alış</option>
                      <option value="SATIS">Satış</option>
                    </select>
                  </div>
                  <div className="dm"><span className="dml">Belge Türü</span>
                    <select className="dmi" value={meta.documentType || ''} onChange={(e) => setMeta({ ...meta, documentType: e.target.value })}>
                      <option value="">—</option>
                      <option value="E_FATURA">e-Fatura</option>
                      <option value="E_ARSIV">e-Arşiv</option>
                      <option value="OKC_FIS">ÖKC Fiş</option>
                      <option value="DIGER">Diğer</option>
                    </select>
                  </div>
                  <div className="dm"><span className="dml">Belge No</span><input className="dmi" value={meta.belgeNo || ''} onChange={(e) => setMeta({ ...meta, belgeNo: e.target.value })} /></div>
                  <div className="dm"><span className="dml">{String(meta.invoiceKind).includes('SATIS') ? 'Alıcı VKN' : 'Satıcı VKN'}</span><input className="dmi" value={meta.vkn || ''} onChange={(e) => setMeta({ ...meta, vkn: e.target.value })} /></div>
                  <div className="dm" style={{ alignSelf: 'end' }}><button className="btn sm primary" disabled={saveMetaMut.isPending} onClick={() => saveMetaMut.mutate()}>{saveMetaMut.isPending ? 'Kaydediliyor…' : 'Bilgileri kaydet'}</button></div>
                </div>
                <div className="twrap">
                  {isIsletme ? (
                    <table>
                      <thead><tr><th>Açıklama</th><th className="num">Matrah (KDV hariç)</th><th className="num">KDV</th></tr></thead>
                      <tbody>
                        <tr>
                          <td>{selDoc.invoiceKind === 'SATIS' ? 'Gelir (satış)' : 'Gider (alış)'} — {firmaOf(selDoc)}</td>
                          <td className="num">{gg.matrah != null ? fmtMoney(gg.matrah) : '—'}</td>
                          <td className="num">{gg.kdv != null ? fmtMoney(gg.kdv) : '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <table>
                      <thead><tr><th>Hesap</th><th>Açıklama</th><th className="num">Borç</th><th className="num">Alacak</th></tr></thead>
                      <tbody>
                        {lines.map((l: any, i: number) => (
                          <tr key={i}>
                            <td><input className="li licode" value={l.accountCode || ''} placeholder="hesap kodu" onChange={(e) => setLine(i, 'accountCode', e.target.value)} /></td>
                            <td>{l.description || l.group}</td>
                            <td className="num"><input className="li linum" type="number" step="0.01" value={l.debit || ''} placeholder="0,00" onChange={(e) => setLine(i, 'debit', e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                            <td className="num"><input className="li linum" type="number" step="0.01" value={l.credit || ''} placeholder="0,00" onChange={(e) => setLine(i, 'credit', e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                          </tr>
                        ))}
                        {lines.length === 0 && <tr><td colSpan={4}><div className="empty">Bu belgede fiş satırı yok.</div></td></tr>}
                      </tbody>
                    </table>
                  )}
                </div>
                {isIsletme ? (
                  <div className="balance">
                    <Ico html={I.checkSm} size={16} /><b>Gelir-Gider girişi</b>
                    <span className="bnote">{selDoc.invoiceKind === 'SATIS' ? 'Gelir' : 'Gider'} {fmtMoney(gg.matrah || 0)} ₺ + KDV {fmtMoney(gg.kdv || 0)} ₺ · hesap kodu yok</span>
                  </div>
                ) : (
                  <div className="balance" style={!dengeli ? { background: '#fdeaea', borderColor: '#f3c9c9' } : undefined}>
                    <Ico html={I.checkSm} size={16} /><b style={!dengeli ? { color: '#c0353a' } : undefined}>{dengeli ? 'Denge tamam' : 'Denge tutmuyor'}</b>
                    <span className="bnote">Borç {fmtMoney(borc)} {dengeli ? '=' : '≠'} Alacak {fmtMoney(alacak)} ₺</span>
                  </div>
                )}
                {!isIsletme && selDoc.invoiceKind !== 'SATIS' && selVkn ? (
                  <div className="balance" style={{ background: '#fbfcfd', borderColor: 'var(--line)', flexWrap: 'wrap' }}>
                    <Ico html={I.rules} size={15} /><b>Gerçek hesap kodu</b>
                    <input className="fmsel" style={{ maxWidth: 150 }} placeholder="örn. 153.01.001" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
                    <button className="btn primary sm" disabled={codeMut.isPending || !codeInput.trim()} onClick={() => codeMut.mutate()}>{codeMut.isPending ? 'Uygulanıyor…' : 'Uygula & öğren'}</button>
                    <span className="bnote" style={{ flexBasis: '100%', marginTop: 4 }}>770 tahmini default — bu satıcının gerçek kodunu gir; o satıcının bu mükellefteki tüm faturalarına uygulanır ve öğrenilir (sonrakiler otomatik alır).</span>
                  </div>
                ) : null}
                <div className="wactions">
                  <div className="sp" />
                  {!isIsletme && <button className="btn sm" disabled={saveLinesMut.isPending || lines.length === 0} onClick={() => saveLinesMut.mutate()} title="Hesap kodu / borç / alacak değişikliklerini kaydet"><Ico html={I.checkSm} size={13} /> {saveLinesMut.isPending ? 'Kaydediliyor…' : 'Satırları kaydet'}</button>}
                  <button className="btn primary sm" disabled={approveMut.isPending || !ggReady} onClick={() => selDoc && approveMut.mutate(selDoc.id)}>
                    <Ico html={I.checkSm} size={13} /> {approveMut.isPending ? 'Gönderiliyor…' : "Onayla & Luca'ya gönder"}
                  </button>
                </div>
                </div></div>
              </>
            ) : (
              <div className="empty">Hazır belge yok ya da soldan bir belge seç.</div>
            )}
          </div>
        <div className="wstrip">
          {[...hazir.map((d: any) => ({ d, ready: true })), ...eksik.slice(0, 40).map((d: any) => ({ d, ready: false }))].map(({ d, ready }) => {
            const code = (Array.isArray(d.lines) ? d.lines.find((l: any) => l.accountCode) : null)?.accountCode || '';
            return (
              <div key={d.id} className={`wchip${selDoc?.id === d.id ? ' on' : ''}${ready ? '' : ' miss'}`} onClick={() => setSelId(d.id)} title={firmaOf(d)}>
                <b>{firmaOf(d)}</b>
                <small>{fmtMoney(d.totalAmount)} ₺ · {isIsletme ? 'G/G' : (ready ? (code || '—') : 'kod yok')}</small>
              </div>
            );
          })}
          {hazir.length === 0 && eksik.length === 0 && <div className="empty" style={{ padding: 14 }}>Belge yok.</div>}
        </div>
        <div className="auto">
          <Ico html={I.clock} size={20} />
          <div><div className="at">Gece otomatik çekim</div><div className="as">Entegratörden faturalar her gece otomatik çekilsin — sen girmeden hazır olsun.</div></div>
          <div className="seg autoseg">
            <button className={!talimatliVar ? 'on' : ''} disabled={talimatMut.isPending || configured.length === 0} onClick={() => talimatMut.mutate(false)}>Kapalı</button>
            <button className={talimatliVar ? 'on' : ''} disabled={talimatMut.isPending || configured.length === 0} onClick={() => talimatMut.mutate(true)}>Açık (her gece)</button>
          </div>
          <button className="btn sm" disabled={bulkMut.isPending || hazir.length === 0} onClick={() => bulkMut.mutate()}>
            <Ico html={I.checkSm} size={13} /> {bulkMut.isPending ? 'Fişleniyor…' : `${hazir.length} belgeyi toplu fişle`}
          </button>
          <button className="btn primary sm" disabled={batchMut.isPending || queuedDocs.length === 0} onClick={() => batchMut.mutate()} title={queuedDocs.length === 0 ? 'Önce belgeleri fişle (onayla)' : "Onaylı belgeleri Luca'ya aktar"}>
            <Ico html={I.send} size={13} /> {batchMut.isPending ? 'Aktarılıyor…' : `Luca'ya Aktar${queuedDocs.length ? ` (${queuedDocs.length})` : ''}`}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: AKTARILANLAR ===================== */
function ScreenAktarilanlar({ taxpayerId, period }: { taxpayerId: string; period: string }) {
  const qc = useQueryClient();
  const docsQ = useDocuments(taxpayerId, period);
  const all: any[] = docsQ.data || [];
  const docs = all.filter((d) => d.status === 'APPROVED' || d.lucaStatus === 'POSTED' || d.lucaStatus === 'QUEUED' || d.lucaStatus === 'POSTING' || d.lucaStatus === 'FAILED');
  const retryMut = useMutation({
    mutationFn: (id: string) => api.post(`/fatura-muhasebelestirme/documents/${id}/retry-luca`),
    onSuccess: () => { toast.success("Luca'ya yeniden gönderildi"); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Tekrar denenemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const lucaPill = (d: any) => {
    const s = d.lucaStatus;
    if (s === 'POSTED') return <span className="pill ok">Luca'da</span>;
    if (s === 'POSTING') return <span className="pill warn">Aktarılıyor…</span>;
    if (s === 'QUEUED') return <span className="pill warn">Kuyrukta</span>;
    if (s === 'FAILED' || s === 'ERROR') return <span className="pill miss" title={d.lucaErrorMessage || ''}>Hata</span>;
    return <span className="pill n">Onaylı</span>;
  };

  return (
    <section className="screen">
      <div className="h2">Aktarılanlar</div>
      <div className="sub">Onaylanıp Luca'ya gönderilen / kuyruğa alınan belgeler — {period}.</div>
      <div className="card">
        <div className="ch"><h3>{docsQ.isLoading ? 'Yükleniyor…' : `${docs.length} belge`}</h3></div>
        <div className="twrap">
          <table>
            <thead><tr><th>Tarih</th><th>Fatura No</th><th>Firma</th><th>Tip</th><th className="num">Tutar</th><th>Hesap Kodu</th><th>Luca Durumu</th><th className="actcol" style={{ width: 40 }} /></tr></thead>
            <tbody>
              {docs.map((d) => {
                const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
                const firma = (sat ? d.customerName : d.vendorName) || '—';
                const code = (Array.isArray(d.lines) ? d.lines.find((l: any) => l.accountCode) : null)?.accountCode || '';
                return (
                  <tr key={d.id}>
                    <td>{fmtDate(d.faturaTarihi || d.createdAt)}</td>
                    <td>{d.belgeNo || '—'}</td>
                    <td className="firm"><b>{firma}</b></td>
                    <td><span className={`pill ${sat ? 'satis' : 'alis'}`}>{sat ? 'Satış' : 'Alış'}</span></td>
                    <td className="num">{fmtMoney(d.totalAmount)}</td>
                    <td>{code ? <span className="hk">{code}</span> : <span className="hk no">—</span>}</td>
                    <td>{lucaPill(d)}</td>
                    <td className="actcol" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {(d.lucaStatus === 'FAILED' || d.lucaStatus === 'ERROR') && (
                        <button className="btn ghost sm" disabled={retryMut.isPending} onClick={() => retryMut.mutate(d.id)} title={d.lucaErrorMessage || "Luca'ya tekrar gönder"}><Ico html={I.sync} size={12} /></button>
                      )}
                      <span className="eye" onClick={() => openDocFile(d.id)}><Ico html={I.eye} size={15} /></span>
                    </td>
                  </tr>
                );
              })}
              {!docsQ.isLoading && docs.length === 0 && (
                <tr><td colSpan={8}><div className="empty">Bu dönemde aktarılan belge yok.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: ENTEGRATÖRLER ===================== */
const PROVIDER_OPTS = [
  { v: 'PARASUT', l: 'Paraşüt' },
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
  const isParasut = provider === 'PARASUT';

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
      toast.success('Entegratör kaydedildi');
      qc.invalidateQueries({ queryKey: ['fm2', 'integrations'] });
      setUsername(''); setPassword(''); setApiKey(''); setApiSecret(''); setAccountId('');
    },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const fetchMut = useMutation({
    mutationFn: (prov: string) =>
      api.post('/fatura-muhasebelestirme/integrations/fetch', { taxpayerId: taxpayerId || undefined, providers: [prov], direction: 'ALIS', donem: period }),
    onSuccess: () => { toast.success('Sorgu başlatıldı'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
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
                    <button className="btn ghost sm" disabled={delMut.isPending} onClick={() => { if (window.confirm(`${c.label || c.provider} kaldırılsın mı?`)) delMut.mutate(c.provider); }}>Kaldır</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <div className="ph" style={{ marginBottom: 10 }}>Yeni entegratör ekle</div>
            <div className="eform">
              <div className="erw">
                <div className="fld"><label>Entegratör</label>
                  <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {PROVIDER_OPTS.map((p) => (<option key={p.v} value={p.v}>{p.l}</option>))}
                  </select>
                </div>
                <div className="fld"><label>client_id {isParasut ? '' : '(varsa)'}</label><input autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isParasut ? 'Paraşüt destekten alınan' : '—'} /></div>
              </div>
              <div className="erw">
                <div className="fld"><label>client_secret</label><input type="password" autoComplete="new-password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="••••••••" /></div>
                <div className="fld"><label>{isParasut ? 'Firma No' : 'Hesap / Firma No'}</label><input autoComplete="off" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder={isParasut ? "Paraşüt URL'deki rakam" : '—'} /></div>
              </div>
              <div className="erw">
                <div className="fld"><label>Kullanıcı adı</label><input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="mükellefin giriş kullanıcısı" /></div>
                <div className="fld"><label>Şifre</label><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></div>
              </div>
              <div className="erw">
                <div className="fld" /><div className="fld endcol">
                  <button className="btn primary" style={{ height: 35 }} disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                    <Ico html={I.checkSm} size={13} /> {saveMut.isPending ? 'Kaydediliyor…' : 'Kaydet'}
                  </button>
                </div>
              </div>
            </div>
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
      <div className="h2">KDV Raporu</div>
      <div className="sub">{rep?.taxpayer?.name || ''} · {rep?.periodLabel || period} — fatura kayıtlarına göre (beyan öncesi taslak).</div>

      {repQ.isLoading ? (
        <div className="card"><div className="empty">Yükleniyor…</div></div>
      ) : !rep ? (
        <div className="card"><div className="empty">Bu dönem için veri bulunamadı.</div></div>
      ) : (
        <>
          <div className="mgrid">
            <div className="mcard"><div className="ml">Hesaplanan KDV (satış)</div><div className="mv">{fmtMoney(t.calculatedVat)}</div></div>
            <div className="mcard"><div className="ml">İndirilecek KDV (alış)</div><div className="mv">{fmtMoney(t.deductibleVat)}</div></div>
            <div className="mcard"><div className="ml">Dönem KDV farkı</div><div className="mv" style={{ color: Number(t.periodVatDifference) >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(t.periodVatDifference)}</div></div>
            <div className="mcard"><div className="ml">Belge sayısı</div><div className="mv">{rep?.quality?.invoiceCount ?? '—'}</div></div>
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
                        <td className="num">%{v.rate ?? 0}</td>
                        <td className="num">{fmtMoney(v.base)}</td>
                        <td className="num">{fmtMoney(v.vat)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
      api.get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, q: q || undefined, limit: 400 } })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() => []),
    enabled: !!taxpayerId,
  });
  const accounts: any[] = planQ.data || [];
  const localCount = accounts.filter((a) => a.local && !a.syncedToLuca).length;

  const refreshMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/account-plan/refresh', { taxpayerId }),
    onSuccess: () => { toast.success('Hesap planı yenileme Luca kuyruğuna alındı'); qc.invalidateQueries({ queryKey: ['fm2', 'account-plan'] }); },
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
        <div className="h2">Ayarlar</div>
        <div className="sub">Hesap planı mükellefe göre yönetilir — önce üstten bir mükellef seç.</div>
        <div className="card"><div className="empty">Mükellef seçilmedi.</div></div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="h2">Ayarlar</div>
      <div className="sub">Mükellefin hesap planı — Luca'dan çekilir, yerel açılan hesaplar Luca'ya gönderilebilir.</div>
      <div className="card">
        <div className="ch">
          <h3>Hesap Planı</h3>
          <div className="sp" />
          <input className="fmsel" style={{ maxWidth: 220 }} placeholder="Kod / ad ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm ghost" disabled={refreshMut.isPending} onClick={() => refreshMut.mutate()}><Ico html={I.sync} size={13} /> {refreshMut.isPending ? 'Yenileniyor…' : "Luca'dan yenile"}</button>
          <button className="btn sm primary" disabled={pushMut.isPending || localCount === 0} onClick={() => pushMut.mutate()} title={localCount === 0 ? 'Gönderilecek yerel hesap yok' : ''}><Ico html={I.send} size={13} /> {pushMut.isPending ? 'Gönderiliyor…' : `Yerelleri gönder${localCount ? ` (${localCount})` : ''}`}</button>
        </div>
        <div className="twrap">
          <table>
            <thead><tr><th>Kod</th><th>Hesap Adı</th><th className="num">Borç Bakiye</th><th className="num">Alacak Bakiye</th><th>Durum</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id || a.code}>
                  <td><span className="hk">{a.code}</span></td>
                  <td>{a.name || '—'}</td>
                  <td className="num">{a.debitBalance ? fmtMoney(a.debitBalance) : '—'}</td>
                  <td className="num">{a.creditBalance ? fmtMoney(a.creditBalance) : '—'}</td>
                  <td>{a.local && !a.syncedToLuca ? <span className="pill warn">yerel · gönderilmedi</span> : <span className="pill ok">Luca'da</span>}</td>
                </tr>
              ))}
              {!planQ.isLoading && accounts.length === 0 && (
                <tr><td colSpan={5}><div className="empty">Hesap planı yok. "Luca'dan yenile" ile çek.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: GENEL BAKIŞ ===================== */
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
  const nameOf = (id: string) => {
    const t = taxpayers.find((x) => x.id === id);
    return t ? taxpayerLabel(t) : id;
  };
  const pendingOf = (r: any) => Number(r.pendingAlis || 0) + Number(r.pendingSatis || 0);
  const tot = rows.reduce(
    (a, r) => ({
      pending: a.pending + pendingOf(r),
      posted: a.posted + Number(r.postedToLuca || 0),
      issue: a.issue + Number(r.hasIssue || 0),
    }),
    { pending: 0, posted: 0, issue: 0 },
  );
  // Genel Bakış = ÖZET + sadece DİKKAT GEREKTİREN (bekleyen ya da sorunlu) mükellefler,
  // önceliğe göre sıralı. Tüm mükellef listesi + arama için ayrı "Mükellefler" ekranı var.
  const attention = rows
    .filter((r) => pendingOf(r) > 0 || Number(r.hasIssue || 0) > 0)
    .sort((a, b) => (Number(b.hasIssue || 0) - Number(a.hasIssue || 0)) || (pendingOf(b) - pendingOf(a)));
  return (
    <section className="screen">
      <div className="h2">Genel Bakış</div>
      <div className="sub" dangerouslySetInnerHTML={{ __html: `${period} döneminin özeti ve dikkat gerektiren mükellefler. Tüm mükellef listesi ve arama için sol menüden <b>Mükellefler</b>'e geç.` }} />
      <div className="mgrid">
        <div className="mcard"><div className="ml">Bekleyen belge</div><div className="mv">{tot.pending}</div></div>
        <div className="mcard"><div className="ml">Luca'ya aktarılan</div><div className="mv">{tot.posted}</div></div>
        <div className="mcard"><div className="ml">Sorunlu (kontrol)</div><div className="mv">{tot.issue}</div></div>
        <div className="mcard"><div className="ml">Dikkat gereken mükellef</div><div className="mv">{attention.length}</div></div>
      </div>
      <div className="card">
        <div className="ch"><h3>Dikkat gerektirenler</h3><div className="sp" /><span className="mu">bekleyen ya da sorunlu olanlar</span></div>
        <div className="twrap">
          <table>
            <thead><tr><th>Mükellef</th><th className="num">Bek. alış</th><th className="num">Bek. satış</th><th className="num">Sorunlu</th><th className="num">Luca'ya</th><th className="actcol" style={{ width: 60 }} /></tr></thead>
            <tbody>
              {attention.map((r) => (
                <tr key={r.taxpayerId} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.taxpayerId)}>
                  <td className="firm"><b>{nameOf(r.taxpayerId)}</b></td>
                  <td className="num">{r.pendingAlis || 0}</td>
                  <td className="num">{r.pendingSatis || 0}</td>
                  <td className="num">{Number(r.hasIssue || 0) > 0 ? <span className="pill miss">{r.hasIssue}</span> : '0'}</td>
                  <td className="num">{r.postedToLuca || 0}</td>
                  <td className="actcol"><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(r.taxpayerId); }}>Aç</button></td>
                </tr>
              ))}
              {!sumQ.isLoading && attention.length === 0 && (
                <tr><td colSpan={6}><div className="empty">Bu dönemde bekleyen ya da sorunlu mükellef yok — her şey güncel. 🎉</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ===================== CSS (#fm-root scope) ===================== */
const CSS = `
#fm-root{--bg:#f4f6f5;--side:#fff;--line:#ebedf2;--line2:#e0e3ea;--text:#1f2937;--muted:#6b7280;--faint:#9aa3b2;--accent:#15803d;--accent-soft:#e7f4ec;--accent-line:#c2e6cf;--th:#edf6f0;--th-text:#166534;--blue:#2563eb;--red:#e5484d;--green:#16a34a;--amber:#d97706;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;font-size:13.5px;line-height:1.5;color:var(--text)}
#fm-root[data-accent="yesil"]{--accent:#15803d;--accent-soft:#e7f4ec;--accent-line:#c2e6cf;--th:#edf6f0;--th-text:#166534}
#fm-root[data-accent="lacivert"]{--accent:#1e3a8a;--accent-soft:#eaecf7;--accent-line:#c7cdeb;--th:#eef0f8;--th-text:#27408b}
#fm-root[data-accent="mavi"]{--accent:#2563eb;--accent-soft:#e8f0ff;--accent-line:#cfe0ff;--th:#eef4ff;--th-text:#1d4ed8}
#fm-root[data-accent="petrol"]{--accent:#0d9488;--accent-soft:#e3f4f2;--accent-line:#bfe6e1;--th:#ecf7f5;--th-text:#0f766e}
#fm-root[data-accent="mor"]{--accent:#5b5bd6;--accent-soft:#eef0fc;--accent-line:#dadcfb;--th:#f4f3fc;--th-text:#5a4fa3}
#fm-root[data-accent="amber"]{--accent:#c2710c;--accent-soft:#fbf1e2;--accent-line:#f0d6ad;--th:#fbf4e9;--th-text:#a85d08}
#fm-root[data-accent="slate"]{--accent:#475569;--accent-soft:#eef1f5;--accent-line:#d6dce4;--th:#f1f4f7;--th-text:#3b4757}
#fm-root[data-accent="bordo"]{--accent:#b91c1c;--accent-soft:#fbeaea;--accent-line:#f1c9c9;--th:#fbeeee;--th-text:#991b1b}
#fm-root *{box-sizing:border-box;margin:0;padding:0}
#fm-root .app{display:flex;min-height:100vh;background:var(--bg)}
#fm-root .side{width:236px;flex-shrink:0;background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:0 0 14px}
#fm-root .brand{display:flex;align-items:center;gap:9px;padding:16px 18px;border-bottom:1px solid var(--line)}
#fm-root .brand .lg{height:30px;width:30px;border-radius:8px;background:var(--accent);display:grid;place-items:center;color:#fff;font-weight:800;font-size:13px}
#fm-root .brand b{font-size:14px;font-weight:700}
#fm-root .brand small{display:block;font-size:10px;color:var(--faint);font-weight:600}
#fm-root .nav{padding:10px 10px 0;overflow:auto}
#fm-root .ncap{font-size:10px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:14px 10px 6px}
#fm-root .nitem{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;margin-bottom:1px}
#fm-root .nitem:hover{background:#f7f8fb;color:var(--text)}
#fm-root .nitem.on{background:var(--accent-soft);color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
#fm-root .nitem .ct{margin-left:auto;font-size:10.5px;font-weight:700;background:#eef1f5;color:var(--muted);border-radius:999px;padding:1px 7px}
#fm-root .nitem.on .ct{background:#fff;color:var(--accent)}
#fm-root .nsub{display:flex;align-items:center;gap:10px;padding:7px 11px 7px 38px;border-radius:8px;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer}
#fm-root .nsub:hover{background:#f7f8fb;color:var(--text)}
#fm-root .nsub.on{color:var(--accent);font-weight:700}
#fm-root .nsub .d{height:6px;width:6px;border-radius:50%;background:currentColor;opacity:.5}
#fm-root .main{flex:1;min-width:0;display:flex;flex-direction:column}
#fm-root .top{display:flex;align-items:center;gap:12px;padding:11px 22px;background:#fff;border-bottom:1px solid var(--line);flex-wrap:wrap}
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
#fm-root .mcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
#fm-root .mcard .ml{font-size:12px;color:var(--muted)}
#fm-root .mcard .mv{font-size:26px;font-weight:700;margin-top:5px}
#fm-root .fld input,#fm-root .fld select{border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font-size:12.5px;font-weight:600;color:var(--text);background:#fff;min-height:35px;width:100%}
#fm-root .fld input:focus,#fm-root .fld select:focus{outline:none;border-color:var(--accent)}
#fm-root .fld input::placeholder{color:var(--faint);font-weight:400}
#fm-root .btn:disabled{opacity:.6;cursor:default}
#fm-root .lic{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:6px}
#fm-root .stat{height:9px;width:9px;border-radius:50%;background:var(--green)}
#fm-root .theme{display:flex;align-items:center;gap:5px;padding-left:10px;border-left:1px solid var(--line);margin-left:2px}
#fm-root .theme small{font-size:10.5px;color:var(--faint);font-weight:700;margin-right:1px}
#fm-root .tsw{height:18px;width:18px;border-radius:50%;cursor:pointer;border:2px solid #fff;outline:1px solid var(--line2)}
#fm-root .tsw:hover{transform:scale(1.12)}
#fm-root .tsw.on{outline:2px solid var(--text)}
#fm-root .content{padding:20px 22px;flex:1}
#fm-root .h2{font-size:19px;font-weight:700;margin-bottom:3px}
#fm-root .sub{font-size:12.5px;color:var(--muted);margin-bottom:16px}
#fm-root .ph-empty{padding:10px 0}
#fm-root .btn{display:inline-flex;align-items:center;gap:7px;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:600;border:1px solid var(--line2);background:#fff;color:var(--text);cursor:pointer}
#fm-root .btn:hover{border-color:var(--accent)}
#fm-root .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
#fm-root .btn.blue{background:var(--blue);color:#fff;border-color:var(--blue)}
#fm-root .btn.red{background:var(--red);color:#fff;border-color:var(--red)}
#fm-root .btn.ghost{background:#fff;color:var(--muted)}
#fm-root .btn.sm{padding:7px 11px;font-size:12px}
#fm-root .card{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:16px}
#fm-root .card .ch{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
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
#fm-root thead th{text-align:left;font-weight:700;color:var(--th-text);font-size:11px;text-transform:uppercase;letter-spacing:.3px;padding:11px 11px;background:var(--th);white-space:nowrap}
#fm-root tbody td{padding:11px 11px;border-bottom:1px solid var(--line);white-space:nowrap}
#fm-root tbody tr:hover{background:#fafbfd}
/* Aksiyon (göz) sütunu daima görünür kalsın — geniş tabloda sağda kesilmesin */
#fm-root td.actcol{position:sticky;right:0;background:#fff;box-shadow:-6px 0 6px -6px rgba(0,0,0,.12)}
#fm-root th.actcol{position:sticky;right:0;background:var(--th)}
#fm-root tbody tr:hover td.actcol{background:#fafbfd}
#fm-root .num{text-align:right;font-variant-numeric:tabular-nums}
#fm-root .cb{height:16px;width:16px;border-radius:4px;border:1.5px solid var(--line2);display:inline-grid;place-items:center;cursor:pointer;background:#fff;vertical-align:middle;color:#fff}
#fm-root .cb.on{background:var(--accent);border-color:var(--accent)}
#fm-root td.firm{max-width:230px}
#fm-root .firm b{font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .firm small{display:block;color:var(--faint);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .hk{font-family:"Consolas",monospace;font-weight:700;color:var(--accent)}
#fm-root .hk.no{color:var(--red)}
#fm-root .pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;white-space:nowrap;display:inline-block}
#fm-root .pill.alis{background:#eaf1ff;color:#2563eb}
#fm-root .pill.satis{background:#e7f6ec;color:#15803d}
#fm-root .pill.ok{background:#e7f6ec;color:#15803d}
#fm-root .pill.miss{background:#fdeaea;color:#c0353a}
#fm-root .pill.warn{background:#fdf2e0;color:#b45309}
#fm-root .pill.n{background:#eef1f5;color:#64748b}
#fm-root .eye{height:28px;width:28px;border-radius:7px;border:1px solid var(--line2);display:grid;place-items:center;color:var(--muted);cursor:pointer}
#fm-root .eye:hover{border-color:var(--accent);color:var(--accent)}
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
#fm-root .ph{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:12px}
#fm-root .docmeta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 14px;padding:11px 13px;margin-bottom:14px;background:#fbfcfd;border:1px solid var(--line);border-radius:10px}
#fm-root .docmeta .dm{display:flex;flex-direction:column;gap:1px}
#fm-root .docmeta .dml{font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.4px}
#fm-root .docmeta .dmv{font-size:13px;font-weight:600;color:var(--text)}
#fm-root .docmeta .dmi{width:100%;height:30px;padding:0 8px;border:1px solid var(--line2);border-radius:7px;font-size:13px;font-weight:600;color:var(--text);background:#fff;font-family:inherit}
#fm-root .docmeta .dmi:focus{outline:none;border-color:var(--accent)}
#fm-root .li{height:28px;border:1px solid var(--line2);border-radius:6px;padding:0 7px;font-size:12.5px;font-weight:600;color:var(--text);background:#fff;font-family:inherit}
#fm-root .li:focus{outline:none;border-color:var(--accent)}
#fm-root .licode{width:120px}
#fm-root .linum{width:120px;text-align:right}
#fm-root .wmain{padding:18px}
#fm-root .wstrip{display:flex;gap:9px;overflow-x:auto;padding:11px 16px;border-top:1px solid var(--line);background:#fbfcfd}
#fm-root .wchip{flex:0 0 auto;max-width:230px;padding:8px 12px;border:1px solid var(--line2);border-radius:9px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:2px}
#fm-root .wchip:hover{border-color:var(--accent-line)}
#fm-root .wchip.on{border-color:var(--accent);background:var(--accent-soft);box-shadow:inset 0 -2px 0 var(--accent)}
#fm-root .wchip.miss{border-style:dashed}
#fm-root .wchip b{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:206px}
#fm-root .wchip small{font-size:11px;color:var(--muted)}
#fm-root .fiseditor{display:flex;gap:18px;align-items:flex-start}
#fm-root .belgepane{flex:0 0 46%;max-width:46%;position:sticky;top:12px}
#fm-root .fispane{flex:1;min-width:0}
#fm-root .belgebox{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
#fm-root .belgebox .bpbar{display:flex;align-items:center;justify-content:space-between;padding:7px 11px;border-bottom:1px solid var(--line);background:#fbfcfd;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
#fm-root .belgebox .bpbar a{color:var(--accent);text-decoration:none;font-weight:700;text-transform:none;letter-spacing:0}
#fm-root .belgebox .bpzoom{display:flex;align-items:center;gap:6px}
#fm-root .belgebox .bpzoom button{width:24px;height:24px;border:1px solid var(--line2);border-radius:6px;background:#fff;color:var(--text);font-size:15px;font-weight:700;cursor:pointer;display:grid;place-items:center;line-height:1}
#fm-root .belgebox .bpzoom button:last-of-type{width:auto;padding:0 9px;font-size:11px}
#fm-root .belgebox .bpzoom button:hover{border-color:var(--accent);color:var(--accent)}
#fm-root .belgebox .bpzoom .bpz{font-size:11px;font-weight:700;color:var(--muted);min-width:38px;text-align:center}
#fm-root .belgebox .bpframe{width:100%;height:660px;border:0;background:#fff}
#fm-root .belgebox .bpimgwrap{height:660px;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:#f1f3f7}
#fm-root .belgebox .bpimg{display:block;height:auto}
#fm-root .belgebox .bpempty{height:200px;display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:12px}
@media(max-width:1100px){#fm-root .fiseditor{flex-direction:column}#fm-root .belgepane{flex:none;max-width:100%;width:100%;position:static}}
#fm-root .ph .mu{margin-left:auto;font-weight:500}
#fm-root .balance{display:flex;align-items:center;gap:10px;margin-top:13px;padding:11px 13px;border-radius:10px;background:#e9f7ee;border:1px solid #c7ecd3;color:#15803d;font-weight:700}
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
#fm-root .docov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:grid;place-items:center;z-index:60;padding:24px}
#fm-root .docbox{background:#fff;border-radius:14px;width:min(1000px,96vw);height:min(90vh,1000px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.35)}
#fm-root .docbar{display:flex;align-items:center;gap:9px;padding:11px 14px;border-bottom:1px solid var(--line);flex-shrink:0}
#fm-root .docbar b{font-size:13.5px}
#fm-root .docframe{flex:1;width:100%;border:none;background:#fff}
#fm-root .docimgwrap{flex:1;min-height:0;overflow:auto;background:#eef1f4;display:flex;justify-content:center;align-items:center;padding:18px}
#fm-root .docimg{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:6px;box-shadow:0 3px 16px rgba(0,0,0,.18);background:#fff}
`;
