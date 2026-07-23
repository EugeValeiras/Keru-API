import { HealthUtility } from './health.util';

/**
 * KER-33: probes de salud reales — DB (SELECT 1), Redis (ping) y lag del outbox.
 * status='error' ⇒ el controller devuelve 503 y el healthcheck del contenedor reinicia la API.
 */

function makeHealth(overrides: Record<string, unknown> = {}) {
  const deps = {
    dataSource: { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
    queue: { client: Promise.resolve({ ping: jest.fn().mockResolvedValue('PONG') }) },
    pubsub: {
      stats: jest.fn().mockResolvedValue({ pending: 0, lagged: 0, deadLettered: 0, oldestPendingAgeMs: null }),
    },
    config: { get: jest.fn((_key: string, def: unknown) => def) },
    ...overrides,
  };
  const health = new HealthUtility(
    deps.dataSource as never,
    deps.queue as never,
    deps.pubsub as never,
    deps.config as never,
  );
  return { health, deps };
}

describe('KER-33 · HealthUtility (probes DB / Redis / lag del outbox)', () => {
  it('todo arriba y sin lag → ok', async () => {
    const { health } = makeHealth();

    const report = await health.check();

    expect(report.status).toBe('ok');
    expect(report.checks.db.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
    expect(report.checks.outbox).toMatchObject({ status: 'ok', pending: 0, lagged: 0 });
  });

  it('DB caída → error, y el estado del outbox queda unknown (no se puede leer)', async () => {
    const { health } = makeHealth({ dataSource: { query: jest.fn().mockRejectedValue(new Error('conn refused')) } });

    const report = await health.check();

    expect(report.status).toBe('error');
    expect(report.checks.db.status).toBe('down');
    expect(report.checks.outbox.status).toBe('unknown');
  });

  it('Redis caído → error aunque la DB esté sana', async () => {
    const { health } = makeHealth({
      queue: { client: Promise.resolve({ ping: jest.fn().mockRejectedValue(new Error('redis down')) }) },
    });

    const report = await health.check();

    expect(report.status).toBe('error');
    expect(report.checks.redis.status).toBe('down');
  });

  it('outbox con lag (worker muerto/trabado) → error: el orquestador debe reiniciar la API', async () => {
    const { health } = makeHealth({
      pubsub: {
        stats: jest.fn().mockResolvedValue({ pending: 4, lagged: 2, deadLettered: 0, oldestPendingAgeMs: 300_000 }),
      },
    });

    const report = await health.check();

    expect(report.status).toBe('error');
    expect(report.checks.outbox).toMatchObject({ status: 'lagged', lagged: 2 });
  });

  it('dead-lettered NO baja la salud: es visible en admin ops y un reinicio no lo arregla', async () => {
    const { health } = makeHealth({
      pubsub: {
        stats: jest.fn().mockResolvedValue({ pending: 0, lagged: 0, deadLettered: 3, oldestPendingAgeMs: null }),
      },
    });

    const report = await health.check();

    expect(report.status).toBe('ok');
    expect(report.checks.outbox).toMatchObject({ status: 'ok', deadLettered: 3 });
  });
});
