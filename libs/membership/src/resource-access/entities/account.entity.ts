import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AccountRole } from '@keru/core';

/**
 * Cuenta de usuario (UC-04). El rol global determina las capacidades base; el acceso a datos
 * concretos se decide por vínculo/asignación (PermissionEngine), no solo por este rol.
 */
@Entity({ name: 'account' })
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200, unique: true })
  @Index()
  email!: string;

  @Column({ type: 'varchar', length: 200 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: AccountRole;

  @Column({ type: 'varchar', length: 200 })
  displayName!: string;

  /** UC-23 · Foto de la cuenta (avatar del header). Opcional: sin ella el cliente cae al fallback inicial+color. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  photoUrl!: string | null;

  /**
   * UC-04 A5 · Verificación de email del self-signup. El auto-registro arranca en `false` y sube
   * a `true` al confirmar el link de verificación (token de un solo uso). Hasta entonces la cuenta
   * opera con banner y no puede emitir invitaciones (gate mínimo). Default DB false para el alta;
   * las cuentas previas al feature se backfillean a `true` en la migración.
   */
  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
