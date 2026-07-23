import { ForbiddenException, GoneException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { MembershipManager } from './membership.manager';

/**
 * KER-49 · UC-04 A5: verificación de email del self-signup. Cubre la orquestación del manager con
 * deps mockeadas: signup dispara el email de verificación; request anti-enumeración (siempre resuelve,
 * solo emite si la cuenta existe y NO está verificada, invalidando el pendiente anterior); confirm
 * (token de un solo uso → 410 si inválido/expirado/usado; válido → marca verificado, consume, audita
 * y auto-loguea) y el gate: una cuenta no-verificada no puede emitir invitaciones (403 EMAIL_NOT_VERIFIED).
 */

const account = {
  id: 'acc-1',
  email: 'user@test.com',
  role: 'family',
  displayName: 'Usuario',
  photoUrl: null,
  emailVerified: false,
  passwordHash: bcrypt.hashSync('Clave!123', 4),
};

function pendingToken(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    token: 'tok-abc',
    accountId: 'acc-1',
    status: 'pending',
    expiresAt: new Date(Date.now() + 30 * 60_000),
    usedAt: null,
    ...over,
  };
}

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {
      findAccountByEmail: jest.fn().mockResolvedValue(account),
      findAccountById: jest.fn().mockResolvedValue(account),
      createAccount: jest.fn().mockResolvedValue(account),
      createEmailVerificationToken: jest.fn().mockResolvedValue(pendingToken()),
      findEmailVerificationByToken: jest.fn().mockResolvedValue(pendingToken()),
      markEmailVerificationUsed: jest.fn().mockResolvedValue(undefined),
      invalidatePendingEmailVerifications: jest.fn().mockResolvedValue(undefined),
      markEmailVerified: jest.fn().mockResolvedValue(undefined),
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', fullName: 'Rosa' }),
      getLink: jest.fn().mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-1', role: 'consent-holder' }),
      createInvitation: jest.fn().mockResolvedValue({ id: 'inv-1', token: 'inv-tok', invitedEmail: 'x@test.com', expiresAt: new Date() }),
    },
    caregiverAccess: {},
    jwt: { signAsync: jest.fn().mockResolvedValue('signed-token') },
    pubsub: { publish: jest.fn().mockResolvedValue({ id: 'evt-1' }), enqueue: jest.fn().mockResolvedValue(undefined) },
    audit: { record: jest.fn() },
    email: {
      sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
    },
    files: {},
    tokenRevocation: { revokeAccountSessions: jest.fn().mockResolvedValue(undefined) },
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

describe('UC-04 A5 · signup dispara la verificación', () => {
  it('Dado un alta nueva, cuando hace signup, entonces emite token de verificación y manda el email', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountByEmail.mockResolvedValue(null); // email libre

    const res = await manager.signup({ email: 'nuevo@test.com', password: 'Clave!123', role: 'family', displayName: 'Nuevo' });

    expect(deps.accountAccess.findAccountByEmail).toHaveBeenCalledWith('nuevo@test.com');
    expect(deps.accountAccess.createEmailVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', token: expect.any(String), expiresAt: expect.any(Date) }),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.email-verification.issued', actor: 'acc-1' }),
    );
    expect(deps.email.sendEmailVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com', token: 'tok-abc' }),
    );
    // El signup NO invalida pendientes: es el primer token de la cuenta.
    expect(deps.accountAccess.invalidatePendingEmailVerifications).not.toHaveBeenCalled();
    // La respuesta expone el estado no-verificado para el banner del cliente.
    expect(res).toEqual(expect.objectContaining({ accessToken: 'signed-token', emailVerified: false }));
  });
});

