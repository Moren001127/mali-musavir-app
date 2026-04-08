import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT');
    const region = config.get<string>('S3_REGION', 'tr-east-1');

    this.s3 = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY', 'minioadmin'),
        secretAccessKey: config.get<string>('S3_SECRET_KEY', 'minioadmin'),
      },
      forcePathStyle: true, // MinIO için gerekli
    });

    this.bucket = config.get<string>('S3_BUCKET', 'mali-musavir-docs');
  }

  /**
   * Upload için presigned PUT URL üretir (max 15 dakika geçerli)
   */
  async getPresignedUploadUrl(
    tenantId: string,
    taxpayerId: string,
    originalName: string,
    mimeType: string,
  ): Promise<{ uploadUrl: string; s3Key: string }> {
    const ext = originalName.split('.').pop() || 'bin';
    const s3Key = `${tenantId}/${taxpayerId}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: mimeType,
      ServerSideEncryption: 'AES256',
      Metadata: {
        'original-name': encodeURIComponent(originalName),
        'tenant-id': tenantId,
        'taxpayer-id': taxpayerId,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    return { uploadUrl, s3Key };
  }

  /**
   * İndirme için presigned GET URL üretir (max 1 saat geçerli)
   */
  async getPresignedDownloadUrl(s3Key: string, filename: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    });

    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }

  /**
   * Nesne boyutunu ve varlığını kontrol eder
   */
  async getObjectMeta(s3Key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const cmd = new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key });
      const res = await this.s3.send(cmd);
      return { sizeBytes: res.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  /**
   * S3'ten nesne siler
   */
  async deleteObject(s3Key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }));
    this.logger.log(`Deleted S3 object: ${s3Key}`);
  }

  getBucket(): string {
    return this.bucket;
  }

  /**
   * Buffer'ı doğrudan S3/MinIO'ya yükler (server-side upload)
   */
  async putBuffer(
    s3Key: string,
    buffer: Buffer,
    mimeType: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: mimeType,
        Metadata: metadata,
      }),
    );
    this.logger.log(`Uploaded buffer to S3: ${s3Key} (${buffer.length} bytes)`);
  }
}
