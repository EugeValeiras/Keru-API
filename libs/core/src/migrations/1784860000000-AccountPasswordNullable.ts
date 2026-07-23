import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KER-47 (UC-04 A5): `account.passwordHash` pasa a NULLABLE. Una cuenta creada al aceptar una
 * invitación sin estar registrada (UC-03 A1) nace sin contraseña propia — `passwordHash IS NULL`
 * es el estado "pendiente de definir contraseña" (MUST_SET_PASSWORD), y su primer acceso la fuerza
 * a definirla (POST /auth/set-password). Ninguna cuenta previa queda sin hash (todas las anteriores
 * se crearon con contraseña), así que aflojar el NOT NULL no requiere backfill.
 */
export class AccountPasswordNullable1784860000000 implements MigrationInterface {
  name = 'AccountPasswordNullable1784860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "account" ALTER COLUMN "passwordHash" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reponer el NOT NULL exige que no queden cuentas pendientes: se descartan las sin hash.
    await queryRunner.query(`DELETE FROM "account" WHERE "passwordHash" IS NULL`);
    await queryRunner.query(`ALTER TABLE "account" ALTER COLUMN "passwordHash" SET NOT NULL`);
  }
}
