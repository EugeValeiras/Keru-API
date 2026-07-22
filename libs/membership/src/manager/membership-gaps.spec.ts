import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MembershipManager } from './membership.manager';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { RegisterCaregiverDto } from './dto/register-caregiver.dto';

/**
 * UC-22 criterios "la edición de la ficha queda reservada a consent-holder y manager (un viewer
 * solo lee)" y "toda edición queda auditada (quién, cuándo, qué campos)"; y
 * UC-02 A2 "la re-postulación solo es posible desde el estado rechazado; el perfil vuelve a
 * pendiente, se limpia el motivo de rechazo y las certificaciones vuelven a no verificada".
 */

const patient = (over: Record<string, unknown> = {}) => ({
  id: 'pat-1',
  fullName: 'Rosa Díaz',
  birthDate: '1948-03-10',
  photoUrl: null,
  mainCondition: 'Hipertensión',
  bloodGroup: '0+',
  allergies: ['Penicilina'],
  emergencyContact: { name: 'María Díaz', phone: '+54 11 5555-5555' },
  ...over,
});

const rejectedCaregiver = (over: Record<string, unknown> = {}) => ({
  id: 'cg-1',
  accountId: 'acc-cg',
  displayName: 'Laura Gómez',
  status: 'rejected',
  rejectionReason: 'Certificación ilegible',
  certifications: [{ type: 'Enfermería', institution: 'UBA', year: 2015, verified: false }],
  ...over,
});

const resubmitDto = (): RegisterCaregiverDto =>
  ({
    operationId: 'op-resubmit-1',
    displayName: 'Laura Gómez',
    specialties: ['elder-care'],
    certifications: [{ type: 'Enfermería', institution: 'UBA', year: 2015 }],
    availability: [{ dayOfWeek: 1, from: '08:00', to: '16:00' }],
    rates: { ratePerHour: 3500 },
    zone: 'Palermo, CABA',
    modalities: ['home'],
  }) as unknown as RegisterCaregiverDto;

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {
      findPatientById: jest.fn().mockResolvedValue(patient()),
      getLink: jest.fn().mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-1', role: 'manager' }),
      updatePatient: jest.fn().mockResolvedValue(undefined),
      listLinksForPatient: jest.fn().mockResolvedValue([]),
      findAccountsByIds: jest.fn().mockResolvedValue([]),
    },
    caregiverAccess: {
      findByAccountId: jest.fn().mockResolvedValue(rejectedCaregiver()),
      resubmitProfile: jest.fn().mockResolvedValue(undefined),
    },
    jwt: {},
    pubsub: {},
    audit: { record: jest.fn() },
    email: {},
    files: {},
    ...overrides,
  };
  const manager = new MembershipManager(
    deps.tx as never,
    deps.accountAccess as never,
    deps.caregiverAccess as never,
    deps.jwt as never,
    deps.pubsub as never,
    deps.audit as never,
    deps.email as never,
    deps.files as never,
  );
  return { manager, deps };
}

describe('UC-22 · editar la ficha del paciente (rol del vínculo)', () => {
  it('Dado un vínculo viewer, cuando intenta editar la ficha, entonces 403 y no se escribe nada', async () => {
    const { manager, deps } = makeManager();
    (deps.accountAccess as { getLink: jest.Mock }).getLink.mockResolvedValue({ role: 'viewer' });

    await expect(
      manager.updatePatient('pat-1', { fullName: 'Otra' } as UpdatePatientDto, 'acc-viewer'),
    ).rejects.toThrow(ForbiddenException);
    expect((deps.accountAccess as { updatePatient: jest.Mock }).updatePatient).not.toHaveBeenCalled();
    expect((deps.audit as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dado un vínculo manager, cuando edita, entonces se aplica el patch y el audit registra los campos tocados', async () => {
    const { manager, deps } = makeManager();
    const dto = { fullName: 'Rosa E. Díaz', allergies: ['Penicilina', 'Ibuprofeno'] } as UpdatePatientDto;

    const result = await manager.updatePatient('pat-1', dto, 'acc-1');

    expect((deps.accountAccess as { updatePatient: jest.Mock }).updatePatient).toHaveBeenCalledWith('pat-1', {
      fullName: 'Rosa E. Díaz',
      allergies: ['Penicilina', 'Ibuprofeno'],
    });
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.patient.updated',
        actor: 'acc-1',
        target: { type: 'patient', id: 'pat-1' },
        metadata: { fields: ['fullName', 'allergies'] },
      }),
    );
    expect(result.linkRole).toBe('manager');
  });
});

