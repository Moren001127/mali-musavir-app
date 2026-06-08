import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DocumentsService } from './documents.service';
import {
  InitiateUploadSchema,
  ConfirmUploadSchema,
  InitiateNewVersionSchema,
  ConfirmNewVersionSchema,
  UpdateDocumentSchema,
} from '@mali-musavir/shared';

function parseUploadTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((tag) => String(tag).trim()).filter(Boolean);
  } catch {
    return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return undefined;
}

@Controller('documents')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  /** Tüm evrak arşivi (tenant geneli) */
  @Get()
  findAll(
    @Req() req: any,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.documentsService.findAll(req.user.tenantId, category, search);
  }

  /**
   * Geçerliliği biten veya yakında bitecek belgeler.
   * Dashboard widget ve mükellef detay uyarısı için.
   * Param: daysAhead (default 30), includeExpired (default true), taxpayerId
   */
  @Get('expiring/all')
  getExpiring(
    @Req() req: any,
    @Query('daysAhead') daysAhead?: string,
    @Query('includeExpired') includeExpired?: string,
    @Query('taxpayerId') taxpayerId?: string,
  ) {
    return this.documentsService.getExpiring(req.user.tenantId, {
      daysAhead: daysAhead ? Math.min(parseInt(daysAhead, 10), 365) : 30,
      includeExpired: includeExpired !== 'false',
      taxpayerId: taxpayerId || undefined,
    });
  }

  /** Mükellef bazlı belgeler */
  @Get('taxpayer/:taxpayerId')
  findByTaxpayer(
    @Req() req: any,
    @Param('taxpayerId') taxpayerId: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.documentsService.findByTaxpayer(
      req.user.tenantId,
      taxpayerId,
      category,
      search,
    );
  }

  /** Belge detayı */
  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.findOne(id, req.user.tenantId);
  }

  /** Tarayici icinde onizleme URL'i al */
  @Get(':id/preview')
  getPreviewUrl(
    @Req() req: any,
    @Param('id') id: string,
    @Query('version') version?: string,
  ) {
    return this.documentsService.getPreviewUrl(
      id,
      req.user.tenantId,
      version ? parseInt(version, 10) : undefined,
    );
  }

  /** İndirme URL'i al */
  @Get(':id/download')
  getDownloadUrl(
    @Req() req: any,
    @Param('id') id: string,
    @Query('version') version?: string,
  ) {
    return this.documentsService.getDownloadUrl(
      id,
      req.user.tenantId,
      version ? parseInt(version, 10) : undefined,
    );
  }

  /** Upload başlat — presigned URL al */
  @Post('upload/initiate')
  @Roles('ADMIN', 'STAFF')
  initiateUpload(@Req() req: any, @Body() body: any) {
    const dto = InitiateUploadSchema.parse(body);
    return this.documentsService.initiateUpload(
      req.user.tenantId,
      req.user.sub,
      dto,
    );
  }

  /** Upload onayla — S3'e yüklendikten sonra çağrılır */
  @Post('upload/confirm')
  @Roles('ADMIN', 'STAFF')
  confirmUpload(@Req() req: any, @Body() body: any) {
    const uploadDto = InitiateUploadSchema.parse(body);
    const confirmDto = ConfirmUploadSchema.parse(body);
    return this.documentsService.confirmUpload(req.user.tenantId, req.user.sub, {
      ...uploadDto,
      s3Key: confirmDto.s3Key,
    });
  }

  /** Canli ortam uyumlu direkt upload — browser S3/MinIO'ya gitmez, API yukler */
  @Post('upload/direct')
  @Roles('ADMIN', 'STAFF')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, _file, cb) => cb(null, true),
  }))
  directUpload(
    @Req() req: any,
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Dosya secilmedi');
    }
    const dto = InitiateUploadSchema.parse({
      taxpayerId: body.taxpayerId,
      title: body.title || file.originalname,
      category: body.category,
      mimeType: file.mimetype || body.mimeType || 'application/octet-stream',
      originalName: file.originalname || body.originalName || body.title || 'document.bin',
      tags: parseUploadTags(body.tags),
    });

    return this.documentsService.uploadDirect(
      req.user.tenantId,
      req.user.sub,
      dto,
      file,
    );
  }

  /** Yeni versiyon — başlat */
  @Post(':id/versions/initiate')
  @Roles('ADMIN', 'STAFF')
  initiateNewVersion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const dto = InitiateNewVersionSchema.parse(body);
    return this.documentsService.initiateNewVersion(id, req.user.tenantId, dto);
  }

  /** Yeni versiyon — onayla */
  @Post(':id/versions/confirm')
  @Roles('ADMIN', 'STAFF')
  confirmNewVersion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const dto = ConfirmNewVersionSchema.parse(body);
    return this.documentsService.confirmNewVersion(
      id,
      req.user.tenantId,
      req.user.sub,
      dto,
    );
  }

  /** Belge meta güncelle */
  @Patch(':id')
  @Roles('ADMIN', 'STAFF')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const dto = UpdateDocumentSchema.parse(body);
    return this.documentsService.update(id, req.user.tenantId, dto);
  }

  /** Soft delete */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.documentsService.softDelete(id, req.user.tenantId);
  }
}
