import { INestApplication } from '@nestjs/common';
import {
  TestAccount,
  bearer,
  createApprovedCaregiver,
  createE2EApp,
  http,
  signup,
  signupAdmin,
} from './e2e-utils';

/**
 * KER-54 · ADR-0003 · Una sola fuente de verdad de identidad (nombre/avatar) entre la cuenta y el
 * perfil de cuidador. La identidad canónica vive en la `Account`; el perfil de cuidador la deriva.
 * Editar nombre/foto en `PATCH /accounts/me` (UC-23) se refleja en el marketplace/ficha por
 * construcción (no hay campos duplicados que diverjan).
 */
describe('E2E · KER-54 · Identidad unificada cuenta↔perfil de cuidador (ADR-0003)', () => {
  let app: INestApplication;
  let admin: TestAccount;

  beforeAll(async () => {
    app = await createE2EApp();
    admin = await signupAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Dado un cuidador aprobado, cuando edita nombre y foto en /accounts/me, entonces el marketplace muestra la MISMA identidad', async () => {
    const { account, caregiverId } = await createApprovedCaregiver(app, admin);
    // El marketplace es para quien busca cuidado (@Roles family/patient): la familia ve las cards.
    const family = await signup(app, 'family', 'Familia Marketplace');

    // Estado inicial: la card del marketplace deriva el nombre de la cuenta (signup 'Laura Gómez').
    const before = await http(app)
      .get(`/api/v1/marketplace/caregivers/${caregiverId}`)
      .set(bearer(family.token));
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ displayName: 'Laura Gómez' });
    expect(before.body.photoUrl ?? null).toBeNull(); // sin foto todavía (cae al fallback)

    // El cuidador edita su identidad por su cuenta (UC-23): único punto de escritura (ADR-0003).
    const photoUrl = 'http://localhost:4566/keru-media/images/laura-nueva.jpg';
    const patched = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(account.token))
      .send({ displayName: 'Laura Gómez Actualizada', photoUrl });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ displayName: 'Laura Gómez Actualizada', photoUrl });

    // Coherencia: la ficha del marketplace refleja la nueva identidad SIN tocar el perfil de cuidador.
    const afterDetail = await http(app)
      .get(`/api/v1/marketplace/caregivers/${caregiverId}`)
      .set(bearer(family.token));
    expect(afterDetail.body).toMatchObject({ displayName: 'Laura Gómez Actualizada', photoUrl });

    // Y la lista del marketplace (cards) muestra la misma identidad unificada.
    const list = await http(app).get('/api/v1/marketplace/caregivers').set(bearer(family.token));
    const card = list.body.find((c: { id: string }) => c.id === caregiverId);
    expect(card).toMatchObject({ displayName: 'Laura Gómez Actualizada', photoUrl });
  });

  it('Dado un cuidador aprobado, cuando edita su perfil, entonces la foto NO se acepta por esa vía (es identidad de la cuenta, ADR-0003)', async () => {
    const { account } = await createApprovedCaregiver(app, admin);

    // La edición del perfil aprobado (UC-02 A3) ya no acepta `photoUrl`: se rechaza por validación.
    const res = await http(app)
      .patch('/api/v1/caregivers/me')
      .set(bearer(account.token))
      .send({ operationId: 'op-cg-photo-reject', photoUrl: 'http://localhost:4566/keru-media/images/x.jpg' });
    expect(res.status).toBe(400);
  });
});
