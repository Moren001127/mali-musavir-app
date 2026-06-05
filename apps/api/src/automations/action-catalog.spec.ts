import { VALID_EVENT_NAMES, ACTION_BY_NAME } from './action-catalog';

describe('VALID_EVENT_NAMES', () => {
  it('henüz yayınlanmayan olayları İÇERMEZ', () => {
    // Bu iki olay sistemde henüz emit edilmiyor; "çalışmayan tetikleyici"
    // sunmamak için kataloğdan çıkarıldı.
    expect(VALID_EVENT_NAMES).not.toContain('Invoice.Created');
    expect(VALID_EVENT_NAMES).not.toContain('WhatsApp.DocumentReceived');
  });

  it('gerçekten ateşlenen olayları İÇERİR', () => {
    expect(VALID_EVENT_NAMES).toContain('Taxpayer.Created');
    expect(VALID_EVENT_NAMES).toContain('Document.Uploaded');
    expect(VALID_EVENT_NAMES).toContain('WhatsApp.MessageReceived');
  });
});

describe('ACTION_BY_NAME kategorileri', () => {
  it.each(['for_each', 'branch_if', 'parallel', 'format_list'])(
    '%s FLOW kategorisindedir',
    (name) => {
      expect(ACTION_BY_NAME[name]).toBeDefined();
      expect(ACTION_BY_NAME[name].category).toBe('FLOW');
    },
  );

  it.each(['send_whatsapp_template', 'send_email'])(
    '%s WRITE kategorisindedir',
    (name) => {
      expect(ACTION_BY_NAME[name]).toBeDefined();
      expect(ACTION_BY_NAME[name].category).toBe('WRITE');
    },
  );
});

describe('FLOW aksiyon şemaları', () => {
  it('for_each.throttleMs şemada number olarak tanımlı', () => {
    const props = ACTION_BY_NAME['for_each'].input_schema.properties;
    expect(props.throttleMs).toBeDefined();
    expect(props.throttleMs.type).toBe('number');
  });

  it('parallel.concurrency şemada number olarak tanımlı', () => {
    const props = ACTION_BY_NAME['parallel'].input_schema.properties;
    expect(props.concurrency).toBeDefined();
    expect(props.concurrency.type).toBe('number');
  });
});
