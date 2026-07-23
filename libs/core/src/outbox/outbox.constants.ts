/** Nombre de la cola BullMQ que despacha el outbox (constitution §4). */
export const OUTBOX_QUEUE = 'outbox';

/** Intentos de dispatch antes de dead-letter (KER-33, G6). */
export const OUTBOX_MAX_ATTEMPTS = 5;

/**
 * Opciones del job de dispatch (KER-33): reintentos con backoff exponencial (1s, 2s, 4s, 8s…).
 * Agotados los intentos, el evento se marca dead-lettered en `outbox_event` — la tabla es la
 * DLQ durable e inspeccionable (admin/ops/outbox/dead-letter) — y el job se limpia de Redis
 * (removeOnComplete/removeOnFail): el estado de verdad vive en Postgres, no en la cola.
 */
export const OUTBOX_JOB_OPTIONS = {
  attempts: OUTBOX_MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/** Eventos encolados Manager→Manager (constitution §3.2). Un solo envelope por plataforma. */
export enum DomainEventType {
  // Membership -> Hiring (ripple de desactivación / revocación)
  CaregiverDeactivated = 'membership.caregiver.deactivated',
  // Membership -> CareRecord (KER-38, NFR-41: logout revoca las push subscriptions de la sesión)
  SessionRevoked = 'membership.session.revoked',
  // Hiring -> CareRecord (eventos de ciclo de vida de asignación)
  AssignmentActivated = 'hiring.assignment.activated',
  AssignmentClosed = 'hiring.assignment.closed',
  // CareRecord -> CareConsult (proyección record-committed)
  ClinicalRecordCommitted = 'care-record.record.committed',
}
