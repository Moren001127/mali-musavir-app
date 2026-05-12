'use client';

import { api } from '@/lib/api';
import { MessageCircle, Save, Send, Trash2, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

type Duyuru = {
  id: string;
  tarih: string;
  no: string;
  baslik: string;
  icerik: string;
};

type Taxpayer = {
  id: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  phones?: string[] | null;
};

type LegacyDuyuru = Partial<Duyuru> & {
  metin?: string;
  altBaslik?: string;
  etiket?: string;
};

const STORAGE_KEY = 'moren-duyurular-v3';
const LEGACY_STORAGE_KEY = 'moren-duyurular-v2';

const NAVY = '#0d1238';
const PAPER = '#f7f4eb';
const GOLD = '#d7c28b';
const TEXT = '#f8fafc';
const MUTED = '#cbd5e1';
const SOFT = '#9ca3af';
const BORDER = 'rgba(255,255,255,0.14)';

const initial: Duyuru = {
  id: 'draft',
  tarih: '12.05.2026',
  no: '2026 / 14',
  baslik: 'MYK Mesleki Yeterlilik Belgesi Zorunluluğu',
  icerik:
    'Sayın müvekkilimiz, ilgili mevzuat kapsamında işyerinizde çalıştırdığınız personel için mesleki yeterlilik belgesi yükümlülüğü bulunmaktadır. Detaylı bilgi ve süreç takibi için ofisimizle iletişime geçebilirsiniz.',
};

export default function DuyurularPage() {
  const [draft, setDraft] = useState<Duyuru>(initial);
  const [items, setItems] = useState<Duyuru[]>([]);
  const [taxpayers, setTaxpayers] = useState<Taxpayer[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LegacyDuyuru[];
      const normalized = Array.isArray(parsed) ? parsed.map(normalizeDuyuru) : [];
      setItems(normalized);
      if (normalized[0]) setDraft(normalized[0]);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .get('/taxpayers')
      .then((r) => {
        if (!active) return;
        const list = r.data?.data ?? r.data ?? [];
        setTaxpayers(Array.isArray(list) ? list : []);
      })
      .catch(() => setTaxpayers([]));
    return () => {
      active = false;
    };
  }, []);

  const whatsappTargets = useMemo(
    () => taxpayers.filter((t) => Boolean(t.phone || (Array.isArray(t.phones) && t.phones.some(Boolean)))),
    [taxpayers],
  );

  const plainMessage = useMemo(() => buildMessage(draft), [draft]);
  const whatsappUrl = useMemo(() => `https://wa.me/?text=${encodeURIComponent(plainMessage)}`, [plainMessage]);

  const update = (key: keyof Duyuru, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    if (!draft.baslik.trim() || !draft.icerik.trim()) {
      toast.error('Başlık ve içerik boş bırakılamaz');
      return;
    }

    const saved = { ...draft, id: draft.id === 'draft' ? crypto.randomUUID() : draft.id };
    const next = [saved, ...items.filter((x) => x.id !== saved.id)].slice(0, 30);
    setDraft(saved);
    setItems(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    toast.success('Duyuru kaydedildi');
  };

  const sendPortalMessage = async () => {
    if (!draft.baslik.trim() || !draft.icerik.trim()) {
      toast.error('Başlık ve içerik boş bırakılamaz');
      return;
    }
    if (!whatsappTargets.length) {
      toast.error('Telefon numarası kayıtlı mükellef bulunamadı');
      return;
    }
    const ok = window.confirm(`${whatsappTargets.length} mükellefe WhatsApp duyurusu gönderilecek. Devam edilsin mi?`);
    if (!ok) return;

    setSending(true);
    try {
      const resp = await api.post('/whatsapp/portal-message/send', {
        taxpayerIds: whatsappTargets.map((t) => t.id),
        message: plainMessage,
      });
      toast.success(`${resp.data?.basarili || 0} gönderildi, ${resp.data?.hatali || 0} hatalı`);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Duyuru gönderilemedi');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-92px)] bg-[#080704] px-6 py-7 text-white">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[.14em]" style={{ color: GOLD }}>
            Portal
          </div>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight" style={{ color: TEXT }}>
            Duyurular
          </h1>
          <p className="mt-2 text-[14px] font-medium" style={{ color: MUTED }}>
            HTML şablonundaki kurumsal duyuru düzeni. Tarih, duyuru no, başlık ve içerik girilir.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ActionButton icon={<Save size={17} />} label="Kaydet" onClick={save} tone="gold" />
          <ActionButton icon={<Send size={17} />} label={sending ? 'Gönderiliyor' : 'Gönder'} onClick={sendPortalMessage} disabled={sending} tone="blue" />
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1f8f55] px-4 text-[14px] font-semibold text-white transition hover:bg-[#25a563]"
          >
            <MessageCircle size={17} /> WhatsApp
          </a>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(560px,790px)_420px]">
        <section className="rounded-[10px] border p-5" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.045)' }}>
          <AnnouncementPreview draft={draft} />
        </section>

        <aside className="space-y-4">
          <Panel title="Duyuru Girişi">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tarih" value={draft.tarih} onChange={(v) => update('tarih', v)} />
              <Field label="Duyuru No" value={draft.no} onChange={(v) => update('no', v)} />
            </div>
            <Field label="Başlık" value={draft.baslik} onChange={(v) => update('baslik', v)} />
            <Field label="İçerik" value={draft.icerik} onChange={(v) => update('icerik', v)} textarea rows={9} />
          </Panel>

          <Panel title="Gönderim">
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.045)' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1f8f55]/20 text-[#4ade80]">
                  <Users size={18} />
                </div>
                <div>
                  <div className="text-[20px] font-semibold tabular-nums" style={{ color: TEXT }}>
                    {whatsappTargets.length}
                  </div>
                  <div className="text-[13px] font-medium" style={{ color: MUTED }}>
                    Telefonu kayıtlı mükellef
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed" style={{ color: SOFT }}>
                Gönder butonu bu metni portal WhatsApp gönderim hattına iletir. WhatsApp butonu ise metni manuel paylaşım ekranında açar.
              </p>
            </div>
          </Panel>

          <Panel title={`Kayıtlı Duyurular (${items.length})`}>
            <div className="max-h-[280px] space-y-2 overflow-auto pr-1">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center text-[14px] font-medium" style={{ borderColor: BORDER, color: MUTED }}>
                  Henüz kayıt yok.
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.035)' }}>
                    <button onClick={() => setDraft(item)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[14px] font-semibold" style={{ color: TEXT }}>
                        {item.baslik}
                      </div>
                      <div className="text-[12.5px] font-medium" style={{ color: MUTED }}>
                        {item.tarih} · Duyuru No {item.no}
                      </div>
                    </button>
                    <button onClick={() => removeItem(item.id, items, setItems, draft, setDraft)} className="rounded-md p-2 text-[#ff7777] hover:bg-[#2a1513]">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function AnnouncementPreview({ draft }: { draft: Duyuru }) {
  return (
    <div className="mx-auto aspect-square w-full max-w-[740px] overflow-hidden bg-[#f7f4eb] shadow-2xl">
      <div className="grid h-full grid-cols-[29.5%_70.5%]" style={{ color: NAVY }}>
        <aside className="flex flex-col items-center bg-[#0d1238] px-7 py-10 text-center text-white">
          <div className="mb-7 mt-1 flex h-[116px] w-[150px] items-center justify-center">
            <div>
              <div className="font-serif text-[86px] leading-none tracking-[-.04em]">M</div>
              <div className="mx-auto mt-2 h-px w-20 bg-white/45" />
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[.28em] text-white/75">Moren</div>
            </div>
          </div>

          <div className="mb-8 h-px w-16 bg-white/35" />
          <Contact label="Telefon" value="0535 058 74 75" />
          <Contact label="E-Posta" value="info@morenmusavirlik.com" />
          <Contact label="Adres" value={'Hastane Mah. Özcan\nTaşkınbaş Cad. No: 16/6\nArnavutköy, İstanbul'} />
          <Contact label="Web" value="morenmusavirlik.com" />
        </aside>

        <main className="relative flex min-w-0 flex-col overflow-hidden px-[6.5%] py-[6.8%]" style={{ background: PAPER }}>
          <div className="absolute left-0 right-0 top-0 h-[18%] bg-[rgba(13,18,56,0.08)]" />
          <div className="absolute left-0 right-0 top-[5%] h-[11%] rounded-b-[55%] bg-[rgba(13,18,56,0.07)]" />
          <div className="absolute bottom-0 left-0 right-0 h-[20%] bg-[rgba(13,18,56,0.08)]" />
          <div className="absolute bottom-[5.5%] left-0 right-0 h-[11%] rounded-t-[55%] bg-[#f7f4eb]" />

          <div className="relative z-10 flex items-start justify-between gap-5">
            <div className="mt-8 inline-flex items-center gap-3 text-[12px] font-bold uppercase tracking-[.32em]" style={{ color: NAVY }}>
              <span className="h-px w-7 bg-[#0d1238]" />
              Duyuru
              <span className="h-px w-7 bg-[#0d1238]" />
            </div>
            <div className="whitespace-nowrap text-right font-serif" style={{ color: NAVY }}>
              <div className="text-[28px] font-semibold leading-none">{draft.tarih}</div>
              <div className="mt-2 text-[14px] font-medium">No {draft.no}</div>
            </div>
          </div>

          <div className="relative z-10 flex flex-1 flex-col justify-center py-10">
            <h2 className="max-w-[520px] font-serif text-[50px] font-semibold leading-[1.08] tracking-[-.02em]" style={{ color: NAVY }}>
              {draft.baslik}
            </h2>
            <div className="mt-7 h-px w-full bg-[rgba(13,18,56,0.18)]" />
            <p className="mt-8 whitespace-pre-line text-justify font-serif text-[24px] leading-[1.58]" style={{ color: '#1f2545' }}>
              {draft.icerik}
            </p>
          </div>

          <div className="relative z-10 mt-auto flex justify-end">
            <div className="text-right" style={{ color: NAVY }}>
              <div className="mb-3 h-px w-[210px] bg-gradient-to-l from-[#0d1238] to-transparent opacity-60" />
              <div className="font-serif text-[38px] italic leading-none">Muzaffer Ören</div>
              <div className="mt-2 font-serif text-[13px] font-semibold italic">Serbest Muhasebeci Mali Müşavir</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone: 'gold' | 'blue';
}) {
  const styles =
    tone === 'gold'
      ? { background: GOLD, color: '#111' }
      : { background: '#2563eb', color: '#fff' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
      style={styles}
    >
      {icon}
      {label}
    </button>
  );
}

function Contact({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-8 whitespace-pre-line">
      <div className="mb-2 font-serif text-[12px] font-semibold italic tracking-[.22em] text-white/55">{label}</div>
      <div className="font-serif text-[14px] font-semibold leading-relaxed">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[10px] border" style={{ borderColor: BORDER, background: 'rgba(255,255,255,0.045)' }}>
      <div className="border-b px-5 py-4 text-[15px] font-semibold" style={{ borderColor: BORDER, color: TEXT }}>
        {title}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12.5px] font-semibold uppercase tracking-[.08em]" style={{ color: MUTED }}>
        {label}
      </span>
      {textarea ? (
        <textarea
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-none rounded-lg border px-3.5 py-3 text-[15px] font-medium leading-relaxed outline-none transition focus:border-[#d7c28b]"
          style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-lg border px-3.5 text-[15px] font-semibold outline-none transition focus:border-[#d7c28b]"
          style={{ borderColor: BORDER, background: 'rgba(0,0,0,0.22)', color: TEXT }}
        />
      )}
    </label>
  );
}

function normalizeDuyuru(item: LegacyDuyuru): Duyuru {
  return {
    id: item.id || crypto.randomUUID(),
    tarih: item.tarih || initial.tarih,
    no: item.no || '',
    baslik: item.baslik || '',
    icerik: item.icerik || item.metin || item.altBaslik || '',
  };
}

function buildMessage(draft: Duyuru) {
  return [
    'DUYURU',
    `Tarih: ${draft.tarih}`,
    `Duyuru No: ${draft.no}`,
    '',
    draft.baslik,
    '',
    draft.icerik,
    '',
    'Moren Mali Müşavirlik',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function removeItem(
  id: string,
  items: Duyuru[],
  setItems: (items: Duyuru[]) => void,
  draft: Duyuru,
  setDraft: (draft: Duyuru) => void,
) {
  const next = items.filter((x) => x.id !== id);
  setItems(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  if (draft.id === id) setDraft(initial);
  toast.success('Duyuru silindi');
}
