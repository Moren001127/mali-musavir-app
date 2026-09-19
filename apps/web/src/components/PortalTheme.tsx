'use client';

import { useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';

/** Fatura Merkezi kendi eski tema kapsamını korur; açılır pencereler de kökü izler. */
export function PortalTheme({ theme }: { theme: 'A' | 'D' }) {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const invoiceCenter = pathname === '/fatura-merkezi' || pathname.startsWith('/fatura-merkezi/');
    document.documentElement.dataset.theme = invoiceCenter ? 'A' : theme;
  }, [pathname, theme]);
  return null;
}
