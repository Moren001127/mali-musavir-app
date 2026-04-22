import {
  Controller, Get, Post, Delete, Query, Param, Req, UseGuards,
  UseInterceptors, UploadedFiles, UploadedFile, BadRequestException, Res,
} from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BeyanKayitlariService } from './beyan-kayitlari.service';
import type { Response } from 'express';

@Controller('beyan-kayitlari')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BeyanKayitlariController {
  constructor(private svc: BeyanKayitlariService) {}

  // ── LİSTE ───────────────────────────────────────────
  @Get()
  list(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('beyanTipi') beyanTipi?: string,
    @Query('donem') donem?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(req.user.tenantId, {
      taxpayerId,
      beyanTipi,
      donem,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('ozet')
  ozet(@Req() req: any) {
    return this.svc.ozet(req.user.tenantId);
  }

  // ── PDF İNDİRME (presigned URL redirect) ────────────
  @Get(':id/pdf')
  async pdf(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const url = await this.svc.getPdfUrl(req.user.tenantId, id);
    res.redirect(url);
  }

  // ── SİL ─────────────────────────────────────────────
  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.svc.delete(req.user.tenantId, id);
  }

  // ── PDF KLASÖR İMPORT (toplu yükleme) ───────────────
  // Frontend: FormData ile "files" array olarak PDF'leri gönderir.
  // Max 100 dosya / istek (backend yükünü kontrol etmek için).
  @Post('import-pdf')
  @UseInterceptors(FilesInterceptor('files', 100, {
    limits: { fileSize: 20 * 1024 * 1024 /* 20MB/PDF */ },
  }))
  async importPdf(@Req() req: any, @UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir PDF dosyası gerekli');
    }
    // PDF olmayanları filtrele
    const pdfs = files.filter((f) =>
      f.mimetype === 'application/pdf' ||
      f.originalname.toLowerCase().endsWith('.pdf'),
    );
    if (pdfs.length === 0) {
      throw new BadRequestException('Yüklenen dosyalar arasında PDF yok');
    }

    return this.svc.importPdfBatch(
      req.user.tenantId,
      pdfs.map((f) => ({ originalName: f.originalname, buffer: f.buffer })),
    );
  }

  // ── HATTAT ZIP IMPORT (tek ZIP dosyası) ─────────────
  @Post('import-zip')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 500 * 1024 * 1024 /* 500 MB */ },
  }))
  async importZip(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('ZIP dosyası gerekli');
    if (!/\.zip$/i.test(file.originalname) && file.mimetype !== 'application/zip' && file.mimetype !== 'application/x-zip-compressed') {
      throw new BadRequestException('Sadece ZIP dosyaları kabul edilir');
    }
    return this.svc.importHattatZip(req.user.tenantId, file.buffer);
  }
}
