import { INestApplication } from '@nestjs/common';
import { TestAccount, bearer, createE2EApp, http, registerPatient, signup, uid } from './e2e-utils';

/**
 * KER-86 (UC-18) · La campana pagina con cursor descendente por createdAt. Un familiar con muchas
 * notificaciones ya no se las trae todas de una: `limit` acota la página, `nextCursor` alimenta la
 * siguiente y el orden DESC se mantiene estable (desempate por id) sin repetir ni saltear filas.
 * Cada vitals fuera de rango deja una notificación en la campana del círculo (UC-12 A2 → UC-18).
 */
describe('E2E · Paginación de la campana con cursor (KER-86, UC-18)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let patientId: string;

  const TOTAL = 5;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Paginado');
    patientId = await registerPatient(app, familiar.token);

    // Genera TOTAL alertas (una notificación en la campana cada una), en serie para un orden claro.
    for (let i = 0; i < TOTAL; i++) {
      const res = await http(app)
        .post(`/api/v1/patients/${patientId}/vitals`)
        .set(bearer(familiar.token))
        .send({ operationId: uid('op-vitals'), values: [{ metricKey: 'temperature', value: 39.5 + i / 10 }] });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const isSortedDesc = (items: { createdAt: string; id: string }[]): boolean =>
    items.every((n, i) => {
      if (i === 0) return true;
      const prev = items[i - 1];
      return (
        prev.createdAt > n.createdAt || (prev.createdAt === n.createdAt && prev.id > n.id)
      );
    });

  it('sin params: default sano, no devuelve todo de golpe y viene ordenado DESC', async () => {
    const res = await http(app).get('/api/v1/notifications').set(bearer(familiar.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
    // Con TOTAL < default (20) entran todas en una página: nextCursor null.
    expect(res.body.items.length).toBe(TOTAL);
    expect(res.body.nextCursor).toBeNull();
    expect(isSortedDesc(res.body.items)).toBe(true);
  });

  it('limit acota la página y expone nextCursor cuando hay más', async () => {
    const res = await http(app).get('/api/v1/notifications?limit=2').set(bearer(familiar.token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(typeof res.body.nextCursor).toBe('string');
    expect(res.body.nextCursor.length).toBeGreaterThan(0);
    expect(isSortedDesc(res.body.items)).toBe(true);
  });

  it('el cursor pagina hacia atrás sin repetir ni saltear, manteniendo DESC global', async () => {
    const seen: { createdAt: string; id: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const url = `/api/v1/notifications?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await http(app).get(url).set(bearer(familiar.token));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items);
      cursor = res.body.nextCursor;
      pages++;
      expect(pages).toBeLessThanOrEqual(TOTAL + 2); // anti-loop
    } while (cursor);

    // Cubrió exactamente las TOTAL, sin ids duplicados, y el concatenado sigue DESC.
    expect(seen.length).toBe(TOTAL);
    expect(new Set(seen.map((n) => n.id)).size).toBe(TOTAL);
    expect(isSortedDesc(seen)).toBe(true);
  });

  it('limit por encima del tope no rompe: devuelve la página completa', async () => {
    const res = await http(app).get('/api/v1/notifications?limit=1000').set(bearer(familiar.token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(TOTAL);
    expect(res.body.nextCursor).toBeNull();
  });

  it('un cursor ilegible se ignora (primera página), no rompe la campana', async () => {
    const res = await http(app)
      .get('/api/v1/notifications?limit=2&cursor=not-a-real-cursor')
      .set(bearer(familiar.token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(isSortedDesc(res.body.items)).toBe(true);
  });
});
