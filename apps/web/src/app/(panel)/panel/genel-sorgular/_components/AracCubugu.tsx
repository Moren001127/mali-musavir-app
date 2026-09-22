'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GENEL_SORGU_DVD_ANAHTARI, type DvdSorguTuru } from '@mali-musavir/shared';
import TaxpayerSelect, { type TaxpayerLite } from '@/components/ui/TaxpayerSelect';
import { DVD_SORGULARI, SORGU_TURU_ADI, genelSorgularApi, sorguMukellefAdi, type SorguKosusu, type SorguTuru } from '@/lib/genel-sorgular';
import { sure } from '../_lib/bicim';

export interface Suzgec {
  /** '' → tüm mükellefler */
  mukellefId: string;
  /** null → tüm türler */
  tur: SorguTuru | null;
  /** 'YYYY-MM' ya da '' (tüm dönemler) */
  donem: string;
}

const TUMU = '__TUMU__';

/**
 * Araç çubuğu: mükellef · dönem süzgeci + Sorgula (tür, altındaki sekmelerden gelir).
 * Süzgeç tabloları daraltır; Sorgula seçili mükellef için (tür sekmesi seçiliyse yalnız o tür, Tümü'de 6 sorgu) Dijital
 * Vergi Dairesi sorgusunu kuyruğa alır ve iş bitene kadar altındaki durum satırına yazar. Durum yokken aynı satır
 * düğmenin ne yapacağını söyler. Gece sorgusu mükellef kartındaki Otomatik Sorgulama Ayarı'na göre kendiliğinden
 * çalışır — burada ayrıca kurulum yok. Dönem süzgeci yalnız POS ve Gelen e-Arşiv'de anlamlıdır; başka tür
 * seçiliyken kapalı görünür.
 */
