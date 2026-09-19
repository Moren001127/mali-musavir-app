'use client';
import { portalStyle, portalPaint } from '@/lib/portal-theme';


// Bildirimler — sade, göz yormayan liste (2026-09-14 yeniden tasarım).
//   Başlık şeridi + tek satır süzgeç (Tümü / Okunmamış / Kritik, arama, tür) + güne göre gruplu liste.
//   Satır: tür ikonu · başlık · tek/iki satır açıklama · sağda saat. Tıkla → ilgili ekran + okundu.
//   Aynı bildirimin tekrarları tek satırda "×N" ile katlanır. Ham tür kodu ve büyük düğme yok.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Bell, BellOff, Check, CheckCheck, ChevronDown, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  ALTIN, GRI, GUN_SIRASI, IKINCIL, KENAR, KENAR_KOYU, KIRMIZI, METIN, SONUK, TUR, ZEMIN, ZEMIN_HOVER,
  bildirimBaglantisi, gunGrubu, kisaZaman, kritikMi, satirlariKur, tamZaman, temizBaslik, temizGovde, tur, turKodu,
  type Bildirim, type GunGrubu, type Satir,
} from './_components/katalog';

type Sekme = 'tumu' | 'okunmamis' | 'kritik';

const BASLIK_ZEMIN =
  'radial-gradient(120% 150% at 0% 0%, rgba(212,184,118,.14), transparent 46%), radial-gradient(90% 120% at 100% 0%, rgba(127,166,221,.10), transparent 46%), #0f0d0b';
const KART_ZEMIN = 'linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))';
const KART_GOLGE = 'inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 30px rgba(0,0,0,0.25)';
const OK_SVG = (c: string) =>
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23${c}' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")`;

