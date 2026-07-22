import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  AllExceptionsFilter,
  REQUEST_ID_HEADER,
  RequestWithContext,
  requestLoggerMiddleware,
} from '@keru/core';

/**
 * KER-15 · Observabilidad: request-id + log JSON por request y stack en 5xx.
 * Igual que throttling.spec (KER-14), se prueba sobre el server HTTP real con la misma
 * composición del borde que AppModule: middleware de logging + guard + AllExceptionsFilter.
 */

/** Simula al JwtAuthGuard adjuntando la sesión al request (UC-04). */
@Injectable()
class FakeSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (request.headers.authorization === 'Bearer valido') {
      request.account = { accountId: 'acc-observada', email: 'obs@test.com', role: 'family' };
    }
    return true;
  }
}

@Controller('obs')
class ObsStubController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error('explosión controlada');
  }
}

describe('KER-15 · logs estructurados con request-id y timing', () => {
  let app: INestApplication;
  let baseUrl: string;
  let lines: string[];
  let stdoutSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ObsStubController],
      providers: [{ provide: APP_GUARD, useClass: FakeSessionGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(requestLoggerMiddleware);
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    lines = [];
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        lines.push(chunk.toString());
        return true;
      });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  /** Parsea las líneas capturadas: cada registro debe ser JSON válido por línea. */
  const parsedLogs = () =>
    lines
      .flatMap((chunk) => chunk.split('\n'))
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  it('toda respuesta lleva x-request-id y el log de request correlaciona con ese id', async () => {
    const res = await fetch(`${baseUrl}/obs/ok`);
    expect(res.status).toBe(200);

    const requestId = res.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/); // uuid generado por el middleware

    const log = parsedLogs().find((l) => l.msg === 'request');
    expect(log).toBeDefined();
    expect(log?.requestId).toBe(requestId);
  });

  it('propaga un x-request-id entrante en vez de generar uno nuevo', async () => {
    const res = await fetch(`${baseUrl}/obs/ok`, {
      headers: { [REQUEST_ID_HEADER]: 'rid-cliente-123' },
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('rid-cliente-123');

    const log = parsedLogs().find((l) => l.msg === 'request');
    expect(log?.requestId).toBe('rid-cliente-123');
  });

  it('el log de request es JSON por línea con método/ruta/status/duración y accountId si hay sesión', async () => {
    const res = await fetch(`${baseUrl}/obs/ok`, {
      headers: { authorization: 'Bearer valido' },
    });
    expect(res.status).toBe(200);

    const log = parsedLogs().find((l) => l.msg === 'request');
    expect(log).toMatchObject({
      level: 'info',
      method: 'GET',
      path: '/obs/ok',
      statusCode: 200,
      accountId: 'acc-observada',
    });
    expect(typeof log?.durationMs).toBe('number');
    expect(typeof log?.ts).toBe('string');
  });

  it('sin sesión el log de request no inventa accountId', async () => {
    await fetch(`${baseUrl}/obs/ok`);
    const log = parsedLogs().find((l) => l.msg === 'request');
    expect(log).toBeDefined();
    expect(log).not.toHaveProperty('accountId');
  });

  it('un 5xx loguea el stack con el request-id de esa respuesta', async () => {
    const res = await fetch(`${baseUrl}/obs/boom`);
    expect(res.status).toBe(500);
    const requestId = res.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toBeTruthy();

    const logs = parsedLogs();
    const errorLog = logs.find((l) => l.level === 'error' && typeof l.stack === 'string');
    expect(errorLog).toBeDefined();
    expect(errorLog?.requestId).toBe(requestId);
    expect(errorLog?.msg).toBe('explosión controlada');
    expect(errorLog?.stack as string).toContain('explosión controlada');

    // Y el log de request de ese mismo hit también sale correlacionado y con level error.
    const requestLog = logs.find((l) => l.msg === 'request');
    expect(requestLog).toMatchObject({ level: 'error', statusCode: 500, requestId });
  });
});

/** Mismo wiring que AppModule.configure: el wildcard '{*splat}' de Express 5 debe montar. */
@Module({ controllers: [ObsStubController] })
class ObsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestLoggerMiddleware).forRoutes('{*splat}');
  }
}

describe('KER-15 · el middleware montado vía MiddlewareConsumer (como en AppModule) cubre las rutas', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ObsModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  it('una ruta cualquiera responde con x-request-id', async () => {
    const res = await fetch(`${await app.getUrl()}/obs/ok`);
    expect(res.status).toBe(200);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
