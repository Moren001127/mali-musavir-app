import { Users } from 'lucide-react';
import { EkipEkrani, DurumRozetleri } from './EkipEkrani';

const ACCENT = '#7dd3fc'; // gök mavisi — Moren Ekip modül kimliği (altın yalnız koordinatörde)

/**
 * Moren Ekip — 13 ajanlık yapay çalışan kadrosu (PLAN/13-AJAN-KADROSU.md).
 * İmza başlık (renk şeridi + radial parıltı), durum rozetleri, ajan kartları,
 * görev paneli, iş dosyaları ve dönem panosu. Yapışkan başlık YOK.
 */
export function EkipSayfa() {
  return (
    <div className="flex flex-col gap-3">
      {/* Üst renk şeridi */}
      <div
        className="h-1 w-full flex-shrink-0 rounded-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, #a78bfa 45%, ${ACCENT}22 80%, transparent)` }}
      />

      {/* Başlık — radial parıltı */}
      <header
        className="relative flex-shrink-0 overflow-hidden rounded-2xl px-4 py-3"
        style={{
          background: 'linear-gradient(135deg, rgba(14,20,26,0.94), rgba(7,8,10,0.94))',
          border: `1px solid ${ACCENT}29`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 40px rgba(0,0,0,0.28)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: `radial-gradient(circle at 8% 0%, ${ACCENT}26, transparent 40%), radial-gradient(circle at 100% 120%, #a78bfa18, transparent 42%)`,
          }}
        />
        <div className="relative flex flex-wrap items-center gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, #5b9fd1)`,
              color: '#0b1218',
              boxShadow: `0 0 22px ${ACCENT}33, inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            <Users size={20} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight" style={{ color: '#fafaf9' }}>
              Moren Ekip
            </h1>
            <p className="truncate text-xs" style={{ color: 'rgba(250,250,249,0.55)' }}>
              13 yapay çalışan — koordinatörden müşteri ilişkilerine, tek ekrandan görev ver, izle, onayla
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <DurumRozetleri />
          </div>
        </div>
      </header>

      <EkipEkrani />
    </div>
  );
}
