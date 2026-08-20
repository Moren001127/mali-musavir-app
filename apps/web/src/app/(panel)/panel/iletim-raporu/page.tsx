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
import {
  Loader2, Send, ClipboardList, AlertTriangle,
  Check, X, Clock, Ban, FlaskConical, Minus, Settings2,
} from 'lucide-react';

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

/**
 * Hücre görünümü — emoji/harf yerine NET İKON.
 * Önceki hâlinde ⏳ ve "T" vardı; ikisi de ne anlama geldiği okunmadan
 * anlaşılmıyordu ve satır yüksekliğini bozuyordu.
 */
const DURUMLAR = {
  iletildi:   { ikon: Check,        renk: '#4ade80', zemin: 'rgba(34,197,94,0.14)',   cerceve: 'rgba(34,197,94,0.35)' },
  hata:       { ikon: X,            renk: '#f87171', zemin: 'rgba(248,113,113,0.14)', cerceve: 'rgba(248,113,113,0.35)' },
  kapali:     { ikon: Ban,          renk: '#fbbf24', zemin: 'rgba(251,191,36,0.14)',  cerceve: 'rgba(251,191,36,0.35)' },
  bekliyor:   { ikon: Clock,        renk: '#fbbf24', zemin: 'rgba(251,191,36,0.14)',  cerceve: 'rgba(251,191,36,0.35)' },
  test:       { ikon: FlaskConical, renk: '#8cbde8', zemin: 'rgba(140,189,232,0.14)', cerceve: 'rgba(140,189,232,0.35)' },
  yok:        { ikon: Minus,        renk: 'rgba(255,255,255,0.28)', zemin: 'rgba(255,255,255,0.04)', cerceve: 'rgba(255,255,255,0.08)' },
} as const;

type DurumAnahtari = keyof typeof DURUMLAR;

/** Hücrenin hangi görsel duruma karşılık geldiği — tek karar noktası */
function hucreDurumu(v: Hucre | null): DurumAnahtari {
  if (!v) return 'yok';
  if (v.status === 'BEKLIYOR') return /kapalı|kapsam dışı|pasif/i.test(String(v.error || '')) ? 'kapali' : 'bekliyor';
  if (v.status === 'SENT') return v.testMode ? 'test' : 'iletildi';
  if (v.status === 'SKIPPED') return 'yok';
  return 'hata';
}

function Rozet({ durum, ipucu, boyut = 26 }: { durum: DurumAnahtari; ipucu?: string; boyut?: number }) {
  const d = DURUMLAR[durum];
  const Ikon = d.ikon;
  return (
    <span
      title={ipucu}
      className="inline-flex items-center justify-center rounded-full border"
      style={{ width: boyut, height: boyut, background: d.zemin, borderColor: d.cerceve, color: d.renk }}
    >
      <Ikon size={Math.round(boyut * 0.54)} strokeWidth={2.6} />
    </span>
  );
}

