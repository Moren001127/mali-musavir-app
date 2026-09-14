'use client';

// Beyanname listesinde TEK satır = TEK kayıt (beyanname + tahakkuk aynı satırda iki belge çipi).
import { FileText, CheckCircle2, Mail, MessageCircle, Download, Loader2, type LucideIcon } from 'lucide-react';
import { BeyanKaydi, IletimKanal, beyanKaydiMukellefAdi } from '@/lib/beyan-kayitlari';
import { IletimRozeti } from './IletimRozeti';
import {
  BeyanDocKind, beyanMahiyeti, declarationTypeCode, declarationTypeLabel,
  fmtCurrency, fmtDate, fmtDonemKisa, gonderimEngeli,
} from './beyan-yardimcilar';

const METIN = '#fafaf9';
const IKINCIL = 'rgba(250,250,249,0.42)';

export type GoruntulenenBelgeler = { beyanname: boolean; tahakkuk: boolean };

export function BeyanSatiri({
  row,
  secili,
  onSecim,
  goruntulenen,
  onOnizle,
  onIndir,
  onGonder,
  onMukellefSec,
  indiriliyor = false,
}: {
  row: BeyanKaydi;
  secili: boolean;
  onSecim: (secili: boolean) => void;
  goruntulenen: GoruntulenenBelgeler;
  onOnizle: (kind: BeyanDocKind) => void;
  onIndir: () => void;
  onGonder: (channel: IletimKanal) => void;
  onMukellefSec: () => void;
  indiriliyor?: boolean;
}) {
  const mahiyet = beyanMahiyeti(row);
  const beyannameVar = !!row.beyannameUrl;
  const tahakkukVar = !!row.pdfUrl;
  const pdfVar = beyannameVar || tahakkukVar;
  const whatsappEngel = gonderimEngeli(row, 'WHATSAPP');
  const epostaEngel = gonderimEngeli(row, 'EMAIL');

  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.055)', background: secili ? 'rgba(212,184,118,0.05)' : undefined }}>
      <td className="px-3 py-2.5">
        <input type="checkbox" checked={secili} onChange={(e) => onSecim(e.target.checked)} aria-label="Kaydı seç" />
      </td>
      <td className="px-3 py-2.5 overflow-hidden">
        <button type="button" onClick={onMukellefSec} className="block w-full min-w-0 text-left" title="Bu mükellefe süz">
          <div className="truncate font-semibold" style={{ color: METIN }}>{beyanKaydiMukellefAdi(row)}</div>
          <div className="mt-0.5 font-mono text-[11.5px]" style={{ color: 'rgba(250,250,249,0.38)' }}>{row.taxpayer?.taxNumber || '—'}</div>
        </button>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap font-semibold tabular-nums" style={{ color: METIN }}>{fmtDonemKisa(row.donem)}</td>
      <td className="px-3 py-2.5">
        <div className="font-semibold" style={{ color: METIN }}>{declarationTypeCode(row)}</div>
        <div className="mt-0.5 text-[11px]" style={{ color: IKINCIL }}>{declarationTypeLabel(row)}</div>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-[12px] font-semibold" style={{ color: mahiyet === 'DUZELTME' ? '#fcd34d' : 'rgba(250,250,249,0.7)' }}>
          {mahiyet === 'DUZELTME' ? 'DÜZELTME' : 'ASIL'}
        </span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums" style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtDate(row.beyanTarihi || row.createdAt)}</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-right font-semibold tabular-nums" style={{ color: row.tahakkukTutari != null ? METIN : tahakkukVar ? '#fcd34d' : IKINCIL }}>
        {row.tahakkukTutari != null ? fmtCurrency(row.tahakkukTutari) : tahakkukVar ? <span title="Tahakkuk fişinden tutar okunamadı">okunamadı</span> : '—'}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap overflow-hidden">
        <div className="flex items-center gap-1">
          <BelgeCipi harf="B" etiket="Beyanname" var={beyannameVar} goruntulendi={goruntulenen.beyanname} onClick={() => onOnizle('beyanname')} />
          <BelgeCipi harf="T" etiket="Tahakkuk" var={tahakkukVar} goruntulendi={goruntulenen.tahakkuk} onClick={() => onOnizle('tahakkuk')} />
        </div>
      </td>
      <td className="px-3 py-2.5">
        <IletimRozeti iletim={row.iletim} />
        {!(row.iletim && row.iletim.length) && <span className="text-[11.5px]" style={{ color: 'rgba(250,250,249,0.28)' }}>—</span>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <EylemDugmesi
            etiket={whatsappEngel || 'WhatsApp ile gönder'}
            ikon={MessageCircle}
            ton="whatsapp"
            disabled={!!whatsappEngel}
            onClick={() => onGonder('WHATSAPP')}
          />
          <EylemDugmesi
            etiket={epostaEngel || 'E-posta ile gönder'}
            ikon={Mail}
            ton="mail"
            disabled={!!epostaEngel}
            onClick={() => onGonder('EMAIL')}
          />
          <EylemDugmesi
            etiket={pdfVar ? (beyannameVar && tahakkukVar ? 'İndir (beyanname + tahakkuk)' : 'İndir') : 'PDF yok'}
            ikon={indiriliyor ? Loader2 : Download}
            ton="default"
            disabled={!pdfVar || indiriliyor}
            onClick={onIndir}
            donuyor={indiriliyor}
          />
        </div>
      </td>
    </tr>
  );
}

