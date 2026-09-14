'use client';

import Link from 'next/link';
import { Building2, MessageSquare, Pause, Play, Repeat, Users } from 'lucide-react';
import {
  KAYNAK_COLOR,
  KAYNAK_LABEL,
  PRIORITY_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  kategoriEtiketi,
  kategoriRengi,
  taxpayerName,
  type Task,
  type TaskKaynak,
  type TaskPriority,
} from '@/lib/tasks';
import { IKINCIL, MOR, etiketStili, kisaTarih, oncelikRengi } from './ortak';

const TEMEL = 'inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-bold leading-4';

/** Kategori — renkli nokta + etiket. Eski değerler (KDV/MIHSAP/…) etiketiyle gösterilir. */
export function KategoriEtiketi({ value, className = '' }: { value?: string | null; className?: string }) {
  if (!value) return <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.3)' }}>—</span>;
  const renk = kategoriRengi(value);
  return (
    <span className={`${TEMEL} ${className}`} style={etiketStili(renk)} title={`Kategori: ${kategoriEtiketi(value)}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: renk }} />
      {kategoriEtiketi(value)}
    </span>
  );
}

/** Öncelik — Düşük/Orta/Yüksek/ACİL; ACİL dolu kırmızı. */
export function OncelikEtiketi({ value, className = '' }: { value: TaskPriority; className?: string }) {
  const renk = oncelikRengi(value);
  return (
    <span className={`${TEMEL} uppercase tracking-wide ${className}`} style={etiketStili(renk, value === 'URGENT')} title={`Öncelik: ${PRIORITY_LABEL[value]}`}>
      {PRIORITY_LABEL[value]}
    </span>
  );
}

/** Kaynak — Elle / Banka / Ekip / Takvim / AI / WhatsApp. */
export function KaynakRozeti({ value, className = '' }: { value?: TaskKaynak | string | null; className?: string }) {
  const k = (value || 'MANUEL') as TaskKaynak;
  const renk = KAYNAK_COLOR[k] || KAYNAK_COLOR.MANUEL;
  const ad = KAYNAK_LABEL[k] || String(value);
  return (
    <span className={`${TEMEL} ${className}`} style={{ background: `${renk}14`, color: renk, border: `1px solid ${renk}33` }} title={`Kaynak: ${ad}`}>
      {k === 'EKIP' && <Users size={9} />}
      {ad}
    </span>
  );
}

/** Mükellef çipi — mükellef kartına bağlantı. */
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
  const stil = { background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.78)', border: '1px solid rgba(255,255,255,0.10)' };
  if (!hedef) return <span className={`${TEMEL} ${className}`} style={stil}>{ic}</span>;
  return (
    <Link href={`/panel/mukellefler/${hedef}`} className={`${TEMEL} transition hover:brightness-125 ${className}`} style={stil} title={`Mükellef kartını aç: ${isim}`} onClick={(e) => e.stopPropagation()}>
      {ic}
    </Link>
  );
}

/** Durum — yalnız Açık dışındakiler gösterilir (Sürüyor / Ertelendi → 17 Eyl / Bitti / İptal). */
export function DurumRozeti({ task, className = '' }: { task: Task; className?: string }) {
  if (task.status === 'OPEN') return null;
  const renk = STATUS_COLOR[task.status] || IKINCIL;
  return (
    <span className={`${TEMEL} ${className}`} style={etiketStili(renk)} title={`Durum: ${STATUS_LABEL[task.status]}`}>
      {task.status === 'IN_PROGRESS' && <Play size={9} />}
      {task.status === 'SNOOZED' && <Pause size={9} />}
      {STATUS_LABEL[task.status]}
      {task.status === 'SNOOZED' && task.snoozedUntil ? ` → ${kisaTarih(task.snoozedUntil)}` : ''}
    </span>
  );
}

/** Not sayısı. */
export function NotSayisi({ n, className = '' }: { n?: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1 text-[10.5px] font-semibold ${className}`} style={{ color: 'rgba(250,250,249,0.6)' }} title={`${n} not`}>
      <MessageSquare size={10} /> {n}
    </span>
  );
}

/** Tekrarlı görev ikonu. */
export function TekrarIkonu({ task, className = '' }: { task: Task; className?: string }) {
  if (!task.recurrence || task.recurrence.type === 'NONE') return null;
  const ad: Record<string, string> = { DAILY: 'her gün', WEEKLY: 'haftalık', MONTHLY: 'aylık', YEARLY: 'yıllık', CUSTOM: 'özel' };
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1 text-[10.5px] font-semibold ${className}`} style={{ color: MOR }} title={`Tekrar: ${ad[task.recurrence.type] || task.recurrence.type}`}>
      <Repeat size={10} /> {ad[task.recurrence.type] || 'tekrar'}
    </span>
  );
}
