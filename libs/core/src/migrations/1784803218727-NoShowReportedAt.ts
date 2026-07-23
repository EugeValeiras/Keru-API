import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KER-32 (NFR-15, UC-09 A4): el solicitante registra el no-show del cuidador con su timestamp.
 * El cierre por no-show usa la razón terminal `no-show` (columna ya existente de KER-31);
 * acá solo se agrega el momento reportado del no-show.
 */
export class NoShowReportedAt1784803218727 implements MigrationInterface {
    name = 'NoShowReportedAt1784803218727'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hiring_request" ADD "noShowReportedAt" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hiring_request" DROP COLUMN "noShowReportedAt"`);
    }

}
