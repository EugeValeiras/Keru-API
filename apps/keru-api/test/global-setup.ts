import { Client } from 'pg';
import { E2E_DB_NAME } from './e2e-db';

/**
 * Recrea la base e2e antes de la corrida: cada `npm run test:e2e` parte de una base vacía
 * (el schema lo crea TypeORM synchronize al bootear cada spec). Se conecta a la base
 * administrativa `postgres` para poder dropear la e2e aunque haya conexiones colgadas.
 */
export default async function recreateE2EDatabase(): Promise<void> {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'keru',
    password: process.env.DB_PASSWORD ?? 'keru',
    database: 'postgres',
  });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB_NAME} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${E2E_DB_NAME}`);
  } finally {
    await client.end();
  }
}
