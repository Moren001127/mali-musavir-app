import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Bildirim başlığında ham kontrol kodu (AGENT_PING_LUCA gibi) yerine Türkçe açıklama. */
const SISTEM_UYARI_ETIKET: Record<string, string> = {
  AGENT_PING_MIHSAP: 'Mihsap ajanı yanıt vermiyor',
  AGENT_PING_LUCA: 'Luca ajanı yanıt vermiyor',
  LUCA_TOKEN_AGE: 'Luca oturumu eskidi',
  MIHSAP_TOKEN_AGE: 'Mihsap oturumu eskidi',
  PENDING_QUEUE: 'Bekleyen iş kuyruğu büyüdü',
  FAILED_RATIO: 'Başarısız iş oranı yüksek',
  LUCA_JOB_FAILURE: 'Luca işi hata verdi',
  MODULE_HASH: 'Kilitli modül dosyası değişti',
  AGENT_VERSION: 'Eski sürüm ajan var',
  DB_HEALTH: 'Veritabanı bağlantısı sorunlu',
};

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
 *  - LUCA_JOB_FAILURE     : Son 24 saatte tekil Luca job hatası var mı
 *  - MODULE_HASH          : Kilitli modül dosyalarının SHA256 hash'i baseline ile uyumlu mu
 *  - AGENT_VERSION        : Eski sürüm agent kullanımı var mı
 *  - DB_HEALTH            : Prisma bağlantısı sağlam mı (ping)
 */
