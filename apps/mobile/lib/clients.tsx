import React, { createContext, useContext, useState, ReactNode } from 'react';
import { colors } from './theme';

export type Client = { id: string; name: string; tur: string; vkn: string; ini: string; color: string };
export type ActiveClient = Client | 'all';

/* Örnek mükellef listesi — RN'de canlı veriye bağlanınca /taxpayers'tan gelecek */
export const CLIENTS: Client[] = [
  { id: 'dogan', name: 'Doğan Ticaret Ltd.', tur: 'Kurumlar · Bilanço', vkn: '1234567890', ini: 'DT', color: colors.blue },
  { id: 'leyla', name: 'Leyla Bozkurt', tur: 'Şahıs · Bilanço', vkn: '1234500011', ini: 'LB', color: colors.gold },
  { id: 'aysegul', name: 'Ayşegül İnşaat A.Ş.', tur: 'Kurumlar · Bilanço', vkn: '9876543210', ini: 'Aİ', color: colors.amber },
  { id: 'ercan', name: 'Ercan Nakliyat', tur: 'Şahıs · İşletme', vkn: '5551234567', ini: 'EN', color: colors.rose },
  { id: 'mert', name: 'Mert Reklam', tur: 'Şahıs · İşletme', vkn: '4443332211', ini: 'MR', color: colors.green },
  { id: 'gulsen', name: 'Gülşen Gıda', tur: 'Şahıs · Basit', vkn: '7778889990', ini: 'GG', color: colors.copper },
];

export function clientLabel(a: ActiveClient): string {
  return a === 'all' ? 'Tüm Mükellefler' : a.name;
}

type Ctx = { active: ActiveClient; setActive: (c: ActiveClient) => void };
const ClientContext = createContext<Ctx | null>(null);

export function ClientProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveClient>(CLIENTS[0]);
  return <ClientContext.Provider value={{ active, setActive }}>{children}</ClientContext.Provider>;
}

export function useClient() {
  const v = useContext(ClientContext);
  if (!v) throw new Error('useClient must be used inside ClientProvider');
  return v;
}
