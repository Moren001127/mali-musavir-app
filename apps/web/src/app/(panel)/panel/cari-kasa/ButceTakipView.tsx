'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import Link from 'next/link';
import { butceApi, pinBileti } from '@/lib/butce';
import PinEkrani from '../butce/PinEkrani';
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  Plus,
  X,
} from 'lucide-react';

// ===== SADE KOYU PALET (referans HTML'lere göre) =====
const GOLD = '#e6c878';
const DEBT = '#e0697a';
const OK = '#5ad18a';
const BG = '#08080a';
const PANEL = '#0c0c0e';
const CARD_BORDER = 'rgba(255,255,255,0.06)';
const CARD_BG = 'rgba(255,255,255,0.018)';
const ROW_LINE = 'rgba(255,255,255,0.05)';
const TEXT = '#e7e7ea';
const SOFT = '#71717a';
const SANS = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const OPTION_STYLE: React.CSSProperties = { background: '#15151a', color: TEXT };
const GOLD_GRAD = 'linear-gradient(135deg,#ecd589,#d4b876)';

export type FinancialAccount = {
  id: string;
  name: string;
  type: 'BANKA' | 'NAKIT' | 'KREDI_KARTI' | 'DIGER' | string;
  color: string;
  openingBalance: number;
  openingDate: string;
  sortOrder?: number;
  isActive: boolean;
  /** Kişisel Bütçe'deki karşılığı — doluysa bakiyenin tek sahibi orasıdır */
  butceBankaHesapId?: string | null;
  currentBalance: number;
  monthInflow: number;
  monthOutflow: number;
  monthIncome: number;
  monthExpense: number;
  monthTransferIn: number;
  monthTransferOut: number;
  monthNet: number;
};

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

const parseMoneyValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').replace(/TL|₺/gi, '').replace(/\s/g, '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw.replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};

const formatMoneyDraft = (value: unknown) => {
  const n = parseMoneyValue(value);
  return n ? fmt(n) : '';
};

