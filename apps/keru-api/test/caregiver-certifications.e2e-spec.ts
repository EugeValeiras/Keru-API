import { INestApplication } from '@nestjs/common';
import {
  bearer,
  caregiverProfileBody,
  createE2EApp,
  http,
  signup,
  signupAdmin,
  stepUp,
  stepUpHeader,
  TestAccount,
  uid,
} from './e2e-utils';

/**
 * KER-52 (UC-02/UC-19) · Certificaciones del cuidador: catálogo finito + insignia por-cert +
 * adjunto PRIVADO + aprobación por-cert del admin + visibilidad solo-aprobadas en el marketplace.
 */
describe('KER-52 · Catálogo + adjunto privado + aprobación por-certificación', () => {
  let app: INestApplication;
  let admin: TestAccount;
  let family: TestAccount;

  const PDF = Buffer.from('%PDF-1.4\nKER-52 documento de prueba\n%%EOF', 'latin1');

  /** Sube un documento privado como el cuidador y devuelve su documentKey. */
  async function uploadDoc(token: string): Promise<{ documentKey: string; contentType: string }> {
    const res = await http(app)
      .post('/api/v1/files/documents')
      .set(bearer(token))
      .attach('file', PDF, { filename: 'certificado.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    return res.body;
  }

  /** Cuidador registrado (pending) con una certificación del catálogo + su documento privado. */
  async function registerCaregiverWithCert(catalogKey = 'nursing-degree') {
    const account = await signup(app, 'caregiver', 'Cuidador Cert');
    const { documentKey } = await uploadDoc(account.token);
    const res = await http(app)
      .post('/api/v1/caregivers')
      .set(bearer(account.token))
      .send(caregiverProfileBody(uid('op-cg'), { catalogKey, documentKey }));
    expect(res.status).toBe(201);
    return { account, caregiverId: res.body.id as string };
  }

  async function approveAccount(caregiverId: string) {
    const res = await http(app)
      .post(`/api/v1/admin/caregivers/${caregiverId}/approve`)
      .set(bearer(admin.token))
      .set(stepUpHeader(await stepUp(app, admin)));
    expect(res.status).toBe(201);
  }

  async function adminCertId(caregiverId: string, index = 0): Promise<string> {
    const res = await http(app).get(`/api/v1/admin/caregivers/${caregiverId}`).set(bearer(admin.token));
    expect(res.status).toBe(200);
    return res.body.certifications[index].id as string;
  }

  beforeAll(async () => {
    app = await createE2EApp();
    admin = await signupAdmin(app);
    family = await signup(app, 'family', 'Familia E2E');
  });

  afterAll(async () => {
    await app.close();
  });

  it('Criterio 1 · GET del catálogo finito devuelve tipos con su insignia', async () => {
    const caregiver = await signup(app, 'caregiver', 'Cat Reader');
    const res = await http(app).get('/api/v1/caregivers/certification-catalog').set(bearer(caregiver.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const nursing = res.body.find((i: { key: string }) => i.key === 'nursing-degree');
    // KER-77: cada tipo trae su iconKey estable (SVG diseñado) además del emoji fallback.
    expect(nursing).toMatchObject({
      key: 'nursing-degree',
      label: expect.any(String),
      iconKey: 'stethoscope',
      badgeIcon: expect.any(String),
    });
  });

  it('Criterio 1 · registrar con un tipo FUERA del catálogo se rechaza (400)', async () => {
    const account = await signup(app, 'caregiver', 'Fuera Catalogo');
    const { documentKey } = await uploadDoc(account.token);
    const res = await http(app)
      .post('/api/v1/caregivers')
      .set(bearer(account.token))
      .send(caregiverProfileBody(uid('op-cg'), { catalogKey: 'no-existe-en-catalogo', documentKey }));
    expect(res.status).toBe(400);
  });

  it('Criterio 2 · la subida del documento devuelve una documentKey privada (NO una URL pública)', async () => {
    const account = await signup(app, 'caregiver', 'Sube Doc');
    const res = await http(app)
      .post('/api/v1/files/documents')
      .set(bearer(account.token))
      .attach('file', PDF, { filename: 'c.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.documentKey).toMatch(/^private\/documents\//);
    expect(res.body.documentKey).not.toMatch(/^https?:\/\//);
    expect(res.body.url).toBeUndefined();
  });

  it('Criterio 2 · la subida rechaza tipos no soportados (400)', async () => {
    const account = await signup(app, 'caregiver', 'Doc Malo');
    const res = await http(app)
      .post('/api/v1/files/documents')
      .set(bearer(account.token))
      .attach('file', Buffer.from('texto plano'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('Criterio 2 · el documento privado lo descarga SOLO el admin (otros roles → 403)', async () => {
    const { account, caregiverId } = await registerCaregiverWithCert();
    await approveAccount(caregiverId);
    const certId = await adminCertId(caregiverId);
    const url = `/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}/document`;

    // Admin: OK, binario con content-type y descarga.
    const ok = await http(app).get(url).set(bearer(admin.token)).buffer(true);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('application/pdf');
    expect(ok.headers['content-disposition']).toContain('attachment');

    // El propio cuidador (rol caregiver): 403.
    expect((await http(app).get(url).set(bearer(account.token))).status).toBe(403);
    // Una cuenta family: 403.
    expect((await http(app).get(url).set(bearer(family.token))).status).toBe(403);
    // Sin sesión: 401.
    expect((await http(app).get(url)).status).toBe(401);
  });

  it('Criterio 3 · aprobar/rechazar por-cert exige step-up (sin token → 403 STEP_UP_REQUIRED)', async () => {
    const { caregiverId } = await registerCaregiverWithCert();
    await approveAccount(caregiverId);
    const certId = await adminCertId(caregiverId);
    const res = await http(app)
      .post(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}/approve`)
      .set(bearer(admin.token)); // sin step-up
    expect(res.status).toBe(403);
  });

  it('Criterio 3 · una certificación pendiente NO aparece en el marketplace; aprobada aparece con su insignia', async () => {
    const { caregiverId } = await registerCaregiverWithCert('nursing-degree');
    await approveAccount(caregiverId);

    // Antes de aprobar la cert: el perfil público NO la muestra y la insignia agregada es false.
    const before = await http(app)
      .get(`/api/v1/marketplace/caregivers/${caregiverId}`)
      .set(bearer(family.token));
    expect(before.status).toBe(200);
    expect(before.body.certifications).toHaveLength(0);
    expect(before.body.badges.certifications).toBe(false);

    // El admin aprueba la certificación (con step-up).
    const certId = await adminCertId(caregiverId);
    const approve = await http(app)
      .post(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}/approve`)
      .set(bearer(admin.token))
      .set(stepUpHeader(await stepUp(app, admin)));
    expect(approve.status).toBe(201);

    // Ahora el perfil público la muestra con su insignia y la agregada pasa a true.
    const after = await http(app)
      .get(`/api/v1/marketplace/caregivers/${caregiverId}`)
      .set(bearer(family.token));
    expect(after.status).toBe(200);
    expect(after.body.certifications).toHaveLength(1);
    expect(after.body.certifications[0]).toMatchObject({
      catalogKey: 'nursing-degree',
      verified: true,
      label: expect.any(String),
      iconKey: 'stethoscope',
      badgeIcon: expect.any(String),
    });
    // El documento privado NUNCA se expone al público.
    expect(after.body.certifications[0].documentKey).toBeUndefined();
    expect(after.body.badges.certifications).toBe(true);
  });

  it('Criterio 3 · una certificación rechazada queda oculta al público (con motivo, sin tocar las demás)', async () => {
    const { account, caregiverId } = await registerCaregiverWithCert('nursing-degree');
    await approveAccount(caregiverId);

    // Agrega una segunda certificación (UC-02 A4): nace pendiente/oculta.
    const { documentKey } = await uploadDoc(account.token);
    const add = await http(app)
      .post('/api/v1/caregivers/me/certifications')
      .set(bearer(account.token))
      .send({ operationId: uid('op-add'), catalogKey: 'cpr', institution: 'SAME', year: 2022, documentKey, documentContentType: 'application/pdf' });
    expect(add.status).toBe(201);

    // Aprobamos la primera y rechazamos la segunda (cpr).
    const detail = await http(app).get(`/api/v1/admin/caregivers/${caregiverId}`).set(bearer(admin.token));
    const nursing = detail.body.certifications.find((c: { catalogKey: string }) => c.catalogKey === 'nursing-degree');
    const cpr = detail.body.certifications.find((c: { catalogKey: string }) => c.catalogKey === 'cpr');

    await http(app)
      .post(`/api/v1/admin/caregivers/${caregiverId}/certifications/${nursing.id}/approve`)
      .set(bearer(admin.token))
      .set(stepUpHeader(await stepUp(app, admin)))
      .expect(201);
    const reject = await http(app)
      .post(`/api/v1/admin/caregivers/${caregiverId}/certifications/${cpr.id}/reject`)
      .set(bearer(admin.token))
      .set(stepUpHeader(await stepUp(app, admin)))
      .send({ reason: 'Documento ilegible' });
    expect(reject.status).toBe(201);

    // El marketplace muestra solo la aprobada; la rechazada no aparece.
    const pub = await http(app).get(`/api/v1/marketplace/caregivers/${caregiverId}`).set(bearer(family.token));
    expect(pub.body.certifications).toHaveLength(1);
    expect(pub.body.certifications[0].catalogKey).toBe('nursing-degree');

    // El dueño sí ve el estado por-cert (aprobada + rechazada con motivo).
    const mine = await http(app).get('/api/v1/caregivers/me').set(bearer(account.token));
    const mineCpr = mine.body.certifications.find((c: { catalogKey: string }) => c.catalogKey === 'cpr');
    expect(mineCpr.status).toBe('rejected');
    expect(mineCpr.rejectionReason).toBe('Documento ilegible');
  });

  it('Criterio 2 · cada descarga del documento queda auditada', async () => {
    const { caregiverId } = await registerCaregiverWithCert();
    await approveAccount(caregiverId);
    const certId = await adminCertId(caregiverId);
    await http(app)
      .get(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}/document`)
      .set(bearer(admin.token))
      .buffer(true)
      .expect(200);

    const audit = await http(app)
      .get('/api/v1/admin/audit')
      .query({ action: 'membership.caregiver.certification-document-downloaded' })
      .set(bearer(admin.token));
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBeGreaterThan(0);
  });
});
