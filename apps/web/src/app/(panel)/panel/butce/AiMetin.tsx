'use client';

import React from 'react';
import { GOLD, MUTED, TEXT, ROW_SEP } from './ui';

/**
 * Yapay zekâ metnini derli toplu gösterir.
 *
 * Model sade metin üretmesi için yönlendirilir; yine de kalıntı biçim işaretleri
 * (##, **, ---, tablo boruları) gelirse burada gerçek biçime çevrilir — ham
 * karakterler kullanıcıya asla görünmez.
 */

/** **kalın** parçalarını gerçek kalına çevirir, kalan yıldızları temizler */
function satirParcala(satir: string, anahtar: string): React.ReactNode {
  const parcalar = satir.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parcalar.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? (
          <strong key={`${anahtar}-${i}`} style={{ color: TEXT, fontWeight: 600 }}>
            {p.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment key={`${anahtar}-${i}`}>{p.replace(/\*/g, '')}</React.Fragment>
        ),
      )}
    </>
  );
}

type Blok =
  | { tur: 'baslik'; metin: string }
  | { tur: 'paragraf'; satirlar: string[] }
  | { tur: 'madde'; maddeler: string[] }
  | { tur: 'tablo'; basliklar: string[]; satirlar: string[][] };

function bloklaraAyir(ham: string): Blok[] {
  const satirlar = String(ham || '').replace(/\r/g, '').split('\n');
  const bloklar: Blok[] = [];
  let i = 0;

  const tabloSatiri = (s: string) => /^\s*\|.*\|\s*$/.test(s);
  const ayracSatiri = (s: string) => /^\s*\|?[\s:|-]{3,}\|?\s*$/.test(s) && s.includes('-');
  const hucreler = (s: string) =>
    s.trim().replace(/^\||\|$/g, '').split('|').map((h) => h.trim());

  while (i < satirlar.length) {
    const satir = satirlar[i];
    const kirp = satir.trim();

    // Boş satır
    if (!kirp) {
      i++;
      continue;
    }

    // Yatay çizgi (---) — görsel gürültü, atlanır
    if (/^[-*_]{3,}$/.test(kirp)) {
      i++;
      continue;
    }

    // Başlık: "## Metin" ya da "1) Metin" / "**Metin**" tek başına
    const md = /^#{1,6}\s+(.*)$/.exec(kirp);
    if (md) {
      bloklar.push({ tur: 'baslik', metin: md[1].replace(/\*/g, '').trim() });
      i++;
      continue;
    }
    if (/^\*\*[^*]+\*\*:?$/.test(kirp)) {
      bloklar.push({ tur: 'baslik', metin: kirp.replace(/\*/g, '').replace(/:$/, '').trim() });
      i++;
      continue;
    }

    // Tablo
    if (tabloSatiri(kirp) && i + 1 < satirlar.length && ayracSatiri(satirlar[i + 1])) {
      const basliklar = hucreler(kirp);
      i += 2;
      const govde: string[][] = [];
      while (i < satirlar.length && tabloSatiri(satirlar[i])) {
        govde.push(hucreler(satirlar[i]));
        i++;
      }
      bloklar.push({ tur: 'tablo', basliklar, satirlar: govde });
      continue;
    }

    // Madde listesi
    if (/^[-•*]\s+/.test(kirp) || /^\d+[.)]\s+/.test(kirp)) {
      const maddeler: string[] = [];
      while (i < satirlar.length) {
        const m = satirlar[i].trim();
        if (!m) break;
        if (/^[-•*]\s+/.test(m)) maddeler.push(m.replace(/^[-•*]\s+/, ''));
        else if (/^\d+[.)]\s+/.test(m)) maddeler.push(m.replace(/^\d+[.)]\s+/, ''));
        else if (maddeler.length > 0) maddeler[maddeler.length - 1] += ' ' + m;
        else break;
        i++;
      }
      bloklar.push({ tur: 'madde', maddeler });
      continue;
    }

    // Paragraf
    const paragraf: string[] = [];
    while (i < satirlar.length) {
      const p = satirlar[i].trim();
      if (!p || /^[-•*]\s+/.test(p) || /^#{1,6}\s+/.test(p) || tabloSatiri(p) || /^[-*_]{3,}$/.test(p)) break;
      paragraf.push(p);
      i++;
    }
    if (paragraf.length) bloklar.push({ tur: 'paragraf', satirlar: paragraf });
  }

  return bloklar;
}

export default function AiMetin({ metin, soluk }: { metin: string; soluk?: boolean }) {
  const bloklar = React.useMemo(() => bloklaraAyir(metin), [metin]);
  const renk = soluk ? MUTED : TEXT;

  return (
    <div className="space-y-3">
      {bloklar.map((b, bi) => {
        if (b.tur === 'baslik') {
          return (
            <h4
              key={bi}
              className="pt-1 text-[12px] font-semibold uppercase tracking-wider"
              style={{ color: GOLD }}
            >
              {b.metin}
            </h4>
          );
        }

        if (b.tur === 'madde') {
          return (
            <ul key={bi} className="space-y-1.5">
              {b.maddeler.map((m, mi) => (
                <li key={mi} className="flex gap-2.5 text-[12.5px] leading-[1.7]" style={{ color: renk }}>
                  <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full" style={{ background: GOLD }} />
                  <span>{satirParcala(m, `${bi}-${mi}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (b.tur === 'tablo') {
          return (
            <div key={bi} className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: MUTED }}>
                    {b.basliklar.map((h, hi) => (
                      <th key={hi} className={`pb-1.5 font-medium ${hi > 0 ? 'text-right' : ''}`}>
                        {h.replace(/\*/g, '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.satirlar.map((r, ri) => (
                    <tr key={ri} className="border-t" style={{ borderColor: ROW_SEP }}>
                      {r.map((h, hi) => (
                        <td
                          key={hi}
                          className={`py-1.5 ${hi > 0 ? 'text-right tabular-nums' : ''}`}
                          style={{ color: hi > 0 ? renk : MUTED }}
                        >
                          {satirParcala(h, `${bi}-${ri}-${hi}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={bi} className="text-[12.5px] leading-[1.75]" style={{ color: renk }}>
            {b.satirlar.map((s, si) => (
              <React.Fragment key={si}>
                {si > 0 && <br />}
                {satirParcala(s, `${bi}-${si}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
