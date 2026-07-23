import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AllExceptionsFilter } from '@keru/core';
import { AppModule } from '../src/app.module';

/**
 * Helpers de la suite e2e (KER-28): bootean el AppModule REAL — Postgres/Redis de docker,
 * KeruAuthorityProvider real, sin stubs — y arman los actores de los casos de uso por la
 * misma API pública que usaría un cliente (signup → paciente → cuidador → contratación).
 */

export interface TestAccount {
  accountId: string;
  email: string;
  password: string;
  token: string;
}

export const uid = (prefix: string): string => `${prefix}-${randomUUID()}`;

export const bearer = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

/** KER-38 (NFR-33): header del token corto de re-confirmación para operaciones sensibles. */
export const stepUpHeader = (token: string): Record<string, string> => ({
  'x-step-up-token': token,
});

/** KER-38 · Re-confirma el password de la cuenta y devuelve el token corto step_up. */
export async function stepUp(app: INestApplication, account: TestAccount): Promise<string> {
  const res = await http(app)
    .post('/api/v1/auth/step-up')
    .set(bearer(account.token))
    .send({ password: account.password });
  if (res.status !== 200) {
    throw new Error(`step-up falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.stepUpToken as string;
}

export const http = (app: INestApplication) => request(app.getHttpServer());

/** App real configurada igual que main.ts (prefijo /api/v1, pipes y envelope de errores). */
export async function createE2EApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

export async function signup(
  app: INestApplication,
  role: 'patient' | 'family' | 'caregiver',
  displayName = 'Cuenta E2E',
): Promise<TestAccount> {
  const email = `${role}-${randomUUID()}@e2e.keru.test`;
  const password = 'S3gura!123';
  const res = await http(app).post('/api/v1/auth/signup').send({ email, password, role, displayName });
  if (res.status !== 201) {
    throw new Error(`signup ${role} falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { accountId: res.body.accountId, email, password, token: res.body.accessToken };
}

/** El rol admin no se auto-registra (UC-04): se promueve por SQL y se reloguea para un token admin. */
export async function signupAdmin(app: INestApplication): Promise<TestAccount> {
  const account = await signup(app, 'family', 'Admin E2E');
  await app.get(DataSource).query(`UPDATE account SET role = 'admin' WHERE id = $1`, [account.accountId]);
  const res = await http(app)
    .post('/api/v1/auth/login')
    .send({ email: account.email, password: account.password });
  if (res.status !== 200) {
    throw new Error(`login admin falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { ...account, token: res.body.accessToken };
}

export function patientBody(operationId: string = uid('op-patient')) {
  return {
    operationId,
    fullName: 'Rosa Díaz',
    birthDate: '1948-03-10',
    mainCondition: 'Hipertensión',
    allergies: ['Penicilina'],
    emergencyContact: { name: 'María Díaz', phone: '+54 11 5555-5555', relationship: 'hija' },
  };
}

/** UC-01: registra un paciente; el creador queda vinculado como consent-holder. Devuelve su id. */
export async function registerPatient(app: INestApplication, token: string): Promise<string> {
  const res = await http(app).post('/api/v1/patients').set(bearer(token)).send(patientBody());
  if (res.status !== 201) {
    throw new Error(`registerPatient falló: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id;
}

export function caregiverProfileBody(operationId: string = uid('op-caregiver')) {
  return {
    operationId,
    displayName: 'Laura Gómez',
    specialties: ['elder-care'],
    certifications: [{ type: 'Enfermería', institution: 'UBA', year: 2015 }],
    availability: [{ dayOfWeek: 1, from: '08:00', to: '16:00' }],
    rates: { ratePerHour: 3500, currency: 'ARS' },
    zone: 'Palermo, CABA',
    modalities: ['home'],
  };
}

/**
 * UC-02 + UC-19: cuenta caregiver con perfil creado y aprobado por un admin.
 * Aprobar es operación sensible (KER-38, NFR-33): exige step-up, por eso recibe la cuenta
 * admin completa (necesita su password para la re-confirmación), no solo el token.
 */
export async function createApprovedCaregiver(
  app: INestApplication,
  admin: TestAccount,
): Promise<{ account: TestAccount; caregiverId: string }> {
  const account = await signup(app, 'caregiver', 'Laura Gómez');
  const created = await http(app)
    .post('/api/v1/caregivers')
    .set(bearer(account.token))
    .send(caregiverProfileBody());
  if (created.status !== 201) {
    throw new Error(`registro de cuidador falló: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const approved = await http(app)
    .post(`/api/v1/admin/caregivers/${created.body.id}/approve`)
    .set(bearer(admin.token))
    .set(stepUpHeader(await stepUp(app, admin)));
  if (approved.status !== 201) {
    throw new Error(`aprobación de cuidador falló: ${approved.status} ${JSON.stringify(approved.body)}`);
  }
  return { account, caregiverId: created.body.id };
}

export function hiringRequestBody(
  patientId: string,
  caregiverId: string,
  window: { startDate: string; endDate: string },
  operationId: string = uid('op-hiring'),
) {
  return {
    operationId,
    patientId,
    caregiverId,
    modality: 'home',
    ...window,
    contactData: { phone: '+54 11 5555-5555' },
  };
}

export const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
