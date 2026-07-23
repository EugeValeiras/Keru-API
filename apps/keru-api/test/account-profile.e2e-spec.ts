import { INestApplication } from '@nestjs/common';
import { TestAccount, bearer, createE2EApp, http, signup } from './e2e-utils';

/**
 * UC-23 · Perfil de la cuenta (KER-41). GET/PATCH /accounts/me contra la base real:
 * cualquier rol ve y edita su propia cuenta (nombre + foto); el email es de solo lectura;
 * el PATCH es naturalmente idempotente (NFR-34) y la foto viaja en la respuesta de auth
 * para que el header la pinte sin recargar.
 */
describe('E2E · UC-23 · Perfil de la cuenta (/accounts/me)', () => {
  let app: INestApplication;
  let familiar: TestAccount;

  beforeAll(async () => {
    app = await createE2EApp();
    familiar = await signup(app, 'family', 'Familiar Perfil');
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /accounts/me devuelve id, email, nombre, rol y foto (null al inicio)', async () => {
    const res = await http(app).get('/api/v1/accounts/me').set(bearer(familiar.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: familiar.accountId,
      email: familiar.email,
      displayName: 'Familiar Perfil',
      role: 'family',
      photoUrl: null,
    });
    // Nunca expone el hash del password.
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('cualquier rol ve su cuenta: un cuidador también accede a /accounts/me', async () => {
    const caregiver = await signup(app, 'caregiver', 'Cuidador Perfil');
    const res = await http(app).get('/api/v1/accounts/me').set(bearer(caregiver.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'caregiver', displayName: 'Cuidador Perfil' });
  });

  it('sin sesión, /accounts/me responde 401', async () => {
    expect((await http(app).get('/api/v1/accounts/me')).status).toBe(401);
    expect((await http(app).patch('/api/v1/accounts/me').send({ displayName: 'X' })).status).toBe(401);
  });

  it('PATCH edita nombre y foto; GET lo refleja y el login los devuelve (header sin recargar)', async () => {
    const account = await signup(app, 'family', 'Nombre Viejo');
    const photoUrl = 'http://localhost:4566/keru-media/images/perfil-nuevo.jpg';

    const patched = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(account.token))
      .send({ displayName: 'Nombre Nuevo', photoUrl });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ displayName: 'Nombre Nuevo', photoUrl });

    const fetched = await http(app).get('/api/v1/accounts/me').set(bearer(account.token));
    expect(fetched.body).toMatchObject({ displayName: 'Nombre Nuevo', photoUrl });

    // La foto viaja en la respuesta de auth (UC-23): un login fresco ya la trae.
    const relogin = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: account.password });
    expect(relogin.status).toBe(200);
    expect(relogin.body).toMatchObject({ displayName: 'Nombre Nuevo', photoUrl });
  });

  it('set parcial: mandar solo la foto no borra el nombre', async () => {
    const account = await signup(app, 'family', 'Solo Foto');
    const photoUrl = 'http://localhost:4566/keru-media/images/solo-foto.jpg';
    await http(app).patch('/api/v1/accounts/me').set(bearer(account.token)).send({ photoUrl });
    const fetched = await http(app).get('/api/v1/accounts/me').set(bearer(account.token));
    expect(fetched.body).toMatchObject({ displayName: 'Solo Foto', photoUrl });
  });

  it('quitar la foto (photoUrl: null) vuelve al fallback', async () => {
    const account = await signup(app, 'family', 'Quita Foto');
    await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(account.token))
      .send({ photoUrl: 'http://localhost:4566/keru-media/images/a-quitar.jpg' });
    const cleared = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(account.token))
      .send({ photoUrl: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.photoUrl).toBeNull();
  });

  it('PATCH es naturalmente idempotente: repetir el mismo patch deja el mismo estado', async () => {
    const account = await signup(app, 'family', 'Idempotente');
    const body = { displayName: 'Final', photoUrl: 'http://localhost:4566/keru-media/images/idem.jpg' };
    const first = await http(app).patch('/api/v1/accounts/me').set(bearer(account.token)).send(body);
    const retry = await http(app).patch('/api/v1/accounts/me').set(bearer(account.token)).send(body);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
  });

  it('el email no se edita por esta vía: mandarlo es rechazado (400)', async () => {
    const res = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(familiar.token))
      .send({ email: 'otro@e2e.keru.test' });
    expect(res.status).toBe(400);
    // El email real no cambió.
    const fetched = await http(app).get('/api/v1/accounts/me').set(bearer(familiar.token));
    expect(fetched.body.email).toBe(familiar.email);
  });

  it('el rol no se edita por esta vía: mandarlo es rechazado (400)', async () => {
    const res = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(familiar.token))
      .send({ role: 'admin' });
    expect(res.status).toBe(400);
    const fetched = await http(app).get('/api/v1/accounts/me').set(bearer(familiar.token));
    expect(fetched.body.role).toBe('family');
  });

  it('valida la foto: una URL de más de 500 chars es rechazada (400)', async () => {
    const tooLong = `http://localhost:4566/keru-media/images/${'a'.repeat(500)}.jpg`;
    const res = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(familiar.token))
      .send({ photoUrl: tooLong });
    expect(res.status).toBe(400);
  });

  it('valida el nombre: vacío es rechazado (400)', async () => {
    const res = await http(app)
      .patch('/api/v1/accounts/me')
      .set(bearer(familiar.token))
      .send({ displayName: '' });
    expect(res.status).toBe(400);
  });
});