/** Belge kutusu (kare): B = Beyanname, T = Tahakkuk. PDF varsa tıklanır (önizleme); görüntülenmişse yeşil, yeni ise mavi; yoksa kesikli soluk. */
function BelgeCipi({ harf, etiket, var: mevcut, goruntulendi, onClick }: { harf: string; etiket: string; var: boolean; goruntulendi: boolean; onClick: () => void }) {
  const taban = 'inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-[12px] font-extrabold leading-none';
  if (!mevcut) {
    return (
      <span className={taban} title={`${etiket} PDF yok`} aria-label={`${etiket} yok`}
        style={{ border: '1px dashed rgba(255,255,255,0.14)', color: 'rgba(250,250,249,0.28)' }}>
        {harf}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick}
      title={goruntulendi ? `${etiket} — görüntülendi (yeniden aç)` : `${etiket} PDF önizle`}
      aria-label={`${etiket} PDF önizle`}
      className={`${taban} transition hover:brightness-125`}
      style={goruntulendi
        ? { background: 'rgba(92,191,138,0.14)', border: '1px solid rgba(92,191,138,0.45)', color: '#5cbf8a' }
        : { background: 'rgba(127,166,221,0.14)', border: '1px solid rgba(127,166,221,0.45)', color: '#9cc0ee' }}>
      {harf}
    </button>
  );
}

function EylemDugmesi({
  etiket, ikon: Ikon, onClick, disabled, ton, donuyor,
}: {
  etiket: string;
  ikon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  ton: 'default' | 'mail' | 'whatsapp';
  donuyor?: boolean;
}) {
  const tonlar = {
    default: { background: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.72)' },
    mail: { background: 'rgba(56,189,248,0.11)', border: 'rgba(56,189,248,0.28)', color: '#7dd3fc' },
    whatsapp: { background: 'rgba(34,197,94,0.11)', border: 'rgba(34,197,94,0.28)', color: '#86efac' },
  } as const;
  const c = tonlar[ton];
  return (
    <button
      type="button"
      title={etiket}
      aria-label={etiket}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
      style={{
        background: c.background,
        border: `1px solid ${c.border}`,
        color: c.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Ikon size={14} strokeWidth={2.2} className={donuyor ? 'animate-spin' : undefined} />
    </button>
  );
}
