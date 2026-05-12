import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * System Health Watchdog Service
 *
 * Her 5 dakikada bir kritik bileşenleri kontrol eder ve `system_health_checks`
 * tablosuna yazar. Frontend top-bar dashboard bell butonu /system/health endpoint
 * üzerinden açık (resolved=false) check'leri çeker.
 *
 * Kontrol edilen sinyaller:
 *  - AGENT_PING_MIHSAP    : Mihsap agent'ı son 5 dk içinde ping attı mı
 *  - AGENT_PING_LUCA      : Luca agent'ı son 5 dk içinde ping attı mı
 *  - LUCA_TOKEN_AGE       : Luca session backend'e ne kadar süredir senkron olmadı
 *  - MIHSAP_TOKEN_AGE     : Mihsap token backend'e ne kadar süredir senkron olmadı
 *  - PENDING_QUEUE        : Bekleyen Luca/Mihsap job kuyruk derinliği
 *  - FAILED_RATIO         : Son 1h failed/total job oranı
 *  - MODULE_HASH          : Kilitli modül dosyalarının SHA256 hash'i baseline ile uyumlu mu
 *  - AGENT_VERSION        : Eski sürüm agent kullanımı var mı
 *  - DB_HEALTH            : Prisma bağlantısı sağlam mı (ping)
 */