export default function BildirimlerPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [sekme, setSekme] = useState<Sekme>('tumu');
  const [turSuzgec, setTurSuzgec] = useState('');
  const [arama, setArama] = useState('');
  const [tercihAcik, setTercihAcik] = useState(false);

  // Sekmeye geri dönünce taze veri
  useEffect(() => {
    const h = () => { qc.invalidateQueries({ queryKey: ['notifications'] }); };
    window.addEventListener('focus', h);
    return () => window.removeEventListener('focus', h);
  }, [qc]);

  const { data: liste = [], isLoading } = useQuery<Bildirim[]>({
    queryKey: ['notifications', 'liste'],
    queryFn: () => api.get('/notifications', { params: { limit: 100 } }).then((r) => r.data),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });

  const { data: tercih, refetch: tercihYenile } = useQuery<{ mutedTypes: string[] }>({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get('/notifications/preferences').then((r) => r.data),
  });

  const yenile = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const okunduYap = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.patch(`/notifications/${id}/read`); },
    onSuccess: yenile,
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşaretlenemedi'),
  });

  const tumunuOkundu = useMutation({
    mutationFn: () => api.patch('/notifications/read-all').then((r) => r.data as { count: number }),
    onSuccess: (d) => { toast.success(`${d.count} bildirim okundu işaretlendi`); yenile(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'İşaretlenemedi'),
  });

  const tercihDegistir = useMutation({
    mutationFn: async (kod: string) => {
      const simdiki = tercih?.mutedTypes || [];
      const yeni = simdiki.includes(kod) ? simdiki.filter((t) => t !== kod) : [...simdiki, kod];
      await api.put('/notifications/preferences', { mutedTypes: yeni });
      return yeni;
    },
    onSuccess: () => { tercihYenile(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Güncellenemedi'),
  });

  const okunmamis = useMemo(() => liste.filter((n) => !n.isRead), [liste]);
  const kritikOkunmamis = useMemo(() => okunmamis.filter(kritikMi), [okunmamis]);
  const kritikTumu = useMemo(() => liste.filter(kritikMi), [liste]);

  // Tür süzgeci: yalnız listede olan türler, Türkçe ad + adet
  const turSecenekleri = useMemo(() => {
    const sayac = new Map<string, number>();
    for (const n of liste) { const k = turKodu(n.type); sayac.set(k, (sayac.get(k) || 0) + 1); }
    return [...sayac.entries()].map(([kod, adet]) => ({ kod, ad: tur(kod).ad, adet })).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
  }, [liste]);

  const gorunen = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase('tr-TR');
    return liste.filter((n) => {
      if (sekme === 'okunmamis' && n.isRead) return false;
      if (sekme === 'kritik' && !kritikMi(n)) return false;
      if (turSuzgec && turKodu(n.type) !== turSuzgec) return false;
      if (!q) return true;
      return [n.title, n.body, tur(n.type).ad, n.metadata?.phone, n.metadata?.actionText].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR').includes(q);
    });
  }, [liste, sekme, turSuzgec, arama]);

  // Güne göre grupla, grup içinde tekrarları katla
  const gruplar = useMemo(() => {
    const kova = new Map<GunGrubu, Bildirim[]>();
    for (const n of gorunen) { const g = gunGrubu(n.createdAt); if (!kova.has(g)) kova.set(g, []); kova.get(g)!.push(n); }
    return GUN_SIRASI.filter((g) => kova.has(g)).map((g) => ({ ad: g, satirlar: satirlariKur(kova.get(g)!) }));
  }, [gorunen]);

  const satirAc = (s: Satir) => {
    const okunmamisIdler = s.uyeler.filter((n) => !n.isRead).map((n) => n.id);
    if (okunmamisIdler.length) okunduYap.mutate(okunmamisIdler);
    const href = bildirimBaglantisi(s.temsilci);
    if (href) router.push(href);
  };

  const ozet = okunmamis.length === 0
    ? `Her şey okundu · son ${liste.length} kayıt`
    : `${okunmamis.length} okunmamış${kritikOkunmamis.length ? ` · ${kritikOkunmamis.length} kritik` : ''} · son ${liste.length} kayıt`;

  return (
    <div className="max-w-none space-y-4">
      {/* Başlık şeridi */}
      <section className="overflow-hidden rounded-2xl" style={portalStyle({ background: BASLIK_ZEMIN, border: `1px solid ${KENAR}`, boxShadow: KART_GOLGE })}>
        <div className="h-px w-full" style={portalStyle({ background: `linear-gradient(90deg, ${ALTIN}99, ${ALTIN}22 45%, transparent)` })} />
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="h-px w-8" style={portalStyle({ background: ALTIN })} />
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.18em]" style={portalStyle({ color: '#c8ad73' })}>
                <Bell size={11} /> Bildirimler
              </span>
            </div>
            <h1 style={portalStyle({ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 650, color: METIN, lineHeight: 1.05 })}>Bildirimler</h1>
            <p className="mt-1.5 text-[13px]" style={portalStyle({ color: IKINCIL })}>{ozet}</p>
          </div>
          <div className="flex items-center gap-2">
            <Dugme aktif={tercihAcik} onClick={() => setTercihAcik((v) => !v)} ikon={<SlidersHorizontal size={14} />}>Tercihler</Dugme>
            {okunmamis.length > 0 && (
              <Dugme birincil onClick={() => tumunuOkundu.mutate()} disabled={tumunuOkundu.isPending}
                ikon={tumunuOkundu.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}>
                Tümünü okundu işaretle
              </Dugme>
            )}
          </div>
        </div>
        {tercihAcik && (
          <TercihPaneli susturulan={tercih?.mutedTypes || []} bekliyor={tercihDegistir.isPending} onDegistir={(kod) => tercihDegistir.mutate(kod)} />
        )}
      </section>

      {/* Liste kartı */}
      <section className="overflow-hidden rounded-2xl" style={portalStyle({ background: KART_ZEMIN, border: `1px solid ${KENAR}`, boxShadow: KART_GOLGE })}>
        {/* Süzgeç satırı */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3" style={portalStyle({ borderColor: KENAR })}>
          <div className="inline-flex items-center gap-1 rounded-full p-0.5" style={portalStyle({ background: ZEMIN, border: `1px solid ${KENAR}` })}>
            {([
              ['tumu', 'Tümü', liste.length],
              ['okunmamis', 'Okunmamış', okunmamis.length],
              ['kritik', 'Kritik', kritikTumu.length],
            ] as const).map(([deger, etiket, adet]) => {
              const secili = sekme === deger;
              const renk = deger === 'kritik' ? KIRMIZI : ALTIN;
              return (
                <button key={deger} type="button" onClick={() => setSekme(deger)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition"
                  style={portalStyle({ background: secili ? `${renk}1f` : 'transparent', color: secili ? renk : IKINCIL, border: `1px solid ${secili ? `${renk}55` : 'transparent'}` })}>
                  {etiket}
                  <span className="tabular-nums text-[11px]" style={portalStyle({ color: secili ? renk : SONUK })}>{adet}</span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={portalStyle({ color: SONUK })} />
            <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Bildirimlerde ara"
              className="h-9 w-full rounded-full border pl-9 pr-8 text-[13px] outline-none"
              style={portalStyle({ background: ZEMIN, borderColor: KENAR, color: METIN, padding: '0 32px 0 36px', borderRadius: 9999, fontSize: 13 })} />
            {arama && (
              <button type="button" onClick={() => setArama('')} aria-label="Aramayı temizle"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full" style={portalStyle({ color: SONUK })}>
                <X size={13} />
              </button>
            )}
          </div>

          <select value={turSuzgec} onChange={(e) => setTurSuzgec(e.target.value)} aria-label="Tür süzgeci"
            className="h-9 appearance-none rounded-full border pl-3 pr-8 text-[12px] font-semibold outline-none"
            style={portalStyle({
              // globals.css select'e width:100% + padding veriyor → burada dar ve satır içinde kalsın
              width: 'auto', minWidth: 150, maxWidth: 260, padding: '0 32px 0 12px', fontSize: 12, borderRadius: 9999,
              background: `${OK_SVG(turSuzgec ? 'd4b876' : '8a8a86')} no-repeat right 10px center, ${ZEMIN}`,
              borderColor: turSuzgec ? `${ALTIN}55` : KENAR, color: turSuzgec ? ALTIN : IKINCIL,
            })}>
            <option value="">Tüm türler</option>
            {turSecenekleri.map((t) => <option key={t.kod} value={t.kod}>{t.ad} ({t.adet})</option>)}
          </select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-[13px]" style={portalStyle({ color: IKINCIL })}>
            <Loader2 size={15} className="animate-spin" /> Yükleniyor…
          </div>
        ) : gruplar.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full" style={portalStyle({ background: `${ALTIN}14`, color: ALTIN })}><Bell size={18} /></span>
            <span className="text-[13px]" style={portalStyle({ color: IKINCIL })}>
              {sekme === 'okunmamis' ? 'Okunmamış bildirim yok.' : sekme === 'kritik' ? 'Kritik bildirim yok.' : arama || turSuzgec ? 'Bu süzgeçle bildirim bulunamadı.' : 'Henüz bildirim yok.'}
            </span>
          </div>
        ) : (
          gruplar.map((g) => (
            <div key={g.ad}>
              <div className="flex items-center gap-3 px-4 pb-1 pt-3">
                <span className="text-[10.5px] font-bold uppercase tracking-[.14em]" style={portalStyle({ color: SONUK })}>{g.ad}</span>
                <span className="h-px flex-1" style={portalStyle({ background: KENAR })} />
                <span className="text-[10.5px] tabular-nums" style={portalStyle({ color: SONUK })}>{g.satirlar.reduce((a, s) => a + s.uyeler.length, 0)}</span>
              </div>
              <div className="divide-y" style={portalStyle({ borderColor: KENAR })}>
                {g.satirlar.map((s) => (
                  <BildirimSatiri key={s.temsilci.id} satir={s} onAc={() => satirAc(s)}
                    onOkundu={() => okunduYap.mutate(s.uyeler.filter((n) => !n.isRead).map((n) => n.id))} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/* ---------- parçalar ---------- */

function Dugme({ children, ikon, onClick, birincil = false, aktif = false, disabled = false }: {
  children: ReactNode; ikon?: ReactNode; onClick?: () => void; birincil?: boolean; aktif?: boolean; disabled?: boolean;
}) {
  const vurgulu = birincil || aktif;
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-semibold transition hover:brightness-125 disabled:opacity-50"
      style={portalStyle({
        background: vurgulu ? `${ALTIN}1a` : ZEMIN,
        border: `1px solid ${vurgulu ? `${ALTIN}55` : KENAR_KOYU}`,
        color: vurgulu ? '#e7cf91' : IKINCIL,
      })}>
      {ikon}{children}
    </button>
  );
}

function BildirimSatiri({ satir, onAc, onOkundu }: { satir: Satir; onAc: () => void; onOkundu: () => void }) {
  const n = satir.temsilci;
  const t = tur(n.type);
  const Ikon = t.Ikon;
  const okunmamis = satir.okunmamis > 0;
  const kritik = satir.kritik;
  const [acik, setAcik] = useState(false);
  const [tekrarAcik, setTekrarAcik] = useState(false);
  const baslik = temizBaslik(n.title);
  const govde = temizGovde(n.body);
  const uzun = govde.length > 150;
  const seritRenk = kritik ? KIRMIZI : t.renk;

  return (
    <article
      role="button" tabIndex={0} onClick={onAc} onKeyDown={(e) => { if (e.key === 'Enter') onAc(); }}
      className="group relative grid cursor-pointer grid-cols-[auto,minmax(0,1fr),auto] items-start gap-3 px-4 py-3 transition-colors"
      style={portalStyle({ background: okunmamis ? `${seritRenk}0d` : 'transparent' })}
      onMouseEnter={(e) => { e.currentTarget.style.background = portalPaint(ZEMIN_HOVER, 'background'); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = portalPaint(okunmamis ? `${seritRenk}0d` : 'transparent', 'background'); }}
    >
      {okunmamis && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={portalStyle({ background: seritRenk })} />}

      <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full"
        style={portalStyle({ background: `${t.renk}${okunmamis ? '22' : '12'}`, color: okunmamis ? t.renk : `${t.renk}99` })}>
        <Ikon size={15} />
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[13.5px] leading-5" style={portalStyle({ color: okunmamis ? METIN : IKINCIL, fontWeight: okunmamis ? 600 : 500 })} title={baslik}>
            {baslik}
          </span>
          {satir.uyeler.length > 1 && (
            <button type="button" title={`${satir.uyeler.length} tekrar — ayrıntı için tıkla`}
              onClick={(e) => { e.stopPropagation(); setTekrarAcik((v) => !v); }}
              className="inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10.5px] font-bold tabular-nums"
              style={portalStyle({ background: `${t.renk}18`, border: `1px solid ${t.renk}44`, color: t.renk })}>
              ×{satir.uyeler.length} <ChevronDown size={11} style={portalStyle({ transform: tekrarAcik ? 'rotate(180deg)' : 'none' })} />
            </button>
          )}
          {kritik && okunmamis && (
            <span className="rounded-full px-2 py-[1px] text-[10px] font-bold uppercase tracking-wide" style={portalStyle({ background: `${KIRMIZI}1c`, color: KIRMIZI })}>Kritik</span>
          )}
        </div>
        {govde && (
          <p className={`mt-0.5 text-[12.5px] leading-5 ${acik ? '' : 'line-clamp-2'}`} style={portalStyle({ color: okunmamis ? 'rgba(250,250,249,.62)' : SONUK })}
            onClick={uzun ? (e) => { e.stopPropagation(); setAcik((v) => !v); } : undefined}
            title={uzun && !acik ? 'Tamamı için tıkla' : undefined}>
            {govde}
          </p>
        )}
        {tekrarAcik && (
          <ul className="mt-2 space-y-1 rounded-lg px-3 py-2 text-[11.5px]" style={portalStyle({ background: ZEMIN, border: `1px solid ${KENAR}` })} onClick={(e) => e.stopPropagation()}>
            {satir.uyeler.map((u) => (
              <li key={u.id} className="flex items-center gap-2" style={portalStyle({ color: u.isRead ? SONUK : IKINCIL })}>
                <span className="h-1.5 w-1.5 rounded-full" style={portalStyle({ background: u.isRead ? 'rgba(255,255,255,.18)' : t.renk })} />
                <span className="tabular-nums">{tamZaman(u.createdAt)}</span>
                <span className="truncate">{temizBaslik(u.title)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 pl-2">
        <span className="whitespace-nowrap text-[11.5px] tabular-nums" style={portalStyle({ color: okunmamis ? IKINCIL : SONUK })} title={tamZaman(n.createdAt)}>
          {kisaZaman(n.createdAt)}
        </span>
        <span className="text-[10.5px]" style={portalStyle({ color: `${t.renk}b0` })}>{t.ad}</span>
        {okunmamis && (
          <button type="button" title="Okundu işaretle" aria-label="Okundu işaretle"
            onClick={(e) => { e.stopPropagation(); onOkundu(); }}
            className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100"
            style={portalStyle({ background: `${t.renk}1a`, color: t.renk, border: `1px solid ${t.renk}44` })}>
            <Check size={12} />
          </button>
        )}
      </div>
    </article>
  );
}

function TercihPaneli({ susturulan, bekliyor, onDegistir }: { susturulan: string[]; bekliyor: boolean; onDegistir: (kod: string) => void }) {
  const kodlar = Object.keys(TUR);
  return (
    <div className="border-t px-5 py-4" style={portalStyle({ borderColor: KENAR })}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[.14em]" style={portalStyle({ color: '#c8ad73' })}>Hangi bildirimler gelsin?</span>
        <span className="text-[11.5px]" style={portalStyle({ color: SONUK })}>
          {susturulan.length ? `${susturulan.length} tür kapalı` : 'Hepsi açık'} · Kapattığın tür yalnız sana gelmez; kritik olanlar kapatılamaz.
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {kodlar.map((kod) => {
          const t = TUR[kod];
          const kapali = susturulan.includes(kod);
          const Ikon = t.Ikon;
          return (
            <button key={kod} type="button" disabled={bekliyor || t.kapatilamaz} onClick={() => onDegistir(kod)}
              title={t.kapatilamaz ? 'Bu tür kapatılamaz' : kapali ? 'Açmak için tıkla' : 'Kapatmak için tıkla'}
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:brightness-125 disabled:cursor-not-allowed"
              style={portalStyle({ background: ZEMIN, border: `1px solid ${kapali ? `${GRI}33` : KENAR}`, opacity: kapali ? 0.6 : 1 })}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={portalStyle({ background: `${t.renk}18`, color: kapali ? GRI : t.renk })}>
                {kapali ? <BellOff size={13} /> : <Ikon size={13} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold" style={portalStyle({ color: kapali ? SONUK : METIN, textDecoration: kapali ? 'line-through' : 'none' })}>{t.ad}</span>
                <span className="block truncate text-[11px]" style={portalStyle({ color: SONUK })}>{t.aciklama}</span>
              </span>
              <Anahtar acik={!kapali} kilitli={!!t.kapatilamaz} renk={t.renk} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Küçük açık/kapalı anahtarı (görsel; tıklama üst düğmede). */
function Anahtar({ acik, kilitli, renk }: { acik: boolean; kilitli: boolean; renk: string }) {
  const stil: CSSProperties = {
    background: acik ? `${renk}55` : 'rgba(255,255,255,.10)',
    border: `1px solid ${acik ? `${renk}88` : KENAR_KOYU}`,
    opacity: kilitli ? 0.5 : 1,
  };
  return (
    <span className="relative inline-block h-[18px] w-[32px] shrink-0 rounded-full transition" style={portalStyle(stil)}>
      <span className="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all" style={portalStyle({ left: acik ? 16 : 2, background: acik ? renk : 'rgba(255,255,255,.45)' })} />
    </span>
  );
}
