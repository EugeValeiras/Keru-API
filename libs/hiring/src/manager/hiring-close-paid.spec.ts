import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HiringManager } from './hiring.manager';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';

/**
 * KER-31 (Decouple row 49, NFR-10/58): el cierre del servicio registra la razón terminal
 * `completed` sin acoplarse al pago; "pagado" es una declaración opcional posterior al
 * cierre (honor-mark), set-una-sola-vez, que no condiciona nada.
 */

const request = (over: Partial<HiringRequest> = {}): HiringRequest =>
  ({
    id: 'req-1',
    patientId: 'pat-1',
    requesterAccountId: 'acc-fam',
    caregiverId: 'cg-1',
    modality: 'home',
    startDate: new Date('2026-08-01T08:00:00Z'),
    endDate: new Date('2026-08-15T18:00:00Z'),
    specialRequirements: null,
    contactData: { phone: '+54 11 5555-5555' },
    status: 'accepted',
    ratePerHourSnapshot: '3500.00',
    terminalReason: null,
    paidDeclaredAt: null,
    ...over,
  }) as unknown as HiringRequest;

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => fn({})) },
    matching: {},
    hiringAccess: {
      findRequestById: jest.fn().mockResolvedValue(request()),
      closeRequest: jest.fn().mockResolvedValue(undefined),
      declareRequestPaid: jest.fn().mockResolvedValue(true),
      setAssignmentsHistoricalForRequest: jest.fn().mockResolvedValue(undefined),
    },
    favoriteAccess: {},
    caregiverAccess: {},
    accountAccess: {},
    audit: { record: jest.fn() },
    pubsub: { publish: jest.fn().mockResolvedValue({ id: 'evt-1' }), enqueue: jest.fn() },
    reputation: {},
    ...overrides,
  };
  const manager = new HiringManager(
    deps.tx as never,
    deps.matching as never,
    deps.hiringAccess as never,
    deps.favoriteAccess as never,
    deps.caregiverAccess as never,
    deps.accountAccess as never,
    deps.audit as never,
    deps.pubsub as never,
    deps.reputation as never,
  );
  return { manager, deps };
}

type HiringAccessMock = {
  findRequestById: jest.Mock;
  closeRequest: jest.Mock;
  declareRequestPaid: jest.Mock;
  setAssignmentsHistoricalForRequest: jest.Mock;
};

describe('UC-09 · completar el servicio (cierre con razón terminal)', () => {
  it('Dada una solicitud ajena, cuando otra cuenta intenta completarla, entonces 403 y no hay cierre', async () => {
    const { manager, deps } = makeManager();

    await expect(manager.completeRequest('req-1', 'acc-otro')).rejects.toThrow(ForbiddenException);
    expect((deps.hiringAccess as HiringAccessMock).closeRequest).not.toHaveBeenCalled();
  });

  it('Dada una solicitud pendiente, cuando el solicitante intenta completarla, entonces 400 (solo aceptada/en curso)', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).findRequestById.mockResolvedValue(
      request({ status: 'pending' }),
    );

    await expect(manager.completeRequest('req-1', 'acc-fam')).rejects.toThrow(BadRequestException);
    expect((deps.hiringAccess as HiringAccessMock).closeRequest).not.toHaveBeenCalled();
  });

  it('Dada una solicitud aceptada, cuando el solicitante completa, entonces cierra con razón terminal `completed` y queda auditado', async () => {
    const { manager, deps } = makeManager();
    const hiringAccess = deps.hiringAccess as HiringAccessMock;
    hiringAccess.findRequestById
      .mockResolvedValueOnce(request()) // precondición: aceptada
      .mockResolvedValueOnce(
        request({ status: 'completed', terminalReason: 'completed', decidedAt: new Date() }),
      );

    const result = await manager.completeRequest('req-1', 'acc-fam');

    expect(hiringAccess.closeRequest).toHaveBeenCalledWith(
      'req-1',
      'completed',
      expect.any(Date),
      expect.anything(),
    );
    expect(hiringAccess.setAssignmentsHistoricalForRequest).toHaveBeenCalledWith('req-1', expect.anything());
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hiring.request.completed',
        actor: 'acc-fam',
        metadata: { terminalReason: 'completed' },
      }),
    );
    expect(result.status).toBe('completed');
    expect(result.terminalReason).toBe('completed');
    // El cierre no toca el pago (Decouple row 49).
    expect(result.paidDeclaredAt).toBeNull();
    expect(hiringAccess.declareRequestPaid).not.toHaveBeenCalled();
  });
});

describe('UC-09 (OQ-1) · declarar pagado (honor-mark opcional post-cierre)', () => {
  it('Dado un servicio no cerrado, cuando el solicitante declara el pago, entonces 400 (el pago es post-cierre)', async () => {
    const { manager, deps } = makeManager();

    await expect(manager.declarePaid('req-1', 'acc-fam')).rejects.toThrow(BadRequestException);
    expect((deps.hiringAccess as HiringAccessMock).declareRequestPaid).not.toHaveBeenCalled();
  });

  it('Dado un servicio cerrado ajeno, cuando otra cuenta declara el pago, entonces 403', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).findRequestById.mockResolvedValue(
      request({ status: 'completed', terminalReason: 'completed' }),
    );

    await expect(manager.declarePaid('req-1', 'acc-otro')).rejects.toThrow(ForbiddenException);
    expect((deps.hiringAccess as HiringAccessMock).declareRequestPaid).not.toHaveBeenCalled();
  });

  it('Dado un servicio cerrado, cuando el solicitante declara el pago, entonces se registra el honor-mark y queda auditado', async () => {
    const { manager, deps } = makeManager();
    const hiringAccess = deps.hiringAccess as HiringAccessMock;
    const paidAt = new Date('2026-08-16T10:00:00Z');
    hiringAccess.findRequestById
      .mockResolvedValueOnce(request({ status: 'completed', terminalReason: 'completed' }))
      .mockResolvedValueOnce(
        request({ status: 'completed', terminalReason: 'completed', paidDeclaredAt: paidAt }),
      );

    const result = await manager.declarePaid('req-1', 'acc-fam');

    expect(hiringAccess.declareRequestPaid).toHaveBeenCalledWith('req-1', expect.any(Date));
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hiring.request.paid-declared',
        actor: 'acc-fam',
        target: { type: 'hiring_request', id: 'req-1' },
      }),
    );
    // La declaración no altera el cierre.
    expect(result.status).toBe('completed');
    expect(result.paidDeclaredAt).toBe(paidAt);
  });

  it('Dado un pago ya declarado, cuando se re-declara, entonces es un no-op sin nueva auditoría (set-una-sola-vez)', async () => {
    const { manager, deps } = makeManager();
    const hiringAccess = deps.hiringAccess as HiringAccessMock;
    const paidAt = new Date('2026-08-16T10:00:00Z');
    hiringAccess.findRequestById.mockResolvedValue(
      request({ status: 'completed', terminalReason: 'completed', paidDeclaredAt: paidAt }),
    );
    hiringAccess.declareRequestPaid.mockResolvedValue(false); // precondición IS NULL no matchea

    const result = await manager.declarePaid('req-1', 'acc-fam');

    expect((deps.audit as { record: jest.Mock }).record).not.toHaveBeenCalled();
    expect(result.paidDeclaredAt).toBe(paidAt);
  });
});
