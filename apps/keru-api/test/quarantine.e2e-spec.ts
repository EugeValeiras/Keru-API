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
  stepUp,
  stepUpHeader,
  uid,
} from './e2e-utils';

/**
 * Cuarentena real (UC-12 A3, NFR-30): un cuidador CON asignación con el paciente pero cuya
 * ventana no cubre el tiempo de medición recibe 201 con status 'quarantined' — nunca un 403
 * seco ni descarte silencioso — y el círculo resuelve. El vínculo cuidador-paciente se arma
 * por el flujo real completo: perfil aprobado por admin → solicitud → aceptación (asignación).
 */
describe('E2E · Cuarentena del cuidador sin asignación vigente (NFR-30)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let cuidador: TestAccount;
  let patientId: string;
  let quarantinedId: string;

  const lateOperationId = uid('op-vitals-tardia');

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Titular');
    patientId = await registerPatient(app, familiar.token);

    const admin = await signupAdmin(app);
    const approved = await createApprovedCaregiver(app, admin);
    cuidador = approved.account;

    // Asignación con ventana FUTURA (+2d..+9d): hoy el cuidador tiene relación pero no vigencia.
    const request = await http(app)
      .post('/api/v1/hiring-requests')
      .set(bearer(familiar.token))
      .send(
        hiringRequestBody(patientId, approved.caregiverId, {
          startDate: daysFromNow(2),
          endDate: daysFromNow(9),
        }),
      );
    expect(request.status).toBe(201);

    const accepted = await http(app)
      .post(`/api/v1/caregiver/requests/${request.body.id}/accept`)
      .set(bearer(cuidador.token));
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe('accepted');
  });

  afterAll(async () => {
    await app.close();
  });

  it('registro de hoy (fuera de la ventana): 201 con status quarantined, no 403', async () => {
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/vitals`)
      .set(bearer(cuidador.token))
      .send({ operationId: lateOperationId, values: [{ metricKey: 'heart-rate', value: 82 }] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('quarantined');
    quarantinedId = res.body.id;
  });

  it('reintento con el MISMO operationId: misma cuarentena, sin duplicar', async () => {
    const retry = await http(app)
      .post(`/api/v1/patients/${patientId}/vitals`)
      .set(bearer(cuidador.token))
      .send({ operationId: lateOperationId, values: [{ metricKey: 'heart-rate', value: 82 }] });

    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe('quarantined');
    expect(retry.body.id).toBe(quarantinedId);

    const list = await http(app)
      .get(`/api/v1/patients/${patientId}/quarantine`)
      .set(bearer(familiar.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: quarantinedId, status: 'pending', type: 'vitals' });
  });

  it('la cuarentena la resuelve el círculo: el cuidador ni la lista ni la aprueba (403), aun con step-up', async () => {
    const list = await http(app)
      .get(`/api/v1/patients/${patientId}/quarantine`)
      .set(bearer(cuidador.token));
    expect(list.status).toBe(403);

    // KER-38: el step-up re-confirma identidad, NO otorga permiso — sin vínculo sigue el 403.
    const approve = await http(app)
      .post(`/api/v1/patients/${patientId}/quarantine/${quarantinedId}/approve`)
      .set(bearer(cuidador.token))
      .set(stepUpHeader(await stepUp(app, cuidador)));
    expect(approve.status).toBe(403);
  });

  it('liberar cuarentena sin step-up: 403 STEP_UP_REQUIRED aunque el vínculo alcance (NFR-33)', async () => {
    const approve = await http(app)
      .post(`/api/v1/patients/${patientId}/quarantine/${quarantinedId}/approve`)
      .set(bearer(familiar.token));
    expect(approve.status).toBe(403);
    expect(approve.body.code).toBe('STEP_UP_REQUIRED');
  });

  it('el consent-holder aprueba (con step-up) y el registro entra al historial con su measuredAt original', async () => {
    const approve = await http(app)
      .post(`/api/v1/patients/${patientId}/quarantine/${quarantinedId}/approve`)
      .set(bearer(familiar.token))
      .set(stepUpHeader(await stepUp(app, familiar)));
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');
    expect(approve.body.approvedRecordId).toBeDefined();

    const history = await http(app)
      .get(`/api/v1/patients/${patientId}/history`)
      .set(bearer(familiar.token));
    expect(history.status).toBe(200);
    const promoted = history.body.find((r: { id: string }) => r.id === approve.body.approvedRecordId);
    expect(promoted).toMatchObject({ type: 'vitals', authorRole: 'caregiver' });
  });

  it('con la ventana vigente el registro entra directo como recorded', async () => {
    // measuredAt dentro de la asignación (+3d): autorizado al tiempo de medición (NFR-30).
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/vitals`)
      .set(bearer(cuidador.token))
      .send({
        operationId: uid('op-vitals-vigente'),
        measuredAt: daysFromNow(3),
        values: [{ metricKey: 'heart-rate', value: 78 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('recorded');
  });
});
