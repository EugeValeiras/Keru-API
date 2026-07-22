import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AlertSeverity = 'critical' | 'info';

/**
 * Alerta (UC-18). Referencia el registro que la disparó (NFR-38) y la versión de rango aplicada
 * (NFR-28: "por qué disparó / no disparó" siempre tiene respuesta).
 */
@Entity({ name: 'alert' })
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  patientId!: string;

  @Column({ type: 'uuid' })
  recordId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  metricKey!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  value!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  unit!: string | null;

  @Column({ type: 'varchar', length: 16 })
  severity!: AlertSeverity;

  @Column({ type: 'varchar', length: 64 })
  rangeVersion!: string;

  @Column({ type: 'varchar', length: 300 })
  message!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
