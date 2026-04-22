'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Users, FileText, AlertTriangle, ArrowRight, Receipt, FileCheck, Plus, Bot, FileInput, Mailbox, Calculator, BookOpen, Printer, CheckCircle2, X as IconX, Check, Download, FileCheck2, Search as SearchIcon, Settings } from 'lucide-react';
import { beyannameTakipApi, BEYAN_ETIKETLER, OzetRow, BeyanTipi } from '@/lib/beyanname-takip';
import Link from 'next/link';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import MorenAiChat, { MorenAiButton, MorenAiFab } from '@/components/MorenAiChat';

const GOLD = '#d4b876';

type Task = {
  id: string;
  title: string;
  dueDate: string;
  note?: string;
  done: boolean;
  createdAt: string;
  // İleride aktif edilecek hatırlatma kanalları
  whatsappPhone?: string; // "05xx xxx xx xx" — WhatsApp hatırlatma için
  emailAddr?: string;     // E-posta hatırlatma için
  // Bildirim kontrolü
  lastReminderAt?: string; // Son uyarının zamanı (sürekli bildirim tekrarı için)
  reminderDismissed?: boolean; // Kullanıcı "Anladım" derse bu oturumda bir daha uyarma
};
const TKEY = 'moren-dashboard-tasks';
const loadT = (): Task[] => { if (typeof window === 'undefined') return []; try { const r = localStorage.getItem(TKEY); return r ? JSON.parse(r) : []; } catch { return []; } };
const saveT = (t: Task[]) => { if (typeof window !== 'undefined') localStorage.setItem(TKEY, JSON.stringify(t)); };
const fmtDue = (iso: string): { label: string; kind: 'danger' | 'warn' | 'gold' | 'ok' } => {
  const t = new Date(); t.setHours(0,0,0,0);
  const d = new Date(iso); d.setHours(0,0,0,0);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return { label: 'BUGÜN', kind: 'danger' };
  if (diff === 1) return { label: 'Yarın', kind: 'gold' };
  if (diff < 0) return { label: `${-diff}g geçti`, kind: 'danger' };
  return { label: `${diff} gün`, kind: 'warn' };
};

type FeedKind = 'ok' | 'warn' | 'err' | 'info';
function agentEventToFeed(ev: any) {
  const a = (ev.agent || '').toUpperCase(), s = (ev.status || '').toUpperCase();
  let kind: FeedKind = 'info';
  if (['OK','KAYDET','BASARILI','SUCCESS','ONAYLANDI','ONAY','DONE','TAMAMLANDI'].includes(s)) kind = 'ok';
  else if (['ATLA','SKIP','WARN','WARNING','ATLANDI'].includes(s)) kind = 'warn';
  else if (['HATA','ERROR','FAIL','FAILED','HATALI'].includes(s)) kind = 'err';
  else if (['BILGI','INFO'].includes(s)) kind = 'info';
  let Icon: any = Bot;
  if (a.includes('MIHSAP')) Icon = Receipt;
  else if (a.includes('LUCA')) Icon = FileInput;
  else if (a.includes('TEBLIGAT')) Icon = Mailbox;
  else if (a.includes('KDV')) Icon = Calculator;
  else if (a.includes('DEFTER')) Icon = BookOpen;
  else if (a.includes('SGK')) Icon = FileCheck;
  else if (a.includes('FIS')) Icon = Printer;
  const rawTs = ev.ts || ev.createdAt || ev.timestamp || ev.date;
  const ts = rawTs ? new Date(rawTs) : new Date();
  const now = new Date();
  const sameDay = ts.toDateString() === now.toDateString();
  const time = sameDay
    ? ts.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : ts.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }) + ' ' + ts.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const title = (<><strong style={{ color: '#fafaf9', fontWeight: 600 }}>{ev.agent || 'Sistem'}</strong>{ev.message ? <> · {ev.message}</> : ev.status ? <> · {ev.status}</> : null}</>);
  const p: string[] = [];
  if (ev.mukellef) p.push(ev.mukellef);
  if (ev.fisNo) p.push(`#${ev.fisNo}`);
  else if (ev.belgeNo) p.push(`#${ev.belgeNo}`);
  if (ev.firma) p.push(ev.firma);
  if (ev.tutar != null && ev.tutar !== '') p.push(`${ev.tutar} TL`);
  return { time, icon: Icon, title, meta: p.join(' · ') || ts.toLocaleDateString('tr-TR'), kind };
}

// Elit Boutique altın ailesi — dashboard'a renk dokunuşları için
type StatAccent = 'gold' | 'champagne' | 'bronze' | 'copper' | 'burgundy';
const ACCENT_TONES: Record<StatAccent, { color: string; bg: string; border: string; hoverBg: string; hoverBorder: string }> = {
  gold:      { color: '#d4b876', bg: 'rgba(212,184,118,0.12)', border: 'rgba(212,184,118,0.28)', hoverBg: 'rgba(212,184,118,0.06)', hoverBorder: 'rgba(212,184,118,0.32)' },
  champagne: { color: '#e8d6a0', bg: 'rgba(232,214,160,0.14)', border: 'rgba(232,214,160,0.32)', hoverBg: 'rgba(232,214,160,0.06)', hoverBorder: 'rgba(232,214,160,0.36)' },
  bronze:    { color: '#c0a079', bg: 'rgba(192,160,121,0.14)', border: 'rgba(192,160,121,0.32)', hoverBg: 'rgba(192,160,121,0.06)', hoverBorder: 'rgba(192,160,121,0.36)' },
  copper:    { color: '#d99560', bg: 'rgba(217,149,96,0.14)',  border: 'rgba(217,149,96,0.32)',  hoverBg: 'rgba(217,149,96,0.06)',  hoverBorder: 'rgba(217,149,96,0.36)' },
  burgundy:  { color: '#c98896', bg: 'rgba(201,136,150,0.14)', border: 'rgba(201,136,150,0.34)', hoverBg: 'rgba(201,136,150,0.08)', hoverBorder: 'rgba(201,136,150,0.38)' },
};

