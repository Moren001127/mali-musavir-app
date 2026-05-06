// Log mesajı parser'ı + ortak format yardımcıları.
// Tüm "Canlı Akış" widget'ları (Mihsap, Loglar, KDV Kontrol, Panel)
// bu modülü kullanır — tek bir görsel format her yerde aynı.

export type FieldStatus = 'full' | 'empty-with-suggestion' | 'missing';

export interface FieldRow {
  label: string;        // "Tarih", "Belge Türü", "Toplam Tutar", "Matrah", "KDV", "Cari" vb.
  status: FieldStatus;  // ✓ full / ○ empty-with-suggestion / ✗ missing
  value?: string;       // Asıl değer (kod / tarih / tutar / öneri kodu)
  meta?: string;        // "öneri · güven %95 · 1 sonuç" gibi ek bilgi
}

export interface ParsedAgentMessage {
  bosAlanlar: string[];          // ['Matrah', 'KDV', 'Cari']
  oneriler: Record<string, { kod: string; guven?: string; sondaj?: string }>;
  sonuc?: { ok: boolean; text: string };
  mihsapUyarisi?: string;
  hata?: string;
  rawLines: string[];            // parse edilemeyen kalan satırlar
}

/**
 * Agent log mesajını yapısal hale çevirir.
 * Mesaj formatı (extension agent.js > satirlar.join('\n')):
 *   Boş alanlar: Matrah, KDV, Cari
 *   AI önerisi:
 *     Matrah : 600.01.001  güven %95  (sondaj: 1 sonuç)
 *     KDV    : 391.01.020  güven %92  (sondaj: 3 sonuç)
 *     Cari   : (öneri yok)  güven %0  (sondaj: 0 sonuç)
 *   Sonuç: ✓ Onaylandı (F2 başarılı)
 *   Mihsap uyarısı: "Tahsilat/Ödeme hesabı seçilmemiş"
 *   Hata: ...
 *
 * `\n` yoksa (transport stripleyebilir) anahtar kelimelere göre split eder.
 */
export function parseAgentMessage(msg: string | undefined | null): ParsedAgentMessage {
  const result: ParsedAgentMessage = {
    bosAlanlar: [],
    oneriler: {},
    rawLines: [],
  };
  if (!msg) return result;

  // 1) satırlara böl — newline varsa direkt, yoksa anahtar kelimelere göre lookahead-split
  const lines = splitLogMessage(msg);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Boş alanlar
    let m = line.match(/^Boş alanlar\s*:\s*(.+)$/i);
    if (m) {
      result.bosAlanlar = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }

    // AI önerisi: başlık satırı — atla
    if (/^AI öneri(si)?\s*:?\s*$/i.test(line)) continue;

    // Matrah / KDV / Cari satırları — "Field : value  güven %xx  (sondaj: N sonuç)"
    m = line.match(/^(Matrah|KDV|Cari)\s*:\s*(.+?)(?:\s+güven\s+(\S+))?(?:\s+\(sondaj\s*:\s*([^)]+)\))?\s*$/i);
    if (m) {
      const [, field, kod, guven, sondaj] = m;
      result.oneriler[field] = {
        kod: kod.trim(),
        guven: guven?.trim(),
        sondaj: sondaj?.trim(),
      };
      continue;
    }

    // Sonuç
    m = line.match(/^Sonuç\s*:\s*(.+)$/i);
    if (m) {
      const text = m[1].trim();
      const ok = /^✓|onayland|başarılı|basarili/i.test(text);
      result.sonuc = { ok, text };
      continue;
    }

    // Mihsap uyarısı
    m = line.match(/^Mihsap uyarısı\s*:\s*(.+)$/i);
    if (m) {
      result.mihsapUyarisi = m[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }

    // Hata
    m = line.match(/^Hata\s*:\s*(.+)$/i);
    if (m) {
      result.hata = m[1].trim();
      continue;
    }

    result.rawLines.push(line);
  }

  return result;
}

