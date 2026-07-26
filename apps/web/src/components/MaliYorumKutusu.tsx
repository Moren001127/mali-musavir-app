'use client';

import React, { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { maliYorumApi, MaliYorumKaynak } from '@/lib/mali-yorum';

/**
 * Yapay Zeka Değerlendirmesi kutusu — Mizan / Bilanço / Gelir Tablosu /
 * İşletme Hesap Özeti sayfalarında ortak kullanılır. Kayıtlı değerlendirmeyi
 * anında gösterir; yoksa "Değerlendir" düğmesi çıkar; "Yenile" ile tazelenir.
 * Kaynak veriye/mantığa DOKUNMAZ; sadece okur.
 */
export function MaliYorumKutusu({
  kaynak,
  kaynakId,
  accent = '#d4b876',
  autoGenerate = false,
}: {
  kaynak: MaliYorumKaynak;
  kaynakId?: string | null;
  accent?: string;
  /** true ise: kayıtlı değerlendirme yoksa açılışta otomatik üretilir (bir kez). */
  autoGenerate?: boolean;
}) {
  const qc = useQueryClient();
  const enabled = !!kaynakId;

  const { data: yorum, isLoading } = useQuery({
    queryKey: ['mali-yorum', kaynak, kaynakId],
    queryFn: () => maliYorumApi.get(kaynak, kaynakId as string),
    enabled,
  });

  const uretMut = useMutation({
    mutationFn: (opts: { force: boolean; derin: boolean }) =>
      maliYorumApi.uret(kaynak, kaynakId as string, opts.force, opts.derin),
    onSuccess: (data) => {
      qc.setQueryData(['mali-yorum', kaynak, kaynakId], data);
      toast.success('Değerlendirme hazır');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Değerlendirme üretilemedi'),
  });

  // Otomatik başlatma: mizan çekilince / bilanço-gelir tablosu üretilince kayıt
  // yoksa bir kez otomatik üret. Hata olursa tekrar denemez (kullanıcı elle "Yenile").
  const autoFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoGenerate || !enabled || isLoading) return;
    if (yorum || uretMut.isPending) return;
    if (autoFiredRef.current === kaynakId) return;
    autoFiredRef.current = kaynakId as string;
    uretMut.mutate({ force: false, derin: false }); // otomatik = ucuz model
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, enabled, isLoading, yorum, kaynakId]);

  if (!enabled) return null;

  const uretiliyor = uretMut.isPending;
  const derinPending = uretiliyor && (uretMut.variables as any)?.derin === true;
  const hataMesaj = uretMut.isError
    ? ((uretMut.error as any)?.response?.data?.message || 'Değerlendirme üretilemedi')
    : '';

  const zaman = (() => {
    if (!yorum?.updatedAt) return '';
    try {
      return new Date(yorum.updatedAt).toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  })();

  return (
    <div
      style={{
        border: `1px solid ${hexA(accent, 0.28)}`,
        background: `linear-gradient(180deg, ${hexA(accent, 0.06)} 0%, rgba(255,255,255,0.012) 100%)`,
        borderRadius: 16,
        padding: 20,
        marginTop: 20,
      }}
    >
      {/* Başlık */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              display: 'grid',
              placeItems: 'center',
              background: hexA(accent, 0.16),
              border: `1px solid ${hexA(accent, 0.4)}`,
              fontSize: 18,
            }}
            aria-hidden
          >
            🤖
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#f5efe3', fontSize: 15, letterSpacing: 0.2 }}>
              MOREN MALİ MÜŞAVİRLİK AI Değerlendirmesi
            </div>
            <div style={{ fontSize: 12, color: 'rgba(245,239,227,0.55)' }}>
              Bir mali müşavir gözüyle otomatik yorum
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => uretMut.mutate({ force: !!yorum, derin: false })}
            disabled={uretiliyor}
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              border: `1px solid ${hexA(accent, 0.5)}`,
              background: uretiliyor ? 'rgba(255,255,255,0.04)' : hexA(accent, 0.14),
              color: uretiliyor ? 'rgba(245,239,227,0.5)' : accent,
              fontWeight: 600,
              fontSize: 13.5,
              cursor: uretiliyor ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {uretiliyor && !derinPending ? 'İnceleniyor…' : yorum ? '↻ Yenile' : '✨ Değerlendir'}
          </button>
          <button
            onClick={() => uretMut.mutate({ force: true, derin: true })}
            disabled={uretiliyor}
            title="Güçlü model (Sonnet) ile daha derin inceleme — normalden biraz daha çok limit yer"
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid rgba(168,85,247,0.5)',
              background: uretiliyor ? 'rgba(255,255,255,0.04)' : 'rgba(168,85,247,0.14)',
              color: uretiliyor ? 'rgba(245,239,227,0.5)' : '#c084fc',
              fontWeight: 600,
              fontSize: 13.5,
              cursor: uretiliyor ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {derinPending ? 'Derin inceleniyor…' : '🔬 Derin Analiz'}
          </button>
        </div>
      </div>

      {/* Gövde */}
      <div style={{ marginTop: 16 }}>
        {isLoading ? (
          <p style={{ color: 'rgba(245,239,227,0.55)', fontSize: 13.5 }}>Yükleniyor…</p>
        ) : uretiliyor && !yorum ? (
          <p style={{ color: 'rgba(245,239,227,0.7)', fontSize: 13.5 }}>
            Bütün hesaplar mali müşavir gözüyle inceleniyor, birkaç saniye…
          </p>
        ) : yorum ? (
          <>
            <YorumMetni ozet={yorum.ozet} accent={accent} />
            {zaman && (
              <div style={{ marginTop: 14, fontSize: 11.5, color: 'rgba(245,239,227,0.4)' }}>
                {zaman} · {yorum.model}
              </div>
            )}
          </>
        ) : hataMesaj ? (
          <div
            style={{
              border: '1px solid rgba(244,63,94,0.35)',
              background: 'rgba(244,63,94,0.06)',
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>
              Değerlendirme yapılamadı
            </div>
            <div style={{ color: 'rgba(245,239,227,0.8)', fontSize: 13, lineHeight: 1.55 }}>
              {hataMesaj}
            </div>
            <div style={{ color: 'rgba(245,239,227,0.5)', fontSize: 12, marginTop: 8 }}>
              Tekrar denemek için yukarıdaki <b>Değerlendir</b> düğmesine basın.
            </div>
          </div>
        ) : (
          <p style={{ color: 'rgba(245,239,227,0.6)', fontSize: 13.5, lineHeight: 1.6 }}>
            Bu tabloyu yapay zeka mali müşavir gözüyle değerlendirsin — güçlü/zayıf
            yönleri, dikkat çeken hesapları ve önerileri sade dille özetler.
            <br />
            <b>Değerlendir</b> düğmesine basın.
          </p>
        )}
      </div>
    </div>
  );
}

