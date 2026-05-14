'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Briefcase, DollarSign, LayoutGrid, Plus, History, MessageSquare, Trash2, Download } from 'lucide-react';
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
  const [showOffice, setShowOffice] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [workflowTerminalJobs, setWorkflowTerminalJobs] = useState<Record<string, true>>({});

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

  const qc = useQueryClient();

  const deleteConvMut = useMutation({
    mutationFn: (id: string) => ofisApi.deleteConversation(id),
    onSuccess: (_, id) => {
      toast.success('Konuşma silindi');
      if (id === conversationId) {
        setMessages([]);
        setConversationId(undefined);
        setWorkflowTerminalJobs({});
      }
      qc.invalidateQueries({ queryKey: ['moren-ofis-conversations'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message),
  });

  const exportConversation = () => {
    if (messages.length === 0) {
      toast.error('Henüz konuşma yok');
      return;
    }
    const team = (qc.getQueryData(['moren-ofis-team']) as any) || [];
    const lines: string[] = [];
    lines.push(`# Moren Ofis Konuşma Kaydı`);
    lines.push(``);
    lines.push(`**Tarih:** ${new Date().toLocaleString('tr-TR')}`);
    lines.push(`**Mesaj sayısı:** ${messages.length}`);
    if (conversationId) lines.push(`**Konuşma ID:** \`${conversationId}\``);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    for (const m of messages) {
      const ts = new Date(m.ts).toLocaleString('tr-TR');
      if (m.agent === 'user') {
        lines.push(`## 👤 Muzaffer Bey · ${ts}`);
      } else {
        const persona = team.find((p: any) => p.id === m.agent);
        lines.push(`## 🤖 ${persona?.displayName || m.agent.toUpperCase()} (${persona?.role || ''}) · ${ts}`);
      }
      lines.push(``);
      lines.push(m.content);
      if (m.toolCalls && m.toolCalls.length > 0) {
        lines.push(``);
        lines.push(`> Tool çağrıları: ${m.toolCalls.map((tc) => `\`${tc.tool}\` (${tc.durationMs}ms${tc.ok ? '' : ' ✕'})`).join(', ')}`);
      }
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moren-ofis-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Konuşma indirildi');
  };

  const loadConversation = async (id: string) => {
    const c = await ofisApi.getConversation(id);
    const msgs = (c as any)?.messages as OfisMessage[] | null;
    if (Array.isArray(msgs)) {
      setMessages(msgs);
      setConversationId(id);
      setWorkflowTerminalJobs({});
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
        setWorkflowTerminalJobs({});
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

  const pushIncomingMessage = (msg: OfisMessage) => {
    setMessages((prev) => {
      const wf = msg.workflow;
      if (
        wf?.kind === 'mizan_gelir_workflow' &&
        wf.jobId &&
        wf.phase &&
        prev.some(
          (existing) =>
            existing.workflow?.kind === 'mizan_gelir_workflow' &&
            existing.workflow.jobId === wf.jobId &&
            existing.workflow.phase === wf.phase &&
            existing.agent === msg.agent,
        )
      ) {
        return prev;
      }
      return [...prev, msg];
    });

    if (msg.agent === 'user' || msg.agent === 'system') return;
    setActiveAgents((curr) => [
      ...curr.filter((a) => a.id !== msg.agent),
      { id: msg.agent as AgentId, state: 'talking' },
    ]);
    setTimeout(() => {
      setActiveAgents((curr) =>
        curr.map((a) => (a.id === msg.agent ? { ...a, state: 'idle' as CharacterState } : a)),
      );
    }, 3000);
  };

  const chatWithFileMut = useMutation({
    mutationFn: ({ files, text }: { files: File[]; text: string }) =>
      ofisApi.chatWithFile(files, text, conversationId),
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
          if (msg.agent === 'system') {
            pushIncomingMessage(msg);
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

  const handleSendFile = (files: File[], text: string) => {
    chatWithFileMut.mutate({ files, text });
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
          if (msg.agent === 'system') {
            pushIncomingMessage(msg);
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

  useEffect(() => {
    if (!conversationId) return;

    const terminalJobIds = new Set<string>();
    for (const msg of messages) {
      const wf = msg.workflow;
      if (wf?.kind !== 'mizan_gelir_workflow' || !wf.jobId) continue;
      if (wf.phase === 'completed' || wf.phase === 'failed' || wf.phase === 'cancelled') {
        terminalJobIds.add(wf.jobId);
      }
    }

    const pendingJobIds = Array.from(
      new Set(
        messages
          .map((msg) => msg.workflow)
          .filter(
            (wf): wf is NonNullable<OfisMessage['workflow']> =>
              wf?.kind === 'mizan_gelir_workflow' &&
              !!wf.jobId &&
              !terminalJobIds.has(wf.jobId) &&
              !workflowTerminalJobs[wf.jobId] &&
              (wf.phase === 'queued' || wf.phase === 'running' || wf.phase === 'waiting_mizan'),
          )
          .map((wf) => wf.jobId as string),
      ),
    );

    if (pendingJobIds.length === 0) return;
    let cancelled = false;

    const poll = async () => {
      await Promise.all(
        pendingJobIds.map(async (jobId) => {
          try {
            const res = await ofisApi.mizanGelirWorkflowStatus(jobId, conversationId);
            if (cancelled) return;
            const isTerminal =
              res.workflow.phase === 'completed' ||
              res.workflow.phase === 'failed' ||
              res.workflow.phase === 'cancelled';
            if (!isTerminal) {
              setMessages((prev) =>
                prev.map((msg) => {
                  const wf = msg.workflow;
                  if (wf?.kind !== 'mizan_gelir_workflow' || wf.jobId !== jobId) return msg;
                  return { ...msg, workflow: res.workflow };
                }),
              );
            }
            if (isTerminal) {
              setWorkflowTerminalJobs((curr) => ({ ...curr, [jobId]: true }));
              qc.invalidateQueries({ queryKey: ['moren-ofis-conversations'] });
            }
            for (const msg of res.messages || []) {
              pushIncomingMessage(msg);
            }
          } catch (e) {
            // Poll hatası sohbeti bölmesin; bir sonraki tur tekrar deneyecek.
            console.warn('mizan-gelir workflow poll failed', e);
          }
        }),
      );
    };

    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages, workflowTerminalJobs, qc]);

  const stateMap = new Map(activeAgents.map((a) => [a.id, a.state]));

  return (
    <div className="space-y-3">
      {/* Üst başlık + araçlar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[.16em]" style={{ color: GOLD }}>
            <Briefcase size={11} className="inline mr-1" /> Moren AI
          </div>
          <h1
            className="mt-0.5"
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#fafaf9',
            }}
          >
            Moren Ofis
          </h1>
          <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(250,250,249,0.55)' }}>
            7 kişilik AI ekibi · Arda · Nevra · Cem · Volkan · Defne · Kayra · Deniz
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center justify-end">
          {cost && cost.total > 0 && (() => {
            // Compact display — aynı değerler tek göster (5¢/5¢/5¢ saçma görünmesin)
            const sameToday = fmtCost(cost.today);
            const sameWeek = fmtCost(cost.week);
            const sameTotal = fmtCost(cost.total);
            const allSame = sameToday === sameWeek && sameWeek === sameTotal;
            const weekTotalSame = sameWeek === sameTotal && sameToday !== sameTotal;
            return (
              <div
                className="px-2.5 py-1.5 rounded-md text-[10px] flex items-center gap-2 font-mono"
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
                className="px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5"
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
                    <div
                      key={c.id}
                      className="flex items-stretch hover:bg-white/[0.04] transition border-b group"
                      style={{
                        borderColor: 'rgba(255,255,255,0.04)',
                        background: c.id === conversationId ? 'rgba(212,184,118,0.10)' : 'transparent',
                      }}
                    >
                      <button
                        onClick={() => loadConversation(c.id)}
                        className="flex-1 text-left px-3 py-2"
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`"${c.title || 'Bu konuşma'}" silinsin mi?`)) {
                            deleteConvMut.mutate(c.id);
                          }
                        }}
                        className="px-2 opacity-0 group-hover:opacity-100 transition"
                        title="Konuşmayı sil"
                      >
                        <Trash2 size={11} style={{ color: '#fca5a5' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.length > 0 && (
            <>
              <button
                onClick={exportConversation}
                className="px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  color: 'rgba(250,250,249,0.7)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                title="Bu konuşmayı Markdown dosyası olarak indir"
              >
                <Download size={12} /> İndir
              </button>
              <button
                onClick={() => {
                  setMessages([]);
                  setConversationId(undefined);
                  setActiveAgents([]);
                  setTotalCost(0);
                }}
                className="px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  color: 'rgba(250,250,249,0.7)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                title="Yeni sohbet başlat (mevcut konuşma DB'de kalır)"
              >
                <Plus size={12} /> Yeni Sohbet
              </button>
            </>
          )}
          <button
            onClick={() => setShowOffice((s) => !s)}
            className="px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5"
            style={{
              background: showOffice ? 'rgba(212,184,118,0.18)' : 'rgba(255,255,255,0.04)',
              color: showOffice ? GOLD : 'rgba(250,250,249,0.7)',
              border: `1px solid ${showOffice ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
            }}
            title="Ofis sahnesi / kart görünümü"
          >
            <LayoutGrid size={12} />
            {showOffice ? 'Masa Görünümü' : 'Kart Görünümü'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_430px] 2xl:grid-cols-[minmax(0,1fr)_470px] items-start">
        <div className="min-w-0 space-y-3">
          {showOffice ? (
            <div className="rounded-2xl overflow-hidden">
              <Office
                agents={team}
                activeAgents={activeAgents}
                onAgentClick={(id) => setSelectedAgent(id === selectedAgent ? null : id)}
                selectedAgent={selectedAgent}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3 gap-3">
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
          )}

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
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
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

          {!showOffice && <DenizPanel />}
        </div>

        <aside className="min-w-0 xl:sticky xl:top-3">
          <div className="h-[min(760px,calc(100vh-176px))] min-h-[520px]">
            <BriefingChat
              agents={team}
              messages={messages}
              sending={chatMut.isPending || chatWithFileMut.isPending}
              onSend={handleSend}
              onSendFile={handleSendFile}
              className="h-full"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
