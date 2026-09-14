/**
 * GÖREV HATIRLATMA KURALI — saf hesap (2026-09-14, Faz 2).
 *
 * Eski durum: yalnız 07:00 e-posta cron'u (e-posta seçili + vade bugün/yarın) → hiç hatırlatma gitmemişti.
 * Yeni kural (Muzaffer Bey kararı: portal bildirimi + telefon push + WhatsApp varsayılan):
 *   - ÖNCEDEN : vadeden 1 gün önce 09:00 (reminderConfig.beforeOffsets varsa onlar; gün/saat/dakika)
 *   - VADE    : vade günü — saat verilmişse 30 dk önce, yoksa 09:00
 *   - GECİKME : vade geçtikten 1, 3 ve 7 gün sonra 09:00 (bitmemişse); 7'den sonra her 7 günde bir (en çok 5 tur)
 * Her olay bir kez gider: anahtar `tip:YYYY-MM-DD` (TaskReminderLog'a yazılır). Sessiz saat / kanal seçimi bildirim
 * katmanında (owner-notifier gece erteleme, push 22–08) — burada yalnız "şimdi hangi olaylar zamanı geldi".
 */
import { gunAnahtari, istanbulGunu } from './gorev-tekrar';

export interface HatirlatmaGorevi {
  id: string;
  title: string;
  status: string;
  dueDate: Date | string | null;
  dueTime?: string | null; // "HH:mm"
  priority?: string | null;
  reminderConfig?: any;
  taxpayerAd?: string | null;
}

export interface HatirlatmaOlayi {
  tip: 'ONCEDEN' | 'VADE' | 'GECIKME';
  /** tekilleştirme anahtarı: tip:YYYY-MM-DD (vade gününe göre) */
  anahtar: string;
  /** olayın planlandığı an (İstanbul) — şimdi bundan sonraysa "zamanı geldi" */
  planlanan: Date;
  baslik: string;
  govde: string;
  gecikmeGun?: number;
}

const AKTIF = new Set(['OPEN', 'IN_PROGRESS', 'SNOOZED']);
const VARSAYILAN_SAAT = 9; // 09:00 İstanbul

/** İstanbul'da belirli gün + saat:dakika → Date (UTC) */
export function istanbulSaat(gun: Date, saat: number, dakika = 0): Date {
  // gun: UTC gece yarısı takvim günü; İstanbul UTC+3 sabit (yaz saati uygulanmıyor)
  return new Date(gun.getTime() + (saat - 3) * 3600000 + dakika * 60000);
}

function saatParcala(dueTime?: string | null): { saat: number; dakika: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(dueTime || '').trim());
  if (!m) return null;
  const saat = Number(m[1]); const dakika = Number(m[2]);
  if (saat < 0 || saat > 23 || dakika < 0 || dakika > 59) return null;
  return { saat, dakika };
}

function vadeMetni(gorev: HatirlatmaGorevi, vadeGunu: Date): string {
  const t = `${vadeGunu.getUTCDate()}.${String(vadeGunu.getUTCMonth() + 1).padStart(2, '0')}.${vadeGunu.getUTCFullYear()}`;
  return gorev.dueTime ? `${t} ${gorev.dueTime}` : t;
}

/**
 * Şimdiye kadar zamanı gelmiş TÜM olaylar (gönderilmiş olanları çağıran anahtarla eler).
 * Sıra: en yeni planlanan sonda. Bitmiş/iptal görev → boş. Vadesiz görev → boş.
 */
