import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  TestAccount,
  bearer,
  caregiverProfileBody,
  createApprovedCaregiver,
  createE2EApp,
  daysFromNow,
  hiringRequestBody,
  http,
  registerPatient,
  signup,
  signupAdmin,
  stepUp,
  stepUpHeader,
  uid,
} from './e2e-utils';

/**
 * #49 · UC-19 A3 · El administrador edita por completo la información de un cuidador.
 *
 * Criterios de aceptación (API) del issue EugeValeiras/Keru#49, en Dado/Cuando/Entonces:
 *  1. Guards: family/caregiver → 403; admin sin step-up → 403 STEP_UP_REQUIRED; con step-up → 200.
 *  2. Set parcial: solo `zone` cambia la zona y nada más; body vacío no escribe ni audita.
 *  3. Identidad: nombre/foto cambian la CUENTA del cuidador (ADR-0003) y se ven en el detalle, el listado
 *     admin, la ficha pública (UC-07) y GET /accounts/me; foto fuera del patrón de /files/images → 400.
 *  4. Tarifas efectivo-fechadas: nueva versión en `caregiver_rate_version` sin reescribir las anteriores;
 *     la solicitud existente conserva su tarifa pinneada (NFR-03/23).
 *  5. Credenciales de un aprobado (especialidades/disponibilidad/modalidades/cert) sin cambiar status ni
 *     badges; la baja de una cert aprobada recalcula la insignia derivada `certifications`.
 *  6. Funciona sobre pending/rejected/deactivated sin cambiar el estado.
 *  7. Cada edición queda en audit_log con actor admin, target caregiver y la lista de campos.
 *  8. El admin lista el catálogo de certificaciones.
 * (El criterio "ninguna respuesta expone accountId" vive en caregiver-admin-minimization.e2e-spec.ts.)
 */
