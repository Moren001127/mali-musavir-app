'use client';

import { api } from '@/lib/api';
import { aiSuggestTemplate } from '@/lib/message-templates';
import {
  Bot, CalendarClock, CalendarPlus, CheckCheck, Clock, Download, Edit3,
  FilePlus2, Globe, History, LibraryBig, Loader2, Mail, MapPin, Megaphone, MessageCircle, Phone,
  Save, Search, Send, SlidersHorizontal, Sparkles, Trash2, Users, Wand2, X,
} from 'lucide-react';
import { toJpeg } from 'html-to-image';
import type { ReactNode, Ref } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

type FontStyleKey = 'klasik' | 'resmi' | 'modern';

type Duyuru = {
  id: string;
  tarih: string;
  no: string;
  baslik: string;
  icerik: string;
  baslikPunto: number;
  icerikPunto: number;
  baslikStil: FontStyleKey;
  icerikStil: FontStyleKey;
};

type Taxpayer = {
  id: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  phones?: string[] | null;
  type?: string | null;
  defterTuru?: string | null;
  isEFaturaMukellefi?: boolean | null;
  isActive?: boolean | null;
};

type LegacyDuyuru = Partial<Duyuru> & { metin?: string; altBaslik?: string; etiket?: string };

type SentRecord = { id: string; at: string; baslik: string; kanal: string; adet: number; basarili: number; hatali: number; grup: string };
type Scheduled = { id: string; when: string; baslik: string; icerik: string; tarih: string; no: string; grup: string; ids: string[]; adet: number; message: string };

const STORAGE_KEY = 'moren-duyurular-v3';
const LEGACY_STORAGE_KEY = 'moren-duyurular-v2';
const TAKVIM_KEY = 'moren-duyuru-vergi-takvimi';
const HISTORY_KEY = 'moren-duyuru-gecmis';
const SCHED_KEY = 'moren-duyuru-planli';

const NAVY = '#0d1238';
const PAPER = '#f7f4eb';
const GOLD = '#d7c28b';
const COPPER = '#d9a06c';
const TEXT = '#f8fafc';
const MUTED = '#cbd5e1';
const SOFT = '#9ca3af';
const BORDER = 'rgba(255,255,255,0.14)';
const LINE = 'rgba(255,255,255,0.08)';
const ANNOUNCEMENT_LOGO = '/duyuru-sablonlari/assets/logo-white.png';
const SANS = 'Inter, Manrope, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CANVAS_SIZE = 1080;
const MIN_PREVIEW_SIZE = 470;
const MAX_PREVIEW_SIZE = 760;
type FontOption = { label: string; family: string; weight: number; lineHeight: number; letterSpacing?: string };

const TITLE_STYLES: Record<FontStyleKey, FontOption> = {
  klasik: { label: 'Şablon Başlık', family: 'Georgia, "Times New Roman", serif', weight: 600, lineHeight: 1.02, letterSpacing: '-0.028em' },
  resmi: { label: 'Kurumsal Başlık', family: '"Times New Roman", Georgia, serif', weight: 700, lineHeight: 1.04, letterSpacing: '-0.016em' },
  modern: { label: 'Sade Başlık', family: SANS, weight: 800, lineHeight: 1.12, letterSpacing: '0' },
};

const BODY_STYLES: Record<FontStyleKey, FontOption> = {
  klasik: { label: 'Şablon Metin', family: 'Georgia, "Times New Roman", serif', weight: 400, lineHeight: 1.58, letterSpacing: '0.004em' },
  resmi: { label: 'Resmi Metin', family: '"Times New Roman", Georgia, serif', weight: 400, lineHeight: 1.62, letterSpacing: '0.002em' },
  modern: { label: 'Sade Metin', family: SANS, weight: 500, lineHeight: 1.48, letterSpacing: '0' },
};

const initial: Duyuru = {
  id: 'draft',
  tarih: '12.05.2026',
  no: '2026 / 14',
  baslik: 'MYK Mesleki Yeterlilik Belgesi Zorunluluğu',
  icerik:
    'Sayın müvekkilimiz, ilgili mevzuat kapsamında işyerinizde çalıştırdığınız personel için mesleki yeterlilik belgesi yükümlülüğü bulunmaktadır. Detaylı bilgi ve süreç takibi için ofisimizle iletişime geçebilirsiniz.',
  baslikPunto: 64,
  icerikPunto: 28,
  baslikStil: 'klasik',
  icerikStil: 'resmi',
};

// ───────────────────────── Vergi Takvimi · Hazır Duyurular ─────────────────────────
const TR_AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

type VergiPreset = { key: string; kisa: string; label: string; color: string; gun: number; baslik: string; icerik: string };

const VERGI_PRESETS: VergiPreset[] = [
  {
    key: 'kdv1', kisa: 'KDV', label: '1 No.lu KDV Beyannamesi', color: '#34d399', gun: 28,
    baslik: 'KDV Beyannamesi Son Ödeme Hatırlatması',
    icerik:
      'Sayın müvekkilimiz,\n\n{donem} dönemine ait 1 No.lu Katma Değer Vergisi (KDV) beyannamesinin son ödeme tarihi {tarih} günüdür. Gecikme faizi ve cezalı duruma düşülmemesi adına ödemelerinizi son güne bırakmamanızı önemle rica ederiz.',
  },
  {
    key: 'kdv2', kisa: 'KDV2', label: '2 No.lu KDV Beyannamesi', color: '#22d3ee', gun: 28,
    baslik: '2 No.lu KDV Beyannamesi Son Ödeme',
    icerik:
      'Sayın müvekkilimiz,\n\n{donem} dönemine ait 2 No.lu (sorumlu sıfatıyla) Katma Değer Vergisi beyannamesinin son ödeme tarihi {tarih} günüdür. Tevkifata tabi işlemlerinize ilişkin ödemelerinizi zamanında gerçekleştirmenizi rica ederiz.',
  },
  {
    key: 'muhtasar', kisa: 'Muhtasar', label: 'Muhtasar ve Prim Hizmet (MUHSGK)', color: '#60a5fa', gun: 26,
    baslik: 'Muhtasar ve Prim Hizmet Beyannamesi Son Ödeme',
    icerik:
      'Sayın müvekkilimiz,\n\n{donem} dönemine ait Muhtasar ve Prim Hizmet Beyannamesi (MUHSGK) tahakkukunun son ödeme tarihi {tarih} günüdür. Vergi ve SGK prim ödemelerinizi zamanında gerçekleştirmenizi rica ederiz.',
  },
  {
    key: 'bagkur', kisa: 'Bağ-Kur', label: 'Bağ-Kur (4/b) Primi', color: '#fb923c', gun: 0,
    baslik: 'Bağ-Kur Primi Son Ödeme Hatırlatması',
    icerik:
      'Sayın müvekkilimiz,\n\n{donem} dönemine ait Bağ-Kur (4/b) sigorta priminin son ödeme tarihi {tarih} günüdür. Sağlık hizmetlerinden kesintisiz yararlanabilmeniz ve gecikme zammı oluşmaması adına priminizi zamanında ödemenizi rica ederiz.',
  },
];

// ───────────────────────── Genel Duyuru Kütüphanesi (vergi dışı) ─────────────────────────
type GenelPreset = { key: string; label: string; color: string; baslik: string; icerik: string };

