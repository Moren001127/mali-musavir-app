'use client';

import React, { useMemo, useState } from 'react';
import {
  Search, MessageCircle, Plus, FileText, PhoneOff, ChevronRight,
  AlertTriangle, PhoneMissed, CalendarX, Users,
} from 'lucide-react';
import {
  SayacKutusu, KPI, paraTR, paraKisa,
  OK as UI_OK, KIRMIZI as UI_KIRMIZI, TURUNCU as UI_TURUNCU, MAVI as UI_MAVI,
  MUTED as UI_MUTED, TEXT as UI_TEXT, CARD_BORDER, CARD_BG,
} from './ui';

/**
 * TAHSİLAT GÖRÜNÜMÜ — sıfırdan tasarım.
 *
 * Eski hâlinde 75 mükellef düz bir tabloydu: dört metrik kartı, arama, üç çip
 * ve her satırda aylık ücret / bu ay / bakiye / borç yaşı çubuğu. Ofis sahibi
 * "kimlerle ilgilenmem lazım" sorusunu cevaplamak için bütün listeyi taramak
 * zorundaydı.
 *
 * Yeni düzenin kuralları:
 *   1. ÖNCE KARAR, SONRA VERİ. En üstte "bugün ne yapmalıyım" kuyrukları var;
 *      liste onların altında ve seçime göre süzülüyor.
 *   2. DÖRT SAYI SÜTUNU (2026-08-18 kullanıcı kararı). Önce yalnız bakiye
 *      gösteriliyordu; "bu mükellefe ne kestim, ne aldım" sorusu ekstreyi
 *      açmadan cevaplanamıyordu. Artık ücret / borç / alacak / bakiye ayrı
 *      sütunlarda ve altta toplam satırı var.
 *   3. ÇUBUK YOK. Borç yaşı "94 gündür açık" diye yazıyor — renkli çubuk
 *      okunmuyordu.
 *   4. RENK AZ. Kırmızı yalnız gerçekten riskli olanda; gerisi nötr.
 */

const CIZGI = CARD_BORDER;
const KART = CARD_BG;
const SATIR_CIZGI = 'rgba(255,255,255,0.045)';
const METIN = UI_TEXT;
const SOLUK = UI_MUTED;
const OK = UI_OK;
const RISK = UI_KIRMIZI;
const UYARI = UI_TURUNCU;
const MAVI = UI_MAVI;

export type TahsilatSatiri = {
  id: string;
  ad: string;
  taxNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  aylikMuhasebeUcreti: number;
  tahakkuk: number;
  tahsilat: number;
  bakiye: number;
  buAyTahsilat?: number;
  maxBucket: string;
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number };
  sonTahsilatTarihi?: string | null;
  sonHatirlatmaTarihi?: string | null;
  telefonVar: boolean;
  whatsappUygun: boolean;
};

type Kuyruk = 'hepsi' | 'riskli' | 'ulasilamiyor' | 'buAy' | 'borclu';

const para = paraTR;
const kisaPara = paraKisa;

const tarih = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null;

