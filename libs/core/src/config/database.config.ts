import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ALL_MIGRATIONS } from '../migrations';

/**
 * Particiones lógicas (constitution §4): en el MVP una sola instancia Postgres con
 * dos schemas separados — `marketplace` (cuentas, vínculos, hirings, reviews, zonas)
 * y `clinical` (registros clínicos, rangos, alertas, outbox, consentimiento).
 * El día que se separe la unidad clínica por deploy, `clinical` se muda de instancia
 * sin tocar el código de dominio.
 */
export const MARKETPLACE_SCHEMA = 'marketplace';
export const CLINICAL_SCHEMA = 'clinical';

/**
 * TLS hacia Postgres (NFR-seguridad). En RDS/managed la conexión debe ir cifrada
 * (rds.force_ssl). Opt-in por `DB_SSL=true` para no afectar dev local / e2e.
 * Si se provee `DB_SSL_CA` (PEM del CA de RDS) se valida el certificado del server
 * (rejectUnauthorized=true); si no, se cifra sin validar la cadena (aceptable dentro
 * de una VPC cerrada, pero DB_SSL_CA es lo recomendado para prod).
 */
export function buildDbSsl(config: ConfigService): boolean | { ca?: string; rejectUnauthorized: boolean } {
  if (config.get<string>('DB_SSL', 'false') !== 'true') {
    return false;
  }
  const ca = config.get<string>('DB_SSL_CA');
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST', 'localhost'),
    port: config.get<number>('DB_PORT', 5432),
    username: config.get<string>('DB_USER', 'keru'),
    password: config.get<string>('DB_PASSWORD', 'keru'),
    database: config.get<string>('DB_NAME', 'keru'),
    ssl: buildDbSsl(config),
    autoLoadEntities: true,
    // KER-29 / NFR-25: el esquema lo gobiernan las migraciones versionadas. synchronize
    // sobre el store clínico puede alterar/dropear columnas en silencio, así que es
    // opt-in EXPLÍCITO y solo para dev local / e2e (ver apps/keru-api/test/e2e-env.ts).
    synchronize: config.get<string>('DB_SYNCHRONIZE', 'false') === 'true',
    migrations: ALL_MIGRATIONS,
    // Correr las migraciones pendientes al bootear (compose local / despliegues sin
    // paso de release separado). Default apagado: en dev contra una base viva no se
    // migra por accidente; se corre a mano con `npm run migration:run`.
    migrationsRun: config.get<string>('DB_MIGRATIONS_RUN', 'false') === 'true',
    logging: config.get<string>('DB_LOGGING', 'false') === 'true',
  };
}