function StatCard({ title, value, icon: Icon, href, sub, trend, trendKind, accent = 'gold' }: { title: string; value: number | string; icon: any; href?: string; sub?: string; trend?: string; trendKind?: 'up'|'down'|'flat'; accent?: StatAccent }) {
  const t = ACCENT_TONES[accent];
  const c = (
    <div className="group rounded-2xl p-5 transition-all duration-300 relative overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', cursor: href ? 'pointer' : 'default' }}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = t.hoverBg; el.style.borderColor = t.hoverBorder; el.style.transform = 'translateY(-3px)'; el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)'; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.02)'; el.style.borderColor = 'rgba(255,255,255,0.05)'; el.style.transform = 'translateY(0)'; el.style.boxShadow = 'none'; }}>
      {/* Üstten ince altın hairline (kendi tonunda, hover'da belirginleşir) */}
      <span className="absolute top-0 left-4 right-4 h-px transition-opacity duration-300 group-hover:opacity-100" style={{ background: `linear-gradient(90deg, transparent, ${t.color}, transparent)`, opacity: 0.35 }} />
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.color }}><Icon size={17} /></div>
        {trend && <span className="text-[10px] font-bold px-2.5 py-[3px] rounded-md" style={{ background: trendKind === 'up' ? 'rgba(34,197,94,0.1)' : trendKind === 'down' ? 'rgba(244,63,94,0.1)' : 'rgba(255,255,255,0.04)', color: trendKind === 'up' ? '#22c55e' : trendKind === 'down' ? '#f43f5e' : 'rgba(250,250,249,0.35)' }}>{trend}</span>}
      </div>
      <p className="text-[11px] uppercase font-semibold tracking-[.12em]" style={{ color: 'rgba(250,250,249,0.38)' }}>{title}</p>
      <p className="mt-1.5 leading-none tabular-nums" style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', color: t.color }}>{value ?? 0}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: 'rgba(250,250,249,0.32)' }}>{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{c}</Link> : c;
}

function Section({ title, children, action, accent = 'gold' }: { title: string; children: ReactNode; action?: ReactNode; accent?: StatAccent }) {
  const t = ACCENT_TONES[accent];
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5"><span className="w-[3px] h-4 rounded-sm" style={{ background: t.color }} /><h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>{title}</h3></div>
        {action}
      </div>
      {children}
    </div>
  );
}

function FeedRow({ time, icon: Icon, title, meta, kind = 'info' }: { time: string; icon: any; title: ReactNode; meta: string; kind?: FeedKind }) {
  // Mat ton paleti — Mihsap LogCard ve KDV Kontrol akışıyla tutarlı
  const C: Record<FeedKind, { bg: string; bd: string; c: string }> = {
    ok:   { bg: 'rgba(60,120,70,0.06)',  bd: 'rgba(77,124,79,0.2)',  c: '#7aa07c' },
    warn: { bg: 'rgba(180,120,40,0.06)', bd: 'rgba(146,116,74,0.2)', c: '#b89870' },
    err:  { bg: 'rgba(180,50,50,0.07)',  bd: 'rgba(176,64,64,0.2)',  c: '#d97070' },
    info: { bg: 'rgba(184,160,111,0.06)', bd: 'rgba(184,160,111,0.15)', c: GOLD },
  };
  const c = C[kind];
  return (
    <div className="flex items-start gap-3 px-5 py-[11px]" style={{ borderLeft: '2px solid transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.04)'; e.currentTarget.style.borderLeftColor = GOLD; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
      <span className="min-w-[40px] pt-[3px] tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: 'rgba(250,250,249,0.3)' }}>{time}</span>
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.c }}><Icon size={13} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] leading-[1.45]" style={{ color: 'rgba(250,250,249,0.85)' }}>{title}</div>
        <div className="text-[10.5px] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.35)' }}>{meta}</div>
      </div>
    </div>
  );
}

function TaskRow({ t, onToggle, onDelete }: { t: Task; onToggle: () => void; onDelete: () => void }) {
  const due = fmtDue(t.dueDate);
  const k = t.done ? 'ok' : due.kind;
  const chip = t.done ? 'Tamam' : due.label;
  const cs: any = { danger: { bg: 'rgba(244,63,94,0.1)', c: '#f43f5e' }, warn: { bg: 'rgba(245,158,11,0.1)', c: '#f59e0b' }, gold: { bg: 'rgba(184,160,111,0.12)', c: GOLD }, ok: { bg: 'rgba(34,197,94,0.1)', c: '#22c55e' } }[k];
  const barC: any = { danger: '#f43f5e', warn: '#f59e0b', gold: 'rgba(184,160,111,0.5)', ok: '#22c55e' }[k];
  const dateStr = new Date(t.dueDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="group/row flex items-center gap-3 px-5 py-3" style={{ borderLeft: '2px solid transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.04)'; e.currentTarget.style.borderLeftColor = 'rgba(184,160,111,0.4)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderLeftColor = 'transparent'; }}>
      <div className="w-[3px] h-7 rounded-sm flex-shrink-0" style={{ background: barC }} />
      <button onClick={onToggle} className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: t.done ? GOLD : 'transparent', border: `1.5px solid ${t.done ? GOLD : 'rgba(250,250,249,0.25)'}`, color: '#0f0d0b' }}>{t.done && <Check size={13} strokeWidth={3} />}</button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13.5px] font-medium truncate" style={{ color: '#fafaf9', textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.55 : 1 }}>{t.title}</p>
          {/* Hatırlatma kanalı rozetleri */}
          {t.whatsappPhone && (
            <span title={`WhatsApp: ${t.whatsappPhone} (yakında aktif)`} className="text-[9.5px] px-1.5 py-[1px] rounded" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>WA</span>
          )}
          {t.emailAddr && (
            <span title={`E-posta: ${t.emailAddr} (yakında aktif)`} className="text-[9.5px] px-1.5 py-[1px] rounded" style={{ background: 'rgba(184,160,111,0.12)', color: GOLD, border: '1px solid rgba(184,160,111,0.25)' }}>MAIL</span>
          )}
        </div>
        <p className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.35)' }}>{t.note ? `${dateStr} · ${t.note}` : dateStr}</p>
      </div>
      <span className="text-[10.5px] font-semibold px-2.5 py-[3px] rounded-md flex-shrink-0" style={{ background: cs.bg, color: cs.c }}>{chip}</span>
      <button onClick={onDelete} className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1" style={{ color: 'rgba(244,63,94,0.65)' }}><IconX size={14} /></button>
    </div>
  );
}

function AgentMini({ href, icon: Icon, name, stat, running }: { href: string; icon: any; name: string; stat: string; running: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-3 p-[14px] rounded-2xl transition-all duration-300" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(184,160,111,0.05)'; el.style.borderColor = 'rgba(184,160,111,0.22)'; el.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(255,255,255,0.02)'; el.style.borderColor = 'rgba(255,255,255,0.05)'; el.style.transform = 'translateY(0)'; }}>
      <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}><Icon size={17} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>{name}</div>
        <div className="text-[10.5px] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.4)' }}>{stat}</div>
      </div>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: running ? '#22c55e' : 'rgba(255,255,255,0.18)', boxShadow: running ? '0 0 8px rgba(34,197,94,0.6)' : 'none', animation: running ? 'moren-pulse 2s infinite' : 'none' }} />
    </Link>
  );
}