@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // === ENTRY POINT — CRON ===
  //
  // 2026-09-25 (portal denetimi bulgu 33) — KONTROLLER ARTIK OFİS BAZLI.
  //   Ajan/oturum/kuyruk sorgularının hiçbirinde `tenantId` yoktu: başka ofisin ajanı
  //   ping attığında BİZİM panelimiz "sağlıklı" gösteriyordu; tersi de doğruydu — kendi
  //   ajanımız düşmüşken başka ofisin ajanı yüzünden uyarı hiç çıkmıyordu.
  //   Satış hazırlığında (çok ofisli kullanım) bu en riskli kusurdu.
  //   Altyapı kontrolleri (MODULE_HASH, DB_HEALTH) ofisten bağımsız → tenantId null.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAllChecks() {
    this.logger.log('SystemHealth: tüm kontroller başlıyor');
    try {
      const tenants: Array<{ id: string }> = await (this.prisma as any).tenant
        .findMany({ select: { id: true } })
        .catch(() => []);

      const isler: Array<Promise<any>> = [
        // Ofisten bağımsız altyapı kontrolleri
        this.checkModuleHashes(),
        this.checkDbHealth(),
      ];
      for (const t of tenants) {
        isler.push(
          this.checkAgentPing('mihsap', 'AGENT_PING_MIHSAP', 'Mihsap', t.id),
          this.checkAgentPing('luca', 'AGENT_PING_LUCA', 'Luca', t.id),
          this.checkLucaTokenAge(t.id),
          this.checkMihsapTokenAge(t.id),
          this.checkPendingQueue(t.id),
          this.checkFailedRatio(t.id),
          this.checkRecentLucaJobFailures(t.id),
          this.checkAgentVersion(t.id),
        );
      }
      await Promise.allSettled(isler);
      await this.ofissizEskiUyarilariKapat();
      this.logger.log(`SystemHealth: tüm kontroller tamamlandı (${tenants.length} ofis)`);
    } catch (e: any) {
      this.logger.error('SystemHealth runAllChecks hata:', e?.message || e);
    }
  }

  // === MANUEL TETİKLEME (frontend "Şimdi Kontrol Et" butonu) ===
  async runNow(tenantId?: string) {
    await this.runAllChecks();
    return await this.getActiveAlerts(tenantId);
  }

  // === ENDPOINT: aktif uyarılar ===
  async getActiveAlerts(tenantId?: string) {
    // Bulgu 33: ofisin kendi uyarıları + ofisten bağımsız altyapı uyarıları (tenantId null).
    const where: any = tenantId
      ? { resolved: false, OR: [{ tenantId }, { tenantId: null }] }
      : { resolved: false };
    const checks = await (this.prisma as any).systemHealthCheck.findMany({
      where,
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

  private async checkAgentPing(agent: 'mihsap' | 'luca', type: string, label: string, tenantId: string) {
    try {
      // v1.36.43 FIX: AgentStatus modelinde alan adı 'lastPing' (lastSeen değil).
      // Önceki yanlış field adı yüzünden lastSeen hep undefined geliyor → "hiç ping atmamış" yanlış uyarısı.
      const ping = await (this.prisma as any).agentStatus.findFirst({
        where: { agent, tenantId },
        orderBy: { lastPing: 'desc' },
      }).catch(() => null);

      const now = Date.now();
      const lastSeen = ping?.lastPing ? new Date(ping.lastPing).getTime() : 0;
      const ageMs = now - lastSeen;
      const ageMin = Math.floor(ageMs / 60000);

      if (!lastSeen) {
        await this.upsertCheck({
          tenantId,
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
          tenantId,
          type,
          severity: 'CRITICAL',
          status: 'DOWN',
          message: `${label} agent'ı ${ageMin} dakikadır ping atmıyor`,
          detail: { ageMin, lastSeen },
          acilTavsiye: `${label} sekmesinin açık olduğundan emin ol, bookmarklet'i kapat-aç`,
        });
      } else if (ageMin > 5) {
        await this.upsertCheck({
          tenantId,
          type,
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `${label} agent ping aralığı uzadı (${ageMin} dk)`,
          detail: { ageMin, lastSeen },
          acilTavsiye: 'Tarayıcı sekmesi arka planda olabilir',
        });
      } else {
        await this.resolveCheck(type, tenantId);
      }
    } catch (e: any) {
      this.logger.warn(`checkAgentPing(${agent}) hata:`, e?.message);
    }
  }

  private async checkLucaTokenAge(tenantId: string) {
    try {
      const sess = await (this.prisma as any).lucaSession.findFirst({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      }).catch(() => null);

      if (!sess) {
        // Hiç sync olmamış — agent muhtemelen Luca sayfasında değil
        return;
      }

      const ageMin = Math.floor((Date.now() - new Date(sess.updatedAt).getTime()) / 60000);

      if (ageMin > 60) {
        await this.upsertCheck({
          tenantId,
          type: 'LUCA_TOKEN_AGE',
          severity: 'CRITICAL',
          status: 'DOWN',
          message: `Luca oturumu ${ageMin} dakikadır senkronize değil`,
          detail: { ageMin, lastSync: sess.updatedAt },
          acilTavsiye: "Portalda Luca Oturum Yöneticisi'ni kontrol et — güvenlik kodu veya oturum yenileme bekliyor olabilir",
        });
      } else if (ageMin > 30) {
        await this.upsertCheck({
          tenantId,
          type: 'LUCA_TOKEN_AGE',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Luca oturumu ${ageMin} dakikadır senkronize değil`,
          detail: { ageMin, lastSync: sess.updatedAt },
          acilTavsiye: "Portalda Luca Oturum Yöneticisi'ni yenile; gerekirse güvenlik kodunu buradan gir",
        });
      } else {
        await this.resolveCheck('LUCA_TOKEN_AGE', tenantId);
      }
    } catch (e: any) {
      this.logger.warn('checkLucaTokenAge hata:', e?.message);
    }
  }

  private async checkMihsapTokenAge(tenantId: string) {
    try {
      // 2026-09-25: `mihsapToken` diye bir model ŞEMADA YOK — doğrusu `mihsapSession`
      //   (schema.prisma:1581, tablo mihsap_sessions). Eski çağrı her seferinde
      //   "Cannot read properties of undefined" fırlatıp dıştaki catch'e düşüyordu:
      //   bu kontrol BUGÜNE KADAR HİÇ ÇALIŞMADI, tek uyarı üretmedi.
      const tok = await (this.prisma as any).mihsapSession.findFirst({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
      }).catch(() => null);

      if (!tok) return;

      const ageMin = Math.floor((Date.now() - new Date(tok.updatedAt).getTime()) / 60000);

      if (ageMin > 30) {
        await this.upsertCheck({
          tenantId,
          type: 'MIHSAP_TOKEN_AGE',
          severity: 'CRITICAL',
          status: 'DOWN',
          message: `Mihsap token ${ageMin} dakikadır senkronize değil`,
          detail: { ageMin, lastSync: tok.updatedAt },
          acilTavsiye: 'Mihsap sekmesini aç, agent token sync edecek',
        });
      } else if (ageMin > 15) {
        await this.upsertCheck({
          tenantId,
          type: 'MIHSAP_TOKEN_AGE',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Mihsap token ${ageMin} dk geçmiş`,
          detail: { ageMin, lastSync: tok.updatedAt },
        });
      } else {
        await this.resolveCheck('MIHSAP_TOKEN_AGE', tenantId);
      }
    } catch (e: any) {
      this.logger.warn('checkMihsapTokenAge hata:', e?.message);
    }
  }

  private async checkPendingQueue(tenantId: string) {
    try {
      const pending = await (this.prisma as any).lucaFetchJob.count({
        where: { status: 'pending', tenantId },
      }).catch(() => 0);

      if (pending > 50) {
        await this.upsertCheck({
          tenantId,
          type: 'PENDING_QUEUE',
          severity: 'CRITICAL',
          status: 'DEGRADED',
          message: `${pending} bekleyen Luca işi var — kuyruk tıkanmış`,
          detail: { pending },
          acilTavsiye: "Portalda Luca Oturum Yöneticisi'ni ve bekleyen güvenlik kodlarını kontrol et",
        });
      } else if (pending > 20) {
        await this.upsertCheck({
          tenantId,
          type: 'PENDING_QUEUE',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `${pending} bekleyen Luca işi var`,
          detail: { pending },
        });
      } else {
        await this.resolveCheck('PENDING_QUEUE', tenantId);
      }
    } catch (e: any) {
      this.logger.warn('checkPendingQueue hata:', e?.message);
    }
  }

  private async checkFailedRatio(tenantId: string) {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const total = await (this.prisma as any).lucaFetchJob.count({
        where: { createdAt: { gte: oneHourAgo }, tenantId },
      }).catch(() => 0);

      if (total < 5) {
        // İstatistik için yeterli veri yok — sessiz geç
        await this.resolveCheck('FAILED_RATIO', tenantId);
        return;
      }

      const failed = await (this.prisma as any).lucaFetchJob.count({
        where: { createdAt: { gte: oneHourAgo }, status: 'failed', tenantId },
      }).catch(() => 0);

      const ratio = failed / total;
      const pct = Math.round(ratio * 100);

      if (ratio >= 0.5) {
        await this.upsertCheck({
          tenantId,
          type: 'FAILED_RATIO',
          severity: 'CRITICAL',
          status: 'DEGRADED',
          message: `Son 1 saatte %${pct} job başarısız (${failed}/${total})`,
          detail: { failed, total, ratio },
          acilTavsiye: 'Failed jobların errorMsg alanını incele, çoğunluk aynı hatadaysa agent broken',
        });
      } else if (ratio >= 0.3) {
        await this.upsertCheck({
          tenantId,
          type: 'FAILED_RATIO',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Son 1 saatte %${pct} job başarısız (${failed}/${total})`,
          detail: { failed, total, ratio },
        });
      } else {
        await this.resolveCheck('FAILED_RATIO', tenantId);
      }
    } catch (e: any) {
      this.logger.warn('checkFailedRatio hata:', e?.message);
    }
  }

  private async checkRecentLucaJobFailures(tenantId: string) {
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const failureWhere = {
        status: 'failed',
        tenantId,
        OR: [
          { finishedAt: { gte: dayAgo } },
          { finishedAt: null, createdAt: { gte: dayAgo } },
        ],
      };

      const [failed24h, failed1h, latestFailures] = await Promise.all([
        (this.prisma as any).lucaFetchJob.count({ where: failureWhere }).catch(() => 0),
        (this.prisma as any).lucaFetchJob.count({
          where: {
            status: 'failed',
            tenantId,
            OR: [
              { finishedAt: { gte: hourAgo } },
              { finishedAt: null, createdAt: { gte: hourAgo } },
            ],
          },
        }).catch(() => 0),
        (this.prisma as any).lucaFetchJob.findMany({
          where: failureWhere,
          orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
          take: 5,
          select: {
            id: true,
            tenantId: true,
            mukellefId: true,
            donem: true,
            tip: true,
            errorMsg: true,
            createdAt: true,
            startedAt: true,
            finishedAt: true,
          },
        }).catch(() => []),
      ]);

      if (!failed24h || latestFailures.length === 0) {
        await this.resolveCheck('LUCA_JOB_FAILURE', tenantId);
        return;
      }

      const latest = latestFailures[0];
      const latestAt = latest.finishedAt || latest.createdAt;
      const ageMin = Math.max(0, Math.floor((Date.now() - new Date(latestAt).getTime()) / 60000));
      const taxpayerName = this.extractMetaValue(latest.errorMsg, 'mukellefAdi');
      const errorLine = this.lastUsefulLogLine(latest.errorMsg);
      const severity = failed1h >= 3 || ageMin <= 30 ? 'CRITICAL' : 'WARNING';
      const jobLabel = `${this.formatJobTip(latest.tip)}${taxpayerName ? ` · ${taxpayerName}` : ''}`;

      await this.upsertCheck({
        tenantId,
        type: 'LUCA_JOB_FAILURE',
        severity,
        status: severity === 'CRITICAL' ? 'DOWN' : 'DEGRADED',
        message: `${jobLabel} işi hata verdi`,
        detail: {
          failed24h,
          failed1h,
          latest: {
            id: latest.id,
            tip: latest.tip,
            mukellefId: latest.mukellefId,
            mukellefAdi: taxpayerName,
            donem: latest.donem,
            ageMin,
            error: errorLine,
            finishedAt: latest.finishedAt,
          },
          recent: latestFailures.map((job: any) => ({
            id: job.id,
            tip: job.tip,
            mukellefAdi: this.extractMetaValue(job.errorMsg, 'mukellefAdi'),
            donem: job.donem,
            error: this.lastUsefulLogLine(job.errorMsg),
            finishedAt: job.finishedAt,
          })),
        },
        acilTavsiye: errorLine
          ? `Ajan logunu aç: ${errorLine}`
          : 'Luca iş logunu aç; gerekirse aynı işi yeniden sıraya al.',
      });
    } catch (e: any) {
      this.logger.warn('checkRecentLucaJobFailures hata:', e?.message);
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

  private async checkAgentVersion(tenantId: string) {
    try {
      // Son 1 saatte ping atan agent'ların version dağılımı
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      // v1.36.43: lastPing field (lastSeen şemada yok)
      const agents = await (this.prisma as any).$queryRaw<
        Array<{ agent: string; agentVersion: string | null; version: string | null; lastPing: Date }>
      >`
        SELECT "agent", "meta"->>'agentVersion' AS "agentVersion", "meta"->>'version' AS "version", "lastPing"
        FROM "agent_status"
        WHERE "lastPing" >= ${oneHourAgo} AND "tenantId" = ${tenantId}
      `.catch(() => []);

      const versionCounts: Record<string, number> = {};
      for (const a of agents) {
        const v = a.agentVersion || a.version || 'bilinmeyen';
        versionCounts[v] = (versionCounts[v] || 0) + 1;
      }

      const minBrowserVersion = '1.37.0';
      const minLocalVersion = 'local-1.1.2';
      const oldVersions = Object.keys(versionCounts).filter((v) => this.isOldAgentVersion(v));

      if (oldVersions.length > 0) {
        const detail = oldVersions.map((v) => `${v}=${versionCounts[v]}`).join(', ');
        await this.upsertCheck({
          tenantId,
          type: 'AGENT_VERSION',
          severity: 'WARNING',
          status: 'DEGRADED',
          message: `Güncel olmayan agent aktif: ${detail}`,
          detail: { versionCounts, oldVersions, minBrowserVersion, minLocalVersion },
          acilTavsiye: "Luca/Mihsap sekmelerinde bookmarklet'i tekrar tıkla; local agent ise yeniden başlat.",
        });
      } else {
        await this.resolveCheck('AGENT_VERSION', tenantId);
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
    // Bulgu 33: aynı tip uyarı ofis başına AYRI tutulmalı; yoksa A ofisinin açık uyarısı
    // B ofisinin kontrolüyle eziliyor ve iki ofisten biri uyarıyı hiç görmüyordu.
    const existing = await (this.prisma as any).systemHealthCheck.findFirst({
      where: { type: args.type, resolved: false, tenantId: args.tenantId ?? null },
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

      // === IN-APP BILDIRIM: Yeni CRITICAL system health uyarisi ===
      // Sadece CRITICAL ve sadece YENI (existing yoksa) durumda. WARNING'leri spam etmemek icin.
      if (args.severity === 'CRITICAL' && this.notifications) {
        // Başlık Türkçe (ham kod yerine); metadata.healthCheckType ham kodu taşır —
        //   merkezi politika LUCA_JOB_FAILURE'ı atlar (LUCA_SYNC_ERROR bildirimi zaten var).
        const baslik = `🚨 ${SISTEM_UYARI_ETIKET[args.type] || args.type}`;
        // tenantId yoksa tum tenantlara at — ama bu spam olabilir, sadece tenantId varsa tenant'a at.
        if (args.tenantId) {
          await this.notifications.createForTenant({
            tenantId: args.tenantId,
            type: NOTIFICATION_TYPES.SYSTEM,
            title: baslik,
            body: `${args.message}${args.acilTavsiye ? `\n\nÖneri: ${args.acilTavsiye}` : ''}`,
            metadata: {
              healthCheckType: args.type,
              status: args.status,
              detail: args.detail,
              link: '/panel/ayarlar',
            },
            dedupeKey: `sys-health:${args.type}`,
            dedupeWindowMin: 60 * 6, // 6 saat
          }).catch((e) => {
            this.logger.warn(`SYSTEM notif failed: ${(e as Error).message}`);
          });
        } else {
          // Tenant geneli kritik (DB_HEALTH gibi) — tum tenantlara at
          const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true } }).catch(() => []);
          for (const t of tenants) {
            await this.notifications.createForTenant({
              tenantId: t.id,
              type: NOTIFICATION_TYPES.SYSTEM,
              title: baslik,
              body: `${args.message}${args.acilTavsiye ? `\n\nÖneri: ${args.acilTavsiye}` : ''}`,
              // healthCheckType burada da var → politika katmanı ham koda bakabilir
              metadata: { healthCheckType: args.type, status: args.status, link: '/panel/ayarlar' },
              dedupeKey: `sys-health:${args.type}`,
              dedupeWindowMin: 60 * 6,
            }).catch(() => null);
          }
        }
      }
    }
  }

  /**
   * GEÇİŞ TEMİZLİĞİ (bulgu 33) — ofis bazlı kontrole geçmeden ÖNCE açılmış, `tenantId`'si
   * boş uyarıları kapatır.
   *
   * Neden gerekli: bu uyarılar artık ofis başına yeniden üretiliyor; eski ofissiz satırlar
   * hiçbir kontrol tarafından kapatılamaz (kapatma da ofise bağlı) ve `tenantId: null`
   * altyapı uyarısı sayıldıkları için HER OFİSİN panelinde sonsuza dek asılı kalırlardı.
   * Canlı ölçüm (25.09.2026): tam 2 satır — LUCA_JOB_FAILURE ve LUCA_TOKEN_AGE.
   * Koşul sürüyorsa aynı tur içinde ofis bazlı olarak zaten yeniden açılır.
   */
  private async ofissizEskiUyarilariKapat() {
    const OFIS_BAZLI_TIPLER = [
      'AGENT_PING_MIHSAP', 'AGENT_PING_LUCA', 'LUCA_TOKEN_AGE', 'MIHSAP_TOKEN_AGE',
      'PENDING_QUEUE', 'FAILED_RATIO', 'LUCA_JOB_FAILURE', 'AGENT_VERSION',
    ];
    const r = await (this.prisma as any).systemHealthCheck
      .updateMany({
        where: { resolved: false, tenantId: null, type: { in: OFIS_BAZLI_TIPLER } },
        data: { resolved: true, resolvedAt: new Date() },
      })
      .catch(() => ({ count: 0 }));
    if (r?.count) {
      this.logger.log(`[SAGLIK-GECIS] ${r.count} ofissiz eski uyarı kapatıldı (ofis bazlı olarak yeniden üretilecek).`);
    }
  }

  /** Bulgu 33: kapatma da ofise bağlı — A ofisinin uyarısını B ofisinin kontrolü kapatmasın. */
  private async resolveCheck(type: string, tenantId?: string | null) {
    const where: any = { type, resolved: false };
    if (tenantId !== undefined) where.tenantId = tenantId ?? null;
    await (this.prisma as any).systemHealthCheck.updateMany({
      where,
      data: { resolved: true, resolvedAt: new Date() },
    });
  }

  private extractMetaValue(text: string | null | undefined, key: string): string | null {
    const match = String(text || '').match(new RegExp(`${key}=([^\\n;]+)`));
    return match?.[1]?.trim() || null;
  }

  private lastUsefulLogLine(text: string | null | undefined): string | null {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
      .filter((line) => line && !line.startsWith('[META]'));
    return lines.at(-1)?.slice(0, 220) || null;
  }

  private formatJobTip(tip: string | null | undefined): string {
    const labels: Record<string, string> = {
      KDV_MIZAN: 'KDV mizan',
      MIZAN: 'Mizan',
      EDEFTER_FIS_LISTESI: 'e-Defter detay fis listesi',
      ACCOUNT_PLAN: 'Hesap planı',
      KDV_191: '191 KDV kontrol',
      KDV_391: '391 KDV kontrol',
      ISLETME_GELIR: 'İşletme gelir',
      ISLETME_GIDER: 'İşletme gider',
      EARSIV_SATIS: 'E-Arşiv satış',
      EARSIV_ALIS: 'E-Arşiv alış',
      EFATURA_SATIS: 'E-Fatura satış',
      EFATURA_ALIS: 'E-Fatura alış',
      IHO_FETCH: 'İşletme hesap özeti',
    };
    return labels[String(tip || '').toUpperCase()] || String(tip || 'Luca job');
  }

  private isOldAgentVersion(version: string): boolean {
    const v = String(version || '').trim();
    if (!v || v === 'bilinmeyen') return false;

    const local = /^local-(\d+)\.(\d+)\.(\d+)/i.exec(v);
    if (local) {
      return this.compareVersionParts(
        [Number(local[1]), Number(local[2]), Number(local[3])],
        [1, 1, 2],
      ) < 0;
    }

    const browser = /^v?(\d+)\.(\d+)(?:\.(\d+))?/i.exec(v);
    if (browser) {
      return this.compareVersionParts(
        [Number(browser[1]), Number(browser[2]), Number(browser[3] || 0)],
        [1, 37, 0],
      ) < 0;
    }

    return false;
  }

  private compareVersionParts(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = Number.isFinite(a[i]) ? a[i] : 0;
      const bv = Number.isFinite(b[i]) ? b[i] : 0;
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }
}
