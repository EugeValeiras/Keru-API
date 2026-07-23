import { AssignmentClosedEvent, CareRecordManager } from './care-record.manager';

/**
 * KER-32 (UC-09 A3/A4): la campana por cierre de asignación activa la escribe CareRecord
 * (dueño único de escritura de notificaciones) al consumir `hiring.assignment.closed` desde
 * el worker del outbox. La campana se persiste en transacción; el push es best-effort después.
 */

function makeManager(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const deps = {
    tx: {
      run: jest.fn(async (fn: (em: unknown) => unknown) => {
        const result = await fn({});
        calls.push('commit');
        return result;
      }),
    },
    careRecordAccess: {},
    quarantineAccess: {},
    rangeAccess: {},
    alertAccess: {
      createNotification: jest.fn(async (input: { recipientAccountId: string }) => {
        calls.push('bell');
        return { id: `n-${input.recipientAccountId}` };
      }),
      recordDeliveryOutcome: jest.fn().mockResolvedValue(undefined),
    },
    alertEngine: {},
    accountAccess: {},
    permission: {},
    audit: { record: jest.fn() },
    pushSubscriptions: {
      listForAccounts: jest.fn().mockResolvedValue([]),
      removeStaleEndpoints: jest.fn().mockResolvedValue(undefined),
    },
    pushTransport: {
      deliver: jest.fn(async () => {
        calls.push('push');
        return { attempted: true, delivered: [], failed: [], stale: [] };
      }),
    },
    ...overrides,
  };
  const manager = new CareRecordManager(
    deps.tx as never,
    deps.careRecordAccess as never,
    deps.quarantineAccess as never,
    deps.rangeAccess as never,
    deps.alertAccess as never,
    deps.alertEngine as never,
    deps.accountAccess as never,
    deps.permission as never,
    deps.audit as never,
    deps.pushSubscriptions as never,
    deps.pushTransport as never,
  );
  return { manager, deps, calls };
}

const event = (over: Partial<AssignmentClosedEvent> = {}): AssignmentClosedEvent => ({
  requestId: 'req-1',
  patientId: 'pat-1',
  caregiverId: 'cg-1',
  reason: 'cancelled-by-caregiver',
  note: null,
  noShowReportedAt: null,
  recipientAccountIds: ['acc-fam'],
  ...over,
});

describe('KER-32 · campana por cierre de asignación activa (hiring.assignment.closed)', () => {
  it('Dado un cierre por el cuidador, cuando llega el evento, entonces la contraparte recibe la campana tipo `hiring` dentro de la transacción', async () => {
    const { manager, deps, calls } = makeManager();

    await manager.handleAssignmentClosed(event());

    const alertAccess = deps.alertAccess as { createNotification: jest.Mock };
    expect(alertAccess.createNotification).toHaveBeenCalledTimes(1);
    expect(alertAccess.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAccountId: 'acc-fam',
        patientId: 'pat-1',
        alertId: null,
        type: 'hiring',
        title: 'Asignación cancelada',
        body: expect.stringContaining('El cuidador canceló'),
      }),
      expect.anything(),
    );
    // La campana se persiste ANTES del commit (garantía §2.7).
    expect(calls).toEqual(['bell', 'commit']);
  });

  it('Dado un cierre por admin con nota, cuando llega el evento, entonces ambas partes reciben campana y la nota viaja en el cuerpo', async () => {
    const { manager, deps } = makeManager();

    await manager.handleAssignmentClosed(
      event({
        reason: 'cancelled-by-admin',
        note: 'Incumplimiento reportado',
        recipientAccountIds: ['acc-fam', 'acc-cg'],
      }),
    );

    const alertAccess = deps.alertAccess as { createNotification: jest.Mock };
    expect(alertAccess.createNotification).toHaveBeenCalledTimes(2);
    expect(alertAccess.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAccountId: 'acc-cg',
        body: expect.stringContaining('Motivo: Incumplimiento reportado'),
      }),
      expect.anything(),
    );
  });

  it('Dado un no-show, cuando llega el evento, entonces el cuidador recibe la campana de no-show', async () => {
    const { manager, deps } = makeManager();

    await manager.handleAssignmentClosed(
      event({ reason: 'no-show', recipientAccountIds: ['acc-cg'] }),
    );

    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientAccountId: 'acc-cg', title: 'No-show registrado' }),
      expect.anything(),
    );
  });

  it('Dado un evento sin destinatarios, cuando llega, entonces no abre transacción ni escribe nada', async () => {
    const { manager, deps } = makeManager();

    await manager.handleAssignmentClosed(event({ recipientAccountIds: [] }));

    expect((deps.tx as { run: jest.Mock }).run).not.toHaveBeenCalled();
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).not.toHaveBeenCalled();
  });

  it('Dado un push que falla, cuando llega el evento, entonces la campana ya quedó persistida (best-effort, NFR-09)', async () => {
    const { manager, deps } = makeManager({
      pushSubscriptions: {
        listForAccounts: jest.fn().mockRejectedValue(new Error('redis caído')),
        removeStaleEndpoints: jest.fn(),
      },
    });

    await expect(manager.handleAssignmentClosed(event())).resolves.toBeUndefined();
    expect((deps.alertAccess as { createNotification: jest.Mock }).createNotification).toHaveBeenCalled();
  });
});
