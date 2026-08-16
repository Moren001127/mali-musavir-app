'use client';

import React, { useMemo, useState } from 'react';
import { Search, MessageCircle, Plus, FileText, PhoneOff, ChevronRight } from 'lucide-react';

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
 *   2. TEK SAYI SÜTUNU. Satırda sağda yalnız bakiye var; aylık ücret, son
 *      tahsilat, borç yaşı ikincil satırda tek stil gri metin.
 *   3. ÇUBUK YOK. Borç yaşı "94 gündür açık" diye yazıyor — renkli çubuk
 *      okunmuyordu.
 *   4. RENK AZ. Kırmızı yalnız gerçekten riskli olanda; gerisi nötr.
 */

const CIZGI = 'rgba(255,255,255,0.06)';
const SATIR_CIZGI = 'rgba(255,255,255,0.045)';
const KART = 'rgba(255,255,255,0.018)';
const METIN = '#e7e7ea';
const SOLUK = '#71717a';
const OK = '#5ad18a';
const RISK = '#e0697a';
const UYARI = '#d9a06c';
const MAVI = '#6aa9e8';

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

const para = (n?: number | null) =>
  `${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

const kisaPara = (n?: number | null) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}M ₺`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000).toLocaleString('tr-TR')}B ₺`;
  return `${Math.round(v)} ₺`;
};

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

  return (
    <div className="mt-6 space-y-5">
      {/* ÜST ŞERİT — üç rakam, kart kalabalığı yok */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
        <Rakam etiket="Toplam alacak" deger={para(toplamBakiye)} renk={METIN} buyuk />
        <Rakam etiket="Tahsilat oranı" deger={`%${Math.round(tahsilatOrani)}`} renk={tahsilatOrani >= 80 ? OK : UYARI} />
        <Rakam etiket="90+ gün riskli" deger={para(risk90Tutar)} renk={RISK} />
        <span className="ml-auto text-[11.5px]" style={{ color: SOLUK }}>
          {rows.length} mükellef · {sayilar.borclu} tanesi borçlu
        </span>
      </div>

      {/* BUGÜN NE YAPMALIYIM — asıl navigasyon burası */}
      <div>
        <div className="mb-2.5 text-[12px]" style={{ color: SOLUK }}>
          Bugün ne yapmalıyım
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Kutu
            etiket="Elle görüşülmeli"
            alt="90+ gün · otomasyon durur"
            sayi={sayilar.riskli}
            tutar={sayilar.riskliTutar}
            renk={RISK}
            aktif={kuyruk === 'riskli'}
            onClick={() => setKuyruk(kuyruk === 'riskli' ? 'hepsi' : 'riskli')}
          />
          <Kutu
            etiket="Ulaşılamıyor"
            alt="Borcu var, telefonu yok"
            sayi={sayilar.ulasilamiyor}
            tutar={sayilar.ulasilamiyorTutar}
            renk={UYARI}
            aktif={kuyruk === 'ulasilamiyor'}
            onClick={() => setKuyruk(kuyruk === 'ulasilamiyor' ? 'hepsi' : 'ulasilamiyor')}
          />
          <Kutu
            etiket="Bu ay ödeme yok"
            alt="Bu dönem tahsilat görünmüyor"
            sayi={sayilar.buAy}
            tutar={sayilar.buAyTutar}
            renk={MAVI}
            aktif={kuyruk === 'buAy'}
            onClick={() => setKuyruk(kuyruk === 'buAy' ? 'hepsi' : 'buAy')}
          />
          <Kutu
            etiket="Borçlu mükellef"
            alt="Açık bakiyesi olan herkes"
            sayi={sayilar.borclu}
            tutar={toplamBakiye}
            renk={SOLUK}
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
          <div>
            {gosterilen.map((r, i) => {
              const yas = borcYasiMetni(r);
              const borclu = r.bakiye > 0.004;
              const odendi = Number(r.buAyTahsilat || 0) > 0.004;
              const sonT = gunFarki(r.sonTahsilatTarihi);

              // İkincil satır: tek stil gri metin, parça parça renkli sayı yok
              const detay = [
                `Aylık ${kisaPara(r.aylikMuhasebeUcreti)}`,
                odendi ? 'bu ay ödendi' : 'bu ay ödeme yok',
                sonT === null ? 'hiç tahsilat yok' : `son tahsilat ${tarih(r.sonTahsilatTarihi)}`,
              ].join(' · ');

              return (
                <div
                  key={r.id}
                  className="group flex items-center gap-3 px-4 py-3 transition"
                  style={{ borderTop: i === 0 ? 'none' : `1px solid ${SATIR_CIZGI}` }}
                >
                  <button onClick={() => onOpen(r)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <span
                      className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                      style={{ background: borclu ? yas.renk : OK }}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px]" style={{ color: METIN }}>{r.ad}</span>
                        {!r.telefonVar && borclu && (
                          <PhoneOff size={11} style={{ color: UYARI }} />
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px]" style={{ color: SOLUK }}>
                        {detay}
                      </span>
                    </span>
                  </button>

                  <span className="flex-shrink-0 text-right">
                    <span className="block text-[14px] tabular-nums" style={{ color: borclu ? METIN : SOLUK }}>
                      {para(r.bakiye)}
                    </span>
                    <span className="block text-[10.5px]" style={{ color: yas.renk }}>
                      {yas.metin}
                    </span>
                  </span>

                  <span className="flex flex-shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Rakam({ etiket, deger, renk, buyuk }: { etiket: string; deger: string; renk: string; buyuk?: boolean }) {
  return (
    <span>
      <span className="block text-[10.5px] uppercase tracking-[0.12em]" style={{ color: SOLUK }}>
        {etiket}
      </span>
      <span className={`block tabular-nums ${buyuk ? 'text-[22px]' : 'text-[17px]'}`} style={{ color: renk }}>
        {deger}
      </span>
    </span>
  );
}

function Kutu({
  etiket, alt, sayi, tutar, renk, aktif, onClick,
}: {
  etiket: string; alt: string; sayi: number; tutar?: number; renk: string; aktif: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl px-3.5 py-3 text-left transition"
      style={{
        background: aktif ? `${renk}12` : KART,
        border: `1px solid ${aktif ? `${renk}44` : CIZGI}`,
      }}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[12px]" style={{ color: aktif ? renk : METIN }}>{etiket}</span>
        <span className="text-[18px] tabular-nums" style={{ color: renk }}>{sayi}</span>
      </span>
      <span className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[10.5px]" style={{ color: SOLUK }}>{alt}</span>
        {tutar !== undefined && tutar > 0 && (
          <span className="text-[10.5px] tabular-nums" style={{ color: SOLUK }}>{kisaPara(tutar)}</span>
        )}
      </span>
    </button>
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
