import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KER-85 (Perf/DB): índices individuales para dos columnas de filtro frecuente que no los tenían.
 *
 * 1. `hiring_request.caregiverId` — `listRequestsForCaregiver` (y el ripple de desactivación)
 *    filtra `where caregiverId order createdAt` SIN status; el compound
 *    ['caregiverId','status'] no cubre ese patrón. No lo vuelve redundante: el compound sigue
 *    sirviendo a las queries que sí filtran por status.
 * 2. `alert.recordId` — `resolveByCorrection` filtra `where recordId = :recordId` en cada
 *    corrección clínica (UC-20/NFR-38) → sin índice, full scan sobre 100k+ alertas.
 *
 * Nombres explícitos e idénticos a los `@Index('IDX_...')` de las entities, para que synchronize
 * (jest-e2e) y esta migración (prod) produzcan el mismo índice. Reversible (down = DROP INDEX).
 */
export class PerfIndicesCaregiverIdRecordId1784900000000 implements MigrationInterface {
  name = 'PerfIndicesCaregiverIdRecordId1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_hiring_request_caregiverId" ON "hiring_request" ("caregiverId") `);
    await queryRunner.query(`CREATE INDEX "IDX_alert_recordId" ON "alert" ("recordId") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_alert_recordId"`);
    await queryRunner.query(`DROP INDEX "IDX_hiring_request_caregiverId"`);
  }
}
