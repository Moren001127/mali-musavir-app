'use client';

import { Fragment, useMemo } from 'react';
import { ExternalLink, FileDown, Loader2, Mail, MessageCircle, Phone, Printer, SendHorizontal } from 'lucide-react';
import {
  donemAdi, fisBaglantisi, gonderimOzeti, grupla, kalemGonderimParcalari, kanalDugmesi, kaynakDurumYazisi, odemeAdi, tarihAdi, tarihSaat, trMoney, vadeDurumu, vadeKaydirildi,
  KANALLAR, type GonderimBilgisi, type GonderimKanal, type GonderimModu, type KanalDugmeDurumu, type OdemeListesi, type OdemeOzet, type OdemeSatiri,
} from '@/lib/aylik-odeme';
import { Cip, GriDugme, GOLD, GOLD_SOFT, GRUP_BOSLUK, GRUP_CIZGI, GRUP_ZEMIN, HUCRE, HUCRE_BASLIK, IKINCIL, KART, KENAR_NOTR, KIRMIZI_YUMUSAK, METIN, SONUK } from './ortak';

const SUTUN = 5;

export interface CetvelProps {
  r: OdemeListesi;
  ozet?: OdemeOzet;
  /** Şu an gönderilen kanal (yoksa null) */
  gonderilenKanal: GonderimKanal | null;
  ornekGonderiliyor: boolean;
  pdfIniyor: boolean;
  /** Kanal düğmesi — mod düğme durumundan gelir ('yeniden' ise onay penceresi sayfada açılır) */
  onGonder: (kanal: GonderimKanal, mod: GonderimModu, yeniden: boolean) => void;
  onOrnekGonder: () => void;
  onPdf: () => void;
  onYazdir: () => void;
}

/**
 * Sağ cetvel — seçili mükellefin o ayki ödemeleri.
 * Yalnız İKİ bölüm: VERGİ ÖDEMELERİ (aylık + geçici + yıllık, son ödeme gününe göre) ve SGK ÖDEMELERİ; bölüm bandında
 * sol "VERGİ ÖDEMELERİ · 3 kalem", sağda yalnız tutar (etiketsiz); en altta tek TOPLAM satırı.
 * Satır: ödeme adı (+ taksit çipi, + "fiş") · dönem · son ödeme (kaydırma ipucu + vade rengi) · GÖNDERİM (düz yazı) · tutar.
 * Başlık altı gönderim şeridi: "Vergi: 2/3 kalem gönderildi (1 yeni) · SGK: gönderildi 12.09" + WhatsApp / E-posta düğmeleri (AYRI).
 */
