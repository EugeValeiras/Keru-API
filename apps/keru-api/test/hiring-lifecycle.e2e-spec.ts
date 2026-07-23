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
 * Cierre y reseña desacoplados del pago (KER-31, Decouple row 49): completar el servicio
 * registra la razón terminal `completed`; la elegibilidad de reseña se apoya en el
 * completado (NFR-20) y "pagado" es una declaración opcional post-cierre (honor-mark,
 * NFR-10/58) que se registra una sola vez.
 */
describe('E2E · Completado vs pagado-declarado (UC-09/17/21, Decouple row 49)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let caregiver: { account: TestAccount; caregiverId: string };
  let patientId: string;
  let requestId: string;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Cierre');
    const admin = await signupAdmin(app);
    caregiver = await createApprovedCaregiver(app, admin.token);
    patientId = await registerPatient(app, familiar.token);

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

  it('antes del cierre no se puede declarar el pago ni reseñar', async () => {
    const paid = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/declare-paid`)
      .set(bearer(familiar.token));
    expect(paid.status).toBe(400);

    const review = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/review-caregiver`)
      .set(bearer(familiar.token))
      .send({ rating: 5 });
    expect(review.status).toBe(400);
  });

  it('el solicitante completa el servicio: cierre con razón terminal `completed`, sin tocar el pago', async () => {
    const res = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/complete`)
      .set(bearer(familiar.token));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'completed', terminalReason: 'completed' });
    expect(res.body.paidDeclaredAt).toBeUndefined();
  });

  it('la reseña es elegible por completado, sin pago declarado (NFR-20)', async () => {
    const review = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/review-caregiver`)
      .set(bearer(familiar.token))
      .send({ rating: 5, comment: 'Excelente servicio' });

    expect(review.status).toBe(201);
    expect(review.body.revealed).toBe(false); // sellada hasta la contraparte o la ventana (NFR-21)
  });

  it('declarar el pago es opcional, post-cierre e idempotente (honor-mark)', async () => {
    const first = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/declare-paid`)
      .set(bearer(familiar.token));
    expect(first.status).toBe(201);
    expect(first.body.paidDeclaredAt).toBeDefined();

    const again = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/declare-paid`)
      .set(bearer(familiar.token));
    expect(again.status).toBe(201);
    expect(again.body.paidDeclaredAt).toBe(first.body.paidDeclaredAt); // set-una-sola-vez
  });

  it('la contraparte reseña y el reveal simultáneo ocurre sin depender del pago (UC-21, NFR-21)', async () => {
    const review = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/review-patient`)
      .set(bearer(caregiver.account.token))
      .send({ rating: 4, comment: 'Familia atenta' });

    expect(review.status).toBe(201);
    expect(review.body.revealed).toBe(true);
  });
});
