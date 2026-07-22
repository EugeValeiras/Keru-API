import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ClinicalRecordType = 'vitals' | 'medication' | 'note';

/**
 * Registro clínico (UC-12/13/20). Fechado por tiempo de MEDICIÓN (distinto del de llegada, NFR-36)
 * y trazado a su autor con rol (I2). Nunca se edita en silencio. Idempotente por operationId (NFR-34).
 * Reside en la partición clínica; se commitea junto con su obligación de alerta (Decouple row 35).
 */
@Entity({ name: 'clinical_record' })
export class ClinicalRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  patientId!: string;

  @Column({ type: 'varchar', length: 16 })
  type!: ClinicalRecordType;

  @Column({ type: 'varchar', length: 128 })
  authorAccountId!: string;

  @Column({ type: 'varchar', length: 32 })
  authorRole!: string;

  /** Tiempo de medición (NFR-36): el historial ordena por acá. */
  @Column({ type: 'timestamptz' })
  @Index()
  measuredAt!: Date;

  /** Contenido: vitals -> { values: [{metricKey,value,unit}] }; medication -> {...}; note -> { text }. */
  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  createdByOperationId!: string | null;

  /** Tiempo de llegada/registro. */
  @CreateDateColumn({ type: 'timestamptz' })
  recordedAt!: Date;
}