// ══════════════════════════════════════════════════════════
// TOPLU BEYANNAME — SGK VE E-DEFTER KONTROL (Hattat-stili)
// Dönem seçici + beyanname/SGK/E-defter tabloları progress bar ile
// ══════════════════════════════════════════════════════════
type BeyanFilter = 'toplam' | 'onaylanan' | 'bekleyen' | 'hatali' | 'kalan';
type ModalState = { beyanTipi: BeyanTipi; filter: BeyanFilter; donem: string } | null;

function ToplubeyannameTable() {
  // Varsayılan: içinde bulunduğumuz ay
  const [donem, setDonem] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [modal, setModal] = useState<ModalState>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['beyanname-ozet', donem],
    queryFn: () => beyannameTakipApi.listOzet(donem),
    // Her beyanname döneminde otomatik yenilensin diye 5 dk cache
    staleTime: 5 * 60 * 1000,
  });

  const rows = data?.rows || [];
  const openModal = (beyanTipi: BeyanTipi, filter: BeyanFilter) =>
    setModal({ beyanTipi, filter, donem });

  // Tablo gruplamaları
  const beyanTipleri: BeyanTipi[] = ['KURUMLAR', 'GELIR', 'KDV1', 'KDV2', 'DAMGA', 'POSET', 'MUHSGK'];
  const beyanRows = rows.filter((r) => beyanTipleri.includes(r.beyanTipi) && r.toplam > 0);
  const bildirgeRow = rows.find((r) => r.beyanTipi === 'BILDIRGE' && r.toplam > 0);
  const edefterRow = rows.find((r) => r.beyanTipi === 'EDEFTER' && r.toplam > 0);

  // Dönem seçenekleri: son 12 ay
  const donemOptions = useMemo(() => {
    const now = new Date();
    const arr: { value: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const aylar = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
      arr.push({ value: v, label: `${d.getFullYear()}/${aylar[d.getMonth()]}` });
    }
    return arr;
  }, []);

  return (
    <div>
      {/* Başlık bandı */}
      <div className="flex items-center justify-between px-5 py-4 flex-wrap gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <FileCheck2 size={16} style={{ color: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Toplu Beyanname — SGK ve E-Defter Kontrol</h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={donem}
            onChange={(e) => setDonem(e.target.value)}
            className="text-[12px] px-2.5 py-1.5 rounded-md outline-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(184,160,111,0.25)', color: '#fafaf9' }}
          >
            {donemOptions.map((o) => (
              <option key={o.value} value={o.value} style={{ background: '#1a1814' }}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium px-3 py-1.5 rounded-md transition-all inline-flex items-center gap-1.5"
            style={{ background: 'rgba(184,160,111,0.12)', border: '1px solid rgba(184,160,111,0.3)', color: GOLD }}
          >
            <SearchIcon size={11} /> Sorgula
          </button>
          <Link
            href="/panel/ayarlar/beyanname-takip"
            className="text-[11px] font-medium px-3 py-1.5 rounded-md transition-all inline-flex items-center gap-1.5"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
          >
            <Settings size={11} /> Ayarlar
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="px-5 py-10 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
          Yükleniyor...
        </div>
      )}

      {!isLoading && beyanRows.length === 0 && !bildirgeRow && !edefterRow && (
        <div className="px-5 py-10 text-center">
          <p className="text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
            Bu dönem için hiçbir mükellefin beyan yükümlülüğü yok.
          </p>
          <p className="text-[11px] mt-1.5" style={{ color: 'rgba(250,250,249,0.3)' }}>
            Ayarlar → Mükellef Beyanname Takip sayfasından mükellef konfigürasyonlarını düzenle.
          </p>
        </div>
      )}

      {/* Beyannameler tablosu */}
      {beyanRows.length > 0 && (
        <div className="px-1.5 py-1.5">
          <table className="w-full text-[12px]" style={{ color: 'rgba(250,250,249,0.85)', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '120px' }} />
              <col style={{ width: '68px' }} />
              <col style={{ width: '82px' }} />
              <col style={{ width: '82px' }} />
              <col style={{ width: '68px' }} />
              <col style={{ width: '68px' }} />
              <col />
            </colgroup>
            <thead>
              <tr style={{ background: 'rgba(184,160,111,0.08)' }}>
                <Th>Beyannameler ({data?.donem})</Th>
                <Th right>Toplam</Th>
                <Th right>Onaylanan</Th>
                <Th right>Bekleyen</Th>
                <Th right>Hatalı</Th>
                <Th right>Kalan</Th>
                <Th>Durum</Th>
              </tr>
            </thead>
            <tbody>
              {beyanRows.map((r) => (
                <BeyanTr key={r.beyanTipi} row={r} onNumberClick={openModal} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bildirge + E-Defter yan yana */}
      {(bildirgeRow || edefterRow) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-1.5 pb-2">
          {bildirgeRow && (
            <MiniTable title="Bildirge" row={bildirgeRow} donem={data?.donem || donem} accent="copper" onNumberClick={openModal} />
          )}
          {edefterRow && (
            <MiniTable title="E-Defter" row={edefterRow} donem={data?.donem || donem} accent="bronze" onNumberClick={openModal} />
          )}
        </div>
      )}

      {/* Mükellef listesi modal'ı */}
      {modal && <BeyanDetayModal state={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function Th({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return (
    <th
      className={`text-[10.5px] font-semibold uppercase tracking-wider px-2.5 py-2 ${right ? 'text-right' : 'text-left'} ${className || ''}`}
      style={{ color: 'rgba(250,250,249,0.6)' }}
    >
      {children}
    </th>
  );
}

/** Tıklanabilir rakam hücresi — rakam > 0 ise altın hover + tıklama. */
function Num({
  value,
  color,
  bold,
  onClick,
  disabled,
}: {
  value: number;
  color: string;
  bold?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const clickable = !disabled && !!onClick && value > 0;
  return (
    <td
      className={`px-2.5 py-2 text-right tabular-nums ${bold ? 'font-semibold' : ''} ${clickable ? 'cursor-pointer hover:bg-white/5 hover:underline decoration-dotted underline-offset-2' : ''} transition`}
      style={{ fontFamily: 'JetBrains Mono, monospace', color }}
      onClick={clickable ? onClick : undefined}
      title={clickable ? 'Mükellef listesini göster' : undefined}
    >
      {value}
    </td>
  );
}

function BeyanTr({ row, onNumberClick }: { row: OzetRow; onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void }) {
  const kind = row.yuzde >= 90 ? 'ok' : row.yuzde >= 50 ? 'warn' : 'danger';
  const barColor = kind === 'ok' ? '#22c55e' : kind === 'warn' ? '#f59e0b' : '#ef4444';
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <td className="px-2.5 py-2 font-semibold" style={{ color: GOLD }}>{BEYAN_ETIKETLER[row.beyanTipi]}</td>
      <Num value={row.toplam}    color="rgba(250,250,249,0.85)"                                              onClick={() => onNumberClick(row.beyanTipi, 'toplam')} />
      <Num value={row.onaylanan} color="#22c55e"                                                             onClick={() => onNumberClick(row.beyanTipi, 'onaylanan')} />
      <Num value={row.bekleyen}  color="rgba(250,250,249,0.5)"                                               onClick={() => onNumberClick(row.beyanTipi, 'bekleyen')} />
      <Num value={row.hatali}    color={row.hatali > 0 ? '#ef4444' : 'rgba(250,250,249,0.3)'}                onClick={() => onNumberClick(row.beyanTipi, 'hatali')} />
      <Num value={row.kalan}     color={row.kalan > 0 ? '#f59e0b' : '#22c55e'} bold                          onClick={() => onNumberClick(row.beyanTipi, 'kalan')} />
      <td className="px-2.5 py-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div
              className="h-full transition-all duration-500 rounded-full"
              style={{ width: `${row.yuzde}%`, background: `linear-gradient(90deg, ${barColor}aa, ${barColor})` }}
            />
          </div>
          <span className="text-[10.5px] font-semibold tabular-nums w-[32px] text-right" style={{ color: barColor, fontFamily: 'JetBrains Mono, monospace' }}>%{row.yuzde}</span>
        </div>
      </td>
    </tr>
  );
}

function MiniTable({ title, row, donem, accent, onNumberClick }: { title: string; row: OzetRow; donem: string; accent: StatAccent; onNumberClick: (tip: BeyanTipi, filter: BeyanFilter) => void }) {
  const tone = ACCENT_TONES[accent];
  const kind = row.yuzde >= 90 ? 'ok' : row.yuzde >= 50 ? 'warn' : 'danger';
  const barColor = kind === 'ok' ? '#22c55e' : kind === 'warn' ? '#f59e0b' : '#ef4444';
  const miniCell = (label: string, value: number, color: string, filter: BeyanFilter) => {
    const clickable = value > 0;
    return (
      <div
        className={`group ${clickable ? 'cursor-pointer' : ''}`}
        onClick={clickable ? () => onNumberClick(row.beyanTipi, filter) : undefined}
        title={clickable ? 'Mükellef listesini göster' : undefined}
      >
        <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
        <div
          className={`text-[16px] font-semibold tabular-nums ${clickable ? 'group-hover:underline decoration-dotted underline-offset-2' : ''}`}
          style={{ color, fontFamily: 'JetBrains Mono, monospace' }}
        >
          {value}
        </div>
      </div>
    );
  };
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${tone.border}` }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: tone.bg }}>
        <div className="flex items-center gap-2">
          <span className="w-[3px] h-3.5 rounded-sm" style={{ background: tone.color }} />
          <span className="text-[12px] font-semibold" style={{ color: tone.color }}>{title} ({donem})</span>
        </div>
      </div>
      <div className="px-4 py-3 grid grid-cols-3 gap-3 text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
        {miniCell('Toplam', row.toplam, '#fafaf9', 'toplam')}
        {miniCell(title === 'E-Defter' ? 'Verilen' : 'Onaylanan', row.onaylanan, '#22c55e', 'onaylanan')}
        {miniCell('Kalan', row.kalan, row.kalan > 0 ? '#f59e0b' : '#22c55e', 'kalan')}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div
              className="h-full transition-all duration-500 rounded-full"
              style={{ width: `${row.yuzde}%`, background: `linear-gradient(90deg, ${barColor}aa, ${barColor})` }}
            />
          </div>
          <span className="text-[10.5px] font-semibold tabular-nums" style={{ color: barColor, fontFamily: 'JetBrains Mono, monospace' }}>%{row.yuzde}</span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// BEYAN DETAY MODAL — rakama tıklanınca açılır, filtreye göre mükellef listesi
// ══════════════════════════════════════════════════════════
function BeyanDetayModal({ state, onClose }: { state: { beyanTipi: BeyanTipi; filter: BeyanFilter; donem: string }; onClose: () => void }) {
  const { data: detay, isLoading } = useQuery({
    queryKey: ['beyanname-detay', state.donem],
    queryFn: () => beyannameTakipApi.listDetay(state.donem),
    staleTime: 2 * 60 * 1000,
  });

  const filterLabels: Record<BeyanFilter, string> = {
    toplam: 'Tüm Yükümlüler',
    onaylanan: 'Onaylananlar',
    bekleyen: 'Bekleyenler',
    hatali: 'Hatalı Olanlar',
    kalan: 'Henüz Verilmeyenler',
  };

  const filteredTaxpayers = useMemo(() => {
    if (!detay) return [];
    return detay
      .map((row) => {
        const b = row.beyanlar.find((x) => x.beyanTipi === state.beyanTipi);
        if (!b) return null;
        switch (state.filter) {
          case 'toplam':    return row;
          case 'onaylanan': return b.durum === 'onaylandi' ? row : null;
          case 'bekleyen':  return b.durum === 'beklemede' ? row : null;
          case 'hatali':    return b.durum === 'hatali' ? row : null;
          case 'kalan':     return (b.durum === 'beklemede' || b.durum === 'hatali') ? row : null;
          default: return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [detay, state.beyanTipi, state.filter]);

  const filterColor: Record<BeyanFilter, string> = {
    toplam: '#d4b876',
    onaylanan: '#22c55e',
    bekleyen: 'rgba(250,250,249,0.6)',
    hatali: '#ef4444',
    kalan: '#f59e0b',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#11100c', border: '1px solid rgba(184,160,111,0.3)', maxHeight: '80vh' }}
      >
        {/* Başlık */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.5)' }}>
              {BEYAN_ETIKETLER[state.beyanTipi]} · {state.donem}
            </div>
            <h3 className="text-[16px] font-semibold mt-0.5" style={{ fontFamily: 'Fraunces, serif', color: filterColor[state.filter] }}>
              {filterLabels[state.filter]}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-white/5" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <IconX size={18} />
          </button>
        </div>

        {/* İçerik */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {isLoading && (
            <div className="px-4 py-8 text-center text-[12px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
              Yükleniyor...
            </div>
          )}
          {!isLoading && filteredTaxpayers.length === 0 && (
            <div className="px-4 py-8 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Bu kategoride mükellef yok.
            </div>
          )}
          {!isLoading && filteredTaxpayers.length > 0 && (
            <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
              {filteredTaxpayers.map((tp, i) => {
                const b = tp.beyanlar.find((x) => x.beyanTipi === state.beyanTipi);
                const durumRenk: Record<string, string> = {
                  onaylandi: '#22c55e',
                  beklemede: 'rgba(250,250,249,0.5)',
                  hatali:    '#ef4444',
                  muaf:      '#d4b876',
                };
                const durumEtiket: Record<string, string> = {
                  onaylandi: 'Onaylandı',
                  beklemede: 'Bekliyor',
                  hatali:    'Hatalı',
                  muaf:      'Muaf',
                };
                return (
                  <li key={tp.taxpayerId} className="px-3 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="text-[10.5px] font-semibold tabular-nums w-6 text-right" style={{ color: 'rgba(250,250,249,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {i + 1}
                      </span>
                      <span className="text-[13px] truncate" style={{ color: '#fafaf9' }}>{tp.ad}</span>
                    </div>
                    {b && (
                      <span
                        className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0"
                        style={{
                          background: `${durumRenk[b.durum]}22`,
                          border: `1px solid ${durumRenk[b.durum]}55`,
                          color: durumRenk[b.durum],
                        }}
                      >
                        {durumEtiket[b.durum] || b.durum}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Alt bilgi */}
        <div className="px-5 py-2.5 text-[11px] flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.4)' }}>
          <span>{filteredTaxpayers.length} mükellef</span>
          <button onClick={onClose} className="font-medium hover:text-amber-400 transition">Kapat</button>
        </div>
      </div>
    </div>
  );
}

// ── Aylık İşlem Trendi — Bar Chart
function TrendChart({ events }: { events: any[] }) {
  const [mode, setMode] = useState<'weekly' | 'monthly'>('monthly');

  const bars = useMemo(() => {
    const now = new Date();
    if (mode === 'monthly') {
      const months = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
      const arr: { label: string; count: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        arr.push({ label: months[d.getMonth()], count: 0 });
      }
      for (const ev of events) {
        const d = (ev.ts || ev.createdAt || ev.timestamp || ev.date) ? new Date(ev.ts || ev.createdAt || ev.timestamp || ev.date) : null;
        if (!d || isNaN(d.getTime())) continue;
        const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
        if (diff >= 0 && diff < 6) arr[5 - diff].count++;
      }
      return arr;
    } else {
      const days = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
      const arr: { label: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        arr.push({ label: days[(d.getDay() + 6) % 7], count: 0 });
      }
      for (const ev of events) {
        const d = (ev.ts || ev.createdAt || ev.timestamp || ev.date) ? new Date(ev.ts || ev.createdAt || ev.timestamp || ev.date) : null;
        if (!d || isNaN(d.getTime())) continue;
        const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (diff >= 0 && diff < 7) arr[6 - diff].count++;
      }
      return arr;
    }
  }, [events, mode]);

  const max = Math.max(1, ...bars.map((b) => b.count));
  const hasAny = bars.some((b) => b.count > 0);

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Aylık İşlem Trendi</h3>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setMode('weekly')} className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-all" style={{ background: mode === 'weekly' ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mode === 'weekly' ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: mode === 'weekly' ? GOLD : 'rgba(250,250,249,0.6)' }}>Haftalık</button>
          <button onClick={() => setMode('monthly')} className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-all" style={{ background: mode === 'monthly' ? 'rgba(184,160,111,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mode === 'monthly' ? 'rgba(184,160,111,0.3)' : 'rgba(255,255,255,0.08)'}`, color: mode === 'monthly' ? GOLD : 'rgba(250,250,249,0.6)' }}>Aylık</button>
        </div>
      </div>
      {hasAny ? (
        <div className="flex items-end gap-2 h-[160px] px-[22px] pt-5 pb-2">
          {bars.map((b, i) => {
            const h = Math.max(4, (b.count / max) * 120);
            return (
              <div key={i} className="flex-1 flex flex-col items-center h-full group/bar" title={`${b.label}: ${b.count} işlem`}>
                <div className="flex-1 w-full flex items-end">
                  <div className="w-full rounded-t-[4px] transition-all group-hover/bar:opacity-100" style={{ height: h, background: `linear-gradient(180deg, ${GOLD}, rgba(184,160,111,0.35))`, opacity: 0.85 }} />
                </div>
                <span className="text-[10px] font-semibold mt-1.5" style={{ color: 'rgba(250,250,249,0.32)' }}>{b.label}</span>
                <span className="text-[9.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)', fontFamily: 'JetBrains Mono, monospace' }}>{b.count || ''}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center h-[130px] px-5">
          <p className="text-[12px]" style={{ color: 'rgba(250,250,249,0.35)' }}>Henüz işlem verisi yok</p>
        </div>
      )}
      <div className="flex gap-4 px-[22px] py-2.5 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
          <div className="w-2 h-2 rounded-[3px]" style={{ background: GOLD }} />Toplam İşlem Hacmi
        </div>
      </div>
    </div>
  );
}

// ── Mükellef Durumu — Donut
function MukellefDonut({ total, segments }: { total: number; segments: { label: string; value: number; color: string }[] }) {
  const sum = segments.reduce((s, x) => s + x.value, 0);
  const grad = useMemo(() => {
    if (sum === 0) return 'rgba(255,255,255,0.06)';
    let acc = 0;
    const parts = segments.map((s) => {
      const start = (acc / sum) * 100;
      acc += s.value;
      const end = (acc / sum) * 100;
      return `${s.color} ${start}% ${end}%`;
    });
    return `conic-gradient(${parts.join(',')})`;
  }, [segments, sum]);

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />
          <h3 className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>Mükellef Durumu</h3>
        </div>
      </div>
      <div className="flex items-center justify-center gap-5 px-5 py-6">
        <div className="w-[120px] h-[120px] rounded-full flex items-center justify-center flex-shrink-0" style={{ background: grad }}>
          <div className="w-[76px] h-[76px] rounded-full flex flex-col items-center justify-center" style={{ background: '#0c0a08' }}>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 24, fontWeight: 700, color: GOLD }}>{total}</div>
            <div className="text-[8.5px] font-semibold uppercase mt-0.5" style={{ color: 'rgba(250,250,249,0.35)', letterSpacing: '.14em' }}>Toplam</div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 flex-1">
          {segments.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.65)' }}>
              <div className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: s.color }} />
              {s.label}
              <span className="ml-auto font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#fafaf9' }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: taxpayers } = useQuery({ queryKey: ['taxpayers'], queryFn: () => api.get('/taxpayers').then((r) => r.data).catch(() => []) });
  const { data: unreadRaw } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get('/notifications/unread-count').then((r) => r.data).catch(() => 0) });
  const { data: agentEvents = [] } = useQuery<any[]>({ queryKey: ['agent-events', 'dashboard'], queryFn: () => api.get('/agent/events?limit=100').then((r) => r.data).catch(() => []), refetchInterval: 15_000 });
  const { data: agentStats } = useQuery<any>({ queryKey: ['agent-stats'], queryFn: () => api.get('/agent/stats').then((r) => r.data).catch(() => null) });
  const { data: agentStatuses = [] } = useQuery<any[]>({ queryKey: ['agent-statuses'], queryFn: () => api.get('/agent/status').then((r) => r.data).catch(() => []), refetchInterval: 30_000 });

  const feed = (agentEvents as any[]).slice(0, 20).map(agentEventToFeed);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [modal, setModal] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [nT, setNT] = useState('');
  const [nD, setND] = useState(() => new Date().toISOString().slice(0, 10));
  const [nN, setNN] = useState('');
  const [nWA, setNWA] = useState('');
  const [nEM, setNEM] = useState('');
  // Bu oturumda hangi görevler için uyarı gösterildi
  const [dueShown, setDueShown] = useState<Record<string, number>>({});

  useEffect(() => { setTasks(loadT()); }, []);
  useEffect(() => { saveT(tasks); }, [tasks]);

  const addT = () => {
    if (!nT.trim()) return;
    setTasks((p) => [{
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      title: nT.trim(),
      dueDate: nD,
      note: nN.trim() || undefined,
      done: false,
      createdAt: new Date().toISOString(),
      whatsappPhone: nWA.trim() || undefined,
      emailAddr: nEM.trim() || undefined,
    }, ...p]);
    setNT(''); setNN(''); setNWA(''); setNEM('');
    setND(new Date().toISOString().slice(0, 10));
    setModal(false);
  };

  // ══════════ Sürekli Hatırlatma Sistemi ══════════
  // Bugün veya geçmiş tarihli, tamamlanmamış görevler için:
  //   1) Tarayıcı bildirimi (permission verdiyse)
  //   2) Sayfada kırmızı pulse banner (dismiss edilene kadar)
  //   3) Her 10 dakikada bir tekrar tetikleme
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Tamamlanmamış, bugün/geçmiş dueDate'li, bu oturumda dismiss edilmemiş görevler
  const dueTasks = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return tasks.filter((t) => {
      if (t.done) return false;
      const d = new Date(t.dueDate); d.setHours(0,0,0,0);
      if (d > today) return false; // gelecek
      if (t.reminderDismissed) return false;
      return true;
    });
  }, [tasks]);

  // Her 10 dakikada tarayıcı bildirimini yenile
  useEffect(() => {
    if (dueTasks.length === 0) return;
    const tick = () => {
      const now = Date.now();
      const TEN_MIN = 10 * 60 * 1000;
      for (const t of dueTasks) {
        const last = dueShown[t.id] || 0;
        if (now - last >= TEN_MIN) {
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('⚠ Hatırlatma — ' + t.title, {
                body: t.note ? `${t.note} · Vade: ${new Date(t.dueDate).toLocaleDateString('tr-TR')}` : `Vade: ${new Date(t.dueDate).toLocaleDateString('tr-TR')}`,
                tag: `moren-task-${t.id}`,
                requireInteraction: true,
              });
            } catch {}
          }
          setDueShown((prev) => ({ ...prev, [t.id]: now }));
        }
      }
    };
    tick(); // hemen tetikle
    const iv = setInterval(tick, 60 * 1000); // her dakika kontrol
    return () => clearInterval(iv);
  }, [dueTasks, dueShown]);

  const dismissReminder = (id: string) => {
    setTasks((p) => p.map((x) => x.id === id ? { ...x, reminderDismissed: true } : x));
  };
  const sorted = [...tasks].sort((a, b) => a.done !== b.done ? (a.done ? 1 : -1) : new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }).toUpperCase();
  const statMap: Record<string, boolean> = {};
  for (const s of (agentStatuses as any[])) if (s?.agent) statMap[String(s.agent).toUpperCase()] = !!s.running;
  const running = (k: string) => statMap[k.toUpperCase()] ?? false;
  const stFor = (k: string) => (agentStatuses as any[]).find((s: any) => String(s.agent || '').toUpperCase().includes(k)) || {};
  const mEv = (agentEvents as any[]).filter((e: any) => String(e.agent || '').toUpperCase().includes('MIHSAP'));
  const mOK = mEv.filter((e: any) => ['OK','KAYDET','BASARILI','ONAYLANDI','ONAY','DONE'].includes(String(e.status || '').toUpperCase())).length;
  const mRate = mEv.length ? Math.round((mOK / mEv.length) * 100) : null;
  const todayCount: number = agentStats?.todayCount ?? (agentEvents as any[]).length ?? 0;
  const successRate: number | null = agentStats?.successRate ?? null;
  const unread: number = typeof unreadRaw === 'number' ? unreadRaw : (unreadRaw?.count ?? 0);
  const todayTaskCount = sorted.filter((t) => !t.done && new Date(t.dueDate).toDateString() === new Date().toDateString()).length;

  // Stat card hesaplamaları
  const tx = (taxpayers as any[]) || [];
  const activeCount = tx.filter((t: any) => (t?.aktif ?? t?.active ?? true) !== false && !t?.deletedAt && !t?.pasif).length;
  const passiveCount = tx.length - activeCount;
  const totalTx = tx.length;

  // Bugünün ajan olay kırılımı
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayEvents = (agentEvents as any[]).filter((e: any) => {
    const r = e.ts || e.createdAt || e.timestamp || e.date;
    return r && new Date(r) >= todayStart;
  });
  const tKayit = todayEvents.filter((e: any) => ['OK','KAYDET','SUCCESS','BASARILI','ONAYLANDI','ONAY','DONE','TAMAMLANDI'].includes(String(e.status || '').toUpperCase())).length;
  const tAtla = todayEvents.filter((e: any) => ['ATLA','SKIP','ATLANDI'].includes(String(e.status || '').toUpperCase())).length;
  const tHata = todayEvents.filter((e: any) => ['HATA','ERROR','FAIL','FAILED','HATALI'].includes(String(e.status || '').toUpperCase())).length;

  // Bekleyen görev trendi
  const pendingTasks = sorted.filter((t) => !t.done);
  const nextDueTask = pendingTasks[0];
  const nextDueStr = nextDueTask ? new Date(nextDueTask.dueDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : null;

  // Kritik uyarı: hatalar + okunmamış bildirim
  const criticalCount = tHata + (unread > 0 ? unread : 0);

  // Mükellef durumu donut segmentleri — Elit Boutique altın tonları (4 segment × 4 ton)
  const donutSegments = useMemo(() => {
    if (tx.length === 0) return [
      { label: 'Tamamlanan', value: 0, color: ACCENT_TONES.gold.color },
      { label: 'Devam Eden', value: 0, color: ACCENT_TONES.champagne.color },
      { label: 'Bekleyen', value: 0, color: ACCENT_TONES.bronze.color },
      { label: 'Başlanmadı', value: 0, color: 'rgba(255,255,255,0.08)' },
    ];
    const byStatus: Record<string, number> = {};
    for (const t of tx) {
      const s = String(t?.durum || t?.status || '').toLowerCase();
      if (s) byStatus[s] = (byStatus[s] || 0) + 1;
    }
    if (Object.keys(byStatus).length > 0) {
      return [
        { label: 'Tamamlanan', value: (byStatus['tamamlanan'] || byStatus['tamamlandi'] || byStatus['completed'] || 0), color: ACCENT_TONES.gold.color },
        { label: 'Devam Eden', value: (byStatus['devam_eden'] || byStatus['devam'] || byStatus['in_progress'] || byStatus['aktif'] || activeCount), color: ACCENT_TONES.champagne.color },
        { label: 'Bekleyen', value: (byStatus['bekleyen'] || byStatus['pending'] || 0), color: ACCENT_TONES.bronze.color },
        { label: 'Başlanmadı', value: (byStatus['baslanmadi'] || byStatus['yeni'] || byStatus['new'] || passiveCount), color: ACCENT_TONES.copper.color },
      ];
    }
    return [
      { label: 'Aktif', value: activeCount, color: ACCENT_TONES.gold.color },
      { label: 'Pasif', value: passiveCount, color: ACCENT_TONES.bronze.color },
    ];
  }, [tx, activeCount, passiveCount]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Hatırlatma bannerı — bugün veya geçmiş tarihli tamamlanmamış görevler için sürekli uyarı */}
      {dueTasks.length > 0 && (
        <div
          className="rounded-2xl px-5 py-4 flex items-center gap-4 flex-wrap"
          style={{
            background: 'linear-gradient(135deg, rgba(244,63,94,0.12), rgba(239,68,68,0.08))',
            border: '1px solid rgba(244,63,94,0.4)',
            boxShadow: '0 0 0 1px rgba(244,63,94,0.15), 0 8px 24px rgba(244,63,94,0.12)',
            animation: 'moren-pulse 2.4s ease-in-out infinite',
          }}
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(244,63,94,0.2)', border: '1px solid rgba(244,63,94,0.5)' }}>
            <AlertTriangle size={18} style={{ color: '#f43f5e' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-bold mb-0.5" style={{ color: '#fafaf9' }}>
              {dueTasks.length} hatırlatma zamanı geldi
            </div>
            <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
              {dueTasks.slice(0, 3).map((t) => t.title).join(' · ')}
              {dueTasks.length > 3 && ` · +${dueTasks.length - 3} daha`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {dueTasks.length === 1 && (
              <button
                onClick={() => dismissReminder(dueTasks[0].id)}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' }}
              >
                Anladım
              </button>
            )}
            {dueTasks.length > 1 && (
              <button
                onClick={() => dueTasks.forEach((t) => dismissReminder(t.id))}
                className="text-[11.5px] font-medium px-3 py-1.5 rounded-md transition"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' }}
              >
                Hepsini anladım
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-end justify-between pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2"><span className="w-[26px] h-px" style={{ background: GOLD }} /><span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>Gösterge</span></div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 36, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>Ofis Paneli</h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>{new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })} · Mükellefler · Beyannameler · Ajanlar</p>
        </div>
        <div className="flex items-center gap-2">
          <MorenAiButton onClick={() => setAiOpen(true)} />
          <Link href="/panel/evraklar" className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184,160,111,0.08)'; e.currentTarget.style.borderColor = 'rgba(184,160,111,0.2)'; e.currentTarget.style.color = '#fafaf9'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(250,250,249,0.75)'; }}>
            <Download size={14} /> İçe Aktar
          </Link>
          <Link href="/panel/mukellefler/yeni" className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}><Plus size={14} /> Yeni Mükellef</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <StatCard
          title="Toplam Mükellef"
          value={totalTx}
          icon={Users}
          href="/panel/mukellefler"
          sub={passiveCount > 0 ? `${activeCount} aktif · ${passiveCount} pasif` : `${activeCount} aktif`}
          accent="gold"
        />
        <StatCard
          title="Bekleyen Görev"
          value={pendingTasks.length}
          icon={FileText}
          sub={todayTaskCount > 0 ? `Bugün: ${todayTaskCount}` : nextDueStr ? `Son tarih: ${nextDueStr}` : 'Bugün yok'}
          trend={pendingTasks.length > 0 ? `${pendingTasks.length} kaldı` : undefined}
          trendKind={pendingTasks.length > 0 ? 'down' : 'flat'}
          accent="champagne"
        />
        <StatCard
          title="Ajan İşlemleri (Bugün)"
          value={todayCount}
          icon={Bot}
          href="/panel/ajanlar"
          sub={todayEvents.length > 0 ? `${tKayit} kayıt · ${tAtla} atla · ${tHata} hata` : 'Henüz işlem yok'}
          trend={successRate != null ? `%${Math.round(successRate)} başarı` : undefined}
          trendKind={successRate != null ? (successRate >= 80 ? 'up' : successRate >= 50 ? 'flat' : 'down') : undefined}
          accent="bronze"
        />
        <div title="Bugünkü ajan işlem hataları + okunmamış tebligat/sistem bildirimleri toplamı. Tıklayınca Bildirimler sayfasına gider.">
          <StatCard
            title="Kritik Uyarı"
            value={criticalCount}
            icon={AlertTriangle}
            href="/panel/bildirimler"
            sub={criticalCount > 0 ? `${tHata} ajan hatası · ${unread} okunmamış bildirim` : 'Sorun yok — her şey yolunda'}
            trend={criticalCount === 0 ? 'değişmedi' : undefined}
            trendKind={criticalCount === 0 ? 'flat' : undefined}
            accent={criticalCount > 0 ? 'burgundy' : 'copper'}
          />
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <ToplubeyannameTable />
      </div>

      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}><span className="w-[3px] h-4 rounded-sm" style={{ background: GOLD }} />Ajan Durumu</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <AgentMini href="/panel/ajanlar/mihsap" icon={Receipt} name="Mihsap Fatura" stat={mEv.length ? `${mEv.length} olay${mRate != null ? ` · %${mRate}` : ''}` : 'Henüz olay yok'} running={running('MIHSAP')} />
          <AgentMini href="/panel/ajanlar/luca" icon={FileInput} name="Luca E-Arşiv" stat={(stFor('LUCA') as any)?.meta?.summary || (running('LUCA') ? 'Çalışıyor' : 'Beklemede')} running={running('LUCA')} />
          <AgentMini href="/panel/ajanlar/tebligat" icon={Mailbox} name="Tebligat Özet" stat={running('TEBLIGAT') ? 'Çalışıyor' : 'Beklemede'} running={running('TEBLIGAT')} />
          <AgentMini href="/panel/ajanlar/kdv-hazirlik" icon={Calculator} name="KDV Ön-Hazırlık" stat={(stFor('KDV') as any)?.meta?.summary || (running('KDV') ? 'Çalışıyor' : 'Beklemede')} running={running('KDV')} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Section title="Notlar & Görevler" accent="champagne" action={
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(250,250,249,0.35)' }}>{today} · BUGÜN</span>
            <button onClick={() => setModal(true)} className="text-[11px] font-medium px-2.5 py-[5px] rounded-md" style={{ background: 'rgba(184,160,111,0.12)', border: '1px solid rgba(184,160,111,0.3)', color: GOLD }}>＋ Ekle</button>
          </div>
        }>
          <div className="py-1.5 max-h-[380px] overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="text-center py-10 px-5">
                <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Henüz görev yok.</p>
                <button onClick={() => setModal(true)} className="mt-3 text-[12px] font-medium" style={{ color: GOLD }}>+ İlk görevi ekle</button>
              </div>
            ) : sorted.map((t) => <TaskRow key={t.id} t={t} onToggle={() => setTasks((p) => p.map((x) => x.id === t.id ? { ...x, done: !x.done } : x))} onDelete={() => setTasks((p) => p.filter((x) => x.id !== t.id))} />)}
          </div>
        </Section>

        <Section title="Canlı Sistem Akışı" accent="bronze" action={
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: feed.length > 0 ? '#22c55e' : 'rgba(255,255,255,0.25)', boxShadow: feed.length > 0 ? '0 0 8px rgba(34,197,94,0.8)' : 'none', animation: feed.length > 0 ? 'moren-pulse 1.6s infinite' : 'none' }} />
            <span className="text-[10px] font-bold uppercase tracking-[.1em]" style={{ color: feed.length > 0 ? '#22c55e' : 'rgba(250,250,249,0.35)' }}>{feed.length > 0 ? 'Canlı' : 'Boş'}</span>
          </div>
        }>
          {feed.length === 0 ? (
            <div className="text-center py-10 px-5">
              <p className="text-[13px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Henüz ajan olayı kaydedilmedi.</p>
              <p className="text-[11.5px] mt-2" style={{ color: 'rgba(250,250,249,0.3)' }}>Ajanlar çalıştığında buradan akar.</p>
            </div>
          ) : feed.length < 5 ? (
            <div className="py-1.5 max-h-[380px] overflow-y-auto">{feed.map((item, i) => <FeedRow key={i} {...item} />)}</div>
          ) : (
            <div className="moren-feed-wrap"><div className="moren-feed-track">{[...feed, ...feed].map((item, i) => <FeedRow key={i} {...item} />)}</div></div>
          )}
        </Section>
      </div>

      <div>
        <h3 className="text-[14px] font-semibold mb-3 flex items-center gap-2.5" style={{ color: '#fafaf9' }}><span className="w-[3px] h-4 rounded-sm" style={{ background: ACCENT_TONES.copper.color }} />Hızlı Erişim</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Mükellef Ekle',  href: '/panel/mukellefler/yeni',   icon: Plus,         accent: 'gold' as StatAccent },
            { label: 'KDV Kontrolü',    href: '/panel/kdv-kontrol/yeni',   icon: CheckCircle2, accent: 'champagne' as StatAccent },
            { label: 'Fiş Yazdırma',    href: '/panel/fis-yazdirma',       icon: Printer,      accent: 'bronze' as StatAccent },
            { label: 'Evrak Yönetimi',  href: '/panel/evraklar',           icon: FileText,     accent: 'copper' as StatAccent },
          ].map(({ label, href, icon: Icon, accent }) => {
            const t = ACCENT_TONES[accent];
            return (
            <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all duration-300 group" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.hoverBg; e.currentTarget.style.borderColor = t.hoverBorder; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110" style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.color }}><Icon size={15} /></div>
              <span className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{label}</span>
              <ArrowRight size={14} className="ml-auto transition-all opacity-30 group-hover:opacity-100" style={{ color: t.color }} />
            </Link>);
          })}
        </div>
      </div>

      {/* Moren AI — floating button & chat sheet */}
      <MorenAiFab onClick={() => setAiOpen(true)} />
      <MorenAiChat open={aiOpen} onClose={() => setAiOpen(false)} />

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} onClick={() => setModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl p-6" style={{ background: '#11100c', border: '1px solid rgba(184,160,111,0.25)' }}>
            <div className="flex items-center justify-between mb-5">
              <h3 style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: '#fafaf9' }}>Yeni Görev</h3>
              <button onClick={() => setModal(false)} style={{ color: 'rgba(250,250,249,0.4)' }}><IconX size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Başlık</label>
                <input type="text" value={nT} onChange={(e) => setNT(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') addT(); }} className="w-full px-3.5 py-2.5 rounded-[10px] text-[14px] outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Tarih</label>
                <input type="date" value={nD} onChange={(e) => setND(e.target.value)} className="w-full px-3.5 py-2.5 rounded-[10px] text-[14px] outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Not (opsiyonel)</label>
                <textarea value={nN} onChange={(e) => setNN(e.target.value)} rows={3} className="w-full px-3.5 py-2.5 rounded-[10px] text-[14px] outline-none resize-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
              </div>

              {/* Hatırlatma kanalları — şimdilik bilgi toplama, entegrasyon ileride */}
              <div className="pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2 mb-2 mt-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.55)' }}>Hatırlatma Kanalları</span>
                  <span className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(212,184,118,0.12)', color: GOLD, border: '1px solid rgba(212,184,118,0.3)' }}>Yakında Aktif</span>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="block text-[10.5px] mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>📱 WhatsApp numarası (Örn: 0535 058 74 75)</label>
                    <input
                      type="tel"
                      value={nWA}
                      onChange={(e) => setNWA(e.target.value)}
                      placeholder="05xx xxx xx xx"
                      className="w-full px-3.5 py-2 rounded-[10px] text-[13.5px] outline-none"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#fafaf9' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] mb-1" style={{ color: 'rgba(250,250,249,0.45)' }}>📧 E-posta adresi</label>
                    <input
                      type="email"
                      value={nEM}
                      onChange={(e) => setNEM(e.target.value)}
                      placeholder="ornek@mail.com"
                      className="w-full px-3.5 py-2 rounded-[10px] text-[13.5px] outline-none"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#fafaf9' }}
                    />
                  </div>
                </div>
                <p className="text-[10px] mt-2" style={{ color: 'rgba(250,250,249,0.35)' }}>
                  Hatırlatma günü geldiğinde bu kanallara da bildirim gidecek. Şimdilik bilgi kaydediliyor, entegrasyon yakında.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button onClick={() => setModal(false)} className="px-4 py-2 rounded-[10px] text-[13px] font-medium" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>İptal</button>
                <button onClick={addT} disabled={!nT.trim()} className="px-5 py-2 rounded-[10px] text-[13px] font-bold disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}>Ekle</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
