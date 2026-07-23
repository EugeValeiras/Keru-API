import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KER-33 (G6, Decouple row 35): entrega confiable del outbox. El dispatch reintenta con
 * backoff; acá se agrega la traza de esos intentos (`attempts`, `lastError`) y la marca de
 * dead-letter (`deadLetteredAt`, indexada para el panel admin ops). NULL = evento vivo.
 */
export class OutboxRetryDlq1784810000000 implements MigrationInterface {
    name = 'OutboxRetryDlq1784810000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "outbox_event" ADD "attempts" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "outbox_event" ADD "lastError" text`);
        await queryRunner.query(`ALTER TABLE "outbox_event" ADD "deadLetteredAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE INDEX "IDX_0d17d64296bcf8755efb3ee2dc" ON "outbox_event" ("deadLetteredAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0d17d64296bcf8755efb3ee2dc"`);
        await queryRunner.query(`ALTER TABLE "outbox_event" DROP COLUMN "deadLetteredAt"`);
        await queryRunner.query(`ALTER TABLE "outbox_event" DROP COLUMN "lastError"`);
        await queryRunner.query(`ALTER TABLE "outbox_event" DROP COLUMN "attempts"`);
    }

}
