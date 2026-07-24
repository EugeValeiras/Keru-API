import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KER-77 (expande KER-52, UC-02/UC-19): cada tipo de certificación gana un ÍCONO SVG DISEÑADO propio.
 * Agrega la columna `iconKey` a `certification_catalog` (clave estable del set Lucide, brand book §5) y
 * la seedea para las filas ya sembradas por `CertificationCatalog1784880000000`. El `badgeIcon` (emoji)
 * se conserva como fallback textual. La fuente de estas filas es
 * `libs/membership/src/certification-catalog.ts` (mantener en sync). Idempotente: `ADD COLUMN IF NOT
 * EXISTS` + `UPDATE` por `key` (no pisa filas ausentes; el ensure de arranque cubre bases con `synchronize`).
 */
export class CertificationCatalogIconKey1784890000000 implements MigrationInterface {
  name = 'CertificationCatalogIconKey1784890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "certification_catalog" ADD COLUMN IF NOT EXISTS "iconKey" character varying(64) NOT NULL DEFAULT ''`,
    );

    // Seed del ícono por tipo (snapshot de certification-catalog.ts al momento de KER-77).
    const icons: Array<[string, string]> = [
      ['nursing-degree', 'stethoscope'],
      ['nursing-assistant', 'syringe'],
      ['cpr', 'heart-pulse'],
      ['first-aid', 'ambulance'],
      ['geriatric-care', 'accessibility'],
      ['palliative-care', 'bird'],
      ['dementia-care', 'brain'],
      ['physical-therapy', 'bone'],
      ['therapeutic-companion', 'heart-handshake'],
      ['pediatric-nursing', 'baby'],
      ['diabetes-nutrition', 'apple'],
    ];
    for (const [key, iconKey] of icons) {
      await queryRunner.query(`UPDATE "certification_catalog" SET "iconKey" = $1 WHERE "key" = $2`, [iconKey, key]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "certification_catalog" DROP COLUMN "iconKey"`);
  }
}
