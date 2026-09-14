'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Save } from 'lucide-react';
import { toast } from 'sonner';
import { aylikOdemeApi, sonKosuMetni, type OtomatikAyar } from '@/lib/aylik-odeme';
import { AltinDugme, Anahtar, GIRDI, IKINCIL, KART, KartBaslik, KENAR_NOTR, METIN, SONUK } from './ortak';

const VARSAYILAN: OtomatikAyar = { aktif: false, gun: 20, saat: 9, onayGerekli: true, sonKosu: null };

/**
 * Otomatik gönderim kartı — Aktif · gün (1-28) · saat (0-23) · "Göndermeden önce onayımı iste" · son koşu · Kaydet (PUT).
 * Açıklama: her ayın seçilen günü/saatinde gönderilmemişlere gönderir; onay isteği açıksa önce WhatsApp'tan haber verir.
 */
export function OtomatikKart({ baslangic }: { baslangic?: OtomatikAyar | null }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['aylik-odeme-otomatik'], queryFn: aylikOdemeApi.otomatik, placeholderData: baslangic || undefined });
  const kaynak = data || baslangic || VARSAYILAN;
  const [form, setForm] = useState<OtomatikAyar>({ ...VARSAYILAN, ...kaynak });
  const [kirli, setKirli] = useState(false);

  // Sunucudan gelen değer değişince (ilk yükleme, başka sekmede kayıt) formu tazele — kullanıcı düzenlemediyse.
  useEffect(() => {
    if (!kirli) setForm({ ...VARSAYILAN, ...kaynak });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaynak.aktif, kaynak.gun, kaynak.saat, kaynak.onayGerekli, kaynak.sonKosu]);

  const kaydet = useMutation({
    mutationFn: () => aylikOdemeApi.otomatikKaydet({ aktif: !!form.aktif, gun: Number(form.gun), saat: Number(form.saat), onayGerekli: !!form.onayGerekli }),
    onSuccess: (r) => {
      setKirli(false);
      if (r && typeof r === 'object') qc.setQueryData(['aylik-odeme-otomatik'], { ...form, ...r });
      qc.invalidateQueries({ queryKey: ['aylik-odeme-otomatik'] });
      qc.invalidateQueries({ queryKey: ['aylik-odeme-ozet'] });
      toast.success(form.aktif ? `Otomatik gönderim açık — her ayın ${form.gun}. günü saat ${String(form.saat).padStart(2, '0')}:00` : 'Otomatik gönderim kapatıldı');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ayar kaydedilemedi'),
  });

  const degis = (p: Partial<OtomatikAyar>) => {
    setForm((f) => ({ ...f, ...p }));
    setKirli(true);
  };
  const sonKosu = sonKosuMetni(kaynak.sonKosu);

  return (
    <div className="p-4" style={KART} data-testid="otomatik-kart">
      <KartBaslik ikon={<CalendarClock size={13} />} sag={<Anahtar acik={!!form.aktif} onDegis={(v) => degis({ aktif: v })} title="Otomatik gönderim" />}>
        Otomatik gönderim
      </KartBaslik>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: IKINCIL }}>
        Her ayın seçilen günü/saatinde gönderilmemişlere gönderir; onay isteği açıksa önce WhatsApp&apos;tan haber verir, gönderimi siz başlatırsınız.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]" style={{ color: METIN, opacity: form.aktif ? 1 : 0.55 }}>
        <label className="inline-flex items-center gap-1.5">
          <span style={{ color: IKINCIL }}>Ayın</span>
          <select aria-label="Gün" value={form.gun} onChange={(e) => degis({ gun: Number(e.target.value) })} className="h-8 px-2 text-[12.5px]" style={{ ...GIRDI, colorScheme: 'dark' }}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((g) => (
              <option key={g} value={g}>{g}.</option>
            ))}
          </select>
          <span style={{ color: IKINCIL }}>günü</span>
        </label>
        <label className="inline-flex items-center gap-1.5">
          <span style={{ color: IKINCIL }}>saat</span>
          <select aria-label="Saat" value={form.saat} onChange={(e) => degis({ saat: Number(e.target.value) })} className="h-8 px-2 text-[12.5px]" style={{ ...GIRDI, colorScheme: 'dark' }}>
            {Array.from({ length: 24 }, (_, i) => i).map((s) => (
              <option key={s} value={s}>{String(s).padStart(2, '0')}:00</option>
            ))}
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <Anahtar acik={!!form.onayGerekli} onDegis={(v) => degis({ onayGerekli: v })} title="Göndermeden önce onayımı iste" />
          <span>Göndermeden önce onayımı iste</span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-3" style={{ borderTop: `1px solid ${KENAR_NOTR}` }}>
        <span className="text-[11.5px]" style={{ color: sonKosu ? IKINCIL : SONUK }}>
          {sonKosu ? `Son koşu: ${sonKosu}` : 'Henüz çalışmadı'}
        </span>
        <AltinDugme kucuk onClick={() => kaydet.mutate()} disabled={!kirli} yukleniyor={kaydet.isPending} title={kirli ? 'Ayarı kaydet' : 'Değişiklik yok'}>
          <Save size={13} /> Kaydet
        </AltinDugme>
      </div>
    </div>
  );
}
