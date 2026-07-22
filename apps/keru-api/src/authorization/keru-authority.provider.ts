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

  async isAdmin(accountId: string): Promise<boolean> {
    const account = await this.accounts.findAccountById(accountId);
    return account?.role === 'admin';
  }
}
