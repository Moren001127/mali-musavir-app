'use client';

import React, { useState } from 'react';
import { Sparkles, RefreshCw, Send } from 'lucide-react';
import { AiRapor } from '@/lib/butce';
import { Kutu, Dugme, Girdi, MUTED, TEXT, MOR, Yukleniyor } from './ui';
import AiMetin from './AiMetin';

/**
 * AI yorum kutusu. İçerik Max aboneliği üzerinden üretilir; rakamlar
 * kullanıcının kendi verisinden gelir. Yorum gelmezse tablo/plan etkilenmez.
 */
export default function AiKutu({
  baslik,
  aciklama,
  rapor,
  yukleniyor,
  yenile,
  soruSor,
}: {
  baslik: string;
  aciklama?: string;
  rapor?: AiRapor | null;
  yukleniyor?: boolean;
  yenile?: () => void;
  soruSor?: (soru: string) => void;
}) {
  const [soru, setSoru] = useState('');

  return (
    <Kutu
      baslik={
        <span className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: MOR }} /> {baslik}
        </span>
      }
      aciklama={aciklama}
      renk={MOR}
      sag={
        yenile && (
          <Dugme onClick={yenile} renk={MOR} yukleniyor={yukleniyor}>
            <RefreshCw size={12} /> Yenile
          </Dugme>
        )
      }
    >
      {yukleniyor && !rapor ? (
        <Yukleniyor metin="Verileriniz değerlendiriliyor…" />
      ) : rapor ? (
        <AiMetin metin={rapor.icerik} soluk={rapor.hata} />
      ) : (
        <p className="text-[12px]" style={{ color: MUTED }}>
          Henüz yorum üretilmedi.
        </p>
      )}

      {rapor && !rapor.hata && (
        <p className="mt-3 text-[10px]" style={{ color: 'rgba(113,113,122,0.8)' }}>
          {rapor.model} · {new Date(rapor.createdAt).toLocaleString('tr-TR')}
          {rapor.onbellek ? ' · kayıtlı yorum' : ''}
        </p>
      )}

      {soruSor && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!soru.trim()) return;
            soruSor(soru.trim());
            setSoru('');
          }}
        >
          <Girdi
            value={soru}
            onChange={(e) => setSoru(e.target.value)}
            placeholder="Sor: bu ay nereye çok harcadım? hangi kartı önce kapatmalıyım?"
          />
          <Dugme type="submit" tur="birincil" renk={MOR} yukleniyor={yukleniyor}>
            <Send size={12} /> Sor
          </Dugme>
        </form>
      )}
    </Kutu>
  );
}
