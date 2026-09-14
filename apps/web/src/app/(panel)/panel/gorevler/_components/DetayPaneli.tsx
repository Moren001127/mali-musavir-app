'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock, Ban, Bell, Check, ExternalLink, FileText, History, Loader2, Mail, MessageSquare, Paperclip, Pin, RotateCcw, Save, Smartphone, StickyNote, Trash2, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CATEGORY_OPTIONS, ESKI_KATEGORI, KAYNAK_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_ORDER, STATUS_LABEL, tasksApi, taxpayerName,
  type CreateTaskInput, type RecurrenceConfig, type Task, type TaskPriority, type UpdateTaskInput,
} from '@/lib/tasks';
import TaxpayerSelect from '@/components/ui/TaxpayerSelect';
import { AcilirMenu, ErtelemeSecenekleri } from './AcilirMenu';
import type { MukellefSecenek } from './akilli-giris';
import type { GorevEylemleri } from './eylemler';
import { DurumRozeti, KaynakRozeti } from './Rozetler';
import { TekrarAlani } from './TekrarAlani';
import { EKIP_RENK, GIRDI, GOLD, GOLD_SOFT, IKINCIL, KENAR, KIRMIZI, METIN, MOR, NOT_RENK, SONUK, YESIL, gunDegeri, tarihSaat, vadeIso } from './ortak';

interface Form {
  title: string;
  description: string;
  category: string;
  priority: TaskPriority;
  taxpayerId: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm
  allDay: boolean;
  recurrence: RecurrenceConfig;
  notifyInApp: boolean;
  notifyPush: boolean;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
  tur: 'GOREV' | 'NOT';
  pinned: boolean;
}

function formOlustur(t?: Task | null, taslak?: Partial<CreateTaskInput> | null): Form {
  return {
    title: t?.title ?? taslak?.title ?? '',
    description: t?.description ?? taslak?.description ?? '',
    category: t?.category ?? taslak?.category ?? '',
    priority: t?.priority ?? taslak?.priority ?? 'MEDIUM',
    taxpayerId: t?.taxpayerId ?? taslak?.taxpayerId ?? '',
    dueDate: gunDegeri(t?.dueDate ?? taslak?.dueDate ?? null),
    dueTime: t?.dueTime ?? taslak?.dueTime ?? '',
    allDay: t ? !!t.allDay && !t.dueTime : !(taslak?.dueTime),
    recurrence: (t?.recurrence as RecurrenceConfig) || taslak?.recurrence || { type: 'NONE' },
    notifyInApp: t?.notifyInApp ?? taslak?.notifyInApp ?? true,
    notifyPush: t?.notifyPush ?? taslak?.notifyPush ?? true,
    notifyWhatsapp: t?.notifyWhatsapp ?? taslak?.notifyWhatsapp ?? true,
    notifyEmail: t?.notifyEmail ?? taslak?.notifyEmail ?? false,
    tur: (t?.tur as 'GOREV' | 'NOT') ?? taslak?.tur ?? 'GOREV',
    pinned: t?.pinned ?? taslak?.pinned ?? false,
  };
}

function formdanDto(f: Form): CreateTaskInput {
  return {
    title: f.title.trim(),
    description: f.description.trim() || undefined,
    category: f.category || undefined,
    priority: f.priority,
    taxpayerId: f.taxpayerId || undefined,
    dueDate: vadeIso(f.dueDate || null, f.allDay ? null : f.dueTime || null),
    dueTime: f.allDay ? undefined : f.dueTime || undefined,
    allDay: f.allDay || !f.dueTime,
    recurrence: f.recurrence?.type && f.recurrence.type !== 'NONE' ? f.recurrence : null,
    notifyInApp: f.notifyInApp,
    notifyPush: f.notifyPush,
    notifyWhatsapp: f.notifyWhatsapp,
    notifyEmail: f.notifyEmail,
    tur: f.tur,
    pinned: f.pinned,
  };
}

