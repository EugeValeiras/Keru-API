import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Favorito (UC-08). Marcar/desmarcar es idempotente. Persistente por cuenta y dispositivo. */
@Entity({ name: 'favorite' })
@Unique(['accountId', 'caregiverId'])
export class Favorite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  @Index()
  accountId!: string;

  @Column({ type: 'uuid' })
  caregiverId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
