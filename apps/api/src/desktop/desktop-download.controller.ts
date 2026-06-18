import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import { createReadStream, existsSync, statSync } from 'fs';
import * as path from 'path';

/**
 * Masaüstü uygulamasının Windows kurulum dosyasını (.exe) yeni bilgisayarlara
 * indirmek için PUBLIC uçlar (JWT yok). Kurulum dosyası gizli bilgi içermez —
 * uygulama yine portala giriş ister; bu yüzden serbestçe indirilebilir.
 *
 * Dosya repoda apps/api/public/downloads/ altında tutulur ve Docker imajına
 * COPY apps/api ile gider; çalışma dizini (WORKDIR) /app/apps/api olduğundan
 * process.cwd()/public/downloads ile çözülür. agent-runtime servisindeki çoklu
 * aday yol mantığı burada da kullanılır (yerel + Railway uyumu).
 */

const INSTALLER_FILE = 'Moren-Masaustu-Kurulum.exe';
// Yeni sürüm derlenip public/downloads'a konulduğunda burayı güncelle.
const INSTALLER_VERSION = '1.2.3';

function resolveInstallerPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'apps/api/public/downloads', INSTALLER_FILE),
    path.resolve(process.cwd(), 'public/downloads', INSTALLER_FILE),
    path.resolve(__dirname, '../../public/downloads', INSTALLER_FILE),
    path.resolve(__dirname, '../../../public/downloads', INSTALLER_FILE),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

@Controller('desktop')
export class DesktopDownloadController {
  /** Kurulum dosyasının sürümü ve hazır olup olmadığı (portal sayfası için). */
  @Get('installer/version')
  version() {
    const filePath = resolveInstallerPath();
    return {
      version: INSTALLER_VERSION,
      available: !!filePath,
      sizeBytes: filePath ? statSync(filePath).size : 0,
      filename: `Moren-Masaustu-Kurulum-${INSTALLER_VERSION}.exe`,
    };
  }

  /** Kurulum dosyasını indir (octet-stream, attachment). */
  @Get('installer')
  download(@Res() res: any) {
    const filePath = resolveInstallerPath();
    if (!filePath) {
      throw new NotFoundException('Kurulum dosyası bulunamadı.');
    }
    const filename = `Moren-Masaustu-Kurulum-${INSTALLER_VERSION}.exe`;
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': statSync(filePath).size,
    });
    createReadStream(filePath).pipe(res);
  }
}
