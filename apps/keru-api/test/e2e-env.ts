import { E2E_DB_NAME } from './e2e-db';

/**
 * Entorno de cada spec e2e (setupFiles: corre antes de importar el AppModule, que congela
 * THROTTLE_AUTH_LIMIT al importar la config de throttling). La app real se conecta al
 * Postgres/Redis de docker (localhost por default; en CI, services del job).
 */
process.env.DB_NAME = E2E_DB_NAME;
// Opt-in EXPLÍCITO de synchronize (KER-29): keru_e2e es descartable — el globalSetup la
// recrea vacía en cada corrida y cada spec bootea su schema desde las entidades, sin
// depender del estado de las migraciones. La fidelidad migración↔entidades la cubre el
// job `migrations` del CI (base vacía + migration:run + boot con synchronize apagado).
process.env.DB_SYNCHRONIZE = 'true';

// Bypass del rate limiting por default (skipIf es lazy: se evalúa por request). El spec de
// throttling lo apaga en su beforeAll para ejercitar el guard real con la cuota de auth en 5.
process.env.THROTTLE_SKIP = 'true';
process.env.THROTTLE_AUTH_LIMIT = '5';
