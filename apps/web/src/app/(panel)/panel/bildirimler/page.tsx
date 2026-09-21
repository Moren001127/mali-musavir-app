'use client';
import './bildirimler-white.css';

// Bildirimler — 2026-09-21 beyaz tema yeniden tasarımı (bilgi/BEYAZ-TEMA-TASARIM-DILI.md).
//   Sayfa başlığı (simge kutusu + başlık + özet, sağda Tercihler / Tümünü okundu) · tek liste kartı:
//   kapsül süzgeç grubu (Tümü / Okunmamış / Kritik) + arama + tür seçici · güne göre gruplu satırlar.
//   Satır: tür tonunda simge kutusu · başlık (okunmamışsa nokta + koyu) · açıklama · sağda saat + tür çipi.
//   Kritik satırda sol 3px kırmızı çizgi. Aynı bildirimin tekrarları "×N" ile katlanır. Tıkla → ilgili ekran + okundu.
//   Sayfa satır içi renk kullanmaz; renkler bildirimler-white.css'te tema değişkeni (A koyu / D beyaz).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Bell, BellOff, Check, CheckCheck, ChevronDown, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  GUN_SIRASI, TUR,
  bildirimBaglantisi, gunGrubu, kisaZaman, kritikMi, satirlariKur, tamZaman, temizBaslik, temizGovde, tur, turKodu,
  type Bildirim, type GunGrubu, type Satir,
} from './_components/katalog';

