/**
 * SİSTEM PROMPTU kilit testleri (PLAN/17 §1.3, 2026-09-13):
 *  - kadro/<ajan>/receteler.md prompta "## REÇETELERİN" olarak TAM girer (sahte kadro klasörü ile),
 *  - beceriler.md "## BECERİLERİN (özet)" olarak girer; uzun dosya 6 KB'de kırpılır (kök neden #1: hiç girmiyordu),
 *  - "İŞ ÖĞRENME SIRASI" (Luca ekran sırası) yalnız luca-operator'a; diğer ajanlara "ÖNCE PORTAL ARAÇLARIN" satırı,
 *  - kademe açıklamasında portal_yaz_agir; kuru test metni zincir kesme + "gerçek yapılan işler" satırını ister,
 *  - boyut logu: debug; 50 KB üstü warn.
 * Gerçek kadro klasörüyle: 13 ajanın promptu 50 KB altında ve reçete bloğu dolu.
 * Prisma / Agent SDK / DB yok.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EkipRunnerService } from './ekip-runner.service';
import { AJAN_TANIMLARI, ajanBul } from './ajan-tanimlari';

function runnerKur(kadroKoku?: string) {
  const operator = { getRulesForUi: async () => [] };
  const r = new EkipRunnerService({} as any, {} as any, {} as any, operator as any, {} as any);
  if (kadroKoku) (r as any).kadroKokAdaylari = () => [kadroKoku];
  const loglar: { seviye: string; mesaj: string }[] = [];
  (r as any).logger = {
    debug: (m: string) => loglar.push({ seviye: 'debug', mesaj: m }),
    warn: (m: string) => loglar.push({ seviye: 'warn', mesaj: m }),
    log: (m: string) => loglar.push({ seviye: 'log', mesaj: m }),
    error: (m: string) => loglar.push({ seviye: 'error', mesaj: m }),
  };
  const prompt = (ajanId: string, dryRun = true) => (r as any).sistemPromptu(ajanBul(ajanId)!, dryRun, 't1', false) as Promise<string>;
  return { r, loglar, prompt };
}

/** Sahte kadro klasörü: 00_ORTAK + <ajan>/{kimlik,kurallar,beceriler,receteler}.md */
function sahteKadro(ajanId: string, dosyalar: Record<string, string>): string {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'kadro-'));
  fs.writeFileSync(path.join(kok, '00_ORTAK_KURALLAR.md'), '# ORTAK\n- sahte ortak kural', 'utf8');
  fs.mkdirSync(path.join(kok, ajanId), { recursive: true });
  for (const [ad, icerik] of Object.entries(dosyalar)) fs.writeFileSync(path.join(kok, ajanId, ad), icerik, 'utf8');
  return kok;
}

