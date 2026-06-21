'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft, MessageSquareText, Plus, Save, Trash2, Copy, Search, Paperclip,
  Zap, Mail, MessageCircle, Check, CircleDot, Power, Sparkles, Wand2, Loader2,
  Download, Upload, Star, Send, GripVertical, X, ArrowDownUp, Clock,
} from 'lucide-react';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, aiSuggestTemplate,
  reorderTemplates, testTemplate,
  type MessageTemplate, type TemplateKanal,
} from '@/lib/message-templates';

const LINE = 'rgba(255,255,255,0.08)';
const LINE2 = 'rgba(255,255,255,0.14)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const MUTED2 = 'rgba(250,250,249,0.40)';
const ACCENT = '#34d399'; // zümrüt — şablonlar modül rengi
const CYAN = '#22d3ee';
const RED = '#f87171';
const AMBER = '#fbbf24';

const OFFICE = 'MOREN MALİ MÜŞAVİRLİK';

// Önizleme örnek verisi — placeholder'lar bununla doldurulur.
const SAMPLE: Record<string, string> = {
  ad: 'SABRİ YAŞIN',
  unvan: 'YORGUN NAKLİYAT LOJİSTİK VE DEPOLAMA TİC. LTD. ŞTİ.',
  donem: 'Şubat 2026', 'dönem': 'Şubat 2026',
  sonGun: '10 Mart 2026',
  beyannameListesi: 'KDV1 - Tahakkuk - Son Ödeme: 28.2.2026 - 791,00 TL',
  sgkListesi: 'MUHSGK - Tahakkuk - Son Ödeme: 26.2.2026 - 1.064,70 TL',
  vergiListesi: 'KDV1 - Son Ödeme: 28.2.2026 - 791,00 TL',
  sgkOdemeListesi: 'MUHSGK - Son Ödeme: 26.2.2026 - 1.064,70 TL',
  toplam: '791,00', tutar: '791,00', vade: '28.2.2026',
  bakiye: '3.500,00',
  link: 'https://www.morenmusavirlik.com/b/abc123',
  kurum: 'Gelir İdaresi Başkanlığı',
};

// Alan etiketleri — kullanıcı her {alan}'ın ne anlama geldiğini görsün.
const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'ad', label: 'Mükellef adı' },
  { key: 'unvan', label: 'Firma ünvanı' },
  { key: 'dönem', label: 'Dönem (ay/yıl)' },
  { key: 'sonGun', label: 'Son gün' },
  { key: 'beyannameListesi', label: 'Beyanname listesi' },
  { key: 'sgkListesi', label: 'SGK listesi' },
  { key: 'vergiListesi', label: 'Vergi ödeme listesi' },
  { key: 'sgkOdemeListesi', label: 'SGK ödeme listesi' },
  { key: 'toplam', label: 'Toplam tutar' },
  { key: 'tutar', label: 'Tutar' },
  { key: 'vade', label: 'Vade tarihi' },
  { key: 'bakiye', label: 'Cari bakiye' },
  { key: 'link', label: 'Mükellef bağlantısı' },
  { key: 'kurum', label: 'Kurum adı' },
];

const KATEGORILER: { key: string; label: string; color: string }[] = [
  { key: 'evrak', label: 'Evrak', color: '#34d399' },
  { key: 'beyanname', label: 'Beyanname', color: '#60a5fa' },
  { key: 'sgk', label: 'SGK', color: '#f472b6' },
  { key: 'odeme', label: 'Ödeme', color: '#fb923c' },
  { key: 'tebligat', label: 'Tebligat', color: '#a855f7' },
  { key: 'ekstre', label: 'Ekstre', color: '#22d3ee' },
  { key: 'genel', label: 'Genel', color: '#d4b876' },
];
const catInfo = (k: string) => KATEGORILER.find((c) => c.key === k) || { key: k, label: k, color: '#9ca3af' };

type SortKey = 'sira' | 'cok' | 'son' | 'ad';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'sira', label: 'Sıra' },
  { key: 'cok', label: 'En çok kullanılan' },
  { key: 'son', label: 'Son kullanım' },
  { key: 'ad', label: 'Ada göre' },
];

function renderPreview(body: string, kanal: TemplateKanal): string {
  const filled = String(body || '').replace(/\{([^\s{}]+)\}/g, (m, k) => SAMPLE[k] ?? m);
  return kanal !== 'EMAIL' ? `Gönderen: ${OFFICE}\n\n${filled}` : filled;
}

// "3 gün önce" gibi göreli zaman.
function relTime(d?: string | null): string {
  if (!d) return 'henüz gönderilmedi';
  const t = new Date(d).getTime();
  if (!t) return '—';
  const diff = Date.now() - t;
  const dk = Math.floor(diff / 60000);
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.floor(dk / 60);
  if (sa < 24) return `${sa} sa önce`;
  const gun = Math.floor(sa / 24);
  if (gun === 1) return 'dün';
  if (gun < 7) return `${gun} gün önce`;
  if (gun < 30) return `${Math.floor(gun / 7)} hafta önce`;
  if (gun < 365) return `${Math.floor(gun / 30)} ay önce`;
  return `${Math.floor(gun / 365)} yıl önce`;
}

