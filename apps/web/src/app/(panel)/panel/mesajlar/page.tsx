'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  MessageCircle, Send, Search, Clock, AlertCircle, CheckCircle2,
  Loader2, Phone, User, Sparkles, X, FileText, AlertTriangle, Plus, Users,
} from 'lucide-react';
import { toast } from 'sonner';

const GOLD = '#d4b876';

interface Conversation {
  taxpayerId: string;
  taxpayerName: string;
  phone: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageDirection: 'incoming' | 'outgoing';
  windowOpen: boolean;
  lastInboundAt: string | null;
  totalMessages: number;
}

interface ChatMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  subject: string;
  content: string;
  occurredAt: string;
  failed?: boolean;
  documents?: Array<{ id: string; title: string }>;
}

interface ChatData {
  taxpayer: { id: string; name: string; phone: string | null; taxNumber: string };
  messages: ChatMessage[];
  windowOpen: boolean;
  windowExpiresAt: string | null;
}

interface WhatsAppConfigShape {
  configured: boolean;
  templateName?: string;
  portalTemplateName?: string;
  documentTemplateName?: string;
}

interface WhatsAppContactPhone {
  phone: string;
  label: string;
  primary: boolean;
}

interface WhatsAppContact {
  taxpayerId: string;
  taxpayerName: string;
  taxNumber: string;
  phones: WhatsAppContactPhone[];
  primaryPhone: string | null;
  hasConversation: boolean;
  lastMessageAt: string | null;
  windowOpen: boolean;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Dün';
  }
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtFullTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function parseMessageContent(content: string): { text: string; docs: Array<{ id: string; title: string }> } {
  const docs: Array<{ id: string; title: string }> = [];
  const text = String(content || '').replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, (_all, id, title) => {
    docs.push({ id, title });
    return '';
  }).trim();
  return { text, docs };
}

