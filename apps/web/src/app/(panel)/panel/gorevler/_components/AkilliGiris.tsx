'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Building2, CalendarDays, ChevronDown, Clock, Flag, Loader2, Plus, Search, Sparkles, StickyNote, Tag, X } from 'lucide-react';
import { CATEGORY_OPTIONS, PRIORITY_LABEL, PRIORITY_ORDER, gunEkle, kategoriEtiketi, type CreateTaskInput, type TaskPriority } from '@/lib/tasks';
import { kahramanKartStili, seritStili } from '../../ekip/_components/ortak';
import { AcilirMenu, MenuAyrac, MenuBaslik, MenuSatiri } from './AcilirMenu';
import { ayristir, mukellefAdi, sadelestir, type MukellefSecenek } from './akilli-giris';
import { GIRDI, GOLD, GOLD_SOFT, IKINCIL, METIN, NOT_RENK, SONUK, kisaTarih, vadeIso } from './ortak';

/*
 * SAKİN PALET (2026-09-14): hızlı şablon çipleri ve ayrıştırma çipleri TEK stil (ince gri kenar, gri yazı; hover/açıkken altın kenar).
 * Yalnız "şüpheli mükellef adayı" çipi altın kesikli kenarlı. Menü ikonları nötr (MenuSatiri).
 */
/** Tek çip stili — Tailwind sınıfı (satır içi stil hover'ı ezerdi). */
const CIP_SINIF = 'border border-white/[0.12] bg-white/[0.03] text-[#fafaf9]/70 hover:border-[#d4b876]/60 hover:text-[#fafaf9]/90';
const CIP_ACIK_SINIF = 'border border-[#d4b876]/70 bg-[#d4b876]/[0.08] text-[#fafaf9]/90';
const CIP_BOS_SINIF = 'border border-dashed border-white/[0.22] bg-transparent text-[#fafaf9]/55 hover:border-[#d4b876]/60';
const CIP_ADAY_SINIF = 'border border-dashed border-[#d4b876]/60 bg-[#d4b876]/[0.06] text-[#d4b876] hover:bg-[#d4b876]/[0.14]';

/** Hızlı şablonlar: başlık + kategori + öncelik. Vade BOŞ bırakılır (kullanıcı çipten seçer). */
const SABLONLAR: Array<{ ad: string; kategori: string; oncelik: TaskPriority }> = [
  { ad: 'KDV kontrolü', kategori: 'KDV_KONTROL', oncelik: 'HIGH' },
  { ad: 'Banka ekstresi iste', kategori: 'BANKA', oncelik: 'MEDIUM' },
  { ad: 'Tahsilat araması', kategori: 'TAHSILAT', oncelik: 'HIGH' },
  { ad: 'Evrak takibi', kategori: 'EVRAK', oncelik: 'MEDIUM' },
  { ad: 'Beyanname hazırla', kategori: 'BEYANNAME', oncelik: 'HIGH' },
];

interface Elle {
  tarih?: string | null;
  saat?: string | null;
  mukellefId?: string | null;
  kategori?: string | null;
  oncelik?: TaskPriority | null;
}

function tarihEtiketi(gunIso: string): string {
  const bugun = gunEkle(0);
  const yarin = gunEkle(1);
  const on = gunIso === bugun ? 'Bugün · ' : gunIso === yarin ? 'Yarın · ' : '';
  const d = new Date(`${gunIso}T00:00:00`);
  return `${on}${d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', weekday: 'short' })}`;
}

/**
 * Akıllı giriş satırı — tek metin kutusu; Enter ile ekler. Metin yazılırken tarih/saat/öncelik/kategori/mükellef
 * çip olarak altta belirir; her çip menüden değiştirilebilir. "Not olarak kaydet" anahtarı tur=NOT yapar.
 */
