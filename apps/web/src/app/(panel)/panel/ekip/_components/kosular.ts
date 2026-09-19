'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ajanCalistirStream,
  getAkis,
  getEkipDurum,
  getKadro,
  getMukellefler,
  getOnaylar,
  getPano,
  iptalEt,
  isOmurgaYok,
  type AkisFiltre,
  type AkisGun,
  type AracCagrisi,
} from '@/lib/ekip';

/** Koşu adımı — akışta görünen her satır. */
export interface Adim {
  tip: 'arac' | 'kuruTest' | 'onay' | 'red';
  ad: string;
  /** Araç girdisi (insan dili adım açıklaması için; ham JSON ekranda gösterilmez). */
  args?: any;
  previewId?: string;
  neden?: string;
  zaman: number;
  durum?: 'calisiyor' | 'bitti';
  /** Akış içi onay/red sonucu (CanliAkis yazar). */
  sonuc?: string;
}

/** Ajan başına tek koşu kaydı — v2'de komut yalnız Koordinatör'e gider; harita anahtarı 'koordinator'. */
export interface Kosu {
  ajanId: string;
  gorev: string;
  taxpayerId?: string;
  dryRun: boolean;
  isId?: string;
  /** Aynı iş dosyası zincirinde (vaka) devam — Cevapla / Tekrar taslağından gelir. */
  vakaId?: string;
  model?: string;
  cevap: string;
  adimlar: Adim[];
  bitti: boolean;
  hata?: string;
  durationMs?: number;
  basladi: number;
  kaynak: 'portal' | 'sabahOzeti';
  /** Sabah özeti sonucu Muzaffer Bey’e gönderildi mi (gonder:true sonrası). */
  gonderildi?: number;
}

/** 2026-09-13 (PLAN/17 Faz C): bağlantı kopunca sunucu koşuyu İPTAL ETMEZ; iş arka planda sürer, sonuç iş dosyasına yazılır. */
export const BAGLANTI_KESILDI_METNI = 'Bağlantı kesildi — koşu sunucuda arka planda sürer; sonucu aşağıdaki akıştan takip edin';
/** Muzaffer Bey "Durdur" dedi: sunucuda koşu iptal edildi (iş dosyası failed, hata "iptal edildi (Muzaffer Bey)"). */
export const DURDURULDU_METNI = 'Durduruldu';

/** Ortak sorgu seçenekleri (tek yerde; KonsolBaslik ve EkipEkrani aynı anahtarları paylaşır → tek ağ isteği). */
export const SORGU = {
  /** Ajan tanımı sabit ama `suAn`/`bekleyenOnay` CANLI → 30 sn; koşu başlangıcı/bitişi ve onay/ret sonrası invalidate. */
  kadro: {
    queryKey: ['ekip-kadro'] as const,
    queryFn: getKadro,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: (n: number, e: unknown) => !isOmurgaYok(e) && n < 2,
  },
  durum: {
    queryKey: ['ekip-durum'] as const,
    queryFn: getEkipDurum,
    refetchInterval: 20_000,
    retry: (n: number, e: unknown) => !isOmurgaYok(e) && n < 2,
  },
  /** CANLI AKIŞ — vaka listesi + sayaçlar; koşu sürerken 10 sn, yoksa 30 sn. */
  akis: (filtre: AkisFiltre, gun: AkisGun, taxpayerId: string | undefined, kosuVar: boolean) => ({
    queryKey: ['ekip-akis', gun, filtre, taxpayerId || ''] as const,
    queryFn: () => getAkis({ gun, filtre, taxpayerId: taxpayerId || undefined, limit: 100 }),
    refetchInterval: kosuVar ? 5_000 : 30_000,
    placeholderData: (prev: any) => prev, // süzgeç değişince liste titremesin
    retry: (n: number, e: unknown) => !isOmurgaYok(e) && n < 2,
  }),
  onaylarBekleyen: {
    queryKey: ['ekip-onaylar', 'PENDING'] as const,
    queryFn: () => getOnaylar('PENDING', 50),
    refetchInterval: 20_000,
    retry: false as const,
  },
  pano: {
    queryKey: ['ekip-pano'] as const,
    queryFn: getPano,
    refetchInterval: 60_000,
    retry: (n: number, e: unknown) => !isOmurgaYok(e) && n < 2,
  },
  mukellefler: {
    queryKey: ['taxpayers'] as const,
    queryFn: getMukellefler,
    staleTime: 5 * 60_000,
  },
};

