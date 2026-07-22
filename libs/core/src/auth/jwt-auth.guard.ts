import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthPrincipal, JwtPayload } from './auth-principal';

/**
 * JwtAuthGuard (UC-04). Verifica el Bearer token y adjunta el principal a `request.account`,
 * accesible con @CurrentAccount(). Reemplaza el placeholder `x-account-id`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { account?: AuthPrincipal }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Falta el token de autenticación');

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      request.account = { accountId: payload.sub, email: payload.email, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type === 'Bearer' ? value : undefined;
  }
}
