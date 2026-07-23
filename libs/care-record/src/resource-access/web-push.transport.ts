import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { ResourceAccess } from '@keru/core';
import { NotificationTransport, PushDeliveryReport, PushPayload } from './notification-transport';
import { PushSubscription } from './entities/push-subscription.entity';

/**
 * WebPushTransport (constitution §3.1, Resource externo: el push service del navegador).
 * Web Push con VAPID (RFC 8292). Sin claves configuradas el canal queda deshabilitado y la
 * campana sigue sola (constitution §2.7). Errores por suscripción se tragan y loguean:
 * 404/410 = suscripción muerta (se reporta para depurar), el resto es transitorio.
 */
@ResourceAccess()
@Injectable()
export class WebPushTransport extends NotificationTransport {
  private readonly logger = new Logger(WebPushTransport.name);
  private readonly publicKey: string | null;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    super();
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY', '');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY', '');
    const subject = config.get<string>('VAPID_SUBJECT', 'mailto:no-reply@keru.app');
    this.enabled = publicKey.length > 0 && privateKey.length > 0;
    this.publicKey = this.enabled ? publicKey : null;
    if (this.enabled) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } else {
      this.logger.warn('Web Push deshabilitado: faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (la campana sigue sola)');
    }
  }

  getPublicKey(): string | null {
    return this.publicKey;
  }

  async deliver(subscriptions: PushSubscription[], payload: PushPayload): Promise<PushDeliveryReport> {
    if (!this.enabled || subscriptions.length === 0) {
      return { attempted: false, delivered: [], failed: [], stale: [] };
    }

    const body = JSON.stringify(payload);
    const delivered: string[] = [];
    const failed: string[] = [];
    const stale: string[] = [];
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            { timeout: 3000 },
          );
          delivered.push(sub.endpoint);
        } catch (err) {
          failed.push(sub.endpoint);
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            stale.push(sub.endpoint);
            return;
          }
          this.logger.warn(
            `Push fallido a ${sub.endpoint.slice(0, 60)}… (${statusCode ?? (err as Error).message}); la campana ya registró la alerta`,
          );
        }
      }),
    );
    return { attempted: true, delivered, failed, stale };
  }
}