describe('UC-04 A5 · request/resend (anti-enumeración)', () => {
  it('Dado un email inexistente, cuando pide verificación, entonces resuelve sin emitir ni auditar', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountByEmail.mockResolvedValue(null);

    await expect(manager.requestEmailVerification('fantasma@test.com')).resolves.toBeUndefined();
    expect(deps.accountAccess.createEmailVerificationToken).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
    expect(deps.email.sendEmailVerificationEmail).not.toHaveBeenCalled();
  });

  it('Dado un email YA verificado, cuando pide verificación, entonces no hace nada (respuesta neutra)', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountByEmail.mockResolvedValue({ ...account, emailVerified: true });

    await expect(manager.requestEmailVerification('user@test.com')).resolves.toBeUndefined();
    expect(deps.accountAccess.createEmailVerificationToken).not.toHaveBeenCalled();
  });

  it('Dado un email no-verificado, cuando reenvía, entonces invalida el pendiente anterior y emite uno nuevo', async () => {
    const { manager, deps } = makeManager();

    await manager.requestEmailVerification('user@test.com');

    expect(deps.accountAccess.invalidatePendingEmailVerifications).toHaveBeenCalledWith('acc-1', expect.any(Date));
    expect(deps.accountAccess.createEmailVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1' }),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.email-verification.issued' }),
    );
    expect(deps.email.sendEmailVerificationEmail).toHaveBeenCalled();
  });
});

describe('UC-04 A5 · confirm (token de un solo uso)', () => {
  it('Dado un token inexistente, cuando confirma, entonces 410 y no marca verificado', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findEmailVerificationByToken.mockResolvedValue(null);

    await expect(manager.confirmEmailVerification({ token: 'x' })).rejects.toBeInstanceOf(GoneException);
    expect(deps.accountAccess.markEmailVerified).not.toHaveBeenCalled();
  });

  it('Dado un token ya usado, cuando confirma, entonces 410', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findEmailVerificationByToken.mockResolvedValue(pendingToken({ status: 'used' }));

    await expect(manager.confirmEmailVerification({ token: 'tok-abc' })).rejects.toBeInstanceOf(GoneException);
  });

  it('Dado un token expirado, cuando confirma, entonces 410', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findEmailVerificationByToken.mockResolvedValue(
      pendingToken({ expiresAt: new Date(Date.now() - 60_000) }),
    );

    await expect(manager.confirmEmailVerification({ token: 'tok-abc' })).rejects.toBeInstanceOf(GoneException);
  });

  it('Dado un token válido, cuando confirma, entonces marca verificado, consume el token, audita y auto-loguea verificado', async () => {
    const { manager, deps } = makeManager();

    const res = await manager.confirmEmailVerification({ token: 'tok-abc' });

    expect(deps.accountAccess.markEmailVerified).toHaveBeenCalledWith('acc-1', expect.anything());
    expect(deps.accountAccess.markEmailVerificationUsed).toHaveBeenCalledWith('evt-1', expect.any(Date), expect.anything());
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.email-verification.confirmed', actor: 'acc-1' }),
    );
    // Auto-login: sesión nueva ya con emailVerified=true (el banner del cliente desaparece).
    expect(res).toEqual(
      expect.objectContaining({ accessToken: 'signed-token', accountId: 'acc-1', emailVerified: true }),
    );
  });
});

describe('UC-04 A5 · gate: emitir invitación exige email verificado', () => {
  it('Dada una cuenta NO verificada, cuando intenta invitar, entonces 403 EMAIL_NOT_VERIFIED y no crea invitación', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountById.mockResolvedValue({ ...account, emailVerified: false });

    await expect(
      manager.issueInvitation('pat-1', 'acc-1', 'invitado@test.com', 'viewer' as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.accountAccess.createInvitation).not.toHaveBeenCalled();
    // El gate corre ANTES del chequeo de vínculo: no llega a mirar el link.
    expect(deps.accountAccess.getLink).not.toHaveBeenCalled();
  });

  it('Dada una cuenta verificada y vinculada, cuando invita, entonces crea la invitación', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountById.mockResolvedValue({ ...account, emailVerified: true });

    await manager.issueInvitation('pat-1', 'acc-1', 'invitado@test.com', 'viewer' as never);

    expect(deps.accountAccess.createInvitation).toHaveBeenCalled();
  });
});