@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  // === ENTRY POINT — CRON ===
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAllChecks() {
    this.logger.log('SystemHealth: tüm kontroller başlıyor');
    try {
      await Promise.allSettled([
        this.checkAgentPing('mihsap', 'AGENT_PING_MIHSAP', 'Mihsap'),
        this.checkAgentPing('luca', 'AGENT_PING_LUCA', 'Luca'),
        this.checkLucaTokenAge(),
        this.checkMihsapTokenAge(),
        this.checkPendingQueue(),
        this.checkFailedRatio(),
        this.checkModuleHashes(),
        this.checkAgentVersion(),
        this.checkDbHealth(),
      ]);
      this.logger.log('SystemHealth: tüm kontroller tamamlandı');
    } catch (e: any) {
      this.logger.error('SystemHealth runAllChecks hata:', e?.message || e);
    }
  }

  // === MANUEL TETİKLEME (frontend "Şimdi Kontrol Et" butonu) ===
  async runNow() {
    await this.runAllChecks();
    return await this.getActiveAlerts();
  }

  // === ENDPOINT: aktif uyarılar ===
  async getActiveAlerts() {
    const checks = await (this.prisma as any).systemHealthCheck.findMany({
      where: { resolved: false },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

    const summary = {
      total: checks.length,
      critical: checks.filter((c: any) => c.severity === 'CRITICAL').length,
      warning: checks.filter((c: any) => c.severity === 'WARNING').length,
      ok: checks.filter((c: any) => c.severity === 'OK').length,
      lastCheck: checks[0]?.createdAt || null,
    };

    return { summary, checks };
  }

  // ========================================================
  // INDIVIDUAL CHECKS
  // ========================================================

  private async checkAgentPing(agent: 'mihsap' | 'luca', type: string, label: string) {
    try {
      // v1.36.43 FIX: AgentStatus modelinde alan adı 'lastPing' (lastSeen değil).
      // Önceki yanlış field adı yüzünden lastSeen hep undefined geliyor → "hiç ping atmamış" yanlış uyarısı.
      const ping = await (this.prisma as any).agentStatus.findFirst({
        where: { agent },
        orderBy: { lastPing: 'desc' },
      }).catch(() => null);

      const now = Date.now();
      const lastSeen = ping?.lastPing ? new Date(ping.lastPing).getTime() : 0;
      const ageMs = now - lastSeen;
      const ageMin = Math.floor(ageMs / 60000);

      if (!lastSeen) {
        await this.upsertCheck({
          type,
          severity: 'WARNING',
          status: 'DOWN',
          message: `${label} agent'ı hiç ping atmamış`,
          detail: { ageMin: null },
          acilTavsiye: agent === 'luca'
            ? 'Portalda Luca Oturum Yöneticisi ekranını kontrol et; güvenlik kodu bekliyor olabilir'
            : `${label} sekmesini aç ve Moren Agent bookmarklet'ine tıkla`,
        });
      } else if (ageMin > 10) {
        await this.upsertCheck({
          type,
          severity: 'CRITICAL',
          status: 'DOWN',
          message: `${label} agent'ı ${ageMin} dakikadır ping atmıyor`,
          detail: { ageMin, lastSeen },
          acilTavsiye: `${label} sekmesinin açık olduğundan emin ol, bookmarklet'i kapat-aç`,
        });
      } else if (ageMin > 5) {
        await this.upsertCheck({
          type,
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `${label} agent ping aralığı uzadı (${ageMin} dk)`,
          detail: { ageMin, lastSeen },
          acilTavsiye: 'Tarayıcı sekmesi arka planda olabilir',
        });
      } else {
        await this.resolveCheck(type);
      }
    } catch (e: any) {
      this.logger.warn(`checkAgentPing(${agent}) hata:`, e?.message);
    }
  }

  private async checkLucaTokenAge() {
    try {
      const sess = await (this.prisma as any).lucaSession.findFirst({
        orderBy: { updatedAt: 'desc' },
      }).catch(() => null);

      if (!sess) {
        // Hiç sync olmamış — agent muhtemelen Luca sayfasında değil
        return;
      }

      const ageMin = Math.floor((Date.now() - new Date(sess.updatedAt).getTime()) / 60000);

      if (ageMin > 60) {
        await this.upsertCheck({
          type: 'LUCA_TOKEN_AGE',
          severity: 'CRITICAL',
          status: 'DOWN',
          message: `Luca oturumu ${ageMin} dakikadır senkronize değil`,
          detail: { ageMin, lastSync: sess.updatedAt },
          acilTavsiye: "Portalda Luca Oturum Yöneticisi'ni kontrol et — güvenlik kodu veya oturum yenileme bekliyor olabilir",
        });
      } else if (ageMin > 30) {
        await this.upsertCheck({
          type: 'LUCA_TOKEN_AGE',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Luca oturumu ${ageMin} dakikadır senkronize değil`,
          detail: { ageMin, lastSync: sess.updatedAt },
          acilTavsiye: "Portalda Luca Oturum Yöneticisi'ni yenile; gerekirse güvenlik kodunu buradan gir",
        });
      } else {
        await this.resolveCheck('LUCA_TOKEN_AGE');
      }
    } catch (e: any) {
      this.logger.warn('checkLucaTokenAge hata:', e?.message);
    }
  }

  private async checkMihsapTokenAge() {
    try {
      const tok = await (this.prisma as any).mihsapToken.findFirst({
        orderBy: { updatedAt: 'desc' },
      }).catch(() => null);

      if (!tok) return;

      const ageMin = Math.floor((Date.now() - new Date(tok.updatedAt).getTime()) / 60000);

      if (ageMin > 30) {
        await this.upsertCheck({
          type: 'MIHSAP_TOKEN_AGE',
          severity: 'CRITICAL',
          status: 'DOWN',
          message: `Mihsap token ${ageMin} dakikadır senkronize değil`,
          detail: { ageMin, lastSync: tok.updatedAt },
          acilTavsiye: 'Mihsap sekmesini aç, agent token sync edecek',
        });
      } else if (ageMin > 15) {
        await this.upsertCheck({
          type: 'MIHSAP_TOKEN_AGE',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Mihsap token ${ageMin} dk geçmiş`,
          detail: { ageMin, lastSync: tok.updatedAt },
        });
      } else {
        await this.resolveCheck('MIHSAP_TOKEN_AGE');
      }
    } catch (e: any) {
      this.logger.warn('checkMihsapTokenAge hata:', e?.message);
    }
  }

  private async checkPendingQueue() {
    try {
      const pending = await (this.prisma as any).lucaFetchJob.count({
        where: { status: 'pending' },
      }).catch(() => 0);

      if (pending > 50) {
        await this.upsertCheck({
          type: 'PENDING_QUEUE',
          severity: 'CRITICAL',
          status: 'DEGRADED',
          message: `${pending} bekleyen Luca işi var — kuyruk tıkanmış`,
          detail: { pending },
          acilTavsiye: "Portalda Luca Oturum Yöneticisi'ni ve bekleyen güvenlik kodlarını kontrol et",
        });
      } else if (pending > 20) {
        await this.upsertCheck({
          type: 'PENDING_QUEUE',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `${pending} bekleyen Luca işi var`,
          detail: { pending },
        });
      } else {
        await this.resolveCheck('PENDING_QUEUE');
      }
    } catch (e: any) {
      this.logger.warn('checkPendingQueue hata:', e?.message);
    }
  }

  private async checkFailedRatio() {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const total = await (this.prisma as any).lucaFetchJob.count({
        where: { createdAt: { gte: oneHourAgo } },
      }).catch(() => 0);

      if (total < 5) {
        // İstatistik için yeterli veri yok — sessiz geç
        await this.resolveCheck('FAILED_RATIO');
        return;
      }

      const failed = await (this.prisma as any).lucaFetchJob.count({
        where: { createdAt: { gte: oneHourAgo }, status: 'failed' },
      }).catch(() => 0);

      const ratio = failed / total;
      const pct = Math.round(ratio * 100);

      if (ratio >= 0.5) {
        await this.upsertCheck({
          type: 'FAILED_RATIO',
          severity: 'CRITICAL',
          status: 'DEGRADED',
          message: `Son 1 saatte %${pct} job başarısız (${failed}/${total})`,
          detail: { failed, total, ratio },
          acilTavsiye: 'Failed jobların errorMsg alanını incele, çoğunluk aynı hatadaysa agent broken',
        });
      } else if (ratio >= 0.3) {
        await this.upsertCheck({
          type: 'FAILED_RATIO',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Son 1 saatte %${pct} job başarısız (${failed}/${total})`,
          detail: { failed, total, ratio },
        });
      } else {
        await this.resolveCheck('FAILED_RATIO');
      }
    } catch (e: any) {
      this.logger.warn('checkFailedRatio hata:', e?.message);
    }
  }

  private async checkModuleHashes() {
    try {
      const baselinePath = path.resolve(process.cwd(), '../../.locked-modules.json');
      // Alternative path for monorepo root
      const altPath = path.resolve(process.cwd(), '.locked-modules.json');
      const finalPath = fs.existsSync(baselinePath) ? baselinePath : altPath;

      if (!fs.existsSync(finalPath)) {
        // Baseline yok → bu kontrol pasif (henüz kurulmamış)
        await this.resolveCheck('MODULE_HASH');
        return;
      }

      const baseline = JSON.parse(fs.readFileSync(finalPath, 'utf-8')) as Record<
        string,
        { sha256: string; reason: string }
      >;
      const repoRoot = path.resolve(process.cwd(), '../..');
      const mismatches: string[] = [];

      for (const [relPath, expected] of Object.entries(baseline)) {
        const abs = path.resolve(repoRoot, relPath);
        if (!fs.existsSync(abs)) {
          mismatches.push(`${relPath}: dosya YOK`);
          continue;
        }
        const buf = fs.readFileSync(abs);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        if (hash !== expected.sha256) {
          mismatches.push(`${relPath}: hash farklı (beklenen: ${expected.sha256.slice(0, 8)}…, mevcut: ${hash.slice(0, 8)}…) — ${expected.reason}`);
        }
      }

      if (mismatches.length > 0) {
        await this.upsertCheck({
          type: 'MODULE_HASH',
          severity: 'CRITICAL',
          status: 'DEGRADED',
          message: `${mismatches.length} kilitli modül beklenmedik şekilde değişmiş`,
          detail: { mismatches },
          acilTavsiye: 'git diff ile değişikliği gör. Kasıtlıysa baseline güncelle (.locked-modules.json sha256), değilse revert et.',
        });
      } else {
        await this.resolveCheck('MODULE_HASH');
      }
    } catch (e: any) {
      this.logger.warn('checkModuleHashes hata:', e?.message);
    }
  }

  private async checkAgentVersion() {
    try {
      // Son 1 saatte ping atan agent'ların version dağılımı
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      // v1.36.43: lastPing field (lastSeen şemada yok)
      const agents = await (this.prisma as any).$queryRaw<
        Array<{ agent: string; agentVersion: string | null; version: string | null; lastPing: Date }>
      >`
        SELECT "agent", "meta"->>'agentVersion' AS "agentVersion", "meta"->>'version' AS "version", "lastPing"
        FROM "agent_status"
        WHERE "lastPing" >= ${oneHourAgo}
      `.catch(() => []);

      const versionCounts: Record<string, number> = {};
      for (const a of agents) {
        const v = a.agentVersion || a.version || 'bilinmeyen';
        versionCounts[v] = (versionCounts[v] || 0) + 1;
      }

      const expected = '1.36'; // major.minor — bu prefix'le başlamayanlar eski
      const oldVersions = Object.keys(versionCounts).filter(
        (v) => v !== 'bilinmeyen' && !v.startsWith(expected),
      );

      if (oldVersions.length > 0) {
        const detail = oldVersions.map((v) => `${v}=${versionCounts[v]}`).join(', ');
        await this.upsertCheck({
          type: 'AGENT_VERSION',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Eski sürüm agent aktif: ${detail}`,
          detail: { versionCounts, oldVersions },
          acilTavsiye: 'Tüm kullanıcılar Luca/Mihsap sekmelerinde bookmarklet\'i tekrar tıklasın — version-aware reload yükselti yapacak',
        });
      } else {
        await this.resolveCheck('AGENT_VERSION');
      }
    } catch (e: any) {
      this.logger.warn('checkAgentVersion hata:', e?.message);
    }
  }

  private async checkDbHealth() {
    try {
      // Basit ping: tenant tablosundan 1 kayıt say
      await (this.prisma as any).tenant.count();
      await this.resolveCheck('DB_HEALTH');
    } catch (e: any) {
      await this.upsertCheck({
        type: 'DB_HEALTH',
        severity: 'CRITICAL',
        status: 'DOWN',
        message: 'Veritabanı bağlantısı başarısız',
        detail: { error: e?.message?.slice(0, 200) },
        acilTavsiye: 'Railway DB durumunu kontrol et (status.railway.app)',
      });
    }
  }

  // ========================================================
  // HELPERS
  // ========================================================

  private async upsertCheck(args: {
    type: string;
    severity: 'OK' | 'WARNING' | 'CRITICAL';
    status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
    message: string;
    detail?: any;
    acilTavsiye?: string;
    tenantId?: string | null;
  }) {
    // Aynı type için açık (resolved=false) check varsa onu güncelle, yoksa yeni oluştur.
    const existing = await (this.prisma as any).systemHealthCheck.findFirst({
      where: { type: args.type, resolved: false },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await (this.prisma as any).systemHealthCheck.update({
        where: { id: existing.id },
        data: {
          severity: args.severity,
          status: args.status,
          message: args.message,
          detail: args.detail || null,
          acilTavsiye: args.acilTavsiye || null,
          updatedAt: new Date(),
        },
      });
    } else {
      await (this.prisma as any).systemHealthCheck.create({
        data: {
          tenantId: args.tenantId || null,
          type: args.type,
          severity: args.severity,
          status: args.status,
          message: args.message,
          detail: args.detail || null,
          acilTavsiye: args.acilTavsiye || null,
          resolved: false,
        },
      });
    }
  }

  private async resolveCheck(type: string) {
    await (this.prisma as any).systemHealthCheck.updateMany({
      where: { type, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }
}
