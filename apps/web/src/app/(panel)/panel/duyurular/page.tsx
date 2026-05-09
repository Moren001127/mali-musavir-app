'use client';

import { MessageCircle, Plus, Printer, Save, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

type Duyuru = {
  id: string;
  etiket: string;
  tarih: string;
  no: string;
  baslik: string;
  altBaslik: string;
  metin: string;
};

const STORAGE_KEY = 'moren-duyurular-v2';

const initial: Duyuru = {
  id: 'draft',
  etiket: 'ONEMLI DUYURU',
  tarih: '05.05.2026',
  no: '2026 / 14',
  baslik: 'MYK Mesleki Yeterlilik Belgesi Zorunlulugu',
  altBaslik: 'Isyerinizde calistirdiginiz personel icin yeni donem yukumlulukleri ve uyum sureci hakkinda ozet bilgilendirme.',
  metin:
    'Sayin muvekkilimiz, ilgili mevzuat kapsaminda isyerinizde calistirmak zorunda oldugunuz personel icin mesleki yeterlilik belgesi yukumlulugu bulunmaktadir. Detayli bilgi icin ofisimizle iletisime gecin.',
};

export default function DuyurularPage() {
  const [draft, setDraft] = useState<Duyuru>(initial);
  const [items, setItems] = useState<Duyuru[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
  }, []);

  const whatsappText = useMemo(() => {
    return encodeURIComponent(`${draft.baslik}\n\n${draft.altBaslik}\n\n${draft.metin}`);
  }, [draft]);

  const update = (key: keyof Duyuru, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    const saved = { ...draft, id: draft.id === 'draft' ? crypto.randomUUID() : draft.id };
    const next = [saved, ...items.filter((x) => x.id !== saved.id)].slice(0, 20);
    setDraft(saved);
    setItems(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const newDraft = () => setDraft({ ...initial, id: 'draft' });

  const remove = (id: string) => {
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (draft.id === id) newDraft();
  };

  return (
    <div className="min-h-[calc(100vh-92px)] bg-[#080704] p-6 text-white">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase text-[#c8ad68]">Ofis</div>
          <h1 className="mt-1 text-2xl font-semibold">Duyurular</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={newDraft} className="inline-flex items-center gap-2 rounded-lg border border-[#3a3322] px-4 py-2 text-sm font-semibold text-[#d7c28b] hover:bg-[#17130d]">
            <Plus size={16} /> Yeni
          </button>
          <button onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-[#d5b868] px-4 py-2 text-sm font-semibold text-[#111] hover:bg-[#e3c777]">
            <Save size={16} /> Kaydet
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(520px,760px)_420px]">
        <section className="rounded-2xl border border-[#2b2619] bg-[#11100c] p-5">
          <div className="mx-auto aspect-square w-full max-w-[720px] overflow-hidden bg-[#f7f6f2] shadow-2xl">
            <div className="grid h-full grid-cols-[29.5%_70.5%] text-[#0c1236]">
              <aside className="flex flex-col items-center bg-[#0d1238] px-7 py-12 text-center text-white">
                <div className="text-[88px] font-serif leading-none">M</div>
                <div className="mt-2 text-[40px] font-serif leading-none">MOREN</div>
                <div className="mt-2 text-[13px] font-bold">MALI MUSAVIRLIK</div>
                <div className="my-8 h-px w-16 bg-white/35" />
                <Contact label="TELEFON" value="0535 058 74 75" />
                <Contact label="E-POSTA" value="info@morenmusavirlik.com" />
                <Contact label="ADRES" value={'Hastane Mah. Ozcan\nTaskinbas Cad. No: 16/6\nArnavutkoy, Istanbul'} />
                <Contact label="WEB" value="morenmusavirlik.com" />
              </aside>

              <main className="relative overflow-hidden px-16 py-12">
                <div className="absolute left-0 right-0 top-0 h-28 bg-[#d7d7db]" />
                <div className="absolute left-0 right-0 top-12 h-16 rounded-b-[55%] bg-[#ececef]" />
                <div className="relative flex items-start justify-between">
                  <div className="mt-10 text-[13px] font-bold">{draft.etiket}</div>
                  <div className="text-right font-serif">
                    <div className="text-3xl font-bold">{draft.tarih}</div>
                    <div className="text-sm">No {draft.no}</div>
                  </div>
                </div>
                <div className="relative mt-36">
                  <h2 className="max-w-[540px] text-[44px] font-serif font-bold leading-[1.08] text-[#0d1238]">{draft.baslik}</h2>
                  <p className="mt-6 max-w-[560px] border-b border-[#dedbd4] pb-8 font-serif text-lg italic leading-relaxed text-[#777b8d]">{draft.altBaslik}</p>
                  <p className="mt-14 whitespace-pre-line text-center font-serif text-[24px] leading-[1.65] text-[#151936]">{draft.metin}</p>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-28 bg-[#e9e9ec]" />
                <div className="absolute bottom-11 left-0 right-0 h-16 rounded-t-[55%] bg-[#f7f6f2]" />
                <div className="absolute bottom-8 right-12 text-right font-serif text-[#0d1238]">
                  <div className="text-3xl italic">Muzaffer Oren</div>
                  <div className="text-xs font-bold italic">Serbest Muhasebeci Mali Musavir</div>
                </div>
              </main>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <Panel title="Duyuru Icerigi">
            <Field label="Ust Etiket" value={draft.etiket} onChange={(v) => update('etiket', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tarih" value={draft.tarih} onChange={(v) => update('tarih', v)} />
              <Field label="No" value={draft.no} onChange={(v) => update('no', v)} />
            </div>
            <Field label="Baslik" value={draft.baslik} onChange={(v) => update('baslik', v)} />
            <Field label="Alt Baslik" value={draft.altBaslik} onChange={(v) => update('altBaslik', v)} textarea />
            <Field label="Metin" value={draft.metin} onChange={(v) => update('metin', v)} textarea rows={7} />
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#3a3322] px-3 py-3 text-sm font-semibold text-[#d7c28b] hover:bg-[#17130d]">
                <Printer size={16} /> PDF
              </button>
              <a href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1f8f55] px-3 py-3 text-sm font-semibold text-white hover:bg-[#25a563]">
                <MessageCircle size={16} /> WhatsApp
              </a>
            </div>
          </Panel>

          <Panel title={`Kayitli Duyurular (${items.length})`}>
            <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#3a3322] p-4 text-center text-sm text-[#8f8878]">Henuz kayit yok.</div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-lg border border-[#2b2619] bg-[#100d08] p-3">
                    <button onClick={() => setDraft(item)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-semibold text-white">{item.baslik}</div>
                      <div className="text-xs text-[#9b927d]">{item.tarih} - No {item.no}</div>
                    </button>
                    <button onClick={() => remove(item.id)} className="rounded-md p-2 text-[#b65a54] hover:bg-[#2a1513]">
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

function Contact({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-10 whitespace-pre-line">
      <div className="mb-3 text-[11px] font-bold italic text-white/55">{label}</div>
      <div className="font-serif text-[15px] font-bold leading-relaxed">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#2b2619] bg-[#11100c]">
      <div className="border-b border-[#2b2619] px-5 py-4 text-sm font-bold text-[#d7c28b]">{title}</div>
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
      <span className="mb-2 block text-xs font-bold uppercase text-[#9b927d]">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-none rounded-lg border border-[#302a1d] bg-[#090806] px-3 py-3 text-sm text-white outline-none focus:border-[#c8ad68]"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-[#302a1d] bg-[#090806] px-3 py-3 text-sm text-white outline-none focus:border-[#c8ad68]"
        />
      )}
    </label>
  );
}
