'use client';
import { useQuery } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { fmtTRY, Section, Empty, Spinner, PageTitle, Th, THead } from '../_lib/shared';
import { Printer, Wallet } from 'lucide-react';

const YESIL = '#4ade80';
const KIRMIZI = '#f87171';

const fmtTarih = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('tr-TR') : '—';
};

function Metric({ label, value, text, tone = 'neutral', suffix }: { label: string; value?: number; text?: string; tone?: 'neutral' | 'good' | 'bad'; suffix?: string }) {
  const color = tone === 'good' ? YESIL : tone === 'bad' ? KIRMIZI : '#fafaf9';
  return (
    <div className="rounded-xl p-4" style={{ background: tone === 'bad' ? 'rgba(248,113,113,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${tone === 'bad' ? 'rgba(248,113,113,0.22)' : 'rgba(255,255,255,0.07)'}` }}>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.10em]" style={{ color: 'rgba(250,250,249,0.4)' }}>{label}</div>
      <div className="mt-2 text-[24px] font-semibold tabular-nums" style={{ color }}>{text ?? fmtTRY(value || 0)}</div>
      {suffix && <div className="mt-1 text-[11px] font-medium" style={{ color }}>{suffix}</div>}
    </div>
  );
}

const TIP_ETIKET: Record<string, string> = { TAHAKKUK: 'Tahakkuk', TAHSILAT: 'Tahsilat', IADE: 'İade', DUZELTME: 'Düzeltme' };

export default function MukellefCari() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-cari'],
    queryFn: () => taxpayerApi.get('/portal/cari').then((r) => r.data),
  });
  const { data: me } = useQuery({ queryKey: ['portal-me'], queryFn: () => taxpayerApi.get('/portal/me').then((r) => r.data) });

  if (isLoading) return (<div><PageTitle ust="Ofis" baslik="Cari Hesabım" icon={Wallet} /><Spinner /></div>);

  const netBakiye = Number(data?.bakiye ?? 0);
  const borclu = netBakiye > 0;
  const hareketler: any[] = data?.hareketler || [];

  const ekstreYazdir = () => {
    const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c]);
    const ad = me?.companyName || [me?.firstName, me?.lastName].filter(Boolean).join(' ') || 'Mükellef';
    const logo = `${window.location.origin}/brand/moren-logo-gold.png`;
    const eskiYeni = [...hareketler].reverse(); // ekstrede eski→yeni
    const satirlar = eskiYeni.map((h) => `<tr>
      <td>${esc(h.tarih ? new Date(h.tarih).toLocaleDateString('tr-TR') : '—')}</td>
      <td>${esc(TIP_ETIKET[h.tip] || h.tip)}</td>
      <td>${esc([h.hizmetAdi, h.aciklama || h.donem].filter(Boolean).join(' · ') || '—')}</td>
      <td class="num">${h.borc ? fmtTRY(h.borc) : '—'}</td>
      <td class="num">${h.alacak ? fmtTRY(h.alacak) : '—'}</td>
      <td class="num">${h.runningBakiye != null ? fmtTRY(h.runningBakiye) : '—'}</td>
    </tr>`).join('');
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Cari Ekstre · ${esc(ad)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#0A1628;margin:24px;font-size:12px}
  .head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #d4b876;padding-bottom:12px;margin-bottom:16px}
  .head img{height:54px} .head .t{text-align:right} .head h1{margin:0;font-size:18px;color:#0A1628} .head p{margin:2px 0 0;color:#555}
  .ozet{display:flex;gap:10px;margin:14px 0}
  .ozet div{flex:1;border:1px solid #e3e3e3;border-radius:8px;padding:8px 12px}
  .ozet span{display:block;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px} .ozet b{font-size:14px}
  table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border-bottom:1px solid #eee;padding:7px 8px;text-align:left}
  th{background:#0A1628;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.4px} .num{text-align:right;font-variant-numeric:tabular-nums}
  .footer{margin-top:20px;text-align:center;color:#999;font-size:10px;border-top:1px solid #eee;padding-top:10px}
  @media print{body{margin:10mm}}
</style></head><body>
  <div class="head">
    <img src="${logo}" alt="Moren">
    <div class="t"><h1>Cari Hesap Ekstresi</h1><p>${esc(ad)}</p><p>${new Date().toLocaleDateString('tr-TR')}</p></div>
  </div>
  <div class="ozet">
    <div><span>Toplam Tahakkuk</span><b>${fmtTRY(data?.tahakkukToplam ?? 0)}</b></div>
    <div><span>Toplam Tahsilat</span><b>${fmtTRY(data?.tahsilatToplam ?? 0)}</b></div>
    <div><span>Açık Bakiye</span><b>${fmtTRY(netBakiye)} ${borclu ? '(Borç)' : ''}</b></div>
  </div>
  <table><thead><tr><th>Tarih</th><th>Tip</th><th>Açıklama</th><th class="num">Borç</th><th class="num">Alacak</th><th class="num">Bakiye</th></tr></thead>
  <tbody>${satirlar || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#999">Hareket yok</td></tr>'}</tbody></table>
  <div class="footer">Moren Mali Müşavirlik · Bu ekstre ${new Date().toLocaleString('tr-TR')} tarihinde portaldan oluşturulmuştur.</div>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.print();},400);});</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Açılır pencere engellendi. Tarayıcıdan bu sayfaya izin verin.'); return; }
    w.document.write(html); w.document.close();
  };

  return (
    <div className="space-y-4">
      <PageTitle ust="Ofis" baslik="Cari Hesabım" icon={Wallet} right={
        <button type="button" onClick={ekstreYazdir} className="inline-flex items-center gap-1.5 h-[36px] px-3 rounded-[10px] text-[12.5px] font-semibold transition hover:brightness-110" style={{ background: 'rgba(212,184,118,0.14)', border: '1px solid rgba(212,184,118,0.3)', color: '#d4b876' }}>
          <Printer size={14} /> Ekstre indir
        </button>
      } />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Toplam tahakkuk" value={data?.tahakkukToplam ?? 0} />
        <Metric label="Toplam tahsilat" value={data?.tahsilatToplam ?? 0} tone="good" />
        <Metric label="Açık bakiye" value={Math.abs(netBakiye)} tone={borclu ? 'bad' : 'good'} suffix={borclu ? 'Borç' : 'Borç yok'} />
        <Metric label="Hareket" text={`${hareketler.length} kayıt`} />
      </div>

      <Section baslik="Cari Hareketler" aciklama="Tahakkuk ve tahsilatlar; yeni tarihliler üstte, sağda yürüyen bakiye.">
        {hareketler.length === 0 ? <div className="px-4 py-5"><Empty>Cari hareket bulunamadı.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <THead>
                <Th>Tarih</Th>
                <Th>Tip</Th>
                <Th>Açıklama</Th>
                <Th align="right">Borç</Th>
                <Th align="right">Alacak</Th>
                <Th align="right">Bakiye</Th>
              </THead>
              <tbody>
                {hareketler.map((h, i) => {
                  const tahsilat = h.tip === 'TAHSILAT';
                  const aciklama = [h.hizmetAdi, h.aciklama || h.donem].filter(Boolean).join(' · ') || '—';
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.055)' }}>
                      <td className="px-4 py-3 text-[12.5px] tabular-nums whitespace-nowrap" style={{ color: 'rgba(250,250,249,0.55)' }}>{fmtTarih(h.tarih)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md px-2 py-1 text-[10.5px] font-bold" style={tahsilat ? { color: YESIL, background: 'rgba(74,222,128,0.10)' } : { color: '#d4b876', background: 'rgba(212,184,118,0.10)' }}>{TIP_ETIKET[h.tip] || h.tip}</span>
                      </td>
                      <td className="px-4 py-3 text-[12.5px] max-w-[360px] truncate" style={{ color: '#fafaf9' }}>{aciklama}</td>
                      <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: h.borc ? KIRMIZI : 'rgba(250,250,249,0.3)' }}>{h.borc ? `${fmtTRY(h.borc)}` : '—'}</td>
                      <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: h.alacak ? YESIL : 'rgba(250,250,249,0.3)' }}>{h.alacak ? `${fmtTRY(h.alacak)}` : '—'}</td>
                      <td className="px-4 py-3 text-right text-[12.5px] font-semibold tabular-nums" style={{ color: '#fafaf9' }}>{h.runningBakiye != null ? `${fmtTRY(h.runningBakiye)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
