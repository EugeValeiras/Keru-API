import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

/**
 * Particiones lógicas (constitution §4): en el MVP una sola instancia Postgres con
 * dos schemas separados — `marketplace` (cuentas, vínculos, hirings, reviews, zonas)
 * y `clinical` (registros clínicos, rangos, alertas, outbox, consentimiento).
 * El día que se separe la unidad clínica por deploy, `clinical` se muda de instancia
 * sin tocar el código de dominio.
 */
export const MARKETPLACE_SCHEMA = 'marketplace';
export const CLINICAL_SCHEMA = 'clinical';

export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST', 'localhost'),
    port: config.get<number>('DB_PORT', 5432),
    username: config.get<string>('DB_USER', 'keru'),
    password: config.get<string>('DB_PASSWORD', 'keru'),
    database: config.get<string>('DB_NAME', 'keru'),
    autoLoadEntities: true,
    synchronize: config.get<string>('DB_SYNCHRONIZE', 'true') === 'true',
    logging: config.get<string>('DB_LOGGING', 'false') === 'true',
  };
}
