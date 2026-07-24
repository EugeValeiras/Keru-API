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
} from './e2e-utils';

/**
 * KER-58 (UC-05 A1 / UC-09 A5, NFR-14): el reloj del ciclo de vida del servicio. El barrido de
 * vencidos transiciona por tiempo — `accepted → in-progress` al entrar en ventana y
 * `accepted|in-progress → completed` al pasar `endDate` — sin intervención de un actor, poblando
 * "Finalizados" y habilitando la calificación (NFR-20). Idempotente y sin pisar cancelación/no-show.
 */
describe('E2E · Barrido del ciclo de vida del servicio (UC-09 A5, NFR-14)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let admin: TestAccount;
  let caregiver: { account: TestAccount; caregiverId: string };

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Barrido');
    admin = await signupAdmin(app);
    caregiver = await createApprovedCaregiver(app, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  // Cada servicio usa su propio paciente: NFR-35 impide dos asignaciones activas para el mismo
  // par cuidador↔paciente, y varios tests dejan asignaciones vivas (in-progress) en paralelo.
  async function createAccepted(window: { startDate: string; endDate: string }): Promise<string> {
    const patient = await registerPatient(app, familiar.token);
    const created = await http(app)
      .post('/api/v1/hiring-requests')
      .set(bearer(familiar.token))
      .send(hiringRequestBody(patient, caregiver.caregiverId, window));
    if (created.status !== 201) {
      throw new Error(`crear solicitud falló: ${created.status} ${JSON.stringify(created.body)}`);
    }
    const requestId = created.body.id as string;
    const accepted = await http(app)
      .post(`/api/v1/caregiver/requests/${requestId}/accept`)
      .set(bearer(caregiver.account.token));
    if (accepted.status !== 201) {
      throw new Error(`aceptar solicitud falló: ${accepted.status} ${JSON.stringify(accepted.body)}`);
    }
    return requestId;
  }

  const sweep = () =>
    http(app).post('/api/v1/admin/ops/sweep').set(bearer(admin.token));

  const requesterItem = async (requestId: string) => {
    const list = await http(app).get('/api/v1/hiring-requests').set(bearer(familiar.token));
    return list.body.find((r: { id: string }) => r.id === requestId);
  };

  it('Dado un servicio cuya ventana venció, cuando corre el barrido, entonces queda `completed`/`completed`, sale de activos y aparece en Finalizados', async () => {
    const requestId = await createAccepted({ startDate: daysFromNow(-3), endDate: daysFromNow(-1) });

    // Antes del barrido: sigue aceptado (activo).
    expect((await requesterItem(requestId)).status).toBe('accepted');

    const res = await sweep();
    expect(res.status).toBe(201);
    expect(res.body.requestsCompleted).toBeGreaterThanOrEqual(1);

    const item = await requesterItem(requestId);
    expect(item).toMatchObject({ status: 'completed', terminalReason: 'completed' });
  });

  it('El servicio cerrado por vencimiento habilita la calificación automáticamente (NFR-20)', async () => {
    // Reusa el servicio vencido del test anterior contratando uno nuevo y barriendo.
    const requestId = await createAccepted({ startDate: daysFromNow(-4), endDate: daysFromNow(-2) });
    await sweep();

    const review = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/review-caregiver`)
      .set(bearer(familiar.token))
      .send({ rating: 5, comment: 'Servicio completo' });
    expect(review.status).toBe(201);
  });

  it('Dado un servicio aceptado dentro de ventana, cuando corre el barrido, entonces pasa a `in-progress` (badge "En curso" real)', async () => {
    const requestId = await createAccepted({ startDate: daysFromNow(-1), endDate: daysFromNow(2) });

    const res = await sweep();
    expect(res.status).toBe(201);
    expect(res.body.requestsStarted).toBeGreaterThanOrEqual(1);

    expect((await requesterItem(requestId)).status).toBe('in-progress');
  });

  it('Idempotencia: un segundo barrido no re-transiciona ni duplica (multi-instancia-safe)', async () => {
    const requestId = await createAccepted({ startDate: daysFromNow(-3), endDate: daysFromNow(-1) });

    const first = await sweep();
    const before = await requesterItem(requestId);
    const second = await sweep();

    // El segundo barrido no vuelve a contar este servicio como recién completado.
    expect(second.body.requestsCompleted).toBeLessThan(first.body.requestsCompleted);
    expect((await requesterItem(requestId)).decidedAt).toBe(before.decidedAt);
  });

  it('No-clobber: un servicio cancelado antes del barrido conserva su razón terminal (no lo pisa `completed`)', async () => {
    const requestId = await createAccepted({ startDate: daysFromNow(-3), endDate: daysFromNow(-1) });

    const cancel = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/cancel-active`)
      .set(bearer(familiar.token))
      .send({ operationId: `op-cancel-${requestId}`, note: 'Cambio de planes' });
    expect(cancel.status).toBe(201);

    await sweep();

    const item = await requesterItem(requestId);
    expect(item).toMatchObject({ status: 'completed', terminalReason: 'cancelled-by-requester' });
  });
});
