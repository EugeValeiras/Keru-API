import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Alcance de una versión de rango. Solo 'system-default' en el MVP: el override por paciente
 * queda bloqueado por la decisión abierta UC-18/NFR-18 (quién lo configura) y el endpoint de
 * configuración por NFR-29 (un cambio de rango es configuración crítica de seguridad: exige
 * plausibilidad sobre la propia config, segunda confirmación, rollout escalonado y auditoría).
 */
export type RangeScope = 'system-default';

/**
 * Versión de rango clínico (NFR-17/28). Append-only efectivo-fechada: cada cambio agrega una
 * versión con su vigencia; ninguna se reescribe ni se borra (sin UPDATE jamás), así "por qué
 * disparó / no disparó a esa hora" siempre tiene respuesta (la alerta persiste el id aplicado).
 * Estrato etario opcional [ageMinYears, ageMaxYears) en años cumplidos al measuredAt (NFR-17;
 * stressor #29 pediátrico). Dueño de escritura: CareRecord (constitution §3.3).
 */
@Entity({ name: 'range_version' })
export class RangeVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  metricKey!: string;

  @Column({ type: 'varchar', length: 32, default: 'system-default' })
  scope!: RangeScope;

  /** Borne inferior del estrato etario (inclusive, años cumplidos); null = sin borne. */
  @Column({ type: 'int', nullable: true })
  ageMinYears!: number | null;

  /** Borne superior del estrato etario (exclusivo, años cumplidos); null = sin borne. */
  @Column({ type: 'int', nullable: true })
  ageMaxYears!: number | null;

  @Column({ type: 'double precision' })
  min!: number;

  @Column({ type: 'double precision' })
  max!: number;

  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  /** Desde cuándo rige: la evaluación resuelve con asOf = measuredAt (replay determinista, NFR-36). */
  @Column({ type: 'timestamptz' })
  effectiveFrom!: Date;

  /** Autor con su rol (NFR-28); null = seed del sistema. */
  @Column({ type: 'uuid', nullable: true })
  authorAccountId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  authorRole!: string | null;

  @Column({ type: 'varchar', length: 128, unique: true })
  createdByOperationId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
