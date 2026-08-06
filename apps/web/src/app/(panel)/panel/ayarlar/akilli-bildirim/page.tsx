'use client';

// =====================================================================
// AKILLI BİLDİRİM AYARLARI — Ayarlar > Akıllı Bildirim
// Gece çekilen belgelerin (Vergi = beyanname+tahakkuk TEK mesaj / SGK /
// e-Tebligat) mükellefe sabah otomatik gönderimi. Onaylanan tasarım:
// 3 kategori sekmesi + kanal anahtarları + Hattat formatlı mesaj önizleme.
// =====================================================================

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, MoonStar, Mail, MessageCircle, Send, FlaskConical } from 'lucide-react';
import Link from 'next/link';

const GOLD = '#d4b876';
const MUTED = 'rgba(250,250,249,0.45)';
const TEXT2 = 'rgba(250,250,249,0.75)';
const CARD_BG = 'rgba(255,255,255,0.028)';
const CARD_BORDER = 'rgba(212,184,118,0.16)';

type Kategori = 'VERGI' | 'SGK' | 'ETEBLIGAT';
const KATEGORILER: Array<{ key: Kategori; tab: string; kisa: string }> = [
  { key: 'VERGI', tab: 'Vergi (Beyanname + Tahakkuk)', kisa: 'Vergi' },
  { key: 'SGK', tab: 'SGK', kisa: 'SGK' },
  { key: 'ETEBLIGAT', tab: 'e-Tebligat', kisa: 'e-Tebligat' },
];

const ORNEK: Record<Kategori, React.ReactNode> = {
  VERGI: (
    <>
      Aşağıdaki Beyanname Dökümanları Bilginize Sunulmuştur,
      <br />
      <br />
      MUHSGK - Tahakkuk - Son Ödeme: 26.02.2026 - 4.182,86 TL
      <br />
      KDV1 - Tahakkuk - Son Ödeme: 28.02.2026 - 791,00 TL
      <br />
      <br />
      <b>Toplam: 4.973,86 TL</b>
      <br />
      <br />
      <span style={{ color: MUTED, fontSize: 11.5 }}>
        PDF ekinde beyanname + tahakkuk birlikte; rakam yalnız bu mesajda, BİR KEZ yazılır.
      </span>
    </>
  ),
  SGK: (
    <>
      Aşağıdaki SGK Dökümanları Bilginize Sunulmuştur,
      <br />
      <br />
      SGK Tahakkuk Fişi - 2026/01 - 24.277,05 TL
      <br />
      SGK Tahakkuk Fişi - 2026/01 - 21.304,35 TL
      <br />
      <br />
      <b>Toplam: 45.581,40 TL</b>
    </>
  ),
  ETEBLIGAT: (
    <>
      Aşağıdaki E-Tebligat Dökümanları Bilginize Sunulmuştur,
      <br />
      <br />
      GİB - E-Tebligat - Tebliğ Tarihi: 05.08.2026
      <br />
      <br />
      <span style={{ color: MUTED, fontSize: 11.5 }}>Tutar yok; tebliğ bilgisi ve belge gönderilir.</span>
    </>
  ),
};

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className="relative inline-flex h-[22px] w-[40px] flex-none rounded-full transition-colors"
      style={{ background: value ? '#22c55e' : '#3a352c', opacity: disabled ? 0.5 : 1 }}
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-all"
        style={{ left: value ? 20 : 2 }}
      />
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <span className="text-[13px]" style={{ color: TEXT2 }}>{label}</span>
      {children}
    </div>
  );
}

