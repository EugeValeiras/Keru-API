import { INestApplication } from '@nestjs/common';
import {
  TestAccount,
  bearer,
  createApprovedCaregiver,
  createE2EApp,
  http,
  signupAdmin,
} from './e2e-utils';

/**
 * KER-74 · El detalle de admin (GET /admin/caregivers/:id, CaregiverDetailDto) expone photoUrl.
 *
 * La foto es identidad de la cuenta (ADR-0003/KER-54): el `CaregiverResponseDto` (pending/lista) ya
 * la exponía, pero el `CaregiverDetailDto` NO, así que la vista de detalle del back-office caía
 * siempre al avatar de iniciales. Este e2e fija el contrato: con foto → el detalle la devuelve;
 * sin foto → la omite (el cliente cae al avatar de iniciales). Mismo patrón que KER-65.
 */
describe('E2E · KER-74 · El detalle de admin expone photoUrl del cuidador', () => {
  let app: INestApplication;
  let admin: TestAccount;

  beforeAll(async () => {
    app = await createE2EApp();
    admin = await signupAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Dado un cuidador con foto en su cuenta, cuando el admin abre el detalle, entonces incluye photoUrl', async () => {
    const { account, caregiverId } = await createApprovedCaregiver(app, admin);

    // La foto es identidad de la cuenta (UC-23, ADR-0003): se setea por PATCH /accounts/me.
    const photoUrl = 'http://localhost:4566/keru-media/images/laura-detalle.jpg';
    const patched = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(account.token))
      .send({ photoUrl });
    expect(patched.status).toBe(200);

    const detail = await http(app)
      .get(`/api/v1/admin/caregivers/${caregiverId}`)
      .set(bearer(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: caregiverId, photoUrl });
  });

  it('Dado un cuidador SIN foto, cuando el admin abre el detalle, entonces photoUrl es nulo (fallback a iniciales)', async () => {
    const { caregiverId } = await createApprovedCaregiver(app, admin);

    const detail = await http(app)
      .get(`/api/v1/admin/caregivers/${caregiverId}`)
      .set(bearer(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(caregiverId);
    expect(detail.body.photoUrl ?? null).toBeNull();
  });
});
