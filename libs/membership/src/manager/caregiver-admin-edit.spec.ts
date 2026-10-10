import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MembershipManager } from './membership.manager';
import { AdminUpdateCaregiverDto, AdminUpdateCertificationDto } from './dto/admin-caregiver.dto';

/**
 * #49 · UC-19 A3 · Edición de datos del cuidador por el ADMINISTRADOR: corrige identidad (nombre/foto,
 * que viven en la cuenta — ADR-0003) y perfil profesional (especialidades, certificaciones existentes,
 * disponibilidad, tarifas, zona, modalidades) en cualquier estado, sin tocar status/insignias/provenance,
 * con set parcial, tarifa efectivo-fechada (NFR-03/23) y auditoría (actor admin + campos).
 * El step-up (NFR-33) lo gatea el controller; acá se prueba la orquestación del Manager.
 */

const approvedCert = {
  id: 'cert-1',
  catalogKey: 'nursing-degree',
  institution: 'UBA',
  year: 2015,
  documentKey: 'private/documents/a.pdf',
  documentContentType: 'application/pdf',
  status: 'approved' as const,
  verified: true,
  reviewedBy: 'acc-admin',
  reviewedAt: '2026-07-01T00:00:00.000Z',
  rejectionReason: null,
};

const pendingCert = {
  ...approvedCert,
  id: 'cert-2',
  catalogKey: 'cpr',
  institution: 'Cruz Roja',
  year: 2021,
  status: 'pending' as const,
  verified: false,
  reviewedBy: null,
  reviewedAt: null,
};

const caregiverOf = (over: Record<string, unknown> = {}) => ({
  id: 'cg-1',
  accountId: 'acc-cg',
  displayName: 'Laura Gómez',
  photoUrl: null,
  status: 'approved',
  rejectionReason: null,
  reviewedBy: 'acc-admin',
  reviewedAt: new Date('2026-07-01T00:00:00.000Z'),
  specialties: ['elder-care'],
  certifications: [approvedCert, pendingCert],
  availability: [{ dayOfWeek: 1, from: '08:00', to: '16:00' }],
  rates: { ratePerHour: 3500, currency: 'ARS' },
  zone: 'Palermo, CABA',
  modalities: ['home'],
  badges: { certifications: true, identity: true, background: false },
  ...over,
});

const editDto = (over: Record<string, unknown> = {}): AdminUpdateCaregiverDto =>
  ({ operationId: 'op-admin-edit-1', ...over }) as unknown as AdminUpdateCaregiverDto;

function makeManager(caregiver: Record<string, unknown> = caregiverOf()) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({ em: true })) },
    accountAccess: { updateAccount: jest.fn().mockResolvedValue(undefined) },
    caregiverAccess: {
      findById: jest.fn().mockResolvedValue(caregiver),
      updateProfileByAdmin: jest.fn().mockResolvedValue(undefined),
      updateApprovedProfile: jest.fn().mockResolvedValue(undefined),
      createRateVersion: jest.fn().mockResolvedValue({ id: 'rv-1' }),
      setCertifications: jest.fn().mockResolvedValue(undefined),
      setBadges: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
    },
    catalogAccess: { list: jest.fn().mockResolvedValue([]) },
    jwt: {},
    pubsub: {},
    audit: { record: jest.fn() },
    email: {},
    files: { isUploadedImageUrl: jest.fn((url: string) => url.startsWith('/media/images/')) },
    tokenRevocation: { revoke: jest.fn(), isRevoked: jest.fn().mockResolvedValue(false) },
    config: { get: jest.fn((_k: string, d?: unknown) => d) },
    permission: { hasLinkRole: jest.fn().mockResolvedValue(true) },
  };
  const manager = new MembershipManager(
    deps.tx as never,
    deps.accountAccess as never,
    deps.caregiverAccess as never,
    deps.catalogAccess as never,
    deps.jwt as never,
    deps.pubsub as never,
    deps.audit as never,
    deps.email as never,
    deps.files as never,
    deps.tokenRevocation as never,
    deps.config as never,
    deps.permission as never,
  );
  return { manager, deps };
}

