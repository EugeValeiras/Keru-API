import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ClinicalRecordType } from './clinical-record.entity';

export type QuarantineStatus = 'pending' | 'approved' | 'discarded';

/**
 * Intento de registro clínico tardío no autorizado (UC-12 A3, NFR-30): la autoridad se evalúa al
 * tiempo de medición y las llegadas tardías no autorizadas se ponen en cuarentena — nunca se
 * descartan en silencio. El círculo resuelve: aprobar lo promueve a ClinicalRecord con su
 * measuredAt original (NFR-36); descartar solo lo marca — nunca se borra (trazabilidad).
 */
@Entity({ name: 'quarantined_record' })
export class QuarantinedRecord {
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

  /** Tiempo de medición original (NFR-36): si se aprueba, el historial ordena por acá. */
  @Column({ type: 'timestamptz' })
  measuredAt!: Date;

  /** Mismo contenido que ClinicalRecord.data, según type. */
  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  /** Por qué quedó en cuarentena. */
  @Column({ type: 'varchar', length: 64, default: 'no-authority-at-measurement' })
  reason!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  @Index()
  status!: QuarantineStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  resolvedByAccountId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  /** Si se aprobó: id del ClinicalRecord promovido al historial. */
  @Column({ type: 'uuid', nullable: true })
  approvedRecordId!: string | null;

  /** NFR-38: si el intento era una CORRECCIÓN, el registro que corrige — aprobar aplica la corrección. */
  @Column({ type: 'uuid', nullable: true })
  supersedesRecordId!: string | null;

  /** NFR-38: razón de la corrección del intento en cuarentena. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  correctionReason!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  createdByOperationId!: string | null;

  /** Tiempo de llegada (distinto del de medición, NFR-36). */
  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt!: Date;
}
