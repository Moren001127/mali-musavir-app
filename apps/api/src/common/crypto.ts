/**
 * AES-256-GCM ile simetrik şifreleme.
 * Hassas verileri (Luca şifresi, Mihsap token vb.) DB'ye yazmadan
 * önce burada şifrelenir; okurken çözülür.
 *
 * ENCRYPTION_KEY env değişkeni 32 byte base64 değer olmalı.
 * Üretmek için:  `openssl rand -base64 32`
 *                (PowerShell) `[Convert]::ToBase64String((1..32|%{[byte](Get-Random -Max 256)}))`
 *
 * Format: base64(iv || authTag || ciphertext)
 *   - iv: 12 byte (GCM standart)
 *   - authTag: 16 byte
 *   - ciphertext: değişken
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('Crypto');

function getKey(): Buffer {
  const keyB64 = process.env.ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error(
      'ENCRYPTION_KEY env değişkeni tanımlı değil. 32 byte base64 bir anahtar oluşturun ve Railway\'e ekleyin.',
    );
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY 32 byte olmalı (32-byte base64). Şu an ${key.length} byte.`);
  }
  return key;
}

export function encrypt(plaintext: string): string {
  if (plaintext == null) throw new Error('encrypt: boş metin verilemez');
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

export function decrypt(payload: string): string {
  if (!payload) throw new Error('decrypt: boş payload');
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < 28) throw new Error('decrypt: payload çok kısa');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (e: any) {
    logger.error('AES-GCM çözme başarısız: ' + e.message);
    throw new Error('Şifrelenmiş veri çözülemedi — ENCRYPTION_KEY değişmiş olabilir');
  }
}

export function tryDecrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}
