'use client';
import { portalStyle } from '@/lib/portal-theme';


import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlarmClock, Ban, Check, CheckCircle2, Edit3, ExternalLink, Loader2, MessageSquare, MoreVertical, Pin, Play, RotateCcw, Trash2, Users,
} from 'lucide-react';
import { type EkipIstek, type Task } from '@/lib/tasks';
import { AcilirMenu, ErtelemeSecenekleri, IkonDugme, MenuAyrac, MenuSatiri } from './AcilirMenu';
import { ajanKisaAd } from '../../ekip/_components/ortak';
import type { GorevEylemleri } from './eylemler';
import {
  ALTIN_SOLUK, DurumRozeti, EkipIstekCipi, GECIKME_RENK, KENAR_NOTR, KategoriEtiketi, KaynakRozeti, MukellefCipi, NotSayisi, OncelikEtiketi, SABIT_RENK, TekrarIkonu,
} from './Rozetler';
import {
  EKIP_RENK, GIRDI, GOLD, GRUPLAR, IKINCIL, METIN, MOR, SONUK, YESIL,
  etkinTarih, gecikmeMetni, goreliZaman, kisaTarih, type SatirGrubu,
} from './ortak';

/*
 * SAKİN PALET (2026-09-14): kenarlık .10; başlık satırı altın tonlu çok hafif zemin; grup başlıkları AYNI nötr zemin
 * + soldaki 3px soluk grup şeridi; satır başlığı 13px font-medium; gecikme tek yumuşak kırmızı, normal ağırlık.
 */
