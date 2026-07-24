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
 * KER-81 · Minimización de datos: los DTOs admin de cuidadores NO exponen el `accountId` interno.
 *
 * El `accountId` correlaciona el perfil del cuidador con su `Account` Keru subyacente. Ningún flujo
 * del back-office (UC-19) lo necesita — aprobar/rechazar y descargar documentos operan por el `id`
 * del cuidador — así que exponerlo violaba §2 (minimización) sin razón funcional. Este e2e fija el
 * contrato: ni el detalle (`GET /admin/caregivers/:id`) ni el listado paginado
 * (`GET /admin/caregivers`) devuelven `accountId`.
 */
describe('E2E · KER-81 · Los DTOs admin de cuidadores no exponen accountId (minimización)', () => {
  let app: INestApplication;
  let admin: TestAccount;

  beforeAll(async () => {
    app = await createE2EApp();
    admin = await signupAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Dado un cuidador, cuando el admin abre el detalle, entonces la respuesta NO incluye accountId', async () => {
    const { caregiverId } = await createApprovedCaregiver(app, admin);

    const detail = await http(app)
      .get(`/api/v1/admin/caregivers/${caregiverId}`)
      .set(bearer(admin.token));

    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(caregiverId);
    expect(detail.body).not.toHaveProperty('accountId');
  });

  it('Dado el listado paginado de cuidadores, cuando el admin lo consulta, entonces ningún item incluye accountId', async () => {
    const { caregiverId } = await createApprovedCaregiver(app, admin);

    const list = await http(app)
      .get('/api/v1/admin/caregivers')
      .set(bearer(admin.token));

    expect(list.status).toBe(200);
    const item = list.body.items.find((c: { id: string }) => c.id === caregiverId);
    expect(item).toBeDefined();
    for (const c of list.body.items) {
      expect(c).not.toHaveProperty('accountId');
    }
  });
});
