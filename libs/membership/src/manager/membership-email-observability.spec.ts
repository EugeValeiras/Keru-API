import { Logger } from '@nestjs/common';
import { MembershipManager, maskEmailForLog } from './membership.manager';

/**
 * KER-66 · Los emails transaccionales (invitación UC-03, reset/verificación UC-04) son "mejor
 * esfuerzo": un fallo de envío NO invalida ni bloquea el flujo. PERO el fallo dejó de ser INVISIBLE:
 * antes se tragaba en un `logger.warn` sin stack ni contexto (causa raíz indiagnosticable). Ahora se
 * loguea a ERROR con detalle accionable (tipo de email + destino ENMASCARADO + name/message + stack).
 * Estas pruebas fijan ese contrato de observabilidad y el enmascarado anti-PII.
 */

const account = {
  id: 'acc-1',
  email: 'usuario@test.com',
  role: 'family',
  displayName: 'Usuario',
  photoUrl: null,
  emailVerified: true,
};

function makeManager(overrides: Record<string, unknown> = {}) {
  const deps = {
    tx: { run: jest.fn(async (fn: (em: unknown) => unknown) => fn({})) },
    accountAccess: {
      findAccountByEmail: jest.fn().mockResolvedValue(account),
      findAccountById: jest.fn().mockResolvedValue(account),
      findPatientById: jest.fn().mockResolvedValue({ id: 'pat-1', fullName: 'Rosa' }),
      getLink: jest.fn().mockResolvedValue({ patientId: 'pat-1', accountId: 'acc-1', role: 'consent-holder' }),
      createInvitation: jest.fn().mockResolvedValue({
        token: 'inv-tok',
        invitedEmail: 'invitado@test.com',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }),
      createPasswordResetToken: jest.fn().mockResolvedValue({
        id: 'rst-1',
        token: 'tok-abc',
        accountId: 'acc-1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }),
    },
    caregiverAccess: {},
    catalogAccess: { list: jest.fn().mockResolvedValue([]) },
    jwt: { signAsync: jest.fn().mockResolvedValue('signed-token') },
    pubsub: { publish: jest.fn().mockResolvedValue({ id: 'evt-1' }), enqueue: jest.fn().mockResolvedValue(undefined) },
    audit: { record: jest.fn() },
    email: {
      sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
    },
    files: {},
    tokenRevocation: { revokeAccountSessions: jest.fn().mockResolvedValue(undefined) },
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

// El envío es fire-and-forget: el `.catch` corre en un microtask DESPUÉS de que el método retorna.
const flush = () => new Promise((r) => setImmediate(r));

describe('KER-66 · maskEmailForLog (anti-PII, conserva el dominio para diagnosticar SES/floci)', () => {
  it('enmascara el local y conserva el dominio', () => {
    expect(maskEmailForLog('invitado@keru.app')).toBe('i*******@keru.app');
    expect(maskEmailForLog('a@b.com')).toBe('a*@b.com');
  });
  it('no se rompe con una entrada sin @', () => {
    expect(maskEmailForLog('no-es-un-email')).toBe('***');
  });
});

describe('KER-66 · el fallo de envío es OBSERVABLE (ERROR con detalle) y no rompe el flujo', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    // Silenciamos el ERROR real y lo interceptamos (el manager usa `new Logger()`).
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('UC-03 · invitación: si el email falla, la invitación se emite igual y el fallo se loguea a ERROR con destino enmascarado', async () => {
    const { manager, deps } = makeManager();
    deps.email.sendInvitationEmail.mockRejectedValue(new Error('SES MessageRejected: Email address not verified'));

    const invitation = await manager.issueInvitation('pat-1', 'acc-1', 'invitado@test.com', 'viewer');

    // Mejor esfuerzo: el fallo NO invalida ni bloquea la emisión.
    expect(invitation).toEqual(expect.objectContaining({ token: 'inv-tok' }));
    await flush();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [msg, stack] = errorSpy.mock.calls[0];
    expect(msg).toContain('invitación');
    expect(msg).toContain('i*******@test.com'); // enmascarado, sin PII de más
    expect(msg).not.toContain('invitado@test.com');
    expect(msg).toContain('MessageRejected'); // detalle accionable del error real
    expect(stack).toBeDefined(); // stack para diagnosticar
  });

  it('UC-04 A4 · reset: si el email falla, el request resuelve igual (anti-enumeración) y se loguea a ERROR', async () => {
    const { manager, deps } = makeManager();
    deps.email.sendPasswordResetEmail.mockRejectedValue(new Error('floci down'));

    await expect(manager.requestPasswordReset('usuario@test.com')).resolves.toBeUndefined();
    await flush();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('recuperación de contraseña'),
      expect.any(String),
    );
  });

  it('cuando el email SÍ se envía, no se loguea ningún ERROR', async () => {
    const { manager } = makeManager();
    await manager.issueInvitation('pat-1', 'acc-1', 'invitado@test.com', 'viewer');
    await flush();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
