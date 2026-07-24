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
