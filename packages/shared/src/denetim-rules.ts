/**
 * Fatura mevzuat denetim kuralları — Faz 1
 *   1. Tevkifat eksikliği (KDVGUT kısmi tevkifat)
 *   2. İndirilemeyen KDV (binek araç)
 *   3. KDV oranı anomalisi (ilaç/temel gıda)
 */

export interface DenetimUyari {
  kod: string;
  baslik: string;
  mesaj: string;
  siddet: 'hata' | 'uyari' | 'bilgi';
}

export interface DenetimGirdi {
  invoiceKind: 'ALIS' | 'SATIS';
  matrah: number;
  kdvTutari: number;
  giderTuru: string;        // AI'ın kısa hizmet/mal açıklaması
  kalemAciklamalari: string[]; // kalemler[].ad
  muhasebeNeden: string;    // AI yorumu
  kdvOrani: number;         // 1, 10, 20 gibi (yüzde)
  tevkifatVar: boolean;     // belgede tevkifat tespiti var mı?
  /** Demirbaş/sabit kıymet ALIMI (detectFixedAsset). Kısmi tevkifat YALNIZ hizmet ifalarında uygulanır;
   *  bir sabit kıymetin (taşıt/makine/ekipman) SATIN ALINMASI mal teslimidir, tevkifata tabi DEĞİLDİR —
   *  TEVKİFAT kontrolü atlanır (demirbaş + "tevkifat eksik" uyarısı birlikte çıkmasın, mantıksal çelişki). */
  isFixedAsset?: boolean;
}

interface TevkifatKural {
  kod: string;
  ad: string;
  anahtar: string[];       // giderTuru/kalemler/muhasebe yorumunda aranır
  esikKdvDahil: number;   // TL — bu eşiği AŞAN (tam eşik HARİÇ; 12.000,00 muaf, 12.000,01+ zorunlu) tutarda tevkifat
  oran: string;            // '2/10', '9/10' vb. — gösterimde kullanılır
  madde: string;           // KDVGUT maddesi
}

