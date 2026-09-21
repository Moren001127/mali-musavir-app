// Panel kabuğu (html/body 100vh + [data-panel-main] overflow:auto) tam sayfa görüntüsünü engeller;
// bu yardımcı, kaydıran zinciri geçici gevşetip fullPage çeker, sonra eski hâline döndürür.
/** secici verilirse yalnız o öğe (ör. tablo) tam boyuyla çekilir. */
async function tamSayfa(pg, dosya, secici) {
  await pg.mouse.move(2, 2); // fare izi (hover) görüntüye girmesin
  await pg.evaluate(() => {
    const main = document.querySelector('[data-panel-main]') || document.querySelector('main');
    const zincir = [];
    for (let el = main; el; el = el.parentElement) zincir.push(el);
    window.__tamSayfaEski = zincir.map((el) => ({ el, style: el.getAttribute('style') }));
    for (const el of zincir) {
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('min-height', '0', 'important');
      el.style.setProperty('overflow', 'visible', 'important');
    }
  });
  await pg.waitForTimeout(250);
  if (secici) await pg.locator(secici).first().screenshot({ path: dosya });
  else await pg.screenshot({ path: dosya, fullPage: true });
  await pg.evaluate(() => {
    for (const { el, style } of window.__tamSayfaEski || []) {
      if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
    }
    delete window.__tamSayfaEski;
  });
  await pg.waitForTimeout(150);
}
module.exports = { tamSayfa };
