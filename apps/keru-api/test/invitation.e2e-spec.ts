import { INestApplication } from '@nestjs/common';
import {
  TestAccount,
  bearer,
  createE2EApp,
  http,
  registerPatient,
  signup,
} from './e2e-utils';

/**
 * Ciclo completo de invitación con revocación (UC-03): emitir → preview pública → revocar
 * (solo emisor o consent-holder; idempotente) → la revocada no se confirma. Y el camino
 * feliz de contraste: una segunda invitación confirmada crea el vínculo con el rol invitado,
 * y una aceptada ya no se puede revocar.
 */
describe('E2E · Invitación de vínculo con revocación (UC-03)', () => {
  let app: INestApplication;
  let familiar: TestAccount;
  let invitado: TestAccount;
  let tercero: TestAccount;
  let patientId: string;
  let token: string;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Titular');
    invitado = await signup(app, 'family', 'Hermana Invitada');
    tercero = await signup(app, 'family', 'Tercero Ajeno');
    patientId = await registerPatient(app, familiar.token);
  });

  afterAll(async () => {
    await app.close();
  });

  it('el vinculado emite la invitación y la lista como pendiente', async () => {
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(familiar.token))
      .send({ invitedEmail: invitado.email, role: 'manager' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ patientId, status: 'pending' });
    expect(res.body.link).toContain(res.body.token);
    token = res.body.token;

    const list = await http(app)
      .get(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(familiar.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ token, status: 'pending', roleToGrant: 'manager' });
  });

  it('la preview es pública y reporta la invitación como válida', async () => {
    const res = await http(app).get(`/api/v1/invitations/${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ patientId, valid: true });
  });

  it('un tercero (ni emisor ni consent-holder) no puede revocarla', async () => {
    const res = await http(app)
      .post(`/api/v1/invitations/${token}/revoke`)
      .set(bearer(tercero.token));
    expect(res.status).toBe(403);
  });

  it('el emisor la revoca; re-revocar es un no-op idempotente', async () => {
    const revoked = await http(app)
      .post(`/api/v1/invitations/${token}/revoke`)
      .set(bearer(familiar.token));
    expect(revoked.status).toBe(201);
    expect(revoked.body.status).toBe('revoked');

    const again = await http(app)
      .post(`/api/v1/invitations/${token}/revoke`)
      .set(bearer(familiar.token));
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('revoked');
  });

  it('la revocada queda inutilizable: preview inválida y confirmación rechazada', async () => {
    const preview = await http(app).get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.valid).toBe(false);

    const confirm = await http(app)
      .post(`/api/v1/invitations/${token}/confirm`)
      .set(bearer(invitado.token));
    expect(confirm.status).toBe(400);

    // El invitado sigue sin vínculo: la ficha le responde 403.
    const ficha = await http(app).get(`/api/v1/patients/${patientId}`).set(bearer(invitado.token));
    expect(ficha.status).toBe(403);
  });

  it('una segunda invitación confirmada crea el vínculo; la aceptada ya no se revoca', async () => {
    const second = await http(app)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(familiar.token))
      .send({ invitedEmail: invitado.email, role: 'manager' });
    expect(second.status).toBe(201);

    const confirm = await http(app)
      .post(`/api/v1/invitations/${second.body.token}/confirm`)
      .set(bearer(invitado.token));
    expect(confirm.status).toBe(201);
    expect(confirm.body).toEqual({ patientId, role: 'manager' });

    // El vínculo manager es real: ve la ficha y puede editarla (UC-22).
    const ficha = await http(app).get(`/api/v1/patients/${patientId}`).set(bearer(invitado.token));
    expect(ficha.status).toBe(200);
    expect(ficha.body.linkRole).toBe('manager');

    const revoke = await http(app)
      .post(`/api/v1/invitations/${second.body.token}/revoke`)
      .set(bearer(familiar.token));
    expect(revoke.status).toBe(400);
  });
});
