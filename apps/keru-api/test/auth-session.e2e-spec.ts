import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  TestAccount,
  bearer,
  caregiverProfileBody,
  createE2EApp,
  http,
  signup,
  signupAdmin,
  stepUp,
  stepUpHeader,
  uid,
} from './e2e-utils';

/**
 * KER-38 · UC-04: sesión revocable server-side y step-up para operaciones sensibles
 * (NFR-33/41). App real: Redis (denylist + outbox worker) y Postgres de docker.
 */
describe('E2E · Logout server-side y step-up admin (KER-38, NFR-33/41)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('logout revoca el token (denylist jti)', () => {
    it('tras el logout, el MISMO token recibe 401 en cualquier endpoint protegido', async () => {
      const familiar = await signup(app, 'family', 'Familiar Logout');

      const before = await http(app).get('/api/v1/notifications').set(bearer(familiar.token));
      expect(before.status).toBe(200);

      const logout = await http(app).post('/api/v1/auth/logout').set(bearer(familiar.token)).send({});
      expect(logout.status).toBe(200);
      expect(logout.body).toEqual({ ok: true });

      const after = await http(app).get('/api/v1/notifications').set(bearer(familiar.token));
      expect(after.status).toBe(401);
    });

    it('el logout queda auditado (membership.session.logout)', async () => {
      const familiar = await signup(app, 'family', 'Familiar Auditado');
      await http(app).post('/api/v1/auth/logout').set(bearer(familiar.token)).send({});
      const rows = (await app
        .get(DataSource)
        .query(`SELECT action FROM audit_log WHERE actor = $1 AND action = 'membership.session.logout'`, [
          familiar.accountId,
        ])) as unknown[];
      expect(rows).toHaveLength(1);
    });
  });

  describe('logout revoca las push subscriptions de la sesión (NFR-41)', () => {
    const subscribe = async (account: TestAccount, endpoint: string) => {
      const res = await http(app)
        .post('/api/v1/notifications/push/subscriptions')
        .set(bearer(account.token))
        .send({ endpoint, keys: { p256dh: 'BPubKeyDeMentira', auth: 'authDeMentira' } });
      expect(res.status).toBe(201);
    };

    const listSubscriptions = async (token: string): Promise<{ endpoint: string }[]> => {
      const res = await http(app).get('/api/v1/notifications/push/subscriptions').set(bearer(token));
      expect(res.status).toBe(200);
      return res.body as { endpoint: string }[];
    };

    const relogin = async (account: TestAccount): Promise<string> => {
      const res = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: account.password });
      expect(res.status).toBe(200);
      return res.body.accessToken as string;
    };

    /** El worker del outbox despacha async: poll hasta que la revocación aterrice. */
    const waitForSubscriptions = async (token: string, expected: number): Promise<{ endpoint: string }[]> => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const subs = await listSubscriptions(token);
        if (subs.length === expected || Date.now() > deadline) return subs;
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    it('con pushEndpoint revoca SOLO la del device que cierra sesión', async () => {
      const familiar = await signup(app, 'family', 'Familiar Push Device');
      const device = `https://push.e2e.keru.test/${uid('ep')}`;
      const otroDevice = `https://push.e2e.keru.test/${uid('ep')}`;
      await subscribe(familiar, device);
      await subscribe(familiar, otroDevice);

      const logout = await http(app)
        .post('/api/v1/auth/logout')
        .set(bearer(familiar.token))
        .send({ pushEndpoint: device });
      expect(logout.status).toBe(200);

      const fresh = await relogin(familiar);
      const subs = await waitForSubscriptions(fresh, 1);
      expect(subs.map((s) => s.endpoint)).toEqual([otroDevice]);
    });

    it('sin pushEndpoint revoca TODAS las de la cuenta (higiene > comodidad)', async () => {
      const familiar = await signup(app, 'family', 'Familiar Push Total');
      await subscribe(familiar, `https://push.e2e.keru.test/${uid('ep')}`);
      await subscribe(familiar, `https://push.e2e.keru.test/${uid('ep')}`);

      await http(app).post('/api/v1/auth/logout').set(bearer(familiar.token)).send({});

      const fresh = await relogin(familiar);
      const subs = await waitForSubscriptions(fresh, 0);
      expect(subs).toHaveLength(0);
    });
  });

  describe('step-up en operaciones admin sensibles (NFR-33)', () => {
    let admin: TestAccount;
    let caregiverId: string;

    beforeAll(async () => {
      admin = await signupAdmin(app);
      const account = await signup(app, 'caregiver', 'Laura Step-Up');
      const created = await http(app)
        .post('/api/v1/caregivers')
        .set(bearer(account.token))
        .send(caregiverProfileBody());
      expect(created.status).toBe(201);
      caregiverId = created.body.id as string;
    });

    it('approve sin step-up: 403 STEP_UP_REQUIRED — el rol admin NO alcanza', async () => {
      const res = await http(app)
        .post(`/api/v1/admin/caregivers/${caregiverId}/approve`)
        .set(bearer(admin.token));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('STEP_UP_REQUIRED');
    });

    it('un Bearer común en x-step-up-token no sirve (falta el claim step_up): 403', async () => {
      const res = await http(app)
        .post(`/api/v1/admin/caregivers/${caregiverId}/approve`)
        .set(bearer(admin.token))
        .set(stepUpHeader(admin.token));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('STEP_UP_REQUIRED');
    });

    it('step-up con password incorrecto: 401 y no emite token', async () => {
      const res = await http(app)
        .post('/api/v1/auth/step-up')
        .set(bearer(admin.token))
        .send({ password: 'incorrecta!' });
      expect(res.status).toBe(401);
    });

    it('con step-up válido el approve procede, y emisión + uso quedan auditados', async () => {
      const token = await stepUp(app, admin);
      const res = await http(app)
        .post(`/api/v1/admin/caregivers/${caregiverId}/approve`)
        .set(bearer(admin.token))
        .set(stepUpHeader(token));
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('approved');

      const actions = (await app
        .get(DataSource)
        .query(
          `SELECT action FROM audit_log WHERE actor = $1 AND action IN ('auth.step-up.issued', 'auth.step-up.used') ORDER BY action`,
          [admin.accountId],
        )) as { action: string }[];
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining(['auth.step-up.issued', 'auth.step-up.used']),
      );
    });

    it('reject exige el mismo step-up: sin token 403, con token procede', async () => {
      const account = await signup(app, 'caregiver', 'Laura Rechazada');
      const created = await http(app)
        .post('/api/v1/caregivers')
        .set(bearer(account.token))
        .send(caregiverProfileBody());
      expect(created.status).toBe(201);

      const sinStepUp = await http(app)
        .post(`/api/v1/admin/caregivers/${created.body.id}/reject`)
        .set(bearer(admin.token))
        .send({ reason: 'Documentación incompleta' });
      expect(sinStepUp.status).toBe(403);
      expect(sinStepUp.body.code).toBe('STEP_UP_REQUIRED');

      const conStepUp = await http(app)
        .post(`/api/v1/admin/caregivers/${created.body.id}/reject`)
        .set(bearer(admin.token))
        .set(stepUpHeader(await stepUp(app, admin)))
        .send({ reason: 'Documentación incompleta' });
      expect(conStepUp.status).toBe(201);
      expect(conStepUp.body.status).toBe('rejected');
    });
  });
});
