import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * UC-04 A5 · Verificación de email del self-signup (KER-49). Agrega `account.emailVerified`
 * (default false para las altas nuevas; las cuentas previas al feature se backfillean a true —
 * no tiene sentido bloquearles el gate retroactivamente) y crea `email_verification_token`,
 * gemela de `password_reset_token`: token de un solo uso, corta vida, con status/expiresAt/usedAt.
 */
export class EmailVerification1784860000000 implements MigrationInterface {
  name = 'EmailVerification1784860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "account" ADD "emailVerified" boolean NOT NULL DEFAULT false`,
    );
    // Backfill: las cuentas que ya existían antes de la verificación se tratan como verificadas.
    await queryRunner.query(`UPDATE "account" SET "emailVerified" = true`);

    await queryRunner.query(
      `CREATE TABLE "email_verification_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" character varying(64) NOT NULL, "accountId" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_email_verification_token_token" UNIQUE ("token"), CONSTRAINT "PK_email_verification_token_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_verification_token_token" ON "email_verification_token" ("token") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_verification_token_accountId" ON "email_verification_token" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_verification_token_status" ON "email_verification_token" ("status") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_email_verification_token_status"`);
    await queryRunner.query(`DROP INDEX "IDX_email_verification_token_accountId"`);
    await queryRunner.query(`DROP INDEX "IDX_email_verification_token_token"`);
    await queryRunner.query(`DROP TABLE "email_verification_token"`);
    await queryRunner.query(`ALTER TABLE "account" DROP COLUMN "emailVerified"`);
  }
}