export function hatirlatmaOlaylari(gorev: HatirlatmaGorevi, simdi: Date): HatirlatmaOlayi[] {
  if (!gorev || !AKTIF.has(String(gorev.status || ''))) return [];
  if (!gorev.dueDate) return [];
  const vadeGunu = istanbulGunu(new Date(gorev.dueDate));
  if (Number.isNaN(vadeGunu.getTime())) return [];
  const bugun = istanbulGunu(simdi);
  const gunFarki = Math.round((bugun.getTime() - vadeGunu.getTime()) / 86400000); // + = gecikme
  const kim = gorev.taxpayerAd ? ` · ${gorev.taxpayerAd}` : '';
  const acil = gorev.priority === 'URGENT' ? 'ACİL · ' : '';
  const cikti: HatirlatmaOlayi[] = [];

  // ÖNCEDEN
  const offsets: Array<{ minutes?: number; hours?: number; days?: number; weeks?: number }> =
    Array.isArray(gorev.reminderConfig?.beforeOffsets) && gorev.reminderConfig.beforeOffsets.length
      ? gorev.reminderConfig.beforeOffsets
      : [{ days: 1 }];
  const vadeAni = (() => { const s = saatParcala(gorev.dueTime); return s ? istanbulSaat(vadeGunu, s.saat, s.dakika) : istanbulSaat(vadeGunu, VARSAYILAN_SAAT); })();
  for (const o of offsets) {
    const dk = (o.minutes || 0) + (o.hours || 0) * 60 + (o.days || 0) * 1440 + (o.weeks || 0) * 10080;
    if (dk <= 0) continue;
    let planlanan = new Date(vadeAni.getTime() - dk * 60000);
    // yalnız gün verilmişse (saat yok) sabah 09:00'a sabitle
    if (!saatParcala(gorev.dueTime) && (o.days || o.weeks) && !o.hours && !o.minutes) planlanan = istanbulSaat(istanbulGunu(planlanan), VARSAYILAN_SAAT);
    if (planlanan.getTime() <= simdi.getTime() && gunFarki <= 0) {
      cikti.push({ tip: 'ONCEDEN', anahtar: `ONCEDEN:${gunAnahtari(istanbulGunu(planlanan))}`, planlanan, baslik: `${acil}Yaklaşıyor: ${gorev.title}`, govde: `Vade ${vadeMetni(gorev, vadeGunu)}${kim}` });
    }
  }
  // VADE (vade günü)
  {
    const s = saatParcala(gorev.dueTime);
    const planlanan = s ? new Date(istanbulSaat(vadeGunu, s.saat, s.dakika).getTime() - 30 * 60000) : istanbulSaat(vadeGunu, VARSAYILAN_SAAT);
    if (gunFarki === 0 && planlanan.getTime() <= simdi.getTime()) {
      cikti.push({ tip: 'VADE', anahtar: `VADE:${gunAnahtari(vadeGunu)}`, planlanan, baslik: `${acil}Bugün vadesi: ${gorev.title}`, govde: `${gorev.dueTime ? 'Saat ' + gorev.dueTime : 'Bugün'}${kim}` });
    }
  }
  // GECİKME: 1, 3, 7 ve sonra her 7 gün (14, 21, 28, 35)
  if (gunFarki >= 1) {
    const kademeler = [1, 3, 7, 14, 21, 28, 35];
    for (const g of kademeler) {
      if (g > gunFarki) break;
      const gun = new Date(vadeGunu.getTime() + g * 86400000);
      const planlanan = istanbulSaat(gun, VARSAYILAN_SAAT);
      if (planlanan.getTime() <= simdi.getTime()) {
        cikti.push({ tip: 'GECIKME', gecikmeGun: g, anahtar: `GECIKME:${gunAnahtari(gun)}`, planlanan, baslik: `${acil}${g} gün gecikti: ${gorev.title}`, govde: `Vade ${vadeMetni(gorev, vadeGunu)} idi${kim}` });
      }
    }
  }
  return cikti;
}

/** Zamanı gelmiş olaylardan yalnız EN SON olanı gönderilir (birikmiş eski günleri tek tek göndermemek için). */
export function gonderilecekOlay(olaylar: HatirlatmaOlayi[], gonderilmisAnahtarlar: Set<string>): HatirlatmaOlayi | null {
  if (!olaylar.length) return null;
  // En son planlanan olay esastır: o gönderildiyse daha eski olaylar da (artık anlamsız) gönderilmez.
  const enSon = olaylar.reduce((a, b) => (b.planlanan.getTime() >= a.planlanan.getTime() ? b : a));
  return gonderilmisAnahtarlar.has(enSon.anahtar) ? null : enSon;
}
