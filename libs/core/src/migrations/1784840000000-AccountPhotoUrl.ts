import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KER-41 (UC-23): la cuenta tiene su propia foto de perfil (avatar del header + página "Mi perfil").
 * Columna opcional, mismo tipo que la foto del cuidador/paciente (varchar 500 nullable);
 * sin ella el cliente cae al fallback inicial+color.
 */
export class AccountPhotoUrl1784840000000 implements MigrationInterface {
    name = 'AccountPhotoUrl1784840000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "account" ADD "photoUrl" character varying(500)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "account" DROP COLUMN "photoUrl"`);
    }

}
