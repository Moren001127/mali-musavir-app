'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Bookmark, CalendarDays, FileCheck, FileText, Receipt, Timer, X } from 'lucide-react';
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

const KISA_AD: Record<string, string> = {
  "KDV2 Tevkifat Beyannamesi (2 No'lu KDV)": 'KDV2 Tevkifat',
  'Muhtasar ve Prim Hizmet Beyannamesi (MUHSGK)': 'MUHSGK',
  'Damga Vergisi Beyannamesi': 'Damga Vergisi',
  'Konaklama Vergisi Beyannamesi': 'Konaklama Vergisi',
  'KDV Beyannamesi (KDV1)': 'KDV1',
  'Turizm Payı Beyannamesi': 'Turizm Payı',
  'e-Defter Berat Yükleme (Aylık Tercih)': 'e-Defter Berat (Aylık)',
  'e-Defter Berat Yükleme (Geçici Vergi Dönemi)': 'e-Defter Berat (Geçici)',
  'Geçici Vergi Beyannamesi': 'Geçici Vergi',
  'Yıllık Gelir Vergisi Beyannamesi': 'Yıllık Gelir Vergisi',
  'Yıllık Kurumlar Vergisi Beyannamesi': 'Yıllık Kurumlar Vergisi',
};
const kisa = (t: string) => KISA_AD[t] || t;

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
  const sonBosluk = (7 - ((ilkGunKaydirma + gunSayisi) % 7)) % 7;

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
  const kalanSonTarih = kalanGunler.reduce((t, g) => t + g.sonTarihler.length, 0);
  const notSayisi = gunler.filter((g) => g.gunFark >= 0).reduce((t, g) => t + g.notlar.length, 0);
  const siradaki = kalanGunler[0];
  const secili = seciliGun != null ? gunler.find((g) => g.n === seciliGun) : undefined;

  return (
    <section className="mt" data-calendar aria-label="Bu ay mali takvim">
      <header className="mt-head">
        <span className="mt-icon" aria-hidden="true"><CalendarDays size={17} /></span>
        <div className="mt-heading">
          <p>MALİ TAKVİM</p>
          <h3>{AYLAR[ay]} {yil}</h3>
        </div>
        <div className="mt-ozet" title={KURAL_NOTU}>
          {siradaki ? (
            <button type="button" className="mt-ozet-next" data-urgency={aciliyet(siradaki.gunFark)} onClick={() => setSeciliGun((s) => (s === siradaki.n ? null : siradaki.n))} title="Günü göster">
              <Timer size={13} aria-hidden="true" />
              <span><b>{kalanEtiket(siradaki.gunFark)}</b> · {siradaki.n} {AYLAR[ay]} · {kisa(siradaki.sonTarihler[0].title)}{siradaki.sonTarihler.length > 1 ? ` +${siradaki.sonTarihler.length - 1}` : ''}</span>
            </button>
          ) : (
            <span className="mt-ozet-item">Bu ay kalan son tarih yok</span>
          )}
          <span className="mt-ozet-item"><b>{kalanSonTarih}</b> son tarih kaldı</span>
          {notSayisi > 0 && <span className="mt-ozet-item"><b>{notSayisi}</b> not</span>}
        </div>
      </header>

      <div className="mt-weekdays" aria-hidden="true">
        {GUNLER.map((g, i) => <span key={g} data-weekend={i >= 5 ? 'true' : undefined}>{g}</span>)}
      </div>
      <div className="mt-month" role="grid" aria-label={`${AYLAR[ay]} ${yil} takvimi`}>
        {Array.from({ length: ilkGunKaydirma }, (_, i) => <span key={`b${i}`} className="mt-cell mt-cell-blank" aria-hidden="true" />)}
        {gunler.map((g) => {
          const varIcerik = g.sonTarihler.length > 0 || g.notlar.length > 0;
          const haftaSonu = g.date.getDay() === 0 || g.date.getDay() === 6;
          const cipler = [
            ...g.sonTarihler.map((st) => ({ tur: st.kind as string, metin: kisa(st.title), tam: st.title })),
            ...g.notlar.map((n) => ({ tur: 'note', metin: n, tam: `Not: ${n}` })),
          ];
          const gorunen = cipler.slice(0, 3);
          const fazla = cipler.length - gorunen.length;
          const Etiket: any = varIcerik ? 'button' : 'div';
          return (
            <Etiket
              key={g.key}
              className="mt-cell"
              role="gridcell"
              data-today={g.gunFark === 0 ? 'true' : undefined}
              data-past={g.gunFark < 0 ? 'true' : undefined}
              data-weekend={haftaSonu ? 'true' : undefined}
              data-has={varIcerik ? 'true' : undefined}
              data-selected={seciliGun === g.n ? 'true' : undefined}
              data-urgency={g.sonTarihler.length > 0 ? aciliyet(g.gunFark) : undefined}
              {...(varIcerik ? { type: 'button', onClick: () => setSeciliGun((s) => (s === g.n ? null : g.n)), title: cipler.map((c) => c.tam).join(String.fromCharCode(10)) } : {})}
            >
              <span className="mt-cell-top">
                <b className="mt-cell-num">{g.n}</b>
                {g.sonTarihler.length > 0 && g.gunFark >= 0 && <em className="mt-cell-left">{kalanEtiket(g.gunFark)}</em>}
              </span>
              {gorunen.length > 0 && (
                <span className="mt-chips">
                  {gorunen.map((c, i) => <i key={i} className="mt-chipx" data-kind={c.tur}><span>{c.metin}</span></i>)}
                  {fazla > 0 && <i className="mt-chipx" data-kind="more">+{fazla}</i>}
                </span>
              )}
            </Etiket>
          );
        })}
        {Array.from({ length: sonBosluk }, (_, i) => <span key={`e${i}`} className="mt-cell mt-cell-blank" aria-hidden="true" />)}
      </div>

      <div className="mt-foot">
        <ul className="mt-legend" aria-label="Renk açıklaması">
          <li><i data-kind="vat" /> KDV</li>
          <li><i data-kind="payroll" /> Muhtasar / SGK</li>
          <li><i data-kind="stamp" /> Damga</li>
          <li><i data-kind="tourism" /> Konaklama / Turizm</li>
          <li><i data-kind="ledger" /> e-Defter</li>
          <li><i data-kind="income" /> Gelir / Kurumlar / Geçici</li>
          <li><i data-kind="note" /> Not</li>
        </ul>
      </div>

      {secili && (
        <div className="mt-detail" data-urgency={secili.sonTarihler.length > 0 ? aciliyet(secili.gunFark) : 'note'}>
          <div className="mt-detail-head">
            <span className="mt-detail-date"><b>{secili.n} {AYLAR[ay]}</b> · {GUN_UZUN[secili.date.getDay()]}{secili.sonTarihler.length > 0 ? <em> · {kalanEtiket(secili.gunFark)}</em> : null}</span>
            <button type="button" className="mt-detail-close" onClick={() => setSeciliGun(null)} aria-label="Kapat"><X size={13} /> Kapat</button>
          </div>
          <ul className="mt-detail-list">
            {secili.sonTarihler.map((st, i) => {
              const Icon = st.icon;
              return (
                <li key={i} data-kind={st.kind}>
                  <span className="mt-detail-icon" aria-hidden="true"><Icon size={14} /></span>
                  <span className="mt-detail-text"><b>{st.title}</b><small>{st.subtitle}</small></span>
                </li>
              );
            })}
            {secili.notlar.map((n, i) => (
              <li key={`n${i}`} data-kind="note">
                <span className="mt-detail-icon" aria-hidden="true"><Bookmark size={14} /></span>
                <span className="mt-detail-text"><b>{n}</b><small>Görevler &amp; Notlar'dan hatırlatma</small></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