type Sekme = 'tumu' | 'okunmamis' | 'kritik';

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
    <div className="bd-root max-w-none space-y-4">
      {/* Sayfa başlığı */}
      <header className="bd-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bd-head__icon"><Bell size={17} /></span>
          <div className="min-w-0">
            <h1 className="bd-head__title">Bildirimler</h1>
            <p className="bd-head__sub">{ozet}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dugme aktif={tercihAcik} onClick={() => setTercihAcik((v) => !v)} ikon={<SlidersHorizontal size={14} />} ariaExpanded={tercihAcik}>Tercihler</Dugme>
          {okunmamis.length > 0 && (
            <Dugme birincil onClick={() => tumunuOkundu.mutate()} disabled={tumunuOkundu.isPending}
              ikon={tumunuOkundu.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}>
              Tümünü okundu işaretle
            </Dugme>
          )}
        </div>
      </header>

      {tercihAcik && (
        <section className="bd-card" aria-label="Bildirim tercihleri">
          <TercihPaneli susturulan={tercih?.mutedTypes || []} bekliyor={tercihDegistir.isPending} onDegistir={(kod) => tercihDegistir.mutate(kod)} />
        </section>
      )}

      {/* Liste kartı */}
      <section className="bd-card">
        {/* Süzgeç satırı */}
        <div className="bd-toolbar">
          <div className="bd-tabs" aria-label="Bildirim süzgeci">
            {([
              ['tumu', 'Tümü', liste.length],
              ['okunmamis', 'Okunmamış', okunmamis.length],
              ['kritik', 'Kritik', kritikTumu.length],
            ] as const).map(([deger, etiket, adet]) => (
              <button key={deger} type="button" aria-pressed={sekme === deger} data-tab={deger} onClick={() => setSekme(deger)} className="bd-tab">
                {etiket}
                <span className="bd-tab__count" data-nonzero={adet > 0 ? 'true' : 'false'}>{adet}</span>
              </button>
            ))}
          </div>

          <div className="bd-search">
            <Search size={14} />
            <input aria-label="Bildirimlerde ara" value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Bildirimlerde ara" className="bd-input" />
            {arama && (
              <button type="button" onClick={() => setArama('')} aria-label="Aramayı temizle" className="bd-search__clear">
                <X size={13} />
              </button>
            )}
          </div>

          <select value={turSuzgec} onChange={(e) => setTurSuzgec(e.target.value)} aria-label="Tür süzgeci" className="bd-select" data-set={turSuzgec ? 'true' : 'false'}>
            <option value="">Tüm türler</option>
            {turSecenekleri.map((t) => <option key={t.kod} value={t.kod}>{t.ad} ({t.adet})</option>)}
          </select>
        </div>

        {isLoading ? (
          <div className="bd-loading">
            <Loader2 size={15} className="animate-spin" /> Yükleniyor…
          </div>
        ) : gruplar.length === 0 ? (
          <div className="bd-empty">
            <span className="bd-empty__icon"><Bell size={18} /></span>
            <p className="bd-empty__text">
              {sekme === 'okunmamis' ? 'Okunmamış bildirim yok.' : sekme === 'kritik' ? 'Kritik bildirim yok.' : arama || turSuzgec ? 'Bu süzgeçle bildirim bulunamadı.' : 'Henüz bildirim yok.'}
            </p>
          </div>
        ) : (
          gruplar.map((g) => (
            <div key={g.ad} className="bd-group">
              <div className="bd-group__head">
                <span className="bd-group__title">{g.ad}</span>
                <span className="bd-group__count">{g.satirlar.reduce((a, s) => a + s.uyeler.length, 0)}</span>
              </div>
              {g.satirlar.map((s) => (
                <BildirimSatiri key={s.temsilci.id} satir={s} onAc={() => satirAc(s)}
                  onOkundu={() => okunduYap.mutate(s.uyeler.filter((n) => !n.isRead).map((n) => n.id))} />
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

/* ---------- parçalar ---------- */

function Dugme({ children, ikon, onClick, birincil = false, aktif = false, disabled = false, ariaExpanded }: {
  children: ReactNode; ikon?: ReactNode; onClick?: () => void; birincil?: boolean; aktif?: boolean; disabled?: boolean; ariaExpanded?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-expanded={ariaExpanded}
      className={`bd-btn ${birincil ? 'bd-btn--primary' : ''}`} data-active={aktif ? 'true' : 'false'}>
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

  return (
    <article
      role="button" tabIndex={0} onClick={onAc} onKeyDown={(e) => { if (e.key === 'Enter') onAc(); }}
      className="bd-row" data-ton={t.ton} data-unread={okunmamis ? 'true' : 'false'} data-critical={kritik ? 'true' : 'false'}
      aria-label={`${baslik}${okunmamis ? ' (okunmamış)' : ''}`}
    >
      <span className="bd-row__icon"><Ikon size={16} /></span>

      <div className="min-w-0">
        <div className="bd-row__title-line">
          {okunmamis && <span className="bd-dot" aria-hidden />}
          <span className="bd-row__title" title={baslik}>{baslik}</span>
          {satir.uyeler.length > 1 && (
            <button type="button" title={`${satir.uyeler.length} tekrar — ayrıntı için tıkla`} aria-expanded={tekrarAcik}
              onClick={(e) => { e.stopPropagation(); setTekrarAcik((v) => !v); }} className="bd-fold">
              ×{satir.uyeler.length} <ChevronDown size={11} />
            </button>
          )}
        </div>
        {govde && (
          <p className={`bd-row__body ${acik ? '' : 'line-clamp-2'}`}
            onClick={uzun ? (e) => { e.stopPropagation(); setAcik((v) => !v); } : undefined}
            title={uzun && !acik ? 'Tamamı için tıkla' : undefined}>
            {govde}
          </p>
        )}
        {tekrarAcik && (
          <ul className="bd-fold-list" onClick={(e) => e.stopPropagation()}>
            {satir.uyeler.map((u) => (
              <li key={u.id} data-unread={u.isRead ? 'false' : 'true'}>
                <span aria-hidden />
                <span className="tabular-nums">{tamZaman(u.createdAt)}</span>
                <span>{temizBaslik(u.title)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bd-row__side">
        <div className="bd-row__side-top">
          {okunmamis && (
            <button type="button" title="Okundu işaretle" aria-label="Okundu işaretle"
              onClick={(e) => { e.stopPropagation(); onOkundu(); }} className="bd-mini">
              <Check size={12} />
            </button>
          )}
          <span className="bd-row__time" title={tamZaman(n.createdAt)}>{kisaZaman(n.createdAt)}</span>
        </div>
        <span className="bd-chip">{t.ad}</span>
      </div>
    </article>
  );
}

function TercihPaneli({ susturulan, bekliyor, onDegistir }: { susturulan: string[]; bekliyor: boolean; onDegistir: (kod: string) => void }) {
  const kodlar = Object.keys(TUR);
  return (
    <div>
      <div className="bd-prefs__head">
        <h2 className="bd-prefs__title">Hangi bildirimler gelsin?</h2>
        <span className="bd-prefs__note">
          {susturulan.length ? `${susturulan.length} tür kapalı` : 'Hepsi açık'} · Kapattığın tür yalnız sana gelmez; kritik olanlar kapatılamaz.
        </span>
      </div>
      <div className="bd-prefs__grid">
        {kodlar.map((kod) => {
          const t = TUR[kod];
          const kapali = susturulan.includes(kod);
          const Ikon = t.Ikon;
          return (
            <button key={kod} type="button" disabled={bekliyor || t.kapatilamaz} onClick={() => onDegistir(kod)}
              title={t.kapatilamaz ? 'Bu tür kapatılamaz' : kapali ? 'Açmak için tıkla' : 'Kapatmak için tıkla'}
              className="bd-pref" data-ton={t.ton} data-off={kapali ? 'true' : 'false'} aria-pressed={!kapali}>
              <span className="bd-pref__icon">{kapali ? <BellOff size={14} /> : <Ikon size={14} />}</span>
              <span className="min-w-0 flex-1">
                <span className="bd-pref__name">{t.ad}</span>
                <span className="bd-pref__desc">{t.aciklama}</span>
              </span>
              <span className="bd-switch" data-on={kapali ? 'false' : 'true'} data-locked={t.kapatilamaz ? 'true' : 'false'} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}
