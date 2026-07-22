import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { LinkRole } from '@keru/core';

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

/**
 * Invitación de vínculo familiar (UC-03). Única, atada a un paciente concreto, con invitado
 * nombrado (desafío de identidad, NFR-19). Validez 30 min y un solo uso (OQ-2), evaluada al
 * confirmar. Emisión y confirmación auditadas.
 */
@Entity({ name: 'family_invitation' })
export class FamilyInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  @Index()
  token!: string;

  @Column({ type: 'uuid' })
  @Index()
  patientId!: string;

  @Column({ type: 'varchar', length: 128 })
  invitedByAccountId!: string;

  /** Invitado nombrado: la confirmación desafía esta identidad (NFR-19). */
  @Column({ type: 'varchar', length: 200 })
  invitedEmail!: string;

  /** Rol de vínculo que se otorgará al confirmar. */
  @Column({ type: 'varchar', length: 32 })
  roleToGrant!: LinkRole;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  @Index()
  status!: InvitationStatus;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 128, nullable: true })
  confirmedByAccountId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
