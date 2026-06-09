'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageSquareText, Plus, Save, Trash2, Paperclip, Zap } from 'lucide-react';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  type MessageTemplate, type TemplateKanal,
} from '@/lib/message-templates';

const GOLD = '#d4b876';
const LINE = 'rgba(255,255,255,0.08)';
const TEXT = '#fafaf9';
const MUTED = 'rgba(250,250,249,0.58)';
const ACCENT = '#34d399'; // zümrüt — şablonlar modül rengi
const CYAN = '#22d3ee';

const OFFICE = 'MOREN MALİ MÜŞAVİRLİK';

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

const PLACEHOLDERS = [
  'ad', 'unvan', 'dönem', 'sonGun', 'beyannameListesi', 'sgkListesi',
  'vergiListesi', 'sgkOdemeListesi', 'toplam', 'tutar', 'vade', 'bakiye', 'link', 'kurum',
];
const KATEGORILER = ['evrak', 'beyanname', 'sgk', 'odeme', 'tebligat', 'ekstre', 'genel'];
const KANALLAR: { v: TemplateKanal; l: string }[] = [
  { v: 'BOTH', l: 'WhatsApp + E-posta' }, { v: 'WHATSAPP', l: 'Sadece WhatsApp' }, { v: 'EMAIL', l: 'Sadece E-posta' },
];

function renderPreview(body: string, kanal: TemplateKanal): string {
  const filled = String(body || '').replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m);
  return kanal !== 'EMAIL' ? `Gönderen: ${OFFICE}\n\n${filled}` : filled;
}

const fieldStyle: React.CSSProperties = { borderColor: LINE, color: TEXT, background: 'rgba(255,255,255,0.03)' };

