import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceAccess } from '@keru/core';
import { CertificationCatalog } from './entities/certification-catalog.entity';

/**
 * KER-52 · CertificationCatalogAccess (constitution §3.1). Verbos de solo-lectura sobre el catálogo
 * finito de tipos de certificación (reference data seedeada por migración). Único punto de acceso a
 * la tabla `certification_catalog` (§3.4). Dueño: Membership.
 */
@ResourceAccess()
@Injectable()
export class CertificationCatalogAccess {
  constructor(
    @InjectRepository(CertificationCatalog)
    private readonly catalog: Repository<CertificationCatalog>,
  ) {}

  /** Lista el catálogo completo, en orden de presentación (para la webapp, UC-02). */
  list(): Promise<CertificationCatalog[]> {
    return this.catalog.find({ order: { sortOrder: 'ASC', label: 'ASC' } });
  }

  /**
   * Upsert idempotente de una entrada del catálogo (por PK `key`). En una base migrada el seed ya
   * existe y esto es un no-op de datos; en bases dev/e2e con `synchronize` (sin migraciones) es quien
   * materializa el catálogo al arranque (mismo criterio que el ensure de `range_version`).
   */
  async upsert(item: { key: string; label: string; badgeIcon: string; sortOrder: number }): Promise<void> {
    await this.catalog.save(this.catalog.create(item));
  }
}
