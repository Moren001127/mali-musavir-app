'use client';
import './mesajlar-white.css';

import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  MessageCircle, Send, Search, Clock, AlertCircle, CheckCircle2,
  Loader2, Phone, X, FileText, AlertTriangle, Plus, Users,
  Paperclip, Image as ImageIcon, Link2, Smile, Trash2, Check, CheckCheck, Bot, Zap, Inbox,
} from 'lucide-react';
import { toast } from 'sonner';

const QUICK_EMOJIS = [
  '😀', '😁', '😂', '😊', '😍', '🥰', '😉', '👍', '🙏', '👏', '✅', '📌',
  '📎', '📄', '💰', '📊', '⏰', '⚠️', '❤️', '🤝', '🙋‍♂️', '🙋‍♀️', '☕', '🎉',
];

function WhatsAppAvatar({
  name,
  url,
  active,
  size = 40,
}: {
  name?: string | null;
  url?: string | null;
  active?: boolean;
  size?: number;
}) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const dotSize = Math.min(18, Math.max(9, Math.round(size * 0.26)));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div
        className={`wm-avatar ${active ? 'wm-avatar-active' : ''}`}
        style={{ fontSize: Math.max(12, Math.round(size * 0.34)) }}
      >
        {url ? <img src={url} alt={name || 'WhatsApp profil'} className="h-full w-full object-cover" /> : initial}
      </div>
      {/* Çevrimiçi noktası (WhatsApp tarzı) */}
      {active && (
        <span
          title="çevrimiçi"
          className="wm-avatar-dot"
          style={{ right: Math.round(size * 0.02), bottom: Math.round(size * 0.02), width: dotSize, height: dotSize }}
        />
      )}
    </div>
  );
}

interface ChatPresence {
  status: 'online' | 'typing' | 'recording' | 'paused' | 'offline' | 'unknown';
  label: string;
  at?: string | null;
  lastSeenAt?: string | null;
}

type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed';

interface Conversation {
  conversationId?: string;
  taxpayerId: string;
  taxpayerName: string;
  /** REHBER: bu numaraya mükellef kartında verilen ad. Yoksa null. */
  kisiAdi?: string | null;
  phone: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageDirection: 'incoming' | 'outgoing';
  lastMessageFailed?: boolean;
  /** Sunucu sağlar (şimdilik hep 0); sıfırdan büyükse yeşil rozet. */
  unreadCount?: number;
  windowOpen: boolean;
  lastInboundAt: string | null;
  totalMessages: number;
  unknownContact?: boolean;
  avatarUrl?: string | null;
  presence?: ChatPresence | null;
}

interface ChatMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  subject: string;
  content: string;
  occurredAt: string;
  failed?: boolean;
  providerMessageId?: string | null;
  deliveryStatus?: MessageDeliveryStatus | null;
  deliveryAt?: string | null;
  documents?: Array<{ id: string; title: string; mimeType?: string; sizeBytes?: number; url?: string | null }>;
}

interface ChatData {
  conversationId?: string;
  taxpayer: { id: string; name: string; kisiAdi?: string | null; phone: string | null; taxNumber: string; unknownContact?: boolean; avatarUrl?: string | null; about?: string | null; aboutSetAt?: string | null };
  messages: ChatMessage[];
  windowOpen: boolean;
  windowExpiresAt: string | null;
  presence?: ChatPresence | null;
}

