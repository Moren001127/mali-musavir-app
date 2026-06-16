'use client';
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import {
  FileText, Wallet, FolderArchive, Sparkles, Send, Loader2, CheckCircle2, Clock, AlertTriangle, ShieldCheck,
} from 'lucide-react';

const GOLD = '#d4b876';
const fmtTRY = (n: number) => `${(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

const DURUM: Record<string, { label: string; color: string; Icon: any }> = {
  onaylandi: { label: 'Onaylandı', color: '#4ade80', Icon: CheckCircle2 },
  beklemede: { label: 'Beklemede', color: '#fbbf24', Icon: Clock },
  hatali: { label: 'Hatalı', color: '#f87171', Icon: AlertTriangle },
  muaf: { label: 'Muaf', color: '#94a3b8', Icon: ShieldCheck },
};

type ChatMsg = { role: 'user' | 'assistant'; text: string };

export default function MukellefDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-dashboard'],
    queryFn: () => taxpayerApi.get('/portal/dashboard').then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div className="py-20 flex justify-center">
        <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.08)', borderTopColor: GOLD }} />
      </div>
    );
  }

  const ad = data?.profile?.companyName || [data?.profile?.firstName, data?.profile?.lastName].filter(Boolean).join(' ') || 'Mükellef';
  const ozet = data?.ozet || {};

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[12px] uppercase tracking-[.16em]" style={{ color: '#b8a06f' }}>Hoş geldiniz</p>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>{ad}</h1>
      </div>

      {/* ÖZET KARTLARI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <OzetCard icon={FileText} label="Bekleyen Beyanname" value={String(ozet.bekleyenBeyan ?? 0)} />
        <OzetCard icon={Wallet} label="Cari Bakiye" value={fmtTRY(ozet.cariBakiye ?? 0)} accent={ (ozet.cariBakiye ?? 0) > 0 ? '#f87171' : '#4ade80'} />
        <OzetCard icon={FolderArchive} label="Evrak" value={String(ozet.evrakSayisi ?? 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5">
        {/* SOL: VERİ */}
        <div className="space-y-5">
          {/* BEYANNAMELER */}
          <Panel title="Beyanname Durumu" icon={FileText}>
            {(!data?.beyannameler || data.beyannameler.length === 0) ? (
              <Empty>Beyanname kaydı yok.</Empty>
            ) : (
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {data.beyannameler.map((b: any, i: number) => {
                  const d = DURUM[b.durum] || DURUM.beklemede;
                  return (
                    <div key={i} className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="text-[13.5px] font-semibold" style={{ color: '#fafaf9' }}>{b.beyanTipi}</span>
                        <span className="text-[12px] ml-2" style={{ color: 'rgba(250,250,249,0.45)' }}>{b.donem}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {b.tahakkukTutari ? <span className="text-[12.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.6)' }}>{fmtTRY(b.tahakkukTutari)}</span> : null}
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-1 rounded-md" style={{ background: `${d.color}1a`, color: d.color }}>
                          <d.Icon size={12} /> {d.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* CARİ */}
          <Panel title="Cari Hareketler" icon={Wallet}>
            <div className="flex gap-4 mb-3 text-[12.5px]">
              <span style={{ color: 'rgba(250,250,249,0.6)' }}>Tahakkuk: <b style={{ color: '#fafaf9' }}>{fmtTRY(data?.cari?.tahakkukToplam ?? 0)}</b></span>
              <span style={{ color: 'rgba(250,250,249,0.6)' }}>Tahsilat: <b style={{ color: '#4ade80' }}>{fmtTRY(data?.cari?.tahsilatToplam ?? 0)}</b></span>
            </div>
            {(!data?.cari?.hareketler || data.cari.hareketler.length === 0) ? (
              <Empty>Cari hareket yok.</Empty>
            ) : (
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                {data.cari.hareketler.slice(0, 10).map((h: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <span className="text-[12.5px]" style={{ color: '#fafaf9' }}>{h.aciklama || h.tip}</span>
                      <span className="text-[11px] ml-2" style={{ color: 'rgba(250,250,249,0.4)' }}>{h.tarih ? new Date(h.tarih).toLocaleDateString('tr-TR') : ''}</span>
                    </div>
                    <span className="text-[12.5px] tabular-nums font-semibold" style={{ color: h.tip === 'TAHSILAT' ? '#4ade80' : '#fafaf9' }}>
                      {h.tip === 'TAHSILAT' ? '−' : '+'}{fmtTRY(h.tutar)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* EVRAKLAR */}
          <Panel title="Evraklarım" icon={FolderArchive}>
            {(!data?.evraklar || data.evraklar.length === 0) ? (
              <Empty>Evrak yok.</Empty>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.evraklar.map((e: any) => (
                  <span key={e.id} className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: 'rgba(250,250,249,0.8)' }}>
                    <FileText size={12} style={{ color: GOLD }} /> {e.title}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* SAĞ: MOREN AI SOHBET */}
        <MorenAiChat taxpayerName={ad} />
      </div>
    </div>
  );
}

function MorenAiChat({ taxpayerName }: { taxpayerName: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', text: `Merhaba! Ben MOREN AI. ${taxpayerName} olarak beyanname, cari bakiye ve evrak durumunuz hakkında soru sorabilirsiniz.` },
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMut = useMutation({
    mutationFn: (message: string) => taxpayerApi.post('/portal/ai/chat', { message }).then((r) => r.data),
    onSuccess: (res) => setMessages((m) => [...m, { role: 'assistant', text: res.reply || '...' }]),
    onError: () => setMessages((m) => [...m, { role: 'assistant', text: 'Şu anda yanıt veremiyorum, lütfen birazdan tekrar deneyin.' }]),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, chatMut.isPending]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || chatMut.isPending) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    chatMut.mutate(q);
  }

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col lg:sticky lg:top-20" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(184,160,111,0.2)', height: '70vh', minHeight: 420 }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(180deg, rgba(184,160,111,0.1), transparent)' }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}>
          <Sparkles size={16} />
        </div>
        <div>
          <p className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>MOREN AI</p>
          <p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Size özel asistan</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[85%] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap"
              style={
                m.role === 'user'
                  ? { background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b', borderRadius: '14px 14px 4px 14px' }
                  : { background: 'rgba(255,255,255,0.05)', color: '#fafaf9', borderRadius: '14px 14px 14px 4px', border: '1px solid rgba(255,255,255,0.06)' }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {chatMut.isPending && (
          <div className="flex justify-start">
            <div className="px-3.5 py-2.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <Loader2 size={15} className="animate-spin" style={{ color: GOLD }} />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Sorunuzu yazın…"
          className="flex-1 px-3.5 py-2.5 text-[13.5px] rounded-xl outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
        />
        <button
          type="submit"
          disabled={!input.trim() || chatMut.isPending}
          className="flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function OzetCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl mb-3" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.15)', color: GOLD }}>
        <Icon size={16} />
      </div>
      <p className="text-[11px] uppercase tracking-[.1em]" style={{ color: 'rgba(250,250,249,0.4)' }}>{label}</p>
      <p className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: accent || GOLD, fontFamily: 'Fraunces, serif' }}>{value}</p>
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} style={{ color: GOLD }} />
        <h2 className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] py-3" style={{ color: 'rgba(250,250,249,0.4)' }}>{children}</p>;
}