const GENEL_PRESETS: GenelPreset[] = [
  {
    key: 'tatil', label: 'Resmî Tatil / Ofis Kapalı', color: '#f472b6',
    baslik: 'Ofisimiz Resmî Tatil Nedeniyle Kapalıdır',
    icerik: 'Sayın müvekkilimiz,\n\nResmî tatil nedeniyle ofisimiz [tarih aralığı] tarihlerinde kapalı olacaktır. Bu süre içinde acil işlemleriniz için 0535 058 74 75 numaralı telefondan bize ulaşabilirsiniz. Anlayışınız için teşekkür ederiz.',
  },
  {
    key: 'mevzuat', label: 'Mevzuat / Yasal Değişiklik', color: '#a855f7',
    baslik: 'Önemli Mevzuat Değişikliği Bilgilendirmesi',
    icerik: 'Sayın müvekkilimiz,\n\n[konu] hakkında yürürlüğe giren mevzuat değişikliği işletmenizi yakından ilgilendirmektedir. Sürecin doğru yönetilmesi ve mağduriyet yaşanmaması adına detayları görüşmek üzere ofisimizle iletişime geçmenizi rica ederiz.',
  },
  {
    key: 'saat', label: 'Ofis Çalışma Saatleri', color: '#60a5fa',
    baslik: 'Çalışma Saatlerimiz Hakkında Bilgilendirme',
    icerik: 'Sayın müvekkilimiz,\n\nOfisimizin çalışma saatleri hafta içi 09:00 - 18:00 olarak güncellenmiştir. Randevu ve evrak teslimi için bu saatler içinde bize ulaşabilirsiniz. Bilginize sunarız.',
  },
  {
    key: 'bayram', label: 'Bayram / Kutlama', color: '#34d399',
    baslik: 'Bayramınız Kutlu Olsun',
    icerik: 'Değerli müvekkilimiz,\n\nYaklaşan bayramınızı en içten dileklerimizle kutlar; sağlık, huzur ve bereket dolu günler dileriz.\n\nMoren Mali Müşavirlik',
  },
  {
    key: 'ucret', label: 'Hizmet Bedeli Bilgilendirmesi', color: '#fbbf24',
    baslik: 'Hizmet Bedeli Güncellemesi Hakkında',
    icerik: 'Sayın müvekkilimiz,\n\n[yıl] yılı için geçerli olacak hizmet bedellerimiz hakkında bilgilendirme yapmak isteriz. Detaylı bilgi ve sözleşme yenileme işlemleri için ofisimizle iletişime geçebilirsiniz.',
  },
  {
    key: 'bos', label: 'Boş Duyuru (sıfırdan)', color: '#9ca3af',
    baslik: '', icerik: '',
  },
];

// ───────────────────────── Alıcı grupları ─────────────────────────
type GroupKey = 'all' | 'tuzel' | 'gercek' | 'bilanco' | 'isletme' | 'efatura' | 'manual';
const RECIPIENT_GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'tuzel', label: 'Tüzel (şirket)' },
  { key: 'gercek', label: 'Gerçek kişi' },
  { key: 'bilanco', label: 'Bilanço' },
  { key: 'isletme', label: 'İşletme' },
  { key: 'efatura', label: 'E-Fatura' },
  { key: 'manual', label: 'Tek tek seç' },
];

function hasPhone(t: Taxpayer) {
  return Boolean(t.phone || (Array.isArray(t.phones) && t.phones.some(Boolean)));
}
function matchGroup(t: Taxpayer, g: GroupKey, selected: Set<string>) {
  if (g === 'manual') return selected.has(t.id);
  if (g === 'all') return true;
  if (g === 'tuzel') return t.type === 'TUZEL_KISI';
  if (g === 'gercek') return t.type === 'GERCEK_KISI';
  if (g === 'bilanco') return String(t.defterTuru || '').toUpperCase() === 'BILANCO';
  if (g === 'isletme') return String(t.defterTuru || '').toUpperCase() === 'ISLETME';
  if (g === 'efatura') return Boolean(t.isEFaturaMukellefi);
  return true;
}
function taxpayerName(t: Taxpayer) {
  return (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim() || 'İsimsiz';
}
const defaultTakvim = (): Record<string, number> => Object.fromEntries(VERGI_PRESETS.map((p) => [p.key, p.gun]));

function lastDayOfMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}
function computeDeadline(gun: number, year: number, month0: number) {
  const son = lastDayOfMonth(year, month0);
  const d = !gun || gun <= 0 ? son : Math.min(gun, son);
  const numeric = `${String(d).padStart(2, '0')}.${String(month0 + 1).padStart(2, '0')}.${year}`;
  const textual = `${d} ${TR_AYLAR[month0]} ${year}`;
  const pm = month0 === 0 ? 11 : month0 - 1;
  const py = month0 === 0 ? year - 1 : year;
  const donem = `${TR_AYLAR[pm]} ${py}`;
  return { numeric, textual, donem };
}
function monthOptions() {
  const now = new Date();
  const out: { value: string; label: string; year: number; month0: number }[] = [];
  for (let i = -2; i <= 9; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ value: `${d.getFullYear()}-${d.getMonth()}`, label: `${TR_AYLAR[d.getMonth()]} ${d.getFullYear()}`, year: d.getFullYear(), month0: d.getMonth() });
  }
  return out;
}
function nextDuyuruNo(items: Duyuru[], history: SentRecord[]) {
  const year = new Date().getFullYear();
  let max = 0;
  const scan = (no?: string) => {
    const m = String(no || '').match(/(\d{4})\s*\/\s*(\d+)/);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  };
  items.forEach((i) => scan(i.no));
  history.forEach((h) => scan(h.baslik));
  return `${year} / ${String(max + 1).padStart(2, '0')}`;
}

