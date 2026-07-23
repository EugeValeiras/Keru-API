import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { TestAccount, bearer, createE2EApp, http, registerPatient, signup } from './e2e-utils';

/**
 * KER-47 · UC-03 A1 + UC-04 A5: definir contraseña en el primer acceso (first-login). App real
 * (Postgres + Redis). Camino completo: aceptar una invitación sin estar registrado crea la cuenta
 * SIN contraseña (sesión limitada MUST_SET_PASSWORD) → los endpoints de negocio la bloquean → setea
 * la contraseña (misma fuerza que el alta) → accede con normalidad y la nueva contraseña sirve para login.
 */
describe('E2E · Primer acceso: definir contraseña por invitación (KER-47, UC-04 A5)', () => {
  let app: INestApplication;
  let db: DataSource;
  let familiar: TestAccount;
  let patientId: string;

  beforeAll(async () => {
    app = await createE2EApp();
    db = app.get(DataSource);
    familiar = await signup(app, 'family', 'Familiar Titular');
    patientId = await registerPatient(app, familiar.token);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Emite una invitación a un email nuevo (no registrado) y devuelve su token. */
  const inviteFreshEmail = async (): Promise<{ token: string; email: string }> => {
    const email = `nuevo-${randomUUID()}@e2e.keru.test`;
    const res = await http(app)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(familiar.token))
      .send({ invitedEmail: email, role: 'manager' });
    expect(res.status).toBe(201);
    return { token: res.body.token, email };
  };

  it('aceptar sin registro crea la cuenta con sesión limitada (mustSetPassword) y la vincula', async () => {
    const { token, email } = await inviteFreshEmail();

    const accept = await http(app).post(`/api/v1/invitations/${token}/accept`).send();
    expect(accept.status).toBe(201);
    expect(accept.body.email).toBe(email);
    expect(accept.body.role).toBe('family');
    expect(accept.body.mustSetPassword).toBe(true);
    expect(accept.body.accessToken).toBeTruthy();

    // El alta quedó auditada como creada por invitación.
    const audit = (await db.query(
      `SELECT metadata FROM audit_log WHERE actor = $1 AND action = 'membership.account.created'`,
      [accept.body.accountId],
    )) as Array<{ metadata: { via?: string } }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata.via).toBe('invitation');
  });

  it('la sesión limitada NO puede usar la app: 403 MUST_SET_PASSWORD en un endpoint de negocio', async () => {
    const { token } = await inviteFreshEmail();
    const accept = await http(app).post(`/api/v1/invitations/${token}/accept`).send();
    const limited = accept.body.accessToken as string;

    const blocked = await http(app).get('/api/v1/notifications').set(bearer(limited));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MUST_SET_PASSWORD');
  });

  it('setea la contraseña (misma fuerza que el alta), auto-loguea con sesión completa y accede', async () => {
    const { token, email } = await inviteFreshEmail();
    const accept = await http(app).post(`/api/v1/invitations/${token}/accept`).send();
    const limited = accept.body.accessToken as string;

    // Contraseña débil → 400 (misma validación que el alta).
    const weak = await http(app).post('/api/v1/auth/set-password').set(bearer(limited)).send({ newPassword: 'corta' });
    expect(weak.status).toBe(400);

    // Contraseña fuerte → 200, sesión completa (mustSetPassword=false) y auto-login.
    const set = await http(app)
      .post('/api/v1/auth/set-password')
      .set(bearer(limited))
      .send({ newPassword: 'PrimeraClave!123' });
    expect(set.status).toBe(200);
    expect(set.body.mustSetPassword).toBe(false);
    const full = set.body.accessToken as string;

    // El uso quedó auditado.
    const audit = (await db.query(
      `SELECT action FROM audit_log WHERE actor = $1 AND action = 'auth.first-login.password-set'`,
      [accept.body.accountId],
    )) as unknown[];
    expect(audit).toHaveLength(1);

    // Con la sesión completa ya accede a la app.
    const ok = await http(app).get('/api/v1/notifications').set(bearer(full));
    expect(ok.status).toBe(200);

    // Ya vinculado: ve la ficha del paciente con su rol manager.
    const ficha = await http(app).get(`/api/v1/patients/${patientId}`).set(bearer(full));
    expect(ficha.status).toBe(200);
    expect(ficha.body.linkRole).toBe('manager');

    // La contraseña nueva sirve para login normal en adelante.
    const login = await http(app).post('/api/v1/auth/login').send({ email, password: 'PrimeraClave!123' });
    expect(login.status).toBe(200);
    expect(login.body.mustSetPassword).toBe(false);
  });

  it('no se puede loguear antes de definir la contraseña (401) ni re-setearla después (409)', async () => {
    const { token, email } = await inviteFreshEmail();
    const accept = await http(app).post(`/api/v1/invitations/${token}/accept`).send();
    const limited = accept.body.accessToken as string;

    // Login antes de definirla → 401 (no puede loguearse sin contraseña).
    const early = await http(app).post('/api/v1/auth/login').send({ email, password: 'loquesea123' });
    expect(early.status).toBe(401);

    // Define la contraseña.
    const set = await http(app).post('/api/v1/auth/set-password').set(bearer(limited)).send({ newPassword: 'OtraClave!456' });
    expect(set.status).toBe(200);
    const full = set.body.accessToken as string;

    // Re-setear (con la sesión completa) → 409: la cuenta ya tiene contraseña (idempotencia por estado).
    const again = await http(app).post('/api/v1/auth/set-password').set(bearer(full)).send({ newPassword: 'Tercera!789' });
    expect(again.status).toBe(409);
  });

  it('aceptar por invitación un email que YA tiene cuenta → 409, y re-aceptar un token usado → 400', async () => {
    // Email ya registrado: aceptar por invitación devuelve 409 (que inicie sesión y confirme).
    const registrado = await signup(app, 'family', 'Ya Registrada');
    const invRes = await http(app)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(familiar.token))
      .send({ invitedEmail: registrado.email, role: 'viewer' });
    const conflict = await http(app).post(`/api/v1/invitations/${invRes.body.token}/accept`).send();
    expect(conflict.status).toBe(409);

    // Token de un solo uso: aceptar dos veces un token nuevo falla la segunda (400).
    const { token } = await inviteFreshEmail();
    const first = await http(app).post(`/api/v1/invitations/${token}/accept`).send();
    expect(first.status).toBe(201);
    const second = await http(app).post(`/api/v1/invitations/${token}/accept`).send();
    expect(second.status).toBe(400);
  });
});
