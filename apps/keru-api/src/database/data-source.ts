import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ALL_MIGRATIONS } from '@keru/core';

/**
 * DataSource del CLI de TypeORM (migration:generate / run / revert — scripts npm
 * `migration:*`). Espeja la conexión de buildTypeOrmOptions
 * (libs/core/src/config/database.config.ts), pero como el CLI corre fuera de Nest
 * (sin autoLoadEntities) carga las entidades por glob. Nunca sincroniza: el esquema
 * sale solo de las migraciones registradas en ALL_MIGRATIONS.
 */
// TLS opt-in (igual que buildTypeOrmOptions): DB_SSL=true, con DB_SSL_CA opcional.
const ssl =
  process.env.DB_SSL === 'true'
    ? process.env.DB_SSL_CA
      ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: false }
    : false;

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'keru',
  password: process.env.DB_PASSWORD ?? 'keru',
  database: process.env.DB_NAME ?? 'keru',
  ssl,
  entities: ['libs/**/*.entity.ts'],
  migrations: ALL_MIGRATIONS,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});
