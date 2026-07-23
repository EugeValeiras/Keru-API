import { HiringManager } from './hiring.manager';
import { CaregiverCardDto, RequestResponseDto } from './dto/hiring-responses.dto';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';
import { CreateRequestDto } from './dto/create-request.dto';

/**
 * NFR-03/23 · Términos pinneados (KER-3 / UC-02 A3): la solicitud fija la tarifa al momento de
 * solicitar; un cambio de tarifa posterior del cuidador NO toca las solicitudes existentes,
 * mientras el marketplace muestra la tarifa vigente.
 */

const caregiver = (ratePerHour: number) =>
  ({
    id: 'cg-1',
    displayName: 'Laura Gómez',
    specialties: ['elder-care'],
    zone: 'Palermo',
    modalities: ['home'],
    rates: { ratePerHour, currency: 'ARS' },
    badges: {},
    status: 'approved',
  }) as never;

const oldRequest = (over: Partial<HiringRequest> = {}): HiringRequest =>
  ({
    id: 'req-1',
    patientId: 'pat-1',
    caregiverId: 'cg-1',
    modality: 'home',
    startDate: new Date('2026-08-01T08:00:00Z'),
    endDate: new Date('2026-08-15T18:00:00Z'),
    specialRequirements: null,
    contactData: { phone: '+54 11 5555-5555' },
    status: 'pending',
    // Pinneada cuando la tarifa era 3500; el cuidador ahora cobra 5000.
    ratePerHourSnapshot: '3500.00',
    currencySnapshot: 'ARS',
    ...over,
  }) as unknown as HiringRequest;

function makeManager(currentRate: number) {
  const deps = {
    tx: {},
    matching: { match: jest.fn().mockResolvedValue([caregiver(currentRate)]) },
    hiringAccess: {
      submitRequest: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({
        id: 'req-new',
        ...input,
      })),
      listRequestsForCaregiver: jest.fn().mockResolvedValue([oldRequest()]),
      listRequestsForRequester: jest.fn().mockResolvedValue([oldRequest()]),
    },
    favoriteAccess: { listCaregiverIds: jest.fn().mockResolvedValue([]) },
    caregiverAccess: {
      findById: jest.fn().mockResolvedValue(caregiver(currentRate)),
      findByAccountId: jest.fn().mockResolvedValue(caregiver(currentRate)),
    },
    accountAccess: {
      getLink: jest.fn().mockResolvedValue({ role: 'consent-holder' }),
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', fullName: 'Rosa Díaz' }),
    },
    audit: { record: jest.fn() },
    pubsub: { publish: jest.fn().mockResolvedValue({ id: 'evt-1' }), enqueue: jest.fn() },
    reputation: {
      aggregatesFor: jest.fn().mockResolvedValue({}),
      myReviewsFor: jest.fn().mockResolvedValue({}),
    },
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

const createDto = (): CreateRequestDto =>
  ({
    operationId: 'op-req-1',
    patientId: 'pat-1',
    caregiverId: 'cg-1',
    modality: 'home',
    startDate: '2026-09-01T08:00:00Z',
    endDate: '2026-09-15T18:00:00Z',
    contactData: { phone: '+54 11 5555-5555' },
  }) as unknown as CreateRequestDto;

describe('NFR-03/23 · tarifas efectivo-fechadas con solicitudes pinneadas', () => {
  it('Dado un cuidador con tarifa vigente, cuando se crea una solicitud, entonces pinnea esa tarifa como snapshot', async () => {
    const { manager, deps } = makeManager(5000);

    await manager.createRequest(createDto(), 'acc-fam');

    expect(deps.hiringAccess.submitRequest).toHaveBeenCalledWith(
      expect.objectContaining({ ratePerHourSnapshot: '5000', currencySnapshot: 'ARS' }),
      'op-req-1',
    );
  });

  it('Dada una solicitud vieja pinneada a 3500, cuando el cuidador ya cobra 5000, entonces la solicitud conserva su snapshot', async () => {
    const { manager } = makeManager(5000);

    const items = await manager.listRequestsForCaregiverAccount('acc-cg');
    const dto = RequestResponseDto.from(items[0].request, { viewer: 'caregiver' });

    expect(dto.ratePerHourSnapshot).toBe('3500.00'); // los términos del pedido no se reescriben
  });

  it('Dado el mismo cambio de tarifa, cuando se busca en el marketplace, entonces la card muestra la vigente (5000), no la pinneada', async () => {
    const { manager } = makeManager(5000);

    const results = await manager.search({}, 'acc-fam');
    const card = CaregiverCardDto.from(results[0].caregiver, results[0].isFavorite, results[0].rating);

    expect(card.ratePerHour).toBe(5000);
  });
});