const TEVKIFAT: TevkifatKural[] = [
  {
    kod: 'TEV_NAKL',
    ad: 'Kara taşımacılığı / nakliye',
    anahtar: ['nakliye','taşımacılık','kara taşıma','yük taşıma','lojistik','sevkiyat','nakliyat','yük nakli','taşıma hizmet'],
    esikKdvDahil: 12000,
    oran: '2/10',
    madde: 'KDVGUT I/C-2.1.3.1',
  },
  {
    kod: 'TEV_ISG',
    ad: 'İşgücü temini',
    anahtar: ['işgücü temin','personel temin','işçi temin','eleman temin','geçici personel','geçici işçi'],
    esikKdvDahil: 12000,
    oran: '9/10',
    madde: 'KDVGUT I/C-2.1.3.2.3',
  },
  {
    kod: 'TEV_YEMEK',
    ad: 'Yemek servisi / organizasyon',
    anahtar: ['yemek servisi','yemek hizmeti','catering','ikram hizmeti','tabldot','toplu yemek','organizasyon hizmeti'],
    esikKdvDahil: 12000,
    oran: '5/10',
    madde: 'KDVGUT I/C-2.1.3.2.4',
  },
  {
    kod: 'TEV_YAPIM',
    ad: 'Yapım işleri',
    anahtar: ['inşaat','yapım işi','taahhüt','tadilat','dekorasyon','altyapı işi','çevre düzenleme','sıva boya','boya badana','elektrik tesisat','su tesisat','çatı işi','zemin döşeme'],
    esikKdvDahil: 12000,
    oran: '4/10',
    madde: 'KDVGUT I/C-2.1.3.3.1',
  },
  {
    kod: 'TEV_ETUT',
    ad: 'Etüt / danışmanlık / denetim',
    anahtar: ['danışmanlık hizmeti','müşavirlik hizmeti','etüt hizmeti','fizibilite','kontrollük','proje yönetim','teknik destek hizmet','ekspertiz','yazılım danışman','denetim hizmeti'],
    esikKdvDahil: 12000,
    oran: '9/10',
    madde: 'KDVGUT I/C-2.1.3.2.2',
  },
  {
    kod: 'TEV_MAK',
    ad: 'Makine / teçhizat bakım-onarım',
    anahtar: ['bakım onarım hizmet','makine bakım','teçhizat bakım','teknik servis hizmet','revizyon hizmet','periyodik bakım','klima bakım','asansör bakım','jeneratör bakım','ekipman bakım'],
    esikKdvDahil: 12000,
    oran: '7/10', // BDP/Mihsap resmî liste teyidi 2026-07-18 (kod 203)
    madde: 'KDVGUT I/C-2.1.3.2.5',
  },
  {
    kod: 'TEV_TEMP',
    ad: 'Temizlik / çevre bakım',
    anahtar: ['temizlik hizmeti','temizlik şirket','bahçe bakım hizmeti','çevre bakım hizmeti','dezenfeksiyon hizmeti','haşere ilaçlama'],
    esikKdvDahil: 12000,
    oran: '9/10', // BDP/Mihsap resmî liste teyidi 2026-07-18 (kod 212/213)
    madde: 'KDVGUT I/C-2.1.3.2.1',
  },
  {
    kod: 'TEV_GUV',
    ad: 'Özel güvenlik',
    anahtar: ['güvenlik hizmeti','özel güvenlik','güvenlik personel','koruma hizmeti'],
    esikKdvDahil: 12000,
    oran: '9/10', // BDP/Mihsap resmî liste teyidi 2026-07-18 (kod 207)
    madde: 'KDVGUT I/C-2.1.3.2.1',
  },
  {
    kod: 'TEV_REKLAM',
    ad: 'Ticari reklam',
    anahtar: ['reklam hizmeti','tanıtım filmi','reklam ajansı','dijital reklam','billboard','medya satın alma'],
    esikKdvDahil: 12000,
    oran: '3/10',
    madde: 'KDVGUT I/C-2.1.3.2.6',
  },
  {
    kod: 'TEV_YAPI_DEN',
    ad: 'Yapı denetim',
    anahtar: ['yapı denetim','bina denetim'],
    esikKdvDahil: 12000,
    oran: '9/10',
    madde: 'KDVGUT I/C-2.1.3.2.2',
  },
];

function trNorm(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
    .replace(/ö/g,'o').replace(/ç/g,'c').replace(/ı/g,'i')
    .replace(/İ/g,'i').replace(/Ğ/g,'g').replace(/Ü/g,'u')
    .replace(/Ş/g,'s').replace(/Ö/g,'o').replace(/Ç/g,'c');
}

function iceriyor(kaynak: string, anahtar: string[]): boolean {
  const k = trNorm(kaynak);
  return anahtar.some(a => k.includes(trNorm(a)));
}

