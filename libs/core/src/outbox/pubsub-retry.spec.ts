import { OutboxEvent } from './outbox-event.entity';
import { PubSubUtility } from './pubsub.util';
import { DomainEventType, OUTBOX_MAX_ATTEMPTS } from './outbox.constants';

/**
 * KER-33: el canal outbox encola con retry + backoff, expone la DLQ y sabe reconciliar
 * pendientes huérfanos. jobId = event.id en todos los caminos: reencolar dedupea, no duplica.
 */

function makeUtility() {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const repo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const pubsub = new PubSubUtility(queue as never, repo as never);
  return { pubsub, queue, repo };
}

const event = (over: Partial<OutboxEvent> = {}): OutboxEvent =>
  ({
    id: 'evt-1',
    type: DomainEventType.AssignmentClosed,
    payload: {},
    operationId: null,
    dispatched: false,
    dispatchedAt: null,
    attempts: 0,
    lastError: null,
    deadLetteredAt: null,
    createdAt: new Date(),
    ...over,
  }) as OutboxEvent;

describe('KER-33 · PubSubUtility: retry, DLQ y reconciliación', () => {
  it('encola el dispatch con reintentos acotados y backoff exponencial', async () => {
    const { pubsub, queue } = makeUtility();

    await pubsub.enqueue(event());

    expect(queue.add).toHaveBeenCalledWith(
      DomainEventType.AssignmentClosed,
      { outboxEventId: 'evt-1' },
      expect.objectContaining({
        jobId: 'evt-1',
        attempts: OUTBOX_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
    expect(OUTBOX_MAX_ATTEMPTS).toBeGreaterThan(1); // sin esto no hay retry
  });

  it('markDeadLettered persiste attempts, lastError y el timestamp de dead-letter', async () => {
    const { pubsub, repo } = makeUtility();

    await pubsub.markDeadLettered('evt-1', 5, 'boom');

    expect(repo.update).toHaveBeenCalledWith('evt-1', {
      attempts: 5,
      lastError: 'boom',
      deadLetteredAt: expect.any(Date),
    });
  });

  it('requeueDeadLetter saca el evento de la DLQ y lo reencola con intentos frescos', async () => {
    const { pubsub, queue, repo } = makeUtility();
    repo.findOne.mockResolvedValue(event({ deadLetteredAt: new Date(), attempts: 5, lastError: 'boom' }));

    const requeued = await pubsub.requeueDeadLetter('evt-1');

    expect(requeued?.id).toBe('evt-1');
    expect(repo.update).toHaveBeenCalledWith('evt-1', { deadLetteredAt: null, attempts: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      DomainEventType.AssignmentClosed,
      { outboxEventId: 'evt-1' },
      expect.objectContaining({ jobId: 'evt-1', attempts: OUTBOX_MAX_ATTEMPTS }),
    );
  });

  it('requeueDeadLetter sobre un evento que no está en la DLQ devuelve null y no encola', async () => {
    const { pubsub, queue, repo } = makeUtility();
    repo.findOne.mockResolvedValue(null);

    expect(await pubsub.requeueDeadLetter('evt-vivo')).toBeNull();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('requeuePending reencola los pendientes huérfanos (enqueue perdido) y devuelve cuántos', async () => {
    const { pubsub, queue, repo } = makeUtility();
    repo.find.mockResolvedValue([event({ id: 'evt-a' }), event({ id: 'evt-b' })]);

    const n = await pubsub.requeuePending(60_000);

    expect(n).toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(expect.any(String), { outboxEventId: 'evt-a' }, expect.objectContaining({ jobId: 'evt-a' }));
    expect(queue.add).toHaveBeenCalledWith(expect.any(String), { outboxEventId: 'evt-b' }, expect.objectContaining({ jobId: 'evt-b' }));
  });

  it('stats reporta pending, lagged, dead-lettered y edad del pendiente más viejo', async () => {
    const { pubsub, repo } = makeUtility();
    repo.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    repo.findOne.mockResolvedValue(event({ createdAt: new Date(Date.now() - 120_000) }));

    const stats = await pubsub.stats(60_000);

    expect(stats.pending).toBe(3);
    expect(stats.lagged).toBe(1);
    expect(stats.deadLettered).toBe(2);
    expect(stats.oldestPendingAgeMs).toBeGreaterThanOrEqual(120_000);
  });
});
