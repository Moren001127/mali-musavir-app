'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor,
  MonitorOff,
  Map as MapIcon,
  Scale,
  GraduationCap,
  Trash2,
  ChevronDown,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { getLucaOperatorDurum, deleteLucaRule, getLucaSkills, deleteLucaSkill } from '@/lib/moren-ai';

const ACCENT = '#d4b876';

/** Katlanabilir bölüm — başlık + sayaç; açık/kapalı durumu kullanıcıda. */
function Bolum({
  ikon,
  baslik,
  sayi,
  varsayilanAcik = false,
  children,
}: {
  ikon: React.ReactNode;
  baslik: string;
  sayi?: number;
  varsayilanAcik?: boolean;
  children: React.ReactNode;
}) {
  const [acik, setAcik] = useState(varsayilanAcik);
  return (
    <div className="border-b last:border-b-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <button
        onClick={() => setAcik((a) => !a)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span style={{ color: ACCENT }}>{ikon}</span>
        <span className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: 'rgba(250,250,249,0.82)' }}>
          {baslik}
        </span>
        {typeof sayi === 'number' && (
          <span
            className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
            style={{ background: `${ACCENT}1f`, color: ACCENT }}
          >
            {sayi}
          </span>
        )}
        <ChevronDown
          size={14}
          className="ml-auto transition-transform"
          style={{ color: 'rgba(250,250,249,0.35)', transform: acik ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </button>
      {acik && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/**
 * Luca Operatörü yan paneli — durum, öğrendiği menü haritaları, ofis kuralları,
 * beceriler ve kısa yetenek notu TEK sütunda. Ekranın ana alanı sohbete kalsın.
 */
export function LucaYanPanel() {
  const qc = useQueryClient();
  const { data: durum } = useQuery({
    queryKey: ['luca-operator-durum'],
    queryFn: getLucaOperatorDurum,
    refetchInterval: 20000,
    staleTime: 10000,
  });
  const { data: beceriler = [] } = useQuery({
    queryKey: ['luca-skills'],
    queryFn: getLucaSkills,
    staleTime: 30000,
  });

  const kuralSil = useMutation({
    mutationFn: (id: string) => deleteLucaRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['luca-operator-durum'] }),
    onError: () => toast.error('Kural silinemedi'),
  });
  const beceriSil = useMutation({
    mutationFn: (id: string) => deleteLucaSkill(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['luca-skills'] }),
    onError: () => toast.error('Beceri silinemedi'),
  });

  const acik = durum?.tarayici?.acik === true;
  const haritalar = durum?.haritalar || [];
  const kurallar = durum?.kurallar || [];

  return (
    <aside
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl"
      style={{
        background: 'linear-gradient(180deg, rgba(24,20,12,0.72), rgba(10,9,7,0.72))',
        border: `1px solid ${ACCENT}1f`,
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Durum — panelin tepesinde, katlanmaz (en kritik bilgi) */}
      <div
        className="flex flex-shrink-0 items-start gap-2.5 px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={
            acik
              ? { background: 'rgba(52,211,153,0.14)', color: '#86efac' }
              : { background: 'rgba(248,113,113,0.12)', color: '#fca5a5' }
          }
        >
          {acik ? <Monitor size={14} /> : <MonitorOff size={14} />}
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: acik ? '#86efac' : '#fca5a5' }}>
            {acik ? 'Operatör tarayıcısı açık' : 'Operatör tarayıcısı kapalı'}
          </div>
          <div className="text-[11px] leading-snug" style={{ color: 'rgba(250,250,249,0.45)' }}>
            {acik
              ? 'Komut verebilirsin; işi kendi penceresinde yapar.'
              : 'Bilgisayarında operator-baslat.bat çalıştır.'}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Bolum ikon={<MapIcon size={13} />} baslik="Öğrendiği Menüler" sayi={haritalar.length}>
          {haritalar.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Henüz yok — &quot;Luca menüsünü keşfet&quot; de, kendi çıkarsın.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {haritalar.map((h) => (
                <div
                  key={h.baslik}
                  className="rounded-lg px-2.5 py-1.5"
                  style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="truncate text-[11px]" style={{ color: 'rgba(250,250,249,0.8)' }}>
                    {h.baslik}
                  </div>
                  <div className="text-[10px]" style={{ color: ACCENT }}>
                    {h.basliksayisi} başlık
                  </div>
                </div>
              ))}
            </div>
          )}
        </Bolum>

        <Bolum ikon={<Scale size={13} />} baslik="Ofis Kuralları" sayi={kurallar.length} varsayilanAcik>
          {kurallar.length === 0 ? (
            <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Sohbette bir çalışma kuralı söyle; kendiliğinden kaydeder ve bir daha sormaz.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {kurallar.map((k) => (
                <div
                  key={k.id}
                  className="group flex items-start gap-2 rounded-lg px-2.5 py-2"
                  style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold" style={{ color: '#fafaf9' }}>
                      {k.baslik}
                    </div>
                    <div className="text-[11px] leading-snug" style={{ color: 'rgba(250,250,249,0.55)' }}>
                      {k.kural}
                    </div>
                  </div>
                  <button
                    onClick={() => kuralSil.mutate(k.id)}
                    className="flex-shrink-0 rounded p-1 opacity-60 transition hover:bg-white/10 hover:opacity-100"
                    title="Kuralı sil"
                    style={{ color: 'rgba(248,113,113,0.8)' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Bolum>

        <Bolum ikon={<GraduationCap size={13} />} baslik="Öğrendiği İşler" sayi={beceriler.length}>
          {beceriler.length === 0 ? (
            <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(250,250,249,0.45)' }}>
              Bir işi yaptır, sonra &quot;bunu kaydet&quot; de; bir daha adım adım anlatmana gerek kalmaz.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {beceriler.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                  style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold" style={{ color: '#fafaf9' }}>
                      {b.ad}
                    </div>
                    <div className="text-[10px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
                      {b.adimSayisi} adım
                    </div>
                  </div>
                  <button
                    onClick={() => beceriSil.mutate(b.id)}
                    className="flex-shrink-0 rounded p-1 opacity-60 transition hover:bg-white/10 hover:opacity-100"
                    title="Beceriyi sil"
                    style={{ color: 'rgba(248,113,113,0.8)' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Bolum>

        <Bolum ikon={<Info size={13} />} baslik="Nasıl Çalışır">
          <ul className="flex flex-col gap-1.5 text-[11px] leading-snug" style={{ color: 'rgba(250,250,249,0.6)' }}>
            <li>Senin bilgisayarında kendi Chrome penceresini açar; günlük tarayıcına karışmaz.</li>
            <li>Luca menüsünü kendi keşfeder, ekranı bulup açar, okur ve doldurur.</li>
            <li>Bilmediği işi önce ekrandan ve geçen dönemin kaydından öğrenmeye çalışır.</li>
            <li>
              <b style={{ color: 'rgba(250,250,249,0.85)' }}>Gönder / Kaydet / Onayla / Tahakkuk</b> adımında durur,
              ne yapacağını özetler ve onayını bekler.
            </li>
          </ul>
        </Bolum>
      </div>
    </aside>
  );
}
