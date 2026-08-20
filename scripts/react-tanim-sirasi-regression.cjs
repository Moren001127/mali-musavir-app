#!/usr/bin/env node
/**
 * REACT: "tanimlanmadan once kullanma" bekcisi.
 *
 * CANLI OLAY (2026-08-20): Fatura Merkezi ekrani "Application error: a client-side
 * exception" ile KOMPLE ACILMIYORDU. Sebep:
 *     const gorunenTaslaklar = (listQ.data || []).filter(x => iptalleriGoster || ...)
 * satiri, iptalleriGoster state'i 63 satir SONRA tanimlandigi halde onu ANINDA okuyordu
 * (.filter hemen calisir) -> "Cannot access 'iptalleriGoster' before initialization".
 *
 * TypeScript BUNU YAKALAMAZ: kullanim bir ok fonksiyonunun icinde oldugu icin tsc
 * "sonra cagrilabilir" varsayar. apps/web icin eslint yapilandirmasi da yok.
 *
 * Bu test yalniz ANINDA CALISAN atamalara bakar (ok fonksiyonu atamalari haric),
 * bu yuzden yanlis alarm uretmez.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const DOSYALAR = ['apps/web/src/app/fatura-merkezi/page.tsx'];

let hata = 0;
for (const rel of DOSYALAR) {
  // CRLF TUZAGI: dosyalar Windows satir sonlu. Yalniz '\n' ile bolunce her satirin sonunda
  //   \r kalir ve regex'lerdeki $ HICBIR ZAMAN tutmaz -> test SESSIZCE HEP GECER.
  //   Bu bekci ilk yazilisinda tam da bu yuzden ise yaramadi (negatif test yakaladi).
  const satirlar = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);

  // Bilesen sinirlari
  const sinirlar = [];
  satirlar.forEach((ln, i) => { if (/^(export\s+)?(default\s+)?function\s+[A-Z]\w*\s*\(/.test(ln)) sinirlar.push(i); });
  sinirlar.push(satirlar.length);

  for (let b = 0; b < sinirlar.length - 1; b++) {
    const bas = sinirlar[b], son = sinirlar[b + 1];
    const ad = (satirlar[bas].match(/function\s+([A-Z]\w*)/) || [])[1] || '?';

    // Hook ile tanimlanan adlar: const [a, setA] = useState / const q = useQuery|useMutation|useMemo
    const tanim = new Map();
    for (let i = bas; i < son; i++) {
      const d1 = satirlar[i].match(/^\s*const\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*use(State|Reducer)/);
      if (d1) { if (!tanim.has(d1[1])) tanim.set(d1[1], i); if (!tanim.has(d1[2])) tanim.set(d1[2], i); continue; }
      const d2 = satirlar[i].match(/^\s*const\s+(\w+)\s*=\s*use(Query|Mutation|Memo|Callback|Ref)/);
      if (d2 && !tanim.has(d2[1])) tanim.set(d2[1], i);
    }
    if (!tanim.size) continue;

    // ANINDA calisan atamalar: const X = <ok fonksiyonu OLMAYAN ifade>
    for (let i = bas; i < son; i++) {
      // Yalniz BILESEN UST DUZEYI (tam 2 bosluk girinti). Daha derin girintili satirlar
      //   bir callback/blok icindedir; oralarda kullanim ERTELENIR, TDZ hatasi vermez.
      const m = satirlar[i].match(/^  const\s+\w+\s*(?::[^=]+)?=\s*(.*)$/);
      if (!m) continue;
      const sag = m[1].trim();
      if (/^use[A-Z]/.test(sag)) continue;                       // hook cagrisi
      if (/^(async\s+)?\(?[\w\s,:{}\[\]]*\)?\s*(:\s*[\w<>\[\]]+\s*)?=>/.test(sag)) continue; // ok fonksiyonu -> ertelenir
      if (/^function\b/.test(sag)) continue;

      for (const [isim, satir] of tanim) {
        if (satir <= i) continue;                                 // tanim once, sorun yok
        // NOT: sablon dizesinde \w kacisi ERIR ([^w] olur) ve "docs" ifadesi "docsQ" icinde
        //   eslesip YANLIS ALARM uretir. Bu yuzden normal dize + acik kacis.
        // TERS BOLU YOK: kacis hatalari yuzunden bu bekci iki kez sessizce hep gecti.
        //   Tam-kelime kontrolu acik karakter kontroluyle yapiliyor.
        const kelimeKar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);
        let tamKelime = false;
        for (let k = satirlar[i].indexOf(isim); k >= 0; k = satirlar[i].indexOf(isim, k + 1)) {
          const onceki = satirlar[i][k - 1];
          const sonraki = satirlar[i][k + isim.length];
          if (!kelimeKar(onceki) && onceki !== '.' && !kelimeKar(sonraki)) { tamKelime = true; break; }
        }
        if (tamKelime) {
          console.error(`  \u2717 ${rel}:${i + 1} (${ad}) — "${isim}" ${satir + 1}. satirda tanimlaniyor ama BURADA ANINDA kullaniliyor`);
          console.error(`      ${satirlar[i].trim().slice(0, 110)}`);
          hata++;
        }
      }
    }
  }
  if (!hata) console.log(`  \u2713 ${rel}: aninda calisan atamalarda tanim-oncesi kullanim yok`);
}

if (hata) { console.error('\n  Bu hata EKRANI KOMPLE PATLATIR (Cannot access ... before initialization).'); process.exit(1); }
console.log('[react-tanim-sirasi-regression] OK');
