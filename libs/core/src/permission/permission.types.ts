/** Rol global de la cuenta. */
export type AccountRole = 'patient' | 'family' | 'caregiver' | 'admin';

/** Rol dentro de un vínculo cuenta↔paciente (constitution §2.4, NFR-13). */
export type LinkRole = 'consent-holder' | 'manager' | 'viewer';

/**
 * Consulta de autoridad. El permiso es del par (cuenta, rol-en-vínculo/asignación),
 * evaluado a un tiempo explícito `at` (NFR-30: autoridad al momento de la medición,
 * no al de sincronización).
 */
export interface AuthorityQuery {
  accountId: string;
  patientId: string;
  /** Momento de evaluación (por defecto, ahora). Para registros clínicos = tiempo de medición. */
  at?: Date;
}
