/** Nombre de la cola BullMQ que despacha el outbox (constitution §4). */
export const OUTBOX_QUEUE = 'outbox';

/** Eventos encolados Manager→Manager (constitution §3.2). Un solo envelope por plataforma. */
export enum DomainEventType {
  // Membership -> Hiring (ripple de desactivación / revocación)
  CaregiverDeactivated = 'membership.caregiver.deactivated',
  // Hiring -> CareRecord (eventos de ciclo de vida de asignación)
  AssignmentActivated = 'hiring.assignment.activated',
  AssignmentClosed = 'hiring.assignment.closed',
  // CareRecord -> CareConsult (proyección record-committed)
  ClinicalRecordCommitted = 'care-record.record.committed',
}
