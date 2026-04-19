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
 * Bir AgentEvent'i 6-alan tablosuna çevirir:
 *   Tarih, Belge Türü, Toplam Tutar, Matrah, KDV, Cari
 *
 * Header bilgileri (Tarih, Belge Türü, Tutar) event'in kendi
 * field'larından gelir; Matrah/KDV/Cari ise mesajdaki AI önerisinden.
 */
export function buildFieldRows(event: {
  ts?: string | Date;
  action?: string;
  tutar?: number | string;
  hesapKodu?: string;
  kdv?: string;
  message?: string;
  meta?: any;
}, parsed: ParsedAgentMessage): FieldRow[] {
  const rows: FieldRow[] = [];

  // Tarih (event.ts)
  if (event.ts) {
    const d = new Date(event.ts);
    rows.push({
      label: 'Tarih',
      status: 'full',
      value: d.toLocaleDateString('tr-TR'),
    });
  }

  // Belge Türü — action'dan türet
  const belgeTuru = inferBelgeTuru(event.action, event.meta);
  if (belgeTuru) {
    rows.push({ label: 'Belge Türü', status: 'full', value: belgeTuru });
  }

  // Toplam Tutar
  if (event.tutar != null && event.tutar !== '') {
    const n = Number(event.tutar);
    if (Number.isFinite(n)) {
      rows.push({
        label: 'Toplam Tutar',
        status: 'full',
        value: `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`,
      });
    }
  }

  // Matrah / KDV / Cari — boş alan + öneri durumuna göre
  const checkField = (label: 'Matrah' | 'KDV' | 'Cari', existingValue?: string) => {
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
    // Hiçbir bilgi yok — atla (gösterme), ya da varsayılan dolu göster
    if (existingValue) {
      rows.push({ label, status: 'full', value: existingValue });
    }
  };

  checkField('Matrah', event.hesapKodu);
  checkField('KDV', event.kdv);
  checkField('Cari');

  return rows;
}

function inferBelgeTuru(action?: string, meta?: any): string | undefined {
  if (meta?.belgeTuru) return String(meta.belgeTuru);
  if (!action) return undefined;
  const a = action.toLowerCase();
  if (a.includes('alis')) return a.includes('isletme') ? 'İşl. Defteri Alış' : 'Bilanço Alış';
  if (a.includes('satis')) return a.includes('isletme') ? 'İşl. Defteri Satış' : 'Bilanço Satış';
  return action;
}
