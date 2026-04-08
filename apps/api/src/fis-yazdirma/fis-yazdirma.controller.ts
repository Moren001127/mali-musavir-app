import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FisYazdirmaService, ExcelRow } from './fis-yazdirma.service';
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
  async scan(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('En az bir görsel gerekli');
    return this.fisYazdirmaService.scanImages(files);
  }

  /**
   * POST /api/v1/fis-yazdirma/process
   */
  @Post('process')
  @UseInterceptors(imageInterceptor())
  async process(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('allDates') allDatesJson: string,
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

    const wordBuffer = await this.fisYazdirmaService.generateWord(files, allDates);
    const filename = `fisler_${new Date().toISOString().slice(0, 10)}.docx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Total': String(files.length),
    });
    return res.send(wordBuffer);
  }

  /**
   * POST /api/v1/fis-yazdirma/excel
   * Body: { data: JSON string of ExcelRow[] }
   */
  @Post('excel')
  async excel(@Body('data') dataJson: string, @Res() res: any) {
    let rows: ExcelRow[];
    try {
      rows = JSON.parse(dataJson);
    } catch {
      throw new BadRequestException('data geçersiz JSON');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('En az bir satır gerekli');
    }

    const buffer = this.fisYazdirmaService.generateExcel(rows);
    const filename = `fis_rapor_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return res.send(buffer);
  }
}
