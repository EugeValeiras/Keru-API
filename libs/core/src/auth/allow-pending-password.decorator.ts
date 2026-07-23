import { SetMetadata } from '@nestjs/common';

/**
 * Código de error que le dice al cliente "definí tu contraseña antes de usar la app" (UC-04 A5),
 * no "te falta permiso". Lo emite el JwtAuthGuard ante una cuenta con la contraseña aún sin
 * definir (first-login por invitación, UC-03 A1) que golpea un endpoint de negocio.
 */
export const MUST_SET_PASSWORD = 'MUST_SET_PASSWORD';

export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';

/**
 * Exime a una ruta del bloqueo MUST_SET_PASSWORD: una cuenta pendiente de definir su contraseña
 * (UC-04 A5) igual la alcanza. Se usa en el propio `POST /auth/set-password` (para poder setearla)
 * y en el logout (para poder abandonar). Todo el resto de la app queda bloqueado hasta que la
 * cuenta tenga contraseña.
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);
