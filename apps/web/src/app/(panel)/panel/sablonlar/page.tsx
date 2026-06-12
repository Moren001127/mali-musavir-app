'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft, MessageSquareText, Plus, Save, Trash2, Copy, Search, Paperclip,
  Zap, Mail, MessageCircle, Check, CircleDot, Power, Sparkles, Wand2, Loader2,
  Download, Upload,
} from 'lucide-react';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, aiSuggestTemplate,
  type MessageTemplate, type TemplateKanal,
} from '@/lib/message-templates';

const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const ACCENT = '#34d399'; // zümrüt — şablonlar modül rengi
const CYAN = '#22d3ee';
const RED = '#f87171';

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

function renderPreview(body: string, kanal: TemplateKanal): string {
  // {dönem} gibi Türkçe karakterli alanları da yakalar.
  const filled = String(body || '').replace(/\{([^\s{}]+)\}/g, (m, k) => SAMPLE[k] ?? m);
  return kanal !== 'EMAIL' ? `Gönderen: ${OFFICE}\n\n${filled}` : filled;
}

const fieldStyle: React.CSSProperties = { borderColor: LINE, color: TEXT, background: 'rgba(255,255,255,0.03)' };
const labelCls = 'mb-1 block text-[11px] font-medium uppercase tracking-wider';

