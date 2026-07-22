import { SetMetadata } from '@nestjs/common';
import { AccountRole } from '../permission/permission.types';

export const ROLES_KEY = 'roles';

/** Restringe una ruta a ciertos roles globales de cuenta. Usar junto con RolesGuard. */
export const Roles = (...roles: AccountRole[]) => SetMetadata(ROLES_KEY, roles);
