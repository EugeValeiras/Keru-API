import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DomainEventType, logJsonLine, OUTBOX_QUEUE, PubSubUtility } from '@keru/core';
import { HiringManager } from '@keru/hiring';
import { AssignmentClosedEvent, CareRecordManager } from '@keru/care-record';

/**
 * Worker del outbox (constitution §3.2). Consume los eventos encolados y los despacha "hacia abajo"
 * al Manager suscriptor del otro dominio — el listener actúa como Client, nunca hay Manager→Manager
 * síncrono. Idempotente: si el evento ya fue despachado, no reprocesa.
 *
 * Entrega confiable (KER-33, G6): un handler que falla hace fallar el job y BullMQ reintenta con
 * backoff exponencial (OUTBOX_JOB_OPTIONS); agotados los intentos, el evento queda dead-lettered
 * en `outbox_event` con su último error — visible en admin/ops/outbox/dead-letter y en el log
 * estructurado — nunca descartado en silencio. El cierre del worker lo maneja @nestjs/bullmq en
 * onApplicationShutdown (espera los jobs en vuelo) al estar habilitados los shutdown hooks.
 */
@Processor(OUTBOX_QUEUE)
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly pubsub: PubSubUtility,
    private readonly hiring: HiringManager,
    private readonly careRecord: CareRecordManager,
  ) {
    super();
  }

  async process(job: Job<{ outboxEventId: string }>): Promise<void> {
    const event = await this.pubsub.findEvent(job.data.outboxEventId);
    if (!event || event.dispatched) return;

    switch (event.type) {
      case DomainEventType.CaregiverDeactivated: {
        const { caregiverId } = event.payload as { caregiverId: string };
        const r = await this.hiring.handleCaregiverDeactivated(caregiverId);
        this.logger.log(
          `ripple ${event.type} (${caregiverId}): ${r.assignmentsClosed} asignaciones cerradas, ${r.requestsCancelled} solicitudes canceladas`,
        );
        break;
      }
      case DomainEventType.AssignmentClosed: {
        // KER-32 (UC-09 A3/A4): la campana a la contraparte la escribe CareRecord (dueño único).
        const payload = event.payload as unknown as AssignmentClosedEvent;
        await this.careRecord.handleAssignmentClosed(payload);
        this.logger.log(
          `campana ${event.type} (${payload.requestId}): razón ${payload.reason}, ${payload.recipientAccountIds?.length ?? 0} destinatario(s)`,
        );
        break;
      }
      default:
        this.logger.warn(`Evento sin handler: ${event.type}`);
    }

    await this.pubsub.markDispatched(event.id);
  }

  /**
   * Cada intento fallido deja traza en el outbox; el último lo manda a dead-letter (KER-33).
   * `attemptsMade` llega post-incremento (1..attempts): exhausted ⇔ attemptsMade >= attempts.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ outboxEventId: string }> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const { outboxEventId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    const message = error?.message ?? String(error);
    try {
      if (job.attemptsMade < maxAttempts) {
        await this.pubsub.recordDispatchFailure(outboxEventId, job.attemptsMade, message);
        this.logger.warn(
          `dispatch ${job.name} (${outboxEventId}) falló (intento ${job.attemptsMade}/${maxAttempts}), reintenta con backoff: ${message}`,
        );
        return;
      }
      await this.pubsub.markDeadLettered(outboxEventId, job.attemptsMade, message);
      logJsonLine({
        level: 'error',
        event: 'outbox.dead-letter',
        outboxEventId,
        type: job.name,
        attempts: job.attemptsMade,
        error: message,
      });
      this.logger.error(
        `dispatch ${job.name} (${outboxEventId}) agotó ${maxAttempts} intentos → dead-letter (ver admin/ops/outbox/dead-letter): ${message}`,
      );
    } catch (persistError) {
      // No dejar caer el proceso por un fallo al persistir la traza: el evento sigue pending
      // (dispatched=false) y lo levantan el reconciler y el lag de /health.
      this.logger.error(`no se pudo registrar el fallo de dispatch de ${outboxEventId}: ${String(persistError)}`);
    }
  }
}
