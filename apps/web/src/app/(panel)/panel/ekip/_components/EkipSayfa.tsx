import { KonsolBaslik } from './KonsolBaslik';
import { EkipEkrani } from './EkipEkrani';

const ACCENT = '#7dd3fc'; // gök mavisi — Moren Ekip modül kimliği

/**
 * Moren Ekip — Operasyon Konsolu (PLAN/14-EKIP-EKRANI-OPERASYON-KONSOLU.md).
 * Renk şeridi + konsol başlığı + ekran omurgası; başka bir şey yok. Yapışkan öğe YOK.
 */
export function EkipSayfa() {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Üst renk şeridi (gök mavisi → mor) */}
      <div
        className="h-1 w-full flex-shrink-0 rounded-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, #a78bfa 45%, ${ACCENT}22 80%, transparent)` }}
      />
      <KonsolBaslik />
      <EkipEkrani />
    </div>
  );
}
