import { useDBAuthState } from './baileys-auth-store';

/**
 * K0.1 transport fix regresyon testi: LID→telefon eşlemesi DB'de kalıcı
 * olmalı ve "restart" (yeni instance) sonrası geri yüklenmeli. Eskiden
 * eşleme yalnızca bellekteydi → restart'ta boşalıyor → toSendJid null →
 * bot bilinen kişilere cevap gönderemiyordu.
 */

const baileysMock = {
  BufferJSON: { replacer: (_k: string, v: any) => v, reviver: (_k: string, v: any) => v },
  initAuthCreds: () => ({ noiseKey: 'k' }),
  proto: { Message: { AppStateSyncKeyData: { fromObject: (x: any) => x } } },
};

function makePrismaMock() {
  const store: { row: any } = { row: null };
  return {
    integrationConnection: {
      findUnique: jest.fn(async () => store.row),
      upsert: jest.fn(async ({ update, create }: any) => {
        const config = (update && update.config) || (create && create.config);
        store.row = { config };
        return store.row;
      }),
      deleteMany: jest.fn(async () => {
        store.row = null;
      }),
    },
    __store: store,
  };
}

describe('useDBAuthState lidMap kalıcılığı', () => {
  it('öğrenilen LID→telefon eşlemesini saklar', async () => {
    const prisma = makePrismaMock();
    const auth = await useDBAuthState(prisma as any, 't1', baileysMock);
    expect(auth.getLidMap()).toEqual({});

    await auth.saveLidMapping('111222333444555', '905350587475');
    expect(auth.getLidMap()).toEqual({ '111222333444555': '905350587475' });
  });

  it('restart (yeni instance) sonrası eşlemeyi geri yükler', async () => {
    const prisma = makePrismaMock();
    const first = await useDBAuthState(prisma as any, 't1', baileysMock);
    await first.saveLidMapping('111222333444555', '905350587475');

    // Aynı DB (store) ile yeni instance = sunucu restart'ı simülasyonu.
    const second = await useDBAuthState(prisma as any, 't1', baileysMock);
    expect(second.getLidMap()).toEqual({ '111222333444555': '905350587475' });
  });

  it('geçersiz/aynı girdileri yok sayar (gereksiz DB yazmaz)', async () => {
    const prisma = makePrismaMock();
    const auth = await useDBAuthState(prisma as any, 't1', baileysMock);
    await auth.saveLidMapping('', '905350587475'); // lid boş
    await auth.saveLidMapping('111', '111'); // lid === phone
    expect(auth.getLidMap()).toEqual({});

    await auth.saveLidMapping('111', '905350587475');
    const calls1 = (prisma.integrationConnection.upsert as jest.Mock).mock.calls.length;
    await auth.saveLidMapping('111', '905350587475'); // değişiklik yok → yazma yok
    const calls2 = (prisma.integrationConnection.upsert as jest.Mock).mock.calls.length;
    expect(calls2).toBe(calls1);
  });
});
