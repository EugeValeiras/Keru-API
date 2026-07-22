import { PushSubscription } from './entities/push-subscription.entity';

/** Contenido de una notificación a empujar a los dispositivos (espejo de la campana). */
export interface PushPayload {
  type: string; // alert | note | quarantine
  patientId: string;
  title: string;
  body: string;
}

/**
 * NotificationTransport (puerto, residual-design: NotificationAccess → PushVendor). Entrega
 * notificaciones por un canal de dispositivo (Web Push en el MVP). Contrato clave (constitution
 * §2.7 / NFR-09): la entrega es best-effort y NUNCA lanza — la campana ya quedó persistida en la
 * transacción del registro; perder el canal push degrada a la campana, jamás al silencio.
 */
export abstract class NotificationTransport {
  /** Clave pública VAPID para que el cliente se suscriba; null si el canal está deshabilitado. */
  abstract getPublicKey(): string | null;

  /**
   * Empuja el payload a cada suscripción. Devuelve los endpoints muertos (404/410 del push
   * service) para que el llamador los depure. No lanza jamás.
   */
  abstract deliver(subscriptions: PushSubscription[], payload: PushPayload): Promise<string[]>;
}
