'use client';
import { ownedThemeStyle } from '@/components/layout/owned-theme';
import { Bell, ChevronDown, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import SystemHealthBell from './SystemHealthBell';
import LucaAgentPanel from './LucaAgentPanel';

type TopbarTaxpayer = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  type?: string | null; // GERCEK_KISI | TUZEL_KISI
};

function taxpayerLabel(t: TopbarTaxpayer): string {
  return (t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || 'Mükellef').trim();
}

/** Hattat listesindeki gibi ad + (ŞAHIS)/(FİRMA); baş harf simgesi ve TC/VKN yok (Muzaffer Bey, 2026-09-21). */
function taxpayerKindLabel(t: TopbarTaxpayer): string {
  if (t.type === 'TUZEL_KISI') return 'FİRMA';
  if (t.type === 'GERCEK_KISI') return 'ŞAHIS';
  return t.companyName ? 'FİRMA' : 'ŞAHIS';
}

function TopbarTaxpayerPicker({ taxpayers }: { taxpayers: TopbarTaxpayer[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedId = pathname.match(/\/panel\/mukellefler\/([^/]+)/)?.[1];
  const selected = taxpayers.find((item) => item.id === selectedId);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleUpperCase('tr-TR');
    const collator = new Intl.Collator('tr', { sensitivity: 'base' });
    return taxpayers
      .filter((item) => {
        if (!term) return true;
        return `${taxpayerLabel(item)} ${item.taxNumber || ''}`.toLocaleUpperCase('tr-TR').includes(term);
      })
      .sort((a, b) => collator.compare(taxpayerLabel(a), taxpayerLabel(b)));
    // TAVAN KALDIRILDI (2026-09-23, Muzaffer Bey): eskiden .slice(0, 60) vardı → alfabetik 60. sıradan
    //   (SİLBER İNŞAAT) sonrası listede HİÇ görünmüyordu; Ş/T/U/V/Y/Z ile başlayan mükellefler yalnız
    //   arama yazılınca bulunabiliyordu. Liste zaten kaydırılabilir (max-h-[360px] overflow-y-auto),
    //   birkaç yüz satır render maliyeti önemsiz — kesmek sessiz veri kaybıydı.
  }, [search, taxpayers]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openTaxpayer = (id: string) => {
    setOpen(false);
    setSearch('');
    router.push(`/panel/mukellefler/${id}`);
  };

  return (
    <div data-moren-owned="surface" ref={wrapperRef} className="relative hidden w-[430px] max-w-[46vw] md:block" title="Mükellef kartına git">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex h-9 w-full items-center gap-2 rounded-[10px] border px-3 text-left outline-none transition"
        style={ownedThemeStyle({
          background: open
            ? 'linear-gradient(180deg, rgba(212,184,118,0.12), rgba(255,255,255,0.035))'
            : 'linear-gradient(180deg, rgba(255,255,255,0.040), rgba(255,255,255,0.018))',
          borderColor: open ? 'rgba(212,184,118,0.38)' : 'rgba(212,184,118,0.18)',
          boxShadow: open ? '0 0 0 3px rgba(212,184,118,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.035)',
          color: '#fafaf9',
        })}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]" style={ownedThemeStyle({ background: 'rgba(212,184,118,0.10)', color: '#d4b876' })}>
          <Users size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-black" style={ownedThemeStyle({ color: '#f5f5f4' })}>
            {selected ? taxpayerLabel(selected) : 'Mükellef Listesi'}
          </span>
        </span>
        <ChevronDown size={14} className="shrink-0 transition" style={ownedThemeStyle({ color: 'rgba(250,250,249,0.48)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' })} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-[640px] max-w-[70vw] overflow-hidden rounded-[12px] border"
          style={ownedThemeStyle({
            background: 'rgba(13,13,12,0.98)',
            borderColor: 'rgba(212,184,118,0.24)',
            boxShadow: '0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
          })}
        >
          <div className="border-b p-3" style={ownedThemeStyle({ borderColor: 'rgba(255,255,255,0.07)', background: 'linear-gradient(180deg, rgba(212,184,118,0.09), rgba(255,255,255,0.018))' })}>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={ownedThemeStyle({ color: 'rgba(212,184,118,0.72)' })} />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Mükellef ara..."
                className="h-9 w-full rounded-[9px] border bg-black/30 pl-9 pr-3 text-[12.5px] font-semibold outline-none transition placeholder:text-white/30"
                style={ownedThemeStyle({ borderColor: 'rgba(255,255,255,0.08)', color: '#f5f5f4' })}
              />
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSearch('');
                router.push('/panel/mukellef-listesi');
              }}
              className="flex w-full items-center gap-2 rounded-[9px] px-3 py-2.5 text-left transition hover:bg-white/[0.055]"
            >
              <span className="text-[13px] font-medium" style={ownedThemeStyle({ color: '#ecd6a4' })}>Mükellef Listesi</span>
            </button>

            {filtered.map((taxpayer) => {
              const active = taxpayer.id === selectedId;
              return (
                <button
                  key={taxpayer.id}
                  type="button"
                  onClick={() => openTaxpayer(taxpayer.id)}
                  className="flex w-full min-w-0 items-center rounded-[6px] px-3 py-2 text-left transition hover:bg-white/[0.055]"
                  style={ownedThemeStyle({ background: active ? 'rgba(79,134,201,0.14)' : 'transparent', color: '#f5f5f4' })}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-normal leading-5">
                    {taxpayerLabel(taxpayer)}
                    <span className="ml-1.5 text-[11px]" style={ownedThemeStyle({ color: 'rgba(245,245,244,0.5)' })}>({taxpayerKindLabel(taxpayer)})</span>
                  </span>
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="px-3 py-8 text-center text-[12px] font-semibold" style={ownedThemeStyle({ color: 'rgba(245,245,244,0.48)' })}>
                Eşleşen mükellef bulunamadı.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const qc = useQueryClient();
  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
    // 60sn -> 15sn (daha hizli refresh)
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const { data: taxpayers = [] } = useQuery<TopbarTaxpayer[]>({
    queryKey: ['taxpayers', 'topbar-picker'],
    queryFn: () =>
      api
        .get('/taxpayers', { params: { scope: 'directory', status: 'active' } })
        .then((r) => (Array.isArray(r.data) ? r.data : [])),
    staleTime: 60_000,
  });

  // Window focus event: kullanici sekmeye geri donunce taze veri
  useEffect(() => {
    const onFocus = () => qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    const onVisibility = () => { if (document.visibilityState === 'visible') onFocus(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [qc]);


  return (
    <header data-moren-owned="surface"
      className="h-14 flex items-center justify-between px-6 flex-shrink-0"
      style={ownedThemeStyle({
        background: '#080807',
        borderBottom: '1px solid rgba(212,184,118,0.08)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.55)',
      })}
    >
      {/* Tarih yazısı kaldırıldı; mükellef seçici sola yaslı (Muzaffer Bey, 2026-09-21) */}
      <div className="flex min-w-0 items-center">
        <TopbarTaxpayerPicker taxpayers={taxpayers} />
      </div>

      <div className="flex items-center gap-2">
        <div id="moren-topbar-actions" className="flex items-center gap-2" />
        <LucaAgentPanel />
        <SystemHealthBell />

        <Link
          href="/panel/bildirimler"
          className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:opacity-80"
          style={ownedThemeStyle({ border: '1px solid rgba(255,255,255,0.05)' })}
        >
          <Bell size={16} style={ownedThemeStyle({ color: 'rgba(250,250,249,0.7)' })} />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={ownedThemeStyle({ background: '#f43f5e' })}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
