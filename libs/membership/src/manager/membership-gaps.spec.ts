import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    certifications: [
      {
        catalogKey: 'nursing-degree',
        institution: 'UBA',
        year: 2015,
        documentKey: 'private/documents/x.pdf',
        documentContentType: 'application/pdf',
      },
    ],
    availability: [{ dayOfWeek: 1, from: '08:00', to: '16:00' }],
    rates: { ratePerHour: 3500 },
    zone: 'Palermo, CABA',
    modalities: ['home'],
  }) as unknown as RegisterCaregiverDto;

const invitation = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  token: 'tok-1',
  patientId: 'pat-1',
  invitedByAccountId: 'acc-emisor',
  invitedEmail: 'hermana@test.com',
  roleToGrant: 'viewer',
  status: 'pending',
  expiresAt: new Date(Date.now() + 10 * 60_000),
  confirmedByAccountId: null,
  confirmedAt: null,
  createdAt: new Date('2026-07-22T10:00:00Z'),
  ...over,
});

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {
      findPatientById: jest.fn().mockResolvedValue(patient()),
      getLink: jest.fn().mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-1', role: 'manager' }),
      updatePatient: jest.fn().mockResolvedValue(undefined),
      listLinksForPatient: jest.fn().mockResolvedValue([]),
      findAccountsByIds: jest.fn().mockResolvedValue([]),
      findInvitationByToken: jest.fn().mockResolvedValue(invitation()),
      listInvitationsForPatient: jest.fn().mockResolvedValue([]),
      setInvitationStatus: jest.fn().mockResolvedValue(undefined),
      linkAccountToPatient: jest.fn().mockResolvedValue(undefined),
    },
    caregiverAccess: {
      findByAccountId: jest.fn().mockResolvedValue(rejectedCaregiver()),
      resubmitProfile: jest.fn().mockResolvedValue(undefined),
    },
    catalogAccess: { list: jest.fn().mockResolvedValue([]) },
    jwt: {},
    pubsub: {},
    audit: { record: jest.fn() },
    email: {},
    files: {},
    tokenRevocation: { revoke: jest.fn(), isRevoked: jest.fn().mockResolvedValue(false) },
    config: { get: jest.fn((_k: string, d?: unknown) => d) },
    permission: { hasLinkRole: jest.fn().mockResolvedValue(true) },
    ...overrides,
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

