import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStorageUtility } from './file-storage.util';

/**
 * KER-70 · CDN de fotos POR AMBIENTE. La URL pública que persisten los perfiles como `photoUrl`
 * se arma con `${S3_PUBLIC_URL}/${key}`: el host lo decide la env por ambiente (dev → cdn.dev.keru.ar,
 * prod → cdn.keru.ar), el MISMO host que el logo de email (EMAIL_LOGO_URL). En local/CI sin
 * S3_PUBLIC_URL, el default deriva del endpoint de floci (subidas emuladas), sin depender del CDN.
 *
 * Espejo del test del logo de email (email.util.spec.ts): ahí se verifica que el <img> sigue a
 * EMAIL_LOGO_URL; acá, que la URL de la foto sigue a S3_PUBLIC_URL.
 */

/** Mockea el ConfigService con un mapa de env; las no presentes caen al default que pasa el código. */
function configWith(env: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string, def?: unknown) => (key in env ? env[key] : def)),
  } as unknown as ConfigService;
}

/** Construye la utility y neutraliza el cliente S3 real (ensureBucket + putObject resuelven ok). */
function utilWith(env: Record<string, string | undefined>): FileStorageUtility {
  const util = new FileStorageUtility(configWith(env));
  (util as unknown as { client: { send: jest.Mock } }).client.send = jest.fn().mockResolvedValue({});
  return util;
}

describe('FileStorageUtility · host público por ambiente (KER-70)', () => {
  it('Dado S3_PUBLIC_URL de CDN (dev), cuando sube una imagen, entonces la URL usa ese host', async () => {
    const util = utilWith({ S3_PUBLIC_URL: 'https://cdn.dev.keru.ar/media' });
    const { url } = await util.putImage(Buffer.from('x'), 'image/png');
    expect(url).toMatch(/^https:\/\/cdn\.dev\.keru\.ar\/media\/images\/[0-9a-f-]+\.png$/);
  });

  it('Dado S3_PUBLIC_URL de CDN (prod), cuando sube una imagen, entonces la URL usa cdn.keru.ar', async () => {
    const util = utilWith({ S3_PUBLIC_URL: 'https://cdn.keru.ar/media' });
    const { url } = await util.putImage(Buffer.from('x'), 'image/jpeg');
    expect(url).toMatch(/^https:\/\/cdn\.keru\.ar\/media\/images\/[0-9a-f-]+\.jpg$/);
  });

  it('Dado solo AWS_ENDPOINT_URL (floci) sin S3_PUBLIC_URL, entonces la URL deriva del endpoint/bucket (local, sin CDN)', async () => {
    const util = utilWith({ AWS_ENDPOINT_URL: 'http://localhost:4566' });
    const { url } = await util.putImage(Buffer.from('x'), 'image/webp');
    expect(url).toMatch(/^http:\/\/localhost:4566\/keru-media\/images\/[0-9a-f-]+\.webp$/);
  });
});

/**
 * KER-75 · Observabilidad de fallos de S3 en getPrivateDocument (UC-19). Un fallo distinto de
 * "no encontrado" (AccessDenied, NoSuchBucket, endpoint/credenciales) caía como un 500 opaco sin
 * pista de la causa. Ahora se LOGUEA el shape del SDK v3 (name + $metadata.requestId + bucket) y los
 * casos esperables se mapean a 503 genérico — el detalle vive solo en el log, nunca llega al cliente.
 */

/** Forja un error con el shape del AWS SDK v3 (name + $metadata.requestId), como el que lanza S3Client. */
function s3Error(name: string, requestId = 'REQ-XYZ'): Error {
  const err = new Error(`${name}: detalle interno de S3`);
  err.name = name;
  (err as unknown as { $metadata: { requestId: string } }).$metadata = { requestId };
  return err;
}

