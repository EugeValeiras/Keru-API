import { BadRequestException } from '@nestjs/common';
import { MembershipManager } from './membership.manager';
import { UpdateCaregiverProfileDto } from './dto/update-caregiver-profile.dto';

/**
 * UC-02 A3 · Edición del perfil aprobado (KER-3, NFR-03/23): un aprobado edita foto,
 * disponibilidad, tarifas, zona y modalidades sin re-aprobación; la tarifa es efectivo-fechada
 * (cada cambio agrega una versión, nunca se reescribe la historia); credenciales no se editan
 * por esta vía; toda edición queda auditada.
 */

const approvedCaregiver = (over: Record<string, unknown> = {}) => ({
  id: 'cg-1',
  accountId: 'acc-cg',
  displayName: 'Laura Gómez',
  status: 'approved',
  rejectionReason: null,
  specialties: ['elder-care'],
  certifications: [{ type: 'Enfermería', institution: 'UBA', year: 2015, verified: true }],
  availability: [{ dayOfWeek: 1, from: '08:00', to: '16:00' }],
  rates: { ratePerHour: 3500, currency: 'ARS' },
  zone: 'Palermo, CABA',
  modalities: ['home'],
  ...over,
});

const editDto = (over: Record<string, unknown> = {}): UpdateCaregiverProfileDto =>
  ({ operationId: 'op-edit-1', ...over }) as unknown as UpdateCaregiverProfileDto;

function makeManager(caregiver: Record<string, unknown> = approvedCaregiver()) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {},
    caregiverAccess: {
      findByAccountId: jest.fn().mockResolvedValue(caregiver),
      updateApprovedProfile: jest.fn().mockResolvedValue(undefined),
      createRateVersion: jest.fn().mockResolvedValue({ id: 'rv-1' }),
    },
    jwt: {},
    pubsub: {},
    audit: { record: jest.fn() },
    email: {},
    files: {},
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

describe('UC-02 A3 · edición del perfil aprobado sin re-aprobación', () => {
  it.each(['pending', 'rejected', 'deactivated'] as const)(
    'Dado un perfil %s, cuando intenta editar, entonces 400 y no se escribe nada',
    async (status) => {
      const { manager, deps } = makeManager(approvedCaregiver({ status }));

      await expect(manager.updateApprovedCaregiver(editDto({ zone: 'Belgrano' }), 'acc-cg')).rejects.toThrow(
        BadRequestException,
      );
      expect(deps.caregiverAccess.updateApprovedProfile).not.toHaveBeenCalled();
      expect(deps.caregiverAccess.createRateVersion).not.toHaveBeenCalled();
      expect(deps.audit.record).not.toHaveBeenCalled();
    },
  );

  it('Dado un perfil aprobado, cuando edita zona/disponibilidad/foto, entonces el patch es parcial, no toca el status y el audit registra los campos', async () => {
    const { manager, deps } = makeManager();
    const availability = [{ dayOfWeek: 3, from: '10:00', to: '18:00' }];

    await manager.updateApprovedCaregiver(
      editDto({ zone: 'Belgrano, CABA', availability, photoUrl: 'http://x/foto.jpg' }),
      'acc-cg',
    );

    expect(deps.caregiverAccess.updateApprovedProfile).toHaveBeenCalledWith(
      'cg-1',
      { zone: 'Belgrano, CABA', availability, photoUrl: 'http://x/foto.jpg' },
      expect.anything(),
    );
    const patch = deps.caregiverAccess.updateApprovedProfile.mock.calls[0][1];
    expect(patch).not.toHaveProperty('status'); // sigue aprobado: sin re-aprobación
    expect(deps.caregiverAccess.createRateVersion).not.toHaveBeenCalled(); // la tarifa no cambió
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.caregiver.profile-updated',
        actor: 'acc-cg',
        metadata: { fields: ['photoUrl', 'availability', 'zone'] },
      }),
    );
  });

  it('Dado un cambio de tarifa, entonces se agrega una versión efectivo-fechada (append, con operationId) y se actualiza la vigente', async () => {
    const { manager, deps } = makeManager();

    await manager.updateApprovedCaregiver(editDto({ rates: { ratePerHour: 5000 } }), 'acc-cg');

    // NFR-03/23: la historia no se reescribe — se agrega una versión con su vigencia...
    expect(deps.caregiverAccess.createRateVersion).toHaveBeenCalledWith(
      'cg-1',
      { ratePerHour: 5000, currency: 'ARS', description: undefined }, // moneda heredada de la vigente
      expect.any(Date),
      'op-edit-1',
      expect.anything(),
    );
    // ...y la vigente (la que lee el marketplace) se actualiza en la misma transacción.
    expect(deps.caregiverAccess.updateApprovedProfile).toHaveBeenCalledWith(
      'cg-1',
      { rates: { ratePerHour: 5000, currency: 'ARS', description: undefined } },
      expect.anything(),
    );
    expect(deps.tx.run).toHaveBeenCalled();
  });

  it('Dado un intento de editar credenciales (nombre/especialidades/certificaciones), entonces se ignoran: el patch solo lleva campos editables', async () => {
    const { manager, deps } = makeManager();

    await manager.updateApprovedCaregiver(
      editDto({
        zone: 'Belgrano',
        displayName: 'Otra Persona',
        specialties: ['pediatric'],
        certifications: [{ type: 'Falsa', institution: 'X', year: 2020 }],
      }),
      'acc-cg',
    );

    expect(deps.caregiverAccess.updateApprovedProfile).toHaveBeenCalledWith(
      'cg-1',
      { zone: 'Belgrano' },
      expect.anything(),
    );
  });

  it('Dado un patch vacío, entonces no se escribe ni audita nada y devuelve el perfil tal cual', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.updateApprovedCaregiver(editDto(), 'acc-cg');

    expect(result.status).toBe('approved');
    expect(deps.caregiverAccess.updateApprovedProfile).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });
});
