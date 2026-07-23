import { INestApplication } from '@nestjs/common';
import {
  TestAccount,
  bearer,
  createApprovedCaregiver,
  createE2EApp,
  daysFromNow,
  hiringRequestBody,
  http,
  patientBody,
  signup,
  signupAdmin,
  uid,
} from './e2e-utils';

/**
 * Idempotencia real por operationId (NFR-34) contra la base: repetir el POST con el MISMO
 * operationId devuelve el mismo recurso sin duplicar filas; con otro operationId sí crea.
 */
describe('E2E · Idempotencia por operationId (NFR-34)', () => {
  let app: INestApplication;
  let familiar: TestAccount;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Idempotente');
  });

  afterAll(async () => {
    await app.close();
  });

  it('repetir POST /patients con el mismo operationId no duplica al paciente', async () => {
    const body = patientBody(uid('op-patient-dup'));

    const first = await http(app).post('/api/v1/patients').set(bearer(familiar.token)).send(body);
    const retry = await http(app).post('/api/v1/patients').set(bearer(familiar.token)).send(body);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);

    const mine = await http(app).get('/api/v1/patients').set(bearer(familiar.token));
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);

    // Con OTRO operationId el mismo payload sí crea un paciente nuevo.
    const other = await http(app)
      .post('/api/v1/patients')
      .set(bearer(familiar.token))
      .send(patientBody(uid('op-patient-otro')));
    expect(other.status).toBe(201);
    expect(other.body.id).not.toBe(first.body.id);
  });

  it('repetir POST /hiring-requests con el mismo operationId no duplica la solicitud', async () => {
    const patientId = (
      await http(app)
        .post('/api/v1/patients')
        .set(bearer(familiar.token))
        .send(patientBody(uid('op-patient-hiring')))
    ).body.id;
    const admin = await signupAdmin(app);
    const { caregiverId } = await createApprovedCaregiver(app, admin);

    const body = hiringRequestBody(
      patientId,
      caregiverId,
      { startDate: daysFromNow(2), endDate: daysFromNow(9) },
      uid('op-hiring-dup'),
    );

    const first = await http(app).post('/api/v1/hiring-requests').set(bearer(familiar.token)).send(body);
    const retry = await http(app).post('/api/v1/hiring-requests').set(bearer(familiar.token)).send(body);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.status).toBe('pending');
    // El alta devuelve la entidad pre-persist ("3500") y el retry la fila de Postgres
    // ("3500.00", decimal): mismo snapshot, distinta serialización — se compara numérico.
    expect(Number(retry.body.ratePerHourSnapshot)).toBe(Number(first.body.ratePerHourSnapshot));

    const mine = await http(app).get('/api/v1/hiring-requests').set(bearer(familiar.token));
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
  });
});
