import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Engine } from '../idesign/idesign';
import { AUTHORITY_PROVIDER, AuthorityProvider } from './authority-provider';
import { AuthorityQuery, LinkRole } from './permission.types';

/**
 * PermissionEngine (constitution §3.1). Decisión de rol-y-vínculo sobre el par
 * (cuenta, rol-en-vínculo/asignación) a un tiempo de evaluación explícito. Cálculo puro:
 * solo lee vía AuthorityProvider, no muta nada. Fuente única de autorización del sistema
 * (constitution §3.5): ningún Manager decide autorización por su cuenta.
 */
@Engine()
@Injectable()
export class PermissionEngine {
  constructor(@Inject(AUTHORITY_PROVIDER) private readonly authority: AuthorityProvider) {}

  /** ¿La cuenta puede LEER datos del paciente? (vínculo o cuidador con asignación). */
  async canReadPatient(query: AuthorityQuery): Promise<boolean> {
    const roles = await this.authority.getLinkRoles(query);
    if (roles.length > 0) return true;
    return this.authority.hasActiveAssignment(query);
  }

  /** ¿La cuenta puede REGISTRAR datos clínicos? Familiar vinculado o cuidador con asignación vigente. */
  async canRecordClinical(query: AuthorityQuery): Promise<boolean> {
    const roles = await this.authority.getLinkRoles(query);
    if (roles.length > 0) return true;
    return this.authority.hasActiveAssignment(query);
  }

  /** ¿La cuenta tiene alguno de los roles de vínculo requeridos? */
  async hasLinkRole(query: AuthorityQuery, allowed: LinkRole[]): Promise<boolean> {
    const roles = await this.authority.getLinkRoles(query);
    return roles.some((r) => allowed.includes(r));
  }

  isAdmin(accountId: string): Promise<boolean> {
    return this.authority.isAdmin(accountId);
  }

  /** ¿La cuenta está vinculada al paciente (cualquier rol)? Lanza 403 si no. */
  async assertLinked(query: AuthorityQuery): Promise<void> {
    const roles = await this.authority.getLinkRoles(query);
    if (roles.length === 0) throw new ForbiddenException('No estás vinculado a este paciente');
  }

  async assertCanRecordClinical(query: AuthorityQuery): Promise<void> {
    if (!(await this.canRecordClinical(query))) {
      throw new ForbiddenException('Sin autoridad para registrar datos de este paciente');
    }
  }

  async assertCanReadPatient(query: AuthorityQuery): Promise<void> {
    if (!(await this.canReadPatient(query))) {
      throw new ForbiddenException('Sin acceso a este paciente');
    }
  }
}