export function denetimUyariOlustur(p: DenetimGirdi): DenetimUyari[] {
  const uyarilar: DenetimUyari[] = [];
  const totalKdvDahil = p.matrah + p.kdvTutari;

  // Geniş arama metni: giderTuru + kalem adları + muhasebe yorumu
  const aramaMetni = [p.giderTuru, ...p.kalemAciklamalari, p.muhasebeNeden].filter(Boolean).join(' ');
  // TEVKİFAT için YALNIZ satın alınan şeyin metni (giderTuru + kalemler). muhasebeNeden
  //   MÜKELLEFİN SEKTÖRÜNÜ anlatıyor ("Nakliyat işletmesinin araçları için lastik…") → içindeki
  //   "nakliye/nakliyat" kelimesi LASTİK ALIMINI "nakliye hizmeti" sanıp YANLIŞ tevkifat uyarısı
  //   üretiyordu. Tevkifat satın alınan HİZMETE bağlıdır, alıcının sektörüne değil.
  const hizmetMetni = [p.giderTuru, ...p.kalemAciklamalari].filter(Boolean).join(' ');

  // ─── 1. TEVKİFAT DENETİMİ ──────────────────────────────────────────────
  // KDV dahil eşik aşıldı + içerik tevkifatlı hizmet türüne uyuyor + belgede tevkifat yok
  // DEMİRBAŞ/SABİT KIYMET ALIMI ise kısmi tevkifat UYGULANMAZ (mal teslimi, hizmet ifası değil) —
  //   "demirbaş + tevkifat eksik" mantıksal çelişkisi (kullanıcı bulgusu: yarı römork SATIN ALIMI
  //   "kara taşımacılığı hizmeti" sanılıp tevkifat istenmişti) → kontrolü baştan atla.
  for (const kural of !p.isFixedAsset ? TEVKIFAT : []) {
    // KDVGUT: sınır "12.000 TL'yi AŞAN" — tam 12.000,00 tevkifata tabi DEĞİL (kullanıcı teyidi 2026-07-18).
    if (totalKdvDahil > kural.esikKdvDahil && iceriyor(hizmetMetni, kural.anahtar)) {
      if (!p.tevkifatVar) {
        uyarilar.push({
          kod: kural.kod + '_EKSIK',
          baslik: 'Tevkifat eksik',
          mesaj: `${kural.ad} hizmeti için KDV dahil ${kural.esikKdvDahil.toLocaleString('tr-TR')} TL eşiği aşıldı — ${kural.oran} oranında tevkifat uygulanmalıdır (${kural.madde}).`,
          siddet: 'hata',
        });
      }
      break; // ilk eşleşen kural yeterli; çift uyarı üretme
    }
  }

  // ─── 2. İNDİRİLEMEYEN KDV ──────────────────────────────────────────────
  // Binek araç alımında KDV indirilemez (KDV K. md. 30/b) — sadece ALIŞ
  if (p.invoiceKind === 'ALIS' && p.kdvTutari > 0) {
    const binekAnahtar = ['binek araç','binek otomobil','binek taşıt','otomobil kiralama','binek araç kiralama','sedan kiralama','binek araç alım'];
    const ticariExclude = ['kamyon','kamyonet','minibüs','ticari araç','çekici','panelvan','tır'];
    if (iceriyor(aramaMetni, binekAnahtar) && !iceriyor(aramaMetni, ticariExclude)) {
      uyarilar.push({
        kod: 'INDIRME_BINEK',
        baslik: 'İndirilemeyen KDV',
        mesaj: 'Binek araçlarda ödenen KDV indirilemez (KDV K. md. 30/b). İstisna: fiilen ticari faaliyette kullanılan araçlar.',
        siddet: 'uyari',
      });
    }
  }

  // ─── 3. KDV ORANI ANOMALİSİ ────────────────────────────────────────────
  if (p.kdvOrani > 0) {
    // İlaç / eczane → %10 KDV olmalı (sadece giderTuru üzerinde kontrol — yanlış alarm minimizasyonu)
    if (iceriyor(p.giderTuru, ['ilaç','eczane','ecza deposu','ilaç deposu']) && p.kdvOrani !== 10) {
      uyarilar.push({
        kod: 'KDV_ORAN_ILAC',
        baslik: 'KDV oranı şüpheli',
        mesaj: `İlaç / eczane ürünleri %10 KDV'ye tabidir; belgede %${p.kdvOrani} görünüyor — kontrol edin.`,
        siddet: 'uyari',
      });
    }
    // Temel gıda → %1 KDV olmalı (sadece giderTuru — kalem bazlı olduğu için dar tut)
    if (iceriyor(p.giderTuru, ['ekmek','yaş meyve','yaş sebze','taze sebze','taze meyve','kırmızı et','kuru baklagil','mercimek','bulgur']) && p.kdvOrani !== 1) {
      uyarilar.push({
        kod: 'KDV_ORAN_GIDA',
        baslik: 'KDV oranı şüpheli',
        mesaj: `Temel gıda ürünleri %1 KDV'ye tabidir; belgede %${p.kdvOrani} görünüyor — kalem bazlı kontrol gerekebilir.`,
        siddet: 'bilgi',
      });
    }
  }

  return uyarilar;
}
