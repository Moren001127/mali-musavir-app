'use client';

import { Fragment, useMemo } from 'react';
import { AlertTriangle, Check, ExternalLink, FileDown, Mail, Phone, Printer, Send, SendHorizontal } from 'lucide-react';
import {
  donemAdi, fisBaglantisi, gonderimOzeti, grupla, odemeAdi, tarihAdi, tarihSaat, trMoney, vadeDurumu, vadeKaydirildi,
  type GonderimBilgisi, type OdemeListesi, type OdemeOzet,
} from '@/lib/aylik-odeme';
import { AltinDugme, Cip, GriDugme, GOLD, GRUP_BOSLUK, GRUP_CIZGI, GRUP_ZEMIN, HUCRE, HUCRE_BASLIK, IKINCIL, KART, KENAR_NOTR, KIRMIZI_YUMUSAK, METIN, SONUK } from './ortak';

const SUTUN = 4;

export interface CetvelProps {
  r: OdemeListesi;
  ozet?: OdemeOzet;
  gonderiliyor: boolean;
  ornekGonderiliyor: boolean;
  pdfIniyor: boolean;
  onGonder: () => void;
  onOrnekGonder: () => void;
  onPdf: () => void;
  onYazdir: () => void;
}

/** Kanal adları düğme yazısı için: "WhatsApp / e-posta ile gönder" */
function kanalYazisi(ozet?: OdemeOzet): string {
  const k = ozet?.kanallar;
  if (!k) return 'WhatsApp / e-posta ile gönder';
  if (k.whatsapp && k.email) return 'WhatsApp / e-posta ile gönder';
  if (k.email) return 'E-posta ile gönder';
  return 'WhatsApp ile gönder';
}

/**
 * Sağ cetvel — seçili mükellefin o ayki ödemeleri.
 * Grup bantları (VERGİ · aylık / GEÇİCİ VERGİ / YILLIK / SGK) altın tonlu, her bandın sağında ara toplam.
 * Satır: ödeme adı (+ taksit çipi, + "fiş" bağlantısı) · dönem · son ödeme (kaydırma ipucu + vade rengi) · tutar.
 */