describe('UC-22 A3/A4 · cambiar el rol de un miembro del círculo (PATCH /patients/:id/links/:accountId)', () => {
  /** makeManager con el objetivo vinculado, su cuenta resoluble y updateLinkRole disponible. */
  const makeCircleManager = (targetRole: string, isConsentHolder = true) => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['getLink'].mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-target', role: targetRole });
    access['findAccountById'] = jest
      .fn()
      .mockResolvedValue({ id: 'acc-target', displayName: 'Pedro Díaz', email: 'pedro@example.com' });
    access['updateLinkRole'] = jest
      .fn()
      .mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-target', role: 'manager', createdAt: new Date('2026-02-01') });
    (deps.permission as { hasLinkRole: jest.Mock }).hasLinkRole.mockResolvedValue(isConsentHolder);
    return { manager, deps, access };
  };

  it('Dado el titular (consent-holder), cuando promueve a un viewer a manager, entonces se escribe el vínculo y se audita el cambio de rol', async () => {
    const { manager, deps, access } = makeCircleManager('viewer');

    const member = await manager.changeLinkRole('pat-1', 'acc-target', 'manager', 'acc-titular');

    expect((deps.permission as { hasLinkRole: jest.Mock }).hasLinkRole).toHaveBeenCalledWith(
      { accountId: 'acc-titular', patientId: 'pat-1' },
      ['consent-holder'],
    );
    expect(access['updateLinkRole']).toHaveBeenCalledWith('pat-1', 'acc-target', 'manager');
    expect(member).toEqual(
      expect.objectContaining({ accountId: 'acc-target', role: 'manager', email: 'pedro@example.com' }),
    );
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.circle.link-role-changed',
        actor: 'acc-titular',
        target: { type: 'patient', id: 'pat-1' },
        metadata: { targetAccountId: 'acc-target', fromRole: 'viewer', toRole: 'manager' },
      }),
    );
  });

  it('Dado un actor que no es consent-holder, cuando intenta cambiar un rol, entonces 403 y no se escribe nada', async () => {
    const { manager, deps, access } = makeCircleManager('viewer', false);

    await expect(manager.changeLinkRole('pat-1', 'acc-target', 'manager', 'acc-manager')).rejects.toThrow(
      ForbiddenException,
    );
    expect(access['updateLinkRole']).not.toHaveBeenCalled();
    expect((deps.audit as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dado un objetivo que no pertenece al círculo, cuando el titular cambia su rol, entonces 404', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    (deps.permission as { hasLinkRole: jest.Mock }).hasLinkRole.mockResolvedValue(true);
    access['getLink'].mockResolvedValue(null);
    access['updateLinkRole'] = jest.fn();

    await expect(manager.changeLinkRole('pat-1', 'acc-ajeno', 'manager', 'acc-titular')).rejects.toThrow(
      NotFoundException,
    );
    expect(access['updateLinkRole']).not.toHaveBeenCalled();
  });

  it('Dado el único consent-holder, cuando intenta degradarse a manager, entonces 409 LAST_CONSENT_HOLDER y no se escribe', async () => {
    const { manager, deps, access } = makeCircleManager('consent-holder');
    access['listLinksForPatient'].mockResolvedValue([
      { patientId: 'pat-1', accountId: 'acc-target', role: 'consent-holder' },
      { patientId: 'pat-1', accountId: 'acc-2', role: 'viewer' },
    ]);

    await expect(manager.changeLinkRole('pat-1', 'acc-target', 'manager', 'acc-target')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LAST_CONSENT_HOLDER' }),
    });
    expect(access['updateLinkRole']).not.toHaveBeenCalled();
    expect((deps.audit as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dado un paciente con dos consent-holders, cuando se degrada a uno, entonces se permite (queda al menos un titular)', async () => {
    const { manager, access } = makeCircleManager('consent-holder');
    access['listLinksForPatient'].mockResolvedValue([
      { patientId: 'pat-1', accountId: 'acc-target', role: 'consent-holder' },
      { patientId: 'pat-1', accountId: 'acc-2', role: 'consent-holder' },
    ]);

    await manager.changeLinkRole('pat-1', 'acc-target', 'viewer', 'acc-2');

    expect(access['updateLinkRole']).toHaveBeenCalledWith('pat-1', 'acc-target', 'viewer');
  });

  it('Dado el mismo rol que ya tiene, cuando el titular lo "cambia", entonces es un no-op idempotente (no escribe ni audita)', async () => {
    const { manager, deps, access } = makeCircleManager('manager');

    const member = await manager.changeLinkRole('pat-1', 'acc-target', 'manager', 'acc-titular');

    expect(member.role).toBe('manager');
    expect(access['updateLinkRole']).not.toHaveBeenCalled();
    expect((deps.audit as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });
});

describe('UC-03 · gestión de invitaciones emitidas (listar y revocar)', () => {
  it('Dado un vinculado, cuando lista las invitaciones del paciente, entonces las recibe con estado y vencimiento', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    const emitted = [
      invitation(),
      invitation({ id: 'inv-2', token: 'tok-2', status: 'revoked' }),
    ];
    access['listInvitationsForPatient'].mockResolvedValue(emitted);

    const result = await manager.listInvitations('pat-1', 'acc-1');

    expect(access['listInvitationsForPatient']).toHaveBeenCalledWith('pat-1');
    expect(result).toEqual(emitted);
    expect(result[0]).toEqual(
      expect.objectContaining({ status: 'pending', expiresAt: expect.any(Date) }),
    );
  });

  it('Dada una cuenta sin vínculo, cuando lista las invitaciones, entonces 403 y no se consulta el store', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['getLink'].mockResolvedValue(null);

    await expect(manager.listInvitations('pat-1', 'acc-intruso')).rejects.toThrow(ForbiddenException);
    expect(access['listInvitationsForPatient']).not.toHaveBeenCalled();
  });

  it('Dado el emisor, cuando revoca una invitación pendiente, entonces queda revoked y auditada', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['getLink'].mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-emisor', role: 'manager' });

    const result = await manager.revokeInvitation('tok-1', 'acc-emisor');

    expect(access['setInvitationStatus']).toHaveBeenCalledWith('inv-1', 'revoked', null, null);
    expect((deps.audit as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.invitation.revoked',
        actor: 'acc-emisor',
        target: { type: 'patient', id: 'pat-1' },
      }),
    );
    expect(result.status).toBe('revoked');
  });

  it('Dado un consent-holder que no emitió la invitación, cuando la revoca, entonces queda revoked', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['getLink'].mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-titular', role: 'consent-holder' });

    const result = await manager.revokeInvitation('tok-1', 'acc-titular');

    expect(access['setInvitationStatus']).toHaveBeenCalledWith('inv-1', 'revoked', null, null);
    expect(result.status).toBe('revoked');
  });

  it('Dado un vinculado que no es el emisor ni consent-holder, cuando intenta revocar, entonces 403 y no se escribe', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['getLink'].mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-otro', role: 'manager' });

    await expect(manager.revokeInvitation('tok-1', 'acc-otro')).rejects.toThrow(ForbiddenException);
    expect(access['setInvitationStatus']).not.toHaveBeenCalled();
    expect((deps.audit as { record: jest.Mock }).record).not.toHaveBeenCalled();
  });

  it('Dada una invitación ya aceptada, cuando se intenta revocar, entonces 400 y no se escribe', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['findInvitationByToken'].mockResolvedValue(invitation({ status: 'accepted' }));

    await expect(manager.revokeInvitation('tok-1', 'acc-emisor')).rejects.toThrow(BadRequestException);
    expect(access['setInvitationStatus']).not.toHaveBeenCalled();
  });

  it('Dada una invitación ya revocada, cuando se vuelve a revocar, entonces no cambia nada (idempotencia natural)', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['findInvitationByToken'].mockResolvedValue(invitation({ status: 'revoked' }));

    const result = await manager.revokeInvitation('tok-1', 'acc-emisor');

    expect(result.status).toBe('revoked');
    expect(access['setInvitationStatus']).not.toHaveBeenCalled();
  });

  it('Dado un token revocado, cuando el invitado intenta confirmar, entonces 400 y no se crea el vínculo', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['findInvitationByToken'].mockResolvedValue(invitation({ status: 'revoked' }));

    await expect(
      manager.confirmInvitation('tok-1', 'acc-invitado', 'hermana@test.com'),
    ).rejects.toThrow(BadRequestException);
    expect(access['linkAccountToPatient']).not.toHaveBeenCalled();
  });

  it('Dado un token revocado, cuando se previsualiza la invitación, entonces valid=false', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['findInvitationByToken'].mockResolvedValue(invitation({ status: 'revoked' }));

    const preview = await manager.previewInvitation('tok-1');

    expect(preview.valid).toBe(false);
  });

  it('KER-67 · Dado una invitación pendiente, cuando se previsualiza, entonces expone roleToGrant e invitedEmail para el registro por invitación', async () => {
    const { manager, deps } = makeManager();
    const access = deps.accountAccess as Record<string, jest.Mock>;
    access['findInvitationByToken'].mockResolvedValue(
      invitation({ roleToGrant: 'manager', invitedEmail: 'invitada@test.com' }),
    );

    const preview = await manager.previewInvitation('tok-1');

    expect(preview.roleToGrant).toBe('manager');
    expect(preview.invitedEmail).toBe('invitada@test.com');
    expect(preview.valid).toBe(true);
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
        // KER-52: cada cert se reconstruye pending/no-verificada, con su catalogKey y documento.
        certifications: [
          expect.objectContaining({ catalogKey: 'nursing-degree', status: 'pending', verified: false }),
        ],
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
