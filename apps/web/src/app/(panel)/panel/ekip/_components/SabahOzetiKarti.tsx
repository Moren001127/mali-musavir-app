'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sun, Loader2, Play, FileText, Inbox, BarChart3, MessageCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getIs, sabahOzetiUret, isZamanAsimi, type EkipDurum } from '@/lib/ekip';
import type { KosularApi } from './kosular';
import { CamKart, Dug, IkonKutu, V5 } from './Cam';
import { saatKisa, tarihKisa, bugunMu } from './ortak';

const SIMGELER = [FileText, Inbox, BarChart3, MessageCircle, AlertTriangle];

/** Rapor metninden özet satırları: markdown/emoji/başlık işaretleri düşer, "yok" satırları ve çok kısa satırlar elenir. */
export function ozetSatirlari(rapor: string, tavan = 5): string[] {
  const out: string[] = [];
  for (const ham of String(rapor || '').replace(/\r/g, '').split('\n')) {
    let s = ham
      .replace(/\*\*|__|`|~~/g, '')
      .replace(/^\s*[#>]+\s*/, '')
      .replace(/^\s*[-•*]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      .trim();
    if (!s || s.length < 12) continue;
    if (/^(rapor|sabah özeti|günaydın)/i.test(s) && s.length < 40) continue;
    if (/^[A-ZÇĞİÖŞÜ\s·:]+$/.test(s)) continue; // BAŞLIK satırı
    if (/^(yaptığım iş|baktığım kaynaklar|kime döndü|öğrendiklerim|devir)\s*:/i.test(s)) continue;
    s = s.replace(/^(bulgular|sonuç|özet)\s*:\s*/i, '');
    if (!s) continue;
    out.push(s.length > 140 ? `${s.slice(0, 139).trimEnd()}…` : s);
    if (out.length >= tavan) break;
  }
  return out;
}

/** Satır içindeki ilk sayı+kelime kalın ("8 mükellef", "2 e-Tebligat"). */
function vurgula(s: string): React.ReactNode {
  const m = s.match(/^(.*?)(\b\d[\d.,]*\s+[^\s,.;:]+)(.*)$/);
  if (!m) return s;
  return (
    <>
      {m[1]}
      <b style={{ color: V5.metin }}>{m[2]}</b>
      {m[3]}
    </>
  );
}

/**
 * Sabah özeti v5 (sağ sütun): son üretilen özetin satırları (simgeli) + "Şimdi üret" (yalnız üretir, göndermez;
 * sonuç iş panelinde Koordinatör koşusu olarak açılır — gönderim orada ayrı teyitle).
 */
export function SabahOzetiKarti({ durum, kosular }: { durum: EkipDurum | undefined; kosular: KosularApi }) {
  const qc = useQueryClient();
  const [uretiliyor, setUretiliyor] = useState(false);
  const [kilitliyeKadar, setKilitliyeKadar] = useState(0);
  const son = durum?.sonSabahOzeti || null;
  const isS = useQuery({ queryKey: ['ekip-is', son?.isId], queryFn: () => getIs(son!.isId), enabled: !!son?.isId, staleTime: 5 * 60_000, retry: 1 });
  const satirlar = useMemo(() => ozetSatirlari(isS.data?.result?.rapor || son?.raporIlkSatir || ''), [isS.data, son?.raporIlkSatir]);
  const kilitli = uretiliyor || Date.now() < kilitliyeKadar || !!kosular.aktifKosu;
  const bugun = !!son?.createdAt && bugunMu(son.createdAt);

  const simdiUret = async () => {
    if (kilitli) return;
    setUretiliyor(true);
    const basladi = Date.now();
    kosular.ayarla('koordinator', { ajanId: 'koordinator', gorev: 'Sabah özeti — üretiliyor (gönderme yok)', dryRun: true, cevap: '', adimlar: [], bitti: false, basladi, kaynak: 'sabahOzeti' });
    try {
      const r = await sabahOzetiUret({ gonder: false });
      kosular.ayarla('koordinator', {
        ajanId: 'koordinator',
        gorev: 'Sabah özeti (şimdi üretildi)',
        dryRun: true,
        isId: r.isId,
        vakaId: r.isId,
        model: r.model,
        cevap: r.rapor || '',
        adimlar: (r.toolUses || []).map((t) => ({ tip: 'arac' as const, ad: t.name, args: t.args, zaman: Date.now(), durum: 'bitti' as const })),
        bitti: true,
        hata: r.hata,
        durationMs: r.durationMs ?? Date.now() - basladi,
        basladi,
        kaynak: 'sabahOzeti',
        gonderildi: 0,
      });
      toast.success('Sabah özeti üretildi', { description: 'İş panelinde açıldı.' });
    } catch (e: any) {
      const zamanAsimi = isZamanAsimi(e);
      const hata = zamanAsimi ? 'Sürüyor — iş kayıtlarında görünecek' : e?.message || 'Sabah özeti üretilemedi';
      kosular.guncelle('koordinator', (k) => ({ ...k, bitti: true, hata, durationMs: Date.now() - basladi }));
      if (zamanAsimi) {
        toast.info(hata);
        setKilitliyeKadar(Date.now() + 3 * 60_000);
      } else toast.error(hata);
    } finally {
      setUretiliyor(false);
      qc.invalidateQueries({ queryKey: ['ekip-akis'] });
      qc.invalidateQueries({ queryKey: ['ekip-durum'] });
      qc.invalidateQueries({ queryKey: ['ekip-kadro'] });
    }
  };

  return (
    <CamKart
      ton="mint"
      etiket="Bugün"
      ikon={<Sun size={17} />}
      baslik="Sabah özeti"
      sag={
        <Dug kucuk tur="hayalet" disabled={kilitli} onClick={simdiUret} title="Yalnız üretir; Muzaffer Bey’e göndermez (gönderim iş panelinde ayrı teyit)">
          {uretiliyor ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {uretiliyor ? 'Üretiliyor…' : Date.now() < kilitliyeKadar ? 'Sürüyor…' : 'Şimdi üret'}
        </Dug>
      }
      dolguYok
    >
      <div className="flex flex-col gap-2 px-4 pb-4">
        {son && (
          <div className="text-[11.5px]" style={{ color: V5.soluk }}>
            {bugun ? `Bugün ${saatKisa(son.createdAt).slice(0, 5)}` : tarihKisa(son.createdAt)} üretildi{durum?.sabahOzeti ? ' · her sabah 08:30 WhatsApp’a gider' : ''}
          </div>
        )}
        {isS.isLoading && !satirlar.length ? (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: V5.ikincil }}>
            <Loader2 size={12} className="animate-spin" /> Özet okunuyor…
          </div>
        ) : satirlar.length ? (
          satirlar.map((s, i) => {
            const Ikon = SIMGELER[i % SIMGELER.length];
            return (
              <div key={i} className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed" style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${V5.cizgi}`, color: V5.ikincil }}>
                <IkonKutu ton="mint" boyut={28}>
                  <Ikon size={14} />
                </IkonKutu>
                <span className="min-w-0">{vurgula(s)}</span>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl px-3 py-4 text-center text-[12.5px]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${V5.cizgi2}`, color: V5.ikincil }}>
            {son ? 'Özet metni okunamadı.' : 'Henüz özet üretilmedi — "Şimdi üret" ile Koordinatör bugünü toplar.'}
          </div>
        )}
      </div>
    </CamKart>
  );
}
