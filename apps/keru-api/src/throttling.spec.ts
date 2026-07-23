import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SkipThrottle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import {
  AllExceptionsFilter,
  THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
  TokenRevocationUtility,
  throttlerModuleOptions,
} from '@keru/core';
import { AuthController } from '@keru/membership/auth.controller';
import { MembershipManager } from '@keru/membership/manager/membership.manager';

/**
 * KER-14 · Hardening: rate limiting por IP contra fuerza bruta.
 * Se prueba contra un server HTTP real (misma composición que AppModule: guard global
 * + AllExceptionsFilter) para verificar el 429 con el envelope uniforme de errores.
 */

// El spec valida el throttle REAL: neutralizar cualquier bypass del entorno local
// (.env con THROTTLE_SKIP=true para las suites E2E) ANTES de bootear la app.
process.env['THROTTLE_SKIP'] = 'false';
delete process.env['THROTTLE_AUTH_LIMIT'];

describe('KER-14 · login con más de N intentos/min devuelve 429 (config real)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(throttlerModuleOptions)],
      controllers: [AuthController],
      providers: [
        {
          provide: MembershipManager,
          useValue: {
            login: jest.fn().mockResolvedValue({ accessToken: 'tok', role: 'family' }),
            signup: jest.fn().mockResolvedValue({ accessToken: 'tok', role: 'family' }),
          },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        // KER-38: logout/step-up llevan JwtAuthGuard — stubs para que Nest resuelva el guard.
        { provide: JwtService, useValue: {} },
        { provide: TokenRevocationUtility, useValue: { isRevoked: jest.fn().mockResolvedValue(false) } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = () =>
    fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'familiar@test.com', password: 'S3gura!123' }),
    });

  it(`permite ${THROTTLE_LIMITS.auth} intentos por minuto y al siguiente responde 429 con el envelope uniforme`, async () => {
    for (let i = 0; i < THROTTLE_LIMITS.auth; i++) {
      const ok = await login();
      expect(ok.status).toBe(200);
    }

    const blocked = await login();
    expect(blocked.status).toBe(429);

    const body = (await blocked.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      path: '/auth/login',
    });
    expect(typeof body.message).toBe('string');
    expect(typeof body.timestamp).toBe('string');
  });
});

@Controller('publico')
class PublicoStubController {
  @Get()
  get() {
    return { ok: true };
  }
}

/** Simula un endpoint interno de back-office: excluido del rate limiting. */
@SkipThrottle()
@Controller('interno')
class InternoStubController {
  @Get()
  get() {
    return { ok: true };
  }
}

describe('KER-14 · default global y exclusión de endpoints internos', () => {
  const LIMIT = 3; // default achicado para no disparar cientos de requests en el test
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({ throttlers: [{ ttl: THROTTLE_TTL_MS, limit: LIMIT }] }),
      ],
      controllers: [PublicoStubController, InternoStubController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('un endpoint sin override queda cubierto por el default global', async () => {
    for (let i = 0; i < LIMIT; i++) {
      const ok = await fetch(`${baseUrl}/publico`);
      expect(ok.status).toBe(200);
    }
    const blocked = await fetch(`${baseUrl}/publico`);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as Record<string, unknown>;
    expect(body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('un controller @SkipThrottle (interno) no se limita', async () => {
    for (let i = 0; i < LIMIT * 3; i++) {
      const res = await fetch(`${baseUrl}/interno`);
      expect(res.status).toBe(200);
    }
  });
});