export default function DuyurularPage() {
  const [draft, setDraft] = useState<Duyuru>(initial);
  const [items, setItems] = useState<Duyuru[]>([]);
  const [taxpayers, setTaxpayers] = useState<Taxpayer[]>([]);
  const [takvim, setTakvim] = useState<Record<string, number>>(defaultTakvim);
  const [history, setHistory] = useState<SentRecord[]>([]);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [tab, setTab] = useState<'duzenle' | 'hazir' | 'gonderim' | 'gecmis'>('duzenle');
  const [group, setGroup] = useState<GroupKey>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [agentPreviewing, setAgentPreviewing] = useState(false);
  const [tick, setTick] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LegacyDuyuru[];
        const normalized = Array.isArray(parsed) ? parsed.map(normalizeDuyuru) : [];
        setItems(normalized);
        if (normalized[0]) setDraft(normalized[0]);
      }
    } catch { setItems([]); }
    readJson(TAKVIM_KEY, (v) => setTakvim({ ...defaultTakvim(), ...(v as Record<string, number>) }));
    readJson(HISTORY_KEY, (v) => Array.isArray(v) && setHistory(v as SentRecord[]));
    readJson(SCHED_KEY, (v) => Array.isArray(v) && setScheduled(v as Scheduled[]));
  }, []);

  // Planlanmış duyuruları kontrol için düşük frekanslı sayaç (portal açıkken).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    api.get('/taxpayers')
      .then((r) => {
        if (!active) return;
        const list = r.data?.data ?? r.data ?? [];
        setTaxpayers(Array.isArray(list) ? list : []);
      })
      .catch(() => setTaxpayers([]));
    return () => { active = false; };
  }, []);

  const phoneTaxpayers = useMemo(() => taxpayers.filter(hasPhone), [taxpayers]);
  const recipients = useMemo(
    () => phoneTaxpayers.filter((t) => matchGroup(t, group, selectedIds)),
    [phoneTaxpayers, group, selectedIds],
  );
  const groupLabel = RECIPIENT_GROUPS.find((g) => g.key === group)?.label || 'Tümü';

  const plainMessage = useMemo(() => buildMessage(draft), [draft]);
  const whatsappUrl = useMemo(() => `https://wa.me/?text=${encodeURIComponent(plainMessage)}`, [plainMessage]);

  const dueItem = useMemo(() => {
    const nowMs = Date.now();
    void tick;
    return scheduled.find((s) => new Date(s.when).getTime() <= nowMs) || null;
  }, [scheduled, tick]);

  const update = <K extends keyof Duyuru>(key: K, value: Duyuru[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const persist = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* yoksay */ } };

  const updateTakvim = (key: string, gun: number) => {
    setTakvim((prev) => {
      const next = { ...prev, [key]: Math.max(0, Math.min(31, Number.isFinite(gun) ? gun : 0)) };
      persist(TAKVIM_KEY, next);
      return next;
    });
  };

  const loadVergi = (preset: VergiPreset, year: number, month0: number) => {
    const { numeric, textual, donem } = computeDeadline(takvim[preset.key] ?? preset.gun, year, month0);
    const icerik = preset.icerik.replace(/\{donem\}/g, donem).replace(/\{tarih\}/g, textual);
    setDraft((d) => ({ ...d, id: 'draft', tarih: numeric, no: d.no || nextDuyuruNo(items, history), baslik: preset.baslik, icerik }));
    toast.success(`${preset.kisa} duyurusu yüklendi · son ödeme ${numeric}`);
    setTab('duzenle');
  };

  const loadGenel = (preset: GenelPreset) => {
    setDraft((d) => ({
      ...d, id: 'draft',
      tarih: new Date().toLocaleDateString('tr-TR'),
      no: d.no || nextDuyuruNo(items, history),
      baslik: preset.baslik, icerik: preset.icerik,
    }));
    toast.success(`"${preset.label}" yüklendi`);
    setTab('duzenle');
  };

  const aiImproveDuyuru = async (instruction: string) => {
    if (!draft.icerik.trim()) { toast.error('Önce içerik yaz ya da "AI ile yaz" kullan.'); return; }
    setAiBusy(true);
    try {
      const r = await aiSuggestTemplate({ mode: 'improve', body: draft.icerik, instruction, context: 'duyuru' });
      if (r.ok && r.body) { update('icerik', r.body); toast.success('AI önerisi uygulandı.'); }
      else toast.error(r.error || 'AI önerisi alınamadı.');
    } catch { toast.error('AI önerisi alınamadı.'); }
    finally { setAiBusy(false); }
  };

  const aiGenerateDuyuru = async () => {
    if (!aiPrompt.trim()) { toast.error('Ne anlatsın yaz.'); return; }
    setAiBusy(true);
    try {
      const r = await aiSuggestTemplate({ mode: 'generate', amac: aiPrompt, context: 'duyuru' });
      if (r.ok && r.body) {
        setDraft((d) => ({ ...d, icerik: r.body, baslik: r.title || d.baslik }));
        setAiPrompt('');
        toast.success(r.title ? 'AI başlık + metni yazdı.' : 'AI duyuru metnini yazdı.');
      } else toast.error(r.error || 'AI önerisi alınamadı.');
    } catch { toast.error('AI önerisi alınamadı.'); }
    finally { setAiBusy(false); }
  };

  const save = () => {
    if (!draft.baslik.trim() || !draft.icerik.trim()) { toast.error('Başlık ve içerik boş bırakılamaz'); return; }
    const saved = { ...draft, id: draft.id === 'draft' ? crypto.randomUUID() : draft.id };
    const updating = draft.id !== 'draft' && items.some((x) => x.id === draft.id);
    const next = [saved, ...items.filter((x) => x.id !== saved.id)].slice(0, 30);
    setDraft(saved);
    setItems(next);
    persist(STORAGE_KEY, next);
    toast.success(updating ? 'Duyuru güncellendi' : 'Duyuru kaydedildi');
  };

  const startNew = () => {
    setDraft({ ...initial, id: 'draft', tarih: new Date().toLocaleDateString('tr-TR'), no: nextDuyuruNo(items, history), baslik: '', icerik: '' });
    setTab('duzenle');
    toast.info('Yeni duyuru taslağı açıldı · no otomatik verildi');
  };

  const downloadJpeg = async () => {
    if (!previewRef.current) return;
    try {
      const dataUrl = await toJpeg(previewRef.current, { quality: 0.98, pixelRatio: 2, backgroundColor: PAPER, cacheBust: true });
      const safeNo = (draft.no || 'taslak').replace(/[^\w-]+/g, '-').replace(/-+/g, '-');
      const link = document.createElement('a');
      link.download = `moren-duyuru-${safeNo}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch { toast.error('JPEG indirilemedi'); }
  };

  const addHistory = (basarili: number, hatali: number, kanal: string) => {
    setHistory((prev) => {
      const rec: SentRecord = { id: crypto.randomUUID(), at: new Date().toISOString(), baslik: draft.baslik || draft.no || 'Duyuru', kanal, adet: recipients.length, basarili, hatali, grup: groupLabel };
      const next = [rec, ...prev].slice(0, 50);
      persist(HISTORY_KEY, next);
      return next;
    });
  };

  const doSend = async (ids: string[], message: string): Promise<{ basarili: number; hatali: number }> => {
    const resp = await api.post('/whatsapp/portal-message/send', { taxpayerIds: ids, message });
    return { basarili: resp.data?.basarili || 0, hatali: resp.data?.hatali || 0 };
  };

  const sendPortalMessage = async () => {
    if (!draft.baslik.trim() || !draft.icerik.trim()) { toast.error('Başlık ve içerik boş bırakılamaz'); return; }
    if (!recipients.length) { toast.error('Seçili alıcı grubunda telefonu kayıtlı mükellef yok'); return; }
    if (!window.confirm(`"${groupLabel}" grubundaki ${recipients.length} mükellefe WhatsApp duyurusu gönderilecek. Devam edilsin mi?`)) return;
    setSending(true);
    try {
      const { basarili, hatali } = await doSend(recipients.map((t) => t.id), plainMessage);
      addHistory(basarili, hatali, 'WhatsApp');
      toast.success(`${basarili} gönderildi, ${hatali} hatalı`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Duyuru gönderilemedi');
    } finally { setSending(false); }
  };

  const previewAgentSend = async () => {
    if (!draft.baslik.trim() || !draft.icerik.trim()) { toast.error('Başlık ve içerik boş bırakılamaz'); return; }
    if (!recipients.length) { toast.error('Seçili alıcı grubunda telefonu kayıtlı mükellef yok'); return; }
    setAgentPreviewing(true);
    try {
      const resp = await api.post('/moren-ai/agent-command/preview', {
        agent: 'whatsapp', action: 'portal_message_preview',
        payload: { taxpayerIds: recipients.map((t) => t.id), message: plainMessage },
      });
      const previewId = resp.data?.previewId;
      toast.success(previewId ? `Agent önizleme hazır: ONAYLIYORUM #${previewId}` : 'Agent önizleme hazır');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Agent önizleme oluşturulamadı');
    } finally { setAgentPreviewing(false); }
  };

  const schedule = (whenIso: string) => {
    if (!draft.baslik.trim() || !draft.icerik.trim()) { toast.error('Önce başlık ve içerik girin'); return; }
    if (!recipients.length) { toast.error('Seçili alıcı grubunda mükellef yok'); return; }
    if (!whenIso) { toast.error('Gönderim tarih/saatini seçin'); return; }
    const item: Scheduled = {
      id: crypto.randomUUID(), when: new Date(whenIso).toISOString(),
      baslik: draft.baslik, icerik: draft.icerik, tarih: draft.tarih, no: draft.no,
      grup: groupLabel, ids: recipients.map((t) => t.id), adet: recipients.length, message: plainMessage,
    };
    setScheduled((prev) => { const next = [item, ...prev].slice(0, 30); persist(SCHED_KEY, next); return next; });
    toast.success(`Planlandı · ${new Date(whenIso).toLocaleString('tr-TR')} · ${item.adet} alıcı`);
  };

  const removeScheduled = (id: string) => {
    setScheduled((prev) => { const next = prev.filter((s) => s.id !== id); persist(SCHED_KEY, next); return next; });
  };

  const runScheduled = async (item: Scheduled) => {
    if (!window.confirm(`Planlanan "${item.baslik}" duyurusu ${item.adet} mükellefe şimdi gönderilsin mi?`)) return;
    setSending(true);
    try {
      const { basarili, hatali } = await doSend(item.ids, item.message);
      setHistory((prev) => {
        const rec: SentRecord = { id: crypto.randomUUID(), at: new Date().toISOString(), baslik: item.baslik, kanal: 'WhatsApp (planlı)', adet: item.adet, basarili, hatali, grup: item.grup };
        const next = [rec, ...prev].slice(0, 50); persist(HISTORY_KEY, next); return next;
      });
      removeScheduled(item.id);
      toast.success(`Planlı gönderim tamam · ${basarili} gönderildi, ${hatali} hatalı`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Planlı gönderim başarısız');
    } finally { setSending(false); }
  };

  const clearHistory = () => { setHistory([]); persist(HISTORY_KEY, []); };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-3 text-white" style={{ fontFamily: SANS }}>
      {/* Planlanan duyuru zamanı geldiğinde uyarı bandı */}
      {dueItem && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5"
          style={{ borderColor: 'rgba(217,160,108,0.5)', background: 'rgba(217,160,108,0.14)' }}>
          <div className="flex items-center gap-2.5 text-[13px]" style={{ color: '#f0d3ac' }}>
            <Clock size={16} /> Planlanan duyurunun zamanı geldi: <strong>{dueItem.baslik}</strong> · {dueItem.adet} alıcı
          </div>
          <div className="flex gap-2">
            <button onClick={() => runScheduled(dueItem)} className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: COPPER, color: '#241a10' }}>Şimdi gönder</button>
            <button onClick={() => removeScheduled(dueItem.id)} className="rounded-md border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: BORDER, color: MUTED }}>İptal et</button>
          </div>
        </div>
      )}

      {/* BAŞLIK — kompakt, imza şeridi */}
      <header className="relative mb-3 shrink-0 overflow-hidden rounded-2xl border px-5 py-3" style={{
        borderColor: LINE,
        background: 'radial-gradient(120% 230% at 0% 0%, rgba(217,160,108,0.16), transparent 52%), #0f0d0b',
      }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(90deg, #d9a06c, #e8b84b, #d4b876, #f472b6, #a855f7, #60a5fa, #34d399)' }} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg, #d9a06c, #e8b84b)', boxShadow: '0 6px 16px rgba(217,160,108,0.32)' }}>
              <Megaphone size={20} style={{ color: '#241a10' }} />
            </span>
            <div>
              <h1 className="text-[21px] font-semibold leading-none" style={{ color: TEXT }}>Duyurular</h1>
              <p className="mt-1 text-[11.5px]" style={{ color: MUTED }}>Afişi hazırla · JPEG indir · mükelleflere WhatsApp ile gönder · planla</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={<FilePlus2 size={16} />} label="Yeni" onClick={startNew} tone="dark" />
            <ActionButton icon={<Download size={16} />} label="JPEG" onClick={downloadJpeg} tone="dark" />
            <ActionButton icon={<Save size={16} />} label="Kaydet" onClick={save} tone="gold" />
            <ActionButton icon={<Bot size={16} />} label={agentPreviewing ? '…' : 'Agent'} onClick={previewAgentSend} disabled={agentPreviewing || sending} tone="dark" />
            <ActionButton icon={<Send size={16} />} label={sending ? '…' : 'Gönder'} onClick={sendPortalMessage} disabled={sending} tone="blue" />
            <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#1f8f55] px-3.5 text-[12.5px] font-semibold text-white transition hover:bg-[#25a563]">
              <MessageCircle size={16} /> WhatsApp
            </a>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(540px,1fr)_440px]">
        {/* SOL — orijinal afiş, büyük ve ferah */}
        <section className="flex min-h-0 flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border p-6" style={{ borderColor: BORDER, background: '#0c0b09' }}>
          <AnnouncementPreview draft={draft} exportRef={previewRef} />
          <div className="flex items-center gap-2 text-[11.5px]" style={{ color: SOFT }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#4ade80' }} /> İndirilen JPEG birebir bu görünür · 1080 × 1080
          </div>
        </section>

        {/* SAĞ — sekmeli kontroller */}
        <aside className="flex min-h-0 flex-col">
          <div className="mb-3 grid shrink-0 grid-cols-4 gap-1 rounded-xl border p-1" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.03)' }}>
            <Tab on={tab === 'duzenle'} onClick={() => setTab('duzenle')} icon={<Edit3 size={14} />} label="Düzenle" />
            <Tab on={tab === 'hazir'} onClick={() => setTab('hazir')} icon={<LibraryBig size={14} />} label="Hazır" />
            <Tab on={tab === 'gonderim'} onClick={() => setTab('gonderim')} icon={<Send size={14} />} label="Gönderim" />
            <Tab on={tab === 'gecmis'} onClick={() => setTab('gecmis')} icon={<History size={14} />} label="Geçmiş" badge={scheduled.length || undefined} />
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {tab === 'duzenle' && (
              <>
                <Panel title="Duyuru Girişi">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tarih" value={draft.tarih} onChange={(v) => update('tarih', v)} />
                    <div>
                      <span className="mb-2 block text-[12.5px] font-semibold uppercase tracking-[.08em]" style={{ color: MUTED }}>Duyuru No</span>
                      <div className="flex gap-1.5">
                        <input value={draft.no} onChange={(e) => update('no', e.target.value)} className="h-10 w-full rounded-lg border px-3.5 text-[14px] font-semibold outline-none transition focus:border-[#d7c28b]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }} />
                        <button title="Sıradaki numara" onClick={() => update('no', nextDuyuruNo(items, history))} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border" style={{ borderColor: BORDER, color: COPPER, background: 'rgba(217,160,108,0.1)' }}>#</button>
                      </div>
                    </div>
                  </div>
                  <Field label="Başlık" value={draft.baslik} onChange={(v) => update('baslik', v)} />
                  <Field label="İçerik" value={draft.icerik} onChange={(v) => update('icerik', v)} textarea rows={5} />
                  <TypeControls draft={draft} onChange={update} />
                </Panel>

                {/* AI Asistan — İçerik metnini yazar/düzenler */}
                <div className="overflow-hidden rounded-[10px] border" style={{ borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.06)' }}>
                  <div className="flex items-center gap-1.5 border-b px-4 py-3 text-[14px] font-semibold" style={{ borderColor: 'rgba(168,85,247,0.2)', color: '#c4a3f0' }}>
                    <Sparkles size={15} /> AI Asistan {aiBusy && <Loader2 size={13} className="animate-spin" />}
                  </div>
                  <div className="space-y-2.5 p-4">
                    <div className="flex flex-wrap gap-1.5">
                      {([['Kısalt', 'daha kısa ve öz yap'], ['Resmileştir', 'daha resmi ve kurumsal yap'], ['Kibarlaştır', 'daha kibar ve nazik yap'], ['Dili düzelt', 'yazım ve dil bilgisi hatalarını düzelt']] as const).map(([lbl, ins]) => (
                        <button key={lbl} type="button" disabled={aiBusy} onClick={() => aiImproveDuyuru(ins)} className="rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50" style={{ borderColor: 'rgba(168,85,247,0.3)', color: '#c4a3f0', background: 'rgba(168,85,247,0.08)' }}>{lbl}</button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') aiGenerateDuyuru(); }}
                        placeholder="Sıfırdan yaz: ne anlatsın? (ör. ofis bayram tatili duyurusu)"
                        className="flex-1 rounded-lg border px-3 py-2 text-[13px] outline-none transition focus:border-[#a855f7]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }} />
                      <button type="button" disabled={aiBusy} onClick={aiGenerateDuyuru} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff' }}>
                        <Wand2 size={14} /> Yaz
                      </button>
                    </div>
                    <div className="text-[11.5px]" style={{ color: SOFT }}>AI, İçerik kutusunu yazar/düzenler — afiş anında güncellenir. (Max aboneliğinden — ek ücret yok.)</div>
                  </div>
                </div>
              </>
            )}

            {tab === 'hazir' && (
              <>
                <VergiTakvimi takvim={takvim} onTakvim={updateTakvim} onLoad={loadVergi} />
                <GenelKutuphane onLoad={loadGenel} />
              </>
            )}

            {tab === 'gonderim' && (
              <>
                <RecipientCard
                  group={group} setGroup={setGroup}
                  taxpayers={phoneTaxpayers} selectedIds={selectedIds} setSelectedIds={setSelectedIds}
                  recipients={recipients}
                />
                <Panel title="Gönder">
                  <div className="rounded-lg border px-4 py-3" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.045)' }}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1f8f55]/20 text-[#4ade80]"><Users size={18} /></div>
                      <div>
                        <div className="text-[20px] font-semibold tabular-nums" style={{ color: TEXT }}>{recipients.length}</div>
                        <div className="text-[13px] font-medium" style={{ color: MUTED }}>{groupLabel} · alıcı</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={sendPortalMessage} disabled={sending} className="inline-flex items-center gap-1.5 rounded-md bg-[#2563eb] px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-60"><Send size={15} /> {sending ? 'Gönderiliyor…' : 'Şimdi gönder'}</button>
                      <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-[#1f8f55] px-3.5 py-2 text-[13px] font-semibold text-white"><MessageCircle size={15} /> WhatsApp'ta aç</a>
                    </div>
                  </div>
                </Panel>
                <ScheduleCard onSchedule={schedule} />
              </>
            )}

            {tab === 'gecmis' && (
              <>
                <ScheduledList items={scheduled} onRun={runScheduled} onRemove={removeScheduled} />
                <HistoryCard history={history} onClear={clearHistory} />
                <Panel title={`Kayıtlı Duyurular (${items.length})`}>
                  <div className="space-y-2">
                    {items.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-4 text-center text-[14px] font-medium" style={{ borderColor: BORDER, color: MUTED }}>Henüz kayıt yok.</div>
                    ) : items.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.035)' }}>
                        <button onClick={() => { setDraft(item); setTab('duzenle'); }} className="min-w-0 flex-1 text-left">
                          <div className="truncate text-[14px] font-semibold" style={{ color: TEXT }}>{item.baslik}</div>
                          <div className="text-[12.5px] font-medium" style={{ color: MUTED }}>{item.tarih} · Duyuru No {item.no || '—'}</div>
                        </button>
                        <button onClick={() => { setDraft(item); setTab('duzenle'); }} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[12.5px] font-semibold" style={{ color: GOLD, background: 'rgba(215,194,139,0.10)' }}><Edit3 size={14} /> Düzenle</button>
                        <button onClick={() => removeItem(item.id, items, setItems, draft, setDraft)} className="rounded-md p-2 text-[#ff7777] hover:bg-[#2a1513]"><Trash2 size={16} /></button>
                      </div>
                    ))}
                  </div>
                </Panel>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Tab({ on, onClick, icon, label, badge }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className="relative inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-semibold transition-colors"
      style={on ? { background: 'rgba(217,160,108,0.16)', color: COPPER } : { color: MUTED }}>
      {icon}{label}
      {badge ? <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold" style={{ background: COPPER, color: '#241a10' }}>{badge}</span> : null}
    </button>
  );
}

function GenelKutuphane({ onLoad }: { onLoad: (p: GenelPreset) => void }) {
  return (
    <div className="rounded-[10px] border" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.045)' }}>
      <div className="flex items-center gap-2 border-b px-4 py-3 text-[14px] font-semibold" style={{ borderColor: LINE, color: TEXT }}>
        <LibraryBig size={16} style={{ color: '#a855f7' }} /> Genel Duyuru Kütüphanesi
      </div>
      <div className="grid grid-cols-1 gap-2 p-4">
        {GENEL_PRESETS.map((p) => (
          <button key={p.key} onClick={() => onLoad(p)} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-left transition-colors hover:brightness-110"
            style={{ borderColor: LINE, borderLeft: `3px solid ${p.color}`, background: `${p.color}10` }}>
            <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: TEXT }}>
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.label}
            </span>
            <span className="text-[12px] font-semibold" style={{ color: p.color }}>Yükle</span>
          </button>
        ))}
        <p className="text-[11.5px] leading-relaxed" style={{ color: SOFT }}>Köşeli parantezli yerleri ([tarih aralığı], [konu] gibi) düzenle alanından doldurun.</p>
      </div>
    </div>
  );
}

