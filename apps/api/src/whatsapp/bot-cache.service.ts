import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Bot cevap cache — aynı mükelleften aynı/benzer soru 24 saat içinde
 * tekrar gelirse AI'ya gitmeden son cevabı döner.
 *
 * In-memory Map; tek instance'da çalışır. Multi-replica deployment'ta
 * Redis'e taşınabilir, şu an tek Railway replica olduğu için yeterli.
 *
 * Cache key: tenantId + taxpayerId + normalize(soru) hash
 * TTL: 24 saat (yapılandırılabilir)
 */
@Injectable()
export class WhatsAppBotCacheService {
  private readonly logger = new Logger(WhatsAppBotCacheService.name);
  private readonly cache = new Map<string, { reply: string; expiresAt: number; hits: number }>();
  private readonly TTL_MS = Number(process.env.WHATSAPP_BOT_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
  private readonly MAX_ENTRIES = Number(process.env.WHATSAPP_BOT_CACHE_MAX || 5000);

  /**
   * Cache anahtarı üret (tenantId + taxpayerId + normalize edilmiş soru)
   */
  private buildKey(tenantId: string, taxpayerId: string, question: string): string {
    const normalized = this.normalize(question);
    const hash = createHash('sha256').update(`${tenantId}::${taxpayerId}::${normalized}`).digest('hex').slice(0, 16);
    return hash;
  }

  /**
   * Eğer cache'de varsa cevap döner, yoksa null.
   * Süresi dolmuşsa otomatik temizler.
   */
  get(tenantId: string, taxpayerId: string, question: string): string | null {
    if (!question || question.length < 3) return null;
    const key = this.buildKey(tenantId, taxpayerId, question);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    entry.hits++;
    this.logger.log(`[BotCache] HIT key=${key} hits=${entry.hits} taxpayer=${taxpayerId.slice(0, 8)}`);
    return entry.reply;
  }

  /**
   * Cevabı cache'e koy. Sadece "kontrol edip dönüş" gibi anlamsız cevapları cache'leme.
   */
  set(tenantId: string, taxpayerId: string, question: string, reply: string): void {
    if (!question || !reply || reply.length < 5) return;
    if (this.shouldNotCache(reply)) return;

    // Cache boyut limiti — en eski %20'yi temizle
    if (this.cache.size >= this.MAX_ENTRIES) {
      const toDelete = Math.floor(this.MAX_ENTRIES * 0.2);
      const keys = Array.from(this.cache.keys()).slice(0, toDelete);
      keys.forEach((k) => this.cache.delete(k));
      this.logger.log(`[BotCache] eviction: removed ${toDelete} old entries`);
    }

    const key = this.buildKey(tenantId, taxpayerId, question);
    this.cache.set(key, { reply, expiresAt: Date.now() + this.TTL_MS, hits: 0 });
  }

  /**
   * Cache'e konulmamalı cevaplar:
   * - "kontrol edip dönüş" gibi generic cevaplar (kullanıcı tekrar sorarsa yeni context'le dönmeli)
   * - Hata cevapları
   */
  private shouldNotCache(reply: string): boolean {
    const t = reply.toLocaleLowerCase('tr-TR');
    if (/kontrol edip d[öo]n[üu][şs]/i.test(t)) return true;
    if (/teknik bir sorun|hata|geri d[öo]n/i.test(t) && reply.length < 100) return true;
    return false;
  }

  private normalize(raw: string): string {
    return String(raw || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  /** Stats (debug için) */
  stats(): { size: number; totalHits: number } {
    let totalHits = 0;
    this.cache.forEach((v) => { totalHits += v.hits; });
    return { size: this.cache.size, totalHits };
  }
}
