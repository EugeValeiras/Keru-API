import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { OUTBOX_QUEUE } from '../outbox/outbox.constants';
import { OutboxStats, PubSubUtility } from '../outbox/pubsub.util';

export type ProbeStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'error';
  checks: {
    db: { status: ProbeStatus; latencyMs?: number; error?: string };
    redis: { status: ProbeStatus; latencyMs?: number; error?: string };
    /** `unknown` cuando la DB está caída y las métricas no se pueden leer. */
    outbox: Partial<OutboxStats> & { status: 'ok' | 'lagged' | 'unknown'; lagThresholdMs: number };
  };
}

/**
 * HealthUtility (KER-33): probes de salud reales para `GET /health` (y el healthcheck del
 * contenedor). Chequea la DB (SELECT 1), Redis (ping vía la conexión de la cola outbox) y el
 * lag del outbox (eventos pending más viejos que OUTBOX_LAG_THRESHOLD_MS): un worker muerto o
 * trabado hace fallar el probe y el orquestador reinicia la API (que incluye al worker).
 * Los dead-lettered NO bajan la salud: son visibles en admin ops y un reinicio no los arregla.
 *
 * Utility de infraestructura transversal (constitution §3.4, misma excepción que
 * TransactionUtility/PubSubUtility): toca DataSource/cola directamente, nunca datos de dominio.
 */
@Injectable()
export class HealthUtility {
  private readonly lagThresholdMs: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    private readonly pubsub: PubSubUtility,
    config: ConfigService,
  ) {
    this.lagThresholdMs = Number(config.get('OUTBOX_LAG_THRESHOLD_MS', 60_000));
  }

  async check(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);

    let outbox: HealthReport['checks']['outbox'] = { status: 'unknown', lagThresholdMs: this.lagThresholdMs };
    if (db.status === 'up') {
      try {
        const stats = await this.pubsub.stats(this.lagThresholdMs);
        outbox = { status: stats.lagged > 0 ? 'lagged' : 'ok', lagThresholdMs: this.lagThresholdMs, ...stats };
      } catch {
        // la DB respondió el SELECT 1 pero falló la lectura de métricas: se reporta unknown
      }
    }

    const healthy = db.status === 'up' && redis.status === 'up' && outbox.status !== 'lagged';
    return { status: healthy ? 'ok' : 'error', checks: { db, redis, outbox } };
  }

  private async checkDb(): Promise<HealthReport['checks']['db']> {
    const started = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'down', error: String(error) };
    }
  }

  private async checkRedis(): Promise<HealthReport['checks']['redis']> {
    const started = Date.now();
    try {
      // El tipo IRedisClient de bullmq no declara ping(), pero el cliente ioredis subyacente lo tiene.
      const client = (await this.queue.client) as unknown as { ping(): Promise<unknown> };
      await client.ping();
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'down', error: String(error) };
    }
  }
}
