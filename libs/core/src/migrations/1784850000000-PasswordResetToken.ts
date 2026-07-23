import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KER-46 (UC-04 A4): tabla de tokens de recuperación de contraseña. Mismo patrón que
 * family_invitation (NFR-19): token único de alta entropía, un solo uso (status pending→used)
 * y corta vida (expiresAt). Referencia a la cuenta por UUID plano. Índices en token (lookup),
 * accountId y status.
 */
export class PasswordResetToken1784850000000 implements MigrationInterface {
  name = 'PasswordResetToken1784850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "password_reset_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" character varying(64) NOT NULL, "accountId" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_password_reset_token_token" UNIQUE ("token"), CONSTRAINT "PK_password_reset_token_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_token_token" ON "password_reset_token" ("token") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_token_accountId" ON "password_reset_token" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_token_status" ON "password_reset_token" ("status") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_password_reset_token_status"`);
    await queryRunner.query(`DROP INDEX "IDX_password_reset_token_accountId"`);
    await queryRunner.query(`DROP INDEX "IDX_password_reset_token_token"`);
    await queryRunner.query(`DROP TABLE "password_reset_token"`);
  }
}
