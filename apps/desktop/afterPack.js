'use strict';

// Build sonrası, paketlenmiş .exe'ye Moren ikonunu ve sürüm bilgisini gömer.
// signAndEditExecutable:false olduğu için electron-builder bunu kendisi yapmıyor
// (winCodeSign'ın symlink sorununu yaşamamak için). Bu yüzden bağımsız rcedit
// ile yalnızca ikon/sürüm gömüyoruz — imzalama yine yok.

const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const mod = await import('rcedit');
  const rcedit = mod.rcedit || mod.default || mod;
  const exePath = path.join(context.appOutDir, 'Moren Masaüstü.exe');
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  await rcedit(exePath, {
    icon: iconPath,
    'version-string': {
      ProductName: 'Moren Masaüstü',
      FileDescription: 'Moren Masaüstü',
      CompanyName: 'Moren Mali Müşavirlik',
      LegalCopyright: 'Moren Mali Müşavirlik',
    },
  });
  console.log('[afterPack] Moren ikonu exe’ye gömüldü: ' + exePath);
};
