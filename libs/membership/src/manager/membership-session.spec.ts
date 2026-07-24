import { UnauthorizedException } from '@nestjs/common';
import { AuthPrincipal, DomainEventType, JwtPayload } from '@keru/core';
import * as bcrypt from 'bcryptjs';
import { MembershipManager } from './membership.manager';

/**
 * KER-38 · UC-04: sesión revocable y step-up (NFR-33/41).
 * Cubre la lógica del manager: jti en la emisión, logout (denylist + evento SessionRevoked +
 * audit) y step-up (re-confirmación de password → token corto con claim step_up, auditado).
 */

const PASSWORD = 'S3gura!123';

function makeManager(overrides: Record<string, unknown> = {}) {
  const account = {
    id: 'acc-1',
    email: 'admin@test.com',
    role: 'admin',
    displayName: 'Admin',
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
  };
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {
      findAccountByEmail: jest.fn().mockResolvedValue(account),
      findAccountById: jest.fn().mockResolvedValue(account),
    },
    caregiverAccess: {},
    catalogAccess: { list: jest.fn().mockResolvedValue([]) },
    jwt: { signAsync: jest.fn().mockResolvedValue('signed-token') },
    pubsub: {
      publish: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      enqueue: jest.fn().mockResolvedValue(undefined),
    },
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
  return { manager, deps, account };
}

const principal = (over: Partial<AuthPrincipal> = {}): AuthPrincipal => ({
  accountId: 'acc-1',
  email: 'admin@test.com',
  role: 'admin',
  jti: 'jti-1',
  tokenExp: Math.floor(Date.now() / 1000) + 3600,
  ...over,
});

describe('UC-04 · emisión con identidad de token (NFR-41)', () => {
  it('Dado un login válido, cuando se emite el JWT, entonces el payload lleva jti', async () => {
    const { manager, deps } = makeManager();
    await manager.login({ email: 'admin@test.com', password: PASSWORD });
    const payload = (deps.jwt.signAsync as jest.Mock).mock.calls[0][0] as JwtPayload;
    expect(payload.jti).toEqual(expect.any(String));
    expect(payload.step_up).toBeUndefined();
  });
});

describe('UC-04 · logout server-side (NFR-41)', () => {
  it('Dado un token con jti, cuando hace logout, entonces se deslista con el exp del token', async () => {
    const { manager, deps } = makeManager();
    const p = principal();
    await manager.logout(p);
    expect(deps.tokenRevocation.revoke).toHaveBeenCalledWith('jti-1', p.tokenExp);
  });

  it('Cuando hace logout, entonces publica SessionRevoked (cuenta+device) y lo encola tras el commit', async () => {
    const { manager, deps } = makeManager();
    await manager.logout(principal(), 'https://push.example/ep-1');
    expect(deps.pubsub.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DomainEventType.SessionRevoked,
        payload: { accountId: 'acc-1', pushEndpoint: 'https://push.example/ep-1' },
      }),
    );
    expect(deps.pubsub.enqueue).toHaveBeenCalledWith({ id: 'evt-1' });
  });

  it('Cuando hace logout, entonces queda auditado (quién y qué jti)', async () => {
    const { manager, deps } = makeManager();
    await manager.logout(principal());
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'membership.session.logout',
        actor: 'acc-1',
        metadata: expect.objectContaining({ jti: 'jti-1' }),
      }),
    );
  });

  it('Dado un token pre-KER-38 sin jti, cuando hace logout, entonces no revienta y el evento sale igual', async () => {
    const { manager, deps } = makeManager();
    await manager.logout(principal({ jti: undefined, tokenExp: undefined }));
    expect(deps.tokenRevocation.revoke).not.toHaveBeenCalled();
    expect(deps.pubsub.publish).toHaveBeenCalled();
  });
});

describe('UC-04 A3 · step-up (NFR-33)', () => {
  it('Dado un password incorrecto, cuando pide step-up, entonces 401 y no se emite token', async () => {
    const { manager, deps } = makeManager();
    await expect(manager.stepUp(principal(), 'incorrecta')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(deps.jwt.signAsync).not.toHaveBeenCalled();
  });

  it('Dado el password correcto, cuando pide step-up, entonces emite token corto con claim step_up y jti propio', async () => {
    const { manager, deps } = makeManager();
    const res = await manager.stepUp(principal(), PASSWORD);
    const [payload, options] = (deps.jwt.signAsync as jest.Mock).mock.calls[0] as [JwtPayload, { expiresIn: number }];
    expect(payload.step_up).toBe(true);
    expect(payload.sub).toBe('acc-1');
    expect(payload.jti).toEqual(expect.any(String));
    expect(options.expiresIn).toBe(300);
    expect(res).toEqual({ stepUpToken: 'signed-token', expiresInSeconds: 300 });
  });

  it('Cuando se emite un step-up, entonces la emisión queda auditada (NFR-33)', async () => {
    const { manager, deps } = makeManager();
    await manager.stepUp(principal(), PASSWORD);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.step-up.issued', actor: 'acc-1' }),
    );
  });
});