export function AracCubugu({ suzgec, onSuzgec, mukellefler }: { suzgec: Suzgec; onSuzgec: (s: Suzgec) => void; mukellefler: TaxpayerLite[] }) {
  const qc = useQueryClient();
  const tumDonemler = suzgec.donem === '';
  const secili = useMemo(() => mukellefler.find((m) => m.id === suzgec.mukellefId) || null, [mukellefler, suzgec.mukellefId]);

  // Kuyruğa alınan işler: bitene kadar 4 sn'de bir izlenir; bitince tablolar yenilenir.
  const [izlenen, setIzlenen] = useState<string[]>([]);
  const [not, setNot] = useState<{ ton: 'bilgi' | 'tamam' | 'uyari' | 'hata'; metin: string } | null>(null);
  const kosular = useQuery({
    queryKey: ['genel-sorgular', 'izlenen-kosular'],
    queryFn: () => genelSorgularApi.kosular(30),
    enabled: izlenen.length > 0,
    refetchInterval: izlenen.length > 0 ? 4_000 : false,
    retry: false,
  });
  const [simdi, setSimdi] = useState(0);
  useEffect(() => {
    if (!izlenen.length) return;
    setSimdi(Date.now());
    const t = setInterval(() => setSimdi(Date.now()), 1000);
    return () => clearInterval(t);
  }, [izlenen.length]);

  const bitirildi = useRef(false);
  useEffect(() => {
    if (!izlenen.length || !kosular.data) return;
    const benimkiler = kosular.data.filter((k) => izlenen.includes(k.id));
    if (!benimkiler.length) return;
    const suren = benimkiler.find((k) => k.status === 'pending' || k.status === 'running');
    if (suren) {
      bitirildi.current = false;
      setNot({ ton: 'bilgi', metin: `${kosuAdi(suren)} — ${suren.status === 'running' ? suren.payload?.progress?.message || 'çalışıyor' : 'kuyrukta'} · ${sure(suren.startedAt || suren.createdAt, simdi)}` });
      return;
    }
    if (bitirildi.current) return;
    bitirildi.current = true;
    const hatali = benimkiler.filter((k) => k.status === 'failed');
    const sorguHatasi = benimkiler.reduce((n, k) => n + (k.result?.sorguHatalari?.length ?? 0), 0);
    qc.invalidateQueries({ queryKey: ['genel-sorgular', 'guncel'] });
    qc.invalidateQueries({ queryKey: ['genel-sorgular', 'eksik-gorseller'] });
    qc.invalidateQueries({ queryKey: ['genel-sorgular', 'ozet'] });
    setIzlenen([]);
    if (hatali.length) setNot({ ton: 'hata', metin: `Sorgu başarısız: ${hatali[0].errorMessage || 'giriş yapılamadı'}` });
    else if (sorguHatasi) setNot({ ton: 'uyari', metin: `Tamamlandı; ${sorguHatasi} sorgu hata verdi (ayrıntı tabloda). Sonuçlar yenilendi.` });
    else setNot({ ton: 'tamam', metin: 'Tamamlandı — sonuçlar yenilendi.' });
  }, [kosular.data, izlenen, simdi, qc]);

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const sorgular: DvdSorguTuru[] = suzgec.tur ? [GENEL_SORGU_DVD_ANAHTARI[suzgec.tur]] : [...DVD_SORGULARI];
      return genelSorgularApi.sorguBaslat({ taxpayerIds: [suzgec.mukellefId], sorgular });
    },
    onSuccess: (d) => {
      if (!d.created.length) {
        setNot({ ton: 'uyari', metin: d.skipped[0]?.reason ? `Sorgu açılmadı: ${d.skipped[0].reason}` : d.message || 'Sorgu açılmadı.' });
        return;
      }
      bitirildi.current = false;
      setIzlenen(d.created.map((c) => c.id));
      setNot({ ton: 'bilgi', metin: 'Kuyruğa alındı…' });
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const m = err?.response?.data?.message;
      setNot({ ton: 'hata', metin: `Sorgu başlatılamadı: ${Array.isArray(m) ? m.join(', ') : m || err?.message || 'bilinmeyen hata'}` });
    },
  });

  const sorgulanabilir = !!suzgec.mukellefId && izlenen.length === 0 && !isPending;
  const dugmeIpucu = !suzgec.mukellefId
    ? 'Sorgulamak için bir mükellef seçin; mükellef ve dönem süzgeci tabloları daraltır.'
    : suzgec.tur
    ? `Sorgula: ${sorguMukellefAdi(secili) || 'Mükellef'} için Dijital Vergi Dairesi'nde yalnız ${SORGU_TURU_ADI[suzgec.tur]} sorgulanır.`
    : `Sorgula: ${sorguMukellefAdi(secili) || 'Mükellef'} için Dijital Vergi Dairesi'nde 6 sorgu tek oturumda çalışır (e-Defter dahil).`;
  const donemKapali = !!suzgec.tur && suzgec.tur !== 'POS' && suzgec.tur !== 'GELEN_EARSIV';

  return (
    <div className="gs-arac" data-gs-arac>
      <div className="gs-arac-satir">
        <label className="gs-alan gs-alan-mukellef">
          <span className="gs-alan-etiket">Mükellef</span>
          <TaxpayerSelect
            taxpayers={mukellefler}
            value={suzgec.mukellefId || TUMU}
            onChange={(id) => onSuzgec({ ...suzgec, mukellefId: id === TUMU ? '' : id })}
            allLabel="Tüm mükellefler"
            allValue={TUMU}
            className="gs-mukellef-secici"
          />
        </label>
        <label className="gs-alan gs-alan-donem" title={donemKapali ? 'Dönem süzgeci yalnız POS ve Gelen e-Arşiv tablolarında uygulanır' : undefined}>
          <span className="gs-alan-etiket">Dönem</span>
          <select className="gs-secim" value={tumDonemler ? '' : suzgec.donem} disabled={donemKapali} onChange={(e) => onSuzgec({ ...suzgec, donem: e.target.value })} aria-label="Dönem">
            <option value="">Tüm dönemler</option>
            {sonAylar(12).map((a) => (
              <option key={a.deger} value={a.deger}>{a.etiket}</option>
            ))}
          </select>
        </label>

        <button type="button" className="gs-dugme gs-arac-dugme" disabled={!sorgulanabilir} title={dugmeIpucu} onClick={() => { setNot(null); mutate(); }} data-gs-sorgula>
          {izlenen.length ? 'Sorgu sürüyor…' : isPending ? 'Kuyruğa alınıyor…' : 'Sorgula'}
        </button>
      </div>
      <div className="gs-durum" data-ton={not?.ton || 'ipucu'} role="status">
        {not ? <><span className="gs-nokta" data-ton={not.ton} aria-hidden />{not.metin}</> : dugmeIpucu}
      </div>
    </div>
  );
}

function kosuAdi(k: SorguKosusu): string {
  return sorguMukellefAdi(k.taxpayer) || 'Mükellef';
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** Bu aydan geriye n ay: [{ deger:'2026-09', etiket:'Eylül 2026' }, …] */
function sonAylar(n: number): Array<{ deger: string; etiket: string }> {
  const d = new Date();
  const out: Array<{ deger: string; etiket: string }> = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ deger: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`, etiket: `${AYLAR[t.getMonth()]} ${t.getFullYear()}` });
  }
  return out;
}
