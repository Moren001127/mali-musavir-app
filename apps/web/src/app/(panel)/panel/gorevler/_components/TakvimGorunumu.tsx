'use client';

import { useMemo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { isoGun, type Task } from '@/lib/tasks';
import { Kart, BosDurum } from '../../ekip/_components/Kart';
import type { GorevEylemleri } from './eylemler';
import { GorevTablosu } from './GorevTablosu';
import { GOLD, IKINCIL, KENAR, METIN, SONUK, TAKVIM_RENK, etkinTarih, gunDegeri, oncelikRengi, uzunTarih, type Satir } from './ortak';

export type TakvimModu = 'ay' | 'hafta';
const GUN_ADLARI = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** Pazartesi başlangıçlı hafta başı. */
function haftaBasi(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const g = (x.getDay() + 6) % 7; // Pzt=0
  x.setDate(x.getDate() - g);
  return x;
}

/** Görünen aralık (ay ızgarası ya da hafta) — sayfa `gun` parametresini buna göre büyütür. */
export function takvimAraligi(ay: Date, mod: TakvimModu, seciliGun: string): { bas: Date; son: Date; gunler: Date[] } {
  if (mod === 'hafta') {
    const bas = haftaBasi(seciliGun ? new Date(`${seciliGun}T00:00:00`) : new Date());
    const gunler = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(bas);
      d.setDate(bas.getDate() + i);
      return d;
    });
    return { bas, son: gunler[6], gunler };
  }
  const ilk = new Date(ay.getFullYear(), ay.getMonth(), 1);
  const bas = haftaBasi(ilk);
  const sonGun = new Date(ay.getFullYear(), ay.getMonth() + 1, 0);
  const satir = Math.ceil((sonGun.getDate() + ((ilk.getDay() + 6) % 7)) / 7);
  const gunler = Array.from({ length: satir * 7 }, (_, i) => {
    const d = new Date(bas);
    d.setDate(bas.getDate() + i);
    return d;
  });
  return { bas, son: gunler[gunler.length - 1], gunler };
}

/**
 * Takvim — ay ızgarası (Pzt-Paz) ya da hafta şeridi; gün hücresinde görev noktaları (öncelik rengi) + Mali Takvim son günleri (mor).
 * Gün tıklanınca o günün listesi altta (aynı tablo).
 */
