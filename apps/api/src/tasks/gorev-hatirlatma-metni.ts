/**
 * GÖREV HATIRLATMA — WhatsApp / e-posta METNİ (saf, 2026-09-14).
 *
 * Muzaffer Bey'in sorusu: "görev hatırlatma günü geldiğinde WhatsApp'tan bana nasıl bildirecek, hangi şablonda?"
 * Cevap: motor, o tikte zamanı gelen olayları ALICI BAŞINA tek mesajda toplar (owner-notifier'ın genel
 * "📢 OTOMATİK BİLDİRİM" biçimi ve 10 sn tip-debounce'u KULLANILMAZ — 3 görev 3 ayrı mesaj olmasın, ilk mesaj
 * sonrakileri yutmasın). Bölümler: BUGÜN · YAKLAŞIYOR · GECİKEN. Alıcı: sahip (hitap "Muzaffer Bey") ve görevde
 * seçilen ofis personeli ("Sayın Ad Soyad"). Sonda portal bağlantısı.
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

const KATEGORI_AD: Record<string, string> = {
  BEYANNAME: 'Beyanname', KDV_KONTROL: 'KDV Kontrol', EVRAK: 'Evrak', BANKA: 'Banka', TAHSILAT: 'Tahsilat',
  MUKELLEF: 'Mükellef görüşmesi', BORDRO: 'Bordro/SGK', OFIS: 'Ofis', DIGER: 'Diğer', AI_REMINDER: 'AI hatırlatma',
};
const ONCELIK_AD: Record<string, string> = { URGENT: 'ACİL', HIGH: 'Yüksek', MEDIUM: '', LOW: 'Düşük' };
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export function kategoriAdi(k?: string | null): string {
  if (!k) return '';
  // kodlar ASCII: MIHSAP → Mihsap (tr-TR küçültme "mıhsap" yapardı)
  return KATEGORI_AD[k] || String(k).replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

/** YYYY-MM-DD → "16.09.2026" */
export function trTarih(gun: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(gun || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(gun || '');
}

function gunAdi(gun: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(gun || ''));
  if (!m) return '';
  return GUNLER[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] || '';
}

/** İstanbul "14.09.2026 09:00" */
export function istanbulZamanMetni(simdi: Date): string {
  const p = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(simdi);
  const al = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${al('day')}.${al('month')}.${al('year')} ${al('hour')}:${al('minute')}`;
}

function kalemSatiri(k: HatirlatmaKalemi, sira: number | null): string[] {
  const bas = sira ? `${sira}) ` : '• ';
  const adSatiri = `${bas}${k.mukellef ? `${k.mukellef} — ` : ''}${k.baslik}`;
  const parcalar: string[] = [];
  if (k.tip === 'GECIKME') parcalar.push(`${k.gecikmeGun || 0} gün gecikti (vade ${trTarih(k.vadeGunu)})`);
  else if (k.tip === 'VADE') parcalar.push(k.saat ? `Bugün saat ${k.saat}` : 'Bugün');
  else parcalar.push(`${trTarih(k.vadeGunu)} ${gunAdi(k.vadeGunu)}${k.saat ? ' ' + k.saat : ''}`.trim());
  const onc = ONCELIK_AD[String(k.oncelik || '')] || '';
  if (onc) parcalar.push(onc);
  const kat = kategoriAdi(k.kategori);
  if (kat) parcalar.push(kat);
  const satirlar = [adSatiri, `   ${parcalar.join(' · ')}`];
  const not = String(k.aciklama || '').replace(/\s+/g, ' ').trim();
  if (not) satirlar.push(`   Not: ${not.length > 140 ? not.slice(0, 137) + '…' : not}`);
  return satirlar;
}

export interface HatirlatmaAlicisi {
  /** "Muzaffer Bey" / "Sayın Büşra Nur Ören" */
  hitap: string;
}

/**
 * Tek alıcı için tek mesaj. Kalemler tip'e göre bölümlenir; sıralama: bugün → yaklaşan (vade günü) → geciken (gün ↓).
 * `ornek=true` başlığa "(ÖRNEK)" ekler — deneme gönderimi gerçek sanılmasın.
 */
export function hatirlatmaMesaji(alici: HatirlatmaAlicisi, kalemler: HatirlatmaKalemi[], simdi: Date, portalUrl: string, ornek = false): string {
  const bugun = kalemler.filter((k) => k.tip === 'VADE');
  const yakin = kalemler.filter((k) => k.tip === 'ONCEDEN').sort((a, b) => String(a.vadeGunu).localeCompare(String(b.vadeGunu)));
  const geciken = kalemler.filter((k) => k.tip === 'GECIKME').sort((a, b) => (b.gecikmeGun || 0) - (a.gecikmeGun || 0));
  const ozet: string[] = [];
  if (bugun.length) ozet.push(`bugün ${bugun.length} görev`);
  if (yakin.length) ozet.push(`${yakin.length} yaklaşan`);
  if (geciken.length) ozet.push(`${geciken.length} geciken`);

  const satirlar: string[] = [];
  satirlar.push(`⏰ GÖREV HATIRLATMA${ornek ? ' (ÖRNEK)' : ''} · ${istanbulZamanMetni(simdi)}`);
  satirlar.push(`${alici.hitap}, ${ozet.length ? ozet.join(', ') + ' var.' : 'hatırlatma yok.'}`);
  if (bugun.length) {
    satirlar.push('', '📌 BUGÜN');
    bugun.forEach((k, i) => satirlar.push(...kalemSatiri(k, bugun.length > 1 ? i + 1 : null)));
  }
  if (yakin.length) {
    satirlar.push('', '🔜 YAKLAŞIYOR');
    yakin.forEach((k) => satirlar.push(...kalemSatiri(k, null)));
  }
  if (geciken.length) {
    satirlar.push('', '⚠️ GECİKEN');
    geciken.forEach((k) => satirlar.push(...kalemSatiri(k, null)));
  }
  satirlar.push('', `🔗 Görevler: ${portalUrl.replace(/\/+$/, '')}/panel/gorevler`);
  if (ornek) satirlar.push('ℹ️ Bu bir şablon denemesidir; içerik gerçek değildir.');
  return satirlar.join('\n');
}

/** Deneme gönderimi için örnek kalemler (gerçek görev değil). */
export function ornekKalemler(): HatirlatmaKalemi[] {
  return [
    { id: 'ornek-1', baslik: 'Ağustos KDV kontrolü', tip: 'VADE', vadeGunu: '2026-09-14', saat: '10:00', mukellef: 'Öz Ela Gıda', kategori: 'KDV_KONTROL', oncelik: 'URGENT', aciklama: 'Devreden KDV Luca ile karşılaştırılacak' },
    { id: 'ornek-2', baslik: 'Tahsilat araması', tip: 'VADE', vadeGunu: '2026-09-14', saat: null, mukellef: 'Famcoffee', kategori: 'TAHSILAT', oncelik: 'MEDIUM' },
    { id: 'ornek-3', baslik: 'Banka ekstresi iste', tip: 'ONCEDEN', vadeGunu: '2026-09-15', saat: null, mukellef: 'Erdoğan Balçık', kategori: 'BANKA', oncelik: 'HIGH' },
    { id: 'ornek-4', baslik: 'Sermaye artırımı raporu', tip: 'GECIKME', vadeGunu: '2026-09-08', gecikmeGun: 6, mukellef: 'Sultan Osman İnşaat', kategori: 'DIGER', oncelik: 'URGENT' },
  ];
}
