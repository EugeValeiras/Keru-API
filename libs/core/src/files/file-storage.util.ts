import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * KER-52 · Tipos aceptados para el documento PRIVADO de una certificación (UC-02): PDF + imágenes.
 * Distinto del bucket/URL público de las fotos: estos objetos van a un prefijo privado y NUNCA se
 * exponen por URL — solo se descargan por el endpoint autorizado del admin (UC-19).
 */
const ALLOWED_DOCUMENT_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Prefijo (no público) donde viven los documentos privados de certificaciones. */
const PRIVATE_DOCUMENT_PREFIX = 'private/documents/';

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

  /**
   * KER-52 · Sube un documento PRIVADO de certificación (PDF o imagen) al prefijo no público y
   * devuelve su `key` opaca — NUNCA una URL pública. Lanza 400 si el tipo no está permitido.
   * La descarga solo se hace por `getPrivateDocument` desde el endpoint autorizado del admin (UC-19).
   */
  async putDocument(buffer: Buffer, mimeType: string): Promise<{ key: string; contentType: string }> {
    const ext = ALLOWED_DOCUMENT_MIME[mimeType];
    if (!ext) {
      throw new BadRequestException('Formato de documento no soportado (PDF, jpeg, png o webp)');
    }
    await this.ensureBucket();
    const key = `${PRIVATE_DOCUMENT_PREFIX}${randomUUID()}.${ext}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }),
    );
    this.logger.log(`Documento privado subido: ${key}`);
    return { key, contentType: mimeType };
  }

  /**
   * KER-52 · Descarga el binario de un documento privado por su `key` (solo el endpoint admin de
   * UC-19 debe invocarlo). Rechaza keys fuera del prefijo privado (defensa anti path-traversal).
   */
  async getPrivateDocument(key: string): Promise<{ body: Buffer; contentType: string }> {
    if (!key.startsWith(PRIVATE_DOCUMENT_PREFIX) || key.includes('..')) {
      throw new BadRequestException('Key de documento inválida');
    }
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = res.Body as unknown as AsyncIterable<Uint8Array> | undefined;
      if (!body) throw new NotFoundException('Documento no encontrado');
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) chunks.push(chunk);
      return {
        body: Buffer.concat(chunks.map((c) => Buffer.from(c))),
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      if (['NoSuchKey', 'NotFound'].includes(name)) {
        throw new NotFoundException('Documento no encontrado');
      }
      throw err;
    }
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
