/**
 * Puerto de lectura de reputación (patrón Ports & Adapters, constitution §3.7).
 * Permite que un dominio no-dueño (p. ej. Hiring, para las cards de UC-06) lea
 * agregados de reseñas como réplica de solo-lectura SIN importar el dominio
 * Reputation (que ya importa Hiring para elegibilidad — evitamos el ciclo).
 * El adapter real se cablea en la capa de composición (apps/keru-api).
 */
export const REPUTATION_READER = Symbol('REPUTATION_READER');

export interface RatingAggregate {
  average: number;
  count: number;
}

export interface ReputationReader {
  /** Agregados (promedio/cantidad) SOLO sobre reseñas reveladas (NFR-22), por sujeto. */
  aggregatesFor(
    subjectType: 'caregiver' | 'patient',
    subjectIds: string[],
  ): Promise<Record<string, RatingAggregate>>;
}