describe('#49 · UC-19 A3 · PATCH /admin/caregivers/:id (adminUpdateCaregiver)', () => {
  it.each(['pending', 'approved', 'rejected', 'deactivated'] as const)(
    'Dado un cuidador %s, cuando el admin edita la zona, entonces se escribe solo la zona (sin status) y se audita con actor admin',
    async (status) => {
      const { manager, deps } = makeManager(caregiverOf({ status }));

      await manager.adminUpdateCaregiver('cg-1', 'acc-admin', editDto({ zone: 'Belgrano, CABA' }));

      expect(deps.caregiverAccess.updateProfileByAdmin).toHaveBeenCalledWith(
        'cg-1',
        { zone: 'Belgrano, CABA' },
        expect.anything(),
      );
      const patch = deps.caregiverAccess.updateProfileByAdmin.mock.calls[0][1];
      expect(patch).not.toHaveProperty('status'); // el estado de aprobación no se toca
      expect(patch).not.toHaveProperty('badges');
      expect(deps.caregiverAccess.setStatus).not.toHaveBeenCalled();
      expect(deps.caregiverAccess.setBadges).not.toHaveBeenCalled();
      expect(deps.accountAccess.updateAccount).not.toHaveBeenCalled(); // sin identidad en el patch
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'membership.caregiver.admin-edited',
          actor: 'acc-admin',
          target: { type: 'caregiver', id: 'cg-1' },
          metadata: { fields: ['zone'] },
        }),
      );
    },
  );

  it('Dado nombre y foto válida, cuando el admin los edita, entonces se escribe la CUENTA del cuidador (ADR-0003) resuelta por accountId y no el perfil', async () => {
    const { manager, deps } = makeManager();

    await manager.adminUpdateCaregiver(
      'cg-1',
      'acc-admin',
      editDto({ displayName: 'Laura G. Pérez', photoUrl: '/media/images/nueva.jpg' }),
    );

    expect(deps.accountAccess.updateAccount).toHaveBeenCalledWith(
      'acc-cg',
      { displayName: 'Laura G. Pérez', photoUrl: '/media/images/nueva.jpg' },
      expect.anything(),
    );
    expect(deps.caregiverAccess.updateProfileByAdmin).not.toHaveBeenCalled(); // la identidad no vive en el perfil
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { fields: ['displayName', 'photoUrl'] } }),
    );
  });

  it('Dado photoUrl: null, cuando el admin la manda, entonces quita la foto de la cuenta', async () => {
    const { manager, deps } = makeManager();

    await manager.adminUpdateCaregiver('cg-1', 'acc-admin', editDto({ photoUrl: null }));

    expect(deps.accountAccess.updateAccount).toHaveBeenCalledWith('acc-cg', { photoUrl: null }, expect.anything());
  });

  it('Dada una foto fuera del patrón de POST /files/images, entonces 400 y no se escribe ni audita nada', async () => {
    const { manager, deps } = makeManager();

    await expect(
      manager.adminUpdateCaregiver('cg-1', 'acc-admin', editDto({ photoUrl: 'https://evil.example/x.png' })),
    ).rejects.toThrow(BadRequestException);

    expect(deps.files.isUploadedImageUrl).toHaveBeenCalledWith('https://evil.example/x.png');
    expect(deps.accountAccess.updateAccount).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.updateProfileByAdmin).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it('Dado un cambio de tarifa, entonces agrega una versión efectivo-fechada (append, con operationId) y actualiza la vigente en la misma transacción', async () => {
    const { manager, deps } = makeManager();

    await manager.adminUpdateCaregiver('cg-1', 'acc-admin', editDto({ rates: { ratePerHour: 5000 } }));

    expect(deps.caregiverAccess.createRateVersion).toHaveBeenCalledWith(
      'cg-1',
      { ratePerHour: 5000, currency: 'ARS', description: undefined }, // moneda heredada de la vigente
      expect.any(Date),
      'op-admin-edit-1',
      expect.anything(),
    );
    expect(deps.caregiverAccess.updateProfileByAdmin).toHaveBeenCalledWith(
      'cg-1',
      { rates: { ratePerHour: 5000, currency: 'ARS', description: undefined } },
      expect.anything(),
    );
    expect(deps.tx.run).toHaveBeenCalledTimes(1);
    expect(deps.audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { fields: ['rates'] } }));
  });

  it('Dado un cuidador aprobado, cuando el admin edita especialidades, disponibilidad y modalidades, entonces el patch las lleva sin tocar status ni badges', async () => {
    const { manager, deps } = makeManager();
    const availability = [{ dayOfWeek: 3, from: '10:00', to: '18:00' }];

    await manager.adminUpdateCaregiver(
      'cg-1',
      'acc-admin',
      editDto({ specialties: ['pediatric', 'palliative'], availability, modalities: ['home', 'hospital'] }),
    );

    expect(deps.caregiverAccess.updateProfileByAdmin).toHaveBeenCalledWith(
      'cg-1',
      { specialties: ['pediatric', 'palliative'], availability, modalities: ['home', 'hospital'] },
      expect.anything(),
    );
    expect(deps.caregiverAccess.setStatus).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.setBadges).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.setCertifications).not.toHaveBeenCalled(); // las certs van por-cert
  });

  it('Dado un intento de colar status/badges/certificaciones en el body, entonces se ignoran: el patch solo lleva campos editables', async () => {
    const { manager, deps } = makeManager();

    await manager.adminUpdateCaregiver(
      'cg-1',
      'acc-admin',
      editDto({
        zone: 'Belgrano',
        status: 'rejected',
        badges: { certifications: false, identity: false, background: true },
        certifications: [],
        reviewedBy: 'otro',
      }),
    );

    expect(deps.caregiverAccess.updateProfileByAdmin).toHaveBeenCalledWith('cg-1', { zone: 'Belgrano' }, expect.anything());
    expect(deps.caregiverAccess.setStatus).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.setBadges).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.setCertifications).not.toHaveBeenCalled();
  });

  it('Dado un patch vacío, entonces no se escribe ni audita nada y devuelve el cuidador tal cual', async () => {
    const { manager, deps } = makeManager();

    const result = await manager.adminUpdateCaregiver('cg-1', 'acc-admin', editDto());

    expect(result.status).toBe('approved');
    expect(deps.tx.run).not.toHaveBeenCalled();
    expect(deps.accountAccess.updateAccount).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.updateProfileByAdmin).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.createRateVersion).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it('Dado un cuidador inexistente, entonces 404', async () => {
    const { manager, deps } = makeManager();
    deps.caregiverAccess.findById.mockResolvedValue(null);

    await expect(manager.adminUpdateCaregiver('nope', 'acc-admin', editDto({ zone: 'X' }))).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('#49 · UC-19 A3 · PATCH /admin/caregivers/:id/certifications/:certId (adminUpdateCertification)', () => {
  const certDto = (over: Record<string, unknown> = {}): AdminUpdateCertificationDto =>
    over as unknown as AdminUpdateCertificationDto;

  it('Dada una certificación APROBADA, cuando el admin corrige institución y año, entonces se reescribe solo esa cert, conserva su estado/provenance y no toca las insignias', async () => {
    const { manager, deps } = makeManager();

    await manager.adminUpdateCertification('cg-1', 'cert-1', 'acc-admin', certDto({ institution: 'UNLP', year: 2016 }));

    const [caregiverId, certs] = deps.caregiverAccess.setCertifications.mock.calls[0];
    expect(caregiverId).toBe('cg-1');
    expect(certs).toHaveLength(2);
    expect(certs[0]).toEqual({ ...approvedCert, institution: 'UNLP', year: 2016 }); // status/verified/reviewedBy intactos
    expect(certs[1]).toEqual(pendingCert); // la otra no se toca
    expect(deps.caregiverAccess.setBadges).not.toHaveBeenCalled(); // editar tipo/institución/año no cambia insignias
    expect(deps.caregiverAccess.setStatus).not.toHaveBeenCalled();
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.caregiver.certification-admin-edited',
        actor: 'acc-admin',
        target: { type: 'caregiver', id: 'cg-1' },
        metadata: { certId: 'cert-1', fields: ['institution', 'year'] },
      }),
    );
  });

  it('Dado un cambio de tipo, entonces el catalogKey nuevo reemplaza al viejo (el DTO ya valida que sea del catálogo)', async () => {
    const { manager, deps } = makeManager();

    await manager.adminUpdateCertification('cg-1', 'cert-2', 'acc-admin', certDto({ catalogKey: 'first-aid' }));

    const certs = deps.caregiverAccess.setCertifications.mock.calls[0][1];
    expect(certs[1]).toEqual({ ...pendingCert, catalogKey: 'first-aid' });
  });

  it('Dado un tipo fuera del catálogo (defensa), entonces 400 y no se escribe', async () => {
    const { manager, deps } = makeManager();

    await expect(
      manager.adminUpdateCertification('cg-1', 'cert-2', 'acc-admin', certDto({ catalogKey: 'inventado' })),
    ).rejects.toThrow(BadRequestException);
    expect(deps.caregiverAccess.setCertifications).not.toHaveBeenCalled();
  });

  it('Dado un patch vacío, entonces no se escribe ni audita', async () => {
    const { manager, deps } = makeManager();

    await manager.adminUpdateCertification('cg-1', 'cert-1', 'acc-admin', certDto());

    expect(deps.caregiverAccess.setCertifications).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it('Dada una certificación inexistente, entonces 404', async () => {
    const { manager } = makeManager();

    await expect(
      manager.adminUpdateCertification('cg-1', 'cert-nope', 'acc-admin', certDto({ year: 2000 })),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('#49 · UC-19 A3 · DELETE /admin/caregivers/:id/certifications/:certId (adminRemoveCertification)', () => {
  it('Dada la única certificación aprobada, cuando el admin la da de baja, entonces sale del perfil y la insignia derivada `certifications` pasa a false (identidad/antecedentes intactas)', async () => {
    const { manager, deps } = makeManager();

    await manager.adminRemoveCertification('cg-1', 'cert-1', 'acc-admin');

    expect(deps.caregiverAccess.setCertifications).toHaveBeenCalledWith('cg-1', [pendingCert], expect.anything());
    expect(deps.caregiverAccess.setBadges).toHaveBeenCalledWith(
      'cg-1',
      { certifications: false, identity: true, background: false },
      expect.anything(),
    );
    expect(deps.caregiverAccess.setStatus).not.toHaveBeenCalled(); // el estado de la cuenta no cambia
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.caregiver.certification-admin-removed',
        actor: 'acc-admin',
        target: { type: 'caregiver', id: 'cg-1' },
        metadata: { certId: 'cert-1', catalogKey: 'nursing-degree', status: 'approved' },
      }),
    );
  });

  it('Dada una certificación pendiente, cuando se da de baja, entonces la insignia derivada sigue true (queda otra aprobada)', async () => {
    const { manager, deps } = makeManager();

    await manager.adminRemoveCertification('cg-1', 'cert-2', 'acc-admin');

    expect(deps.caregiverAccess.setCertifications).toHaveBeenCalledWith('cg-1', [approvedCert], expect.anything());
    expect(deps.caregiverAccess.setBadges).toHaveBeenCalledWith(
      'cg-1',
      { certifications: true, identity: true, background: false },
      expect.anything(),
    );
  });

  it('Dada una certificación inexistente, entonces 404 y no se escribe', async () => {
    const { manager, deps } = makeManager();

    await expect(manager.adminRemoveCertification('cg-1', 'cert-nope', 'acc-admin')).rejects.toThrow(
      NotFoundException,
    );
    expect(deps.caregiverAccess.setCertifications).not.toHaveBeenCalled();
    expect(deps.caregiverAccess.setBadges).not.toHaveBeenCalled();
  });
});
