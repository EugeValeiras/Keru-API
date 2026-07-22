import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Notificación del centro de notificaciones / campana (UC-18). SIEMPRE se persiste, aunque el push
 * esté deshabilitado — la campana es la garantía (I6). Estado leída/no leída por destinatario.
 */
/**
 * Índice por patrón de acceso de la campana: unreadCount usa el prefijo (recipient, read);
 * la lista usa el prefijo (recipient) y ordena — pocas filas por destinatario.
 */
@Entity({ name: 'notification' })
@Index(['recipientAccountId', 'read', 'createdAt'])
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
