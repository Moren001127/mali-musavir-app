'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Briefcase, DollarSign, LayoutGrid, MessageSquare } from 'lucide-react';
import { ofisApi, type OfisMessage, type AgentId } from '@/lib/moren-ofis';
import { Office } from './_components/Office';
import { AgentStrip } from './_components/AgentStrip';
import { ChatPanel } from './_components/ChatPanel';
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
  const [showOffice, setShowOffice] = useState(false); // ofis sahnesi gizli default

  const { data: team = [] } = useQuery({
    queryKey: ['moren-ofis-team'],
    queryFn: ofisApi.team,
    staleTime: Infinity,
  });

  const chatMut = useMutation({
    mutationFn: (text: string) => ofisApi.chat(text, conversationId),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setTotalCost((c) => c + (res.totalCostUsd || 0));

      // Mesajları kademeli olarak ekle, ajanlar tek tek görünsün
      let delay = 0;
      for (const msg of res.messages) {
        setTimeout(() => {
          // user mesajı zaten manuel eklendi, skip
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

  return (
    <div className="space-y-3">
      {/* Üst başlık + araçlar */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <Briefcase size={11} className="inline mr-1" /> Moren AI
          </div>
          <h1 className="text-2xl font-bold mt-1" style={{ color: '#fafaf9' }}>
            Moren Ofis
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(250,250,249,0.55)' }}>
            7 kişilik AI ekibi · Arda · Nevra · Cem · Volkan · Defne · Kayra · Deniz
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {totalCost > 0 && (
            <div
              className="px-3 py-2 rounded-md text-xs"
              style={{
                background: 'rgba(212,184,118,0.10)',
                color: GOLD,
                border: '1px solid rgba(212,184,118,0.25)',
              }}
              title={`Tam: $${totalCost.toFixed(6)}`}
            >
              <DollarSign size={11} className="inline" />
              {totalCost < 0.01
                ? `${(totalCost * 100).toFixed(2)} sent`
                : `${totalCost.toFixed(3)} USD`}
            </div>
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

      {/* ÜST ŞERİT — 7 ajan kafa-isim-durum (her zaman görünür) */}
      <AgentStrip
        agents={team}
        activeAgents={activeAgents}
        onAgentClick={(id) => setSelectedAgent(id === selectedAgent ? null : id)}
        selectedAgent={selectedAgent}
      />

      {/* Seçili ajan detayı */}
      {selectedAgent && (() => {
        const a = team.find((x) => x.id === selectedAgent);
        if (!a) return null;
        return (
          <div
            className="rounded-lg p-3 flex items-start justify-between gap-3"
            style={{
              background: `linear-gradient(90deg, ${a.accentColor}15 0%, transparent 100%)`,
              border: `1px solid ${a.accentColor}30`,
            }}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs uppercase tracking-wider font-bold" style={{ color: a.accentColor }}>
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

      {/* ANA İÇERİK — Chat tam genişlik (Ofis sahnesi opsiyonel altta) */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.2)' }}>
        <ChatPanel
          agents={team}
          messages={messages}
          sending={chatMut.isPending}
          onSend={handleSend}
        />
      </div>

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

      {/* DENİZ PANELİ — sistem önerileri, alt kısımda */}
      <div className="rounded-xl overflow-hidden">
        <DenizPanel />
      </div>
    </div>
  );
}
