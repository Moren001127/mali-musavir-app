'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Coins,
  Loader2,
  Play,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from 'lucide-react';

const TEAL = '#14b8a6';
const TEAL_BR = '#2dd4bf';
const GOLD = '#d4b876';
const GOLD_SOFT = '#b8a06f';
const GREEN = '#5fcf8e';
const AMBER = '#f0b755';
const RED = '#ef6b6b';

// Backend'den gelen İngilizce durumları Türkçeye çevir
function durumTurkce(status: string): string {
  switch (status) {
    case 'FALLBACK_USED':      return 'Yedek Kullanıldı';
    case 'SYNTHETIC_FAIL':     return 'Test Başarısız';
    case 'LOW_SCORE':          return 'Düşük Puan';
    case 'PASSED':             return 'Başarılı';
    case 'PASS':               return 'Başarılı';
    case 'FAIL':               return 'Başarısız';
    case 'FAILED':             return 'Başarısız';
    case 'HIGH_SCORE':         return 'Yüksek Puan';
    case 'OK':                 return 'Normal';
    default:                   return status;
  }
}

function durumRengi(status: string): string {
  if (['PASSED', 'PASS', 'HIGH_SCORE', 'OK'].includes(status)) return GREEN;
  if (['FALLBACK_USED'].includes(status)) return AMBER;
  return RED;
}

const nedenSecenekleri = [
  { val: 'tekrar',      label: 'Tekrarlıyor' },
  { val: 'alakasız',    label: 'Alakasız cevap' },
  { val: 'uzun',        label: 'Çok uzun' },
  { val: 'ton kötü',   label: 'Ton uygunsuz' },
  { val: 'taahhüt var', label: 'Söz verdi' },
  { val: 'veri riski',  label: 'Veri riski' },
];

type Ozet = {
  count: number;
  onlineCount: number;
  syntheticCount: number;
  averageScore: number;
  lowQualityCount: number;
  retryCount: number;
  fallbackCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  estimatedTry: number;
};

type KaliteKaydi = {
  id: string;
  status: string;
  score: number;
  intent?: string | null;
  reasons?: string[];
  originalReply?: string | null;
  finalReply?: string | null;
  source: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  scenarioKey?: string | null;
  metadata?: any;
  createdAt: string;
};

type TestSonuclari = {
  latestBatch?: string | null;
  results: KaliteKaydi[];
};

type Rapor = {
  totalLogs: number;
  lowScore: number;
  negativeFeedback: number;
  topReasons: Array<{ reason: string; count: number }>;
  suggestions: string[];
};

