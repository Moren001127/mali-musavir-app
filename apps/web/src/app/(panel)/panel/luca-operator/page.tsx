import { BotMessageSquare, Info } from 'lucide-react';
import { LucaOperatorChat } from './_components/LucaOperatorChat';

const ACCENT = '#a78bfa'; // mor — Luca Operatörü modül kimliği

export const metadata = {
  title: 'Luca Operatörü',
};

export default function LucaOperatorPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
      {/* Üst renk şeridi */}
      <div
        className="h-1 w-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}33 40%, transparent)` }}
      />

      {/* Radial başlık kartı (AI Maliyet imzası) */}
      <header
        className="relative overflow-hidden rounded-2xl p-5"
        style={{
          background: 'linear-gradient(135deg, rgba(20,16,28,0.92), rgba(8,7,11,0.92))',
          border: `1px solid ${ACCENT}26`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 18px 40px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background: `radial-gradient(circle at 12% 0%, ${ACCENT}1f, transparent 38%), radial-gradient(circle at 100% 120%, ${ACCENT}12, transparent 42%)`,
          }}
        />
        <div className="relative flex items-center gap-4">
          <div
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, #6d5bd0)`,
              color: '#0f0d0b',
              boxShadow: `0 0 22px ${ACCENT}3a, inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            <BotMessageSquare size={24} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold" style={{ color: '#fafaf9' }}>
              Luca Operatörü
            </h1>
            <p className="text-sm" style={{ color: 'rgba(250,250,249,0.6)' }}>
              Luca işlerini yapan, konuşulan ve öğrenen çalışan. Yazılı veya sesli komut ver.
            </p>
          </div>
        </div>
      </header>

      {/* Kapsam notu — Faz 1 */}
      <div
        className="flex items-start gap-2 rounded-xl px-4 py-3 text-xs"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(250,250,249,0.7)',
        }}
      >
        <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: ACCENT }} />
        <span>
          <b style={{ color: '#fafaf9' }}>Şu an (Faz 1):</b> konuşur, mükellef/mali veriyi okur ve mevcut
          Luca veri çekme işlerini onayla tetikler. <b style={{ color: '#fafaf9' }}>Luca&apos;ya yazma/işlem</b> (beyanname,
          işe giriş-çıkış, işletme defteri gönderimi) bir sonraki aşamada eklenecek.
        </span>
      </div>

      <LucaOperatorChat />
    </div>
  );
}
