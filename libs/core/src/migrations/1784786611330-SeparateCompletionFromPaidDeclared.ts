import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KER-31 (Decouple row 49, NFR-10/12/56/58): separa servicio-completado de pagado-declarado.
 * El cierre registra una razón terminal estructurada (`terminalReason`) y el honor-mark de
 * pago pasa a ser una declaración opcional post-cierre (`paidDeclaredAt`). Los cierres
 * existentes (`finished`, que soldaba cierre y pago) migran a `completed` + razón `completed`.
 */
export class SeparateCompletionFromPaidDeclared1784786611330 implements MigrationInterface {
    name = 'SeparateCompletionFromPaidDeclared1784786611330'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hiring_request" ADD "terminalReason" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "hiring_request" ADD "paidDeclaredAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(
            `UPDATE "hiring_request" SET "status" = 'completed', "terminalReason" = 'completed' WHERE "status" = 'finished'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "hiring_request" SET "status" = 'finished' WHERE "status" = 'completed'`,
        );
        await queryRunner.query(`ALTER TABLE "hiring_request" DROP COLUMN "paidDeclaredAt"`);
        await queryRunner.query(`ALTER TABLE "hiring_request" DROP COLUMN "terminalReason"`);
    }

}
