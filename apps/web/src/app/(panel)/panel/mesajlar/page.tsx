'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  MessageCircle, Send, Search, Clock, AlertCircle, CheckCircle2,
  Loader2, Phone, User, Sparkles, X, FileText, AlertTriangle, Plus, Users,
  Paperclip, Image as ImageIcon, Link2, Smile,
} from 'lucide-react';
import { toast } from 'sonner';

const GOLD = '#d4b876';
const QUICK_EMOJIS = [
  '😀', '😁', '😂', '😊', '😍', '🥰', '😉', '👍', '🙏', '👏', '✅', '📌',
  '📎', '📄', '💰', '📊', '⏰', '⚠️', '❤️', '🤝', '🙋‍♂️', '🙋‍♀️', '☕', '🎉',
];

function WhatsAppAvatar({
  name,
  url,
  active,
  size = 36,
}: {
  name?: string | null;
  url?: string | null;
  active?: boolean;
  size?: number;
}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className="rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden text-[12px] font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.34)),
        background: active ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
        color: active ? '#86efac' : 'rgba(250,250,249,0.55)',
        border: `1px solid ${active ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {url ? <img src={url} alt={name || 'WhatsApp profil'} className="h-full w-full object-cover" /> : initial}
    </div>
  );
}

interface Conversation {
  conversationId?: string;
  taxpayerId: string;
  taxpayerName: string;
  phone: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageDirection: 'incoming' | 'outgoing';
  windowOpen: boolean;
  lastInboundAt: string | null;
  totalMessages: number;
  unknownContact?: boolean;
  avatarUrl?: string | null;
}

interface ChatMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  subject: string;
  content: string;
  occurredAt: string;
  failed?: boolean;
  documents?: Array<{ id: string; title: string; mimeType?: string; sizeBytes?: number; url?: string | null }>;
}

interface ChatData {
  conversationId?: string;
  taxpayer: { id: string; name: string; phone: string | null; taxNumber: string; unknownContact?: boolean; avatarUrl?: string | null };
  messages: ChatMessage[];
  windowOpen: boolean;
  windowExpiresAt: string | null;
}

interface WhatsAppConfigShape {
  configured: boolean;
  templateName?: string;
  portalTemplateName?: string;
  documentTemplateName?: string;
  templateLang?: string;
}

interface WhatsAppQrStatus {
  connected: boolean;
  connecting: boolean;
  hasQr: boolean;
}

interface WhatsAppTemplate {
  name: string;
  language?: string;
  status?: string;
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

function parseMessageContent(content: string): { text: string; docs: Array<{ id: string; title: string; mimeType?: string; sizeBytes?: number; url?: string | null }> } {
  const docs: Array<{ id: string; title: string; mimeType?: string; sizeBytes?: number; url?: string | null }> = [];
  const rawText = String(content || '').replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, (_all, id, title) => {
    docs.push({ id, title });
    return '';
  }).trim();
  const text = renderWhatsAppLogText(rawText);
  return { text, docs };
}

function renderWhatsAppLogText(content: string): string {
  const raw = String(content || '').trim();
  const templateMatch = raw.match(/^\[Sablon:\s*([^\]]+)\]\s*([\s\S]*?)(?:\n\nHata:\s*([\s\S]+))?$/i);
  if (!templateMatch) return raw;

  const templateName = templateMatch[1].trim();
  const params = templateMatch[2]
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  const error = templateMatch[3]?.trim();
  let text = '';

  if (templateName.toLocaleLowerCase('tr-TR') === 'evrak_iletisim' && params[0]) {
    text = `Merhaba ${params[0]}, dönem evrak ve muhasebe işlemlerinizle ilgili iletişim için size bu hattan ulaşıyoruz. Uygun olduğunuzda yanıt verebilirsiniz.`;
  } else {
    text = `Şablon gönderildi: ${templateName}`;
    if (params.length) text += `\n${params.join(' | ')}`;
  }

  if (error) text += `\n\nGönderim hatası: ${error}`;
  return text;
}

function isImageDoc(doc: { mimeType?: string; title?: string }): boolean {
  const mime = String(doc.mimeType || '').toLowerCase();
  const title = String(doc.title || '').toLowerCase();
  return mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic)$/i.test(title);
}

function isPdfDoc(doc: { mimeType?: string; title?: string }): boolean {
  const mime = String(doc.mimeType || '').toLowerCase();
  const title = String(doc.title || '').toLowerCase();
  return mime.includes('pdf') || /\.pdf$/i.test(title);
}

function buildStartTemplateParams(templateName: string, primaryName: string, extraParam: string): string[] {
  const primary = primaryName.trim();
  if (templateName.trim().toLocaleLowerCase('tr-TR') === 'evrak_iletisim') return [primary];
  const extra = extraParam.trim();
  return extra ? [primary, extra] : [primary];
}

export default function MesajlarPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeText, setComposeText] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [startTemplateName, setStartTemplateName] = useState('');
  const [startExtraParam, setStartExtraParam] = useState('');
  const [startMode, setStartMode] = useState<'contacts' | 'manual'>('contacts');
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [startMessage, setStartMessage] = useState('Merhaba');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedLinkContactId, setSelectedLinkContactId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conversation = params.get('conversation') || params.get('taxpayerId');
    if (conversation) setSelectedId(conversation);
  }, []);

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

  const { data: qrStatus } = useQuery<WhatsAppQrStatus>({
    queryKey: ['integration-whatsapp-qr-status'],
    queryFn: () => api.get('/integrations/whatsapp/qr/status').then((r) => r.data),
    refetchInterval: 8000,
  });

  const { data: metaTemplates } = useQuery<{ ok: boolean; templates: WhatsAppTemplate[] }>({
    queryKey: ['whatsapp-meta-templates'],
    queryFn: () => api.get('/whatsapp/templates').then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<WhatsAppContact[]>({
    queryKey: ['whatsapp-contacts', contactSearch],
    queryFn: () => api.get('/whatsapp/contacts', { params: { search: contactSearch || undefined } }).then((r) => r.data),
    enabled: showStartModal || showLinkModal,
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
  const selectedLinkContact = useMemo(
    () => contacts.find((contact) => contact.taxpayerId === selectedLinkContactId) || null,
    [contacts, selectedLinkContactId],
  );

  const templateOptions = useMemo(() => {
    const templateLang = String(whatsappConfig?.templateLang || 'tr').trim().toLocaleLowerCase('tr-TR');
    const approvedNames = (metaTemplates?.templates || [])
      .filter((tpl) => {
        const approved = !tpl.status || tpl.status === 'APPROVED';
        const sameLanguage = !tpl.language || tpl.language.toLocaleLowerCase('tr-TR') === templateLang;
        return approved && sameLanguage;
      })
      .map((tpl) => tpl.name);
    const configuredNames = [
      whatsappConfig?.portalTemplateName,
      'evrak_iletisim',
      whatsappConfig?.templateName,
      whatsappConfig?.documentTemplateName,
    ]
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    const approvedSet = new Set(approvedNames);
    const metaListLoaded = Boolean(metaTemplates?.ok && (metaTemplates.templates || []).length > 0);
    const names = [
      ...approvedNames,
      ...configuredNames.filter((name) => !metaListLoaded || approvedSet.has(name)),
    ];
    return Array.from(new Set(names));
  }, [metaTemplates, whatsappConfig]);

  useEffect(() => {
    if (templateOptions.length > 0 && (!startTemplateName || !templateOptions.includes(startTemplateName))) {
      setStartTemplateName(templateOptions[0]);
    }
  }, [startTemplateName, templateOptions]);

  useEffect(() => {
    if (selectedContact) {
      setSelectedPhone((current) => {
        const stillAvailable = selectedContact.phones.some((item) => item.phone === current);
        if (stillAvailable) return current;
        return selectedContact.primaryPhone || selectedContact.phones[0]?.phone || '';
      });
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
      if (startMode === 'manual') {
        if (!manualPhone.trim()) throw new Error('Telefon numarasi zorunlu');
        const templateName = startTemplateName.trim();
        const displayName = manualName.trim() || manualPhone.trim();
        return api.post('/whatsapp/conversations/start', {
          phone: manualPhone.trim(),
          displayName: manualName.trim() || undefined,
          initialMessage: qrStartAvailable ? startMessage.trim() : undefined,
          templateName,
          templateParams: qrStartAvailable ? undefined : buildStartTemplateParams(templateName, displayName, startExtraParam),
        }).then((r) => r.data);
      }
      if (!selectedContact) throw new Error('Mükellef seçimi zorunlu');
      const templateName = startTemplateName.trim();
      const phone = selectedContact.phones.some((item) => item.phone === selectedPhone)
        ? selectedPhone
        : (selectedContact.primaryPhone || selectedContact.phones[0]?.phone || '');
      return api.post('/whatsapp/conversations/start', {
        taxpayerId: selectedContact.taxpayerId,
        phone,
        initialMessage: qrStartAvailable ? startMessage.trim() : undefined,
        templateName,
        templateParams: qrStartAvailable ? undefined : buildStartTemplateParams(templateName, selectedContact.taxpayerName, startExtraParam),
      }).then((r) => r.data);
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.method === 'free-form' ? 'Mesaj gönderildi' : 'Şablon gönderildi');
        setShowStartModal(false);
        setSelectedId(res.conversationId || res.taxpayerId);
        setStartExtraParam('');
        setStartMessage('Merhaba');
        setManualPhone('');
        setManualName('');
        qc.invalidateQueries({ queryKey: ['whatsapp-chat', res.conversationId || res.taxpayerId] });
        qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
        qc.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      } else {
        toast.error(res.error || 'Gönderilemedi');
        if (res.taxpayerId) {
          setSelectedId(res.conversationId || res.taxpayerId);
          qc.invalidateQueries({ queryKey: ['whatsapp-chat', res.conversationId || res.taxpayerId] });
          qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
        }
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Gönderim hatası'),
  });

  const linkMut = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('Konusma secimi yok');
      if (!selectedLinkContactId) throw new Error('Mukellef secimi zorunlu');
      return api.post(`/whatsapp/conversations/${selectedId}/link`, { targetTaxpayerId: selectedLinkContactId }).then((r) => r.data);
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success('Konusma mukellefe baglandi');
        setShowLinkModal(false);
        setSelectedId(res.conversationId || res.taxpayerId);
        setSelectedLinkContactId(null);
        qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
        qc.invalidateQueries({ queryKey: ['whatsapp-chat'] });
        qc.invalidateQueries({ queryKey: ['whatsapp-contacts'] });
      } else {
        toast.error(res.error || 'Baglanamadi');
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Baglama hatasi'),
  });

  const mediaMut = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedId) throw new Error('Konusma secimi yok');
      const formData = new FormData();
      formData.append('file', file);
      const caption = composeText.trim();
      if (caption) formData.append('caption', caption);
      return api.post(`/whatsapp/conversations/${selectedId}/media/upload`, formData).then((r) => r.data);
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success('Dosya WhatsApp ile gonderildi');
        setComposeText('');
      } else {
        toast.error(res.error || 'Dosya gonderilemedi');
      }
      qc.invalidateQueries({ queryKey: ['whatsapp-chat', selectedId] });
      qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Dosya gonderim hatasi'),
  });

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.taxpayerName.toLocaleLowerCase('tr-TR').includes(q) ||
      (c.phone || '').includes(q),
    );
  }, [conversations, search]);
  const selectedConversation = useMemo(
    () => conversations.find((c) => (c.conversationId || c.taxpayerId) === selectedId) || null,
    [conversations, selectedId],
  );

  const freeFormAvailable = Boolean(chatData?.windowOpen || qrStatus?.connected);
  const qrStartAvailable = Boolean(qrStatus?.connected);

  useEffect(() => {
    if (!selectedId) {
      setShowProfilePanel(false);
      setShowAvatarPreview(false);
    }
  }, [selectedId]);

  // Mesaj geldikçe en alta scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatData?.messages?.length]);

  const handleSend = () => {
    if (!selectedId) return;
    if (!freeFormAvailable) {
      setShowTemplatePicker(true);
      return;
    }
    const text = composeText.trim();
    if (!text) return;
    setShowEmojiPicker(false);
    sendMut.mutate({ message: text });
  };

  const handleSendTemplate = (templateName: string) => {
    if (!selectedId) return;
    sendMut.mutate({ templateName });
    setShowTemplatePicker(false);
  };

  const insertEmoji = (emoji: string) => {
    const input = composeRef.current;
    const start = input?.selectionStart ?? composeText.length;
    const end = input?.selectionEnd ?? composeText.length;
    const next = `${composeText.slice(0, start)}${emoji}${composeText.slice(end)}`;
    setComposeText(next);
    setShowEmojiPicker(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const openWhatsAppFromHeader = () => {
    const phone = chatData?.taxpayer?.phone?.replace(/[^\d]/g, '');
    if (!phone) return toast.error('Telefon numarası yok');
    window.location.href = `whatsapp://send?phone=${phone}`;
    window.setTimeout(() => window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer'), 700);
    toast.message('WhatsApp açılırsa aramayı uygulama içinden başlatabilirsin');
  };

  const handleMediaPicked = (file?: File | null) => {
    if (!file) return;
    mediaMut.mutate(file);
  };

  const openStartModal = () => {
    setShowStartModal(true);
    if (!startMessage.trim()) setStartMessage('Merhaba');
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
              const id = c.conversationId || c.taxpayerId;
              const isSelected = id === selectedId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedId(id)}
                  className="w-full px-3 py-2.5 text-left flex items-start gap-2.5 transition-colors"
                  style={{
                    background: isSelected ? 'rgba(212,184,118,0.08)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    borderLeft: isSelected ? `2px solid ${GOLD}` : '2px solid transparent',
                  }}
                >
                  {/* Avatar */}
                  <WhatsAppAvatar name={c.taxpayerName} url={c.avatarUrl} active={c.windowOpen} />

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
                      {c.phone && (
                        <span className="text-[10px] flex-shrink-0" style={{ color: 'rgba(250,250,249,0.38)' }}>
                          {c.phone}
                        </span>
                      )}
                      <span className="text-[11.5px] truncate flex-1" style={{ color: 'rgba(250,250,249,0.55)' }}>
                        {renderWhatsAppLogText(c.lastMessage) || '(boş mesaj)'}
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
              <button type="button" onClick={() => setShowProfilePanel(true)} className="rounded-full" title="Kişi bilgisi">
                <WhatsAppAvatar name={chatData?.taxpayer?.name} url={chatData?.taxpayer?.avatarUrl} active={chatData?.windowOpen} />
              </button>
              <button type="button" onClick={() => setShowProfilePanel(true)} className="flex-1 min-w-0 text-left">
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
              </button>
              {chatData?.taxpayer?.phone && (
                <button
                  type="button"
                  onClick={openWhatsAppFromHeader}
                  title="WhatsApp'ta aç ve ara"
                  className="h-8 w-8 rounded-md flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.82)' }}
                >
                  <Phone size={14} />
                </button>
              )}
              {chatData?.taxpayer?.unknownContact && (
                <button
                  type="button"
                  onClick={() => setShowLinkModal(true)}
                  className="h-8 px-3 rounded-md flex items-center gap-1.5 text-[11px] font-semibold"
                  style={{ background: 'rgba(212,184,118,0.12)', border: '1px solid rgba(212,184,118,0.24)', color: GOLD }}
                >
                  <Link2 size={12} /> Mükellefe Bağla
                </button>
              )}
              {/* 24h pencere durumu */}
              {freeFormAvailable ? (
                <div className="text-[11px] flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac' }}>
                  <CheckCircle2 size={11} /> {qrStatus?.connected ? 'QR bağlı' : '24h pencere açık'}
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
                  {qrStatus?.connected ? 'Henüz mesaj yok. Aşağıdan normal WhatsApp mesajı yazabilirsin.' : 'Henüz mesaj yok. Şablon ile konuşmayı başlatabilirsin.'}
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
                        <div className="whitespace-pre-wrap break-words">{parsed.text || '(boş)'}</div>
                        {docs.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {docs.map((doc) => (
                              <div
                                key={doc.id}
                                className="overflow-hidden rounded-md border"
                                style={{
                                  borderColor: incoming ? 'rgba(255,255,255,0.12)' : 'rgba(212,184,118,0.28)',
                                  background: incoming ? 'rgba(255,255,255,0.04)' : 'rgba(212,184,118,0.08)',
                                }}
                              >
                                {isImageDoc(doc) && doc.url ? (
                                  <button type="button" onClick={() => openDocument(doc.id)} className="block w-full">
                                    <img src={doc.url} alt={doc.title} className="max-h-64 w-full object-contain" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openDocument(doc.id)}
                                    className="flex max-w-full items-center gap-2 px-2.5 py-2 text-left text-[11.5px]"
                                    style={{ color: '#fafaf9' }}
                                  >
                                    {isPdfDoc(doc) ? <FileText size={16} className="shrink-0" /> : <ImageIcon size={16} className="shrink-0" />}
                                    <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                                  </button>
                                )}
                              </div>
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
              {freeFormAvailable ? (
                <div className="flex items-end gap-2">
                  <input
                    ref={mediaInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
                    onChange={(e) => {
                      handleMediaPicked(e.target.files?.[0]);
                      e.currentTarget.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => mediaInputRef.current?.click()}
                    disabled={mediaMut.isPending}
                    title="Dosya gönder"
                    className="h-11 w-11 rounded-[10px] flex items-center justify-center disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: GOLD }}
                  >
                    {mediaMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={15} />}
                  </button>
                  <div className="relative flex-1">
                    {showEmojiPicker && (
                      <div
                        className="absolute bottom-[52px] left-0 z-20 w-[320px] max-w-[calc(100vw-48px)] rounded-[12px] border p-3 shadow-2xl"
                        style={{ background: '#1f1f1f', borderColor: 'rgba(255,255,255,0.12)' }}
                      >
                        <div className="mb-2 text-[11px] font-semibold" style={{ color: 'rgba(250,250,249,0.55)' }}>Sık kullanılanlar</div>
                        <div className="grid grid-cols-8 gap-1">
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => insertEmoji(emoji)}
                              className="h-8 rounded-md text-[20px] leading-none hover:bg-white/10"
                              aria-label={`Emoji ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker((value) => !value)}
                      title="Emoji"
                      className="absolute left-2 top-2 h-7 w-7 rounded-md flex items-center justify-center"
                      style={{ color: 'rgba(250,250,249,0.55)' }}
                    >
                      <Smile size={17} />
                    </button>
                  <textarea
                    ref={composeRef}
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
                    className="w-full pl-11 pr-3 py-2 rounded-[10px] text-[13px] outline-none resize-none"
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
                  />
                  </div>
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
              ) : (() => {
                // En son giden şablon mesajı var mı (son 24 saat içinde)?
                const lastOutgoing = [...(chatData?.messages || [])].reverse().find((m) => m.direction === 'outgoing');
                const isTemplateRecent =
                  lastOutgoing &&
                  /[Şş]ablon|Sablon|template|hatirlat|iletisim|baslat/i.test(lastOutgoing.subject || '') &&
                  (Date.now() - new Date(lastOutgoing.occurredAt).getTime()) < 24 * 60 * 60 * 1000;

                if (isTemplateRecent) {
                  // Şablon zaten yollanmış, müşteri yanıtı bekleniyor
                  return (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 px-3 py-2 rounded-[10px]" style={{ background: 'rgba(125,211,252,0.06)', border: '1px solid rgba(125,211,252,0.2)' }}>
                        <Clock size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#7dd3fc' }} />
                        <div className="text-[12px]" style={{ color: 'rgba(250,250,249,0.78)' }}>
                          <strong>Şablon gönderildi</strong> ({fmtFullTime(lastOutgoing!.occurredAt)}). Müşteri yanıt vermedi, henüz 24 saatlik pencere açılmadı.
                          <br />
                          Müşteri yazdığında <strong>serbest mesaj</strong> kutusu otomatik açılır. Hatırlatma göndermek istersen aşağıdaki butonu kullan.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTemplatePicker(true)}
                        className="w-full h-11 rounded-[10px] flex items-center justify-center gap-1.5 text-[13px] font-semibold"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' }}
                      >
                        <Sparkles size={14} /> Hatırlatma Şablonu Gönder
                      </button>
                    </div>
                  );
                }

                // İlk defa şablon gönderilecek
                return (
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
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* ŞABLON SEÇİCİ MODAL */}
      {showProfilePanel && chatData && (
        <aside
          className="fixed bottom-4 right-4 top-4 z-40 flex w-[min(380px,calc(100vw-32px))] shrink-0 flex-col overflow-hidden rounded-2xl xl:static xl:h-auto xl:w-[360px] xl:min-w-[340px]"
          style={{
            background: '#121212',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          }}
        >
          <div className="flex h-14 items-center gap-3 px-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              type="button"
              onClick={() => setShowProfilePanel(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md"
              style={{ color: 'rgba(250,250,249,0.72)' }}
              title="Kapat"
            >
              <X size={18} />
            </button>
            <div className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Kişi bilgisi</div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-5 pb-6 pt-7 text-center">
              <button
                type="button"
                onClick={() => chatData.taxpayer.avatarUrl && setShowAvatarPreview(true)}
                className="mx-auto rounded-full"
                style={{ cursor: chatData.taxpayer.avatarUrl ? 'zoom-in' : 'default' }}
                title={chatData.taxpayer.avatarUrl ? 'Profil fotoğrafını büyüt' : undefined}
              >
                <WhatsAppAvatar
                  name={chatData.taxpayer.name}
                  url={chatData.taxpayer.avatarUrl}
                  active={chatData.windowOpen}
                  size={172}
                />
              </button>

              <div className="mt-5 text-[20px] font-semibold leading-tight" style={{ color: '#fafaf9' }}>
                {chatData.taxpayer.name}
              </div>
              {chatData.taxpayer.phone && (
                <div className="mt-1 text-[14px]" style={{ color: 'rgba(250,250,249,0.58)' }}>
                  {chatData.taxpayer.phone}
                </div>
              )}
              <div
                className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
                style={{
                  background: freeFormAvailable ? 'rgba(34,197,94,0.1)' : 'rgba(251,191,36,0.1)',
                  color: freeFormAvailable ? '#86efac' : '#fbbf24',
                }}
              >
                {freeFormAvailable ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                {qrStatus?.connected ? 'QR bağlı' : chatData.windowOpen ? '24h pencere açık' : 'Pencere kapalı'}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={openWhatsAppFromHeader}
                  disabled={!chatData.taxpayer.phone}
                  className="flex h-12 items-center justify-center gap-2 rounded-[10px] text-[12px] font-semibold disabled:opacity-45"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#fafaf9' }}
                >
                  <Phone size={15} /> Ara
                </button>
                <button
                  type="button"
                  onClick={() => setShowProfilePanel(false)}
                  className="flex h-12 items-center justify-center gap-2 rounded-[10px] text-[12px] font-semibold"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#fafaf9' }}
                >
                  <MessageCircle size={15} /> Sohbet
                </button>
              </div>

              {chatData.taxpayer.unknownContact && (
                <button
                  type="button"
                  onClick={() => setShowLinkModal(true)}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-[12px] font-semibold"
                  style={{ background: 'rgba(212,184,118,0.14)', border: '1px solid rgba(212,184,118,0.25)', color: GOLD }}
                >
                  <Link2 size={14} /> Mükellefe bağla
                </button>
              )}
            </div>

            <div className="px-5 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.42)' }}>
                Kayıt bilgileri
              </div>
              <div className="space-y-3 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span style={{ color: 'rgba(250,250,249,0.56)' }}>Telefon</span>
                  <span className="text-right" style={{ color: '#fafaf9' }}>{chatData.taxpayer.phone || '-'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span style={{ color: 'rgba(250,250,249,0.56)' }}>Portal kaydi</span>
                  <span className="text-right" style={{ color: '#fafaf9' }}>
                    {chatData.taxpayer.unknownContact ? 'Kayıtsız WhatsApp' : 'Mükellef kaydı'}
                  </span>
                </div>
                {chatData.taxpayer.taxNumber && (
                  <div className="flex items-center justify-between gap-3">
                    <span style={{ color: 'rgba(250,250,249,0.56)' }}>VKN/TCKN</span>
                    <span className="text-right" style={{ color: '#fafaf9' }}>{chatData.taxpayer.taxNumber}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.42)' }}>
                Konuşma
              </div>
              <div className="space-y-3 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span style={{ color: 'rgba(250,250,249,0.56)' }}>Toplam mesaj</span>
                  <span style={{ color: '#fafaf9' }}>{selectedConversation?.totalMessages ?? chatData.messages.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span style={{ color: 'rgba(250,250,249,0.56)' }}>Son mesaj</span>
                  <span className="text-right" style={{ color: '#fafaf9' }}>
                    {selectedConversation?.lastMessageAt ? fmtFullTime(selectedConversation.lastMessageAt) : '-'}
                  </span>
                </div>
                {selectedConversation?.lastMessage && (
                  <div
                    className="rounded-[10px] px-3 py-2 text-left text-[12px]"
                    style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.74)' }}
                  >
                    {renderWhatsAppLogText(selectedConversation.lastMessage)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>
      )}

      {showAvatarPreview && chatData?.taxpayer?.avatarUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowAvatarPreview(false)}
        >
          <button
            type="button"
            onClick={() => setShowAvatarPreview(false)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
            title="Kapat"
          >
            <X size={22} />
          </button>
          <img
            src={chatData.taxpayer.avatarUrl}
            alt={chatData.taxpayer.name || 'WhatsApp profil'}
            className="max-h-[82vh] max-w-[82vw] rounded-full object-cover"
            style={{ boxShadow: '0 28px 100px rgba(0,0,0,0.55)' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showStartModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowStartModal(false)}
        >
          <div
            className="rounded-2xl p-5 w-full max-w-5xl"
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

            <div className="mb-4 grid grid-cols-2 gap-2 rounded-[12px] border p-1" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.16)' }}>
              {[
                { key: 'contacts', label: 'Rehber' },
                { key: 'manual', label: 'Manuel Numara' },
              ].map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setStartMode(mode.key as 'contacts' | 'manual')}
                  className="h-9 rounded-[10px] text-[12px] font-semibold"
                  style={{
                    background: startMode === mode.key ? 'rgba(212,184,118,0.16)' : 'transparent',
                    color: startMode === mode.key ? GOLD : 'rgba(250,250,249,0.58)',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
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
                {startMode === 'manual' ? (
                  <>
                    <label className="block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Telefon
                    </label>
                    <input
                      value={manualPhone}
                      onChange={(e) => setManualPhone(e.target.value)}
                      placeholder="905xxxxxxxxx"
                      className="mt-1.5 w-full rounded-[10px] border bg-transparent px-3 py-2 text-[13px] outline-none"
                      style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                    />
                    <label className="mt-3 block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Kayıt adı
                    </label>
                    <input
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="Opsiyonel"
                      className="mt-1.5 w-full rounded-[10px] border bg-transparent px-3 py-2 text-[13px] outline-none"
                      style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Telefon
                    </label>
                    <div className="mt-1.5 space-y-2">
                      {(selectedContact?.phones || []).length ? selectedContact!.phones.map((item) => (
                        <button
                          key={`${item.label}-${item.phone}`}
                          type="button"
                          onClick={() => setSelectedPhone(item.phone)}
                          className="w-full rounded-[10px] border px-3 py-2 text-left"
                          style={{
                            borderColor: selectedPhone === item.phone ? 'rgba(212,184,118,0.34)' : 'rgba(255,255,255,0.08)',
                            background: selectedPhone === item.phone ? 'rgba(212,184,118,0.1)' : 'rgba(0,0,0,0.12)',
                            color: '#fafaf9',
                          }}
                        >
                          <div className="text-[12px] font-semibold">{item.phone}</div>
                          <div className="mt-0.5 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.48)' }}>{item.label}</div>
                        </button>
                      )) : (
                        <div className="rounded-[10px] border px-3 py-3 text-[12px]" style={{ borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.45)' }}>
                          Telefon yok
                        </div>
                      )}
                    </div>
                  </>
                )}

                {qrStartAvailable ? (
                  <>
                    <label className="mt-3 block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      İlk mesaj
                    </label>
                    <textarea
                      value={startMessage}
                      onChange={(e) => setStartMessage(e.target.value)}
                      rows={5}
                      placeholder="Merhaba"
                      className="mt-1.5 w-full resize-none rounded-[10px] border bg-transparent px-3 py-2 text-[13px] outline-none"
                      style={{ borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
                    />
                    <div className="mt-2 text-[11px]" style={{ color: 'rgba(134,239,172,0.82)' }}>
                      QR bağlı olduğu için normal WhatsApp mesajı olarak gönderilecek.
                    </div>
                  </>
                ) : (
                  <>
                    <label className="mt-3 block text-[11px] font-medium uppercase tracking-wider" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      Meta şablonu
                    </label>
                    <input
                      value={startTemplateName}
                      onChange={(e) => setStartTemplateName(e.target.value)}
                      list="whatsapp-template-options"
                      placeholder={templateOptions[0] || 'Meta onayli sablon adi'}
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
                  </>
                )}

                <button
                  type="button"
                  onClick={() => startMut.mutate()}
                  disabled={(startMode === 'contacts' ? (!selectedContact || !selectedPhone) : !manualPhone.trim()) || (qrStartAvailable ? !startMessage.trim() : !startTemplateName.trim()) || startMut.isPending}
                  className="mt-4 h-11 w-full rounded-[10px] flex items-center justify-center gap-1.5 text-[13px] font-semibold disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
                >
                  {startMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {qrStartAvailable ? 'Mesajla Başlat' : 'Şablonla Başlat'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLinkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowLinkModal(false)}
        >
          <div
            className="rounded-2xl p-5 w-full max-w-2xl"
            style={{ background: '#1c1813', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 size={17} style={{ color: GOLD }} />
                <h3 className="text-[15px] font-semibold" style={{ color: '#fafaf9' }}>Kayıtsız Konuşmayı Bağla</h3>
              </div>
              <button onClick={() => setShowLinkModal(false)} style={{ color: 'rgba(250,250,249,0.5)' }}>
                <X size={18} />
              </button>
            </div>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(250,250,249,0.38)' }} />
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Mükellef ara..."
                className="w-full h-10 pl-9 pr-3 rounded-[10px] text-[12.5px] outline-none"
                style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
              />
            </div>
            <div className="max-h-[320px] overflow-y-auto space-y-1">
              {contacts.map((contact) => {
                const active = selectedLinkContactId === contact.taxpayerId;
                return (
                  <button
                    key={contact.taxpayerId}
                    type="button"
                    onClick={() => setSelectedLinkContactId(contact.taxpayerId)}
                    className="w-full rounded-[10px] px-3 py-2 text-left"
                    style={{
                      background: active ? 'rgba(212,184,118,0.1)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? 'rgba(212,184,118,0.28)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{contact.taxpayerName}</div>
                    <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{contact.primaryPhone || 'Telefon yok'}</div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => linkMut.mutate()}
              disabled={!selectedLinkContact || linkMut.isPending}
              className="mt-4 h-11 w-full rounded-[10px] flex items-center justify-center gap-1.5 text-[13px] font-semibold disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' }}
            >
              {linkMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Mükellefe Bağla
            </button>
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
              {templateOptions.length === 0 ? (
                <div
                  className="rounded-[10px] px-4 py-3 text-[12px]"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.62)' }}
                >
                  Meta'da bu dil icin onayli sablon bulunamadi.
                </div>
              ) : templateOptions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleSendTemplate(name)}
                  disabled={sendMut.isPending}
                  className="w-full px-4 py-3 rounded-[10px] text-left transition-colors"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{name}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                    Meta onayli sablon
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
