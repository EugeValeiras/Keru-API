import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Hardening · Rate limiting por IP contra fuerza bruta (KER-14).
 * Única fuente de verdad de los límites: la composición (AppModule) monta el guard global
 * con estas opciones y los controllers sensibles endurecen su cuota con @Throttle usando
 * estas mismas constantes. Los endpoints internos de back-office (admin/*) se excluyen
 * con @SkipThrottle: ya exigen JWT + rol admin y los usa tooling propio.
 * El 429 sale por AllExceptionsFilter con el envelope uniforme (code TOO_MANY_REQUESTS).
 */
export const THROTTLE_TTL_MS = 60_000;

/** Override por env con default estricto: el stack local E2E crea varias cuentas por corrida. */
function limitFromEnv(name: string, strictDefault: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : strictDefault;
}

export const THROTTLE_LIMITS = {
  /** Default global: cualquier endpoint sin override ni @SkipThrottle. */
  default: 100,
  /** Login/signup (UC-04): superficie de fuerza bruta de credenciales. */
  auth: limitFromEnv('THROTTLE_AUTH_LIMIT', 5),
  /** Preview pública de invitaciones (UC-03): sin sesión; frena la adivinación de tokens. */
  invitationPreview: 30,
} as const;

/**
 * Bypass para entornos de TEST (THROTTLE_SKIP=true): las suites E2E hacen decenas
 * de signups/logins por minuto desde una sola IP y agotan la cuota de auth — el
 * hardening no debe romper la verificación. NUNCA setearlo en producción.
 */
export const throttlerModuleOptions: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMITS.default }],
  errorMessage: 'Demasiadas solicitudes. Esperá un momento y volvé a intentar.',
  // Lazy a propósito: ConfigModule carga .env DESPUÉS del import de este módulo.
  skipIf: () => process.env.THROTTLE_SKIP === 'true',
};
