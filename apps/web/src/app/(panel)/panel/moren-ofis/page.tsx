'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Briefcase, DollarSign, LayoutGrid, Plus, History, MessageSquare } from 'lucide-react';
import { ofisApi, type OfisMessage, type AgentId } from '@/lib/moren-ofis';
import { Office } from './_components/Office';
import { AgentStatCard } from './_components/AgentStatCard';
import { BriefingChat } from './_components/BriefingChat';
import { DenizPanel } from './_components/DenizPanel';
import type { CharacterState } from './_components/Character';
import { toast } from 'sonner';

const GOLD = '#d4b876';

export default function MorenOfisPage() {
  const [messages, setMessages] = useState<OfisMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [activeAgents, setActiveAgents] = useState<{ id: AgentId; state: CharacterState }[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [showOffice, setShowOffice] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: team = [] } = useQuery({
    queryKey: ['moren-ofis-team'],
    queryFn: ofisApi.team,
    staleTime: Infinity,
  });

  // Konuşmalar listesi — geçmiş erişimi
  const { data: conversations = [] } = useQuery({
    queryKey: ['moren-ofis-conversations'],
    queryFn: ofisApi.conversations,
    refetchInterval: 30_000,
  });

  const sortedConvs = [...conversations].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );

  // Sayfa açılınca son aktif konuşmayı DB'den yükle
  const { data: lastConversation } = useQuery({
    queryKey: ['moren-ofis-last-conv', sortedConvs[0]?.id],
    queryFn: async () => {
      if (sortedConvs.length === 0) return null;
      return ofisApi.getConversation(sortedConvs[0].id);
    },
    enabled: sortedConvs.length > 0 && messages.length === 0,
    staleTime: Infinity,
  });

  const loadConversation = async (id: string) => {
    const c = await ofisApi.getConversation(id);
    const msgs = (c as any)?.messages as OfisMessage[] | null;
    if (Array.isArray(msgs)) {
      setMessages(msgs);
      setConversationId(id);
      setShowHistory(false);
    }
  };

  // Konuşma yüklendi mi? bir kere yükle, sonra kullanıcı yazdıkça state güncelleniyor
  useEffect(() => {
    if (lastConversation && messages.length === 0) {
      const msgs = (lastConversation as any).messages as OfisMessage[] | null;
      if (Array.isArray(msgs) && msgs.length > 0) {
        setMessages(msgs);
        setConversationId((lastConversation as any).id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastConversation]);

  // AI maliyet özeti — kaçak harcamayı erken yakalamak için
  const { data: cost } = useQuery({
    queryKey: ['moren-ofis-cost'],
    queryFn: ofisApi.costSummary,
    refetchInterval: 30_000,
  });

  const fmtCost = (usd: number) => {
    if (usd < 0.01) return `${(usd * 100).toFixed(1)}¢`;
    if (usd < 1) return `${(usd * 100).toFixed(0)}¢`;
    return `$${usd.toFixed(2)}`;
  };

  const chatWithFileMut = useMutation({
    mutationFn: ({ file, text }: { file: File; text: string }) =>
      ofisApi.chatWithFile(file, text, conversationId),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setTotalCost((c) => c + (res.totalCostUsd || 0));
      // user mesajı zaten backend tarafında "Evrak yüklendi" prefix'i ile geldi,
      // mesajları kademeli ekle
      let delay = 0;
      for (const msg of res.messages) {
        setTimeout(() => {
          if (msg.agent === 'user') {
            // user mesajını da göster (evrak içeriği), zaten backend "Evrak: ..." yazıyor
            setMessages((prev) => [...prev, msg]);
            return;
          }
          setMessages((prev) => [...prev, msg]);
          setActiveAgents((curr) => [
            ...curr.filter((a) => a.id !== msg.agent),
            { id: msg.agent as AgentId, state: 'talking' },
          ]);
          setTimeout(() => {
            setActiveAgents((curr) =>
              curr.map((a) => (a.id === msg.agent ? { ...a, state: 'idle' as CharacterState } : a)),
            );
          }, 3000);
        }, delay);
        delay += msg.agent === 'user' ? 100 : 900;
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Evrak işlenemedi'),
  });

  const handleSendFile = (file: File, text: string) => {
    chatWithFileMut.mutate({ file, text });
  };

  const chatMut = useMutation({
    mutationFn: (text: string) => ofisApi.chat(text, conversationId),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setTotalCost((c) => c + (res.totalCostUsd || 0));

      let delay = 0;
      for (const msg of res.messages) {
        setTimeout(() => {
          if (msg.agent === 'user') return;
          setMessages((prev) => [...prev, msg]);
          setActiveAgents((curr) => [
            ...curr.filter((a) => a.id !== msg.agent),
            { id: msg.agent as AgentId, state: 'talking' },
          ]);
          setTimeout(() => {
            setActiveAgents((curr) =>
              curr.map((a) => (a.id === msg.agent ? { ...a, state: 'idle' as CharacterState } : a)),
            );
          }, 3000);
        }, delay);
        delay += msg.agent === 'user' ? 100 : 900;
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Ekip hatası'),
  });

  const handleSend = (text: string) => {
    const userMsg: OfisMessage = {
      agent: 'user',
      content: text,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    chatMut.mutate(text);
  };

  const stateMap = new Map(activeAgents.map((a) => [a.id, a.state]));

  return (
    <div className="space-y-4">
      {/* Üst başlık + araçlar */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <Briefcase size={11} className="inline mr-1" /> Moren AI
          </div>
          <h1
            className="mt-1"
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#fafaf9',
            }}
          >
            Moren Ofis
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            7 kişilik AI ekibi · Arda · Nevra · Cem · Volkan · Defne · Kayra · Deniz
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {cost && cost.total > 0 && (() => {
            // Compact display — aynı değerler tek göster (5¢/5¢/5¢ saçma görünmesin)
            const sameToday = fmtCost(cost.today);
            const sameWeek = fmtCost(cost.week);
            const sameTotal = fmtCost(cost.total);
            const allSame = sameToday === sameWeek && sameWeek === sameTotal;
            const weekTotalSame = sameWeek === sameTotal && sameToday !== sameTotal;
            return (
              <div
                className="px-3 py-2 rounded-md text-[10px] flex items-center gap-2 font-mono"
                style={{
                  background: 'rgba(212,184,118,0.10)',
                  color: GOLD,
                  border: '1px solid rgba(212,184,118,0.25)',
                }}
                title={`Tam: $${cost.total.toFixed(6)} (${cost.msgCount} mesaj, ${cost.totalConv} konuşma)`}
              >
                <DollarSign size={11} />
                {allSame ? (
                  <span>{sameTotal}</span>
                ) : weekTotalSame ? (
                  <>
                    <span><span className="opacity-60">bugün</span> {sameToday}</span>
                    <span className="opacity-30">·</span>
                    <span><span className="opacity-60">toplam</span> {sameTotal}</span>
                  </>
                ) : (
                  <>
                    <span><span className="opacity-60">bugün</span> {sameToday}</span>
                    <span className="opacity-30">·</span>
                    <span><span className="opacity-60">hafta</span> {sameWeek}</span>
                    <span className="opacity-30">·</span>
                    <span><span className="opacity-60">toplam</span> {sameTotal}</span>
                  </>
                )}
              </div>
            );
          })()}
          {sortedConvs.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowHistory((s) => !s)}
                className="px-3 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5"
                style={{
                  background: showHistory ? 'rgba(212,184,118,0.18)' : 'rgba(255,255,255,0.04)',
                  color: showHistory ? GOLD : 'rgba(250,250,249,0.7)',
                  border: `1px solid ${showHistory ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
                }}
                title="Geçmiş konuşmalar"
              >
                <History size={12} /> Geçmiş ({sortedConvs.length})
              </button>
              {showHistory && (
                <div
                  className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto rounded-lg z-30 shadow-xl"
                  style={{
                    background: 'rgba(15,11,21,0.98)',
                    border: '1px solid rgba(212,184,118,0.30)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  {sortedConvs.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => loadConversation(c.id)}
                      className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition border-b"
                      style={{
                        borderColor: 'rgba(255,255,255,0.04)',
                        background: c.id === conversationId ? 'rgba(212,184,118,0.10)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <MessageSquare size={10} style={{ color: GOLD, opacity: 0.7 }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                          {c.messageCount} mesaj
                        </span>
                        <span className="text-[10px] ml-auto" style={{ color: 'rgba(250,250,249,0.4)' }}>
                          {new Date(c.lastActivityAt).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[12px] line-clamp-2" style={{ color: 'rgba(250,250,249,0.85)' }}>
                        {c.title || 'Yeni sohbet'}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                setConversationId(undefined);
                setActiveAgents([]);
                setTotalCost(0);
              }}
              className="px-3 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5"
              style={{
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(250,250,249,0.7)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
              title="Yeni sohbet başlat (mevcut konuşma DB'de kalır)"
            >
              <Plus size={12} /> Yeni Sohbet
            </button>
          )}
          <button
            onClick={() => setShowOffice((s) => !s)}
            className="px-3 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5"
            style={{
              background: showOffice ? 'rgba(212,184,118,0.18)' : 'rgba(255,255,255,0.04)',
              color: showOffice ? GOLD : 'rgba(250,250,249,0.7)',
              border: `1px solid ${showOffice ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
            }}
            title="Ofis sahnesini göster/gizle"
          >
            <LayoutGrid size={12} />
            {showOffice ? 'Ofis Görünümü Açık' : 'Ofis Görünümü'}
          </button>
        </div>
      </div>

      {/* ===== AJAN MASASI GRID — gösterge panelindeki StatCard tarzında ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {team.map((agent) => {
          const state = stateMap.get(agent.id) || 'idle';
          const isActive = stateMap.has(agent.id);
          return (
            <AgentStatCard
              key={agent.id}
              agent={agent}
              state={state}
              isActive={isActive}
              selected={selectedAgent === agent.id}
              onClick={() =>
                setSelectedAgent(agent.id === selectedAgent ? null : agent.id)
              }
            />
          );
        })}
      </div>

      {/* Seçili ajan detayı */}
      {selectedAgent && (() => {
        const a = team.find((x) => x.id === selectedAgent);
        if (!a) return null;
        return (
          <div
            className="rounded-xl p-3 flex items-start justify-between gap-3"
            style={{
              background: `linear-gradient(90deg, ${a.accentColor}15 0%, transparent 100%)`,
              border: `1px solid ${a.accentColor}30`,
            }}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs uppercase tracking-wider font-bold"
                  style={{ color: a.accentColor }}
                >
                  {a.displayName}
                </span>
                <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
                  {a.fullName} · {a.age} · {a.role}
                </span>
              </div>
              <p className="text-xs mb-1.5" style={{ color: 'rgba(250,250,249,0.75)' }}>
                {a.personality}
              </p>
              <div className="flex flex-wrap gap-1">
                {a.expertise.map((e) => (
                  <span
                    key={e}
                    className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                    style={{ background: `${a.accentColor}22`, color: a.accentColor }}
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => setSelectedAgent(null)}
              className="text-xs px-2 py-1 rounded"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.6)' }}
            >
              Kapat
            </button>
          </div>
        );
      })()}

      {/* ===== BRIFING CHAT — gösterge panelindeki Brifing kartı tarzında ===== */}
      <BriefingChat
        agents={team}
        messages={messages}
        sending={chatMut.isPending || chatWithFileMut.isPending}
        onSend={handleSend}
        onSendFile={handleSendFile}
      />

      {/* OFİS SAHNESİ — opsiyonel, toggle ile */}
      {showOffice && (
        <div className="rounded-xl overflow-hidden">
          <Office
            agents={team}
            activeAgents={activeAgents}
            onAgentClick={(id) => setSelectedAgent(id === selectedAgent ? null : id)}
            selectedAgent={selectedAgent}
          />
        </div>
      )}

      {/* DENİZ PANELİ — sistem önerileri */}
      <DenizPanel />
    </div>
  );
}
