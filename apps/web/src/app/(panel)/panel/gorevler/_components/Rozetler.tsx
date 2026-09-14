'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Building2, MessageSquare, Pause, Play, Repeat, Users } from 'lucide-react';
import {
  KAYNAK_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  kategoriEtiketi,
  kategoriRengi,
  taxpayerName,
  type Task,
  type TaskKaynak,
  type TaskPriority,
} from '@/lib/tasks';
import { EKIP_RENK, GOLD, IKINCIL, SONUK, kisaTarih } from './ortak';

/*
 * SAKİN PALET (2026-09-14, Muzaffer Bey'in "karma karışık" geri bildirimi):
 * koyu zemin + altın vurgu (yalnız seçili/aktif/önemli) + nötr griler + gecikme için TEK yumuşak kırmızı.
 * Satır içinde dolu (boyalı) rozet YOK; kategori/kaynak/durum ince gri çip; öncelik düz yazı.
 */
/** Tablo/kart kenarlığı — .14 göz yoruyordu, .10'a indi. */
export const KENAR_NOTR = 'rgba(255,255,255,0.10)';
/** Gecikme / tehlike için tek yumuşak kırmızı (kalın değil). */
export const GECIKME_RENK = '#e0868f';
/** Soluk altın — "Yüksek" öncelik, tablo başlığı yazısı. */
export const ALTIN_SOLUK = 'rgba(212,184,118,0.85)';
/** Nötr çip: ince gri kenar, gri yazı, dolgu yok. */
export const CIP_NOTR: CSSProperties = { background: 'rgba(255,255,255,0.03)', border: `1px solid ${KENAR_NOTR}`, color: 'rgba(250,250,249,0.7)' };
/** Nötr ikon/eylem düğmesi zemini (hover'da işlev rengi belirir — IkonDugme). */
export const DUGME_NOTR: CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${KENAR_NOTR}`, color: 'rgba(250,250,249,0.6)' };

const TEMEL = 'inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-medium leading-4';

/** Kategori — ince gri çip; tek küçük renkli nokta kalır (o kadar). Eski değerler (KDV/MIHSAP/…) etiketiyle gösterilir. */
export function KategoriEtiketi({ value, className = '' }: { value?: string | null; className?: string }) {
  if (!value) return <span className="text-[11px]" style={{ color: SONUK }}>—</span>;
  return (
    <span className={`${TEMEL} ${className}`} style={CIP_NOTR} title={`Kategori: ${kategoriEtiketi(value)}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: kategoriRengi(value), opacity: 0.85 }} />
      {kategoriEtiketi(value)}
    </span>
  );
}

/** Öncelik — rozet değil düz yazı. ACİL: yumuşak kırmızı + nokta; Yüksek: soluk altın; Orta/Düşük: soluk gri. */
export function OncelikEtiketi({ value, className = '' }: { value: TaskPriority; className?: string }) {
  const acil = value === 'URGENT';
  const renk = acil ? GECIKME_RENK : value === 'HIGH' ? ALTIN_SOLUK : IKINCIL;
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px] leading-4 ${acil ? 'font-medium' : 'font-normal'} ${className}`} style={{ color: renk }} title={`Öncelik: ${PRIORITY_LABEL[value]}`}>
      {acil && <span className="h-1.5 w-1.5 rounded-full" style={{ background: GECIKME_RENK }} />}
      {PRIORITY_LABEL[value]}
    </span>
  );
}

/** Kaynak — Elle (MANUEL) HİÇ gösterilmez; Banka / Ekip / Takvim / AI / WhatsApp gri ince çip (renk dolgusu yok). */
export function KaynakRozeti({ value, className = '' }: { value?: TaskKaynak | string | null; className?: string }) {
  const k = (value || 'MANUEL') as TaskKaynak;
  if (k === 'MANUEL') return null;
  const ad = KAYNAK_LABEL[k] || String(value);
  return (
    <span className={`${TEMEL} ${className}`} style={CIP_NOTR} title={`Kaynak: ${ad}`}>
      {k === 'EKIP' && <Users size={9} />}
      {ad}
    </span>
  );
}

/** Mükellef çipi — mükellef kartına bağlantı (nötr). */
export function MukellefCipi({ taxpayer, id, ad, className = '' }: { taxpayer?: Task['taxpayer'] | null; id?: string | null; ad?: string | null; className?: string }) {
  const isim = ad || taxpayerName(taxpayer);
  const hedef = id || taxpayer?.id;
  if (!isim) return null;
  const ic = (
    <>
      <Building2 size={10} />
      <span className="max-w-[220px] truncate">{isim}</span>
    </>
  );
  const stil: CSSProperties = { ...CIP_NOTR, color: 'rgba(250,250,249,0.78)' };
  if (!hedef) return <span className={`${TEMEL} ${className}`} style={stil}>{ic}</span>;
  return (
    <Link href={`/panel/mukellefler/${hedef}`} className={`${TEMEL} transition hover:brightness-125 ${className}`} style={stil} title={`Mükellef kartını aç: ${isim}`} onClick={(e) => e.stopPropagation()}>
      {ic}
    </Link>
  );
}

/** Durum — yalnız Açık dışındakiler gösterilir (Sürüyor / Ertelendi → 17 Eyl / Bitti / İptal); gri çip. */
export function DurumRozeti({ task, className = '' }: { task: Task; className?: string }) {
  if (task.status === 'OPEN') return null;
  return (
    <span className={`${TEMEL} ${className}`} style={CIP_NOTR} title={`Durum: ${STATUS_LABEL[task.status]}`}>
      {task.status === 'IN_PROGRESS' && <Play size={9} />}
      {task.status === 'SNOOZED' && <Pause size={9} />}
      {STATUS_LABEL[task.status]}
      {task.status === 'SNOOZED' && task.snoozedUntil ? ` → ${kisaTarih(task.snoozedUntil)}` : ''}
    </span>
  );
}

/** Ekip isteği çipi — "Sizden istenen": gri çip + küçük gök mavisi nokta (sky yalnız burada ve satır başı noktada). */
export function EkipIstekCipi({ className = '' }: { className?: string }) {
  return (
    <span className={`${TEMEL} ${className}`} style={CIP_NOTR} title="Ekip ajanının sizden istediği iş">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: EKIP_RENK, opacity: 0.85 }} />
      Sizden istenen
    </span>
  );
}

/** Not sayısı. */
export function NotSayisi({ n, className = '' }: { n?: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1 text-[10.5px] font-medium ${className}`} style={{ color: IKINCIL }} title={`${n} not`}>
      <MessageSquare size={10} /> {n}
    </span>
  );
}

/** Tekrarlı görev ikonu (gri). */
export function TekrarIkonu({ task, className = '' }: { task: Task; className?: string }) {
  if (!task.recurrence || task.recurrence.type === 'NONE') return null;
  const ad: Record<string, string> = { DAILY: 'her gün', WEEKLY: 'haftalık', MONTHLY: 'aylık', YEARLY: 'yıllık', CUSTOM: 'özel' };
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1 text-[10.5px] font-medium ${className}`} style={{ color: IKINCIL }} title={`Tekrar: ${ad[task.recurrence.type] || task.recurrence.type}`}>
      <Repeat size={10} /> {ad[task.recurrence.type] || 'tekrar'}
    </span>
  );
}

/** Sabitlenmiş görev vurgusu için tek altın ton (pin ikonu). */
export const SABIT_RENK = GOLD;
