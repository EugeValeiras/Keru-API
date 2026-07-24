import { AuthorityQuery, LinkRole } from './permission.types';

export const AUTHORITY_PROVIDER = Symbol('AUTHORITY_PROVIDER');

/**
 * AuthorityProvider (patrón Ports & Adapters). Es el CONTRATO de datos del PermissionEngine:
 * define qué necesita saber para decidir autorización, sin acoplar el engine a dónde viven los datos.
 * El adapter real (KeruAuthorityProvider) lo implementa leyendo réplicas de solo-lectura de
 * AccountAccess (vínculos) y HiringAccess (asignaciones) — constitution §3.4. Para tests se usa un
 * adapter falso, sin tocar la base.
 */
export interface AuthorityProvider {
  /** Roles que la cuenta tiene en su vínculo con el paciente, vigentes en `at`. */
  getLinkRoles(query: AuthorityQuery): Promise<LinkRole[]>;

  /**
   * ¿La cuenta (cuidador) tiene asignación cuya VENTANA cubre `at` (`periodStart ≤ at ≤ periodEnd`)?
   * Es el alcance de la ESCRITURA clínica (NFR-30: autoridad al tiempo de la medición).
   */
  hasActiveAssignment(query: AuthorityQuery): Promise<boolean>;

  /**
   * ¿La cuenta (cuidador) tiene una relación de servicio VIVA con el paciente — una asignación en
   * estado `active` (aceptada y aún no cerrada a `historical`), **independiente de la ventana**?
   * Es el alcance de la LECTURA clínica del cuidador (KER-57, constitution §3.7): mirar no es medir,
   * así que la lectura acompaña la VIDA del servicio (inicio futuro / en curso), no solo la ventana.
   */
  hasLiveServiceRelationship(query: AuthorityQuery): Promise<boolean>;

  /**
   * ¿La cuenta (cuidador) tiene ALGUNA asignación con el paciente, sin importar ventana ni estado?
   * Distingue una llegada tardía de una relación de cuidado (→ cuarentena, NFR-30) de un intento
   * sin relación alguna (→ prohibido).
   */
  hasAnyAssignment(query: AuthorityQuery): Promise<boolean>;

  /** ¿La cuenta es administrador? */
  isAdmin(accountId: string): Promise<boolean>;
}
