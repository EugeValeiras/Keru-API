import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StepUpGuard, STEP_UP_REQUIRED } from './step-up.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * KER-38 · Guards de sesión (NFR-33/41): StepUpGuard exige el token corto con claim step_up
 * de la MISMA cuenta y audita cada uso; JwtAuthGuard rechaza tokens deslistados por logout.
 */

const ctx = (headers: Record<string, string>, account?: { accountId: string }): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers, account, method: 'POST', url: '/x', originalUrl: '/x' }),
    }),
  }) as unknown as ExecutionContext;

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
    const guard = new JwtAuthGuard(jwt as never, revocation as never);
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
    const guard = new JwtAuthGuard(jwt as never, revocation as never);
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
    const guard = new JwtAuthGuard(jwt as never, revocation as never);
    const request: { account?: { jti?: string; tokenExp?: number } } = {};
    const context = {
      switchToHttp: () => ({
        getRequest: () => Object.assign(request, { headers: { authorization: 'Bearer t' } }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.account).toMatchObject({ accountId: 'acc-1', jti: 'jti-1', tokenExp: 123 });
  });
});
