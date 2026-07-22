import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * FileStorageUtility (constitution §3.1, utility transversal). Guarda imágenes
 * de perfil (UC-01 paciente, UC-02 cuidador) en S3 — floci en dev — y devuelve
 * la URL pública que los perfiles persisten como photoUrl.
 */
@Injectable()
export class FileStorageUtility {
  private readonly logger = new Logger(FileStorageUtility.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private bucketEnsured = false;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('AWS_ENDPOINT_URL');
    this.bucket = this.config.get<string>('S3_BUCKET', 'keru-media');
    this.publicBaseUrl = this.config.get<string>(
      'S3_PUBLIC_URL',
      endpoint ? `${endpoint}/${this.bucket}` : `https://${this.bucket}.s3.amazonaws.com`,
    );
    this.client = new S3Client({
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle: true,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
    });
  }

  /** Sube una imagen y devuelve su URL pública. Lanza 400 si el tipo no es imagen soportada. */
  async putImage(buffer: Buffer, mimeType: string): Promise<{ url: string; key: string }> {
    const ext = ALLOWED_MIME[mimeType];
    if (!ext) {
      throw new BadRequestException('Formato de imagen no soportado (jpeg, png o webp)');
    }
    await this.ensureBucket();
    const key = `images/${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    const url = `${this.publicBaseUrl}/${key}`;
    this.logger.log(`Imagen subida: ${url}`);
    return { url, key };
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) {
      return;
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(name)) {
        throw err;
      }
    }
    this.bucketEnsured = true;
  }
}
