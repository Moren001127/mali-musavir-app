'use client';

/**
 * Cari Kasa > İstatistik — tahakkuk/tahsilat göstergeleri.
 *
 * Bu dosya eskiden "ButceTakipView" idi ve ofis gelir/gider takibini de
 * barındırıyordu. O iş Kişisel Bütçe modülüne taşındı (2026-08-18); burada
 * yalnız cari_hareketler'den beslenen istatistik kaldı. Dosya adı da işine
 * uysun diye yeniden adlandırıldı — "bütçe" adını taşıyan ama bütçeyle ilgisi
 * kalmayan bir dosya, sonraki okuyanı yanlış yere bakmaya gönderirdi.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { BarChart3, Loader2 } from 'lucide-react';

// ===== SADE KOYU PALET (referans HTML'lere göre) =====
const GOLD = '#e6c878';
const DEBT = '#e0697a';
const OK = '#5ad18a';
const CARD_BORDER = 'rgba(255,255,255,0.06)';
const CARD_BG = 'rgba(255,255,255,0.018)';
const ROW_LINE = 'rgba(255,255,255,0.05)';
const TEXT = '#e7e7ea';
const SOFT = '#71717a';
const SANS = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

type Istatistik = {
  kpi: {
    aylikHedef: number;
    buAyTahakkuk: number;
    buAyTahsilat: number;
    gecenAyTahsilat: number;
    toplamTahakkuk12Ay: number;
    toplamTahsilat12Ay: number;
    tahsilatOrani: number;
    toplamAktifBorc: number;
    borcluMukellefAdet: number;
  };
  trend: Array<{ ay: string; tahakkuk: number; tahsilat: number }>;
  odemeYontemi: Array<{ yontem: string; tutar: number }>;
  enBorclular: Array<{ id: string; ad: string; taxNumber?: string | null; bakiye: number }>;
};

const fmt = (n: number | null | undefined) => {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const ayKisaLabel = (ay: string) => {
  const m = Number(ay.slice(5, 7));
  return AY_KISA[m - 1] || ay;
};

const odemeYontemiLabel = (k: string) => {
  const map: Record<string, string> = {
    NAKIT: 'Nakit',
    HAVALE: 'Havale / EFT',
    EFT: 'EFT',
    KREDI_KARTI: 'Kredi Kartı',
    CEK: 'Çek',
    SENET: 'Senet',
    BELIRTILMEMIS: 'Belirtilmemiş',
  };
  return map[k] || k;
};

// ===== Ortak stiller =====

// ===== Ortak stiller =====
const cardline: React.CSSProperties = { border: `1px solid ${CARD_BORDER}`, background: CARD_BG };

function ViewHeader({ icon: Icon, title, subtitle, actions }: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  // Portal dili: gradyan zemin + köşede radial parıltı. Dört görünüm de bu
  // başlığı kullandığı için tek değişiklik hepsini birden dönüştürür.
  return (
    <header
      className="relative overflow-hidden rounded-2xl px-5 py-4"
      style={{
        background: 'linear-gradient(140deg, rgba(230,200,120,0.08), rgba(255,255,255,0.01) 58%)',
        border: `1px solid ${CARD_BORDER}`,
      }}
    >
      <span
        className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full opacity-[0.22]"
        style={{ background: `radial-gradient(circle, ${GOLD}, transparent 66%)` }}
      />
      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3.5 min-w-0">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{
              background: `linear-gradient(140deg, ${GOLD}2e, rgba(255,255,255,0.01) 65%)`,
              border: `1px solid ${GOLD}3d`,
              color: GOLD,
            }}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold tracking-tight leading-none" style={{ color: '#fff' }}>{title}</h1>
            {subtitle && <p className="mt-1.5 text-[12.5px]" style={{ color: SOFT }}>{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
      </div>
    </header>
  );
}


function KpiCard({ label, value, color = TEXT, accent = false, suffix = '₺' }: {
  label: string;
  value: string;
  color?: string;
  accent?: boolean;
  suffix?: string;
}) {
  // Vurgu rengi kartın kendi rengidir; altın her karta sabitlenmiyordu,
  // artık gelir yeşil / gider kırmızı kendi tonuyla parlıyor.
  const vurguRenk = color || GOLD;
  return (
    <div
      className="relative overflow-hidden rounded-2xl px-4 py-3.5"
      style={
        accent
          ? {
              background: `linear-gradient(140deg, ${vurguRenk}1f, rgba(255,255,255,0.01) 60%)`,
              border: `1px solid ${vurguRenk}3d`,
              boxShadow: '0 14px 32px rgba(0,0,0,0.20)',
            }
          : { ...cardline, boxShadow: '0 14px 32px rgba(0,0,0,0.20)' }
      }
    >
      <span
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-[0.16]"
        style={{ background: `radial-gradient(circle, ${vurguRenk}, transparent 68%)` }}
      />
      <div className="relative text-[11px] font-medium uppercase tracking-wider" style={{ color: SOFT }}>{label}</div>
      <div
        className="relative mt-1.5 text-[21px] font-semibold"
        style={{ color: vurguRenk, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}{suffix ? <span className="text-[14px] ml-1" style={{ color: SOFT }}>{suffix}</span> : null}
      </div>
    </div>
  );
}


function LoadingPanel({ label = 'Hesaplanıyor...' }: { label?: string }) {
  return (
    <div className="py-16 text-center text-[14px] font-medium" style={{ color: SOFT }}>
      <Loader2 className="animate-spin inline mr-2" size={16} />{label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl px-5 py-12 text-center text-[14px]" style={{ ...cardline, color: SOFT }}>
      {label}
    </div>
  );
}


export function IstatistikView() {
  const { data, isLoading } = useQuery<Istatistik>({
    queryKey: ['cari-istatistikler'],
    queryFn: () => api.get('/cari-kasa/istatistikler').then((r) => r.data),
    refetchInterval: 60000,
  });

  if (isLoading || !data) return <LoadingPanel />;

  const kpi = data.kpi;
  const trend = data.trend || [];
  const maxTrend = Math.max(...trend.map((t) => Math.max(t.tahakkuk, t.tahsilat)), 1);

  const odeme = data.odemeYontemi || [];
  const odemeToplam = odeme.reduce((s, o) => s + o.tutar, 0);
  const odemePalette = ['#e6c878', '#d4b876', '#5ad18a', '#9b9ba3', '#e0697a', '#6f6f77'];

  const borclular = data.enBorclular || [];
  const hasData = trend.some((t) => t.tahakkuk || t.tahsilat) || odeme.length > 0 || borclular.length > 0;

  const milyon = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + 'M';
    if (Math.abs(n) >= 1_000) return (n / 1_000).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + 'K';
    return fmt(n);
  };

  return (
    <div style={{ fontFamily: SANS }}>
      <ViewHeader icon={BarChart3} title="İstatistik" subtitle="Son 12 ay · genel bakış" />

      {!hasData ? (
        <div className="mt-6"><EmptyState label="Henüz istatistik için yeterli hareket yok." /></div>
      ) : (
        <>
          {/* KPI */}
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="12 Ay Tahakkuk" value={milyon(kpi.toplamTahakkuk12Ay)} color={OK} />
            <KpiCard label="12 Ay Tahsilat" value={milyon(kpi.toplamTahsilat12Ay)} color={DEBT} />
            <KpiCard label="Net" value={(kpi.toplamTahsilat12Ay - kpi.toplamTahakkuk12Ay >= 0 ? '+' : '') + milyon(kpi.toplamTahsilat12Ay - kpi.toplamTahakkuk12Ay)} color={GOLD} accent />
            <KpiCard label="Tahsilat Oranı" value={'%' + kpi.tahsilatOrani.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} color={OK} suffix="" />
          </div>

          {/* BAR CHART */}
          <div className="mt-6 rounded-2xl px-5 sm:px-6 py-5" style={cardline}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[14px] font-semibold" style={{ color: TEXT }}>Son 12 ay · tahakkuk / tahsilat</div>
              <div className="flex items-center gap-4 text-[12px]" style={{ color: '#a1a1aa' }}>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OK }} />Tahakkuk</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DEBT }} />Tahsilat</span>
              </div>
            </div>
            <div className="mt-7 flex items-end justify-between gap-2 sm:gap-3" style={{ height: 200 }}>
              {trend.map((m) => (
                <div key={m.ay} className="flex h-full flex-1 items-end justify-center gap-[3px] sm:gap-1.5" title={`${ayKisaLabel(m.ay)} · Tahakkuk ${fmt(m.tahakkuk)} ₺ · Tahsilat ${fmt(m.tahsilat)} ₺`}>
                  <div className="w-full max-w-[14px]" style={{ height: `${Math.max(2, (m.tahakkuk / maxTrend) * 100)}%`, background: OK, borderRadius: '5px 5px 2px 2px' }} />
                  <div className="w-full max-w-[14px]" style={{ height: `${Math.max(2, (m.tahsilat / maxTrend) * 100)}%`, background: DEBT, borderRadius: '5px 5px 2px 2px' }} />
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 sm:gap-3 text-[11px]" style={{ color: SOFT }}>
              {trend.map((m) => <div key={m.ay} className="flex-1 text-center" style={{ fontVariantNumeric: 'tabular-nums' }}>{ayKisaLabel(m.ay)}</div>)}
            </div>
          </div>

          {/* İKİ KOLON */}
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Ödeme yöntemi dağılımı */}
            <div className="rounded-2xl px-5 sm:px-6 py-5" style={cardline}>
              <div className="text-[14px] font-semibold" style={{ color: TEXT }}>Tahsilat · ödeme yöntemi dağılımı</div>
              {odeme.length === 0 ? (
                <div className="mt-5 text-[13px]" style={{ color: SOFT }}>Tahsilat kaydı yok.</div>
              ) : (
                <div className="mt-5 space-y-4">
                  {odeme.map((o, i) => {
                    const pct = odemeToplam > 0 ? Math.round((o.tutar / odemeToplam) * 100) : 0;
                    return (
                      <div key={o.yontem}>
                        <div className="flex items-center justify-between text-[13px]">
                          <span style={{ color: '#d4d4d8' }}>{odemeYontemiLabel(o.yontem)}</span>
                          <span className="font-semibold" style={{ color: TEXT, fontVariantNumeric: 'tabular-nums' }}>%{pct} · {fmt(o.tutar)} ₺</span>
                        </div>
                        <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: odemePalette[i % odemePalette.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* En borçlu mükellefler */}
            <div className="rounded-2xl px-5 sm:px-6 py-5" style={cardline}>
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-semibold" style={{ color: TEXT }}>En borçlu mükellefler</div>
                <div className="text-[12px]" style={{ color: SOFT }}>{kpi.borcluMukellefAdet} borçlu · {fmt(kpi.toplamAktifBorc)} ₺</div>
              </div>
              {borclular.length === 0 ? (
                <div className="mt-4 text-[13px]" style={{ color: SOFT }}>Borçlu mükellef yok.</div>
              ) : (
                <div className="mt-3">
                  {borclular.map((d) => (
                    <div key={d.id} className="flex items-center justify-between py-3" style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                      <div className="min-w-0">
                        <div className="text-[14px] truncate" style={{ color: '#e4e4e7' }}>{d.ad}</div>
                        {d.taxNumber && <div className="text-[11.5px]" style={{ color: SOFT, fontVariantNumeric: 'tabular-nums' }}>{d.taxNumber}</div>}
                      </div>
                      <span className="text-[14px] font-bold whitespace-nowrap ml-3" style={{ color: DEBT, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.bakiye)} ₺</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


export default IstatistikView;
