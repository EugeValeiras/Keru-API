/**
 * Base dedicada de la suite e2e: aislada de la `keru` de desarrollo (mismo Postgres de
 * docker). globalSetup la recrea desde cero en cada corrida; los specs la usan vía DB_NAME.
 */
export const E2E_DB_NAME = 'keru_e2e';
