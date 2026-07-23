import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { EntityManager, IsNull, LessThan, Not, Repository } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { DomainEventType, OUTBOX_JOB_OPTIONS, OUTBOX_QUEUE } from './outbox.constants';

export interface PublishOptions {
  /** EntityManager de la transacción en curso: el evento se persiste atómicamente con el cambio de estado. */
  manager: EntityManager;
  type: DomainEventType;
  payload: Record<string, unknown>;
  operationId?: string;
}

/** Salud del canal outbox (KER-33): pendientes, pendientes viejos (lag) y dead-lettered. */
export interface OutboxStats {
  pending: number;
  lagged: number;
  oldestPendingAgeMs: number | null;
  deadLettered: number;
}

/**
 * PubSubUtility (constitution §3.1). Único mecanismo de comunicación Manager→Manager:
 * publica un evento en el outbox dentro de la transacción del emisor y lo encola en BullMQ
 * para dispatch asíncrono. NUNCA hay llamada síncrona entre Managers de distinto dominio.
 *
 * Entrega confiable (KER-33, G6): el dispatch reintenta con backoff exponencial; agotados
 * los intentos el evento queda dead-lettered en la tabla (visible y reencolable), jamás se
 * descarta en silencio. El estado de verdad es Postgres; Redis es solo el mecanismo.
 */
@Injectable()
export class PubSubUtility {
  private readonly logger = new Logger(PubSubUtility.name);

  constructor(
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue,
    @InjectRepository(OutboxEvent) private readonly outbox: Repository<OutboxEvent>,
  ) {}

  /** Persiste el evento en el outbox usando el EntityManager de la transacción activa. */
  async publish(opts: PublishOptions): Promise<OutboxEvent> {
    const repo = opts.manager.getRepository(OutboxEvent);
    const event = repo.create({
      type: opts.type,
      payload: opts.payload,
      operationId: opts.operationId ?? null,
      dispatched: false,
    });
    const saved = await repo.save(event);
    this.logger.debug(`outbox <- ${opts.type} (${saved.id})`);
    return saved;
  }

  /**
   * Encola el evento ya persistido para su dispatch, con retry + backoff (KER-33). Llamado tras
   * el commit de la transacción. jobId = event.id: reencolar el mismo evento dedupea en Redis.
   */
  async enqueue(event: OutboxEvent): Promise<void> {
    await this.queue.add(event.type, { outboxEventId: event.id }, { jobId: event.id, ...OUTBOX_JOB_OPTIONS });
  }

  /** Lee un evento del outbox (usado por el worker que consume la cola). */
  findEvent(id: string): Promise<OutboxEvent | null> {
    return this.outbox.findOne({ where: { id } });
  }

  /** Marca el evento como despachado (idempotencia del worker). */
  async markDispatched(id: string): Promise<void> {
    await this.outbox.update(id, { dispatched: true, dispatchedAt: new Date() });
  }

  /** Registra un intento de dispatch fallido: contador + último error (traza del panel, KER-33). */
  async recordDispatchFailure(id: string, attempts: number, error: string): Promise<void> {
    await this.outbox.update(id, { attempts, lastError: error });
  }

  /** Agotados los reintentos: el evento pasa a dead-letter — visible, nunca descartado (G6). */
  async markDeadLettered(id: string, attempts: number, error: string): Promise<void> {
    await this.outbox.update(id, { attempts, lastError: error, deadLetteredAt: new Date() });
  }

  /** DLQ (KER-33): eventos que agotaron sus reintentos, más recientes primero. */
  listDeadLettered(limit = 50): Promise<OutboxEvent[]> {
    return this.outbox.find({
      where: { deadLetteredAt: Not(IsNull()) },
      order: { deadLetteredAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Reintento manual desde el panel: saca el evento de la DLQ y lo reencola con intentos frescos.
   * Naturalmente idempotente (NFR-34): jobId dedupea y el worker no reprocesa lo ya despachado.
   */
  async requeueDeadLetter(id: string): Promise<OutboxEvent | null> {
    const event = await this.outbox.findOne({ where: { id, deadLetteredAt: Not(IsNull()) } });
    if (!event) return null;
    await this.outbox.update(id, { deadLetteredAt: null, attempts: 0 });
    await this.enqueue(event);
    this.logger.log(`dead-letter ${event.type} (${event.id}) reencolado manualmente`);
    return event;
  }

  /**
   * Reconciliación (KER-33): reencola eventos pendientes viejos cuyo job se perdió (p. ej. el
   * enqueue post-commit falló porque Redis estaba caído). jobId = event.id: si el job sigue vivo
   * en Redis (delayed/waiting por backoff), el add es un no-op — no duplica.
   */
  async requeuePending(olderThanMs: number, limit = 100): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const stuck = await this.outbox.find({
      where: { dispatched: false, deadLetteredAt: IsNull(), createdAt: LessThan(cutoff) },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    for (const event of stuck) await this.enqueue(event);
    return stuck.length;
  }

  /** Métricas de salud del canal (probe /health, KER-33): lag = pendientes más viejos que el umbral. */
  async stats(lagThresholdMs: number): Promise<OutboxStats> {
    const pendingWhere = { dispatched: false, deadLetteredAt: IsNull() };
    const [pending, lagged, deadLettered, oldest] = await Promise.all([
      this.outbox.count({ where: pendingWhere }),
      this.outbox.count({ where: { ...pendingWhere, createdAt: LessThan(new Date(Date.now() - lagThresholdMs)) } }),
      this.outbox.count({ where: { deadLetteredAt: Not(IsNull()) } }),
      this.outbox.findOne({ where: pendingWhere, order: { createdAt: 'ASC' } }),
    ]);
    return {
      pending,
      lagged,
      deadLettered,
      oldestPendingAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : null,
    };
  }
}
