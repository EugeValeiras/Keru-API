import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { WebPushTransport } from './web-push.transport';
import { PushSubscription } from './entities/push-subscription.entity';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

/**
 * UC-18 · WebPushTransport: canal best-effort detrás del puerto NotificationTransport.
 * Sin claves VAPID queda deshabilitado; los errores del push service jamás se propagan
 * (constitution §2.7: perder el push degrada a la campana, nunca al silencio).
 */

const sub = (over: Partial<PushSubscription> = {}): PushSubscription =>
  ({
    id: 'sub-1',
    accountId: 'acc-1',
    endpoint: 'https://push.test/sub-1',
    p256dh: 'p256dh-key',
    auth: 'auth-secret',
    createdAt: new Date(),
    ...over,
  }) as PushSubscription;

const config = (env: Record<string, string>) =>
  ({ get: (key: string, def = '') => env[key] ?? def }) as unknown as ConfigService;

const payload = { type: 'alert', patientId: 'pat-1', title: 'Alerta clínica', body: 'fuera de rango' };

describe('WebPushTransport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sin claves VAPID queda deshabilitado: publicKey null y deliver no envía nada', async () => {
    const transport = new WebPushTransport(config({}));
    expect(transport.getPublicKey()).toBeNull();
    expect(await transport.deliver([sub()], payload)).toEqual([]);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('con claves configura VAPID y envía el payload JSON a cada suscripción', async () => {
    const transport = new WebPushTransport(config({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }));
    (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });

    const stale = await transport.deliver([sub(), sub({ endpoint: 'https://push.test/sub-2' })], payload);

    expect(transport.getPublicKey()).toBe('pub');
    expect(webpush.setVapidDetails).toHaveBeenCalledWith('mailto:no-reply@keru.app', 'pub', 'priv');
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.test/sub-1', keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } },
      JSON.stringify(payload),
      { timeout: 3000 },
    );
    expect(stale).toEqual([]);
  });

  it('un 410 Gone marca la suscripción como muerta para depurar; no lanza', async () => {
    const transport = new WebPushTransport(config({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }));
    (webpush.sendNotification as jest.Mock).mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    const stale = await transport.deliver([sub()], payload);

    expect(stale).toEqual(['https://push.test/sub-1']);
  });

  it('un error transitorio del push service se traga (la campana ya registró la alerta)', async () => {
    const transport = new WebPushTransport(config({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }));
    (webpush.sendNotification as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(transport.deliver([sub()], payload)).resolves.toEqual([]);
  });
});
