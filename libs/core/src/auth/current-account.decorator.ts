import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthPrincipal } from './auth-principal';

/** Inyecta el principal autenticado (UC-04). Requiere JwtAuthGuard en la ruta. */
export const CurrentAccount = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { account?: AuthPrincipal }>();
    return request.account;
  },
);
