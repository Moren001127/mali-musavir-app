'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ajanCalistirStream,
  getEkipDurum,
  getIsler,
  getKadro,
  getMukellefler,
  getOnaylar,
  getPano,
  iptalEt,
  isOmurgaYok,
  type AracCagrisi,
} from '@/lib/ekip';

/** Koşu adımı — akışta görünen her satır. */
export interface Adim {
  tip: 'arac' | 'kuruTest' | 'onay' | 'red';
  ad: string;
  previewId?: string;
  neden?: string;
  zaman: number;
  durum?: 'calisiyor' | 'bitti';
  /** Akış içi onay/red sonucu (CanliAkis yazar). */
  sonuc?: string;
}

/** Ajan başına tek koşu kaydı — ajan değişince KESİLMEZ (§2). */
export interface Kosu {
  ajanId: string;
  gorev: string;
  taxpayerId?: string;
  dryRun: boolean;
  isId?: string;
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
export const BAGLANTI_KESILDI_METNI = "Bağlantı kesildi — koşu sunucuda arka planda sürer; sonucu İş Dosyaları'ndan takip edin";
/** Muzaffer Bey "Durdur" dedi: sunucuda koşu iptal edildi (iş dosyası failed, hata "iptal edildi (Muzaffer Bey)"). */
export const DURDURULDU_METNI = 'Durduruldu';

/** Ortak sorgu seçenekleri (tek yerde; KonsolBaslik ve EkipEkrani aynı anahtarları paylaşır → tek ağ isteği). */
export const SORGU = {
  /**
   * Ajan tanımı sabit ama backend #3 ile `sonKosu`/`bekleyenOnay` alanları CANLI → 30 sn'de bir tazelenir;
   * ayrıca koşu başlangıcı/bitişi ve onay/ret sonrası invalidate edilir (isler ile çelişmesin).
   */
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
  /** TEK sorgu: limit=200; koşu sürerken 10 sn, yoksa 30 sn. */
  isler: (kosuVar: boolean) => ({
    queryKey: ['ekip-isler', 200] as const,
    queryFn: () => getIsler({ limit: 200 }),
    refetchInterval: kosuVar ? 10_000 : 30_000,
    retry: (n: number, e: unknown) => !isOmurgaYok(e) && n < 2,
  }),
  onaylarBekleyen: {
    queryKey: ['ekip-onaylar', 'PENDING'] as const,
    queryFn: () => getOnaylar('PENDING', 50),
    refetchInterval: 20_000,
    retry: false as const,
  },
  onaylarTumu: {
    queryKey: ['ekip-onaylar', 'tumu'] as const,
    queryFn: () => getOnaylar('tumu', 50),
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
 * useKosular — ajan başına koşu haritası + SSE yönetimi.
 * - AbortController ajan başına Map'te; ajan değişince HİÇBİR ŞEY abort edilmez.
 * - aktifKosu: herhangi bir bitmemiş koşu → tek aktif koşu kilidi (tek Max hesabı + Luca tek oturum).
 * - durdur: ÖNCE sunucuda iptal (POST /ekip/isler/:id/iptal → Agent SDK abort, iş failed), SONRA SSE'yi kapatır;
 *   ekranda "Durduruldu". isId henüz gelmediyse yalnız SSE kapanır → sunucu koşuyu ARTIK durdurmaz, arka planda sürer
 *   (iş dosyasından takip edilir).
 */
export function useKosular() {
  const qc = useQueryClient();
  const [kosular, setKosular] = useState<Map<string, Kosu>>(() => new Map());
  const abortlar = useRef<Map<string, AbortController>>(new Map());
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

  const tazeleBaslangic = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ekip-isler'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] }); // kadro[].sonKosu 'running' olsun
  }, [qc]);

  const tazeleBitis = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ekip-isler'] });
    qc.invalidateQueries({ queryKey: ['ekip-durum'] });
    qc.invalidateQueries({ queryKey: ['ekip-onaylar'] });
    qc.invalidateQueries({ queryKey: ['ekip-pano'] });
    qc.invalidateQueries({ queryKey: ['ekip-kadro'] }); // kadro[].sonKosu/bekleyenOnay takılı kalmasın
  }, [qc]);

  const baslat = useCallback(
    async (ajanId: string, body: { gorev: string; taxpayerId?: string; dryRun: boolean }) => {
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
          { gorev, taxpayerId: body.taxpayerId || undefined, dryRun: body.dryRun },
          (e) => {
            const zaman = Date.now();
            if (e.type === 'text') {
              acc += e.delta;
              guncelle(ajanId, (k) => ({ ...k, cevap: acc, adimlar: calisaniBitir(k.adimlar) }));
            } else if (e.type === 'tool') {
              if (e.name) {
                guncelle(ajanId, (k) => ({
                  ...k,
                  adimlar: [...calisaniBitir(k.adimlar), { tip: 'arac', ad: e.name, zaman, durum: 'calisiyor' }],
                }));
              }
            } else if (e.type === 'kuruTest') {
              guncelle(ajanId, (k) => ({ ...k, adimlar: [...calisaniBitir(k.adimlar), { tip: 'kuruTest', ad: e.name, zaman }] }));
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
              guncelle(ajanId, (k) => ({ ...k, isId: e.isId || k.isId, model: e.model || k.model }));
              tazeleBaslangic();
            } else if (e.type === 'done') {
              guncelle(ajanId, (k) => ({
                ...k,
                model: e.model || k.model,
                durationMs: e.durationMs,
                isId: e.isId || k.isId,
                adimlar: k.adimlar.length
                  ? calisaniBitir(k.adimlar)
                  : (e.toolUses || []).map((t: AracCagrisi) => ({ tip: 'arac' as const, ad: t.name, zaman, durum: 'bitti' as const })),
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
      guncelle(ajanId, (k) => ({ ...k, hata: DURDURULDU_METNI }));
      if (isId) {
        const r = await iptalEt(isId).catch(() => ({ ok: false as const, isId }));
        if (!r.ok) console.warn('[ekip] sunucu iptali başarısız', isId, (r as any).error);
      }
      try {
        ac.abort();
      } catch {
        /* yoksay */
      }
    },
    [guncelle],
  );

  const aktifKosu = useMemo(() => Array.from(kosular.values()).find((k) => !k.bitti) || null, [kosular]);

  return { kosular, baslat, durdur, ayarla, guncelle, aktifKosu };
}

export type KosularApi = ReturnType<typeof useKosular>;
