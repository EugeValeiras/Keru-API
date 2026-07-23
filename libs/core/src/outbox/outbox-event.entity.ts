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

  /** Intentos de dispatch consumidos (KER-33: retry con backoff). */
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  /** Mensaje del último fallo de dispatch (traza para el panel admin ops). */
  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  /**
   * Dead-letter (KER-33, G6): agotó los reintentos. NULL = vivo. Un evento dead-lettered
   * queda visible (admin/ops/outbox/dead-letter) y reencolable — nunca se descarta en silencio.
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  deadLetteredAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
