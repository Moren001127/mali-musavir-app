import { firmaEslesiyorMu } from './firma-eslesme';

describe('firmaEslesiyorMu — Luca raporu secilen mukellefe mi ait?', () => {
  it('SILBER vakasi: rapor GITO, mukellef SILBER → UYUMSUZ (genel kelimeler insaat/gida ortak sayilmaz)', () => {
    const r = firmaEslesiyorMu('GİTO GIDA İNŞAAT TİCARET LİMİTED ŞİRKETİ', { companyName: 'SİLBER İNŞAAT GIDA SANAYİ VE TİCARET LİMİTED ŞİRKETİ', taxNumber: '7701280004' });
    expect(r.uyumlu).toBe(false);
  });
  it('ayni firma, Luca 40 karakterde kesmis → uyumlu', () => {
    const r = firmaEslesiyorMu('YORGUN NAKLİYAT LOJİSTİK VE DEPOLAMA TİC', { companyName: 'YORGUN NAKLİYAT LOJİSTİK VE DEPOLAMA TİCARET LİMİTED ŞİRKETİ' });
    expect(r.uyumlu).toBe(true);
  });
  it('sahis: ad soyad birebir → uyumlu; farkli kisi → uyumsuz', () => {
    expect(firmaEslesiyorMu('FATİH GEDİK', { firstName: 'Fatih', lastName: 'Gedik' }).uyumlu).toBe(true);
    expect(firmaEslesiyorMu('EYUP YÜKSEL', { firstName: 'Fatih', lastName: 'Gedik' }).uyumlu).toBe(false);
  });
  it('portal adi farkli yazilmis ama ortak ayirt edici kelime var → uyumlu (yanlis engelleme olmasin)', () => {
    expect(firmaEslesiyorMu('YILMAZ TİCARET', { companyName: 'MEHMET YILMAZ' }).uyumlu).toBe(true);
    expect(firmaEslesiyorMu('OZ ELA TURIZM TASIMACILIK', { companyName: 'ÖZ ELA TURİZM TAŞIMACILIK İNŞAAT TİCARET LTD' }).uyumlu).toBe(true);
  });
  it('rapor adi yok ya da yalniz genel kelimeler → kontrol atlanir (uyumlu)', () => {
    expect(firmaEslesiyorMu(null, { companyName: 'X LTD' }).uyumlu).toBe(true);
    expect(firmaEslesiyorMu('LOJİSTİK NAKLİYAT LTD ŞTİ', { companyName: 'ABC LOJİSTİK' }).uyumlu).toBe(true);
  });
  it('VKN rapor basliginda geciyorsa dogrudan uyumlu', () => {
    expect(firmaEslesiyorMu('7701280004 - FIRMA', { companyName: 'BAMBASKA AD', taxNumber: '7701280004' }).uyumlu).toBe(true);
  });
});