export default function SablonlarPage() {
  const [items, setItems] = useState<MessageTemplate[]>([]);
  const [draft, setDraft] = useState<MessageTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await listTemplates();
      setItems(list);
      setDraft((cur) => cur ?? (list[0] ? { ...list[0] } : null));
    } catch { setMsg('Şablonlar yüklenemedi.'); }
    finally { setLoading(false); }
  }

  function patch(p: Partial<MessageTemplate>) { setDraft((d) => (d ? { ...d, ...p } : d)); }

  function insertPlaceholder(name: string) {
    const ta = bodyRef.current;
    const token = `{${name}}`;
    if (!ta || !draft) { patch({ body: (draft?.body || '') + token }); return; }
    const s = ta.selectionStart ?? draft.body.length;
    const e = ta.selectionEnd ?? draft.body.length;
    patch({ body: draft.body.slice(0, s) + token + draft.body.slice(e) });
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length; });
  }

  async function save() {
    if (!draft) return;
    setSaving(true); setMsg('');
    try {
      const dto = {
        ad: draft.ad, kanal: draft.kanal, kategori: draft.kategori, emailSubject: draft.emailSubject,
        body: draft.body, attachPdf: draft.attachPdf, auto: draft.auto, isActive: draft.isActive,
      };
      const saved = draft.id.startsWith('new-') ? await createTemplate(dto) : await updateTemplate(draft.id, dto);
      setMsg('Kaydedildi.'); await load(); setDraft({ ...saved });
    } catch { setMsg('Kaydedilemedi.'); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!draft || draft.id.startsWith('new-')) { setDraft(items[0] ? { ...items[0] } : null); return; }
    if (!confirm('Bu şablon silinsin mi?')) return;
    try { await deleteTemplate(draft.id); setDraft(null); await load(); } catch { setMsg('Silinemedi.'); }
  }

  function newTemplate() {
    setDraft({
      id: 'new-' + Date.now(), ad: 'Yeni Şablon', kanal: 'BOTH', kategori: 'genel',
      emailSubject: '', body: 'Sayın {ad},\n\n', attachPdf: false, auto: false, autoEvent: null,
      sirano: items.length, isActive: true,
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-12">
      {/* BAŞLIK — radial + gökkuşağı şerit + degrade ikon */}
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
          <button onClick={newTemplate} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors"
            style={{ background: 'rgba(52,211,153,0.16)', color: ACCENT, border: '1px solid rgba(52,211,153,0.35)' }}>
            <Plus size={14} /> Yeni Şablon
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
          WhatsApp ve e-posta için kendi şablonlarını tanımla. <span style={{ color: CYAN }}>{'{ad}'}</span>, <span style={{ color: CYAN }}>{'{tutar}'}</span> gibi alanlar gönderimde mükellef verisiyle otomatik dolar.
        </p>
        {msg && <div className="mt-3 inline-flex rounded-lg px-3 py-1.5 text-[12px] font-medium" style={{ background: 'rgba(52,211,153,0.12)', color: ACCENT, border: '1px solid rgba(52,211,153,0.3)' }}>{msg}</div>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr_380px]">

        {/* SOL — liste */}
        <section className="rounded-2xl border p-2.5" style={{ borderColor: LINE, background: '#0f0d0b' }}>
          {loading ? <div className="p-3 text-[13px]" style={{ color: MUTED }}>Yükleniyor…</div> :
            items.map((t) => {
              const sel = draft?.id === t.id;
              return (
                <button key={t.id} onClick={() => setDraft({ ...t })} className="mb-1.5 block w-full rounded-xl px-3 py-2.5 text-left transition-colors"
                  style={{ background: sel ? 'rgba(52,211,153,0.12)' : 'transparent', border: `1px solid ${sel ? 'rgba(52,211,153,0.4)' : 'transparent'}` }}>
                  <div className="text-[14px] font-semibold" style={{ color: TEXT }}>{t.ad}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: MUTED }}>
                    <span>{t.kategori}</span>
                    {t.auto && <span className="inline-flex items-center gap-0.5" style={{ color: '#60a5fa' }}><Zap size={10} /> oto</span>}
                    {t.attachPdf && <span className="inline-flex items-center gap-0.5" style={{ color: '#f472b6' }}><Paperclip size={10} /> PDF</span>}
                    {!t.isActive && <span style={{ color: '#f87171' }}>pasif</span>}
                  </div>
                </button>
              );
            })}
          {!loading && !items.length && <div className="p-3 text-[13px]" style={{ color: MUTED }}>Şablon yok.</div>}
        </section>

        {/* ORTA — düzenleyici */}
        <section className="rounded-2xl border p-5" style={{ borderColor: LINE, background: 'linear-gradient(135deg, rgba(52,211,153,0.06), rgba(34,211,238,0.03) 60%, transparent)' }}>
          {!draft ? <div className="text-[13px]" style={{ color: MUTED }}>Soldan bir şablon seç ya da “Yeni Şablon” ekle.</div> : (
            <>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(52,211,153,0.85)' }}>Şablon adı</label>
              <input className="w-full rounded-lg border px-3 py-2 text-[14px]" style={fieldStyle} value={draft.ad} onChange={(e) => patch({ ad: e.target.value })} />

              <div className="mt-3 flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Kanal</label>
                  <select className="w-full rounded-lg border px-3 py-2 text-[13px]" style={fieldStyle} value={draft.kanal} onChange={(e) => patch({ kanal: e.target.value as TemplateKanal })}>
                    {KANALLAR.map((k) => <option key={k.v} value={k.v} style={{ background: '#1c1917', color: '#fafaf9' }}>{k.l}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Kategori</label>
                  <select className="w-full rounded-lg border px-3 py-2 text-[13px]" style={fieldStyle} value={draft.kategori} onChange={(e) => patch({ kategori: e.target.value })}>
                    {KATEGORILER.map((k) => <option key={k} value={k} style={{ background: '#1c1917', color: '#fafaf9' }}>{k}</option>)}
                  </select>
                </div>
              </div>

              {draft.kanal !== 'WHATSAPP' && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>E-posta konusu</label>
                  <input className="w-full rounded-lg border px-3 py-2 text-[14px]" style={fieldStyle} value={draft.emailSubject || ''} onChange={(e) => patch({ emailSubject: e.target.value })} />
                </div>
              )}

              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Mesaj metni</label>
                <textarea ref={bodyRef} value={draft.body} onChange={(e) => patch({ body: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2.5 text-[14px]" style={{ ...fieldStyle, minHeight: 190, lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>

              <div className="mt-3">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Alan ekle (tıkla)</div>
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map((p) => (
                    <button key={p} onClick={() => insertPlaceholder(p)} className="rounded-md border px-2 py-1 text-[12px] font-medium transition-colors"
                      style={{ borderColor: 'rgba(34,211,238,0.3)', color: CYAN, background: 'rgba(34,211,238,0.07)' }}>{`{${p}}`}</button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]" style={{ color: TEXT }}>
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={draft.attachPdf} onChange={(e) => patch({ attachPdf: e.target.checked })} /> PDF ekle</label>
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={draft.auto} onChange={(e) => patch({ auto: e.target.checked })} /> Otomatik</label>
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={draft.isActive} onChange={(e) => patch({ isActive: e.target.checked })} /> Aktif</label>
              </div>

              <div className="mt-5 flex gap-2.5">
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold"
                  style={{ background: 'linear-gradient(135deg, #34d399, #22d3ee)', color: '#0a1410' }}>
                  <Save size={15} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
                <button onClick={remove} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px]"
                  style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#f87171', background: 'transparent' }}>
                  <Trash2 size={15} /> Sil
                </button>
              </div>
            </>
          )}
        </section>

        {/* SAĞ — canlı önizleme */}
        <section className="rounded-2xl border p-4" style={{ borderColor: LINE, background: '#0b141a' }}>
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>Canlı önizleme · örnek veri</div>
          {draft && draft.kanal !== 'EMAIL' && (
            <div className="mb-4">
              <div className="mb-1.5 text-[11px]" style={{ color: '#25d366' }}>● WhatsApp</div>
              <div className="ml-auto max-w-[92%] rounded-[10px] rounded-br-[2px] px-3 py-2.5 text-[13.5px]" style={{ background: '#005c4b', color: '#e9edef', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                {renderPreview(draft.body, draft.kanal)}
                {draft.attachPdf && <div className="mt-2 rounded-lg px-2.5 py-2 text-[12px]" style={{ background: '#0b141a', color: '#8aa9a0' }}>📎 Belge.pdf</div>}
              </div>
            </div>
          )}
          {draft && draft.kanal !== 'WHATSAPP' && (
            <div>
              <div className="mb-1.5 text-[11px]" style={{ color: '#60a5fa' }}>● E-posta</div>
              <div className="overflow-hidden rounded-xl" style={{ background: '#fff', color: '#1b2230' }}>
                <div className="px-3.5 py-2.5 text-[13px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#1b3a6b,#2a5298)' }}>MOREN MALİ MÜŞAVİRLİK</div>
                <div className="px-3.5 py-3 text-[13px]" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {draft.emailSubject && <div className="mb-2 font-bold">{renderPreview(draft.emailSubject, 'EMAIL')}</div>}
                  {renderPreview(draft.body, 'EMAIL')}
                  {draft.attachPdf && <div className="mt-2.5 text-[12px]" style={{ color: '#c00' }}>📎 Belge.pdf (ekli)</div>}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
