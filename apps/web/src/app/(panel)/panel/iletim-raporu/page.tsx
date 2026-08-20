'use client';

// =====================================================================
// İLETİM RAPORU — Ofis > İletim Raporu
// Akıllı Bildirim motorunun dağıtım kayıtları: kim aldı, kim almadı.
// Kategoriler: Vergi (beyanname+tahakkuk) / SGK / e-Tebligat.
//
// ÖNEMLİ — bu ekranın evreni artık YALNIZ gönderim kayıtları değil.
// Sunucu, ay içinde belgesi olduğu hâlde gönderim kaydı hiç oluşmamış
// mükellefleri de "bekliyor" olarak döndürüyor. Eskiden bu mükelleflerin
// tabloda satırı bile yoktu; "kimlere gönderilmediği" görünmüyordu.
// =====================================================================

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, Send, ClipboardList, AlertTriangle } from 'lucide-react';

const GOLD = '#d4b876';
const MUTED = 'rgba(250,250,249,0.45)';
const TEXT2 = 'rgba(250,250,249,0.75)';
const CARD_BG = 'rgba(255,255,255,0.028)';
const CARD_BORDER = 'rgba(212,184,118,0.16)';

const KATEGORI_COLS: Array<{ key: 'VERGI' | 'SGK' | 'ETEBLIGAT'; label: string }> = [
  { key: 'VERGI', label: 'Vergi' },
  { key: 'SGK', label: 'SGK' },
  { key: 'ETEBLIGAT', label: 'e-Tebligat' },
];

interface Hucre {
  status: string;
  error?: string | null;
  channel?: string | null;
  testMode?: boolean;
  kanallar?: Array<{ status: string; error?: string | null; channel?: string | null; testMode?: boolean }>;
}

function currentMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

/** Sunucudaki 'ILETISIM-' kodu ekrana sızmasın */
function sebepMetni(e?: string | null): string {
  return String(e || '').replace(/^ILETISIM-/, '');
}

const KANAL_ADI: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'E-posta' };

/** Hücrenin üstüne gelince kanal kanal ne olduğu okunsun */
function hucreIpucu(v: Hucre): string {
  const satirlar = (v.kanallar?.length ? v.kanallar : [v]).map((k) => {
    const kanal = KANAL_ADI[String(k.channel || '')] || k.channel || 'kanal';
    const durum =
      k.status === 'SENT' ? (k.testMode ? 'test alıcısına gitti' : 'iletildi')
      : k.status === 'FAILED' ? `iletilemedi — ${sebepMetni(k.error)}`
      : k.status === 'BEKLIYOR' ? sebepMetni(k.error)
      : k.status === 'SKIPPED' ? 'atlandı'
      : k.status;
    return v.status === 'BEKLIYOR' ? durum : `${kanal}: ${durum}`;
  });
  return satirlar.join('\n');
}

function Cell({ v }: { v: Hucre | null }) {
  const kutu = 'inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-lg px-1 font-extrabold';
  if (!v) {
    return (
      <span title="Bu ay bu kategoride belge yok" className={kutu} style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)' }}>
        –
      </span>
    );
  }
  // BEKLİYOR: belge var, gönderim kaydı hiç yok — asıl aranan grup
  if (v.status === 'BEKLIYOR') {
    return (
      <span title={hucreIpucu(v)} className={kutu} style={{ background: 'rgba(251,191,36,0.13)', color: '#fbbf24' }}>
        ⏳
      </span>
    );
  }
  if (v.status === 'SENT') {
    // Test modunda gönderim mükellefe ULAŞMADI — yeşil ✓ ile karıştırılmamalı
    if (v.testMode) {
      return (
        <span title={hucreIpucu(v)} className={kutu} style={{ background: 'rgba(140,189,232,0.13)', color: '#8cbde8' }}>
          T
        </span>
      );
    }
    return (
      <span title={hucreIpucu(v)} className={kutu} style={{ background: 'rgba(34,197,94,0.13)', color: '#4ade80' }}>
        ✓
      </span>
    );
  }
  if (v.status === 'SKIPPED') {
    return (
      <span title={hucreIpucu(v)} className={kutu} style={{ background: 'rgba(255,255,255,0.06)', color: TEXT2 }}>
        ·
      </span>
    );
  }
  return (
    <span title={hucreIpucu(v)} className={kutu} style={{ background: 'rgba(248,113,113,0.13)', color: '#f87171' }}>
      !
    </span>
  );
}

