import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KER-34 (NFR-11/26/27, anti-T7): outcome de entrega por destinatario y canal + escalación de
 * críticas no acusadas + supersede.
 * - `alert`: marca de escalación (una sola vez) y traza de supersede; índice del barrido.
 * - `notification.readAt`: acuse — momento del PRIMER read (entregada ≠ vista).
 * - `notification_delivery`: outcome por (notificación, canal); la notificación ya es por
 *   (alerta, destinatario). Unique (notificationId, channel): un reintento upserta.
 * - unique parcial (alertId, recipientAccountId) en `notification`: fan-out idempotente por
 *   constraint (solo alertas; note/hiring/quarantine pueden repetirse).
 */
export class AlertDeliveryOutcome1784820000000 implements MigrationInterface {
    name = 'AlertDeliveryOutcome1784820000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alert" ADD "escalatedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "alert" ADD "supersededAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "alert" ADD "supersededByAlertId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_alert_severity_createdAt" ON "alert" ("severity", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "notification" ADD "readAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_notification_alert_recipient" ON "notification" ("alertId", "recipientAccountId") WHERE "alertId" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "notification_delivery" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "notificationId" uuid NOT NULL, "channel" character varying(16) NOT NULL, "status" character varying(16) NOT NULL, "detail" character varying(300), "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_notification_delivery_channel" UNIQUE ("notificationId", "channel"), CONSTRAINT "PK_notification_delivery" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_notification_delivery_notification" ON "notification_delivery" ("notificationId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_notification_delivery_notification"`);
        await queryRunner.query(`DROP TABLE "notification_delivery"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_notification_alert_recipient"`);
        await queryRunner.query(`ALTER TABLE "notification" DROP COLUMN "readAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_alert_severity_createdAt"`);
        await queryRunner.query(`ALTER TABLE "alert" DROP COLUMN "supersededByAlertId"`);
        await queryRunner.query(`ALTER TABLE "alert" DROP COLUMN "supersededAt"`);
        await queryRunner.query(`ALTER TABLE "alert" DROP COLUMN "escalatedAt"`);
    }

}
