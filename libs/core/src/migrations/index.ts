/**
 * Registro explícito de migraciones (KER-29). El esquema vive acá, versionado — no en
 * `synchronize` (NFR-25: el store clínico no se altera en silencio). Sin globs: el array
 * funciona igual en ts-node (CLI), jest y el build compilado de Nest.
 *
 * Alta de una migración: `npm run migration:generate -- libs/core/src/migrations/<Nombre>`
 * contra una base con el esquema vigente, y sumar la clase generada a este array.
 */
import { InitialSchema1784783279894 } from './1784783279894-InitialSchema';
import { SeparateCompletionFromPaidDeclared1784786611330 } from './1784786611330-SeparateCompletionFromPaidDeclared';
import { RangeVersions1784788818727 } from './1784788818727-RangeVersions';
import { NoShowReportedAt1784803218727 } from './1784803218727-NoShowReportedAt';
import { OutboxRetryDlq1784810000000 } from './1784810000000-OutboxRetryDlq';
import { AlertDeliveryOutcome1784820000000 } from './1784820000000-AlertDeliveryOutcome';
import { RecordCorrection1784830000000 } from './1784830000000-RecordCorrection';
import { AccountPhotoUrl1784840000000 } from './1784840000000-AccountPhotoUrl';
import { PasswordResetToken1784850000000 } from './1784850000000-PasswordResetToken';
import { EmailVerification1784860000000 } from './1784860000000-EmailVerification';
import { CaregiverIdentityFromAccount1784870000000 } from './1784870000000-CaregiverIdentityFromAccount';

export const ALL_MIGRATIONS: Array<new () => unknown> = [
  InitialSchema1784783279894,
  SeparateCompletionFromPaidDeclared1784786611330,
  RangeVersions1784788818727,
  NoShowReportedAt1784803218727,
  OutboxRetryDlq1784810000000,
  AlertDeliveryOutcome1784820000000,
  RecordCorrection1784830000000,
  AccountPhotoUrl1784840000000,
  PasswordResetToken1784850000000,
  EmailVerification1784860000000,
  CaregiverIdentityFromAccount1784870000000,
];
