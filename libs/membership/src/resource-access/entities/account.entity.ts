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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
