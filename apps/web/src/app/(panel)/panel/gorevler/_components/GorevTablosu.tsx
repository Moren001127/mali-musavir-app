'use client';

import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlarmClock, Ban, CalendarDays, Check, CheckCircle2, Edit3, ExternalLink, Loader2, MessageSquare, MoreVertical, Pin, Play, RotateCcw, Trash2, Users,
} from 'lucide-react';
import { type EkipIstek, type TakvimKalemi, type Task } from '@/lib/tasks';
import { AcilirMenu, ErtelemeSecenekleri, IkonDugme, MenuAyrac, MenuSatiri } from './AcilirMenu';
import { ajanKisaAd } from '../../ekip/_components/ortak';
import type { GorevEylemleri } from './eylemler';
import { DurumRozeti, KategoriEtiketi, KaynakRozeti, MukellefCipi, NotSayisi, OncelikEtiketi, TekrarIkonu } from './Rozetler';
import {
  EKIP_RENK, GIRDI, GOLD, IKINCIL, KENAR, KIRMIZI, MAVI, METIN, MOR, SONUK, TAKVIM_RENK, YESIL,
  donemEtiketi, etkinTarih, gecikmeMetni, goreliZaman, kisaTarih, type SatirGrubu,
} from './ortak';

// Kenarlıklar GÖRÜNÜR (rgba .14), başlık satırı lacivert tonlu, grup başlığı satırı grup renginde + sol 5px şerit.
const HUCRE: CSSProperties = { border: `1px solid ${KENAR}`, padding: '8px 10px', verticalAlign: 'middle' };
const HUCRE_BASLIK: CSSProperties = { ...HUCRE, padding: '7px 10px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: '#bfd4ff', textAlign: 'left', whiteSpace: 'nowrap' };
const SUTUN = 6;

export interface GorevTablosuProps {
  gruplar: SatirGrubu[];
  secili: Set<string>;
  onSec: (id: string, secildi: boolean) => void;
  onGrupSec: (ids: string[], secildi: boolean) => void;
  eylemler: GorevEylemleri;
  /** Detay panelinde açık olan görev (satır vurgusu) */
  acikId?: string | null;
  /** Grup başlıkları gizli (tek gruplu kullanım) */
  basliksiz?: boolean;
  bos?: ReactNode;
}

/**
 * Ajanda tablosu — GERÇEK <table>: ☐ · Görev · Kategori · Öncelik · Vade · Eylemler.
 * Gruplar renkli başlık satırı + sayı; satırda kısa olgu (başlık + çipler), açıklama detay panelinde.
 * Eylem düğmeleri HER ZAMAN görünür.
 */
export function GorevTablosu({ gruplar, secili, onSec, onGrupSec, eylemler, acikId, basliksiz, bos }: GorevTablosuProps) {
  const dolu = gruplar.filter((g) => g.satirlar.length > 0);
  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${KENAR}`, background: 'rgba(255,255,255,0.02)' }}>
      <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 760 }}>
        <colgroup>
          <col style={{ width: 36 }} />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 156 }} />
        </colgroup>
        <thead>
          <tr style={{ background: 'rgba(91,141,239,.14)' }}>
            <th style={{ ...HUCRE_BASLIK, textAlign: 'center', padding: '7px 4px' }} title="Seç">
              <span className="sr-only">Seç</span>☐
            </th>
            <th style={HUCRE_BASLIK}>Görev</th>
            <th style={HUCRE_BASLIK}>Kategori</th>
            <th style={HUCRE_BASLIK}>Öncelik</th>
            <th style={HUCRE_BASLIK}>Vade</th>
            <th style={{ ...HUCRE_BASLIK, textAlign: 'center' }}>Eylemler</th>
          </tr>
        </thead>
        <tbody>
          {dolu.length === 0 && (
            <tr>
              <td colSpan={SUTUN} style={{ ...HUCRE, padding: 0 }}>
                {bos}
              </td>
            </tr>
          )}
          {dolu.map((g) => {
            const gorevIdleri = g.satirlar.filter((s) => s.tip === 'gorev').map((s) => (s as { gorev: Task }).gorev.id);
            const hepsiSecili = gorevIdleri.length > 0 && gorevIdleri.every((id) => secili.has(id));
            return (
              <Fragment key={g.key}>
                {!basliksiz && (
                  <tr style={{ background: `${g.renk}1f` }}>
                    <td style={{ ...HUCRE, borderLeft: `5px solid ${g.renk}`, padding: '6px 4px', textAlign: 'center' }}>
                      {gorevIdleri.length > 0 && (
                        <input
                          type="checkbox"
                          checked={hepsiSecili}
                          onChange={(e) => onGrupSec(gorevIdleri, e.target.checked)}
                          title={hepsiSecili ? 'Grubun seçimini kaldır' : 'Gruptaki görevleri seç'}
                          className="h-3.5 w-3.5 cursor-pointer"
                          style={{ accentColor: g.renk }}
                        />
                      )}
                    </td>
                    <td colSpan={SUTUN - 1} style={{ ...HUCRE, padding: '6px 10px' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-bold" style={{ color: METIN }}>
                          {g.ad}
                        </span>
                        <span className="rounded-md px-1.5 text-[10.5px] font-extrabold tabular-nums leading-4" style={{ background: g.renk, color: '#0b1218' }}>
                          {g.satirlar.length}
                        </span>
                        {g.ek && (
                          <span className="text-[11px]" style={{ color: IKINCIL }}>
                            {g.ek}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {g.satirlar.map((s, i) => {
                  const zebra = i % 2 === 1 ? 'rgba(255,255,255,0.018)' : 'transparent';
                  if (s.tip === 'istek') return <EkipIstekSatiri key={`i-${s.istek.id}`} istek={s.istek} eylemler={eylemler} zemin={zebra} />;
                  if (s.tip === 'takvim') return <TakvimSatiri key={`c-${s.kalem.id}`} kalem={s.kalem} eylemler={eylemler} zemin={zebra} />;
                  return (
                    <GorevSatiri
                      key={s.gorev.id}
                      gorev={s.gorev}
                      secili={secili.has(s.gorev.id)}
                      acik={acikId === s.gorev.id}
                      onSec={(v) => onSec(s.gorev.id, v)}
                      eylemler={eylemler}
                      zemin={zebra}
                    />
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Tek görev satırı. */
export function GorevSatiri({
  gorev: t,
  secili,
  acik,
  onSec,
  eylemler,
  zemin,
}: {
  gorev: Task;
  secili: boolean;
  acik?: boolean;
  onSec: (v: boolean) => void;
  eylemler: GorevEylemleri;
  zemin?: string;
}) {
  const bitti = t.status === 'DONE';
  const iptal = t.status === 'CANCELLED';
  const kapali = bitti || iptal;
  const tarih = etkinTarih(t);
  const gecikme = !kapali ? gecikmeMetni(tarih) : '';
  const gecikti = gecikme.endsWith('gecikti');
  const arka = secili ? 'rgba(212,184,118,0.09)' : acik ? 'rgba(125,211,252,0.07)' : zemin;

  return (
    <tr style={{ background: arka, boxShadow: acik ? `inset 3px 0 0 ${EKIP_RENK}` : undefined }} className="transition-colors hover:bg-white/[0.03]">
      <td style={{ ...HUCRE, padding: '8px 4px', textAlign: 'center' }}>
        <input type="checkbox" checked={secili} onChange={(e) => onSec(e.target.checked)} title="Seç" className="h-3.5 w-3.5 cursor-pointer" style={{ accentColor: GOLD }} />
      </td>
      <td style={{ ...HUCRE, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => eylemler.ac(t.id)}
          title="Detayı aç"
          className={`block w-full min-w-0 truncate text-left text-[13.5px] font-semibold leading-5 transition hover:underline decoration-dotted underline-offset-4 ${kapali ? 'line-through opacity-50' : ''}`}
          style={{ color: METIN }}
        >
          {t.pinned && <Pin size={11} className="mr-1 inline -translate-y-px" style={{ color: '#fbbf24' }} />}
          {t.title}
        </button>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <MukellefCipi taxpayer={t.taxpayer} />
          <KaynakRozeti value={t.kaynak} />
          <DurumRozeti task={t} />
          {t.ekipIsId && (
            <Link href="/panel/ekip" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10.5px] font-semibold hover:underline" style={{ color: EKIP_RENK }} title="Ekip konsolunda aç">
              <Users size={10} /> Ekipte
            </Link>
          )}
          <NotSayisi n={t._count?.notes} />
          <TekrarIkonu task={t} />
        </div>
      </td>
      <td style={HUCRE}>
        <KategoriEtiketi value={t.category} />
      </td>
      <td style={HUCRE}>
        <OncelikEtiketi value={t.priority} />
      </td>
      <td style={{ ...HUCRE, whiteSpace: 'nowrap' }}>
        {tarih ? (
          <div className="leading-tight">
            <div className="text-[12.5px] font-semibold tabular-nums" style={{ color: gecikti ? '#fca5a5' : METIN }}>
              {kisaTarih(tarih)}
              {!t.allDay && t.dueTime ? <span style={{ color: IKINCIL }}> {t.dueTime}</span> : null}
            </div>
            {gecikme && (
              <div className="text-[10.5px] font-semibold" style={{ color: gecikti ? KIRMIZI : IKINCIL }}>
                {gecikme}
              </div>
            )}
          </div>
        ) : (
          <span className="text-[11px]" style={{ color: SONUK }}>
            —
          </span>
        )}
      </td>
      <td style={{ ...HUCRE, padding: '6px 8px' }}>
        <SatirEylemleri gorev={t} eylemler={eylemler} />
      </td>
    </tr>
  );
}

/** Eylem sütunu: Tamamla ✓ · Ertele ⏰ · Not 💬 · ⋯ menü (Başlat / Düzenle / Ekibe ver / İptal / Sil). */
export function SatirEylemleri({ gorev: t, eylemler, kompakt, durumDugmesiz }: { gorev: Task; eylemler: GorevEylemleri; kompakt?: boolean; /** Tamamla / Yeniden aç düğmesi dışarıda gösteriliyorsa gizle (Kanban) */ durumDugmesiz?: boolean }) {
  const bitti = t.status === 'DONE';
  const iptal = t.status === 'CANCELLED';
  const kapali = bitti || iptal;
  return (
    <div className={`flex items-center ${kompakt ? 'gap-1' : 'justify-center gap-1'}`}>
      {durumDugmesiz ? null : bitti ? (
        <IkonDugme ikon={<RotateCcw size={13} />} title="Yeniden aç" renk={MAVI} onClick={() => eylemler.yenidenAc(t.id)} />
      ) : (
        <IkonDugme ikon={<Check size={14} />} title="Tamamla" renk={YESIL} onClick={() => eylemler.tamamla(t.id)} disabled={iptal} />
      )}
      <AcilirMenu genislik={240} tetik={({ ref, ac, acik }) => <IkonDugme refDis={ref} ikon={<AlarmClock size={13} />} title="Ertele" renk={MOR} onClick={ac} aktif={acik} disabled={kapali} />}>
        {(kapat) => (
          <ErtelemeSecenekleri
            onSec={(g) => {
              eylemler.ertele(t.id, g);
              kapat();
            }}
          />
        )}
      </AcilirMenu>
      <HizliNot gorev={t} eylemler={eylemler} />
      <AcilirMenu genislik={208} tetik={({ ref, ac, acik }) => <IkonDugme refDis={ref} ikon={<MoreVertical size={14} />} title="Diğer eylemler" renk="#a8a29e" onClick={ac} aktif={acik} />}>
        {(kapat) => (
          <div className="py-1">
            {!kapali && t.status !== 'IN_PROGRESS' && (
              <MenuSatiri ikon={<Play size={13} />} renk={MAVI} onClick={() => { eylemler.baslat(t.id); kapat(); }}>
                Başlat (Sürüyor)
              </MenuSatiri>
            )}
            {t.status === 'IN_PROGRESS' && (
              <MenuSatiri ikon={<RotateCcw size={13} />} renk={GOLD} onClick={() => { eylemler.durumDegistir(t.id, 'OPEN'); kapat(); }}>
                Açık'a geri al
              </MenuSatiri>
            )}
            <MenuSatiri ikon={<Edit3 size={13} />} onClick={() => { eylemler.ac(t.id); kapat(); }}>
              Düzenle
            </MenuSatiri>
            {!kapali && (
              <MenuSatiri ikon={<Users size={13} />} renk={EKIP_RENK} onClick={() => { eylemler.ac(t.id); kapat(); }} title="Detay panelinde kuru test / canlı seçerek ekibe verin">
                Ekibe ver…
              </MenuSatiri>
            )}
            <MenuSatiri ikon={<Pin size={13} />} renk="#fbbf24" onClick={() => { eylemler.sabitle(t.id, !t.pinned); kapat(); }}>
              {t.pinned ? 'Sabitlemeyi kaldır' : 'Üste sabitle'}
            </MenuSatiri>
            {!kapali && (
              <MenuSatiri ikon={<Ban size={13} />} renk="#94a3b8" onClick={() => { if (confirm('Bu görev iptal edilsin mi?')) eylemler.iptal(t.id); kapat(); }}>
                İptal et
              </MenuSatiri>
            )}
            <MenuAyrac />
            <MenuSatiri ikon={<Trash2 size={13} />} renk={KIRMIZI} onClick={() => { if (confirm('Bu kayıt silinsin mi? Geri alınamaz.')) eylemler.sil(t.id); kapat(); }}>
              Sil
            </MenuSatiri>
          </div>
        )}
      </AcilirMenu>
    </div>
  );
}

/** 💬 Hızlı not — küçük açılır kutu; Ctrl+Enter / Kaydet. */
function HizliNot({ gorev: t, eylemler }: { gorev: Task; eylemler: GorevEylemleri }) {
  const [metin, setMetin] = useState('');
  const [kaydediyor, setKaydediyor] = useState(false);
  return (
    <AcilirMenu genislik={300} tetik={({ ref, ac, acik }) => <IkonDugme refDis={ref} ikon={<MessageSquare size={13} />} title="Not ekle" renk={GOLD} onClick={ac} aktif={acik} />}>
      {(kapat) => {
        const kaydet = async () => {
          if (!metin.trim() || kaydediyor) return;
          setKaydediyor(true);
          try {
            await eylemler.notEkle(t.id, metin.trim());
            setMetin('');
            kapat();
          } finally {
            setKaydediyor(false);
          }
        };
        return (
          <div className="p-3">
            <div className="mb-1.5 truncate text-[11px] font-semibold" style={{ color: IKINCIL }} title={t.title}>
              {t.title}
            </div>
            <textarea
              autoFocus
              value={metin}
              onChange={(e) => setMetin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) kaydet();
              }}
              rows={3}
              placeholder="Not yaz… (Ctrl+Enter kaydeder)"
              className="w-full resize-none px-2.5 py-2 text-[12.5px]"
              style={GIRDI}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={kapat} className="h-8 rounded-lg px-3 text-[12px] font-semibold" style={{ color: IKINCIL }}>
                Vazgeç
              </button>
              <button
                type="button"
                onClick={kaydet}
                disabled={!metin.trim() || kaydediyor}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
              >
                {kaydediyor ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Kaydet
              </button>
            </div>
          </div>
        );
      }}
    </AcilirMenu>
  );
}

/** "Sizden istenen" — Ekip ajanının Muzaffer Bey'den istediği iş. Eylem: Yapıldı · Konsolda aç. */
function EkipIstekSatiri({ istek: i, eylemler, zemin }: { istek: EkipIstek; eylemler: GorevEylemleri; zemin?: string }) {
  const [kapaniyor, setKapaniyor] = useState(false);
  return (
    <tr style={{ background: zemin }} className="transition-colors hover:bg-white/[0.03]">
      <td style={{ ...HUCRE, padding: '8px 4px', textAlign: 'center' }}>
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: EKIP_RENK, boxShadow: `0 0 8px ${EKIP_RENK}` }} title="Ekip isteği" />
      </td>
      <td style={{ ...HUCRE, minWidth: 0 }}>
        <div className="truncate text-[13.5px] font-semibold leading-5" style={{ color: METIN }} title={i.aciklama || i.baslik}>
          {i.baslik}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {i.mukellefAd && <MukellefCipi id={i.taxpayerId} ad={i.mukellefAd} />}
          <KaynakRozeti value="EKIP" />
          {i.ajanId && (
            <span className="text-[10.5px] font-semibold" style={{ color: IKINCIL }} title={`İsteyen ajan: ${i.ajanId}`}>
              {ajanKisaAd(i.ajanId)} ajanı
            </span>
          )}
          {i.aciklama && (
            <span className="min-w-0 truncate text-[11px]" style={{ color: IKINCIL, maxWidth: 420 }} title={i.aciklama}>
              {i.aciklama}
            </span>
          )}
        </div>
      </td>
      <td style={HUCRE}>
        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[10.5px] font-bold" style={{ background: `${EKIP_RENK}18`, color: EKIP_RENK, border: `1px solid ${EKIP_RENK}44` }}>
          Sizden istenen
        </span>
      </td>
      <td style={HUCRE}>
        <span className="text-[11px]" style={{ color: SONUK }}>
          —
        </span>
      </td>
      <td style={{ ...HUCRE, whiteSpace: 'nowrap' }}>
        <div className="text-[12px] font-semibold" style={{ color: METIN }}>
          {goreliZaman(i.createdAt)}
        </div>
        <div className="text-[10.5px]" style={{ color: IKINCIL }}>
          istendi
        </div>
      </td>
      <td style={{ ...HUCRE, padding: '6px 8px' }}>
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            disabled={kapaniyor}
            onClick={async () => {
              setKapaniyor(true);
              try {
                await eylemler.istekKapat(i.id);
              } finally {
                setKapaniyor(false);
              }
            }}
            title="Yapıldı — isteği kapat"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-bold transition hover:brightness-110 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${EKIP_RENK}, #5b9fd1)`, color: '#0b1218' }}
          >
            {kapaniyor ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Yapıldı
          </button>
          <Link href="/panel/ekip" title="Ekip konsolunda aç" className="inline-flex h-7 w-7 items-center justify-center rounded-md transition hover:brightness-125" style={{ background: `${EKIP_RENK}14`, color: EKIP_RENK, border: `1px solid ${EKIP_RENK}2e` }}>
            <ExternalLink size={13} />
          </Link>
        </div>
      </td>
    </tr>
  );
}