function RecipientCard({ group, setGroup, taxpayers, selectedIds, setSelectedIds, recipients }: {
  group: GroupKey; setGroup: (g: GroupKey) => void;
  taxpayers: Taxpayer[]; selectedIds: Set<string>; setSelectedIds: (s: Set<string>) => void; recipients: Taxpayer[];
}) {
  const [q, setQ] = useState('');
  const count = (g: GroupKey) => taxpayers.filter((t) => matchGroup(t, g, selectedIds)).length;
  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr');
    const list = s ? taxpayers.filter((t) => taxpayerName(t).toLocaleLowerCase('tr').includes(s)) : taxpayers;
    return list.slice(0, 200);
  }, [q, taxpayers]);
  const toggle = (id: string) => { const n = new Set(selectedIds); n.has(id) ? n.delete(id) : n.add(id); setSelectedIds(n); };

  return (
    <Panel title="Alıcılar">
      <div className="flex flex-wrap gap-1.5">
        {RECIPIENT_GROUPS.map((g) => {
          const on = group === g.key;
          return (
            <button key={g.key} onClick={() => setGroup(g.key)} className="rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors"
              style={on ? { background: 'rgba(217,160,108,0.18)', color: COPPER, border: '1px solid rgba(217,160,108,0.5)' } : { background: 'transparent', color: MUTED, border: `1px solid ${LINE}` }}>
              {g.label}{g.key !== 'manual' ? ` ${count(g.key)}` : ''}
            </button>
          );
        })}
      </div>

      {group === 'manual' && (
        <div className="mt-3">
          <div className="relative mb-2">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: SOFT }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mükellef ara…" className="h-9 w-full rounded-lg border py-1 pl-8 pr-2 text-[13px] outline-none focus:border-[#d9a06c]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }} />
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {filtered.map((t) => {
              const on = selectedIds.has(t.id);
              return (
                <button key={t.id} onClick={() => toggle(t.id)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors" style={{ background: on ? 'rgba(217,160,108,0.12)' : 'transparent', color: on ? COPPER : MUTED }}>
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded border" style={{ borderColor: on ? COPPER : BORDER, background: on ? COPPER : 'transparent' }}>{on && <CheckCheck size={11} style={{ color: '#241a10' }} />}</span>
                  <span className="truncate">{taxpayerName(t)}</span>
                </button>
              );
            })}
            {!filtered.length && <div className="px-2 py-3 text-center text-[12.5px]" style={{ color: SOFT }}>Mükellef bulunamadı.</div>}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.03)', color: MUTED }}>
        <SlidersHorizontal size={14} style={{ color: COPPER }} /> Seçili: <strong style={{ color: TEXT }}>{recipients.length}</strong> telefonlu mükellef
      </div>
    </Panel>
  );
}

function ScheduleCard({ onSchedule }: { onSchedule: (whenIso: string) => void }) {
  const [when, setWhen] = useState('');
  return (
    <Panel title="Planla (zamanlanmış gönderim)">
      <p className="text-[12.5px] leading-relaxed" style={{ color: SOFT }}>
        Duyuruyu ileri bir tarih/saate kur. Portal o anda açıkken zamanı gelince üstte uyarı çıkar, tek tıkla gönderilir.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.08em]" style={{ color: MUTED }}>Tarih & saat</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-10 w-full rounded-lg border px-3 text-[13.5px] font-semibold outline-none focus:border-[#d9a06c]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }} />
        </div>
        <button onClick={() => onSchedule(when)} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold" style={{ background: 'rgba(217,160,108,0.18)', color: COPPER, border: '1px solid rgba(217,160,108,0.5)' }}>
          <CalendarPlus size={15} /> Planla
        </button>
      </div>
    </Panel>
  );
}

