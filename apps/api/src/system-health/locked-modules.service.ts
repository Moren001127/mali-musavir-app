import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Kilitli Modül Yönetimi
 *
 * - SOURCE OF TRUTH: DB tablosu `locked_modules`
 * - SEED: `.locked-modules.json` (ilk kurulum / Railway deploy fallback)
 * - SystemHealthService.checkModuleHashes bu service'i kullanır
 * - Admin panelden CRUD yapar (lock/unlock/rebaseline)
 */
@Injectable()
export class LockedModulesService {
  private readonly logger = new Logger(LockedModulesService.name);

  // Repo root — Railway: /app, dev: /sessions/.../mali-musavir-app
  // process.cwd() Railway'de /app/apps/api olur, repo root = ../../
  private readonly REPO_ROOT =
    process.env.MOREN_REPO_ROOT || path.resolve(process.cwd(), '../..');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * İlk başlatmada DB boşsa .locked-modules.json'dan seed yap.
   */
  async seedFromJsonIfEmpty() {
    try {
      const count = await (this.prisma as any).lockedModule.count();
      if (count > 0) return;

      const jsonPath = path.join(this.REPO_ROOT, '.locked-modules.json');
      if (!fs.existsSync(jsonPath)) {
        this.logger.log('seed: .locked-modules.json yok, atlandı');
        return;
      }

      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const modules = data.modules || {};
      let seeded = 0;
      for (const [relPath, meta] of Object.entries(modules)) {
        try {
          await (this.prisma as any).lockedModule.create({
            data: {
              path: relPath,
              sha256: (meta as any).sha256,
              reason: (meta as any).reason || 'baseline',
              lockedBy: 'system-seed',
            },
          });
          seeded++;
        } catch (e: any) {
          this.logger.warn(`seed ${relPath} hata: ${e?.message}`);
        }
      }
      this.logger.log(`seed tamamlandı: ${seeded} modül kilitlendi`);
    } catch (e: any) {
      this.logger.warn('seedFromJsonIfEmpty hata:', e?.message);
    }
  }

  // ============ CRUD ============

  async list() {
    const modules = await (this.prisma as any).lockedModule.findMany({
      where: { active: true },
      orderBy: { path: 'asc' },
    });

    // Her modül için canlı hash hesapla, drift kontrolü
    const result = modules.map((m: any) => {
      const abs = path.join(this.REPO_ROOT, m.path);
      let currentSha: string | null = null;
      let exists = fs.existsSync(abs);
      if (exists) {
        const buf = fs.readFileSync(abs);
        currentSha = crypto.createHash('sha256').update(buf).digest('hex');
      }
      const matches = currentSha === m.sha256;
      return {
        ...m,
        currentSha,
        exists,
        matches,
        status: !exists ? 'MISSING' : matches ? 'OK' : 'DRIFT',
      };
    });
    return result;
  }

  async getOne(id: string) {
    const m = await (this.prisma as any).lockedModule.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Kilitli modül bulunamadı');
    return m;
  }

  /**
   * Yeni dosya kilitle. Backend dosyayı okur, hash hesaplar, DB'ye yazar.
   */
  async lock(input: { path: string; reason: string; lockedBy: string; notes?: string }) {
    // Path normalize: önce/sonra slash temizle
    const cleanPath = input.path.replace(/^\/+|\/+$/g, '');
    const abs = path.join(this.REPO_ROOT, cleanPath);

    if (!fs.existsSync(abs)) {
      throw new BadRequestException(`Dosya bulunamadı: ${cleanPath} (REPO_ROOT=${this.REPO_ROOT})`);
    }

    // Dizin değil dosya olmalı
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      throw new BadRequestException(`${cleanPath} bir dosya değil`);
    }

    // Var mı?
    const existing = await (this.prisma as any).lockedModule.findUnique({
      where: { path: cleanPath },
    });
    if (existing && existing.active) {
      throw new ConflictException('Bu modül zaten kilitli — rebaseline yap veya unlock et');
    }

    const buf = fs.readFileSync(abs);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');

    if (existing && !existing.active) {
      // Daha önce unlock edilmiş — re-aktive et
      return await (this.prisma as any).lockedModule.update({
        where: { id: existing.id },
        data: {
          active: true,
          sha256: sha,
          reason: input.reason,
          lockedBy: input.lockedBy,
          lockedAt: new Date(),
          notes: input.notes || null,
        },
      });
    }

    return await (this.prisma as any).lockedModule.create({
      data: {
        path: cleanPath,
        sha256: sha,
        reason: input.reason,
        lockedBy: input.lockedBy,
        notes: input.notes || null,
      },
    });
  }

  /**
   * Re-baseline: dosya kasıtlı değişti, yeni hash'i baseline yap.
   */
  async rebaseline(id: string) {
    const m = await this.getOne(id);
    const abs = path.join(this.REPO_ROOT, m.path);
    if (!fs.existsSync(abs)) {
      throw new BadRequestException(`Dosya bulunamadı: ${m.path}`);
    }
    const buf = fs.readFileSync(abs);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    return await (this.prisma as any).lockedModule.update({
      where: { id },
      data: {
        sha256: sha,
        rebaselined: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  }

  async unlock(id: string) {
    const m = await this.getOne(id);
    return await (this.prisma as any).lockedModule.update({
      where: { id },
      data: { active: false, updatedAt: new Date() },
    });
  }

  /**
   * Hard delete — gerçekten satırı kaldır (audit silmiş olur).
   */
  async destroy(id: string) {
    await this.getOne(id); // existence check
    await (this.prisma as any).lockedModule.delete({ where: { id } });
    return { ok: true };
  }

  // === Health check için liste (drift bul) ===
  async getDrifts(): Promise<Array<{ path: string; reason: string; mismatch: string }>> {
    const list = await this.list();
    return list
      .filter((m: any) => !m.matches)
      .map((m: any) => ({
        path: m.path,
        reason: m.reason,
        mismatch: m.exists
          ? `hash farklı (beklenen: ${m.sha256.slice(0, 8)}…, mevcut: ${m.currentSha?.slice(0, 8)}…)`
          : 'dosya yok',
      }));
  }
}
