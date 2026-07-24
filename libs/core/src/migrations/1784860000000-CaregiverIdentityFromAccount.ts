import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KER-54 (ADR-0003): la identidad (nombre/avatar) del cuidador pasa a derivarse de su `Account`
 * (fuente única). Se dropean `caregiver.displayName` y `caregiver.photoUrl`.
 *
 * Backfill SIN pérdida antes de dropear: si la cuenta no tiene foto pero el perfil sí, la foto del
 * perfil se copia a la cuenta (COALESCE). El nombre lo aporta la cuenta (siempre presente, identidad
 * de login del signup); el `displayName` del perfil era un duplicado y se descarta.
 */
export class CaregiverIdentityFromAccount1784860000000 implements MigrationInterface {
  name = 'CaregiverIdentityFromAccount1784860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Backfill no-destructivo: no perder ninguna foto seteada (gana la de la cuenta si existe).
    await queryRunner.query(`
      UPDATE "account" a
      SET "photoUrl" = c."photoUrl"
      FROM "caregiver" c
      WHERE c."accountId" = a.id
        AND a."photoUrl" IS NULL
        AND c."photoUrl" IS NOT NULL
    `);

    // 2) Drop de las columnas duplicadas: la identidad vive ahora en la cuenta.
    await queryRunner.query(`ALTER TABLE "caregiver" DROP COLUMN "photoUrl"`);
    await queryRunner.query(`ALTER TABLE "caregiver" DROP COLUMN "displayName"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-crea las columnas y re-backfillea desde la cuenta para no dejar la vista rota.
    await queryRunner.query(`ALTER TABLE "caregiver" ADD "displayName" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "caregiver" ADD "photoUrl" character varying(500)`);
    await queryRunner.query(`
      UPDATE "caregiver" c
      SET "displayName" = a."displayName", "photoUrl" = a."photoUrl"
      FROM "account" a
      WHERE a.id = c."accountId"
    `);
    // displayName vuelve a ser NOT NULL (era obligatorio); las filas ya quedaron backfilleadas.
    await queryRunner.query(`ALTER TABLE "caregiver" ALTER COLUMN "displayName" SET NOT NULL`);
  }
}
