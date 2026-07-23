import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HiringManager } from './hiring.manager';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';

/**
 * UC-09 A2 · Cancelación por el solicitante: "solo el solicitante puede cancelar, y solo en
 * estado pendiente; la cancelación queda auditada" (estado terminal `cancelled`).
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
    status: 'pending',
    ratePerHourSnapshot: '3500.00',
    ...over,
  }) as unknown as HiringRequest;

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: {},
    matching: {},
    hiringAccess: {
      findRequestById: jest.fn().mockResolvedValue(request()),
      setRequestStatus: jest.fn().mockResolvedValue(undefined),
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

describe('UC-09 A2 · cancelar solicitud pendiente', () => {
  it('Dada una solicitud ajena, cuando otra cuenta intenta cancelarla, entonces 403 y el estado no cambia', async () => {
    const { manager, deps } = makeManager();

    await expect(manager.cancelRequest('req-1', 'acc-otro')).rejects.toThrow(ForbiddenException);
    expect((deps.hiringAccess as { setRequestStatus: jest.Mock }).setRequestStatus).not.toHaveBeenCalled();
  });

  it('Dada una solicitud aceptada, cuando el solicitante intenta cancelarla, entonces 400 (solo pendiente se cancela)', async () => {
    const { manager, deps } = makeManager();
    (deps.hiringAccess as { findRequestById: jest.Mock }).findRequestById.mockResolvedValue(
      request({ status: 'accepted' }),
    );

    await expect(manager.cancelRequest('req-1', 'acc-fam')).rejects.toThrow(BadRequestException);
    expect((deps.hiringAccess as { setRequestStatus: jest.Mock }).setRequestStatus).not.toHaveBeenCalled();
  });

  it('Dada una solicitud pendiente, cuando el solicitante cancela, entonces pasa a cancelled y queda auditado', async () => {
    const { manager, deps } = makeManager();
    const hiringAccess = deps.hiringAccess as { findRequestById: jest.Mock; setRequestStatus: jest.Mock };
    hiringAccess.findRequestById
      .mockResolvedValueOnce(request()) // precondición: pendiente
      .mockResolvedValueOnce(request({ status: 'cancelled', decidedAt: new Date() })); // refetch post-transición

    const result = await manager.cancelRequest('req-1', 'acc-fam');

    expect(hiringAccess.setRequestStatus).toHaveBeenCalledWith('req-1', 'cancelled', expect.any(Date));
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hiring.request.cancelled',
        actor: 'acc-fam',
        target: { type: 'hiring_request', id: 'req-1' },
      }),
    );
    expect(result.status).toBe('cancelled');
  });
});
