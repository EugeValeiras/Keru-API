// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

/**
 * Fitness functions (constitution §3.4) enforced as lint rules.
 * Capas IDesign por convención de path dentro de cada dominio:
 *   libs/<dominio>/src/manager/**          -> Manager
 *   libs/<dominio>/src/engine/**           -> Engine
 *   libs/<dominio>/src/resource-access/**  -> ResourceAccess
 *   libs/<dominio>/src/index.ts            -> API pública del dominio
 *   libs/core/**                           -> Utilities / base compartida
 *   apps/**                                -> composición / entrypoint
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['apps/**/*.ts', 'libs/**/*.ts'],
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*/**' },
        { type: 'core', pattern: 'libs/core/**' },
        { type: 'domain-api', pattern: 'libs/*/src/index.ts', mode: 'full' },
        { type: 'manager', pattern: 'libs/*/src/manager/**' },
        { type: 'engine', pattern: 'libs/*/src/engine/**' },
        { type: 'resource-access', pattern: 'libs/*/src/resource-access/**' },
        { type: 'domain-shared', pattern: 'libs/*/src/**' },
      ],
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'boundaries/no-unknown': 'off',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // Entrypoint: solo compone dominios (por su API pública) y core.
            { from: 'app', allow: ['app', 'domain-api', 'core'] },
            // Manager: orquesta hacia abajo (engine, resource-access) + core/shared.
            {
              from: 'manager',
              allow: ['engine', 'resource-access', 'core', 'domain-shared', 'domain-api'],
            },
            // Engine: solo lee ResourceAccess + core. NUNCA Manager.
            { from: 'engine', allow: ['resource-access', 'core', 'domain-shared'] },
            // ResourceAccess: solo core/shared. NUNCA Manager, Engine, ni otro RA.
            { from: 'resource-access', allow: ['core', 'domain-shared'] },
            // Base del dominio (dtos, entities, contratos): core/shared.
            { from: 'domain-shared', allow: ['core', 'domain-shared'] },
            { from: 'domain-api', allow: ['manager', 'domain-shared', 'core'] },
            // Core: aislado.
            { from: 'core', allow: ['core'] },
          ],
        },
      ],
    },
  },
  {
    // Constitution §3.4 (no-negociable): DB solo vía ResourceAccess.
    // Managers, Engines y Controllers NO inyectan repositorios ni DataSource.
    files: ['libs/*/src/manager/**/*.ts', 'libs/*/src/engine/**/*.ts', '**/*.controller.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Decorator[expression.callee.name='InjectRepository']",
          message:
            'Constitution §3.4: el acceso a la DB va solo por ResourceAccess. Un Manager/Engine/Controller no inyecta @InjectRepository.',
        },
        {
          selector: "Decorator[expression.callee.name='InjectDataSource']",
          message:
            'Constitution §3.4: las transacciones se abren con TransactionUtility, no con @InjectDataSource crudo.',
        },
      ],
    },
  },
  {
    // Los specs pueden importar lo que necesiten.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'apps/*/test/**'],
    rules: { 'boundaries/element-types': 'off' },
  },
);
