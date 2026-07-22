import { AccountRole } from '../permission/permission.types';

/** Identidad autenticada adjuntada al request por el JwtAuthGuard (UC-04). */
export interface AuthPrincipal {
  accountId: string;
  email: string;
  role: AccountRole;
}

/** Payload del JWT emitido en login (UC-04). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: AccountRole;
}
