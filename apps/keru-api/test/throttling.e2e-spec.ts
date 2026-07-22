import { INestApplication } from '@nestjs/common';
import { createE2EApp, http } from './e2e-utils';

/**
 * Rate limiting real (KER-14) con THROTTLE_SKIP=false: a diferencia del unit test (stubs),
 * acá el guard corre montado en el AppModule real. La cuota de auth queda fija en 5/min
 * (THROTTLE_AUTH_LIMIT=5 en e2e-env.ts, congelada al importar la config). El skipIf es lazy
 * (se evalúa por request), así que este spec apaga y prende el bypass sin rebootear la app.
 */
describe('E2E · Rate limiting real en auth (KER-14)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.THROTTLE_SKIP = 'false';
    app = await createE2EApp();
  });

  afterAll(async () => {
    process.env.THROTTLE_SKIP = 'true';
    await app.close();
  });

  it('el 6to login desde la misma IP responde 429 con el envelope uniforme', async () => {
    const attempt = () =>
      http(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nadie@e2e.keru.test', password: 'incorrecta' });

    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }

    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, code: 'TOO_MANY_REQUESTS' });
    expect(blocked.body.path).toContain('/auth/login');

    // Con el bypass de test activo el guard deja pasar de nuevo (skipIf por request).
    process.env.THROTTLE_SKIP = 'true';
    expect((await attempt()).status).toBe(401);
  });
});