/** Util cuyo `client.send` rechaza con `err` (simula el fallo de S3). Devuelve el spy del logger.error. */
function utilRejectingWith(err: unknown, env: Record<string, string | undefined> = {}) {
  const util = utilWith(env);
  (util as unknown as { client: { send: jest.Mock } }).client.send = jest.fn().mockRejectedValue(err);
  const logError = jest
    .spyOn((util as unknown as { logger: Logger }).logger, 'error')
    .mockImplementation(() => undefined);
  return { util, logError };
}

const VALID_KEY = 'private/documents/3d36477d-cafe-4000-9000-000000000000.pdf';

describe('FileStorageUtility · observabilidad de getPrivateDocument (KER-75)', () => {
  it('Dado AccessDenied de S3, cuando descarga, entonces loguea name+requestId+bucket y lanza 503 (no 500 opaco)', async () => {
    const { util, logError } = utilRejectingWith(s3Error('AccessDenied', 'REQ-ACCESS'));
    await expect(util.getPrivateDocument(VALID_KEY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(logError).toHaveBeenCalledTimes(1);
    const logged = logError.mock.calls[0][0] as string;
    expect(logged).toContain('name=AccessDenied');
    expect(logged).toContain('requestId=REQ-ACCESS');
    expect(logged).toContain('bucket=keru-media');
  });

  it('Dado NoSuchBucket de S3, cuando descarga, entonces loguea el detalle y lanza 503', async () => {
    const { util, logError } = utilRejectingWith(s3Error('NoSuchBucket', 'REQ-BUCKET'));
    await expect(util.getPrivateDocument(VALID_KEY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(logError.mock.calls[0][0]).toContain('name=NoSuchBucket');
  });

  it('El cliente NUNCA recibe el detalle del error de S3 ni la key (UC-19): el mensaje del 503 es genérico', async () => {
    const { util } = utilRejectingWith(s3Error('AccessDenied', 'REQ-LEAK'));
    const thrown = (await util.getPrivateDocument(VALID_KEY).catch((e) => e)) as Error;
    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect(thrown.message).toBe('El documento no está disponible en este momento');
    // Ni el name, ni el requestId, ni el bucket, ni la key se filtran hacia el cliente.
    expect(thrown.message).not.toContain('AccessDenied');
    expect(thrown.message).not.toContain('REQ-LEAK');
    expect(thrown.message).not.toContain('keru-media');
    expect(thrown.message).not.toContain(VALID_KEY);
  });

  it('Caso preservado: NoSuchKey sigue dando 404 (documento inexistente) sin loguearse como fallo de infra', async () => {
    const { util, logError } = utilRejectingWith(s3Error('NoSuchKey'));
    await expect(util.getPrivateDocument(VALID_KEY)).rejects.toBeInstanceOf(NotFoundException);
    expect(logError).not.toHaveBeenCalled();
  });

  it('Caso preservado: key fuera del prefijo privado (path-traversal) → 400 sin tocar S3', async () => {
    const util = utilWith({});
    const send = jest.fn();
    (util as unknown as { client: { send: jest.Mock } }).client.send = send;
    await expect(util.getPrivateDocument('images/../etc/passwd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('Un fallo de S3 desconocido se loguea y se re-propaga tal cual (el filtro global lo vuelve 500 genérico)', async () => {
    const err = s3Error('TimeoutError', 'REQ-TIMEOUT');
    const { util, logError } = utilRejectingWith(err);
    await expect(util.getPrivateDocument(VALID_KEY)).rejects.toBe(err);
    expect(logError.mock.calls[0][0]).toContain('name=TimeoutError');
  });

  it('putDocument: un fallo de PutObject deja de ser opaco — se loguea name+requestId antes de propagar', async () => {
    const err = s3Error('AccessDenied', 'REQ-PUT');
    // Con endpoint (floci): ensureBucket (primer send) ok; el PutObject del documento (segundo send) falla.
    const util = utilWith({ AWS_ENDPOINT_URL: 'http://localhost:4566' });
    (util as unknown as { client: { send: jest.Mock } }).client.send = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(err);
    const logError = jest
      .spyOn((util as unknown as { logger: Logger }).logger, 'error')
      .mockImplementation(() => undefined);
    await expect(util.putDocument(Buffer.from('pdf'), 'application/pdf')).rejects.toBe(err);
    expect(logError.mock.calls[0][0]).toContain('name=AccessDenied');
    expect(logError.mock.calls[0][0]).toContain('requestId=REQ-PUT');
  });
});

/**
 * KER-76 · `ensureBucket()` NO debe depender de `s3:CreateBucket` en AWS real (least-privilege). El
 * bucket lo provisiona Terraform; el task role no tiene por qué poder crearlo. Regla: solo se envía
 * `CreateBucketCommand` en modo emulador (AWS_ENDPOINT_URL seteado → floci/localstack). Sin endpoint
 * (AWS real), `ensureBucket()` es no-op y las subidas van directo al bucket pre-provisto.
 */
describe('FileStorageUtility · ensureBucket least-privilege (KER-76)', () => {
  /** Espía `client.send` (todos los comandos resuelven ok) y devuelve la util + el spy. */
  function utilSpyingSend(env: Record<string, string | undefined>) {
    const util = new FileStorageUtility(configWith(env));
    const send = jest.fn().mockResolvedValue({});
    (util as unknown as { client: { send: jest.Mock } }).client.send = send;
    return { util, send };
  }

  /** Nombre del comando del SDK v3 con el que se llamó a `send` (p. ej. 'CreateBucketCommand'). */
  const commandNames = (send: jest.Mock): string[] =>
    send.mock.calls.map((c) => (c[0] as object).constructor.name);

  it('Sin AWS_ENDPOINT_URL (AWS real): putImage NO emite CreateBucketCommand (0 llamadas)', async () => {
    const { util, send } = utilSpyingSend({});
    await util.putImage(Buffer.from('x'), 'image/png');
    expect(commandNames(send)).not.toContain('CreateBucketCommand');
    // Solo el PutObject de la imagen sale al bucket pre-provisto.
    expect(commandNames(send)).toEqual(['PutObjectCommand']);
  });

  it('Sin AWS_ENDPOINT_URL: putDocument tampoco crea bucket — sube directo al bucket pre-provisto', async () => {
    const { util, send } = utilSpyingSend({});
    await util.putDocument(Buffer.from('pdf'), 'application/pdf');
    expect(commandNames(send)).toEqual(['PutObjectCommand']);
  });

  it('Con AWS_ENDPOINT_URL (floci): putImage SÍ asegura el bucket con CreateBucketCommand primero', async () => {
    const { util, send } = utilSpyingSend({ AWS_ENDPOINT_URL: 'http://localhost:4566' });
    await util.putImage(Buffer.from('x'), 'image/png');
    expect(commandNames(send)).toEqual(['CreateBucketCommand', 'PutObjectCommand']);
  });

  it('Con AWS_ENDPOINT_URL: el bucket se asegura una sola vez (se cachea entre subidas)', async () => {
    const { util, send } = utilSpyingSend({ AWS_ENDPOINT_URL: 'http://localhost:4566' });
    await util.putImage(Buffer.from('x'), 'image/png');
    await util.putImage(Buffer.from('y'), 'image/jpeg');
    // Un solo CreateBucket para las dos subidas.
    expect(commandNames(send).filter((n) => n === 'CreateBucketCommand')).toHaveLength(1);
  });

  it('Modo emulador: un CreateBucket que falla con BucketAlreadyOwnedByYou no rompe la subida', async () => {
    const { util } = utilSpyingSend({ AWS_ENDPOINT_URL: 'http://localhost:4566' });
    (util as unknown as { client: { send: jest.Mock } }).client.send = jest
      .fn()
      .mockRejectedValueOnce(s3Error('BucketAlreadyOwnedByYou'))
      .mockResolvedValue({});
    const { url } = await util.putImage(Buffer.from('x'), 'image/png');
    expect(url).toMatch(/\/images\/[0-9a-f-]+\.png$/);
  });
});
