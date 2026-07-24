import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Engine } from '../idesign/idesign';
import { AUTHORITY_PROVIDER, AuthorityProvider } from './authority-provider';
import { AuthorityQuery, LinkRole } from './permission.types';

/** Resultado de clasificar una escritura clínica al tiempo de medición (NFR-30). */
export type ClinicalWriteAuthority = 'authorized' | 'quarantine' | 'forbidden';

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

  /**
   * ¿La cuenta puede LEER datos del paciente? Familiar vinculado, o cuidador con una relación de
   * servicio VIVA (asignación aceptada sin cerrar), independiente de la ventana (KER-57, §3.7):
   * la lectura acompaña la VIDA del servicio, no el instante de la medición (eso es la ESCRITURA).
   */
  async canReadPatient(query: AuthorityQuery): Promise<boolean> {
    const roles = await this.authority.getLinkRoles(query);
    if (roles.length > 0) return true;
    return this.authority.hasLiveServiceRelationship(query);
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

  /**
   * Clasifica una escritura clínica al tiempo de medición (NFR-30): `authorized` (vínculo o
   * asignación que cubre `at`); `quarantine` (llegada tardía de un cuidador CON relación de
   * cuidado — alguna asignación con el paciente — pero sin ventana que cubra `at`: se pone en
   * cuarentena, nunca se descarta en silencio); `forbidden` (sin relación alguna: 403 seco).
   */
  async classifyClinicalWrite(query: AuthorityQuery): Promise<ClinicalWriteAuthority> {
    if (await this.canRecordClinical(query)) return 'authorized';
    if (await this.authority.hasAnyAssignment(query)) return 'quarantine';
    return 'forbidden';
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
