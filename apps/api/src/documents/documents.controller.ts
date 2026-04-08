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
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DocumentsService } from './documents.service';
import {
  InitiateUploadSchema,
  ConfirmUploadSchema,
  UpdateDocumentSchema,
} from '@mali-musavir/shared';

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

  /** Yeni versiyon — başlat */
  @Post(':id/versions/initiate')
  @Roles('ADMIN', 'STAFF')
  initiateNewVersion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.documentsService.initiateNewVersion(id, req.user.tenantId, body);
  }

  /** Yeni versiyon — onayla */
  @Post(':id/versions/confirm')
  @Roles('ADMIN', 'STAFF')
  confirmNewVersion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.documentsService.confirmNewVersion(
      id,
      req.user.tenantId,
      req.user.sub,
      body,
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
