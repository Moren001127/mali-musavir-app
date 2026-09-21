'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bell, Bookmark, CalendarDays, FileCheck, FileText, Receipt, Timer, X } from 'lucide-react';
import { api } from '@/lib/api';
import './mali-takvim.css';

/**
 * Bu Ay Mali Takvim — AY IZGARASI + ZAMAN ÇİZGİSİ (2026-09-21 gece, Muzaffer Bey: "takvimi şekil olarak da baştan dizayn et").
 * Eski yedi günlük şerit + düz liste yerine: solda gerçek ay ızgarası (bugün, son tarih günleri kalan güne göre renkli,
 * not günleri mavi nokta), sağda tarihe göre gruplanmış dikey zaman çizgisi. Izgarada bir güne tıklayınca sağ taraf
 * o güne süzülür. Son tarih kuralları ve görev (`/tasks`) verisi eski bileşenle aynı; yalnız biçim değişti.
 * Renkler `mali-takvim.css`te: koyu tema A varsayılan, beyaz tema D ezer.
 */

interface SonTarih {
  date: Date;
  gunFark: number;
  title: string;
  subtitle: string;
  icon: any;
  kind: 'vat' | 'payroll' | 'stamp' | 'tourism' | 'ledger' | 'income';
}

interface TaskItem {
  id: string;
  title: string;
  dueDate: string;
  status?: string;
  isCompleted?: boolean;
  done?: boolean;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUNLER = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const GUN_UZUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const KURAL_NOTU =
  "e-Defter: aylık tercih için gelir vergisi mükelleflerinde ayın 10'u, kurumlar/diğer mükelleflerde ayın 14'ü · KDV2: ayın 25'i · MUHSGK/Damga/Konaklama: ayın 26'sı · KDV1: ayın 28'i · Geçici Vergi: Şubat/Mayıs/Ağustos/Kasım 17'si · Ay sonu: Turizm Payı";

function monthName(date: Date) {
  return date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}
function previousPeriodLabel(date: Date, monthOffset: number) {
  return monthName(new Date(date.getFullYear(), date.getMonth() - monthOffset, 1));
}
function quarterlyLedgerPeriodForDueDate(date: Date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if ((month === 6 || month === 9 || month === 12) && (day === 10 || day === 14)) {
    if (month === 6) return 'Ocak-Şubat-Mart';
    if (month === 9) return 'Nisan-Mayıs-Haziran';
    return 'Temmuz-Ağustos-Eylül';
  }
  if (month === 4 && day === 10) return 'Ekim-Kasım-Aralık';
  if (month === 5 && day === 14) return 'Ekim-Kasım-Aralık';
  return null;
}

/** Belirli bir günün mali son tarihleri (kurallar eski BuHaftaTakvim ile birebir). */
function gununSonTarihleri(date: Date): Omit<SonTarih, 'date' | 'gunFark'>[] {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const isLastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() === day;
  const out: Omit<SonTarih, 'date' | 'gunFark'>[] = [];

  if (day === 25) out.push({ title: "KDV2 Tevkifat Beyannamesi (2 No'lu KDV)", subtitle: "Tevkifata tâbi işlemler · 164 Sıra No'lu VUK Sirküleri · izleyen ayın 25'i", icon: FileText, kind: 'vat' });
  if (day === 26) {
    out.push({ title: 'Muhtasar ve Prim Hizmet Beyannamesi (MUHSGK)', subtitle: 'Bir önceki ay dönemi — birleşik muhtasar + SGK', icon: FileText, kind: 'payroll' });
    out.push({ title: 'Damga Vergisi Beyannamesi', subtitle: 'Önceki ay damga vergisi beyan ve ödeme', icon: FileCheck, kind: 'stamp' });
    out.push({ title: 'Konaklama Vergisi Beyannamesi', subtitle: 'Otel/pansiyon/tatil köyü · önceki ay · %2', icon: Bell, kind: 'tourism' });
  }
  if (day === 28) out.push({ title: 'KDV Beyannamesi (KDV1)', subtitle: "Önceki ay KDV beyan ve ödeme · izleyen ayın 28'i", icon: Receipt, kind: 'vat' });
  if (isLastDay) out.push({ title: 'Turizm Payı Beyannamesi', subtitle: 'Konaklama, yat, seyahat acentesi · izleyen ayın SON GÜNÜ (23:59)', icon: Bell, kind: 'tourism' });
  if (day === 10 || day === 14) {
    const grup = day === 10 ? 'Gelir vergisi mükellefleri' : 'Kurumlar/diğer mükellefler';
    out.push({ title: 'e-Defter Berat Yükleme (Aylık Tercih)', subtitle: `${previousPeriodLabel(date, 4)} dönemi · ${grup} · ayın ${day}. günü sonu`, icon: Bookmark, kind: 'ledger' });
    const ceyrek = quarterlyLedgerPeriodForDueDate(date);
    if (ceyrek) out.push({ title: 'e-Defter Berat Yükleme (Geçici Vergi Dönemi)', subtitle: `${ceyrek} dönemi · ${grup} · ayın ${day}. günü sonu`, icon: Bookmark, kind: 'ledger' });
  }
  if (day === 17 && [2, 5, 8, 11].includes(month)) out.push({ title: 'Geçici Vergi Beyannamesi', subtitle: '3 aylık dönem geçici vergi', icon: FileText, kind: 'income' });
  if (month === 3 && day === 31) out.push({ title: 'Yıllık Gelir Vergisi Beyannamesi', subtitle: 'Önceki yıl gelirleri · Mart sonu', icon: FileText, kind: 'income' });
  if (month === 4 && day === 30) out.push({ title: 'Yıllık Kurumlar Vergisi Beyannamesi', subtitle: 'Önceki takvim yılı kurumlar vergisi · 1-30 Nisan', icon: FileText, kind: 'income' });
  return out;
}

/** Kalan güne göre 6 kademe: geçmiş gri · 0–1 kırmızı · 2–3 turuncu · 4–5 kehribar · 6–7 deniz yeşili · 8+ yeşil. */
function aciliyet(gunFark: number): 'past' | 'immediate' | 'soon' | 'near' | 'week' | 'planned' {
  if (gunFark < 0) return 'past';
  if (gunFark <= 1) return 'immediate';
  if (gunFark <= 3) return 'soon';
  if (gunFark <= 5) return 'near';
  if (gunFark <= 7) return 'week';
  return 'planned';
}
function kalanEtiket(gunFark: number) {
  if (gunFark < 0) return `${Math.abs(gunFark)} gün geçti`;
  if (gunFark === 0) return 'Bugün';
  if (gunFark === 1) return 'Yarın';
  return `${gunFark} gün`;
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Tasks API'den gelen aktif görevleri tarih→başlık[] eşlemesine çevirir. */
function gorevleriGuneGoreAyir(tasks: TaskItem[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const t of tasks) {
    const status = String((t as any).status || '').toUpperCase();
    if ((t as any).done || (t as any).isCompleted || status === 'DONE' || status === 'CANCELLED') continue;
    const d = new Date(t.dueDate);
    if (isNaN(d.getTime())) continue;
    const key = dateKey(d);
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(t.title);
  }
  return m;
}

type Gun = { n: number; date: Date; key: string; gunFark: number; sonTarihler: SonTarih[]; notlar: string[] };

export function MaliTakvim() {
  const bugun = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const yil = bugun.getFullYear();
  const ay = bugun.getMonth();
  const gunSayisi = new Date(yil, ay + 1, 0).getDate();
  const ilkGunKaydirma = (new Date(yil, ay, 1).getDay() + 6) % 7; // Pazartesi = 0

  const { data: tasksData } = useQuery<{ items: TaskItem[] } | TaskItem[]>({
    queryKey: ['takvim-gorevler'],
    queryFn: () => api.get('/tasks', { params: { isTemplate: 'false', limit: 200 } }).then((r) => r.data).catch(() => ({ items: [] })),
    staleTime: 60 * 1000,
  });
  const tasks: TaskItem[] = Array.isArray(tasksData) ? tasksData : ((tasksData as any)?.items || []);
  const notMap = useMemo(() => gorevleriGuneGoreAyir(tasks), [tasks]);

  const gunler: Gun[] = useMemo(() => {
    return Array.from({ length: gunSayisi }, (_, i) => {
      const date = new Date(yil, ay, i + 1);
      const gunFark = Math.round((date.getTime() - bugun.getTime()) / 86400000);
      const key = dateKey(date);
      return { n: i + 1, date, key, gunFark, sonTarihler: gununSonTarihleri(date).map((s) => ({ ...s, date, gunFark })), notlar: notMap.get(key) || [] };
    });
  }, [yil, ay, gunSayisi, bugun, notMap]);

  const [seciliGun, setSeciliGun] = useState<number | null>(null);
  const kalanGunler = gunler.filter((g) => g.gunFark >= 0 && g.sonTarihler.length > 0);
  const gruplar = seciliGun == null ? kalanGunler : gunler.filter((g) => g.n === seciliGun && (g.sonTarihler.length > 0 || g.notlar.length > 0));
  const kalanSonTarih = kalanGunler.reduce((t, g) => t + g.sonTarihler.length, 0);
  const yakin = kalanGunler.filter((g) => g.gunFark <= 3).reduce((t, g) => t + g.sonTarihler.length, 0);
  const notSayisi = gunler.filter((g) => g.gunFark >= 0).reduce((t, g) => t + g.notlar.length, 0);
  const secili = seciliGun != null ? gunler.find((g) => g.n === seciliGun) : undefined;

  // Sol sütun: sıradaki son tarih, ay özeti ve gelecek ayın ilk son tarihleri (ızgaranın altı boş kalmasın)
  const siradaki = kalanGunler[0];
  const ayToplam = gunler.reduce((t, g) => t + g.sonTarihler.length, 0);
  const gecen = ayToplam - kalanSonTarih;
  const enYogun = gunler.reduce<Gun | undefined>((en, g) => (g.sonTarihler.length > (en?.sonTarihler.length || 0) ? g : en), undefined);
  const gelecekAy = useMemo(() => {
    const ilk = new Date(yil, ay + 1, 1);
    const son = new Date(yil, ay + 2, 0).getDate();
    const out: Array<{ date: Date; title: string; kind: SonTarih['kind']; icon: any }> = [];
    for (let d = 1; d <= son && out.length < 3; d++) {
      const date = new Date(ilk.getFullYear(), ilk.getMonth(), d);
      for (const st of gununSonTarihleri(date)) {
        if (out.length < 3) out.push({ date, title: st.title, kind: st.kind, icon: st.icon });
      }
    }
    return { ayAdi: AYLAR[ilk.getMonth()], liste: out };
  }, [yil, ay]);

  return (
    <section className="mt" data-calendar aria-label="Bu ay mali takvim">
      <header className="mt-band">
        <span className="mt-band-icon" aria-hidden="true"><CalendarDays size={17} /></span>
        <div className="mt-band-text">
          <p>MALİ TAKVİM</p>
          <h3>Bu Ay Mali Takvim</h3>
        </div>
        <span className="mt-note" title={KURAL_NOTU}>{kalanSonTarih} son tarih kaldı{yakin > 0 ? ` · ${yakin} yakın` : ''}{notSayisi > 0 ? ` · ${notSayisi} not` : ''}</span>
        <div className="mt-band-chips">
          <span className="mt-chip"><CalendarDays size={12} aria-hidden="true" /> {AYLAR[ay]} {yil}</span>
        </div>
      </header>

      <div className="mt-body">
        {/* Sol: ay ızgarası */}
        <aside className="mt-side">
        <div className="mt-grid" aria-label={`${AYLAR[ay]} ${yil} takvimi`}>
          <div className="mt-grid-head">
            <span className="mt-grid-month">{AYLAR[ay]} <em>{yil}</em></span>
            <span className="mt-grid-today">Bugün · {bugun.getDate()} {AYLAR[ay]}</span>
          </div>
          <div className="mt-progress" title={`Ayın ${bugun.getDate()}. günü · ${gunSayisi - bugun.getDate()} gün kaldı`} aria-hidden="true">
            <i style={{ width: `${Math.round((bugun.getDate() / gunSayisi) * 100)}%` }} />
          </div>
          <div className="mt-weekdays" aria-hidden="true">
            {GUNLER.map((g) => <span key={g}>{g}</span>)}
          </div>
          <div className="mt-days">
            {Array.from({ length: ilkGunKaydirma }, (_, i) => <span key={`b${i}`} className="mt-day-blank" aria-hidden="true" />)}
            {gunler.map((g) => {
              const varSonTarih = g.sonTarihler.length > 0;
              const varNot = g.notlar.length > 0;
              const tiklanir = g.gunFark >= 0 && (varSonTarih || varNot);
              const ipucu = [...g.sonTarihler.map((s) => s.title), ...g.notlar.map((n) => `Not: ${n}`)].join('\n');
              return (
                <button
                  key={g.key}
                  type="button"
                  className="mt-day"
                  data-urgency={varSonTarih ? aciliyet(g.gunFark) : undefined}
                  data-today={g.gunFark === 0 ? 'true' : undefined}
                  data-past={g.gunFark < 0 ? 'true' : undefined}
                  data-deadline={varSonTarih ? 'true' : undefined}
                  data-note={varNot ? 'true' : undefined}
                  data-selected={seciliGun === g.n ? 'true' : undefined}
                  disabled={!tiklanir}
                  title={ipucu || undefined}
                  aria-label={`${g.n} ${AYLAR[ay]}${ipucu ? ` — ${ipucu.replace(/\n/g, ', ')}` : ''}`}
                  onClick={() => setSeciliGun((s) => (s === g.n ? null : g.n))}
                >
                  <span className="mt-day-num">{g.n}</span>
                  <span className="mt-day-marks" aria-hidden="true">
                    {g.sonTarihler.slice(0, 3).map((_, i) => <i key={i} className="mt-day-mark" data-kind="deadline" />)}
                    {varNot && <i className="mt-day-mark" data-kind="note" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-legend" aria-hidden="true">
            <span><i data-kind="today" /> Bugün</span>
            <span><i data-kind="deadline" /> Son tarih</span>
            <span><i data-kind="note" /> Not</span>
            <span><i data-kind="past" /> Geçti</span>
          </div>
        </div>

        {/* Sıradaki son tarih */}
        {siradaki ? (
          <button type="button" className="mt-next" data-urgency={aciliyet(siradaki.gunFark)} onClick={() => setSeciliGun((s) => (s === siradaki.n ? null : siradaki.n))} title="Zaman çizgisinde yalnız bu günü göster">
            <span className="mt-next-label"><Timer size={13} /> Sıradaki son tarih</span>
            <span className="mt-next-row">
              <b className="mt-next-days">{kalanEtiket(siradaki.gunFark)}</b>
              <span className="mt-next-date">{siradaki.n} {AYLAR[ay]} · {GUN_UZUN[siradaki.date.getDay()]}</span>
            </span>
            <span className="mt-next-titles">
              {siradaki.sonTarihler.slice(0, 3).map((st, i) => <span key={i}>{st.title}</span>)}
              {siradaki.sonTarihler.length > 3 && <span>+{siradaki.sonTarihler.length - 3} son tarih daha</span>}
            </span>
          </button>
        ) : (
          <div className="mt-next" data-urgency="past">
            <span className="mt-next-label"><Timer size={13} /> Sıradaki son tarih</span>
            <span className="mt-next-row"><b className="mt-next-days">—</b><span className="mt-next-date">Bu ay kalan son tarih yok</span></span>
          </div>
        )}

        {/* Ay özeti + gelecek ayın ilk son tarihleri (tek kart) */}
        <div className="mt-ozet">
          <span className="mt-ozet-label">{AYLAR[ay]} özeti</span>
          <dl className="mt-stats">
            <div><dt>Toplam</dt><dd>{ayToplam} <small>son tarih</small></dd></div>
            <div><dt>Geçti · Kaldı</dt><dd>{gecen} · <b>{kalanSonTarih}</b></dd></div>
            <div><dt>En yoğun gün</dt><dd>{enYogun ? <>{enYogun.n} {AYLAR[ay]} <small>({enYogun.sonTarihler.length})</small></> : '—'}</dd></div>
            <div><dt>Notlar</dt><dd>{notSayisi} <small>hatırlatma</small></dd></div>
          </dl>
        {gelecekAy.liste.length > 0 && (
          <div className="mt-upcoming">
            <span className="mt-upcoming-label"><ArrowRight size={13} /> {gelecekAy.ayAdi} başı</span>
            <ul>
              {gelecekAy.liste.map((u, i) => {
                const Icon = u.icon;
                return (
                  <li key={i} data-kind={u.kind}>
                    <span className="mt-upcoming-icon" aria-hidden="true"><Icon size={13} /></span>
                    <span className="mt-upcoming-text"><b>{u.date.getDate()} {gelecekAy.ayAdi}</b> · {u.title}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        </div>
        </aside>

        {/* Sağ: zaman çizgisi */}
        <div className="mt-timeline">
          {secili && (
            <div className="mt-filter">
              <span>Yalnız <b>{secili.n} {AYLAR[ay]}</b> gösteriliyor</span>
              <button type="button" onClick={() => setSeciliGun(null)}><X size={12} /> Tümünü göster</button>
            </div>
          )}
          {gruplar.length === 0 ? (
            <div className="mt-empty">
              {seciliGun != null ? 'Seçili günde son tarih ya da not yok.' : 'Kalan günlerde beyanname, bildirim veya e-Defter son tarihi yok.'}
            </div>
          ) : (
            <ol className="mt-groups">
              {gruplar.map((g) => (
                <li key={g.key} className="mt-group" data-urgency={g.sonTarihler.length > 0 ? aciliyet(g.gunFark) : 'note'}>
                  <div className="mt-leaf" aria-hidden="true">
                    <b>{g.n}</b>
                    <small>{AYLAR[ay].slice(0, 3)}</small>
                  </div>
                  <div className="mt-group-body">
                  <div className="mt-group-head">
                    <span className="mt-group-date">
                      {GUN_UZUN[g.date.getDay()]} <em>· {g.n} {AYLAR[ay]}</em>
                    </span>
                    <span className="mt-group-remaining">{kalanEtiket(g.gunFark)}</span>
                  </div>
                  <ul className="mt-items">
                    {g.sonTarihler.map((s, i) => {
                      const Icon = s.icon;
                      return (
                        <li key={i} className="mt-item" data-kind={s.kind}>
                          <span className="mt-item-icon" aria-hidden="true"><Icon size={15} /></span>
                          <span className="mt-item-text">
                            <span className="mt-item-title">{s.title}</span>
                            <span className="mt-item-sub">{s.subtitle}</span>
                          </span>
                        </li>
                      );
                    })}
                    {g.notlar.length > 0 && (
                      <li className="mt-item mt-item-notes" data-kind="note" title={g.notlar.join(String.fromCharCode(10))}>
                        <span className="mt-item-icon" aria-hidden="true"><Bookmark size={15} /></span>
                        <span className="mt-notes">
                          <span className="mt-notes-label">{g.notlar.length} not</span>
                          {g.notlar.slice(0, 3).map((n, i) => <span key={i} className="mt-note-chip">{n}</span>)}
                          {g.notlar.length > 3 && <span className="mt-note-chip" data-more="true">+{g.notlar.length - 3}</span>}
                        </span>
                      </li>
                    )}
                  </ul>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
