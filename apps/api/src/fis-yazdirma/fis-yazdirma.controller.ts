import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FisYazdirmaService } from './fis-yazdirma.service';
import { memoryStorage } from 'multer';

const imageInterceptor = () =>
  FilesInterceptor('images', 300, {
    storage: memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new BadRequestException('Sadece görsel dosyalar kabul edilir') as any, false);
      }
    },
  });

@Controller('fis-yazdirma')
@UseGuards(AuthGuard('jwt'))
export class FisYazdirmaController {
  constructor(private fisYazdirmaService: FisYazdirmaService) {}

  /**
   * POST /api/v1/fis-yazdirma/scan
   */
  @Post('scan')
  @UseInterceptors(imageInterceptor())
  async scan(@UploadedFiles() files: Express.Multer.File[], @Req() req: any) {
    if (!files?.length) throw new BadRequestException('En az bir görsel gerekli');
    return this.fisYazdirmaService.scanImages(files, req.user?.tenantId);
  }

  /**
   * POST /api/v1/fis-yazdirma/process
   */
  @Post('process')
  @UseInterceptors(imageInterceptor())
  async process(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('allDates') allDatesJson: string,
    @Body('mukellef') mukellef: string | undefined,
    @Body('donem') donem: string | undefined,
    @Body('pagesPerSheet') pagesPerSheetStr: string | undefined,
    @Res() res: any,
  ) {
    if (!files?.length) throw new BadRequestException('En az bir görsel gerekli');

    let allDates: Record<string, string> = {};
    if (allDatesJson) {
      try {
        allDates = JSON.parse(allDatesJson);
      } catch {
        throw new BadRequestException('allDates geçersiz JSON');
      }
    }

    const pagesPerSheet = pagesPerSheetStr ? parseInt(pagesPerSheetStr, 10) : undefined;
    const wordBuffer = await this.fisYazdirmaService.generateWord(files, allDates, {
      mukellef: mukellef || undefined,
      donem: donem || undefined,
      pagesPerSheet,
    });
    const safeMukellef = (mukellef || 'fisler').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const datePart = donem || new Date().toISOString().slice(0, 10);
    const filename = `${safeMukellef}_${datePart}.docx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Total': String(files.length),
    });
    return res.send(wordBuffer);
  }

}
