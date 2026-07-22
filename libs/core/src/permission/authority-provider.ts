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

  /** ¿La cuenta (cuidador) tiene asignación vigente al paciente en `at`? */
  hasActiveAssignment(query: AuthorityQuery): Promise<boolean>;

  /** ¿La cuenta es administrador? */
  isAdmin(accountId: string): Promise<boolean>;
}
