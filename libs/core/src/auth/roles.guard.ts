import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AccountRole } from '../permission/permission.types';
import { AuthPrincipal } from './auth-principal';
import { ROLES_KEY } from './roles.decorator';

/**
 * RolesGuard: valida el rol global de la cuenta contra @Roles(). Corre DESPUÉS de JwtAuthGuard
 * (que adjunta request.account). El acceso a datos concretos igual se decide por vínculo/asignación
 * (PermissionEngine); esto solo gatea capacidades por rol (p. ej. back-office = admin).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AccountRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { account?: AuthPrincipal }>();
    const role = request.account?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Rol insuficiente para esta operación');
    }
    return true;
  }
}
