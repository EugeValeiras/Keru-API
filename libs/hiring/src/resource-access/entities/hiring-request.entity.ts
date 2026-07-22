import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Ciclo de vida de la contratación (UC-09). `expired` = pendiente que venció (barrido, NFR-14).
 * `cancelled` = el solicitante la canceló mientras estaba pendiente (UC-09 A2; estado terminal).
 */
export type HiringRequestStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'in-progress'
  | 'finished'
  | 'expired';

/**
 * Solicitud de contratación / booking (UC-09). Pertenece a UN paciente (I4). Fija los términos
 * contra los que se hizo (rate snapshot, NFR-03/23). Idempotente por operationId (NFR-34).
 */
@Entity({ name: 'hiring_request' })
/** Agenda del cuidador (list + decline masivo por estado): equality en ambas columnas. */
@Index(['caregiverId', 'status'])
export class HiringRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  patientId!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  requesterAccountId!: string;

  @Column({ type: 'uuid' })
  caregiverId!: string;

  @Column({ type: 'varchar', length: 16 })
  modality!: string; // home | hospital

  @Column({ type: 'timestamptz' })
  startDate!: Date;

  @Column({ type: 'timestamptz' })
  endDate!: Date;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  specialRequirements!: string | null;

  @Column({ type: 'jsonb' })
  contactData!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  @Index()
  status!: HiringRequestStatus;

  /** Términos pinneados al momento de solicitar (NFR-03/23). */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  ratePerHourSnapshot!: string;

  @Column({ type: 'varchar', length: 8 })
  currencySnapshot!: string;

  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  createdByOperationId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