describe('sistem promptu — receteler.md + beceriler özeti (sahte kadro)', () => {
  it('receteler.md "## REÇETELERİN" bloğu olarak TAM girer; kurallar bloğundan sonra, beceriler özetinden önce', async () => {
    const kok = sahteKadro('beyanname', {
      'kimlik.md': '# Kimlik\nBen beyanname.',
      'kurallar.md': '# Kurallar\n- kural bir',
      'beceriler.md': '# Beceriler\n- beceri bir',
      'receteler.md': '## R1 — KDV Kontrol zinciri\n1) oturum bul — kdv_kontrol_oturum_bul_olustur — portal_yaz_agir\nRECETE-SON-SATIR',
    });
    const { prompt, loglar } = runnerKur(kok);
    const p = await prompt('beyanname');
    expect(p).toContain('## REÇETELERİN (bu sırayı izle; adım atlama; kuru testte kesilen adımdan sonrasını ÇAĞIRMA, "yapılacaktı" yaz)');
    expect(p).toContain('## R1 — KDV Kontrol zinciri');
    expect(p).toContain('RECETE-SON-SATIR');
    expect(p).toContain('## BECERİLERİN (özet)\n# Beceriler\n- beceri bir');
    const iKural = p.indexOf('## KURALLARIN');
    const iRecete = p.indexOf('## REÇETELERİN');
    const iBeceri = p.indexOf('## BECERİLERİN');
    const iArac = p.indexOf('## KULLANABİLECEĞİN ARAÇLAR');
    expect(iKural).toBeGreaterThan(0);
    expect(iRecete).toBeGreaterThan(iKural);
    expect(iBeceri).toBeGreaterThan(iRecete);
    expect(iArac).toBeGreaterThan(iBeceri);
    // boyut logu debug (küçük prompt), warn yok
    expect(loglar.some((l) => l.seviye === 'debug' && /beyanname prompt \d+ kr/.test(l.mesaj))).toBe(true);
    expect(loglar.some((l) => l.seviye === 'warn')).toBe(false);
  });

  it('receteler.md yoksa blok hiç girmez; beceriler 6 KB üstü kırpılır ve "…" işareti konur', async () => {
    const uzun = Array.from({ length: 400 }, (_, i) => `- beceri satırı ${i} ${'x'.repeat(20)}`).join('\n'); // ~14 KB
    const kok = sahteKadro('analist', { 'kimlik.md': 'k', 'kurallar.md': 'r', 'beceriler.md': uzun });
    const { prompt } = runnerKur(kok);
    const p = await prompt('analist');
    expect(p).not.toContain('## REÇETELERİN');
    const beceri = p.split('## BECERİLERİN (özet)\n')[1].split('\n## ')[0];
    expect(beceri.length).toBeLessThan(6 * 1024 + 80);
    expect(beceri).toContain('…(beceriler.md kırpıldı');
    expect(beceri).toContain('beceri satırı 0 ');
    expect(beceri).not.toContain('beceri satırı 399 ');
  });

  it('50 KB üstü prompt warn loguna düşer', async () => {
    const dev = 'R'.repeat(50 * 1024);
    const kok = sahteKadro('risk', { 'kimlik.md': 'k', 'receteler.md': dev });
    const { prompt, loglar } = runnerKur(kok);
    await prompt('risk');
    const w = loglar.find((l) => l.seviye === 'warn');
    expect(w).toBeTruthy();
    expect(w!.mesaj).toMatch(/risk prompt \d+ kr/);
    expect(w!.mesaj).toMatch(/tavanını aşıyor/);
  });

  it('İŞ ÖĞRENME SIRASI yalnız luca-operator; diğerlerine "ÖNCE PORTAL ARAÇLARIN"; kademe satırında portal_yaz_agir; kuru test metni zincir kesme ister', async () => {
    const kok = sahteKadro('luca-operator', { 'kimlik.md': 'k' });
    fs.mkdirSync(path.join(kok, 'beyanname'), { recursive: true });
    const { prompt } = runnerKur(kok);
    const luca = await prompt('luca-operator');
    expect(luca).toContain('## İŞ ÖĞRENME SIRASI');
    expect(luca).toContain('2) EKRANI AÇ-OKU: luca_menu_ara → luca_menu_git → luca_ekran_oku');
    expect(luca).not.toContain('ÖNCE PORTAL ARAÇLARIN');
    const bey = await prompt('beyanname');
    expect(bey).not.toContain('## İŞ ÖĞRENME SIRASI');
    expect(bey).toContain('ÖNCE PORTAL ARAÇLARIN (reçeten)');
    expect(bey).toContain('Luca yalnız DEVİR');
    expect(bey).toContain('portal_yaz_agir=portala yazar ve yan etkisi var');
    expect(bey).toContain('o adımın çıktısına bağlı sonraki adımları ÇAĞIRMA');
    expect(bey).toContain('Kuru testte gerçek yapılan işler');
    expect(bey).toContain('## ÇALIŞMA BİÇİMİ: KURU TEST');
    const canli = await prompt('beyanname', false);
    expect(canli).toContain('## ÇALIŞMA BİÇİMİ: CANLI');
    expect(canli).toContain('Kilitleme/kilit açma, resolve, fm_onayla, GİB gönderimi, Mihsap çekimi her zaman Muzaffer Bey’de');
  });
});

describe('sistem promptu — gerçek kadro klasörü (apps/api/kadro)', () => {
  it('13 ajanın promptu 50 KB altında; REÇETELERİN ve BECERİLERİN blokları dolu; öğrenme sırası yalnız luca-operator', async () => {
    const { prompt, loglar } = runnerKur();
    for (const ajan of AJAN_TANIMLARI) {
      const p = await prompt(ajan.id);
      expect({ ajan: ajan.id, altinda: p.length < 50 * 1024, uzunluk: p.length }).toEqual({ ajan: ajan.id, altinda: true, uzunluk: p.length });
      expect({ ajan: ajan.id, recete: p.includes('## REÇETELERİN') }).toEqual({ ajan: ajan.id, recete: true });
      expect({ ajan: ajan.id, beceri: p.includes('## BECERİLERİN (özet)') }).toEqual({ ajan: ajan.id, beceri: true });
      expect({ ajan: ajan.id, ogrenme: p.includes('## İŞ ÖĞRENME SIRASI') }).toEqual({ ajan: ajan.id, ogrenme: ajan.id === 'luca-operator' });
    }
    expect(loglar.filter((l) => l.seviye === 'warn')).toEqual([]);
    // Beyanname R1 reçetesi ve Koordinatör §5 tablosu gerçekten promptta
    const beyanname = await prompt('beyanname');
    expect(beyanname).toContain('## R1 — KDV Kontrol zinciri');
    // Doğrulayıcı 2026-09-13: R1 zincirinin ilk aracı REÇETELERİN bloğu içinde geçiyor (gerçek kadro dosyasıyla)
    const receteBlogu = beyanname.split('## REÇETELERİN')[1].split('## BECERİLERİN')[0];
    expect(receteBlogu).toContain('kdv_kontrol_oturum_bul_olustur');
    expect(await prompt('koordinator')).toContain('§5 Yönlendirme tablosu');
    expect(await prompt('luca-operator')).toContain('DEVİR CEVABI');
  });
});
