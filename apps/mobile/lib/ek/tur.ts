/**
 * EK MODÜL ALTYAPISI (2026-09-13) — mobil uygulamaya yeni modül/aksiyon eklemenin tek yolu.
 *
 * Neden: app/index.tsx tek büyük köprü dosyası; birden fazla iş paketi aynı anda ona dokununca çakışıyor.
 * Her paket kendi dosyasında (lib/ek/<paket>.ts) yükleyici + aksiyon haritası verir; index.tsx yalnız
 * EK_MODUL_YUKLEYICI / EK_AKSIYON kayıt defterine bakar (lib/ek/index.ts).
 *
 * HTML tarafı: design/ek/<paket>.html bloğu (scripts/build-app-html.cjs assets/app.html'e gömer) —
 * MOREN_EK.render['<modul-id>'] = (m,id) => html ; MOREN_EK.navEkle('Grup', [ikon, 'Ad', renk, 'm:<modul-id>']).
 * Veri akışı: HTML modülü açınca RN'e {type:'module', module, client, donem} gelir → yükleyici çalışır →
 * ctx.pushModule(modulId, client, veri) → HTML'de modLive(modulId) ile okunur ve modül yeniden çizilir.
 */
import type { AxiosInstance } from 'axios';

export interface EkBaglam {
  api: AxiosInstance;
  /** Seçili mükellef id ('' ya da 'all' = ofis geneli) */
  client: string;
  /** 'YYYY-MM' — HTML'deki dönem seçici ya da içinde bulunulan ay */
  donem: string;
  hasClient: boolean;
  /** HTML'e JS enjekte et (window.MOREN.* çağrıları) */
  inject: (js: string) => void;
  /** Modül verisini HTML'e ver: window.MOREN.applyModule(modul, client, veri) */
  pushModule: (modul: string, client: string, veri: any) => void;
  /** Muhatap: 'adv' müşavir, 'tax' mükellef */
  persona: 'adv' | 'tax';
}

/** Modül açılınca çağrılır; veriyi ctx.pushModule ile HTML'e verir. Hata fırlatırsa index.tsx yutar (örnek görünüm kalmaz, HTML "veri yok" der). */
export type EkModulYukleyici = (ctx: EkBaglam) => Promise<void>;

/** HTML'deki morenAction(el,'<aksiyon>',etiket,params) → burada koşar; sonuç butona yansır (actionDone). */
export type EkAksiyon = (ctx: EkBaglam, params: any) => Promise<{ ok: boolean; msg?: string }>;

export interface EkPaket {
  /** modül id → yükleyici */
  yukleyiciler: Record<string, EkModulYukleyici>;
  /** aksiyon adı → işleyici */
  aksiyonlar: Record<string, EkAksiyon>;
}
