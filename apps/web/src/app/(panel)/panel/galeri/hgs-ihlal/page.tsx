'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { galeriApi, Arac } from '@/lib/galeri';
import {
  Gavel, Plus, Search, Trash2, ExternalLink, RefreshCw, Car,
  CheckCircle2, AlertCircle, Clock, X as IconX, Save,
  PlayCircle, Bot, FileText, Terminal, Square, ChevronDown, ChevronUp,
  ArrowLeft, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ── Tema: camgöbeği / gece mavisi (turuncu yok) ──
const ACCENT = '#22d3ee';        // camgöbeği — başlık + ana aksiyonlar
const ACCENT_DEEP = '#0891b2';
const INK = '#062c33';           // degrade üstü koyu yazı/ikon
const ROSE = '#f43f5e';          // ihlal
const AMBER = '#fbbf24';         // tutar / uyarı
const GREEN = '#22c55e';         // sorunsuz / başarılı
const KGM_URL = 'https://webihlaltakip.kgm.gov.tr/WebIhlalSorgulama/Sayfalar/Sorgulama.aspx?lang=tr';

function fmtTarih(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtTL(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n) + ' ₺';
}

export default function HgsIhlalPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const { data: araclar = [], isLoading } = useQuery({
    queryKey: ['galeri-araclar', search],
    queryFn: () => galeriApi.listAraclar({ search: search || undefined }),
  });

  const { data: ozet } = useQuery({
    queryKey: ['galeri-ozet'],
    queryFn: () => galeriApi.ozet(),
  });

  // Agent durumu — her 15 saniyede bir yenile, çalışan komut varken her 3 saniye
  const { data: agentInfo } = useQuery({
    queryKey: ['galeri-agent-durumu'],
    queryFn: () => galeriApi.agentDurumu(),
    refetchInterval: (q) => ((q.state.data as any)?.aktifKomut ? 3000 : 15000),
  });

  // Aktif veya son komutun log'larını çek (aktifse 2sn polling, son komut için tek seferlik)
  const aktifKomutId = (agentInfo as any)?.aktifKomut?.id;
  const sonKomutId = (agentInfo as any)?.sonKomut?.id;
  const izlenenKomutId = aktifKomutId || sonKomutId;
  const [logsOpen, setLogsOpen] = useState(true);
  const { data: izlenenKomutDetay } = useQuery({
    queryKey: ['agent-command-detail', izlenenKomutId],
    queryFn: async () => {
      if (!izlenenKomutId) return null;
      const { data } = await api.get(`/agent/commands-jwt/${izlenenKomutId}`);
      return data;
    },
    enabled: !!izlenenKomutId,
    // Aktif komut varsa 2sn'de bir, sadece son komut görüntüleniyorsa 15sn'de bir (statik)
    refetchInterval: aktifKomutId ? 2000 : (izlenenKomutId ? 15000 : false),
  });
  const canliLoglar = ((izlenenKomutDetay as any)?.result?.logs || []) as Array<{ ts: string; level: string; message: string }>;
  const izlenenKomutStatus = (izlenenKomutDetay as any)?.status;

  // Komut iptal mutation
  const iptalMut = useMutation({
    mutationFn: async () => {
      if (!aktifKomutId) throw new Error('Aktif komut yok');
      const { data } = await api.post(`/agent/commands/${aktifKomutId}/cancel`);
      return data;
    },
    onSuccess: () => {
      toast.success('İptal komutu gönderildi — agent bir sonraki plakada duracak');
      qc.invalidateQueries({ queryKey: ['galeri-agent-durumu'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'İptal başarısız'),
  });

  // Log paneli en alta otomatik kaydır
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current && logsOpen) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [canliLoglar.length, logsOpen]);

  // Toplu sorgu başlatma mutation — AgentCommand tablosuna komut yazar
  const topluSorguMut = useMutation({
    mutationFn: () => galeriApi.baslatTopluSorgu({ sadeceAktif: true }),
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.mesaj || 'Toplu sorgu komutu oluşturuldu');
      } else {
        toast.error(data.sebep || 'Sorgu başlatılamadı');
      }
      qc.invalidateQueries({ queryKey: ['galeri-agent-durumu'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Bir hata oluştu');
    },
  });

  // Tek araç için sorgu — satırın yanındaki butona basınca agent o plakayı sorgular
  const tekAracSorguMut = useMutation({
    mutationFn: (aracId: string) => galeriApi.baslatTopluSorgu({ aracIds: [aracId], sadeceAktif: true }),
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.mesaj || 'Sorgu komutu oluşturuldu — agent yakında çalıştıracak');
      } else {
        toast.error(data.sebep || 'Sorgu başlatılamadı');
      }
      qc.invalidateQueries({ queryKey: ['galeri-agent-durumu'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Bir hata oluştu');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => galeriApi.deleteArac(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['galeri-araclar'] });
      qc.invalidateQueries({ queryKey: ['galeri-ozet'] });
      toast.success('Araç silindi');
    },
  });

  const agentCalisiyor = !!agentInfo?.aktifKomut;

  return (
    <div className="space-y-4 max-w-7xl pb-12">
      {/* ═══ BAŞLIK (camgöbeği / gece mavisi) ═══ */}
      <header
        className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(34,211,238,0.16), transparent 45%), radial-gradient(120% 140% at 100% 0%, rgba(59,130,246,0.12), transparent 45%), #0f0d0b',
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #22d3ee, #38bdf8, #60a5fa, #818cf8)' }} />
        <Link href="/panel" className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'rgba(250,250,249,0.58)' }}>
          <ArrowLeft size={14} /> Panel
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>
            <span
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`, boxShadow: '0 6px 18px rgba(34,211,238,0.32)' }}
            >
              <Gavel size={22} style={{ color: INK }} />
            </span>
            HGS İhlal Sorgulama
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={KGM_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 px-[18px] py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.85)' }}
            >
              <ExternalLink size={14} /> KGM Sitesini Aç
            </a>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`, color: INK }}
            >
              <Plus size={14} /> Araç Ekle
            </button>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-[13px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
          Araç plakalarını kaydet, KGM sisteminden ihlalli geçişlerini sorgula ve raporla.
        </p>
      </header>

      {/* ═══ ÖZET KARTLARI ═══ */}
      {ozet && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OzetCard label="Toplam Araç" value={ozet.toplamArac} icon={Car} color={ACCENT} />
          <OzetCard label="İhlalli Araç" value={ozet.ihlalliArac} icon={AlertCircle} color={ozet.ihlalliArac > 0 ? ROSE : GREEN} />
          <OzetCard label="Toplam İhlal" value={ozet.toplamIhlal} icon={Gavel} color={AMBER} />
          <OzetCard label="Toplam Tutar" value={fmtTL(ozet.toplamTutar)} icon={Wallet} color="#818cf8" />
        </div>
      )}

      {/* ═══ OTOMASYON KOMUT KARTI (canlı log entegre) ═══ */}
      <section
        className="relative overflow-hidden rounded-2xl border"
        style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${ACCENT}, #818cf8, transparent)` }} />
        <div className="p-5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.25)' }}
            >
              <Bot size={19} style={{ color: ACCENT }} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>Otomatik HGS Sorgu</span>
                {agentInfo?.canli ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: GREEN }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: GREEN }} /> Agent Çevrimiçi
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(250,250,249,0.05)', color: 'rgba(250,250,249,0.5)' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(250,250,249,0.4)' }} /> Agent Kapalı
                  </span>
                )}
              </div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
                {agentInfo?.aktifKomut
                  ? <>Çalışıyor — <b>{agentInfo.aktifKomut.status === 'running' ? 'işleme alındı' : 'kuyrukta'}</b></>
                  : agentInfo?.sonKomut
                    ? <>Son sorgu: <b>{fmtTarih(agentInfo.sonKomut.finishedAt || agentInfo.sonKomut.createdAt)}</b></>
                    : 'Manuel başlatabilirsin'}
              </div>
            </div>
          </div>
          <button
            onClick={() => topluSorguMut.mutate()}
            disabled={topluSorguMut.isPending || agentCalisiyor}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold rounded-[10px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`, color: INK }}
          >
            {topluSorguMut.isPending
              ? <><RefreshCw size={14} className="animate-spin" /> Başlatılıyor...</>
              : agentCalisiyor
                ? <><Clock size={14} /> Çalışıyor...</>
                : <><PlayCircle size={14} /> Toplu Sorgu Başlat</>}
          </button>
          <button
            onClick={() => {
              galeriApi.acPdfRapor({ sadeceIhlalli: false })
                .catch((err) => toast.error(err?.message || 'PDF açılamadı'));
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium rounded-[10px] transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.85)' }}
          >
            <FileText size={14} /> PDF Rapor
          </button>
          {!!aktifKomutId && (
            <button
              onClick={() => {
                if (confirm('Çalışan toplu sorguyu iptal etmek istiyor musun? Agent bir sonraki plakada duracak.')) {
                  iptalMut.mutate();
                }
              }}
              disabled={iptalMut.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium rounded-[10px] transition-all disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}
            >
              <Square size={14} /> İptal Et
            </button>
          )}
        </div>

        {/* Canlı / son sorgu logları — komut kartının içinde açılır bölüm */}
        {!!izlenenKomutId && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={() => setLogsOpen(!logsOpen)}
              className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-white/[0.02] transition-colors"
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: ACCENT }}>
                <Terminal size={14} /> {aktifKomutId ? 'Canlı Agent Logları' : 'Son Sorgu Logları'}
                {aktifKomutId ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(34,197,94,0.15)', color: GREEN }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: GREEN }} /> CANLI · {canliLoglar.length} satır
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ml-1"
                    style={{
                      background: izlenenKomutStatus === 'done' ? 'rgba(34,197,94,0.12)' : izlenenKomutStatus === 'failed' ? 'rgba(239,68,68,0.12)' : izlenenKomutStatus === 'cancelled' ? 'rgba(250,204,21,0.12)' : 'rgba(250,250,249,0.06)',
                      color: izlenenKomutStatus === 'done' ? GREEN : izlenenKomutStatus === 'failed' ? '#ef4444' : izlenenKomutStatus === 'cancelled' ? '#facc15' : 'rgba(250,250,249,0.6)',
                    }}
                  >
                    {izlenenKomutStatus === 'done' ? 'TAMAMLANDI' : izlenenKomutStatus === 'failed' ? 'HATALI' : izlenenKomutStatus === 'cancelled' ? 'İPTAL' : 'BİTTİ'} · {canliLoglar.length} satır
                  </span>
                )}
              </span>
              {logsOpen ? <ChevronUp size={14} style={{ color: 'rgba(250,250,249,0.5)' }} /> : <ChevronDown size={14} style={{ color: 'rgba(250,250,249,0.5)' }} />}
            </button>
            {logsOpen && (
              <div
                ref={logRef}
                className="px-5 py-3 max-h-[280px] overflow-y-auto font-mono text-[11.5px] leading-[1.55]"
                style={{ background: 'rgba(0,0,0,0.4)', borderTop: '1px solid rgba(255,255,255,0.04)' }}
              >
                {canliLoglar.length === 0 ? (
                  <div style={{ color: 'rgba(250,250,249,0.4)' }}>
                    {aktifKomutId ? 'Henüz log yok — agent komutu işlemeye başlamak üzere…' : 'Son sorgu için log kaydı bulunamadı (eski sorgular log akışı eklemeden önce yapılmış olabilir).'}
                  </div>
                ) : (
                  canliLoglar.map((l, i) => {
                    const t = new Date(l.ts).toLocaleTimeString('tr-TR', { hour12: false });
                    const c = l.level === 'warn' ? '#fbbf24' : l.level === 'error' ? '#ef4444' : 'rgba(250,250,249,0.85)';
                    return (
                      <div key={i} style={{ color: c, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        <span style={{ color: 'rgba(250,250,249,0.35)' }}>[{t}]</span> {l.message}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══ ARAÇ LİSTESİ ═══ */}
      <section className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: '#fafaf9' }}>
            <Car size={16} style={{ color: ACCENT }} /> Araçlar
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,211,238,0.12)', color: ACCENT }}>
              {araclar.length}
            </span>
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'rgba(250,250,249,0.4)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Plaka, marka, model, sahip ara..."
              className="w-full pl-9 pr-3 py-2 text-[13px] rounded-lg outline-none"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="px-5 py-16 text-center text-[13px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <RefreshCw size={18} className="animate-spin inline mr-2" /> Yükleniyor...
          </div>
        ) : araclar.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Car className="w-12 h-12 mx-auto mb-4" style={{ color: 'rgba(250,250,249,0.2)' }} />
            <p className="text-[14px]" style={{ color: 'rgba(250,250,249,0.55)' }}>
              {search ? 'Aramaya uyan araç yok.' : 'Henüz araç kaydedilmemiş.'}
            </p>
            {!search && (
              <button onClick={() => setAddOpen(true)} className="mt-4 text-[13px] font-semibold" style={{ color: ACCENT }}>
                + İlk aracı ekle
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ color: 'rgba(250,250,249,0.85)' }}>
              <thead style={{ background: 'rgba(255,255,255,0.025)' }}>
                <tr className="text-left text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(250,250,249,0.5)' }}>
                  <th className="px-4 py-3">Plaka</th>
                  <th className="px-4 py-3">Marka / Model</th>
                  <th className="px-4 py-3">Sahip</th>
                  <th className="px-4 py-3">Son Sorgu</th>
                  <th className="px-4 py-3 text-right">İhlal</th>
                  <th className="px-4 py-3 text-right">Tutar</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {araclar.map((a: Arac) => (
                  <AracRow
                    key={a.id}
                    arac={a}
                    onDelete={() => deleteMut.mutate(a.id)}
                    onSorgula={(aracId) => tekAracSorguMut.mutate(aracId)}
                    sorguPending={tekAracSorguMut.isPending && tekAracSorguMut.variables === a.id}
                    sorguDisabled={agentCalisiyor}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bilgilendirme */}
      <div className="rounded-xl p-4 text-[12px] flex items-start gap-2.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.7)' }}>
        <span className="mt-0.5 flex-shrink-0 grid h-5 w-5 place-items-center rounded-md" style={{ background: 'rgba(34,211,238,0.12)', color: ACCENT }}>i</span>
        <span>
          <strong style={{ color: ACCENT }}>Otomatik sorgu:</strong> Chrome eklentisi her Pazartesi sabahı tüm araçları tek tek sorgulayıp sonuçları buraya kaydedebilir. Manuel sorgu için satırdaki <b>Sorgula</b>, sonucu elle girmek için <b>Sonuç</b> butonunu kullan.
        </span>
      </div>

      {/* Araç ekleme modal */}
      {addOpen && <AddAracModal onClose={() => setAddOpen(false)} onDone={() => {
        qc.invalidateQueries({ queryKey: ['galeri-araclar'] });
        qc.invalidateQueries({ queryKey: ['galeri-ozet'] });
      }} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PLAKA ROZETİ
// ════════════════════════════════════════════════════════════
function PlateBadge({ text, size = 'md' }: { text: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex items-center rounded-md font-bold tabular-nums ${size === 'sm' ? 'px-2 py-0.5 text-[12px]' : 'px-2.5 py-1 text-[13px]'}`}
      style={{ background: 'rgba(34,211,238,0.09)', border: '1px solid rgba(34,211,238,0.28)', color: '#67e8f9', fontFamily: 'JetBrains Mono, monospace' }}
    >
      {text}
    </span>
  );
}

