'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { edefterControlApi, type ManuelKaynak, type ManuelKosul, type ManuelKural, type ManuelKuralGovde } from '@/lib/edefter-control';
import { ARROW, BORDER, BORDER_STRONG, MUTED, MUTED2, NAVY, NAVY_SOFT, OK, PANEL, PANEL_HOVER, TEXT, sevColor, sevLabel } from './tema';

// ─────────────────────────────────────────────────────────────────────────────
//  MANUEL (OFİS) KURALLARI — Kontrol Kuralları sekmesi (2026-09-14).
//  Muzaffer Bey: "500 sermaye hesabında bakiye yoksa uyarı versin; hareket yoksa; şu tutarın üstünde/altındaysa".
//  Eski form yalnız tarayıcıya yazıyordu ve hiç çalışmıyordu. Artık sunucuda saklanır, analizde çalışır
//  (bulgu kodu MANUEL:<id>, Bulgular'da "Manuel Kurallar" alanı; kaynak Mizan ise Mizan Denetimi'nde de).
//  Dil: sakin kayıt formu (altın yok, tek vurgu lacivert), koşul cümle gibi okunur.
// ─────────────────────────────────────────────────────────────────────────────
const KOSULLAR: Array<{ kod: ManuelKosul; kaynak: ManuelKaynak; ad: string; esik: false | 'TL' | 'ADET' }> = [
  { kod: 'BAKIYE_YOK', kaynak: 'MIZAN', ad: 'mizan bakiyesi yoksa', esik: false },
  { kod: 'BAKIYE_VAR', kaynak: 'MIZAN', ad: 'mizan bakiyesi varsa', esik: false },
  { kod: 'BORC_BAKIYE', kaynak: 'MIZAN', ad: 'borç bakiyesi veriyorsa', esik: false },
  { kod: 'ALACAK_BAKIYE', kaynak: 'MIZAN', ad: 'alacak bakiyesi veriyorsa', esik: false },
  { kod: 'BAKIYE_USTUNDE', kaynak: 'MIZAN', ad: 'mizan bakiyesi eşiğin üstündeyse', esik: 'TL' },
  { kod: 'BAKIYE_ALTINDA', kaynak: 'MIZAN', ad: 'mizan bakiyesi eşiğin altındaysa', esik: 'TL' },
  { kod: 'HAREKET_YOK', kaynak: 'HAREKET', ad: 'dönemde hareket yoksa', esik: false },
  { kod: 'HAREKET_VAR', kaynak: 'HAREKET', ad: 'dönemde hareket varsa', esik: false },
  { kod: 'BORC_USTUNDE', kaynak: 'HAREKET', ad: 'dönem borç toplamı eşiğin üstündeyse', esik: 'TL' },
  { kod: 'BORC_ALTINDA', kaynak: 'HAREKET', ad: 'dönem borç toplamı eşiğin altındaysa', esik: 'TL' },
  { kod: 'ALACAK_USTUNDE', kaynak: 'HAREKET', ad: 'dönem alacak toplamı eşiğin üstündeyse', esik: 'TL' },
  { kod: 'ALACAK_ALTINDA', kaynak: 'HAREKET', ad: 'dönem alacak toplamı eşiğin altındaysa', esik: 'TL' },
  { kod: 'ADET_ALTINDA', kaynak: 'HAREKET', ad: 'dönem hareket adedi eşiğin altındaysa', esik: 'ADET' },
];
const kosulTanim = (kod: string) => KOSULLAR.find((k) => k.kod === kod);

type Form = { ad: string; aciklama: string; seviye: 'ERROR' | 'WARN' | 'INFO'; hesap: string; kaynak: ManuelKaynak; kosul: ManuelKosul; esik: string; herHesapAyri: boolean; donemKisiti: 'HEPSI' | 'YILLIK' | 'GECICI' };
const BOS_FORM: Form = { ad: '', aciklama: '', seviye: 'WARN', hesap: '', kaynak: 'MIZAN', kosul: 'BAKIYE_YOK', esik: '', herHesapAyri: false, donemKisiti: 'HEPSI' };

