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
    // Eşik 5'ten 10'a çıkarıldı (2026-06-15): 30 sn'de 5 mesaj çok düşüktü; ardı
    // ardına birkaç kısa soru soran normal mükellef bu sınıra takılıp gerçek
    // soruları cevapsız kalıyordu ("yoğunluk nedeniyle sıraya aldık" + sessiz yutma).
    // 10/30sn yalnız gerçek sel/döngüyü durdurur, normal sohbeti engellemez.
    const maxHits = Number(process.env.WHATSAPP_RATE_LIMIT_PER_30S || 10);
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
