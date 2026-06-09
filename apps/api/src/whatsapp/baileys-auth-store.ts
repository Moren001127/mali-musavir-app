import { PrismaService } from '../prisma/prisma.service';

/**
 * Baileys auth state'ini Postgres'te saklayan store.
 *
 * Railway'in dosya sistemi her deploy'da sıfırlandığı için Baileys'in
 * varsayılan useMultiFileAuthState (dosya tabanlı) kullanılamaz; yoksa her
 * deploy sonrası QR yeniden okutulması gerekirdi. Bu store, kimlik (creds) ve
 * signal anahtarlarını tek bir JSON olarak IntegrationConnection.config
 * (provider = 'WHATSAPP_BAILEYS') içine yazar. Tek numara / tek tenant için
 * yeterli ve basittir.
 *
 * `baileys` parametresi dinamik import edilen ESM modülüdür (BufferJSON,
 * initAuthCreds, proto buradan gelir).
 */

export const BAILEYS_PROVIDER = 'WHATSAPP_BAILEYS';

type AnyObj = Record<string, any>;

interface AuthBlob {
  creds: AnyObj | null;
  keys: Record<string, Record<string, any>>;
  lidMap: Record<string, string>;
}

export interface DBAuthState {
  state: { creds: any; keys: any };
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
  /** Kalıcı LID→telefon eşlemesi (restart sonrası gönderim bloklanmasın diye). */
  getLidMap: () => Record<string, string>;
  saveLidMapping: (lid: string, phone: string) => Promise<void>;
}

export async function useDBAuthState(
  prisma: PrismaService,
  tenantId: string,
  baileys: any,
): Promise<DBAuthState> {
  const BufferJSON = baileys.BufferJSON || baileys.default?.BufferJSON;
  const initAuthCreds = baileys.initAuthCreds || baileys.default?.initAuthCreds;
  const proto = baileys.proto || baileys.default?.proto;

  // --- DB'den oku ---
  const loadBlob = async (): Promise<AuthBlob> => {
    const row = await (prisma as any).integrationConnection
      .findUnique({ where: { tenantId_provider: { tenantId, provider: BAILEYS_PROVIDER } } })
      .catch(() => null);
    const cfg = (row?.config as any) || {};
    let creds: AnyObj | null = null;
    let keys: AuthBlob['keys'] = {};
    try {
      if (cfg.credsJson) creds = JSON.parse(cfg.credsJson, BufferJSON.reviver);
    } catch { creds = null; }
    try {
      if (cfg.keysJson) keys = JSON.parse(cfg.keysJson, BufferJSON.reviver) || {};
    } catch { keys = {}; }
    let lidMap: AuthBlob['lidMap'] = {};
    try {
      if (cfg.lidMapJson) lidMap = JSON.parse(cfg.lidMapJson) || {};
    } catch { lidMap = {}; }
    return { creds, keys, lidMap };
  };

  const blob = await loadBlob();
  const creds = blob.creds || initAuthCreds();
  const keys: AuthBlob['keys'] = blob.keys || {};
  const lidMap: AuthBlob['lidMap'] = blob.lidMap || {};

  // --- DB'ye yaz (creds + keys birlikte) ---
  const persist = async () => {
    const config = {
      credsJson: JSON.stringify(creds, BufferJSON.replacer),
      keysJson: JSON.stringify(keys, BufferJSON.replacer),
      lidMapJson: JSON.stringify(lidMap),
      updatedAt: new Date().toISOString(),
    };
    await (prisma as any).integrationConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: BAILEYS_PROVIDER } },
      update: { config, updatedAt: new Date() },
      // isActive=false: bu kayıt Meta master-switch'inden ayrı; bağlantı durumu
      // ayrı yönetilir. Sadece oturum verisini saklıyoruz.
      create: { tenantId, provider: BAILEYS_PROVIDER, config, isActive: true },
    });
  };

  return {
    state: {
      creds,
      keys: {
        get: (type: string, ids: string[]) => {
          const out: AnyObj = {};
          const cat = keys[type] || {};
          for (const id of ids) {
            let value = cat[id];
            if (value && type === 'app-state-sync-key') {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value !== undefined) out[id] = value;
          }
          return out;
        },
        set: async (data: AnyObj) => {
          for (const type of Object.keys(data)) {
            keys[type] = keys[type] || {};
            for (const id of Object.keys(data[type])) {
              const value = data[type][id];
              if (value === null || value === undefined) delete keys[type][id];
              else keys[type][id] = value;
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
    getLidMap: () => ({ ...lidMap }),
    saveLidMapping: async (lid: string, phone: string) => {
      const l = String(lid || '').replace(/[^\d]/g, '');
      const p = String(phone || '').replace(/[^\d]/g, '');
      if (!l || !p || l === p) return;
      if (lidMap[l] === p) return; // değişiklik yoksa gereksiz DB yazma
      lidMap[l] = p;
      await persist();
    },
    clear: async () => {
      await (prisma as any).integrationConnection
        .deleteMany({ where: { tenantId, provider: BAILEYS_PROVIDER } })
        .catch(() => null);
    },
  };
}