const HUCRE: CSSProperties = { border: `1px solid ${KENAR_NOTR}`, padding: '8px 10px', verticalAlign: 'middle' };
const HUCRE_BASLIK: CSSProperties = { ...HUCRE, padding: '7px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: ALTIN_SOLUK, textAlign: 'left', whiteSpace: 'nowrap' };
// Satır zeminleri TEK TON (zebra YOK — Muzaffer Bey 2026-09-14: "her satırda farklı renk tonu göz yoruyor").
// Grup başlığı ise AYRI bir bant: dolu zemin + üstte boşluk + kalın üst çizgi + büyük harf etiket ("Yarın/Sonra devamı gibi
// duruyordu, ayırt edici değil — doğru düzgün tablo yapısı").
// Grup başlığı = BAŞLIK olduğu belli olsun (Muzaffer Bey: "gecikmiş/yarın yazıları notlar gibi görünüyor"):
// altın tonlu dolu zemin (tablo başlığıyla aynı aile), altın büyük harf yazı, altın üst/alt çizgi, iç sütun çizgisi yok.
const GRUP_ZEMIN = 'rgba(212,184,118,0.13)';
const GRUP_CIZGI = '1px solid rgba(212,184,118,0.45)';
const GRUP_BOSLUK = 8; // px — gruplar arası nefes payı
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
 * Gruplar nötr başlık satırı + soluk şerit + soluk sayı; satırda kısa olgu (başlık + çipler), açıklama detay panelinde.
 * Eylem düğmeleri HER ZAMAN görünür (nötr; işlev rengi yalnız hover/aktif).
 */
export function GorevTablosu({ gruplar, secili, onSec, onGrupSec, eylemler, acikId, basliksiz, bos }: GorevTablosuProps) {
  const dolu = gruplar.filter((g) => g.satirlar.length > 0);
  return (
    <div data-gorev-tablo-cerceve className="gorev-tablo-cerceve overflow-x-auto rounded-xl" style={portalStyle({ border: `1px solid ${KENAR_NOTR}`, background: 'rgba(255,255,255,0.02)' })}>
      <table data-gorev-tablo className="w-full" style={portalStyle({ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 760 })}>
        <colgroup>
          <col style={portalStyle({ width: 36 })} />
          <col />
          <col style={portalStyle({ width: 140 })} />
          <col style={portalStyle({ width: 92 })} />
          <col style={portalStyle({ width: 132 })} />
          <col style={portalStyle({ width: 156 })} />
        </colgroup>
        <thead>
          <tr style={portalStyle({ background: 'rgba(212,184,118,0.07)' })}>
            <th style={portalStyle({ ...HUCRE_BASLIK, textAlign: 'center', padding: '7px 4px' })} title="Seç">
              <span className="sr-only">Seç</span>☐
            </th>
            <th style={portalStyle(HUCRE_BASLIK)}>Görev</th>
            <th style={portalStyle(HUCRE_BASLIK)}>Kategori</th>
            <th style={portalStyle(HUCRE_BASLIK)}>Öncelik</th>
            <th style={portalStyle(HUCRE_BASLIK)}>Vade</th>
            <th style={portalStyle({ ...HUCRE_BASLIK, textAlign: 'center' })}>Eylemler</th>
          </tr>
        </thead>
        <tbody>
          {dolu.length === 0 && (
            <tr>
              <td colSpan={SUTUN} style={portalStyle({ ...HUCRE, padding: 0 })}>
                {bos}
              </td>
            </tr>
          )}
          {dolu.map((g, gi) => {
            const gorevIdleri = g.satirlar.filter((s) => s.tip === 'gorev').map((s) => (s as { gorev: Task }).gorev.id);
            const hepsiSecili = gorevIdleri.length > 0 && gorevIdleri.every((id) => secili.has(id));
            // Ajanda grupları (Gecikmiş/Bugün/…/Sizden istenen) aciliyet rengi taşır; diğerleri (mükellef adı, gün) nötr.
            const grupTuru = g.key === 'istek' || GRUPLAR.some((x) => x.key === g.key) ? 'ajanda' : 'ozel';
            return (
              <Fragment key={g.key}>
                {!basliksiz && gi > 0 && (
                  <tr aria-hidden="true" data-gorev-bosluk>
                    <td colSpan={SUTUN} style={portalStyle({ border: 'none', padding: 0, height: GRUP_BOSLUK, background: 'transparent' })} />
                  </tr>
                )}
                {!basliksiz && (
                  <tr data-gorev-grup={g.key} data-gorev-grup-tur={grupTuru} style={portalStyle({ background: GRUP_ZEMIN })}>
                    <td style={portalStyle({ ...HUCRE, borderTop: GRUP_CIZGI, borderBottom: GRUP_CIZGI, borderRight: 'none', borderLeft: `4px solid ${g.renk}`, padding: '10px 4px', textAlign: 'center' })}>
                      {gorevIdleri.length > 0 && (
                        <input
                          type="checkbox"
                          checked={hepsiSecili}
                          onChange={(e) => onGrupSec(gorevIdleri, e.target.checked)}
                          title={hepsiSecili ? 'Grubun seçimini kaldır' : 'Gruptaki görevleri seç'}
                          className="h-3.5 w-3.5 cursor-pointer"
                          style={portalStyle({ accentColor: GOLD })}
                        />
                      )}
                    </td>
                    <td colSpan={SUTUN - 1} style={portalStyle({ ...HUCRE, borderTop: GRUP_CIZGI, borderBottom: GRUP_CIZGI, borderLeft: 'none', padding: '10px 12px' })}>
                      <div className="flex items-center gap-2.5">
                        <span data-gorev-grup-ad className="text-[12px] font-extrabold uppercase" style={portalStyle({ color: GOLD, letterSpacing: '.16em' })}>
                          {g.ad}
                        </span>
                        <span data-gorev-grup-sayi className="rounded-md px-1.5 text-[10.5px] font-bold tabular-nums leading-[18px]" style={portalStyle({ background: 'rgba(212,184,118,0.22)', color: GOLD })}>
                          {g.satirlar.length}
                        </span>
                        {g.ek && (
                          <span data-gorev-grup-ek className="text-[11px]" style={portalStyle({ color: IKINCIL })}>
                            · {g.ek}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {g.satirlar.map((s, si) => {
                  if (s.tip === 'istek') return <EkipIstekSatiri key={`i-${s.istek.id}`} istek={s.istek} eylemler={eylemler} zebra={si % 2 === 1} />;
                  return (
                    <GorevSatiri
                      key={s.gorev.id}
                      gorev={s.gorev}
                      secili={secili.has(s.gorev.id)}
                      acik={acikId === s.gorev.id}
                      onSec={(v) => onSec(s.gorev.id, v)}
                      eylemler={eylemler}
                      zebra={si % 2 === 1}
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
  zebra,
}: {
  gorev: Task;
  secili: boolean;
  acik?: boolean;
  onSec: (v: boolean) => void;
  eylemler: GorevEylemleri;
  zemin?: string;
  /** Grup içi sıra çiftliği — beyaz temada hafif zebra (gorevler-white.css). */
  zebra?: boolean;
}) {
  const bitti = t.status === 'DONE';
  const iptal = t.status === 'CANCELLED';
  const kapali = bitti || iptal;
  const tarih = etkinTarih(t);
  const gecikme = !kapali ? gecikmeMetni(tarih) : '';
  const gecikti = gecikme.endsWith('gecikti');
  // Beyaz tema vade tonu: gecikti kırmızı · bugün/yarın kehribar · ileri tarih soluk.
  const vadeTonu = gecikti ? 'gecikti' : gecikme === 'bugün' || gecikme === 'yarın' ? 'yakin' : 'ileri';
  // Seçili / detayda açık satır: tek vurgu altın.
  const arka = secili ? 'rgba(212,184,118,0.09)' : acik ? 'rgba(212,184,118,0.05)' : 'transparent';

  return (
    <tr data-gorev-satir="gorev" data-zebra={!!zebra} aria-selected={secili} data-gorev-acik={!!acik} style={portalStyle({ background: arka, boxShadow: acik ? `inset 3px 0 0 ${GOLD}` : undefined })} className="transition-colors hover:bg-white/[0.03]">
      <td style={portalStyle({ ...HUCRE, padding: '8px 4px', textAlign: 'center' })}>
        <input type="checkbox" checked={secili} onChange={(e) => onSec(e.target.checked)} title="Seç" className="h-3.5 w-3.5 cursor-pointer" style={portalStyle({ accentColor: GOLD })} />
      </td>
      <td style={portalStyle({ ...HUCRE, minWidth: 0 })}>
        <button
          type="button"
          onClick={() => eylemler.ac(t.id)}
          title="Detayı aç"
          data-gorev-satir-baslik
          className={`block w-full min-w-0 truncate text-left text-[13px] font-medium leading-5 transition hover:underline decoration-dotted underline-offset-4 ${kapali ? 'line-through opacity-50' : ''}`}
          style={portalStyle({ color: METIN })}
        >
          {t.pinned && <Pin size={11} className="mr-1 inline -translate-y-px" style={portalStyle({ color: SABIT_RENK })} />}
          {t.title}
        </button>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <MukellefCipi taxpayer={t.taxpayer} />
          <KaynakRozeti value={t.kaynak} />
          <DurumRozeti task={t} />
          {t.ekipIsId && (
            <Link href="/panel/ekip" data-gorev-meta onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[10.5px] font-medium hover:underline" style={portalStyle({ color: IKINCIL })} title="Ekip konsolunda aç">
              <Users size={10} /> Ekipte
            </Link>
          )}
          <NotSayisi n={t._count?.notes} />
          <TekrarIkonu task={t} />
        </div>
      </td>
      <td style={portalStyle(HUCRE)}>
        <KategoriEtiketi value={t.category} />
      </td>
      <td style={portalStyle(HUCRE)}>
        <OncelikEtiketi value={t.priority} />
      </td>
      <td style={portalStyle({ ...HUCRE, whiteSpace: 'nowrap' })}>
        {tarih ? (
          <div className="leading-tight">
            <div data-gorev-tarih className="text-[12.5px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.88)' })}>
              {kisaTarih(tarih)}
              {!t.allDay && t.dueTime ? <span style={portalStyle({ color: IKINCIL })}> {t.dueTime}</span> : null}
            </div>
            {gecikme && (
              <div data-gorev-vade={vadeTonu} className="text-[10.5px]" style={portalStyle({ color: gecikti ? GECIKME_RENK : IKINCIL })}>
                {gecikme}
              </div>
            )}
          </div>
        ) : (
          <span data-gorev-yok className="text-[11px]" style={portalStyle({ color: SONUK })}>
            —
          </span>
        )}
      </td>
      <td style={portalStyle({ ...HUCRE, padding: '6px 8px' })}>
        <SatirEylemleri gorev={t} eylemler={eylemler} />
      </td>
    </tr>
  );
}

/** Eylem sütunu: Tamamla ✓ · Ertele ⏰ · Not 💬 · ⋯ menü (Başlat / Düzenle / Ekibe ver / İptal / Sil). Düğmeler nötr; işlev rengi hover/aktifte. */
export function SatirEylemleri({ gorev: t, eylemler, kompakt, durumDugmesiz }: { gorev: Task; eylemler: GorevEylemleri; kompakt?: boolean; /** Tamamla / Yeniden aç düğmesi dışarıda gösteriliyorsa gizle (Kanban) */ durumDugmesiz?: boolean }) {
  const bitti = t.status === 'DONE';
  const iptal = t.status === 'CANCELLED';
  const kapali = bitti || iptal;
  return (
    <div className={`flex items-center ${kompakt ? 'gap-1' : 'justify-center gap-1'}`}>
      {durumDugmesiz ? null : bitti ? (
        <IkonDugme ikon={<RotateCcw size={13} />} title="Yeniden aç" renk={GOLD} onClick={() => eylemler.yenidenAc(t.id)} />
      ) : (
        <IkonDugme ikon={<Check size={14} />} title="Tamamla" renk={YESIL} ton="yesil" onClick={() => eylemler.tamamla(t.id)} disabled={iptal} />
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
              <MenuSatiri ikon={<Play size={13} />} onClick={() => { eylemler.baslat(t.id); kapat(); }}>
                Başlat (Sürüyor)
              </MenuSatiri>
            )}
            {t.status === 'IN_PROGRESS' && (
              <MenuSatiri ikon={<RotateCcw size={13} />} onClick={() => { eylemler.durumDegistir(t.id, 'OPEN'); kapat(); }}>
                Açık'a geri al
              </MenuSatiri>
            )}
            <MenuSatiri ikon={<Edit3 size={13} />} onClick={() => { eylemler.ac(t.id); kapat(); }}>
              Düzenle
            </MenuSatiri>
            {!kapali && (
              <MenuSatiri ikon={<Users size={13} />} onClick={() => { eylemler.ac(t.id); kapat(); }} title="Detay panelinde kuru test / canlı seçerek ekibe verin">
                Ekibe ver…
              </MenuSatiri>
            )}
            <MenuSatiri ikon={<Pin size={13} />} onClick={() => { eylemler.sabitle(t.id, !t.pinned); kapat(); }}>
              {t.pinned ? 'Sabitlemeyi kaldır' : 'Üste sabitle'}
            </MenuSatiri>
            {!kapali && (
              <MenuSatiri ikon={<Ban size={13} />} onClick={() => { if (confirm('Bu görev iptal edilsin mi?')) eylemler.iptal(t.id); kapat(); }}>
                İptal et
              </MenuSatiri>
            )}
            <MenuAyrac />
            <MenuSatiri ikon={<Trash2 size={13} />} tehlike onClick={() => { if (confirm('Bu kayıt silinsin mi? Geri alınamaz.')) eylemler.sil(t.id); kapat(); }}>
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
            <div data-gorev-soluk className="mb-1.5 truncate text-[11px] font-medium" style={portalStyle({ color: IKINCIL })} title={t.title}>
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
              data-gorev-girdi
              className="w-full resize-none px-2.5 py-2 text-[12.5px]"
              style={portalStyle(GIRDI)}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" data-gorev-dugme="sessiz" onClick={kapat} className="h-8 rounded-lg px-3 text-[12px] font-medium" style={portalStyle({ color: IKINCIL })}>
                Vazgeç
              </button>
              <button
                type="button"
                data-gorev-dugme="birincil"
                onClick={kaydet}
                disabled={!metin.trim() || kaydediyor}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-40"
                style={portalStyle({ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' })}
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

/*
 * Düğme görünümleri Tailwind sınıfıyla (satır içi stil hover sınıflarını ezerdi):
 * ALTIN_DUGME = altın ince kenarlı düz düğme (Yapıldı), gradyan yok; GRI_DUGME = ince gri kenar + altın yazı (Görev yap);
 * NOTR_IKON_BAGLANTI = nötr ikon kutusu, hover'da altın kenar.
 */
const ALTIN_DUGME = 'bg-[#d4b876]/[0.08] border border-[#d4b876]/40 text-[#d4b876] hover:bg-[#d4b876]/20 hover:border-[#d4b876]/70';
const GRI_DUGME = 'bg-white/[0.03] border border-white/[0.14] text-[#d4b876] hover:border-[#d4b876]/60 hover:bg-[#d4b876]/[0.06]';
const NOTR_IKON_BAGLANTI = 'bg-white/[0.04] border border-white/10 text-[#fafaf9]/60 hover:border-[#d4b876]/60 hover:text-[#d4b876]';

/** "Sizden istenen" — Ekip ajanının Muzaffer Bey'den istediği iş. Eylem: Yapıldı · Konsolda aç. Sky yalnız satır başı nokta + çipteki nokta. */
function EkipIstekSatiri({ istek: i, eylemler, zebra }: { istek: EkipIstek; eylemler: GorevEylemleri; zebra?: boolean }) {
  const [kapaniyor, setKapaniyor] = useState(false);
  return (
    <tr data-gorev-satir="istek" data-zebra={!!zebra} className="transition-colors hover:bg-white/[0.03]">
      <td style={portalStyle({ ...HUCRE, padding: '8px 4px', textAlign: 'center' })}>
        <span data-gorev-nokta="istek" className="inline-block h-1.5 w-1.5 rounded-full" style={portalStyle({ background: EKIP_RENK, opacity: 0.85 })} title="Ekip isteği" />
      </td>
      <td style={portalStyle({ ...HUCRE, minWidth: 0 })}>
        <div data-gorev-satir-baslik className="truncate text-[13px] font-medium leading-5" style={portalStyle({ color: METIN })} title={i.aciklama || i.baslik}>
          {i.baslik}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {i.mukellefAd && <MukellefCipi id={i.taxpayerId} ad={i.mukellefAd} />}
          <KaynakRozeti value="EKIP" />
          {i.ajanId && (
            <span data-gorev-meta className="text-[10.5px]" style={portalStyle({ color: IKINCIL })} title={`İsteyen ajan: ${i.ajanId}`}>
              {ajanKisaAd(i.ajanId)} ajanı
            </span>
          )}
          {i.aciklama && (
            <span data-gorev-soluk className="min-w-0 truncate text-[11px]" style={portalStyle({ color: IKINCIL, maxWidth: 420 })} title={i.aciklama}>
              {i.aciklama}
            </span>
          )}
        </div>
      </td>
      <td style={portalStyle(HUCRE)}>
        <EkipIstekCipi />
      </td>
      <td style={portalStyle(HUCRE)}>
        <span data-gorev-yok className="text-[11px]" style={portalStyle({ color: SONUK })}>
          —
        </span>
      </td>
      <td style={portalStyle({ ...HUCRE, whiteSpace: 'nowrap' })}>
        <div data-gorev-tarih className="text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.88)' })}>
          {goreliZaman(i.createdAt)}
        </div>
        <div data-gorev-vade="ileri" className="text-[10.5px]" style={portalStyle({ color: IKINCIL })}>
          istendi
        </div>
      </td>
      <td style={portalStyle({ ...HUCRE, padding: '6px 8px' })}>
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
            data-gorev-dugme="yesil"
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold transition disabled:opacity-50 ${ALTIN_DUGME}`}
          >
            {kapaniyor ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Yapıldı
          </button>
          <Link href="/panel/ekip" title="Ekip konsolunda aç" data-gorev-dugme="ikon" className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${NOTR_IKON_BAGLANTI}`}>
            <ExternalLink size={13} />
          </Link>
        </div>
      </td>
    </tr>
  );
}

