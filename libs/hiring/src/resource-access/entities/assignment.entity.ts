import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AssignmentStatus = 'active' | 'historical';

/**
 * Asignación cuidador↔paciente (UC-05). Se crea al aceptar una solicitud (o manual/admin).
 * Se conserva como historial al finalizar (I7, UC-16) — nunca se borra.
 */
@Entity({ name: 'assignment' })
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  caregiverId!: string;

  @Column({ type: 'uuid' })
  @Index()
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  requestId!: string | null;

  @Column({ type: 'timestamptz' })
  periodStart!: Date;

  @Column({ type: 'timestamptz' })
  periodEnd!: Date;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  @Index()
  status!: AssignmentStatus;

  /** Cómo se originó la asignación (NFR-40): aceptación de solicitud o alta manual del admin. */
  @Column({ type: 'varchar', length: 16, default: 'acceptance' })
  provenance!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
