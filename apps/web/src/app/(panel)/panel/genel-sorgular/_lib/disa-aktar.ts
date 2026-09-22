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
export function disaAktarimTablosu(tur: SorguTuru, rows: SorguSonucu[]): { basliklar: string[]; satirlar: Hucre[][] } {
  switch (tur) {
    case 'VERGI_BORCU': {
      const basliklar = [...ORTAK_BASLIK, 'Vergi türü', 'Dönem', 'Vade', 'Asıl borç', 'Gecikme zammı', 'Toplam', 'Vergi dairesi', 'Vadesi geçmiş mi', 'Sorgu toplamı'];
      const satirlar: Hucre[][] = [];
      for (const s of rows) {
        const v = vergiBorcuVerisi(s);
        if (v.kalemler.length === 0) satirlar.push([...ortak(s), 'Borç yok', '', '', 0, 0, 0, '', 'Hayır', v.toplam]);
        for (const k of v.kalemler) satirlar.push([...ortak(s), k.vergiTuru, k.donem, tarihKisa(k.vadeTarihi), k.asilBorc, k.gecikmeZammi, k.toplam, k.vergiDairesi, k.vadesiGecmisMi ? 'Evet' : 'Hayır', v.toplam]);
      }
      return { basliklar, satirlar };
    }
    case 'E_HACIZ': {
      const basliklar = [...ORTAK_BASLIK, 'Kapsam', 'Bildiri no', 'Vergi dairesi', 'Tutar', 'Durum', 'Vergi türü / dönem'];
      const satirlar: Hucre[][] = [];
      for (const s of rows) {
        const v = eHacizVerisi(s);
        if (v.bildiriler.length === 0) satirlar.push([...ortak(s), '', '', '', 0, 'Bildiri yok', '']);
        for (const b of v.bildiriler) {
          satirlar.push([...ortak(s), b.kapsam === 'ARAC' ? 'Araç' : 'Banka', b.bildiriNo, b.vergiDairesi || b.vergiDairesiKodu, b.tutar, b.durum, b.borclar.map((x) => `${x.vergiTuru} ${x.vergiDonem}`).join(' | ')]);
        }
      }
      return { basliklar, satirlar };
    }
    case 'YOKLAMA_DENETIM': {
      const basliklar = [...ORTAK_BASLIK, 'Kayıt', 'Vergi dairesi', 'Kod', 'Türü', 'Tarih', 'Sonuç', 'Tutanak PDF'];
      const satirlar: Hucre[][] = [];
      for (const s of rows) {
        const v = yoklamaVerisi(s);
        if (v.yoklamalar.length === 0 && v.denetimler.length === 0) satirlar.push([...ortak(s), 'Kayıt yok', '', '', '', '', '', '']);
        for (const y of v.yoklamalar) satirlar.push([...ortak(s), 'Yoklama', y.vergiDairesi, y.yoklamaKodu, y.yoklamaTuru, tarihSaat(y.tarih), '', y.pdfVarMi ? 'Var' : 'Yok']);
        for (const d of v.denetimler) satirlar.push([...ortak(s), 'Denetim', '', d.belgeKodu, d.denetimAdi || d.denetimTuru, tarihSaat(d.tarih), d.sonuc || '', '']);
      }
      return { basliklar, satirlar };
    }
    case 'POS': {
      const basliklar = [...ORTAK_BASLIK, 'Dönem', 'Kaynak', 'Ünvan', 'VKN', 'Üye işyeri no', 'Tutar', 'Dönem toplamı'];
      const satirlar: Hucre[][] = [];
      for (const s of rows) {
        const v = posVerisi(s);
        const donem = v.yil && v.ay ? yilAyEtiketi(v.yil, v.ay) : donemEtiketi(s.donem);
        if (v.satirlar.length === 0) satirlar.push([...ortak(s), donem, '', 'Kayıt yok', '', '', 0, v.toplamTutar]);
        for (const p of v.satirlar) satirlar.push([...ortak(s), donem, p.kaynak === 'ODEME_KURULUSU' ? 'Ödeme kuruluşu' : 'Banka', p.unvan, p.vkn, p.uyeIsyeriNo, p.tutar, v.toplamTutar]);
      }
      return { basliklar, satirlar };
    }
    case 'GELEN_EARSIV': {
      const basliklar = [...ORTAK_BASLIK, 'Dönem', 'Fatura tarihi', 'Fatura no', 'Satıcı', 'Satıcı VKN', 'Tutar', 'Vergiler', 'Ödenecek', 'Gönderim', 'Dönem toplamı'];
      const satirlar: Hucre[][] = [];
      for (const s of rows) {
        const v = gelenEArsivVerisi(s);
        const donem = donemEtiketi(s.donem);
        if (v.faturalar.length === 0) satirlar.push([...ortak(s), donem, '', 'Fatura yok', '', '', 0, 0, 0, '', v.toplamOdenecek]);
        for (const f of v.faturalar) satirlar.push([...ortak(s), donem, tarihKisa(f.duzenlenmeTarihi), f.faturaNo, f.saticiUnvan, f.saticiVkn, f.toplamTutar, f.vergilerTutari, f.odenecekTutar, f.gonderimSekli === 'KAGIT' ? 'Kâğıt' : 'Elektronik', v.toplamOdenecek]);
      }
      return { basliklar, satirlar };
    }
  }
}
