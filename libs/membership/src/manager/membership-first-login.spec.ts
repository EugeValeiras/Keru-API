import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthPrincipal } from '@keru/core';
import { MembershipManager } from './membership.manager';

/**
 * KER-47 · UC-03 A1 + UC-04 A5 · First-login (definir contraseña en el primer acceso). Cubre la
 * orquestación del manager con deps mockeadas: aceptar una invitación sin registro crea la cuenta
 * SIN contraseña (mustSetPassword) y la vincula; setear la contraseña la deja como cuenta normal.
 */

function pendingInvitation(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    token: 'tok-inv',
    patientId: 'pat-1',
    invitedByAccountId: 'acc-inviter',
    invitedEmail: 'invitada@test.com',
    roleToGrant: 'manager',
    status: 'pending',
    expiresAt: new Date(Date.now() + 30 * 60_000),
    ...over,
  };
}

const createdAccount = {
  id: 'acc-new',
  email: 'invitada@test.com',
  role: 'family',
  displayName: 'invitada',
  photoUrl: null,
  passwordHash: null as string | null,
};

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {
      findInvitationByToken: jest.fn().mockResolvedValue(pendingInvitation()),
      findAccountByEmail: jest.fn().mockResolvedValue(null),
      findAccountById: jest.fn(),
      createAccount: jest.fn().mockResolvedValue(createdAccount),
      linkAccountToPatient: jest.fn().mockResolvedValue(undefined),
      setInvitationStatus: jest.fn().mockResolvedValue(undefined),
      updatePasswordHash: jest.fn().mockResolvedValue(undefined),
    },
    caregiverAccess: {},
    jwt: { signAsync: jest.fn().mockResolvedValue('signed-token') },
    pubsub: { publish: jest.fn(), enqueue: jest.fn() },
    audit: { record: jest.fn() },
    email: {},
    files: {},
    tokenRevocation: {},
    config: { get: jest.fn((_k: string, d?: unknown) => d) },
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
    deps.tokenRevocation as never,
    deps.config as never,
  );
  return { manager, deps };
}

describe('UC-03 A1 · aceptar invitación sin registro (crea cuenta sin contraseña)', () => {
  it('Dado un token inexistente, entonces 404 y no crea cuenta', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findInvitationByToken.mockResolvedValue(null);
    await expect(manager.acceptInvitationByRegistering('x')).rejects.toBeInstanceOf(NotFoundException);
    expect(deps.accountAccess.createAccount).not.toHaveBeenCalled();
  });

  it('Dada una invitación ya usada/revocada, entonces 400', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findInvitationByToken.mockResolvedValue(pendingInvitation({ status: 'accepted' }));
    await expect(manager.acceptInvitationByRegistering('tok-inv')).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.accountAccess.createAccount).not.toHaveBeenCalled();
  });

  it('Dada una invitación expirada, entonces 400', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findInvitationByToken.mockResolvedValue(
      pendingInvitation({ expiresAt: new Date(Date.now() - 60_000) }),
    );
    await expect(manager.acceptInvitationByRegistering('tok-inv')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Dado un email que YA tiene cuenta, entonces 409 (que inicie sesión)', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountByEmail.mockResolvedValue({ id: 'acc-existing' });
    await expect(manager.acceptInvitationByRegistering('tok-inv')).rejects.toBeInstanceOf(ConflictException);
    expect(deps.accountAccess.createAccount).not.toHaveBeenCalled();
  });

  it('Dada una invitación válida, entonces crea la cuenta sin contraseña, la vincula, consume la invitación y devuelve sesión limitada', async () => {
    const { manager, deps } = makeManager();

    const res = await manager.acceptInvitationByRegistering('tok-inv');

    expect(deps.accountAccess.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'invitada@test.com', passwordHash: null, role: 'family' }),
      expect.anything(),
    );
    expect(deps.accountAccess.linkAccountToPatient).toHaveBeenCalledWith('pat-1', 'acc-new', 'manager', expect.anything());
    expect(deps.accountAccess.setInvitationStatus).toHaveBeenCalledWith('inv-1', 'accepted', 'acc-new', expect.any(Date), expect.anything());
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'membership.account.created', actor: 'acc-new' }),
    );
    // Sesión LIMITADA: el cliente debe llevar a "Definí tu contraseña".
    expect(res).toEqual(
      expect.objectContaining({ accessToken: 'signed-token', accountId: 'acc-new', mustSetPassword: true }),
    );
    // El token lleva el claim mps (sesión limitada).
    expect(deps.jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ mps: true }));
  });
});

describe('UC-04 A5 · setear la contraseña en el primer acceso', () => {
  const principal: AuthPrincipal = { accountId: 'acc-new', email: 'invitada@test.com', role: 'family', mustSetPassword: true };

  it('Dada una cuenta inexistente, entonces 401', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountById.mockResolvedValue(null);
    await expect(manager.setFirstLoginPassword(principal, 'Nueva!12345')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Dada una cuenta que YA definió su contraseña, entonces 409 (idempotencia por estado)', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountById.mockResolvedValue({ ...createdAccount, passwordHash: 'ya-tiene' });
    await expect(manager.setFirstLoginPassword(principal, 'Nueva!12345')).rejects.toBeInstanceOf(ConflictException);
    expect(deps.accountAccess.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('Dada una cuenta pendiente, entonces setea el hash, audita y auto-loguea con sesión completa', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountById
      .mockResolvedValueOnce({ ...createdAccount, passwordHash: null })
      .mockResolvedValueOnce({ ...createdAccount, passwordHash: 'hash-nuevo' });

    const res = await manager.setFirstLoginPassword(principal, 'Nueva!12345');

    expect(deps.accountAccess.updatePasswordHash).toHaveBeenCalledWith('acc-new', expect.any(String), expect.anything());
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.first-login.password-set', actor: 'acc-new' }),
    );
    // Sesión COMPLETA: ya no está pendiente y el token no lleva el claim mps.
    expect(res).toEqual(expect.objectContaining({ accountId: 'acc-new', mustSetPassword: false }));
    expect(deps.jwt.signAsync).toHaveBeenCalledWith(expect.not.objectContaining({ mps: true }));
  });
});
