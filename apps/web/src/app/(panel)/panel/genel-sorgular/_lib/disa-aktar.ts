/**
 * Genel Sorgulamalar — "Excel indir": tarayıcıda CSV (noktalı virgül, UTF-8 BOM → Excel Türkçe karakterleri doğru açar).
 * Projede xlsx paketi yok; CSV Excel'de doğrudan açılır. Her sorgu türü için kalem/bildiri/fatura başına bir satır.
 */
import {
  eHacizVerisi,
  gelenEArsivVerisi,
  posVerisi,
  sorguMukellefAdi,
  vergiBorcuVerisi,
  yoklamaVerisi,
  type SorguSonucu,
  type SorguTuru,
} from '@/lib/genel-sorgular';
import { donemEtiketi, tarihKisa, tarihSaat, yilAyEtiketi } from './bicim';

type Hucre = string | number | null | undefined;

/** Excel'in sayı olarak tanıması için ondalık virgül; metinler tırnak içinde. */
function hucreMetni(v: Hucre): string {
  if (v === null || v === undefined) return '""';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '""';
  return `"${String(v).replace(/"/g, "'")}"`;
}

export function csvIndir(dosyaAdi: string, basliklar: string[], satirlar: Hucre[][]): void {
  const govde = [basliklar, ...satirlar].map((r) => r.map(hucreMetni).join(';')).join('\r\n');
  const blob = new Blob([`﻿${govde}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dosyaAdi;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const ORTAK_BASLIK = ['Mükellef', 'VKN / TCKN', 'Sorgu tarihi'];
const ortak = (s: SorguSonucu): Hucre[] => [sorguMukellefAdi(s.taxpayer) || s.taxpayerId, s.taxpayer?.taxNumber || '', tarihSaat(s.sorguTarihi)];

/** Tür başına başlık + satırlar. Ayrıntısı olmayan sonuç da tek satır olarak yazılır. */