function Stat({ n, label, color, sub }: { n: number; label: string; color: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-2xl border p-4" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
      <div className="text-[26px] font-extrabold" style={{ color }}>{n}</div>
      <div className="mt-0.5 text-[11px] tracking-wide" style={{ color: MUTED }}>{label}</div>
      {sub ? <div className="mt-1 text-[11px]" style={{ color: MUTED }}>{sub}</div> : null}
    </div>
  );
}

export default function IletimRaporuPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [resending, setResending] = useState(false);
  const [yalnizSorunlu, setYalnizSorunlu] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['iletim-raporu', month],
    queryFn: () => api.get('/akilli-bildirim/report', { params: { month } }).then((r) => r.data),
    refetchInterval: 60000,
  });

  const resend = async () => {
    setResending(true);
    try {
      const r = await api.post('/akilli-bildirim/resend-failed', { month });
      const d = r.data || {};
      const denenen = d.denenen ?? d.retried ?? 0;
      const atlanan = d.atlanan ?? 0;
      toast.success(
        `${denenen} mükellef için yeniden denendi` +
          (atlanan ? ` · ${atlanan} tanesi atlandı (kategori kapalı veya ayar yok)` : ''),
      );
      qc.invalidateQueries({ queryKey: ['iletim-raporu', month] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Yeniden gönderilemedi');
    } finally {
      setResending(false);
    }
  };

  const totals = data?.totals || { total: 0, sent: 0, failed: 0, badContact: 0, bekleyen: 0, testGonderim: 0 };
  const tumRows: any[] = data?.taxpayers || [];

  const sorunluMu = (r: any) =>
    KATEGORI_COLS.some((k) => r[k.key] && r[k.key].status !== 'SENT') ||
    KATEGORI_COLS.some((k) => r[k.key]?.status === 'SENT' && r[k.key]?.testMode);

  const rows = useMemo(
    () => (yalnizSorunlu ? tumRows.filter(sorunluMu) : tumRows),
    [tumRows, yalnizSorunlu],
  );
  const sorunluSayisi = useMemo(() => tumRows.filter(sorunluMu).length, [tumRows]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <header className="relative overflow-hidden rounded-2xl border p-6" style={{ borderColor: CARD_BORDER, background: `radial-gradient(ellipse at top left, rgba(74,222,128,0.06), transparent 60%), ${CARD_BG}` }}>
        <h1 className="flex items-center gap-3 text-[22px] font-semibold text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)` }}>
            <ClipboardList size={20} style={{ color: '#1a1410' }} />
          </span>
          İletim Raporu
        </h1>
        <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
          Mükellefe gönderilen belgelerin dağıtım durumu — kim aldı, kim almadı, kime hiç gönderilmedi.
        </p>
        <div className="absolute right-6 top-6 flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* tarayıcı desteklemiyorsa elle yazılır */ } }}
            className="cursor-pointer rounded-lg border bg-transparent px-3 py-1.5 text-[13px] text-white outline-none [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert"
            style={{ borderColor: 'rgba(255,255,255,0.12)', colorScheme: 'dark' }}
          />
          <button
            onClick={resend}
            disabled={resending || totals.failed === 0}
            title="Yalnızca BAŞARISIZ gönderimleri yeniden dener. Daha önce başarıyla iletilmiş belge tekrar gönderilmez."
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)', opacity: resending || totals.failed === 0 ? 0.5 : 1 }}
          >
            {resending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Başarısızları Yeniden Dene ({totals.failed})
          </button>
        </div>
      </header>

      {/* Test modu uyarısı — "iletildi" sanılan gönderimler aslında mükellefe
          ulaşmıyor. Sayaçtan da ayrıldı, ama görünür bir uyarı da şart. */}
      {totals.testGonderim > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border p-4 text-[12.5px]" style={{ borderColor: 'rgba(140,189,232,0.28)', background: 'rgba(140,189,232,0.06)', color: '#8cbde8' }}>
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            <b>{totals.testGonderim} gönderim test modunda</b> yapıldı — belgeler mükellefe değil, test
            numarasına/e-postasına gitti. Tabloda <b style={{ color: '#8cbde8' }}>T</b> ile gösterilir ve
            &quot;iletildi&quot; sayılmaz. Gerçek gönderim için Ayarlar &gt; Akıllı Bildirim&apos;de test modunu kapatın.
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-3.5">
        <Stat n={totals.total} label="GÖNDERİM KAYDI" color={GOLD} sub={`${totals.mukellefSayisi ?? tumRows.length} mükellef`} />
        <Stat n={totals.sent} label="İLETİLDİ" color="#4ade80" sub={totals.testGonderim ? `${totals.testGonderim} test gönderimi hariç` : undefined} />
        <Stat
          n={totals.failed}
          label="İLETİLMEDİ"
          color="#f87171"
          /* badContact, failed'in ALT KÜMESİ. Ayrı kart olsaydı toplam
             yanlış okunurdu (2 + 2 = 4 sanılırdı). */
          sub={totals.badContact ? `${totals.badContact} tanesi iletişim bilgisi eksik` : undefined}
        />
        <Stat n={totals.bekleyen ?? 0} label="HİÇ GÖNDERİLMEDİ" color="#fbbf24" sub="belge var, gönderim yok" />
      </div>

      <div className="overflow-x-auto rounded-2xl border p-4" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[12.5px]" style={{ color: MUTED }}>
            {tumRows.length} mükellef · <span style={{ color: sorunluSayisi ? '#f87171' : '#4ade80' }}>{sorunluSayisi} tanesinde eksik var</span>
          </div>
          <button
            onClick={() => setYalnizSorunlu((v) => !v)}
            className="rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition"
            style={
              yalnizSorunlu
                ? { borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.12)', color: '#f87171' }
                : { borderColor: 'rgba(255,255,255,0.12)', background: 'transparent', color: TEXT2 }
            }
          >
            {yalnizSorunlu ? 'Tümünü göster' : 'Yalnız eksikleri göster'}
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-[13px]" style={{ color: MUTED }}>
            <Loader2 size={16} className="animate-spin" /> Yükleniyor…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-[13px]" style={{ color: MUTED }}>
            {yalnizSorunlu
              ? 'Eksik gönderim yok — bu ayki belgelerin tamamı iletilmiş.'
              : 'Bu ay ne gönderim kaydı ne de gönderilecek belge var. Gönderimler Ayarlar > Akıllı Bildirim’den yönetilir.'}
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }}>Mükellef</th>
                {KATEGORI_COLS.map((k) => (
                  <th key={k.key} className="border-b px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }}>{k.label}</th>
                ))}
                <th className="border-b px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED, borderColor: 'rgba(255,255,255,0.1)' }}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bekleyen = KATEGORI_COLS.filter((k) => r[k.key]?.status === 'BEKLIYOR');
                const hatali = KATEGORI_COLS.filter((k) => r[k.key]?.status === 'FAILED');
                const testli = KATEGORI_COLS.filter((k) => r[k.key]?.status === 'SENT' && r[k.key]?.testMode);
                // Sebep artık sabit koddan okunuyor; serbest metin araması
                // metin değiştiği anda sessizce bozuluyordu.
                const iletisimHata = hatali.some((k) => String(r[k.key]?.error || '').startsWith('ILETISIM-'));
                // Neden gönderilmediği ROZETİN İÇİNDE yazsın — kullanıcının
                // hücrenin üstüne gelmesi gerekmesin.
                const bekleyenSebep = bekleyen.length ? sebepMetni(r[bekleyen[0].key]?.error) : null;
                return (
                  <tr key={r.taxpayerId}>
                    <td className="border-b px-3 py-2.5 text-white" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>{r.unvan}</td>
                    {KATEGORI_COLS.map((k) => (
                      <td key={k.key} className="border-b px-3 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Cell v={r[k.key]} />
                      </td>
                    ))}
                    <td className="border-b px-3 py-2.5 text-right" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      {bekleyen.length > 0 ? (
                        <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                          Gönderilmedi · {bekleyenSebep}
                        </span>
                      ) : iletisimHata ? (
                        <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>İletişim bilgisi eksik</span>
                      ) : hatali.length > 0 ? (
                        <span
                          title={sebepMetni(r[hatali[0].key]?.error)}
                          className="rounded-full px-3 py-0.5 text-[11.5px] font-bold"
                          style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}
                        >
                          {hatali.length} iletilemedi
                        </span>
                      ) : testli.length > 0 ? (
                        <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(140,189,232,0.12)', color: '#8cbde8' }}>Test gönderimi</span>
                      ) : (
                        <span className="rounded-full px-3 py-0.5 text-[11.5px] font-bold" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>Tamam</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-[11.5px]" style={{ color: MUTED }}>
          <span><span style={{ color: '#4ade80' }}>✓</span> mükellefe iletildi</span>
          <span><span style={{ color: '#8cbde8' }}>T</span> test alıcısına gitti (mükellef almadı)</span>
          <span><span style={{ color: '#f87171' }}>!</span> denendi, iletilemedi</span>
          <span><span style={{ color: '#fbbf24' }}>⏳</span> belge var, hiç gönderilmedi</span>
          <span>– bu kategoride belge yok</span>
        </div>
      </div>
    </div>
  );
}
