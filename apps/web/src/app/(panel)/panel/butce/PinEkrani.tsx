'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, ShieldCheck, KeyRound } from 'lucide-react';
import { butceApi, pinBileti } from '@/lib/butce';
import { Dugme, GOLD, MUTED, TEXT, CARD_BORDER, KIRMIZI, OK, Yukleniyor } from './ui';

/**
 * Modül kapısı: 6 haneli PIN.
 * PIN kurulu değilse önce belirletir, kuruluysa sorar. Doğrulanınca sunucudan
 * gelen bilet sekme belleğine yazılır; sekme kapanınca PIN yeniden sorulur.
 */
export default function PinEkrani({ acildi }: { acildi: () => void }) {
  const durum = useQuery({ queryKey: ['butce-pin-durum'], queryFn: butceApi.pinDurum, retry: false });
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [hata, setHata] = useState('');
  const ilkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ilkRef.current?.focus();
  }, [durum.data?.kurulu]);

  const ac = useMutation({
    mutationFn: () => butceApi.pinAc(pin),
    onSuccess: (d) => {
      pinBileti.yaz(d.bilet);
      acildi();
    },
    onError: (e: any) => {
      setHata(e?.response?.data?.message || 'PIN doğrulanamadı');
      setPin('');
      durum.refetch();
    },
  });

  const kur = useMutation({
    mutationFn: () => butceApi.pinKur(pin),
    onSuccess: (d) => {
      pinBileti.yaz(d.bilet);
      acildi();
    },
    onError: (e: any) => setHata(e?.response?.data?.message || 'PIN belirlenemedi'),
  });

  if (durum.isLoading) return <Yukleniyor metin="Kontrol ediliyor…" />;

  const kurulu = !!durum.data?.kurulu;
  const kilitli = !!durum.data?.kilitli;

  const gonder = () => {
    setHata('');
    if (!/^\d{6}$/.test(pin)) {
      setHata('PIN 6 haneli olmalı');
      return;
    }
    if (!kurulu) {
      if (pin !== pin2) {
        setHata('PIN tekrarı eşleşmiyor');
        return;
      }
      kur.mutate();
    } else {
      ac.mutate();
    }
  };

  return (
    <div className="flex min-h-[65vh] items-center justify-center px-4">
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl px-6 py-7 text-center"
        style={{
          background: 'linear-gradient(160deg, rgba(230,200,120,0.08), rgba(255,255,255,0.012) 60%)',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 30px 70px rgba(0,0,0,0.45)',
        }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full opacity-25"
          style={{ background: `radial-gradient(circle, ${GOLD}, transparent 66%)` }}
        />

        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: `${GOLD}1a`, border: `1px solid ${GOLD}44`, color: GOLD }}
        >
          {kurulu ? <Lock size={20} /> : <KeyRound size={20} />}
        </div>

        <h1 className="mt-3 text-[15px] font-semibold" style={{ color: TEXT }}>
          {kurulu ? 'Kişisel Bütçe kilidi' : 'Modül şifresi belirleyin'}
        </h1>
        <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
          {kurulu
            ? 'Devam etmek için 6 haneli şifrenizi girin.'
            : 'Bu modül her açılışta 6 haneli şifre soracak. Portal şifrenizden farklı olmalı.'}
        </p>

        {kilitli ? (
          <div
            className="mt-5 rounded-xl px-4 py-3 text-[12px]"
            style={{ background: `${KIRMIZI}14`, border: `1px solid ${KIRMIZI}38`, color: KIRMIZI }}
          >
            Çok fazla yanlış deneme yapıldı. Bir süre sonra tekrar deneyin.
          </div>
        ) : (
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              gonder();
            }}
          >
            <input
              ref={ilkRef}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••••"
              className="w-full text-center tracking-[0.5em]"
              style={{
                background: 'rgba(0,0,0,0.35)',
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 12,
                padding: '12px 14px',
                fontSize: 20,
                color: TEXT,
                outline: 'none',
              }}
            />
            {!kurulu && (
              <input
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Tekrar"
                className="w-full text-center tracking-[0.5em]"
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  border: `1px solid ${CARD_BORDER}`,
                  borderRadius: 12,
                  padding: '12px 14px',
                  fontSize: 20,
                  color: TEXT,
                  outline: 'none',
                }}
              />
            )}

            {hata && (
              <div className="text-[11.5px]" style={{ color: KIRMIZI }}>
                {hata}
              </div>
            )}

            {kurulu && durum.data && durum.data.kalanDeneme < 5 && !hata && (
              <div className="text-[11px]" style={{ color: MUTED }}>
                Kalan deneme: {durum.data.kalanDeneme}
              </div>
            )}

            <Dugme
              type="submit"
              tur="birincil"
              className="w-full justify-center"
              yukleniyor={ac.isPending || kur.isPending}
            >
              {kurulu ? 'Aç' : 'Şifreyi belirle'}
            </Dugme>
          </form>
        )}

        <p className="mt-4 flex items-center justify-center gap-1.5 text-[10.5px]" style={{ color: MUTED }}>
          <ShieldCheck size={11} style={{ color: OK }} />
          Şifre geri döndürülemez biçimde saklanır; 5 yanlış denemede kilitlenir.
        </p>
      </div>
    </div>
  );
}
