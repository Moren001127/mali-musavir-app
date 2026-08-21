import { BotMessageSquare } from 'lucide-react';
import { LucaOperatorChat } from './_components/LucaOperatorChat';
import { LucaYanPanel } from './_components/LucaYanPanel';

const ACCENT = '#d4b876'; // altın — Luca Operatörü modül kimliği

export const metadata = {
  title: 'Luca Operatörü',
};

/**
 * Ekran düzeni (2026-08-21 yeniden tasarım): ana alan SOHBET. Durum, öğrenilen
 * menüler, ofis kuralları ve beceriler tek bir yan panelde toplandı; eskiden
 * üst üste yığılı 5 kutu sohbete yer bırakmıyordu.
 */
export default function LucaOperatorPage() {
  return (
    <div className="flex h-full flex-col gap-3">
      {/* Üst renk şeridi */}
      <div
        className="h-1 w-full flex-shrink-0 rounded-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}33 40%, transparent)` }}
      />

      {/* Başlık — tek satır, radial parıltı */}
      <header
        className="relative flex-shrink-0 overflow-hidden rounded-2xl px-4 py-3"
        style={{
          background: 'linear-gradient(135deg, rgba(24,20,12,0.92), rgba(8,7,5,0.92))',
          border: `1px solid ${ACCENT}29`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 40px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background: `radial-gradient(circle at 10% 0%, ${ACCENT}24, transparent 38%), radial-gradient(circle at 100% 120%, ${ACCENT}12, transparent 42%)`,
          }}
        />
        <div className="relative flex items-center gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, #8b7649)`,
              color: '#15110b',
              boxShadow: `0 0 22px ${ACCENT}33, inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            <BotMessageSquare size={20} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight" style={{ color: '#fafaf9' }}>
              Luca Operatörü
            </h1>
            <p className="truncate text-xs" style={{ color: 'rgba(250,250,249,0.55)' }}>
              Luca işlerini yapan, konuşulan ve öğrenen çalışan
            </p>
          </div>
          <span
            className="hidden flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold sm:inline-flex"
            style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#86efac' }}
            title="Max aboneliğiyle çalışır — ek API maliyeti yok"
          >
            ● Max · ücretsiz
          </span>
        </div>
      </header>

      {/* Ana alan: sohbet (geniş) + yan panel (dar). Dar ekranda alt alta. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 lg:order-1">
          <LucaOperatorChat />
        </div>
        <div className="min-h-0 lg:order-2">
          <LucaYanPanel />
        </div>
      </div>
    </div>
  );
}
