'use client';
import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { mizanApi } from '@/lib/mizan';
import { LucaInlineCaptchaPanel } from '@/components/luca/LucaInlineCaptchaPanel';
import { toast } from 'sonner';
import {
  Scale, CloudDownload, Loader2, Upload, Plus, Trash2, Calculator,
  AlertTriangle, Printer, FileSpreadsheet,
} from 'lucide-react';

/* 7582 / Seri:B Sıra No:20 — Tecil ve Taksitlendirme
 * Mevzuat: 6183/48 · 7582 sayılı Kanun · Seri:B Sıra No:20 Tahsilat Genel Tebliği
 * Hesabın tamamı sunucudaki saf motorda; bu ekran yalnız veri toplar ve gösterir. */

const GOLD = '#d4b876';
const SURFACE = '#181613';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Defter = 'BILANCO' | 'ISLETME' | 'DIGER';
type BorcSatiri = { vergiTuru: string; tutar: number; turElle?: string };

const TUR_ETIKET: Record<string, string> = {
  KDV_BSMV: 'KDV / BSMV',
  DIGER: 'Diğer',
  KAPSAM_DISI: 'Kapsam dışı',
  BELIRSIZ: 'Belirsiz',
};

export default function Yapilandirma7582Page() {
  const [taxpayerId, setTaxpayerId] = useState('');
  const [defter, setDefter] = useState<Defter>('BILANCO');
  const [statu, setStatu] = useState<'NORMAL' | 'BELEDIYE_VB'>('NORMAL');
  const [faalMi, setFaalMi] = useState(true);
  const [talepTarihi, setTalepTarihi] = useState(() => new Date().toISOString().slice(0, 10));

  // Likidite
  const [yil, setYil] = useState(new Date().getFullYear());
  const [ay, setAy] = useState(new Date().getMonth() + 1);
  const [lucaJobId, setLucaJobId] = useState<string | null>(null);
  const [likidite, setLikidite] = useState<any>(null);
  const [elle, setElle] = useState({ kasa: '', banka: '', alacak: '', borc: '' });

  // Borçlar
  const [satirlar, setSatirlar] = useState<BorcSatiri[]>([{ vergiTuru: '', tutar: 0 }]);
  const [sonuc, setSonuc] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);

  const mukellefler = useQuery({
    queryKey: ['taxpayers'],
    queryFn: () => api.get('/taxpayers').then((r) => r.data?.data ?? r.data ?? []),
  });

  // ——— Luca'dan taze mizan (kilitli Mizan modülünün kendi ucu) ———
  const mizanCek = useMutation({
    mutationFn: () =>
      mizanApi.fetchFromLucaAgent({
        mukellefId: taxpayerId,
        donem: `${yil}-${String(ay).padStart(2, '0')}`,
        donemTipi: 'AYLIK' as any,
      }),
    onSuccess: (d: any) => {
      setLucaJobId(d.jobId);
      toast.info('Luca job oluşturuldu · güvenlik kodu gerekirse burada açılacak', { duration: 5000 });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Luca job oluşturulamadı'),
  });

  const jobQuery = useQuery({
    queryKey: ['luca-job-7582', lucaJobId],
    queryFn: () => mizanApi.getLucaJob(lucaJobId!),
    enabled: !!lucaJobId,
    refetchInterval: 3000,
  });

  const job = (jobQuery.data as any)?.job;
  const mizanId = (jobQuery.data as any)?.mizan?.id;

  const likiditeHesapla = useMutation({
    mutationFn: (id: string) => api.post('/yapilandirma-7582/likidite', { mizanId: id }).then((r) => r.data),
    onSuccess: (d) => {
      setLikidite(d);
      if (d?.not) toast.warning(d.not);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Likidite hesaplanamadı'),
  });

  // Mizan geldiği anda oranı hesapla
  React.useEffect(() => {
    if (mizanId && !likidite) likiditeHesapla.mutate(mizanId);
  }, [mizanId]); // eslint-disable-line react-hooks/exhaustive-deps

  const elleOran = useMemo(() => {
    if (defter !== 'ISLETME') return null;
    const s = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;
    const payda = s(elle.borc);
    if (payda <= 0) return null;
    return (s(elle.kasa) + s(elle.banka) + s(elle.alacak)) / payda;
  }, [defter, elle]);

  const oran = defter === 'BILANCO' ? (likidite?.oran ?? null) : defter === 'ISLETME' ? elleOran : null;

  // ——— Excel ———
  const excelYukle = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/yapilandirma-7582/excel', fd).then((r) => r.data);
    },
    onSuccess: (d: any) => {
      const bas: string[] = d.basliklar || [];
      const turS = bas.find((b) => /vergi|tür|tur|borç|borc|açıklama/i.test(b));
      const tutarS = bas.find((b) => /tutar|bakiye|toplam|borç tutar/i.test(b));
      if (!turS || !tutarS) {
        toast.error(`Sütunlar tanınamadı. Bulunanlar: ${bas.join(', ')}`);
        return;
      }
      const yeni: BorcSatiri[] = (d.satirlar || [])
        .map((r: any) => ({
          vergiTuru: String(r[turS] ?? '').trim(),
          tutar: Number(String(r[tutarS] ?? '0').replace(/\./g, '').replace(',', '.')) || 0,
        }))
        .filter((r: BorcSatiri) => r.vergiTuru && r.tutar > 0);
      if (!yeni.length) return toast.error('Excel’de okunabilir borç satırı bulunamadı');
      setSatirlar(yeni);
      toast.success(`${yeni.length} satır okundu · sütunlar: "${turS}" / "${tutarS}"`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Excel okunamadı'),
  });

  const hesapla = useMutation({
    mutationFn: () =>
      api
        .post('/yapilandirma-7582/hesapla', {
          satirlar: satirlar.filter((s) => s.vergiTuru && s.tutar > 0),
          defter, statu, faalMi, oran, talepTarihi,
        })
        .then((r) => r.data),
    onSuccess: (d) => { setSonuc(d); setPlan(null); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Hesaplanamadı'),
  });

  const planCek = useMutation({
    mutationFn: (v: { tutar: number; taksitSayisi: number }) =>
      api.post('/yapilandirma-7582/plan', { ...v, talepTarihi }).then((r) => r.data),
    onSuccess: (d) => setPlan(d),
  });

  const kutu: React.CSSProperties = {
    background: SURFACE, border: '1px solid rgba(212,184,118,0.18)', borderRadius: 14, padding: 16,
  };
  const input: React.CSSProperties = {
    background: '#0f0d0b', border: '1px solid rgba(212,184,118,0.25)', borderRadius: 8,
    padding: '8px 10px', color: '#e8e2d5', width: '100%', fontSize: 14,
  };
  const etiket: React.CSSProperties = { fontSize: 12, color: '#9c937f', marginBottom: 4, display: 'block' };

  return (
    <div style={{ padding: 14, color: '#e8e2d5' }}>
      {/* Başlık — üst renk şeridi + radial parıltı + degrade ikon kutusu */}
      <div style={{ ...kutu, padding: 0, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: 3, background: `linear-gradient(90deg, ${GOLD}, #8b7649, transparent)` }} />
        <div
          style={{
            padding: 18,
            background:
              'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
            display: 'flex', alignItems: 'center', gap: 14,
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#1a1713',
          }}>
            <Scale size={22} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>7582 Tecil ve Taksitlendirme</div>
            <div style={{ fontSize: 12, color: '#9c937f' }}>
              Seri:B Sıra No:20 · yıllık %29 tecil faizi · son başvuru <b style={{ color: GOLD }}>31.08.2026</b>
            </div>
          </div>
        </div>
      </div>

      {/* 1) Mükellef ve durum */}
      <div style={{ ...kutu, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={etiket}>Mükellef</label>
            <select style={input} value={taxpayerId} onChange={(e) => { setTaxpayerId(e.target.value); setLikidite(null); setLucaJobId(null); }}>
              <option value="">— seçin —</option>
              {(mukellefler.data || []).map((m: any) => (
                <option key={m.id} value={m.id}>{m.companyName || `${m.firstName || ''} ${m.lastName || ''}`.trim()}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={etiket}>Defter türü</label>
            <select style={input} value={defter} onChange={(e) => setDefter(e.target.value as Defter)}>
              <option value="BILANCO">Bilanço esası</option>
              <option value="ISLETME">İşletme hesabı esası</option>
              <option value="DIGER">Diğer / defter tutmayan</option>
            </select>
          </div>
          <div>
            <label style={etiket}>Hukuki statü</label>
            <select style={input} value={statu} onChange={(e) => setStatu(e.target.value as any)}>
              <option value="NORMAL">Normal</option>
              <option value="BELEDIYE_VB">Belediye / il özel idaresi vb.</option>
            </select>
          </div>
          <div>
            <label style={etiket}>Tecil talep tarihi</label>
            <input style={input} type="date" value={talepTarihi} onChange={(e) => setTalepTarihi(e.target.value)} />
          </div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" checked={faalMi} onChange={(e) => setFaalMi(e.target.checked)} />
          16.06.2026 itibarıyla faal mükellefiyet kaydı var
        </label>
      </div>

      {/* 2) Likidite oranı */}
      <div style={{ ...kutu, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Likidite oranı</div>

        {defter === 'BILANCO' && (
          <>
            <div style={{ fontSize: 12, color: '#9c937f', marginBottom: 10 }}>
              Oran <b>(Dönen Varlıklar − Stoklar) ÷ Kısa Vadeli Yabancı Kaynaklar</b> formülüyle, Luca’dan
              çekilen <b>taze mizandan</b> hesaplanır. Mevzuat hangi dönemin esas alınacağını yazmıyor —
              dönemi siz seçiyorsunuz, kullanılan dönem çıktıda görünür.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ width: 110 }}>
                <label style={etiket}>Yıl</label>
                <input style={input} type="number" value={yil} onChange={(e) => setYil(Number(e.target.value))} />
              </div>
              <div style={{ width: 110 }}>
                <label style={etiket}>Ay</label>
                <input style={input} type="number" min={1} max={12} value={ay} onChange={(e) => setAy(Number(e.target.value))} />
              </div>
              <button
                onClick={() => { setLikidite(null); mizanCek.mutate(); }}
                disabled={!taxpayerId || mizanCek.isPending}
                style={{
                  background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#1a1713', border: 0,
                  borderRadius: 9, padding: '9px 14px', fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                {mizanCek.isPending ? <Loader2 size={16} className="animate-spin" /> : <CloudDownload size={16} />}
                Mizan Çek
              </button>
              {job && (
                <span style={{ fontSize: 12, color: '#9c937f' }}>
                  Job: {job.status}{job.error ? ` · ${String(job.error).slice(0, 80)}` : ''}
                </span>
              )}
            </div>
            {lucaJobId && <LucaInlineCaptchaPanel jobIds={[lucaJobId]} color={GOLD} />}
            {likidite && (
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {[
                  ['Dönen varlıklar', likidite.donenVarliklar],
                  ['Stoklar', likidite.stoklar],
                  ['KV yabancı kaynak', likidite.kisaVadeliYabanciKaynak],
                ].map(([b, v]: any) => (
                  <div key={b} style={{ background: '#0f0d0b', borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 11, color: '#9c937f' }}>{b}</div>
                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</div>
                  </div>
                ))}
                <div style={{ background: '#0f0d0b', borderRadius: 10, padding: 10, border: `1px solid ${GOLD}` }}>
                  <div style={{ fontSize: 11, color: '#9c937f' }}>Likidite oranı · {likidite.donem}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: GOLD }}>
                    {likidite.oran == null ? '—' : likidite.oran.toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {defter === 'ISLETME' && (
          <>
            <div style={{ fontSize: 12, color: '#9c937f', marginBottom: 10 }}>
              Oran <b>(Kasa + Banka + Kısa Vadeli Alacaklar) ÷ Kısa Vadeli Borçlar</b>. İşletme defterinde bu
              kalemler tutulmadığı için rakamlar <b>beyana</b> dayanır: kasa sayımı, banka ekstresi, tahsil
              edilmemiş faturalar/çek-senet, satıcı-kredi-vergi-SGK borçları. Belgelenebilir olmalı.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {([['kasa', 'Kasa'], ['banka', 'Banka'], ['alacak', 'Kısa vadeli alacaklar'], ['borc', 'Kısa vadeli borçlar']] as const).map(
                ([k, b]) => (
                  <div key={k}>
                    <label style={etiket}>{b}</label>
                    <input style={input} value={(elle as any)[k]} onChange={(e) => setElle({ ...elle, [k]: e.target.value })} placeholder="0" />
                  </div>
                ),
              )}
            </div>
            {elleOran != null && (
              <div style={{ marginTop: 10, fontSize: 14 }}>
                Likidite oranı: <b style={{ color: GOLD, fontSize: 18 }}>{elleOran.toFixed(2)}</b>
              </div>
            )}
          </>
        )}

        {defter === 'DIGER' && (
          <div style={{ fontSize: 13, color: '#9c937f' }}>
            Bilanço ya da işletme hesabı esasına göre defter tutmayan borçlularda oran hesaplanmaz;
            borçlar <b style={{ color: GOLD }}>48 eşit taksitte</b> ödenir.
          </div>
        )}
      </div>

      {/* 3) Borçlar */}
      <div style={{ ...kutu, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 600 }}>Borçlar</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={dosyaRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) excelYukle.mutate(f); e.target.value = ''; }}
            />
            <button
              onClick={() => dosyaRef.current?.click()}
              style={{ background: '#0f0d0b', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}
            >
              {excelYukle.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
              Excel yükle
            </button>
            <button
              onClick={() => setSatirlar([...satirlar, { vergiTuru: '', tutar: 0 }])}
              style={{ background: '#0f0d0b', border: '1px solid rgba(212,184,118,0.3)', color: '#e8e2d5', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}
            >
              <Plus size={15} /> Satır
            </button>
          </div>
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {satirlar.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 32px', gap: 8, marginBottom: 6 }}>
              <input
                style={input} placeholder="Vergi türü (örn. KATMA DEĞER VERGİSİ)" value={s.vergiTuru}
                onChange={(e) => { const y = [...satirlar]; y[i] = { ...s, vergiTuru: e.target.value }; setSatirlar(y); }}
              />
              <input
                style={{ ...input, textAlign: 'right' }} placeholder="0,00" value={s.tutar || ''}
                onChange={(e) => { const y = [...satirlar]; y[i] = { ...s, tutar: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 }; setSatirlar(y); }}
              />
              <button
                onClick={() => setSatirlar(satirlar.filter((_, j) => j !== i))}
                style={{ background: 'transparent', border: 0, color: '#8a6a6a', cursor: 'pointer' }}
              ><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button
          onClick={() => hesapla.mutate()}
          disabled={hesapla.isPending || !satirlar.some((s) => s.vergiTuru && s.tutar > 0)}
          style={{
            marginTop: 10, background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#1a1713',
            border: 0, borderRadius: 9, padding: '10px 16px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {hesapla.isPending ? <Loader2 size={16} className="animate-spin" /> : <Calculator size={16} />}
          Taksit seçeneklerini hesapla
        </button>
      </div>

      {/* 4) Sonuç */}
      {sonuc && (
        <div style={{ ...kutu }}>
          {sonuc.uyarilar?.map((u: string, i: number) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'start', background: 'rgba(180,120,60,0.12)', border: '1px solid rgba(212,140,60,0.35)', borderRadius: 10, padding: 10, marginBottom: 8, fontSize: 13 }}>
              <AlertTriangle size={16} style={{ color: '#d9964a', flexShrink: 0, marginTop: 2 }} />
              <span>{u}</span>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
            <span>Tecil edilebilir toplam: <b style={{ color: GOLD }}>{fmt(sonuc.tecilEdilebilirToplam)} ₺</b></span>
            <span>Tecil faizi: <b>%{sonuc.tecilFaiziYillik}</b></span>
            {sonuc.teminatGerekli > 0 && <span>Teminat: <b style={{ color: '#d9964a' }}>{fmt(sonuc.teminatGerekli)} ₺</b></span>}
          </div>

          {sonuc.paketler.map((p: any) => (
            <div key={p.grup} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {p.grupAdi} · {fmt(p.tutar)} ₺
                <span style={{ color: '#9c937f', fontWeight: 400, fontSize: 12, marginLeft: 8 }}>{p.gerekce}</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#9c937f', textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Taksit</th>
                      <th style={{ padding: '6px 8px' }}>İlk taksit</th>
                      <th style={{ padding: '6px 8px' }}>Aylık</th>
                      <th style={{ padding: '6px 8px' }}>Toplam faiz</th>
                      <th style={{ padding: '6px 8px' }}>Faiz yükü</th>
                      <th style={{ padding: '6px 8px' }}>Toplam ödeme</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {p.secenekler.map((s: any) => (
                      <tr key={s.taksitSayisi} style={{ borderTop: '1px solid rgba(212,184,118,0.12)', textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>
                          {s.taksitSayisi} ay
                          {s.taksitSayisi === p.azamiTaksit && <span style={{ color: GOLD, fontSize: 11 }}> (azami)</span>}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{fmt(s.ilkTaksit)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmt(s.aylikTaksit)}</td>
                        <td style={{ padding: '6px 8px' }}>{fmt(s.toplamFaiz)}</td>
                        <td style={{ padding: '6px 8px', color: '#9c937f' }}>%{s.faizYuku}</td>
                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{fmt(s.toplamOdeme)}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <button
                            onClick={() => planCek.mutate({ tutar: p.tutar, taksitSayisi: s.taksitSayisi })}
                            style={{ background: 'transparent', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 7, padding: '3px 9px', fontSize: 12, cursor: 'pointer' }}
                          >Plan</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!p.secenekler.length && (
                <div style={{ fontSize: 13, color: '#d9964a' }}>Taksit sayısı belirlenemedi — {p.gerekce}</div>
              )}
            </div>
          ))}

          {plan && (
            <div style={{ marginTop: 6, borderTop: '1px solid rgba(212,184,118,0.18)', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>
                  Ödeme planı · {plan.taksitSayisi} taksit · toplam {fmt(plan.toplamOdeme)} ₺
                </div>
                <button
                  onClick={() => window.print()}
                  style={{ background: '#0f0d0b', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}
                ><Printer size={15} /> Yazdır</button>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#9c937f', textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>#</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Vade</th>
                      <th style={{ padding: '6px 8px' }}>Anapara</th>
                      <th style={{ padding: '6px 8px' }}>Gün</th>
                      <th style={{ padding: '6px 8px' }}>Tecil faizi</th>
                      <th style={{ padding: '6px 8px' }}>Ödenecek</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {plan.satirlar.map((s: any) => (
                      <tr key={s.sira} style={{ borderTop: '1px solid rgba(212,184,118,0.10)', textAlign: 'right' }}>
                        <td style={{ textAlign: 'left', padding: '5px 8px' }}>{s.sira}</td>
                        <td style={{ textAlign: 'left', padding: '5px 8px' }}>
                          {new Date(s.vade).toLocaleDateString('tr-TR')}
                        </td>
                        <td style={{ padding: '5px 8px' }}>{fmt(s.anapara)}</td>
                        <td style={{ padding: '5px 8px', color: '#9c937f' }}>{s.gun}</td>
                        <td style={{ padding: '5px 8px' }}>{fmt(s.tecilFaizi)}</td>
                        <td style={{ padding: '5px 8px', fontWeight: 600 }}>{fmt(s.odenecek)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sonuc.kapsamDisi?.tutar > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#9c937f' }}>
              Kapsam dışı ({TUR_ETIKET.KAPSAM_DISI}): {fmt(sonuc.kapsamDisi.tutar)} ₺ —
              {' '}{sonuc.kapsamDisi.satirlar.map((s: any) => s.vergiTuru).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
