import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Notificación del centro de notificaciones / campana (UC-18). SIEMPRE se persiste, aunque el push
 * esté deshabilitado — la campana es la garantía (I6). Estado leída/no leída por destinatario.
 */
@Entity({ name: 'notification' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
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
  @Index()
  read!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