function Cell({ v }: { v: Hucre | null }) {
  return <Rozet durum={hucreDurumu(v)} ipucu={v ? hucreIpucu(v) : 'Bu ay bu kategoride belge yok'} />;
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
          (atlanan ? ` · ${atlanan} tanesi atlandı` : ''),
      );
      // Aylık Ödeme Listesi buradan yeniden gönderilemez (cetvelin tamamı
      // yeniden giderdi); kullanıcı doğru ekrana yönlendiriliyor.
      if (d.not) toast.info(d.not, { duration: 9000 });
      qc.invalidateQueries({ queryKey: ['iletim-raporu', month] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Yeniden gönderilemedi');
    } finally {
      setResending(false);
    }
  };

  const totals = data?.totals || { total: 0, sent: 0, failed: 0, badContact: 0, bekleyen: 0, testGonderim: 0 };
  const tumRows: any[] = data?.taxpayers || [];

  /**
   * SATIR ÖZETİ — durum sütununda ne yazacağını tek yerde karar verir.
   *
   * Eski hâlinde sebep cümlesi ("Gönderilmedi · kategori kapalı (Ayarlar >
   * Akıllı Bildirim)") HER SATIRDA tam olarak yazılıyordu. 82 satırın hepsinde
   * aynı cümle olduğu için sütun iki satıra taşıyor ve tabloyu okunmaz
   * hâle getiriyordu. Artık satırda KISA etiket var, tam cümle üstüne
   * gelince; tekrar eden sebep ise tablonun üstünde TEK bandda yazıyor.
   */
  const satirOzeti = (r: any): { durum: DurumAnahtari; kisa: string; tam: string } => {
    const bekleyen = KATEGORI_COLS.filter((k) => r[k.key]?.status === 'BEKLIYOR');
    const hatali = KATEGORI_COLS.filter((k) => r[k.key]?.status === 'FAILED');
    const testli = KATEGORI_COLS.filter((k) => r[k.key]?.status === 'SENT' && r[k.key]?.testMode);

    if (hatali.length) {
      const iletisim = hatali.some((k) => String(r[k.key]?.error || '').startsWith('ILETISIM-'));
      const tam = hatali.map((k) => `${k.label}: ${sebepMetni(r[k.key]?.error)}`).join('\n');
      return {
        durum: 'hata',
        kisa: iletisim ? 'İletişim eksik' : hatali.length > 1 ? `${hatali.length} iletilemedi` : 'İletilemedi',
        tam,
      };
    }
    if (bekleyen.length) {
      const sebep = sebepMetni(r[bekleyen[0].key]?.error);
      const kapali = /kapalı|kapsam dışı|pasif/i.test(sebep);
      return {
        durum: kapali ? 'kapali' : 'bekliyor',
        kisa: kapali ? 'Kapalı' : 'Bekliyor',
        tam: bekleyen.map((k) => `${k.label}: ${sebepMetni(r[k.key]?.error)}`).join('\n'),
      };
    }
    if (testli.length) return { durum: 'test', kisa: 'Test', tam: 'Test alıcısına gitti, mükellef almadı' };
    return { durum: 'iletildi', kisa: 'Tamam', tam: 'Tüm belgeler mükellefe iletildi' };
  };

  const sorunluMu = (r: any) =>
    KATEGORI_COLS.some((k) => r[k.key] && r[k.key].status !== 'SENT') ||
    KATEGORI_COLS.some((k) => r[k.key]?.status === 'SENT' && r[k.key]?.testMode);

  const rows = useMemo(
    () => (yalnizSorunlu ? tumRows.filter(sorunluMu) : tumRows),
    [tumRows, yalnizSorunlu],
  );
  const sorunluSayisi = useMemo(() => tumRows.filter(sorunluMu).length, [tumRows]);

  /**
   * BASKIN SEBEP — tek bir ayar yüzünden yüzlerce satır aynı şeyi yazıyorsa
   * o cümle satırlara değil, tablonun üstüne aittir.
   */
  const baskinSebep = useMemo(() => {
    const say = new Map<string, number>();
    for (const r of tumRows) {
      for (const k of KATEGORI_COLS) {
        const h = r[k.key];
        if (h?.status !== 'BEKLIYOR') continue;
        const s = sebepMetni(h.error);
        say.set(s, (say.get(s) || 0) + 1);
      }
    }
    const en = [...say].sort((a, b) => b[1] - a[1])[0];
    // yalnız gerçekten tekrar eden bir sebep varsa banda çıkar
    return en && en[1] >= 5 ? { sebep: en[0], adet: en[1] } : null;
  }, [tumRows]);

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
            numarasına/e-postasına gitti. Tabloda deney şişesi simgesiyle gösterilir ve
            &quot;iletildi&quot; sayılmaz. Gerçek gönderim için Ayarlar &gt; Akıllı Bildirim&apos;de test modunu kapatın.
          </span>
        </div>
      )}

      {/* Tekrar eden sebep tek yerde — satırlarda 82 kez yazılmasına gerek yok */}
      {baskinSebep && (
        <div className="flex items-start gap-2.5 rounded-2xl border p-4 text-[12.5px]" style={{ borderColor: 'rgba(251,191,36,0.28)', background: 'rgba(251,191,36,0.05)', color: '#fbbf24' }}>
          <Settings2 size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            <b>{baskinSebep.adet} gönderim</b> aynı sebeple bekliyor: <b>{baskinSebep.sebep}</b>.
            Tabloda bu satırlar <b>Kapalı</b> olarak işaretli.
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
// table-fixed + colgroup: uzun ünvan sütunları itip durumu ekran dışına
          // taşımasın. Durum sütunu SABİT dar — eskiden serbest genişlikteydi ve
          // uzun sebep cümlesi tabloyu eziyordu.
          <table className="w-full min-w-[640px] table-fixed border-collapse text-[13px]">
            <colgroup>
              <col />
              <col style={{ width: 74 }} />
              <col style={{ width: 74 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 152 }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'rgba(212,184,118,0.05)' }}>
                <th className="border-b px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: GOLD, borderColor: 'rgba(212,184,118,0.2)' }}>Mükellef</th>
                {KATEGORI_COLS.map((k) => (
                  <th key={k.key} className="border-b px-3 py-2.5 text-center text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: GOLD, borderColor: 'rgba(212,184,118,0.2)' }}>{k.label}</th>
                ))}
                <th className="border-b px-3 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: GOLD, borderColor: 'rgba(212,184,118,0.2)' }}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ozet = satirOzeti(r);
                const d = DURUMLAR[ozet.durum];
                return (
                  <tr key={r.taxpayerId} className="transition hover:bg-white/[0.02]">
                    <td className="border-b px-3 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      <span className="block truncate text-white" title={r.unvan}>{r.unvan}</span>
                    </td>
                    {KATEGORI_COLS.map((k) => (
                      <td key={k.key} className="border-b px-3 py-2.5 text-center" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <Cell v={r[k.key]} />
                      </td>
                    ))}
                    <td className="border-b px-3 py-2.5 text-right" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      <span
                        title={ozet.tam}
                        className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-[11px] font-bold"
                        style={{ background: d.zemin, borderColor: d.cerceve, color: d.renk }}
                      >
                        {ozet.kisa}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
<div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[11.5px]" style={{ color: MUTED }}>
          {([
            ['iletildi', 'mükellefe iletildi'],
            ['test', 'test alıcısına gitti — mükellef almadı'],
            ['hata', 'denendi, iletilemedi'],
            ['kapali', 'kategori kapalı / kapsam dışı'],
            ['bekliyor', 'belge var, hiç gönderilmedi'],
            ['yok', 'bu kategoride belge yok'],
          ] as Array<[DurumAnahtari, string]>).map(([k, metin]) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <Rozet durum={k} boyut={18} />
              {metin}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