function ScheduledList({ items, onRun, onRemove }: { items: Scheduled[]; onRun: (s: Scheduled) => void; onRemove: (id: string) => void }) {
  return (
    <Panel title={`Planlanmış Duyurular (${items.length})`}>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-[13.5px] font-medium" style={{ borderColor: BORDER, color: MUTED }}>Planlanmış duyuru yok.</div>
      ) : (
        <div className="space-y-2">
          {items.map((s) => {
            const due = new Date(s.when).getTime() <= Date.now();
            return (
              <div key={s.id} className="rounded-lg border p-3" style={{ borderColor: due ? 'rgba(217,160,108,0.5)' : BORDER, background: due ? 'rgba(217,160,108,0.10)' : 'rgba(255,255,255,0.035)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold" style={{ color: TEXT }}>{s.baslik}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px]" style={{ color: MUTED }}>
                      <CalendarClock size={12} /> {new Date(s.when).toLocaleString('tr-TR')} · {s.grup} · {s.adet} alıcı
                    </div>
                  </div>
                  <button onClick={() => onRemove(s.id)} className="shrink-0 rounded-md p-1.5 text-[#ff7777] hover:bg-[#2a1513]"><X size={15} /></button>
                </div>
                <button onClick={() => onRun(s)} className="mt-2 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold" style={{ background: due ? COPPER : 'rgba(255,255,255,0.06)', color: due ? '#241a10' : MUTED, border: `1px solid ${due ? COPPER : BORDER}` }}>
                  <Send size={13} /> {due ? 'Zamanı geldi — gönder' : 'Şimdi gönder'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function HistoryCard({ history, onClear }: { history: SentRecord[]; onClear: () => void }) {
  return (
    <div className="rounded-[10px] border" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.045)' }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: LINE }}>
        <div className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: TEXT }}><History size={16} style={{ color: '#60a5fa' }} /> Gönderim Geçmişi</div>
        {history.length > 0 && <button onClick={onClear} className="text-[12px] font-medium" style={{ color: SOFT }}>Temizle</button>}
      </div>
      <div className="p-4">
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-[13.5px] font-medium" style={{ borderColor: BORDER, color: MUTED }}>Henüz gönderim yok.</div>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="rounded-lg border p-2.5" style={{ borderColor: LINE, background: 'rgba(255,255,255,0.03)' }}>
                <div className="truncate text-[13px] font-semibold" style={{ color: TEXT }}>{h.baslik}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]" style={{ color: MUTED }}>
                  <span>{new Date(h.at).toLocaleString('tr-TR')}</span><span>·</span>
                  <span>{h.kanal}</span><span>·</span>
                  <span>{h.grup}</span><span>·</span>
                  <span style={{ color: '#4ade80' }}>{h.basarili} gönderildi</span>
                  {h.hatali > 0 && <span style={{ color: '#ff7777' }}>· {h.hatali} hatalı</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VergiTakvimi({ takvim, onTakvim, onLoad }: {
  takvim: Record<string, number>;
  onTakvim: (key: string, gun: number) => void;
  onLoad: (preset: VergiPreset, year: number, month0: number) => void;
}) {
  const months = useMemo(monthOptions, []);
  const [sel, setSel] = useState(months[2]?.value ?? months[0].value);
  const current = months.find((m) => m.value === sel) ?? months[2] ?? months[0];

  return (
    <div className="rounded-[10px] border" style={{ borderColor: 'rgba(217,160,108,0.32)', background: 'linear-gradient(135deg, rgba(217,160,108,0.10), rgba(232,184,75,0.04) 60%, rgba(255,255,255,0.03))' }}>
      <div className="flex items-center gap-2 border-b px-4 py-3 text-[14px] font-semibold" style={{ borderColor: LINE, color: TEXT }}>
        <CalendarClock size={16} style={{ color: COPPER }} /> Vergi Takvimi · Son Ödeme
      </div>
      <div className="space-y-2.5 p-4">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.08em]" style={{ color: MUTED }}>Ödeme Ayı</span>
          <select value={sel} onChange={(e) => setSel(e.target.value)} className="h-10 w-full rounded-lg border px-3 text-[14px] font-semibold outline-none transition focus:border-[#d9a06c]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }}>
            {months.map((m) => <option key={m.value} value={m.value} style={{ background: '#11100d', color: TEXT }}>{m.label}</option>)}
          </select>
        </label>
        <div className="space-y-2">
          {VERGI_PRESETS.map((p) => {
            const gun = takvim[p.key] ?? p.gun;
            const { numeric } = computeDeadline(gun, current.year, current.month0);
            return (
              <div key={p.key} className="rounded-lg border p-2.5" style={{ borderColor: LINE, borderLeft: `3px solid ${p.color}`, background: `${p.color}10` }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13.5px] font-semibold" style={{ color: TEXT }}><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />{p.kisa}</div>
                    <div className="mt-0.5 truncate text-[11.5px]" style={{ color: SOFT }}>{p.label}</div>
                  </div>
                  <button onClick={() => onLoad(p, current.year, current.month0)} className="shrink-0 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors" style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}55` }}>Yükle</button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                  <span style={{ color: MUTED }}>Son ödeme: <strong className="tabular-nums" style={{ color: TEXT }}>{numeric}</strong></span>
                  <label className="flex items-center gap-1.5" style={{ color: SOFT }}>Gün
                    <input type="number" min={0} max={31} value={gun} onChange={(e) => onTakvim(p.key, Number(e.target.value))} className="h-7 w-14 rounded-md border px-2 text-center text-[12.5px] font-semibold tabular-nums outline-none focus:border-[#d9a06c]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.25)', color: TEXT }} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11.5px] leading-relaxed" style={{ color: SOFT }}>Tarihler örnek varsayılan; güncel takvime göre <strong>Gün</strong>'den düzenleyin. <strong>Gün 0</strong> = ayın son günü. Dönem = ödeme ayının bir öncesi.</p>
      </div>
    </div>
  );
}

function AnnouncementPreview({ draft, exportRef }: { draft: Duyuru; exportRef?: Ref<HTMLDivElement> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState(640);

  useEffect(() => {
    const measure = () => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = Math.floor(Math.max(MIN_PREVIEW_SIZE, Math.min(MAX_PREVIEW_SIZE, rect.width - 12, rect.height - 12)));
      setPreviewSize(next);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer && hostRef.current) observer.observe(hostRef.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  return (
    <>
      <div ref={hostRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div data-duyuru-preview className="overflow-hidden bg-[#f7f6f3] shadow-2xl" style={{ width: previewSize, height: previewSize }}>
          <AnnouncementCanvas draft={draft} scale={previewSize / CANVAS_SIZE} />
        </div>
      </div>
      <div aria-hidden className="pointer-events-none fixed left-[-2400px] top-0 overflow-hidden" style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
        <AnnouncementCanvas draft={draft} exportRef={exportRef} />
      </div>
    </>
  );
}

function AnnouncementCanvas({ draft, exportRef, scale = 1 }: { draft: Duyuru; exportRef?: Ref<HTMLDivElement>; scale?: number }) {
  const titleStyle = TITLE_STYLES[draft.baslikStil] || TITLE_STYLES.klasik;
  const bodyStyle = BODY_STYLES[draft.icerikStil] || BODY_STYLES.resmi;
  const titlePunto = fitTitlePoint(draft.baslik, clampPoint(draft.baslikPunto, 62, 34, 78));
  const bodyPunto = fitBodyPoint(draft.icerik, clampPoint(draft.icerikPunto, 27, 18, 34));

  return (
      <div
        ref={exportRef}
        className="relative h-[1080px] w-[1080px] origin-top-left overflow-hidden"
        style={{
          transform: scale === 1 ? undefined : `scale(${scale})`,
          background: PAPER,
          color: NAVY,
          fontFamily: 'Manrope, Inter, system-ui, sans-serif',
        }}
      >
        <div className="grid h-full grid-cols-[320px_1fr]">
          <aside className="flex flex-col items-center bg-[#0d1238] px-8 py-14 text-center text-white">
            <div className="mb-10 flex w-full flex-col items-center">
              <div className="mb-3 flex h-[170px] w-[200px] items-center justify-center">
                <img src={ANNOUNCEMENT_LOGO} alt="Moren Mali Müşavirlik" className="h-full w-full object-contain" />
              </div>
              <div className="h-[1.5px] w-[60px] bg-white/40" />
            </div>

            <div className="flex flex-1 flex-col justify-between gap-6 py-2">
              <Contact icon={<Phone />} label="Telefon" value="0535 058 74 75" />
              <Contact icon={<Mail />} label="E-Posta" value="info@morenmusavirlik.com" />
              <Contact icon={<MapPin />} label="Adres" value={'Hastane Mah. Özcan\nTaşkınbaş Cad. No: 16/6\nArnavutköy, İstanbul'} />
              <Contact icon={<Globe />} label="Web" value="morenmusavirlik.com" />
            </div>
          </aside>

          <main className="relative flex h-full min-w-0 flex-col overflow-hidden px-[70px] py-[78px]" style={{ background: PAPER }}>
            <div
              className="pointer-events-none absolute left-0 right-0 top-0 h-[220px]"
              style={{
                background:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 220' preserveAspectRatio='none'><path d='M0,0 L1000,0 L1000,70 Q800,90 600,75 T200,85 T0,80 Z' fill='%230d1238' opacity='0.12'/><path d='M0,0 L1000,0 L1000,40 Q800,60 600,45 T200,55 T0,50 Z' fill='%230d1238' opacity='0.10'/><path d='M0,0 L1000,0 L1000,100 Q750,130 500,110 T0,115 Z' fill='%230d1238' opacity='0.08'/></svg>\") no-repeat top center / 100% 220px",
              }}
            />
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-[280px]"
              style={{
                background:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 280' preserveAspectRatio='none'><path d='M0,180 Q150,140 300,170 T600,160 T1000,150 L1000,280 L0,280 Z' fill='%230d1238' opacity='0.08'/><path d='M0,210 Q150,180 300,200 T600,190 T1000,180 L1000,280 L0,280 Z' fill='%230d1238' opacity='0.10'/><path d='M0,240 Q200,220 400,235 T800,230 T1000,225 L1000,280 L0,280 Z' fill='%230d1238' opacity='0.12'/></svg>\") no-repeat bottom center / 100% 280px",
              }}
            />

            <div className="relative z-10 mb-[28px] flex items-start justify-between">
              <div className="inline-flex items-center gap-4 text-[13px] font-bold uppercase tracking-[.4em]" style={{ color: NAVY }}>
                <span className="h-px w-8 bg-[#0d1238]" />
                Önemli Duyuru
                <span className="h-px w-8 bg-[#0d1238]" />
              </div>
              <div
                className="whitespace-nowrap text-right text-[16px] font-medium leading-normal"
                style={{ color: NAVY, fontFamily: 'Fraunces, Georgia, serif' }}
              >
                <strong className="mb-1 block text-[30px] font-medium leading-none tracking-[-.015em]">{draft.tarih}</strong>
                No {draft.no}
              </div>
            </div>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-start pt-[48px] pb-[112px]">
              <h2
                className="m-0 max-w-[690px]"
                style={{
                  color: NAVY,
                  fontFamily: titleStyle.family,
                  fontSize: titlePunto,
                  fontWeight: titleStyle.weight,
                  lineHeight: titleStyle.lineHeight,
                  letterSpacing: titleStyle.letterSpacing || 0,
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  hyphens: 'auto',
                }}
              >
                {draft.baslik}
              </h2>
              <div className="mb-9 mt-7 h-px max-w-[92%] bg-[rgba(13,18,56,0.18)]" />
              <p
                className="max-w-[690px] whitespace-pre-line text-justify"
                style={{
                  color: '#1f2545',
                  fontFamily: bodyStyle.family,
                  fontSize: bodyPunto,
                  fontWeight: bodyStyle.weight,
                  lineHeight: bodyStyle.lineHeight,
                  letterSpacing: bodyStyle.letterSpacing || 0,
                  maxHeight: 430,
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  hyphens: 'auto',
                }}
              >
                {draft.icerik}
              </p>
            </div>

            <div className="relative z-10 mb-[-24px] mr-[-18px] mt-auto flex justify-end">
              <div className="relative pt-7 text-right" style={{ color: NAVY }}>
                <div className="absolute right-0 top-0 h-px w-[280px] bg-gradient-to-l from-[#0d1238] via-[#0d1238] to-transparent opacity-50" />
                <div
                  className="inline-block origin-right -rotate-2 text-[48px] font-semibold leading-none tracking-[-.01em]"
                  style={{ fontFamily: 'Caveat, Brush Script MT, cursive' }}
                >
                  Muzaffer Ören
                </div>
                <div className="mt-3 text-[16px] font-medium italic tracking-[.01em]" style={{ fontFamily: 'Fraunces, Georgia, serif' }}>
                  Serbest Muhasebeci Mali Müşavir
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, tone }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; tone: 'gold' | 'blue' | 'dark' }) {
  const styles =
    tone === 'gold' ? { background: GOLD, color: '#111' }
      : tone === 'blue' ? { background: '#2563eb', color: '#fff' }
        : { background: 'rgba(255,255,255,0.065)', color: TEXT, border: `1px solid ${BORDER}` };
  return (
    <button onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60" style={styles}>
      {icon}{label}
    </button>
  );
}

function Contact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 whitespace-pre-line">
      <div className="mb-3 flex h-[52px] w-[52px] items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/85">{icon}</div>
      <div className="text-[13px] font-medium uppercase italic tracking-[.28em] text-white/55" style={{ fontFamily: 'Source Serif 4, Georgia, serif' }}>{label}</div>
      <div className="max-w-[280px] break-words text-[20px] font-normal leading-[1.45] text-white" style={{ fontFamily: 'Source Serif 4, Georgia, serif' }}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[10px] border" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.045)' }}>
      <div className="border-b px-4 py-3 text-[14px] font-semibold" style={{ borderColor: BORDER, color: TEXT }}>{title}</div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, textarea, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; textarea?: boolean; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12.5px] font-semibold uppercase tracking-[.08em]" style={{ color: MUTED }}>{label}</span>
      {textarea ? (
        <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="w-full resize-none rounded-lg border px-3.5 py-2.5 text-[14px] font-medium leading-relaxed outline-none transition focus:border-[#d7c28b]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-lg border px-3.5 text-[14px] font-semibold outline-none transition focus:border-[#d7c28b]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }} />
      )}
    </label>
  );
}

function TypeControls({ draft, onChange }: { draft: Duyuru; onChange: <K extends keyof Duyuru>(key: K, value: Duyuru[K]) => void }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.035)' }}>
      <div className="mb-2 text-[12.5px] font-semibold" style={{ color: TEXT }}>Yazı Ayarları</div>
      <div className="grid grid-cols-2 gap-2.5">
        <NumberControl label="Başlık Punto" min={34} max={78} value={draft.baslikPunto} onChange={(value) => onChange('baslikPunto', value)} />
        <StyleControl label="Başlık Stil" options={TITLE_STYLES} value={draft.baslikStil} onChange={(value) => onChange('baslikStil', value)} />
        <NumberControl label="İçerik Punto" min={18} max={34} value={draft.icerikPunto} onChange={(value) => onChange('icerikPunto', value)} />
        <StyleControl label="İçerik Stil" options={BODY_STYLES} value={draft.icerikStil} onChange={(value) => onChange('icerikStil', value)} />
      </div>
    </div>
  );
}

function NumberControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.08em]" style={{ color: MUTED }}>{label}</span>
      <input type="number" min={min} max={max} step={1} value={value} onChange={(e) => onChange(clampPoint(Number(e.target.value), value, min, max))} className="h-9 w-full rounded-lg border px-3 text-[13px] font-semibold outline-none transition focus:border-[#d7c28b]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }} />
    </label>
  );
}

function StyleControl({ label, options, value, onChange }: { label: string; options: Record<FontStyleKey, FontOption>; value: FontStyleKey; onChange: (value: FontStyleKey) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.08em]" style={{ color: MUTED }}>{label}</span>
      <select value={value} onChange={(e) => onChange(normalizeStyle(e.target.value))} className="h-9 w-full rounded-lg border px-3 text-[13px] font-semibold outline-none transition focus:border-[#d7c28b]" style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }}>
        {Object.entries(options).map(([key, option]) => <option key={key} value={key} style={{ background: '#11100d', color: TEXT }}>{option.label}</option>)}
      </select>
    </label>
  );
}

function readJson(key: string, apply: (v: unknown) => void) {
  try { const raw = localStorage.getItem(key); if (raw) apply(JSON.parse(raw)); } catch { /* yoksay */ }
}

function normalizeDuyuru(item: LegacyDuyuru): Duyuru {
  return {
    id: item.id || crypto.randomUUID(),
    tarih: item.tarih || initial.tarih,
    no: item.no || '',
    baslik: item.baslik || '',
    icerik: item.icerik || item.metin || item.altBaslik || '',
    baslikPunto: clampPoint(item.baslikPunto, initial.baslikPunto, 34, 78),
    icerikPunto: clampPoint(item.icerikPunto, initial.icerikPunto, 18, 34),
    baslikStil: normalizeStyle(item.baslikStil, initial.baslikStil),
    icerikStil: normalizeStyle(item.icerikStil, initial.icerikStil),
  };
}

function normalizeStyle(value: unknown, fallback: FontStyleKey = 'klasik'): FontStyleKey {
  return value === 'klasik' || value === 'resmi' || value === 'modern' ? value : fallback;
}

function clampPoint(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function fitTitlePoint(text: string, requested: number) {
  const length = text.trim().length;
  const fitted = length > 96 ? 44 : length > 72 ? 50 : length > 54 ? 56 : requested;
  return Math.min(requested, fitted);
}

function fitBodyPoint(text: string, requested: number) {
  const compactLength = text.replace(/\s+/g, ' ').trim().length;
  const fitted = compactLength > 980 ? 18 : compactLength > 780 ? 20 : compactLength > 580 ? 23 : compactLength > 420 ? 25 : requested;
  return Math.min(requested, fitted);
}

function buildMessage(draft: Duyuru) {
  const lines = ['DUYURU', `Tarih: ${draft.tarih}`];
  if (draft.no.trim()) lines.push(`Duyuru No: ${draft.no}`);
  lines.push('', draft.baslik, '', draft.icerik, '', 'Moren Mali Müşavirlik');
  return lines.join('\n');
}

function removeItem(id: string, items: Duyuru[], setItems: (items: Duyuru[]) => void, draft: Duyuru, setDraft: (draft: Duyuru) => void) {
  const next = items.filter((x) => x.id !== id);
  setItems(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* yoksay */ }
  if (draft.id === id) setDraft({ ...initial, id: 'draft', tarih: new Date().toLocaleDateString('tr-TR'), no: '', baslik: '', icerik: '' });
  toast.success('Duyuru silindi');
}
