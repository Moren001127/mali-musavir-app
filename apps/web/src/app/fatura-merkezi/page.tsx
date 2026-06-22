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
function deriveDurum(doc: any): { k: string; t: string } {
  if (doc.status === 'APPROVED') return { k: 'ok', t: 'Onaylandı' };
  // OCR/işleme henüz bitmemiş — satır yok diye "Eksik kod" demek yanıltıcı; işleniyor.
  if (doc.status === 'PROCESSING') return { k: 'proc', t: 'İşleniyor' };
  const hasCode = Array.isArray(doc.lines) && doc.lines.some((l: any) => l.accountCode);
  const issues = Array.isArray(doc.validationIssues) ? doc.validationIssues : [];
  // İçerik çelişkisi = denge/sahiplik/toplam hatası (INCOMPLETE hariç gerçek hata).
  const vissue =
    doc.validationStatus === 'INVALID' ||
    doc.ocrData?.validationStatus === 'INVALID' ||
    issues.some((i: any) => i?.code && i.code !== 'INCOMPLETE_AMOUNTS' && i?.severity !== 'WARNING');
  // Tutar eksik = matrah/KDV ayrıştırılamadı (ayrı durum, "çelişki" değil).
  const incomplete =
    doc.validationStatus === 'INCOMPLETE' ||
    doc.ocrData?.validationStatus === 'INCOMPLETE' ||
    issues.some((i: any) => i?.code === 'INCOMPLETE_AMOUNTS');
  // Öncelik: içerik çelişkisi (kritik) > tutar eksik > hesap kodu eksik.
  if (vissue) return { k: 'warn', t: 'İçerik çelişkisi' };
  if (incomplete) return { k: 'warn', t: 'Tutar eksik' };
  if (!hasCode) return { k: 'miss', t: 'Eksik hesap kodu' };
  return { k: 'ok', t: 'Muhasebeleştirilebilir' };
}
function taxpayerLabel(t: any): string {
  return t?.companyName || [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.taxNumber || 'Mükellef';
}
// Hesap kodu seçici — Mihsap gibi: KUTUNUN İÇİNE doğrudan yazılır (ayrı arama kutusu yok),
// yazdıkça altta kod/isim listesi filtrelenir; tıkla seç ya da Enter. Tek temiz ok.
function CodeSelect({ value, accounts, onChange }: { value: string; accounts: any[]; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inpRef = useRef<HTMLInputElement>(null);
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
  const list = (term
    ? accounts.filter((a) => String(a.code || '').toLocaleLowerCase('tr').includes(term) || String(a.name || '').toLocaleLowerCase('tr').includes(term))
    : accounts
  ).slice(0, 80);
  const pick = (code: string) => { onChange(code); setOpen(false); inpRef.current?.blur(); };
  return (
    <div className="csel" ref={boxRef}>
      <div className={`cselfield${open ? ' on' : ''}`} title={value ? (selName ? `${value} — ${selName}` : value) : ''}>
        <input ref={inpRef} className="cselinp" value={open ? value : (value && selName ? `${value} — ${selName}` : value)} placeholder="kod ya da isim yaz"
          onFocus={() => { setOpen(true); measure(); setTimeout(() => inpRef.current?.select(), 0); }}
          onChange={(e) => { const r = e.target.value; onChange(r.includes(' — ') ? r.split(' — ')[0].trim() : r); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); inpRef.current?.blur(); }
            else if (e.key === 'Enter') { e.preventDefault(); if (list.length === 1) pick(String(list[0].code)); else setOpen(false); }
            else if (e.key === 'ArrowDown' && !open) { setOpen(true); }
          }} />
        <span className="cselcar" onMouseDown={(e) => { e.preventDefault(); if (open) { setOpen(false); } else { setOpen(true); inpRef.current?.focus(); measure(); setTimeout(() => inpRef.current?.select(), 0); } }} />
      </div>
      {open && pos && (
        <div className="cselpop" ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}>
          <div className="csellist">
            {list.length === 0 && <div className="cselempty">Eşleşen hesap yok — yazdığın kod aynen kullanılır</div>}
            {list.map((a) => (
              <div key={a.id || a.code} className={`cselopt${String(a.code) === String(value) ? ' sel' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(String(a.code)); }}>
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
    // Sığdır: belgeyi gerçek boyutunu AŞMADAN (max %100) genişliğe oturt. Dar belge
    // büyütülmez (kullanıcı isterse + ile büyütür); geniş belge küçültülerek sığar.
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
    fitToWidth(e.currentTarget.naturalWidth || 0);
  };

  if (!doc) return null;
  const isImg = !doc.html && isImgMime;
  const frameSrc = blobUrl || rawUrl;
  const zoomStyle: any = { zoom: scale };
  const sizeStyle: any = dim.w ? { width: dim.w, height: dim.h || undefined, margin: '0 auto' } : {};
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
              ? <img className="docimg" style={zoomStyle} src={rawUrl} alt="Belge" onLoad={onImgLoad} />
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
  faturalar: 'Belgeler · <b>Alış Faturaları</b>',
  satis: 'Belgeler · <b>Satış Faturaları</b>',
  kurallar: 'Kurulum · <b>Eşleştirme Kuralları</b>',
  muhasebe: 'Belgeler · <b>Muhasebeleştir &amp; Aktar</b>',
  aktarilanlar: 'Belgeler · <b>Aktarılanlar</b>',
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
  const [screen, setScreen] = useState('mukellefler');
  const [accent, setAccent] = useState('yesil');
  const [taxpayerId, setTaxpayerId] = useState('');
  const nowP = new Date();
  const [period, setPeriod] = useState(`${nowP.getFullYear()}-${String(nowP.getMonth() + 1).padStart(2, '0')}`);
  // Belge işleme tam ekran — sol menü gizlenir, ekran tamamen editöre kalır.
  const [editorFull, setEditorFull] = useState(false);
  useEffect(() => { if (screen !== 'muhasebe') setEditorFull(false); }, [screen]);

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
      <div className={`nsub${screen === 'faturalar' ? ' on' : ''}`} onClick={() => go('faturalar')}><span className="d" /> Alış Faturaları</div>
      <div className={`nsub${screen === 'satis' ? ' on' : ''}`} onClick={() => go('satis')}><span className="d" /> Satış Faturaları</div>
      <div className={`nitem${screen === 'muhasebe' ? ' on' : ''}`} onClick={() => go('muhasebe')}><Ico html={I.ledger} /> Muhasebeleştir {badge(sum.pending)}</div>
      <div className={`nitem${screen === 'aktarilanlar' ? ' on' : ''}`} onClick={() => go('aktarilanlar')}><Ico html={I.check} /> Aktarılanlar {badge(sum.posted)}</div>

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
            {(screen === 'faturalar' || screen === 'satis') && <ScreenFaturalar taxpayerId={taxpayerId} period={period} kind={screen === 'satis' ? 'SATIS' : 'ALIS'} />}
            {screen === 'mukellefler' && <ScreenMukellefler taxpayers={taxpayers} period={period} onOpen={(id) => { setTaxpayerId(id); setScreen('faturalar'); }} />}
            {screen === 'kurallar' && <ScreenKurallar taxpayerId={taxpayerId} period={period} />}
            {screen === 'muhasebe' && <ScreenMuhasebe taxpayerId={taxpayerId} period={period} isIsletme={String(taxpayers.find((t) => t.id === taxpayerId)?.defterTuru || '').toUpperCase() === 'ISLETME'} taxpayerNace={(taxpayers.find((t) => t.id === taxpayerId) as any)?.naceKodu || ''} taxpayerFaaliyet={(taxpayers.find((t) => t.id === taxpayerId) as any)?.faaliyetAciklama || ''} taxpayerAd={(() => { const t = taxpayers.find((x) => x.id === taxpayerId); return t ? taxpayerLabel(t) : ''; })()} full={editorFull} onToggleFull={() => setEditorFull((v) => !v)} />}
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
                    <td className="actcol" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="eye" onClick={() => openDocFile(d.id)} title="Belgeyi aç"><Ico html={I.eye} size={15} /></span>
                      <span className="eye del" title="Belgeyi sil" onClick={() => { if (window.confirm(`Bu belge silinsin mi?\n${firma} · ${fmtMoney(d.totalAmount)} ₺${d.belgeNo ? ' · ' + d.belgeNo : ''}`)) delMut.mutate(d.id); }}><Ico html={I.trash} size={14} /></span>
                    </td>
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
                <div className="lx"><b>{firma}</b> — {du.k === 'miss' ? 'hesap kodu atanmamış, elle ya da öğrenmeyle atanmalı.' : du.t === 'Tutar eksik' ? 'matrah/KDV ayrıştırılamadı, tutar girilmeli.' : 'içerik geçmişle çelişiyor, kontrol gerekiyor.'} <small style={{ color: 'var(--faint)' }}>{d.belgeNo ? `· ${d.belgeNo}` : ''} · {fmtMoney(d.totalAmount)} ₺</small></div>
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
  const [blobUrl, setBlobUrl] = useState(''); // XML data: URL → blob (same-origin, ölçülebilir + XSLT render)
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
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
      // 3) Genişliğe sığdır oranı.
      const paneW = (w.clientWidth || 600) - 16;
      setFit(Math.min(1, Math.max(0.3, paneW / cw)));
    } catch { /* cross-origin */ }
  };
  // Görseller geç yüklendiğinden birkaç kez yeniden ölç.
  const onFrameLoad = () => { measure(); setTimeout(measure, 250); setTimeout(measure, 900); setTimeout(measure, 2000); };
  useEffect(() => {
    let alive = true;
    setD(null); setZoom(1); setFit(1);
    api.get(`/fatura-muhasebelestirme/documents/${id}/file-url`)
      .then((r) => { if (alive) setD(r.data || {}); })
      .catch(() => { if (alive) setD({}); });
    return () => { alive = false; };
  }, [id]);
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
  // zoom = çarpan (1 = Sığdır = %100 = tüm fatura). Gerçek ölçek = taban(fit/contain) × zoom.
  const appliedScale = (html || isXml ? fit : 1) * zoom;
  const canZoom = html || isImg || isXml;
  const dz = (delta: number) => setZoom((z) => Math.min(5, Math.max(0.25, Math.round((z + delta) * 100) / 100)));
  return (
    <div className="belgebox">
      <div className="bpbar">
        <span>Belge</span>
        <div className="bpzoom">
          {canZoom ? (
            <>
              <button type="button" onClick={() => dz(-0.25)} title="Uzaklaştır">−</button>
              <span className="bpz">{Math.round(appliedScale * 100)}%</span>
              <button type="button" onClick={() => dz(0.25)} title="Yakınlaştır">+</button>
              <button type="button" onClick={() => setZoom(1)} title="Tümünü sığdır (%100)">Sığdır</button>
            </>
          ) : null}
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" title="Yeni sekmede aç">↗</a> : null}
        </div>
      </div>
      <div ref={wrapRef} className="bpview" style={{ overflow: 'auto' }}>
        {html
          ? <iframe ref={frameRef} onLoad={onFrameLoad} className="bpframe-h" srcDoc={htmlDoc} title="Belge" sandbox="allow-same-origin" scrolling="no" style={{ zoom: appliedScale } as any} />
          : isImg
            ? <img className="bpimg" src={url} alt="Belge" style={{ zoom: appliedScale } as any} />
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
  const hasCode = (d: any) => Array.isArray(d.lines) && d.lines.some((l: any) => l.accountCode);
  const hasAmount = (d: any) => { const p = kdvParts(d); return (Number(p.matrah) || 0) > 0 || (Number(p.kdv) || 0) > 0 || Number(d.totalAmount) > 0; };
  // İşletme defterinde hesap kodu yok — hazır olma şartı belgenin tutarının olması.
  const ready = (d: any) => (isIsletme ? hasAmount(d) : hasCode(d));
  const hazir = allF.filter((d) => d.status !== 'APPROVED' && ready(d));
  const eksik = allF.filter((d) => d.status !== 'APPROVED' && !ready(d));

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
      return api.patch(`/fatura-muhasebelestirme/documents/${selDoc.id}`, {
        faturaTarihi: meta.faturaTarihi || undefined,
        invoiceKind: meta.invoiceKind,
        documentType: meta.documentType || undefined,
        belgeNo: meta.belgeNo || undefined,
        ...(isSale
          ? { buyerVkn: meta.vkn || undefined, customerName: meta.cariUnvan || undefined }
          : { sellerVkn: meta.vkn || undefined, vendorName: meta.cariUnvan || undefined }),
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
    onSuccess: () => { toast.success('Fiş satırları kaydedildi · satıcı kodu öğrenildi'); qc.invalidateQueries({ queryKey: ['fm2'] }); },
    onError: (e: any) => toast.error('Kaydedilemedi: ' + (e?.response?.data?.message || e?.message || 'hata')),
  });
  const gg = selDoc ? kdvParts(selDoc) : { matrah: null, kdv: null };
  const ggReady = isIsletme ? ((Number(gg.matrah) || 0) > 0 || (Number(gg.kdv) || 0) > 0 || Number(selDoc?.totalAmount) > 0) : dengeli;

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
      <div className="card" style={{ padding: 0, marginTop: 2 }}>
        <div className="wmain">
            {selDoc ? (
              <>
                <div className="fiseditor">
                <div className="belgepane"><InlineBelge id={selDoc.id} /></div>
                <div className="fispane">
                <div className="ph">{firmaOf(selDoc)} · {selDoc.invoiceKind === 'SATIS' ? 'Satış' : 'Alış'} faturası <span className="mu">{selDoc.belgeNo || ''}</span><div className="sp" /><button type="button" className="fifull" onClick={() => onToggleFull?.()} title={full ? 'Küçült — menüyü geri getir' : 'Büyüt — menüyü gizle, tam ekran işle'}><Ico html={full ? I.compress : I.expand} size={14} /><span>{full ? 'Küçült' : 'Büyüt'}</span></button></div>
                {!isIsletme && (taxpayerAd || taxpayerNace || taxpayerFaaliyet) && (
                  <div className="sektorbar" title="Hesap kodu eşleştirmesi mükellefin bu işine göre yapılır — düzeltmek için Mükellefler → mükellef detayı → Faaliyet/Sektör">
                    <Ico html={I.info} size={12} /><span>Mükellef: <b>{taxpayerAd || '—'}</b>{taxpayerFaaliyet ? <> · faaliyet: <b>{taxpayerFaaliyet}</b></> : (taxpayerNace ? <> · NACE <b>{taxpayerNace}</b></> : <> · <i>faaliyet/sektör girilmemiş — Mükellef detayından gir</i></>)} · {isIsletme ? 'İşletme' : 'Bilanço'} — eşleştirme bu işe göre</span>
                  </div>
                )}
                <div className="docmeta">
                  <div className="dm"><span className="dml">Tarih</span><input className="dmi" type="date" value={meta.faturaTarihi || ''} onChange={(e) => setMeta({ ...meta, faturaTarihi: e.target.value })} /></div>
                  <div className="dm"><span className="dml">Fatura Türü</span>
                    <PlainSelect value={`${meta.invoiceKind || 'ALIS'}${meta.tevkifatli ? '_TEV' : ''}`} onChange={(v) => setMeta({ ...meta, invoiceKind: v.startsWith('SATIS') ? 'SATIS' : 'ALIS', tevkifatli: v.endsWith('_TEV') })} options={[
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
                      { value: 'OKC_FIS', label: 'ÖKC Fiş' },
                      { value: 'DIGER', label: 'Diğer' },
                    ]} />
                  </div>
                  <div className="dm"><span className="dml">Belge No</span><input className="dmi" value={meta.belgeNo || ''} onChange={(e) => setMeta({ ...meta, belgeNo: e.target.value })} /></div>
                  <div className="dm"><span className="dml">{String(meta.invoiceKind).includes('SATIS') ? 'Alıcı VKN' : 'Satıcı VKN'}</span><input className="dmi" value={meta.vkn || ''} onChange={(e) => setMeta({ ...meta, vkn: e.target.value })} /></div>
                  <div className="dm"><span className="dml">Cari Ünvanı</span><input className="dmi" value={meta.cariUnvan || ''} placeholder="satıcı/alıcı ünvanı" onChange={(e) => setMeta({ ...meta, cariUnvan: e.target.value })} /></div>
                </div>
                {meta.tevkifatli && !isIsletme && (
                  <div className="tevpanel">
                    <span className="tlbl">Tevkifat</span>
                    <div style={{ maxWidth: 110, flex: '0 0 110px' }}><PlainSelect value={String(meta.kdvRate || 20)} onChange={(v) => setMeta({ ...meta, kdvRate: Number(v) })} options={[{ value: '20', label: 'KDV %20' }, { value: '10', label: 'KDV %10' }, { value: '1', label: 'KDV %1' }]} /></div>
                    <div style={{ maxWidth: 90, flex: '0 0 90px' }}><PlainSelect value={String(meta.tevkifatPay || 5)} onChange={(v) => setMeta({ ...meta, tevkifatPay: Number(v) })} options={[2, 3, 4, 5, 7, 9, 10].map((p) => ({ value: String(p), label: `${p}/10` }))} /></div>
                    <button className="btn sm primary" disabled={applyTevkifatMut.isPending} onClick={() => applyTevkifatMut.mutate()}>{applyTevkifatMut.isPending ? 'Kuruluyor…' : 'Tevkifat fişini kur'}</button>
                    <span className="tnote">2×191 (normal + sorumlu sıf.) + 360 (KDV2) fişi oluşturur</span>
                  </div>
                )}
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
                    <div className="fgrps">
                      {(String(selDoc.invoiceKind || '').includes('SATIS')
                        ? [
                            // SATIŞ: matrah(600)+KDV(391) ALACAK, cari(120) BORÇ
                            { key: 'matrah', label: 'Matrah (Gelir)', side: 'credit' as const },
                            { key: 'vergi', label: 'Hesaplanan KDV', side: 'credit' as const },
                            { key: 'cari', label: 'Cari Hesap', side: 'debit' as const },
                          ]
                        : [
                            // ALIŞ: matrah+KDV BORÇ, cari ALACAK
                            { key: 'matrah', label: 'Matrah', side: 'debit' as const },
                            { key: 'vergi', label: 'İndirilecek KDV', side: 'debit' as const },
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
                                <CodeSelect value={l.accountCode || ''} accounts={accountPlan} onChange={(code) => setLine(i, 'accountCode', code)} />
                                {g.key !== 'cari'
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
                    <Ico html={I.checkSm} size={16} /><b>Gelir-Gider girişi</b>
                    <span className="bnote">{selDoc.invoiceKind === 'SATIS' ? 'Gelir' : 'Gider'} {fmtMoney(gg.matrah || 0)} ₺ + KDV {fmtMoney(gg.kdv || 0)} ₺ · hesap kodu yok</span>
                  </div>
                ) : (
                  <div className="balance" style={!dengeli ? { background: '#fdeaea', borderColor: '#f3c9c9' } : undefined}>
                    <Ico html={I.checkSm} size={16} /><b style={!dengeli ? { color: '#c0353a' } : undefined}>{dengeli ? 'Denge tamam' : 'Denge tutmuyor'}</b>
                    <span className="bnote">Borç {fmtMoney(borc)} {dengeli ? '=' : '≠'} Alacak {fmtMoney(alacak)} ₺</span>
                  </div>
                )}
                <div className="wactions">
                  <div className="sp" />
                  <button className="btn sm" disabled={saveMetaMut.isPending || saveLinesMut.isPending} title="Bilgileri ve satırları kaydet (Luca'ya GÖNDERMEZ)"
                    onClick={async () => { try { await saveMetaMut.mutateAsync(); if (!isIsletme) await saveLinesMut.mutateAsync(); } catch { /* mutasyon kendi hatasını gösterir */ } }}>
                    <Ico html={I.checkSm} size={13} /> {(saveMetaMut.isPending || saveLinesMut.isPending) ? 'Kaydediliyor…' : 'Kaydet'}
                  </button>
                  <button className="btn primary sm" disabled={approveMut.isPending || saveMetaMut.isPending || saveLinesMut.isPending || !ggReady} title="Kaydet + Onayla (aktarıma hazır). Luca'ya aktarım AKTARILANLAR ekranından toplu yapılır."
                    onClick={async () => { try { await saveMetaMut.mutateAsync(); if (!isIsletme) await saveLinesMut.mutateAsync(); if (selDoc) approveMut.mutate(selDoc.id); } catch { /* atla */ } }}>
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
          <span className="amini">Luca'ya aktarım → <b>Aktarılanlar</b> ekranından</span>
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
  // Onaylı ama Luca'ya henüz aktarılmamış belgeler — alış/satış ayrı fiş olarak aktarılır.
  const aktarilabilir = all.filter((d) => d.status === 'APPROVED' && !['POSTED', 'POSTING', 'QUEUED'].includes(d.lucaStatus));
  const bekAlis = aktarilabilir.filter((d) => (d.invoiceKind || 'ALIS') !== 'SATIS').length;
  const bekSatis = aktarilabilir.filter((d) => (d.invoiceKind || 'ALIS') === 'SATIS').length;
  const batchMut = useMutation({
    mutationFn: () => api.post('/fatura-muhasebelestirme/batch-post-to-luca', { taxpayerId, period }),
    onSuccess: (r: any) => {
      const d = r?.data || {};
      toast.success(`Luca'ya aktarım başlatıldı · ${d.documentCount ?? 0} belge${d.skippedInvalid ? ` · ${d.skippedInvalid} veri hatası nedeniyle hariç` : ''}. Ajan açıkken işlenir (alış/satış ayrı fiş).`);
      qc.invalidateQueries({ queryKey: ['fm2'] });
    },
    onError: (e: any) => toast.error("Luca'ya aktarılamadı: " + (e?.response?.data?.message || e?.message || 'hata')),
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
      <div className="h2">Aktarılanlar — Luca'ya Aktarım</div>
      <div className="sub">Onaylı fişleri {period} döneminde Luca'ya aktar (alış/satış ayrı fiş olarak gider). Üstten dönem seçilir.</div>
      <div className="aktarbar">
        <div className="akbil">{aktarilabilir.length > 0
          ? <><b>{aktarilabilir.length}</b> onaylı belge aktarıma hazır · <span className="pill alis">Alış {bekAlis}</span> <span className="pill satis">Satış {bekSatis}</span></>
          : <>Aktarılacak onaylı belge yok. Muhasebeleştir'de <b>Kaydet ve Onayla</b> yap; sonra burada toplu Luca'ya aktar (alış/satış ayrı fiş).</>}</div>
        <div className="sp" />
        <button className="btn primary" disabled={batchMut.isPending || aktarilabilir.length === 0} onClick={() => batchMut.mutate()}>
          <Ico html={I.send} size={14} /> {batchMut.isPending ? 'Aktarılıyor…' : `Luca'ya Aktar${aktarilabilir.length ? ` (${aktarilabilir.length})` : ''}`}
        </button>
      </div>
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
#fm-root .planwrap .hk{font-size:11.5px}
#fm-root .planwrap .pill{padding:1px 7px;font-size:10px}
#fm-root .ch h3 .cnt{margin-left:8px;padding:1px 8px;border-radius:20px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:700;vertical-align:middle}
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
#fm-root .pill.proc{background:#e6eefc;color:#2563eb}
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
#fm-root .ph{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:12px}
#fm-root .docmeta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 14px;padding:11px 13px;margin-bottom:14px;background:#fbfcfd;border:1px solid var(--line);border-radius:10px}
#fm-root .docmeta .dm{display:flex;flex-direction:column;gap:1px}
#fm-root .docmeta .dml{font-size:10px;font-weight:700;color:var(--faint);text-transform:uppercase;letter-spacing:.4px}
#fm-root .docmeta .dmv{font-size:13px;font-weight:600;color:var(--text)}
#fm-root .docmeta .dmi{width:100%;height:30px;padding:0 8px;border:1px solid var(--line2);border-radius:7px;font-size:13px;font-weight:600;color:var(--text);background:#fff;font-family:inherit}
#fm-root .docmeta .dmi:focus{outline:none;border-color:var(--accent)}
/* Temiz açılır liste (native siyah select yerine) */
#fm-root .psel{position:relative;width:100%}
#fm-root .psel .pselfield{display:flex;align-items:center;gap:6px;height:30px;border:1px solid var(--line2);border-radius:7px;background:#fff;padding:0 9px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text)}
#fm-root .psel .pselfield.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
#fm-root .psel .pselfield > span:first-child{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fm-root .psel .pselfield .ph{color:#9aa6b2;font-weight:400}
#fm-root .psel .pselcar{flex:0 0 auto;width:7px;height:7px;border-right:1.6px solid #94a3b2;border-bottom:1.6px solid #94a3b2;transform:rotate(45deg) translateY(-2px);transition:transform .15s,border-color .15s}
#fm-root .psel .pselfield.on .pselcar{transform:rotate(-135deg) translateY(2px);border-color:var(--accent)}
#fm-root .psel .pselpop{z-index:9000;background:#fff;border:1px solid var(--line2);border-radius:9px;box-shadow:0 12px 30px rgba(15,23,42,.18);overflow:hidden;padding:4px}
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
#fm-root .fgrps{display:flex;flex-direction:column;gap:12px}
#fm-root .fgrp{border:1px solid var(--line2);border-radius:10px;overflow:hidden}
#fm-root .fgrp .fgh{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;background:var(--th);color:var(--th-text);font-size:11.5px;font-weight:700}
#fm-root .fgrp .fgh .fgs{font-size:9.5px;opacity:.85;text-transform:uppercase;letter-spacing:.4px}
#fm-root .fgrp .frow{display:flex;align-items:center;gap:6px;padding:4px 10px;border-top:1px solid var(--line)}
#fm-root .fgrp .frow .li{height:27px}
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
#fm-root .fgrp .fgt{display:flex;justify-content:space-between;padding:5px 10px;border-top:1px solid var(--line2);background:#fbfcfd;font-size:12px}
#fm-root .fgrp .fgt b{font-weight:800}
#fm-root .fgrp .frow .frowdel{width:22px;height:22px;flex:0 0 22px;border:1px solid var(--line2);border-radius:6px;background:#fff;color:var(--red);font-size:15px;font-weight:700;cursor:pointer;line-height:1;display:grid;place-items:center}
#fm-root .fgrp .frow .frowdel:hover{background:#fdeaea;border-color:#f3c9c9}
#fm-root .fgrp .frowadd{padding:4px 10px;border-top:1px dashed var(--line2);color:var(--accent);font-size:11.5px;font-weight:700;cursor:pointer}
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
#fm-root .belgepane{flex:0 0 58%;max-width:58%;position:sticky;top:8px}
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
