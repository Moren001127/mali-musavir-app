'use client';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeAlert, Landmark, Mail, Receipt, ScanSearch, Search, ShieldAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { FAINT, LINE, MUTED, R_ALAN, TEXT, ikonRozeti } from '../_lib/tema';
import { Salter } from './ortak/ToggleRow';

/** GET /taxpayers/:id → `otomatikSorgu` (null = varsayılan: yalnız e-Tebligat açık). */
export type OtomatikSorgu = {
  vergiBorcu: boolean;
  eTebligat: boolean;
  gelenEArsiv: boolean;
  pos: boolean;
  eHaciz: boolean;
  yoklama: boolean;
};
export type OtomatikSorguAnahtar = keyof OtomatikSorgu;

export const OTOMATIK_SORGU_VARSAYILAN: OtomatikSorgu = {
  vergiBorcu: false,
  eTebligat: true,
  gelenEArsiv: false,
  pos: false,
  eHaciz: false,
  yoklama: false,
};

/** null/eksik alanları varsayılana tamamlar. */
export function otomatikSorguCoz(v: unknown): OtomatikSorgu {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<OtomatikSorguAnahtar, unknown>>;
  const al = (k: OtomatikSorguAnahtar) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : OTOMATIK_SORGU_VARSAYILAN[k]);
  return { vergiBorcu: al('vergiBorcu'), eTebligat: al('eTebligat'), gelenEArsiv: al('gelenEArsiv'), pos: al('pos'), eHaciz: al('eHaciz'), yoklama: al('yoklama') };
}

/** "Tanımlı" göstergesi: en az bir şalter açık. */
export function otomatikSorguTanimli(v: unknown): boolean {
  return Object.values(otomatikSorguCoz(v)).some(Boolean);
}

const STEEL = '#4f86c9';
const KILIT_IPUCU = 'Dijital Vergi Dairesi sorgu yolu bağlanınca açılacak.';

/** Şimdilik YALNIZ e-Tebligat etkin; diğer beşi kilitli ("Yakında"). */
const SORGULAR: Array<{ key: OtomatikSorguAnahtar; ad: string; ikon: LucideIcon; etkin: boolean }> = [
  { key: 'vergiBorcu', ad: 'Vergi Borcu', ikon: Landmark, etkin: false },
  { key: 'eTebligat', ad: 'E-Tebligat', ikon: Mail, etkin: true },
  { key: 'gelenEArsiv', ad: 'Gelen E-Arşiv', ikon: Receipt, etkin: false },
  { key: 'pos', ad: 'POS', ikon: Search, etkin: false },
  { key: 'eHaciz', ad: 'E-Haciz', ikon: ShieldAlert, etkin: false },
  { key: 'yoklama', ad: 'Yoklama ve Denetim', ikon: BadgeAlert, etkin: false },
];

export const OTOMATIK_SORGU_IKON = ScanSearch;
export const OTOMATIK_SORGU_RENK = STEEL;

/**
 * Otomatik Sorgulama Ayarı — 3 sütunlu şalter ızgarası.
 * Kaydet düğmesinden BAĞIMSIZ: şalter değişince anında PATCH /taxpayers/:id/otomatik-sorgu { anahtar: bool }
 * (yalnız değişen anahtar). İyimser güncelleme; hata olursa geri al + toast. Başarıda ['taxpayer', id] yenilenir.
 */
export function OtomatikSorguAyari({ taxpayerId, deger }: { taxpayerId: string; deger: unknown }) {
  const qc = useQueryClient();
  const cozulmus = otomatikSorguCoz(deger);
  const [bekleyen, setBekleyen] = useState<OtomatikSorguAnahtar | null>(null);

  const { mutate } = useMutation({
    mutationFn: (degisiklik: Partial<OtomatikSorgu>) =>
      api.patch(`/taxpayers/${taxpayerId}/otomatik-sorgu`, degisiklik).then((r) => r.data),
    onMutate: async (degisiklik) => {
      const anahtar = Object.keys(degisiklik)[0] as OtomatikSorguAnahtar;
      setBekleyen(anahtar);
      await qc.cancelQueries({ queryKey: ['taxpayer', taxpayerId] });
      const onceki = qc.getQueryData<any>(['taxpayer', taxpayerId]);
      // İyimser: önbellekteki mükellefin yalnız otomatikSorgu alanı güncellenir
      qc.setQueryData<any>(['taxpayer', taxpayerId], (eski: any) =>
        eski ? { ...eski, otomatikSorgu: { ...otomatikSorguCoz(eski.otomatikSorgu), ...degisiklik } } : eski,
      );
      return { onceki };
    },
    onError: (err: any, _degisiklik, ctx) => {
      if (ctx?.onceki !== undefined) qc.setQueryData(['taxpayer', taxpayerId], ctx.onceki);
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join('\n') : msg || 'Otomatik sorgu ayarı kaydedilemedi');
    },
    onSuccess: (guncel: any, degisiklik) => {
      // Yanıt kısmi alan seti döndürür → önbelleğe yalnız otomatikSorgu işlenir, sonra sorgu yenilenir
      if (guncel && typeof guncel === 'object' && 'otomatikSorgu' in guncel) {
        qc.setQueryData<any>(['taxpayer', taxpayerId], (eski: any) => (eski ? { ...eski, otomatikSorgu: guncel.otomatikSorgu } : eski));
      }
      const [anahtar, deger2] = Object.entries(degisiklik)[0] as [OtomatikSorguAnahtar, boolean];
      const ad = SORGULAR.find((s) => s.key === anahtar)?.ad || anahtar;
      toast.success(`${ad} gece sorgusu ${deger2 ? 'açıldı' : 'kapatıldı'}`);
    },
    onSettled: () => {
      setBekleyen(null);
      qc.invalidateQueries({ queryKey: ['taxpayer', taxpayerId] });
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-[13px]" style={{ color: MUTED }}>
        Bu mükellef için gece sorgularını tek tek açıp kapatabilirsiniz. Kapalı olan sorgu gece çalışmaz.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SORGULAR.map((s) => {
          const Ikon = s.ikon;
          const acik = cozulmus[s.key];
          const kilitli = !s.etkin;
          const mesgul = bekleyen === s.key;
          return (
            <button
              key={s.key}
              type="button"
              role="switch"
              aria-checked={acik}
              aria-disabled={kilitli}
              disabled={mesgul}
              onClick={() => { if (kilitli || mesgul) return; mutate({ [s.key]: !acik } as Partial<OtomatikSorgu>); }}
              title={kilitli ? KILIT_IPUCU : `${s.ad} gece sorgusunu ${acik ? 'kapat' : 'aç'}`}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${kilitli ? 'cursor-not-allowed' : 'hover:bg-white/[0.03]'}`}
              style={{
                border: `1px solid ${acik && !kilitli ? 'rgba(95,207,142,0.32)' : LINE}`,
                background: acik && !kilitli ? 'rgba(95,207,142,0.06)' : 'rgba(0,0,0,0.18)',
                borderRadius: R_ALAN,
                opacity: kilitli ? 0.6 : 1,
              }}
            >
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center" style={ikonRozeti(kilitli ? 'rgba(250,250,249,0.45)' : STEEL)}>
                <Ikon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium" style={{ color: kilitli ? MUTED : TEXT }}>{s.ad}</span>
                {kilitli && (
                  <span className="mt-0.5 inline-flex items-center rounded-md px-1.5 text-[11.5px] font-medium leading-4" style={{ border: `1px solid ${LINE}`, color: FAINT }}>
                    Yakında
                  </span>
                )}
              </span>
              <Salter checked={acik} disabled={kilitli || mesgul} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