const fmtTL = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Sunucudaki manuelKuralCumlesi ile aynı kalıp — canlı önizleme için ekranda da üretilir.
export function kuralCumlesi(k: { hesap: string; kosul: string; esik?: number | string | null; herHesapAyri: boolean; donemKisiti: string }): string {
  const t = kosulTanim(k.kosul);
  const onekler = String(k.hesap || '').split(/[\s,;]+/).map((s) => s.trim().toLocaleUpperCase('tr-TR')).filter(Boolean);
  const hesapYazi = onekler.length > 1 ? `${onekler.join(', ')} hesaplarında` : `${onekler[0] || '…'} hesabında`;
  const e = k.esik == null || k.esik === '' ? null : Number(k.esik);
  const esikYazi = t?.esik && e != null && Number.isFinite(e) ? (t.esik === 'ADET' ? ` (eşik ${e} hareket)` : ` (eşik ${fmtTL(e)} TL)`) : '';
  const ayri = k.herHesapAyri ? ' — her alt hesap ayrı' : '';
  const donem = k.donemKisiti === 'YILLIK' ? ' — yalnız yıllık' : k.donemKisiti === 'GECICI' ? ' — yalnız geçici vergi' : '';
  return `${hesapYazi} ${t?.ad || k.kosul}${esikYazi}${ayri}${donem}`;
}

const GIRDI: CSSProperties = { background: PANEL, border: `1px solid ${BORDER}`, color: TEXT };
const SECIM: CSSProperties = { ...GIRDI, backgroundImage: ARROW('5b8def'), backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: 30 };
const SECENEK: CSSProperties = { background: '#1a1a17', color: TEXT };

