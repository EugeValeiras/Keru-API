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

  constructor(
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.prefix = config.get<string>('BULLMQ_PREFIX', 'bull');
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

  private key(jti: string): string {
    return `${this.prefix}:jwt-denylist:${jti}`;
  }
}
