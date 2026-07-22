import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Suscripción Web Push de un navegador (UC-18). Pertenece a una cuenta (varias por cuenta:
 * un navegador = una suscripción) y es revocable. El endpoint es único: re-suscribir el mismo
 * navegador es un upsert, nunca un duplicado. El push es adicional a la campana (constitution §2.7).
 */
@Entity({ name: 'push_subscription' })
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  accountId!: string;

  /** URL del push service del navegador (FCM, Mozilla autopush, etc.). */
  @Column({ type: 'varchar', length: 1024, unique: true })
  endpoint!: string;

  /** Clave pública ECDH del navegador (cifrado del payload, RFC 8291). */
  @Column({ type: 'varchar', length: 256 })
  p256dh!: string;

  /** Secreto de autenticación del navegador (RFC 8291). */
  @Column({ type: 'varchar', length: 256 })
  auth!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
