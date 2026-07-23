import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthPrincipal, JwtPayload } from './auth-principal';
import { AuditUtility } from '../audit/audit.util';

/** Header por el que viaja el token corto de re-confirmación (UC-04 A3). */
export const STEP_UP_HEADER = 'x-step-up-token';

/** Código de error que le dice al cliente "pedí la re-confirmación", no "te falta permiso". */
export const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED';

/**
 * StepUpGuard (KER-38, NFR-33): las operaciones sensibles exigen, además de la sesión, un
 * token corto emitido por POST /auth/step-up tras re-confirmar el password (claim `step_up`).
 * Corre después de JwtAuthGuard (y RolesGuard si aplica): valida que el step-up sea de la
 * MISMA cuenta que la sesión y audita cada uso (la emisión la audita el manager).
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly audit: AuditUtility,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { account?: AuthPrincipal }>();
    const token = request.headers[STEP_UP_HEADER];
    if (typeof token !== 'string' || token.length === 0) {
      throw this.required('Operación sensible: requiere re-confirmación de identidad (step-up)');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw this.required('El token de step-up es inválido o expiró: re-confirmá tu identidad');
    }
    // Un Bearer común NO sirve como step-up (no lleva el claim), y el step-up de otra cuenta tampoco.
    if (payload.step_up !== true || (request.account && payload.sub !== request.account.accountId)) {
      throw this.required('El token de step-up es inválido o expiró: re-confirmá tu identidad');
    }

    // NFR-33: cada uso queda auditado (la emisión se audita en membership.stepUp).
    await this.audit.record({
      action: 'auth.step-up.used',
      actor: payload.sub,
      metadata: { method: request.method, path: request.originalUrl ?? request.url, jti: payload.jti ?? null },
    });
    return true;
  }

  private required(message: string): ForbiddenException {
    return new ForbiddenException({ message, code: STEP_UP_REQUIRED });
  }
}
