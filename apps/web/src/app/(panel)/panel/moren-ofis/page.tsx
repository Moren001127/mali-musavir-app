'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Briefcase, Users, DollarSign } from 'lucide-react';
import { ofisApi, type OfisMessage, type AgentId } from '@/lib/moren-ofis';
import { Office } from './_components/Office';
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

  const { data: team = [] } = useQuery({
    queryKey: ['moren-ofis-team'],
    queryFn: ofisApi.team,
    staleTime: Infinity,
  });

  const chatMut = useMutation({
    mutationFn: (text: string) => ofisApi.chat(text, conversationId),
    onSuccess: (res) => {
      // Önce kullanıcı mesajını + agent mesajlarını sırayla ekle
      // (UI animasyonu: her ajan'ı 800ms ara ile göster)
      setConversationId(res.conversationId);
      setTotalCost((c) => c + (res.totalCostUsd || 0));

      // Mesajları kademeli olarak ekle, ajanlar tek tek görünsün
      let delay = 0;
      for (const msg of res.messages) {
        setTimeout(() => {
          setMessages((prev) => [...prev, msg]);
          if (msg.agent !== 'user') {
            // Aktif ajan göstergesi
            setActiveAgents((curr) => [
              ...curr.filter((a) => a.id !== msg.agent),
              { id: msg.agent as AgentId, state: 'talking' },
            ]);
            // 3 saniye sonra idle'a çek
            setTimeout(() => {
              setActiveAgents((curr) =>
                curr.map((a) => (a.id === msg.agent ? { ...a, state: 'idle' as CharacterState } : a)),
              );
            }, 3000);
          }
        }, delay);
        delay += msg.agent === 'user' ? 100 : 900;
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Ekip hatası'),
  });

  const handleSend = (text: string) => {
    // User mesajını anında göster
    const userMsg: OfisMessage = {
      agent: 'user',
      content: text,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    // Eski mesajları temizleyip yeni turn'u almaya başla
    chatMut.mutate(text);
  };

  return (
    <div className="space-y-4">
      {/* Üst başlık */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <Briefcase size={11} className="inline mr-1" /> Yapay Zeka
          </div>
          <h1 className="text-2xl font-bold mt-1" style={{ color: '#fafaf9' }}>
            Moren Ofis
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
            7 kişilik yapay zeka ekibi — Arda, Nevra, Cem, Volkan, Defne, Kayra, Deniz. Her biri kendi uzmanlığında.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="px-3 py-2 rounded-md text-xs" style={{ background: 'rgba(34,197,94,0.10)', color: '#86efac', border: '1px solid rgba(34,197,94,0.25)' }}>
            <Users size={11} className="inline mr-1" /> {team.length}/6 çevrimiçi
          </div>
          {totalCost > 0 && (
            <div className="px-3 py-2 rounded-md text-xs" style={{ background: 'rgba(212,184,118,0.10)', color: GOLD, border: '1px solid rgba(212,184,118,0.25)' }}>
              <DollarSign size={11} className="inline" />{(totalCost * 100).toFixed(2)}¢ harcandı
            </div>
          )}
        </div>
      </div>

      {/* OFIS SAHNESİ + CHAT PANELİ — yan yana */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        <Office
          agents={team}
          activeAgents={activeAgents}
          onAgentClick={(id) => setSelectedAgent(id === selectedAgent ? null : id)}
          selectedAgent={selectedAgent}
        />
        <ChatPanel
          agents={team}
          messages={messages}
          sending={chatMut.isPending}
          onSend={handleSend}
        />
      </div>

      {/* DENİZ Sistem Sorumlusu paneli — sistem sağlığı + öneriler */}
      <DenizPanel />

      {/* Seçili ajan detayı — alt kısımda */}
      {selectedAgent && (() => {
        const a = team.find((x) => x.id === selectedAgent);
        if (!a) return null;
        return (
          <div
            className="rounded-xl p-4"
            style={{
              background: `linear-gradient(90deg, ${a.accentColor}15 0%, transparent 100%)`,
              border: `1px solid ${a.accentColor}40`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-xs uppercase tracking-wider font-bold" style={{ color: a.accentColor }}>
                    {a.displayName}
                  </div>
                  <div className="text-xs" style={{ color: 'rgba(250,250,249,0.55)' }}>
                    {a.fullName} · {a.age} yaş · {a.role}
                  </div>
                </div>
                <p className="text-sm" style={{ color: 'rgba(250,250,249,0.8)' }}>
                  {a.personality}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {a.expertise.map((e) => (
                    <span
                      key={e}
                      className="px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        background: `${a.accentColor}22`,
                        color: a.accentColor,
                        border: `1px solid ${a.accentColor}33`,
                      }}
                    >
                      {e}
                    </span>
                  ))}
                </div>
                <div className="text-[10px] mt-2 font-mono" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  Model: {a.model}
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
          </div>
        );
      })()}
    </div>
  );
}
