import { EFaturaAdapter } from './efatura-adapter.interface';
import { NilveraAdapter } from './nilvera.adapter';
import { IzibizAdapter } from './izibiz.adapter';
import { UyumsoftAdapter } from './uyumsoft.adapter';

const ADAPTERS: Record<string, EFaturaAdapter> = {
  NILVERA: new NilveraAdapter(),
  IZIBIZ: new IzibizAdapter(),
  UYUMSOFT: new UyumsoftAdapter(),
};

export function getEFaturaAdapter(provider: string): EFaturaAdapter | null {
  return ADAPTERS[provider.toUpperCase()] || null;
}

export const SUPPORTED_PROVIDERS = Object.keys(ADAPTERS);
