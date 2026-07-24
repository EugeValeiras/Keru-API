import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bearer, createE2EApp, http, registerPatient, signup } from './e2e-utils';

/**
 * KER-49 · UC-04 A5: verificación de email del self-signup. App real: Postgres (tabla
 * email_verification_token + columna account.emailVerified + audit_log).
 *
 * Signup deja la cuenta sin verificar y emite el token. `confirm` valida el token de un solo uso
 * (válido/expirado/reusado) y marca la cuenta verificada (auto-login). `request` (reenvío) responde
 * SIEMPRE 200 (anti-enumeración) e invalida el token pendiente anterior. Gate: sin verificar, no se
 * pueden emitir invitaciones (UC-03) → 403 EMAIL_NOT_VERIFIED.
 */
describe('E2E · Verificación de email del self-signup (KER-49, UC-04 A5)', () => {
  let app: INestApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createE2EApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Último token de verificación emitido para una cuenta (lo que el usuario recibiría por email). */
  const latestToken = async (accountId: string): Promise<{ token: string; status: string } | undefined> => {
    const rows = (await db.query(
      `SELECT token, status FROM email_verification_token WHERE "accountId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [accountId],
    )) as Array<{ token: string; status: string }>;
    return rows[0];
  };

  const isVerified = async (accountId: string): Promise<boolean> => {
    const rows = (await db.query(`SELECT "emailVerified" FROM account WHERE id = $1`, [accountId])) as Array<{
      emailVerified: boolean;
    }>;
    return rows[0]?.emailVerified;
  };

  const requestVerification = (email: string) =>
    http(app).post('/api/v1/auth/email-verification/request').send({ email });

  const confirmVerification = (token: string) =>
    http(app).post('/api/v1/auth/email-verification/confirm').send({ token });

  const peekVerification = (token: string) =>
    http(app).post('/api/v1/auth/email-verification/peek').send({ token });

  describe('signup · alta no-verificada (A5.1)', () => {
    it('el signup responde emailVerified=false, deja la cuenta sin verificar y emite el token auditado', async () => {
      const email = `nuevo-${Date.now()}@e2e.keru.test`;
      const res = await http(app)
        .post('/api/v1/auth/signup')
        .send({ email, password: 'S3gura!123', role: 'family', displayName: 'Alta Nueva' });

      expect(res.status).toBe(201);
      expect(res.body.emailVerified).toBe(false);
      expect(await isVerified(res.body.accountId)).toBe(false);

      const token = await latestToken(res.body.accountId);
      expect(token?.status).toBe('pending');

      const audit = (await db.query(
        `SELECT action FROM audit_log WHERE actor = $1 AND action = 'auth.email-verification.issued'`,
        [res.body.accountId],
      )) as unknown[];
      expect(audit).toHaveLength(1);

      // El estado no-verificado también se ve en GET /accounts/me (para el banner tras recargar).
      const me = await http(app).get('/api/v1/accounts/me').set(bearer(res.body.accessToken));
      expect(me.status).toBe(200);
      expect(me.body.emailVerified).toBe(false);
    });
  });

  describe('confirm · token de un solo uso (A5.2)', () => {
    it('token válido → 200, marca verificado, consume el token, audita y auto-loguea verificado', async () => {
      const account = await signup(app, 'family', 'Verif Feliz', { verifyEmail: false });
      const token = await latestToken(account.accountId);

      const res = await confirmVerification(token!.token);
      expect(res.status).toBe(200);
      expect(res.body.accountId).toBe(account.accountId);
      expect(res.body.emailVerified).toBe(true);
      expect(res.body.accessToken).toBeTruthy();

      expect(await isVerified(account.accountId)).toBe(true);
      expect((await latestToken(account.accountId))?.status).toBe('used');

      const audit = (await db.query(
        `SELECT action FROM audit_log WHERE actor = $1 AND action = 'auth.email-verification.confirmed'`,
        [account.accountId],
      )) as unknown[];
      expect(audit).toHaveLength(1);

      // El token nuevo (auto-login) es válido en un endpoint protegido.
      const protectedCall = await http(app).get('/api/v1/notifications').set(bearer(res.body.accessToken));
      expect(protectedCall.status).toBe(200);
    });

    it('token ya usado → 410 (single-use)', async () => {
      const account = await signup(app, 'family', 'Verif Reuso', { verifyEmail: false });
      const token = await latestToken(account.accountId);

      expect((await confirmVerification(token!.token)).status).toBe(200);
      expect((await confirmVerification(token!.token)).status).toBe(410);
    });

    it('token expirado → 410', async () => {
      const account = await signup(app, 'family', 'Verif Vencido', { verifyEmail: false });
      const token = await latestToken(account.accountId);
      await db.query(`UPDATE email_verification_token SET "expiresAt" = now() - interval '1 hour' WHERE token = $1`, [
        token!.token,
      ]);

      expect((await confirmVerification(token!.token)).status).toBe(410);
    });

    it('token inexistente → 410 (misma respuesta, sin distinguir)', async () => {
      expect((await confirmVerification('token-que-no-existe-000')).status).toBe(410);
    });
  });

  describe('peek · email destino sin consumir el token (A5.2b, KER-63)', () => {
    it('token válido → 200 {email destino}, SIN consumir el token (sigue pendiente y confirma después)', async () => {
      const account = await signup(app, 'family', 'Verif Peek', { verifyEmail: false });
      const token = await latestToken(account.accountId);

      const res = await peekVerification(token!.token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ email: account.email });

      // Peek no tiene efecto: el token sigue pendiente y la cuenta sin verificar.
      expect((await latestToken(account.accountId))?.status).toBe('pending');
      expect(await isVerified(account.accountId)).toBe(false);

      // Y el confirm posterior con el mismo token sigue funcionando (single-use recién acá).
      expect((await confirmVerification(token!.token)).status).toBe(200);
      expect(await isVerified(account.accountId)).toBe(true);
    });

    it('token ya usado → 410 (no revela el email destino)', async () => {
      const account = await signup(app, 'family', 'Verif Peek Usado', { verifyEmail: false });
      const token = await latestToken(account.accountId);
      expect((await confirmVerification(token!.token)).status).toBe(200);

      const res = await peekVerification(token!.token);
      expect(res.status).toBe(410);
      expect(res.body.email).toBeUndefined();
    });

    it('token expirado → 410', async () => {
      const account = await signup(app, 'family', 'Verif Peek Vencido', { verifyEmail: false });
      const token = await latestToken(account.accountId);
      await db.query(`UPDATE email_verification_token SET "expiresAt" = now() - interval '1 hour' WHERE token = $1`, [
        token!.token,
      ]);

      expect((await peekVerification(token!.token)).status).toBe(410);
    });

    it('token inexistente → 410 (misma respuesta, sin distinguir)', async () => {
      expect((await peekVerification('token-que-no-existe-000')).status).toBe(410);
    });
  });

  describe('request/resend · anti-enumeración + invalida el anterior (A5.3)', () => {
    it('email inexistente → 200 {ok:true} igual (no revela existencia)', async () => {
      const res = await requestVerification(`fantasma-${Date.now()}@e2e.keru.test`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('reenviar acuña un token nuevo e invalida el pendiente anterior (solo el último sirve)', async () => {
      const account = await signup(app, 'family', 'Verif Reenvío', { verifyEmail: false });
      const first = await latestToken(account.accountId);

      const res = await requestVerification(account.email);
      expect(res.status).toBe(200);

      const second = await latestToken(account.accountId);
      expect(second!.token).not.toBe(first!.token);

      // El primero quedó invalidado → 410; el segundo verifica.
      expect((await confirmVerification(first!.token)).status).toBe(410);
      expect((await confirmVerification(second!.token)).status).toBe(200);
    });

    it('una cuenta ya verificada que pide reenvío → 200 neutro, sin emitir token nuevo', async () => {
      const account = await signup(app, 'family', 'Verif Ya', { verifyEmail: false });
      const token = await latestToken(account.accountId);
      await confirmVerification(token!.token);

      const res = await requestVerification(account.email);
      expect(res.status).toBe(200);
      // El último token sigue siendo el usado; no se acuñó uno nuevo pendiente.
      expect((await latestToken(account.accountId))?.status).toBe('used');
    });
  });

  describe('gate · emitir invitación exige email verificado (A5.4 / UC-03)', () => {
    it('cuenta no-verificada: crear paciente sí, pero invitar → 403 EMAIL_NOT_VERIFIED; tras verificar, invita', async () => {
      const account = await signup(app, 'family', 'Gate Titular', { verifyEmail: false });

      // El onboarding no se rompe: registra su propio paciente aunque no esté verificada.
      const patientId = await registerPatient(app, account.token);

      const blocked = await http(app)
        .post(`/api/v1/patients/${patientId}/invitations`)
        .set(bearer(account.token))
        .send({ invitedEmail: 'hermana@e2e.keru.test', role: 'viewer' });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

      // Verifica el email y reintenta: ahora emite.
      const token = await latestToken(account.accountId);
      await confirmVerification(token!.token);

      const allowed = await http(app)
        .post(`/api/v1/patients/${patientId}/invitations`)
        .set(bearer(account.token))
        .send({ invitedEmail: 'hermana@e2e.keru.test', role: 'viewer' });
      expect(allowed.status).toBe(201);
      expect(allowed.body).toMatchObject({ patientId, status: 'pending' });
    });
  });
});
