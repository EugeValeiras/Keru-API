import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { DomainEventType, OUTBOX_QUEUE } from './outbox.constants';

export interface PublishOptions {
  /** EntityManager de la transacción en curso: el evento se persiste atómicamente con el cambio de estado. */
  manager: EntityManager;
  type: DomainEventType;
  payload: Record<string, unknown>;
  operationId?: string;
}

/**
 * PubSubUtility (constitution §3.1). Único mecanismo de comunicación Manager→Manager:
 * publica un evento en el outbox dentro de la transacción del emisor y lo encola en BullMQ
 * para dispatch asíncrono. NUNCA hay llamada síncrona entre Managers de distinto dominio.
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

  /** Encola el evento ya persistido para su dispatch. Llamado tras el commit de la transacción. */
  async enqueue(event: OutboxEvent): Promise<void> {
    await this.queue.add(event.type, { outboxEventId: event.id }, { jobId: event.id });
  }

  /** Lee un evento del outbox (usado por el worker que consume la cola). */
  findEvent(id: string): Promise<OutboxEvent | null> {
    return this.outbox.findOne({ where: { id } });
  }

  /** Marca el evento como despachado (idempotencia del worker). */
  async markDispatched(id: string): Promise<void> {
    await this.outbox.update(id, { dispatched: true, dispatchedAt: new Date() });
  }
}
