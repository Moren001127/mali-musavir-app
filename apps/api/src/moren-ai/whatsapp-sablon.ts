/**
 * WhatsApp ŞABLON KATMANI — tool sonuçlarını deterministik, okunur bloklara çevirir.
 *
 * İKİ KURAL:
 * 1) Şablon yalnızca SORUDA o veri açıkça istendiyse eklenir (soru-kapısı) —
 *    "beyannameyi gönder" deyince KDV kontrol şablonu yapışmaz.
 * 2) Sayılar/kalemler modele bırakılmaz; blok kod tarafından üretilir, model
 *    yalnızca kısa YORUM yazar.
 *
 * Saf fonksiyonlar — DB/DI yok, jest ile test edilir.
 */

function tl(value: any): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0,00 TL';
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' TL';
}

function pct(value: any, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return '%' + new Intl.NumberFormat('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

function norm(raw: string): string {
  return String(raw || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

/** Soru-kapıları: şablon ancak soru bu deseni içeriyorsa eklenir. */
const GATES: Record<string, RegExp> = {
  get_gelir_tablosu: /gelir\s*tablo|kar(lilik)?\s*analiz|net\s*kar|brut\s*kar/,
  get_bilanco: /bilanco|ozkaynak|aktif\s*toplam|cari\s*oran/,
  get_mizan: /mizan/,
  // "kdv beyannamesi verildi mi / gönder" KDV KONTROL şablonunu TETİKLEMEZ.
  get_kdv_summary: /kdv\s*kontrol|kdv.*(esles|uyusmaz|fatura\s*kontrol)|kontrol.*kdv/,
  list_beyan_kayitlari: /beyanname|tahakkuk|verildi\s*mi|beyan\s*kay/,
  get_beyan_ozet: /beyan.*(ozet|durum|kac|kaldi)|kac\s*beyanname|toplu\s*beyan/,
  calculate_financial_ratios: /rasyo|oran|likidite|\broe\b|\broa\b|borcluluk/,
  compare_periods: /karsilastir|kiyasla|gecen\s*(yil|donem|ay)|buyume|dusus|degisim/,
  list_araclar_hgs: /hgs|plaka|arac|ihlal|otoyol/,
  get_payroll_summary: /bordro|maas|personel|sgk\s*prim/,
  get_collection_risk_summary: /tahsilat|borclu|acik\s*bakiye|alacak\s*risk|risk.*tahsilat/,
};

/**
 * Tool sonucundan şablon bloğu üretir; soru-kapısı tutmuyorsa veya
 * veri yoksa null döner.
 */
export function sablonForTool(toolName: string, result: any, question: string): string | null {
  if (!result || result.error) return null;
  const gate = GATES[toolName];
  if (!gate || !gate.test(norm(question))) return null;

  switch (toolName) {
    // Bu dördü şablonunu tool içinde üretir (whatsappOzet) — kapıdan geçirip aynen ver.
    case 'get_gelir_tablosu':
    case 'get_bilanco':
    case 'get_mizan':
    case 'get_kdv_summary':
      return typeof result.whatsappOzet === 'string' && result.whatsappOzet.trim()
        ? result.whatsappOzet.trim()
        : null;

    case 'list_beyan_kayitlari': {
      const kayitlar = Array.isArray(result.kayitlar) ? result.kayitlar : [];
      if (!kayitlar.length) return null;
      const adlar = Array.from(new Set(kayitlar.map((k: any) => k.mukellef).filter(Boolean)));
      const baslik = adlar.length === 1 ? `📝 BEYANNAME — ${adlar[0]}` : '📝 BEYANNAME KAYITLARI';
      const satirlar = kayitlar.slice(0, 8).map((k: any) => {
        const durum = k.verildi ? '✅ VERİLDİ' : '⏳ hazırlanmış';
        const tutar = k.tahakkukTutari ? ` · tahakkuk ${tl(k.tahakkukTutari)}` : '';
        const tarih = k.beyanTarihi ? ` · ${k.beyanTarihi}` : '';
        return `• ${k.beyanTipi} · ${k.donem} — ${durum}${tutar}${tarih}`;
      });
      const kalan = kayitlar.length > 8 ? [`… ${kayitlar.length - 8} kayıt daha`] : [];
      return [baslik, '', ...satirlar, ...kalan].join('\n');
    }

    case 'get_beyan_ozet': {
      const satirlar = Array.isArray(result.satirlar) ? result.satirlar : [];
      if (!satirlar.length) return null;
      const rows = satirlar.map((s: any) =>
        `• ${s.beyanTipi}: ${s.onaylanan}/${s.toplam} onaylı · ${s.bekleyen} bekliyor${s.hatali ? ` · ⚠️ ${s.hatali} hatalı` : ''}`);
      return [`📝 BEYAN ÖZETİ — ${result.donem}`, '', ...rows].join('\n');
    }

    case 'calculate_financial_ratios': {
      const r = result.rasyolar || {};
      const rows: string[] = [];
      const oran = (v: any) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(Number(v));
      if (r.cariOran) rows.push(`• Cari Oran: ${oran(r.cariOran.deger)} (${r.cariOran.yorum || '-'})`);
      if (r.borcluluk) rows.push(`• Borçluluk: ${pct(r.borcluluk.deger * 100)} (${r.borcluluk.yorum || '-'})`);
      if (r.ozkaynakOrani) rows.push(`• Özkaynak/Aktif: ${pct(r.ozkaynakOrani.deger * 100)}`);
      if (r.brutKarMarji) rows.push(`• Brüt Kâr Marjı: ${pct(r.brutKarMarji.deger * 100)}`);
      if (r.faaliyetKarMarji) rows.push(`• Faaliyet Kârı Marjı: ${pct(r.faaliyetKarMarji.deger * 100)}`);
      if (r.netKarMarji) rows.push(`• Net Kâr Marjı: ${pct(r.netKarMarji.deger * 100)}`);
      if (r.roe) rows.push(`• ROE: ${pct(r.roe.deger * 100)}`);
      if (r.roa) rows.push(`• ROA: ${pct(r.roa.deger * 100)}`);
      if (!rows.length) return null;
      const uyarilar = Array.isArray(result.uyarilar) && result.uyarilar.length
        ? ['', '⚠️ UYARI', ...result.uyarilar.map((u: string) => `• ${String(u).replace(/\*\*/g, '').replace(/^⚠️\s*/, '')}`)]
        : [];
      return [`📐 RASYOLAR — ${result.donem || ''}`.trim(), '', ...rows, ...uyarilar].join('\n');
    }

    case 'compare_periods': {
      const diff = result['karsilaştırma'] || result.karsilastirma || {};
      const LABELS: Record<string, string> = {
        netSatislar: 'Net Satışlar', satisMaliyeti: 'Satış Maliyeti', brutSatisKari: 'Brüt Satış Kârı',
        faaliyetGiderleri: 'Faaliyet Giderleri', faaliyetKari: 'Faaliyet Kârı', donemNetKari: 'Dönem Net Kârı',
        donemKari: 'Dönem Kârı', donenVarliklar: 'Dönen Varlıklar', duranVarliklar: 'Duran Varlıklar',
        aktifToplami: 'Aktif Toplamı', kvYabanciKaynak: 'KV Yabancı Kaynak', uvYabanciKaynak: 'UV Yabancı Kaynak',
        ozkaynaklar: 'Özkaynaklar', toplamBorc: 'Toplam Borç', toplamAlacak: 'Toplam Alacak',
      };
      const entries = Object.entries(diff)
        .filter(([, v]: any) => v && (Math.abs(v.donem1) > 0.005 || Math.abs(v.donem2) > 0.005))
        .sort((a: any, b: any) => Math.abs(b[1].fark) - Math.abs(a[1].fark))
        .slice(0, 6);
      if (!entries.length) return null;
      const rows = entries.map(([key, v]: any) => {
        const yon = v.fark > 0 ? '▲' : v.fark < 0 ? '▼' : '＝';
        const yuzde = v.degismeYuzdesi == null ? '' : ` (${yon}${pct(Math.abs(v.degismeYuzdesi))})`;
        return `• ${LABELS[key] || key}: ${tl(v.donem1)} → ${tl(v.donem2)}${yuzde}`;
      });
      return [`📊 KARŞILAŞTIRMA — ${result.donem1} → ${result.donem2}`, '', ...rows].join('\n');
    }

    case 'list_araclar_hgs': {
      const ozet = result.ozet || {};
      const araclar = Array.isArray(result.araclar) ? result.araclar : [];
      if (!araclar.length && !ozet.toplamArac) return null;
      const ihlalli = araclar.filter((a: any) => a.ihlalSayisi > 0).slice(0, 8);
      const rows = ihlalli.map((a: any) => `• ${a.plaka} — ${a.ihlalSayisi} ihlal · ${tl(a.toplamTutar)}`);
      return [
        '🚗 HGS DURUMU',
        '',
        `• Toplam Araç: ${ozet.toplamArac ?? araclar.length}`,
        `• İhlalli Araç: ${ozet.ihlalliArac ?? ihlalli.length}`,
        `• Toplam Tutar: ${tl(ozet.toplamTutar)}`,
        ...(rows.length ? ['', '⚠️ İHLALLİ', ...rows] : []),
      ].join('\n');
    }

    case 'get_payroll_summary': {
      if (!result.toplamPersonel && !result.aktifPersonel) return null;
      return [
        `👥 BORDRO — ${result.donem || ''}`.trim(),
        '',
        `• Personel: ${result.aktifPersonel}/${result.toplamPersonel} aktif`,
        `• Toplam Brüt: ${tl(result.toplamBrutMaas)}`,
        `• Toplam Net: ${tl(result.toplamNetMaas)}`,
        `• SGK (işçi+işveren): ${tl(result.toplamSgk)}`,
        `• Stopaj: ${tl(result.toplamStopaj)} · Damga: ${tl(result.toplamDamga)}`,
      ].join('\n');
    }

    case 'get_collection_risk_summary': {
      const riskli = Array.isArray(result.enRiskli) ? result.enRiskli : [];
      if (!result.toplamBorclu) return null;
      const rows = riskli.slice(0, 8).map((r: any) => `• ${r.ad}: ${tl(r.bakiye)}`);
      return [
        '💰 TAHSİLAT RİSKİ',
        '',
        `• Borçlu Mükellef: ${result.toplamBorclu}`,
        `• Toplam Açık Bakiye: ${tl(result.toplamBakiye)}`,
        ...(rows.length ? ['', '⚠️ EN YÜKSEK BAKİYELER', ...rows] : []),
      ].join('\n');
    }

    default:
      return null;
  }
}

/** Cevapta zaten şablon başlığı var mı? (model kendisi yazdıysa ikinci kez ekleme) */
export function sablonZatenVar(text: string): boolean {
  return /(📈|📊|📝|📒|🧾|📐|🚗|👥|💰)\s?[A-ZÇĞİÖŞÜ]/.test(String(text || ''));
}
