import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AlertSeverity = 'critical' | 'info';

/**
 * Alerta (UC-18). Referencia el registro que la disparó (NFR-38) y la versión de rango aplicada
 * (NFR-28: "por qué disparó / no disparó" siempre tiene respuesta).
 *
 * KER-34 (NFR-11/26/27, anti-T7): una crítica sin acuse escala una sola vez (`escalatedAt`,
 * reclamada por el barrido); una alerta más nueva del mismo (paciente, métrica) la supersede
 * (`supersededAt` + `supersededByAlertId`) y la saca del circuito de escalación/reenvío — un
 * backlog nunca se convierte en tormenta de alertas obsoletas.
 */
/** Índice del barrido de escalación: filtra por severidad y antigüedad (claim pattern). */
@Entity({ name: 'alert' })
@Index('IDX_alert_severity_createdAt', ['severity', 'createdAt'])
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

  /** Escalación (NFR-11): momento en que se re-notificó al círculo por falta de acuse. NULL = no escaló. */
  @Column({ type: 'timestamptz', nullable: true })
  escalatedAt!: Date | null;

  /** Supersede (anti-T7): momento en que una alerta más nueva del mismo (paciente, métrica) la reemplazó. */
  @Column({ type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;

  /** Traza del supersede: qué alerta la reemplazó. */
  @Column({ type: 'uuid', nullable: true })
  supersededByAlertId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
