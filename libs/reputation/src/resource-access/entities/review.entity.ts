import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type ReviewSubject = 'caregiver' | 'patient';

/**
 * Reseña bidireccional (UC-17/21). Una por servicio y por autor (I5, inmutable). Sellada hasta que
 * ambas partes envían o cierra la ventana (reveal simultáneo, NFR-21). Solo con servicio finalizado.
 */
@Entity({ name: 'review' })
@Unique(['requestId', 'authorAccountId'])
/** Reseñas reveladas de un sujeto (listRevealedForSubject / averagesForSubjects). */
@Index(['subjectType', 'subjectId', 'revealed'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Consultas por requestId cubiertas por el prefijo del @Unique de arriba. */
  @Column({ type: 'uuid' })
  requestId!: string;

  @Column({ type: 'varchar', length: 128 })
  authorAccountId!: string;

  @Column({ type: 'varchar', length: 16 })
  subjectType!: ReviewSubject;

  @Column({ type: 'uuid' })
  subjectId!: string;

  @Column({ type: 'int' })
  rating!: number; // 1..5

  @Column({ type: 'varchar', length: 1000, nullable: true })
  comment!: string | null;

  /** Sellada hasta el reveal simultáneo (NFR-21). */
  @Column({ type: 'boolean', default: false })
  @Index()
  revealed!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