/**
 * Mesajı satırlara böler. Önce \n / \r\n, yoksa anahtar kelimelere göre.
 */
export function splitLogMessage(msg: string): string[] {
  if (!msg) return [];
  const byNewline = msg.split(/\r?\n/).filter((s) => s.length > 0);
  if (byNewline.length > 1) return byNewline;

  const KEYS = [
    'Boş alanlar:',
    'AI önerisi:',
    'AI öneri:',
    'AI öneri',
    'Sonuç:',
    'Mihsap uyarısı:',
    'Hata:',
    'Matrah :',
    'Matrah:',
    'KDV :',
    'KDV:',
    'Cari :',
    'Cari:',
  ];
  const escaped = KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\s*(?=(?:${escaped}))`, 'g');
  const parts = msg.split(re).map((s) => s.trim()).filter((s) => s.length > 0);

  return parts;
}

/**
 * Bir AgentEvent'i 8-alan tablosuna çevirir:
 *   Tarih, Cari, Belge Türü, Toplam Tutar, Matrah, KDV, İçerik, Onay
 *
 * Her satır alt alta gösterilir — artık "F2 · ..." tarzı metin alt satırı
 * YOK, her bilgi ayrı row olarak yer alır.
 */
export function buildFieldRows(event: {
  ts?: string | Date;
  action?: string;
  tutar?: number | string;
  hesapKodu?: string;
  kdv?: string;
  status?: string;
  message?: string;
  meta?: any;
}, parsed: ParsedAgentMessage): FieldRow[] {
  const rows: FieldRow[] = [];

  // 1) Tarih — meta.tarih > mesaj prefix'inden
  const faturaTarihi = extractFaturaTarihi(event.meta, event.message);
  rows.push({
    label: 'Tarih',
    status: faturaTarihi ? 'full' : 'missing',
    value: faturaTarihi || '—',
  });

  // 2) Cari (karşı firma) — meta.firma veya meta.cari
  const cari = (event.meta?.cari || event.meta?.firma || '').toString().trim();
  rows.push({
    label: 'Cari',
    status: cari ? 'full' : 'missing',
    value: cari || '—',
  });

  // 3) Belge Türü — meta.belgeTuru > mesajda BT:...
  const belgeTuru = inferBelgeTuru(event.action, event.meta, event.message);
  rows.push({
    label: 'Belge Türü',
    status: belgeTuru ? 'full' : 'missing',
    value: belgeTuru || '—',
  });

  // 4) Toplam Tutar
  if (event.tutar != null && event.tutar !== '') {
    const n = Number(event.tutar);
    if (Number.isFinite(n)) {
      rows.push({
        label: 'Toplam Tutar',
        status: 'full',
        value: `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`,
      });
    }
  } else {
    rows.push({ label: 'Toplam Tutar', status: 'missing', value: '—' });
  }

  // 5-6) Matrah / KDV — boş alan + öneri durumuna göre
  const checkField = (label: 'Matrah' | 'KDV', existingValue?: string) => {
    const isBos = parsed.bosAlanlar.some((b) => b.toLowerCase() === label.toLowerCase());
    const oneri = parsed.oneriler[label];
    if (!isBos && existingValue) {
      rows.push({ label, status: 'full', value: existingValue });
      return;
    }
    if (isBos && oneri) {
      const yok = /öneri yok|^\(öneri yok\)$/i.test(oneri.kod);
      const meta = [
        yok ? 'sondaj boş' : 'öneri',
        oneri.guven ? `güven ${oneri.guven}` : null,
        oneri.sondaj ? oneri.sondaj : null,
      ].filter(Boolean).join(' · ');
      rows.push({
        label,
        status: yok ? 'missing' : 'empty-with-suggestion',
        value: yok ? 'öneri yok' : oneri.kod,
        meta,
      });
      return;
    }
    if (isBos) {
      rows.push({ label, status: 'missing', value: 'boş' });
      return;
    }
    if (existingValue) {
      rows.push({ label, status: 'full', value: existingValue });
    } else {
      rows.push({ label, status: 'missing', value: '—' });
    }
  };
  checkField('Matrah', event.hesapKodu);
  checkField('KDV', event.kdv);

  // 7) İçerik (AI ocrOzet veya meta.icerik)
  const icerik = (event.meta?.icerik || event.meta?.ocrOzet || '').toString().trim();
  if (icerik) {
    rows.push({ label: 'İçerik', status: 'full', value: icerik });
  }

  // 8) Onay/Karar
  const kararText =
    event.meta?.karar === 'onay' || event.status === 'basarili' || event.status === 'ok' || event.status === 'onaylandi'
      ? 'Onaylandı (F2)'
      : event.meta?.karar === 'atla' || event.status === 'atlandi' || event.status === 'skip'
      ? 'Atlandı'
      : event.meta?.karar === 'emin_degil' || event.status === 'hata'
      ? 'Emin değil / Hata'
      : event.meta?.karar || event.status || '';
  if (kararText) {
    const ok = /onay|F2|başarı|basarili/i.test(kararText);
    rows.push({
      label: 'Onay',
      status: ok ? 'full' : 'missing',
      value: kararText,
    });
  }

  return rows;
}

/**
 * Fatura tarihi çıkarır. Öncelik:
 *  1) meta.tarih (extension yeni sürüm doğrudan koyuyor)
 *  2) Mesaj prefix'i "DD.MM.YYYY · ..." veya "YYYY-MM-DD · ..."
 *  3) Bulunamazsa undefined — UI tarihi göstermez (yanıltıcı olmasın)
 *
 * event.ts ASLA kullanılmaz: o kayıt zamanı (bugün), fatura tarihi değil.
 */
function extractFaturaTarihi(meta?: any, message?: string): string | undefined {
  // 1) meta.tarih (en yaygın)
  if (meta?.tarih) {
    const t = String(meta.tarih).trim();
    if (t && !/^\?+$/.test(t)) return normalizeTarih(t);
  }
  // 2) meta.faturaTarihi / meta.belgeTarihi / meta.duzenlemeTarihi fallback
  for (const key of ['faturaTarihi', 'belgeTarihi', 'duzenlemeTarihi', 'evrakTarihi', 'tarihi']) {
    const v = meta?.[key];
    if (v) {
      const t = String(v).trim();
      if (t && !/^\?+$/.test(t)) return normalizeTarih(t);
    }
  }
  // 3) Mesaj prefix'inden parse — "31.03.2026 · ..." veya "2026-03-31 · ..."
  if (message) {
    const m = message.match(/^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\s*[·\-—]/);
    if (m) return normalizeTarih(m[1]);
    // Mesaj ortasında "tarih X ≠ Y" pattern (ay-skip log mesajı)
    const m2 = message.match(/tarih\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})/i);
    if (m2) return normalizeTarih(m2[1]);
  }
  // 4) SON ÇARE — agent v1.36.3+ her log'a meta.donem ("YYYY-MM") ekliyor.
  // Tarih hiçbir yerden okunamadıysa o ayın 15'ini göster (yaklaşık tarih).
  // Bu sayede log'da Tarih: ✗ kalmaz, en azından "15.04.2026" gibi bir değer
  // kullanıcı için anlamlı olur (zaten o ay için işlenen fatura).
  if (meta?.donem) {
    const d = String(meta.donem).trim();
    const m = d.match(/^(\d{4})-(\d{1,2})$/);
    if (m) return `15.${m[2].padStart(2, '0')}.${m[1]}`;
  }
  return undefined;
}

function normalizeTarih(raw: string): string {
  const s = raw.trim();
  // YYYY-MM-DD veya YYYY/MM/DD → DD.MM.YYYY
  let m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m) return `${m[3].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[1]}`;
  // DD.MM.YYYY veya DD/MM/YYYY → DD.MM.YYYY
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${yyyy}`;
  }
  return s;
}

