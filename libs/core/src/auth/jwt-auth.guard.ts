import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthPrincipal, JwtPayload } from './auth-principal';
import { TokenRevocationUtility } from './token-revocation.util';

/**
 * JwtAuthGuard (UC-04). Verifica el Bearer token y adjunta el principal a `request.account`,
 * accesible con @CurrentAccount(). Reemplaza el placeholder `x-account-id`.
 * Desde KER-38 (NFR-41) consulta además la denylist de jti: un token deslistado por logout
 * vale tanto como uno expirado.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly revocation: TokenRevocationUtility,
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
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type === 'Bearer' ? value : undefined;
  }
}