const today = () => new Date().toISOString().slice(0, 10);
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

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
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid rgba(255,255,255,0.10)`,
  color: TEXT,
  outline: 'none',
  fontSize: 14,
};
const selectStyle: React.CSSProperties = { ...inputStyle, colorScheme: 'dark' };

const cardline: React.CSSProperties = { border: `1px solid ${CARD_BORDER}`, background: CARD_BG };
const panelStyle: React.CSSProperties = { background: PANEL, border: '1px solid rgba(255,255,255,0.07)' };

// ===== Genel UI parçaları =====
/**
 * Bu ekranların para rakamları Kişisel Bütçe'den okunur; buradan giriş yapılmaz.
 * Not kısa tutuluyor — ekranın işi rakamı göstermek, kendini anlatmak değil.
 */
function CanliNot() {
  return (
    <p className="mt-4 text-[12.5px]" style={{ color: SOFT }}>
      Rakamlar{' '}
      <Link href="/panel/butce" className="underline underline-offset-2" style={{ color: GOLD }}>
        Kişisel Bütçe
      </Link>
      'den canlı okunur; gelir/gider girişi oradan yapılır. Müşteri tahsilatı eskisi gibi Tahsilat
      ekranından girilir.
    </p>
  );
}

/**
 * Kişisel Bütçe'den okuyan blokların kapısı.
 *
 * Yetki ve PIN koruması /butce uçlarından MİRAS alınır — burada ikinci bir
 * yetki mantığı yazılmaz. Yazılsaydı ikisi zamanla ayrışır ve biri gevşerdi.
 * Ofis sahibi olmayan kullanıcı 404 alır; ekran bunu "yalnız ofis sahibi"
 * diye gösterir, çünkü ofis gider tablosunda kira ve personel maaşı var.
 */
function ButceKapisi({ baslik, children }: { baslik?: string; children: React.ReactNode }) {
  const [kilitAcik, setKilitAcik] = useState(false);

  useEffect(() => {
    setKilitAcik(!!pinBileti.al());
    const kilitle = () => setKilitAcik(false);
    window.addEventListener('butce-pin-gerekli', kilitle);
    return () => window.removeEventListener('butce-pin-gerekli', kilitle);
  }, []);

  const erisim = useQuery({ queryKey: ['butce-erisim'], queryFn: butceApi.erisim, retry: false });

  const sarmala = (icerik: React.ReactNode) => (
    <div className="mt-7">
      {baslik && (
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>
          {baslik}
        </h2>
      )}
      {icerik}
    </div>
  );

  if (erisim.isLoading) return sarmala(<LoadingPanel label="Yetki kontrol ediliyor..." />);

  if (erisim.isError) {
    return sarmala(
      <div className="rounded-2xl px-5 py-6 text-center" style={cardline}>
        <Lock className="mx-auto h-5 w-5" style={{ color: SOFT }} />
        <div className="mt-2.5 text-[14px] font-semibold" style={{ color: TEXT }}>
          Bu bilgi yalnız ofis sahibine görünür
        </div>
        <div className="mt-1 text-[12.5px]" style={{ color: SOFT }}>
          Ofis gelir/gider tablosu kira ve personel bilgisi içerdiği için kapalıdır.
        </div>
      </div>,
    );
  }

  if (!kilitAcik) {
    return sarmala(
      <div className="rounded-2xl px-5 py-5" style={cardline}>
        <PinEkrani acildi={() => setKilitAcik(true)} />
      </div>,
    );
  }

  return sarmala(children);
}

/** Ay seçici — yıl+dönem ikilisine gerek yok, tek ay yeter. */
function DonemSecici({ donem, onDonem }: { donem: string; onDonem: (d: string) => void }) {
  const kaydir = (adim: number) => {
    const [y, a] = donem.split('-').map(Number);
    const d = new Date(y, a - 1 + adim, 1);
    onDonem(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <div className="flex items-center gap-1 rounded-xl px-1 py-1" style={{ border: `1px solid ${CARD_BORDER}` }}>
      <button onClick={() => kaydir(-1)} className="rounded-lg p-1.5 transition hover:bg-white/[0.06]" style={{ color: SOFT }} title="Önceki ay">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="px-2 text-[13px] font-medium tabular-nums" style={{ color: TEXT }}>{donem}</span>
      <button onClick={() => kaydir(1)} className="rounded-lg p-1.5 transition hover:bg-white/[0.06]" style={{ color: SOFT }} title="Sonraki ay">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

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

function SecondaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium transition disabled:opacity-50"
      style={{ border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)', color: TEXT }}
    >
      {children}
    </button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-[12.5px] font-medium" style={{ color: SOFT }}>{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-10" style={{ background: 'rgba(0,0,0,0.62)' }} onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-[18px] p-5 sm:p-6" style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-[17px] font-bold" style={{ color: '#fff' }}>{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.10)', color: SOFT }}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ====================================================================
// KASA / BANKA — rakamlar Kişisel Bütçe'den CANLI okunur
// ====================================================================

/**
 * Bu ekran para YAZMAZ, gösterir.
 *
 * Üst blok tahsilat hesapları: paranın hangi cüzdana girdiğini işaretlemek
 * için kullanılır, herkese açıktır, bakiye tutmaz. Alt blok ofisin gerçek
 * nakit durumu — Kişisel Bütçe'den canlı okunur ve yalnız ofis sahibine
 * görünür (ofis gider tablosunda kira ve personel maaşı var).
 */
export function KasaBankaView() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<null | 'account'>(null);
  const [accountForm, setAccountForm] = useState({
    name: '',
    type: 'BANKA',
    openingBalance: 0,
    openingDate: today(),
    color: '#d4b876',
  });
  const [savingAccount, setSavingAccount] = useState(false);

  const { data: accounts = [], isLoading } = useQuery<FinancialAccount[]>({
    queryKey: ['cari-accounts'],
    queryFn: () => api.get('/cari-kasa/accounts').then((r) => r.data),
  });

  const saveAccount = async () => {
    if (!accountForm.name.trim()) { toast.error('Hesap adı girin'); return; }
    setSavingAccount(true);
    try {
      await api.post('/cari-kasa/accounts', accountForm);
      toast.success('Hesap eklendi');
      setModal(null);
      setAccountForm((old) => ({ ...old, name: '', openingBalance: 0 }));
      qc.invalidateQueries({ queryKey: ['cari-accounts'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Hesap eklenemedi');
    } finally {
      setSavingAccount(false);
    }
  };

  if (isLoading) return <LoadingPanel />;

  return (
    <div style={{ fontFamily: SANS }}>
      <ViewHeader
        icon={LandmarkIcon}
        title="Kasa & Banka"
        subtitle={`${accounts.length} tahsilat hesabı · bakiyeler Kişisel Bütçe'den`}
        actions={<SecondaryBtn onClick={() => setModal('account')}><Plus className="h-4 w-4" /> Hesap</SecondaryBtn>}
      />

      <CanliNot />

      <h2 className="mt-7 mb-3 text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#a1a1aa' }}>
        Tahsilat hesapları
      </h2>
      {accounts.length === 0 ? (
        <EmptyState label="Henüz hesap yok. Sağ üstten Hesap ekleyin." />
      ) : (
        <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT }}>
                  <th className="px-5 py-3.5 text-left font-medium">Hesap</th>
                  <th className="px-3 py-3.5 text-left font-medium">Tür</th>
                  <th className="px-5 py-3.5 text-left font-medium">Bütçe bağlantısı</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color || GOLD }} />
                        <span style={{ color: TEXT }}>{a.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5" style={{ color: SOFT }}>{a.type}</td>
                    <td className="px-5 py-3.5">
                      {a.butceBankaHesapId ? (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: OK }}>
                          <Check className="h-3.5 w-3.5" /> bağlı
                        </span>
                      ) : (
                        <span className="text-[12.5px]" style={{ color: SOFT }}>bağlı değil</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-2.5 text-[12px]" style={{ color: SOFT }}>
        Bağlantı{' '}
        <Link href="/panel/butce" className="underline underline-offset-2" style={{ color: GOLD }}>
          Kişisel Bütçe &gt; Hesaplar
        </Link>{' '}
        ekranından kurulur. Bağlanmayan hesaba giren tahsilat bakiyeye işlenmez.
      </p>

      <ButceKapisi baslik="Ofis nakit durumu">
        <OfisNakitDurumu />
      </ButceKapisi>

      {modal === 'account' && (
        <Modal title="Hesap ekle" onClose={() => setModal(null)}>
          <AccountFormBody form={accountForm} setForm={setAccountForm} saving={savingAccount} onSave={saveAccount} />
        </Modal>
      )}
    </div>
  );
}

