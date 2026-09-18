/**
 * Gösterge paneli selamı + saatte bir değişen kısa motivasyon cümlesi.
 * AI yok: hazır havuz; seçim gün+saat'e bağlı (aynı saat içinde sabit, her saat farklı).
 */

export function selam(saat: number): string {
  if (saat >= 5 && saat < 11) return 'Günaydın';
  if (saat >= 11 && saat < 17) return 'İyi günler';
  if (saat >= 17 && saat < 22) return 'İyi akşamlar';
  return 'İyi geceler';
}

const HAVUZ: string[] = [
  'Küçük adımlar, büyük dosyaları kapatır.',
  'Bugün bir işi bitirmek, yarın iki işi hafifletir.',
  'Sırayı sakin tut; liste kendiliğinden kısalır.',
  'Zor olanı sabah yap, öğleden sonra hafifler.',
  'Her kapanan dosya, bir mükellefin huzurudur.',
  'Düzen, aceleden hızlıdır.',
  'Bir telefon, on yazışmadan kısadır.',
  'Bugünün işi bugünün; yarına yalnız yarının işi kalsın.',
  'Kontrol etmek, düzeltmekten ucuzdur.',
  'Önce en yakın son tarih, sonra en büyük tutar.',
  'İyi bir gün, temiz bir listeyle başlar.',
  'Bekleyen evrak kendi kendine gelmez; kısa bir hatırlatma yeter.',
  'Sakin ofis, doğru beyanname demektir.',
  'Bugün yapılan bir kontrol, ay sonunda bir gece uykusudur.',
  'Karmaşık görünen iş, üç parçaya bölünce kolaylaşır.',
  'Not almak, hatırlamaya çalışmaktan iyidir.',
  'Bir mükellefi arayıp bilgi vermek, güvenin en kısa yoludur.',
  'Erken başlayan, son güne kalmaz.',
  'Eksik belge bugün istenir, yarın gelir.',
  'Hesaplar tutunca gün de tutar.',
  'Rutin sıkıcı görünür ama ofisi ayakta tutan odur.',
  'Bir işi iki kez yapmamak için bir kez doğru yap.',
  'En verimli saat, telefonun sustuğu saattir.',
  'Bugün küçük bir düzen kur; hafta kendini toplar.',
  'Takılan bir dosya, sorulmamış bir sorudur.',
  'Zamanında yapılan iş, sessizce takdir edilir.',
  'Kısa mola, uzun hata önler.',
  'Dosya kapatmak da bir tahsilattır: zaman tahsilatı.',
  'Bir sonraki adımı bilmek, yükü yarıya indirir.',
  'Yalnız acil olanı değil, önemli olanı da bugün yap.',
  'İyi hazırlık, ay sonu telaşını siler.',
  'Her mükellef bir hikâye; düzgün defter iyi anlatıcıdır.',
  'Bir işi bitirmenin en iyi zamanı, başladığın gündür.',
  'Gecikmiş bir görev, bugün yapılınca gecikmiş olmaz.',
  'Sıraya koyduğun iş, kafanı boşaltır.',
  'Kalabalık listeyi değil, ilk satırı düşün.',
  'Söz verilen tarih, tutulan tarih olsun.',
  'Bugün bir hatayı yakalamak, yarın bir cezayı önler.',
  'Az konuş, net yaz, doğru hesapla.',
  'Sabah sakinliği, günün en değerli sermayesidir.',
  'Bir mükellefe bugün ulaş; yarın o sana ulaşır.',
  'Dosyalar bekler, son tarih beklemez.',
  'Küçük bir düzeltme bugün, büyük bir düzeltme yarın.',
  'İş bitince değil, kontrol edilince biter.',
  'Bir günü iyi planlamak, iki gün kazandırır.',
  'Bugün "sonra bakarım" deme; şimdi bak, kısa sürer.',
  'Doğru rakam, en iyi savunmadır.',
  'Her sabah temiz masa, her akşam temiz vicdan.',
  'Bir işi ertelemek, onu iki kez düşünmektir.',
  'Sessiz bir gün, iyi yapılmış bir dünün ödülüdür.',
  'Önce sor, sonra hesapla; iki kez hesaplamaktan iyidir.',
  'Bugün bir mükellefe teşekkür et; iş ilişkisi böyle uzar.',
  'Listeyi kısaltmanın tek yolu, ilk maddeden başlamaktır.',
  'Beklemek iş değildir; hatırlatmak iştir.',
  'Bir mükellefin borcunu konuşmak, bir ay sonra konuşmaktan kolaydır.',
  'İyi arşiv, aranmayan arşivdir.',
  'Bugünkü sükûnet, yarınki hızdır.',
  'Zor mükellef yoktur; net anlatılmamış süreç vardır.',
  'Ay sonu paniği, ay başı ihmalinin faturasıdır.',
  'Kapanan her dosya için kendine bir tik koy.',
];

/** Gün + saat'e göre havuzdan cümle; saat değişince cümle değişir. */
export function motivasyon(simdi: Date = new Date()): string {
  const yilBasi = new Date(simdi.getFullYear(), 0, 1);
  const gun = Math.floor((simdi.getTime() - yilBasi.getTime()) / 86400000);
  const idx = (gun * 24 + simdi.getHours()) % HAVUZ.length;
  return HAVUZ[idx];
}
