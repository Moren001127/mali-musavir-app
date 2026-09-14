'use client';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeAlert, Landmark, Mail, Receipt, ScanSearch, Search, ShieldAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { FAINT, GREEN, MUTED, ikonRozeti } from '../_lib/tema';
import { DurumCipi, FormGrup, Salter } from './ortak/Form';

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
 * Otomatik Sorgulama Ayarı — grup bantlı, etiket-solda satır listesi (kayıt formu dili).
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

  const acikSayisi = SORGULAR.filter((s) => s.etkin && cozulmus[s.key]).length;
  const etkinSayisi = SORGULAR.filter((s) => s.etkin).length;

  return (
    <div className="space-y-3">
      <FormGrup
        baslik="Gece sorguları"
        aciklama="Kapalı olan sorgu gece çalışmaz; elle sorgu bu ayardan etkilenmez"
        sag={<DurumCipi ton={acikSayisi ? 'yesil' : 'notr'}>{acikSayisi} / {etkinSayisi} açık</DurumCipi>}
      >
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
              className={`grid min-h-9 grid-cols-[190px_minmax(0,1fr)] items-center gap-x-3 text-left ${kilitli ? 'cursor-not-allowed' : ''}`}
            >
              <span className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: kilitli ? FAINT : 'rgba(250,250,249,0.72)' }}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center" style={{ ...ikonRozeti(kilitli ? 'rgba(250,250,249,0.35)' : STEEL), borderRadius: 6 }}>
                  <Ikon size={13} />
                </span>
                <span className="truncate">{s.ad}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <Salter checked={acik && !kilitli} disabled={kilitli || mesgul} />
                {kilitli ? (
                  <span className="text-[13px] font-medium" style={{ color: FAINT }}>Yakında</span>
                ) : (
                  <span className="text-[13px] font-medium" style={{ color: acik ? GREEN : MUTED }}>{mesgul ? 'Kaydediliyor…' : acik ? 'Açık' : 'Kapalı'}</span>
                )}
              </span>
            </button>
          );
        })}
      </FormGrup>
      <p className="text-[11.5px]" style={{ color: FAINT }}>
        Şalter değişince anında kaydedilir; üstteki Kaydet düğmesine gerek yoktur. "Yakında" olanlar: {KILIT_IPUCU}
      </p>
    </div>
  );
}
