import { INestApplication } from '@nestjs/common';
import {
  TestAccount,
  bearer,
  createApprovedCaregiver,
  createE2EApp,
  daysFromNow,
  hiringRequestBody,
  http,
  registerPatient,
  signup,
  signupAdmin,
  uid,
} from './e2e-utils';

/**
 * KER-57 · La LECTURA clínica del cuidador va por la VIDA del servicio, no por la ventana
 * (constitution §3.7, UC-14 A2). Repro exacto del bug: familiar crea un servicio con inicio
 * FUTURO, el cuidador acepta y abre "Ver estado" -> antes daba 403 "Sin acceso"; ahora 200.
 * La ESCRITURA sigue atada a la ventana (NFR-30): fuera de ventana entra en cuarentena, no se
 * autoriza. Al cerrarse el servicio (asignación -> historical) la lectura se corta (403 real).
 */
describe('E2E · Lectura del cuidador por vida del servicio (KER-57, UC-14, NFR-30)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let caregiver: { account: TestAccount; caregiverId: string };
  let patientId: string;
  let requestId: string;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar KER-57');
    const admin = await signupAdmin(app);
    caregiver = await createApprovedCaregiver(app, admin);
    patientId = await registerPatient(app, familiar.token);

    // Servicio con INICIO FUTURO (mañana → +3 días): la ventana aún no arrancó.
    const created = await http(app)
      .post('/api/v1/hiring-requests')
      .set(bearer(familiar.token))
      .send(
        hiringRequestBody(patientId, caregiver.caregiverId, {
          startDate: daysFromNow(1),
          endDate: daysFromNow(3),
        }),
      );
    if (created.status !== 201) {
      throw new Error(`crear solicitud falló: ${created.status} ${JSON.stringify(created.body)}`);
    }
    requestId = created.body.id;

    const accepted = await http(app)
      .post(`/api/v1/caregiver/requests/${requestId}/accept`)
      .set(bearer(caregiver.account.token));
    if (accepted.status !== 201) {
      throw new Error(`aceptar solicitud falló: ${accepted.status} ${JSON.stringify(accepted.body)}`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('inicio futuro: el cuidador LEE estado e historial (200), aunque la ventana no arrancó', async () => {
    const state = await http(app)
      .get(`/api/v1/patients/${patientId}/state`)
      .set(bearer(caregiver.account.token));
    expect(state.status).toBe(200);

    const history = await http(app)
      .get(`/api/v1/patients/${patientId}/history`)
      .set(bearer(caregiver.account.token));
    expect(history.status).toBe(200);
  });

  it('inicio futuro: la ESCRITURA sigue fuera de ventana → cuarentena, no autorizada (NFR-30 intacto)', async () => {
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/vitals`)
      .set(bearer(caregiver.account.token))
      .send({ operationId: uid('op-vitals'), values: [{ metricKey: 'heart-rate', value: 78 }] });
    // 201 pero en cuarentena: la llegada fuera de ventana no se descarta ni se autoriza.
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('quarantined');
  });

  it('un cuidador SIN relación de servicio con el paciente: 403 seco en la lectura', async () => {
    const ajeno = await signup(app, 'caregiver', 'Cuidador Ajeno');
    const state = await http(app)
      .get(`/api/v1/patients/${patientId}/state`)
      .set(bearer(ajeno.token));
    expect(state.status).toBe(403);
  });

  it('al cerrarse el servicio (asignación → historical), la lectura del cuidador se corta (403 real)', async () => {
    const closed = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/complete`)
      .set(bearer(familiar.token));
    expect(closed.status).toBe(201);

    const state = await http(app)
      .get(`/api/v1/patients/${patientId}/state`)
      .set(bearer(caregiver.account.token));
    expect(state.status).toBe(403);
  });
});
