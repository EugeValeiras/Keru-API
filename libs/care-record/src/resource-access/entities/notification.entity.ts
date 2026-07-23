import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Notificación del centro de notificaciones / campana (UC-18). SIEMPRE se persiste, aunque el push
 * esté deshabilitado — la campana es la garantía (I6). Estado leída/no leída por destinatario.
 */
/**
 * Índice por patrón de acceso de la campana: unreadCount usa el prefijo (recipient, read);
 * la lista usa el prefijo (recipient) y ordena — pocas filas por destinatario.
 *
 * KER-34 (NFR-27): unique parcial (alertId, recipientAccountId) — el fan-out de una alerta es
 * idempotente por constraint: una misma alerta jamás duplica la campana de un destinatario
 * (un retry del outbox o una escalación no crean campana nueva). Parcial: las notificaciones
 * sin alerta (note/hiring/quarantine) sí pueden repetirse por destinatario.
 */
@Entity({ name: 'notification' })
@Index(['recipientAccountId', 'read', 'createdAt'])
@Index('UQ_notification_alert_recipient', ['alertId', 'recipientAccountId'], {
  unique: true,
  where: '"alertId" IS NOT NULL',
})
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  recipientAccountId!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  alertId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  type!: string; // alert | note

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 500 })
  body!: string;

  @Column({ type: 'boolean', default: false })
  read!: boolean;

  /** Acuse (NFR-11): momento del PRIMER read — entregada ≠ vista; re-leer no lo mueve. */
  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
