import { AccountRole } from '../permission/permission.types';

/** Identidad autenticada adjuntada al request por el JwtAuthGuard (UC-04). */
export interface AuthPrincipal {
  accountId: string;
  email: string;
  role: AccountRole;
  /** Identidad del token (NFR-41, KER-38). Los tokens previos a KER-38 no la llevan. */
  jti?: string;
  /** Expiración del token (epoch en segundos): TTL de la denylist al hacer logout. */
  tokenExp?: number;
  /** UC-04 A5: la cuenta aún no definió su contraseña (first-login). Sesión limitada. */
  mustSetPassword?: boolean;
}

/** Payload del JWT emitido en login (UC-04). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: AccountRole;
  /** Identidad del token para poder revocarlo (denylist, NFR-41). */
  jti?: string;
  /** Claim de los tokens cortos de re-confirmación (NFR-33): solo los emite /auth/step-up. */
  step_up?: boolean;
  /** UC-04 A5: sesión limitada de una cuenta sin contraseña definida (first-login por invitación). */
  mps?: boolean;
  /** Estampados por JwtService al firmar. */
  exp?: number;
  iat?: number;
}
