/**
 * TOTP (RFC 6238) — authenticator app (Google Authenticator, Authy vb.) ile
 * iki adımlı doğrulama. Harici bağımlılık YOK; sadece Node 'crypto'.
 *
 * - Secret: base32 (RFC 4648, padding yok), DB'de crypto.ts ile şifreli saklanır.
 * - Kod: 6 hane, 30 sn periyot, SHA-1 (authenticator app standardı).
 */
import { createHmac, randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

/** Yeni base32 secret üret (authenticator'a girilecek/QR'a kodlanacak). */
export function generateBase32Secret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Verilen base32 secret + token (6 hane) doğru mu? ±window periyot tolere edilir (saat kayması). */
export function verifyTotp(secretBase32: string, token: string, window = 1): boolean {
  const t = String(token || '').trim();
  if (!/^\d{6}$/.test(t)) return false;
  const key = base32Decode(secretBase32);
  if (key.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (hotp(key, counter + i) === t) return true;
  }
  return false;
}

/** authenticator app'in okuyacağı otpauth:// URI (QR ya da manuel için). */
export function buildOtpauthUri(secretBase32: string, accountLabel: string, issuer = 'Moren Portal'): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Secret'ı manuel girişte okunaklı olsun diye 4'erli gruplar. */
export function formatSecretForDisplay(secretBase32: string): string {
  return (secretBase32.match(/.{1,4}/g) || [secretBase32]).join(' ');
}