export function Cetvel({ r, ozet, gonderilenKanal, ornekGonderiliyor, pdfIniyor, onGonder, onOrnekGonder, onPdf, onYazdir }: CetvelProps) {
  const gruplar = useMemo(() => grupla(r.satirlar), [r.satirlar]);
  const g = useMemo(() => gonderimOzeti(r), [r]);
  const testMode = !!ozet?.testMode;
  const dugmeler = useMemo(() => KANALLAR.map((k) => kanalDugmesi(r, k, { kanallar: ozet?.kanallar || null, testMode })), [r, ozet?.kanallar, testMode]);

  return (
    <div style={KART} data-testid="cetvel">
      {/* Başlık: mükellef + iletişim · Yazdır / PDF / Şablonu bana gönder */}
      <div className="px-4 pt-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
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
          </div>
        </div>

        {/* Gönderim şeridi: durum satırı + kanal düğmeleri */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3" style={{ borderTop: `1px solid ${KENAR_NOTR}` }} data-testid="gonderim-seridi">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px]" style={{ color: IKINCIL }} data-testid="gonderim-durumu">
            {g.kaynaklar.length === 0 ? (
              <span style={{ color: SONUK }}>Ödeme kalemi yok</span>
            ) : (
              g.kaynaklar.map((k, i) => {
                const d = kaynakDurumYazisi(k);
                return (
                  <span key={k.kaynak} className="whitespace-nowrap" title={k.sentAt ? `Son gönderim ${tarihSaat(k.sentAt)}` : undefined}>
                    {i > 0 && <span aria-hidden="true" style={{ color: SONUK }}>· </span>}
                    <span style={{ color: 'rgba(250,250,249,0.78)' }}>{k.kaynak === 'SGK' ? 'SGK' : 'Vergi'}:</span>{' '}
                    <span style={{ color: d.ton === 'hata' ? KIRMIZI_YUMUSAK : d.ton === 'soluk' ? SONUK : IKINCIL }}>{d.yazi}</span>
                  </span>
                );
              })
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 print:hidden" role="group" aria-label="Cetveli gönder">
            {dugmeler.map((d) => (
              <KanalDugmesi
                key={d.kanal}
                d={d}
                yukleniyor={gonderilenKanal === d.kanal}
                disabled={gonderilenKanal !== null}
                onClick={() => onGonder(d.kanal, d.mod, d.yeniden)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Tablo — table-fixed + colgroup: uzun ödeme adı tutarı dışarı taşımasın */}
      <div className="overflow-x-auto" style={{ borderTop: `1px solid ${KENAR_NOTR}` }}>
        <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 720 }}>
          <colgroup>
            <col />
            <col style={{ width: 122 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 176 }} />
            <col style={{ width: 132 }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'rgba(212,184,118,0.07)' }}>
              <th style={{ ...HUCRE_BASLIK, borderLeft: 'none', borderTop: 'none' }}>Ödeme</th>
              <th style={{ ...HUCRE_BASLIK, borderTop: 'none' }}>Dönem</th>
              <th style={{ ...HUCRE_BASLIK, borderTop: 'none' }}>Son ödeme</th>
              <th style={{ ...HUCRE_BASLIK, borderTop: 'none' }}>Gönderim</th>
              <th style={{ ...HUCRE_BASLIK, textAlign: 'right', borderRight: 'none', borderTop: 'none' }}>Tutar</th>
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
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11.5px] font-bold uppercase" style={{ color: METIN, letterSpacing: '.14em' }}>
                        {grup.ad}
                      </span>
                      <span className="text-[11px] font-medium tabular-nums" style={{ color: IKINCIL }}>
                        · {grup.satirlar.length} kalem
                      </span>
                    </div>
                  </td>
                  <td style={{ ...HUCRE, borderTop: GRUP_CIZGI, borderBottom: GRUP_CIZGI, borderLeft: 'none', borderRight: 'none', padding: '9px 10px', textAlign: 'right', whiteSpace: 'nowrap' }} title={`${grup.ad} toplamı`}>
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
                      <td style={{ ...HUCRE, padding: '8px 10px' }} data-testid="kalem-gonderim">
                        <KalemGonderimi s={s} kaynakBilgi={r.gonderim?.[grup.key] || null} />
                      </td>
                      <td style={{ ...HUCRE, borderRight: 'none', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span className="text-[13px] font-semibold tabular-nums" style={{ color: METIN }}>{trMoney(s.tutar)}</span>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {/* Genel toplam — tek satır */}
            <tr style={{ background: 'rgba(212,184,118,0.05)' }} data-testid="genel-toplam">
              <td colSpan={SUTUN - 1} style={{ ...HUCRE, borderLeft: 'none', borderRight: 'none', borderTop: '1px solid rgba(212,184,118,0.28)', borderBottom: 'none', padding: '11px 12px' }}>
                <span className="text-[11.5px] font-bold uppercase" style={{ color: 'rgba(250,250,249,0.78)', letterSpacing: '.14em' }}>
                  Toplam
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

/** GÖNDERİM sütunu — düz yazı: "WhatsApp 12.09 · E-posta 12.09" / "gönderilmedi" (soluk) / "· test" etiketi */
function KalemGonderimi({ s, kaynakBilgi }: { s: OdemeSatiri; kaynakBilgi: GonderimBilgisi | null }) {
  const { parcalar, test } = kalemGonderimParcalari(s, kaynakBilgi);
  if (parcalar.length === 0) {
    return (
      <span className="text-[11.5px]" style={{ color: SONUK }} title="Bu kalem henüz hiçbir kanaldan gönderilmedi">
        gönderilmedi
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11.5px] leading-4" style={{ color: 'rgba(250,250,249,0.78)' }}>
      {parcalar.map((p, i) => (
        <span key={p.kanal} className="whitespace-nowrap" title={`${p.ad} ile gönderildi${p.sentAt ? ' · ' + tarihSaat(p.sentAt) : ''}${p.test ? ' · test alıcısına' : ''}`}>
          {i > 0 && <span aria-hidden="true" style={{ color: SONUK }}>· </span>}
          {p.ad} <span className="tabular-nums">{p.tarih}</span>
        </span>
      ))}
      {test && (
        <span className="whitespace-nowrap" style={{ color: SONUK }} title="Test alıcısına gitti; mükellefe gitmedi">
          · test
        </span>
      )}
    </span>
  );
}

/**
 * Kanal düğmesi (WhatsApp / E-posta) — AYRI iki düğme; altın yalnız burada (panelin ana eylemi).
 * Pasif: kanal kapalı ya da iletişim bilgisi yok → soluk + ipucu.
 */
function KanalDugmesi({ d, yukleniyor, disabled, onClick }: { d: KanalDugmeDurumu; yukleniyor: boolean; disabled: boolean; onClick: () => void }) {
  const pasif = d.pasif || disabled || yukleniyor;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pasif}
      aria-disabled={d.pasif || undefined}
      title={d.ipucu || undefined}
      data-kanal={d.kanal}
      className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-[12px] font-bold transition-[transform,filter] hover:-translate-y-px hover:brightness-110 disabled:hover:translate-y-0 disabled:hover:brightness-100"
      style={{ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b', opacity: d.pasif ? 0.4 : disabled && !yukleniyor ? 0.6 : 1, cursor: d.pasif ? 'not-allowed' : undefined }}
    >
      {yukleniyor ? <Loader2 size={13} className="animate-spin" /> : d.kanal === 'WHATSAPP' ? <MessageCircle size={13} /> : <Mail size={13} />}
      {d.etiket}
    </button>
  );
}
