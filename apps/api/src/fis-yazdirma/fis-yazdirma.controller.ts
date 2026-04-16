import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  NotFoundException,
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
   * Word belgesi oluşturur, DB'ye arşivler ve indirtir.
   */
  @Post('process')
  @UseInterceptors(imageInterceptor())
  async process(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('allDates') allDatesJson: string,
    @Body('mukellef') mukellef: string | undefined,
    @Body('donem') donem: string | undefined,
    @Body('pagesPerSheet') pagesPerSheetStr: string | undefined,
    @Req() req: any,
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

    // Arşive kaydet (hata olursa indirme akışını bozma)
    let outputId: string | null = null;
    try {
      const rec = await this.fisYazdirmaService.saveOutput({
        tenantId: req.user.tenantId,
        buffer: wordBuffer,
        filename,
        fileCount: files.length,
        mukellefName: mukellef || undefined,
        donem: donem || undefined,
        pagesPerSheet,
        createdBy: req.user?.userId,
      });
      outputId = rec.id;
    } catch (e) {
      // Kaydetme başarısızsa indirme devam etsin
    }

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Total': String(files.length),
      'X-Output-Id': outputId || '',
    });
    return res.send(wordBuffer);
  }

  /**
   * GET /api/v1/fis-yazdirma/outputs
   * Daha önce üretilmiş Word çıktılarının listesi.
   */
  @Get('outputs')
  async listOutputs(@Req() req: any, @Query('limit') limit?: string) {
    return this.fisYazdirmaService.listOutputs(
      req.user.tenantId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /**
   * GET /api/v1/fis-yazdirma/outputs/:id/download
   * Arşivlenmiş Word belgesini indirir.
   */
  @Get('outputs/:id/download')
  async downloadOutput(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const rec = await this.fisYazdirmaService.getOutput(req.user.tenantId, id);
    if (!rec) throw new NotFoundException('Çıktı bulunamadı');

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${rec.filename}"`,
      'Content-Length': String(rec.fileSize ?? rec.fileBytes.length),
    });
    return res.send(rec.fileBytes);
  }

  /**
   * DELETE /api/v1/fis-yazdirma/outputs/:id
   * Arşivden sil.
   */
  @Delete('outputs/:id')
  async deleteOutput(@Req() req: any, @Param('id') id: string) {
    return this.fisYazdirmaService.deleteOutput(req.user.tenantId, id);
  }
}
