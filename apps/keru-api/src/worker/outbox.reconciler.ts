import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PubSubUtility } from '@keru/core';

/** Pendientes más viejos que esto se consideran huérfanos y se reencolan (jobId dedupea). */
const STUCK_AFTER_MS = 60_000;

/**
 * Reconciliador del outbox (KER-33, "retry until acknowledged" — Decouple row 35): si el
 * enqueue post-commit se perdió (p. ej. Redis caído en ese instante), el evento queda pending
 * sin job. Este barrido lo reencola; como jobId = event.id, si el job sigue vivo en Redis
 * (waiting/delayed por backoff) el add es un no-op y no duplica dispatch.
 */
@Injectable()
export class OutboxReconciler {
  private readonly logger = new Logger(OutboxReconciler.name);

  constructor(private readonly pubsub: PubSubUtility) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    try {
      const requeued = await this.pubsub.requeuePending(STUCK_AFTER_MS);
      if (requeued > 0) this.logger.warn(`outbox: ${requeued} evento(s) pending huérfano(s) reencolado(s)`);
    } catch (error) {
      this.logger.error(`reconciliación del outbox falló: ${String(error)}`);
    }
  }
}
