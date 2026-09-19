'use client';
import { portalStyle } from '@/lib/portal-theme';


/**
 * Görevler & Notlar — "sakin komuta merkezi" düzeni (2026-09-14 yeniden tasarım).
 * Tek sütun: başlık (korundu) → hap sayaç şeridi → akıllı giriş satırı → görünüm sekmeleri + süzgeçler → içerik.
 * Veri: GET /tasks/ajanda (görevler + notlar + ekip istekleri + sayaçlar) — tek çağrı. Mali Takvim kalemleri bu ekranda
 * GÖSTERİLMEZ (Muzaffer Bey 2026-09-14: "mali takvimi görevler alanından kaldır, göz yoruyor"); arka uç yine döndürür, yok sayılır.
 * Bu dosya yalnız veri kabuğu + düzen; parçalar _components/ altında.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Inbox, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { isoGun, tasksApi, type AjandaResponse, type CreateTaskInput, type Task, type TaskStatus, type TopluInput, type UpdateTaskInput } from '@/lib/tasks';
import { BosDurum } from '../ekip/_components/Kart';
import { AkilliGiris } from './_components/AkilliGiris';
import { AracCubugu, type Gorunum, type Suzgecler } from './_components/AracCubugu';
import { DetayPaneli } from './_components/DetayPaneli';
import { HataDurumu, Iskelet } from './_components/Durumlar';
import type { GorevEylemleri } from './_components/eylemler';
import { GorevTablosu } from './_components/GorevTablosu';
import { KanbanGorunumu } from './_components/KanbanGorunumu';
import { MukellefeGoreGorunumu } from './_components/MukellefeGoreGorunumu';
import { NotlarBolumu } from './_components/NotlarBolumu';
import { SayacSeridi, type SayacAnahtari } from './_components/SayacSeridi';
import { TakvimGorunumu, type TakvimModu } from './_components/TakvimGorunumu';
import { TopluSerit } from './_components/TopluSerit';
import type { MukellefSecenek } from './_components/akilli-giris';
import { EKIP_RENK, GOLD, GOLD_SOFT, GRUPLAR, gorevGrubu, vadeIso, type Satir, type SatirGrubu } from './_components/ortak';

const DEPO_GORUNUM = 'gorevler.gorunum';
const BOS_SUZGEC: Suzgecler = { kategori: '', oncelik: '', kaynak: '', mukellefId: '', arama: '' };

function hataMesaji(e: any, varsayilan: string): string {
  const m = e?.response?.data?.message || e?.message || '';
  if (!m || /network error/i.test(m)) return m ? 'Sunucuya ulaşılamadı' : varsayilan;
  if (/timeout/i.test(m)) return 'Sunucu zamanında yanıt vermedi';
  return Array.isArray(m) ? m.join(', ') : String(m);
}

export default function GorevlerPage() {
  const qc = useQueryClient();

  // ── Görünüm / süzgeç durumu ──
  const [gorunum, setGorunumState] = useState<Gorunum>('ajanda');
  const [sayac, setSayac] = useState<SayacAnahtari>('acik');
  const [suzgec, setSuzgec] = useState<Suzgecler>(BOS_SUZGEC);
  const [aramaGecikmeli, setAramaGecikmeli] = useState('');
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [detay, setDetay] = useState<{ id: string | null; taslak?: Partial<CreateTaskInput> } | null>(null);
  const [takvimAy, setTakvimAy] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [takvimMod, setTakvimMod] = useState<TakvimModu>('ay');
  const [seciliGun, setSeciliGun] = useState(() => isoGun(new Date()));

  useEffect(() => {
    try {
      const g = window.localStorage.getItem(DEPO_GORUNUM) as Gorunum | null;
      if (g && ['ajanda', 'kanban', 'takvim', 'mukellef'].includes(g)) setGorunumState(g);
    } catch {
      /* depo yoksa varsayılan */
    }
    // Derin bağlantı (mükellef kartı → "Görevler'de aç"): ?mukellef=<id> süzgeci kilitler, ?gorev=<id> detayı açar.
    try {
      const sp = new URLSearchParams(window.location.search);
      const mukellef = sp.get('mukellef');
      const gorev = sp.get('gorev');
      if (mukellef) setSuzgec((f) => ({ ...f, mukellefId: mukellef }));
      if (gorev) setDetay({ id: gorev });
    } catch {
      /* sunucu tarafı / eski tarayıcı */
    }
  }, []);
  const setGorunum = useCallback((g: Gorunum) => {
    setGorunumState(g);
    setSecili(new Set());
    try {
      window.localStorage.setItem(DEPO_GORUNUM, g);
    } catch {
      /* sessiz */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setAramaGecikmeli(suzgec.arama.trim()), 300);
    return () => clearTimeout(t);
  }, [suzgec.arama]);

  const gun = 45; // ajanda penceresi (Mali Takvim ekranda gösterilmediği için sabit)

  // ── Veri ──
  const ajandaParams = useMemo(
    () => ({
      taxpayerId: suzgec.mukellefId || undefined,
      category: suzgec.kategori || undefined,
      priority: suzgec.oncelik || undefined,
      kaynak: suzgec.kaynak || undefined,
      search: aramaGecikmeli || undefined,
      gun,
    }),
    [suzgec.mukellefId, suzgec.kategori, suzgec.oncelik, suzgec.kaynak, aramaGecikmeli, gun],
  );
  const ajandaQ = useQuery<AjandaResponse>({
    queryKey: ['gorevler-ajanda', ajandaParams],
    queryFn: () => tasksApi.ajanda(ajandaParams),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const bitenlerQ = useQuery({
    queryKey: ['gorevler-bitenler', ajandaParams],
    queryFn: () =>
      tasksApi.list({
        status: 'DONE',
        isTemplate: 'false',
        limit: 100,
        taxpayerId: ajandaParams.taxpayerId,
        category: ajandaParams.category,
        priority: ajandaParams.priority,
        search: ajandaParams.search,
      }),
    enabled: gorunum === 'kanban',
    placeholderData: keepPreviousData,
  });
  const { data: mukellefler = [] } = useQuery<MukellefSecenek[]>({
    queryKey: ['taxpayers-options'],
    queryFn: () => api.get('/taxpayers').then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
    staleTime: 5 * 60_000,
  });

  const veri = ajandaQ.data;
  const gorevler = useMemo(() => veri?.gorevler || [], [veri]);
  const notlar = useMemo(() => veri?.notlar || [], [veri]);
  const istekler = useMemo(() => veri?.ekipIstekler || [], [veri]);

  const yenile = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['gorevler-ajanda'] });
    qc.invalidateQueries({ queryKey: ['gorevler-bitenler'] });
    qc.invalidateQueries({ queryKey: ['gorevler-detay'] });
    qc.invalidateQueries({ queryKey: ['task-counts'] });
  }, [qc]);

  // ── Eylemler (tek sözleşme; satır / kart / panel hepsi bunu kullanır) ──
  const eylemler = useMemo<GorevEylemleri>(() => {
    const calistir = async (is: () => Promise<unknown>, basari: string, hata: string) => {
      try {
        await is();
        toast.success(basari);
        yenile();
      } catch (e: any) {
        toast.error(hataMesaji(e, hata));
        throw e;
      }
    };
    return {
      ac: (id) => setDetay({ id }),
      tamamla: (id) => void calistir(() => tasksApi.complete(id), 'Görev tamamlandı', 'Tamamlanamadı').catch(() => undefined),
      yenidenAc: (id) => void calistir(() => tasksApi.update(id, { status: 'OPEN' }), 'Görev yeniden açıldı', 'Açılamadı').catch(() => undefined),
      baslat: (id) => void calistir(() => tasksApi.update(id, { status: 'IN_PROGRESS' }), 'Görev başlatıldı (Sürüyor)', 'Başlatılamadı').catch(() => undefined),
      iptal: (id) => void calistir(() => tasksApi.update(id, { status: 'CANCELLED' }), 'Görev iptal edildi', 'İptal edilemedi').catch(() => undefined),
      sil: (id) => {
        setDetay((d) => (d?.id === id ? null : d));
        setSecili((s) => {
          if (!s.has(id)) return s;
          const y = new Set(s);
          y.delete(id);
          return y;
        });
        void calistir(() => tasksApi.remove(id), 'Kayıt silindi', 'Silinemedi').catch(() => undefined);
      },
      ertele: (id, gunIso) => void calistir(() => tasksApi.snooze(id, vadeIso(gunIso) as string), `Ertelendi · ${new Date(`${gunIso}T00:00:00`).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}`, 'Ertelenemedi').catch(() => undefined),
      notEkle: (id, icerik) => calistir(() => tasksApi.addNote(id, icerik), 'Not eklendi', 'Not eklenemedi'),
      sabitle: (id, pinned) => void calistir(() => tasksApi.update(id, { pinned }), pinned ? 'Üste sabitlendi' : 'Sabitleme kaldırıldı', 'Değiştirilemedi').catch(() => undefined),
      durumDegistir: (id, status: TaskStatus) => void calistir(() => tasksApi.update(id, { status }), 'Durum güncellendi', 'Güncellenemedi').catch(() => undefined),
      ekibeVer: async (id, canli) => {
        const r = await tasksApi.ekibeVer(id, canli);
        if (r.ok) {
          toast.success(canli ? 'Ekibe verildi (canlı)' : 'Ekibe verildi (kuru test)', { description: r.isId ? `İş ${r.isId} — sonuç notlara düşecek` : undefined });
          yenile();
        } else toast.error(r.error || 'Ekip başlatılamadı');
        return r;
      },
      istekKapat: (id) => void calistir(() => tasksApi.ekipIstekKapat(id), 'İstek kapatıldı (yapıldı)', 'Kapatılamadı').catch(() => undefined),
    };
  }, [yenile]);

  const hizliEkle = useCallback(
    async (girdi: CreateTaskInput) => {
      try {
        const t = await tasksApi.create(girdi);
        toast.success(girdi.tur === 'NOT' ? 'Not kaydedildi' : 'Görev eklendi', { description: t?.title });
        yenile();
      } catch (e: any) {
        toast.error(hataMesaji(e, 'Kayıt eklenemedi'));
        throw e;
      }
    },
    [yenile],
  );

  const panelKaydet = useCallback(
    async (id: string | null, dto: CreateTaskInput | UpdateTaskInput): Promise<Task> => {
      try {
        const t = id ? await tasksApi.update(id, dto as UpdateTaskInput) : await tasksApi.create(dto as CreateTaskInput);
        toast.success(id ? 'Kaydedildi' : 'Oluşturuldu');
        yenile();
        if (!id && t?.id) setDetay({ id: t.id });
        return t;
      } catch (e: any) {
        toast.error(hataMesaji(e, 'Kaydedilemedi'));
        throw e;
      }
    },
    [yenile],
  );

  const topluIslem = useCallback(
    async (dto: Omit<TopluInput, 'ids'>) => {
      const ids = [...secili];
      try {
        const r = await tasksApi.toplu({ ids, ...dto });
        toast.success(`${r.etkilenen} kayıt güncellendi`);
        setSecili(new Set());
        yenile();
      } catch (e: any) {
        toast.error(hataMesaji(e, 'Toplu işlem yapılamadı'));
      }
    },
    [secili, yenile],
  );

  // ── Seçim ──
  const sec = useCallback((id: string, v: boolean) => {
    setSecili((s) => {
      const y = new Set(s);
      if (v) y.add(id);
      else y.delete(id);
      return y;
    });
  }, []);
  const grupSec = useCallback((ids: string[], v: boolean) => {
    setSecili((s) => {
      const y = new Set(s);
      for (const id of ids) (v ? y.add(id) : y.delete(id));
      return y;
    });
  }, []);

  // ── Sayaç hapına göre süzülmüş görevler (istemci tarafı) ──
  const suzulmusGorevler = useMemo(() => {
    if (sayac === 'acik') return gorevler;
    if (sayac === 'istek' || sayac === 'not') return [] as Task[];
    return gorevler.filter((t) => {
      const g = gorevGrubu(t);
      if (sayac === 'bugun') return g === 'today';
      if (sayac === 'gecikmis') return g === 'overdue';
      return g === 'today' || g === 'tomorrow' || g === 'thisWeek';
    });
  }, [gorevler, sayac]);

  // ── Ajanda grupları: Gecikmiş · Bugün · Yarın · Bu hafta · Sonra · Tarihsiz (+ ekip istekleri Bugün'de) ──
  const ajandaGruplari = useMemo<SatirGrubu[]>(() => {
    if (sayac === 'istek') return [{ key: 'istek', ad: 'Sizden istenen', renk: EKIP_RENK, satirlar: istekler.map((i) => ({ tip: 'istek' as const, istek: i })) }];
    const kutular = new Map<string, Satir[]>(GRUPLAR.map((g) => [g.key, [] as Satir[]]));
    if (sayac === 'acik') for (const i of istekler) kutular.get('today')!.push({ tip: 'istek', istek: i });
    for (const t of suzulmusGorevler) kutular.get(gorevGrubu(t))!.push({ tip: 'gorev', gorev: t });
    return GRUPLAR.map((g) => ({ key: g.key, ad: g.ad, renk: g.renk, satirlar: kutular.get(g.key) || [] }));
  }, [suzulmusGorevler, istekler, sayac]);

  const bosMetin: Record<SayacAnahtari, string> = {
    acik: 'Açık görev yok — üstteki satırdan ekleyin',
    bugun: 'Bugün için görev yok',
    gecikmis: 'Gecikmiş görev yok',
    buHafta: 'Bu hafta için görev yok',
    istek: 'Ekipten bekleyen istek yok',
    not: 'Not yok',
  };

  const notlarGorunur = sayac === 'acik' || sayac === 'not';
  const tabloGorunur = sayac !== 'not';

  const icerik = () => {
    if (ajandaQ.isError && !veri) return <HataDurumu mesaj={hataMesaji(ajandaQ.error, 'Sunucuya ulaşılamadı')} onTekrar={() => ajandaQ.refetch()} deneniyor={ajandaQ.isFetching} />;
    if (!veri) return <Iskelet />;
    if (gorunum === 'kanban') return <KanbanGorunumu gorevler={suzulmusGorevler} bitenler={bitenlerQ.data?.items || []} bitenlerYukleniyor={bitenlerQ.isLoading} eylemler={eylemler} acikId={detay?.id} />;
    if (gorunum === 'takvim')
      return (
        <TakvimGorunumu
          gorevler={gorevler}
          ay={takvimAy}
          onAy={setTakvimAy}
          mod={takvimMod}
          onMod={setTakvimMod}
          seciliGun={seciliGun}
          onSeciliGun={setSeciliGun}
          eylemler={eylemler}
          secili={secili}
          onSec={sec}
          onGrupSec={grupSec}
          acikId={detay?.id}
        />
      );
    if (gorunum === 'mukellef') return <MukellefeGoreGorunumu gorevler={suzulmusGorevler} istekler={sayac === 'acik' || sayac === 'istek' ? istekler : []} eylemler={eylemler} secili={secili} onSec={sec} onGrupSec={grupSec} acikId={detay?.id} />;
    return (
      <div className="flex flex-col gap-3">
        {tabloGorunur && (
          <GorevTablosu
            gruplar={ajandaGruplari}
            secili={secili}
            onSec={sec}
            onGrupSec={grupSec}
            eylemler={eylemler}
            acikId={detay?.id}
            bos={<BosDurum ikon={sayac === 'istek' ? <Inbox size={18} /> : <CheckSquare size={18} />} metin={bosMetin[sayac]} renk={sayac === 'istek' ? EKIP_RENK : GOLD} />}
          />
        )}
        {notlarGorunur && <NotlarBolumu notlar={notlar} eylemler={eylemler} acikId={detay?.id} />}
      </div>
    );
  };

  return (
    <div className="space-y-3 max-w-none">
      <header
        className="relative overflow-hidden rounded-[18px] border px-5 py-4"
        style={portalStyle({
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(212,184,118,0.16), transparent 46%), radial-gradient(120% 140% at 100% 0%, rgba(139,118,73,0.12), transparent 48%), #0f0d0b',
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 16px 42px rgba(0,0,0,0.28)',
        })}
      >
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={portalStyle({ background: 'linear-gradient(90deg, #8b7649, #b8a06f, #d4b876, #e7cf95, #d4b876, #b8a06f)' })}
        />
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-px w-[26px]" style={portalStyle({ background: GOLD })} />
          <span className="text-[10px] font-bold uppercase tracking-[.18em]" style={portalStyle({ color: GOLD_SOFT })}>Ofis Takip</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              className="grid shrink-0 place-items-center rounded-xl"
              style={portalStyle({
                width: 46,
                height: 46,
                background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`,
                boxShadow: '0 8px 22px rgba(212,184,118,0.30)',
              })}
            >
              <CheckSquare size={24} style={portalStyle({ color: '#1a1410' })} />
            </span>
            <div className="min-w-0">
              <h1 style={portalStyle({ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em', lineHeight: 1.05 })}>
                Görevler & Notlar
              </h1>
              <p className="mt-2 text-[13px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.48)' })}>
                Tek seferlik veya tekrarlı hatırlatmalar — vade geldiğinde sistem bildirim atar
              </p>
            </div>
          </div>
          <button
            onClick={() => setDetay({ id: null, taslak: { taxpayerId: suzgec.mukellefId || undefined } })}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-4 text-[12.5px] font-bold transition-all"
            style={portalStyle({ background: `linear-gradient(135deg, ${GOLD}, ${GOLD_SOFT})`, color: '#0f0d0b', boxShadow: '0 10px 24px rgba(212,184,118,0.16)' })}
          >
            <Plus size={14} /> Yeni Görev
          </button>
        </div>
      </header>

      {/* Hap sayaç şeridi — tıklanınca süzer */}
      <SayacSeridi sayaclar={veri?.sayaclar} aktif={sayac} onSec={(k) => setSayac((s) => (s === k && k !== 'acik' ? 'acik' : k))} />

      {/* Akıllı giriş satırı */}
      <AkilliGiris mukellefler={mukellefler} varsayilanMukellefId={suzgec.mukellefId || undefined} onEkle={hizliEkle} />

      {/* Görünüm sekmeleri + süzgeçler — ayrı ton (Muzaffer Bey: "Ajanda/Kanban başlıklarının arka planı farklı olsun, ayırt edici") */}
      <div className="rounded-xl px-3 py-2" style={portalStyle({ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.11)' })}>
        <AracCubugu gorunum={gorunum} onGorunum={setGorunum} suzgec={suzgec} onSuzgec={setSuzgec} mukellefler={mukellefler} />
      </div>

      {/* İçerik */}
      {icerik()}

      {/* Toplu işlem şeridi (seçim varken) */}
      <TopluSerit secili={[...secili]} onTemizle={() => setSecili(new Set())} onIslem={topluIslem} />

      {/* Detay paneli */}
      {detay && <DetayPaneli id={detay.id} taslak={detay.taslak} mukellefler={mukellefler} eylemler={eylemler} onKapat={() => setDetay(null)} onKaydet={panelKaydet} />}
    </div>
  );
}
