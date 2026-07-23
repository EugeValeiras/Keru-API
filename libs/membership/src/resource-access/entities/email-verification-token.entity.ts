import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type EmailVerificationStatus = 'pending' | 'used';

/**
 * Token de verificación de email del self-signup (UC-04 A5). Mismo patrón que
 * PasswordResetToken/FamilyInvitation/NFR-19: alto entropía, un solo uso y corta vida
 * (30 min por defecto), evaluado al confirmar. La emisión (siempre neutra, anti-enumeración
 * en el reenvío) y el uso quedan auditados. Al reenviar, los pendientes anteriores de la
 * cuenta se invalidan (solo el último link sirve). Referencia a la cuenta por UUID plano
 * (constitution §3.5: sin FKs cross-store; acá mismo dominio, se mantiene el estilo).
 */
@Entity({ name: 'email_verification_token' })
export class EmailVerificationToken {
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
  status!: EmailVerificationStatus;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