describe('E2E · #49 (UC-19 A3) · El administrador edita los datos del cuidador', () => {
  let app: INestApplication;
  let admin: TestAccount;
  let ds: DataSource;

  // PNG 1x1 válido para subir por POST /files/images (la foto debe venir de la vía oficial).
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );

  const editBody = (over: Record<string, unknown> = {}) => ({ operationId: uid('op-admin-edit'), ...over });

  const adminPatch = async (caregiverId: string, body: Record<string, unknown>) =>
    http(app)
      .patch(`/api/v1/admin/caregivers/${caregiverId}`)
      .set(bearer(admin.token))
      .set(stepUpHeader(await stepUp(app, admin)))
      .send(body);

  const adminDetail = (caregiverId: string) =>
    http(app).get(`/api/v1/admin/caregivers/${caregiverId}`).set(bearer(admin.token));

  const auditRows = (action: string, caregiverId: string) =>
    ds.query(`SELECT actor, target, metadata FROM audit_log WHERE action = $1 AND target->>'id' = $2`, [
      action,
      caregiverId,
    ]) as Promise<{ actor: string; target: Record<string, unknown>; metadata: Record<string, unknown> }[]>;

  /** Cuidador con perfil creado y SIN aprobar (estado pending). */
  async function createPendingCaregiver(): Promise<{ account: TestAccount; caregiverId: string }> {
    const account = await signup(app, 'caregiver', 'Pendiente Pérez');
    const created = await http(app).post('/api/v1/caregivers').set(bearer(account.token)).send(caregiverProfileBody());
    expect(created.status).toBe(201);
    return { account, caregiverId: created.body.id };
  }

  beforeAll(async () => {
    app = await createE2EApp();
    admin = await signupAdmin(app);
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Criterio 1 · guards: rol admin + step-up (NFR-33)', () => {
    it('Dado un rol family o caregiver, cuando intenta editar, entonces 403 (y nada cambia)', async () => {
      const { account, caregiverId } = await createApprovedCaregiver(app, admin);
      const family = await signup(app, 'family', 'Familia Intrusa');

      const asFamily = await http(app)
        .patch(`/api/v1/admin/caregivers/${caregiverId}`)
        .set(bearer(family.token))
        .set(stepUpHeader(await stepUp(app, family)))
        .send(editBody({ zone: 'Hackeada' }));
      const asCaregiver = await http(app)
        .patch(`/api/v1/admin/caregivers/${caregiverId}`)
        .set(bearer(account.token))
        .set(stepUpHeader(await stepUp(app, account)))
        .send(editBody({ zone: 'Hackeada' }));

      expect(asFamily.status).toBe(403);
      expect(asCaregiver.status).toBe(403);
      const detail = await adminDetail(caregiverId);
      expect(detail.body.zone).toBe('Palermo, CABA');
    });

    it('Dado un admin SIN step-up, cuando intenta editar, entonces 403 STEP_UP_REQUIRED', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);

      const res = await http(app)
        .patch(`/api/v1/admin/caregivers/${caregiverId}`)
        .set(bearer(admin.token)) // sin x-step-up-token
        .send(editBody({ zone: 'Sin step-up' }));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('STEP_UP_REQUIRED');
      expect((await adminDetail(caregiverId)).body.zone).toBe('Palermo, CABA');
    });

    it('Dado un admin CON step-up, cuando edita, entonces 200 y la respuesta es el detalle actualizado', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);

      const res = await adminPatch(caregiverId, editBody({ zone: 'Belgrano, CABA' }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: caregiverId, zone: 'Belgrano, CABA', status: 'approved' });
    });

    it('Los verbos por-certificación (PATCH/DELETE) también exigen rol admin y step-up', async () => {
      const { account, caregiverId } = await createApprovedCaregiver(app, admin);
      const certId = (await adminDetail(caregiverId)).body.certifications[0].id as string;

      const patchNoStepUp = await http(app)
        .patch(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}`)
        .set(bearer(admin.token))
        .send({ year: 2016 });
      const deleteNoStepUp = await http(app)
        .delete(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}`)
        .set(bearer(admin.token));
      const deleteAsCaregiver = await http(app)
        .delete(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}`)
        .set(bearer(account.token))
        .set(stepUpHeader(await stepUp(app, account)));

      expect(patchNoStepUp.status).toBe(403);
      expect(patchNoStepUp.body.code).toBe('STEP_UP_REQUIRED');
      expect(deleteNoStepUp.status).toBe(403);
      expect(deleteNoStepUp.body.code).toBe('STEP_UP_REQUIRED');
      expect(deleteAsCaregiver.status).toBe(403);
      expect((await adminDetail(caregiverId)).body.certifications).toHaveLength(1);
    });
  });

  describe('Criterio 2 · set parcial', () => {
    it('Dado un body con solo `zone`, cuando el admin edita, entonces cambia la zona y NADA más', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const before = (await adminDetail(caregiverId)).body;

      const res = await adminPatch(caregiverId, editBody({ zone: 'Núñez, CABA' }));

      expect(res.status).toBe(200);
      const after = (await adminDetail(caregiverId)).body;
      expect(after.zone).toBe('Núñez, CABA');
      // Todo lo demás, idéntico (identidad, credenciales, tarifa, estado, insignias, provenance).
      const { zone: _z1, ...restBefore } = before;
      const { zone: _z2, ...restAfter } = after;
      expect(restAfter).toEqual(restBefore);
    });

    it('Dado un body vacío (solo operationId), cuando el admin "edita", entonces 200, no escribe ni audita', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const before = (await adminDetail(caregiverId)).body;

      const res = await adminPatch(caregiverId, editBody());

      expect(res.status).toBe(200);
      expect((await adminDetail(caregiverId)).body).toEqual(before);
      expect(await auditRows('membership.caregiver.admin-edited', caregiverId)).toHaveLength(0);
    });

    it('Dado un body con claves desconocidas (p. ej. status), entonces 400 (whitelist del contrato)', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);

      const res = await adminPatch(caregiverId, editBody({ status: 'rejected' }));

      expect(res.status).toBe(400);
      expect((await adminDetail(caregiverId)).body.status).toBe('approved');
    });
  });

  describe('Criterio 3 · identidad (nombre/foto) vive en la cuenta — ADR-0003', () => {
    it('Dado un cambio de nombre y foto, cuando el admin edita, entonces cambia la CUENTA: detalle, listado, ficha pública y GET /accounts/me del cuidador muestran la identidad nueva', async () => {
      const { account, caregiverId } = await createApprovedCaregiver(app, admin);
      const family = await signup(app, 'family', 'Familia Lectora');

      // La foto tiene que venir de la vía oficial: la sube el admin por POST /files/images.
      const uploaded = await http(app)
        .post('/api/v1/files/images')
        .set(bearer(admin.token))
        .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' });
      expect(uploaded.status).toBe(201);
      const photoUrl = uploaded.body.url as string;

      const res = await adminPatch(caregiverId, editBody({ displayName: 'Laura G. Pérez', photoUrl }));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ displayName: 'Laura G. Pérez', photoUrl });

      // Detalle + listado admin (ordenado por creación DESC: el recién creado entra en la 1ª página).
      // No se usa el filtro `q`: hoy devuelve 500 por `uuid = varchar` en listPaged (preexistente, fuera de #49).
      expect((await adminDetail(caregiverId)).body).toMatchObject({ displayName: 'Laura G. Pérez', photoUrl });
      const list = await http(app)
        .get('/api/v1/admin/caregivers')
        .query({ status: 'approved', pageSize: 100 })
        .set(bearer(admin.token));
      expect(list.status).toBe(200);
      expect(list.body.items.find((c: { id: string }) => c.id === caregiverId)).toMatchObject({
        displayName: 'Laura G. Pérez',
        photoUrl,
      });
      // Ficha pública del marketplace (UC-07): Hiring la lee ya enriquecida por Membership.
      const profile = await http(app).get(`/api/v1/marketplace/caregivers/${caregiverId}`).set(bearer(family.token));
      expect(profile.status).toBe(200);
      expect(profile.body).toMatchObject({ displayName: 'Laura G. Pérez', photoUrl });
      // Y la cuenta del propio cuidador (UC-23): misma fuente, sin copia.
      const me = await http(app).get('/api/v1/accounts/me').set(bearer(account.token));
      expect(me.body).toMatchObject({ displayName: 'Laura G. Pérez', photoUrl });
    });

    it('Dado photoUrl: null, cuando el admin lo manda, entonces quita la foto (fallback a iniciales)', async () => {
      const { account, caregiverId } = await createApprovedCaregiver(app, admin);
      const uploaded = await http(app)
        .post('/api/v1/files/images')
        .set(bearer(admin.token))
        .attach('file', PNG_1X1, { filename: 'avatar.png', contentType: 'image/png' });
      await http(app).patch('/api/v1/accounts/me').set(bearer(account.token)).send({ photoUrl: uploaded.body.url });
      expect((await adminDetail(caregiverId)).body.photoUrl).toBe(uploaded.body.url);

      const res = await adminPatch(caregiverId, editBody({ photoUrl: null }));

      expect(res.status).toBe(200);
      expect(res.body.photoUrl ?? null).toBeNull();
    });

    it('Dada una foto fuera del patrón de POST /files/images, cuando el admin la manda, entonces 400 y nada cambia', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const before = (await adminDetail(caregiverId)).body;

      const res = await adminPatch(
        caregiverId,
        editBody({ displayName: 'No Debería', photoUrl: 'https://evil.example/images/foto.png' }),
      );

      expect(res.status).toBe(400);
      expect((await adminDetail(caregiverId)).body).toEqual(before);
      expect(await auditRows('membership.caregiver.admin-edited', caregiverId)).toHaveLength(0);
    });

    it('Dado un nombre vacío, entonces 400 (validación del contrato)', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);

      const res = await adminPatch(caregiverId, editBody({ displayName: '' }));

      expect(res.status).toBe(400);
    });
  });

  describe('Criterio 4 · tarifas efectivo-fechadas (NFR-03/23)', () => {
    it('Dada una solicitud existente, cuando el admin cambia la tarifa, entonces se agrega una versión sin reescribir las anteriores, el marketplace muestra la vigente y la solicitud conserva su tarifa pinneada', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const family = await signup(app, 'family', 'Familia Pinneada');
      const patientId = await registerPatient(app, family.token);
      const created = await http(app)
        .post('/api/v1/hiring-requests')
        .set(bearer(family.token))
        .send(hiringRequestBody(patientId, caregiverId, { startDate: daysFromNow(1), endDate: daysFromNow(3) }));
      expect(created.status).toBe(201);
      expect(Number(created.body.ratePerHourSnapshot)).toBe(3500);

      const versionsBefore = (await ds.query(
        `SELECT id, rates, "effectiveFrom" FROM caregiver_rate_version WHERE "caregiverId" = $1 ORDER BY "effectiveFrom" ASC`,
        [caregiverId],
      )) as { id: string; rates: { ratePerHour: number }; effectiveFrom: Date }[];

      const res = await adminPatch(caregiverId, editBody({ rates: { ratePerHour: 5000, description: 'Nocturno' } }));
      expect(res.status).toBe(200);
      expect(res.body.rates).toMatchObject({ ratePerHour: 5000, currency: 'ARS', description: 'Nocturno' }); // moneda heredada

      const versionsAfter = (await ds.query(
        `SELECT id, rates, "effectiveFrom" FROM caregiver_rate_version WHERE "caregiverId" = $1 ORDER BY "effectiveFrom" ASC`,
        [caregiverId],
      )) as { id: string; rates: { ratePerHour: number }; effectiveFrom: Date }[];
      // Append-only: las versiones previas quedan idénticas y hay exactamente una más, con la nueva tarifa.
      expect(versionsAfter).toHaveLength(versionsBefore.length + 1);
      expect(versionsAfter.slice(0, versionsBefore.length)).toEqual(versionsBefore);
      expect(versionsAfter[versionsAfter.length - 1].rates.ratePerHour).toBe(5000);

      // El marketplace muestra la vigente...
      const profile = await http(app).get(`/api/v1/marketplace/caregivers/${caregiverId}`).set(bearer(family.token));
      expect(Number(profile.body.ratePerHour)).toBe(5000);
      // ...y la solicitud ya emitida conserva su snapshot pinneado.
      const mine = await http(app).get('/api/v1/hiring-requests').set(bearer(family.token));
      const request = mine.body.find((r: { id: string }) => r.id === created.body.id);
      expect(Number(request.ratePerHourSnapshot)).toBe(3500);
    });

    it('Dado el mismo operationId dos veces, cuando se reintenta el cambio de tarifa, entonces no se duplica la versión (NFR-34)', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const body = editBody({ rates: { ratePerHour: 4200 } });

      expect((await adminPatch(caregiverId, body)).status).toBe(200);
      expect((await adminPatch(caregiverId, body)).status).toBe(200);

      const rows = await ds.query(`SELECT COUNT(*)::int AS n FROM caregiver_rate_version WHERE "createdByOperationId" = $1`, [
        body.operationId,
      ]);
      expect(rows[0].n).toBe(1);
    });
  });

  describe('Criterio 5 · credenciales de un cuidador APROBADO, sin re-verificación', () => {
    it('Dado un aprobado, cuando el admin edita especialidades, disponibilidad y modalidades, entonces no cambia status ni badges ni lo vuelve pendiente', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const before = (await adminDetail(caregiverId)).body;
      const availability = [
        { dayOfWeek: 2, from: '09:00', to: '13:00' },
        { dayOfWeek: 4, from: '14:00', to: '20:00' },
      ];

      const res = await adminPatch(
        caregiverId,
        editBody({ specialties: ['pediatric', 'palliative'], availability, modalities: ['home', 'hospital'] }),
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'approved',
        specialties: ['pediatric', 'palliative'],
        availability,
        modalities: ['home', 'hospital'],
        badges: before.badges,
        reviewedBy: before.reviewedBy,
        reviewedAt: before.reviewedAt,
      });
    });

    it('Dada una certificación APROBADA, cuando el admin corrige tipo/institución/año, entonces sigue aprobada (insignia visible) y la cuenta sigue aprobada', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const family = await signup(app, 'family', 'Familia Cert');
      const certId = (await adminDetail(caregiverId)).body.certifications[0].id as string;
      // El admin aprueba la cert (KER-52) → badge derivada true.
      const approved = await http(app)
        .post(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}/approve`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)));
      expect(approved.status).toBe(201);
      expect(approved.body.badges.certifications).toBe(true);

      const res = await http(app)
        .patch(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)))
        .send({ catalogKey: 'nursing-assistant', institution: 'Cruz Roja Argentina', year: 2018 });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.badges.certifications).toBe(true);
      const cert = res.body.certifications.find((c: { id: string }) => c.id === certId);
      expect(cert).toMatchObject({
        catalogKey: 'nursing-assistant',
        label: 'Auxiliar de Enfermería',
        institution: 'Cruz Roja Argentina',
        year: 2018,
        status: 'approved',
        verified: true,
        hasDocument: true,
      });
      // Sigue visible al público con los datos corregidos (UC-07).
      const profile = await http(app).get(`/api/v1/marketplace/caregivers/${caregiverId}`).set(bearer(family.token));
      expect(profile.body.certifications).toEqual([
        expect.objectContaining({ catalogKey: 'nursing-assistant', institution: 'Cruz Roja Argentina', year: 2018 }),
      ]);
      expect(await auditRows('membership.caregiver.certification-admin-edited', caregiverId)).toEqual([
        expect.objectContaining({
          actor: admin.accountId,
          metadata: { certId, fields: ['catalogKey', 'institution', 'year'] },
        }),
      ]);
    });

    it('Dada la única certificación aprobada, cuando el admin la da de baja, entonces sale del perfil y la insignia derivada `certifications` pasa a false; la cuenta sigue aprobada', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const certId = (await adminDetail(caregiverId)).body.certifications[0].id as string;
      await http(app)
        .post(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}/approve`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)));
      // Insignias manuales para comprobar que no se pisan.
      await http(app).put(`/api/v1/admin/caregivers/${caregiverId}/badges`).set(bearer(admin.token)).send({ identity: true });
      expect((await adminDetail(caregiverId)).body.badges).toEqual({ certifications: true, identity: true, background: false });

      const res = await http(app)
        .delete(`/api/v1/admin/caregivers/${caregiverId}/certifications/${certId}`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.certifications).toEqual([]);
      expect(res.body.badges).toEqual({ certifications: false, identity: true, background: false });
      expect(await auditRows('membership.caregiver.certification-admin-removed', caregiverId)).toEqual([
        expect.objectContaining({
          actor: admin.accountId,
          metadata: { certId, catalogKey: 'nursing-degree', status: 'approved' },
        }),
      ]);
    });

    it('Dada una certificación inexistente, cuando el admin la edita o la da de baja, entonces 404', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);

      const patched = await http(app)
        .patch(`/api/v1/admin/caregivers/${caregiverId}/certifications/00000000-0000-4000-8000-000000000000`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)))
        .send({ year: 2000 });
      const deleted = await http(app)
        .delete(`/api/v1/admin/caregivers/${caregiverId}/certifications/00000000-0000-4000-8000-000000000000`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)));

      expect(patched.status).toBe(404);
      expect(deleted.status).toBe(404);
    });
  });

  describe('Criterio 6 · funciona en cualquier estado sin cambiarlo', () => {
    it('Dado un cuidador PENDING, cuando el admin edita, entonces sigue pending', async () => {
      const { caregiverId } = await createPendingCaregiver();

      const res = await adminPatch(caregiverId, editBody({ zone: 'Caballito', displayName: 'Pendiente Corregida' }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'pending', zone: 'Caballito', displayName: 'Pendiente Corregida' });
      // Sigue en la cola de pendientes (UC-19 paso 1).
      const pending = await http(app).get('/api/v1/admin/caregivers/pending').set(bearer(admin.token));
      expect(pending.body.some((c: { id: string }) => c.id === caregiverId)).toBe(true);
    });

    it('Dado un cuidador REJECTED, cuando el admin edita, entonces sigue rejected y conserva el motivo de rechazo', async () => {
      const { caregiverId } = await createPendingCaregiver();
      const rejected = await http(app)
        .post(`/api/v1/admin/caregivers/${caregiverId}/reject`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)))
        .send({ reason: 'Documento ilegible' });
      expect(rejected.status).toBe(201);

      const res = await adminPatch(caregiverId, editBody({ zone: 'Flores', rates: { ratePerHour: 3900 } }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'rejected',
        rejectionReason: 'Documento ilegible',
        zone: 'Flores',
        rates: { ratePerHour: 3900 },
      });
    });

    it('Dado un cuidador DEACTIVATED, cuando el admin edita, entonces sigue deactivated (oculto del marketplace)', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);
      const deactivated = await http(app)
        .post(`/api/v1/admin/caregivers/${caregiverId}/deactivate`)
        .set(bearer(admin.token))
        .send({ reason: 'Baja temporal' });
      expect(deactivated.status).toBe(201);

      const res = await adminPatch(caregiverId, editBody({ specialties: ['companionship'] }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'deactivated', specialties: ['companionship'] });
    });
  });

  describe('Criterio 7 · auditoría', () => {
    it('Dada una edición, entonces queda en audit_log con actor admin, target caregiver y la lista de campos', async () => {
      const { caregiverId } = await createApprovedCaregiver(app, admin);

      await adminPatch(caregiverId, editBody({ displayName: 'Auditada', zone: 'Saavedra', modalities: ['hospital'] }));

      const rows = await auditRows('membership.caregiver.admin-edited', caregiverId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        actor: admin.accountId,
        target: { type: 'caregiver', id: caregiverId },
        metadata: { fields: ['displayName', 'zone', 'modalities'] },
      });
    });
  });

  describe('Criterio 8 · catálogo de certificaciones para el admin', () => {
    it('Dado un admin, cuando pide el catálogo, entonces 200 con las mismas entradas que ve el cuidador', async () => {
      const { account } = await createApprovedCaregiver(app, admin);

      const asAdmin = await http(app).get('/api/v1/admin/caregivers/certification-catalog').set(bearer(admin.token));
      const asCaregiver = await http(app).get('/api/v1/caregivers/certification-catalog').set(bearer(account.token));

      expect(asAdmin.status).toBe(200);
      expect(asAdmin.body.length).toBeGreaterThan(0);
      expect(asAdmin.body[0]).toEqual(expect.objectContaining({ key: expect.any(String), label: expect.any(String), iconKey: expect.any(String) }));
      expect(asAdmin.body).toEqual(asCaregiver.body);
    });

    it('Dado un rol que no es admin, cuando pide el catálogo por la ruta admin, entonces 403', async () => {
      const family = await signup(app, 'family', 'Familia Catálogo');

      const res = await http(app).get('/api/v1/admin/caregivers/certification-catalog').set(bearer(family.token));

      expect(res.status).toBe(403);
    });
  });
});
