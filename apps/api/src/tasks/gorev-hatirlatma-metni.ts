/**
 * GÖREV HATIRLATMA — WhatsApp / e-posta METNİ (saf, 2026-09-14).
 *
 * Muzaffer Bey: "görev hatırlatma günü geldiğinde WhatsApp'tan hangi şablonda bildirecek?" → ilk sürümü beğenmedi
 * ("daha güzel, daha şık, daha orijinal bir şey olsun") → bu sürüm: WhatsApp biçimlendirmesi (*kalın*, _eğik_), tarih satırı,
 * ince çizgi, selamlama (günaydın / iyi günler / iyi akşamlar), ① ② ③ numaralı BUGÜN listesi, ▸ YAKLAŞAN / GECİKEN,
 * altta portal bağlantısı ve "Elif · Moren Ofis Asistanı" imzası. Emoji yalnız başlıkta ve ACİL noktasında.
 *
 * Motor, o tikte zamanı gelen olayları ALICI BAŞINA tek mesajda toplar (owner-notifier'ın genel "📢 OTOMATİK BİLDİRİM"
 * biçimi ve 10 sn tip-debounce'u KULLANILMAZ). Alıcı: sahip ("Muzaffer Bey") ve görevde seçilen ofis personeli
 * ("Sayın Ad Soyad").
 */
export type HatirlatmaTipi = 'ONCEDEN' | 'VADE' | 'GECIKME';

export interface HatirlatmaKalemi {
  id: string;
  baslik: string;
  tip: HatirlatmaTipi;
  /** İstanbul günü, YYYY-MM-DD */
  vadeGunu: string | null;
  /** HH:mm */
  saat?: string | null;
  gecikmeGun?: number | null;
  mukellef?: string | null;
  kategori?: string | null;
  oncelik?: string | null;
  aciklama?: string | null;
}

export interface HatirlatmaAlicisi {
  /** "Muzaffer Bey" / "Sayın Büşra Nur Ören" */
  hitap: string;
  /** Alt imza; verilmezse "Elif · Moren Ofis Asistanı" */
  imza?: string;
}

const KATEGORI_AD: Record<string, string> = {
  BEYANNAME: 'Beyanname', KDV_KONTROL: 'KDV Kontrol', EVRAK: 'Evrak', BANKA: 'Banka', TAHSILAT: 'Tahsilat',
  MUKELLEF: 'Mükellef görüşmesi', BORDRO: 'Bordro/SGK', OFIS: 'Ofis', DIGER: 'Diğer', AI_REMINDER: 'AI hatırlatma',
};
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const NUMARALAR = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const CIZGI = '━━━━━━━━━━━━━━━━━━━━';
export const VARSAYILAN_IMZA = 'Elif · Moren Ofis Asistanı';

export function kategoriAdi(k?: string | null): string {
  if (!k) return '';
  // kodlar ASCII: MIHSAP → Mihsap (tr-TR küçültme "mıhsap" yapardı)
  return KATEGORI_AD[k] || String(k).replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

/** YYYY-MM-DD → "08.09.2026" */
export function trTarih(gun: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(gun || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(gun || '');
}

/** YYYY-MM-DD → "08.09" */
function kisaTarih(gun: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(gun || ''));
  return m ? `${m[3]}.${m[2]}` : String(gun || '');
}

function gunAdi(gun: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(gun || ''));
  if (!m) return '';
  return GUNLER[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] || '';
}

function istanbulParcalar(simdi: Date): { gun: string; saat: string; dakika: number; sayiSaat: number; gunAdi: string; ay: string; yil: string; gunNo: string } {
  const p = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(simdi);
  const al = (t: string) => p.find((x) => x.type === t)?.value || '';
  const gun = `${al('year')}-${al('month')}-${al('day')}`;
  return { gun, saat: `${al('hour')}:${al('minute')}`, dakika: Number(al('minute')), sayiSaat: Number(al('hour')), gunAdi: gunAdi(gun), ay: AYLAR[Number(al('month')) - 1] || '', yil: al('year'), gunNo: String(Number(al('day'))) };
}

/** İstanbul "14.09.2026 09:00" (e-posta konusu / günlük için) */
export function istanbulZamanMetni(simdi: Date): string {
  const p = istanbulParcalar(simdi);
  return `${trTarih(p.gun)} ${p.saat}`;
}

function selam(sayiSaat: number): string {
  if (sayiSaat < 12) return 'günaydın';
  if (sayiSaat < 17) return 'iyi günler';
  return 'iyi akşamlar';
}

function ertesiGun(gun: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(gun);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return d.toISOString().slice(0, 10);
}

function oncelikMetni(oncelik?: string | null): string {
  if (oncelik === 'URGENT') return '🔴 Acil';
  if (oncelik === 'HIGH') return 'Yüksek';
  return '';
}

