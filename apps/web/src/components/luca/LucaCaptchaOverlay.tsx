'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { lucaSessionApi } from '@/lib/luca-session';

// Inline panel sayfaları — kullanıcı bu sayfalardayken zaten LucaInlineCaptchaPanel
// görünür, ikinci form açmaya gerek yok.
const INLINE_PAGES = [
  '/panel/mizan',
  '/panel/kdv-kontrol',
  '/panel/kdv-beyanname',
  // NOT: /panel/e-arsiv, /panel/isletme-hesap-ozeti listeden çıkarıldı —
  // bu sayfalarda LucaInlineCaptchaPanel sadece kullanıcının BAŞLATTIĞI
  // jobIds için tetikleniyor. Local agent kuyruktan çektiği eski job için
  // captcha çıkarsa orada görünmez → overlay devreye girip çözmesi gerekir.
];

export function LucaCaptchaOverlay() {
  const pathname = usePathname();
  const hiddenOnManager = pathname?.startsWith('/panel/ajanlar/luca');
  const hiddenOnInlinePage = INLINE_PAGES.some((page) => pathname?.startsWith(page));

  const [answer, setAnswer] = useState('');

  const statusQuery = useQuery({
    queryKey: ['luca-captcha-overlay'],
    queryFn: lucaSessionApi.status,
    enabled: !hiddenOnManager && !hiddenOnInlinePage,
    refetchInterval: 2000,
  });

  const challenge = statusQuery.data?.activeChallenge?.status === 'pending'
    ? statusQuery.data.activeChallenge
    : null;
  const autoOcr = challenge?.context?.autoOcr;

  const answerMut = useMutation({
    mutationFn: () => {
      if (!challenge) throw new Error('Güvenlik kodu isteği bulunamadı');
      if (!answer.trim()) throw new Error('Güvenlik kodunu girin');
      return lucaSessionApi.answerCaptcha(challenge.id, answer.trim());
    },
    onSuccess: () => {
      toast.success('Güvenlik kodu Luca ajanına gönderildi');
      setAnswer('');
      statusQuery.refetch();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || e?.message || 'Güvenlik kodu gönderilemedi'),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (challenge) await lucaSessionApi.cancelCaptcha(challenge.id).catch(() => null);
    },
    onSuccess: () => {
      setAnswer('');
      statusQuery.refetch();
      toast.info('Luca güvenlik kodu isteği iptal edildi');
    },
  });

  if (hiddenOnManager || hiddenOnInlinePage || !challenge) return null;

  // Captcha formu doğrudan overlay'de — kullanıcı modüle gitmeden çözebilsin.
  return (
    <div
      className="fixed bottom-4 right-6 z-[80] w-[420px] max-w-[calc(100vw-2rem)] rounded-xl p-4 shadow-2xl"
      style={{
        background: 'rgba(20,17,13,0.98)',
        border: '1px solid rgba(212,184,118,0.42)',
        boxShadow: '0 22px 70px rgba(0,0,0,0.55)',
      }}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em]" style={{ color: '#d4b876' }}>
        <AlertTriangle size={14} />
        Luca güvenlik kodu
      </div>

      {challenge.captchaImage ? (
        <img
          src={challenge.captchaImage}
          alt="Luca güvenlik kodu"
          className="h-16 w-full rounded-md object-contain mb-3"
          style={{ background: '#fff', border: '1px solid rgba(255,255,255,0.22)' }}
        />
      ) : (
        <div className="flex h-16 items-center justify-center rounded-md text-xs mb-3" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.65)' }}>
          Kod görseli bekleniyor...
        </div>
      )}

      {autoOcr && (
        <div className="mb-3 rounded-md px-3 py-2 text-[11.5px]" style={{ background: 'rgba(245,158,11,0.10)', color: 'rgba(250,250,249,0.72)', border: '1px solid rgba(245,158,11,0.22)' }}>
          {autoOcr.skippedReason
            ? autoOcr.skippedReason
            : autoOcr.ocrKapali
              ? 'Kod otomatik çözülüyor (2captcha) — birkaç saniye. Beklemek istemezsen elle de girebilirsin.'
              : `Otomatik okuma güvenli olmadı${autoOcr.confidence != null ? ` · güven ${Math.round(autoOcr.confidence)}%` : ''}. Kodu elle girin.`}
        </div>
      )}

      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && answer.trim()) answerMut.mutate();
        }}
        autoFocus
        placeholder="Kodu yazın..."
        className="h-11 w-full rounded-lg border px-3 text-base font-bold outline-none mb-3"
        style={{
          background: 'rgba(0,0,0,0.28)',
          borderColor: 'rgba(212,184,118,0.35)',
          color: '#fafaf9',
          letterSpacing: '.08em',
        }}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => answerMut.mutate()}
          disabled={answerMut.isPending || !answer.trim()}
          className="flex-1 inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-bold disabled:opacity-45"
          style={{ background: '#d4b876', color: '#15110b' }}
        >
          {answerMut.isPending ? 'Gönderiliyor...' : 'Kodu Gönder'}
        </button>
        <button
          type="button"
          onClick={() => cancelMut.mutate()}
          disabled={cancelMut.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold disabled:opacity-45"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(250,250,249,0.76)' }}
          title="Bu Luca işini iptal et"
        >
          <X size={15} /> İptal
        </button>
      </div>
    </div>
  );
}
