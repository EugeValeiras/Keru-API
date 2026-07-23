import { INestApplication } from '@nestjs/common';
import { TestAccount, bearer, createE2EApp, http, registerPatient, signup, uid } from './e2e-utils';

/**
 * NFR-38 real (KER-36): el typo de 39.8° deja de ser incorregible. La corrección es un registro
 * NUEVO con referencia, autor y razón; el original queda intacto y marcado superseded; la alerta
 * que disparó el valor errado queda resuelta-por-corrección con campana al círculo; el estado
 * actual usa la versión vigente. Camino completo por la API pública.
 */
describe('E2E · Corrección de registro con traza y re-evaluación (NFR-38)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let patientId: string;
  let originalId: string;
  let correctionId: string;

  const correctionOperationId = uid('op-fix');

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Titular');
    patientId = await registerPatient(app, familiar.token);
  });

  afterAll(async () => {
    await app.close();
  });

  it('un vitals con typo (39.8°) dispara la alerta clínica (campana al círculo)', async () => {
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/vitals`)
      .set(bearer(familiar.token))
      .send({ operationId: uid('op-typo'), values: [{ metricKey: 'temperature', value: 39.8 }] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('recorded');
    originalId = res.body.id;

    const bells = await http(app).get('/api/v1/notifications').set(bearer(familiar.token));
    expect(bells.status).toBe(200);
    expect(bells.body.some((n: { title: string }) => n.title === 'Alerta clínica')).toBe(true);
  });

  it('la corrección crea la versión nueva con referencia y razón, y resuelve la alerta por corrección con campana', async () => {
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/records/${originalId}/corrections`)
      .set(bearer(familiar.token))
      .send({
        operationId: correctionOperationId,
        reason: 'Error de tipeo: era 36.8, no 39.8',
        values: [{ metricKey: 'temperature', value: 36.8 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('recorded');
    expect(res.body.supersedesRecordId).toBe(originalId);
    correctionId = res.body.id;

    const bells = await http(app).get('/api/v1/notifications').set(bearer(familiar.token));
    expect(bells.body.some((n: { title: string }) => n.title === 'Alerta resuelta por corrección')).toBe(true);
  });

  it('el historial conserva el original INTACTO y legible, marcado superseded, y la corrección con su razón', async () => {
    const history = await http(app)
      .get(`/api/v1/patients/${patientId}/history`)
      .set(bearer(familiar.token));
    expect(history.status).toBe(200);

    const original = history.body.find((r: { id: string }) => r.id === originalId);
    expect(original).toBeDefined();
    expect(original.data.values[0].value).toBe(39.8); // el original nunca se edita
    expect(original.supersededAt).toBeTruthy();
    expect(original.supersededByRecordId).toBe(correctionId);

    const correction = history.body.find((r: { id: string }) => r.id === correctionId);
    expect(correction).toMatchObject({
      supersedesRecordId: originalId,
      correctionReason: 'Error de tipeo: era 36.8, no 39.8',
    });
    // NFR-36: la corrección conserva el tiempo de medición del original.
    expect(correction.measuredAt).toBe(original.measuredAt);
  });

  it('el estado actual usa la versión vigente (36.8), no la superseded', async () => {
    const state = await http(app)
      .get(`/api/v1/patients/${patientId}/state`)
      .set(bearer(familiar.token));
    expect(state.status).toBe(200);

    const temp = state.body.metrics.find((m: { metricKey: string }) => m.metricKey === 'temperature');
    expect(temp.value).toBe(36.8);
  });

  it('reintento con el MISMO operationId: devuelve la misma corrección, sin duplicar (NFR-34)', async () => {
    const retry = await http(app)
      .post(`/api/v1/patients/${patientId}/records/${originalId}/corrections`)
      .set(bearer(familiar.token))
      .send({
        operationId: correctionOperationId,
        reason: 'Error de tipeo: era 36.8, no 39.8',
        values: [{ metricKey: 'temperature', value: 36.8 }],
      });

    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(correctionId);
  });

  it('corregir un registro ya superseded se rechaza (409): la corrección va sobre la versión vigente', async () => {
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/records/${originalId}/corrections`)
      .set(bearer(familiar.token))
      .send({
        operationId: uid('op-fix-again'),
        reason: 'Segunda corrección sobre el original',
        values: [{ metricKey: 'temperature', value: 37 }],
      });

    expect(res.status).toBe(409);
  });

  it('un valor corregido fuera de rango dispara una alerta NUEVA (re-evaluación completa)', async () => {
    const before = await http(app).get('/api/v1/notifications').set(bearer(familiar.token));
    const alertsBefore = before.body.filter((n: { title: string }) => n.title === 'Alerta clínica').length;

    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/records/${correctionId}/corrections`)
      .set(bearer(familiar.token))
      .send({
        operationId: uid('op-fix-out-of-range'),
        reason: 'La temperatura real era 39.1',
        values: [{ metricKey: 'temperature', value: 39.1 }],
      });

    expect(res.status).toBe(201);

    const after = await http(app).get('/api/v1/notifications').set(bearer(familiar.token));
    const alertsAfter = after.body.filter((n: { title: string }) => n.title === 'Alerta clínica').length;
    expect(alertsAfter).toBe(alertsBefore + 1);
  });

  it('sin relación con el paciente no se corrige: 403 (mismos permisos que el alta)', async () => {
    const extranio = await signup(app, 'family', 'Sin Vinculo');
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/records/${correctionId}/corrections`)
      .set(bearer(extranio.token))
      .send({
        operationId: uid('op-fix-forbidden'),
        reason: 'No debería poder',
        values: [{ metricKey: 'temperature', value: 36.5 }],
      });

    expect(res.status).toBe(403);
  });
});
