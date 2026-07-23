import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestAccount, bearer, createE2EApp, http, signup } from './e2e-utils';

/**
 * KER-46 · UC-04 A4: recuperación de contraseña (forgot/reset). App real: Postgres (tabla
 * password_reset_token + audit_log) y Redis (denylist / corte de sesiones por cuenta, NFR-41).
 *
 * Anti-enumeración: `request` responde 200 exista o no el email. `confirm` valida el token de un
 * solo uso (válido/expirado/reusado) y, al aplicar el reset, revoca todas las sesiones vigentes.
 */
describe('E2E · Recuperación de contraseña (KER-46, UC-04 A4)', () => {
  let app: INestApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createE2EApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Lee el último token de reset emitido para una cuenta (lo que el usuario recibiría por email). */
  const latestResetToken = async (accountId: string): Promise<{ token: string; status: string } | undefined> => {
    const rows = (await db.query(
      `SELECT token, status FROM password_reset_token WHERE "accountId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [accountId],
    )) as Array<{ token: string; status: string }>;
    return rows[0];
  };

  const requestReset = (email: string) =>
    http(app).post('/api/v1/auth/password-reset/request').send({ email });

  const confirmReset = (token: string, newPassword: string) =>
    http(app).post('/api/v1/auth/password-reset/confirm').send({ token, newPassword });

  describe('request · anti-enumeración (A4.1)', () => {
    it('email registrado → 200 {ok:true}, emite token y lo audita', async () => {
      const account = await signup(app, 'family', 'Olvido Registrado');

      const res = await requestReset(account.email);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const reset = await latestResetToken(account.accountId);
      expect(reset?.status).toBe('pending');

      const audit = (await db.query(
        `SELECT action FROM audit_log WHERE actor = $1 AND action = 'auth.password-reset.issued'`,
        [account.accountId],
      )) as unknown[];
      expect(audit).toHaveLength(1);
    });

    it('email inexistente → 200 {ok:true} igual, sin emitir token (no revela existencia)', async () => {
      const res = await requestReset(`fantasma-${Date.now()}@e2e.keru.test`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('confirm · token de un solo uso (A4.2)', () => {
    it('token válido → 200, setea la contraseña nueva, consume el token y auto-loguea', async () => {
      const account = await signup(app, 'family', 'Reset Feliz');
      await requestReset(account.email);
      const reset = await latestResetToken(account.accountId);

      const res = await confirmReset(reset!.token, 'NuevaClave!456');
      expect(res.status).toBe(200);
      expect(res.body.accountId).toBe(account.accountId);
      expect(res.body.accessToken).toBeTruthy();

      // El token nuevo (auto-login) es válido en un endpoint protegido.
      const me = await http(app).get('/api/v1/notifications').set(bearer(res.body.accessToken));
      expect(me.status).toBe(200);

      // El token de reset quedó consumido y el uso auditado.
      expect((await latestResetToken(account.accountId))?.status).toBe('used');
      const audit = (await db.query(
        `SELECT action FROM audit_log WHERE actor = $1 AND action = 'auth.password-reset.used'`,
        [account.accountId],
      )) as unknown[];
      expect(audit).toHaveLength(1);
    });

    it('la contraseña nueva sirve para login y la vieja ya no', async () => {
      const account = await signup(app, 'family', 'Reset Login');
      await requestReset(account.email);
      const reset = await latestResetToken(account.accountId);
      await confirmReset(reset!.token, 'OtraClave!789');

      const conVieja = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: account.password });
      expect(conVieja.status).toBe(401);

      const conNueva = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: 'OtraClave!789' });
      expect(conNueva.status).toBe(200);
    });

    it('token ya usado → 410 (single-use)', async () => {
      const account = await signup(app, 'family', 'Reset Reuso');
      await requestReset(account.email);
      const reset = await latestResetToken(account.accountId);

      const first = await confirmReset(reset!.token, 'Primera!123');
      expect(first.status).toBe(200);

      const reuse = await confirmReset(reset!.token, 'Segunda!123');
      expect(reuse.status).toBe(410);
    });

    it('token expirado → 410', async () => {
      const account = await signup(app, 'family', 'Reset Vencido');
      await requestReset(account.email);
      const reset = await latestResetToken(account.accountId);
      await db.query(`UPDATE password_reset_token SET "expiresAt" = now() - interval '1 hour' WHERE token = $1`, [
        reset!.token,
      ]);

      const res = await confirmReset(reset!.token, 'Tarde!12345');
      expect(res.status).toBe(410);
    });

    it('token inexistente → 410 (misma respuesta que expirado/usado, anti-enumeración)', async () => {
      const res = await confirmReset('token-que-no-existe-000', 'Cualquier!123');
      expect(res.status).toBe(410);
    });

    it('contraseña nueva demasiado corta → 400 (misma fuerza que el alta)', async () => {
      const account = await signup(app, 'family', 'Reset Debil');
      await requestReset(account.email);
      const reset = await latestResetToken(account.accountId);

      const res = await confirmReset(reset!.token, 'corta');
      expect(res.status).toBe(400);
    });
  });

  describe('confirm · revoca las sesiones vigentes de la cuenta (A4.2, NFR-41)', () => {
    it('tras el reset, un token de sesión emitido antes recibe 401', async () => {
      const account: TestAccount = await signup(app, 'family', 'Reset Revoca');

      // El token de sesión previo funciona.
      const before = await http(app).get('/api/v1/notifications').set(bearer(account.token));
      expect(before.status).toBe(200);

      // El corte por cuenta es de granularidad de segundo (iat del JWT): garantizamos que la
      // sesión previa sea estrictamente anterior al corte esperando > 1s antes de resetear.
      await sleep(1100);

      await requestReset(account.email);
      const reset = await latestResetToken(account.accountId);
      const confirmed = await confirmReset(reset!.token, 'Revocada!123');
      expect(confirmed.status).toBe(200);

      // El token viejo ahora recibe 401; el token nuevo del confirm sigue vivo.
      const oldAfter = await http(app).get('/api/v1/notifications').set(bearer(account.token));
      expect(oldAfter.status).toBe(401);

      const newAfter = await http(app)
        .get('/api/v1/notifications')
        .set(bearer(confirmed.body.accessToken));
      expect(newAfter.status).toBe(200);
    });
  });
});
