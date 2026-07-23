import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KER-36 (NFR-38, I2): corrección de registros clínicos con traza y re-evaluación.
 * - `clinical_record`: la corrección es un registro NUEVO (supersedesRecordId + correctionReason);
 *   el original queda intacto y marcado superseded (supersededAt + supersededByRecordId).
 * - `quarantined_record`: una corrección tardía no autorizada también va a cuarentena (NFR-30);
 *   aprobar el item aplica la corrección.
 * - `alert`: resuelta-por-corrección (resolvedAt + resolvedByRecordId) — sale del circuito de
 *   escalación; la alerta ya referencia la versión del registro que la disparó (recordId).
 */
export class RecordCorrection1784830000000 implements MigrationInterface {
    name = 'RecordCorrection1784830000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "clinical_record" ADD "supersedesRecordId" uuid`);
        await queryRunner.query(`ALTER TABLE "clinical_record" ADD "correctionReason" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "clinical_record" ADD "supersededAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "clinical_record" ADD "supersededByRecordId" uuid`);
        await queryRunner.query(`ALTER TABLE "quarantined_record" ADD "supersedesRecordId" uuid`);
        await queryRunner.query(`ALTER TABLE "quarantined_record" ADD "correctionReason" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "alert" ADD "resolvedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "alert" ADD "resolvedByRecordId" uuid`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alert" DROP COLUMN "resolvedByRecordId"`);
        await queryRunner.query(`ALTER TABLE "alert" DROP COLUMN "resolvedAt"`);
        await queryRunner.query(`ALTER TABLE "quarantined_record" DROP COLUMN "correctionReason"`);
        await queryRunner.query(`ALTER TABLE "quarantined_record" DROP COLUMN "supersedesRecordId"`);
        await queryRunner.query(`ALTER TABLE "clinical_record" DROP COLUMN "supersededByRecordId"`);
        await queryRunner.query(`ALTER TABLE "clinical_record" DROP COLUMN "supersededAt"`);
        await queryRunner.query(`ALTER TABLE "clinical_record" DROP COLUMN "correctionReason"`);
        await queryRunner.query(`ALTER TABLE "clinical_record" DROP COLUMN "supersedesRecordId"`);
    }

}