describe('UC-22 · círculo del paciente (GET /patients/:id/links)', () => {
  const circleLinks = [
    { patientId: 'pat-1', accountId: 'acc-2', role: 'viewer', createdAt: new Date('2026-02-01') },
    { patientId: 'pat-1', accountId: 'acc-1', role: 'consent-holder', createdAt: new Date('2026-01-01') },
  ];
  const circleAccounts = [
    { id: 'acc-1', displayName: 'María Díaz', email: 'maria@example.com' },
    { id: 'acc-2', displayName: 'Pedro Díaz', email: 'pedro@example.com' },
  ];

  it('Dado un vínculo viewer, cuando consulta el círculo, entonces ve cada cuenta (nombre/email) con su rol, ordenadas por antigüedad del vínculo', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['getLink'].mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-2', role: 'viewer' });
    access['listLinksForPatient'].mockResolvedValue(circleLinks);
    access['findAccountsByIds'].mockResolvedValue(circleAccounts);

    const circle = await manager.getPatientCircle('pat-1', 'acc-2');

    expect(access['findAccountsByIds']).toHaveBeenCalledWith(['acc-2', 'acc-1']);
    expect(circle).toEqual([
      {
        accountId: 'acc-1',
        displayName: 'María Díaz',
        email: 'maria@example.com',
        role: 'consent-holder',
        since: new Date('2026-01-01'),
      },
      {
        accountId: 'acc-2',
        displayName: 'Pedro Díaz',
        email: 'pedro@example.com',
        role: 'viewer',
        since: new Date('2026-02-01'),
      },
    ]);
  });

  it('Dada una cuenta sin vínculo, cuando consulta el círculo, entonces 403 y no se listan los vínculos', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['getLink'].mockResolvedValue(null);

    await expect(manager.getPatientCircle('pat-1', 'acc-intruso')).rejects.toThrow(ForbiddenException);
    expect(access['listLinksForPatient']).not.toHaveBeenCalled();
  });
});

describe('UC-02 A2 · re-postulación del cuidador rechazado', () => {
  it('Dado un perfil aprobado, cuando intenta re-enviarse, entonces 400 y no se escribe nada', async () => {
    const { manager, deps } = makeManager();
    (deps.caregiverAccess as { findByAccountId: jest.Mock }).findByAccountId.mockResolvedValue(
      rejectedCaregiver({ status: 'approved', rejectionReason: null }),
    );

    await expect(manager.resubmitCaregiver(resubmitDto(), 'acc-cg')).rejects.toThrow(BadRequestException);
    expect((deps.caregiverAccess as { resubmitProfile: jest.Mock }).resubmitProfile).not.toHaveBeenCalled();
  });

  it('Dado un perfil rechazado, cuando re-envía, entonces vuelve a pending sin motivo de rechazo, con certificaciones no verificadas y auditado', async () => {
    const { manager, deps } = makeManager();
    const caregiverAccess = deps.caregiverAccess as { findByAccountId: jest.Mock; resubmitProfile: jest.Mock };
    caregiverAccess.findByAccountId
      .mockResolvedValueOnce(rejectedCaregiver()) // precondición: está rechazado
      .mockResolvedValueOnce(rejectedCaregiver({ status: 'pending', rejectionReason: null })); // refetch post-verbo

    const result = await manager.resubmitCaregiver(resubmitDto(), 'acc-cg');

    expect(caregiverAccess.resubmitProfile).toHaveBeenCalledWith(
      'cg-1',
      expect.objectContaining({
        certifications: [{ type: 'Enfermería', institution: 'UBA', year: 2015, verified: false }],
      }),
    );
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.caregiver.resubmitted',
        actor: 'acc-cg',
        target: { type: 'caregiver', id: 'cg-1' },
      }),
    );
    expect(result.status).toBe('pending');
    expect(result.rejectionReason).toBeNull();
  });
});
