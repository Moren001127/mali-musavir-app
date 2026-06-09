'use client';

import { useEffect, useRef, useState } from 'react';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  type MessageTemplate, type TemplateKanal,
} from '@/lib/message-templates';

const OFFICE = 'MOREN MALİ MÜŞAVİRLİK';

// Canlı önizleme örnek verisi (backend ile aynı).
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

const card: React.CSSProperties = { background: '#161b22', border: '1px solid #2a3340', borderRadius: 12, padding: 16 };
const label: React.CSSProperties = { fontSize: 12, color: '#8b98a8', marginBottom: 4, display: 'block' };
const input: React.CSSProperties = { width: '100%', background: '#0d1117', border: '1px solid #2a3340', borderRadius: 8, color: '#e6edf3', padding: '8px 10px', fontSize: 14 };

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
    } catch {
      setMsg('Şablonlar yüklenemedi.');
    } finally { setLoading(false); }
  }

  function patch(p: Partial<MessageTemplate>) { setDraft((d) => (d ? { ...d, ...p } : d)); }

  function insertPlaceholder(name: string) {
    const ta = bodyRef.current;
    const token = `{${name}}`;
    if (!ta || !draft) { patch({ body: (draft?.body || '') + token }); return; }
    const s = ta.selectionStart ?? draft.body.length;
    const e = ta.selectionEnd ?? draft.body.length;
    const next = draft.body.slice(0, s) + token + draft.body.slice(e);
    patch({ body: next });
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
      const saved = draft.id.startsWith('new-')
        ? await createTemplate(dto)
        : await updateTemplate(draft.id, dto);
      setMsg('Kaydedildi.');
      await load();
      setDraft({ ...saved });
    } catch {
      setMsg('Kaydedilemedi.');
    } finally { setSaving(false); }
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

  const previewText = draft ? renderPreview(draft.body, draft.kanal) : '';

  return (
    <div style={{ padding: 20, color: '#e6edf3', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Mesaj Şablonları</h1>
          <p style={{ color: '#8b98a8', fontSize: 13, margin: '4px 0 0' }}>WhatsApp ve e-posta için kendi şablonlarını tanımla. {'{ad}'} gibi alanlar gönderimde otomatik dolar.</p>
        </div>
        <button onClick={newTemplate} style={{ ...input, width: 'auto', background: '#1f6feb', border: 'none', fontWeight: 600, cursor: 'pointer' }}>+ Yeni Şablon</button>
      </div>

      {msg && <div style={{ ...card, padding: '8px 14px', marginBottom: 12, color: '#7ee787' }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 360px', gap: 16, alignItems: 'start' }}>

        {/* SOL — liste */}
        <div style={{ ...card, padding: 8 }}>
          {loading ? <div style={{ padding: 12, color: '#8b98a8' }}>Yükleniyor…</div> :
            items.map((t) => (
              <button key={t.id} onClick={() => setDraft({ ...t })}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: draft?.id === t.id ? '#1f6feb22' : 'transparent',
                  border: draft?.id === t.id ? '1px solid #1f6feb' : '1px solid transparent', borderRadius: 8, padding: '8px 10px', color: '#e6edf3', cursor: 'pointer', marginBottom: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.ad}</div>
                <div style={{ fontSize: 11, color: '#8b98a8' }}>{t.kategori}{t.auto ? ' · otomatik' : ''}{t.attachPdf ? ' · PDF' : ''}</div>
              </button>
            ))}
          {!loading && !items.length && <div style={{ padding: 12, color: '#8b98a8' }}>Şablon yok.</div>}
        </div>

        {/* ORTA — düzenleyici */}
        <div style={{ ...card }}>
          {!draft ? <div style={{ color: '#8b98a8' }}>Soldan bir şablon seç ya da yeni ekle.</div> : (
            <>
              <label style={label}>Şablon adı</label>
              <input style={input} value={draft.ad} onChange={(e) => patch({ ad: e.target.value })} />

              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>Kanal</label>
                  <select style={input} value={draft.kanal} onChange={(e) => patch({ kanal: e.target.value as TemplateKanal })}>
                    {KANALLAR.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>Kategori</label>
                  <select style={input} value={draft.kategori} onChange={(e) => patch({ kategori: e.target.value })}>
                    {KATEGORILER.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>

              {draft.kanal !== 'WHATSAPP' && (
                <div style={{ marginTop: 12 }}>
                  <label style={label}>E-posta konusu</label>
                  <input style={input} value={draft.emailSubject || ''} onChange={(e) => patch({ emailSubject: e.target.value })} />
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <label style={label}>Mesaj metni</label>
                <textarea ref={bodyRef} value={draft.body} onChange={(e) => patch({ body: e.target.value })}
                  style={{ ...input, minHeight: 180, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />
              </div>

              <div style={{ marginTop: 8 }}>
                <div style={{ ...label, marginBottom: 6 }}>Alan ekle (tıkla):</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PLACEHOLDERS.map((p) => (
                    <button key={p} onClick={() => insertPlaceholder(p)}
                      style={{ background: '#0d1117', border: '1px solid #2a3340', borderRadius: 6, color: '#79c0ff', padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>{`{${p}}`}</button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={draft.attachPdf} onChange={(e) => patch({ attachPdf: e.target.checked })} /> PDF ekle (ekstre/tebligat)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={draft.auto} onChange={(e) => patch({ auto: e.target.checked })} /> Otomatik (olay olunca)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={draft.isActive} onChange={(e) => patch({ isActive: e.target.checked })} /> Aktif
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={save} disabled={saving} style={{ ...input, width: 'auto', background: '#238636', border: 'none', fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
                <button onClick={remove} style={{ ...input, width: 'auto', background: 'transparent', border: '1px solid #6e2a2a', color: '#ff7b72', cursor: 'pointer' }}>Sil</button>
              </div>
            </>
          )}
        </div>

        {/* SAĞ — canlı önizleme */}
        <div style={{ ...card, background: '#0b141a' }}>
          <div style={{ fontSize: 12, color: '#8b98a8', marginBottom: 10 }}>Canlı önizleme (örnek veriyle)</div>
          {draft && draft.kanal !== 'EMAIL' && (
            <div style={{ background: '#005c4b', borderRadius: '10px 10px 2px 10px', padding: '10px 12px', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', color: '#e9edef', marginBottom: draft.kanal === 'BOTH' ? 14 : 0 }}>
              {previewText}
              {draft.attachPdf && <div style={{ marginTop: 8, background: '#0b141a', borderRadius: 8, padding: 8, fontSize: 12, color: '#8aa9a0' }}>📎 Belge.pdf</div>}
            </div>
          )}
          {draft && draft.kanal !== 'WHATSAPP' && (
            <div style={{ background: '#fff', color: '#1b2230', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ background: '#1b3a6b', color: '#fff', padding: '10px 14px', fontWeight: 700, fontSize: 13 }}>MOREN MALİ MÜŞAVİRLİK</div>
              <div style={{ padding: 14, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {draft.emailSubject && <div style={{ fontWeight: 700, marginBottom: 8 }}>{renderPreview(draft.emailSubject, 'EMAIL')}</div>}
                {renderPreview(draft.body, 'EMAIL')}
                {draft.attachPdf && <div style={{ marginTop: 10, color: '#c00', fontSize: 12 }}>📎 Belge.pdf (ekli)</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