// ════════════════════════════════════════════════════════════
// OZET CARD
// ════════════════════════════════════════════════════════════
function OzetCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: any; color: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4"
      style={{ borderColor: `${color}40`, background: `linear-gradient(135deg, ${color}22, ${color}0a 58%, rgba(255,255,255,0.02))` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold tracking-[.16em]" style={{ color: 'rgba(250,250,249,0.55)' }}>{label}</span>
        <span className="grid h-7 w-7 place-items-center rounded-lg flex-shrink-0" style={{ background: `${color}22`, border: `1px solid ${color}40` }}>
          <Icon size={14} style={{ color }} />
        </span>
      </div>
      <div className="mt-3 text-[26px] font-semibold tabular-nums leading-none" style={{ color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ARAC SATIRI
// ════════════════════════════════════════════════════════════
function AracRow({
  arac,
  onDelete,
  onSorgula,
  sorguPending,
  sorguDisabled,
}: {
  arac: Arac;
  onDelete: () => void;
  onSorgula: (aracId: string) => void;
  sorguPending: boolean;
  sorguDisabled: boolean;
}) {
  const [sonucOpen, setSonucOpen] = useState(false);
  const s = arac.sonSorgu;
  const ihlalliMi = (s?.ihlalSayisi || 0) > 0;

  return (
    <>
      <tr className="group transition-colors hover:bg-white/[0.02]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <td className="px-4 py-2.5">
          <PlateBadge text={arac.plakaGorunum || arac.plaka} />
        </td>
        <td className="px-4 py-2.5 text-[12.5px]">
          {arac.marka || arac.model
            ? <span>{arac.marka} {arac.model && <span style={{ color: 'rgba(250,250,249,0.5)' }}>{arac.model}</span>}</span>
            : <span style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>}
        </td>
        <td className="px-4 py-2.5 text-[12.5px]">
          {arac.sahipAd || <span style={{ color: 'rgba(250,250,249,0.35)' }}>—</span>}
        </td>
        <td className="px-4 py-2.5 text-[12px]">
          {s ? (
            <div className="flex items-center gap-2">
              {s.durum === 'basarili' && <CheckCircle2 size={13} style={{ color: GREEN }} />}
              {s.durum === 'hatali' && <AlertCircle size={13} style={{ color: '#ef4444' }} />}
              {s.durum === 'beklemede' && <Clock size={13} style={{ color: AMBER }} />}
              <span style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtTarih(s.sorguTarihi)}</span>
            </div>
          ) : <span style={{ color: 'rgba(250,250,249,0.35)' }}>henüz yok</span>}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={{ fontFamily: 'JetBrains Mono, monospace', color: ihlalliMi ? ROSE : GREEN }}>
          {s ? s.ihlalSayisi : '—'}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', color: ihlalliMi ? AMBER : 'rgba(250,250,249,0.6)' }}>
          {s ? fmtTL(s.toplamTutar) : '—'}
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={() => onSorgula(arac.id)}
              disabled={sorguPending || sorguDisabled}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-md transition inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`, color: INK }}
              title="Agent ile arka planda sorgula"
            >
              {sorguPending
                ? <><RefreshCw size={11} className="animate-spin" /> Gönderiliyor</>
                : sorguDisabled
                  ? <><Clock size={11} /> Bekliyor</>
                  : <><PlayCircle size={11} /> Sorgula</>}
            </button>
            <button
              onClick={() => setSonucOpen(true)}
              className="text-[11px] font-medium px-2.5 py-1.5 rounded-md transition inline-flex items-center gap-1"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(250,250,249,0.8)' }}
              title="Sonuç kaydet"
            >
              <Save size={11} /> Sonuç
            </button>
            <button
              onClick={() => {
                if (confirm(`${arac.plakaGorunum || arac.plaka} aracını silmek istediğine emin misin?\nTüm sorgu geçmişi de silinir.`)) {
                  onDelete();
                }
              }}
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-rose-500/10 transition"
              style={{ color: 'rgba(244,63,94,0.7)' }}
              title="Aracı sil"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>
      {sonucOpen && <SonucKaydetModal arac={arac} onClose={() => setSonucOpen(false)} />}
    </>
  );
}

// ════════════════════════════════════════════════════════════
// ARAC EKLE MODAL
// ════════════════════════════════════════════════════════════
function AddAracModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [plaka, setPlaka] = useState('');
  const [marka, setMarka] = useState('');
  const [model, setModel] = useState('');
  const [sahipAd, setSahipAd] = useState('');
  const [notlar, setNotlar] = useState('');

  const createMut = useMutation({
    mutationFn: () => galeriApi.createArac({ plaka, marka: marka || undefined, model: model || undefined, sahipAd: sahipAd || undefined, notlar: notlar || undefined }),
    onSuccess: () => {
      toast.success('Araç eklendi');
      onDone();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Eklenemedi'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-2xl overflow-hidden" style={{ background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${ACCENT}, #818cf8, transparent)` }} />
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: '#fafaf9' }}>
            <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})` }}><Car size={16} style={{ color: INK }} /></span>
            Araç Ekle
          </h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200"><IconX size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Plaka" required>
            <input value={plaka} onChange={(e) => setPlaka(e.target.value.toUpperCase())} placeholder="34 ABC 123" autoFocus
              className="w-full px-3 py-2 rounded-md text-[14px] font-mono outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marka (ops.)">
              <input value={marka} onChange={(e) => setMarka(e.target.value)} placeholder="Ford"
                className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
            </Field>
            <Field label="Model (ops.)">
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Transit"
                className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
            </Field>
          </div>
          <Field label="Sahip / Müşteri Adı (ops.)">
            <input value={sahipAd} onChange={(e) => setSahipAd(e.target.value)} placeholder="Örn: Ahmet Yılmaz Galerisi"
              className="w-full px-3 py-2 rounded-md text-[13px] outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
          </Field>
          <Field label="Notlar (ops.)">
            <textarea value={notlar} onChange={(e) => setNotlar(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-md text-[13px] outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
          </Field>
        </div>
        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium rounded-md"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>İptal</button>
          <button onClick={() => createMut.mutate()} disabled={!plaka.trim() || createMut.isPending}
            className="px-5 py-2 text-[12.5px] font-bold rounded-md disabled:opacity-40 inline-flex items-center gap-1.5"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`, color: INK }}>
            <Plus size={13} /> {createMut.isPending ? 'Ekleniyor...' : 'Ekle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// SORGU SONUÇ KAYDET MODAL (manuel)
// ════════════════════════════════════════════════════════════
function SonucKaydetModal({ arac, onClose }: { arac: Arac; onClose: () => void }) {
  const qc = useQueryClient();
  const [ihlalSayisi, setIhlalSayisi] = useState('0');
  const [toplamTutar, setToplamTutar] = useState('');
  const [notlar, setNotlar] = useState('');

  const { data: gecmis = [] } = useQuery({
    queryKey: ['galeri-hgs-gecmis', arac.id],
    queryFn: () => galeriApi.sorguGecmisi(arac.id),
  });

  const kaydetMut = useMutation({
    mutationFn: () => galeriApi.kaydetSorgu(arac.id, {
      durum: 'basarili' as const,
      ihlalSayisi: parseInt(ihlalSayisi) || 0,
      toplamTutar: toplamTutar ? parseFloat(toplamTutar.replace(',', '.')) : null,
      detaylar: notlar ? { not: notlar } : null,
      kaynak: 'manuel' as const,
    } as any),
    onSuccess: () => {
      toast.success('Sorgu sonucu kaydedildi');
      qc.invalidateQueries({ queryKey: ['galeri-araclar'] });
      qc.invalidateQueries({ queryKey: ['galeri-ozet'] });
      qc.invalidateQueries({ queryKey: ['galeri-hgs-gecmis', arac.id] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Kayıt başarısız'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col" style={{ background: '#0f0d0b', border: '1px solid rgba(255,255,255,0.1)', maxHeight: '85vh' }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${ACCENT}, #818cf8, transparent)` }} />
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <h3 className="text-[17px] font-semibold" style={{ color: '#fafaf9' }}>HGS Sorgu Sonucu</h3>
            <PlateBadge text={arac.plakaGorunum || arac.plaka} size="sm" />
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200"><IconX size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* KGM'ye yönlendirme */}
          <a
            href={KGM_URL}
            target="_blank"
            rel="noopener"
            className="block rounded-xl p-4 transition"
            style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.25)' }}
          >
            <div className="flex items-center gap-3">
              <ExternalLink size={16} style={{ color: ACCENT }} />
              <div className="flex-1">
                <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                  1) KGM sitesini aç ve plakayı sorgula
                </div>
                <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.6)' }}>
                  webihlaltakip.kgm.gov.tr — CAPTCHA çöz, plaka "{arac.plakaGorunum}" yaz, Sorgula
                </div>
              </div>
            </div>
          </a>

          {/* Sonuç giriş formu */}
          <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <h4 className="text-[13px] font-semibold mb-3" style={{ color: '#fafaf9' }}>2) Sonucu buraya kaydet</h4>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="İhlal Sayısı">
                <input type="number" min="0" value={ihlalSayisi} onChange={(e) => setIhlalSayisi(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-[14px] tabular-nums outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }} />
              </Field>
              <Field label="Toplam Tutar (TL)">
                <input type="text" value={toplamTutar} onChange={(e) => setToplamTutar(e.target.value)} placeholder="0"
                  className="w-full px-3 py-2 rounded-md text-[14px] tabular-nums outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9', fontFamily: 'JetBrains Mono, monospace' }} />
              </Field>
            </div>
            <Field label="Not / Detay (ops.)">
              <textarea value={notlar} onChange={(e) => setNotlar(e.target.value)} rows={2}
                placeholder="Örn: 3 ihlal, Avrasya Tünelinden. 2 ihlal HGS yetersiz bakiye."
                className="w-full px-3 py-2 rounded-md text-[13px] outline-none resize-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
            </Field>
          </div>

          {/* Geçmiş sorgular */}
          {gecmis.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <h4 className="text-[12.5px] font-semibold" style={{ color: 'rgba(250,250,249,0.75)' }}>Geçmiş Sorgular ({gecmis.length})</h4>
              </div>
              <ul className="max-h-[220px] overflow-y-auto divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {gecmis.map((g) => (
                  <li key={g.id} className="px-4 py-2 text-[12px] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {g.durum === 'basarili' && <CheckCircle2 size={13} style={{ color: GREEN }} />}
                      {g.durum === 'hatali' && <AlertCircle size={13} style={{ color: '#ef4444' }} />}
                      <span style={{ color: 'rgba(250,250,249,0.7)' }}>{fmtTarih(g.sorguTarihi)}</span>
                      <span className="text-[10.5px] uppercase tracking-wider opacity-60">{g.kaynak}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="tabular-nums font-semibold" style={{ color: g.ihlalSayisi > 0 ? ROSE : GREEN, fontFamily: 'JetBrains Mono, monospace' }}>
                        {g.ihlalSayisi} ihlal
                      </span>
                      <span className="tabular-nums" style={{ color: g.toplamTutar ? AMBER : 'rgba(250,250,249,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtTL(g.toplamTutar)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} className="px-4 py-2 text-[12.5px] font-medium rounded-md"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.75)' }}>İptal</button>
          <button onClick={() => kaydetMut.mutate()} disabled={kaydetMut.isPending}
            className="px-5 py-2 text-[12.5px] font-bold rounded-md inline-flex items-center gap-1.5"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`, color: INK }}>
            <Save size={13} /> {kaydetMut.isPending ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-[10.5px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
        {label} {required && <span style={{ color: ROSE }}>*</span>}
      </label>
      {children}
    </div>
  );
}