function kalemSatirlari(k: HatirlatmaKalemi, imlec: string, bugun: string): string[] {
  const ad = `${imlec} ${k.mukellef ? `*${k.mukellef}* — ` : ''}${k.baslik}`;
  const parcalar: string[] = [];
  if (k.tip === 'VADE') parcalar.push(k.saat ? k.saat : 'Tüm gün');
  else if (k.tip === 'ONCEDEN') {
    const yarin = k.vadeGunu === ertesiGun(bugun);
    parcalar.push(`${yarin ? 'Yarın, ' : ''}${gunAdi(k.vadeGunu)} ${kisaTarih(k.vadeGunu)}${k.saat ? ' ' + k.saat : ''}`.trim());
  } else parcalar.push(`${k.gecikmeGun || 0} gündür bekliyor · vade ${kisaTarih(k.vadeGunu)}`);
  const onc = oncelikMetni(k.oncelik);
  if (onc) parcalar.push(onc);
  const kat = kategoriAdi(k.kategori);
  if (kat) parcalar.push(kat);
  const satirlar = [ad, `    ${parcalar.join(' · ')}`];
  const not = String(k.aciklama || '').replace(/\s+/g, ' ').trim();
  if (not) satirlar.push(`    _${not.length > 120 ? not.slice(0, 117) + '…' : not}_`);
  return satirlar;
}

/**
 * Tek alıcı için tek mesaj. Bölümler: BUGÜN (numaralı) → YAKLAŞAN (vade gününe göre) → GECİKEN (gün ↓).
 * `ornek=true` başlığa "(ÖRNEK)" ekler ve altta uyarı bırakır — deneme gönderimi gerçek sanılmasın.
 */
export function hatirlatmaMesaji(alici: HatirlatmaAlicisi, kalemler: HatirlatmaKalemi[], simdi: Date, portalUrl: string, ornek = false): string {
  const p = istanbulParcalar(simdi);
  const bugun = kalemler.filter((k) => k.tip === 'VADE');
  const yakin = kalemler.filter((k) => k.tip === 'ONCEDEN').sort((a, b) => String(a.vadeGunu).localeCompare(String(b.vadeGunu)));
  const geciken = kalemler.filter((k) => k.tip === 'GECIKME').sort((a, b) => (b.gecikmeGun || 0) - (a.gecikmeGun || 0));

  const ozet: string[] = [];
  if (bugun.length) ozet.push(`Bugün *${bugun.length} görev*`);
  if (yakin.length) ozet.push(`${yakin.length} yaklaşan`);
  if (geciken.length) ozet.push(`${geciken.length} geciken`);
  const ozetMetni = ozet.length
    ? (ozet[0].startsWith('Bugün') ? ozet.join(', ') : ozet.join(', ').replace(/^./, (c) => c.toLocaleUpperCase('tr-TR'))) + ' var.'
    : 'Bugün için hatırlatma yok.';

  const s: string[] = [];
  s.push(`🗓️ *GÖREV HATIRLATMA${ornek ? ' (ÖRNEK)' : ''}*`);
  s.push(`${p.gunAdi}, ${p.gunNo} ${p.ay} ${p.yil} · ${p.saat}`);
  s.push(CIZGI);
  s.push(`${alici.hitap}, ${selam(p.sayiSaat)}.`);
  s.push(ozetMetni);
  if (bugun.length) {
    s.push('', '*BUGÜN*');
    bugun.forEach((k, i) => s.push(...kalemSatirlari(k, NUMARALAR[i] || '•', p.gun)));
  }
  if (yakin.length) {
    s.push('', '*YAKLAŞAN*');
    yakin.forEach((k) => s.push(...kalemSatirlari(k, '▸', p.gun)));
  }
  if (geciken.length) {
    s.push('', '*GECİKEN*');
    geciken.forEach((k) => s.push(...kalemSatirlari(k, '▸', p.gun)));
  }
  s.push('', CIZGI);
  s.push(`Görevler → ${portalUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/panel/gorevler`);
  s.push(`_${alici.imza || VARSAYILAN_IMZA}_`);
  if (ornek) s.push('', '_Bu bir şablon denemesidir; içerik gerçek değildir._');
  return s.join('\n');
}

/** Deneme gönderimi için örnek kalemler (gerçek görev değil). Tarihler `simdi`ye göre (bugün / yarın / 6 gün önce). */
export function ornekKalemler(simdi: Date = new Date()): HatirlatmaKalemi[] {
  const p = istanbulParcalar(simdi);
  const bugun = p.gun;
  const yarin = ertesiGun(bugun);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bugun)!;
  const altiGunOnce = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 6)).toISOString().slice(0, 10);
  return [
    { id: 'ornek-1', baslik: 'Ağustos KDV kontrolü', tip: 'VADE', vadeGunu: bugun, saat: '10:00', mukellef: 'Öz Ela Gıda', kategori: 'KDV_KONTROL', oncelik: 'URGENT', aciklama: 'Devreden KDV Luca ile karşılaştırılacak' },
    { id: 'ornek-2', baslik: 'Tahsilat araması', tip: 'VADE', vadeGunu: bugun, saat: null, mukellef: 'Famcoffee', kategori: 'TAHSILAT', oncelik: 'MEDIUM' },
    { id: 'ornek-3', baslik: 'Banka ekstresi iste', tip: 'ONCEDEN', vadeGunu: yarin, saat: null, mukellef: 'Erdoğan Balçık', kategori: 'BANKA', oncelik: 'HIGH' },
    { id: 'ornek-4', baslik: 'Sermaye artırımı raporu', tip: 'GECIKME', vadeGunu: altiGunOnce, gecikmeGun: 6, mukellef: 'Sultan Osman İnşaat', kategori: 'DIGER', oncelik: 'URGENT' },
  ];
}
