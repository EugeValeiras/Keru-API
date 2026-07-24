import { Injectable } from '@nestjs/common';
import { AuthorityProvider, AuthorityQuery, LinkRole } from '@keru/core';
import { AccountAccess, CaregiverAccess } from '@keru/membership';
import { HiringAccess } from '@keru/hiring';

/**
 * Adapter real del AuthorityProvider (constitution §3.5). Responde las preguntas de autorización
 * leyendo réplicas de solo-lectura: vínculos (AccountAccess) y asignaciones (HiringAccess).
 * Vive en la capa de composición (app) para poder leer ambos dominios sin acoplar core.
 */
@Injectable()
export class KeruAuthorityProvider implements AuthorityProvider {
  constructor(
    private readonly accounts: AccountAccess,
    private readonly caregivers: CaregiverAccess,
    private readonly hiring: HiringAccess,
  ) {}

  async getLinkRoles(query: AuthorityQuery): Promise<LinkRole[]> {
    const link = await this.accounts.getLink(query.patientId, query.accountId);
    return link ? [link.role] : [];
  }

  /** Asignación vigente que cubre el tiempo de evaluación (NFR-30). */
  async hasActiveAssignment(query: AuthorityQuery): Promise<boolean> {
    if (query.accountId === '') return false;
    const caregiver = await this.caregivers.findByAccountId(query.accountId);
    if (!caregiver) return false;
    const at = (query.at ?? new Date()).getTime();
    const active = await this.hiring.listActiveAssignmentsForCaregiver(caregiver.id);
    return active.some(
      (a) =>
        a.patientId === query.patientId &&
        a.periodStart.getTime() <= at &&
        at <= a.periodEnd.getTime(),
    );
  }

  /**
   * Relación de servicio VIVA: asignación en estado `active` con el paciente, SIN chequear la
   * ventana (KER-57, §3.7). Alcance de la LECTURA clínica del cuidador — la lectura acompaña la
   * VIDA del servicio aceptado (inicio futuro / en curso); cuando la asignación se cierra o vence
   * pasa a `historical` (barrido NFR-14) y deja de contar. `listActiveAssignmentsForCaregiver`
   * devuelve solo las `active`, así que basta filtrar por paciente.
   */
  async hasLiveServiceRelationship(query: AuthorityQuery): Promise<boolean> {
    if (query.accountId === '') return false;
    const caregiver = await this.caregivers.findByAccountId(query.accountId);
    if (!caregiver) return false;
    const active = await this.hiring.listActiveAssignmentsForCaregiver(caregiver.id);
    return active.some((a) => a.patientId === query.patientId);
  }

  /** Alguna asignación con el paciente, sin importar ventana ni estado (llegada tardía vs ajeno, NFR-30). */
  async hasAnyAssignment(query: AuthorityQuery): Promise<boolean> {
    if (query.accountId === '') return false;
    const caregiver = await this.caregivers.findByAccountId(query.accountId);
    if (!caregiver) return false;
    const assignments = await this.hiring.listAssignmentsForPatient(query.patientId);
    return assignments.some((a) => a.caregiverId === caregiver.id);
  }

  async isAdmin(accountId: string): Promise<boolean> {
    const account = await this.accounts.findAccountById(accountId);
    return account?.role === 'admin';
  }
}
