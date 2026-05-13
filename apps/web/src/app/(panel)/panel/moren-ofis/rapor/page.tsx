'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, Printer, AlertTriangle, CheckCircle2, Sparkles, Activity, DollarSign, Loader2 } from 'lucide-react';
import { ofisApi, type WeeklyReport } from '@/lib/moren-ofis';

const GOLD = '#d4b876';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtCost(usd: number) {
  if (usd < 0.01) return `${(usd * 100).toFixed(1)}¢`;
  if (usd < 1) return `${(usd * 100).toFixed(0)}¢`;
  return `$${usd.toFixed(2)}`;
}

export default function WeeklyReportPage() {
  const { data, isLoading } = useQuery<WeeklyReport>({
    queryKey: ['weekly-report'],
    queryFn: ofisApi.weeklyReport,
  });

  if (isLoading) {
    return (
      <div className="p-12 text-center text-sm" style={{ color: 'rgba(250,250,249,0.5)' }}>
        <Loader2 size={20} className="animate-spin mx-auto mb-2" />
        Rapor hazırlanıyor...
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header — yazdırma için gizli olacak */}
      <div className="flex items-end justify-between gap-3 no-print">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <FileText size={11} className="inline mr-1" /> DENİZ Raporu
          </div>
          <h1 className="mt-1" style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: '#fafaf9' }}>
            Haftalık Sistem Raporu
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            {fmtDate(data.periodFrom)} — {fmtDate(data.periodTo)}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-3 py-2 rounded-md text-xs font-bold flex items-center gap-1.5"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
        >
          <Printer size={13} /> Yazdır / PDF Olarak Kaydet
        </button>
      </div>

      {/* Rapor içeriği — print için optimize */}
      <article className="report-content space-y-6 rounded-2xl p-6" style={{ background: 'linear-gradient(135deg, rgba(212,184,118,0.04) 0%, rgba(15,11,21,0.85) 100%)', border: '1px solid rgba(212,184,118,0.20)' }}>
        {/* Print kapak başlığı */}
        <header className="print-cover" style={{ borderBottom: `2px solid ${GOLD}`, paddingBottom: 16 }}>
          <p className="text-[11px] uppercase tracking-[.18em] mb-1" style={{ color: GOLD }}>
            Moren Mali Müşavirlik · DENİZ Haftalık Sistem Raporu
          </p>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, color: '#fafaf9', letterSpacing: '-0.02em' }}>
            {data.tenantName || 'Moren Ofis'} — {fmtDate(data.periodTo)}
          </h2>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
            Dönem: {fmtDate(data.periodFrom)} — {fmtDate(data.periodTo)} (son 7 gün)
          </p>
        </header>

        {/* 1) Özet metrikler */}
        <section>
          <h3 className="text-[10px] uppercase font-bold tracking-[.16em] mb-3" style={{ color: GOLD }}>
            1. Genel Özet
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricBox label="DENİZ Önerisi" value={String(data.proposals.length)} icon={Sparkles} />
            <MetricBox label="AI Maliyeti" value={fmtCost(data.aiCost.week)} subtitle={`${data.aiCost.msgCount} mesaj`} icon={DollarSign} />
            <MetricBox label="Tool Çağrı" value={String(data.totalToolCalls)} subtitle={`${data.toolFailures} hata`} icon={Activity} tone={data.toolFailures > data.totalToolCalls * 0.1 ? 'warn' : 'ok'} />
            <MetricBox label="Onay Aksiyonu" value={String(data.pendingActions.total)} subtitle={`${data.pendingActions.applied} uygulandı`} icon={CheckCircle2} />
          </div>
        </section>

        {/* 2) Öneriler */}
        <section>
          <h3 className="text-[10px] uppercase font-bold tracking-[.16em] mb-3" style={{ color: GOLD }}>
            2. DENİZ Önerileri ({data.proposals.length})
          </h3>
          {data.proposals.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Bu hafta öneri üretilmedi.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(data.proposalsByStatus).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {Object.entries(data.proposalsByStatus).map(([s, c]) => (
                    <span key={s} className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded" style={{ background: 'rgba(212,184,118,0.10)', color: GOLD }}>
                      {s}: {c}
                    </span>
                  ))}
                </div>
              )}
              {data.proposals.slice(0, 10).map((p) => (
                <div key={p.id} className="px-3 py-2 rounded" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-[1px] rounded" style={{ background: p.priority === 'high' ? 'rgba(239,68,68,0.20)' : p.priority === 'medium' ? 'rgba(245,158,11,0.20)' : 'rgba(107,114,128,0.20)', color: p.priority === 'high' ? '#fca5a5' : p.priority === 'medium' ? '#fcd34d' : '#9ca3af' }}>
                      {p.priority}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgba(250,250,249,0.55)' }}>{p.category} · {p.status}</span>
                    <span className="text-[10px] ml-auto" style={{ color: 'rgba(250,250,249,0.4)' }}>
                      {fmtDate(p.createdAt)}
                    </span>
                  </div>
                  <p className="text-[12.5px] font-semibold" style={{ color: '#fafaf9' }}>{p.title}</p>
                  <p className="text-[11.5px] mt-0.5 line-clamp-3" style={{ color: 'rgba(250,250,249,0.7)' }}>{p.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3) Tool kullanımı */}
        <section>
          <h3 className="text-[10px] uppercase font-bold tracking-[.16em] mb-3" style={{ color: GOLD }}>
            3. AI Tool Kullanımı (en çok 10)
          </h3>
          {data.toolStats.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'rgba(250,250,249,0.5)' }}>Bu hafta tool çağrısı kaydı yok.</p>
          ) : (
            <table className="w-full text-[11.5px]">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <th className="text-left py-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Tool</th>
                  <th className="text-right py-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Çağrı</th>
                  <th className="text-right py-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>Hata %</th>
                </tr>
              </thead>
              <tbody>
                {data.toolStats.slice(0, 10).map((t) => (
                  <tr key={t.tool} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="py-1.5 font-mono" style={{ color: GOLD }}>{t.tool}</td>
                    <td className="text-right py-1.5" style={{ color: '#fafaf9' }}>{t.count}</td>
                    <td className="text-right py-1.5 font-mono" style={{ color: t.failureRate > 0.1 ? '#fca5a5' : 'rgba(250,250,249,0.7)' }}>
                      {(t.failureRate * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 4) Onay kuyruğu */}
        <section>
          <h3 className="text-[10px] uppercase font-bold tracking-[.16em] mb-3" style={{ color: GOLD }}>
            4. Onay Kuyruğu (PendingAction)
          </h3>
          <div className="grid grid-cols-4 gap-3">
            <MetricBox label="Toplam" value={String(data.pendingActions.total)} />
            <MetricBox label="Onaylı" value={String(data.pendingActions.approved)} tone="ok" />
            <MetricBox label="Reddedildi" value={String(data.pendingActions.rejected)} />
            <MetricBox label="Uygulandı" value={String(data.pendingActions.applied)} tone="ok" />
          </div>
        </section>

        <footer className="text-[10px] pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.4)' }}>
          Bu rapor Moren AI sistemi tarafından otomatik üretildi · {new Date().toLocaleString('tr-TR')}
        </footer>
      </article>

      <style jsx global>{`
        @media print {
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
          .report-content {
            background: white !important;
            border: none !important;
            color: black !important;
            padding: 0 !important;
          }
          .report-content h3 { color: #b8860b !important; }
          .report-content span,
          .report-content p,
          .report-content td,
          .report-content th { color: black !important; }
          .print-cover h2 { color: black !important; }
        }
      `}</style>
    </div>
  );
}

function MetricBox({ label, value, subtitle, icon: Icon, tone }: { label: string; value: string; subtitle?: string; icon?: any; tone?: 'ok' | 'warn' }) {
  const color = tone === 'warn' ? '#fbbf24' : '#fafaf9';
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(212,184,118,0.05)', border: '1px solid rgba(212,184,118,0.15)' }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={11} style={{ color: GOLD, opacity: 0.7 }} />}
        <span className="text-[9.5px] uppercase font-bold tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.55)' }}>
          {label}
        </span>
      </div>
      <p style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </p>
      {subtitle && (
        <p className="text-[10px] mt-1" style={{ color: 'rgba(250,250,249,0.5)' }}>{subtitle}</p>
      )}
    </div>
  );
}
