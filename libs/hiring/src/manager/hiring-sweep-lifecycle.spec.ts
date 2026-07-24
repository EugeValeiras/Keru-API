import { HiringManager } from './hiring.manager';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';
import { Assignment } from '../resource-access/entities/assignment.entity';

/**
 * KER-58 (UC-05 A1 / UC-09 A5, NFR-14): el reloj del ciclo de vida del servicio. El barrido
 * transiciona por tiempo, sin esperar a un actor: `accepted → in-progress` al entrar en ventana y
 * `accepted|in-progress → completed` al pasar `endDate`, en el mismo barrido que historifica la
 * asignación. Idempotente y multi-instancia-safe (claim `UPDATE...RETURNING` en el ResourceAccess);
 * la precondición SQL de estado no pisa cancelación/no-show (KER-31/32).
 */

const assignment = (over: Partial<Assignment> = {}): Assignment =>
  ({ id: 'asg-1', caregiverId: 'cg-1', patientId: 'pat-1', requestId: 'req-1', status: 'historical', ...over }) as unknown as Assignment;

const request = (over: Partial<HiringRequest> = {}): HiringRequest =>
  ({ id: 'req-1', status: 'completed', ...over }) as unknown as HiringRequest;

function makeManager(hiringAccess: Record<string, unknown>) {
  const audit = { record: jest.fn() };
  const deps = {
    hiringAccess: {
      claimDueAssignments: jest.fn().mockResolvedValue([]),
      claimEndedRequests: jest.fn().mockResolvedValue([]),
      claimStartedRequests: jest.fn().mockResolvedValue([]),
      claimExpiredPendingRequests: jest.fn().mockResolvedValue([]),
      ...hiringAccess,
    },
    audit,
  };
  const manager = new HiringManager(
    {} as never, // tx
    {} as never, // matching
    deps.hiringAccess as never,
    {} as never, // favoriteAccess
    {} as never, // caregiverAccess
    {} as never, // accountAccess
    audit as never,
    {} as never, // pubsub
    {} as never, // reputation
  );
  return { manager, deps };
}

describe('UC-09 A5 · barrido del ciclo de vida del servicio (KER-58, NFR-14)', () => {
  it('Dado un servicio cuya ventana venció, cuando corre el barrido, entonces cierra el request a `completed` con razón terminal `completed` y audita', async () => {
    const now = new Date('2026-08-20T00:00:00Z');
    const { manager, deps } = makeManager({
      claimDueAssignments: jest.fn().mockResolvedValue([assignment()]),
      claimEndedRequests: jest.fn().mockResolvedValue([
        request({ id: 'req-1', status: 'completed', terminalReason: 'completed' }),
      ]),
    });

    const result = await manager.sweepLifecycle(now);

    expect(deps.hiringAccess.claimEndedRequests).toHaveBeenCalledWith(now);
    expect(result).toMatchObject({ assignmentsClosed: 1, requestsCompleted: 1 });
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hiring.request.auto-completed',
        actor: 'system',
        target: { type: 'hiring_request', id: 'req-1' },
        metadata: { terminalReason: 'completed' },
      }),
    );
  });

  it('Dado un servicio aceptado que entró en ventana, cuando corre el barrido, entonces pasa a `in-progress` y audita', async () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const { manager, deps } = makeManager({
      claimStartedRequests: jest.fn().mockResolvedValue([request({ id: 'req-2', status: 'in-progress' })]),
    });

    const result = await manager.sweepLifecycle(now);

    expect(deps.hiringAccess.claimStartedRequests).toHaveBeenCalledWith(now);
    expect(result).toMatchObject({ requestsStarted: 1 });
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hiring.request.started', target: { type: 'hiring_request', id: 'req-2' } }),
    );
  });

  it('Dado un barrido sin vencimientos, cuando corre, entonces no toca nada y no audita', async () => {
    const { manager, deps } = makeManager({});

    const result = await manager.sweepLifecycle(new Date('2026-08-05T00:00:00Z'));

    expect(result).toEqual({ assignmentsClosed: 0, requestsExpired: 0, requestsCompleted: 0, requestsStarted: 0 });
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it('Idempotencia: un segundo barrido no reclama nada (los claims ya no matchean la precondición de estado)', async () => {
    const { manager, deps } = makeManager({
      claimDueAssignments: jest.fn().mockResolvedValueOnce([assignment()]).mockResolvedValue([]),
      claimEndedRequests: jest
        .fn()
        .mockResolvedValueOnce([request({ status: 'completed', terminalReason: 'completed' })])
        .mockResolvedValue([]),
    });

    const first = await manager.sweepLifecycle();
    const second = await manager.sweepLifecycle();

    expect(first.requestsCompleted).toBe(1);
    expect(second.requestsCompleted).toBe(0);
    expect(second.assignmentsClosed).toBe(0);
    // El segundo barrido no vuelve a auditar el cierre.
    expect(deps.audit.record).toHaveBeenCalledTimes(2); // asignación + request del PRIMER barrido
  });
});
