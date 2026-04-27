'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Megaphone, Download, Save, Trash2, Plus,
  Eye, FileImage, Share2,
  Square, RectangleVertical,
} from 'lucide-react';

// ─── Tipler ─────────────────────────────────────────────────────────────────
type Tema = 'onyx' | 'beyaz' | 'krem';
type Format = 'story' | 'post';

type Duyuru = {
  id: string;
  baslik: string;
  ustBaslik: string;
  metin: string;
  tarih: string;
  telefon: string;
  email: string;
  web: string;
  adres: string;
  tema: Tema;
  format: Format;
  olusturma: string;
};

const STORAGE_KEY = 'moren-duyurular-v3';
const LOGO_URL = '/brand/moren-logo-gold.png';

const VARSAYILAN: Omit<Duyuru, 'id' | 'olusturma'> = {
  ustBaslik: 'Kurumsal duyuru',
  baslik: 'E-Fatura dönemi başlıyor',
  metin:
    '1 Ocak 2026 itibarıyla yıllık brüt cirosu 3 milyon TL üzeri tüm mükellefler için e-Fatura kullanımı zorunlu hale gelmiştir.\n\nMüşterilerimizin sürece sorunsuz geçişi için ücretsiz ön danışmanlık veriyoruz.',
  tarih: new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }),
  telefon: '0212 555 00 00',
  email: 'info@morenmusavirlik.com',
  web: 'morenmusavirlik.com',
  adres: 'Bahçelievler / İstanbul',
  tema: 'onyx',
  format: 'story',
};

// ─── Tema paleti ─────────────────────────────────────────────────────────────
type Palet = {
  bg: string;
  ink: string;
  inkSoft: string;
  inkMute: string;
  accent: string;
  rule: string;
};

const PALETLER: Record<Tema, Palet> = {
  onyx: {
    bg: '#0a0a0a',
    ink: '#fafafa',
    inkSoft: '#a1a1a1',
    inkMute: '#525252',
    accent: '#d4b876',
    rule: 'rgba(255,255,255,0.12)',
  },
  beyaz: {
    bg: '#ffffff',
    ink: '#0a0a0a',
    inkSoft: '#525252',
    inkMute: '#a1a1a1',
    accent: '#9a7a1a',
    rule: 'rgba(0,0,0,0.10)',
  },
  krem: {
    bg: '#f5f1e8',
    ink: '#1a1a1a',
    inkSoft: '#5a5448',
    inkMute: '#8a8470',
    accent: '#8b6f15',
    rule: 'rgba(26,26,26,0.12)',
  },
};