interface WhatsAppQrStatus {
  connected: boolean;
  connecting: boolean;
  hasQr: boolean;
  /** Kayitli oturum var: sunucu gonderim aninda yeniden baglanmayi dener. */
  hasStoredSession?: boolean;
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

// Sadece saat (balon içi, WhatsApp tarzı): "14:32"
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// Sohbet içi tarih ayıracı: "Bugün / Dün / 12 Haziran 2026"
function fmtDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function sameDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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

function isLivePresence(p?: ChatPresence | null): boolean {
  return p?.status === 'online' || p?.status === 'typing' || p?.status === 'recording';
}

// Son görülme zamanını WhatsApp tarzı biçimler: "bugün 14:32 / dün 09:05 / 12 Haziran"
function formatLastSeen(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const saat = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const gun = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const farkGun = Math.round((gun(now) - gun(d)) / 86400000);
  if (farkGun <= 0) return `bugün ${saat}`;
  if (farkGun === 1) return `dün ${saat}`;
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  return `${d.getDate()} ${aylar[d.getMonth()]} ${saat}`;
}

function presenceText(p?: ChatPresence | null): string | null {
  if (!p || p.status === 'unknown') return null;
  if (p.status === 'online') return 'çevrimiçi';
  if (p.status === 'typing') return 'yazıyor...';
  if (p.status === 'recording') return 'ses kaydediyor...';
  if (p.status === 'paused') return 'az önce aktifti';
  if (p.status === 'offline') {
    const ls = formatLastSeen(p.lastSeenAt);
    return ls ? `son görülme ${ls}` : null;
  }
  return null;
}

type DeliveryTone = 'failed' | 'read' | 'delivered' | 'pending' | 'sent';

function deliveryMeta(message: ChatMessage): { label: string; tone: DeliveryTone; icon: typeof Check | typeof CheckCheck | typeof Clock | typeof AlertTriangle } {
  if (message.failed || message.deliveryStatus === 'failed') {
    return { label: 'Gönderilemedi', tone: 'failed', icon: AlertTriangle };
  }
  if (message.deliveryStatus === 'read' || message.deliveryStatus === 'played') {
    return { label: 'Okundu', tone: 'read', icon: CheckCheck };
  }
  if (message.deliveryStatus === 'delivered') {
    return { label: 'Teslim edildi', tone: 'delivered', icon: CheckCheck };
  }
  if (message.deliveryStatus === 'pending') {
    return { label: 'Gönderiliyor', tone: 'pending', icon: Clock };
  }
  return { label: 'Gönderildi', tone: 'sent', icon: Check };
}

/** Giden mesajın kaynağı (kayıt konusundan): MOREN AI botu, otomatik hatırlatma/şablon, ya da elle yazılan. */
function mesajKaynagi(subject?: string | null): 'bot' | 'otomatik' | null {
  const s = String(subject || '');
  if (/bot cevab/i.test(s)) return 'bot';
  if (/hat[ıi]rlatma|sablon|şablon|ak[ıi]ll[ıi] bildirim|brifing|d[öo]k[üu]manlar[ıi]|hesap d[öo]k[üu]m[üu]/i.test(s)) return 'otomatik';
  return null;
}

export default function MesajlarPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeText, setComposeText] = useState('');
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedPhone, setSelectedPhone] = useState('');
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

  const { data: qrStatus } = useQuery<WhatsAppQrStatus>({
    queryKey: ['integration-whatsapp-qr-status'],
    queryFn: () => api.get('/integrations/whatsapp/qr/status').then((r) => r.data),
    refetchInterval: 8000,
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

  // Pencereler Escape ile kapanır
  useEffect(() => {
    if (!showStartModal && !showLinkModal && !showAvatarPreview && !showEmojiPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowStartModal(false);
      setShowLinkModal(false);
      setShowAvatarPreview(false);
      setShowEmojiPicker(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showStartModal, showLinkModal, showAvatarPreview, showEmojiPicker]);

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

  // Konuşma başlatma
  const startMut = useMutation({
    mutationFn: () => {
      if (startMode === 'manual') {
        if (!manualPhone.trim()) throw new Error('Telefon numarasi zorunlu');
        return api.post('/whatsapp/conversations/start', {
          phone: manualPhone.trim(),
          displayName: manualName.trim() || undefined,
          initialMessage: startMessage.trim(),
        }).then((r) => r.data);
      }
      if (!selectedContact) throw new Error('Mükellef seçimi zorunlu');
      const phone = selectedContact.phones.some((item) => item.phone === selectedPhone)
        ? selectedPhone
        : (selectedContact.primaryPhone || selectedContact.phones[0]?.phone || '');
      return api.post('/whatsapp/conversations/start', {
        taxpayerId: selectedContact.taxpayerId,
        phone,
        initialMessage: startMessage.trim(),
      }).then((r) => r.data);
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success('Mesaj gönderildi');
        setShowStartModal(false);
        setSelectedId(res.conversationId || res.taxpayerId);
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

  const deleteConversationMut = useMutation({
    mutationFn: (conversationId: string) =>
      api.delete(`/whatsapp/conversations/${conversationId}`).then((r) => r.data),
    onSuccess: (res, conversationId) => {
      if (res.ok) {
        toast.success('Konuşma portaldan silindi');
        setSelectedId(null);
        setShowProfilePanel(false);
        setShowAvatarPreview(false);
        qc.removeQueries({ queryKey: ['whatsapp-chat', conversationId] });
        qc.invalidateQueries({ queryKey: ['whatsapp-conversations'] });
      } else {
        toast.error(res.error || 'Konuşma silinemedi');
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Silme hatası'),
  });

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return conversations;
    return conversations.filter((c) =>
      c.taxpayerName.toLocaleLowerCase('tr-TR').includes(q) ||
      // Rehber adıyla da aranabilsin: kullanıcı firmayı değil kişiyi arıyor olabilir
      (c.kisiAdi || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (c.phone || '').includes(q),
    );
  }, [conversations, search]);
  const selectedConversation = useMemo(
    () => conversations.find((c) => (c.conversationId || c.taxpayerId) === selectedId) || null,
    [conversations, selectedId],
  );

  // QR (Baileys) hattinda Meta'nin 24 SAAT PENCERESI YOKTUR: baglanti acikken
  // istenen kisiye istenen zaman normal mesaj yazilir. Tek kosul baglantidir.
  const qrConnected = Boolean(qrStatus?.connected);
  // Durum daha gelmediyse ALARM VERME (ilk acilista yanlis kirmizi cikiyordu).
  const qrDurumBilindi = qrStatus !== undefined;
  // Sunucu, kayitli oturum varken gonderim aninda yeniden baglanmayi deniyor
  // (ensureConnected, 18 sn). Ekran bundan DAHA SERT davranmasin: anlik kopmada
  // kutuyu kapatip kullaniciyi bosuna engellemek yerine yazmasina izin ver;
  // gercekten gonderilemezse acik hata mesaji zaten geliyor.
  const gonderimDenenebilir = qrConnected
    || Boolean(qrStatus?.connecting)
    || Boolean(qrStatus?.hasStoredSession);
  const freeFormAvailable = !qrDurumBilindi || gonderimDenenebilir;
  const qrStartAvailable = freeFormAvailable;

  useEffect(() => {
    if (!selectedId) {
      setShowProfilePanel(false);
      setShowAvatarPreview(false);
    }
  }, [selectedId]);

  // Mesaj geldikçe en alta kaydır
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatData?.messages?.length]);

  const handleSend = () => {
    if (!selectedId) return;
    if (!freeFormAvailable) {
      toast.error('WhatsApp baglantisi kapali. Ayarlar > Entegrasyonlar > WhatsApp ekranindan QR kodu yeniden okutun.');
      return;
    }
    const text = composeText.trim();
    if (!text) return;
    setShowEmojiPicker(false);
    sendMut.mutate({ message: text });
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

  const handleDeleteConversation = () => {
    if (!selectedId || deleteConversationMut.isPending) return;
    const ok = window.confirm('Bu konuşmayı portaldan silmek istiyor musun? WhatsApp telefonundaki sohbet silinmez.');
    if (!ok) return;
    deleteConversationMut.mutate(selectedId);
  };

  const handleMediaPicked = (file?: File | null) => {
    if (!file) return;
    mediaMut.mutate(file);
  };

  const openStartModal = () => {
    setShowStartModal(true);
    if (!startMessage.trim()) setStartMessage('Merhaba');
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

  const baglantiCipi = !qrDurumBilindi ? (
    <span className="wm-chip wm-chip-notr"><Loader2 size={12} className="animate-spin" /> Durum kontrol ediliyor</span>
  ) : qrConnected ? (
    <span className="wm-chip wm-chip-yesil"><CheckCircle2 size={12} /> Bağlı</span>
  ) : (
    <span className="wm-chip wm-chip-kirmizi"><AlertCircle size={12} /> Bağlantı kapalı</span>
  );

  return (
    <div data-inceleme="mesajlar" className="wm flex h-[calc(100vh-164px)] w-full max-w-[2200px] gap-3 lg:h-[calc(100vh-88px)]">
      {/* SOL: KONUŞMA LİSTESİ */}
      <div className="wm-card flex w-[350px] flex-shrink-0 flex-col overflow-hidden xl:w-[400px] 2xl:w-[440px]">
        {/* Başlık satırı: yumuşak yeşil simge kutusu + başlık + kişi sayısı çipi + yeni sohbet */}
        <div className="wm-list-head flex items-center gap-2.5 px-4 py-3">
          <span className="wm-head-icon"><MessageCircle size={18} /></span>
          <h1 className="wm-title min-w-0 flex-1 truncate">WhatsApp Mesajlar</h1>
          <span className="wm-chip wm-chip-notr tabular-nums">{conversations.length} kişi</span>
          <button
            type="button"
            onClick={openStartModal}
            title="Yeni konuşma"
            className="wm-btn wm-btn-secondary wm-btn-sm"
          >
            <Plus size={15} /> <span className="hidden xl:inline">Yeni</span>
          </button>
        </div>
        <div className="wm-list-search px-4 py-2.5">
          <div className="relative">
            <Search size={15} className="wm-input-icon absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Mükellef veya telefon ara…"
              className="wm-input h-10 w-full pl-9 pr-3"
            />
          </div>
        </div>

        {/* Konuşma satırları */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="wm-muted p-6 text-center text-[12.5px]">
              <Loader2 size={16} className="mx-auto mb-2 animate-spin" /> Yükleniyor...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="wm-empty m-4 px-4 py-8 text-center">
              <MessageCircle size={20} className="mx-auto mb-2" />
              <div className="text-[12.5px]">
                {conversations.length === 0
                  ? 'Henüz bir mesajlaşma yok.'
                  : 'Aramaya uyan kayıt yok.'}
              </div>
            </div>
          ) : (
            filteredConversations.map((c) => {
              const id = c.conversationId || c.taxpayerId;
              const isSelected = id === selectedId;
              const unread = Number(c.unreadCount || 0);
              const gorunenAd = c.kisiAdi || c.taxpayerName;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedId(id)}
                  data-selected={isSelected ? 'true' : undefined}
                  title={c.phone ? `${gorunenAd} · ${c.phone}` : gorunenAd}
                  className="wm-row flex w-full items-center gap-3 px-4 py-2.5 text-left"
                >
                  {/* REHBER ADI önce: kullanıcı bu numaraya ad yazdıysa firma adı yerine o görünür. Firma bağı değişmez. */}
                  <WhatsAppAvatar name={gorunenAd} url={c.avatarUrl} active={isLivePresence(c.presence)} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="wm-row-name truncate">{gorunenAd}</span>
                      <span className="wm-row-time flex-shrink-0 tabular-nums">{fmtTime(c.lastMessageAt)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {c.lastMessageDirection === 'outgoing' && (
                        c.lastMessageFailed
                          ? <AlertTriangle size={12} className="wm-row-tick wm-tick-failed flex-shrink-0" />
                          : <CheckCheck size={13} className="wm-row-tick flex-shrink-0" />
                      )}
                      <span className={`wm-row-last min-w-0 flex-1 truncate ${unread > 0 ? 'wm-row-last-unread' : ''}`}>
                        {renderWhatsAppLogText(c.lastMessage) || '(boş mesaj)'}
                      </span>
                      {unread > 0 && <span className="wm-unread tabular-nums">{unread}</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* SAĞ: SOHBET */}
      <div className="wm-card flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedId ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="wm-empty w-full max-w-md px-6 py-10 text-center">
              <span className="wm-empty-icon mx-auto mb-3"><Inbox size={22} /></span>
              <div className="wm-empty-title">Bir konuşma seç</div>
              <p className="wm-empty-text mt-1">Sol listeden bir mükellef seç; mesajlar burada açılır.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Sohbet başlığı */}
            <div className="wm-chat-head flex items-center gap-3 px-5 py-3">
              <button type="button" onClick={() => setShowProfilePanel(true)} className="rounded-full" title="Kişi bilgisi">
                <WhatsAppAvatar name={chatData?.taxpayer?.kisiAdi || chatData?.taxpayer?.name} url={chatData?.taxpayer?.avatarUrl} active={isLivePresence(chatData?.presence)} size={40} />
              </button>
              <button type="button" onClick={() => setShowProfilePanel(true)} className="min-w-0 flex-1 text-left">
                <div className="wm-chat-name truncate">
                  {chatData?.taxpayer?.kisiAdi || chatData?.taxpayer?.name || 'Yükleniyor...'}
                </div>
                <div className="wm-chat-meta mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {/* Rehber adı gösteriliyorsa firma adı kaybolmasın — hangi mükellefle konuşulduğu görünür kalmalı. */}
                  {chatData?.taxpayer?.kisiAdi && chatData?.taxpayer?.name && (
                    <span className="truncate">{chatData.taxpayer.name}</span>
                  )}
                  {chatData?.taxpayer?.phone && (
                    <span className="inline-flex items-center gap-1 tabular-nums"><Phone size={11} /> {chatData.taxpayer.phone}</span>
                  )}
                  {chatData?.taxpayer?.taxNumber && (
                    <span className="tabular-nums">VKN {chatData.taxpayer.taxNumber}</span>
                  )}
                  {presenceText(chatData?.presence) && (
                    <span className={isLivePresence(chatData?.presence) ? 'wm-presence-live' : ''}>{presenceText(chatData?.presence)}</span>
                  )}
                </div>
              </button>
              <div className="flex flex-shrink-0 items-center gap-2">
                {baglantiCipi}
                {chatData?.taxpayer?.unknownContact && (
                  <button
                    type="button"
                    onClick={() => setShowLinkModal(true)}
                    className="wm-btn wm-btn-civit wm-btn-sm"
                  >
                    <Link2 size={13} /> Mükellefe Bağla
                  </button>
                )}
                {chatData?.taxpayer?.phone && (
                  <button
                    type="button"
                    onClick={openWhatsAppFromHeader}
                    title="WhatsApp'ta aç ve ara"
                    className="wm-btn wm-btn-secondary wm-btn-icon"
                  >
                    <Phone size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDeleteConversation}
                  disabled={deleteConversationMut.isPending}
                  title="Konuşmayı sil"
                  className="wm-btn wm-btn-danger wm-btn-icon"
                >
                  {deleteConversationMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </div>
            </div>

            {/* Mesajlar */}
            <div ref={scrollRef} data-wm-sohbet className="wm-chat flex-1 space-y-2 overflow-y-auto px-6 py-4">
              {!chatData ? (
                <div className="wm-muted py-10 text-center">
                  <Loader2 size={16} className="mx-auto animate-spin" />
                </div>
              ) : chatData.messages.length === 0 ? (
                <div className="wm-muted py-10 text-center text-[12.5px]">
                  {qrConnected ? 'Henüz mesaj yok. Aşağıdan normal WhatsApp mesajı yazabilirsin.' : 'Henüz mesaj yok. Bağlantı gelince buradan yazabilirsin.'}
                </div>
              ) : (
                chatData.messages.map((m, idx) => {
                  const incoming = m.direction === 'incoming';
                  const parsed = parseMessageContent(m.content);
                  const docs = m.documents?.length ? m.documents : parsed.docs;
                  const delivery = incoming ? null : deliveryMeta(m);
                  const DeliveryIcon = delivery?.icon;
                  const kaynak = incoming ? null : mesajKaynagi(m.subject);
                  const prev = idx > 0 ? chatData.messages[idx - 1] : null;
                  const showDate = !prev || sameDayKey(prev.occurredAt) !== sameDayKey(m.occurredAt);
                  const bubbleTone = `${incoming ? 'wm-bubble-in' : kaynak ? 'wm-bubble-sys' : 'wm-bubble-out'}${m.failed ? ' wm-bubble-hatali' : ''}`;
                  return (
                    <Fragment key={m.id}>
                      {showDate && (
                        <div className="flex justify-center py-1.5">
                          <span className="wm-date">{fmtDateSeparator(m.occurredAt)}</span>
                        </div>
                      )}
                      <div className={`flex ${incoming ? 'justify-start' : 'justify-end'}`}>
                        <div className={`wm-bubble ${bubbleTone}`}>
                          {kaynak && (
                            <div className="wm-bubble-tag">
                              {kaynak === 'bot' ? <><Bot size={11} /> MOREN AI botu</> : <><Zap size={11} /> Otomatik mesaj</>}
                            </div>
                          )}
                          {(parsed.text || docs.length === 0) && (
                            <div className="whitespace-pre-wrap break-words">{parsed.text || '(boş)'}</div>
                          )}
                          {docs.length > 0 && (
                            <div className={`space-y-1.5 ${parsed.text ? 'mt-2' : ''}`}>
                              {docs.map((doc) => (
                                <div key={doc.id} className="wm-doc overflow-hidden">
                                  {isImageDoc(doc) && doc.url ? (
                                    <button type="button" onClick={() => openDocument(doc.id)} className="block w-full">
                                      <img src={doc.url} alt={doc.title} className="max-h-64 w-full object-contain" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => openDocument(doc.id)}
                                      className="flex max-w-full items-center gap-2.5 px-2.5 py-2 text-left"
                                    >
                                      <span className="wm-doc-icon">{isPdfDoc(doc) ? <FileText size={15} /> : <ImageIcon size={15} />}</span>
                                      <span className="wm-doc-title min-w-0 flex-1 truncate">{doc.title}</span>
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {m.failed && (
                            <div className="wm-bubble-failed mt-2 flex items-center gap-1.5">
                              <AlertTriangle size={11} /> WhatsApp&apos;a gönderilemedi
                            </div>
                          )}
                          <div className="wm-bubble-meta mt-1 flex items-center justify-end gap-1.5 tabular-nums">
                            <span title={fmtFullTime(m.occurredAt)}>{fmtClock(m.occurredAt)}</span>
                            {delivery && DeliveryIcon && (
                              <span className={`inline-flex items-center wm-tick-${delivery.tone}`} title={delivery.label}>
                                <DeliveryIcon size={14} />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  );
                })
              )}
            </div>

            {/* Yazı kutusu */}
            <div className="wm-compose px-4 py-3">
              {freeFormAvailable ? (
                <>
                  {qrDurumBilindi && !qrConnected && (
                    <div className="wm-note wm-note-kehribar mb-2 flex items-start gap-2 px-3 py-2">
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <div className="text-[12px]">
                        Bağlantı şu an kopuk. Gönderirken otomatik yeniden bağlanmayı deneyecek; olmazsa
                        {' '}<strong>Ayarlar › Entegrasyonlar › WhatsApp</strong> ekranından QR&apos;ı yeniden okutun.
                      </div>
                    </div>
                  )}
                  <div className="flex items-end gap-2.5">
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
                      className="wm-btn wm-btn-secondary wm-btn-icon wm-btn-lg"
                    >
                      {mediaMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={16} />}
                    </button>
                    <div className="relative flex-1">
                      {showEmojiPicker && (
                        <div className="wm-popover absolute bottom-[54px] left-0 z-20 w-[320px] max-w-[calc(100vw-48px)] p-3">
                          <div className="wm-label mb-2">Sık kullanılanlar</div>
                          <div className="grid grid-cols-8 gap-1">
                            {QUICK_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => insertEmoji(emoji)}
                                className="wm-emoji h-8 rounded-md text-[20px] leading-none"
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
                        className="wm-emoji-toggle absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-md"
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
                        placeholder="Mesaj yaz… (Enter = gönder, Shift+Enter = yeni satır)"
                        rows={2}
                        className="wm-input wm-textarea w-full resize-none py-2.5 pl-11 pr-3"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!composeText.trim() || sendMut.isPending}
                      className="wm-btn wm-btn-primary wm-btn-lg"
                    >
                      {sendMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Gönder
                    </button>
                  </div>
                </>
              ) : (
                /* QR bağlantısı kapalı. Meta'nın 24 saat penceresi ve şablon kavramı QR hattında YOKTUR;
                   tek engel bağlantıdır. Burada gerçek sebep ve çözüm gösterilir. */
                <div className="wm-note wm-note-kirmizi flex items-start gap-2 px-3 py-3">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <div className="text-[12.5px]">
                    <strong>WhatsApp bağlantısı kapalı.</strong> Telefon uzun süre çevrimdışı kalınca bağlantı düşebiliyor.
                    {' '}<strong>Ayarlar › Entegrasyonlar › WhatsApp</strong> ekranından QR&apos;ı telefonla yeniden okutun.
                    Bağlanır bağlanmaz mesaj kutusu bu konuşmada kendiliğinden açılır.
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* KİŞİ BİLGİSİ PANELİ */}
      {showProfilePanel && chatData && (
        <aside className="wm-panel fixed bottom-4 right-4 top-4 z-40 flex w-[min(380px,calc(100vw-32px))] shrink-0 flex-col overflow-hidden xl:static xl:h-auto xl:w-[360px] xl:min-w-[340px]">
          <div className="wm-panel-head flex h-14 items-center gap-2 px-3">
            <button
              type="button"
              onClick={() => setShowProfilePanel(false)}
              className="wm-btn wm-btn-ghost wm-btn-icon"
              title="Kapat"
            >
              <X size={17} />
            </button>
            <div className="wm-panel-title">Kişi bilgisi</div>
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
                  active={isLivePresence(chatData.presence)}
                  size={148}
                />
              </button>

              <div className="wm-panel-name mt-4">{chatData.taxpayer.name}</div>
              {chatData.taxpayer.phone && (
                <div className="wm-muted mt-1 text-[13px] tabular-nums">{chatData.taxpayer.phone}</div>
              )}
              <div className="mt-3">{baglantiCipi}</div>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={openWhatsAppFromHeader}
                  disabled={!chatData.taxpayer.phone}
                  className="wm-btn wm-btn-secondary h-11 justify-center"
                >
                  <Phone size={14} /> Ara
                </button>
                <button
                  type="button"
                  onClick={() => setShowProfilePanel(false)}
                  className="wm-btn wm-btn-secondary h-11 justify-center"
                >
                  <MessageCircle size={14} /> Sohbet
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConversation}
                  disabled={deleteConversationMut.isPending}
                  className="wm-btn wm-btn-danger h-11 justify-center"
                >
                  {deleteConversationMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Sil
                </button>
              </div>

              {chatData.taxpayer.unknownContact && (
                <button
                  type="button"
                  onClick={() => setShowLinkModal(true)}
                  className="wm-btn wm-btn-civit mt-3 h-11 w-full justify-center"
                >
                  <Link2 size={14} /> Mükellefe bağla
                </button>
              )}
            </div>

            {/* Durum (WhatsApp hakkında) */}
            {chatData.taxpayer.about && (
              <div className="wm-panel-section px-5 py-4">
                <div className="wm-label mb-2">Durum</div>
                <div className="wm-ink text-[13.5px] leading-relaxed">{chatData.taxpayer.about}</div>
                {formatLastSeen(chatData.taxpayer.aboutSetAt) && (
                  <div className="wm-faint mt-1 text-[11px]">{formatLastSeen(chatData.taxpayer.aboutSetAt)}</div>
                )}
              </div>
            )}

            {/* Çevrimiçi / son görülme */}
            {presenceText(chatData.presence) && (
              <div className="wm-panel-section flex items-center justify-between gap-3 px-5 py-3">
                <span className="wm-muted text-[13px]">Durum bilgisi</span>
                <span className={`text-[13px] font-medium ${isLivePresence(chatData.presence) ? 'wm-presence-live' : 'wm-ink'}`}>
                  {presenceText(chatData.presence)}
                </span>
              </div>
            )}

            {/* Ortak medya, bağlantılar ve belgeler */}
            {(() => {
              const docs = chatData.messages
                .flatMap((m) => (m.documents || []).map((d) => ({ ...d })))
                .filter((d) => d.url);
              if (!docs.length) return null;
              const images = docs.filter((d) => isImageDoc(d));
              const files = docs.filter((d) => !isImageDoc(d));
              return (
                <div className="wm-panel-section px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="wm-label">Medya, bağlantılar ve belgeler</span>
                    <span className="wm-chip wm-chip-notr wm-chip-sm tabular-nums">{docs.length}</span>
                  </div>
                  {images.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {images.slice(0, 9).map((d) => (
                        <a
                          key={d.id}
                          href={d.url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="wm-thumb aspect-square overflow-hidden rounded-[8px]"
                          title={d.title}
                        >
                          <img src={d.url || ''} alt={d.title} className="h-full w-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  {files.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {files.slice(0, 6).map((d) => (
                        <a
                          key={d.id}
                          href={d.url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="wm-file flex items-center gap-2.5 px-2.5 py-2 text-[12.5px]"
                          title={d.title}
                        >
                          <Paperclip size={13} className="wm-file-icon flex-shrink-0" />
                          <span className="truncate">{d.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="wm-panel-section px-5 py-4">
              <div className="wm-label mb-3">Kayıt bilgileri</div>
              <div className="space-y-2.5 text-[13px]">
                <div className="wm-kv"><span>Telefon</span><span className="tabular-nums">{chatData.taxpayer.phone || '-'}</span></div>
                <div className="wm-kv"><span>Portal kaydı</span><span>{chatData.taxpayer.unknownContact ? 'Kayıtsız WhatsApp' : 'Mükellef kaydı'}</span></div>
                {chatData.taxpayer.taxNumber && (
                  <div className="wm-kv"><span>VKN/TCKN</span><span className="tabular-nums">{chatData.taxpayer.taxNumber}</span></div>
                )}
              </div>
            </div>

            <div className="wm-panel-section px-5 py-4">
              <div className="wm-label mb-3">Konuşma</div>
              <div className="space-y-2.5 text-[13px]">
                <div className="wm-kv"><span>Toplam mesaj</span><span className="tabular-nums">{selectedConversation?.totalMessages ?? chatData.messages.length}</span></div>
                <div className="wm-kv"><span>Son mesaj</span><span className="tabular-nums">{selectedConversation?.lastMessageAt ? fmtFullTime(selectedConversation.lastMessageAt) : '-'}</span></div>
                {selectedConversation?.lastMessage && (
                  <div className="wm-quote px-3 py-2 text-left text-[12px]">
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
          className="wm-lightbox fixed inset-0 z-[70] flex items-center justify-center p-6"
          onClick={() => setShowAvatarPreview(false)}
        >
          <button
            type="button"
            onClick={() => setShowAvatarPreview(false)}
            className="wm-lightbox-close absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full"
            title="Kapat"
          >
            <X size={22} />
          </button>
          <img
            src={chatData.taxpayer.avatarUrl}
            alt={chatData.taxpayer.name || 'WhatsApp profil'}
            className="wm-lightbox-img max-h-[82vh] max-w-[82vw] rounded-full object-cover"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* YENİ KONUŞMA PENCERESİ */}
      {showStartModal && (
        <div
          className="wm-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowStartModal(false)}
        >
          <div
            className="wm-dialog w-full max-w-5xl p-5"
            role="dialog"
            aria-label="Rehberden konuşma başlat"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="wm-head-icon"><Users size={17} /></span>
                <div>
                  <h3 className="wm-dialog-title">Rehberden Konuşma Başlat</h3>
                  <p className="wm-muted text-[12px]">Mükellef seç, numarayı doğrula, ilk mesajı gönder.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowStartModal(false)} className="wm-btn wm-btn-ghost wm-btn-icon" title="Pencereyi kapat">
                <X size={17} />
              </button>
            </div>

            <div className="wm-seg mb-4 grid grid-cols-2 gap-1">
              {[
                { key: 'contacts', label: 'Rehber' },
                { key: 'manual', label: 'Numara yaz' },
              ].map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setStartMode(mode.key as 'contacts' | 'manual')}
                  data-active={startMode === mode.key ? 'true' : undefined}
                  className="wm-seg-btn h-9"
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="wm-subcard min-h-[360px] p-3">
                <div className="relative mb-3">
                  <Search size={14} className="wm-input-icon absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      setSelectedContactId(null);
                    }}
                    placeholder="Rehberde ara…"
                    className="wm-input h-10 w-full pl-9 pr-3"
                  />
                </div>

                <div className="max-h-[310px] space-y-1 overflow-y-auto">
                  {contactsLoading ? (
                    <div className="wm-muted py-10 text-center text-[12.5px]">
                      <Loader2 size={16} className="mx-auto mb-2 animate-spin" /> Yükleniyor...
                    </div>
                  ) : contacts.length === 0 ? (
                    <div className="wm-muted py-10 text-center text-[12.5px]">Kayıt bulunamadı.</div>
                  ) : contacts.map((contact) => {
                    const active = contact.taxpayerId === selectedContactId;
                    const canSend = contact.phones.length > 0;
                    return (
                      <button
                        key={contact.taxpayerId}
                        type="button"
                        onClick={() => setSelectedContactId(contact.taxpayerId)}
                        disabled={!canSend}
                        data-active={active ? 'true' : undefined}
                        className="wm-pick w-full px-3 py-2 text-left disabled:opacity-45"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="wm-pick-name truncate">{contact.taxpayerName}</div>
                            <div className="wm-muted mt-0.5 text-[11.5px] tabular-nums">{contact.primaryPhone || 'Telefon yok'}</div>
                          </div>
                          {contact.hasConversation && (
                            <span className="wm-chip wm-chip-yesil wm-chip-sm">Sohbet var</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="wm-subcard p-3">
                {startMode === 'manual' ? (
                  <>
                    <label className="wm-label block">Telefon</label>
                    <input
                      value={manualPhone}
                      onChange={(e) => setManualPhone(e.target.value)}
                      placeholder="905xxxxxxxxx"
                      className="wm-input mt-1.5 h-10 w-full px-3"
                    />
                    <label className="wm-label mt-3 block">Kayıt adı</label>
                    <input
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="İsteğe bağlı"
                      className="wm-input mt-1.5 h-10 w-full px-3"
                    />
                  </>
                ) : (
                  <>
                    <label className="wm-label block">Telefon</label>
                    <div className="mt-1.5 space-y-2">
                      {(selectedContact?.phones || []).length ? selectedContact!.phones.map((item) => (
                        <button
                          key={`${item.label}-${item.phone}`}
                          type="button"
                          onClick={() => setSelectedPhone(item.phone)}
                          data-active={selectedPhone === item.phone ? 'true' : undefined}
                          className="wm-pick w-full px-3 py-2 text-left"
                        >
                          <div className="wm-pick-name tabular-nums">{item.phone}</div>
                          <div className="wm-muted mt-0.5 text-[11px]">{item.label}</div>
                        </button>
                      )) : (
                        <div className="wm-empty px-3 py-3 text-[12px]">Telefon yok</div>
                      )}
                    </div>
                  </>
                )}

                <label className="wm-label mt-3 block">İlk mesaj</label>
                <textarea
                  value={startMessage}
                  onChange={(e) => setStartMessage(e.target.value)}
                  rows={5}
                  placeholder="Merhaba"
                  className="wm-input mt-1.5 w-full resize-none px-3 py-2"
                />
                {qrStartAvailable ? (
                  <div className="wm-hint wm-hint-yesil mt-2 text-[11.5px]">Bağlantı açık — normal WhatsApp mesajı olarak gönderilecek.</div>
                ) : (
                  <div className="wm-hint wm-hint-kirmizi mt-2 text-[11.5px]">
                    WhatsApp bağlantısı kapalı. Ayarlar › Entegrasyonlar › WhatsApp ekranından QR&apos;ı yeniden okutun; bağlanınca buradan konuşma başlatabilirsiniz.
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => startMut.mutate()}
                  disabled={(startMode === 'contacts' ? (!selectedContact || !selectedPhone) : !manualPhone.trim()) || !startMessage.trim() || !qrStartAvailable || startMut.isPending}
                  className="wm-btn wm-btn-primary mt-4 h-11 w-full justify-center"
                >
                  {startMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {qrStartAvailable ? 'Mesajla Başlat' : 'Bağlantı bekleniyor'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KAYITSIZ KONUŞMAYI BAĞLA */}
      {showLinkModal && (
        <div
          className="wm-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowLinkModal(false)}
        >
          <div
            className="wm-dialog w-full max-w-2xl p-5"
            role="dialog"
            aria-label="Kayıtsız konuşmayı bağla"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="wm-head-icon wm-head-icon-civit"><Link2 size={17} /></span>
                <div>
                  <h3 className="wm-dialog-title">Kayıtsız Konuşmayı Bağla</h3>
                  <p className="wm-muted text-[12px]">Bu numaranın mesajları seçtiğin mükellefin kartına taşınır.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowLinkModal(false)} className="wm-btn wm-btn-ghost wm-btn-icon" title="Pencereyi kapat">
                <X size={17} />
              </button>
            </div>
            <div className="relative mb-3">
              <Search size={14} className="wm-input-icon absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Mükellef ara…"
                className="wm-input h-10 w-full pl-9 pr-3"
              />
            </div>
            <div className="max-h-[320px] space-y-1 overflow-y-auto">
              {contacts.map((contact) => {
                const active = selectedLinkContactId === contact.taxpayerId;
                return (
                  <button
                    key={contact.taxpayerId}
                    type="button"
                    onClick={() => setSelectedLinkContactId(contact.taxpayerId)}
                    data-active={active ? 'true' : undefined}
                    className="wm-pick w-full px-3 py-2 text-left"
                  >
                    <div className="wm-pick-name">{contact.taxpayerName}</div>
                    <div className="wm-muted mt-0.5 text-[11.5px] tabular-nums">{contact.primaryPhone || 'Telefon yok'}</div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => linkMut.mutate()}
              disabled={!selectedLinkContact || linkMut.isPending}
              className="wm-btn wm-btn-primary wm-btn-civit-solid mt-4 h-11 w-full justify-center"
            >
              {linkMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Mükellefe Bağla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
