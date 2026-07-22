import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DomainEventType } from './outbox.constants';

/**
 * Registro del patrón outbox: se inserta en la MISMA transacción que el cambio de
 * estado que lo origina (p. ej. registro clínico + obligación de alerta, Decouple row 35).
 * Un worker BullMQ lo despacha luego a los Managers suscriptores (dispatch encolado).
 */
@Entity({ name: 'outbox_event' })
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  type!: DomainEventType;

  /** Payload del evento (envelope único de plataforma). */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /** Identidad de operación que originó el evento (traza / idempotencia, NFR-34). */
  @Column({ type: 'varchar', length: 128, nullable: true })
  operationId!: string | null;

  @Column({ type: 'boolean', default: false })
  @Index()
  dispatched!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
