import { PushSubscription } from './entities/push-subscription.entity';

/** Contenido de una notificación a empujar a los dispositivos (espejo de la campana). */
export interface PushPayload {
  type: string; // alert | note | quarantine | hiring
  patientId: string;
  title: string;
  body: string;
}

/**
 * Resultado REAL del envío por endpoint (KER-34, NFR-26): "aceptado por el proveedor" nunca se
 * trata como entregado sin resultado. `stale` ⊂ `failed`: suscripciones muertas (404/410) a depurar.
 */
export interface PushDeliveryReport {
  /** false si el canal está deshabilitado o no había suscripciones: no hubo intento. */
  attempted: boolean;
  delivered: string[]; // endpoints que aceptaron el envío
  failed: string[]; // endpoints que fallaron (incluye stale)
  stale: string[]; // endpoints muertos (404/410) para depurar
}

/**
 * NotificationTransport (puerto, residual-design: NotificationAccess → PushVendor). Entrega
 * notificaciones por un canal de dispositivo (Web Push en el MVP). Contrato clave (constitution
 * §2.7 / NFR-09): la entrega es best-effort y NUNCA lanza — la campana ya quedó persistida en la
 * transacción del registro; perder el canal push degrada a la campana, jamás al silencio.
 * Devuelve el outcome por endpoint para persistirlo por destinatario y canal (NFR-26).
 */
export abstract class NotificationTransport {
  /** Clave pública VAPID para que el cliente se suscriba; null si el canal está deshabilitado. */
  abstract getPublicKey(): string | null;

  /**
   * Empuja el payload a cada suscripción. Devuelve el resultado real por endpoint (NFR-26),
   * incluidos los muertos (404/410) para que el llamador los depure. No lanza jamás.
   */
  abstract deliver(subscriptions: PushSubscription[], payload: PushPayload): Promise<PushDeliveryReport>;
}
