import { INestApplication } from '@nestjs/common';
import { TestAccount, bearer, createE2EApp, http, patientBody, signup, uid } from './e2e-utils';

/**
 * KER-65 · La foto del paciente en el LISTADO (GET /patients). El dato ya se persiste en el alta
 * (photoUrl) y el detalle GET /patients/:id lo devuelve; el bug era que el listado no lo exponía.
 * Contrato: GET /patients incluye photoUrl cuando el paciente tiene foto, y lo omite cuando no
 * (fallback a iniciales en el cliente). UC-22.
 */
describe('E2E · El listado de pacientes expone photoUrl (KER-65, UC-22)', () => {
  let app: INestApplication;
  let titular: TestAccount;
  const photo = 'https://cdn.keru.app/p/rosa-e2e.jpg';

  beforeAll(async () => {
    app = await createE2EApp();
    titular = await signup(app, 'family', 'Titular Listado');

    // Un paciente CON foto y otro SIN foto, para cubrir ambos caminos del binding.
    const withPhoto = await http(app)
      .post('/api/v1/patients')
      .set(bearer(titular.token))
      .send({ ...patientBody(uid('op-with-photo')), fullName: 'Con Foto', photoUrl: photo });
    expect(withPhoto.status).toBe(201);
    // El alta también devuelve el campo por consistencia con el listado.
    expect(withPhoto.body.photoUrl).toBe(photo);

    const withoutPhoto = await http(app)
      .post('/api/v1/patients')
      .set(bearer(titular.token))
      .send({ ...patientBody(uid('op-no-photo')), fullName: 'Sin Foto' });
    expect(withoutPhoto.status).toBe(201);
    expect(withoutPhoto.body.photoUrl).toBeUndefined();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /patients devuelve photoUrl para el paciente con foto y lo omite para el que no tiene', async () => {
    const res = await http(app).get('/api/v1/patients').set(bearer(titular.token));
    expect(res.status).toBe(200);

    const conFoto = res.body.find((p: { fullName: string }) => p.fullName === 'Con Foto');
    const sinFoto = res.body.find((p: { fullName: string }) => p.fullName === 'Sin Foto');
    expect(conFoto).toBeDefined();
    expect(sinFoto).toBeDefined();

    expect(conFoto.photoUrl).toBe(photo);
    // Sin foto: el campo se omite (no null), para que el cliente caiga al avatar de iniciales.
    expect(sinFoto.photoUrl).toBeUndefined();
    expect('photoUrl' in sinFoto).toBe(false);
  });
});
