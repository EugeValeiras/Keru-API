import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AccountAccess, MembershipManager } from '@keru/membership';
import { AccountRole } from '@keru/core';
import { AppModule } from './app.module';

/**
 * Seed idempotente de datos de demo. Ejecutar con infra levantada:
 *   npm run infra:up && npm run seed
 */
async function seed() {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const accounts = app.get(AccountAccess, { strict: false });
  const membership = app.get(MembershipManager, { strict: false });

  async function ensureAccount(email: string, role: AccountRole, displayName: string) {
    const existing = await accounts.findAccountByEmail(email);
    if (existing) return existing;
    const res = await membership.signup({ email, password: 'S3gura!123', role, displayName });
    return accounts.findAccountByEmail(res.email);
  }

  const family = await ensureAccount('familiar@test.com', 'family', 'Juan Díaz');
  await ensureAccount('cuidador@test.com', 'caregiver', 'Laura Gómez');
  await ensureAccount('admin@test.com', 'admin', 'Admin Keru');

  if (family) {
    await membership.registerPatient(
      {
        operationId: 'seed-patient-rosa',
        fullName: 'Rosa Díaz',
        birthDate: '1948-03-10',
        mainCondition: 'Hipertensión',
        bloodGroup: '0+',
        allergies: ['Penicilina'],
        emergencyContact: { name: 'Juan Díaz', phone: '+54 11 5555-5555', relationship: 'hijo' },
      },
      family.id,
    );
  }

  logger.log('Seed completo. Cuentas: familiar@test.com / cuidador@test.com / admin@test.com (pass: S3gura!123)');
  logger.log('Paciente demo: Rosa Díaz (vinculada a familiar@test.com)');
  await app.close();
}

void seed();
