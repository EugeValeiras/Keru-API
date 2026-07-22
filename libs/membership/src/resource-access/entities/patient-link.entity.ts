import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { LinkRole } from '@keru/core';

/**
 * Vínculo cuenta↔paciente con su rol (constitution §2.4, NFR-13). El permiso se decide
 * sobre el par (cuenta, rol-en-vínculo), no sobre la cuenta. Único artefacto que otorga
 * acceso de lectura/escritura clínica a un familiar.
 */
@Entity({ name: 'patient_link' })
@Unique(['patientId', 'accountId'])
export class PatientLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  patientId!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  accountId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: LinkRole;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