// Raw belge türü kodlarını kullanıcı-dostu Türkçeye çevir
function formatBelgeTuru(raw: string): string {
  const map: Record<string, string> = {
    'E_ARSIV': 'e-Arşiv Fatura',
    'EARSIV': 'e-Arşiv Fatura',
    'E_FATURA': 'e-Fatura',
    'EFATURA': 'e-Fatura',
    'FAT': 'Fatura',
    'FATURA': 'Fatura',
    'FIS': 'Yazarkasa Fişi',
    'OKC': 'Yazarkasa Fişi',
    'IRSALIYE': 'İrsaliye',
    'IRSALIYELI_FATURA': 'İrsaliyeli Fatura',
    'GIDER_PUSULASI': 'Gider Pusulası',
    'SMM': 'Serbest Meslek Makbuzu',
    'PMM': 'Perakende Makbuz',
    'MUSTAHSIL': 'Müstahsil Makbuzu',
    'BANKA_DEKONTU': 'Banka Dekontu',
  };
  const key = raw.toUpperCase().replace(/[\s-]/g, '_');
  return map[key] || raw;
}

function inferBelgeTuru(action?: string, meta?: any, message?: string): string | undefined {
  // 1) meta.belgeTuru — extension explicit göndermişse en doğru (insanca formatla)
  if (meta?.belgeTuru) return formatBelgeTuru(String(meta.belgeTuru));
  // 2) meta.faturaTuru — bazı durumlarda belgeTuru yok ama faturaTuru var
  if (meta?.faturaTuru) {
    const ft = String(meta.faturaTuru).toUpperCase();
    if (ft.includes('EARSIV') || ft.includes('E_ARSIV') || ft.includes('ARSIV')) return 'e-Arşiv Fatura';
    if (ft.includes('EFATURA') || ft.includes('E_FATURA') || ft === 'FATURA') return 'e-Fatura';
    if (ft.includes('FIS') || ft.includes('OKC')) return 'Yazarkasa Fişi';
    if (ft.includes('IRSALIYE')) return 'İrsaliye';
  }
  // 3) Mesajdan "BT:..." parse et — agent.js mTag/log formatında ekliyor
  if (message) {
    const m = message.match(/\bBT\s*:\s*([^·\n]+?)(?=\s*[·|]|\s+(?:AST|FatT|B\d+)\s*:|$)/i);
    if (m) {
      const v = m[1].trim();
      if (v) return formatBelgeTuru(v);
    }
  }
  // 4) BelgeNo prefix'inden tahmin — agent.js (v1.36.3) ile aynı tablo
  // Türkiye e-Belge formatı: 3 harf + 4 yıl + 9 sıra (toplam 16 char)
  const fisNo = (meta as any)?.fisNo || (meta as any)?.belgeNo;
  if (fisNo) {
    const bn = String(fisNo).toUpperCase().trim();
    // 1) e-Arşiv prefiksleri
    if (/^(BEA|EAR|GIB|EARSIV)/.test(bn)) return 'e-Arşiv Fatura';
    // 2) Yazarkasa fişi
    if (/(FIS|OKC|ZRP)/.test(bn)) return 'Yazarkasa Fişi';
    // 3) e-Fatura — generic 3-4 harf + 4 yıl + sayı
    //    KAA2026..., KE32026..., J812026..., MK12026... gibi tüm yaygın seriler.
    if (/^[A-Z][A-Z0-9]{1,3}20\d{2}\d{6,12}$/.test(bn)) return 'e-Fatura';
    // 4) Eski explicit prefiksler
    if (/^(ABC|AN[A-Z0-9]?|EFA|EFATURA|FAT|F[A-Z0-9]|KAA|KE\d|K3|J\d{2}|MK\d|MUH)/.test(bn)) return 'e-Fatura';
  }
  return undefined;
}
