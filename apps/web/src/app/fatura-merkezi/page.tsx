'use client';

import { useState, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isletmeRef, ISLETME_ISLEM_TURU, ISLETME_KDV_ORAN, defaultBelgeTuruKod, getKayitAltList, defaultKayitAltKod, kayitAltKisaAd } from '@mali-musavir/shared';

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
  expand: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></svg>',
  compress: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m8 0v-3a2 2 0 0 1 2-2h3"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>',
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
  const nonAmountIssues = issues.filter((i: any) => i?.code && i?.severity !== 'WARNING'
    && !['INCOMPLETE_AMOUNTS', 'TOTAL_MISMATCH', 'BALANCE_MISMATCH'].includes(i.code));
  const vissue = dengesiz || nonAmountIssues.length > 0;
  if (vissue) return { k: 'warn', t: 'Çelişki — kontrol et', cat: 'celiski' };
  // İŞLETME DEFTERİ (Defter-Beyan): tek-taraflı — hesap planı/kodu YOK, cari kodu açılmaz.
  //   Sınıflandırma = Kayıt Türü (Mal/Hizmet Satışı) MÜKELLEFİN FAALİYETİNE göre otomatik belirlenir.
  //   Tutar okunmuş + kayıt türü çözülmüşse "Eşleşti"; çözülemezse "İncele" (Bilanço kod eksiği UYGULANMAZ).
  if (isIsletme) {
    const p = kdvParts(doc);
    const hasAmt = (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || Number(doc.totalAmount) > 0;
    if (!hasAmt) return { k: 'warn', t: 'Tutar okunamadı', cat: 'tutar' };
    const isl = doc.ocrData?.isletme;
    const saved = isl && ((Array.isArray(isl.satirlar) && isl.satirlar.length) || isl.kayitTuruKod);
    if (saved || autoKtKod) return { k: 'ok', t: 'Eşleşti ✓', cat: 'ready' };
    return { k: 'warn', t: 'Eşleşmedi', cat: 'incele' };
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
const DURUM_FILTRELER: Array<{ v: string; l: string }> = [
  { v: 'all', l: 'Hepsi' },
  { v: 'ready', l: 'Eşleşti' },
  { v: 'incele', l: 'Eşleşmedi' },
  { v: 'eksik', l: 'Kod eksik' },
  { v: 'celiski', l: 'Çelişki' },
  { v: 'tutar', l: 'Tutar okunamadı' },
  { v: 'okunuyor', l: 'Okunuyor' },
  { v: 'okunamadi', l: 'Okunamadı' },
];
function taxpayerLabel(t: any): string {
  return t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.taxNumber || 'Mükellef';
}
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
    const onDoc = (e: MouseEvent) => {
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
    const onDoc = (e: MouseEvent) => {
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
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => String(o.value) === String(value));
  const measure = () => { const el = boxRef.current; if (!el) return; const r = el.getBoundingClientRect(); setPos({ top: r.bottom + 3, left: r.left, width: r.width }); };
  useEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (boxRef.current?.contains(t) || popRef.current?.contains(t)) return; setOpen(false); };
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
        <div className="pselpop" ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}>
          {options.map((o) => (
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

  useEffect(() => {
    const onView = (e: any) => { setDoc(e.detail || null); setScale(1); setDim({ w: 0, h: 0 }); fittedRef.current = false; };
    const onKey = (e: KeyboardEvent) => {
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

export default function FaturaMerkeziPage() {
  const [screen, setScreen] = useState('mukellefler');
  const [accent, setAccent] = useState('yesil');
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
      const s = localStorage.getItem('fm-screen'); if (s) setScreen(s);
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
      <div className={`nitem${screen === 'mukellefler' ? ' on' : ''}`} onClick={() => go('mukellefler')}><Ico html={I.users} /> Mükellefler</div>

      <div className="ncap">Belgeler</div>
      <div className={`nitem${screen === 'faturalar' || screen === 'satis' ? ' on' : ''}`} onClick={() => go('faturalar')}><Ico html={I.file} /> Gelen Faturalar</div>
      <div className={`nsub${screen === 'faturalar' ? ' on' : ''}`} onClick={() => go('faturalar')}><span className="d" /> Bekleyen Alış Faturaları {badge(sum.alisPending)}</div>
      <div className={`nsub${screen === 'satis' ? ' on' : ''}`} onClick={() => go('satis')}><span className="d" /> Bekleyen Satış Faturaları {badge(sum.satisPending)}</div>
      <div className={`nitem${screen === 'muhasebe' ? ' on' : ''}`} onClick={() => go('muhasebe')}><Ico html={I.ledger} /> Muhasebeleştir {badge(sum.pending)}</div>
      <div className={`nitem${screen === 'aktarilanlar' ? ' on' : ''}`} onClick={() => go('aktarilanlar')}><Ico html={I.check} /> Aktarım {badge(Math.max(0, (Number(sum.approved) || 0) - (Number(sum.posted) || 0)))}</div>
      <div className={`nitem${screen === 'arsiv' ? ' on' : ''}`} onClick={() => go('arsiv')}><Ico html={I.ledger} /> Arşivim {badge(sum.posted)}</div>

      <div className="ncap">Kurulum</div>
      <div className={`nitem${screen === 'kurallar' ? ' on' : ''}`} onClick={() => go('kurallar')}><Ico html={I.rules} /> Eşleştirme Kuralları</div>
      <div className={`nitem${screen === 'entegrator' ? ' on' : ''}`} onClick={() => go('entegrator')}><Ico html={I.plug} /> Entegratörler</div>
      <div className={`nitem${screen === 'kdv' ? ' on' : ''}`} onClick={() => go('kdv')}><Ico html={I.chart} /> KDV Raporu</div>
      <div className={`nitem${screen === 'ayarlar' ? ' on' : ''}`} onClick={() => go('ayarlar')}><Ico html={I.ledger} /> Hesap Planı</div>
    </nav>
  );

  return (
    <div id="fm-root" data-accent={accent}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <DocModal />
      <div className={`app${editorFull ? ' editorfull' : ''}`}>
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
            {(screen === 'faturalar' || screen === 'satis') && <ScreenFaturalar taxpayerId={taxpayerId} period={period} kind={screen === 'satis' ? 'SATIS' : 'ALIS'} isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} taxpayerNace={(taxpayers.find((t) => t.id === taxpayerId) as any)?.naceKodu || ''} taxpayerFaaliyet={(taxpayers.find((t) => t.id === taxpayerId) as any)?.faaliyetAciklama || ''} />}
            {screen === 'mukellefler' && <ScreenMukellefler taxpayers={taxpayers} period={period} onOpen={(id) => { setTaxpayerId(id); setScreen('faturalar'); }} />}
            {screen === 'kurallar' && <ScreenKurallar taxpayerId={taxpayerId} period={period} />}
            {screen === 'muhasebe' && <ScreenMuhasebe taxpayerId={taxpayerId} period={period} isIsletme={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return /i[şs]letme|defter.?beyan|basit/i.test(`${t?.defterTuru || ''} ${(t as any)?.mihsapDefterTuru || ''}`); })()} taxpayerNace={(taxpayers.find((t) => t.id === taxpayerId) as any)?.naceKodu || ''} taxpayerFaaliyet={(taxpayers.find((t) => t.id === taxpayerId) as any)?.faaliyetAciklama || ''} taxpayerAd={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return t ? taxpayerLabel(t) : ''; })()} full={editorFull} onToggleFull={() => setEditorFull((v) => !v)} />}
            {screen === 'aktarilanlar' && <ScreenAktarilanlar taxpayerId={taxpayerId} period={period} mode="bekleyen" />}
            {screen === 'arsiv' && <ScreenAktarilanlar taxpayerId={taxpayerId} period={period} mode="arsiv" />}
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
function ScreenFaturalar({ taxpayerId, period, kind = 'ALIS', isIsletme = false, taxpayerNace = '', taxpayerFaaliyet = '' }: { taxpayerId: string; period: string; kind?: 'ALIS' | 'SATIS'; isIsletme?: boolean; taxpayerNace?: string; taxpayerFaaliyet?: string }) {
  const qc = useQueryClient();
  const docsQ = useDocuments(taxpayerId, period);
  const all: any[] = docsQ.data || [];
  // Gelen kutusu: yalnız HENÜZ İŞLENMEMİŞ gelen belgeler. Onaylanan/aktarıma alınan/aktarılan
  //   belgeler buradan çıkar (Aktarım arşivinde görünür) — kullanıcı talebi.
  const docsAll = all.filter((d) => (d.invoiceKind || 'ALIS') === kind && !isInAktarim(d));
  // İşletme sınıfı = AI'ın fatura OKUMA anında faaliyet+içerikle verdiği karar (ocrData.isletme).
  //   Kaydedilmiş satır varsa o; yoksa AI'ın sınıfı. AI sınıf vermediyse ok:false → "Eşleşmedi" + boş.
  const islSinif = (d: any): { ktAd: string; altAd: string; ok: boolean } => {
    if (!isIsletme) return { ktAd: '', altAd: '', ok: false };
    const isl = d.ocrData?.isletme;
    const ktKod = isl?.satirlar?.[0]?.kayitTuruKod || isl?.kayitTuruKod;
    if (!ktKod) return { ktAd: '', altAd: '', ok: false };
    return {
      ktAd: isl?.satirlar?.[0]?.kayitTuruAd || isl?.kayitTuruAd || '',
      altAd: isl?.satirlar?.[0]?.kayitAltAd || isl?.kayitAltAd || '',
      ok: true,
    };
  };
  const dd = (d: any) => deriveDurum(d, isIsletme, islSinif(d).ok ? 'x' : '');
  // Durum filtresi (Hepsi / Eşleşti / İncele / Kod eksik / Çelişki / …)
  const [durumF, setDurumF] = useState('all');
  const durumCount = (cat: string) => cat === 'all' ? docsAll.length : docsAll.filter((d) => dd(d).cat === cat).length;
  const docs = durumF === 'all' ? docsAll : docsAll.filter((d) => dd(d).cat === durumF);
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
  docsAll.forEach((d) => {
    const k = dd(d).k;
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
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/fatura-muhasebelestirme/documents/${id}`),
    onSuccess: () => { toast.success('Belge silindi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Silinemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const syncMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/documents/match-orphans', { period }),
    onSuccess: (r: any) => { toast.success(`Eşitlendi${r?.data?.matched != null ? ` · ${r.data.matched} belge bağlandı` : ''}`); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: () => toast.error('Eşitleme başarısız'),
  });
  // Hızlı: belgeleri tekrar OKUMADAN hesap kodlarını plana göre yeniden eşleştir (yanlış cari temizlenir).
  const recodeMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/documents/reapply-codes', { taxpayerId }),
    onSuccess: () => { toast.success('Hesap kodları yeniden eşleştirildi — yanlış cariler düzeltildi/temizlendi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: () => toast.error('Yeniden eşleştirme başarısız'),
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

  // AI ile oku — seçili faturalar SUNUCU kuyruğunda okunur (sayfa değişince DURMAZ).
  // İlerleme aşağıdaki tarama şeridinden izlenir.
  const [aiBusy, setAiBusy] = useState(false);
  const aiOku = async () => {
    const ids = [...sel];
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
  // OCR/okuma ilerlemesi — sunucudan periyodik çekilir (3sn). Sayfaya dönünce mevcut
  // durumu gösterir; okuma sunucuda sürdüğü için kapanmaz.
  const ocrProgQ = useQuery({
    queryKey: ['fm-ocr-progress', taxpayerId, period],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/ocr-progress', { params: { taxpayerId, period } })).data,
    enabled: !!taxpayerId,
    refetchInterval: 3000,
  });
  const ocrProg: any = ocrProgQ.data;
  // Faz F/6: eksik belge takibi — sadece Alış'ta, düzenli gelip bu dönem gelmeyen satıcılar.
  const missingQ = useQuery({
    queryKey: ['fm-missing', taxpayerId, period, kind],
    queryFn: async () => (await api.get('/fatura-muhasebelestirme/missing-suppliers', { params: { taxpayerId, period } })).data,
    enabled: !!taxpayerId && kind === 'ALIS',
  });
  const missing: any[] = missingQ.data?.missing || [];
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
  const grpLabel = (g: string) => g === 'matrah' ? 'Matrah' : g === 'vergi' ? 'KDV' : g === 'cari' ? 'Cari' : g === 'tevkifat' ? 'Tevkifat' : (g || '—');

  const muhasebelestir = () => {
    // İşletme defteri: hesap kodu YOK — tutarı olan hazır. Bilanço: TÜM satırların kodu dolu (cari dahil).
    const isReadyDoc = (d: any) => {
      if (d.status === 'APPROVED') return false;
      if (isIsletme) { const p = kdvParts(d); return (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || Number(d.totalAmount) > 0; }
      return Array.isArray(d.lines) && d.lines.length > 0 && d.lines.every((l: any) => l.accountCode);
    };
    const hazir = docs.filter((d) => sel.has(d.id) && isReadyDoc(d));
    if (hazir.length === 0) {
      toast.error(sel.size === 0 ? 'Önce belge seç' : (isIsletme ? 'Seçilenlerde tutar okunamamış ya da zaten onaylı' : 'Seçilenlerde eksik hesap kodu var (cari/KDV/gider) ya da zaten onaylı'));
      return;
    }
    approveMut.mutate(hazir.map((d) => d.id));
  };

  return (
    <section className="screen">
      <div className="h2">{kind === 'SATIS' ? 'Bekleyen Satış Faturaları' : 'Bekleyen Alış Faturaları'}</div>
      <div className="sub">{kind === 'SATIS' ? 'Mükellefin kestiği satış faturaları — kuralla otomatik eşleşir.' : 'Entegratörden çekilen gelen faturalar — kuralla otomatik eşleşir, sadece eksik/çelişkili olana bakarsın.'}</div>
      <div className="card">
        <div className="ch">
          <h3>{docsQ.isLoading ? 'Yükleniyor…' : `${docs.length} belge`}</h3><div className="sp" />
          <button className="btn sm blue" disabled={!taxpayerId || mihsapMut.isPending} onClick={() => mihsapMut.mutate()} title={!taxpayerId ? 'Önce mükellef seç' : "Mihsap 'bekleyen evraklar'daki faturaları portala aktarır"}><Ico html={I.download} size={13} /> {mihsapMut.isPending ? 'Aktarılıyor…' : "Mihsap'tan Aktar"}</button>
          <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.jpe,.jfif,.png,.webp,.gif,.tif,.tiff,.bmp,.heic,.heif,.avif,.xml,.ubl,.zip" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files; if (f && f.length) uploadMut.mutate(f); e.target.value = ''; }} />
          <button className="btn sm" disabled={!taxpayerId || uploadMut.isPending} onClick={() => fileRef.current?.click()} title={!taxpayerId ? 'Önce mükellef seç' : 'JPEG / PDF / XML belge yükle (elle)'}><Ico html={I.plus} size={13} /> {uploadMut.isPending ? 'Yükleniyor…' : 'Belge Yükle'}</button>
          <button className="btn sm" disabled title="Entegratörden otomatik çekme — yakında. Şimdilik 'Mihsap'tan Aktar' ya da 'Belge Yükle' kullan." style={{ opacity: .55 }}><Ico html={I.download} size={13} /> Belgeleri Getir <span style={{ fontSize: 9, fontWeight: 700, opacity: .8 }}>YAKINDA</span></button>
          <button className="btn sm ghost" disabled={syncMut.isPending} onClick={() => syncMut.mutate()} title="Mükellefe bağlanmamış (sahipsiz) belgeleri VKN/TCKN'ye göre ilgili mükellefe bağlar"><Ico html={I.sync} size={13} /> {syncMut.isPending ? 'Bağlanıyor…' : 'Sahipsiz belgeleri bağla'}</button>
          <button className="btn sm ghost" disabled={!taxpayerId || recodeMut.isPending} onClick={() => recodeMut.mutate()} title="Belgeleri TEKRAR OKUMADAN hesap kodlarını plana göre yeniden eşleştir — yanlış carileri düzeltir/temizler (saniyeler sürer)"><Ico html={I.sync} size={13} /> {recodeMut.isPending ? 'Düzeltiliyor…' : 'Kodları düzelt'}</button>
          <button className="btn sm blue" disabled={aiBusy || sel.size === 0} onClick={aiOku} title="Seçili faturaları yapay zeka (Max) ile oku — sunucuda okur, sayfa değişince durmaz">{aiBusy ? 'Başlatılıyor…' : `AI ile oku${sel.size ? ` (${sel.size})` : ''}`}</button>
          <button className="btn sm primary" disabled={approveMut.isPending} onClick={muhasebelestir} title="Seçili, kodu tam olan belgeleri toplu onayla (Luca kuyruğuna alır). Tek tek inceleme için soldaki 'Muhasebeleştir' ekranını kullan."><Ico html={I.checkSm} size={13} /> {approveMut.isPending ? 'İşleniyor…' : `Seçilenleri onayla${sel.size ? ` (${sel.size})` : ''}`}</button>
        </div>
        {docsQ.isError && (
          <div className="yuklenemedi">
            <span><Ico html={I.info} size={14} /> Belgeler yüklenemedi (bağlantı/sunucu hatası) — "veri yok" değil.</span>
            <button className="btn sm" onClick={() => docsQ.refetch()}><Ico html={I.sync} size={12} /> Tekrar dene</button>
          </div>
        )}
        {ocrProg && (ocrProg.active || ocrProg.failed > 0) && (() => {
          const tot = Math.max(1, (ocrProg.done || 0) + (ocrProg.reading || 0) + (ocrProg.failed || 0));
          const pct = Math.min(100, Math.round(((ocrProg.done || 0) / tot) * 100));
          return (
            <div className={`ocrstrip${ocrProg.active ? ' scanning' : ''}`}>
              <div className="ocrbar"><div className="ocrfill" style={{ width: `${ocrProg.active ? pct : 100}%` }} /></div>
              <div className="ocrtxt">
                {ocrProg.active ? (
                  <><span className="ocrdot" /> Belgeler okunuyor — <b>{ocrProg.done}</b> / {tot} okundu{ocrProg.reading ? <> · {ocrProg.reading} sırada</> : null}{ocrProg.failed ? <> · {ocrProg.failed} okunamadı</> : null} <span className="ocrpct">%{pct}</span> <span className="ocrhint">(sunucuda sürer, sayfa değiştirebilirsin)</span></>
                ) : (
                  <><span className="ocrdot err" /> {ocrProg.failed} belge okunamadı — seçip <b>AI ile oku</b> ile tekrar dene</>
                )}
              </div>
            </div>
          );
        })()}
        {kind === 'ALIS' && missing.length > 0 && (
          <div className="eksikbelge" title="Bu satıcılar son aylarda düzenli alış faturası gönderdi ama bu dönem henüz yok — eksik belge olabilir.">
            <Ico html={I.info} size={14} />
            <span><b>{missing.length}</b> satıcıdan bu dönem belge gelmemiş olabilir (düzenli geliyordu): {missing.slice(0, 8).map((m: any) => m.name).join(', ')}{missing.length > 8 ? ` +${missing.length - 8}` : ''}</span>
          </div>
        )}
        <div className="durumfiltre">
          {DURUM_FILTRELER.map((f) => {
            const n = durumCount(f.v);
            if (f.v !== 'all' && n === 0) return null;
            return (
              <button key={f.v} className={`dfchip${durumF === f.v ? ' on' : ''}`} onClick={() => setDurumF(f.v)}>
                {f.l} <span className="dfn">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="twrap">
          <table>
            <thead><tr><th style={{ width: 30 }}><Check checked={allSelected} onToggle={toggleAll} /></th><th>Tarih</th><th>Fatura No</th><th>Firma Adı</th><th>Tip</th><th className="num">KDV Hariç</th><th className="num">KDV</th><th className="num">Tutar</th><th>{isIsletme ? 'Kayıt Türü' : 'Hesap Kodu'}</th><th>Durum</th><th className="actcol" style={{ width: 40 }} /></tr></thead>
            <tbody>
              {docs.map((d) => {
                const du = dd(d);
                const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
                // İşletme "Kayıt Türü" sütunu: içerik = ALT türü (örn. "Elektrik Giderleri"). Seçili ise o,
                //   değilse satıcı adından otomatik (Elektrik/Yakıt/Doğalgaz/Su/Telefon/Kargo/HGS…); alt yoksa ana türe düşer.
                // İşletme: içerikten gelen sınıf. ok ise ALT türünü göster (yoksa ana türe düş); değilse boş (Eşleşmedi).
                const sinif = islSinif(d);
                const islKayit = isIsletme && sinif.ok ? (kayitAltKisaAd(sinif.altAd) || sinif.ktAd) : '';
                const islAltFull = sinif.altAd;
                const islMain = sinif.ktAd;
                const firma = (sat ? d.customerName : d.vendorName) || '—';
                const vkn = sat ? d.buyerVkn : d.sellerVkn;
                const code = (() => { const ls = Array.isArray(d.lines) ? d.lines : []; return (ls.find((l: any) => String(l.group) === 'matrah' && l.accountCode) || ls.find((l: any) => l.accountCode))?.accountCode || ''; })();
                const { matrah, kdv } = kdvParts(d);
                const ocrCls = d.ocrStatus === 'IN_PROGRESS' ? 'scanning' : justDone.has(d.id) ? 'justdone' : d.ocrStatus === 'PENDING' ? 'queued' : undefined;
                const fisAcik = fisDetayId === d.id;
                const fisLines: any[] = Array.isArray(d.lines) ? d.lines : [];
                return (
                  <Fragment key={d.id}>
                  <tr className={`${ocrCls || ''}${fisAcik ? ' detay-on' : ''}`.trim() || undefined}>
                    <td><Check checked={sel.has(d.id)} onToggle={() => toggle(d.id)} /></td>
                    <td>{fmtDate(d.faturaTarihi || d.createdAt)}</td>
                    <td>{d.belgeNo || '—'}</td>
                    <td className="firm"><b>{firma}</b><small>{vkn ? `VKN ${vkn}` : '—'}</small></td>
                    <td><span className={`pill ${sat ? 'satis' : 'alis'}`}>{sat ? 'Satış' : 'Alış'}</span></td>
                    <td className="num">{matrah != null ? fmtMoney(matrah) : '—'}</td>
                    <td className="num">{kdv != null ? fmtMoney(kdv) : '—'}</td>
                    <td className="num">{fmtMoney(d.totalAmount)}</td>
                    <td>{isIsletme
                      ? (islKayit ? <span className="hk" title={islAltFull ? `${islMain} › ${islAltFull}` : islMain}>{islKayit}</span> : <span className="hk no" title="Belge içeriğinden tür çıkarılamadı — Muhasebeleştir'de seç">—</span>)
                      : (code ? <span className="hk">{code}</span> : <span className="hk no">— yok —</span>)}</td>
                    <td><span className={`pill ${du.k}`} title={du.cat === 'okunamadi' && d.lucaErrorMessage ? `Neden: ${d.lucaErrorMessage}` : du.cat === 'celiski' ? ((Array.isArray(d.validationIssues) ? d.validationIssues : (Array.isArray(d.ocrData?.validationIssues) ? d.ocrData.validationIssues : [])).filter((i: any) => i?.code && i.code !== 'INCOMPLETE_AMOUNTS' && i?.severity !== 'WARNING').map((i: any) => i.message).filter(Boolean).join(' · ') || du.t) : du.t}>{du.t}</span>{du.cat === 'okunamadi' && d.lucaErrorMessage ? <div className="oneden">{d.lucaErrorMessage}</div> : null}{du.cat === 'celiski' ? <div className="oneden" style={{ fontSize: 10.5, opacity: 0.85 }}>↓ sebebi fiş detayında</div> : null}</td>
                    <td className="actcol" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="eye" onClick={() => setFisDetayId(fisAcik ? '' : d.id)} title={fisAcik ? 'Detayı gizle' : (isIsletme ? 'Kayıt türünü göster' : 'Yevmiye fişini göster')} style={fisAcik ? { color: 'var(--accent,#2563eb)' } : undefined}><Ico html={I.ledger} size={15} /></span>
                      <span className="eye" onClick={() => openDocFile(d.id)} title="Belgeyi aç"><Ico html={I.eye} size={15} /></span>
                      <span className="eye del" title="Belgeyi sil" onClick={() => { if (window.confirm(`Bu belge silinsin mi?\n${firma} · ${fmtMoney(d.totalAmount)} ₺${d.belgeNo ? ' · ' + d.belgeNo : ''}`)) delMut.mutate(d.id); }}><Ico html={I.trash} size={14} /></span>
                    </td>
                  </tr>
                  {fisAcik && (
                    <tr className="detayrow">
                      <td colSpan={11}>
                        <div className="detaybox">
                          {isIsletme ? (
                            <div style={{ padding: '4px 2px', fontSize: 13 }}>{(() => { const s = islSinif(d); return s.ok ? <><b>Kayıt Türü:</b> {s.ktAd}{s.altAd ? <> › {s.altAd}</> : null}</> : <span className="hk no">Kayıt türü belirlenemedi — "AI ile oku" ile yeniden okut ya da Muhasebeleştir'de seç.</span>; })()}</div>
                          ) : fisLines.length ? (
                            <table className="detaytbl">
                              <thead><tr><th>Tür</th><th>Hesap Kodu</th><th>Açıklama</th><th className="num">Borç</th><th className="num">Alacak</th></tr></thead>
                              <tbody>
                                {fisLines.map((l: any, i: number) => (
                                  <tr key={l.id || i}>
                                    <td>{grpLabel(String(l.group || ''))}{l.rate ? ` %${String(l.rate).replace(/[^0-9.,]/g, '')}` : ''}</td>
                                    <td>{l.accountCode ? <span className="hk">{l.accountCode}</span> : <span className="hk no">eksik</span>}</td>
                                    <td>{l.accountCode ? (l.description || '—') : '—'}</td>
                                    <td className="num">{Number(l.debit) ? fmtMoney(l.debit) : ''}</td>
                                    <td className="num">{Number(l.credit) ? fmtMoney(l.credit) : ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : <div className="empty" style={{ padding: 10 }}>Fiş satırı yok — önce "AI ile oku".</div>}
                          {(() => { const sB = fisLines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0); const sA = fisLines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0); const msgs: string[] = []; if (fisLines.length > 0 && Math.abs(sB - sA) > 0.5) msgs.push(`Yevmiye dengesiz: Borç ${fmtMoney(sB)} ₺ ≠ Alacak ${fmtMoney(sA)} ₺ (${Math.abs(sB - sA).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺ fark) — bir satır eksik/fazla.`); (Array.isArray(d.validationIssues) ? d.validationIssues : (Array.isArray(d.ocrData?.validationIssues) ? d.ocrData.validationIssues : [])).filter((i: any) => i?.code && i?.severity !== 'WARNING' && !['INCOMPLETE_AMOUNTS', 'TOTAL_MISMATCH', 'BALANCE_MISMATCH'].includes(i.code)).forEach((i: any) => i.message && msgs.push(i.message)); return msgs.length ? <div className="celiskibanner"><b>Çelişki sebebi:</b>{msgs.map((m: string, k: number) => <div key={k}>• {m}</div>)}</div> : null; })()}
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
        <div className="mcard"><div className="ml">Bekleyen belge</div><div className="mv">{tot.pending}</div></div>
        <div className="mcard"><div className="ml">Luca'ya aktarılan</div><div className="mv">{tot.posted}</div></div>
        <div className="mcard"><div className="ml">Sorunlu (kontrol)</div><div className="mv">{tot.issue}</div></div>
        <div className="mcard"><div className="ml">Dikkat gereken</div><div className="mv">{tot.attention}</div></div>
      </div>
      <div className="card">
        <div className="ch"><h3>{list.length} mükellef · {periodLabel(period)}</h3><div className="sp" /><input className="fmsel" style={{ maxWidth: 240 }} placeholder="Mükellef ara…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
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
      setFit(Math.min(1, Math.max(0.3, paneW / cw)));
    } catch { /* cross-origin */ }
  };
  // Panel yeniden boyutlanınca (Büyüt/Küçült/pencere) ölçülen içerik genişliğine göre yeniden sığdır.
  const refit = () => {
    const w = wrapRef.current, cw = contentWRef.current;
    if (!w || !cw) { measure(); return; }
    const paneW = (w.clientWidth || 600) - 16;
    setFit(Math.min(1, Math.max(0.3, paneW / cw)));
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
    setFit(Math.min(1, Math.max(0.3, paneW / nw)));
  };
  // Görseller geç yüklendiğinden birkaç kez yeniden ölç.
  const onFrameLoad = () => { measure(); setTimeout(measure, 250); setTimeout(measure, 900); setTimeout(measure, 2000); };
  useEffect(() => {
    let alive = true;
    setD(null); setZoom(1); setFit(1); setImgW(0);
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
      <div ref={wrapRef} className="bpview" style={{ overflow: 'auto' }} onDoubleClick={() => openDocFile(id)}>
        {html
          ? <iframe ref={frameRef} onLoad={onFrameLoad} className="bpframe-h" srcDoc={htmlDoc} title="Belge" sandbox="allow-same-origin" scrolling="no" style={{ zoom: appliedScale } as any} />
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
  const all: any[] = docsQ.data || [];
  const dirOf = (d: any) => (String(d.invoiceKind || '').includes('SATIS') ? 'SATIS' : 'ALIS');
  const [dir, setDir] = useState<'ALL' | 'ALIS' | 'SATIS'>('ALL');
  const cAlis = all.filter((d) => dirOf(d) === 'ALIS').length;
  const cSatis = all.filter((d) => dirOf(d) === 'SATIS').length;
  const allF = dir === 'ALL' ? all : all.filter((d) => dirOf(d) === dir);
  // HAZIR = TÜM satırların kodu dolu (cari dahil). Eskiden "herhangi bir satır" yeterdi →
  // cari boşken bile "hazır/muhasebeleştirilebilir" görünüyordu (yanlış).
  const hasCode = (d: any) => Array.isArray(d.lines) && d.lines.length > 0 && d.lines.every((l: any) => l.accountCode);
  const hasAmount = (d: any) => { const p = kdvParts(d); return (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || Number(d.totalAmount) > 0; };
  // İşletme defterinde hesap kodu yok — hazır olma şartı belgenin tutarının olması.
  const ready = (d: any) => (isIsletme ? hasAmount(d) : hasCode(d));
  const hazir = allF.filter((d) => d.status !== 'APPROVED' && ready(d));
  const eksik = allF.filter((d) => d.status !== 'APPROVED' && !ready(d));

  const [selId, setSelId] = useState<string>('');
  const navList = [...hazir, ...eksik];
  const selDoc = navList.find((d) => d.id === selId) || hazir[0] || eksik[0];
  const navIdx = selDoc ? navList.findIndex((d) => d.id === selDoc.id) : -1;
  const goNav = (delta: number) => {
    if (navIdx < 0) return;
    const next = navList[navIdx + delta];
    if (next) setSelId(next.id);
  };
  // Klavye ok tuşlarıyla önceki/sonraki belgeye geç (form alanındayken serbest bırak).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'ArrowLeft') goNav(-1);
      else if (e.key === 'ArrowRight') goNav(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navIdx, navList.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    })));
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
  const ggReady = isIsletme ? ((Number(gg.matrah) || 0) > 0 || (Number(gg.kdv) || 0) > 0 || Number(selDoc?.totalAmount) > 0) : dengeli;

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
    let altKod = ai?.kayitAltKod || '';
    const ktAd = isletmeRef(kind).kayitTuru.find((x) => x.kod === ktKod)?.ad;
    if (!altKod) altKod = defaultKayitAltKod(kind, ktKod, ktAd);
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
      belgeTuruKod: saved.belgeTuruKod || defaultBelgeTuruKod(selDoc.documentType, kind),
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
  const expKey = (i: number, sec: string) => `${i}:${sec}`;
  const toggleExp = (i: number, sec: string) => setIslExp((e) => ({ ...e, [expKey(i, sec)]: !e[expKey(i, sec)] }));
  // Fatura Türü (Gelir/Gider) değişince üst + tüm satırların kayıt türünü yeni bağlama göre sıfırla.
  const setIslKind = (kind: 'SATIS' | 'ALIS') => {
    if (!isIsletme) return;
    const ktKod = kind === 'SATIS' ? '2' : '4';
    const ktAd = isletmeRef(kind).kayitTuru.find((x) => x.kod === ktKod)?.ad;
    setIsl((s: any) => ({ ...s, belgeTuruKod: defaultBelgeTuruKod(selDoc?.documentType, kind), alisSatisKod: '1', plakaNo: kind === 'SATIS' ? '' : s.plakaNo, satirlar: (s.satirlar || []).map((x: any) => ({ ...x, kayitTuruKod: ktKod, kayitAltKod: defaultKayitAltKod(kind, ktKod, ktAd) })) }));
  };
  // İşletme: aktarıma çıkan değerlerin özeti (alt çubuk).
  const islBelgeAd = islRef.belgeTuru.find((x) => x.kod === isl.belgeTuruKod)?.ad || '—';
  const islKayitAd = (islSatirlar.length > 1 ? `${islSatirlar.length} satır` : (islRef.kayitTuru.find((x) => x.kod === islSatirlar[0]?.kayitTuruKod)?.ad || '—'));

  // Gerçek hesap kodunu elle ver — o satıcının tüm faturalarına uygulanır + öğrenilir (770 tahmini yerine)
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
  // Faz E: TEK kaydet (bilgi+satır birlikte, tek bildirim). Ctrl+S buna bağlı.
  const saveAll = async (silent = false) => {
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
      await approveMut.mutateAsync(selDoc.id);
      if (nextId) setSelId(nextId);
    } catch { /* mutasyon hatasını gösterir */ }
  };
  // Faz E: klavye kısayolları — Ctrl+S Kaydet, Ctrl+Enter Kaydet+Onayla (form alanında da çalışır).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      <div className="card" style={{ padding: 0, marginTop: 2 }}>
        <div className="wmain">
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
                  <span className="phname">{isIsletme ? (<>{selDoc.invoiceKind === 'SATIS' ? 'Gelir' : 'Gider'} faturası</>) : (<>{firmaOf(selDoc)} · {selDoc.invoiceKind === 'SATIS' ? 'Satış' : 'Alış'} faturası <span className="mu">{selDoc.belgeNo || ''}</span></>)}</span>
                  {!isIsletme && (taxpayerAd || taxpayerNace || taxpayerFaaliyet) && (
                    <span className="nacechip" title={`Mükellef: ${taxpayerAd || '—'}${taxpayerFaaliyet ? ` · faaliyet: ${taxpayerFaaliyet}` : (taxpayerNace ? ` · NACE ${taxpayerNace}` : ' · faaliyet/sektör girilmemiş')} · ${isIsletme ? 'İşletme' : 'Bilanço'} — hesap eşleştirmesi bu işe göre yapılır`}>
                      <Ico html={I.info} size={11} />{taxpayerNace ? `NACE ${taxpayerNace}` : 'sektör?'}
                    </span>
                  )}
                  <div className="sp" />
                  <button type="button" className="fifull" onClick={() => onToggleFull?.()} title={full ? 'Küçült — menüyü geri getir' : 'Büyüt — menüyü gizle, tam ekran işle'}><Ico html={full ? I.compress : I.expand} size={14} /><span>{full ? 'Küçült' : 'Büyüt'}</span></button>
                </div>
                {!isIsletme && (
                <div className="docmeta">
                  <div className="dm"><span className="dml">Tarih</span><input className="dmi" type="date" value={meta.faturaTarihi || ''} onChange={(e) => setMeta({ ...meta, faturaTarihi: e.target.value })} /></div>
                  <div className="dm"><span className="dml">Fatura Türü</span>
                    <PlainSelect value={`${meta.invoiceKind || 'ALIS'}${meta.tevkifatli ? '_TEV' : ''}`} onChange={(v) => { const k = v.startsWith('SATIS') ? 'SATIS' : 'ALIS'; setMeta({ ...meta, invoiceKind: k, tevkifatli: v.endsWith('_TEV') }); setIslKind(k); }} options={[
                      { value: 'ALIS', label: 'Alış' },
                      { value: 'ALIS_TEV', label: 'Tevkifatlı Alış' },
                      { value: 'SATIS', label: 'Satış' },
                      { value: 'SATIS_TEV', label: 'Tevkifatlı Satış' },
                    ]} />
                  </div>
                  {!isIsletme && (
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
                  )}
                  <div className="dm"><span className="dml">Belge No</span><input className="dmi" value={meta.belgeNo || ''} onChange={(e) => setMeta({ ...meta, belgeNo: e.target.value })} /></div>
                  <div className="dm"><span className="dml">{String(meta.invoiceKind).includes('SATIS') ? 'Alıcı VKN' : 'Satıcı VKN'}</span><input className="dmi" value={meta.vkn || ''} onChange={(e) => setMeta({ ...meta, vkn: e.target.value })} /></div>
                  <div className="dm"><span className="dml">Cari Ünvanı</span><input className="dmi" value={meta.cariUnvan || ''} placeholder="satıcı/alıcı ünvanı" onChange={(e) => setMeta({ ...meta, cariUnvan: e.target.value })} /></div>
                </div>
                )}
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
                      {(String(selDoc.invoiceKind || '').includes('SATIS')
                        ? [
                            // SATIŞ: matrah(600)+KDV(391) ALACAK, cari(120) BORÇ
                            { key: 'matrah', label: 'Matrah (Gelir)', side: 'credit' as const },
                            { key: 'vergi', label: 'Hesaplanan KDV', side: 'credit' as const },
                            { key: 'cari', label: 'Cari Hesap', side: 'debit' as const },
                          ]
                        : [
                            // ALIŞ: matrah+KDV BORÇ, cari ALACAK. Tevkifatlıda 360 (KDV2 sorumlu sıf.)
                            // AYRI bölüm — Mihsap gibi (Matrah · Vergi · Tevkifat · Cari).
                            { key: 'matrah', label: 'Matrah', side: 'debit' as const },
                            { key: 'vergi', label: 'İndirilecek KDV', side: 'debit' as const },
                            ...((Number(selDoc?.ocrData?.tevkifatOrani) > 0 || lineDraft.some((l: any) => (l.group) === 'tevkifat'))
                              ? [{ key: 'tevkifat', label: 'Tevkifat — Ödenecek KDV (360 · KDV2)', side: 'credit' as const }]
                              : []),
                            { key: 'cari', label: 'Cari Hesap', side: 'credit' as const },
                          ]
                      ).map((g) => {
                        const rows = lineDraft.map((l: any, i: number) => ({ l, i })).filter(({ l }) => (l.group || 'matrah') === g.key);
                        const tot = rows.reduce((s, { l }) => s + (Number(g.side === 'debit' ? l.debit : l.credit) || 0), 0);
                        return (
                          <div key={g.key} className="fgrp">
                            <div className="fgh"><span>{g.label}</span><span className="fgs">{g.side === 'debit' ? 'Borç' : 'Alacak'}</span></div>
                            {rows.map(({ l, i }) => (
                              <div key={i} className="frow">
                                <CodeSelect value={l.accountCode || ''} accounts={accountPlan} onChange={(code) => setLine(i, 'accountCode', code)} onAddNew={(code) => openAddAccount(code)} />
                                {g.key !== 'cari' && g.key !== 'tevkifat'
                                  ? <RateSelect value={String(l.rate || '').replace(/[^0-9]/g, '')} onChange={(v) => setLine(i, 'rate', v ? `%${v}` : '')} />
                                  : null}
                                <MoneyInput value={Number((g.side === 'debit' ? l.debit : l.credit) || 0)} onChange={(n) => setLine(i, g.side, n)} />
                                <button type="button" className="frowdel" title="Satırı sil" onClick={() => delLine(i)}>×</button>
                              </div>
                            ))}
                            <div className="frowadd" onClick={() => addLine(g.key)}>+ satır ekle</div>
                            <div className="fgt"><span>Toplam</span><b>{fmtMoney(tot)} ₺</b></div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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
        <div className="wstrip">
          <div className="wfilter">
            <button className={dir === 'ALL' ? 'on' : ''} onClick={() => setDir('ALL')}>Tümü ({all.length})</button>
            <button className={dir === 'ALIS' ? 'on' : ''} onClick={() => setDir('ALIS')}>Alış ({cAlis})</button>
            <button className={dir === 'SATIS' ? 'on' : ''} onClick={() => setDir('SATIS')}>Satış ({cSatis})</button>
          </div>
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
          <button className="btn sm primary" disabled={bulkMut.isPending || hazir.length === 0} onClick={() => bulkMut.mutate()}>
            <Ico html={I.checkSm} size={13} /> {bulkMut.isPending ? 'Onaylanıyor…' : `${hazir.length} belgeyi toplu onayla`}
          </button>
          <span className="amini">Luca'ya aktarım → <b>Aktarım</b> ekranından</span>
        </div>
      </div>
    </section>
  );
}

/* ===================== EKRAN: AKTARILANLAR ===================== */
function ScreenAktarilanlar({ taxpayerId, period, mode = 'bekleyen' }: { taxpayerId: string; period: string; mode?: 'bekleyen' | 'arsiv' }) {
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
  const grpLabel = (g: string) => g === 'matrah' ? 'Matrah' : g === 'vergi' ? 'KDV' : g === 'cari' ? 'Cari' : g === 'tevkifat' ? 'Tevkifat' : (g || '—');
  const renderRow = (d: any) => {
    const sat = (d.invoiceKind || 'ALIS') === 'SATIS';
    const firma = (sat ? d.customerName : d.vendorName) || '—';
    const code = (() => { const ls = Array.isArray(d.lines) ? d.lines : []; return (ls.find((l: any) => String(l.group) === 'matrah' && l.accountCode) || ls.find((l: any) => l.accountCode))?.accountCode || ''; })();
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
          <td className="actcol" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(d.lucaStatus === 'FAILED' || d.lucaStatus === 'ERROR') && (
              <button className="btn ghost sm" disabled={retryMut.isPending} onClick={() => retryMut.mutate(d.id)} title={d.lucaErrorMessage || "Luca'ya tekrar gönder"}><Ico html={I.sync} size={12} /></button>
            )}
            {d.status === 'APPROVED' && !['POSTED', 'POSTING'].includes(d.lucaStatus) && (
              <button className="btn ghost sm" disabled={reopenMut.isPending} onClick={() => { if (confirm('Onayı geri al? Belge tekrar düzenlenebilir olacak.')) reopenMut.mutate(d.id); }} title="Onayı geri al (Luca'ya gitmemişse)">↩</button>
            )}
            <button className="btn ghost sm" onClick={() => setDetayId(acik ? '' : d.id)} title={acik ? 'Fiş detayını gizle' : 'Fiş (yevmiye) detayını göster'}>{acik ? '▾' : '▸'}</button>
            <span className="eye" onClick={() => openDocFile(d.id)}><Ico html={I.eye} size={15} /></span>
          </td>
        </tr>
        {acik && (
          <tr className="detayrow">
            <td colSpan={7}>
              <div className="detaybox">
                {lines.length ? (
                  <table className="detaytbl">
                    <thead><tr><th>Tür</th><th>Hesap Kodu</th><th>Açıklama</th><th className="num">Borç</th><th className="num">Alacak</th></tr></thead>
                    <tbody>
                      {lines.map((l: any, i: number) => (
                        <tr key={l.id || i}>
                          <td>{grpLabel(String(l.group || ''))}{l.rate ? ` %${String(l.rate).replace(/[^0-9.,]/g, '')}` : ''}</td>
                          <td>{l.accountCode ? <span className="hk">{l.accountCode}</span> : <span className="hk no">eksik</span>}</td>
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

          {(Array.isArray(rep.formBa) || Array.isArray(rep.formBs)) && ((rep.formBa?.length || 0) + (rep.formBs?.length || 0) > 0) && (
            <div className="card">
              <div className="ch"><h3>Ba/Bs Taslağı</h3><span className="mu">cari bazında KDV hariç toplam ≥ {fmtMoney(rep.formBaBsThreshold || 5000)} ₺ · müşavir kontrol eder, resmi beyan değildir</span></div>
              <div className="babs2">
                {[{ t: 'Form Ba — Alışlar', rows: rep.formBa || [] }, { t: 'Form Bs — Satışlar', rows: rep.formBs || [] }].map((blk, bi) => (
                  <div className="babscol" key={bi}>
                    <div className="babsh">{blk.t} <span className="mu">{blk.rows.length} cari</span></div>
                    <div className="twrap">
                      <table>
                        <thead><tr><th>Cari</th><th>VKN/TCKN</th><th className="num">Belge</th><th className="num">KDV Hariç</th><th className="num">KDV</th></tr></thead>
                        <tbody>
                          {blk.rows.map((r: any, i: number) => (
                            <tr key={i}>
                              <td className="firm"><b>{r.name}</b></td>
                              <td>{r.taxNo || '—'}</td>
                              <td className="num">{r.count ?? '—'}</td>
                              <td className="num">{fmtMoney(r.base)}</td>
                              <td className="num">{fmtMoney(r.vat)}</td>
                            </tr>
                          ))}
                          {blk.rows.length === 0 && <tr><td colSpan={5}><div className="empty">Eşik üstü cari yok.</div></td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
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
      api.get('/fatura-muhasebelestirme/account-plan', { params: { taxpayerId, q: q || undefined, limit: 5000 } })
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
        <div className="ch">
          <h3>Hesap Planı{accounts.length ? <span className="cnt">{accounts.length}{q ? ' eşleşme' : ' hesap'}</span> : null}</h3>
          <div className="sp" />
          <input className="fmsel" style={{ maxWidth: 220 }} placeholder="Kod / ad ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm ghost" disabled={refreshMut.isPending} onClick={() => refreshMut.mutate()}><Ico html={I.sync} size={13} /> {refreshMut.isPending ? 'Yenileniyor…' : "Luca'dan yenile"}</button>
          <button className="btn sm primary" disabled={pushMut.isPending || localCount === 0} onClick={() => pushMut.mutate()} title={localCount === 0 ? 'Gönderilecek yerel hesap yok' : ''}><Ico html={I.send} size={13} /> {pushMut.isPending ? 'Gönderiliyor…' : `Yerelleri gönder${localCount ? ` (${localCount})` : ''}`}</button>
        </div>
        <div className="twrap planwrap">
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
#fm-root .content{padding:12px 22px;flex:1}
#fm-root .h2{font-size:16px;font-weight:700;margin-bottom:1px}
#fm-root .sub{font-size:12px;color:var(--muted);margin-bottom:9px}
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
#fm-root .detaybox{position:sticky;left:0;width:calc(100vw - 300px);max-width:1040px;box-sizing:border-box;padding:8px 14px 12px;overflow-x:auto}
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
#fm-root td.firm{max-width:230px}
#fm-root .firm b{font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .firm small{display:block;color:var(--faint);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fm-root .hk{font-family:"Consolas","SF Mono",ui-monospace,monospace;font-weight:700;color:var(--accent);font-size:13px;letter-spacing:.4px}
#fm-root .hk.no{color:var(--red)}
#fm-root .pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;white-space:nowrap;display:inline-block}
#fm-root .pill.alis{background:#eaf1ff;color:#2563eb}
#fm-root .pill.satis{background:#e7f6ec;color:#15803d}
#fm-root .pill.ok{background:#e7f6ec;color:#15803d}
#fm-root .pill.miss{background:#fdeaea;color:#c0353a}
#fm-root .pill.warn{background:#fdf2e0;color:#b45309}
#fm-root .pill.proc{background:#e6eefc;color:#2563eb}
#fm-root .ocrstrip{display:flex;flex-direction:column;gap:5px;padding:9px 16px;border-bottom:1px solid var(--line);background:#f7faff}
#fm-root .ocrbar{height:8px;border-radius:6px;background:#e6eefc;overflow:hidden;position:relative;box-shadow:inset 0 1px 2px rgba(20,40,80,.08)}
#fm-root .ocrfill{height:100%;border-radius:6px;background:linear-gradient(90deg,#2563eb,#3b82f6 55%,#22c55e);transition:width .45s cubic-bezier(.4,0,.2,1);position:relative;overflow:hidden}
#fm-root .ocrstrip.scanning .ocrfill{min-width:10px}
#fm-root .ocrstrip.scanning .ocrfill::after{content:'';position:absolute;inset:0;background-image:linear-gradient(45deg,rgba(255,255,255,.28) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.28) 50%,rgba(255,255,255,.28) 75%,transparent 75%,transparent);background-size:20px 20px;animation:ocrstripes .65s linear infinite}
#fm-root .ocrstrip.scanning .ocrfill::before{content:'';position:absolute;top:0;right:0;width:26px;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55));animation:ocrglow 1.3s ease-in-out infinite}
#fm-root .ocrstrip:not(.scanning) .ocrfill{background:linear-gradient(90deg,#ef4444,#f87171)}
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
#fm-root .dfchip .dfn{font-size:10px;font-weight:700;opacity:.7}
#fm-root .dfchip.on .dfn{opacity:.95}
#fm-root .pill.n{background:#eef1f5;color:#64748b}
#fm-root .eye{height:28px;width:28px;border-radius:7px;border:1px solid var(--line2);display:grid;place-items:center;color:var(--muted);cursor:pointer}
#fm-root .eye:hover{border-color:var(--accent);color:var(--accent)}
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
#fm-root .psel .pselpop{z-index:9000;background:#fff;border:1px solid var(--line2);border-radius:9px;box-shadow:0 12px 30px rgba(15,23,42,.18);overflow-y:auto;max-height:330px;width:max-content;max-width:min(680px,92vw);padding:4px}
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
#fm-root .csel .cselopt b{flex:0 0 auto;font-size:12px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums}
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
`;
