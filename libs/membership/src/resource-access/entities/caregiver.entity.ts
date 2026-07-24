import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type CaregiverStatus = 'pending' | 'approved' | 'rejected' | 'deactivated';

export type CertificationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Certificación del cuidador (UC-02 / UC-19). KER-52: el tipo ya no es texto libre — referencia el
 * catálogo finito (`catalogKey`, ver `certification-catalog.ts`) y lleva un **documento privado**
 * adjunto (`documentKey`: key del store no público, NUNCA URL pública) que solo el admin descarga.
 * Cada certificación nace `pending` y oculta al público; el admin la aprueba/rechaza una por una.
 */
export interface Certification {
  /** Id estable dentro del perfil (UUID): identifica la cert para aprobar/rechazar/descargar. */
  id: string;
  /** Clave del catálogo finito (reemplaza el `type` libre). */
  catalogKey: string;
  institution: string;
  year: number;
  /** Key del documento adjunto en el store PRIVADO (no público, sin URL). */
  documentKey: string;
  /** Content-type del documento adjunto (para el header de descarga admin). */
  documentContentType: string;
  /** Estado de revisión por-cert (UC-19). Nace `pending`; oculta al público hasta `approved`. */
  status: CertificationStatus;
  /** Compat/derivado (UC-02/07): `verified === (status === 'approved')`. */
  verified: boolean;
  /** operationId del alta de la cert (idempotencia, NFR-34). Interno, no se expone al público. */
  operationId?: string;
  reviewedBy: string | null;
  /** ISO string (jsonb no persiste Date). */
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface AvailabilitySlot {
  dayOfWeek: number; // 0..6
  from: string; // 'HH:mm'
  to: string; // 'HH:mm'
}

export interface Rates {
  ratePerHour: number;
  currency: string;
  description?: string;
}

/** Insignias de verificación (UC-19). Los tres niveles son independientes. */
export interface VerificationBadges {
  certifications: boolean;
  identity: boolean;
  background: boolean;
}

/**
 * Perfil profesional del cuidador (UC-02). Nace en estado `pending`; no es visible en el
 * marketplace ni recibe solicitudes hasta que el admin lo aprueba (UC-19). Dueño de escritura:
 * Membership (constitution §3.3); Hiring lo lee para el marketplace.
 */
@Entity({ name: 'caregiver' })
export class Caregiver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cuenta (rol caregiver) dueña del perfil. Un perfil por cuenta. Fuente de la identidad. */
  @Column({ type: 'varchar', length: 128, unique: true })
  @Index()
  accountId!: string;

  /**
   * Identidad (nombre + avatar) DERIVADA de la `Account` — NO son columnas (ADR-0003).
   * `CaregiverAccess` las resuelve por `accountId` (join intra-Membership) tras cada lectura,
   * para que el marketplace/ficha muestren la misma identidad que el header. Fuente única:
   * `Account`; único punto de escritura: `PATCH /accounts/me` (UC-23).
   */
  displayName!: string;
  photoUrl!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  specialties!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  certifications!: Certification[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  availability!: AvailabilitySlot[];

  @Column({ type: 'jsonb' })
  rates!: Rates;

  @Column({ type: 'varchar', length: 120 })
  zone!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  modalities!: string[];

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  @Index()
  status!: CaregiverStatus;

  @Column({ type: 'varchar', length: 400, nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'jsonb', default: () => `'{"certifications":false,"identity":false,"background":false}'` })
  badges!: VerificationBadges;

  @Column({ type: 'varchar', length: 128, nullable: true })
  reviewedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  createdByOperationId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
