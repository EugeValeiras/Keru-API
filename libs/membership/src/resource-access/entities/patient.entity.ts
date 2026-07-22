import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship?: string;
}

/**
 * Perfil de paciente (UC-01). La identidad del paciente es distinta del perfil (Decouple row 14);
 * en el MVP el perfil ES la unidad, con detección de duplicados a nivel aplicación.
 */
@Entity({ name: 'patient' })
export class Patient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  fullName!: string;

  @Column({ type: 'date' })
  birthDate!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  photoUrl!: string | null;

  @Column({ type: 'varchar', length: 300 })
  mainCondition!: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  bloodGroup!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  allergies!: string[];

  @Column({ type: 'jsonb' })
  emergencyContact!: EmergencyContact;

  /** NFR-34: identidad de operación que creó el perfil (dedup idempotente). */
  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  @Index()
  createdByOperationId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
