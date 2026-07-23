import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type DeliveryChannel = 'bell' | 'push';
export type DeliveryStatus = 'delivered' | 'failed';

/**
 * Outcome de entrega por (notificación, canal) — KER-34 (NFR-26): la notificación ya es por
 * (alerta, destinatario), así que cada fila es el outcome por destinatario y canal. La campana
 * queda `delivered` al persistirse (misma transacción — la campana es la garantía, §2.7); el
 * push registra el resultado REAL del envío: "aceptado por el proveedor" nunca se trata como
 * entregado sin resultado. Entregada ≠ vista: el acuse vive en `notification.readAt` (NFR-11).
 * Un reintento (p. ej. la escalación re-pushea) upserta la fila: el outcome refleja el último intento.
 */
@Entity({ name: 'notification_delivery' })
@Unique('UQ_notification_delivery_channel', ['notificationId', 'channel'])
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index('IDX_notification_delivery_notification')
  notificationId!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: DeliveryChannel;

  @Column({ type: 'varchar', length: 16 })
  status!: DeliveryStatus;

  /** Detalle del outcome (p. ej. "3/3 endpoints fallaron", "escalación"). */
  @Column({ type: 'varchar', length: 300, nullable: true })
  detail!: string | null;

  @Column({ type: 'timestamptz' })
  recordedAt!: Date;
}