const fieldStyle: React.CSSProperties = { borderColor: LINE, color: TEXT, background: 'rgba(255,255,255,0.03)' };
const labelCls = 'mb-1.5 block text-[11px] font-medium uppercase tracking-wider';

export default function SablonlarPage() {
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [draft, setDraft] = useState<MessageTemplate | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('sira');
  const [previewKanal, setPreviewKanal] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [testKanal, setTestKanal] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [testTarget, setTestTarget] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cleanRef = useRef<string>(''); // son kaydedilmiş halin imzası → değişiklik takibi

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await listTemplates();
      setItems(list);
    } catch { toast.error('Şablonlar yüklenemedi.'); }
    finally { setLoading(false); }
  }

  const dirty = useMemo(() => Boolean(draft) && JSON.stringify(draft) !== cleanRef.current, [draft]);

  function patch(p: Partial<MessageTemplate>) { setDraft((d) => (d ? { ...d, ...p } : d)); }

  function openEditor(t: MessageTemplate) {
    const next = { ...t };
    cleanRef.current = JSON.stringify(next);
    setDraft(next);
    setPreviewKanal(next.kanal === 'EMAIL' ? 'EMAIL' : 'WHATSAPP');
    setTestKanal(next.kanal === 'EMAIL' ? 'EMAIL' : 'WHATSAPP');
    setDrawerOpen(true);
  }

  function closeEditor() {
    if (dirty && !confirm('Kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?')) return;
    setDrawerOpen(false);
    setTimeout(() => setDraft(null), 200);
  }

  function newTemplate() {
    const fresh: MessageTemplate = {
      id: 'new-' + Date.now(), ad: 'Yeni Şablon', kanal: 'BOTH', kategori: 'genel',
      emailSubject: '', body: 'Sayın {ad},\n\n', attachPdf: false, auto: false, autoEvent: null,
      sirano: items.length, isActive: true, favori: false, kullanimSayisi: 0, sonKullanim: null,
    };
    cleanRef.current = '';
    setDraft(fresh);
    setPreviewKanal('WHATSAPP');
    setTestKanal('WHATSAPP');
    setDrawerOpen(true);
  }

  function toggleChannel(which: 'WHATSAPP' | 'EMAIL') {
    if (!draft) return;
    let wa = draft.kanal !== 'EMAIL';
    let email = draft.kanal !== 'WHATSAPP';
    if (which === 'WHATSAPP') wa = !wa; else email = !email;
    if (!wa && !email) { if (which === 'WHATSAPP') email = true; else wa = true; }
    patch({ kanal: wa && email ? 'BOTH' : wa ? 'WHATSAPP' : 'EMAIL' });
  }

  function insertText(text: string) {
    const ta = bodyRef.current;
    if (!ta || !draft) { patch({ body: (draft?.body || '') + text }); return; }
    const s = ta.selectionStart ?? draft.body.length;
    const e = ta.selectionEnd ?? draft.body.length;
    patch({ body: draft.body.slice(0, s) + text + draft.body.slice(e) });
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length; });
  }
  const insertPlaceholder = (name: string) => insertText(`{${name}}`);

  async function aiImprove(instruction: string) {
    if (!draft) return;
    if (!draft.body.trim()) { toast.error('Önce bir metin yaz ya da "AI ile yaz" kullan.'); return; }
    setAiBusy(true);
    try {
      const r = await aiSuggestTemplate({ mode: 'improve', body: draft.body, instruction, kanal: draft.kanal });
      if (r.ok && r.body) { patch({ body: r.body }); toast.success('AI önerisi uygulandı.'); }
      else toast.error(r.error || 'AI önerisi alınamadı.');
    } catch { toast.error('AI önerisi alınamadı.'); }
    finally { setAiBusy(false); }
  }

  async function aiGenerate() {
    if (!draft) return;
    if (!aiPrompt.trim()) { toast.error('Ne anlatsın yaz.'); return; }
    setAiBusy(true);
    try {
      const r = await aiSuggestTemplate({ mode: 'generate', amac: aiPrompt, kanal: draft.kanal });
      if (r.ok && r.body) {
        const setAd = Boolean(r.title) && (!draft.ad.trim() || draft.ad === 'Yeni Şablon');
        patch(setAd ? { body: r.body, ad: r.title! } : { body: r.body });
        setAiPrompt('');
        toast.success('AI şablonu oluşturdu.');
      } else toast.error(r.error || 'AI önerisi alınamadı.');
    } catch { toast.error('AI önerisi alınamadı.'); }
    finally { setAiBusy(false); }
  }

  function exportJson() {
    if (!items.length) { toast.error('Dışa aktarılacak şablon yok.'); return; }
    const data = JSON.stringify(items.map(({ id, sirano, kullanimSayisi, sonKullanim, ...rest }) => rest), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `moren-sablonlar-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${items.length} şablon dışa aktarıldı.`);
  }

  async function importJson(file: File) {
    try {
      const arr = JSON.parse(await file.text());
      if (!Array.isArray(arr)) { toast.error('Geçersiz dosya.'); return; }
      let n = 0;
      for (const t of arr) {
        if (!t || typeof t.body !== 'string') continue;
        await createTemplate({
          ad: t.ad || 'İçe aktarılan', kanal: t.kanal || 'BOTH', kategori: t.kategori || 'genel',
          emailSubject: t.emailSubject ?? null, body: t.body, attachPdf: !!t.attachPdf,
          auto: !!t.auto, autoEvent: t.autoEvent ?? null, isActive: t.isActive ?? true, favori: !!t.favori,
        });
        n++;
      }
      await load();
      toast.success(`${n} şablon içe aktarıldı.`);
    } catch { toast.error('İçe aktarılamadı (dosya bozuk olabilir).'); }
  }

  async function save() {
    if (!draft) return;
    if (!draft.ad.trim()) { toast.error('Şablon adı boş olamaz.'); return; }
    setSaving(true);
    try {
      const dto = {
        ad: draft.ad.trim(), kanal: draft.kanal, kategori: draft.kategori, emailSubject: draft.emailSubject,
        body: draft.body, attachPdf: draft.attachPdf, auto: draft.auto, autoEvent: draft.autoEvent,
        isActive: draft.isActive, favori: draft.favori ?? false,
      };
      const saved = draft.id.startsWith('new-') ? await createTemplate(dto) : await updateTemplate(draft.id, dto);
      const next = { ...saved };
      cleanRef.current = JSON.stringify(next);
      setDraft(next);
      await load();
      toast.success('Şablon kaydedildi.');
    } catch { toast.error('Kaydedilemedi.'); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!draft) return;
    if (draft.id.startsWith('new-')) { setDrawerOpen(false); setTimeout(() => setDraft(null), 200); return; }
    if (!confirm(`"${draft.ad}" şablonu silinsin mi?`)) return;
    try {
      await deleteTemplate(draft.id);
      setDrawerOpen(false); setTimeout(() => setDraft(null), 200);
      await load();
      toast.success('Şablon silindi.');
    } catch { toast.error('Silinemedi.'); }
  }

  function duplicate() {
    if (!draft) return;
    const copy: MessageTemplate = {
      ...draft, id: 'new-' + Date.now(), ad: `${draft.ad} (kopya)`,
      kullanimSayisi: 0, sonKullanim: null, favori: false,
    };
    cleanRef.current = '';
    setDraft(copy);
    toast.info('Kopya oluşturuldu — kaydetmeyi unutma.');
  }

  // Favori aç/kapat — galeride anında kaydedilir (drawer açmadan).
  async function toggleFavori(t: MessageTemplate, e: React.MouseEvent) {
    e.stopPropagation();
    if (t.id.startsWith('new-')) return;
    const yeni = !t.favori;
    setItems((arr) => arr.map((x) => (x.id === t.id ? { ...x, favori: yeni } : x)));
    if (draft?.id === t.id) patch({ favori: yeni });
    try { await updateTemplate(t.id, { favori: yeni }); }
    catch { toast.error('Favori güncellenemedi.'); await load(); }
  }

  async function sendTest() {
    if (!draft) return;
    if (draft.id.startsWith('new-')) { toast.error('Test için önce şablonu kaydet.'); return; }
    if (!testTarget.trim()) { toast.error(testKanal === 'EMAIL' ? 'E-posta adresi gir.' : 'Telefon numarası gir.'); return; }
    setTestBusy(true);
    try {
      const r = await testTemplate(draft.id, { kanal: testKanal, target: testTarget.trim() });
      if (r.ok) { toast.success('Test gönderildi.'); await load(); }
      else toast.error(r.error || 'Test gönderilemedi.');
    } catch { toast.error('Test gönderilemedi.'); }
    finally { setTestBusy(false); }
  }

  // Sürükle-bırak yalnız ham/sıralı listede (filtre yokken) anlamlı.
  const dndEnabled = sortBy === 'sira' && catFilter === 'all' && !favOnly && !search.trim();

  async function onDrop(targetId: string) {
    if (!dndEnabled || !dragId || dragId === targetId) { setDragId(null); return; }
    const arr = [...items];
    const from = arr.findIndex((x) => x.id === dragId);
    const to = arr.findIndex((x) => x.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setItems(arr);
    setDragId(null);
    try { await reorderTemplates(arr.map((x) => x.id)); }
    catch { toast.error('Sıra kaydedilemedi.'); await load(); }
  }

  // Liste filtreleme + sıralama
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    const list = items.filter((t) => {
      if (favOnly && !t.favori) return false;
      if (catFilter !== 'all' && t.kategori !== catFilter) return false;
      if (q && !t.ad.toLocaleLowerCase('tr').includes(q) && !t.body.toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
    const sorted = [...list];
    if (sortBy === 'cok') sorted.sort((a, b) => (b.kullanimSayisi ?? 0) - (a.kullanimSayisi ?? 0));
    else if (sortBy === 'son') sorted.sort((a, b) => new Date(b.sonKullanim || 0).getTime() - new Date(a.sonKullanim || 0).getTime());
    else if (sortBy === 'ad') sorted.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
    else sorted.sort((a, b) => a.sirano - b.sirano);
    return sorted;
  }, [items, search, catFilter, favOnly, sortBy]);

  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of items) m[t.kategori] = (m[t.kategori] || 0) + 1;
    return m;
  }, [items]);

  const favCount = useMemo(() => items.filter((t) => t.favori).length, [items]);

  const usedFields = useMemo(() => {
    if (!draft) return [] as string[];
    const set = new Set<string>();
    (draft.body.match(/\{([^\s{}]+)\}/g) || []).forEach((x) => set.add(x.slice(1, -1)));
    return Array.from(set);
  }, [draft]);

  const effPreviewKanal: TemplateKanal = draft
    ? (draft.kanal === 'BOTH' ? previewKanal : draft.kanal)
    : 'WHATSAPP';

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-12">
      {/* BAŞLIK — imza: radial + gökkuşağı şerit + degrade ikon */}
      <header className="relative overflow-hidden rounded-2xl border p-5" style={{
        borderColor: LINE,
        background: 'radial-gradient(120% 140% at 0% 0%, rgba(52,211,153,0.16), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(34,211,238,0.14), transparent 45%), #0f0d0b',
      }}>
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #34d399, #22d3ee, #60a5fa, #a855f7, #f472b6, #fb923c, #d4b876)' }} />
        <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: MUTED }}>
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: TEXT }}>
            <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg, #34d399, #22d3ee)', boxShadow: '0 6px 18px rgba(52,211,153,0.35)' }}>
              <MessageSquareText size={22} style={{ color: '#0a1410' }} />
            </span>
            Mesaj Şablonları
          </h1>
          <div className="flex items-center gap-2">
            <button onClick={exportJson} title="Tüm şablonları JSON yedekle" className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.03)' }}>
              <Download size={13} /> Dışa
            </button>
            <button onClick={() => fileRef.current?.click()} title="JSON'dan şablon içe aktar" className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.03)' }}>
              <Upload size={13} /> İçe
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
            <button onClick={newTemplate} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
              style={{ background: 'rgba(52,211,153,0.16)', color: ACCENT, border: '1px solid rgba(52,211,153,0.35)' }}>
              <Plus size={14} /> Yeni Şablon
            </button>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
          WhatsApp ve e-posta için kendi şablonlarını tanımla. <span style={{ color: CYAN }}>{'{ad}'}</span>, <span style={{ color: CYAN }}>{'{tutar}'}</span> gibi alanlar gönderimde mükellef verisiyle otomatik dolar.
        </p>
      </header>

      {/* ARAÇ ÇUBUĞU */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Şablon ara… (ad veya metin)"
            className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-[13px]" style={fieldStyle} />
        </div>
        <button onClick={() => setFavOnly((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold transition-colors"
          style={favOnly
            ? { borderColor: 'rgba(251,191,36,0.5)', color: AMBER, background: 'rgba(251,191,36,0.12)' }
            : { borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.03)' }}>
          <Star size={14} fill={favOnly ? AMBER : 'none'} /> Favoriler{favCount ? ` ${favCount}` : ''}
        </button>
        <div className="inline-flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.03)' }}>
          <ArrowDownUp size={14} />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="cursor-pointer bg-transparent pr-1 text-[12.5px] font-semibold outline-none" style={{ color: TEXT }}>
            {SORTS.map((s) => <option key={s.key} value={s.key} style={{ background: '#13110e', color: TEXT }}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* KATEGORİ FİLTRELERİ */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setCatFilter('all')} className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
          style={catFilter === 'all'
            ? { background: 'rgba(250,250,249,0.14)', color: TEXT, border: `1px solid ${LINE2}` }
            : { background: 'transparent', color: MUTED, border: `1px solid ${LINE}` }}>
          Tümü {items.length}
        </button>
        {KATEGORILER.filter((c) => catCounts[c.key]).map((c) => {
          const on = catFilter === c.key;
          return (
            <button key={c.key} onClick={() => setCatFilter(on ? 'all' : c.key)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{ background: on ? `${c.color}24` : 'transparent', color: on ? c.color : MUTED, border: `1px solid ${on ? `${c.color}66` : LINE}` }}>
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.label} {catCounts[c.key]}
            </button>
          );
        })}
      </div>

      {/* GALERİ */}
      {loading ? (
        <div className="grid place-items-center rounded-2xl border py-20 text-[13px]" style={{ borderColor: LINE, color: MUTED, background: '#0f0d0b' }}>
          <Loader2 size={20} className="mb-2 animate-spin" /> Yükleniyor…
        </div>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
          {filtered.map((t) => {
            const c = catInfo(t.kategori);
            const isDrag = dragId === t.id;
            return (
              <div key={t.id} onClick={() => openEditor(t)}
                draggable={dndEnabled}
                onDragStart={() => dndEnabled && setDragId(t.id)}
                onDragOver={(e) => { if (dndEnabled && dragId) e.preventDefault(); }}
                onDrop={() => onDrop(t.id)}
                className="group relative cursor-pointer overflow-hidden rounded-2xl border p-4 transition-all hover:-translate-y-0.5"
                style={{
                  borderColor: isDrag ? c.color : LINE, background: '#0f0d0b',
                  boxShadow: t.favori ? 'inset 0 0 0 1px rgba(251,191,36,0.22)' : 'none',
                  opacity: isDrag ? 0.5 : 1,
                }}>
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: c.color }} />

                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold" style={{ color: c.color }}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
                    {c.label}
                  </span>
                  <div className="flex items-center gap-2" style={{ color: MUTED }}>
                    {t.kanal !== 'EMAIL' && <MessageCircle size={14} />}
                    {t.kanal !== 'WHATSAPP' && <Mail size={14} />}
                    <button onClick={(e) => toggleFavori(t, e)} title={t.favori ? 'Favoriden çıkar' : 'Favoriye ekle'}
                      className="transition-colors" style={{ color: t.favori ? AMBER : MUTED2 }}>
                      <Star size={15} fill={t.favori ? AMBER : 'none'} />
                    </button>
                    {dndEnabled && <span title="Sürükle-sırala" className="cursor-grab active:cursor-grabbing" style={{ color: MUTED2 }} onClick={(e) => e.stopPropagation()}><GripVertical size={15} /></span>}
                  </div>
                </div>

                <h3 className="truncate text-[15px] font-semibold" style={{ color: TEXT }}>{t.ad}</h3>
                <p className="mt-1.5 text-[12.5px]" style={{ color: MUTED, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 38 }}>
                  {t.body.replace(/\s+/g, ' ').trim() || '—'}
                </p>

                {/* hover hızlı eylemler */}
                <div className="pointer-events-none absolute right-3 top-12 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); openEditor(t); setTimeout(() => document.getElementById('test-target-input')?.focus(), 250); }}
                    title="Test gönder" className="pointer-events-auto grid h-7 w-7 place-items-center rounded-lg border backdrop-blur"
                    style={{ borderColor: LINE2, background: 'rgba(15,13,11,0.9)', color: MUTED }}><Send size={13} /></button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2.5" style={{ borderColor: LINE }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {t.auto && <Badge color="#60a5fa" icon={<Zap size={10} />}>oto</Badge>}
                    {t.attachPdf && <Badge color="#f472b6" icon={<Paperclip size={10} />}>PDF</Badge>}
                    {!t.isActive && <Badge color={RED} icon={<Power size={10} />}>pasif</Badge>}
                  </div>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px]" style={{ color: MUTED2 }}>
                    <b style={{ color: ACCENT, fontWeight: 700 }}>{t.kullanimSayisi ?? 0}</b> gönderim · {relTime(t.sonKullanim)}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Yeni şablon kartı */}
          <button onClick={newTemplate} className="grid min-h-[168px] place-items-center rounded-2xl border border-dashed transition-colors hover:border-emerald-400/50"
            style={{ borderColor: LINE2, color: MUTED, background: 'transparent' }}>
            <span className="flex flex-col items-center gap-2 text-[13px] font-semibold">
              <Plus size={26} /> Yeni Şablon
            </span>
          </button>

          {!filtered.length && (
            <div className="col-span-full rounded-2xl border p-8 text-center text-[13px]" style={{ borderColor: LINE, color: MUTED, background: '#0f0d0b' }}>
              {items.length ? 'Eşleşen şablon yok.' : 'Henüz şablon yok — "Yeni Şablon" ile başla.'}
            </div>
          )}
        </div>
      )}

      {dndEnabled && filtered.length > 1 && (
        <p className="text-[11px]" style={{ color: MUTED2 }}>İpucu: Kartları sürükleyerek sıralayabilirsin. (Filtre/arama açıkken sürükleme kapalıdır.)</p>
      )}

      {/* ÇEKMECE */}
      {drawerOpen && draft && (
        <Drawer
          draft={draft} dirty={dirty} saving={saving}
          previewKanal={previewKanal} setPreviewKanal={setPreviewKanal} effPreviewKanal={effPreviewKanal}
          usedFields={usedFields} bodyRef={bodyRef}
          aiBusy={aiBusy} aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
          testKanal={testKanal} setTestKanal={setTestKanal} testTarget={testTarget} setTestTarget={setTestTarget} testBusy={testBusy}
          onClose={closeEditor} onPatch={patch} onToggleChannel={toggleChannel}
          onInsertText={insertText} onInsertPlaceholder={insertPlaceholder}
          onAiImprove={aiImprove} onAiGenerate={aiGenerate}
          onSave={save} onDuplicate={duplicate} onRemove={remove} onSendTest={sendTest}
        />
      )}
    </div>
  );
}

function Badge({ color, icon, children }: { color: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold" style={{ color, background: `${color}1f` }}>
      {icon}{children}
    </span>
  );
}

function Toggle({ on, color, icon, label, onClick }: { on: boolean; color: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-colors"
      style={on
        ? { borderColor: `${color}66`, background: `${color}1f`, color }
        : { borderColor: LINE, background: 'transparent', color: MUTED }}>
      <span className="relative inline-block h-[18px] w-[32px] rounded-full transition-colors" style={{ background: on ? `${color}88` : 'rgba(255,255,255,0.14)' }}>
        <span className="absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all" style={{ left: on ? 16 : 2, background: on ? '#0a1410' : '#9ca3af' }} />
      </span>
      <span className="grid h-4 w-4 place-items-center">{icon}</span>
      {label}
    </button>
  );
}

interface DrawerProps {
  draft: MessageTemplate; dirty: boolean; saving: boolean;
  previewKanal: 'WHATSAPP' | 'EMAIL'; setPreviewKanal: (k: 'WHATSAPP' | 'EMAIL') => void; effPreviewKanal: TemplateKanal;
  usedFields: string[]; bodyRef: React.RefObject<HTMLTextAreaElement>;
  aiBusy: boolean; aiPrompt: string; setAiPrompt: (s: string) => void;
  testKanal: 'WHATSAPP' | 'EMAIL'; setTestKanal: (k: 'WHATSAPP' | 'EMAIL') => void;
  testTarget: string; setTestTarget: (s: string) => void; testBusy: boolean;
  onClose: () => void; onPatch: (p: Partial<MessageTemplate>) => void; onToggleChannel: (w: 'WHATSAPP' | 'EMAIL') => void;
  onInsertText: (t: string) => void; onInsertPlaceholder: (n: string) => void;
  onAiImprove: (i: string) => void; onAiGenerate: () => void;
  onSave: () => void; onDuplicate: () => void; onRemove: () => void; onSendTest: () => void;
}

function Drawer(p: DrawerProps) {
  const { draft } = p;
  const isNew = draft.id.startsWith('new-');
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)' }} onClick={p.onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(960px,96vw)] overflow-hidden border-l shadow-2xl"
        style={{ borderColor: LINE2, background: '#0f0d0b' }}>
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: 'linear-gradient(180deg,#34d399,#22d3ee)' }} />

        {/* SOL — düzenleyici */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[16px] font-bold" style={{ color: TEXT }}>
              <MessageSquareText size={18} style={{ color: ACCENT }} />
              {isNew ? 'Yeni Şablon' : 'Şablon Düzenle'}
              {p.dirty && <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: AMBER }}><CircleDot size={11} /> kaydedilmedi</span>}
            </div>
            <button onClick={p.onClose} className="grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.03)' }}><X size={16} /></button>
          </div>

          <label className={labelCls} style={{ color: 'rgba(52,211,153,0.85)' }}>Şablon adı</label>
          <input className="w-full rounded-lg border px-3 py-2 text-[14px] font-semibold" style={fieldStyle} value={draft.ad} onChange={(e) => p.onPatch({ ad: e.target.value })} />

          {/* Kanal */}
          <div className="mt-4">
            <label className={labelCls} style={{ color: MUTED }}>Kanal</label>
            <div className="flex gap-1.5 rounded-xl border p-1" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.03)' }}>
              {([['WHATSAPP', MessageCircle, 'WhatsApp'], ['EMAIL', Mail, 'E-posta']] as const).map(([key, Icon, lbl]) => {
                const on = key === 'WHATSAPP' ? draft.kanal !== 'EMAIL' : draft.kanal !== 'WHATSAPP';
                return (
                  <button key={key} type="button" onClick={() => p.onToggleChannel(key)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-semibold transition-colors"
                    style={on ? { background: 'rgba(52,211,153,0.16)', color: ACCENT, boxShadow: 'inset 0 0 0 1px rgba(52,211,153,0.4)' } : { color: MUTED }}>
                    <Icon size={14} /> {lbl}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[11px]" style={{ color: MUTED }}>
              {draft.kanal === 'BOTH' ? 'WhatsApp ve e-posta birlikte gönderilir' : draft.kanal === 'WHATSAPP' ? 'Yalnızca WhatsApp' : 'Yalnızca e-posta'}
            </div>
          </div>

          {/* Kategori */}
          <div className="mt-3">
            <label className={labelCls} style={{ color: MUTED }}>Kategori</label>
            <div className="flex flex-wrap gap-1.5">
              {KATEGORILER.map((k) => {
                const on = draft.kategori === k.key;
                return (
                  <button key={k.key} type="button" onClick={() => p.onPatch({ kategori: k.key })}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
                    style={{ border: `1px solid ${on ? `${k.color}66` : LINE}`, background: on ? `${k.color}22` : 'transparent', color: on ? k.color : MUTED }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: k.color }} /> {k.label}
                  </button>
                );
              })}
            </div>
          </div>

          {draft.kanal !== 'WHATSAPP' && (
            <div className="mt-3">
              <label className={labelCls} style={{ color: MUTED }}>E-posta konusu</label>
              <input className="w-full rounded-lg border px-3 py-2 text-[14px]" style={fieldStyle} value={draft.emailSubject || ''} onChange={(e) => p.onPatch({ emailSubject: e.target.value })} placeholder="Örn. Evrak Talebi - {dönem}" />
            </div>
          )}

          {/* Mesaj metni + alan ekle */}
          <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.02)' }}>
            <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: LINE }}>
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Mesaj metni</span>
              <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>{draft.body.length} karakter</span>
            </div>
            <textarea ref={p.bodyRef} value={draft.body} onChange={(e) => p.onPatch({ body: e.target.value })}
              className="w-full border-0 bg-transparent px-3 py-2.5 text-[14px] outline-none"
              style={{ color: TEXT, minHeight: 170, lineHeight: 1.55, resize: 'vertical', fontFamily: 'inherit' }} />
            <div className="border-t px-3 py-2.5" style={{ borderColor: LINE, background: 'rgba(34,211,238,0.03)' }}>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Alan ekle — tıklayınca metne eklenir</div>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((ph) => {
                  const used = p.usedFields.includes(ph.key);
                  return (
                    <button key={ph.key} type="button" onClick={() => p.onInsertPlaceholder(ph.key)} title={ph.label}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors"
                      style={{ borderColor: used ? 'rgba(34,211,238,0.6)' : 'rgba(34,211,238,0.28)', color: CYAN, background: used ? 'rgba(34,211,238,0.16)' : 'rgba(34,211,238,0.06)' }}>
                      {used && <Check size={11} />}{`{${ph.key}}`}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px]" style={{ color: MUTED }}>Hazır parça:</span>
                {([['Selamlama', 'Sayın {ad},\n\n'], ['Kapanış', '\n\nSaygılarımızla,'], ['İmza', '\nMoren Mali Müşavirlik'], ['Teşekkür', '\n\nTeşekkür ederiz.']] as const).map(([lbl, txt]) => (
                  <button key={lbl} type="button" onClick={() => p.onInsertText(txt)} className="rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition-colors" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.03)' }}>{lbl}</button>
                ))}
              </div>
            </div>
          </div>

          {/* AI Asistan */}
          <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.06)' }}>
            <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ borderColor: 'rgba(168,85,247,0.2)', color: '#c4a3f0' }}>
              <Sparkles size={13} /> AI Asistan {p.aiBusy && <Loader2 size={12} className="animate-spin" />}
            </div>
            <div className="space-y-2.5 p-3">
              <div className="flex flex-wrap gap-1.5">
                {([['Kısalt', 'daha kısa ve öz yap'], ['Resmileştir', 'daha resmi ve kurumsal yap'], ['Samimileştir', 'daha sıcak ve samimi yap'], ['Kibarlaştır', 'daha kibar ve nazik yap'], ['Dili düzelt', 'yazım ve dil bilgisi hatalarını düzelt']] as const).map(([lbl, ins]) => (
                  <button key={lbl} type="button" disabled={p.aiBusy} onClick={() => p.onAiImprove(ins)} className="rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#c4a3f0', background: 'rgba(168,85,247,0.08)' }}>{lbl}</button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input value={p.aiPrompt} onChange={(e) => p.setAiPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') p.onAiGenerate(); }}
                  placeholder="Sıfırdan yaz: ne anlatsın? (ör. KDV iadesi için eksik evrak talebi)"
                  className="flex-1 rounded-lg border px-3 py-2 text-[13px]" style={fieldStyle} />
                <button type="button" disabled={p.aiBusy} onClick={p.onAiGenerate} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff' }}>
                  <Wand2 size={14} /> Yaz
                </button>
              </div>
              <div className="text-[11px]" style={{ color: MUTED }}>AI metni öneri olarak uygular; dilediğin gibi düzenleyebilirsin. (Max aboneliğinden — ek ücret yok.)</div>
            </div>
          </div>

          {/* Anahtarlar */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Toggle on={draft.attachPdf} color="#f472b6" icon={<Paperclip size={13} />} label="PDF ekle" onClick={() => p.onPatch({ attachPdf: !draft.attachPdf })} />
            <Toggle on={draft.auto} color="#60a5fa" icon={<Zap size={13} />} label="Otomatik gönderim" onClick={() => p.onPatch({ auto: !draft.auto })} />
            <Toggle on={draft.isActive} color={ACCENT} icon={<Power size={13} />} label={draft.isActive ? 'Aktif' : 'Pasif'} onClick={() => p.onPatch({ isActive: !draft.isActive })} />
            <Toggle on={!!draft.favori} color={AMBER} icon={<Star size={13} />} label="Favori" onClick={() => p.onPatch({ favori: !draft.favori })} />
          </div>
          {draft.auto && (
            <div className="mt-2.5 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.07)', color: '#9cc4f5' }}>
              <Zap size={12} className="mr-1 inline" /> Otomatik tetik: <strong>Evrak alındığında</strong> bu şablon mükellefe kendiliğinden gönderilir.
            </div>
          )}

          {/* TEST GÖNDER */}
          <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(52,211,153,0.28)', background: 'rgba(52,211,153,0.05)' }}>
            <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ borderColor: 'rgba(52,211,153,0.2)', color: ACCENT }}>
              <Send size={13} /> Test gönder — örnek veriyle
            </div>
            <div className="space-y-2.5 p-3">
              <div className="flex gap-1.5 rounded-lg border p-1" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.03)', maxWidth: 280 }}>
                {(['WHATSAPP', 'EMAIL'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => p.setTestKanal(k)} className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-semibold transition-colors"
                    style={p.testKanal === k ? { background: 'rgba(52,211,153,0.16)', color: ACCENT } : { color: MUTED }}>
                    {k === 'WHATSAPP' ? <MessageCircle size={13} /> : <Mail size={13} />}{k === 'WHATSAPP' ? 'WhatsApp' : 'E-posta'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input id="test-target-input" value={p.testTarget} onChange={(e) => p.setTestTarget(e.target.value)}
                  placeholder={p.testKanal === 'EMAIL' ? 'kendi@eposta.com' : '0535 058 74 75 (kendi numaran)'}
                  className="flex-1 rounded-lg border px-3 py-2 text-[13px]" style={fieldStyle} />
                <button type="button" disabled={p.testBusy || isNew} onClick={p.onSendTest} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#34d399,#22d3ee)', color: '#0a1410' }}>
                  {p.testBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Gönder
                </button>
              </div>
              <div className="text-[11px]" style={{ color: MUTED2 }}>
                {isNew ? 'Test için önce şablonu kaydet.' : 'Şablon örnek mükellef verisiyle doldurulup belirttiğin hedefe gönderilir. Mükelleflere gitmez.'}
              </div>
            </div>
          </div>

          {/* Eylemler */}
          <div className="mt-5 flex flex-wrap gap-2.5 border-t pt-4" style={{ borderColor: LINE }}>
            <button onClick={p.onSave} disabled={p.saving} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #34d399, #22d3ee)', color: '#0a1410' }}>
              <Save size={15} /> {p.saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button onClick={p.onDuplicate} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: LINE, color: TEXT, background: 'rgba(255,255,255,0.03)' }}>
              <Copy size={15} /> Kopyala
            </button>
            <button onClick={p.onRemove} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px]"
              style={{ borderColor: 'rgba(248,113,113,0.4)', color: RED, background: 'transparent' }}>
              <Trash2 size={15} /> Sil
            </button>
          </div>
        </div>

        {/* SAĞ — önizleme + istatistik */}
        <div className="hidden w-[340px] flex-shrink-0 overflow-y-auto border-l p-4 lg:block" style={{ borderColor: LINE, background: '#0b0a08' }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Canlı önizleme</span>
            {draft.kanal === 'BOTH' && (
              <div className="flex rounded-lg border p-0.5" style={{ borderColor: LINE }}>
                {(['WHATSAPP', 'EMAIL'] as const).map((k) => (
                  <button key={k} onClick={() => p.setPreviewKanal(k)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
                    style={p.previewKanal === k ? { background: 'rgba(255,255,255,0.1)', color: TEXT } : { color: MUTED }}>
                    {k === 'WHATSAPP' ? <MessageCircle size={12} /> : <Mail size={12} />}{k === 'WHATSAPP' ? 'WhatsApp' : 'E-posta'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {p.effPreviewKanal === 'WHATSAPP' ? (
            <div className="rounded-xl p-3" style={{ background: 'linear-gradient(180deg,#0c1a14,#0b141a)' }}>
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold" style={{ background: '#25d366', color: '#0a1410' }}>M</span>
                <div>
                  <div className="text-[12px] font-semibold" style={{ color: '#e9edef' }}>{OFFICE}</div>
                  <div className="text-[10px]" style={{ color: '#8aa9a0' }}>çevrimiçi</div>
                </div>
              </div>
              <div className="ml-auto max-w-[94%] rounded-[10px] rounded-br-[2px] px-3 py-2.5 text-[13.5px]" style={{ background: '#005c4b', color: '#e9edef', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                {renderPreview(draft.body, 'WHATSAPP')}
                {draft.attachPdf && <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px]" style={{ background: '#0b141a', color: '#8aa9a0' }}><Paperclip size={12} /> Belge.pdf</div>}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px]" style={{ color: '#8aa9a0' }}>
                  09:41 <Check size={11} style={{ color: '#53bdeb' }} className="-mr-1.5" /><Check size={11} style={{ color: '#53bdeb' }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl" style={{ background: '#fff', color: '#1b2230' }}>
              <div className="px-3.5 py-2.5 text-[13px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#1b3a6b,#2a5298)' }}>{OFFICE}</div>
              {draft.emailSubject && <div className="border-b px-3.5 py-2 text-[13.5px] font-bold" style={{ borderColor: '#eee' }}>{renderPreview(draft.emailSubject, 'EMAIL')}</div>}
              <div className="px-3.5 py-3 text-[13px]" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {renderPreview(draft.body, 'EMAIL')}
                {draft.attachPdf && <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px]" style={{ borderColor: '#e5e7eb', color: '#b91c1c' }}><Paperclip size={12} /> Belge.pdf (ekli)</div>}
              </div>
            </div>
          )}

          {/* İstatistik */}
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.02)' }}>
            <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Bu şablonun kullanımı</div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg border p-2.5" style={{ borderColor: LINE }}>
                <div className="text-[19px] font-extrabold tabular-nums" style={{ color: ACCENT }}>{draft.kullanimSayisi ?? 0}</div>
                <div className="mt-0.5 text-[10.5px]" style={{ color: MUTED }}>toplam gönderim</div>
              </div>
              <div className="rounded-lg border p-2.5" style={{ borderColor: LINE }}>
                <div className="inline-flex items-center gap-1 text-[14px] font-bold" style={{ color: TEXT }}><Clock size={13} style={{ color: MUTED }} /> {relTime(draft.sonKullanim)}</div>
                <div className="mt-0.5 text-[10.5px]" style={{ color: MUTED }}>son kullanım</div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