export function TakvimGorunumu({
  gorevler,
  ay,
  onAy,
  mod,
  onMod,
  seciliGun,
  onSeciliGun,
  eylemler,
  secili,
  onSec,
  onGrupSec,
  acikId,
}: {
  gorevler: Task[];
  ay: Date;
  onAy: (d: Date) => void;
  mod: TakvimModu;
  onMod: (m: TakvimModu) => void;
  seciliGun: string;
  onSeciliGun: (g: string) => void;
  eylemler: GorevEylemleri;
  secili: Set<string>;
  onSec: (id: string, v: boolean) => void;
  onGrupSec: (ids: string[], v: boolean) => void;
  acikId?: string | null;
}) {
  const bugun = isoGun(new Date());
  const { gunler } = useMemo(() => takvimAraligi(ay, mod, seciliGun), [ay, mod, seciliGun]);

  const gunMap = useMemo(() => {
    const m = new Map<string, { gorevler: Task[] }>();
    const al = (k: string) => {
      let v = m.get(k);
      if (!v) {
        v = { gorevler: [] };
        m.set(k, v);
      }
      return v;
    };
    for (const t of gorevler) {
      const k = gunDegeri(etkinTarih(t));
      if (k) al(k).gorevler.push(t);
    }
    return m;
  }, [gorevler]);

  const seciliVeri = gunMap.get(seciliGun);
  const seciliSatirlar: Satir[] = [
    ...(seciliVeri?.gorevler || []).map((g) => ({ tip: 'gorev' as const, gorev: g })),
  ];

  const ileriGeri = (yon: -1 | 1) => {
    if (mod === 'hafta') {
      const d = new Date(`${seciliGun || bugun}T00:00:00`);
      d.setDate(d.getDate() + 7 * yon);
      onSeciliGun(isoGun(d));
      onAy(new Date(d.getFullYear(), d.getMonth(), 1));
    } else {
      onAy(new Date(ay.getFullYear(), ay.getMonth() + yon, 1));
    }
  };

  const baslik = mod === 'hafta' && gunler.length === 7
    ? `${gunler[0].toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })} – ${gunler[6].toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : `${AY_ADLARI[ay.getMonth()]} ${ay.getFullYear()}`;

  const dugme = 'inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-[12px] font-semibold transition hover:bg-white/10';

  return (
    <div className="flex flex-col gap-3">
      <Kart renk={TAKVIM_RENK} serit>
        {/* Başlık: ay/hafta adı · ileri/geri · Bugün · mod */}
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: `1px solid ${KENAR}` }}>
          <CalendarDays size={14} style={{ color: TAKVIM_RENK }} />
          <h3 className="text-[13.5px] font-bold" style={{ color: METIN, fontFamily: 'Fraunces, Georgia, serif' }}>
            {baslik}
          </h3>
          <div className="ml-1 inline-flex items-center gap-0.5">
            <button type="button" onClick={() => ileriGeri(-1)} className={dugme} style={{ color: IKINCIL, border: '1px solid rgba(255,255,255,0.10)' }} title={mod === 'hafta' ? 'Önceki hafta' : 'Önceki ay'}>
              <ChevronLeft size={14} />
            </button>
            <button type="button" onClick={() => ileriGeri(1)} className={dugme} style={{ color: IKINCIL, border: '1px solid rgba(255,255,255,0.10)' }} title={mod === 'hafta' ? 'Sonraki hafta' : 'Sonraki ay'}>
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                onSeciliGun(bugun);
                onAy(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
              }}
              className={dugme}
              style={{ color: GOLD, border: `1px solid ${GOLD}44` }}
              title="Bugüne dön"
            >
              Bugün
            </button>
          </div>
          <div className="ml-auto inline-flex items-center rounded-full p-[2px]" style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {(['hafta', 'ay'] as TakvimModu[]).map((m) => (
              <button key={m} type="button" onClick={() => onMod(m)} aria-pressed={mod === m} className="rounded-full px-3 py-0.5 text-[11px] font-semibold transition-[background-color,color]" style={mod === m ? { background: `${TAKVIM_RENK}22`, color: TAKVIM_RENK } : { color: IKINCIL }}>
                {m === 'hafta' ? 'Hafta' : 'Ay'}
              </button>
            ))}
          </div>
        </div>

        {/* Izgara */}
        <div className="p-2">
          <div className="grid grid-cols-7 gap-1">
            {GUN_ADLARI.map((g) => (
              <div key={g} className="px-1 py-1 text-center text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: IKINCIL }}>
                {g}
              </div>
            ))}
            {gunler.map((d) => {
              const k = isoGun(d);
              const v = gunMap.get(k);
              const buAy = mod === 'hafta' || d.getMonth() === ay.getMonth();
              const secildi = seciliGun === k;
              const bugunMu = k === bugun;
              const gecmis = k < bugun;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onSeciliGun(k)}
                  aria-pressed={secildi}
                  title={`${uzunTarih(`${k}T00:00:00`)} — ${v?.gorevler.length || 0} görev`}
                  className="flex flex-col items-stretch gap-1 rounded-lg p-1.5 text-left transition-[background-color,border-color]"
                  style={{
                    minHeight: mod === 'hafta' ? 150 : 76,
                    background: secildi ? `${TAKVIM_RENK}1f` : buAy ? 'rgba(255,255,255,0.025)' : 'transparent',
                    border: `1px solid ${secildi ? `${TAKVIM_RENK}88` : bugunMu ? `${GOLD}77` : 'rgba(255,255,255,0.06)'}`,
                    opacity: buAy ? 1 : 0.45,
                  }}
                >
                  <span className="flex items-center justify-between">
                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1 text-[11.5px] font-bold tabular-nums" style={bugunMu ? { background: GOLD, color: '#0f0d0b' } : { color: gecmis ? SONUK : METIN }}>
                      {d.getDate()}
                    </span>
                    {(v?.gorevler.length || 0) > 0 && (
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: IKINCIL }}>
                        {v!.gorevler.length}
                      </span>
                    )}
                  </span>
                  {mod === 'ay' ? (
                    <>
                      <span className="flex flex-wrap gap-[3px]">
                        {(v?.gorevler || []).slice(0, 8).map((t) => (
                          <span key={t.id} className="h-[6px] w-[6px] rounded-full" style={{ background: oncelikRengi(t.priority), opacity: t.status === 'DONE' ? 0.4 : 1 }} />
                        ))}
                      </span>
                    </>
                  ) : (
                    <>
                      {(v?.gorevler || []).slice(0, 6).map((t) => (
                        <span key={t.id} className="flex items-center gap-1 truncate text-[10.5px] leading-4" style={{ color: 'rgba(250,250,249,0.85)' }} title={t.title}>
                          <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: oncelikRengi(t.priority) }} />
                          <span className="truncate">{t.title}</span>
                        </span>
                      ))}
                      {(v?.gorevler.length || 0) > 6 && (
                        <span className="text-[10px]" style={{ color: IKINCIL }}>
                          +{v!.gorevler.length - 6} görev
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 px-1 text-[10.5px]" style={{ color: IKINCIL }}>
            <span className="inline-flex items-center gap-1"><span className="h-[6px] w-[6px] rounded-full" style={{ background: oncelikRengi('URGENT') }} /> ACİL</span>
            <span className="inline-flex items-center gap-1"><span className="h-[6px] w-[6px] rounded-full" style={{ background: oncelikRengi('HIGH') }} /> Yüksek</span>
            <span className="inline-flex items-center gap-1"><span className="h-[6px] w-[6px] rounded-full" style={{ background: oncelikRengi('MEDIUM') }} /> Orta</span>
            <span className="inline-flex items-center gap-1"><span className="h-[6px] w-[6px] rounded-full" style={{ background: oncelikRengi('LOW') }} /> Düşük</span>
          </div>
        </div>
      </Kart>

      {/* Seçili günün listesi */}
      <div>
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="text-[12.5px] font-bold" style={{ color: METIN }}>
            {seciliGun ? uzunTarih(`${seciliGun}T00:00:00`) : 'Gün seçin'}
          </span>
          {seciliGun === bugun && (
            <span className="rounded-md px-1.5 text-[10px] font-extrabold leading-4" style={{ background: GOLD, color: '#0f0d0b' }}>
              BUGÜN
            </span>
          )}
        </div>
        <GorevTablosu
          gruplar={[{ key: seciliGun || 'gun', ad: seciliGun, renk: TAKVIM_RENK, satirlar: seciliSatirlar }]}
          basliksiz
          secili={secili}
          onSec={onSec}
          onGrupSec={onGrupSec}
          eylemler={eylemler}
          acikId={acikId}
          bos={<BosDurum ikon={<CalendarDays size={18} />} metin="Bu gün için görev yok" renk={TAKVIM_RENK} />}
        />
      </div>
    </div>
  );
}

