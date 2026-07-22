import { HiringManager } from './hiring.manager';
import { RequestResponseDto } from './dto/hiring-responses.dto';
import { HiringRequest } from '../resource-access/entities/hiring-request.entity';

/**
 * UC-06 criterio 3 ("la reputación es visible ya desde el listado") y
 * UC-10 flujo 1 + criterio de contacto ("el cuidador ve paciente, fechas,
 * modalidad y requerimientos; el contacto solo con solicitud aceptada/en curso").
 */

const caregiver = (id: string, displayName = `Cuidador ${id}`) =>
  ({
    id,
    displayName,
    specialties: ['elder-care'],
    zone: 'Palermo',
    modalities: ['home'],
    rates: { ratePerHour: 3500, currency: 'ARS' },
    badges: {},
    status: 'approved',
  }) as never;

const request = (over: Partial<HiringRequest> = {}): HiringRequest =>
  ({
    id: 'req-1',
    patientId: 'pat-1',
    caregiverId: 'cg-1',
    modality: 'home',
    startDate: new Date('2026-08-01T08:00:00Z'),
    endDate: new Date('2026-08-15T18:00:00Z'),
    specialRequirements: 'Movilidad reducida',
    contactData: { phone: '+54 11 5555-5555' },
    status: 'pending',
    ratePerHourSnapshot: '3500.00',
    ...over,
  }) as unknown as HiringRequest;

function makeManager(overrides: Record<string, unknown> = {}): HiringManager {
  const deps = {
    tx: {},
    matching: { match: jest.fn().mockResolvedValue([caregiver('cg-1'), caregiver('cg-2')]) },
    hiringAccess: {
      listRequestsForCaregiver: jest.fn().mockResolvedValue([request()]),
      listRequestsForRequester: jest.fn().mockResolvedValue([request()]),
    },
    favoriteAccess: { listCaregiverIds: jest.fn().mockResolvedValue(['cg-2']) },
    caregiverAccess: {
      findById: jest.fn().mockResolvedValue(caregiver('cg-1', 'Laura Gómez')),
      findByAccountId: jest.fn().mockResolvedValue(caregiver('cg-1')),
    },
    accountAccess: {
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', fullName: 'Rosa Díaz' }),
    },
    audit: { log: jest.fn() },
    reputation: {
      aggregatesFor: jest.fn().mockResolvedValue({ 'cg-1': { average: 4.5, count: 2 } }),
    },
    ...overrides,
  };
  return new HiringManager(
    deps.tx as never,
    deps.matching as never,
    deps.hiringAccess as never,
    deps.favoriteAccess as never,
    deps.caregiverAccess as never,
    deps.accountAccess as never,
    deps.audit as never,
    deps.reputation as never,
  );
}

describe('UC-06 · rating en cards del listado', () => {
  it('Dado cuidadores con reseñas reveladas, cuando busco, entonces cada card trae average y count', async () => {
    const manager = makeManager();
    const results = await manager.search({}, 'acc-1');

    const withReviews = results.find((r) => r.caregiver.id === 'cg-1');
    expect(withReviews?.rating).toEqual({ average: 4.5, count: 2 });
  });

  it('Dado un cuidador sin reseñas, cuando busco, entonces su rating es {0, 0} (no undefined)', async () => {
    const manager = makeManager();
    const results = await manager.search({}, 'acc-1');

    const without = results.find((r) => r.caregiver.id === 'cg-2');
    expect(without?.rating).toEqual({ average: 0, count: 0 });
  });
});

describe('UC-10 · bandeja del cuidador con nombre del paciente y contacto restringido', () => {
  it('Dada una solicitud pendiente, cuando el cuidador la lista, entonces ve el nombre del paciente', async () => {
    const manager = makeManager();
    const items = await manager.listRequestsForCaregiverAccount('acc-cg');

    expect(items[0].patientName).toBe('Rosa Díaz');
  });

  it('Dada una solicitud pendiente, el DTO para el cuidador expone requerimientos pero NO el contacto', () => {
    const dto = RequestResponseDto.from(request(), { viewer: 'caregiver', patientName: 'Rosa Díaz' });

    expect(dto.patientName).toBe('Rosa Díaz');
    expect(dto.specialRequirements).toBe('Movilidad reducida');
    expect(dto.contactData).toBeUndefined();
  });

  it.each(['accepted', 'in-progress'] as const)(
    'Dada una solicitud %s, el DTO para el cuidador SÍ expone el contacto (coordinación post-aceptación)',
    (status) => {
      const dto = RequestResponseDto.from({ ...request(), status }, { viewer: 'caregiver' });

      expect(dto.contactData).toEqual({ phone: '+54 11 5555-5555' });
    },
  );

  it('El solicitante siempre ve su propio contacto y el nombre del cuidador', async () => {
    const manager = makeManager();
    const items = await manager.listMyRequests('acc-fam');
    const dto = RequestResponseDto.from(items[0].request, {
      viewer: 'requester',
      caregiverName: items[0].caregiverName,
    });

    expect(dto.caregiverName).toBe('Laura Gómez');
    expect(dto.contactData).toEqual({ phone: '+54 11 5555-5555' });
  });
});
