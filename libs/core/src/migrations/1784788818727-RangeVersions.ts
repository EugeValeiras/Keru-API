import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KER-30 (NFR-17/28): rangos clínicos versionados en DB. Tabla `range_version` append-only
 * efectivo-fechada (estrato etario opcional, at-most-once por createdByOperationId) + seed de los
 * defaults del sistema replicando el catálogo de métricas vigente (NFR-16). Vigencia desde epoch:
 * cualquier measuredAt histórico resuelve versión. El seed es idempotente (ON CONFLICT DO NOTHING)
 * y coincide con el ensure de arranque del CareRecordManager (mismos operationIds).
 */
export class RangeVersions1784788818727 implements MigrationInterface {
  name = 'RangeVersions1784788818727';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "range_version" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "metricKey" character varying(64) NOT NULL, "scope" character varying(32) NOT NULL DEFAULT 'system-default', "ageMinYears" integer, "ageMaxYears" integer, "min" double precision NOT NULL, "max" double precision NOT NULL, "unit" character varying(16) NOT NULL, "effectiveFrom" TIMESTAMP WITH TIME ZONE NOT NULL, "authorAccountId" uuid, "authorRole" character varying(32), "createdByOperationId" character varying(128) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ea6cdeece9665cce7e277c62b93" UNIQUE ("createdByOperationId"), CONSTRAINT "PK_35650ea9a35d739da6976aa3113" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_88091a3b88663a4ef499a272ae" ON "range_version" ("metricKey") `);

    // Seed system-default (snapshot congelado del catálogo al momento de KER-30; sin estrato:
    // aplica a toda edad hasta que una decisión clínica agregue estratos como versiones nuevas).
    const seed: Array<[string, number, number, string]> = [
      ['blood-pressure-systolic', 90, 140, 'mmHg'],
      ['blood-pressure-diastolic', 60, 90, 'mmHg'],
      ['heart-rate', 60, 100, 'bpm'],
      ['temperature', 36, 37.5, '°C'],
      ['oxygen-saturation', 92, 100, '%'],
      ['glucose', 70, 140, 'mg/dL'],
    ];
    for (const [metricKey, min, max, unit] of seed) {
      await queryRunner.query(
        `INSERT INTO "range_version" ("metricKey", "scope", "min", "max", "unit", "effectiveFrom", "createdByOperationId")
         VALUES ($1, 'system-default', $2, $3, $4, '1970-01-01T00:00:00Z', $5)
         ON CONFLICT ("createdByOperationId") DO NOTHING`,
        [metricKey, min, max, unit, `seed-system-default-${metricKey}`],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_88091a3b88663a4ef499a272ae"`);
    await queryRunner.query(`DROP TABLE "range_version"`);
  }
}