export function AkilliGiris({
  mukellefler,
  varsayilanMukellefId,
  onEkle,
}: {
  mukellefler: MukellefSecenek[];
  /** Araç çubuğunda mükellef süzgeci açıksa yeni kayıt ona bağlanır */
  varsayilanMukellefId?: string;
  onEkle: (girdi: CreateTaskInput) => Promise<unknown>;
}) {
  const [metin, setMetin] = useState('');
  const [elle, setElle] = useState<Elle>({});
  const [notOlarak, setNotOlarak] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const girdiRef = useRef<HTMLInputElement>(null);

  const sonuc = useMemo(() => ayristir(metin, mukellefler), [metin, mukellefler]);

  const tarih = elle.tarih !== undefined ? elle.tarih : sonuc.tarih;
  const saat = elle.saat !== undefined ? elle.saat : sonuc.saat;
  const mukellefId = elle.mukellefId !== undefined ? elle.mukellefId : sonuc.mukellef?.id ?? varsayilanMukellefId ?? null;
  const kategori = elle.kategori !== undefined ? elle.kategori : sonuc.kategori;
  const oncelik: TaskPriority = elle.oncelik !== undefined && elle.oncelik !== null ? elle.oncelik : sonuc.oncelik ?? 'MEDIUM';
  const tur: 'GOREV' | 'NOT' = notOlarak || sonuc.tur === 'NOT' ? 'NOT' : 'GOREV';
  const mukellef = mukellefId ? mukellefler.find((m) => m.id === mukellefId) : undefined;
  const adaylar = !mukellefId && sonuc.mukellefAdaylar.length > 0 ? sonuc.mukellefAdaylar.slice(0, 3) : [];
  const baslik = (sonuc.baslik || metin).trim();
  const dolu = metin.trim().length > 0;

  const sifirla = () => {
    setMetin('');
    setElle({});
    setNotOlarak(false);
    girdiRef.current?.focus();
  };

  const ekle = async () => {
    if (!baslik || gonderiliyor) return;
    setGonderiliyor(true);
    try {
      await onEkle({
        title: baslik,
        category: kategori || undefined,
        priority: oncelik,
        taxpayerId: mukellefId || undefined,
        dueDate: vadeIso(tarih, saat),
        dueTime: saat || undefined,
        allDay: !saat,
        tur,
        kaynak: 'MANUEL',
        notifyInApp: true,
        notifyBrowser: true,
      });
      sifirla();
    } finally {
      setGonderiliyor(false);
    }
  };

  const sablonUygula = (s: (typeof SABLONLAR)[number]) => {
    setMetin(s.ad);
    setElle((e) => ({ mukellefId: e.mukellefId, kategori: s.kategori, oncelik: s.oncelik, tarih: undefined, saat: undefined }));
    setNotOlarak(false);
    girdiRef.current?.focus();
  };

  return (
    <section className="relative overflow-hidden rounded-2xl" style={kahramanKartStili(GOLD)}>
      <div className="h-1 w-full" style={seritStili(GOLD)} />
      <div className="p-3.5 sm:p-4">
        {/* Giriş satırı */}
        <div className="flex items-center gap-2 rounded-xl px-3" style={{ background: 'rgba(0,0,0,0.28)', border: `1px solid ${dolu ? `${GOLD}55` : 'rgba(255,255,255,0.10)'}` }}>
          <Sparkles size={16} className="flex-shrink-0" style={{ color: GOLD }} />
          <input
            ref={girdiRef}
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                ekle();
              } else if (e.key === 'Escape') {
                sifirla();
              }
            }}
            placeholder="Görev yaz: 'Öz Ela KDV kontrolü yarın 10:00' — Enter ile ekle"
            aria-label="Akıllı görev girişi"
            className="h-11 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[13.5px]"
            style={{ color: METIN }}
          />
          {dolu && (
            <button type="button" onClick={sifirla} title="Temizle (Esc)" className="flex-shrink-0 rounded-md p-1 hover:bg-white/10" style={{ color: IKINCIL }}>
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={ekle}
            disabled={!baslik || gonderiliyor}
            title={tur === 'NOT' ? 'Not olarak kaydet (Enter)' : 'Görev ekle (Enter)'}
            className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold transition-[transform,filter] hover:-translate-y-px hover:brightness-110 disabled:opacity-40 disabled:hover:translate-y-0"
            style={{ background: `linear-gradient(135deg, ${tur === 'NOT' ? NOT_RENK : GOLD}, ${tur === 'NOT' ? '#d97706' : GOLD_SOFT})`, color: '#0f0d0b' }}
          >
            {gonderiliyor ? <Loader2 size={13} className="animate-spin" /> : tur === 'NOT' ? <StickyNote size={13} /> : <Plus size={13} />}
            {tur === 'NOT' ? 'Not kaydet' : 'Ekle'}
          </button>
        </div>

        {/* Çipler */}
        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5">
          {dolu ? (
            <>
              <Cip ikon={<CalendarDays size={11} />} bos={!tarih} etiket={tarih ? tarihEtiketi(tarih) : 'Tarih yok'} title="Vade tarihi">
                {(kapat) => (
                  <TarihMenusu
                    deger={tarih}
                    onSec={(g) => {
                      setElle((e) => ({ ...e, tarih: g }));
                      kapat();
                    }}
                  />
                )}
              </Cip>
              <Cip ikon={<Clock size={11} />} bos={!saat} etiket={saat || 'Saat yok'} title="Saat">
                {(kapat) => (
                  <SaatMenusu
                    deger={saat}
                    onSec={(s) => {
                      setElle((e) => ({ ...e, saat: s }));
                      kapat();
                    }}
                  />
                )}
              </Cip>
              <Cip ikon={<Building2 size={11} />} bos={!mukellef} etiket={mukellef ? mukellefAdi(mukellef) : adaylar.length ? 'Mükellef?' : 'Mükellef yok'} title="Mükellef">
                {(kapat) => (
                  <MukellefMenusu
                    mukellefler={mukellefler}
                    deger={mukellefId}
                    onSec={(id) => {
                      setElle((e) => ({ ...e, mukellefId: id }));
                      kapat();
                    }}
                  />
                )}
              </Cip>
              {adaylar.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setElle((e) => ({ ...e, mukellefId: a.id }))}
                  title="Bu mükellef mi? Tıklayınca bağlanır"
                  className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium transition ${CIP_ADAY_SINIF}`}
                >
                  {a.ad}?
                </button>
              ))}
              <Cip ikon={<Tag size={11} />} bos={!kategori} etiket={kategori ? kategoriEtiketi(kategori) : 'Kategori yok'} title="Kategori">
                {(kapat) => (
                  <div className="py-1">
                    <MenuBaslik>Kategori</MenuBaslik>
                    {CATEGORY_OPTIONS.map((c) => (
                      <MenuSatiri key={c.value} aktif={kategori === c.value} ikon={<span className="h-2 w-2 rounded-full" style={{ background: c.color }} />} onClick={() => { setElle((e) => ({ ...e, kategori: c.value })); kapat(); }}>
                        {c.label}
                      </MenuSatiri>
                    ))}
                    <MenuAyrac />
                    <MenuSatiri ikon={<X size={12} />} onClick={() => { setElle((e) => ({ ...e, kategori: null })); kapat(); }}>
                      Kategori yok
                    </MenuSatiri>
                  </div>
                )}
              </Cip>
              <Cip ikon={<Flag size={11} />} etiket={PRIORITY_LABEL[oncelik]} title="Öncelik">
                {(kapat) => (
                  <div className="py-1">
                    <MenuBaslik>Öncelik</MenuBaslik>
                    {PRIORITY_ORDER.map((p) => (
                      <MenuSatiri key={p} aktif={oncelik === p} ikon={<Flag size={12} />} onClick={() => { setElle((e) => ({ ...e, oncelik: p })); kapat(); }}>
                        {PRIORITY_LABEL[p]}
                      </MenuSatiri>
                    ))}
                  </div>
                )}
              </Cip>
            </>
          ) : (
            <span className="text-[11.5px]" style={{ color: SONUK }}>
              Tarih, saat, mükellef, kategori ve öncelik yazdıkça kendiliğinden ayrışır; çiplerden düzeltebilirsiniz.
            </span>
          )}

          {/* Not anahtarı */}
          <label className="ml-auto inline-flex flex-shrink-0 cursor-pointer select-none items-center gap-2 text-[11.5px] font-semibold" style={{ color: tur === 'NOT' ? NOT_RENK : IKINCIL }} title="Görev yerine serbest not olarak kaydet">
            <span
              role="switch"
              aria-checked={tur === 'NOT'}
              className="relative inline-block h-[18px] w-[32px] rounded-full transition-colors"
              style={{ background: tur === 'NOT' ? NOT_RENK : 'rgba(255,255,255,0.14)' }}
            >
              <span className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all" style={{ left: tur === 'NOT' ? 16 : 2 }} />
            </span>
            <input type="checkbox" className="sr-only" checked={notOlarak} onChange={(e) => setNotOlarak(e.target.checked)} />
            <StickyNote size={12} /> Not olarak kaydet
          </label>
        </div>

        {/* Hızlı şablonlar */}
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 border-t pt-2.5" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[.08em]" style={{ color: IKINCIL }}>
            Hızlı şablon
          </span>
          {SABLONLAR.map((s) => (
            <button
              key={s.ad}
              type="button"
              onClick={() => sablonUygula(s)}
              title={`${s.ad} — ${kategoriEtiketi(s.kategori)} · ${PRIORITY_LABEL[s.oncelik]}; vadeyi çipten seçin`}
              className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-medium transition ${CIP_SINIF}`}
            >
              <Plus size={10} /> {s.ad}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Çip — menü açan hap; tek stil (gri), açıkken altın kenar, boşken kesikli gri. */
function Cip({ ikon, etiket, bos, title, children }: { ikon: ReactNode; etiket: string; bos?: boolean; title: string; children: (kapat: () => void) => ReactNode }) {
  return (
    <AcilirMenu
      genislik={260}
      hiza="sol"
      tetik={({ ref, ac, acik }) => (
        <button
          ref={ref}
          type="button"
          onClick={ac}
          title={`${title} — değiştirmek için tıkla`}
          className={`inline-flex max-w-[260px] flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-medium transition ${acik ? CIP_ACIK_SINIF : bos ? CIP_BOS_SINIF : CIP_SINIF}`}
        >
          {ikon}
          <span className="truncate">{etiket}</span>
          <ChevronDown size={10} style={{ opacity: 0.7 }} />
        </button>
      )}
    >
      {children}
    </AcilirMenu>
  );
}

function TarihMenusu({ deger, onSec }: { deger: string | null; onSec: (g: string | null) => void }) {
  const [tarih, setTarih] = useState(deger || '');
  const hizli = [
    { ad: 'Bugün', gun: gunEkle(0) },
    { ad: 'Yarın', gun: gunEkle(1) },
    { ad: 'Öbür gün', gun: gunEkle(2) },
    { ad: 'Gelecek hafta', gun: gunEkle(7) },
  ];
  return (
    <div className="py-1">
      <MenuBaslik>Vade</MenuBaslik>
      {hizli.map((h) => (
        <MenuSatiri key={h.ad} aktif={deger === h.gun} ikon={<CalendarDays size={12} />} onClick={() => onSec(h.gun)}>
          {h.ad} <span style={{ color: IKINCIL }}>· {kisaTarih(`${h.gun}T00:00:00`)}</span>
        </MenuSatiri>
      ))}
      <MenuAyrac />
      <div className="flex items-center gap-2 px-3 py-2">
        <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tarih && onSec(tarih)} className="h-8 min-w-0 flex-1 px-2 text-[12px]" style={GIRDI} title="Tarih seç" />
        <button type="button" disabled={!tarih} onClick={() => tarih && onSec(tarih)} className="h-8 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-40" style={{ background: 'rgba(212,184,118,0.10)', color: GOLD, border: `1px solid ${GOLD}66` }}>
          Seç
        </button>
      </div>
      {deger && (
        <>
          <MenuAyrac />
          <MenuSatiri ikon={<X size={12} />} onClick={() => onSec(null)}>
            Tarihi kaldır
          </MenuSatiri>
        </>
      )}
    </div>
  );
}

function SaatMenusu({ deger, onSec }: { deger: string | null; onSec: (s: string | null) => void }) {
  const [saat, setSaat] = useState(deger || '');
  return (
    <div className="py-1">
      <MenuBaslik>Saat</MenuBaslik>
      <div className="flex flex-wrap gap-1 px-3 py-1">
        {['09:00', '10:00', '11:00', '14:00', '16:00', '17:30'].map((s) => (
          <button key={s} type="button" onClick={() => onSec(s)} className="rounded-md px-2 py-1 text-[11.5px] font-semibold tabular-nums transition hover:brightness-125" style={{ background: deger === s ? 'rgba(212,184,118,0.14)' : 'rgba(255,255,255,0.05)', color: deger === s ? GOLD : METIN, border: `1px solid ${deger === s ? `${GOLD}66` : 'rgba(255,255,255,0.08)'}` }}>
            {s}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <input type="time" value={saat} onChange={(e) => setSaat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saat && onSec(saat)} className="h-8 min-w-0 flex-1 px-2 text-[12px]" style={GIRDI} title="Saat seç" />
        <button type="button" disabled={!saat} onClick={() => saat && onSec(saat)} className="h-8 rounded-lg px-3 text-[12px] font-semibold disabled:opacity-40" style={{ background: 'rgba(212,184,118,0.10)', color: GOLD, border: `1px solid ${GOLD}66` }}>
          Seç
        </button>
      </div>
      {deger && (
        <>
          <MenuAyrac />
          <MenuSatiri ikon={<X size={12} />} onClick={() => onSec(null)}>
            Saati kaldır (tüm gün)
          </MenuSatiri>
        </>
      )}
    </div>
  );
}

/** Aranabilir mükellef listesi (menü içi). */
export function MukellefMenusu({ mukellefler, deger, onSec }: { mukellefler: MukellefSecenek[]; deger: string | null; onSec: (id: string | null) => void }) {
  const [arama, setArama] = useState('');
  const liste = useMemo(() => {
    const a = sadelestir(arama.trim());
    const sirali = [...mukellefler].sort((x, y) => mukellefAdi(x).localeCompare(mukellefAdi(y), 'tr'));
    if (!a) return sirali.slice(0, 60);
    return sirali.filter((m) => sadelestir(mukellefAdi(m)).includes(a) || String(m.taxNumber || '').includes(a)).slice(0, 60);
  }, [mukellefler, arama]);
  return (
    <div className="flex max-h-[320px] flex-col">
      <div className="p-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: IKINCIL }} />
          <input autoFocus value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Ad ya da VKN ara…" className="h-8 w-full pl-7 pr-2 text-[12px]" style={GIRDI} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {liste.length === 0 && (
          <div className="px-3 py-4 text-center text-[11.5px]" style={{ color: IKINCIL }}>
            Eşleşen mükellef yok
          </div>
        )}
        {liste.map((m) => (
          <MenuSatiri key={m.id} aktif={deger === m.id} ikon={<Building2 size={12} />} onClick={() => onSec(m.id)}>
            {mukellefAdi(m)}
          </MenuSatiri>
        ))}
      </div>
      {deger && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <MenuSatiri ikon={<X size={12} />} onClick={() => onSec(null)}>
            Mükellef bağını kaldır
          </MenuSatiri>
        </div>
      )}
    </div>
  );
}
