import { randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
 * KER-75 · Errores de S3 con causa conocida de integración/infra (permisos IAM, bucket inexistente,
 * región/endpoint equivocados). Los mapeamos a un 503 con mensaje genérico al cliente — el detalle
 * accionable vive SOLO en el log. El resto de fallos se loguea igual y se re-propaga (→ 500 genérico).
 * `NoSuchKey`/`NotFound` NO están acá: siguen siendo 404 (documento inexistente, no un fallo de infra).
 */
const EXPECTED_S3_ERROR_NAMES = ['AccessDenied', 'NoSuchBucket', 'PermanentRedirect'];

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
    // KER-70: la URL pública de las fotos se resuelve POR AMBIENTE vía S3_PUBLIC_URL, con el MISMO
    // host de CDN que el logo de email (EMAIL_LOGO_URL): cdn.dev.keru.ar en dev y cdn.keru.ar en
    // prod. En local/CI se deja el default (relativo /media o el endpoint de floci) para que las
    // subidas se recuperen del emulador sin depender del CDN. El default de abajo es solo el de
    // arranque sin config; los deploys setean S3_PUBLIC_URL explícito.
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
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
    } catch (err) {
      // KER-75 · Un fallo de PutObject caía como 500 opaco: lo logueamos antes de propagar.
      this.logS3Failure('putImage', err);
      throw err;
    }
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
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }),
      );
    } catch (err) {
      // KER-75 · Un fallo de PutObject caía como 500 opaco: lo logueamos antes de propagar.
      this.logS3Failure('putDocument', err);
      throw err;
    }
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
      // Nuestras propias señales de control (p. ej. el 404 "sin body" de arriba) no son fallos de
      // S3: se re-propagan tal cual, sin loguearse como un error de storage.
      if (err instanceof HttpException) throw err;
      const name = (err as { name?: string }).name ?? '';
      // Caso ya cubierto: el objeto no existe → 404 (documento inexistente), no un fallo de infra.
      if (['NoSuchKey', 'NotFound'].includes(name)) {
        throw new NotFoundException('Documento no encontrado');
      }
      // KER-75 · Observabilidad: cualquier otro fallo de S3 (AccessDenied, NoSuchBucket, endpoint/
      // credenciales) caía como un 500 opaco sin pista de la causa. Lo logueamos ANTES de propagar.
      this.logS3Failure('getPrivateDocument', err);
      // Errores esperables de integración: 503 con mensaje genérico al cliente; el detalle vive solo
      // en el log (seguridad UC-19 — nunca se leakea el error de storage ni la key al cliente).
      if (EXPECTED_S3_ERROR_NAMES.includes(name)) {
        throw new ServiceUnavailableException('El documento no está disponible en este momento');
      }
      throw err;
    }
  }

  /**
   * KER-75 · Vuelca a ERROR el shape del error del SDK v3 de AWS — `name` + `$metadata.requestId`
   * (el request-id de S3, correlacionable con CloudWatch) + el bucket — para diagnosticar fallos de
   * storage sin adivinar. NUNCA loguea la key completa, el binario ni PII (documento privado, UC-19).
   * Espejo de la observabilidad best-effort del email (KER-66): un fallo de integración jamás es
   * silencioso, pero su detalle no llega al cliente.
   */
  private logS3Failure(operation: string, err: unknown): void {
    const name = (err as { name?: string }).name ?? 'desconocido';
    const requestId =
      (err as { $metadata?: { requestId?: string } }).$metadata?.requestId ?? 'n/d';
    this.logger.error(
      `S3 ${operation} falló: name=${name} requestId=${requestId} bucket=${this.bucket}`,
    );
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
