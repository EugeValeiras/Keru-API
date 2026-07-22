import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Rates } from './caregiver.entity';

/**
 * Versión efectivo-fechada de la tarifa del cuidador (UC-02 A3, NFR-03/23). Append-only: cada
 * cambio agrega una versión con su fecha de vigencia; ninguna versión pasada se reescribe. La
 * tarifa vigente vive además en `Caregiver.rates` (la que lee el marketplace); las solicitudes
 * existentes conservan su snapshot pinneado (`HiringRequest`). Dueño de escritura: Membership.
 */
@Entity({ name: 'caregiver_rate_version' })
export class CaregiverRateVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  caregiverId!: string;

  @Column({ type: 'jsonb' })
  rates!: Rates;

  /** Desde cuándo rige esta versión. */
  @Column({ type: 'timestamptz' })
  effectiveFrom!: Date;

  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  createdByOperationId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
