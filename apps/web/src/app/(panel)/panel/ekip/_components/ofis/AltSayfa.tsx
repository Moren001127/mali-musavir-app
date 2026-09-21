'use client';
import './ofis.css';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/** Alt sayfa kabuğu (dönem tablosu · iş geçmişi · düzenli işler): küçük üst satır "← Ekip" + başlık 22/700 + alt satır. */
export function AltSayfa({ baslik, alt, sag, children }: { baslik: string; alt?: ReactNode; sag?: ReactNode; children: ReactNode }) {
  return (
    <div className="ekip-ofis of-alt-sayfa">
      <div className="of-alt-ust">
        <Link href="/panel/ekip" className="of-geri">
          <ArrowLeft size={15} aria-hidden="true" /> Ekip
        </Link>
      </div>
      <header className="of-alt-baslik">
        <div className="min-w-0 flex-1">
          <h1>{baslik}</h1>
          {alt && <p>{alt}</p>}
        </div>
        {sag && <div className="of-kart-eylemler">{sag}</div>}
      </header>
      {children}
    </div>
  );
}
