import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestAccount, bearer, createE2EApp, http, registerPatient, signup } from './e2e-utils';

/**
 * UC-22 A3/A4 · Cambiar el rol de un miembro del círculo (PATCH /patients/:id/links/:accountId).
 * Solo el consent-holder (autorización real vía PermissionEngine): un manager/viewer recibe 403,
 * un objetivo no vinculado 404, un rol inválido 400. Nunca se deja al paciente sin consent-holder
 * (409 LAST_CONSENT_HOLDER); la titularidad se transfiere promoviendo antes a otro miembro. Auditado.
 */
describe('E2E · Cambiar el rol de un miembro del círculo (UC-22 A3/A4)', () => {
  let app: INestApplication;
  let titular: TestAccount; // consent-holder (registra el paciente)
  let viewerM: TestAccount; // se une como viewer
  let managerM: TestAccount; // se une como manager
  let stranger: TestAccount; // family sin vínculo
  let patientId: string;

  /** Suma un miembro al círculo por invitación + confirmación (UC-03), con el rol dado. */
  async function addMember(member: TestAccount, role: 'manager' | 'viewer'): Promise<void> {
    const inv = await http(app)
      .post(`/api/v1/patients/${patientId}/invitations`)
      .set(bearer(titular.token))
      .send({ invitedEmail: member.email, role });
    expect(inv.status).toBe(201);
    const confirm = await http(app)
      .post(`/api/v1/invitations/${inv.body.token}/confirm`)
      .set(bearer(member.token));
    expect(confirm.status).toBe(201);
  }

  const roleOf = async (accountId: string): Promise<string | undefined> => {
    const circle = await http(app).get(`/api/v1/patients/${patientId}/links`).set(bearer(titular.token));
    return circle.body.find((m: { accountId: string; role: string }) => m.accountId === accountId)?.role;
  };

  const patchRole = (targetAccountId: string, role: string, actorToken: string) =>
    http(app)
      .patch(`/api/v1/patients/${patientId}/links/${targetAccountId}`)
      .set(bearer(actorToken))
      .send({ role });

  beforeAll(async () => {
    app = await createE2EApp();
    titular = await signup(app, 'family', 'Titular Consent');
    viewerM = await signup(app, 'family', 'Miembro Viewer');
    managerM = await signup(app, 'family', 'Miembro Manager');
    stranger = await signup(app, 'family', 'Ajeno Sin Vínculo');
    patientId = await registerPatient(app, titular.token);
    await addMember(viewerM, 'viewer');
    await addMember(managerM, 'manager');
  });

  afterAll(async () => {
    await app.close();
  });

  it('un manager no puede cambiar el rol de otro miembro → 403', async () => {
    const res = await patchRole(viewerM.accountId, 'manager', managerM.token);
    expect(res.status).toBe(403);
    expect(await roleOf(viewerM.accountId)).toBe('viewer');
  });

  it('un viewer no puede cambiar el rol de otro miembro → 403', async () => {
    const res = await patchRole(managerM.accountId, 'viewer', viewerM.token);
    expect(res.status).toBe(403);
    expect(await roleOf(managerM.accountId)).toBe('manager');
  });

  it('el titular (consent-holder) promueve al viewer a manager → 200, reflejado en el círculo y auditado', async () => {
    const res = await patchRole(viewerM.accountId, 'manager', titular.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accountId: viewerM.accountId, role: 'manager' });
    expect(await roleOf(viewerM.accountId)).toBe('manager');

    const audits = await app
      .get(DataSource)
      .query(`SELECT actor, target, metadata FROM audit_log WHERE action = 'membership.circle.link-role-changed'`);
    const row = audits.find(
      (a: { metadata: { targetAccountId: string } }) => a.metadata?.targetAccountId === viewerM.accountId,
    );
    expect(row).toBeDefined();
    expect(row.actor).toBe(titular.accountId);
    expect(row.metadata).toMatchObject({ fromRole: 'viewer', toRole: 'manager' });
    expect(row.target).toMatchObject({ type: 'patient', id: patientId });
  });

  it('un rol inválido es rechazado por validación → 400', async () => {
    const res = await patchRole(managerM.accountId, 'super-admin', titular.token);
    expect(res.status).toBe(400);
  });

  it('cambiar el rol de una cuenta que no pertenece al círculo → 404', async () => {
    const res = await patchRole(stranger.accountId, 'manager', titular.token);
    expect(res.status).toBe(404);
  });

  it('degradar al único consent-holder se rechaza → 409 LAST_CONSENT_HOLDER (no queda sin titular)', async () => {
    const res = await patchRole(titular.accountId, 'manager', titular.token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_CONSENT_HOLDER');
    expect(await roleOf(titular.accountId)).toBe('consent-holder');
  });

  it('se transfiere la titularidad: promover a otro a consent-holder habilita degradar al titular anterior', async () => {
    // managerM (manager) → consent-holder: ahora hay dos titulares.
    const promote = await patchRole(managerM.accountId, 'consent-holder', titular.token);
    expect(promote.status).toBe(200);
    expect(await roleOf(managerM.accountId)).toBe('consent-holder');

    // Con dos consent-holders, el titular original ya puede degradarse a viewer.
    const demote = await patchRole(titular.accountId, 'viewer', titular.token);
    expect(demote.status).toBe(200);
    expect(await roleOf(titular.accountId)).toBe('viewer');

    // Y ya sin ser titular, no puede seguir cambiando roles: 403.
    const denied = await patchRole(viewerM.accountId, 'viewer', titular.token);
    expect(denied.status).toBe(403);
  });
});
