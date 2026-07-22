import { Global, Module } from '@nestjs/common';
import { AUTHORITY_PROVIDER, PermissionEngine } from '@keru/core';
import { MembershipModule } from '@keru/membership';
import { HiringModule } from '@keru/hiring';
import { KeruAuthorityProvider } from './keru-authority.provider';

/**
 * AuthorizationModule (constitution §3.5): fuente única de autorización. Cablea el PermissionEngine
 * con el adapter real (KeruAuthorityProvider) y lo expone globalmente, para que cualquier Manager
 * lo inyecte sin repetir lógica de permisos. Vive en la capa de composición: importa Membership y
 * Hiring para leer vínculos/asignaciones (réplica de solo-lectura), evitando ciclos con core.
 */
@Global()
@Module({
  imports: [MembershipModule, HiringModule],
  providers: [
    KeruAuthorityProvider,
    { provide: AUTHORITY_PROVIDER, useExisting: KeruAuthorityProvider },
    PermissionEngine,
  ],
  exports: [PermissionEngine],
})
export class AuthorizationModule {}
