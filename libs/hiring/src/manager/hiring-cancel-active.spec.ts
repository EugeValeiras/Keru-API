import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HiringManager } from './hiring.manager';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';

/**
 * KER-32 (UC-09 A3/A4, NFR-15, stressor #27): cancelación de la asignación ACTIVA por
 * requester/cuidador/admin con razón terminal estructurada + audit + campana a la contraparte
 * (evento outbox `hiring.assignment.closed`), y no-show registrable por el solicitante con
 * timestamp. Verbos mutantes con operationId (NFR-34); at-most-once por precondición SQL.
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
    noShowReportedAt: null,
    paidDeclaredAt: null,
    ...over,
  }) as unknown as HiringRequest;

const caregiver = { id: 'cg-1', accountId: 'acc-cg', status: 'approved' };

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => fn({})) },
    matching: {},
    hiringAccess: {
      findRequestById: jest.fn().mockResolvedValue(request()),
      closeActiveRequest: jest.fn().mockResolvedValue(true),
      setAssignmentsHistoricalForRequest: jest.fn().mockResolvedValue(undefined),
    },
    favoriteAccess: {},
    caregiverAccess: {
      findById: jest.fn().mockResolvedValue(caregiver),
      findByAccountId: jest.fn().mockResolvedValue(caregiver),
    },
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
  closeActiveRequest: jest.Mock;
  setAssignmentsHistoricalForRequest: jest.Mock;
};
type PubSubMock = { publish: jest.Mock; enqueue: jest.Mock };

const dto = { operationId: 'op-cancel-1', note: 'Viaje imprevisto' };

describe('UC-09 A3 · cancelación de la asignación activa (KER-32)', () => {
  it('Dada una asignación activa, cuando el solicitante cancela, entonces cierra con `cancelled-by-requester`, audita y publica el evento con campana al cuidador', async () => {
    const { manager, deps } = makeManager();
    const hiringAccess = deps.hiringAccess as HiringAccessMock;
    hiringAccess.findRequestById
      .mockResolvedValueOnce(request()) // precondición: activa
      .mockResolvedValueOnce(
        request({ status: 'completed', terminalReason: 'cancelled-by-requester', decidedAt: new Date() }),
      );

    const result = await manager.cancelActiveByRequester('req-1', 'acc-fam', dto);

    expect(hiringAccess.closeActiveRequest).toHaveBeenCalledWith(
      'req-1',
      'cancelled-by-requester',
      expect.any(Date),
      null,
      expect.anything(),
    );
    expect(hiringAccess.setAssignmentsHistoricalForRequest).toHaveBeenCalledWith('req-1', expect.anything());
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hiring.assignment.cancelled-by-requester',
        actor: 'acc-fam',
        target: { type: 'hiring_request', id: 'req-1' },
        metadata: expect.objectContaining({
          terminalReason: 'cancelled-by-requester',
          operationId: 'op-cancel-1',
          note: 'Viaje imprevisto',
        }),
      }),
    );
    const pubsub = deps.pubsub as PubSubMock;
    expect(pubsub.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'hiring.assignment.closed',
        operationId: 'op-cancel-1',
        payload: expect.objectContaining({
          requestId: 'req-1',
          reason: 'cancelled-by-requester',
          recipientAccountIds: ['acc-cg'], // la contraparte: el cuidador
        }),
      }),
    );
    // El dispatch se encola DESPUÉS del commit (patrón outbox).
    expect(pubsub.enqueue).toHaveBeenCalledWith({ id: 'evt-1' });
    expect(result.terminalReason).toBe('cancelled-by-requester');
  });

  it('Dada una asignación activa, cuando el cuidador cancela, entonces la razón es `cancelled-by-caregiver` y la campana va al solicitante', async () => {
    const { manager, deps } = makeManager();

    await manager.cancelActiveByCaregiver('req-1', 'acc-cg', dto);

    expect((deps.hiringAccess as HiringAccessMock).closeActiveRequest).toHaveBeenCalledWith(
      'req-1',
      'cancelled-by-caregiver',
      expect.any(Date),
      null,
      expect.anything(),
    );
    expect((deps.pubsub as PubSubMock).publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ recipientAccountIds: ['acc-fam'] }),
      }),
    );
  });

  it('Dada una asignación activa, cuando un admin cancela, entonces la razón es `cancelled-by-admin` y la campana va a ambas partes', async () => {
    const { manager, deps } = makeManager();

    await manager.cancelActiveByAdmin('req-1', 'acc-admin', dto);

    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hiring.assignment.cancelled-by-admin', actor: 'acc-admin' }),
    );
    expect((deps.pubsub as PubSubMock).publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ recipientAccountIds: ['acc-fam', 'acc-cg'] }),
      }),
    );
  });

  it('Dada una asignación ajena, cuando otra cuenta intenta cancelarla como solicitante, entonces 403 y no hay cierre', async () => {
    const { manager, deps } = makeManager();

    await expect(manager.cancelActiveByRequester('req-1', 'acc-otro', dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect((deps.hiringAccess as HiringAccessMock).closeActiveRequest).not.toHaveBeenCalled();
  });

  it('Dada una asignación de otro cuidador, cuando un cuidador ajeno intenta cancelarla, entonces 403', async () => {
    const { manager, deps } = makeManager({
      caregiverAccess: {
        findById: jest.fn().mockResolvedValue(caregiver),
        findByAccountId: jest.fn().mockResolvedValue({ id: 'cg-otro', accountId: 'acc-cg-otro' }),
      },
    });

    await expect(manager.cancelActiveByCaregiver('req-1', 'acc-cg-otro', dto)).rejects.toThrow(
      ForbiddenException,
    );
    expect((deps.hiringAccess as HiringAccessMock).closeActiveRequest).not.toHaveBeenCalled();
  });

  it('Dada una solicitud pendiente (sin asignación), cuando se intenta cancelar la asignación, entonces 400', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).findRequestById.mockResolvedValue(
      request({ status: 'pending' }),
    );

    await expect(manager.cancelActiveByRequester('req-1', 'acc-fam', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect((deps.hiringAccess as HiringAccessMock).closeActiveRequest).not.toHaveBeenCalled();
  });

  it('Dada una carrera perdida (otro cierre ganó), cuando la precondición SQL no matchea, entonces 400 y no se publica evento', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as HiringAccessMock).closeActiveRequest.mockResolvedValue(false);

    await expect(manager.cancelActiveByRequester('req-1', 'acc-fam', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect((deps.pubsub as PubSubMock).publish).not.toHaveBeenCalled();
    expect((deps.pubsub as PubSubMock).enqueue).not.toHaveBeenCalled();
  });
});

describe('UC-09 A4 · no-show registrado por el solicitante (KER-32)', () => {
  it('Dada una asignación activa, cuando el solicitante registra el no-show con timestamp, entonces cierra con razón `no-show` y persiste el momento', async () => {
    const { manager, deps } = makeManager();
    const occurredAt = '2026-08-01T08:30:00Z';

    await manager.recordNoShow('req-1', 'acc-fam', {
      operationId: 'op-noshow-1',
      occurredAt,
      note: 'No llegó al turno',
    });

    expect((deps.hiringAccess as HiringAccessMock).closeActiveRequest).toHaveBeenCalledWith(
      'req-1',
      'no-show',
      expect.any(Date),
      new Date(occurredAt),
      expect.anything(),
    );
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hiring.request.no-show',
        metadata: expect.objectContaining({
          terminalReason: 'no-show',
          noShowReportedAt: new Date(occurredAt).toISOString(),
        }),
      }),
    );
    expect((deps.pubsub as PubSubMock).publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'no-show', recipientAccountIds: ['acc-cg'] }),
      }),
    );
  });

  it('Dado un no-show sin occurredAt, cuando se registra, entonces el timestamp es el del registro (default now)', async () => {
    const { manager, deps } = makeManager();
    const before = Date.now();

    await manager.recordNoShow('req-1', 'acc-fam', { operationId: 'op-noshow-2' });

    const noShowArg = (deps.hiringAccess as HiringAccessMock).closeActiveRequest.mock.calls[0][3] as Date;
    expect(noShowArg.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('Dado un tercero, cuando intenta registrar el no-show, entonces 403 (solo el solicitante)', async () => {
    const { manager, deps } = makeManager();

    await expect(
      manager.recordNoShow('req-1', 'acc-otro', { operationId: 'op-noshow-3' }),
    ).rejects.toThrow(ForbiddenException);
    expect((deps.hiringAccess as HiringAccessMock).closeActiveRequest).not.toHaveBeenCalled();
  });
});
