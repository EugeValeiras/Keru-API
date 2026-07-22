import { INestApplication } from '@nestjs/common';
import {
  TestAccount,
  bearer,
  createE2EApp,
  http,
  registerPatient,
  signup,
  uid,
} from './e2e-utils';

/**
 * Authz por vínculo contra la app real (KER-28): la autorización sale del
 * KeruAuthorityProvider leyendo vínculos y asignaciones de la base — sin stubs.
 * Cubre el borde fino de UC-22/NFR-30: sin vínculo es 403; el rol del vínculo
 * (viewer vs consent-holder/manager) decide quién edita la ficha.
 */
describe('E2E · Authz por vínculo (UC-22, NFR-30)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let intruso: TestAccount;
  let patientId: string;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Titular');
    intruso = await signup(app, 'family', 'Cuenta Sin Vínculo');
    patientId = await registerPatient(app, familiar.token);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sin sesión: 401 en la ficha', async () => {
    const res = await http(app).get(`/api/v1/patients/${patientId}`);
    expect(res.status).toBe(401);
  });

  it('cuenta sin vínculo: 403 en ficha, state e history', async () => {
    for (const path of [
      `/api/v1/patients/${patientId}`,
      `/api/v1/patients/${patientId}/state`,
      `/api/v1/patients/${patientId}/history`,
    ]) {
      const res = await http(app).get(path).set(bearer(intruso.token));
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  it('el consent-holder ve la ficha con su linkRole y puede editarla', async () => {
    const ficha = await http(app).get(`/api/v1/patients/${patientId}`).set(bearer(familiar.token));
    expect(ficha.status).toBe(200);
    expect(ficha.body.linkRole).toBe('consent-holder');

    const edit = await http(app)
      .patch(`/api/v1/patients/${patientId}`)
      .set(bearer(familiar.token))
      .send({ mainCondition: 'Hipertensión controlada' });
    expect(edit.status).toBe(200);
    expect(edit.body.mainCondition).toBe('Hipertensión controlada');
  });

  it('un viewer invitado ve la ficha pero NO la edita (403)', async () => {
    // El vínculo viewer se crea por el flujo real: invitación + confirmación del invitado (UC-03).
    const viewer = await signup(app, 'family', 'Tía Viewer');
    const inv = await http(app)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(familiar.token))
      .send({ invitedEmail: viewer.email, role: 'viewer' });
    expect(inv.status).toBe(201);

    const confirm = await http(app)
      .post(`/api/v1/invitations/${inv.body.token}/confirm`)
      .set(bearer(viewer.token));
    expect(confirm.status).toBe(201);
    expect(confirm.body).toEqual({ patientId, role: 'viewer' });

    const ficha = await http(app).get(`/api/v1/patients/${patientId}`).set(bearer(viewer.token));
    expect(ficha.status).toBe(200);
    expect(ficha.body.linkRole).toBe('viewer');

    const edit = await http(app)
      .patch(`/api/v1/patients/${patientId}`)
      .set(bearer(viewer.token))
      .send({ mainCondition: 'no debería poder' });
    expect(edit.status).toBe(403);
  });

  it('cuidador sin relación alguna con el paciente: 403 seco al registrar (no cuarentena)', async () => {
    const ajeno = await signup(app, 'caregiver', 'Cuidador Ajeno');
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/vitals`)
      .set(bearer(ajeno.token))
      .send({ operationId: uid('op-vitals'), values: [{ metricKey: 'heart-rate', value: 80 }] });
    expect(res.status).toBe(403);
  });
});
