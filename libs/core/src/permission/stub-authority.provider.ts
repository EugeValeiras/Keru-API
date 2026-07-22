import { Injectable } from '@nestjs/common';
import { AuthorityProvider } from './authority-provider';
import { AuthorityQuery, LinkRole } from './permission.types';

/**
 * Adapter falso para tests / arranque sin dominios. Deniega por defecto. En producción se usa
 * KeruAuthorityProvider (app), que lee vínculos y asignaciones reales.
 */
@Injectable()
export class StubAuthorityProvider implements AuthorityProvider {
  async getLinkRoles(_query: AuthorityQuery): Promise<LinkRole[]> {
    return [];
  }
  async hasActiveAssignment(_query: AuthorityQuery): Promise<boolean> {
    return false;
  }
  async isAdmin(_accountId: string): Promise<boolean> {
    return false;
  }
}