/** Mali Takvim kalemi — soluk bilgi satırı + "Görev yap"; görev açıldıysa "görev var". */
function TakvimSatiri({ kalem: c, eylemler, zemin }: { kalem: TakvimKalemi; eylemler: GorevEylemleri; zemin?: string }) {
  const [olusuyor, setOlusuyor] = useState(false);
  const gecikme = gecikmeMetni(c.tarih);
  return (
    <tr style={{ background: zemin, opacity: 0.82 }} className="transition-colors hover:bg-white/[0.03]">
      <td style={{ ...HUCRE, padding: '8px 4px', textAlign: 'center' }}>
        <CalendarDays size={12} style={{ color: TAKVIM_RENK }} />
      </td>
      <td style={{ ...HUCRE, minWidth: 0 }}>
        <div className="truncate text-[13px] font-medium leading-5" style={{ color: 'rgba(250,250,249,0.85)' }}>
          {c.ad}
          {c.donem && <span style={{ color: IKINCIL }}> — {donemEtiketi(c.donem)}</span>}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <KaynakRozeti value="TAKVIM" />
          <span className="text-[10.5px]" style={{ color: IKINCIL }}>
            son gün
          </span>
        </div>
      </td>
      <td style={HUCRE}>
        <KategoriEtiketi value="BEYANNAME" />
      </td>
      <td style={HUCRE}>
        <span className="text-[11px]" style={{ color: SONUK }}>
          —
        </span>
      </td>
      <td style={{ ...HUCRE, whiteSpace: 'nowrap' }}>
        <div className="text-[12.5px] font-semibold tabular-nums" style={{ color: METIN }}>
          {kisaTarih(c.tarih)}
        </div>
        <div className="text-[10.5px] font-semibold" style={{ color: IKINCIL }}>
          {gecikme}
        </div>
      </td>
      <td style={{ ...HUCRE, padding: '6px 8px' }}>
        <div className="flex items-center justify-center">
          {c.gorevVar ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: YESIL }} title="Bu takvim kaleminden görev açılmış">
              <CheckCircle2 size={13} /> görev var
            </span>
          ) : (
            <button
              type="button"
              disabled={olusuyor}
              onClick={async () => {
                setOlusuyor(true);
                try {
                  await eylemler.takvimdenGorev(c);
                } finally {
                  setOlusuyor(false);
                }
              }}
              title="Bu takvim kaleminden görev aç"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11.5px] font-bold transition hover:brightness-125 disabled:opacity-50"
              style={{ background: `${TAKVIM_RENK}1a`, color: TAKVIM_RENK, border: `1px solid ${TAKVIM_RENK}55` }}
            >
              {olusuyor ? <Loader2 size={12} className="animate-spin" /> : <CalendarDays size={12} />} Görev yap
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
