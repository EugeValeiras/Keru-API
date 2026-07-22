import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * AuditUtility (constitution §3.1). Traza uniforme de autoría, configuración,
 * evaluación, entrega, ack y acciones de administrador. Componible en el paquete de
 * evidencia de auditoría.
 */
@Entity({ name: 'audit_log' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Acción auditada, p. ej. "membership.caregiver.approved". */
  @Column({ type: 'varchar', length: 160 })
  @Index()
  action!: string;

  /** Cuenta que ejecutó la acción (o "system"). */
  @Column({ type: 'varchar', length: 128 })
  @Index()
  actor!: string;

  /** Entidad afectada (tipo + id), p. ej. { type: "caregiver", id: "..." }. */
  @Column({ type: 'jsonb', nullable: true })
  target!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  createdAt!: Date;
}
