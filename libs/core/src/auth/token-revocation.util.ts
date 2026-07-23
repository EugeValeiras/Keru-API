import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { OUTBOX_QUEUE } from '../outbox/outbox.constants';
import { logJsonLine } from '../logging/json-log.util';

/** Subconjunto del cliente ioredis subyacente de BullMQ que usa la denylist. */
interface RedisLike {
  set(key: string, value: string, px: 'PX', ttlMs: number): Promise<unknown>;
  exists(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
}

/**
 * TokenRevocationUtility (KER-38, NFR-41): denylist de `jti` en Redis con TTL = vida restante
 * del token. Logout server-side barato sobre la infra existente: reusa la conexión Redis de
 * BullMQ (misma vía que HealthUtility) y las claves llevan el prefijo del entorno
 * (BULLMQ_PREFIX) para no cruzarse entre instancias que comparten Redis (e2e vs dev).
 *
 * Postura ante Redis caído: `isRevoked` FALLA ABIERTA con log estructurado — la disponibilidad
 * del path clínico le gana a la revocación instantánea (constitution §5 NFR-33/41); el techo
 * sigue siendo la expiración natural del JWT. `revoke` en cambio propaga el error: un logout
 * que no revocó no debe reportarse como exitoso.
 */
@Injectable()
export class TokenRevocationUtility {
  private readonly logger = new Logger(TokenRevocationUtility.name);
  private readonly prefix: string;
  /** Techo de vida de la clave de corte por cuenta = vida del access token (JWT_EXPIRES). */
  private readonly accountCutoffTtlMs: number;

  constructor(
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.prefix = config.get<string>('BULLMQ_PREFIX', 'bull');
    this.accountCutoffTtlMs = parseDurationMs(config.get<string>('JWT_EXPIRES', '7d'));
  }

  /** Deslista el token hasta su expiración natural. TTL vencido o ausente: no hay nada que revocar. */
  async revoke(jti: string, expEpochSeconds?: number): Promise<void> {
    const ttlMs = expEpochSeconds ? expEpochSeconds * 1000 - Date.now() : null;
    if (ttlMs !== null && ttlMs <= 0) return; // ya expiró solo
    const client = (await this.queue.client) as unknown as RedisLike;
    // Sin exp legible (no debería pasar: lo estampa JwtService), techo defensivo de 7 días.
    await client.set(this.key(jti), '1', 'PX', ttlMs ?? 7 * 24 * 60 * 60 * 1000);
  }

  /** Consulta del guard en cada request autenticado. Falla abierta si Redis no responde. */
  async isRevoked(jti: string | undefined): Promise<boolean> {
    if (!jti) return false; // tokens pre-KER-38 sin jti: solo los revoca su expiración
    try {
      const client = (await this.queue.client) as unknown as RedisLike;
      return (await client.exists(this.key(jti))) === 1;
    } catch (error) {
      logJsonLine({
        level: 'warn',
        event: 'auth.denylist.unavailable',
        msg: 'Redis no responde: la denylist de jti falla abierta (NFR-41)',
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.warn('denylist de jti no disponible: se deja pasar el token (fail-open)');
      return false;
    }
  }

  /**
   * UC-04 A4 (reset de contraseña, NFR-41): revoca TODAS las sesiones vigentes de una cuenta de
   * un plumazo, sin rastrear cada jti. Estampa un "corte" = ahora (epoch en segundos): el guard
   * rechaza todo token con `iat` anterior al corte. TTL = vida del access token (pasado ese
   * lapso ya no hay tokens vivos previos al corte, la clave se limpia sola).
   *
   * MEJOR ESFUERZO (fail-open, NFR-41): a diferencia de `revoke` (logout), acá la contraseña ya
   * se cambió en la transacción; si Redis no responde, la revocación instantánea se pierde pero
   * el techo sigue siendo la expiración natural del token — no se rompe el reset por eso.
   */
  async revokeAccountSessions(accountId: string): Promise<void> {
    const cutoffEpochSeconds = Math.floor(Date.now() / 1000);
    try {
      const client = (await this.queue.client) as unknown as RedisLike;
      await client.set(this.accountKey(accountId), String(cutoffEpochSeconds), 'PX', this.accountCutoffTtlMs);
    } catch (error) {
      logJsonLine({
        level: 'warn',
        event: 'auth.account-revocation.unavailable',
        msg: 'Redis no responde: no se pudo revocar las sesiones de la cuenta (fail-open, NFR-41)',
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.warn(`no se pudo revocar las sesiones de la cuenta ${accountId} (fail-open)`);
    }
  }

  /**
   * Consulta del guard en cada request: ¿el token es anterior al corte de revocación por cuenta?
   * (UC-04 A4). Sin `iat` legible no hay con qué comparar → se deja pasar. Falla abierta si Redis
   * no responde (misma postura que la denylist de jti).
   */
  async isAccountSessionRevoked(accountId: string, iatEpochSeconds: number | undefined): Promise<boolean> {
    if (!iatEpochSeconds) return false;
    try {
      const client = (await this.queue.client) as unknown as RedisLike;
      const cutoff = await client.get(this.accountKey(accountId));
      if (!cutoff) return false;
      return iatEpochSeconds < Number(cutoff);
    } catch (error) {
      logJsonLine({
        level: 'warn',
        event: 'auth.account-revocation.unavailable',
        msg: 'Redis no responde: el corte de sesiones por cuenta falla abierto (NFR-41)',
        error: error instanceof Error ? error.message : String(error),
      });
      this.logger.warn('corte de sesiones por cuenta no disponible: se deja pasar el token (fail-open)');
      return false;
    }
  }

  private key(jti: string): string {
    return `${this.prefix}:jwt-denylist:${jti}`;
  }

  private accountKey(accountId: string): string {
    return `${this.prefix}:jwt-account-cutoff:${accountId}`;
  }
}

/** Parsea duraciones estilo JWT (`7d`, `12h`, `15m`, `30s`) o segundos crudos a milisegundos. */
function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*([dhms])?$/.exec(value.trim());
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (!match) return sevenDaysMs; // formato desconocido: techo defensivo de 7 días
  const amount = Number(match[1]);
  const unitMs = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 }[match[2] ?? 's'] ?? 1000;
  return amount * unitMs;
}