export default function MesajlarPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeText, setComposeText] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [startTemplateName, setStartTemplateName] = useState('');
  const [startExtraParam, setStartExtraParam] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Konuşma listesi — her 8 saniyede yenilenir
  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ['whatsapp-conversations'],
    queryFn: () => api.get('/whatsapp/conversations').then((r) => r.data),
    refetchInterval: 8000,
  });

  const { data: whatsappConfig } = useQuery<WhatsAppConfigShape>({
    queryKey: ['integration-whatsapp'],
    queryFn: () => api.get('/integrations/whatsapp').then((r) => r.data),
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<WhatsAppContact[]>({
    queryKey: ['whatsapp-contacts', contactSearch],
    queryFn: () => api.get('/whatsapp/contacts', { params: { search: contactSearch || undefined } }).then((r) => r.data),
    enabled: showStartModal,
    staleTime: 10_000,
  });

  // Seçili mükellefin mesajları
  const { data: chatData } = useQuery<ChatData>({
    queryKey: ['whatsapp-chat', selectedId],
    queryFn: () => api.get(`/whatsapp/conversations/${selectedId}`).then((r) => r.data),
    enabled: !!selectedId,
    refetchInterval: selectedId ? 5000 : false,
  });

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.taxpayerId === selectedContactId) || null,
    [contacts, selectedContactId],
  );

  const templateOptions = useMemo(() => {
    const names = [
      whatsappConfig?.portalTemplateName,
      whatsappConfig?.templateName,
      whatsappConfig?.documentTemplateName,
      'sohbet_baslat',
      'evrak_hatirlatma',
    ]
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [whatsappConfig]);

  useEffect(() => {
    if (!startTemplateName && templateOptions.length > 0) {
      setStartTemplateName(templateOptions[0]);
    }
  }, [startTemplateName, templateOptions]);

  useEffect(() => {
    if (selectedContact) {
      setSelectedPhone(selectedContact.primaryPhone || selectedContact.phones[0]?.phone || '');
    }
  }, [selectedContact]);

  useEffect(() => {
    if (showStartModal && !selectedContactId && contacts.length > 0) {
      const first = contacts.find((contact) => contact.phones.length > 0) || contacts[0];
      setSelectedContactId(first.taxpayerId);
    }
  }, [contacts, selectedContactId, showStartModal]);

  // Mesaj gönderme
  const sendMut = useMutation({
    mutationFn: (payload: { message?: string; templateName?: string; templateParams?: string[] }) =>
      api.post(`/whatsapp/conversations/${selectedId}/reply`, payload).then((r) => r.data),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.method === 'template' ? 'Şablon gönderildi' : 'Mesaj gönderildi');
        setComposeText('');
        qc.invalidateQueries({ queryKey: ['whatsapp-chat', selectedId] });
        qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      } else {
        toast.error(res.error || 'Gönderilemedi');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Gönderim hatası'),
  });

  // Konuşma listesi filtrele
  const startMut = useMutation({
    mutationFn: () => {
      if (!selectedContact) throw new Error('Mükellef seçimi zorunlu');
      return api.post('/whatsapp/conversations/start', {
        taxpayerId: selectedContact.taxpayerId,
        phone: selectedPhone || selectedContact.primaryPhone,
        templateName: startTemplateName.trim(),
        templateParams: [
          selectedContact.taxpayerName,
          ...(startExtraParam.trim() ? [startExtraParam.trim()] : []),
        ],
      }).then((r) => r.data);
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success('Şablon gönderildi');
        setShowStartModal(false);
        setSelectedId(res.taxpayerId);
        setStartExtraParam('');
        qc.invalidateQueries({ queryKey: ['whatsapp-chat', res.taxpayerId] });
        qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
        qc.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      } else {
        toast.error(res.error || 'Şablon gönderilemedi');
        if (res.taxpayerId) {
          setSelectedId(res.taxpayerId);
          qc.invalidateQueries({ queryKey: ['whatsapp-chat', res.taxpayerId] });
          qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
        }
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Gönderim hatası'),
  });

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.taxpayerName.toLocaleLowerCase('tr-TR').includes(q) ||
      (c.phone || '').includes(q),
    );
  }, [conversations, search]);

  // Mesaj geldikçe en alta scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatData?.messages?.length]);

  const handleSend = () => {
    if (!selectedId) return;
    if (!chatData?.windowOpen) {
      setShowTemplatePicker(true);
      return;
    }
    const text = composeText.trim();
    if (!text) return;
    sendMut.mutate({ message: text });
  };

  const handleSendTemplate = (templateName: string) => {
    if (!selectedId) return;
    sendMut.mutate({ templateName });
    setShowTemplatePicker(false);
  };

  const openStartModal = () => {
    setShowStartModal(true);
    if (!startTemplateName && templateOptions.length > 0) {
      setStartTemplateName(templateOptions[0]);
    }
  };

  const openDocument = async (documentId: string) => {
    try {
      const res = await api.get(`/documents/${documentId}/download`);
      const url = res.data?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else toast.error('Dosya bağlantısı alınamadı');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Dosya açılamadı');
    }
  };

  const unreadTotal = conversations.filter((c) => c.windowOpen).length;

  return (
    <div className="flex h-[calc(100vh-120px)] gap-3 max-w-[1600px]">
      {/* SOL: KONUŞMA LİSTESİ */}
      <div
        className="w-[340px] rounded-2xl flex flex-col overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Üst başlık + arama */}
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <MessageCircle size={18} style={{ color: GOLD }} />
          <h1 className="text-[15px] font-semibold flex-1" style={{ color: '#fafaf9' }}>Mesajlar</h1>
          <span className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.5)' }}>
            {conversations.length} kişi
          </span>
          <button
            type="button"
            onClick={openStartModal}
            title="Yeni konuşma"
            className="h-8 w-8 rounded-[9px] flex items-center justify-center"
            style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.24)', color: GOLD }}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="p-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.38)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mükellef veya telefon ara..."
              className="w-full h-10 pl-9 pr-3 rounded-[10px] text-[12.5px] outline-none"
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
            />
          </div>
        </div>

        {/* Konuşma listesi */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
              <Loader2 size={16} className="animate-spin mx-auto mb-2" /> Yükleniyor...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-6 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
              <MessageCircle size={20} className="mx-auto mb-2" style={{ color: 'rgba(250,250,249,0.25)' }} />
              {conversations.length === 0
                ? 'Henüz bir mesajlaşma yok.'
                : 'Aramaya uyan kayıt yok.'}
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = c.taxpayerId === selectedId;
              return (
                <button
                  key={c.taxpayerId}
                  type="button"
                  onClick={() => setSelectedId(c.taxpayerId)}
                  className="w-full px-3 py-2.5 text-left flex items-start gap-2.5 transition-colors"
                  style={{
                    background: isSelected ? 'rgba(212,184,118,0.08)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    borderLeft: isSelected ? `2px solid ${GOLD}` : '2px solid transparent',
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-semibold"
                    style={{
                      background: c.windowOpen ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                      color: c.windowOpen ? '#86efac' : 'rgba(250,250,249,0.55)',
                      border: `1px solid ${c.windowOpen ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    {c.taxpayerName.charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold truncate" style={{ color: '#fafaf9' }}>
                        {c.taxpayerName}
                      </span>
                      <span className="text-[10.5px] tabular-nums flex-shrink-0" style={{ color: 'rgba(250,250,249,0.4)' }}>
                        {fmtTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {c.lastMessageDirection === 'outgoing' && (
                        <Send size={9} style={{ color: 'rgba(250,250,249,0.35)' }} />
                      )}
                      <span className="text-[11.5px] truncate flex-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
                        {c.lastMessage || '(boş mesaj)'}
                      </span>
                    </div>
                    {c.windowOpen ? (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#86efac' }} />
                        <span className="text-[10px]" style={{ color: '#86efac' }}>24h pencere açık</span>
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {unreadTotal > 0 && (
          <div className="px-4 py-2 text-[11px] flex items-center gap-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'rgba(134,239,172,0.85)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#86efac' }} />
            {unreadTotal} aktif konuşma (24h pencere açık)
          </div>
        )}
      </div>

      {/* SAĞ: SOHBET */}
      <div
        className="flex-1 rounded-2xl flex flex-col overflow-hidden min-w-0"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="text-center">
              <MessageCircle size={36} className="mx-auto mb-3" style={{ color: 'rgba(250,250,249,0.2)' }} />
              <p className="text-[14px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
                Sol taraftan bir mükellef seç, konuşmaya başla
              </p>
              <p className="text-[12px] mt-2" style={{ color: 'rgba(250,250,249,0.35)' }}>
                Yeşil avatar = son 24 saatte mesajlaşıldı (serbest yazabilirsin)
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Sohbet başlık */}
            <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold"
                style={{
                  background: chatData?.windowOpen ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                  color: chatData?.windowOpen ? '#86efac' : 'rgba(250,250,249,0.55)',
                  border: `1px solid ${chatData?.windowOpen ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                {chatData?.taxpayer?.name?.charAt(0).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold" style={{ color: '#fafaf9' }}>
                  {chatData?.taxpayer?.name || 'Yükleniyor...'}
                </div>
                <div className="flex items-center gap-3 text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  {chatData?.taxpayer?.phone && (
                    <span className="flex items-center gap-1">
                      <Phone size={9} /> {chatData.taxpayer.phone}
                    </span>
                  )}
                  {chatData?.taxpayer?.taxNumber && (
                    <span>VKN: {chatData.taxpayer.taxNumber}</span>
                  )}
                </div>
              </div>
              {/* 24h pencere durumu */}
              {chatData?.windowOpen ? (
                <div className="text-[11px] flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac' }}>
                  <CheckCircle2 size={11} /> 24h pencere açık
                </div>
              ) : (
                <div className="text-[11px] flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>
                  <Clock size={11} /> Pencere kapalı (şablon gerekli)
                </div>
              )}
            </div>

            {/* Mesaj listesi */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {!chatData ? (
                <div className="text-center py-10" style={{ color: 'rgba(250,250,249,0.4)' }}>
                  <Loader2 size={16} className="animate-spin mx-auto" />
                </div>
              ) : chatData.messages.length === 0 ? (
                <div className="text-center py-10 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Henüz mesaj yok. Şablon ile konuşmayı başlatabilirsin.
                </div>
              ) : (
                chatData.messages.map((m) => {
                  const incoming = m.direction === 'incoming';
                  const parsed = parseMessageContent(m.content);
                  const docs = m.documents?.length ? m.documents : parsed.docs;
                  return (
                    <div key={m.id} className={`flex ${incoming ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className="max-w-[70%] px-3.5 py-2 rounded-[14px] text-[13px]"
                        style={{
                          background: incoming ? 'rgba(255,255,255,0.05)' : 'rgba(212,184,118,0.12)',
                          border: incoming ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(212,184,118,0.18)',
                          color: '#fafaf9',
                          borderTopLeftRadius: incoming ? 4 : 14,
                          borderTopRightRadius: incoming ? 14 : 4,
                        }}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.content || '(boş)'}</div>
                        {docs.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {docs.map((doc) => (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => openDocument(doc.id)}
                                className="flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11.5px]"
                                style={{
                                  borderColor: incoming ? 'rgba(255,255,255,0.12)' : 'rgba(212,184,118,0.28)',
                                  background: incoming ? 'rgba(255,255,255,0.04)' : 'rgba(212,184,118,0.08)',
                                  color: '#fafaf9',
                                }}
                              >
                                <FileText size={13} className="shrink-0" />
                                <span className="truncate">{doc.title}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {m.failed && (
                          <div className="mt-2 flex items-center gap-1.5 text-[10.5px]" style={{ color: '#fca5a5' }}>
                            <AlertTriangle size={11} /> WhatsApp'a gonderilemedi
                          </div>
                        )}
                        <div className="text-[10px] mt-1 text-right" style={{ color: 'rgba(250,250,249,0.4)' }}>
                          {fmtFullTime(m.occurredAt)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Alt input */}
            <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
              {chatData?.windowOpen ? (
                <div className="flex items-end gap-2">
                  <textarea
                    value={composeText}
                    onChange={(e) => setComposeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Mesaj yaz... (Enter = gönder, Shift+Enter = yeni satır)"
                    rows={2}
                    className="flex-1 px-3 py-2 rounded-[10px] text-[13px] outline-none resize-none"
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!composeText.trim() || sendMut.isPending}
                    className="h-11 px-4 rounded-[10px] flex items-center gap-1.5 text-[13px] font-semibold"
                    style={{
                      background: composeText.trim() ? `linear-gradient(135deg, ${GOLD}, #b8a06f)` : 'rgba(255,255,255,0.04)',
                      color: composeText.trim() ? '#0f0d0b' : 'rgba(250,250,249,0.35)',
                      opacity: sendMut.isPending ? 0.6 : 1,
                    }}
                  >
                    {sendMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Gönder
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 px-3 py-2 rounded-[10px]" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
                    <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.7)' }}>
                      Bu mükellef son 24 saatte sana yazmamış. Serbest metin gönderemezsin.
                      <strong> Meta onaylı bir şablon</strong> kullanarak "kapı çal" mesajı gönder — müşteri yazdığında pencere açılır, sonra serbest yazabilirsin.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTemplatePicker(true)}
                    className="w-full h-11 rounded-[10px] flex items-center justify-center gap-1.5 text-[13px] font-semibold"
                    style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
                  >
                    <Sparkles size={14} /> Şablonla Konuşma Başlat
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ŞABLON SEÇİCİ MODAL */}
      {showStartModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowStartModal(false)}
        >
          <div
            className="rounded-2xl p-5 w-full max-w-3xl"
            style={{ background: '#1c1813', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users size={17} style={{ color: GOLD }} />
                <h3 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Rehberden Konuşma Başlat</h3>
              </div>
              <button onClick={() => setShowStartModal(false)} style={{ color: 'rgba(250,250,249,0.5)' }}>
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
              <div className="min-h-[360px] rounded-[12px] border p-3" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.16)' }}>
                <div className="relative mb-3">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.38)' }} />
                  <input
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      setSelectedContactId(null);
                    }}
                    placeholder="Rehberde ara..."
                    className="w-full h-10 pl-9 pr-3 rounded-[10px] text-[12.5px] outline-none"
                    style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
                  />
                </div>

                <div className="max-h-[310px] overflow-y-auto space-y-1">
                  {contactsLoading ? (
                    <div className="py-10 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
                      <Loader2 size={16} className="animate-spin mx-auto mb-2" /> Yükleniyor...
                    </div>
                  ) : contacts.length === 0 ? (
                    <div className="py-10 text-center text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Kayıt bulunamadı.
                    </div>
                  ) : contacts.map((contact) => {
                    const active = contact.taxpayerId === selectedContactId;
                    const canSend = contact.phones.length > 0;
                    return (
                      <button
                        key={contact.taxpayerId}
                        type="button"
                        onClick={() => setSelectedContactId(contact.taxpayerId)}
                        disabled={!canSend}
                        className="w-full rounded-[10px] px-3 py-2 text-left disabled:opacity-45"
                        style={{
                          background: active ? 'rgba(212,184,118,0.1)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${active ? 'rgba(212,184,118,0.28)' : 'rgba(255,255,255,0.06)'}`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{contact.taxpayerName}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                              <span className="truncate">{contact.primaryPhone || 'Telefon yok'}</span>
                              {contact.windowOpen && <span style={{ color: '#86efac' }}>24h açık</span>}
                            </div>
                          </div>
                          {contact.hasConversation && (
                            <span className="rounded-md px-2 py-1 text-[10px]" style={{ background: 'rgba(34,197,94,0.09)', color: '#86efac' }}>
                              Sohbet
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[12px] border p-3" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)' }}>
                <label className="block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Telefon
                </label>
                <select
                  value={selectedPhone}
                  onChange={(e) => setSelectedPhone(e.target.value)}
                  disabled={!selectedContact}
                  className="mt-1.5 w-full rounded-[10px] border bg-transparent px-3 py-2 text-[13px] outline-none"
                  style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                >
                  {(selectedContact?.phones || []).map((item) => (
                    <option key={`${item.label}-${item.phone}`} value={item.phone} style={{ background: '#1c1813', color: '#fafaf9' }}>
                      {item.label} - {item.phone}
                    </option>
                  ))}
                </select>

                <label className="mt-3 block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Şablon adı
                </label>
                <input
                  value={startTemplateName}
                  onChange={(e) => setStartTemplateName(e.target.value)}
                  list="whatsapp-template-options"
                  placeholder="sohbet_baslat"
                  className="mt-1.5 w-full rounded-[10px] border bg-transparent px-3 py-2 text-[13px] outline-none"
                  style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                />
                <datalist id="whatsapp-template-options">
                  {templateOptions.map((name) => <option key={name} value={name} />)}
                </datalist>

                <label className="mt-3 block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                  Ek parametre
                </label>
                <textarea
                  value={startExtraParam}
                  onChange={(e) => setStartExtraParam(e.target.value)}
                  rows={4}
                  placeholder="Şablonda ikinci değişken varsa buraya yaz"
                  className="mt-1.5 w-full resize-none rounded-[10px] border bg-transparent px-3 py-2 text-[13px] outline-none"
                  style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                />

                <button
                  type="button"
                  onClick={() => startMut.mutate()}
                  disabled={!selectedContact || !selectedPhone || !startTemplateName.trim() || startMut.isPending}
                  className="mt-4 h-11 w-full rounded-[10px] flex items-center justify-center gap-1.5 text-[13px] font-semibold disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
                >
                  {startMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Şablonla Başlat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTemplatePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowTemplatePicker(false)}
        >
          <div
            className="rounded-2xl p-6 max-w-md w-full"
            style={{ background: '#1c1813', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Şablon Seç</h3>
              <button onClick={() => setShowTemplatePicker(false)} style={{ color: 'rgba(250,250,249,0.5)' }}>
                <X size={18} />
              </button>
            </div>
            <p className="text-[12px] mb-4" style={{ color: 'rgba(250,250,249,0.6)' }}>
              Meta'da onaylı bir şablon seç. Mükellef adı otomatik doldurulacak.
            </p>
            <div className="space-y-2">
              {[
                { name: 'evrak_hatirlatma', label: 'Evrak Hatırlatma', desc: 'Belge teslimi bekleniyor' },
                { name: 'sohbet_baslat', label: 'Sohbet Başlat', desc: 'Genel bir kapı çal mesajı' },
              ].map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => handleSendTemplate(t.name)}
                  disabled={sendMut.isPending}
                  className="w-full px-4 py-3 rounded-[10px] text-left transition-colors"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{t.label}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    {t.desc} <span className="font-mono">({t.name})</span>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[10.5px] mt-3" style={{ color: 'rgba(250,250,249,0.4)' }}>
              ⚠️ Şablonların Meta'da onaylı olması gerekir. Onaysız şablon gönderirsen Meta hata döner.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
