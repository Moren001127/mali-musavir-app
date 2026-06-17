'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, Empty, Spinner, PageTitle, Section, openBelge, ozetBelge } from '../_lib/shared';
import { Eye, Sparkles } from 'lucide-react';

// Beyanname türü etiketleri — müşavir Beyanname Listesi ile aynı.
const TIP_ETIKET: Record<string, string> = {
  KDV1: "KDV (1 No'lu)", KDV2: 'KDV Tevkifat (2)', KDV4: 'KDV (4 No\'lu)', KDV9015: 'KDV 9015',
  MUHSGK: 'MUHSGK', MUHSGK2: 'MUHSGK (2)', DAMGA: 'Damga Vergisi', POSET: 'Poşet Beyan.',
  KURUMLAR: 'Kurumlar V.', GELIR: 'Gelir V.', BILDIRGE: 'SGK Bildirge', EDEFTER: 'E-Defter',
  GGECICI: 'Gelir Geçici', KGECICI: 'Kurum Geçici', GECICI_VERGI: 'Geçici Vergi', DIGER: 'Diğer',
};

function fmtDonem(donem: string): string {
  const q = donem.match(/^(\d{4})-Q([1-4])$/i);
  if (q) { const s = (Number(q[2]) - 1) * 3 + 1; return `${q[1]}/${s} - ${q[1]}/${s + 2}`; }
  const m = donem.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}/${Number(m[2])}`;
  const y = donem.match(/^(\d{4})-YIL$/);
  if (y) return y[1];
  return donem;
}
const fmtDate = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : null;
};

type Kayit = {
  id: string; beyanTipi: string; donem: string; beyanTarihi: string | null; createdAt: string;
  tahakkukTutari: number | null; onayNo: string | null; mahiyet: 'ASIL' | 'DUZELTME';
  hasBeyanname: boolean; hasTahakkuk: boolean; hasXml: boolean;
};

export default function MukellefBeyannameler() {
  const { data = [], isLoading } = useQuery<Kayit[]>({
    queryKey: ['portal-beyannameler'],
    queryFn: () => taxpayerApi.get('/portal/beyannameler').then((r) => r.data),
  });

  const liste: Kayit[] = Array.isArray(data) ? data : [];
  // Her kayıt iki satır: EBeyanname + Tahakkuk (müşavir Beyanname Listesi ile aynı).
  const rows = liste.flatMap((k) => [
    { key: `${k.id}:b`, k, kind: 'beyanname' as const, tur: 'EBeyanname', hasFile: k.hasBeyanname },
    { key: `${k.id}:t`, k, kind: 'pdf' as const, tur: 'Tahakkuk', hasFile: k.hasTahakkuk },
  ]);

  return (
    <div className="space-y-4">
      <PageTitle ust="Vergi & Beyan" baslik="Beyannamelerim" />

      {isLoading ? <Spinner /> : (
        <Section
          baslik="Beyanname Listesi"
          aciklama="Tarihe göre yeni kayıtlar üstte gösterilir. Beyanname aslını ve tahakkuk fişini görüntüleyebilirsiniz."
        >
          {rows.length === 0 ? <div className="p-6"><Empty>Henüz beyanname kaydı yok.</Empty></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead style={{ background: 'rgba(255,255,255,0.025)' }}>
                  <tr className="text-left uppercase tracking-[.12em] text-[10.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    <th className="px-3 py-3 w-[160px] whitespace-nowrap">Beyanname Dönemi</th>
                    <th className="px-3 py-3">Beyanname Türü</th>
                    <th className="px-3 py-3">Belge Mahiyeti</th>
                    <th className="px-3 py-3">Tür</th>
                    <th className="px-3 py-3">Tutar</th>
                    <th className="px-3 py-3 w-[90px] text-right">Görüntüle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => {
                    const k = item.k;
                    const tarih = fmtDate(k.beyanTarihi || k.createdAt);
                    return (
                      <tr key={item.key} style={{ borderTop: '1px solid rgba(255,255,255,0.055)' }}>
                        <td className="px-3 py-3">
                          <div className="whitespace-nowrap font-semibold tabular-nums" style={{ color: '#fafaf9' }}>{fmtDonem(k.donem)}</div>
                          {tarih && <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.42)' }}>{tarih}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold" style={{ color: '#fafaf9' }}>{k.beyanTipi}</div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.42)' }}>{TIP_ETIKET[k.beyanTipi] || k.beyanTipi}</div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-[12.5px] font-semibold" style={{ color: 'rgba(250,250,249,0.85)' }}>{k.mahiyet === 'DUZELTME' ? 'DÜZELTME' : 'ASIL'}</span>
                        </td>
                        <td className="px-3 py-3" style={{ color: '#fafaf9' }}>{item.tur}</td>
                        <td className="px-3 py-3">
                          {item.kind === 'pdf' ? (
                            <>
                              <div className="font-semibold tabular-nums" style={{ color: k.tahakkukTutari != null ? '#fafaf9' : 'rgba(250,250,249,0.4)' }}>
                                {k.tahakkukTutari != null ? fmtTRY(k.tahakkukTutari) : '—'}
                              </div>
                              {k.tahakkukTutari != null && <div className="text-[10.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.36)' }}>Tahakkuk tutarı</div>}
                            </>
                          ) : <span style={{ color: 'rgba(250,250,249,0.25)' }}>—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-1.5">
                            {item.hasFile ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => ozetBelge('beyanname', k.id, item.kind, `${k.beyanTipi} ${fmtDonem(k.donem)} ${item.tur}`)}
                                  title="MOREN AI ile özetle"
                                  className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
                                  style={{ border: '1px solid rgba(184,160,111,0.4)', color: '#d4b876', background: 'rgba(184,160,111,0.1)' }}
                                >
                                  <Sparkles size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openBelge('beyanname', k.id, item.kind, `${k.beyanTipi} ${fmtDonem(k.donem)} ${item.tur}`)}
                                  title={item.kind === 'pdf' ? 'Tahakkuk fişini görüntüle' : 'Beyannameyi görüntüle'}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/[0.06]"
                                  style={{ border: '1px solid rgba(244,63,94,0.25)', color: '#fda4af', background: 'rgba(244,63,94,0.08)' }}
                                >
                                  <Eye size={15} />
                                </button>
                              </>
                            ) : (
                              <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.25)' }}>
                                <Eye size={15} />
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
