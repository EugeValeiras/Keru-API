import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StepUpGuard, STEP_UP_REQUIRED } from './step-up.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MUST_SET_PASSWORD } from './allow-pending-password.decorator';

/**
 * KER-38 · Guards de sesión (NFR-33/41): StepUpGuard exige el token corto con claim step_up
 * de la MISMA cuenta y audita cada uso; JwtAuthGuard rechaza tokens deslistados por logout.
 * KER-47 (UC-04 A5): JwtAuthGuard bloquea con 403 MUST_SET_PASSWORD la sesión limitada de una
 * cuenta sin contraseña definida, salvo la ruta marcada @AllowPendingPassword.
 */

const ctx = (headers: Record<string, string>, account?: { accountId: string }): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers, account, method: 'POST', url: '/x', originalUrl: '/x' }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

/** Reflector stub: por defecto la ruta NO está exenta (getAllAndOverride → false). */
const reflectorStub = (allowsPending = false) => ({ getAllAndOverride: jest.fn().mockReturnValue(allowsPending) });

const codeOf = (e: unknown): string | undefined =>
  ((e as ForbiddenException).getResponse() as { code?: string }).code;

describe('StepUpGuard (NFR-33)', () => {
  const audit = { record: jest.fn() };

  beforeEach(() => audit.record.mockClear());

  it('Dado un request sin x-step-up-token, entonces 403 con código STEP_UP_REQUIRED', async () => {
    const guard = new StepUpGuard({ verifyAsync: jest.fn() } as never, audit as never);
    const err = await guard.canActivate(ctx({}, { accountId: 'acc-1' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(codeOf(err)).toBe(STEP_UP_REQUIRED);
  });

  it('Dado un Bearer común (sin claim step_up), entonces 403 STEP_UP_REQUIRED — la sesión no alcanza', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'acc-1' }) };
    const guard = new StepUpGuard(jwt as never, audit as never);
    const err = await guard
      .canActivate(ctx({ 'x-step-up-token': 'bearer-comun' }, { accountId: 'acc-1' }))
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe(STEP_UP_REQUIRED);
  });

  it('Dado un step-up de OTRA cuenta, entonces 403 STEP_UP_REQUIRED', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'acc-2', step_up: true }) };
    const guard = new StepUpGuard(jwt as never, audit as never);
    const err = await guard
      .canActivate(ctx({ 'x-step-up-token': 't' }, { accountId: 'acc-1' }))
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe(STEP_UP_REQUIRED);
  });

  it('Dado un step-up vencido/ilegible, entonces 403 STEP_UP_REQUIRED', async () => {
    const jwt = { verifyAsync: jest.fn().mockRejectedValue(new Error('expired')) };
    const guard = new StepUpGuard(jwt as never, audit as never);
    const err = await guard
      .canActivate(ctx({ 'x-step-up-token': 'vencido' }, { accountId: 'acc-1' }))
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe(STEP_UP_REQUIRED);
  });

  it('Dado un step-up válido de la misma cuenta, entonces pasa y el USO queda auditado', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'acc-1', step_up: true, jti: 'su-1' }) };
    const guard = new StepUpGuard(jwt as never, audit as never);
    await expect(guard.canActivate(ctx({ 'x-step-up-token': 't' }, { accountId: 'acc-1' }))).resolves.toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.step-up.used', actor: 'acc-1', metadata: expect.objectContaining({ jti: 'su-1' }) }),
    );
  });
});

describe('JwtAuthGuard + denylist (NFR-41)', () => {
  const payload = { sub: 'acc-1', email: 'a@test.com', role: 'family', jti: 'jti-1', exp: 123 };

  it('Dado un token deslistado por logout, entonces 401 aunque la firma sea válida', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const revocation = {
      isRevoked: jest.fn().mockResolvedValue(true),
      isAccountSessionRevoked: jest.fn().mockResolvedValue(false),
    };
    const guard = new JwtAuthGuard(jwt as never, revocation as never, reflectorStub() as never);
    await expect(guard.canActivate(ctx({ authorization: 'Bearer t' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(revocation.isRevoked).toHaveBeenCalledWith('jti-1');
  });

  it('Dado un token de una cuenta con reset de contraseña (corte por cuenta), entonces 401 (UC-04 A4)', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const revocation = {
      isRevoked: jest.fn().mockResolvedValue(false),
      isAccountSessionRevoked: jest.fn().mockResolvedValue(true),
    };
    const guard = new JwtAuthGuard(jwt as never, revocation as never, reflectorStub() as never);
    await expect(guard.canActivate(ctx({ authorization: 'Bearer t' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(revocation.isAccountSessionRevoked).toHaveBeenCalledWith('acc-1', undefined);
  });

  it('Dado un token vigente no deslistado, entonces pasa y el principal lleva jti y exp (para el logout)', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const revocation = {
      isRevoked: jest.fn().mockResolvedValue(false),
      isAccountSessionRevoked: jest.fn().mockResolvedValue(false),
    };
    const guard = new JwtAuthGuard(jwt as never, revocation as never, reflectorStub() as never);
    const request: { account?: { jti?: string; tokenExp?: number } } = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => Object.assign(request, { headers: { authorization: 'Bearer t' } }),
      }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.account).toMatchObject({ accountId: 'acc-1', jti: 'jti-1', tokenExp: 123 });
  });
});

describe('JwtAuthGuard + first-login MUST_SET_PASSWORD (UC-04 A5)', () => {
  const pendingPayload = { sub: 'acc-9', email: 'nuevo@test.com', role: 'family', jti: 'jti-9', mps: true };
  const revocation = {
    isRevoked: jest.fn().mockResolvedValue(false),
    isAccountSessionRevoked: jest.fn().mockResolvedValue(false),
  };

  const codeOf = (e: unknown): string | undefined =>
    ((e as ForbiddenException).getResponse() as { code?: string }).code;

  it('Dada una sesión limitada (mps) en un endpoint de negocio, entonces 403 MUST_SET_PASSWORD', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(pendingPayload) };
    const guard = new JwtAuthGuard(jwt as never, revocation as never, reflectorStub(false) as never);
    const err = await guard.canActivate(ctx({ authorization: 'Bearer t' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(codeOf(err)).toBe(MUST_SET_PASSWORD);
  });

  it('Dada una sesión limitada (mps) en una ruta @AllowPendingPassword, entonces pasa', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(pendingPayload) };
    const guard = new JwtAuthGuard(jwt as never, revocation as never, reflectorStub(true) as never);
    await expect(guard.canActivate(ctx({ authorization: 'Bearer t' }))).resolves.toBe(true);
  });
});