const gunFarki = (d?: string | null) => {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

/** Borç yaşı — kovadan okunur, metin olarak yazılır */
const borcYasiMetni = (r: TahsilatSatiri): { metin: string; renk: string } => {
  if (r.bakiye <= 0.004) return { metin: 'Borç yok', renk: OK };
  if (Number(r.aging?.d90plus || 0) > 0) return { metin: '90+ gündür açık', renk: RISK };
  if (Number(r.aging?.d61_90 || 0) > 0) return { metin: '61–90 gündür açık', renk: RISK };
  if (Number(r.aging?.d31_60 || 0) > 0) return { metin: '31–60 gündür açık', renk: UYARI };
  if (Number(r.aging?.d1_30 || 0) > 0) return { metin: '30 gün içinde', renk: SOLUK };
  return { metin: 'Vadesi gelmedi', renk: SOLUK };
};

const normalize = (s: string) =>
  s.toLocaleLowerCase('tr').replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c');

export default function TahsilatView({
  rows,
  isLoading,
  toplamBakiye,
  risk90Tutar,
  tahsilatOrani,
  onOpen,
  onQuickTahsilat,
  onWhatsApp,
}: {
  rows: TahsilatSatiri[];
  isLoading: boolean;
  toplamBakiye: number;
  risk90Tutar: number;
  tahsilatOrani: number;
  onOpen: (r: TahsilatSatiri) => void;
  onQuickTahsilat: (r: TahsilatSatiri) => void;
  onWhatsApp: (r: TahsilatSatiri) => void;
}) {
  const [kuyruk, setKuyruk] = useState<Kuyruk>('hepsi');
  const [arama, setArama] = useState('');

  const sayilar = useMemo(() => {
    let riskli = 0, riskliTutar = 0, ulasilamiyor = 0, ulasilamiyorTutar = 0;
    let buAy = 0, buAyTutar = 0, borclu = 0;
    for (const r of rows) {
      const borc = r.bakiye > 0.004;
      if (!borc) continue;
      borclu += 1;
      if (Number(r.aging?.d90plus || 0) > 0) { riskli += 1; riskliTutar += r.bakiye; }
      if (!r.telefonVar) { ulasilamiyor += 1; ulasilamiyorTutar += r.bakiye; }
      if (!(Number(r.buAyTahsilat || 0) > 0.004)) { buAy += 1; buAyTutar += r.bakiye; }
    }
    return { riskli, riskliTutar, ulasilamiyor, ulasilamiyorTutar, buAy, buAyTutar, borclu };
  }, [rows]);

  const gosterilen = useMemo(() => {
    const ara = normalize(arama.trim());
    const suz = rows.filter((r) => {
      const borc = r.bakiye > 0.004;
      if (kuyruk === 'riskli' && !(borc && Number(r.aging?.d90plus || 0) > 0)) return false;
      if (kuyruk === 'ulasilamiyor' && !(borc && !r.telefonVar)) return false;
      if (kuyruk === 'buAy' && !(borc && !(Number(r.buAyTahsilat || 0) > 0.004))) return false;
      if (kuyruk === 'borclu' && !borc) return false;
      if (!ara) return true;
      return normalize([r.ad, r.taxNumber || '', r.phone || ''].join(' ')).includes(ara);
    });

    // Sıralama: riskli önce, sonra büyük bakiye. Alfabetik sıra karar vermeye
    // yardım etmiyordu — sahip önce parayı görmeli.
    return suz.sort((a, b) => {
      const ra = Number(a.aging?.d90plus || 0) > 0 ? 1 : 0;
      const rb = Number(b.aging?.d90plus || 0) > 0 ? 1 : 0;
      return rb - ra || b.bakiye - a.bakiye || a.ad.localeCompare(b.ad, 'tr');
    });
  }, [rows, kuyruk, arama]);

  /** Alt toplam satırı — SÜZGEÇTEN GEÇEN satırların toplamı, hepsinin değil */
  const toplamlar = useMemo(
    () =>
      gosterilen.reduce(
        (t, r) => ({
          ucret: t.ucret + Number(r.aylikMuhasebeUcreti || 0),
          tahakkuk: t.tahakkuk + Number(r.tahakkuk || 0),
          tahsilat: t.tahsilat + Number(r.tahsilat || 0),
          bakiye: t.bakiye + Number(r.bakiye || 0),
        }),
        { ucret: 0, tahakkuk: 0, tahsilat: 0, bakiye: 0 },
      ),
    [gosterilen],
  );

  return (
    <div className="mt-6 space-y-5">
      {/* ÜST ŞERİT — portalın kart dili: renk şeridi + radial parıltı */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KPI
          etiket="Toplam alacak"
          deger={para(toplamBakiye)}
          altBilgi={`${rows.length} mükellef · ${sayilar.borclu} tanesi borçlu`}
          renk={UI_MAVI}
          ikon={<Users size={14} />}
          vurgu
        />
        <KPI
          etiket="Tahsilat oranı"
          deger={`%${Math.round(tahsilatOrani)}`}
          altBilgi={tahsilatOrani >= 80 ? 'Hedefin üstünde' : 'Hedefin altında'}
          renk={tahsilatOrani >= 80 ? OK : UYARI}
        />
        <KPI
          etiket="90+ gün riskli"
          deger={para(risk90Tutar)}
          altBilgi={`${sayilar.riskli} mükellefte birikmiş`}
          renk={RISK}
          ikon={<AlertTriangle size={14} />}
          vurgu={sayilar.riskli > 0}
        />
      </div>

      {/* BUGÜN NE YAPMALIYIM — asıl navigasyon burası */}
      <div>
        <div className="mb-2.5 text-[12px]" style={{ color: SOLUK }}>
          Bugün ne yapmalıyım
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SayacKutusu
            etiket="Elle görüşülmeli"
            aciklama="90+ gün · otomasyon durur"
            sayi={sayilar.riskli}
            tutar={kisaPara(sayilar.riskliTutar)}
            renk={RISK}
            ikon={<AlertTriangle size={13} />}
            aktif={kuyruk === 'riskli'}
            onClick={() => setKuyruk(kuyruk === 'riskli' ? 'hepsi' : 'riskli')}
          />
          <SayacKutusu
            etiket="Ulaşılamıyor"
            aciklama="Borcu var, telefonu yok"
            sayi={sayilar.ulasilamiyor}
            tutar={kisaPara(sayilar.ulasilamiyorTutar)}
            renk={UYARI}
            ikon={<PhoneMissed size={13} />}
            aktif={kuyruk === 'ulasilamiyor'}
            onClick={() => setKuyruk(kuyruk === 'ulasilamiyor' ? 'hepsi' : 'ulasilamiyor')}
          />
          <SayacKutusu
            etiket="Bu ay ödeme yok"
            aciklama="Bu dönem tahsilat görünmüyor"
            sayi={sayilar.buAy}
            tutar={kisaPara(sayilar.buAyTutar)}
            renk={MAVI}
            ikon={<CalendarX size={13} />}
            aktif={kuyruk === 'buAy'}
            onClick={() => setKuyruk(kuyruk === 'buAy' ? 'hepsi' : 'buAy')}
          />
          <SayacKutusu
            etiket="Borçlu mükellef"
            aciklama="Açık bakiyesi olan herkes"
            sayi={sayilar.borclu}
            tutar={kisaPara(toplamBakiye)}
            renk={UI_MUTED}
            ikon={<Users size={13} />}
            aktif={kuyruk === 'borclu'}
            onClick={() => setKuyruk(kuyruk === 'borclu' ? 'hepsi' : 'borclu')}
          />
        </div>
      </div>

      {/* LİSTE */}
      <div className="rounded-xl" style={{ background: KART, border: `1px solid ${CIZGI}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-baseline gap-2">
            <span className="text-[12.5px]" style={{ color: METIN }}>
              {kuyruk === 'hepsi' ? 'Tüm mükellefler' :
               kuyruk === 'riskli' ? 'Elle görüşülmesi gerekenler' :
               kuyruk === 'ulasilamiyor' ? 'Ulaşılamayanlar' :
               kuyruk === 'buAy' ? 'Bu ay ödeme görünmeyenler' : 'Borçlular'}
            </span>
            <span className="text-[11px] tabular-nums" style={{ color: SOLUK }}>
              {gosterilen.length}
            </span>
            {kuyruk !== 'hepsi' && (
              <button
                onClick={() => setKuyruk('hepsi')}
                className="text-[11px] underline underline-offset-2"
                style={{ color: SOLUK }}
              >
                süzgeci kaldır
              </button>
            )}
          </span>

          <div className="relative w-full sm:w-[260px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: SOLUK }} />
            <input
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Mükellef ara…"
              className="w-full rounded-lg py-2 pl-9 pr-3 text-[12.5px] outline-none"
              style={{ border: `1px solid ${CIZGI}`, background: 'rgba(0,0,0,0.25)', color: METIN }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="px-4 py-12 text-center text-[12.5px]" style={{ color: SOLUK }}>
            Yükleniyor…
          </div>
        ) : gosterilen.length === 0 ? (
          <div className="px-4 py-12 text-center text-[12.5px]" style={{ color: SOLUK }}>
            Bu süzgece uyan mükellef yok.
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* table-fixed + colgroup ŞART: serbest genişlikte uzun firma adı
                hücreyi büyütüp "İşlem" sütununu ekranın sağ dışına itiyordu ve
                düğmeler kayboluyordu. Sabit sütunla ad kesilir, düğmeler kalır. */}
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 132 }} />
                <col style={{ width: 128 }} />
              </colgroup>
              <thead>
                <tr
                  className="text-[10.5px] uppercase tracking-wider"
                  style={{ color: SOLUK, borderTop: `1px solid ${SATIR_CIZGI}` }}
                >
                  <th className="px-4 py-2.5 text-left font-medium">Mükellef</th>
                  <th className="px-3 py-2.5 text-right font-medium">Aylık ücret</th>
                  <th className="px-3 py-2.5 text-right font-medium">Borç</th>
                  <th className="px-3 py-2.5 text-right font-medium">Alacak</th>
                  <th className="px-3 py-2.5 text-right font-medium">Bakiye</th>
                  <th className="px-4 py-2.5 text-right font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {gosterilen.map((r) => {
                  const yas = borcYasiMetni(r);
                  const borclu = r.bakiye > 0.004;
                  const odendi = Number(r.buAyTahsilat || 0) > 0.004;
                  const sonT = gunFarki(r.sonTahsilatTarihi);

                  return (
                    <tr
                      key={r.id}
                      className="group transition"
                      style={{ borderTop: `1px solid ${SATIR_CIZGI}` }}
                    >
                      <td className="px-4 py-2.5">
                        <button onClick={() => onOpen(r)} className="flex w-full min-w-0 items-center gap-2.5 text-left">
                          <span
                            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{ background: borclu ? yas.renk : OK }}
                          />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13px]" style={{ color: METIN }}>{r.ad}</span>
                              {!r.telefonVar && borclu && <PhoneOff size={11} style={{ color: UYARI }} />}
                            </span>
                            {/* İkincil satır: borç yaşı ve son tahsilat — sayı sütunlarında yeri yok */}
                            <span className="mt-0.5 block truncate text-[11px]" style={{ color: SOLUK }}>
                              {borclu ? yas.metin : 'borcu yok'}
                              {' · '}
                              {odendi ? 'bu ay ödendi' : 'bu ay ödeme yok'}
                              {' · '}
                              {sonT === null ? 'hiç tahsilat yok' : `son tahsilat ${tarih(r.sonTahsilatTarihi)}`}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: r.aylikMuhasebeUcreti > 0 ? METIN : 'rgba(113,113,122,0.5)' }}>
                        {r.aylikMuhasebeUcreti > 0 ? para(r.aylikMuhasebeUcreti) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: SOLUK }}>
                        {para(r.tahakkuk)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: OK }}>
                        {para(r.tahsilat)}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums"
                        style={{ color: borclu ? yas.renk : SOLUK }}
                      >
                        {para(r.bakiye)}
                      </td>
                      <td className="px-4 py-2.5">
                        {/* Eylemler HER ZAMAN görünür: hover ardına saklamak işlevi bulunamaz kılıyordu */}
                        <span className="flex flex-shrink-0 items-center justify-end gap-1">
                          <Eylem ikon={<FileText size={13} />} baslik="Ekstre" onClick={() => onOpen(r)} />
                          <Eylem
                            ikon={<MessageCircle size={13} />}
                            baslik={r.whatsappUygun ? 'Hatırlatma gönder' : 'WhatsApp uygun değil'}
                            renk={r.whatsappUygun ? OK : SOLUK}
                            onClick={() => r.whatsappUygun && onWhatsApp(r)}
                            pasif={!r.whatsappUygun}
                          />
                          <Eylem ikon={<Plus size={13} />} baslik="Tahsilat ekle" renk={MAVI} onClick={() => onQuickTahsilat(r)} />
                          <ChevronRight size={14} style={{ color: SOLUK }} />
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {/* TOPLAM — süzgeçten geçen satırların toplamı; hangi kümeye
                    baktığınızın karşılığı aşağıda dursun. */}
                <tr style={{ borderTop: `1px solid ${CIZGI}`, background: 'rgba(255,255,255,0.022)' }}>
                  <td className="px-4 py-3 text-[11.5px] uppercase tracking-wider" style={{ color: SOLUK }}>
                    Toplam · {gosterilen.length} mükellef
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums" style={{ color: METIN }}>
                    {para(toplamlar.ucret)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums" style={{ color: METIN }}>
                    {para(toplamlar.tahakkuk)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums" style={{ color: OK }}>
                    {para(toplamlar.tahsilat)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums" style={{ color: RISK }}>
                    {para(toplamlar.bakiye)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}



function Eylem({
  ikon, baslik, onClick, renk = '#8b8b93', pasif,
}: { ikon: React.ReactNode; baslik: string; onClick: () => void; renk?: string; pasif?: boolean }) {
  return (
    <button
      title={baslik}
      onClick={onClick}
      disabled={pasif}
      className="rounded-md p-1.5 transition hover:bg-white/[0.06] disabled:cursor-not-allowed"
      style={{ color: renk, opacity: pasif ? 0.4 : 1 }}
    >
      {ikon}
    </button>
  );
}