export default function SablonlarPage() {
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [draft, setDraft] = useState<MessageTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [previewKanal, setPreviewKanal] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cleanRef = useRef<string>(''); // son kaydedilmiş/yüklenmiş halin imzası → değişiklik takibi

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await listTemplates();
      setItems(list);
      setDraft((cur) => {
        if (cur) return cur;
        const first = list[0] ? { ...list[0] } : null;
        if (first) cleanRef.current = JSON.stringify(first);
        return first;
      });
    } catch { toast.error('Şablonlar yüklenemedi.'); }
    finally { setLoading(false); }
  }

  const dirty = useMemo(() => Boolean(draft) && JSON.stringify(draft) !== cleanRef.current, [draft]);

  function selectTemplate(t: MessageTemplate) {
    if (dirty && !confirm('Kaydedilmemiş değişiklikler var. Yine de bu şablona geçilsin mi?')) return;
    const next = { ...t };
    cleanRef.current = JSON.stringify(next);
    setDraft(next);
    setPreviewKanal(next.kanal === 'EMAIL' ? 'EMAIL' : 'WHATSAPP');
  }

  function patch(p: Partial<MessageTemplate>) { setDraft((d) => (d ? { ...d, ...p } : d)); }

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
      if (r.ok && r.body) { patch({ body: r.body }); setAiPrompt(''); toast.success('AI şablonu oluşturdu.'); }
      else toast.error(r.error || 'AI önerisi alınamadı.');
    } catch { toast.error('AI önerisi alınamadı.'); }
    finally { setAiBusy(false); }
  }

  function exportJson() {
    if (!items.length) { toast.error('Dışa aktarılacak şablon yok.'); return; }
    const data = JSON.stringify(items.map(({ id, sirano, ...rest }) => rest), null, 2);
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
          auto: !!t.auto, autoEvent: t.autoEvent ?? null, isActive: t.isActive ?? true,
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
        body: draft.body, attachPdf: draft.attachPdf, auto: draft.auto, autoEvent: draft.autoEvent, isActive: draft.isActive,
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
    if (draft.id.startsWith('new-')) { const f = items[0] ? { ...items[0] } : null; if (f) cleanRef.current = JSON.stringify(f); setDraft(f); return; }
    if (!confirm(`"${draft.ad}" şablonu silinsin mi?`)) return;
    try { await deleteTemplate(draft.id); cleanRef.current = ''; setDraft(null); await load(); toast.success('Şablon silindi.'); }
    catch { toast.error('Silinemedi.'); }
  }

  function duplicate() {
    if (!draft) return;
    setDraft({
      ...draft, id: 'new-' + Date.now(), ad: `${draft.ad} (kopya)`,
    });
    cleanRef.current = ''; // kopya kaydedilene kadar "değişti" sayılır
    toast.info('Kopya oluşturuldu — kaydetmeyi unutma.');
  }

  function newTemplate() {
    if (dirty && !confirm('Kaydedilmemiş değişiklikler var. Yeni şablon açılsın mı?')) return;
    const fresh: MessageTemplate = {
      id: 'new-' + Date.now(), ad: 'Yeni Şablon', kanal: 'BOTH', kategori: 'genel',
      emailSubject: '', body: 'Sayın {ad},\n\n', attachPdf: false, auto: false, autoEvent: null,
      sirano: items.length, isActive: true,
    };
    cleanRef.current = '';
    setDraft(fresh);
    setPreviewKanal('WHATSAPP');
  }

  // Liste filtreleme
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    return items.filter((t) => {
      if (catFilter !== 'all' && t.kategori !== catFilter) return false;
      if (q && !t.ad.toLocaleLowerCase('tr').includes(q)) return false;
      return true;
    });
  }, [items, search, catFilter]);

  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of items) m[t.kategori] = (m[t.kategori] || 0) + 1;
    return m;
  }, [items]);

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

      <div className="grid gap-4 lg:grid-cols-[290px_1fr_400px]">

        {/* SOL — liste + arama + filtre */}
        <section className="flex flex-col gap-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Şablon ara…"
              className="w-full rounded-xl border py-2.5 pl-9 pr-3 text-[13px]" style={fieldStyle}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setCatFilter('all')} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
              style={catFilter === 'all'
                ? { background: 'rgba(250,250,249,0.14)', color: TEXT, border: `1px solid ${LINE}` }
                : { background: 'transparent', color: MUTED, border: `1px solid ${LINE}` }}>
              Tümü {items.length}
            </button>
            {KATEGORILER.filter((c) => catCounts[c.key]).map((c) => {
              const on = catFilter === c.key;
              return (
                <button key={c.key} onClick={() => setCatFilter(on ? 'all' : c.key)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
                  style={{ background: on ? `${c.color}24` : 'transparent', color: on ? c.color : MUTED, border: `1px solid ${on ? `${c.color}66` : LINE}` }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                  {c.label} {catCounts[c.key]}
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border p-2" style={{ borderColor: LINE, background: '#0f0d0b' }}>
            {loading ? <div className="p-3 text-[13px]" style={{ color: MUTED }}>Yükleniyor…</div> :
              filtered.map((t) => {
                const sel = draft?.id === t.id;
                const c = catInfo(t.kategori);
                return (
                  <button key={t.id} onClick={() => selectTemplate(t)} className="mb-1 block w-full rounded-xl px-3 py-2.5 text-left transition-colors"
                    style={{ background: sel ? 'rgba(52,211,153,0.12)' : 'transparent', border: `1px solid ${sel ? 'rgba(52,211,153,0.4)' : 'transparent'}` }}>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color, boxShadow: `0 0 7px ${c.color}80` }} />
                      <span className="truncate text-[13.5px] font-semibold" style={{ color: sel ? ACCENT : TEXT }}>{t.ad}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-[18px] text-[11px]" style={{ color: MUTED }}>
                      <span style={{ color: c.color }}>{c.label}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5">{t.kanal === 'EMAIL' ? <Mail size={10} /> : t.kanal === 'WHATSAPP' ? <MessageCircle size={10} /> : <><MessageCircle size={10} /><Mail size={10} /></>}</span>
                      {t.auto && <span className="inline-flex items-center gap-0.5" style={{ color: '#60a5fa' }}><Zap size={10} /> oto</span>}
                      {t.attachPdf && <span className="inline-flex items-center gap-0.5" style={{ color: '#f472b6' }}><Paperclip size={10} /> PDF</span>}
                      {!t.isActive && <span className="inline-flex items-center gap-0.5" style={{ color: RED }}><Power size={10} /> pasif</span>}
                    </div>
                  </button>
                );
              })}
            {!loading && !filtered.length && <div className="p-3 text-[13px]" style={{ color: MUTED }}>{items.length ? 'Eşleşen şablon yok.' : 'Şablon yok.'}</div>}
          </div>
        </section>

        {/* ORTA — düzenleyici */}
        <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: 'linear-gradient(135deg, rgba(52,211,153,0.06), rgba(34,211,238,0.03) 60%, transparent)' }}>
          {!draft ? <div className="text-[13px]" style={{ color: MUTED }}>Soldan bir şablon seç ya da "Yeni Şablon" ekle.</div> : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <label className={labelCls} style={{ color: 'rgba(52,211,153,0.85)' }}>Şablon adı</label>
                {dirty && <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#fbbf24' }}><CircleDot size={11} /> kaydedilmedi</span>}
              </div>
              <input className="w-full rounded-lg border px-3 py-2 text-[14px] font-semibold" style={fieldStyle} value={draft.ad} onChange={(e) => patch({ ad: e.target.value })} />

              {/* Kanal — iki yönlü ikon segmenti */}
              <div className="mt-4">
                <label className={labelCls} style={{ color: MUTED }}>Kanal</label>
                <div className="flex gap-1.5 rounded-xl border p-1" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.03)' }}>
                  {([['WHATSAPP', MessageCircle, 'WhatsApp'], ['EMAIL', Mail, 'E-posta']] as const).map(([key, Icon, lbl]) => {
                    const on = key === 'WHATSAPP' ? draft.kanal !== 'EMAIL' : draft.kanal !== 'WHATSAPP';
                    return (
                      <button key={key} type="button" onClick={() => toggleChannel(key)}
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

              {/* Kategori — renkli çipler */}
              <div className="mt-3">
                <label className={labelCls} style={{ color: MUTED }}>Kategori</label>
                <div className="flex flex-wrap gap-1.5">
                  {KATEGORILER.map((k) => {
                    const on = draft.kategori === k.key;
                    return (
                      <button key={k.key} type="button" onClick={() => patch({ kategori: k.key })}
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
                  <input className="w-full rounded-lg border px-3 py-2 text-[14px]" style={fieldStyle} value={draft.emailSubject || ''} onChange={(e) => patch({ emailSubject: e.target.value })} placeholder="Örn. Evrak Talebi - {dönem}" />
                </div>
              )}

              {/* Mesaj metni + alan ekle tek kart */}
              <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.02)' }}>
                <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: LINE }}>
                  <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Mesaj metni</span>
                  <span className="text-[11px] tabular-nums" style={{ color: MUTED }}>{draft.body.length} karakter</span>
                </div>
                <textarea ref={bodyRef} value={draft.body} onChange={(e) => patch({ body: e.target.value })}
                  className="w-full border-0 bg-transparent px-3 py-2.5 text-[14px] outline-none"
                  style={{ color: TEXT, minHeight: 180, lineHeight: 1.55, resize: 'vertical', fontFamily: 'inherit' }} />
                <div className="border-t px-3 py-2.5" style={{ borderColor: LINE, background: 'rgba(34,211,238,0.03)' }}>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Alan ekle — tıklayınca metne eklenir</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map((p) => {
                      const used = usedFields.includes(p.key);
                      return (
                        <button key={p.key} type="button" onClick={() => insertPlaceholder(p.key)} title={p.label}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors"
                          style={{ borderColor: used ? 'rgba(34,211,238,0.6)' : 'rgba(34,211,238,0.28)', color: CYAN, background: used ? 'rgba(34,211,238,0.16)' : 'rgba(34,211,238,0.06)' }}>
                          {used && <Check size={11} />}{`{${p.key}}`}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px]" style={{ color: MUTED }}>Hazır parça:</span>
                    {([['Selamlama', 'Sayın {ad},\n\n'], ['Kapanış', '\n\nSaygılarımızla,'], ['İmza', '\nMoren Mali Müşavirlik'], ['Teşekkür', '\n\nTeşekkür ederiz.']] as const).map(([lbl, txt]) => (
                      <button key={lbl} type="button" onClick={() => insertText(txt)} className="rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition-colors" style={{ borderColor: LINE, color: MUTED, background: 'rgba(255,255,255,0.03)' }}>{lbl}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI Asistan */}
              <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.06)' }}>
                <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ borderColor: 'rgba(168,85,247,0.2)', color: '#c4a3f0' }}>
                  <Sparkles size={13} /> AI Asistan {aiBusy && <Loader2 size={12} className="animate-spin" />}
                </div>
                <div className="space-y-2.5 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {([['Kısalt', 'daha kısa ve öz yap'], ['Resmileştir', 'daha resmi ve kurumsal yap'], ['Samimileştir', 'daha sıcak ve samimi yap'], ['Kibarlaştır', 'daha kibar ve nazik yap'], ['Dili düzelt', 'yazım ve dil bilgisi hatalarını düzelt']] as const).map(([lbl, ins]) => (
                      <button key={lbl} type="button" disabled={aiBusy} onClick={() => aiImprove(ins)} className="rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#c4a3f0', background: 'rgba(168,85,247,0.08)' }}>{lbl}</button>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aiGenerate(); }}
                      placeholder="Sıfırdan yaz: ne anlatsın? (ör. KDV iadesi için eksik evrak talebi)"
                      className="flex-1 rounded-lg border px-3 py-2 text-[13px]" style={fieldStyle} />
                    <button type="button" disabled={aiBusy} onClick={aiGenerate} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff' }}>
                      <Wand2 size={14} /> Yaz
                    </button>
                  </div>
                  <div className="text-[11px]" style={{ color: MUTED }}>AI metni öneri olarak uygular; dilediğin gibi düzenleyebilirsin. (Max aboneliğinden — ek ücret yok.)</div>
                </div>
              </div>

              {/* Anahtarlar */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Toggle on={draft.attachPdf} color="#f472b6" icon={<Paperclip size={13} />} label="PDF ekle" onClick={() => patch({ attachPdf: !draft.attachPdf })} />
                <Toggle on={draft.auto} color="#60a5fa" icon={<Zap size={13} />} label="Otomatik gönderim" onClick={() => patch({ auto: !draft.auto })} />
                <Toggle on={draft.isActive} color={ACCENT} icon={<Power size={13} />} label={draft.isActive ? 'Aktif' : 'Pasif'} onClick={() => patch({ isActive: !draft.isActive })} />
              </div>
              {draft.auto && (
                <div className="mt-2.5 rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.07)', color: '#9cc4f5' }}>
                  <Zap size={12} className="mr-1 inline" /> Otomatik tetik: <strong>Evrak alındığında</strong> bu şablon mükellefe kendiliğinden gönderilir.
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2.5">
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #34d399, #22d3ee)', color: '#0a1410' }}>
                  <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
                <button onClick={duplicate} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px]"
                  style={{ borderColor: LINE, color: TEXT, background: 'rgba(255,255,255,0.03)' }}>
                  <Copy size={15} /> Kopyala
                </button>
                <button onClick={remove} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px]"
                  style={{ borderColor: 'rgba(248,113,113,0.4)', color: RED, background: 'transparent' }}>
                  <Trash2 size={15} /> Sil
                </button>
              </div>
            </>
          )}
        </section>

        {/* SAĞ — canlı önizleme */}
        <section className="rounded-2xl border p-4" style={{ borderColor: LINE, background: '#0b141a' }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Canlı önizleme · örnek veri</span>
            {draft?.kanal === 'BOTH' && (
              <div className="flex rounded-lg border p-0.5" style={{ borderColor: LINE }}>
                {(['WHATSAPP', 'EMAIL'] as const).map((k) => (
                  <button key={k} onClick={() => setPreviewKanal(k)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
                    style={previewKanal === k ? { background: 'rgba(255,255,255,0.1)', color: TEXT } : { color: MUTED }}>
                    {k === 'WHATSAPP' ? <MessageCircle size={12} /> : <Mail size={12} />}{k === 'WHATSAPP' ? 'WhatsApp' : 'E-posta'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!draft ? <div className="text-[13px]" style={{ color: MUTED }}>Önizleme için bir şablon seç.</div> : effPreviewKanal === 'WHATSAPP' ? (
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
        </section>
      </div>
    </div>
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
