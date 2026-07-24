import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * KER-52 · Catálogo finito de tipos de certificación (UC-02). Reference data seedeada por migración
 * (`CertificationCatalog`, patrón `range_version`). Dueño de escritura: Membership (constitution
 * §3.3); solo se escribe por migración/seed. La fuente de las filas es `certification-catalog.ts`.
 */
@Entity({ name: 'certification_catalog' })
export class CertificationCatalog {
  /** Clave estable del catálogo, referenciada por `Certification.catalogKey`. */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  /** Nombre visible de la certificación. */
  @Column({ type: 'varchar', length: 120 })
  label!: string;

  /**
   * KER-77 · Clave estable del ícono SVG diseñado (nombre del set Lucide, brand book §5). La webapp la
   * mapea a un SVG bundleado localmente; NO es una URL externa. Fuente: `certification-catalog.ts`.
   */
  @Column({ type: 'varchar', length: 64, default: '' })
  iconKey!: string;

  /** Ícono de la insignia asociada (emoji). KER-77: fallback textual (ver `certification-catalog.ts`). */
  @Column({ type: 'varchar', length: 16 })
  badgeIcon!: string;

  /** Orden de presentación (opcional). */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}
