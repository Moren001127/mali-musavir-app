'use client';
import { portalStyle } from '@/lib/portal-theme';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeAlert, BookOpen, Landmark, Mail, Receipt, ScanSearch, Search, ShieldAlert, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  OTOMATIK_SORGU_ETIKETLERI,
  OTOMATIK_SORGU_TURLERI,
  otomatikSorguCoz,
  type OtomatikSorguAyari as OtomatikSorguDegeri,
  type OtomatikSorguTuru,
} from '@mali-musavir/shared';
import { api } from '@/lib/api';
import { FAINT, GREEN, MUTED, ikonRozeti } from '../_lib/tema';
import { DurumCipi, FormGrup, Salter } from './ortak/Form';

/**
 * GET /taxpayers/:id → `otomatikSorgu` (null = varsayılan: e-Tebligat ve e-Defter açık).
 * Tip, varsayılan ve çözümleme TEK KAYNAK: @mali-musavir/shared otomatik-sorgu.ts (7 şalter, 2026-09-22).
 */
export type OtomatikSorgu = OtomatikSorguDegeri;
export type OtomatikSorguAnahtar = OtomatikSorguTuru;
export { otomatikSorguCoz };

/** "Tanımlı" göstergesi: en az bir şalter açık. */
export function otomatikSorguTanimli(v: unknown): boolean {
  return Object.values(otomatikSorguCoz(v)).some(Boolean);
}

const STEEL = '#4f86c9';

/** Satır ikonu ve tek satır açıklama (ne yapar). Etiketler shared'dan gelir. */
const SATIR: Record<OtomatikSorguTuru, { ikon: LucideIcon; aciklama: string }> = {
  eTebligat: { ikon: Mail, aciklama: 'Yeni tebligatları gece kontrol eder, belgeyi arşive alır' },
  vergiBorcu: { ikon: Landmark, aciklama: 'Vadesi geçmiş / gelmemiş borç dökümünü alır' },
  gelenEArsiv: { ikon: Receipt, aciklama: 'Mükellefe kesilen e-Arşiv faturalarını listeler' },
  pos: { ikon: Search, aciklama: 'Banka ve ödeme kuruluşu POS tutarlarını (aylık) alır' },
  eHaciz: { ikon: ShieldAlert, aciklama: 'Banka ve araç e-haciz bildirilerini alır' },
  yoklama: { ikon: BadgeAlert, aciklama: 'Yoklama ve denetim tutanaklarını alır, tutanağı PDF olarak saklar' },
  eDefter: { ikon: BookOpen, aciklama: 'e-Defter mükellefinde berat yüklemelerini gece kontrol eder' },
};

export const OTOMATIK_SORGU_IKON = ScanSearch;
export const OTOMATIK_SORGU_RENK = STEEL;

/**
 * Otomatik Sorgulama Ayarı — grup bantlı, etiket-solda satır listesi (kayıt formu dili). 7 şalter, hepsi etkin.
 * Kaydet düğmesinden BAĞIMSIZ: şalter değişince anında PATCH /taxpayers/:id/otomatik-sorgu { anahtar: bool }
 * (yalnız değişen anahtar). İyimser güncelleme; hata olursa geri al + toast. Başarıda ['taxpayer', id] yenilenir.
 */
export function OtomatikSorguAyari({ taxpayerId, deger }: { taxpayerId: string; deger: unknown }) {
  const qc = useQueryClient();
  const cozulmus = otomatikSorguCoz(deger);
  const [bekleyen, setBekleyen] = useState<OtomatikSorguTuru | null>(null);

  const { mutate } = useMutation({
    mutationFn: (degisiklik: Partial<OtomatikSorgu>) =>
      api.patch(`/taxpayers/${taxpayerId}/otomatik-sorgu`, degisiklik).then((r) => r.data),
    onMutate: async (degisiklik) => {
      const anahtar = Object.keys(degisiklik)[0] as OtomatikSorguTuru;
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
      const [anahtar, deger2] = Object.entries(degisiklik)[0] as [OtomatikSorguTuru, boolean];
      toast.success(`${OTOMATIK_SORGU_ETIKETLERI[anahtar] || anahtar} gece sorgusu ${deger2 ? 'açıldı' : 'kapatıldı'}`);
    },
    onSettled: () => {
      setBekleyen(null);
      qc.invalidateQueries({ queryKey: ['taxpayer', taxpayerId] });
    },
  });

  const acikSayisi = OTOMATIK_SORGU_TURLERI.filter((t) => cozulmus[t]).length;

  return (
    <div className="space-y-3" data-otomatik-sorgu>
      <FormGrup
        baslik="Gece sorguları"
        aciklama="Kapalı olan sorgu gece çalışmaz; elle sorgu bu ayardan etkilenmez"
        sag={<DurumCipi ton={acikSayisi ? 'yesil' : 'notr'}>{acikSayisi} / {OTOMATIK_SORGU_TURLERI.length} açık</DurumCipi>}
        sutun={1}
      >
        {OTOMATIK_SORGU_TURLERI.map((t) => {
          const { ikon: Ikon, aciklama } = SATIR[t];
          const ad = OTOMATIK_SORGU_ETIKETLERI[t];
          const acik = cozulmus[t];
          const mesgul = bekleyen === t;
          return (
            <button
              key={t}
              type="button"
              role="switch"
              aria-checked={acik}
              disabled={mesgul}
              onClick={() => { if (mesgul) return; mutate({ [t]: !acik } as Partial<OtomatikSorgu>); }}
              title={`${ad} gece sorgusunu ${acik ? 'kapat' : 'aç'}`}
              className="grid min-h-9 grid-cols-[200px_minmax(0,1fr)] items-center gap-x-3 text-left"
              data-sorgu={t}
            >
              <span className="flex items-center gap-2 text-[13px] font-medium" style={portalStyle({ color: 'rgba(250,250,249,0.72)' })}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center" style={portalStyle({ ...ikonRozeti(STEEL), borderRadius: 6 })}>
                  <Ikon size={13} />
                </span>
                <span className="truncate">{ad}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <Salter checked={acik} disabled={mesgul} />
                <span className="w-[88px] shrink-0 text-[13px] font-medium" style={portalStyle({ color: acik ? GREEN : MUTED })}>{mesgul ? 'Kaydediliyor…' : acik ? 'Açık' : 'Kapalı'}</span>
                <span className="hidden truncate text-[12px] md:inline" style={portalStyle({ color: FAINT })}>{aciklama}</span>
              </span>
            </button>
          );
        })}
      </FormGrup>
      <p className="text-[11.5px]" style={portalStyle({ color: FAINT })}>
        Şalter değişince anında kaydedilir. Açık sorgular her gece mükellefin Dijital Vergi Dairesi girişiyle tek oturumda koşar.
      </p>
    </div>
  );
}
