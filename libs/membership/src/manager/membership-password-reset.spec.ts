import { GoneException } from '@nestjs/common';
import { DomainEventType } from '@keru/core';
import * as bcrypt from 'bcryptjs';
import { MembershipManager } from './membership.manager';

/**
 * KER-46 · UC-04 A4: recuperación de contraseña. Cubre la orquestación del manager con deps
 * mockeadas: request anti-enumeración (siempre resuelve, solo emite si la cuenta existe) y
 * confirm (token de un solo uso → 410 si inválido/expirado/usado; válido → setea hash, consume
 * token, audita, revoca sesiones de la cuenta y auto-loguea).
 */

const account = {
  id: 'acc-1',
  email: 'user@test.com',
  role: 'family',
  displayName: 'Usuario',
  photoUrl: null,
  passwordHash: bcrypt.hashSync('Vieja!123', 4),
};

function pendingToken(over: Record<string, unknown> = {}) {
  return {
    id: 'rst-1',
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
      createPasswordResetToken: jest.fn().mockResolvedValue(pendingToken()),
      findPasswordResetByToken: jest.fn().mockResolvedValue(pendingToken()),
      markPasswordResetUsed: jest.fn().mockResolvedValue(undefined),
      updatePasswordHash: jest.fn().mockResolvedValue(undefined),
    },
    caregiverAccess: {},
    jwt: { signAsync: jest.fn().mockResolvedValue('signed-token') },
    pubsub: {
      publish: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      enqueue: jest.fn().mockResolvedValue(undefined),
    },
    audit: { record: jest.fn() },
    email: { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) },
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

describe('UC-04 A4 · request (anti-enumeración)', () => {
  it('Dado un email inexistente, cuando pide reset, entonces resuelve sin emitir token ni auditar', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findAccountByEmail.mockResolvedValue(null);

    await expect(manager.requestPasswordReset('fantasma@test.com')).resolves.toBeUndefined();
    expect(deps.accountAccess.createPasswordResetToken).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
    expect(deps.email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('Dado un email registrado, cuando pide reset, entonces emite token, lo audita y manda el email', async () => {
    const { manager, deps } = makeManager();

    await manager.requestPasswordReset('user@test.com');

    expect(deps.accountAccess.createPasswordResetToken).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', token: expect.any(String), expiresAt: expect.any(Date) }),
    );
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password-reset.issued', actor: 'acc-1' }),
    );
    expect(deps.email.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com', token: 'tok-abc' }),
    );
  });
});

describe('UC-04 A4 · confirm (token de un solo uso)', () => {
  it('Dado un token inexistente, cuando confirma, entonces 410 y no toca la contraseña', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findPasswordResetByToken.mockResolvedValue(null);

    await expect(manager.confirmPasswordReset({ token: 'x', newPassword: 'Nueva!12345' })).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(deps.accountAccess.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('Dado un token ya usado, cuando confirma, entonces 410', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findPasswordResetByToken.mockResolvedValue(pendingToken({ status: 'used' }));

    await expect(manager.confirmPasswordReset({ token: 'tok-abc', newPassword: 'Nueva!12345' })).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('Dado un token expirado, cuando confirma, entonces 410', async () => {
    const { manager, deps } = makeManager();
    deps.accountAccess.findPasswordResetByToken.mockResolvedValue(
      pendingToken({ expiresAt: new Date(Date.now() - 60_000) }),
    );

    await expect(manager.confirmPasswordReset({ token: 'tok-abc', newPassword: 'Nueva!12345' })).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('Dado un token válido, cuando confirma, entonces setea el hash, consume el token, audita, revoca y auto-loguea', async () => {
    const { manager, deps } = makeManager();

    const res = await manager.confirmPasswordReset({ token: 'tok-abc', newPassword: 'Nueva!12345' });

    expect(deps.accountAccess.updatePasswordHash).toHaveBeenCalledWith('acc-1', expect.any(String), expect.anything());
    expect(deps.accountAccess.markPasswordResetUsed).toHaveBeenCalledWith('rst-1', expect.any(Date), expect.anything());
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password-reset.used', actor: 'acc-1' }),
    );
    // Revoca TODAS las sesiones de la cuenta (corte por cuenta + limpieza de push por outbox).
    expect(deps.tokenRevocation.revokeAccountSessions).toHaveBeenCalledWith('acc-1');
    expect(deps.pubsub.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DomainEventType.SessionRevoked,
        payload: { accountId: 'acc-1', pushEndpoint: null },
      }),
    );
    expect(deps.pubsub.enqueue).toHaveBeenCalledWith({ id: 'evt-1' });
    // Auto-login: devuelve una sesión nueva.
    expect(res).toEqual(
      expect.objectContaining({ accessToken: 'signed-token', accountId: 'acc-1', email: 'user@test.com' }),
    );
  });

  it('el corte por cuenta se hace DESPUÉS de emitir el nuevo token (auto-login sobrevive)', async () => {
    const { manager, deps } = makeManager();
    const order: string[] = [];
    deps.tokenRevocation.revokeAccountSessions.mockImplementation(async () => {
      order.push('revoke');
    });
    (deps.jwt.signAsync as jest.Mock).mockImplementation(async () => {
      order.push('sign');
      return 'signed-token';
    });

    await manager.confirmPasswordReset({ token: 'tok-abc', newPassword: 'Nueva!12345' });

    expect(order).toEqual(['revoke', 'sign']);
  });
});
