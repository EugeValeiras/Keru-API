import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DomainEventType, OUTBOX_QUEUE, PubSubUtility } from '@keru/core';
import { HiringManager } from '@keru/hiring';
import { AssignmentClosedEvent, CareRecordManager } from '@keru/care-record';

/**
 * Worker del outbox (constitution §3.2). Consume los eventos encolados y los despacha "hacia abajo"
 * al Manager suscriptor del otro dominio — el listener actúa como Client, nunca hay Manager→Manager
 * síncrono. Idempotente: si el evento ya fue despachado, no reprocesa.
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
}
