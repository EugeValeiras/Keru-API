import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HiringManager } from './hiring.manager';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';

/**
 * KER-32 (UC-16 A2, NFR-15/21/23): rehire urgente — re-solicitud dirigida a un cuidador que ya
 * atendió al paciente, sin re-búsqueda. Re-pinnea la tarifa VIGENTE y devuelve la pinneada de
 * la última contratación previa para el diff a la vista.
 */

const priorAssignment = (over: Record<string, unknown> = {}) => ({
  id: 'asg-1',
  caregiverId: 'cg-1',
  patientId: 'pat-1',
  requestId: 'req-old',
  status: 'historical',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
});

const priorRequest = {
  id: 'req-old',
  ratePerHourSnapshot: '3500.00',
  currencySnapshot: 'ARS',
} as unknown as HiringRequest;

const rehireDto = {
  operationId: 'op-rehire-1',
  patientId: 'pat-1',
  caregiverId: 'cg-1',
  modality: 'home',
  startDate: '2026-08-20T08:00:00Z',
  endDate: '2026-08-25T18:00:00Z',
  contactData: { phone: '+54 11 5555-5555' },
};

function makeManager(currentRate = 5000, overrides: Record<string, unknown> = {}) {
  const submitted = {
    id: 'req-new',
    patientId: 'pat-1',
    caregiverId: 'cg-1',
    status: 'pending',
    ratePerHourSnapshot: String(currentRate),
    currencySnapshot: 'ARS',
  } as unknown as HiringRequest;
  const deps = {
    tx: {},
    matching: {},
    hiringAccess: {
      listAssignmentsForPatient: jest.fn().mockResolvedValue([priorAssignment()]),
      findRequestById: jest.fn().mockResolvedValue(priorRequest),
      submitRequest: jest.fn().mockResolvedValue(submitted),
    },
    favoriteAccess: {},
    caregiverAccess: {
      findById: jest.fn().mockResolvedValue({
        id: 'cg-1',
        accountId: 'acc-cg',
        status: 'approved',
        rates: { ratePerHour: currentRate, currency: 'ARS' },
      }),
    },
    accountAccess: { getLink: jest.fn().mockResolvedValue({ role: 'consent-holder' }) },
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
  listAssignmentsForPatient: jest.Mock;
  findRequestById: jest.Mock;
  submitRequest: jest.Mock;
};

describe('UC-16 A2 · rehire urgente hacia un cuidador previo (KER-32)', () => {
  it('Dado un cuidador que ya atendió al paciente, cuando se pide el rehire, entonces re-pinnea la tarifa vigente y devuelve la anterior para el diff', async () => {
    const { manager, deps } = makeManager(5000);

    const result = await manager.createRehireRequest(rehireDto, 'acc-fam');

    // Re-pinneo de términos vigentes (NFR-03/21): el snapshot nuevo es la tarifa actual.
    expect((deps.hiringAccess as HiringAccessMock).submitRequest).toHaveBeenCalledWith(
      expect.objectContaining({ ratePerHourSnapshot: '5000', currencySnapshot: 'ARS' }),
      'op-rehire-1',
    );
    // Diff mínimo (NFR-23): tarifa pinneada de la última contratación previa vs la vigente.
    expect(result.previousRatePerHour).toBe('3500.00');
    expect(result.request.ratePerHourSnapshot).toBe('5000');
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hiring.request.rehire-created',
        actor: 'acc-fam',
        metadata: expect.objectContaining({ previousRatePerHour: '3500.00' }),
      }),
    );
  });

  it('Dado un cuidador SIN contratación previa con el paciente, cuando se pide el rehire, entonces 400 (la vía urgente no aplica)', async () => {
    const { manager, deps } = makeManager(5000);
    (deps.hiringAccess as HiringAccessMock).listAssignmentsForPatient.mockResolvedValue([
      priorAssignment({ caregiverId: 'cg-otro' }),
    ]);

    await expect(manager.createRehireRequest(rehireDto, 'acc-fam')).rejects.toThrow(
      BadRequestException,
    );
    expect((deps.hiringAccess as HiringAccessMock).submitRequest).not.toHaveBeenCalled();
  });

  it('Dado un usuario no vinculado al paciente, cuando pide el rehire, entonces 403', async () => {
    const { manager, deps } = makeManager(5000, {
      accountAccess: { getLink: jest.fn().mockResolvedValue(null) },
    });

    await expect(manager.createRehireRequest(rehireDto, 'acc-intruso')).rejects.toThrow(
      ForbiddenException,
    );
    expect((deps.hiringAccess as HiringAccessMock).submitRequest).not.toHaveBeenCalled();
  });

  it('Dada una asignación previa manual sin solicitud (provenance admin), cuando se pide el rehire, entonces el diff usa la tarifa vigente como anterior (sin snapshot previo)', async () => {
    const { manager, deps } = makeManager(5000);
    (deps.hiringAccess as HiringAccessMock).listAssignmentsForPatient.mockResolvedValue([
      priorAssignment({ requestId: null }),
    ]);

    const result = await manager.createRehireRequest(rehireDto, 'acc-fam');

    expect(result.previousRatePerHour).toBe('5000');
    expect(result.request.ratePerHourSnapshot).toBe('5000');
  });
});