export function Cetvel({ r, ozet, gonderiliyor, ornekGonderiliyor, pdfIniyor, onGonder, onOrnekGonder, onPdf, onYazdir }: CetvelProps) {
  const gruplar = useMemo(() => grupla(r.satirlar), [r.satirlar]);
  const g = gonderimOzeti(r);
  const dahaOnce = g.durum === 'gonderildi' || g.kismi || g.durum === 'hata';
  const iletisimYok = !(r.phone || '').trim() && !(r.email || '').trim();
  const testMode = !!ozet?.testMode;

  return (
    <div style={KART} data-testid="cetvel">
      {/* Başlık: mükellef + iletişim + gönderim durumu + düğmeler */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${KENAR_NOTR}` }}>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold leading-6" style={{ color: METIN }} title={r.unvan}>
            {r.unvan}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: IKINCIL }}>
            <span className="inline-flex items-center gap-1" title={r.phone ? 'Telefon' : 'Telefon kayıtlı değil'} style={{ color: r.phone ? IKINCIL : KIRMIZI_YUMUSAK }}>
              <Phone size={11} /> {r.phone || 'telefon yok'}
            </span>
            <span className="inline-flex items-center gap-1" title={r.email ? 'E-posta' : 'E-posta kayıtlı değil'} style={{ color: r.email ? IKINCIL : SONUK }}>
              <Mail size={11} /> {r.email || 'e-posta yok'}
            </span>
            <GonderimDurumu etiket="Vergi" g={r.gonderim?.VERGI || null} var_={r.satirlar.some((s) => s.kaynak !== 'SGK')} />
            <GonderimDurumu etiket="SGK" g={r.gonderim?.SGK || null} var_={r.satirlar.some((s) => s.kaynak === 'SGK')} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 print:hidden">
          <GriDugme kucuk onClick={onYazdir} title="PDF'i yeni sekmede aç ve yazdır">
            <Printer size={13} /> Yazdır
          </GriDugme>
          <GriDugme kucuk onClick={onPdf} yukleniyor={pdfIniyor} title="Bu mükellefin cetvelini PDF olarak indir">
            <FileDown size={13} /> PDF
          </GriDugme>
          <GriDugme kucuk onClick={onOrnekGonder} yukleniyor={ornekGonderiliyor} title="Mükellefe gitmez — bu mükellefin mesajını örnek olarak kendi WhatsApp'ınıza gönderir">
            <SendHorizontal size={13} /> Şablonu bana gönder
          </GriDugme>
          <div className="flex flex-col items-end">
            <AltinDugme kucuk onClick={onGonder} yukleniyor={gonderiliyor} disabled={iletisimYok && !testMode} title={iletisimYok && !testMode ? 'Telefon ve e-posta yok — gönderilemez' : testMode ? 'TEST MODU: mesaj test alıcısına gider' : undefined}>
              <Send size={13} /> {dahaOnce ? 'Yeniden gönder' : kanalYazisi(ozet)}
            </AltinDugme>
            {dahaOnce && g.sentAt && (
              <span className="mt-1 text-[10.5px] tabular-nums" style={{ color: IKINCIL }}>
                son gönderim {tarihSaat(g.sentAt)}{g.test ? ' · test' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tablo — table-fixed + colgroup: uzun ödeme adı tutarı dışarı taşımasın */}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 560 }}>
          <colgroup>
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'rgba(212,184,118,0.07)' }}>
              <th style={{ ...HUCRE_BASLIK, borderLeft: 'none' }}>Ödeme</th>
              <th style={HUCRE_BASLIK}>Dönem</th>
              <th style={HUCRE_BASLIK}>Son ödeme</th>
              <th style={{ ...HUCRE_BASLIK, textAlign: 'right', borderRight: 'none' }}>Tutar</th>
            </tr>
          </thead>
          <tbody>
            {gruplar.map((grup, gi) => (
              <Fragment key={grup.key}>
                {gi > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={SUTUN} style={{ border: 'none', padding: 0, height: GRUP_BOSLUK, background: 'transparent' }} />
                  </tr>
                )}
                <tr style={{ background: GRUP_ZEMIN }} data-grup={grup.key}>
                  <td colSpan={SUTUN - 1} style={{ ...HUCRE, borderTop: GRUP_CIZGI, borderBottom: GRUP_CIZGI, borderLeft: 'none', borderRight: 'none', padding: '9px 12px' }}>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[11.5px] font-bold uppercase" style={{ color: METIN, letterSpacing: '.14em' }}>
                        {grup.ad}
                      </span>
                      <span className="rounded-md px-1.5 text-[10.5px] font-bold tabular-nums leading-[18px]" style={{ background: 'rgba(255,255,255,0.08)', color: IKINCIL }}>
                        {grup.satirlar.length}
                      </span>
                      <span className="ml-auto text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: IKINCIL }}>ara toplam</span>
                    </div>
                  </td>
                  <td style={{ ...HUCRE, borderTop: GRUP_CIZGI, borderBottom: GRUP_CIZGI, borderLeft: 'none', borderRight: 'none', padding: '9px 10px', textAlign: 'right', whiteSpace: 'nowrap' }} title={`${grup.ad} ara toplamı`}>
                    <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: METIN }}>{trMoney(grup.araToplam)}</span>
                  </td>
                </tr>
                {grup.satirlar.map((s, i) => {
                  const vade = vadeDurumu(s);
                  const kaydi = vadeKaydirildi(s);
                  const fis = fisBaglantisi(s);
                  return (
                    <tr key={`${grup.key}-${i}`} className="transition-colors hover:bg-white/[0.03]">
                      <td style={{ ...HUCRE, borderLeft: 'none', minWidth: 0 }}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-[13px] font-medium leading-5" style={{ color: METIN }} title={odemeAdi(s)}>
                            {odemeAdi(s)}
                          </span>
                          {s.taksit && <Cip title={`${s.taksit} taksit`}>{s.taksit} taksit</Cip>}
                          {fis && (
                            <a href={fis} target="_blank" rel="noopener noreferrer" title="Tahakkuk fişini aç (PDF)" className="inline-flex flex-shrink-0 items-center gap-0.5 text-[10.5px] font-semibold hover:underline" style={{ color: GOLD }}>
                              <ExternalLink size={10} /> fiş
                            </a>
                          )}
                        </div>
                      </td>
                      <td style={{ ...HUCRE, whiteSpace: 'nowrap', color: 'rgba(250,250,249,0.78)', fontSize: 12.5 }}>{donemAdi(s.donem)}</td>
                      <td style={{ ...HUCRE, whiteSpace: 'nowrap' }}>
                        <div className="leading-tight">
                          <div className="text-[12.5px] tabular-nums" style={{ color: vade.renk || 'rgba(250,250,249,0.88)' }}>
                            {tarihAdi(s.sonGun)}
                            {vade.etiket && <span className="ml-1.5 text-[10.5px] font-medium">({vade.etiket})</span>}
                          </div>
                          {kaydi && (
                            <div className="text-[10.5px]" style={{ color: IKINCIL }} title={`Asıl gün ${tarihAdi(s.sonGunHam)} hafta sonuna denk geldi; ödeme ilk iş gününe kaydı`}>
                              hafta sonu → ilk iş günü
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ ...HUCRE, borderRight: 'none', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span className="text-[13px] font-semibold tabular-nums" style={{ color: METIN }}>{trMoney(s.tutar)}</span>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {/* Genel toplam */}
            <tr style={{ background: 'rgba(212,184,118,0.05)' }}>
              <td colSpan={SUTUN - 1} style={{ ...HUCRE, borderLeft: 'none', borderRight: 'none', borderTop: '1px solid rgba(212,184,118,0.28)', borderBottom: 'none', padding: '11px 12px' }}>
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.75)' }}>
                  Toplam · {r.satirlar.length} kalem
                </span>
              </td>
              <td style={{ ...HUCRE, borderLeft: 'none', borderRight: 'none', borderTop: '1px solid rgba(212,184,118,0.28)', borderBottom: 'none', padding: '11px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span className="text-[15px] font-bold tabular-nums" style={{ color: GOLD }}>{trMoney(r.toplam)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Başlıkta kaynak bazında gönderim durumu: "Vergi ✓ 12.09" / "SGK — bekliyor" / "Vergi ⚠ hata" */
function GonderimDurumu({ etiket, g, var_ }: { etiket: string; g: GonderimBilgisi | null; var_: boolean }) {
  if (!var_) return null;
  if (!g) {
    return (
      <span className="inline-flex items-center gap-1" title={`${etiket} cetveli henüz gönderilmedi`} style={{ color: SONUK }}>
        {etiket} — bekliyor
      </span>
    );
  }
  const hata = g.status === 'FAILED';
  return (
    <span className="inline-flex items-center gap-1" title={`${etiket}: ${hata ? 'gönderim hatası' : 'gönderildi'}${g.sentAt ? ' · ' + tarihSaat(g.sentAt) : ''}${g.kanallar?.length ? ' · ' + g.kanallar.join(', ') : ''}${g.test ? ' · test alıcısına' : ''}`} style={{ color: hata ? KIRMIZI_YUMUSAK : 'rgba(250,250,249,0.75)' }}>
      {etiket} {hata ? <AlertTriangle size={11} /> : <Check size={11} />} {hata ? 'hata' : g.sentAt ? tarihSaat(g.sentAt).slice(0, 5) : 'gönderildi'}
      {g.test && <span style={{ color: SONUK }}>· test</span>}
    </span>
  );
}
