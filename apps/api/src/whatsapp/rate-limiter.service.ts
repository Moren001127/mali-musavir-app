import { Injectable } from '@nestjs/common';

type Bucket = {
  hits: number[];
  lastNoticeAt?: number;
};

@Injectable()
export class WhatsAppRateLimiterService {
  private readonly buckets = new Map<string, Bucket>();

  registerIncoming(tenantId: string, taxpayerId: string): { limited: boolean; shouldNotify: boolean } {
    const now = Date.now();
    const windowMs = Number(process.env.WHATSAPP_RATE_LIMIT_WINDOW_MS || 30_000);
    const maxHits = Number(process.env.WHATSAPP_RATE_LIMIT_PER_30S || 5);
    const key = `${tenantId}:${taxpayerId}`;
    const bucket = this.buckets.get(key) || { hits: [] };
    bucket.hits = bucket.hits.filter((ts) => now - ts <= windowMs);
    bucket.hits.push(now);

    const limited = bucket.hits.length > maxHits;
    const shouldNotify = limited && (!bucket.lastNoticeAt || now - bucket.lastNoticeAt > windowMs);
    if (shouldNotify) bucket.lastNoticeAt = now;
    this.buckets.set(key, bucket);
    return { limited, shouldNotify };
  }
}
