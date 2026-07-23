import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial (KER-29): las 17 tablas del MVP con sus índices (incluidos los
 * compuestos de KER-26), generado con migration:generate contra una base vacía a partir
 * de las entidades vigentes. Desde acá el esquema evoluciona SOLO por migraciones.
 */
export class InitialSchema1784783279894 implements MigrationInterface {
  name = 'InitialSchema1784783279894';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Los PK uuid usan uuid_generate_v4(); synchronize instalaba la extensión, acá es explícito.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "outbox_event" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(128) NOT NULL, "payload" jsonb NOT NULL, "operationId" character varying(128), "dispatched" boolean NOT NULL DEFAULT false, "dispatchedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cc0c9e40998e45ecfc5e313429d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_293254e94cb18e871039263caf" ON "outbox_event" ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_60844d9c04cc0d6d037a1b1fa8" ON "outbox_event" ("dispatched") `,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "action" character varying(160) NOT NULL, "actor" character varying(128) NOT NULL, "target" jsonb, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_07fefa57f7f5ab8fc3f52b3ed0b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_951e6339a77994dfbad976b35c" ON "audit_log" ("action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b24e98ef90e2b356263d4487e4" ON "audit_log" ("actor") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_78e013ffae12f5a1fc1dbefff9" ON "audit_log" ("createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "quarantined_record" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "patientId" uuid NOT NULL, "type" character varying(16) NOT NULL, "authorAccountId" character varying(128) NOT NULL, "authorRole" character varying(32) NOT NULL, "measuredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "data" jsonb NOT NULL, "reason" character varying(64) NOT NULL DEFAULT 'no-authority-at-measurement', "status" character varying(16) NOT NULL DEFAULT 'pending', "resolvedByAccountId" character varying(128), "resolvedAt" TIMESTAMP WITH TIME ZONE, "approvedRecordId" uuid, "createdByOperationId" character varying(128), "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_351c6033ad0b99879e81d0e8731" UNIQUE ("createdByOperationId"), CONSTRAINT "PK_1c0fa3c1c7f10f4cd234fe20bde" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c5dadece581f4105887f2f22e" ON "quarantined_record" ("patientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_26d6eb6421f86522c7dec85989" ON "quarantined_record" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "push_subscription" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "accountId" character varying(128) NOT NULL, "endpoint" character varying(1024) NOT NULL, "p256dh" character varying(256) NOT NULL, "auth" character varying(256) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_27ae9074fc39a09bc1aee263df5" UNIQUE ("endpoint"), CONSTRAINT "PK_07fc861c0d2c38c1b830fb9cb5d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9ea73224f467ec6e031bd34048" ON "push_subscription" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notification" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recipientAccountId" character varying(128) NOT NULL, "patientId" uuid NOT NULL, "alertId" uuid, "type" character varying(16) NOT NULL, "title" character varying(200) NOT NULL, "body" character varying(500) NOT NULL, "read" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_705b6c7cdf9b2c2ff7ac7872cb7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d1e572ca4da43cb842643ac0ad" ON "notification" ("recipientAccountId", "read", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "alert" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "patientId" uuid NOT NULL, "recordId" uuid NOT NULL, "metricKey" character varying(64), "value" character varying(32), "unit" character varying(16), "severity" character varying(16) NOT NULL, "rangeVersion" character varying(64) NOT NULL, "message" character varying(300) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ad91cad659a3536465d564a4b2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d1998afcd1e3e7699e980304f" ON "alert" ("patientId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "clinical_record" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "patientId" uuid NOT NULL, "type" character varying(16) NOT NULL, "authorAccountId" character varying(128) NOT NULL, "authorRole" character varying(32) NOT NULL, "measuredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "data" jsonb NOT NULL, "createdByOperationId" character varying(128), "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_c6c7d201a1f5c7bf87accb4f357" UNIQUE ("createdByOperationId"), CONSTRAINT "PK_8ff45b82ea4c7a2ee37a1ec2464" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee49bcf291288f9b27226bd314" ON "clinical_record" ("patientId", "measuredAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "review" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requestId" uuid NOT NULL, "authorAccountId" character varying(128) NOT NULL, "subjectType" character varying(16) NOT NULL, "subjectId" uuid NOT NULL, "rating" integer NOT NULL, "comment" character varying(1000), "revealed" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8c787993017c51b6cc188599466" UNIQUE ("requestId", "authorAccountId"), CONSTRAINT "PK_2e4299a343a81574217255c00ca" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_baa17eb6fdffe5f9c5439d11d6" ON "review" ("revealed") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8cda325b5bf370060d3dab2664" ON "review" ("subjectType", "subjectId", "revealed") `,
    );
    await queryRunner.query(
      `CREATE TABLE "patient" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fullName" character varying(200) NOT NULL, "birthDate" date NOT NULL, "photoUrl" character varying(500), "mainCondition" character varying(300) NOT NULL, "bloodGroup" character varying(10), "allergies" jsonb NOT NULL DEFAULT '[]', "emergencyContact" jsonb NOT NULL, "createdByOperationId" character varying(128), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d3d520e4d79c62af6d42534585b" UNIQUE ("createdByOperationId"), CONSTRAINT "PK_8dfa510bb29ad31ab2139fbfb99" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3d520e4d79c62af6d42534585" ON "patient" ("createdByOperationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "patient_link" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "patientId" uuid NOT NULL, "accountId" character varying(128) NOT NULL, "role" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4b7567203878c1ecc72680e59bb" UNIQUE ("patientId", "accountId"), CONSTRAINT "PK_43984c19e4194a991694fe28d97" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23edab0242bc1106b2e7f2a69a" ON "patient_link" ("patientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d6f921342cb786d78409a10ba" ON "patient_link" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "family_invitation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" character varying(64) NOT NULL, "patientId" uuid NOT NULL, "invitedByAccountId" character varying(128) NOT NULL, "invitedEmail" character varying(200) NOT NULL, "roleToGrant" character varying(32) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "confirmedByAccountId" character varying(128), "confirmedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_6dd6a9c83b0e565e94b9e3592fd" UNIQUE ("token"), CONSTRAINT "PK_4fb559e55d6f1fb8216caabb157" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6dd6a9c83b0e565e94b9e3592f" ON "family_invitation" ("token") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cdc62aca419e446b968f438a87" ON "family_invitation" ("patientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_002df7538c02b2d57d509e756c" ON "family_invitation" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "caregiver" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "accountId" character varying(128) NOT NULL, "displayName" character varying(200) NOT NULL, "photoUrl" character varying(500), "specialties" jsonb NOT NULL DEFAULT '[]', "certifications" jsonb NOT NULL DEFAULT '[]', "availability" jsonb NOT NULL DEFAULT '[]', "rates" jsonb NOT NULL, "zone" character varying(120) NOT NULL, "modalities" jsonb NOT NULL DEFAULT '[]', "status" character varying(16) NOT NULL DEFAULT 'pending', "rejectionReason" character varying(400), "badges" jsonb NOT NULL DEFAULT '{"certifications":false,"identity":false,"background":false}', "reviewedBy" character varying(128), "reviewedAt" TIMESTAMP WITH TIME ZONE, "createdByOperationId" character varying(128), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_36e72e237186762b0648aefd432" UNIQUE ("accountId"), CONSTRAINT "UQ_5e756f89dc3264e4db14059a59d" UNIQUE ("createdByOperationId"), CONSTRAINT "PK_114bf658fe2b416245381f89be0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_36e72e237186762b0648aefd43" ON "caregiver" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_952ec97828bb836606934388f7" ON "caregiver" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "caregiver_rate_version" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caregiverId" uuid NOT NULL, "rates" jsonb NOT NULL, "effectiveFrom" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByOperationId" character varying(128), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_db0c15352196e44979745a47c03" UNIQUE ("createdByOperationId"), CONSTRAINT "PK_52c8531907425e43b3606c74c7a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b96755812343223eb4308b11a6" ON "caregiver_rate_version" ("caregiverId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "account" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(200) NOT NULL, "passwordHash" character varying(200) NOT NULL, "role" character varying(32) NOT NULL, "displayName" character varying(200) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4c8f96ccf523e9a3faefd5bdd4c" UNIQUE ("email"), CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c8f96ccf523e9a3faefd5bdd4" ON "account" ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "hiring_request" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "patientId" uuid NOT NULL, "requesterAccountId" character varying(128) NOT NULL, "caregiverId" uuid NOT NULL, "modality" character varying(16) NOT NULL, "startDate" TIMESTAMP WITH TIME ZONE NOT NULL, "endDate" TIMESTAMP WITH TIME ZONE NOT NULL, "specialRequirements" character varying(1000), "contactData" jsonb NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "ratePerHourSnapshot" numeric(12,2) NOT NULL, "currencySnapshot" character varying(8) NOT NULL, "createdByOperationId" character varying(128), "decidedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_095470b4761faf3f8f786966ecd" UNIQUE ("createdByOperationId"), CONSTRAINT "PK_fb8a5bfe28bb7cbfe351aac13a6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4aafc37b21a2979ee02f7bfdf5" ON "hiring_request" ("patientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f67781fc8ecf2ced3f283def42" ON "hiring_request" ("requesterAccountId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_32dafd82bb2ef6f6e1d98691b5" ON "hiring_request" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a5523f1b94cf2602ecd7b9a3fa" ON "hiring_request" ("caregiverId", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "favorite" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "accountId" character varying(128) NOT NULL, "caregiverId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a78e41db6066684353525c57eee" UNIQUE ("accountId", "caregiverId"), CONSTRAINT "PK_495675cec4fb09666704e4f610f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5dedf4cf7a911c8f0445465aec" ON "favorite" ("accountId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "assignment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caregiverId" uuid NOT NULL, "patientId" uuid NOT NULL, "requestId" uuid, "periodStart" TIMESTAMP WITH TIME ZONE NOT NULL, "periodEnd" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'active', "provenance" character varying(16) NOT NULL DEFAULT 'acceptance', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_43c2f5a3859f54cedafb270f37e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e65d4ed01d3b7962d475543c51" ON "assignment" ("caregiverId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a9b7f8126c35256a257aa845b0" ON "assignment" ("patientId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ff0d41f34ef2956d9282fb5cdf" ON "assignment" ("status") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_ff0d41f34ef2956d9282fb5cdf"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a9b7f8126c35256a257aa845b0"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e65d4ed01d3b7962d475543c51"`);
    await queryRunner.query(`DROP TABLE "assignment"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5dedf4cf7a911c8f0445465aec"`);
    await queryRunner.query(`DROP TABLE "favorite"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a5523f1b94cf2602ecd7b9a3fa"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_32dafd82bb2ef6f6e1d98691b5"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_f67781fc8ecf2ced3f283def42"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4aafc37b21a2979ee02f7bfdf5"`);
    await queryRunner.query(`DROP TABLE "hiring_request"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4c8f96ccf523e9a3faefd5bdd4"`);
    await queryRunner.query(`DROP TABLE "account"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b96755812343223eb4308b11a6"`);
    await queryRunner.query(`DROP TABLE "caregiver_rate_version"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_952ec97828bb836606934388f7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_36e72e237186762b0648aefd43"`);
    await queryRunner.query(`DROP TABLE "caregiver"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_002df7538c02b2d57d509e756c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cdc62aca419e446b968f438a87"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6dd6a9c83b0e565e94b9e3592f"`);
    await queryRunner.query(`DROP TABLE "family_invitation"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_6d6f921342cb786d78409a10ba"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_23edab0242bc1106b2e7f2a69a"`);
    await queryRunner.query(`DROP TABLE "patient_link"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d3d520e4d79c62af6d42534585"`);
    await queryRunner.query(`DROP TABLE "patient"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_8cda325b5bf370060d3dab2664"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_baa17eb6fdffe5f9c5439d11d6"`);
    await queryRunner.query(`DROP TABLE "review"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ee49bcf291288f9b27226bd314"`);
    await queryRunner.query(`DROP TABLE "clinical_record"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_4d1998afcd1e3e7699e980304f"`);
    await queryRunner.query(`DROP TABLE "alert"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d1e572ca4da43cb842643ac0ad"`);
    await queryRunner.query(`DROP TABLE "notification"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_9ea73224f467ec6e031bd34048"`);
    await queryRunner.query(`DROP TABLE "push_subscription"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_26d6eb6421f86522c7dec85989"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_0c5dadece581f4105887f2f22e"`);
    await queryRunner.query(`DROP TABLE "quarantined_record"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_78e013ffae12f5a1fc1dbefff9"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b24e98ef90e2b356263d4487e4"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_951e6339a77994dfbad976b35c"`);
    await queryRunner.query(`DROP TABLE "audit_log"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_60844d9c04cc0d6d037a1b1fa8"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_293254e94cb18e871039263caf"`);
    await queryRunner.query(`DROP TABLE "outbox_event"`);
  }
}