/**
 * useKosular — ajan başına koşu haritası + SSE yönetimi (v2'de tek anahtar: 'koordinator').
 * - aktifKosu: herhangi bir bitmemiş koşu → tek aktif koşu kilidi (tek Max hesabı + Luca tek oturum).
 * - durdur: ÖNCE sunucuda iptal (POST /ekip/isler/:id/iptal → Agent SDK abort, iş failed), SONRA SSE'yi kapatır;
 *   ekranda "Durduruldu". İş kimliği yoksa veya iptal reddedilirse izleme sürer.
 * - Akış (ekip-akis) koşu başlarken ve biterken tazelenir → koşu bitince satır adım kaydına dönüşür.
 */
export function useKosular() {
  const qc = useQueryClient();
  const [kosular, setKosular] = useState<Map<string, Kosu>>(() => new Map());
  const abortlar = useRef<Map<string, AbortController>>(new Map());
  const [bekleyenCevap, setBekleyenCevap] = useState<{ metin: string; vakaId: string; taxpayerId?: string; dryRun: boolean } | null>(null);
  const gonderilenCevap = useRef<typeof bekleyenCevap>(null);
  /** durdur() render dışından güncel isId'yi okusun (state kapanışa takılmasın). */
  const kosularRef = useRef(kosular);
  kosularRef.current = kosular;

  const ayarla = useCallback((ajanId: string, kosu: Kosu) => {
    setKosular((prev) => {
      const m = new Map(prev);
      m.set(ajanId, kosu);
      return m;
    });
  }, []);

  const guncelle = useCallback((ajanId: string, fn: (k: Kosu) => Kosu) => {
    setKosular((prev) => {
      const k = prev.get(ajanId);
      if (!k) return prev;
      const m = new Map(prev);
      m.set(ajanId, fn(k));
      return m;
    });
  }, []);

  /** Bitmiş koşuyu haritadan kaldır (akışta kalıcı satırı zaten var ya da hiç başlamadı). */
  const kaldir = useCallback((ajanId: string) => {
    setKosular((prev) => {
      if (!prev.has(ajanId)) return prev;
      const m = new Map(prev);
      m.delete(ajanId);
      return m;
    });
  }, []);

  const tazeleBaslangic = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] }); // kadro[].suAn dolsun
  }, [qc]);

  const tazeleBitis = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ekip-akis'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
    qc.invalidateQueries({ queryKey: ['ekip-pano'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] }); // kadro[].suAn/bekleyenOnay takılı kalmasın
  }, [qc]);

  const baslat = useCallback(
    async (ajanId: string, body: { gorev: string; taxpayerId?: string; dryRun: boolean; vakaId?: string }) => {
      const gorev = body.gorev.trim();
      if (!gorev) return;
      // Aynı ajanda önceki bağlantı açık kaldıysa kapat (yeni koşu başlıyor).
      try {
        abortlar.current.get(ajanId)?.abort();
      } catch {
        /* yoksay */
      }
      const ac = new AbortController();
      abortlar.current.set(ajanId, ac);

      ayarla(ajanId, {
        ajanId,
        gorev,
        taxpayerId: body.taxpayerId || undefined,
        dryRun: body.dryRun,
        vakaId: body.vakaId || undefined,
        cevap: '',
        adimlar: [],
        bitti: false,
        basladi: Date.now(),
        kaynak: 'portal',
      });

      // Çalışan adımı bitir (yeni olay geldi → önceki araç döndü)
      const calisaniBitir = (adimlar: Adim[]) => adimlar.map((a) => (a.durum === 'calisiyor' ? { ...a, durum: 'bitti' as const } : a));
      let acc = '';

      try {
        await ajanCalistirStream(
          ajanId,
          { gorev, taxpayerId: body.taxpayerId || undefined, dryRun: body.dryRun, vakaId: body.vakaId || undefined },
          (e) => {
            const zaman = Date.now();
            if (e.type === 'text') {
              acc += e.delta;
              guncelle(ajanId, (k) => ({ ...k, cevap: acc, adimlar: calisaniBitir(k.adimlar) }));
            } else if (e.type === 'tool') {
              if (e.name) {
                guncelle(ajanId, (k) => ({
                  ...k,
                  adimlar: [...calisaniBitir(k.adimlar), { tip: 'arac', ad: e.name, args: e.args, zaman, durum: 'calisiyor' }],
                }));
              }
            } else if (e.type === 'kuruTest') {
              guncelle(ajanId, (k) => ({ ...k, adimlar: [...calisaniBitir(k.adimlar), { tip: 'kuruTest', ad: e.name, args: e.args, zaman }] }));
            } else if (e.type === 'onay') {
              guncelle(ajanId, (k) => ({
                ...k,
                adimlar: [...calisaniBitir(k.adimlar), { tip: 'onay', ad: e.name, previewId: e.previewId, zaman }],
              }));
            } else if (e.type === 'red') {
              guncelle(ajanId, (k) => ({
                ...k,
                adimlar: [...calisaniBitir(k.adimlar), { tip: 'red', ad: e.name, neden: e.neden || e.mesaj, zaman }],
              }));
            } else if (e.type === 'baslangic') {
              // Kök iş = vaka; vakaId gelmediyse (yeni zincir) isId vaka kimliğidir.
              guncelle(ajanId, (k) => ({ ...k, isId: e.isId || k.isId, vakaId: k.vakaId || e.isId || k.vakaId, model: e.model || k.model }));
              tazeleBaslangic();
            } else if (e.type === 'done') {
              guncelle(ajanId, (k) => ({
                ...k,
                model: e.model || k.model,
                durationMs: e.durationMs,
                isId: e.isId || k.isId,
                adimlar: k.adimlar.length
                  ? calisaniBitir(k.adimlar)
                  : (e.toolUses || []).map((t: AracCagrisi) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman, durum: 'bitti' as const })),
              }));
            } else if (e.type === 'error') {
              // Muzaffer Bey durdurduysa sunucunun "iptal edildi (Muzaffer Bey)" metni "Durduruldu"nun üstüne yazılmaz.
              guncelle(ajanId, (k) => ({ ...k, hata: k.hata === DURDURULDU_METNI ? k.hata : e.error || 'Yanıt alınamadı', isId: e.isId || k.isId }));
            }
          },
          ac.signal,
        );
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          guncelle(ajanId, (k) => ({ ...k, hata: k.hata || BAGLANTI_KESILDI_METNI }));
        } else {
          guncelle(ajanId, (k) => ({ ...k, hata: err?.message || String(err) }));
        }
      } finally {
        if (abortlar.current.get(ajanId) === ac) abortlar.current.delete(ajanId);
        guncelle(ajanId, (k) => ({
          ...k,
          bitti: true,
          durationMs: k.durationMs ?? Date.now() - k.basladi,
          adimlar: calisaniBitir(k.adimlar),
          cevap: k.cevap || (k.hata ? '' : '(boş yanıt)'),
        }));
        tazeleBitis();
      }
    },
    [ayarla, guncelle, tazeleBaslangic, tazeleBitis],
  );

  /** DURDUR: önce sunucuda iptal (iş dosyası failed), sonra SSE bağlantısını kapat. */
  const durdur = useCallback(
    async (ajanId: string) => {
      const ac = abortlar.current.get(ajanId);
      if (!ac) return;
      const isId = kosularRef.current.get(ajanId)?.isId;
      if (!isId) {
        toast.info('İş başlatılıyor. Durdurmak için birkaç saniye sonra tekrar deneyin.');
        return;
      }
      const r = await iptalEt(isId).catch(() => ({ ok: false as const, isId }));
      if (!r.ok) {
        toast.error('İş durdurulamadı. İlerleme izlenmeye devam ediyor.');
        return;
      }
      guncelle(ajanId, (k) => ({ ...k, hata: DURDURULDU_METNI }));
      try {
        ac.abort();
      } catch {
        /* yoksay */
      }
    },
    [guncelle],
  );

  const aktifKosu = useMemo(() => Array.from(kosular.values()).find((k) => !k.bitti) || null, [kosular]);
  // Cevap seçili panelden bağımsızdır; listeye veya başka sekmeye geçince kaybolmaz.
  useEffect(() => {
    if (aktifKosu || !bekleyenCevap) return;
    let kapandi = false;
    let timer: ReturnType<typeof setTimeout>;
    const dene = async () => {
      try {
        const akis = await getAkis({ gun: 30, filtre: 'tumu', limit: 100, taxpayerId: bekleyenCevap.taxpayerId });
        if (kapandi || gonderilenCevap.current === bekleyenCevap) return;
        const hedef = akis.vakalar.find((v) => v.vakaId === bekleyenCevap.vakaId);
        if (!hedef || hedef.adimlar.some((a) => a.tip === 'is' && (a.durum === 'running' || a.durum === 'pending')) || Array.from(kosularRef.current.values()).some((k) => !k.bitti)) {
          timer = setTimeout(dene, 5000);
          return;
        }
        gonderilenCevap.current = bekleyenCevap;
        setBekleyenCevap(null);
        void baslat('koordinator', { gorev: `Cevap: ${bekleyenCevap.metin}`, vakaId: bekleyenCevap.vakaId, taxpayerId: bekleyenCevap.taxpayerId, dryRun: bekleyenCevap.dryRun });
      } catch {
        if (!kapandi) timer = setTimeout(dene, 5000);
      }
    };
    void dene();
    return () => { kapandi = true; clearTimeout(timer); };
  }, [aktifKosu, bekleyenCevap, baslat]);

  return { kosular, baslat, durdur, ayarla, guncelle, kaldir, aktifKosu, bekleyenCevap, setBekleyenCevap };
}

export type KosularApi = ReturnType<typeof useKosular>;
