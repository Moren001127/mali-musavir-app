import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

const documentUploadInterceptor = () =>
  FilesInterceptor('files', 100, {
    storage: memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype.startsWith('image/') ||
        file.mimetype === 'application/pdf' ||
        file.mimetype.includes('xml') ||
        /\.xml$/i.test(file.originalname);
      if (ok) cb(null, true);
      else cb(new BadRequestException('Sadece görsel, PDF veya XML belge kabul edilir') as any, false);
    },
  });

@Controller('fatura-muhasebelestirme')
@UseGuards(AuthGuard('jwt'))
export class FaturaMuhasebelestirmeController {
  constructor(private readonly service: FaturaMuhasebelestirmeService) {}

  @Get('documents')
  list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(req.user.tenantId, {
      status,
      taxpayerId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('documents/upload')
  @UseInterceptors(documentUploadInterceptor())
  upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
    @Body('taxpayerId') taxpayerId?: string,
    @Body('source') source?: string,
    @Body('documentType') documentType?: string,
    @Body('invoiceKind') invoiceKind?: string,
    @Body('forceClaude') forceClaude?: string,
  ) {
    return this.service.uploadAndOcr(req.user.tenantId, req.user?.userId, files, {
      taxpayerId: taxpayerId || undefined,
      source: source || 'manual-web',
      documentType: documentType || 'OKC_FIS',
      invoiceKind: invoiceKind || 'ALIS',
      forceClaude: forceClaude === 'true',
    });
  }

  @Get('documents/:id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.service.get(req.user.tenantId, id);
  }

  @Get('documents/:id/file-url')
  fileUrl(@Req() req: any, @Param('id') id: string) {
    return this.service.fileUrl(req.user.tenantId, id);
  }

  @Patch('documents/:id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.update(req.user.tenantId, id, body);
  }

  @Post('documents/:id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.service.approve(req.user.tenantId, id, req.user?.userId);
  }

  @Delete('documents/:id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.tenantId, id);
  }
}
