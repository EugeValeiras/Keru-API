import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthPrincipal, JwtPayload } from './auth-principal';
import { TokenRevocationUtility } from './token-revocation.util';
import { ALLOW_PENDING_PASSWORD_KEY, MUST_SET_PASSWORD } from './allow-pending-password.decorator';

/**
 * JwtAuthGuard (UC-04). Verifica el Bearer token y adjunta el principal a `request.account`,
 * accesible con @CurrentAccount(). Reemplaza el placeholder `x-account-id`.
 * Desde KER-38 (NFR-41) consulta además la denylist de jti: un token deslistado por logout
 * vale tanto como uno expirado.
 * Desde KER-47 (UC-04 A5) bloquea las sesiones limitadas de first-login: un token con el claim
 * `mps` (cuenta sin contraseña definida) recibe 403 MUST_SET_PASSWORD en todo endpoint de negocio,
 * salvo los marcados con @AllowPendingPassword (set-password, logout).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly revocation: TokenRevocationUtility,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { account?: AuthPrincipal }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Falta el token de autenticación');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    if (await this.revocation.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Token revocado: la sesión fue cerrada');
    }
    // UC-04 A4: un reset de contraseña revoca todas las sesiones previas de la cuenta.
    if (await this.revocation.isAccountSessionRevoked(payload.sub, payload.iat)) {
      throw new UnauthorizedException('Sesión revocada: la contraseña de la cuenta fue cambiada');
    }
    request.account = {
      accountId: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
      tokenExp: payload.exp,
      mustSetPassword: payload.mps === true,
    };

    // UC-04 A5: una cuenta sin contraseña definida (sesión limitada) no puede usar la app hasta
    // setearla. Se exime la ruta marcada con @AllowPendingPassword (el propio set-password/logout).
    if (payload.mps === true) {
      const allowsPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowsPending) {
        throw new ForbiddenException({
          message: 'Definí tu contraseña para empezar a usar Keru',
          code: MUST_SET_PASSWORD,
        });
      }
    }
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type === 'Bearer' ? value : undefined;
  }
}