/** Değerlendirme metnini başlık/madde biçimlendirmesiyle göster. */
function YorumMetni({ ozet, accent }: { ozet: string; accent: string }) {
  const lines = String(ozet || '').split('\n');
  const basliklar = /^(genel durum|dikkat çekenler|öneri|öneriler|değerlendirme|özet)\s*:?/i;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} style={{ height: 6 }} />;

        const baslikMatch = line.match(basliklar);
        if (baslikMatch) {
          const kalan = line.slice(baslikMatch[0].length).trim();
          return (
            <div key={i} style={{ marginTop: i === 0 ? 0 : 10 }}>
              <span style={{ fontWeight: 700, color: accent, fontSize: 13.5 }}>
                {baslikMatch[0].replace(/:\s*$/, '')}
              </span>
              {kalan && (
                <span style={{ color: 'rgba(245,239,227,0.85)', fontSize: 13.5, lineHeight: 1.65 }}>
                  {' '}
                  {kalan}
                </span>
              )}
            </div>
          );
        }

        const madde = /^[-•*]\s+/.test(line);
        if (madde) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
              <span style={{ color: accent, lineHeight: 1.65 }}>•</span>
              <span style={{ color: 'rgba(245,239,227,0.85)', fontSize: 13.5, lineHeight: 1.65 }}>
                {line.replace(/^[-•*]\s+/, '')}
              </span>
            </div>
          );
        }

        return (
          <p key={i} style={{ color: 'rgba(245,239,227,0.85)', fontSize: 13.5, lineHeight: 1.65 }}>
            {line}
          </p>
        );
      })}
    </div>
  );
}

/** hex + alpha → rgba() */
function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return `rgba(212,184,118,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