/**
 * Kişisel Bütçe'nin hesap bakiyeleri — burada yalnız GÖSTERİLİR.
 * Aynı uçtan okunur ki iki ekran asla farklı sayı gösteremesin.
 */
function OfisNakitDurumu() {
  const hesaplar = useQuery({ queryKey: ['butce-hesaplar'], queryFn: butceApi.hesaplar });
  const kasa = useQuery({ queryKey: ['butce-kasa'], queryFn: () => butceApi.kasa(), staleTime: 30_000 });
  const ofis = useQuery({ queryKey: ['butce-ofis-hesaplar'], queryFn: butceApi.ofisHesaplar, staleTime: 60_000 });

  if (hesaplar.isLoading) return <LoadingPanel />;
  const liste = (hesaplar.data || []).filter((h) => h.aktif);
  const kasaBakiye = kasa.data?.bakiye || 0;
  const bankada = liste.reduce((t, h) => t + h.bakiye, 0);
  const kmh = liste.reduce((t, h) => t + h.kmhBorcu, 0);
  const hesapsiz = ofis.data?.hesabiSecilmemisTahsilat;
  const arsiv = ofis.data?.arsivTahsilat;

  return (
    <>
      {!!hesapsiz?.adet && (
        <div
          className="mt-5 rounded-2xl px-4 py-3 text-[13.5px] font-medium"
          style={{ background: 'rgba(230,200,120,0.06)', border: '1px solid rgba(230,200,120,0.22)', color: GOLD }}
        >
          {hesapsiz.adet} tahsilatta banka/kasa hesabı seçilmemiş ({fmt(hesapsiz.toplam)} ₺). Paranın hangi
          cüzdana girdiği bilinmediği için bakiyeye eklenmedi — Tahsilat ekranından hesabı seçilince düzelir.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Toplam Nakit" value={fmt(bankada + kasaBakiye)} accent />
        <KpiCard label="Bankada" value={fmt(bankada)} />
        <KpiCard label="Kasada" value={fmt(kasaBakiye)} />
        <KpiCard label="KMH Borcu" value={fmt(kmh)} color={kmh > 0 ? DEBT : TEXT} />
      </div>

      {!!arsiv?.adet && (
        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: SOFT }}>
          Ayrıca Hattat'tan aktarılan {arsiv.adet} eski tahsilat ({fmt(arsiv.toplam)} ₺) arşivdir: hesap bilgisi
          taşımaz ve bakiyeye girmez. Açılış bakiyeniz o dönemi zaten içerdiği için ikinci kez sayılmaması gerekir.
        </p>
      )}

      {liste.length === 0 ? (
        <div className="mt-5"><EmptyState label="Kişisel Bütçe'de banka hesabı tanımlı değil." /></div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT }}>
                  <th className="px-5 py-3.5 text-left font-medium">Hesap</th>
                  <th className="px-3 py-3.5 text-right font-medium">Bakiye</th>
                  <th className="px-5 py-3.5 text-right font-medium">Kullanılabilir</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((h) => (
                  <tr key={h.id} style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: h.renk || GOLD }} />
                        <span style={{ color: TEXT }}>{h.bankaAdi} · {h.ad}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-right" style={{ color: h.bakiye < 0 ? DEBT : TEXT, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(h.bakiye)} ₺
                    </td>
                    <td className="px-5 py-3.5 text-right" style={{ color: SOFT, fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(h.kullanilabilir)} ₺
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function LandmarkIcon(props: React.ComponentProps<typeof BarChart3>) {
  // referans header ikonu yerine paket içi ikon kullan
  return <BarChart3 {...props} />;
}

function AccountFormBody({ form, setForm, saving, onSave }: {
  form: any;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Ad"><input value={form.name} onChange={(e) => setForm((old: any) => ({ ...old, name: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={inputStyle} /></Field>
        <Field label="Tür">
          <select value={form.type} onChange={(e) => setForm((old: any) => ({ ...old, type: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl" style={selectStyle}>
            <option value="BANKA" style={OPTION_STYLE}>Banka</option>
            <option value="NAKIT" style={OPTION_STYLE}>Nakit</option>
            <option value="KREDI_KARTI" style={OPTION_STYLE}>Kredi Kartı</option>
            <option value="DIGER" style={OPTION_STYLE}>Diğer</option>
          </select>
        </Field>
        <Field label="Açılış Bakiyesi"><input type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm((old: any) => ({ ...old, openingBalance: Number(e.target.value) }))} className="w-full px-3 py-2.5 rounded-xl" style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} /></Field>
        <Field label="Renk"><input type="color" value={form.color} onChange={(e) => setForm((old: any) => ({ ...old, color: e.target.value }))} className="w-full h-[42px] rounded-xl" style={{ ...inputStyle, padding: 4 }} /></Field>
      </div>
      <button onClick={onSave} disabled={saving} className="w-full py-2.5 rounded-xl text-[14px] font-bold text-black disabled:opacity-60" style={{ background: GOLD_GRAD }}>
        {saving ? <Loader2 size={14} className="animate-spin inline" /> : <><Plus size={14} className="inline mr-1" /> Hesap Ekle</>}
      </button>
    </div>
  );
}

// ====================================================================
// GELİR - GİDER — Kişisel Bütçe'nin ofis rakamları, CANLI ve salt okunur
// ====================================================================
export function GelirGiderTablosuView() {
  const [donem, setDonem] = useState(currentPeriod());

  return (
    <div style={{ fontFamily: SANS }}>
      <ViewHeader
        icon={BarChart3}
        title="Gelir-Gider"
        subtitle={`${donem} · ofis gelir-gider özeti`}
        actions={<DonemSecici donem={donem} onDonem={setDonem} />}
      />
      <CanliNot />
      <ButceKapisi>
        <OfisGelirGider donem={donem} />
      </ButceKapisi>
    </div>
  );
}

function OfisGelirGider({ donem }: { donem: string }) {
  const ozet = useQuery({
    queryKey: ['butce-ozet', donem, 'OFIS'],
    queryFn: () => butceApi.ozet(donem, 'OFIS'),
  });

  if (ozet.isLoading || !ozet.data) return <LoadingPanel />;
  const o = ozet.data;
  // Şahıs firmasında gelir TEK HAVUZ; ayrım yalnız giderde. Gösterilen kazanç
  // vergi matrahına esas rakamdır: kişisel harcamalar bu hesaba girmez.
  const kazanc = o.meslekiKazanc;
  const giderler = (o.kategoriKirilim || []).filter((k) => k.defter === 'OFIS');
  const trend = o.trend || [];
  const enBuyuk = Math.max(...trend.map((t) => Math.max(t.gelir, t.gider)), 1);

  return (
    <>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Gelir" value={fmt(o.gelir)} color={OK} />
        <KpiCard label="Ofis Gideri" value={fmt(o.meslekiGider)} color={DEBT} />
        <KpiCard label="Kazanç" value={(kazanc >= 0 ? '+' : '') + fmt(kazanc)} color={kazanc >= 0 ? GOLD : DEBT} accent />
      </div>

      <div className="mt-6 rounded-2xl px-5 sm:px-6 py-5" style={cardline}>
        <div className="text-[14px] font-semibold" style={{ color: TEXT }}>Son 6 ay · gelir / gider</div>
        <div className="mt-6 flex items-end justify-between gap-2 sm:gap-3" style={{ height: 170 }}>
          {trend.map((m) => (
            <div
              key={m.donem}
              className="flex h-full flex-1 items-end justify-center gap-[3px] sm:gap-1.5"
              title={`${m.donem} · Gelir ${fmt(m.gelir)} ₺ · Gider ${fmt(m.gider)} ₺`}
            >
              <div className="w-full max-w-[14px]" style={{ height: `${Math.max(2, (m.gelir / enBuyuk) * 100)}%`, background: OK, borderRadius: '5px 5px 2px 2px' }} />
              <div className="w-full max-w-[14px]" style={{ height: `${Math.max(2, (m.gider / enBuyuk) * 100)}%`, background: DEBT, borderRadius: '5px 5px 2px 2px' }} />
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 sm:gap-3 text-[11px]" style={{ color: SOFT }}>
          {trend.map((m) => (
            <div key={m.donem} className="flex-1 text-center" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {m.donem.slice(5, 7)}/{m.donem.slice(2, 4)}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-7">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full" style={{ background: DEBT }} />
          <h2 className="text-[15px] font-semibold" style={{ color: '#fff' }}>Ofis gider kalemleri</h2>
          <span className="text-[12px]" style={{ color: SOFT }}>· {giderler.length} kalem</span>
        </div>
        {giderler.length === 0 ? (
          <EmptyState label="Bu dönemde ofis gideri kaydı yok." />
        ) : (
          <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${CARD_BORDER}` }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-[14px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider" style={{ color: SOFT }}>
                    <th className="px-5 py-3.5 text-left font-medium">Kalem</th>
                    <th className="px-5 py-3.5 text-right font-medium">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {giderler.map((k) => (
                    <tr key={k.ad} style={{ borderTop: `1px solid ${ROW_LINE}` }}>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.renk || DEBT }} />
                          <span style={{ color: TEXT }}>{k.ad}</span>
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right" style={{ color: TEXT, fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(k.tutar)} ₺
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-[12px]" style={{ color: '#52525b' }}>
        Kazanç = gelir − ofis gideri · kişisel harcamalar bu hesaba girmez
      </p>
    </>
  );
}

// ====================================================================
// İSTATİSTİK
// ====================================================================
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

export default KasaBankaView;
