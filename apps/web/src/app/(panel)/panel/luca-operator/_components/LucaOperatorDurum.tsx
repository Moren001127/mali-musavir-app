'use client';

import { useQuery } from '@tanstack/react-query';
import { Monitor, MonitorOff, Map } from 'lucide-react';
import { getLucaOperatorDurum } from '@/lib/moren-ai';

const ACCENT = '#d4b876';

/**
 * Operatör tarayıcısı açık mı + Luca'da öğrendiği menü haritaları.
 * Kullanıcı ajanı açmayı unutursa komut zaman aşımına uğruyor; burada
 * doğrudan görünsün diye ekranın üstünde duruyor.
 */
export function LucaOperatorDurum() {
  const { data } = useQuery({
    queryKey: ['luca-operator-durum'],
    queryFn: getLucaOperatorDurum,
    refetchInterval: 20000,
    staleTime: 10000,
  });

  const acik = data?.tarayici?.acik === true;
  const haritalar = data?.haritalar || [];

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
        style={
          acik
            ? { background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.32)', color: '#86efac' }
            : { background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#fca5a5' }
        }
        title={
          acik
            ? `Operatör tarayıcısı çalışıyor (${data?.tarayici?.cihaz || ''}) — komut verebilirsin.`
            : 'Operatör tarayıcısı kapalı. Bilgisayarında operator-baslat.bat dosyasını çalıştır.'
        }
      >
        {acik ? <Monitor size={12} /> : <MonitorOff size={12} />}
        {acik ? 'Operatör tarayıcısı açık' : 'Operatör tarayıcısı kapalı'}
      </span>

      {haritalar.map((h) => (
        <span
          key={h.baslik}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
          style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}33`, color: 'rgba(250,250,249,0.75)' }}
          title="Operatörün Luca'da kendi keşfettiği menü haritası"
        >
          <Map size={12} style={{ color: ACCENT }} />
          {h.baslik} · {h.basliksayisi} başlık
        </span>
      ))}

      {!haritalar.length && (
        <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>
          Menü haritası yok — &quot;Luca menüsünü keşfet&quot; de, kendi çıkarsın.
        </span>
      )}
    </div>
  );
}
