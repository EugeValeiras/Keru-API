import { INestApplication } from '@nestjs/common';
import {
  TestAccount,
  bearer,
  createE2EApp,
  http,
  patientBody,
  registerPatient,
  signup,
  signupAdmin,
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

/**
 * Authz por ROL DE CUENTA al administrar perfiles de paciente (KER-50, §2.4 rol Y vínculo):
 * registrar (UC-01) y unirse al círculo (UC-03) son capacidad de `family`. Cubre el gate que
 * antes faltaba en POST /patients y el invariante "solo cuentas family tienen vínculo".
 */
describe('E2E · Quién registra/administra pacientes por rol de cuenta (KER-50)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('family registra OK y queda como consent-holder (camino legítimo intacto)', async () => {
    const familiar = await signup(app, 'family', 'Familiar Titular');
    const res = await http(app).post('/api/v1/patients').set(bearer(familiar.token)).send(patientBody());
    expect(res.status).toBe(201);
    const patientId = res.body.id as string;

    // El consent-holder quedó bien asignado: el creador ve la ficha con linkRole consent-holder.
    const ficha = await http(app).get(`/api/v1/patients/${patientId}`).set(bearer(familiar.token));
    expect(ficha.status).toBe(200);
    expect(ficha.body.linkRole).toBe('consent-holder');
  });

  it('caregiver: 403 al registrar un paciente (no es capacidad de su rol)', async () => {
    const cuidador = await signup(app, 'caregiver', 'Cuidador');
    const res = await http(app).post('/api/v1/patients').set(bearer(cuidador.token)).send(patientBody());
    expect(res.status).toBe(403);
  });

  it('admin: 403 al registrar un paciente (rol interno, no administra fichas)', async () => {
    const admin = await signupAdmin(app);
    const res = await http(app).post('/api/v1/patients').set(bearer(admin.token)).send(patientBody());
    expect(res.status).toBe(403);
  });

  it("self-signup con role 'patient' (o 'admin'): 400 de validación (KER-50)", async () => {
    for (const role of ['patient', 'admin']) {
      const res = await http(app)
        .post('/api/v1/auth/signup')
        .send({ email: `${role}-${uid('e')}@e2e.keru.test`, password: 'S3gura!123', role, displayName: 'X' });
      expect({ role, status: res.status }).toEqual({ role, status: 400 });
    }
  });

  it('invariante: un caregiver invitado NO puede confirmar y sumarse al círculo (403)', async () => {
    const familiar = await signup(app, 'family', 'Titular');
    const patientId = await registerPatient(app, familiar.token);
    const cuidador = await signup(app, 'caregiver', 'Cuidador Invitado');

    const inv = await http(app)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(familiar.token))
      .send({ invitedEmail: cuidador.email, role: 'viewer' });
    expect(inv.status).toBe(201);

    // La invitación es válida, pero el rol de cuenta del invitado no es family → 403 al confirmar.
    const confirm = await http(app)
      .post(`/api/v1/invitations/${inv.body.token}/confirm`)
      .set(bearer(cuidador.token));
    expect(confirm.status).toBe(403);

    // Y sigue sin vínculo: no ve la ficha.
    const ficha = await http(app).get(`/api/v1/patients/${patientId}`).set(bearer(cuidador.token));
    expect(ficha.status).toBe(403);
  });
});