// ─── Önizleme şablonu ────────────────────────────────────────────────────────
function PosterTemplate({
  d,
  scale = 0.36,
}: {
  d: Omit<Duyuru, 'id' | 'olusturma'>;
  scale?: number;
}) {
  const isStory = d.format === 'story';
  const W = 1080;
  const H = isStory ? 1920 : 1080;
  const t = PALETLER[d.tema];

  // ölçek
  const padX = isStory ? 96 : 80;
  const padY = isStory ? 100 : 72;

  const titleSize = isStory
    ? d.baslik.length > 32 ? 110 : 132
    : d.baslik.length > 32 ? 78 : 92;

  const bodySize = isStory ? 34 : 26;
  const labelSize = isStory ? 18 : 14;
  const microSize = isStory ? 16 : 12;

  return (
    <div
      style={{
        width: W * scale,
        height: H * scale,
        position: 'relative',
        boxShadow: '0 30px 60px rgba(0,0,0,0.18)',
        overflow: 'hidden',
        flexShrink: 0,
        borderRadius: 4,
      }}
    >
      <div
        id="poster-render"
        style={{
          width: W,
          height: H,
          background: t.bg,
          color: t.ink,
          fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          padding: `${padY}px ${padX}px`,
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          boxSizing: 'border-box',
        }}
      >
        {/* === ÜST: logo + tarih === */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="Moren"
            crossOrigin="anonymous"
            style={{
              height: isStory ? 84 : 64,
              width: 'auto',
              filter: d.tema === 'onyx' ? 'none' : 'none',
            }}
          />
          <div
            style={{
              fontSize: microSize,
              color: t.inkSoft,
              letterSpacing: 2.5,
              textTransform: 'uppercase',
              fontWeight: 500,
            }}
          >
            {d.tarih}
          </div>
        </div>

        {/* İnce ayırıcı */}
        <div style={{ height: 1, background: t.rule, marginTop: isStory ? 36 : 24, marginBottom: isStory ? 36 : 22 }} />

        {/* Üst başlık (mini etiket) */}
        <div
          style={{
            fontSize: labelSize,
            color: t.accent,
            letterSpacing: 4,
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          {d.ustBaslik || 'Duyuru'}
        </div>

        {/* === Ana başlık === */}
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 0.96,
            letterSpacing: -3.5,
            color: t.ink,
            marginTop: isStory ? 80 : 50,
            marginBottom: isStory ? 60 : 36,
            maxWidth: '95%',
          }}
        >
          {d.baslik || 'Başlık'}
          <span style={{ color: t.accent }}>.</span>
        </div>

        {/* === Gövde === */}
        <div
          style={{
            fontSize: bodySize,
            lineHeight: 1.5,
            color: t.inkSoft,
            fontWeight: 400,
            maxWidth: isStory ? 820 : 880,
            whiteSpace: 'pre-wrap',
            flex: 1,
          }}
        >
          {d.metin || 'Duyuru metni...'}
        </div>

        {/* === İletişim tablosu === */}
        <div
          style={{
            marginTop: isStory ? 60 : 30,
            paddingTop: isStory ? 36 : 24,
            borderTop: `1px solid ${t.rule}`,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: `${isStory ? 18 : 12}px ${isStory ? 60 : 40}px`,
          }}
        >
          {[
            { label: 'Telefon', value: d.telefon },
            { label: 'E-posta', value: d.email },
            { label: 'Web', value: d.web },
            { label: 'Adres', value: d.adres },
          ]
            .filter((x) => x.value)
            .map((row, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  borderBottom: `1px solid ${t.rule}`,
                  paddingBottom: isStory ? 14 : 9,
                  gap: 16,
                }}
              >
                <span
                  style={{
                    fontSize: microSize,
                    color: t.inkMute,
                    letterSpacing: 2.5,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    fontSize: isStory ? 22 : 17,
                    color: t.ink,
                    fontWeight: 500,
                    textAlign: 'right',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
        </div>

        {/* === Alt: marka adı === */}
        <div
          style={{
            marginTop: isStory ? 40 : 22,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: microSize,
            color: t.inkMute,
            letterSpacing: 2.5,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          <span>Moren Mali Müşavirlik</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 6, height: 6, background: t.accent, display: 'inline-block', borderRadius: 0 }} />
            <span>Güvenilir Mali Çözüm Ortağınız</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Ana sayfa ───────────────────────────────────────────────────────────────
export default function DuyurularPage() {
  const [form, setForm] = useState<Omit<Duyuru, 'id' | 'olusturma'>>(VARSAYILAN);
  const [duyurular, setDuyurular] = useState<Duyuru[]>([]);
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const onzRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDuyurular(JSON.parse(raw));
    } catch {}
  }, []);

  const persist = (list: Duyuru[]) => {
    setDuyurular(list);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {}
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const yeni = () => {
    setForm(VARSAYILAN);
    setSeciliId(null);
  };

  const kaydet = () => {
    if (!form.baslik.trim()) {
      alert('Başlık gerekli');
      return;
    }
    const id = seciliId || `dy_${Date.now()}`;
    const olusturma = seciliId
      ? duyurular.find((d) => d.id === id)?.olusturma || new Date().toISOString()
      : new Date().toISOString();
    const yeniKayit: Duyuru = { ...form, id, olusturma };
    const liste = seciliId
      ? duyurular.map((d) => (d.id === id ? yeniKayit : d))
      : [yeniKayit, ...duyurular];
    persist(liste);
    setSeciliId(id);
  };

  const sec = (id: string) => {
    const d = duyurular.find((x) => x.id === id);
    if (!d) return;
    const { id: _i, olusturma: _o, ...rest } = d;
    setForm(rest);
    setSeciliId(id);
  };

  const sil = (id: string) => {
    if (!confirm('Bu duyuru silinsin mi?')) return;
    persist(duyurular.filter((d) => d.id !== id));
    if (seciliId === id) yeni();
  };

  const pngUret = async () => {
    const { toPng } = await import('html-to-image');
    const node = document.getElementById('poster-render');
    if (!node) throw new Error('Önizleme bulunamadı');
    const W = 1080;
    const H = form.format === 'story' ? 1920 : 1080;
    return toPng(node as HTMLElement, {
      width: W,
      height: H,
      pixelRatio: 1,
      cacheBust: true,
      style: { transform: 'none' },
    });
  };

  const pngIndir = async () => {
    setExportLoading(true);
    try {
      const dataUrl = await pngUret();
      const a = document.createElement('a');
      const safe = (form.baslik || 'duyuru').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
      a.download = `moren-duyuru-${safe}-${form.format}-${Date.now()}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e: any) {
      alert(
        'PNG dışa aktarma hatası.\n\nGerekirse projeye ekle:\n  pnpm add html-to-image\n\nHata: ' +
          (e?.message || e),
      );
    } finally {
      setExportLoading(false);
    }
  };

  const whatsappPaylas = async () => {
    setExportLoading(true);
    try {
      const { toBlob } = await import('html-to-image');
      const node = document.getElementById('poster-render');
      if (!node) return;
      const W = 1080;
      const H = form.format === 'story' ? 1920 : 1080;
      const blob = await toBlob(node as HTMLElement, {
        width: W,
        height: H,
        pixelRatio: 1,
        cacheBust: true,
        style: { transform: 'none' },
      });
      if (!blob) return;
      const file = new File([blob], 'moren-duyuru.png', { type: 'image/png' });
      const nav = navigator as any;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: form.baslik,
          text: `${form.baslik}\n\n${form.metin}\n\n${form.telefon} · ${form.email}`,
        });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = 'moren-duyuru.png';
      a.href = url;
      a.click();
      window.open('https://web.whatsapp.com/', '_blank');
    } catch (e: any) {
      alert('Paylaşım hatası: ' + (e?.message || e));
    } finally {
      setExportLoading(false);
    }
  };

  const TEMA_LISTESI: { key: Tema; label: string; bg: string; ink: string; sub: string }[] = [
    { key: 'onyx', label: 'Onyx', bg: '#0a0a0a', ink: '#fafafa', sub: 'Siyah · gece' },
    { key: 'beyaz', label: 'Saf Beyaz', bg: '#ffffff', ink: '#0a0a0a', sub: 'Beyaz · modern' },
    { key: 'krem', label: 'Krem', bg: '#f5f1e8', ink: '#1a1a1a', sub: 'Sıcak · klasik' },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[1.5px] text-gray-400 uppercase">İşlemler</div>
          <h2 className="text-xl font-bold text-gray-900 mt-0.5 flex items-center gap-2">
            <Megaphone size={22} className="text-amber-700" /> Duyuru Şablonları
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={yeni}
            className="px-4 py-2 text-sm font-semibold bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-2"
          >
            <Plus size={16} /> Yeni Duyuru
          </button>
          <button
            onClick={kaydet}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg flex items-center gap-2 hover:opacity-90"
            style={{ background: '#0a0a0a' }}
          >
            <Save size={16} /> {seciliId ? 'Güncelle' : 'Kaydet'}
          </button>
          <button
            onClick={pngIndir}
            disabled={exportLoading}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg flex items-center gap-2 disabled:opacity-50 hover:opacity-90"
            style={{ background: '#525252' }}
          >
            <Download size={16} /> {exportLoading ? 'İşleniyor...' : 'PNG İndir'}
          </button>
          <button
            onClick={whatsappPaylas}
            disabled={exportLoading}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg flex items-center gap-2 disabled:opacity-50 hover:opacity-90"
            style={{ background: '#25D366' }}
          >
            <Share2 size={16} /> WhatsApp
          </button>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '260px 1fr 460px' }}>
        {/* SOL: Kayıtlı duyurular listesi */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Kayıtlı Duyurular</h3>
            <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full">
              {duyurular.length}
            </span>
          </div>
          <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
            {duyurular.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400 italic">
                Henüz duyuru yok. Sağdaki form ile oluştur, "Kaydet" ile listeye ekle.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {duyurular.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => sec(d.id)}
                    className={`p-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      seciliId === d.id ? 'bg-gray-50 border-l-4 border-gray-900' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{
                          background: d.format === 'story' ? '#e5e5e5' : '#f5f5f5',
                          color: '#0a0a0a',
                        }}
                      >
                        {d.format === 'story' ? '9:16' : '1:1'}
                      </span>
                      <span className="text-[9px] text-gray-400 uppercase tracking-wider">{d.tema}</span>
                    </div>
                    <div className="text-sm font-semibold text-gray-900 line-clamp-2">{d.baslik}</div>
                    <div className="text-xs text-gray-500 mt-1">{d.tarih}</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        sil(d.id);
                      }}
                      className="text-xs text-red-500 hover:text-red-700 mt-1.5 flex items-center gap-1"
                    >
                      <Trash2 size={12} /> Sil
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ORTA: Form */}
        <div className="space-y-4">
          {/* Format & Tema */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Görsel Stil</h3>
              <p className="text-xs text-gray-500 mt-0.5">Format ve renk teması</p>
            </div>
            <div className="p-5 space-y-4">
              {/* Format */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2 tracking-wide">FORMAT</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => set('format', 'story')}
                    className={`flex-1 p-3 rounded-lg border-2 text-left transition flex items-center gap-3 ${
                      form.format === 'story' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <RectangleVertical size={28} className="text-gray-700" />
                    <div>
                      <div className="text-xs font-bold text-gray-900">Story · 9:16</div>
                      <div className="text-[10px] text-gray-500">1080×1920 — WhatsApp Story</div>
                    </div>
                  </button>
                  <button
                    onClick={() => set('format', 'post')}
                    className={`flex-1 p-3 rounded-lg border-2 text-left transition flex items-center gap-3 ${
                      form.format === 'post' ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Square size={28} className="text-gray-700" />
                    <div>
                      <div className="text-xs font-bold text-gray-900">Post · 1:1</div>
                      <div className="text-[10px] text-gray-500">1080×1080 — Sohbet/Grup</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Tema seçici */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2 tracking-wide">TEMA</label>
                <div className="grid grid-cols-3 gap-2">
                  {TEMA_LISTESI.map((th) => (
                    <button
                      key={th.key}
                      onClick={() => set('tema', th.key)}
                      className={`p-3 rounded-lg border-2 text-left transition ${
                        form.tema === th.key
                          ? 'border-gray-900 bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div
                        className="rounded mb-2 flex items-center px-2 py-1.5"
                        style={{
                          background: th.bg,
                          color: th.ink,
                          border: th.key === 'beyaz' ? '1px solid #e5e5e5' : 'none',
                        }}
                      >
                        <span className="text-[11px] font-bold tracking-wide">Aa</span>
                      </div>
                      <div className="text-[11px] font-semibold text-gray-900 leading-tight">{th.label}</div>
                      <div className="text-[10px] text-gray-500">{th.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* İçerik */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Duyuru İçeriği</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">ÜST ETİKET</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
                  value={form.ustBaslik}
                  onChange={(e) => set('ustBaslik', e.target.value)}
                  placeholder="Kurumsal duyuru"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">BAŞLIK *</label>
                <input
                  className="w-full px-3 py-3 text-base font-bold border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
                  value={form.baslik}
                  onChange={(e) => set('baslik', e.target.value)}
                  placeholder="Duyurunun ana başlığı"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">METİN</label>
                <textarea
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900 min-h-[140px] leading-relaxed"
                  value={form.metin}
                  onChange={(e) => set('metin', e.target.value)}
                  placeholder="Duyuru içeriği..."
                />
                <div className="text-xs text-gray-400 mt-1">Boş satır bırakarak paragraf oluştur</div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">TARİH</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
                  value={form.tarih}
                  onChange={(e) => set('tarih', e.target.value)}
                  placeholder="01 Ocak 2026"
                />
              </div>
            </div>
          </div>

          {/* İletişim */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">İletişim Bilgileri</h3>
            </div>
            <div className="p-5 grid gap-4 grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">TELEFON</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
                  value={form.telefon}
                  onChange={(e) => set('telefon', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">E-POSTA</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">WEB</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
                  value={form.web}
                  onChange={(e) => set('web', e.target.value)}
                  placeholder="morenmusavirlik.com"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5 tracking-wide">ADRES</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"
                  value={form.adres}
                  onChange={(e) => set('adres', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* SAĞ: Canlı önizleme */}
        <div
          className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col"
          style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}
        >
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Eye size={14} /> Canlı Önizleme
            </h3>
            <span className="text-xs text-gray-400">
              {form.format === 'story' ? '1080×1920 · Story' : '1080×1080 · Post'}
            </span>
          </div>
          <div
            ref={onzRef}
            className="flex items-start justify-center p-6 overflow-auto"
            style={{
              background: '#f5f5f5',
              minHeight: 720,
            }}
          >
            <PosterTemplate d={form} scale={form.format === 'story' ? 0.34 : 0.4} />
          </div>
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center gap-2">
            <FileImage size={12} />
            PNG indirildiğinde {form.format === 'story' ? '1080×1920' : '1080×1080'} tam çözünürlükte üretilir
          </div>
        </div>
      </div>
    </div>
  );
}
