import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PasswordResetStatus = 'pending' | 'used';

/**
 * Token de recuperación de contraseña (UC-04 A4). Mismo patrón que FamilyInvitation/NFR-19:
 * alto entropía, un solo uso y corta vida (30 min por defecto), evaluado al confirmar. La
 * emisión (siempre 200, anti-enumeración) y el uso quedan auditados. Referencia a la cuenta
 * por UUID plano (constitution §3.5: sin FKs cross-store; acá mismo dominio, se mantiene el
 * estilo de invitación).
 */
@Entity({ name: 'password_reset_token' })
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  @Index()
  token!: string;

  @Column({ type: 'uuid' })
  @Index()
  accountId!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  @Index()
  status!: PasswordResetStatus;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