/**
 * Detay paneli — sağdan kayar (~440px), arkadaki liste yerinde kalır. Var olan kayıt: GET /tasks/:id (notlar + ekler).
 * Yeni kayıt: `taslak` ile açılır, "Oluştur" ile POST. Düzenlemeler "Kaydet" ile PATCH (yalnız değişince etkin).
 */
export function DetayPaneli({
  id,
  taslak,
  mukellefler,
  eylemler,
  onKapat,
  onKaydet,
}: {
  id: string | null;
  taslak?: Partial<CreateTaskInput> | null;
  mukellefler: MukellefSecenek[];
  eylemler: GorevEylemleri;
  onKapat: () => void;
  /** id null → oluştur; dolu → güncelle. Dönen kayıt ile panel güncel kalır. */
  onKaydet: (id: string | null, dto: CreateTaskInput | UpdateTaskInput) => Promise<Task>;
}) {
  const yeni = !id;
  const detayQ = useQuery({
    queryKey: ['gorevler-detay', id],
    queryFn: () => tasksApi.get(id as string),
    enabled: !!id,
    staleTime: 10_000,
  });
  const task = detayQ.data;

  const [form, setForm] = useState<Form>(() => formOlustur(null, taslak));
  const [kirli, setKirli] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [yeniNot, setYeniNot] = useState('');
  const [notEkleniyor, setNotEkleniyor] = useState(false);
  const [canli, setCanli] = useState(false);
  const [ekipDurum, setEkipDurum] = useState<{ calisiyor: boolean; hata?: string; isId?: string }>({ calisiyor: false });

  // Kayıt yüklenince / değişince formu tazele (kullanıcı düzenlerken ezme)
  useEffect(() => {
    if (yeni) {
      setForm(formOlustur(null, taslak));
      setKirli(false);
      return;
    }
    if (task && !kirli) setForm(formOlustur(task));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, task?.id, task?.updatedAt, yeni]);

  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKapat();
    };
    document.addEventListener('keydown', tus);
    return () => document.removeEventListener('keydown', tus);
  }, [onKapat]);

  const guncelle = (p: Partial<Form>) => {
    setForm((f) => ({ ...f, ...p }));
    setKirli(true);
  };

  const kaydet = async () => {
    if (!form.title.trim()) {
      toast.error('Başlık boş olamaz');
      return;
    }
    setKaydediliyor(true);
    try {
      await onKaydet(id, formdanDto(form));
      setKirli(false);
    } finally {
      setKaydediliyor(false);
    }
  };

  const notEkle = async () => {
    if (!id || !yeniNot.trim()) return;
    setNotEkleniyor(true);
    try {
      await eylemler.notEkle(id, yeniNot.trim());
      setYeniNot('');
      detayQ.refetch();
    } finally {
      setNotEkleniyor(false);
    }
  };

  const ekibeVer = async () => {
    if (!id) return;
    setEkipDurum({ calisiyor: true });
    try {
      const r = await eylemler.ekibeVer(id, canli);
      if (r.ok) {
        setEkipDurum({ calisiyor: false, isId: r.isId });
        detayQ.refetch();
      } else setEkipDurum({ calisiyor: false, hata: r.error || 'Ekip başlatılamadı' });
    } catch (e: any) {
      setEkipDurum({ calisiyor: false, hata: e?.response?.data?.message || e?.message || 'Ekip başlatılamadı' });
    }
  };

  const notlar = useMemo(() => [...(task?.notes || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [task?.notes]);
  const kategoriSecenekleri = useMemo(() => {
    const liste = [...CATEGORY_OPTIONS];
    if (form.category && !liste.some((c) => c.value === form.category)) liste.push({ value: form.category, label: ESKI_KATEGORI[form.category]?.label || form.category, color: '#a3a3a3' });
    return liste;
  }, [form.category]);

  const mukellef = form.taxpayerId ? mukellefler.find((m) => m.id === form.taxpayerId) : undefined;
  const bitti = task?.status === 'DONE';
  const kapali = bitti || task?.status === 'CANCELLED';
  const not = form.tur === 'NOT';
  const vurgu = not ? NOT_RENK : GOLD;
  const yukleniyor = !yeni && detayQ.isLoading;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[940]" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onKapat} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={yeni ? 'Yeni kayıt' : 'Kayıt detayı'}
        className="fixed bottom-0 right-0 top-0 z-[950] flex w-[440px] max-w-[calc(100vw-16px)] flex-col overflow-hidden"
        style={{
          background: `radial-gradient(90% 40% at 100% 0%, ${vurgu}1f, transparent 60%), linear-gradient(160deg, rgba(22,19,16,0.99), rgba(12,10,8,0.99))`,
          borderLeft: `1px solid ${vurgu}44`,
          boxShadow: '-24px 0 60px rgba(0,0,0,0.55)',
          animation: 'gorevPanelKay .18s ease-out',
        }}
      >
        <style>{`@keyframes gorevPanelKay{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}`}</style>
        {/* Üst şerit + başlık satırı */}
        <div className="h-1 w-full flex-shrink-0" style={{ background: `linear-gradient(90deg, ${vurgu}, ${vurgu}55 55%, transparent)` }} />
        <div className="flex flex-shrink-0 items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${KENAR}` }}>
          {not ? <StickyNote size={15} style={{ color: vurgu }} /> : <FileText size={15} style={{ color: vurgu }} />}
          <span className="text-[12.5px] font-bold" style={{ color: METIN }}>
            {yeni ? (not ? 'Yeni not' : 'Yeni görev') : not ? 'Not' : 'Görev'}
          </span>
          {task && <KaynakRozeti value={task.kaynak} />}
          {task && <DurumRozeti task={task} />}
          {task?.pinned && <Pin size={12} style={{ color: '#fbbf24' }} />}
          <button type="button" onClick={onKapat} title="Kapat (Esc)" className="ml-auto rounded-md p-1.5 transition hover:bg-white/10" style={{ color: IKINCIL }}>
            <X size={16} />
          </button>
        </div>

        {/* Gövde */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {yukleniyor ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[12.5px]" style={{ color: IKINCIL }}>
              <Loader2 size={14} className="animate-spin" /> Kayıt alınıyor…
            </div>
          ) : !yeni && detayQ.isError ? (
            <div className="rounded-xl p-4 text-center text-[12.5px]" style={{ border: `1px solid ${KIRMIZI}44`, color: '#fca5a5' }}>
              Kayıt alınamadı.{' '}
              <button type="button" onClick={() => detayQ.refetch()} className="font-bold underline">
                Tekrar dene
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Başlık + açıklama */}
              <div>
                <input
                  value={form.title}
                  onChange={(e) => guncelle({ title: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      kaydet();
                    }
                  }}
                  placeholder={not ? 'Not başlığı' : 'Görev başlığı'}
                  aria-label="Başlık"
                  autoFocus={yeni}
                  className={`h-11 w-full px-3 text-[15px] font-semibold ${kapali ? 'line-through opacity-60' : ''}`}
                  style={{ ...GIRDI, background: 'rgba(0,0,0,0.28)' }}
                />
                <textarea
                  value={form.description}
                  onChange={(e) => guncelle({ description: e.target.value })}
                  rows={3}
                  placeholder="Açıklama (isteğe bağlı)"
                  aria-label="Açıklama"
                  className="mt-2 w-full resize-y px-3 py-2 text-[12.5px] leading-relaxed"
                  style={GIRDI}
                />
              </div>

              {/* Mükellef */}
              <Alan etiket="Mükellef" sag={mukellef ? (
                <Link href={`/panel/mukellefler/${mukellef.id}`} className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: '#34d399' }} title="Mükellef kartını aç">
                  Kartı aç <ExternalLink size={10} />
                </Link>
              ) : null}>
                <TaxpayerSelect taxpayers={mukellefler} value={form.taxpayerId} onChange={(v) => guncelle({ taxpayerId: v === '__yok' ? '' : v })} allLabel="— Mükellef yok —" allValue="__yok" placeholder="Mükellef seç" style={{ ...GIRDI, height: 36, padding: '0 12px' }} />
              </Alan>

              {/* Kategori + öncelik */}
              <div className="grid grid-cols-2 gap-3">
                <Alan etiket="Kategori">
                  <select value={form.category} onChange={(e) => guncelle({ category: e.target.value })} className="h-9 w-full px-3 text-[12.5px]" style={GIRDI} title="Kategori">
                    <option value="" style={{ background: '#14110e' }}>Seçilmedi</option>
                    {kategoriSecenekleri.map((c) => (
                      <option key={c.value} value={c.value} style={{ background: '#14110e' }}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Alan>
                <Alan etiket="Öncelik">
                  <div className="grid grid-cols-4 gap-1">
                    {PRIORITY_ORDER.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => guncelle({ priority: p })}
                        aria-pressed={form.priority === p}
                        title={PRIORITY_LABEL[p]}
                        className="h-9 rounded-md text-[10.5px] font-bold uppercase"
                        style={form.priority === p ? { background: PRIORITY_COLOR[p], color: '#0f0d0b', border: '1px solid transparent' } : { background: 'rgba(255,255,255,0.04)', color: PRIORITY_COLOR[p], border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        {PRIORITY_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </Alan>
              </div>

              {/* Vade + saat */}
              <div className="grid grid-cols-2 gap-3">
                <Alan etiket="Vade">
                  <input type="date" value={form.dueDate} onChange={(e) => guncelle({ dueDate: e.target.value })} className="h-9 w-full px-3 text-[12.5px]" style={GIRDI} title="Vade tarihi" />
                </Alan>
                <Alan etiket="Saat" sag={
                  <label className="inline-flex cursor-pointer items-center gap-1 text-[11px]" style={{ color: IKINCIL }}>
                    <input type="checkbox" checked={form.allDay} onChange={(e) => guncelle({ allDay: e.target.checked, dueTime: e.target.checked ? '' : form.dueTime })} style={{ accentColor: GOLD }} /> Tüm gün
                  </label>
                }>
                  <input type="time" value={form.dueTime} disabled={form.allDay} onChange={(e) => guncelle({ dueTime: e.target.value, allDay: false })} className="h-9 w-full px-3 text-[12.5px] disabled:opacity-40" style={GIRDI} title="Saat" />
                </Alan>
              </div>

              {!not && <TekrarAlani value={form.recurrence} onChange={(r) => guncelle({ recurrence: r })} />}

              {/* Hatırlatma kanalları */}
              {!not && (
                <Alan etiket="Hatırlatma kanalları">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Anahtar ikon={<Bell size={12} />} ad="Portal" acik={form.notifyInApp} onChange={(v) => guncelle({ notifyInApp: v })} />
                    <Anahtar ikon={<Smartphone size={12} />} ad="Telefon" acik={form.notifyPush} onChange={(v) => guncelle({ notifyPush: v })} />
                    <Anahtar ikon={<MessageSquare size={12} />} ad="WhatsApp" acik={form.notifyWhatsapp} onChange={(v) => guncelle({ notifyWhatsapp: v })} />
                    <Anahtar ikon={<Mail size={12} />} ad="E-posta" acik={form.notifyEmail} onChange={(v) => guncelle({ notifyEmail: v })} />
                  </div>
                </Alan>
              )}

              {/* Tür + sabit */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => guncelle({ tur: not ? 'GOREV' : 'NOT' })} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold transition hover:brightness-125" style={{ background: `${NOT_RENK}14`, color: NOT_RENK, border: `1px solid ${NOT_RENK}44` }} title="Görev ↔ Not">
                  <StickyNote size={12} /> {not ? 'Göreve çevir' : 'Nota çevir'}
                </button>
                <button type="button" onClick={() => guncelle({ pinned: !form.pinned })} aria-pressed={form.pinned} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold transition hover:brightness-125" style={form.pinned ? { background: '#fbbf24', color: '#0f0d0b', border: '1px solid transparent' } : { background: 'rgba(251,191,36,0.10)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)' }} title="Listede üste sabitle">
                  <Pin size={12} /> {form.pinned ? 'Sabit' : 'Sabitle'}
                </button>
              </div>

              {/* Kaydet */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={kaydet}
                  disabled={kaydediliyor || (!yeni && !kirli) || !form.title.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[12.5px] font-bold transition-[transform,filter] hover:-translate-y-px hover:brightness-110 disabled:opacity-40 disabled:hover:translate-y-0"
                  style={{ background: `linear-gradient(135deg, ${vurgu}, ${not ? '#d97706' : GOLD_SOFT})`, color: '#0f0d0b' }}
                  title={yeni ? 'Kaydı oluştur (Enter)' : 'Değişiklikleri kaydet (Enter)'}
                >
                  {kaydediliyor ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {yeni ? 'Oluştur' : 'Kaydet'}
                </button>
                {!yeni && kirli && (
                  <button type="button" onClick={() => { if (task) setForm(formOlustur(task)); setKirli(false); }} className="h-9 rounded-lg px-3 text-[12px] font-semibold" style={{ color: IKINCIL }}>
                    Geri al
                  </button>
                )}
                {!yeni && !kirli && (
                  <span className="text-[11px]" style={{ color: SONUK }}>
                    Değişiklik yok
                  </span>
                )}
              </div>

              {!yeni && task && (
                <>
                  {/* Durum eylemleri */}
                  <Bolum baslik="Eylemler" ikon={<Check size={12} />}>
                    <div className="flex flex-wrap gap-1.5">
                      {bitti ? (
                        <Eylem ikon={<RotateCcw size={12} />} renk="#93c5fd" onClick={() => eylemler.yenidenAc(task.id)}>Yeniden aç</Eylem>
                      ) : (
                        <Eylem ikon={<Check size={12} />} renk={YESIL} onClick={() => eylemler.tamamla(task.id)} disabled={kapali}>Tamamla</Eylem>
                      )}
                      <AcilirMenu genislik={240} tetik={({ ref, ac }) => (
                        <button ref={ref} type="button" onClick={ac} disabled={kapali} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition hover:brightness-125 disabled:opacity-40" style={{ background: `${MOR}1f`, color: '#c084fc', border: `1px solid ${MOR}55` }} title="Ertele">
                          <AlarmClock size={12} /> Ertele
                        </button>
                      )}>
                        {(kapat) => <ErtelemeSecenekleri onSec={(g) => { eylemler.ertele(task.id, g); kapat(); }} />}
                      </AcilirMenu>
                      {!kapali && (
                        <Eylem ikon={<Ban size={12} />} renk="#94a3b8" onClick={() => { if (confirm('Bu kayıt iptal edilsin mi?')) eylemler.iptal(task.id); }}>İptal</Eylem>
                      )}
                      <Eylem ikon={<Trash2 size={12} />} renk={KIRMIZI} onClick={() => { if (confirm('Bu kayıt silinsin mi? Geri alınamaz.')) { eylemler.sil(task.id); onKapat(); } }}>Sil</Eylem>
                    </div>
                  </Bolum>

                  {/* Ekibe ver */}
                  {!not && (
                    <Bolum baslik="Ekibe ver" ikon={<Users size={12} />} renk={EKIP_RENK}>
                      <p className="mb-2 text-[11.5px]" style={{ color: IKINCIL }}>
                        Koordinatör işi ilgili ajana yönlendirir; sonuç bu kaydın notlarına düşer.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex items-center rounded-full p-[2px]" style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          {[{ v: false, ad: 'Kuru test' }, { v: true, ad: 'Canlı' }].map((s) => (
                            <button key={s.ad} type="button" onClick={() => setCanli(s.v)} aria-pressed={canli === s.v} className="rounded-full px-3 py-1 text-[11px] font-bold transition-[background-color,color]" style={canli === s.v ? { background: s.v ? `${KIRMIZI}33` : `${YESIL}33`, color: s.v ? '#fca5a5' : '#86efac' } : { color: IKINCIL }} title={s.v ? 'Canlı: portala yazar, dışarı gönderim yine onay ister' : 'Kuru test: hiçbir şey yazmaz, yalnız rapor üretir'}>
                              {s.ad}
                            </button>
                          ))}
                        </div>
                        <button type="button" onClick={ekibeVer} disabled={ekipDurum.calisiyor || kapali} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition hover:brightness-110 disabled:opacity-40" style={{ background: `linear-gradient(135deg, ${EKIP_RENK}, #5b9fd1)`, color: '#0b1218' }} title="Görevi Ekip'e ver">
                          {ekipDurum.calisiyor ? <Loader2 size={12} className="animate-spin" /> : <Users size={12} />} Ekibe ver
                        </button>
                        {(ekipDurum.isId || task.ekipIsId) && (
                          <Link href="/panel/ekip" className="inline-flex items-center gap-1 text-[11.5px] font-bold hover:underline" style={{ color: EKIP_RENK }} title={`İş ${ekipDurum.isId || task.ekipIsId}`}>
                            Konsolda aç <ExternalLink size={11} />
                          </Link>
                        )}
                      </div>
                      {ekipDurum.hata && (
                        <div className="mt-2 rounded-lg px-3 py-2 text-[11.5px]" style={{ background: `${KIRMIZI}14`, color: '#fca5a5', border: `1px solid ${KIRMIZI}44` }}>
                          {ekipDurum.hata}
                        </div>
                      )}
                    </Bolum>
                  )}

                  {/* Not zinciri */}
                  <Bolum baslik={`Notlar${notlar.length ? ` · ${notlar.length}` : ''}`} ikon={<MessageSquare size={12} />}>
                    <div className="flex gap-2">
                      <textarea
                        value={yeniNot}
                        onChange={(e) => setYeniNot(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) notEkle();
                        }}
                        rows={2}
                        placeholder="Yeni not… (Ctrl+Enter)"
                        className="min-w-0 flex-1 resize-none px-3 py-2 text-[12.5px]"
                        style={GIRDI}
                      />
                      <button type="button" onClick={notEkle} disabled={!yeniNot.trim() || notEkleniyor} className="h-9 self-end rounded-lg px-3 text-[12px] font-bold disabled:opacity-40" style={{ background: `${GOLD}22`, color: GOLD, border: `1px solid ${GOLD}55` }} title="Not ekle">
                        {notEkleniyor ? <Loader2 size={12} className="animate-spin" /> : 'Ekle'}
                      </button>
                    </div>
                    {notlar.length === 0 ? (
                      <p className="mt-2 text-[11.5px]" style={{ color: SONUK }}>
                        Henüz not yok.
                      </p>
                    ) : (
                      <ol className="mt-3 space-y-2">
                        {notlar.map((n) => (
                          <li key={n.id} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${KENAR}` }}>
                            <div className="mb-1 flex items-center gap-2 text-[10.5px]" style={{ color: IKINCIL }}>
                              <span className="font-semibold">{n.user ? `${n.user.firstName || ''} ${n.user.lastName || ''}`.trim() || 'Portal' : 'Portal'}</span>
                              <span>·</span>
                              <span>{tarihSaat(n.createdAt)}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.88)' }}>
                              {n.content}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </Bolum>

                  {/* Ekler */}
                  {(task.attachments?.length || 0) > 0 && (
                    <Bolum baslik={`Ekler · ${task.attachments!.length}`} ikon={<Paperclip size={12} />}>
                      <ul className="space-y-1">
                        {task.attachments!.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${KENAR}` }}>
                            <Paperclip size={12} style={{ color: IKINCIL }} />
                            <span className="min-w-0 flex-1 truncate" style={{ color: METIN }}>
                              {a.filename}
                            </span>
                            <span className="text-[10.5px] tabular-nums" style={{ color: IKINCIL }}>
                              {Math.max(1, Math.round((a.size || 0) / 1024))} KB
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Bolum>
                  )}

                  {/* Geçmiş */}
                  <Bolum baslik="Geçmiş" ikon={<History size={12} />}>
                    <ul className="space-y-1.5 text-[11.5px]">
                      <GecmisSatiri renk={GOLD} zaman={task.createdAt}>
                        Oluşturuldu{task.createdBy ? ` · ${task.createdBy.firstName} ${task.createdBy.lastName}` : ''}{task.kaynak && task.kaynak !== 'MANUEL' ? ` · kaynak: ${KAYNAK_LABEL[task.kaynak] || task.kaynak}` : ''}
                      </GecmisSatiri>
                      {task.ekipIsId && (
                        <GecmisSatiri renk={EKIP_RENK} zaman={null}>
                          Ekibe verildi · iş {task.ekipIsId} ·{' '}
                          <Link href="/panel/ekip" className="font-bold hover:underline" style={{ color: EKIP_RENK }}>
                            Konsolda aç
                          </Link>
                        </GecmisSatiri>
                      )}
                      {task.status === 'SNOOZED' && task.snoozedUntil && (
                        <GecmisSatiri renk={MOR} zaman={task.snoozedUntil}>
                          Ertelendi — bu tarihe kadar
                        </GecmisSatiri>
                      )}
                      {task.completedAt && (
                        <GecmisSatiri renk={YESIL} zaman={task.completedAt}>
                          Tamamlandı
                        </GecmisSatiri>
                      )}
                      {task.status === 'CANCELLED' && (
                        <GecmisSatiri renk="#94a3b8" zaman={task.updatedAt}>
                          İptal edildi
                        </GecmisSatiri>
                      )}
                      <GecmisSatiri renk="rgba(250,250,249,0.35)" zaman={task.updatedAt}>
                        Son güncelleme · durum {STATUS_LABEL[task.status]}
                      </GecmisSatiri>
                    </ul>
                  </Bolum>
                </>
              )}

              {yeni && mukellef && (
                <p className="text-[11px]" style={{ color: SONUK }}>
                  Kayıt {taxpayerName({ id: mukellef.id, companyName: mukellef.companyName || undefined, firstName: mukellef.firstName || undefined, lastName: mukellef.lastName || undefined })} mükellefine bağlanacak.
                </p>
              )}
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function Alan({ etiket, sag, children }: { etiket: string; sag?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: IKINCIL }}>
          {etiket}
        </label>
        {sag}
      </div>
      {children}
    </div>
  );
}

function Bolum({ baslik, ikon, renk = GOLD, children }: { baslik: string; ikon: ReactNode; renk?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${KENAR}` }}>
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.12em]" style={{ color: renk }}>
        {ikon} {baslik}
      </div>
      {children}
    </section>
  );
}

function Eylem({ ikon, renk, onClick, disabled, children }: { ikon: ReactNode; renk: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition hover:brightness-125 disabled:opacity-40" style={{ background: `${renk}1f`, color: renk, border: `1px solid ${renk}55` }}>
      {ikon} {children}
    </button>
  );
}

function Anahtar({ ikon, ad, acik, onChange }: { ikon: ReactNode; ad: string; acik: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={acik} onClick={() => onChange(!acik)} title={`${ad} hatırlatması ${acik ? 'açık' : 'kapalı'}`} className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-[12px] font-semibold transition" style={{ background: acik ? `${GOLD}14` : 'rgba(255,255,255,0.03)', border: `1px solid ${acik ? `${GOLD}55` : 'rgba(255,255,255,0.08)'}`, color: acik ? METIN : IKINCIL }}>
      <span style={{ color: acik ? GOLD : IKINCIL }}>{ikon}</span>
      <span className="flex-1 text-left">{ad}</span>
      <span className="relative inline-block h-[16px] w-[28px] flex-shrink-0 rounded-full transition-colors" style={{ background: acik ? GOLD : 'rgba(255,255,255,0.14)' }}>
        <span className="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all" style={{ left: acik ? 14 : 2, background: acik ? '#0f0d0b' : '#fff' }} />
      </span>
    </button>
  );
}

function GecmisSatiri({ renk, zaman, children }: { renk: string; zaman: string | null; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[5px] h-2 w-2 flex-shrink-0 rounded-full" style={{ background: renk }} />
      <span className="min-w-0 flex-1" style={{ color: 'rgba(250,250,249,0.82)' }}>
        {children}
      </span>
      {zaman && (
        <span className="flex-shrink-0 tabular-nums" style={{ color: IKINCIL }}>
          {tarihSaat(zaman)}
        </span>
      )}
    </li>
  );
}
