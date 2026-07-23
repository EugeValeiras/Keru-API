import { Job } from 'bullmq';
import { DomainEventType, OUTBOX_MAX_ATTEMPTS } from '@keru/core';
import { OutboxProcessor } from './outbox.processor';

/**
 * KER-33 (G6, Decouple row 35): un handler que falla NO puede dejar el ripple colgado en
 * silencio. El fallo hace fallar el job (BullMQ reintenta con backoff, OUTBOX_JOB_OPTIONS);
 * cada intento deja traza en el outbox y el último manda el evento a dead-letter — visible
 * en admin/ops/outbox/dead-letter y en el log estructurado.
 */

function makeProcessor(overrides: Record<string, unknown> = {}) {
  const deps = {
    pubsub: {
      findEvent: jest.fn(),
      markDispatched: jest.fn().mockResolvedValue(undefined),
      recordDispatchFailure: jest.fn().mockResolvedValue(undefined),
      markDeadLettered: jest.fn().mockResolvedValue(undefined),
    },
    hiring: { handleCaregiverDeactivated: jest.fn() },
    careRecord: { handleAssignmentClosed: jest.fn() },
    ...overrides,
  };
  const processor = new OutboxProcessor(
    deps.pubsub as never,
    deps.hiring as never,
    deps.careRecord as never,
  );
  return { processor, deps };
}

const makeJob = (over: Record<string, unknown> = {}) =>
  ({
    name: DomainEventType.CaregiverDeactivated,
    data: { outboxEventId: 'evt-1' },
    opts: { attempts: OUTBOX_MAX_ATTEMPTS },
    attemptsMade: 1,
    ...over,
  }) as unknown as Job<{ outboxEventId: string }>;

describe('KER-33 · retry y dead-letter del worker outbox', () => {
  it('un handler que falla hace fallar el job (gatilla el retry de BullMQ) y NO marca dispatched', async () => {
    const { processor, deps } = makeProcessor();
    deps.pubsub.findEvent.mockResolvedValue({
      id: 'evt-1',
      type: DomainEventType.CaregiverDeactivated,
      payload: { caregiverId: 'cg-1' },
      dispatched: false,
    });
    deps.hiring.handleCaregiverDeactivated.mockRejectedValue(new Error('replica caída'));

    await expect(processor.process(makeJob())).rejects.toThrow('replica caída');
    expect(deps.pubsub.markDispatched).not.toHaveBeenCalled();
  });

  it('un intento fallido no-final deja traza (attempts + lastError) y NO dead-letterea', async () => {
    const { processor, deps } = makeProcessor();

    await processor.onFailed(makeJob({ attemptsMade: 2 }), new Error('timeout'));

    expect(deps.pubsub.recordDispatchFailure).toHaveBeenCalledWith('evt-1', 2, 'timeout');
    expect(deps.pubsub.markDeadLettered).not.toHaveBeenCalled();
  });

  it('agotados los intentos, el evento queda dead-lettered con su último error', async () => {
    const { processor, deps } = makeProcessor();

    await processor.onFailed(makeJob({ attemptsMade: OUTBOX_MAX_ATTEMPTS }), new Error('sigue caída'));

    expect(deps.pubsub.markDeadLettered).toHaveBeenCalledWith('evt-1', OUTBOX_MAX_ATTEMPTS, 'sigue caída');
    expect(deps.pubsub.recordDispatchFailure).not.toHaveBeenCalled();
  });

  it('el ciclo completo: reintenta hasta agotar y termina en la DLQ (simulación de los 5 intentos)', async () => {
    const { processor, deps } = makeProcessor();
    deps.pubsub.findEvent.mockResolvedValue({
      id: 'evt-1',
      type: DomainEventType.CaregiverDeactivated,
      payload: { caregiverId: 'cg-1' },
      dispatched: false,
    });
    deps.hiring.handleCaregiverDeactivated.mockRejectedValue(new Error('boom'));

    // Lo que BullMQ hace con attempts=OUTBOX_MAX_ATTEMPTS: procesa, falla, emite 'failed'
    // con attemptsMade incrementado, y reintenta con backoff hasta agotar.
    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
      await expect(processor.process(makeJob())).rejects.toThrow('boom');
      await processor.onFailed(makeJob({ attemptsMade: attempt }), new Error('boom'));
    }

    expect(deps.hiring.handleCaregiverDeactivated).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS); // reintentó
    expect(deps.pubsub.recordDispatchFailure).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS - 1);
    expect(deps.pubsub.markDeadLettered).toHaveBeenCalledTimes(1); // y terminó en la DLQ
    expect(deps.pubsub.markDispatched).not.toHaveBeenCalled(); // jamás se dio por entregado
  });

  it('el dispatch exitoso sigue marcando dispatched (camino feliz intacto)', async () => {
    const { processor, deps } = makeProcessor();
    deps.pubsub.findEvent.mockResolvedValue({
      id: 'evt-1',
      type: DomainEventType.CaregiverDeactivated,
      payload: { caregiverId: 'cg-1' },
      dispatched: false,
    });
    deps.hiring.handleCaregiverDeactivated.mockResolvedValue({ assignmentsClosed: 0, requestsCancelled: 0 });

    await processor.process(makeJob());

    expect(deps.pubsub.markDispatched).toHaveBeenCalledWith('evt-1');
  });

  it('onFailed sin job (stall raro de BullMQ) no explota', async () => {
    const { processor, deps } = makeProcessor();
    await processor.onFailed(undefined, new Error('stalled'));
    expect(deps.pubsub.recordDispatchFailure).not.toHaveBeenCalled();
    expect(deps.pubsub.markDeadLettered).not.toHaveBeenCalled();
  });

  it('si falla persistir la traza, no tira: el evento queda pending y lo levanta el reconciler', async () => {
    const { processor, deps } = makeProcessor();
    deps.pubsub.markDeadLettered.mockRejectedValue(new Error('db caída'));

    await expect(
      processor.onFailed(makeJob({ attemptsMade: OUTBOX_MAX_ATTEMPTS }), new Error('boom')),
    ).resolves.toBeUndefined();
  });
});
