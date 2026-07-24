import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KER-52 (UC-02/UC-19): catálogo finito de tipos de certificación del cuidador. Tabla
 * `certification_catalog` seedeada con el catálogo vigente (patrón `range_version`): cada entrada es
 * un tipo elegible con su insignia (ícono). La fuente de estas filas es
 * `libs/membership/src/certification-catalog.ts` (mantener en sync). El seed es idempotente
 * (`ON CONFLICT ("key") DO NOTHING`).
 */
export class CertificationCatalog1784880000000 implements MigrationInterface {
  name = 'CertificationCatalog1784880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "certification_catalog" ("key" character varying(64) NOT NULL, "label" character varying(120) NOT NULL, "badgeIcon" character varying(16) NOT NULL, "sortOrder" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_certification_catalog_key" PRIMARY KEY ("key"))`,
    );

    // Seed del catálogo (snapshot de certification-catalog.ts al momento de KER-52).
    const seed: Array<[string, string, string]> = [
      ['nursing-degree', 'Título de Enfermería', '🩺'],
      ['nursing-assistant', 'Auxiliar de Enfermería', '💉'],
      ['cpr', 'RCP', '❤️'],
      ['first-aid', 'Primeros Auxilios', '🚑'],
      ['geriatric-care', 'Cuidado Geriátrico', '🧓'],
      ['palliative-care', 'Cuidados Paliativos', '🕊️'],
      ['dementia-care', 'Cuidado de Demencia / Alzheimer', '🧠'],
      ['physical-therapy', 'Kinesiología', '🦵'],
      ['therapeutic-companion', 'Acompañante Terapéutico', '🤝'],
      ['pediatric-nursing', 'Enfermería Pediátrica', '🧸'],
      ['diabetes-nutrition', 'Diabetes y Nutrición', '🍎'],
    ];
    for (let i = 0; i < seed.length; i++) {
      const [key, label, badgeIcon] = seed[i];
      await queryRunner.query(
        `INSERT INTO "certification_catalog" ("key", "label", "badgeIcon", "sortOrder")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("key") DO NOTHING`,
        [key, label, badgeIcon, i],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "certification_catalog"`);
  }
}