function Alan({ label, children, genis }: { label: string; children: any; genis?: boolean }) {
  return (
    <div className={genis ? 'md:col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: MUTED }}>{label}</div>
      {children}
    </div>
  );
}

export function ManuelKurallar() {
  const qc = useQueryClient();
  const [acik, setAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BOS_FORM);

  const { data: kurallar = [], isLoading } = useQuery<ManuelKural[]>({
    queryKey: ['edefter-manuel-kurallar'],
    queryFn: () => edefterControlApi.manuelKurallar.list(),
  });

  const tazele = () => {
    qc.invalidateQueries({ queryKey: ['edefter-manuel-kurallar'] });
    qc.invalidateQueries({ queryKey: ['edefter-rule-settings'] }); // katalog (bulgu etiketleri) manuel kuralları da taşır
  };
  const hataMesaji = (e: any) => e?.response?.data?.message || e?.message || 'Kaydedilemedi';

  const kaydetMut = useMutation({
    mutationFn: (govde: ManuelKuralGovde) => (duzenlenen ? edefterControlApi.manuelKurallar.update(duzenlenen, govde) : edefterControlApi.manuelKurallar.create(govde)),
    onSuccess: () => {
      tazele(); setAcik(false); setDuzenlenen(null); setForm(BOS_FORM);
      toast.success('Kural kaydedildi. Bulguları görmek için Yeniden Analiz çalıştırın.');
    },
    onError: (e: any) => toast.error(hataMesaji(e)),
  });
  const aktifMut = useMutation({
    mutationFn: ({ id, aktif }: { id: string; aktif: boolean }) => edefterControlApi.manuelKurallar.update(id, { aktif }),
    onSuccess: (_d, v) => { tazele(); toast.success(v.aktif ? 'Kural açıldı' : 'Kural kapatıldı'); },
    onError: (e: any) => toast.error(hataMesaji(e)),
  });
  const silMut = useMutation({
    mutationFn: (id: string) => edefterControlApi.manuelKurallar.remove(id),
    onSuccess: () => { tazele(); toast.success('Kural silindi'); },
    onError: (e: any) => toast.error(hataMesaji(e)),
  });

  const kosulSecenekleri = useMemo(() => KOSULLAR.filter((k) => k.kaynak === form.kaynak), [form.kaynak]);
  const secili = kosulTanim(form.kosul);
  const esikGerekli = Boolean(secili?.esik);

  const kaynakDegistir = (kaynak: ManuelKaynak) => {
    const ilk = KOSULLAR.find((k) => k.kaynak === kaynak)!;
    setForm((f) => ({ ...f, kaynak, kosul: kosulTanim(f.kosul)?.kaynak === kaynak ? f.kosul : ilk.kod }));
  };
  const duzenle = (k: ManuelKural) => {
    setDuzenlenen(k.id); setAcik(true);
    setForm({ ad: k.ad, aciklama: k.aciklama || '', seviye: k.seviye, hesap: k.hesap, kaynak: k.kaynak, kosul: k.kosul, esik: k.esik == null ? '' : String(k.esik), herHesapAyri: Boolean(k.herHesapAyri), donemKisiti: k.donemKisiti || 'HEPSI' });
  };
  const vazgec = () => { setAcik(false); setDuzenlenen(null); setForm(BOS_FORM); };
  const kaydet = () => {
    if (!form.ad.trim()) { toast.error('Kural adı boş olamaz'); return; }
    if (!form.hesap.trim()) { toast.error('Hesap kodu boş olamaz (örn. 500 veya 320.01)'); return; }
    if (esikGerekli && (form.esik === '' || !Number.isFinite(Number(form.esik)) || Number(form.esik) < 0)) { toast.error('Bu koşul için eşik gerekli'); return; }
    kaydetMut.mutate({
      ad: form.ad.trim(), aciklama: form.aciklama.trim() || null, seviye: form.seviye, hesap: form.hesap.trim(), kaynak: form.kaynak, kosul: form.kosul,
      esik: esikGerekli ? Number(form.esik) : null, herHesapAyri: form.herHesapAyri, donemKisiti: form.donemKisiti,
    });
  };
  const sil = (k: ManuelKural) => {
    if (!window.confirm(`"${k.ad}" kuralı silinsin mi? Bu kuralın eski bulguları Yeniden Analiz'de kaybolur.`)) return;
    silMut.mutate(k.id);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: PANEL, border: `1px solid ${BORDER_STRONG}` }}>
      <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: PANEL_HOVER, borderBottom: `1px solid ${BORDER}` }}>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(250,250,249,.85)' }}>Ofis kuralları</span>
        <span className="text-xs tabular-nums" style={{ color: MUTED }}>{kurallar.length}</span>
        <span className="text-[11px] hidden md:inline" style={{ color: MUTED2 }}>Sunucuda saklanır; her analizde (Luca'dan Çek / Yeniden Analiz) çalışır, bulgular "Manuel Kurallar" alanında görünür.</span>
        {!acik && (
          <button onClick={() => { setDuzenlenen(null); setForm(BOS_FORM); setAcik(true); }} className="ml-auto h-8 px-3 rounded-md text-[11.5px] font-semibold inline-flex items-center gap-1.5" style={{ background: NAVY_SOFT, color: NAVY, border: '1px solid rgba(91,141,239,.3)' }}>
            <Plus size={13} /> Yeni kural
          </button>
        )}
      </div>

      {acik && (
        <div className="px-4 py-4 space-y-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="text-[11px] font-semibold" style={{ color: NAVY }}>{duzenlenen ? 'Kuralı düzenle' : 'Yeni kural'}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Alan label="Kural adı *"><input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn: Sermaye hesabı boş olmasın" className="w-full h-9 rounded-md px-3 text-sm" style={GIRDI} /></Alan>
            <Alan label="Seviye">
              <select value={form.seviye} onChange={(e) => setForm({ ...form, seviye: e.target.value as Form['seviye'] })} className="w-full h-9 rounded-md px-3 text-sm appearance-none cursor-pointer" style={SECIM}>
                <option value="ERROR" style={SECENEK}>Hata</option><option value="WARN" style={SECENEK}>Uyarı</option><option value="INFO" style={SECENEK}>Bilgi</option>
              </select>
            </Alan>
            <Alan label="Hesap kodu * (birden fazla: 120, 320)"><input value={form.hesap} onChange={(e) => setForm({ ...form, hesap: e.target.value })} placeholder="Örn: 500 veya 320.01" className="w-full h-9 rounded-md px-3 text-sm tabular-nums" style={GIRDI} /></Alan>
            <Alan label="Kaynak">
              <select value={form.kaynak} onChange={(e) => kaynakDegistir(e.target.value as ManuelKaynak)} className="w-full h-9 rounded-md px-3 text-sm appearance-none cursor-pointer" style={SECIM}>
                <option value="MIZAN" style={SECENEK}>Mizan bakiyesi (dönem sonu, kümülatif)</option>
                <option value="HAREKET" style={SECENEK}>Dönem hareketi (fiş listesi)</option>
              </select>
            </Alan>
            <Alan label="Koşul">
              <select value={form.kosul} onChange={(e) => setForm({ ...form, kosul: e.target.value as ManuelKosul })} className="w-full h-9 rounded-md px-3 text-sm appearance-none cursor-pointer" style={SECIM}>
                {kosulSecenekleri.map((k) => <option key={k.kod} value={k.kod} style={SECENEK}>{k.ad}</option>)}
              </select>
            </Alan>
            <Alan label={secili?.esik === 'ADET' ? 'Eşik (hareket adedi) *' : esikGerekli ? 'Eşik (TL) *' : 'Eşik'}>
              <input type="number" min={0} disabled={!esikGerekli} value={esikGerekli ? form.esik : ''} onChange={(e) => setForm({ ...form, esik: e.target.value })} placeholder={esikGerekli ? (secili?.esik === 'ADET' ? 'Örn: 3' : 'Örn: 250000') : 'Bu koşulda eşik yok'} className="w-full h-9 rounded-md px-3 text-sm tabular-nums disabled:opacity-40" style={GIRDI} />
            </Alan>
            <Alan label="Uygulama">
              <select value={form.herHesapAyri ? 'AYRI' : 'TOPLAM'} onChange={(e) => setForm({ ...form, herHesapAyri: e.target.value === 'AYRI' })} className="w-full h-9 rounded-md px-3 text-sm appearance-none cursor-pointer" style={SECIM}>
                <option value="TOPLAM" style={SECENEK}>Hesap toplamı (tek satır)</option>
                <option value="AYRI" style={SECENEK}>Her alt hesap ayrı</option>
              </select>
            </Alan>
            <Alan label="Dönem">
              <select value={form.donemKisiti} onChange={(e) => setForm({ ...form, donemKisiti: e.target.value as Form['donemKisiti'] })} className="w-full h-9 rounded-md px-3 text-sm appearance-none cursor-pointer" style={SECIM}>
                <option value="HEPSI" style={SECENEK}>Her dönem</option>
                <option value="YILLIK" style={SECENEK}>Yalnız yıllık</option>
                <option value="GECICI" style={SECENEK}>Yalnız geçici vergi dönemleri</option>
              </select>
            </Alan>
            <Alan label="Açıklama (isteğe bağlı)" genis><textarea value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} placeholder="Bu kural neden var, bulgu çıkınca ne yapılmalı?" rows={2} className="w-full rounded-md px-3 py-2 text-sm" style={GIRDI} /></Alan>
          </div>
          <div className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: 'rgba(91,141,239,.08)', border: '1px solid rgba(91,141,239,.2)', color: 'rgba(250,250,249,.85)' }}>
            <span style={{ color: MUTED }}>Kural: </span>{kuralCumlesi(form)} <span style={{ color: MUTED }}>→</span> <span style={{ color: sevColor(form.seviye) }}>{sevLabel(form.seviye)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={vazgec} className="h-9 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5" style={{ background: 'rgba(255,255,255,.06)', color: 'rgba(250,250,249,.8)', border: `1px solid ${BORDER}` }}><XCircle size={13} /> Vazgeç</button>
            <button onClick={kaydet} disabled={kaydetMut.isPending} className="h-9 px-4 rounded-md text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: NAVY, color: '#0b1220' }}><CheckCircle2 size={13} /> Kaydet</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="px-4 py-3 text-xs" style={{ color: MUTED }}>Yükleniyor…</div>
      ) : kurallar.length === 0 ? (
        <div className="px-4 py-3 text-xs" style={{ color: MUTED }}>Henüz ofis kuralı yok. Örnek: "500 hesabında mizan bakiyesi yoksa → Uyarı".</div>
      ) : (
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {kurallar.map((k) => {
            const renk = sevColor(k.seviye);
            return (
              <div key={k.id} className="px-4 py-3 flex items-start gap-3" style={{ borderColor: BORDER, opacity: k.aktif ? 1 : 0.55 }}>
                <span className="text-[10px] font-extrabold tabular-nums px-2 py-0.5 rounded-md shrink-0 mt-0.5" style={{ background: `${renk}1f`, color: renk, border: `1px solid ${renk}40` }}>{sevLabel(k.seviye)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold" style={{ color: TEXT }}>{k.ad}</div>
                  <div className="text-[12px] mt-0.5" style={{ color: 'rgba(250,250,249,.7)' }}>{kuralCumlesi(k)}</div>
                  {k.aciklama && <div className="text-[11.5px] mt-0.5" style={{ color: MUTED }}>{k.aciklama}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => aktifMut.mutate({ id: k.id, aktif: !k.aktif })} disabled={aktifMut.isPending} className="h-8 px-3 rounded-md text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: k.aktif ? 'rgba(92,191,138,.12)' : 'rgba(255,255,255,.06)', color: k.aktif ? OK : 'rgba(250,250,249,.7)', border: `1px solid ${k.aktif ? 'rgba(92,191,138,.24)' : BORDER}` }} title={k.aktif ? 'Kuralı kapat' : 'Kuralı aç'}>
                    {k.aktif ? 'Aktif' : 'Pasif'}
                  </button>
                  <button onClick={() => duzenle(k)} className="h-8 w-8 rounded-md inline-flex items-center justify-center" style={{ background: 'rgba(255,255,255,.06)', color: 'rgba(250,250,249,.8)', border: `1px solid ${BORDER}` }} title="Düzenle"><Pencil size={13} /></button>
                  <button onClick={() => sil(k)} disabled={silMut.isPending} className="h-8 w-8 rounded-md inline-flex items-center justify-center disabled:opacity-50" style={{ background: 'rgba(255,255,255,.06)', color: 'rgba(250,250,249,.8)', border: `1px solid ${BORDER}` }} title="Sil"><Trash2 size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