export default function BotKalitePage() {
  const qc = useQueryClient();
  const [sekme, setSekme] = useState<'dusuk' | 'testler' | 'rapor'>('dusuk');
  const [nedenler, setNedenler] = useState<Record<string, string>>({});

  const { data: ozet, isLoading: ozetYukleniyor } = useQuery<Ozet>({
    queryKey: ['whatsapp-quality-summary'],
    queryFn: () => api.get('/whatsapp/quality/summary').then((r) => r.data),
  });

  const { data: kayitlar = [], isLoading: kayitlarYukleniyor } = useQuery<KaliteKaydi[]>({
    queryKey: ['whatsapp-quality-logs'],
    queryFn: () => api.get('/whatsapp/quality/logs?limit=80').then((r) => r.data),
  });

  const { data: testler, isLoading: testlerYukleniyor } = useQuery<TestSonuclari>({
    queryKey: ['whatsapp-quality-tests'],
    queryFn: () => api.get('/whatsapp/quality/test/last-results').then((r) => r.data),
  });

  const { data: rapor, isLoading: raporYukleniyor } = useQuery<Rapor>({
    queryKey: ['whatsapp-quality-report'],
    queryFn: () => api.get('/whatsapp/quality/improvement-report').then((r) => r.data),
  });

  const geribildirim = useMutation({
    mutationFn: (input: { logId: string; rating: 'UP' | 'DOWN'; reason?: string }) =>
      api.post('/whatsapp/quality/feedback', input),
    onSuccess: () => toast.success('Geri bildirim kaydedildi'),
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Kaydedilemedi'),
  });

  const testCalistir = useMutation({
    mutationFn: () => api.post('/whatsapp/quality/test/run-now').then((r) => r.data),
    onSuccess: (data) => {
      toast.success(`Test tamamlandı: ${data.passed}/${data.total} başarılı`);
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-summary'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-logs'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-tests'] });
      qc.invalidateQueries({ queryKey: ['whatsapp-quality-report'] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.message || 'Test başlatılamadı'),
  });

  const dusukKayitlar = useMemo(
    () => kayitlar.filter((k) => k.score < 6 || ['LOW_SCORE', 'FALLBACK_USED', 'SYNTHETIC_FAIL'].includes(k.status)),
    [kayitlar],
  );

  const ortalamaPuan = ozetYukleniyor ? '...' : (ozet?.averageScore || 0).toFixed(1);
  const puan = parseFloat(ortalamaPuan);
  const puanRengi = puan >= 7 ? GREEN : puan >= 5 ? AMBER : RED;

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-5"
        style={{
          background: 'radial-gradient(120% 140% at 0% 0%, rgba(20,184,166,0.13), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(45,212,191,0.08), transparent 48%), #0f0d0b',
          borderColor: 'rgba(255,255,255,0.07)',
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${TEAL}, ${TEAL_BR}, ${TEAL})` }} />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid shrink-0 place-items-center rounded-xl"
              style={{ width: 46, height: 46, background: `linear-gradient(135deg, ${TEAL}, ${TEAL_BR})`, boxShadow: '0 8px 22px rgba(20,184,166,0.28)' }}
            >
              <Bot size={24} style={{ color: '#0f0d0b' }} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.18em]" style={{ color: TEAL_BR }}>WhatsApp Bot</p>
              <h1 className="text-[28px] font-semibold leading-none tracking-tight" style={{ color: '#fafaf9', fontFamily: 'Fraunces, Georgia, serif' }}>
                Kalite Takip
              </h1>
              <p className="mt-1 text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                Botun verdiği cevaplar otomatik puanlanır — düşük puan, test ve maliyet burada izlenir
              </p>
            </div>
          </div>
          <button
            onClick={() => testCalistir.mutate()}
            disabled={testCalistir.isPending}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-4 text-[12.5px] font-bold transition-all disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${TEAL}, #0d9488)`, color: '#0f0d0b', boxShadow: '0 8px 20px rgba(20,184,166,0.22)' }}
          >
            {testCalistir.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Test Çalıştır
          </button>
        </div>
      </header>

      {/* Sayaçlar */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SayacKarti
          icon={<Activity size={18} />}
          baslik="Bu Hafta Cevap"
          deger={ozetYukleniyor ? '...' : String(ozet?.count || 0)}
          alt={`${ozet?.onlineCount || 0} gerçek mesaj · ${ozet?.syntheticCount || 0} test senaryosu`}
          renk={TEAL}
        />
        <SayacKarti
          icon={<CheckCircle2 size={18} />}
          baslik="Ortalama Puan"
          deger={ozetYukleniyor ? '...' : `${ortalamaPuan} / 10`}
          alt="Otomatik kalite değerlendirmesi"
          renk={puanRengi}
        />
        <SayacKarti
          icon={<AlertTriangle size={18} />}
          baslik="Düşük Kaliteli"
          deger={ozetYukleniyor ? '...' : String(ozet?.lowQualityCount || 0)}
          alt={`${ozet?.retryCount || 0} yeniden deneme · ${ozet?.fallbackCount || 0} yedek kullanıldı`}
          renk={RED}
          tehlike={(ozet?.lowQualityCount || 0) > 0}
        />
        <SayacKarti
          icon={<Coins size={18} />}
          baslik="Değerlendirme Maliyeti"
          deger={`$${(ozet?.costUsd || 0).toFixed(4)}`}
          alt={`${((ozet?.inputTokens || 0) / 1000).toFixed(0)}K giriş · ${((ozet?.outputTokens || 0) / 1000).toFixed(0)}K çıkış token · ~${ozet?.estimatedTry || 0} TL`}
          renk={GOLD}
        />
      </section>

      {/* Sekmeler */}
      <div className="inline-flex overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
        {([
          ['dusuk', 'Düşük Kaliteli Cevaplar', dusukKayitlar.length],
          ['testler', 'Test Senaryoları', testler?.results?.length || 0],
          ['rapor', 'Haftalık Rapor', null],
        ] as const).map(([anahtar, etiket, sayi]) => (
          <button
            key={anahtar}
            onClick={() => setSekme(anahtar)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition"
            style={{
              background: sekme === anahtar ? 'rgba(20,184,166,0.14)' : 'transparent',
              color: sekme === anahtar ? TEAL_BR : 'rgba(250,250,249,0.58)',
              borderRight: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {etiket}
            {sayi != null && sayi > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: sekme === anahtar ? 'rgba(20,184,166,0.25)' : 'rgba(255,255,255,0.09)', color: sekme === anahtar ? TEAL_BR : 'rgba(250,250,249,0.55)' }}
              >
                {sayi}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Düşük Kaliteli Cevaplar */}
      {sekme === 'dusuk' && (
        <section className="rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
          {kayitlarYukleniyor ? (
            <Yukleniyor />
          ) : dusukKayitlar.length === 0 ? (
            <Bos icon={<CheckCircle2 size={34} />} metin="Bu hafta düşük kaliteli cevap yok — bot iyi performans gösteriyor." />
          ) : (
            <div>
              <div className="border-b px-4 py-3" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                <span className="text-[12px] font-semibold" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  {dusukKayitlar.length} kayıt — puan &lt;6 veya yedek/başarısız durumdaki cevaplar
                </span>
              </div>
              <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as any}>
                {dusukKayitlar.map((kayit) => (
                  <article key={kayit.id} className="grid gap-4 p-4 xl:grid-cols-[1fr_240px]" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                    <div className="min-w-0">
                      <div className="mb-2.5 flex flex-wrap items-center gap-2">
                        <Etiket renk={durumRengi(kayit.status)}>{durumTurkce(kayit.status)}</Etiket>
                        <Etiket renk={kayit.score < 5 ? RED : AMBER}>Puan {kayit.score}/10</Etiket>
                        {kayit.intent && (
                          <Etiket renk="rgba(250,250,249,0.3)">{kayit.intent}</Etiket>
                        )}
                        <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
                          {new Date(kayit.createdAt).toLocaleString('tr-TR')}
                        </span>
                      </div>
                      <p className="text-[13px] font-medium leading-relaxed" style={{ color: 'rgba(250,250,249,0.82)' }}>
                        {kayit.finalReply || kayit.originalReply || '(cevap metni yok)'}
                      </p>
                      {(kayit.reasons || []).length > 0 && (
                        <p className="mt-2 text-[11px]" style={{ color: 'rgba(250,250,249,0.4)' }}>
                          Tespit edilen sorunlar: {kayit.reasons!.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <select
                        value={nedenler[kayit.id] || ''}
                        onChange={(e) => setNedenler((prev) => ({ ...prev, [kayit.id]: e.target.value }))}
                        className="h-10 w-full rounded-lg px-3 text-[13px] outline-none"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fafaf9' }}
                      >
                        <option value="">Sorun türü seç</option>
                        {nedenSecenekleri.map((n) => (
                          <option key={n.val} value={n.val}>{n.label}</option>
                        ))}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => geribildirim.mutate({ logId: kayit.id, rating: 'UP', reason: nedenler[kayit.id] })}
                          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold"
                          style={{ background: 'rgba(95,207,142,0.12)', color: GREEN }}
                        >
                          <ThumbsUp size={14} /> İyi
                        </button>
                        <button
                          onClick={() => geribildirim.mutate({ logId: kayit.id, rating: 'DOWN', reason: nedenler[kayit.id] })}
                          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold"
                          style={{ background: 'rgba(239,107,107,0.12)', color: RED }}
                        >
                          <ThumbsDown size={14} /> Kötü
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Test Senaryoları */}
      {sekme === 'testler' && (
        <section className="rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
          {testlerYukleniyor ? (
            <Yukleniyor />
          ) : !testler?.results?.length ? (
            <Bos icon={<ClipboardList size={34} />} metin='Henüz test senaryosu sonucu yok. "Test Çalıştır" butonunu kullanarak başlatabilirsiniz.' />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead style={{ borderBottom: '2px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                  <tr className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                    <th className="px-4 py-3">Senaryo</th>
                    <th className="px-4 py-3">Sonuç</th>
                    <th className="px-4 py-3 text-center">Puan</th>
                    <th className="px-4 py-3">Sorunlar</th>
                    <th className="px-4 py-3">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {testler.results.map((satir, idx) => (
                    <tr
                      key={satir.id}
                      style={{ borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <td className="px-4 py-3.5 text-[13px] font-semibold" style={{ color: 'rgba(250,250,249,0.82)' }}>
                        {satir.metadata?.title || satir.scenarioKey || 'Senaryo'}
                      </td>
                      <td className="px-4 py-3.5">
                        <Etiket renk={durumRengi(satir.status)}>{durumTurkce(satir.status)}</Etiket>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className="inline-block min-w-[42px] rounded-md px-2 py-1 text-[12px] font-bold tabular-nums"
                          style={{
                            background: satir.score >= 7 ? 'rgba(95,207,142,0.13)' : satir.score >= 5 ? 'rgba(240,183,85,0.13)' : 'rgba(239,107,107,0.13)',
                            color: satir.score >= 7 ? GREEN : satir.score >= 5 ? AMBER : RED,
                          }}
                        >
                          {satir.score}/10
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-[12px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                        {(satir.reasons || []).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3.5 text-[12px]" style={{ color: 'rgba(250,250,249,0.35)' }}>
                        {new Date(satir.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Haftalık Rapor */}
      {sekme === 'rapor' && (
        <section className="grid gap-4 xl:grid-cols-[340px_1fr]">
          <div className="rounded-xl border p-5" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
            <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[.15em]" style={{ color: TEAL_BR }}>Haftalık Özet</h2>
            {raporYukleniyor ? <Yukleniyor kucuk /> : (
              <div className="space-y-3">
                <SatirKarti etiket="Toplam kayıt" deger={rapor?.totalLogs || 0} />
                <SatirKarti etiket="Düşük puanlı cevap" deger={rapor?.lowScore || 0} tehlike={(rapor?.lowScore || 0) > 0} />
                <SatirKarti etiket="Olumsuz geri bildirim" deger={rapor?.negativeFeedback || 0} tehlike={(rapor?.negativeFeedback || 0) > 0} />
                <div className="pt-2">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>Sık görülen sorunlar</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(rapor?.topReasons || []).map((item) => (
                      <Etiket key={item.reason} renk={AMBER}>{item.reason} ({item.count})</Etiket>
                    ))}
                    {(rapor?.topReasons || []).length === 0 && (
                      <span className="text-[12px]" style={{ color: 'rgba(250,250,249,0.35)' }}>Bu hafta kayıt yok</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-xl border p-5" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
            <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[.15em]" style={{ color: TEAL_BR }}>Otomatik İyileştirme Önerileri</h2>
            {raporYukleniyor ? <Yukleniyor kucuk /> : (
              <ul className="space-y-3">
                {(rapor?.suggestions?.length ? rapor.suggestions : ['Bu hafta henüz iyileştirme önerisi oluşmadı.']).map((oneri, i) => (
                  <li key={i} className="flex items-start gap-2.5 rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <RefreshCw size={13} className="mt-0.5 shrink-0" style={{ color: TEAL_BR }} />
                    <span className="text-[13px]" style={{ color: 'rgba(250,250,249,0.72)' }}>{oneri}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function SayacKarti({ icon, baslik, deger, alt, renk, tehlike }: {
  icon: ReactNode; baslik: string; deger: string; alt: string; renk: string; tehlike?: boolean;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: tehlike ? `${renk}44` : 'rgba(255,255,255,0.08)',
        background: tehlike ? `${renk}0d` : 'rgba(255,255,255,0.025)',
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span style={{ color: renk }}>{icon}</span>
        {tehlike && <XCircle size={14} style={{ color: renk, opacity: 0.7 }} />}
      </div>
      <div className="text-[26px] font-bold tabular-nums" style={{ color: '#fafaf9' }}>{deger}</div>
      <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.42)' }}>{baslik}</div>
      <div className="mt-2 text-[11px]" style={{ color: 'rgba(250,250,249,0.35)' }}>{alt}</div>
    </div>
  );
}

function SatirKarti({ etiket, deger, tehlike }: { etiket: string; deger: number; tehlike?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <span className="text-[13px]" style={{ color: 'rgba(250,250,249,0.62)' }}>{etiket}</span>
      <span className="text-[14px] font-bold tabular-nums" style={{ color: tehlike && deger > 0 ? RED : '#fafaf9' }}>{deger}</span>
    </div>
  );
}

function Etiket({ children, renk }: { children: ReactNode; renk: string }) {
  return (
    <span
      className="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold"
      style={{ borderColor: `${renk}44`, color: renk, background: `${renk}18` }}
    >
      {children}
    </span>
  );
}

function Yukleniyor({ kucuk }: { kucuk?: boolean }) {
  return (
    <div className={kucuk ? 'flex items-center gap-2 text-[13px]' : 'flex items-center justify-center gap-2 p-10 text-[13px]'} style={{ color: 'rgba(250,250,249,0.42)' }}>
      <Loader2 size={15} className="animate-spin" /> Yükleniyor…
    </div>
  );
}

function Bos({ icon, metin }: { icon: ReactNode; text?: string; metin: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-14 text-center" style={{ color: 'rgba(250,250,249,0.38)' }}>
      {icon}
      <span className="text-[13px] font-medium max-w-xs">{metin}</span>
    </div>
  );
}
