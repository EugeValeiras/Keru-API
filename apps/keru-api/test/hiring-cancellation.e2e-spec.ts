import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
 * KER-32 (UC-09 A3/A4, UC-16 A2, NFR-15/23, stressor #27): cancelación de la asignación ACTIVA
 * por los tres actores con razón terminal + audit + campana a la contraparte (outbox), no-show
 * registrable con timestamp, y rehire urgente con tarifa re-pinneada y diff a la vista.
 */
describe('E2E · Cancelación de asignación activa, no-show y rehire urgente (KER-32)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let admin: TestAccount;
  let caregiver: { account: TestAccount; caregiverId: string };
  let patientId: string;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Cancelaciones');
    admin = await signupAdmin(app);
    caregiver = await createApprovedCaregiver(app, admin);
    patientId = await registerPatient(app, familiar.token);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  /** Crea una solicitud y la deja ACEPTADA (asignación activa). */
  async function createAcceptedRequest(): Promise<string> {
    const created = await http(app)
      .post('/api/v1/hiring-requests')
      .set(bearer(familiar.token))
      .send(
        hiringRequestBody(patientId, caregiver.caregiverId, {
          startDate: daysFromNow(1),
          endDate: daysFromNow(3),
        }),
      );
    if (created.status !== 201) throw new Error(`crear solicitud falló: ${created.status}`);
    const accepted = await http(app)
      .post(`/api/v1/caregiver/requests/${created.body.id}/accept`)
      .set(bearer(caregiver.account.token));
    if (accepted.status !== 201) throw new Error(`aceptar solicitud falló: ${accepted.status}`);
    return created.body.id as string;
  }

  /** Espera la campana (UC-18) hasta que aparezca una notificación que cumpla el predicado. */
  async function waitForBell(
    token: string,
    predicate: (n: { type: string; title: string; body: string }) => boolean,
    timeoutMs = 20000,
  ): Promise<{ type: string; title: string; body: string }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await http(app).get('/api/v1/notifications').set(bearer(token));
      const match = (res.body as Array<{ type: string; title: string; body: string }>).find(predicate);
      if (match) return match;
      if (Date.now() > deadline) {
        throw new Error(`campana no llegó a tiempo; recibidas: ${JSON.stringify(res.body)}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  it('UC-09 A3 · el solicitante cancela la asignación activa: razón `cancelled-by-requester` y campana al cuidador', async () => {
    const requestId = await createAcceptedRequest();

    const res = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/cancel-active`)
      .set(bearer(familiar.token))
      .send({ operationId: randomUUID(), note: 'Internación imprevista' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'completed', terminalReason: 'cancelled-by-requester' });

    // La campana es la garantía (§2.7): el cuidador ve la cancelación con la nota.
    const bell = await waitForBell(
      caregiver.account.token,
      (n) => n.type === 'hiring' && n.body.includes('Internación imprevista'),
    );
    expect(bell.title).toBe('Asignación cancelada');
    expect(bell.body).toContain('El solicitante canceló');
  });

  it('UC-09 A3 · un cierre cancelado NO habilita reseñas (NFR-20: decide la razón terminal)', async () => {
    // La solicitud del test anterior quedó status=completed pero razón cancelled-by-requester.
    const mine = await http(app).get('/api/v1/hiring-requests').set(bearer(familiar.token));
    const cancelled = (mine.body as Array<{ id: string; terminalReason?: string }>).find(
      (r) => r.terminalReason === 'cancelled-by-requester',
    );
    expect(cancelled).toBeDefined();

    const review = await http(app)
      .post(`/api/v1/hiring-requests/${cancelled!.id}/review-caregiver`)
      .set(bearer(familiar.token))
      .send({ rating: 5, comment: 'no debería poder' });
    expect(review.status).toBe(400);
  });

  it('UC-09 A3 · el cuidador cancela la asignación activa: razón `cancelled-by-caregiver` y campana al solicitante', async () => {
    const requestId = await createAcceptedRequest();

    const res = await http(app)
      .post(`/api/v1/caregiver/requests/${requestId}/cancel-active`)
      .set(bearer(caregiver.account.token))
      .send({ operationId: randomUUID(), note: 'Problema de salud propio' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'completed', terminalReason: 'cancelled-by-caregiver' });

    const bell = await waitForBell(
      familiar.token,
      (n) => n.type === 'hiring' && n.body.includes('Problema de salud propio'),
    );
    expect(bell.body).toContain('El cuidador canceló');
  });

  it('UC-09 A3 · un admin cancela la asignación activa: razón `cancelled-by-admin` y campana a AMBAS partes', async () => {
    const requestId = await createAcceptedRequest();

    const res = await http(app)
      .post(`/api/v1/admin/hiring-requests/${requestId}/cancel-active`)
      .set(bearer(admin.token))
      .send({ operationId: randomUUID(), note: 'Incumplimiento reportado por soporte' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'completed', terminalReason: 'cancelled-by-admin' });

    const familiarBell = await waitForBell(
      familiar.token,
      (n) => n.type === 'hiring' && n.body.includes('Incumplimiento reportado por soporte'),
    );
    expect(familiarBell.body).toContain('administrador');
    await waitForBell(
      caregiver.account.token,
      (n) => n.type === 'hiring' && n.body.includes('Incumplimiento reportado por soporte'),
    );
  });

  it('UC-09 A4 · el solicitante registra el no-show con timestamp: razón `no-show` y campana al cuidador', async () => {
    const requestId = await createAcceptedRequest();
    const occurredAt = new Date().toISOString();

    const res = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/no-show`)
      .set(bearer(familiar.token))
      .send({ operationId: randomUUID(), occurredAt, note: 'No llegó al turno de la mañana' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'completed', terminalReason: 'no-show' });
    expect(new Date(res.body.noShowReportedAt).toISOString()).toBe(occurredAt);

    const bell = await waitForBell(
      caregiver.account.token,
      (n) => n.type === 'hiring' && n.body.includes('No llegó al turno de la mañana'),
    );
    expect(bell.title).toBe('No-show registrado');
  });

  it('UC-16 A2 · rehire urgente: re-solicitud dirigida con tarifa re-pinneada y diff anterior vs vigente', async () => {
    // El cuidador subió su tarifa después de las contrataciones previas (efectivo-fechada, UC-02 A3).
    const patched = await http(app)
      .patch('/api/v1/caregivers/me')
      .set(bearer(caregiver.account.token))
      .send({ operationId: randomUUID(), rates: { ratePerHour: 5000, currency: 'ARS' } });
    expect(patched.status).toBe(200);

    const res = await http(app)
      .post('/api/v1/hiring-requests/rehire')
      .set(bearer(familiar.token))
      .send(
        hiringRequestBody(patientId, caregiver.caregiverId, {
          startDate: daysFromNow(1),
          endDate: daysFromNow(2),
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    // Diff mínimo (NFR-23): la anterior pinneada vs la vigente re-pinneada (NFR-03/21).
    expect(res.body.rateDiff).toMatchObject({
      previousRatePerHour: '3500.00',
      currentRatePerHour: '5000',
      currency: 'ARS',
      changed: true,
    });

    // El ciclo sigue normal (UC-10): el cuidador acepta la re-solicitud.
    const accepted = await http(app)
      .post(`/api/v1/caregiver/requests/${res.body.id}/accept`)
      .set(bearer(caregiver.account.token));
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe('accepted');

    // Limpieza del par: cerrar para no dejar asignación activa colgando.
    const closed = await http(app)
      .post(`/api/v1/hiring-requests/${res.body.id}/cancel-active`)
      .set(bearer(familiar.token))
      .send({ operationId: randomUUID() });
    expect(closed.status).toBe(201);
  });

  it('UC-16 A2 · el rehire urgente exige contratación previa: cuidador nunca contratado → 400', async () => {
    const otro = await createApprovedCaregiver(app, admin);

    const res = await http(app)
      .post('/api/v1/hiring-requests/rehire')
      .set(bearer(familiar.token))
      .send(
        hiringRequestBody(patientId, otro.caregiverId, {
          startDate: daysFromNow(1),
          endDate: daysFromNow(2),
        }),
      );

    expect(res.status).toBe(400);
  });

  it('Autorización · un tercero no puede cancelar la asignación activa ajena (403) y una pendiente no se cancela por esta vía (400)', async () => {
    const requestId = await createAcceptedRequest();

    // Familiar ajeno al paciente → 403.
    const intruso = await signup(app, 'family', 'Familiar Intruso');
    const foreign = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/cancel-active`)
      .set(bearer(intruso.token))
      .send({ operationId: randomUUID() });
    expect(foreign.status).toBe(403);

    // Cerrar la activa para poder crear una pendiente nueva del mismo par.
    const closed = await http(app)
      .post(`/api/v1/hiring-requests/${requestId}/cancel-active`)
      .set(bearer(familiar.token))
      .send({ operationId: randomUUID() });
    expect(closed.status).toBe(201);

    // Una solicitud PENDIENTE no tiene asignación activa que cerrar → 400 (para eso está UC-09 A2).
    const pending = await http(app)
      .post('/api/v1/hiring-requests')
      .set(bearer(familiar.token))
      .send(
        hiringRequestBody(patientId, caregiver.caregiverId, {
          startDate: daysFromNow(5),
          endDate: daysFromNow(6),
        }),
      );
    expect(pending.status).toBe(201);
    const notActive = await http(app)
      .post(`/api/v1/hiring-requests/${pending.body.id}/cancel-active`)
      .set(bearer(familiar.token))
      .send({ operationId: randomUUID() });
    expect(notActive.status).toBe(400);
  });
});