export default function AkilliBildirimPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Kategori>('VERGI');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['akilli-bildirim-settings'],
    queryFn: () => api.get('/akilli-bildirim/settings').then((r) => r.data),
  });
  const { data: rapor } = useQuery({
    queryKey: ['akilli-bildirim-today'],
    queryFn: () => api.get('/akilli-bildirim/report').then((r) => r.data),
    refetchInterval: 60000,
  });

  const current = useMemo(
    () => (Array.isArray(settings) ? settings.find((s: any) => s.kategori === tab) : null),
    [settings, tab],
  );

  const patch = async (data: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.put(`/akilli-bildirim/settings/${tab}`, data);
      await qc.invalidateQueries({ queryKey: ['akilli-bildirim-settings'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const testGonder = async () => {
    setTesting(true);
    try {
      const r = await api.post('/akilli-bildirim/run', { kategori: tab, sinceHours: 24 * 40, force: true });
      const n = r.data?.count ?? 0;
      toast.success(n > 0 ? `${n} gönderim işlendi (test modu: ${current?.testMode ? 'AÇIK' : 'KAPALI'})` : 'Gönderilecek yeni belge bulunamadı');
      qc.invalidateQueries({ queryKey: ['akilli-bildirim-today'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Çalıştırılamadı');
    } finally {
      setTesting(false);
    }
  };

  const today = rapor?.today;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      {/* Başlık */}
      <header className="relative overflow-hidden rounded-2xl border p-6" style={{ borderColor: CARD_BORDER, background: `radial-gradient(ellipse at top left, rgba(212,184,118,0.08), transparent 60%), ${CARD_BG}` }}>
        <Link href="/panel/ayarlar" className="mb-3 inline-flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
          <ArrowLeft size={13} /> Ayarlar
        </Link>
        <h1 className="flex items-center gap-3 text-[22px] font-semibold text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)` }}>
            <MoonStar size={20} style={{ color: '#1a1410' }} />
          </span>
          Akıllı Bildirim Ayarları
        </h1>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: MUTED }}>
          Gece çekilen belgeler sabah 09:00&apos;da mükellefe otomatik gönderilir. Vergi = beyanname + tahakkuk TEK mesaj; SGK ve e-Tebligat ayrı mesajdır.
        </p>
      </header>

      {/* Kategori sekmeleri */}
      <div className="flex flex-wrap items-center gap-2">
        {KATEGORILER.map((k) => (
          <button
            key={k.key}
            onClick={() => setTab(k.key)}
            className="rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-colors"
            style={
              tab === k.key
                ? { background: GOLD, color: '#141210' }
                : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.08)' }
            }
          >
            {k.tab}
          </button>
        ))}
        <span className="ml-auto" />
        {current?.testMode && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)' }}>
            <FlaskConical size={12} /> TEST MODU — gerçek mükellefe gitmez
          </span>
        )}
      </div>

      {isLoading || !current ? (
        <div className="flex items-center gap-2 p-8 text-[13px]" style={{ color: MUTED }}>
          <Loader2 size={16} className="animate-spin" /> Yükleniyor…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Sol: ayarlar */}
          <div className="rounded-2xl border p-5" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
            <div className="mb-1 text-[15px] font-bold text-white">🌙 Gece Otomatik Çekilenler</div>
            <p className="mb-3 text-[12.5px]" style={{ color: MUTED }}>
              {KATEGORILER.find((k) => k.key === tab)?.kisa} belgeleri gece çekilir, sabah 09:00 itibariyle TEK mesajla iletilir.
            </p>
            <Row label="Otomatik gönderim AÇIK (ana anahtar)">
              <Toggle value={!!current.enabled} onChange={(v) => patch({ enabled: v })} disabled={saving} />
            </Row>
            <Row label="WhatsApp ile gönder">
              <Toggle value={!!current.whatsapp} onChange={(v) => patch({ whatsapp: v })} disabled={saving} />
            </Row>
            <Row label="E-posta ile gönder">
              <Toggle value={!!current.email} onChange={(v) => patch({ email: v })} disabled={saving} />
            </Row>
            <Row label="Gönderim saati">
              <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(45,212,191,0.12)', color: '#2dd4bf', border: '1px solid rgba(45,212,191,0.3)' }}>09:00</span>
            </Row>
            <Row label="Elle çekilen de AYNI formatla anında iletilsin">
              <Toggle value={!!current.manualInstant} onChange={(v) => patch({ manualInstant: v })} disabled={saving} />
            </Row>
            <Row label="Test modu (gönderimler yalnız test alıcısına)">
              <Toggle value={!!current.testMode} onChange={(v) => patch({ testMode: v })} disabled={saving} />
            </Row>
            {current.testMode && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-[12px]" style={{ color: MUTED }}>
                  Test telefonu
                  <input
                    defaultValue={current.testPhone || ''}
                    onBlur={(e) => { if (e.target.value !== (current.testPhone || '')) patch({ testPhone: e.target.value || null }); }}
                    placeholder="05xxxxxxxxx"
                    className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] text-white outline-none"
                    style={{ borderColor: 'rgba(255,255,255,0.12)' }}
                  />
                </label>
                <label className="text-[12px]" style={{ color: MUTED }}>
                  Test e-postası
                  <input
                    defaultValue={current.testEmail || ''}
                    onBlur={(e) => { if (e.target.value !== (current.testEmail || '')) patch({ testEmail: e.target.value || null }); }}
                    placeholder="ornek@adres.com"
                    className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] text-white outline-none"
                    style={{ borderColor: 'rgba(255,255,255,0.12)' }}
                  />
                </label>
              </div>
            )}
            <button
              onClick={testGonder}
              disabled={testing}
              className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold"
              style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#141210', opacity: testing ? 0.6 : 1 }}
            >
              {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Şimdi Çalıştır (son 40 günün belgeleri)
            </button>
          </div>

          {/* Sağ: mesaj önizleme */}
          <div className="rounded-2xl border p-5" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
            <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-white">
              <MessageCircle size={16} style={{ color: GOLD }} /> Mesaj Önizleme — {KATEGORILER.find((k) => k.key === tab)?.kisa}
            </div>
            <p className="mb-3 text-[12.5px]" style={{ color: MUTED }}>
              Elle veya otomatik çekilen fark etmez, mesaj hep bu formattadır.
            </p>
            <div className="rounded-xl border border-dashed p-4 text-[12.5px] leading-[1.7]" style={{ borderColor: 'rgba(212,184,118,0.3)', background: 'rgba(0,0,0,0.35)', color: TEXT2 }}>
              <b>Gönderen</b>
              <br />
              MOREN MALİ MÜŞAVİRLİK
              <br />
              <br />
              <b>Merhaba</b> <b style={{ color: GOLD }}>{'{ünvan}'}</b>,
              <br />
              <br />
              {ORNEK[tab]}
              <br />
              <br />
              <span className="inline-flex items-center gap-1.5"><Mail size={13} /> PDF ekleri WhatsApp + e-posta ile birlikte gönderilir</span>
            </div>
          </div>
        </div>
      )}

      {/* Bugün özeti */}
      <div className="rounded-r-xl border-l-[3px] py-2.5 pl-4 pr-3 text-[13px]" style={{ borderColor: GOLD, background: 'rgba(212,184,118,0.08)', color: TEXT2 }}>
        Bugün: <b className="text-white">{today?.belge ?? 0} belge</b> {today?.mukellef ?? 0} mükellefe iletildi
        {today?.bekleyen ? <> · <b style={{ color: '#fbbf24' }}>{today.bekleyen} bekliyor</b></> : null}
        {today?.hata ? <> · <b style={{ color: '#f87171' }}>{today.hata} hata</b>{today.ilkHata ? ` (${today.ilkHata})` : ''}</> : null}
      </div>
    </div>
  );
}
