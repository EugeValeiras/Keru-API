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

/** Reseña propia del viewer sobre un servicio (UC-16: una por parte). */
export interface OwnReview {
  rating: number;
  comment: string | null;
}

export interface ReputationReader {
  /** Agregados (promedio/cantidad) SOLO sobre reseñas reveladas (NFR-22), por sujeto. */
  aggregatesFor(
    subjectType: 'caregiver' | 'patient',
    subjectIds: string[],
  ): Promise<Record<string, RatingAggregate>>;

  /**
   * Reseñas del propio autor para N servicios en bloque (cards de UC-09/10 sin N+1),
   * clave = requestId. Incluye selladas: el autor siempre puede ver SU reseña (NFR-21
   * sella la de la contraparte, no la propia).
   */
  myReviewsFor(requestIds: string[], authorAccountId: string): Promise<Record<string, OwnReview>>;
}
